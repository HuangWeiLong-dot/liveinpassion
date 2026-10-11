// 通用转场：**一块板子从随机一侧划进来 → 正中逐字亮出目标页标题 → 板子滑走 → 落到目标页**。
//
// 时序（用户定的）：
//   ① 点下链接，**先**有一块板子从随机一侧（上/下/左/右）划进来，盖满整屏
//   ② 板子停住，正中那行字（目标页的标题，如 BLOGS / HOME）逐字亮出来
//   ③ 板子往**另一个随机方向**滑走，露出目标页
// 进、退两个方向各自独立随机。
//
// ── 为什么不用 View Transitions API（用过，撤了）────────────────────────
// 两个死结，都是这个 API 本身的：
//
//  1. **伪元素树在 top layer，z-index 压不过它。**
//     "板子划进来盖住旧页面"需要旧页面还画在屏幕上；用 VT 的话旧页面只剩一张
//     快照，而快照挂在最顶层 —— 板子整段进场都得藏在它底下，用户看到的还是
//     "啪一下盖满"。想反过来让快照滑走也不对：那动的是页面，不是板子。
//  2. **startViewTransition 要抓一张整页位图。**
//     首页有 WebGL 画布和几十张图，抓那一张就是"点下去先卡一下"的来源。
//
// 现在改成一块**普通 DOM** 板子自己动：没有快照、没有 top layer、没有整页栅格化。
// "板子盖住的是旧页面"靠的是**把导航本身推迟到板子盖满之后** —— 那期间 DOM 里
// 还是货真价实的旧页面（见下面 beforeEach 里那个 await）。
//
// 主题切换（整屏放大）和"首页磁贴 → 博客详情"那两条**仍然用 View Transitions**：
// 它们不需要板子盖住任何东西，上面两个问题都不存在。见 useViewTransition.js。
import { nextTick, ref } from 'vue';
import { sectionLabelFor } from './pageLabels.js';

// ── 时长（唯一的出处；改这里就够了）───────────────────────────────────
export const IN_MS = 420;            // ① 板子划进来
export const GLYPH_MS = 220;         // 单个字亮起来本身要多久
export const GLYPH_STAGGER_MS = 34;  // 字与字之间错开多少
/** 字亮完之后再停多久。⚠ 导航就在这一段里完成（见 beforeEach），留得太短会来不及 */
export const HOLD_MS = 320;
export const OUT_MS = 380;           // ③ 板子滑走
/** 逐字亮的**总时长上限**：字多的时候把间隔压薄，也不许超过这个数 */
export const LABEL_CAP_MS = 900;

// ── 覆盖层状态（组件读它渲染）─────────────────────────────────────────
/** 屏幕正中要显示的那行字 */
export const transitionLabel = ref('');
/** 'left' | 'right' | 'up' | 'down' —— 板子从哪边**划进来** */
export const transitionIn = ref('left');
/** 'left' | 'right' | 'up' | 'down' —— 板子往哪边**滑走**（与进来那侧各自随机） */
export const transitionOut = ref('right');
/** 每次开演 +1：组件据此开演、并据此判断"这一次还该不该继续往下走" */
export const transitionRunId = ref(0);
/** 新页面的 DOM 真的换完了（路由 afterEach + nextTick）就 +1。组件据此决定何时滑走 */
export const swapVersion = ref(0);

const DIRS = ['left', 'right', 'up', 'down'];
const pickDir = () => DIRS[Math.floor(Math.random() * DIRS.length)];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let skipOnce = false; // 下一次导航跳过（首页磁贴那条路自己会演）
let armedRunId = 0;   // 哪一次 runId 是"真的要开演"；0 = 没有

/** 系统"减少动态效果"下整段转场不做，只保留切换本身 */
export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 这条只给 useViewTransition.js 用（主题切换 / 首页磁贴那两条还走 VT） */
export function supportsViewTransition() {
  return typeof document !== 'undefined' && typeof document.startViewTransition === 'function';
}

/**
 * 那行字逐字亮要多长时间、字与字错开多少。
 *
 * 字多了（"THE FIRE AND THE TRAP" 21 个字）光靠固定间隔会拖到 1s 开外，
 * 所以间隔按上限**等比压薄**：宁可整体快一点，也不要一行字拖成两拍。
 * ⚠ 路由守卫（算"什么时候放行导航"）和组件（排 GSAP 的 stagger）都从这里取，
 * 两边必须是同一个数，否则字还没亮完导航就走了。
 *
 * @returns {{ step: number, total: number }}
 */
export function labelTiming(label) {
  const n = Math.max((label || '').length, 1);
  const spread = n - 1;
  const step = spread
    ? Math.min(GLYPH_STAGGER_MS, Math.max(14, (LABEL_CAP_MS - GLYPH_MS) / spread))
    : GLYPH_STAGGER_MS;
  return { step, total: spread * step + GLYPH_MS };
}

