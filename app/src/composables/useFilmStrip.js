// BLOGS 轨道的**扭曲层**（Three.js）：把封面画在细分过的平面上，所以画面能**弯**、
// 能被随滚动变化的波形扭 —— 这是整条轨道里唯一必须 WebGL 的地方
// （CSS 只能整体刚性变换，一张图弯不了）。
//
// ── 分工（和 useFilmPose.js 的关系）─────────────────────────────────────
//   · **姿态**（每张卡在圆柱上的位置 / 转角 / 后退 / 缩放）只算一份，在 useFilmPose.js。
//     调用方（BlogsView 主循环）把同一份 pose 同时写进两处：
//       ① DOM 卡片的 matrix3d（连标题编号一起，所以字和面永远对得上）；
//       ② 这里的 mesh（下面 render 的 items[i].pose）。
//     ⚠ 这一层**不再自带姿态数学** —— 曾经两边各有一份，一改就劈叉，
//       图和字差开一整个位移量那种错位就是这么来的。
//   · **图像**由这一层画。DOM 里那张 <img> 只在"这张卡还没有贴图"时才露出来
//     （见下面的 is-film-live），所以本地 dev 拿不到跨域像素时，卡片照旧是照片，
//     不会变成空框。
//
// ── 相机（必须和 CSS 那套投影是同一个）──────────────────────────────────
//   视口高 H、纵向视角 fov → 焦距 D = (H/2)/tan(fov/2)，相机在 (0,0,+D) 看原点。
//   这样 z=0 平面上 1 个世界单位 = 1 个 CSS px，卡片直接按 viewport 像素摆即可。
//
// ── 拿不到 WebGL / three 拉不下来 ────────────────────────────────────────
//   createFilmStrip 返回 null，调用方什么都不做：卡片退回普通的 <img>，
//   3D 排布照旧（那部分是纯 CSS 数学）。
const DEG = Math.PI / 180;

// three 走**动态 import**，不进首屏包（和 useRippleEffect 同一个理由）。
const FOV = 30;         // 与 useFilmPose 的 FILM.fov 一致（那边管投影，这边管相机）
const TEX_SIZES = { near: 1024, far: 384 }; // 正面清楚、背面小一号（整圈一起驻留时的分水岭）
// ⚠ 上限必须容纳**整圈所有卡片的两档贴图**：24 张 × (near/far) = 最多 48 条。
//   给少了会出两种毛病，都是"卡片突然变回占位色/变黑"：
//     · 把**正在用**的那张 dispose 掉（mesh 还指着它）→ 采样纯黑；
//     · 把刚建好的另一档挤掉 → 那张卡下一次进视野要重建，中间这段就是占位色。
//   实测：上限 22 时正面几张变黑；36 时滚动中仍会被挤掉（24×2 > 36）。
const TEX_KEEP = 48;
// ── 画面自身的弧度 ──────────────────────────────────────────────────────
// ⚠ 弧度**不是每张一样大**：按"这张卡离屏幕中线多远"给 —— 正中间几乎平的，
//   越往边上越弯（边上的卡片等于歪在鼓面上，画面跟着鼓起来）。
//   BOW 是**屏幕边缘那一档**的值，中间那张拿 BOW_BASE 打底（完全 0 会显得发平）。
const BOW = 160;        // 屏幕边缘那张的弧度（世界 px，越大越鼓）
const BOW_BASE = 0.15;  // 中线那张保留多少弧度（0 = 中间完全平）
const BOW_GAMMA = 1.7;  // 渐变曲线：>1 = 中间平、往外陡；1 = 线性
const BOW_Y = 0.35;     // 纵向也分一点弧度（0 = 只横向弯，1 = 横竖一样）

