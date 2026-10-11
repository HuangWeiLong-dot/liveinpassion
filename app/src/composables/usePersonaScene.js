// 四个人格的粒子场：Three.js 三维场景（透视、前后远近）。
//
// 为什么把粒子的位置计算整个塞进顶点着色器：
//   之前是在 2D 画布上每帧用 JS 循环画 5000 多个粒子，实测那一项吃掉大半个
//   16.7ms 的帧预算。这里每个粒子的目标、散开位置、起飞延迟、抖动全部由顶点
//   着色器从几个属性 + 每帧更新的 uniform 算出来，CPU 每帧只改十几个 uniform。
//   顺带就拿到了真正的三维：点的大小和亮度按深度衰减，是透视算出来的。
//
// 相机约定（组件里的屏幕投影必须严格一致，否则 DOM 命中和粒子会对不上）：
//   相机在 (0, 0, uNear) 看向 -Z，垂直视场角 FOV。
//   世界点 (x, y, z) → 屏幕偏移 (x, y) × uFocalPx / (uNear - z)，
//   其中 uFocalPx = (视口高 ÷ 2) ÷ tan(FOV ÷ 2)，单位是 CSS 像素。
//   y 方向要取负（世界 y 向上、CSS y 向下）。
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';

// 视场角和相机距离一起决定透视强度。这里刻意拉近、开大：
// 环的深度跨度是 R·sin(TILT)，相对 NEAR 越大、远近差别越明显。
// 38°/2.4 的配置下只有 ±7% 的大小差，基本看不出前后。
export const FOV = 45;
// 相机到原点的距离（世界单位）。环半径和它一起决定透视强度。
export const NEAR = 1.5;
// 环面绕 X 轴倾斜：转到上方的人格往后退、下方的往前靠，
// 于是四格会周期性地在远近之间轮转。为 0 的话全程同一深度、没有前后可言。
export const TILT = 30 * (Math.PI / 180);
// 主体矩形的半宽/半高（世界单位）。流的起点落在它的边界上。
export const SUBJECT_HALF = { x: 0.172, y: 0.23 };
// 人格卡片在场景里的半宽/半高（世界单位）
export const CARD_HALF = { x: 0.085, y: 0.1133 };
// 环半径（世界单位）。水平方向 0.41×焦距 ≈ 408px，和原来 ORBIT.rx=32% 接近。
export const RING_R = 0.41;

// 组的数量（人格 + 博客）是构建期就知道的常量，直接把它嵌进着色器源码里 ——
// GLSL 的 uniform 数组长度必须是编译期常量，传 uniform 是指定不了的。
// 之前这里是写死的 4，加了外圈博客之后按实际数量生成。
const VERT = /* glsl */ `
  attribute vec3 aLocal;   // 人格平面内的位置（相对该人格中心）
  attribute vec3 aColor;
  attribute float aU;      // 沿流的参数：0 = 贴着主体，1 = 末端
  attribute float aSeed;
  attribute float aGroup;

  uniform vec3 uGroupPos[4];     // 四个人格此刻在场景中的位置
  uniform float uProgress[4];    // 各自的成图进度
  uniform vec2 uSubject;
  uniform vec2 uSubjectHalf;
  uniform vec2 uCardHalf;
  uniform float uIntro;          // 0 = 全塌在主体身上，1 = 展开到位
  uniform float uSpread;         // 起飞延迟跨度
  uniform float uTime;
  uniform float uFocalPx;
  uniform float uNear;
  uniform float uDpr;
  uniform float uPointSize;
  uniform float uInvert;   // 浅色主题下把灰度反过来

  varying vec3 vColor;
  varying float vAlpha;

  float smoother(float t) {
    t = clamp(t, 0.0, 1.0);
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
  }

  // 贴着主体那端收成一丝、末端完全展开成图 —— 末端才撑得出人形
  float strandScale(float u) {
    float t = clamp((u - 0.32) / 0.68, 0.0, 1.0);
    float e = t * t * (3.0 - 2.0 * t);
    return 0.16 + 0.84 * e;
  }

  void main() {
    int gi = int(aGroup + 0.5);
    vec3 head = uGroupPos[gi];
    float prog = uProgress[gi];

    // 主体边界：从主体中心朝这一格的方向与矩形求交，取先碰壁的那个轴
    vec2 d = head.xy - uSubject;
    float dl = length(d);
    d = dl > 1e-4 ? d / dl : vec2(0.0, 1.0);
    vec2 te = uSubjectHalf / max(abs(d), vec2(1e-4));
    vec2 edge = uSubject + d * min(te.x, te.y);
    vec2 perp = vec2(-d.y, d.x);

    // 静止位置：沿流铺开
    float sc = strandScale(aU);
    vec3 scatter = vec3(mix(edge, head.xy, aU), mix(0.0, head.z, aU));
    scatter.xy += aLocal.xy * sc;

    // 中段往侧面鼓出去成一条弧；相邻两条方向相反，弧线交叉、互相穿插
    float bowSide = mod(aGroup, 2.0) < 0.5 ? 1.0 : -1.0;
    scatter.xy += perp * sin(aU * 3.14159265) * uCardHalf.x * 0.85 * bowSide * uIntro;

    // 丝的横向抖动（越靠近主体越细）
    float wisp = (1.0 - sc) * uCardHalf.x * 0.5;
    scatter.xy += perp * (fract(aSeed * 7.31) - 0.5) * 2.0 * wisp;

    // 成图位置
    vec3 target = head + aLocal;

    // 每个粒子按 seed 先后起飞 —— 看起来是聚拢，不是整体变形
    float t = clamp((prog - aSeed * uSpread) / (1.0 - uSpread), 0.0, 1.0);
    vec3 pos = mix(scatter, target, smoother(t));

    // 开场：从主体身上出发（它们本来就是主体散开来的）
    vec3 birth = vec3(uSubject, 0.0) + aLocal * vec3(1.9, 1.9, 1.0);
    pos = mix(birth, pos, uIntro);

    // 静止态的飘忽
    float wander = (1.0 - smoother(t)) * 0.014;
    pos.x += sin(uTime * 0.9 + aSeed * 37.0) * wander;
    pos.y += cos(uTime * 1.1 + aSeed * 53.0) * wander;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    // 透视：近大远小
    float depth = max(uNear - mv.z, 0.05);
    gl_PointSize = uPointSize * uDpr * uFocalPx / depth;

    // 近亮远暗，和大小同步变化
    float lit = clamp((uFocalPx / depth) / (uFocalPx / uNear), 0.0, 2.0);
    lit = clamp(0.42 + 0.58 * (lit - 0.72) / 0.56, 0.3, 1.0);
    // 浅色主题把灰度反过来：照片暗的地方变白（融进白底）、亮的（脸）变黑。
    // 用 uniform 而不是重建属性，切主题不用重传缓冲区。
    vec3 base = mix(aColor, vec3(1.0) - aColor, uInvert);
    vColor = base * lit;
    vAlpha = 0.55 + 0.45 * prog;
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uFade;   // 整体淡入（贴图就绪 / 首帧之前）
  void main() {
    // 方形粒子，和整站其它地方的方块语言一致
    gl_FragColor = vec4(vColor, vAlpha * uFade);
  }
`;

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<object|null>} 拿不到 WebGL 就返回 null，调用方退回原来的 2D 画法
 */
