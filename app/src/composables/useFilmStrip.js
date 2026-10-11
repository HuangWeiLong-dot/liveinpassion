// BLOGS 轨道的"胶片"层（Three.js）+ 那一套投影数学。
//
// 用户要的效果：**中间那张正面朝你、最近**，越往两边越绕 Y 轴转开、越往后退，
// 整条轨道读起来像一条绕过片门的胶片；而且**滚动时整条带子跟着扭**，停下自己回正。
//
// ── 分工（这里最容易做错，先讲清楚）──────────────────────────────────────
//   · **几何**（每张卡的位置 / 绕 Y、X 的转角 / 后退的深度 / 缩放，以及随滚动速度
//     那一层扭曲）只有一份数，算一次，写两个地方：
//       ① DOM 那张卡片的 `matrix3d`（下面这几个纯函数直接算，**不需要 three**）；
//       ② WebGL 里的 mesh（同一个 pose）。
//     于是**标题、编号跟着卡片一起转**（它们是 DOM 文本，投影完全一致、永远清晰），
//     而点击命中、键盘焦点、以及"点卡片 → 详情页封面从这一格飞过去"那条交接
//     （量的是 .jb-media 的矩形）**全都还在 DOM 上，一行没改**。
//   · **图像**由 WebGL 画：贴在**细分过**的平面上，所以能弯、能被波形扭 ——
//     这是"用 three 而不是纯 CSS"的**唯一**理由（CSS 只能整体刚性变换，弯不了）。
//
// ── 坐标与相机（两个坐标系必须严丝合缝，否则图和字会错开）──────────────
//   视口高 H、纵向视角 fov → 焦距 D = (H/2)/tan(fov/2)，相机放在 (0,0,+D) 看向原点。
//   这个 D 的取法换来一条好用的性质：**z=0 平面上 1 个世界单位 = 1 个 CSS px**，
//   所以卡片直接按 viewport 像素摆就行，不用做单位换算。
//   世界 y 朝上、z 朝观众；CSS 局部 y 朝下、z 朝观众。变换的支点取**媒体盒中心**
//   （mesh 也绕它转，两边必须同一个支点，否则一转就劈叉）。
//
// ── 拿不到 WebGL / three 拉不下来 ────────────────────────────────────────
//   createFilmStrip 直接返回 null，调用方退回"只有 DOM 图片"那条路 ——
//   注意**几何那部分不需要退回**：matrix3d 是纯数学，没有 three 也照样是全 3D 的。

// three 走**动态 import**，不进首屏包（和 useRippleEffect 同一个理由：
// 静态 import 会把入口包从 ~226KB 顶到 ~756KB，为一个轨道效果不值当）。
// 下面这一整段纯数学没有任何 three 依赖，调用方静态 import 它是零成本的。
const DEG = Math.PI / 180;
// 贴图最长边。整圈 24 张一起驻留（背面那圈也要 WebGL 画，见 BlogsView 的主循环），
// 所以这个数直接决定显存：768 → 每张约 1.8MB（含 mipmap），24 张 ≈ 43MB；
// 1024 就是 74MB —— 桌面还行，手机上太狠了。前台的卡片宽 518px（DPR 2 下 1036 设备像素），
// 768 略欠一点点采样、肉眼看不出来。
const TEX_MAX = 768;
const TEX_KEEP = 26;   // 贴图缓存条数（LRU）：整圈 24 张 + 余量