/** 这一次 runId 是不是真的要演（false = 取消信号，把板子收掉就行） */
export function isArmedRun(runId) {
  return runId !== 0 && runId === armedRunId;
}

/**
 * 非导航场景的转场（主题切换走这里）：DOM 变更就在 cb 里，直接等它落地。
 * 走的是 view-transition.css 里的默认皮肤（整屏放大冲过去再缩回），没有板子 ——
 * 主题切换不换"板块"，弹一行标题没有意义。
 *
 * ⚠ 这一条**故意仍然用 View Transitions**，和上面撤掉的那条路不冲突：
 * 它换的就是整页像素，快照正是想要的东西（不需要板子压过任何东西）；
 * 抓拍的开销也只在点主题按钮时付一次，不在每次导航上。
 *
 * @param {() => void | Promise<void>} swap 屏幕被盖住那一刻执行的切换动作
 */
export async function runPageTransition(swap) {
  if (prefersReducedMotion() || !supportsViewTransition()) {
    await swap();
    return;
  }
  // 上一次留下的是 cover 皮肤的话先清掉，否则主题切换会套错皮肤
  delete document.documentElement.dataset.vt;
  const vt = document.startViewTransition(async () => {
    await swap();
    // 主题是改 <html> 的 class，样式得等一帧才落到渲染树上
    await nextTick();
  });
  try {
    await vt.finished;
  } catch {
    // 过渡被打断（用户连点、切标签页）时 finished 会 reject。不是错误，吞掉即可。
  }
}

/**
 * 让紧接着的那一次导航跳过转场（首页磁贴那条自己会用 VT 演）。
 * 顺带把**已经在演**的那一次收掉：正在播的板子要是在这里不停下，
 * 它会继续盖在共享元素过渡上面，用户什么也看不到。
 */
export function skipNextPageTransition() {
  skipOnce = true;
  if (transitionRunId.value) {
    armedRunId = 0;
    transitionRunId.value++;
  }
}

/**
 * 等"新页面的 DOM 真的换完"。
 *
 * 组件排完字之后要等这个才滑走：滑走露出来的是新页面，它得先在板子底下挂好。
 * 挂载的开销（首页那边还有 WebGL 初始化）就落在"停住"那一段 —— 那会儿没有东西
 * 在动，卡一下也看不出来。自带超时，路由真出问题时不会把板子永久按在屏幕上。
 *
 * @param {number} from 开演那一刻的 swapVersion 快照
 * @param {number} [capMs] 兜底上限
 */
export async function waitForSwap(from, capMs = 1500) {
  const t0 = Date.now();
  while (swapVersion.value <= from && Date.now() - t0 < capMs) await wait(16);
  // 换完还要等两帧：新页面的首屏图片、字体、WebGL 都还在路上，
  // 至少让它画过一帧再露出来。
  await nextTick();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

/**
 * 挂到 router 上：每次导航都演一遍。
 *
 * ── 为什么守卫里要 await ─────────────────────────────────────────────
 * **这是"板子能盖住旧页面"的全部秘密**。导航被推迟 → 那段时间 DOM 里还是旧页面
 * → 板子划进来盖住的是一张真页面。不推迟的话，点下去 DOM 立刻换成新页面，
 * 用户先看到新页面闪一下、板子才划过来。
 * 推迟到"字写完"为止：再往后新页面就要在板子底下挂载了，那点开销正好落在
 * 停住的那一段里（没有东西在动，卡顿看不见）。
 *
 * @param {import('vue-router').Router} router
 */
export function installPageTransition(router) {
  router.beforeEach(async (to, from) => {
    // 首屏那次导航没有 from（START_LOCATION）—— 那一段由品牌遮罩负责
    if (!from.name) return true;
    // 跳过标记必须在其它 early-return **之前**消耗，否则会漏到下一次导航
    if (skipOnce) {
      skipOnce = false;
      return true;
    }
    // 点同一个链接（含重复点当前页）：没有画面切换，别演
    if (to.fullPath === from.fullPath) return true;
    if (prefersReducedMotion()) return true;

    // 字和方向都要在开演之前定下来 —— 组件的 watcher 是同步的，runId 一加它就开演。
    transitionLabel.value = sectionLabelFor(to);
    transitionIn.value = pickDir();
    transitionOut.value = pickDir();
    const runId = transitionRunId.value + 1;
    armedRunId = runId;
    transitionRunId.value = runId;

    await wait(IN_MS + labelTiming(transitionLabel.value).total);
    return true;
  });

  router.afterEach(async () => {
    // 等 Vue 把新视图 patch 进 DOM
    await nextTick();
    swapVersion.value++;
  });
}
