// 主体图的水波纹扭曲（Three.js）。
//
// 做法：一个铺满视口的 quad + 片元着色器。涟漪中心跟着鼠标走，
// 按距离衰减，位移是真的对采样 UV 做的（不是叠一层半透明贴图假装）。
//
// 两个容易踩的点：
//   1. **色彩空间要直通**。这条管线只是一次"取样 → 输出"，
//      中间没有任何光照计算。如果按默认让 three 做 sRGB→linear→sRGB 的往返，
//      不但多两次转换，中间还会有量化损失。所以贴图和 renderer 都设成
//      NoColorSpace，进出原样。
//   2. **只在需要时渲染**。静止时波纹幅度是 0，画面和一张静态图没区别，
//      没必要一直跑 rAF。幅度收敛到 0 且没有指针移动时就把循环停掉。
//
// 拿不到 WebGL 上下文的机器（老显卡、软件渲染被禁）直接返回 null，
// 调用方退回普通 <img>——这也是为什么主体在 DOM 里始终留着一个 <img>。

// three 走**动态 import**，不进首屏包。
//
// 静态 import 实测会把入口包从 226KB(gzip 70KB) 顶到 756KB(gzip 203KB)——
// WebGLRenderer 是整块的，摇不掉。本站其它地方对字节抠得很细，为一个 hover 效果
// 让每个访客都先下 133KB 说不过去。
//
// 动态 import 之后：首屏包不变，three 的 chunk 在组件挂载后并行拉取，
// 通常人还没把鼠标移到主体上就已经就绪。真没赶上也不难看——只是这一次悬停没涟漪。

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // 乘 2：PlaneGeometry(1,1) 的 position.xy 是 [-0.5, 0.5]，直接当 NDC 用的话
    // 这个 quad 只占屏幕中间的四分之一（每轴一半），图像会缩在中间、四周露出底图。
    // 深色主题下两层都是黑的看不出来，浅色底上就是一圈明显的硬边。
    gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uTime;
  uniform vec2 uMouse;      // 0..1，相对图片显示区（含 cover 裁切后的可视区）
  uniform float uAmp;       // 0 = 静水，1 = 悬停时的满幅涟漪
  uniform float uPlaneAspect;   // 显示区的 宽/高
  uniform float uTextureAspect; // 贴图的 宽/高
  uniform float uRestSolid;     // 静止时主体保留多少实感
  uniform float uSolid;         // 悬停幅度：鼠标处照片显形（重组）
  uniform float uSolidRadius;   // 重组半径
  varying vec2 vUv;

  // object-fit: cover —— 把块的 UV 映射到贴图上被裁切后的那块
  vec2 coverUv(vec2 uv) {
    float s = uTextureAspect / uPlaneAspect;
    vec2 k = s > 1.0 ? vec2(1.0 / s, 1.0) : vec2(1.0, s);
    return (uv - 0.5) * k + 0.5;
  }

  void main() {
    // 距离要在等比例空间里算，否则竖向的涟漪会被拉成椭圆
    vec2 sc = vec2(uPlaneAspect, 1.0);
    float d = distance(vUv * sc, uMouse * sc);

    // 主涟漪：从鼠标点一圈圈推出去
    float ring = sin(d * 26.0 - uTime * 3.2) * exp(-d * 7.0);
    // 近处再叠一层细密的高频水花
    float fine = sin(d * 62.0 - uTime * 6.0) * exp(-d * 12.0) * 0.35;
    float wave = (ring + fine) * uAmp * 0.035;

    vec2 dir = d > 0.0001 ? (vUv * sc - uMouse * sc) / d : vec2(0.0);
    vec2 uv = vUv + (dir / sc) * wave;

    vec3 col = texture2D(uTex, coverUv(uv)).rgb;
    // 波峰处提亮一点，像水面的反光
    col += vec3(wave * 3.0) * uAmp;

    // uRestSolid = 0：静止时这层照片完全不出现，主体由上面那层粒子独家承担
    // （"彻底粒子化"）。鼠标压住的地方 focus→1，照片在那里显形 —— 这就是"重组"。
    // 只在一块局部显形，不是整张主体一起变亮，所以和"删掉变亮"不冲突。
    //
    // 显形用 alpha，而不是往画布里填背景色：
    // 悬停时只有指针附近 alpha→1，其余区域整层透明，露出背后的海报墙和粒子。
    // （原来整片填背景色时，椭圆遮罩会把那块平色裁成一个明显的椭圆。）
    float focus = 1.0 - smoothstep(0.0, uSolidRadius, d);
    float solidAmt = mix(uRestSolid, 1.0, focus * uSolid);

    gl_FragColor = vec4(col, solidAmt);
  }
