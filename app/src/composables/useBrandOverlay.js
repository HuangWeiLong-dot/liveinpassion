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
import { runPageTransition } from './usePageTransition.js';

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

  return { visible, phase, showEnter, entered, wordmarkOn, uiReady, bg, runId, markReady, enter, switchTheme };
}