const VERT = /* glsl */ `
  uniform float uBow;      // 画面自身的弧度（世界 px，按离中线的距离给）
  uniform float uWave;     // 随滚动的波形幅度（0..1）
  uniform float uPhase;    // 波形相位（跟着滚动量走：停下就定住）
  varying vec2 vUv;
  varying float vWave;
  void main() {
    vUv = uv;
    vec3 p = position;                 // PlaneGeometry(1,1)：中心在原点，范围 ±0.5
    // 抛物线弧：中间最鼓、两头回到 0（"这张画面本身是弯的"，不是整块斜过去）。
    // 纵向再按 BOW_Y 分一份（横竖都鼓 = 更像整张画面被掰在弧面上）。
    float bow = uBow * ((0.25 - p.x * p.x) + ${BOW_Y} * (0.25 - p.y * p.y)) * 4.0;
    // 行波：沿画面的 x 走，幅度由滚动速度给 —— 这就是"随滚动去扭曲"那一层
    float wave = sin(p.x * 6.2831853 + uPhase) * uWave;
    p.z += bow + wave;
    vWave = wave;
    // ⚠ mesh 的缩放是 (宽, 高, 1)：局部 z 乘的是 1，所以位移单位就是世界 px。
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uTex;
  uniform vec3 uTone;       // 还没贴图时的占位色（和列表卡片上的 --ph 同一个值）
  uniform float uHasTex;
  uniform float uOpacity;
  uniform float uHover;     // 悬停：对应 CSS 里那张图的 scale(1.035)
  uniform float uPlaneAspect;
  uniform float uTextureAspect;
  uniform float uWave;
  uniform float uPhase;
  varying vec2 vUv;
  varying float vWave;

  // object-fit: cover —— 把块的 UV 映射到贴图上被裁切后的那块
  vec2 coverUv(vec2 uv) {
    float s = uTextureAspect / uPlaneAspect;
    vec2 k = s > 1.0 ? vec2(1.0 / s, 1.0) : vec2(1.0, s);
    return (uv - 0.5) * k + 0.5;
  }

  void main() {
    vec2 uv = vUv;
    uv = (uv - 0.5) / (1.0 + 0.035 * uHover) + 0.5;   // 悬停放大
    // 画面内部也跟着波形拧一下：只靠顶点位移读起来像"板子被掰弯"，
    // 采样 UV 一起动才像"画面在流动"
    uv.x += sin(uv.y * 3.1415926 + uPhase) * uWave * 0.018;
    vec4 tex = texture2D(uTex, coverUv(uv));
    vec3 col = mix(uTone, tex.rgb, uHasTex);
    col *= 1.0 - abs(vWave) * 0.4; // 波峰处压一点亮度，给"胶片过片门"一点存在感
    gl_FragColor = vec4(col, uOpacity);
  }
`;

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<null | { op: {v:number}, render: Function, resize: Function,
 *                        dispose: Function, stats: Function }>}
 */