`;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} src 图片地址
 * @returns {Promise<{ setPointer: (u:number,v:number)=>void, setHover: (on:boolean)=>void,
 *             setRestSolid: (v:number)=>void, resize: ()=>void, dispose: ()=>void } | null>}
 */
export async function createRippleEffect(canvas, src) {
  let THREE;
  try {
    THREE = await import('three');
  } catch {
    return null; // chunk 拉不下来，交给调用方退回 <img>
  }
  const {
    Mesh, NoColorSpace, OrthographicCamera, PlaneGeometry,
    Scene, ShaderMaterial, TextureLoader, Vector2, WebGLRenderer,
  } = THREE;

  let renderer;
  try {
    // alpha: true —— 这层现在是一张透明贴图，只在指针附近显形；
    // premultipliedAlpha: false 让 shader 输出的 alpha 按直通（straight）混合。
    renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      premultipliedAlpha: false,
      powerPreference: 'low-power',
    });
    renderer.setClearColor(0x000000, 0);
  } catch {
    return null; // 没有 WebGL，交给调用方退回 <img>
  }

  // 直通色彩空间：进出不做转换（见文件头注释）。
  //
  // 这里**不要**去动 renderer.outputColorSpace —— 那个 setter 只接受
  // SRGBColorSpace / LinearSRGBColorSpace，传 NoColorSpace('') 会直接抛
  // "Cannot read properties of undefined (reading 'outputColorSpaceConfig')"。
  // 而且根本没必要：输出侧的转换发生在 fragment shader 的 colorspace_fragment
  // 里，我们的 shader 是直接写 gl_FragColor，压根没包含那个 chunk。
  // 只要把贴图标成 NoColorSpace（采样时不做 sRGB→linear 解码），进出就都是原值。
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new Scene();
  const camera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
  const uniforms = {
    uTex: { value: null },
    uTime: { value: 0 },
    uMouse: { value: new Vector2(0.5, 0.5) },
    uAmp: { value: 0 },
    uPlaneAspect: { value: 1 },
    uTextureAspect: { value: 1 },
    // 主体在静止时保留多少"实感"。0.3 → 照片很淡，主体由上面那层粒子承担
    // （用户要的"将主体粒子化"）；调到 1 就退回"照片 + 粒子噪点"。
    // 注意 tools/verify-hero.mjs 里有个 1/uRestSolid 的反向亮度要跟着改。
    uRestSolid: { value: 0 },
    uSolid: { value: 0 },
    uSolidRadius: { value: 0.26 },
  };
  const material = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms });
  const mesh = new Mesh(new PlaneGeometry(1, 1), material);
  scene.add(mesh);

  let amp = 0;      // 当前幅度
  let target = 0;   // 目标幅度
  let raf = 0;
  let last = 0;
  let disposed = false;

  function loop(now) {
    raf = 0;
    if (disposed) return;
    const dt = Math.min(64, now - (last || now));
    last = now;

    if (amp !== target) {
      // 涨上来快一点（像指尖入水），退下去慢一点
      const speed = target > amp ? 2.6 : 1.4;
      const step = (dt / 1000) * speed;
      amp = target > amp ? Math.min(target, amp + step) : Math.max(target, amp - step);
    }

    uniforms.uAmp.value = amp;
    // 重组和涟漪共用同一条悬停曲线
    uniforms.uSolid.value = amp;
    if (amp > 0) uniforms.uTime.value += dt / 1000;

    renderer.render(scene, camera);
    syncIdle();

    // 静止在 0 就别再占帧了
    if (amp !== target || amp > 0) raf = requestAnimationFrame(loop);
  }

  function kick() {
    if (!raf && !disposed) raf = requestAnimationFrame(loop);
  }

  // 静止且不悬停时，这层画布整片只是背景色。椭圆遮罩会把这块平色裁成
  // 一个可见的椭圆（尤其背景上有粒子/海报时）。没有东西要画就整层藏掉，
  // 等悬停或"先实后散"再显示。
  function syncIdle() {
    const idle = amp === 0 && target === 0 && uniforms.uRestSolid.value <= 0.002;
    canvas.classList.toggle('is-idle', idle);
  }

  function resize() {
    if (disposed) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); // false：不要去改 canvas 的 CSS 尺寸，那是样式表的事
    uniforms.uPlaneAspect.value = w / h;
    renderer.render(scene, camera);
  }

  new TextureLoader().load(
    src,
    (texture) => {
      if (disposed) {
        texture.dispose();
        return;
      }
      texture.colorSpace = NoColorSpace;
      texture.generateMipmaps = true;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      uniforms.uTex.value = texture;
      uniforms.uTextureAspect.value = texture.image.width / texture.image.height;
      canvas.classList.add('is-ready'); // 贴图就绪后才把 canvas 显出来，避免闪黑
      syncIdle();
      resize();
    },
    undefined,
    () => {
      canvas.classList.remove('is-ready');
    }
  );

  resize();

  return {
    setPointer(u, v) {
      uniforms.uMouse.value.set(u, v);
      if (target > 0) kick(); // 悬停时指针一动就要重画；静止时不用
    },
    setHover(on) {
      target = on ? 1 : 0;
      syncIdle();
      kick();
    },
    /**
     * 静止时这层照片保留多少"实感"（0 = 完全不出现，主体交给上面那层粒子；
     * 1 = 完整显示这张人像）。开场那一下要**先让人像完整地亮一下、再化开成粒子**，
     * 就是靠这个值从 1 连续降到 0 —— 光靠 setHover 只有 0/1 两态，做不出过渡。
     *
     * 静止时渲染循环是停的（raf 为 0），所以这里必须自己画一帧，
     * 否则改了 uniform 也看不见。
     */
    setRestSolid(v) {
      uniforms.uRestSolid.value = Math.max(0, Math.min(1, v));
      syncIdle();
      if (!disposed && !raf) renderer.render(scene, camera);
    },
    resize,
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      mesh.geometry.dispose();
      material.dispose();
      uniforms.uTex.value?.dispose();
      renderer.dispose();
    },
  };
}
