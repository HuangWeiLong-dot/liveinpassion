// BLOGS 轨道的**姿态数学**：整排卡片贴在圆柱面上的位置、转角、后退与投影。
//
// ── 这一层为什么没有 WebGL ─────────────────────────────────────────────
// 早先这里还有一层 three.js 的"胶片"overlay（把封面画在**能弯**的细分平面上）。
// 已经**按需求撤掉**了 —— 代价太大、收益太小：跨域贴图（CDN 只放行线上域名，
// 本地 dev 拿不到干净像素）、一张 canvas 要跟 DOM 抢层次（背面会压到正面）、
// 24 张 1K 贴图的显存…… 而"弯"这一点，在真实照片上远不如在棋盘格测试图上明显。
// 现在整排就是**纯 DOM**：卡片用 matrix3d 摆到圆柱上（下面的 poseAt / cssMatrix），
// 图片还是页面里那张 <img>，一行没有多。
//
// ── 这里就是**一整个圆**（不是弧段）─────────────────────────────────────
// 卡片一路绕到圆柱背面再转回来 —— 用户要的"能看见圆柱后面"就是这一圈。
// ⚠ 纯 DOM 确实没有 3D 深度排序，但**顺序可以显式给**：BlogsView 的主循环按
//   pose.depth 给每张卡写一个 z-index（近的高、远的低），前后遮挡于是完全正确，
//   背面那一圈会被正面挡住、只在两侧和上方露出来。"背面会压到正面"不是纯 DOM
//   解不了的问题，不给 z-index 才会。
// ⚠ 半径由"一份轨道正好绕 laps 整圈"推出来（见 ringRadius）：取整数圈，
//   回卷（平移一个周期）才落回原处、接缝严格看不见。
//
// ⚠ 这一整段是**纯数学**，不依赖 three，也不需要 WebGL：投影写成 CSS matrix3d
//   交给浏览器，和卡片上的标题编号共用同一个矩阵，所以字和面永远对得上。

const DEG = Math.PI / 180;

/** 姿态常量（想调手感只动这里） */
export const FILM = {
  fov: 30,       // 纵向视角（deg）：长焦一点，整条带子的透视别太凶
  // 一圈 = 一份轨道绕**几圈**（整数）。1 = 正好一圈；越大圈越紧、弯得越狠。
  // 🌟 正面那几张"贴不贴"**别靠收紧圈**：圈一紧，卡片的投影宽度会超过它们的间距
  // —— 那就是用户说的"卡片叠在一起"。正确做法是把卡片**放宽**（--jb-card-w）：
  // 卡越宽，透视缩小占的比例越小，缝自己就合上。
  laps: 1,
  fallbackRadius: 1400, // cycleWidth 还没量出来时的兜底半径
  labelArc: 1.35, // rad ≈ 77°：转角超过这个角度，文字标签收起来（见 BlogsView）
  tilt: 3.5,     // **整排**的俯仰（deg）：整个圆柱沿 X 轴压一下 = "从上方看着它"，
                 // 越靠边（越往后）的卡片整体抬得越高。刚性的一项：所有卡片同一个
                 // 角度、位移严格按 depth 线性 —— 每张卡各自转一点的话，相邻两张的
                 // 边缘会在几像素的缝里互相穿模（画面上是满撕裂的三角，实测踩过）。
  shrink: 1,     // 在透视给的缩小之外再补一档。1 = 不补
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
 * 一圈的半径：**一份轨道绕 laps 整圈**（整数圈 → 回卷正好落回原处，接缝看不见）。
 * 一圈摆得下几张、弯得多狠，交给卡片宽度（--jb-card-w）去定。
 */
export function ringRadius(cycleWidth) {
  if (!(cycleWidth > 0)) return FILM.fallbackRadius;
  return cycleWidth / (2 * Math.PI * Math.max(1, Math.round(FILM.laps)));
}

/**
 * 一张卡这一帧的姿态。
 * @param {number} cx 媒体盒中心在视口里的 x（**布局**值，不含任何变换）
 * @param {number} cy 同上，y
 * @param {{w:number,h:number}} view 视口（CSS px）
 * @param {number} warpNorm 平滑后的滚动速度 / FILM.wFull，已夹到 -1..1
 */
export function poseAt(cx, cy, view, warpNorm, radius) {
  const half = view.w / 2;
  const x = cx - half; // 布局上离屏幕中心多远 —— 也就是"沿轨道走了多远"（弧长）
  const R = radius || FILM.fallbackRadius;
  // **整圈**：θ 不设上限，卡片一路绕到背面再回来（见文件头）
  const theta = (x / R) * FILM.sign;
  const cth = Math.cos(theta);
  const sth = Math.sin(theta);
  const depth = R * (1 - cth); // 沿轴后退：圆柱自己给的
  const tilt = FILM.tilt * DEG;
  return {
    // ⚠ X / Y 是**布局**位置（元素在页面里本来就摆在那儿的地方），
    //   wx / wy 是在它之上再补的**世界位移**。两者必须分开：DOM 卡片的布局位置
    //   等于 (X,Y)，而它要被投影到的世界位置是 (X+wx, Y+wy) —— 混成一个数的话，
    //   标题编号会和封面差开一整个位移量（实测：上扬 110px 的卡片，字就低 110px）。
    X: x,
    Y: view.h / 2 - cy,
    wx: R * sth - x, // 世界位置在圆柱上：(R·sinθ, -R(1-cosθ))
    wy: depth * Math.tan(tilt), // 刚性倾斜（和下面的 pitch 是同一个角）
    depth,
    scale: FILM.shrink * (1 + Math.abs(warpNorm) * FILM.wStretch),
    // 脸朝外：圆柱上"转过的角度"就是这个转角（不用另外给 yaw 常量）
    yaw: theta + (-warpNorm * FILM.wYaw * FILM.sign) * DEG,
    pitch: -tilt + warpNorm * FILM.wPitch * DEG,
  };
}

/**
 * pose → CSS `matrix3d(...)`。
 *
 * 推导：世界点 W = (X+wx+ox, Y+wy+oy, -depth+oz)（ox/oy/oz 是本地偏移经旋转缩放后的结果），
 * 相机在 (0,0,D) 看原点，于是 projX = D·Wx/(D+depth-oz)，屏幕位移 = proj − **布局**位置。
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
  // 常数项里那个 wx / wy 是"世界位置 − 布局位置"（见 poseAt 的注释）：
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