export async function createPersonaScene(canvas) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 30);
  camera.position.set(0, 0, NEAR);
  camera.lookAt(0, 0, 0);

  const groupPos = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  const uniforms = {
    uGroupPos: { value: groupPos },
    uProgress: { value: [0, 0, 0, 0] },
    uSubject: { value: new Vector2(0, 0) },
    uSubjectHalf: { value: new Vector2(SUBJECT_HALF.x, SUBJECT_HALF.y) },
    uCardHalf: { value: new Vector2(CARD_HALF.x, CARD_HALF.y) },
    uIntro: { value: 1 },
    uSpread: { value: 0.45 },
    uTime: { value: 0 },
    uFocalPx: { value: 1000 },
    uNear: { value: NEAR },
    uDpr: { value: 1 },
    uPointSize: { value: 0.0042 },
    uInvert: { value: 0 },
    uFade: { value: 0 },
  };

  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
  });

  let points = null;
  let disposed = false;

  /**
   * 把四组粒子合成一个 Points：属性里带上归属组号，顶点着色器里按组取 uniform。
   * @param {{local: Float32Array, color: Float32Array, u: Float32Array, seed: Float32Array, group: Float32Array}} data
   */
  function setParticles(data) {
    if (disposed) return;
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(data.local.slice(), 3)); // 占位，真实位置在着色器里算
    geom.setAttribute('aLocal', new BufferAttribute(data.local, 3));
    geom.setAttribute('aColor', new BufferAttribute(data.color, 3));
    geom.setAttribute('aU', new BufferAttribute(data.u, 1));
    geom.setAttribute('aSeed', new BufferAttribute(data.seed, 1));
    geom.setAttribute('aGroup', new BufferAttribute(data.group, 1));
    geom.boundingSphere = null; // 位置是着色器算的，包围球没意义，别让它剔除整块
    if (points) {
      scene.remove(points);
      points.geometry.dispose();
    }
    points = new Points(geom, material);
    points.frustumCulled = false;
    scene.add(points);
  }

  function resize(widthPx, heightPx, dpr) {
    if (disposed || !widthPx || !heightPx) return;
    renderer.setPixelRatio(dpr);
    renderer.setSize(widthPx, heightPx, false);
    camera.aspect = widthPx / heightPx;
    camera.updateProjectionMatrix();
    // 焦距（CSS 像素）：世界点 (0,0,0) 处 1 个世界单位等于多少像素
    const focal = heightPx / 2 / Math.tan((FOV * Math.PI) / 360);
    uniforms.uFocalPx.value = focal;
  }

  /**
   * 把世界点投影成**相对舞台中心的 CSS 像素偏移** + 缩放系数。
   * 页面里的 DOM 元素就是用这个摆位的，所以必须和顶点着色器里的透视完全一致
   * （同一个 focal、同一个 NEAR），否则 DOM 命中区和粒子会对不上。
   */
  function project(x, y, z) {
    const f = uniforms.uFocalPx.value / Math.max(NEAR - z, 0.05);
    return { x: x * f, y: -y * f, scale: f / (uniforms.uFocalPx.value / NEAR) };
  }

  function render() {
    if (disposed || !points) return;
    renderer.render(scene, camera);
  }

  return {
    uniforms,
    project,
    setParticles,
    resize,
    render,
    setFade(v) {
      uniforms.uFade.value = v;
    },
    dispose() {
      disposed = true;
      if (points) {
        scene.remove(points);
        points.geometry.dispose();
        points = null;
      }
      material.dispose();
      renderer.dispose();
    },
  };
}