export async function createFilmStrip(canvas) {
  let THREE;
  try {
    THREE = await import('three');
  } catch {
    return null;
  }
  const {
    CanvasTexture, Color, DoubleSide, LinearMipmapLinearFilter, Mesh, NoColorSpace,
    PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, WebGLRenderer,
  } = THREE;

  let renderer;
  try {
    renderer = new WebGLRenderer({
      canvas, antialias: true, alpha: true, powerPreference: 'high-performance',
    });
  } catch {
    return null; // 没有 WebGL
  }

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 1, 100000);
  const geometry = new PlaneGeometry(1, 1, 24, 16); // 细分是为了能弯；4 个顶点弯不了
  // 贴图缓存。键 = `${尺寸}#${图的唯一 id}` —— **一张图的两个档位是两条独立记录**。
  // 早先是"一个 <img> 一条记录"，于是卡片在近/远档之间切换时，旧记录被 dispose、
  // 而另一张还在用它的 mesh 就采样到纯黑（用户报的"照片加载出来了却黑屏"）。
  // Map 保持插入序，顺手当 LRU 用。
  let texCache = new Map();
  // ⚠ 缓存键是**图片地址**，不是 <img> 元素：无限循环把每篇文章铺了三份，
  //   三份各有自己的 <img>（同一个 URL）—— 按元素缓存等于**同一张照片存三张贴图**，
  //   显存 ×3、LRU 被挤爆、回卷换到另一份时还要重建（就是"滚着滚着变回色块"的来源）。
  //   按 URL 缓存后：一张照片一张贴图，三份副本共享，回卷时直接命中。
  const urlOf = (img) => (img && (img.dataset?.src || img.currentSrc || img.src)) || '';
  const noTexUrls = new Set(); // 跨域拿不到干净像素的图（按 URL 记，三份一起跳过）
  const pool = [];
  const live = new Map();   // key → mesh
  const op = { v: 1 };      // 全局不透明度（调用方直接补间它）
  let disposed = false;
  let texWarned = false;
  let texBlocked = false;   // 贴图被浏览器拒过一次之后，这一层就永远只用占位色
  // 这一层**不再画了**（WebGL 上下文丢了 / 贴图彻底不可用）：
  //   ⚠ 这时必须把"我把 DOM 那张 <img> 藏起来了"这件事**撤回** ——
  //     否则画面上是 canvas 一片黑、而照片被我们自己藏了 = **黑屏**
  //     （用户报的"照片明明加载出来了却黑屏"就是这一类）。
  let dead = false;
  let lastW = 0;
  let lastH = 0;

  function resize() {
    if (disposed) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    lastW = w;
    lastH = h;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false); // false：别动 canvas 的 CSS 尺寸
    camera.aspect = w / h;
    camera.position.set(0, 0, (h / 2) / Math.tan((FOV * DEG) / 2));
    camera.updateProjectionMatrix();
  }

  // ── 贴图 ────────────────────────────────────────────────────────────────
  // 来源是**列表里那张已经加载好的 <img>**（同一个 URL、走原有的懒加载），
  // 先缩到目标档位再上传：把 1920px 的原图直接传到显存是纯浪费。
  function textureFor(img, bucket) {
    if (texBlocked) return null;
    // ⚠ 必须等它**真的下完**再画：`naturalWidth` 在元数据到齐时就有了，像素却还在路上，
    //   这时 drawImage 会**静默画出一张空画布** —— 拿到贴图上就是纯黑，
    //   正是"照片加载出来了却黑屏"和"有的卡一直是占位色"的来源。
    //   `img.complete` + naturalWidth 才是"加载成功且可以画"。
    //   还没下完就返回 null，下一帧再看（图 load 完会喊一帧，见 BlogsView 里的 filmDirty）。
    if (!img || !img.complete || !img.naturalWidth) return null;
    // CORS 被拒过的图（BlogsView.loadCoverImage 会打上这个标记）：像素是"污染"的，
    // 画进 canvas 再传 WebGL 会每帧抛 SecurityError。这一张索性不做贴图。
    if (img.dataset && img.dataset.noTex === '1') noTexUrls.add(urlOf(img));
    if (noTexUrls.has(urlOf(img))) return null;
    const size = TEX_SIZES[bucket] || TEX_SIZES.near;
    const url = urlOf(img);
    if (!url) return null;
    const key = `${size}#${url}`;
    const hit = texCache.get(key);
    if (hit) {
      texCache.delete(key); // 命中就挪到队尾（LRU）
      texCache.set(key, hit);
      return { key, tex: hit.tex };
    }
    const sw = img.naturalWidth;
    const sh = img.naturalHeight;
    // 超大图**不做贴图**：5782×4869 / 4895×6528 这种（11MB / 27.9MB）画进 canvas 会
    // 吃掉一大块内存、还会拖住主线程。这类图交给 DOM 那张 <img> 显示（不弯，但看得见）。
    // （和上面"没下完"那条是不同的两件事：这里是图本身太大，不是还没到。）
    if (!(sw > 0 && sh > 0) || sw * sh > 20e6) return null;
    const k = Math.min(1, size / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * k));
    c.height = Math.max(1, Math.round(sh * k));
    try {
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('拿不到 2d 上下文');
      ctx.drawImage(img, 0, 0, c.width, c.height);
    } catch (err) {
      if (!texWarned) {
        texWarned = true;
        console.warn('[film] 封面缩图失败，这一层只剩占位色：', err && err.message,
          img.currentSrc || img.src);
      }
      return null;
    }
    const t = new CanvasTexture(c);
    // 直通色彩空间：这条管线只是"取样 → 输出"，中间没有光照计算。
    t.colorSpace = NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    texCache.set(key, { tex: t });
    // ⚠ 回收时**跳过正在被 mesh 用的那些**：把 live 的那张 dispose 掉、mesh 还指着它，
    //   采样出来就是纯黑（实测：上限 22 < 同时在画 24 张，先建的那几张被回收 → 全黑）。
    //   上限调大只是缓解，这道判断才是根治。
    const inUse = new Set();
    for (const [, m] of live) if (m.userData.texKey) inUse.add(m.userData.texKey);
    while (texCache.size > TEX_KEEP) {
      let victim = null;
      for (const [k] of texCache) {
        if (!inUse.has(k)) { victim = k; break; }
      }
      if (!victim) break; // 全都在用：宁可不回收，也不许把画面弄黑
      texCache.get(victim).tex.dispose();
      texCache.delete(victim);
    }
    return { key, tex: t };
  }

  function acquire() {
    const m = pool.pop();
    if (m) {
      m.visible = true;
      // ⚠ 从池子里复用时**必须把"这张卡是谁"的那几项清干净**：材质是跟着 mesh 走的，
      //   留着上一张卡的 uTex/uHasTex，新卡一进窗口就直接顶着**上一张卡的封面**显示
      //   —— 表现就是"图片跟文章对不上"（滚动、或从详情返回时卡片刚进出过窗口，
      //   正是最容易撞上这个的时刻）。uPlaneAspect 同理，不清会沿用上一张的长宽比、
      //   裁切也跟着错。
      const u = m.material.uniforms;
      u.uTex.value = null;
      u.uHasTex.value = 0;
      u.uPlaneAspect.value = 1;
      u.uTextureAspect.value = 1;
      m.userData.texKey = null;
      m.userData.el = null;
      return m;
    }
    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true, // 交接（进 / 退场）时要整体淡出
      // ⚠ 必须双面：整圈转过去的那一半卡片是**背朝观众**的，单面渲染会被整片剔除
      //   —— 表现就是"圆柱背面那一圈不见了"（DOM 版没有背面剔除，所以看得见）。
      side: DoubleSide,
      uniforms: {
        uTex: { value: null },
        uTone: { value: new Color() },
        uHasTex: { value: 0 },
        uOpacity: { value: 1 },
        uHover: { value: 0 },
        uPlaneAspect: { value: 1 },
        uTextureAspect: { value: 1 },
        uBow: { value: BOW },
        uWave: { value: 0 },
        uPhase: { value: 0 },
      },
    });
    const mesh = new Mesh(geometry, material);
    scene.add(mesh);
    return mesh;
  }

  /**
   * 每帧调一次。
   *
   * @param {Array} items 这一帧要画的卡：
   *        { key, el, pose, media:{width,height}, img, tone, hover, texSize }
   *        pose 由 useFilmPose.poseAt 算好（DOM 那边用的是同一份）。
   * @param {{phase:number, flyingKey:any}} state
   */
  function render(items, state) {
    if (disposed) return;
    if (canvas.clientWidth !== lastW || canvas.clientHeight !== lastH) resize();
    const used = new Set();
    for (let i = 0; i < items.length; i += 1) used.add(items[i].key);
    for (const [key, mesh] of live) {
      if (!used.has(key)) {
        mesh.visible = false;
        pool.push(mesh);
        live.delete(key);
      }
    }

    for (let i = 0; i < items.length; i += 1) {
      const it = items[i];
      const p = it.pose;
      let mesh = live.get(it.key);
      if (!mesh) {
        mesh = acquire();
        live.set(it.key, mesh);
      }
      // 这两项是"这张卡自己的"：每帧按当前卡写，复用的 mesh 就不会带着上一位的信息
      mesh.material.uniforms.uPlaneAspect.value = it.media.width / it.media.height;
      mesh.material.uniforms.uTone.value.set(it.tone || '#c8cdd2');
      mesh.userData.el = it.el; // 出事时要照着它把 DOM 那张 <img> 放回来
      const u = mesh.material.uniforms;
      // 图是懒加载来的，加载完不通知我们：每帧顺手看一眼，能建就建。
      // textureFor 对"没加载完"一句话返回 null，命中缓存 O(1)，白看不贵。
      if (!u.uHasTex.value) {
        const got = textureFor(it.img, it.texSize);
        if (got) {
          u.uTex.value = got.tex;
          u.uHasTex.value = 1;
          u.uTextureAspect.value = got.tex.image.width / got.tex.image.height;
          mesh.userData.texKey = got.key; // 让回收器知道这张正在用
        }
      }
      // 有贴图了才把 DOM 那张 <img> 藏起来（见文件头）；没贴图就一直留着，
      // 本地 dev 拿不到跨域像素时卡片照旧是照片，不会变成空框。
      const ready = u.uHasTex.value === 1 && !dead;
      if (it.el && it.live !== ready) {
        it.live = ready;
        it.el.classList.toggle('is-film-live', ready);
      }
      // 世界坐标 = viewport 像素（见文件头）。位置要加 wx / wy（世界位移），
      // 不能只用 X / Y（布局位置）—— 见 useFilmPose.poseAt 的注释。
      mesh.position.set(p.X + p.wx, p.Y + p.wy, -p.depth);
      mesh.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
      mesh.scale.set(it.media.width * p.scale, it.media.height * p.scale, 1);
      // 弧度按"离屏幕中线多远"给：中间平、边上鼓（见 BOW 那一段注释）
      const edge = Math.min(1, Math.max(0, it.edge || 0));
      const bow = BOW * (BOW_BASE + (1 - BOW_BASE) * Math.pow(edge, BOW_GAMMA));
      // ⚠ 背面那半圈要**取反**，否则它的弧也是朝外鼓的。
      //   edge 只回答"离屏幕中线多远"，而圆柱背面那一圈在屏幕上同样落在两侧 ——
      //   同一个 edge 值，正面和背面拿到的是同一个弧度，方向也就跟着一样。
      //   背面是圆柱的后壁，从观众这侧看过去必须是**向里凹**（正面才是朝外鼓）。
      //   标志由 BlogsView 按转角给（和收标签用的 is-back 同一条件）。
      u.uBow.value = it.back ? -bow : bow;
      u.uOpacity.value = (it.key === state.flyingKey) ? 1 : op.v;
      u.uHover.value = it.hover ? 1 : 0;
      u.uPhase.value = state.phase;
    }

    if (dead) return; // 已经收工（见 dead 的注释），后面每帧都只是空转
    try {
      renderer.render(scene, camera);
    } catch (err) {
      // 最后一道闸：万一还是混进了一张"污染"的贴图，three 会在上传时抛 SecurityError。
      // 就地清空所有贴图、退回占位色，并且只报一次 —— 不能让它每帧抛一次。
      if (!texBlocked) {
        texBlocked = true;
        console.warn('[film] 贴图被浏览器拒绝（跨域污染），这一层改用占位色：', err && err.message);
      }
      for (const [, en] of texCache) en.tex.dispose();
      texCache = new Map();
      const clear = (m) => {
        m.userData.texKey = null;
        m.material.uniforms.uTex.value = null;
        m.material.uniforms.uHasTex.value = 0;
      };
      for (const [, m] of live) {
        clear(m);
        // 撤回：这张卡的封面交回给 DOM 里那张 <img>（它就是照片本身）
        m.userData.el?.classList.remove('is-film-live');
      }
      for (const m of pool) clear(m);
      // 这一层作废：DOM 图片全部放回来，别留一片黑
      for (const [, m] of live) m.visible = false;
      dead = true;
    }
  }

  // WebGL 上下文丢了（驱动重置、切显卡、标签页被回收）：canvas 立刻变全黑，
  // 而我们的 DOM 图片是藏着的 —— 必须马上把封面交回 DOM（见 dead）。
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    dead = true;
    for (const [, m] of live) {
      m.userData.el?.classList.remove('is-film-live');
      m.visible = false;
    }
    for (const [, en] of texCache) en.tex.dispose();
    texCache = new Map();
    console.warn('[film] WebGL 上下文丢失，封面交回 DOM 图片显示。');
  });

  resize();

  return {
    // 全局不透明度：调用方补间 `op.v`（交接的进出场和 DOM 卡片同一拍）。
    // 被点的那张由 state.flyingKey 单独豁免、一直亮着。
    op,
    render,
    resize,
    stats: () => {
      // dupTex：几对 mesh 用的是同一张贴图 —— 池子复用没清干净时这个数会 > 0，
      // 表现就是"卡片顶着别人的封面"（见 acquire 里那段）。
      const seen = new Map();
      let dup = 0;
      for (const [, m] of live) {
        const t = m.material.uniforms.uTex.value;
        if (!t) continue;
        if (seen.has(t)) dup += 1; else seen.set(t, true);
      }
      return { meshes: live.size, textures: texCache.size, dead, dupTex: dup,
        dpr: renderer.getPixelRatio() };
    },
    dispose() {
      disposed = true;
      for (const [, m] of live) m.userData.el?.classList.remove('is-film-live');
      for (const [, mesh] of live) mesh.material.dispose();
      live.clear();
      for (const m of pool) m.material.dispose();
      pool.length = 0;
      for (const [, en] of texCache) en.tex.dispose();
      texCache = new Map();
      geometry.dispose();
      renderer.dispose();
    },
  };
}