/** 姿态常量（想调手感只动这里；`sign: -1` 可以把弧面的凹凸翻过来） */
export const FILM = {
  fov: 30,       // 纵向视角（deg）：长焦一点，整条带子的透视别太凶
  // ── 圆柱：整排卡片是**贴在**一个圆柱面上的（轴在屏幕中心后方 radius 处）──
  // **弧长 = 布局位移**，所以角位置 θ = x / radius。这是"整排连成一条"的关键：
  // 卡片沿弧线摆，横向的**投影间距**必然小于布局间距（越往边上挤得越紧），
  // 缝自己就合上了。反过来说，"在原位置上转一下再往后退"那种做法，间距永远
  // 等于布局间距，边上必然裂开一条条缝 —— 那正是上一版和参考站的差别。
  // 调小 radius = 弯得更狠、两边挤得更紧；调大 = 更平。
  // 半径**不是常量**：由"一份轨道 = laps 整圈"推出来（见 ringRadius）。
  // 取整数圈是为了让回卷（平移一个周期）在圆柱上正好落在同一处，接缝严格看不见。
  // laps 就是"弯得多狠"的旋钮：大 = 圈更紧、弯得更狠。**但别贪** ——
  // 实测 2 圈时正面几张会互相压住、背面那一圈还会从正面的缝里钻出来，糊成一团。
  // 正面那几张贴不贴，正确做法不是收紧圈，而是**把卡片放宽**（--jb-card-w）：
  // 卡越宽，"透视缩小"占的比例越小，缝自己就合上了 —— 参考站也是靠这个。
  laps: 2,
  frontArc: 0.95, // rad ≈ 54°：这个角度以内由 WebGL 画封面（能弯），
                  // 之外的卡片走 DOM 的 <img>（在背面、又小，平着贴没差别，
                  // 却能省下十几张 1K 贴图的显存）
  // 整圈的倾角（deg）：把**整个圆环**沿 X 轴压一下 —— 相当于"从上方看着这个鼓"。
  // 背面那一圈因此抬起来、看得见。
  // ⚠ 这一项必须做成**刚性**的（所有卡片同一个角 + 位移按 depth 线性给），
  //   不能像早先那样"每张卡各自绕自己的 X 轴转一点"：相邻两张的倾角差几度，
  //   边缘就会在几像素的缝里互相穿模，画面上是满屏撕裂的三角（实测踩过）。
  tilt: 3.5,
  shrink: 1,     // 在圆柱给的缩小之外再补一档。1 = 不补（默认；圆柱自己会缩）
  bow: 72,       // 画面自身的弧度（世界 px）：中间朝观众鼓出来 —— 卡片自己也是弯的
                 // （CSS 只能整体刚性变换，弯不了，这是用 WebGL 的理由）
  wFull: 36,     // 多少 px/帧 算"满速"（一次快甩大约 40～90）
  wYaw: 7,       // 满速时整条带子多转几度（朝运动方向倾）
  wPitch: 3,     // 满速时的上下俯仰（deg）
  wStretch: 0.05,// 满速时整条带子再多撑大 5%
  sign: 1,       // 弧面朝向：1 = 卡片朝外（参考站那种），-1 = 翻过来（朝屏幕中心）
};

