// 品牌遮罩：只管**首屏进入**了。
//
// 时序（用户定的）：
//   1. 首屏：LIVEINPASSION 正常显示（实心字），下面一个 ENTER
//   2. 点 Enter：字**从屏幕中间滑到上方**
//   3. 再**从上方滑回屏幕正中** —— 冲上去再落回来，同时淡成背景字的浓度
//   4. 主体和 4 个人格照常播它们自己的动画（这套不动）
//   5. 遮罩撤掉，字交接给 Hero 里那层位置、浓度都一致的背景字（也在正中）
//   6. 其余 UI（头部 / 悬浮按钮 / 播放器）最后逐个浮出来
//
// 之前那套"溶解成离子再重组"整个去掉了 —— 用户不要了。开场就是那一行字在动，
// 没有粒子。通用转场挪去了 composables/usePageTransition.js，主题切换也走它 ——
// 于是全站只有一套转场，不再有第二份实现。
import { ref } from 'vue';
import { useTheme } from './useTheme.js';
import { preloadSiteImages } from './useSitePreload.js';
import { runPageTransition } from './usePageTransition.js';
import { pickBrandQuestion } from '../data/brandQuestions.js';

const LIFT_MS = 820;  // 字：中间 → 上方
const DROP_MS = 900;  // 字：上方 → 下方；主体与人格这时已经在播自己的动画
const LEAVE_MS = 420;

const visible = ref(true);    // 首屏默认就盖着
const phase = ref('idle');    // 'idle' | 'lift' | 'drop' | 'leave'
const showEnter = ref(false); // 站点就绪之后才让点
const entered = ref(false);   // Hero 的内容开始它的入场（也用来放开 Hero 的动画）
const wordmarkOn = ref(false);// Hero 底部那层背景字接手
const uiReady = ref(false);   // 最后浮出来的那批 UI（头部、页脚、播放器等）
const bg = ref('dark');       // 首屏遮罩的底色
const runId = ref(0);         // 每次开演 +1，组件据此复位字的位移

// 首屏那个小小的"LIVE IN PASSION / NOT LIVE IN PASSION"选择：
// 前者点 ENTER 时预载**全站图片**（进度条画在首屏字上），后者不预载。
// 默认 NOT：几百张图的全量下载不该强加给每个第一次来的访客；选过一次 LIVE
// 会记在 localStorage，之后一直保留。
const PRELOAD_KEY = 'lip:first-screen-preload';
const preloadOn = ref(false);
try {
  if (localStorage.getItem(PRELOAD_KEY) === '1') preloadOn.value = true;
} catch { /* 隐私模式：默认不预载 */ }

// ── 首次访问 vs 刷新 ─────────────────────────────────────────────────────
// 第一次进站：LIVEINPASSION + ENTER（现在的首屏）。
// 之后每次刷新：不再要 ENTER，随机显示一个大写问题，走同一套字的上浮/回落
// 动画后自动进站 —— 相当于把首屏变成一个会随机提问的过场。
const VISITED_KEY = 'lip:visited';
// 同名 cookie 作为兜底：某些浏览器/设置会在强刷（Ctrl+Shift+R）时清掉
// localStorage 那一档，但 cookie 还在。两者任一为 1 都算"来过"。
const VISITED_COOKIE = 'lip_visited';

function readVisited() {
  try {
    if (localStorage.getItem(VISITED_KEY) === '1') return true;
  } catch { /* ignore */ }
  try {
    return document.cookie.split('; ').some((c) => c.startsWith(`${VISITED_COOKIE}=1`));
  } catch {
    return false;
  }
}

function markVisited() {
  try {
    localStorage.setItem(VISITED_KEY, '1');
  } catch { /* ignore */ }
  try {
    document.cookie = `${VISITED_COOKIE}=1; Max-Age=31536000; Path=/; SameSite=Lax`;
  } catch { /* ignore */ }
}

const wasVisited = readVisited();
const refreshMode = ref(wasVisited);

/** 首屏那行大字：首次是 LIVEINPASSION；刷新是一个随机问题 */
const wordmarkText = ref(wasVisited ? pickBrandQuestion() : 'LIVEINPASSION');

function setPreload(on) {
  preloadOn.value = Boolean(on);
  try {
    localStorage.setItem(PRELOAD_KEY, preloadOn.value ? '1' : '0');
  } catch { /* ignore */ }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function useBrandOverlay() {
  /** 应用挂载完、可以进入时调用 */
  function markReady() {
    showEnter.value = true;
  }

  /** 首屏的 Enter */
  async function enter() {
    if (phase.value !== 'idle' || !showEnter.value) return;
    bg.value = useTheme().isDark.value ? 'dark' : 'light';
    runId.value++;

    // 首次进站完成之后，之后刷新都走"随机问题"的自动过场
    if (!refreshMode.value) markVisited();

    // 选了 LIVE IN PASSION：先把全站图片拉下来，进度条画在首屏那行字上。
    // 这一步**挡在入场动画之前** —— 用户要的就是"下完再进"，避免浏览时逐张卡。
    // 刷新过场是自动的、没有用户选择，不再预载（缓存通常也已经有了）。
    if (!refreshMode.value && preloadOn.value) {
      phase.value = 'loading';
      try {
        await preloadSiteImages();
      } catch {
        /* 预载失败也照常进站 */
      }
    }

    // 1) 字滑到上方
    phase.value = 'lift';
    await wait(LIFT_MS);

    // 2) 字再滑回**屏幕正中**（过冲回落），同时淡成背景字的浓度。
    //    主体和人格从这一刻起照常播它们自己的动画 —— 那套不动。
    entered.value = true;
    phase.value = 'drop';
    await wait(DROP_MS);
    // 背景字必须等**落定之后**才亮：早亮的话，Hero 还在上滑，
    // 那行淡字就提前卡在中间占着位置了（用户一眼就看出来）。
    wordmarkOn.value = true;

    // 3) 其余 UI 最后浮出来 —— 先把注意力留给画面
    phase.value = 'leave';
    uiReady.value = true;
    document.body.classList.add('ui-ready');
    await wait(LEAVE_MS);

    visible.value = false;
    phase.value = 'idle';
    // 首屏遮罩挡住了滚动，揭开之后要放开（旧版是 useAppLoader 负责这件事）
    document.body.classList.remove('no-scroll');
  }

  /**
   * 主题切换。走通用转场（画面放大模糊冲过去 → 换主题 → 从放大态缩回），
   * 所以用户永远看不到颜色硬切。
   */
  async function switchTheme() {
    const { isDark, toggle } = useTheme();
    // 还没进首屏、首屏动画没播完、或者遮罩还盖着：普通切，别把用户卡在动画里
    if (!entered.value || phase.value !== 'idle' || visible.value) {
      toggle();
      return;
    }
    // 目标主题交给覆盖层 —— 它得用**新**底色把屏幕盖满，绽开时才接得上
    await runPageTransition(() => toggle());
  }

  return {
    visible, phase, showEnter, entered, wordmarkOn, uiReady, bg, runId,
    refreshMode, wordmarkText,
    preloadOn, setPreload,
    markReady, enter, switchTheme,
  };
}
