// CoverFlight：整段"列表 → 详情 → 列表"里**唯一**那张会飞的封面。
//
// 为什么不再用两个页面各自的 <img> 交接：
//   · 列表那格和详情右列是两棵 DOM，交接只能靠 sessionStorage 里的一个旧矩形；
//     退出时也拿不到"现在的卡片在哪"，切篇 / 改窗口 / 无限轨道复位都会落偏；
//   · 路由换页那一帧是两个元素在换手，比例、object-fit、hover 缩放都可能变，
//     看起来就是一下"跳"。
//
// 现在：图片和飞行过程都归 App 层这一块 fixed 元素所有（Teleport 到 body，
// 没有 transform 祖先）。两个页面只负责：
//   · 列表：点下去时把封面交给它，并在返回时量出**当前**目标格的矩形；
//   · 详情：挂上来后量出右列的终点矩形，飞完再把图交还给详情自己的封面。
//
// 一次飞行的生命周期：
//   beginCoverFlight() → 可选 liftCoverFlightTo()（列表淡出的那 240ms 里先轻微起势，
//   避免"点下去先愣一下"）→ animateCoverFlightTo(dest, { onComplete })
//   → 调用方在同一帧 hideCoverFlight() 并显示自己的封面。
import { gsap } from 'gsap';
import { reactive } from 'vue';

/** 仅供调试 / 视图读取；动画本身直接操作 DOM，不走响应式 */
export const coverFlightState = reactive({
  active: false,
  mode: '',   // 'enter' | 'exit'
  slug: '',
});

let hostEl = null;
let imgEl = null;
let timeline = null;
let rect = null;
let meta = {};
let safetyTimer = 0;

/** CoverFlight.vue 挂载时注册自己的两个节点 */
export function registerCoverFlight(host, img) {
  hostEl = host;
  imgEl = img;
}

export function isCoverFlightActive() {
  return coverFlightState.active;
}

export function getCoverFlightSlug() {
  return coverFlightState.slug;
}

export function getCoverFlightMode() {
  return coverFlightState.mode;
}

/** 当前飞行矩形的快照（被打断时用来接着飞） */
export function getCoverFlightRect() {
  return rect ? { ...rect } : null;
}

/** 起飞时带过来的附加信息（自然尺寸 / 列表底色 / 来源格） */
export function getCoverFlightMeta() {
  return { ...meta };
}

function readRect() {
  if (!hostEl) return null;
  const r = hostEl.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function applyRect(r) {
  hostEl.style.left = `${r.left}px`;
  hostEl.style.top = `${r.top}px`;
  hostEl.style.width = `${r.width}px`;
  hostEl.style.height = `${r.height}px`;
  rect = { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * 接管封面。
 *
 * @param {object} opts
 * @param {string} opts.src       封面图 URL（列表和详情用的是同一张压缩图）
 * @param {string} opts.slug      文章 slug
 * @param {'enter'|'exit'} opts.mode
 * @param {{left:number,top:number,width:number,height:number}} opts.rect 起始矩形
 * @param {number} [opts.naturalWidth]  源图的自然宽（详情用它先把媒体盒比例定下来）
 * @param {number} [opts.naturalHeight]
 * @param {string|null} [opts.stageBg]  列表页底色（详情第一帧顶着它，避免整屏亮/暗一档）
 * @param {Element|null} [opts.sourceEl] 被点的那一格（返回时用它现量落点）
 * @param {string} [opts.sourceSlug]    那一格对应的 slug
 * @returns {boolean} 接管是否成功
 */
export function beginCoverFlight({
  src,
  slug,
  mode = 'enter',
  rect: startRect,
  naturalWidth = 0,
  naturalHeight = 0,
  stageBg = null,
  sourceEl = null,
  sourceSlug = '',
} = {}) {
  if (!hostEl || !imgEl || !startRect || !startRect.width || !startRect.height) return false;

  timeline?.kill();
  timeline = null;
  clearTimeout(safetyTimer);

  meta = {
    src,
    naturalWidth,
    naturalHeight,
    stageBg,
    sourceEl,
    sourceSlug: sourceSlug || slug || '',
  };
  coverFlightState.active = true;
  coverFlightState.mode = mode;
  coverFlightState.slug = slug || '';

  if (imgEl.getAttribute('src') !== src) imgEl.src = src;
  imgEl.style.transform = 'none';
  imgEl.style.transformOrigin = '50% 50%';

  hostEl.style.display = 'block';
  hostEl.style.visibility = 'visible';
  hostEl.style.opacity = '1';
  applyRect(startRect);

  // 兜底：任何一步没接上（路由失败、页面被强切）也不让图永远浮在页面上
  safetyTimer = setTimeout(() => {
    if (coverFlightState.active) hideCoverFlight();
  }, 2500);

  return true;
}

/**
 * 起势：列表淡出 / 详情退场面板淡出的那一小段时间里先轻微缩放，避免"愣住"。
 * 之后的 animateCoverFlightTo 会从当前矩形接着走，不会跳。
 */
export function liftCoverFlightTo(targetRect, { duration = 0.24, ease = 'power1.out' } = {}) {
  if (!coverFlightState.active || !hostEl || !targetRect) return;
  timeline?.kill();
  timeline = gsap.to(hostEl, {
    left: targetRect.left,
    top: targetRect.top,
    width: targetRect.width,
    height: targetRect.height,
    duration,
    ease,
    overwrite: true,
    onUpdate: () => { rect = readRect(); },
  });
}

/**
 * 飞向终点。
 * @param {{left:number,top:number,width:number,height:number}} targetRect
 * @param {{duration?:number, ease?:string, onComplete?:Function}} [opts]
 */
export function animateCoverFlightTo(targetRect, { duration = 0.8, ease = 'power2.inOut', opacity = 1, onComplete = null } = {}) {
  if (!coverFlightState.active || !hostEl || !targetRect) {
    onComplete?.();
    return;
  }
  timeline?.kill();
  timeline = gsap.to(hostEl, {
    left: targetRect.left,
    top: targetRect.top,
    width: targetRect.width,
    height: targetRect.height,
    // 归档里的非当前篇是 0.38 的预览：封面往那儿落的时候要跟着一起暗下来，
    // 否则落地那一帧会从全亮突然变暗。
    opacity,
    duration,
    ease,
    overwrite: true,
    onUpdate: () => { rect = readRect(); },
    onComplete: () => {
      rect = readRect();
      timeline = null;
      onComplete?.();
    },
  });
}

/** 立刻收掉飞行层（不作动画；落地那一帧由调用方先显示自己的封面） */
export function hideCoverFlight() {
  clearTimeout(safetyTimer);
  safetyTimer = 0;
  timeline?.kill();
  timeline = null;
  coverFlightState.active = false;
  coverFlightState.mode = '';
  coverFlightState.slug = '';
  if (hostEl) {
    hostEl.style.display = 'none';
    hostEl.style.opacity = '0';
  }
  if (imgEl) imgEl.style.transform = 'none';
  rect = null;
  meta = {};
}