/** 相机到 z=0 平面的距离（px）。视口高度一变就要重算。 */
export function focalOf(viewH) {
  return (viewH / 2) / Math.tan((FILM.fov * DEG) / 2);
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * 一张卡这一帧的姿态。
 * @param {number} cx 媒体盒中心在视口里的 x（布局值，不含任何变换）
 * @param {number} cy 同上，y
 * @param {{w:number,h:number}} view 视口（CSS px）
 * @param {number} warpNorm 平滑后的滚动速度 / FILM.wFull，已夹到 -1..1
 */
export function poseAt(cx, cy, view, warpNorm, radius) {
  const half = view.w / 2;
  const x = cx - half; // 布局上离屏幕中心多远 —— 也就是"沿轨道走了多远"（弧长）
  const R = radius || 1600;
  // 整圈：θ 不设上限，卡片会一路绕到圆柱背面再回来 ——
  // 这就是"能看见圆柱后面"那一圈。回卷（平移一个周期）正好是一整圈，
  // 所以接缝严格看不见（半径由 cycleWidth 推出来，见 ringRadius）。
  const theta = (x / R) * FILM.sign;
  const cth = Math.cos(theta);
  const depth = R * (1 - cth);
  return {
    // ⚠ X / Y 是**布局**位置（元素在页面里本来就摆在那儿的地方），
    //   wx / wy 是在它之上再补的**世界位移**。两者必须分开：DOM 卡片的布局位置
    //   等于 (X,Y)，而它要被投影到的世界位置是 (X+wx, Y+wy) —— 混成一个数的话，
    //   标题编号会和封面差开一整个位移量（实测：上扬 110px 的卡片，字就低 110px）。
    X: x,
    Y: view.h / 2 - cy,
    wx: R * Math.sin(theta) - x,
    // 整排上扬：越靠后的卡片抬得越高（位移，不是转角）。**上限压到半径**——
    // 不压的话背面那一圈会抬到屏幕外面去（depth 最大是 2R，乘 0.16 就是 500px+）。
    // 刚性倾斜：竖向位移严格按 depth 线性（= 整个环绕 X 轴转 tilt 角），
    // 背面那一圈因此抬起来看得见，而卡片之间不会互穿。
    wy: depth * Math.tan(FILM.tilt * DEG),
    depth,
    scale: FILM.shrink * (1 + Math.abs(warpNorm) * FILM.wStretch),
    // 脸朝外：圆柱上"转过的角度"就是这个转角（不用另外给 yaw 常量）
    yaw: theta + (-warpNorm * FILM.wYaw * FILM.sign) * DEG,
    // 刚性倾斜（和 wy 是同一个角，见 FILM.tilt）
    pitch: -FILM.tilt * DEG + warpNorm * FILM.wPitch * DEG,
  };
}

/**
 * 一圈的半径：**一圈 = 一份轨道**（cycleWidth）。
 * 这样回卷平移一个周期在圆柱上正好是一整圈，接缝严格看不见；
 * 而"一圈摆几张卡"自然由卡片宽度决定 —— 宽卡 → 大圈 → 弯得平，窄卡反之。
 */
export function ringRadius(cycleWidth) {
  if (!(cycleWidth > 0)) return 1600;
  return cycleWidth / (2 * Math.PI * Math.max(1, Math.round(FILM.laps)));
}

/**
 * pose → CSS `matrix3d(...)`。
 *
 * 推导：世界点 W = (X+wx+ox, Y+wy+oy, -depth+oz)（ox/oy/oz 是本地偏移经旋转缩放后的结果，
 * wx/wy 是"世界位置 − 布局位置"那一点额外位移），相机在 (0,0,D) 看原点，于是
 * projX = D·Wx/(D+depth-oz)，屏幕位移 = proj − **布局**位置（元素本来就摆在那儿的地方）。
 * 摊开后每一行都是 (lpx, lpy, lpz) 的线性式，直接填数 —— 比拿矩阵库拼简单，
 * 也不会因为乘法次序搞错支点。
 *
 * ⚠ CSS 的 matrix3d 入参是**列主序**：matrix3d(m11,m12,m13,m14, m21,…) 对应的矩阵里
 *   x' = m11·x + m21·y + m31·z + m41。所以下面按 [x行的4个系数, y行的4个, z行的4个,
 *   w行的4个] 交错填。
 */
export function cssMatrix(p, D) {
  const ct = Math.cos(p.yaw); const st = Math.sin(p.yaw);
  const cp = Math.cos(p.pitch); const sp = Math.sin(p.pitch);
  const s = p.scale;
  // ox / oy / oz：本地 (lpx, lpy, lpz) → 世界偏移的系数（先翻 y，再绕 Y，再绕 X，再缩放）
  const ox = [s * ct, 0, s * st];
  const oy = [s * sp * st, -s * cp, -s * sp * ct];
  const oz = [-s * cp * st, -s * sp, s * cp * ct];
  // 常数项里那个 wx / wy 是"世界位置 − 布局位置"（见 poseAt：现在只有整排上扬）：
  // 布局位置决定"从哪儿量位移"，世界位置决定"被投影到哪儿"。
  const rowX = [
    ox[0] + (p.X / D) * oz[0], ox[1] + (p.X / D) * oz[1], ox[2] + (p.X / D) * oz[2],
    p.wx - (p.X * p.depth) / D,
  ];
  // ⚠ 常数项是 `-wy + Y·depth/D`（推导：dispY·w = -oy -wy -(Y/D)·oz + Y·depth/D）。
  //   Y 那一项是**正号** —— 写成负号会让整条卡片比封面低 2·wy（实测 60px 上下），
  //   而 wy 恰恰是"整排上扬"，越靠边的卡片错得越多。
  const rowY = [
    -oy[0] - (p.Y / D) * oz[0], -oy[1] - (p.Y / D) * oz[1], -oy[2] - (p.Y / D) * oz[2],
    -p.wy + (p.Y * p.depth) / D,
  ];
  const rowW = [-oz[0] / D, -oz[1] / D, -oz[2] / D, 1 + p.depth / D];
  return `matrix3d(${rowX[0]},${rowY[0]},0,${rowW[0]},`
    + `${rowX[1]},${rowY[1]},0,${rowW[1]},`
    + `${rowX[2]},${rowY[2]},1,${rowW[2]},`
    + `${rowX[3]},${rowY[3]},0,${rowW[3]})`;
}

const VERT = /* glsl */ `
  uniform float uBow;      // 画面自身的弧度（世界 px）
  uniform float uWave;     // 随滚动的波形幅度（0..1）
  uniform float uPhase;    // 波形相位（跟着滚动量走：停下就定住）
  varying vec2 vUv;
  varying float vWave;
  void main() {
    vUv = uv;
    vec3 p = position;                 // PlaneGeometry(1,1)：中心在原点，范围 ±0.5
    // 抛物线弧：中间最鼓、两头回到 0（"这张画面本身是弯的"，不是整块斜过去）
    float bow = uBow * (0.25 - p.x * p.x) * 4.0;
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
  // （和 useRippleEffect 里那份一样；列表卡片本来就是 cover 裁切的）
  vec2 coverUv(vec2 uv) {
    float s = uTextureAspect / uPlaneAspect;
    vec2 k = s > 1.0 ? vec2(1.0 / s, 1.0) : vec2(1.0, s);
    return (uv - 0.5) * k + 0.5;
  }

  void main() {
    vec2 uv = vUv;
    // 悬停放大（绕自己的中心，和 CSS 那张图的写法对齐）
    uv = (uv - 0.5) / (1.0 + 0.035 * uHover) + 0.5;
    // 画面内部也跟着波形拧一下：只靠顶点位移读起来像"板子被掰弯"，
    // 采样 UV 一起动才像"画面在流动"
    uv.x += sin(uv.y * 3.1415926 + uPhase) * uWave * 0.018;
    vec4 tex = texture2D(uTex, coverUv(uv));
    vec3 col = mix(uTone, tex.rgb, uHasTex);
    // 波峰处压一点点亮度，给"胶片过片门"一点存在感
    col *= 1.0 - abs(vWave) * 0.4;
    gl_FragColor = vec4(col, uOpacity);
  }
`;

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<null | {
 *   op: { v: number }, render: Function, resize: Function, dispose: Function,
 *   stats: Function,
 * }>}
 */
export async function createFilmStrip(canvas) {
  let THREE;
  try {
    THREE = await import('three');
  } catch {
    return null; // chunk 拉不下来：调用方退回 DOM 图片
  }
  const {
    CanvasTexture, Color, LinearMipmapLinearFilter, Mesh, NoColorSpace, PerspectiveCamera,
    PlaneGeometry, Scene, ShaderMaterial, WebGLRenderer,
  } = THREE;

  let renderer;
  try {
    renderer = new WebGLRenderer({
      canvas, antialias: true, alpha: true, powerPreference: 'high-performance',
    });
  } catch {
    return null; // 没有 WebGL：退回 DOM 图片
  }

  const scene = new Scene();
  const camera = new PerspectiveCamera(FILM.fov, 1, 1, 100000);
  const geometry = new PlaneGeometry(1, 1, 24, 16); // 细分是为了能弯；4 个顶点弯不了
  let texCache = new Map(); // <img> → CanvasTexture（Map 保持插入序，当 LRU 用）
  const pool = [];
  const live = new Map();   // key → 本帧在用的 mesh
  const op = { v: 1 };      // 全局不透明度（调用方直接补间它）
  let disposed = false;
  let texWarned = false;
  let texBlocked = false; // 贴图被浏览器拒过一次之后，这一层就永远只用占位色
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
    renderer.setSize(w, h, false); // false：别动 canvas 的 CSS 尺寸，那是样式表的事
    camera.aspect = w / h;
    camera.position.set(0, 0, focalOf(h));
    camera.updateProjectionMatrix();
  }

  // ── 贴图 ────────────────────────────────────────────────────────────────
  // 来源是**列表里那张已经加载好的 <img>**（同一个 URL、走原有的懒加载），
  // 先缩到 TEX_MAX 再上传：列表卡片显示宽度 ~478px，把 1920px 的原图直接上传
  // 是纯浪费（二十来张一起驻留时每张 8MB，加起来能到 200MB）。
  function textureFor(img) {
    if (texBlocked) return null;
    if (!img || !img.naturalWidth) return null;
    // CORS 被拒过的图（BlogsView.loadCoverImage 会打上这个标记）：像素是"污染"的，
    // 画进 canvas 再上传 WebGL 会每帧抛 SecurityError。这一张索性不做贴图，
    // 停在占位色上 —— 宁可少一张，也不能让控制台刷屏、帧率掉下去。
    if (img.dataset && img.dataset.noTex === '1') return null;
    const hit = texCache.get(img);
    if (hit) {
      texCache.delete(img); // 命中就挪到队尾（LRU）
      texCache.set(img, hit);
      return hit;
    }
    const sw = img.naturalWidth;
    const sh = img.naturalHeight;
    const k = Math.min(1, TEX_MAX / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * k));
    c.height = Math.max(1, Math.round(sh * k));
    try {
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('拿不到 2d 上下文');
      ctx.drawImage(img, 0, 0, c.width, c.height);
    } catch (err) {
      // 画不进去就停在占位色（不炸整条轨道），但**要说出来** ——
      // 一句都不吭的话，卡片永远是纯色块，排查时只能瞎猜。
      if (!texWarned) {
        texWarned = true;
        console.warn('[film] 封面缩图失败，这一层只剩占位色：', err && err.message, img.currentSrc || img.src);
      }
      return null;
    }
    const t = new CanvasTexture(c);
    // 直通色彩空间：这条管线只是"取样 → 输出"，中间没有光照计算。
    // 让 three 走 sRGB→linear→sRGB 的往返不但白转两次，中间还有量化损失。
    t.colorSpace = NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    texCache.set(img, t);
    while (texCache.size > TEX_KEEP) {
      const [oldImg, oldTex] = texCache.entries().next().value;
      texCache.delete(oldImg);
      oldTex.dispose();
    }
    return t;
  }

  function acquire() {
    const m = pool.pop();
    if (m) {
      m.visible = true;
      return m;
    }
    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true, // 交接（进 / 退场）时要整体淡出
      uniforms: {
        uTex: { value: null },
        uTone: { value: new Color() },
        uHasTex: { value: 0 },
        uOpacity: { value: 1 },
        uHover: { value: 0 },
        uPlaneAspect: { value: 1 },
        uTextureAspect: { value: 1 },
        uBow: { value: FILM.bow },
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
   * @param {Array} items 这一帧要画的卡（轨道顺序 = 画序）：
   *        { key, pose, media:{width,height}, img, tone, hover }
   *        pose 由 poseAt() 算好（调用方那边 DOM 也用同一份）。
   * @param {{phase:number, flyingKey:any}} state
   */
  function render(items, state) {
    if (disposed) return;
    // 尺寸变了就顺手跟上：canvas 是 `display:none` 起来之后再 `.is-film` 放出来的，
    // 创建那一刻 clientWidth 还是 0，那一次 resize 是空转的。
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
        mesh.material.uniforms.uPlaneAspect.value = it.media.width / it.media.height;
        mesh.material.uniforms.uTone.value.set(it.tone || '#c8cdd2');
        live.set(it.key, mesh);
      }
      const u = mesh.material.uniforms;
      // 图是**懒加载**来的，加载完不会通知我们（沿用列表那套观察器）。
      // 每帧顺手看一眼：还没贴图、而这张 <img> 已经解码好，就补一张。
      // textureFor 对"没加载完"一句话返回 null，命中缓存也是 O(1)，白看不贵。
      if (!u.uHasTex.value) {
        const tex = textureFor(it.img);
        if (tex) {
          u.uTex.value = tex;
          u.uHasTex.value = 1;
          u.uTextureAspect.value = tex.image.width / tex.image.height;
        }
      }
      // 世界坐标 = viewport 像素（见文件头）。缩放里带上姿态的 scale，
      // 平面的基准尺寸是媒体盒的宽高。
      // ⚠ 位置要加 wx / wy（世界位移），不能只用 X / Y（布局位置）—— 见 poseAt 的注释。
      mesh.position.set(p.X + p.wx, p.Y + p.wy, -p.depth);
      mesh.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
      mesh.scale.set(it.media.width * p.scale, it.media.height * p.scale, 1);
      u.uOpacity.value = (it.key === state.flyingKey) ? 1 : op.v;
      u.uHover.value = it.hover ? 1 : 0;
      u.uPhase.value = state.phase;
    }

    try {
      renderer.render(scene, camera);
    } catch (err) {
      // 最后一道闸：万一还是混进了一张"污染"的贴图（浏览器/代理在 CORS 上给出
      // 意外答案），three 会在上传时抛 SecurityError。**不能**让它每帧抛一次 ——
      // 那样既刷屏又拖帧率。就地清空所有贴图、退回占位色，并且只报一次。
      if (!texBlocked) {
        texBlocked = true;
        console.warn('[film] 贴图被浏览器拒绝（跨域污染），这一层改用占位色：',
          err && err.message);
      }
      for (const [, t] of texCache) t.dispose();
      texCache = new Map();
      for (const [, m] of live) {
        m.material.uniforms.uTex.value = null;
        m.material.uniforms.uHasTex.value = 0;
      }
      for (const m of pool) {
        m.material.uniforms.uTex.value = null;
        m.material.uniforms.uHasTex.value = 0;
      }
    }
  }

  resize();

  return {
    // 全局不透明度：调用方补间 `op.v`（交接的进出场和 DOM 卡片同一拍）。
    // 被点的那张由 state.flyingKey 单独豁免、一直亮着 —— 和 CSS 里那条
    // `html.bd-taking-cover .jb-card:not(.is-flying)` 是同一个语义。
    op,
    render,
    resize,
    stats: () => ({ meshes: live.size, textures: texCache.size, dpr: renderer.getPixelRatio() }),
    dispose() {
      disposed = true;
      for (const [, mesh] of live) mesh.material.dispose();
      live.clear();
      for (const m of pool) m.material.dispose();
      pool.length = 0;
      for (const [, t] of texCache) t.dispose();
      texCache = new Map();
      geometry.dispose();
      renderer.dispose();
    },
  };
}
