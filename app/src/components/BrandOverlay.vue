<script setup>
// 品牌遮罩：只管**首屏进入**（时序在 composables/useBrandOverlay.js）。
//
//   1. 首屏：LIVEINPASSION 实心显示在屏幕正中，下面一个 ENTER
//   2. 点 Enter：字**从中间滑到上方**
//   3. 再**从上方滑回屏幕正中** —— 冲上去再落回来（过冲回落），同时淡成背景字的浓度
//   4. 主体和 4 个人格这时照常播自己的动画（那套不动）
//   5. 遮罩撤掉，字交接给 Hero 里那层位置、浓度都一致的背景字
//
// 全程就是这一行实心字在动，没有粒子、没有溶解 —— 之前那套离子重组已经去掉。
// 通用转场走浏览器的 View Transitions API（composables/usePageTransition.js），主题切换也走它。
// 两处的字号/字距/最终位置必须一致，交接时才对得上。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useBrandOverlay } from '../composables/useBrandOverlay.js';
import { useTheme } from '../composables/useTheme.js';
import { useMusicPlayer } from '../composables/useMusicPlayer.js';
import { sitePreload } from '../composables/useSitePreload.js';
import { BRAND_QUESTIONS } from '../data/brandQuestions.js';

// 预载进度条下方滚动的那些问题：复制一份，滚到一半时无缝接回开头
const tickerQuestions = [...BRAND_QUESTIONS, ...BRAND_QUESTIONS];

const BG_ALPHA = 0.075; // 落到背景字时的浓度（和 .hero-wordmark 的 opacity 对齐）

const {
  visible, phase, showEnter, bg, runId,
  refreshMode, wordmarkText,
  preloadOn, setPreload,
  markReady, enter,
} = useBrandOverlay();
const { isDark } = useTheme();
const { cancelAutoPlay } = useMusicPlayer();

const solidRef = ref(null);

// 字体就绪之前不显示 —— 否则先按 fallback 字体渲染一遍，Oswald 到了再跳一下
const ready = ref(false);
// 字的位移与浓度：由 phase 驱动
const ty = ref('0px');
const alpha = ref(1);

function measureTargets(which) {
  const vh = window.innerHeight;
  if (which === 'lift') {
    // 从居中（0）滑到靠上：中心落在 10vh 处
    return -(vh * 0.5 - vh * 0.1);
  }
  // 滑回**屏幕正中** —— 和 Hero 里那层背景字同一个位置。
  // 所以整段是冲上去、再落回中间的过冲回落，不是一路滑到底。
  return 0;
}

watch(phase, (p) => {
  if (p === 'lift') {
    ty.value = `${measureTargets('lift')}px`;
    alpha.value = 1;
  } else if (p === 'drop' || p === 'leave') {
    ty.value = `${measureTargets('drop')}px`;
    alpha.value = BG_ALPHA;
  } else {
    // 回到 idle（下一次开演）
    ty.value = '0px';
    alpha.value = 1;
  }
});

// 重开（点 Enter）时，位移要复位
watch(runId, () => {
  ty.value = '0px';
  alpha.value = 1;
});

// 刷新过场：不出现 ENTER，问题字在正中停一下让人看清，再自动走同一套进场动画。
let autoEnterTimer = 0;
let autoEntered = false;
watch([ready, showEnter, refreshMode], ([r, s, rm]) => {
  if (!rm || !r || !s || autoEntered || phase.value !== 'idle') return;
  autoEntered = true;
  autoEnterTimer = window.setTimeout(() => {
    if (phase.value === 'idle') enter();
  }, 900);
}, { immediate: true });

// 无音乐进入：先摘掉首次交互自动起播的监听，再走同一条进入时序
function enterNoMusic() {
  cancelAutoPlay();
  enter();
}

// 字体就绪（带兜底时限）。两步缺一不可：
//   ① 先等字体 CSS 应用上 —— 它到位之前 @font-face 根本不存在，fonts.ready 秒兑现；
//   ② 再把首屏用到的那几款字**显式 load 一遍** —— 元素还没显示的话这些字压根没被
//      请求过，fonts.ready 同样秒兑现（它就是"当前挂起的加载都完成了"）。
// 最后再赛一个 2.5s 的死线：网慢时宁可让字先出来、允许跳一次，也不能一直空着。
async function waitForFonts() {
  const timeout = new Promise((r) => setTimeout(r, 2500));
  const fonts = (async () => {
    await (window.__fontCSSReady || Promise.resolve());
    const f = document.fonts;
    if (!f?.load) return;
    await Promise.all([
      f.load('700 1em Oswald'),      // 品牌字
      f.load('300 1em Poppins'),     // 正文最常用的那一档
      f.load('400 1em "JetBrains Mono"'), // ENTER / INDIVIDUATION 那行小字
    ]);
    await f.ready;
  })();
  try {
    await Promise.race([fonts, timeout]);
  } catch {
    // 拿不到就算了 —— 显示比字体正确要紧
  }
}

onMounted(async () => {
  bg.value = isDark.value ? 'dark' : 'light';
  await waitForFonts();
  if (!visible.value && phase.value === 'idle') {
    // 极端情况下（用户已经点过）就别再亮了
  }
  ready.value = true;
  markReady();
});

onBeforeUnmount(() => {
  ready.value = false;
  clearTimeout(autoEnterTimer);
});
</script>

<template>
  <div
    class="brand"
    :class="{
      'is-dark': bg === 'dark',
      'is-gone': !visible,
      'is-ready': ready,
      'is-leaving': phase === 'leave',
      // loading 期间底板要留着：进度条就画在这块实体底板上
      'is-moving': phase !== 'idle' && phase !== 'loading',
    }"
  >
    <div class="brand__bg" aria-hidden="true" />
    <!-- ⚠ 这行大字也要挂在 ready 上。它原来是"一直就画"，于是首屏必然先用
         兜底字体画一遍、等 Oswald 到了再换一次 —— 整屏只有这一个字，那一下很跳。
         is-ready 以前只管 ENTER 按钮，所以那套"等字体"其实没管到字。 -->
    <div
      ref="solidRef"
      class="brand__solid"
      :class="{ 'is-question': refreshMode }"
      :style="{
        transform: `translateY(${ty})`,
        opacity: ready ? alpha : 0,
        '--brand-progress': `${sitePreload.progress}%`,
      }"
    >
      {{ wordmarkText }}
    </div>

    <div
      v-show="!refreshMode && showEnter && phase === 'idle'"
      class="brand__actions"
    >
      <button
        class="brand__enter"
        type="button"
        @click="enter"
        @keyup.enter="enter"
      >
        ENTER
      </button>
      <button
        class="brand__enter brand__enter--quiet"
        type="button"
        data-no-music
        @click.stop="enterNoMusic"
        @keydown.enter.stop
      >
        ENTER WITHOUT MUSIC
      </button>

      <!-- 首屏的一个小选择：LIVE IN PASSION = 点 ENTER 时预载全站图片；
           NOT LIVE IN PASSION = 不预载。记在 localStorage。 -->
      <div class="brand__preload" role="radiogroup" aria-label="Preload next pages" data-no-music>
        <button
          class="brand__preload-opt"
          :class="{ 'is-on': preloadOn }"
          type="button"
          :aria-pressed="preloadOn"
          @click.stop="setPreload(true)"
          @touchstart.stop
          @keydown.stop
        >LIVE IN PASSION</button>
        <span class="brand__preload-sep" aria-hidden="true">/</span>
        <button
          class="brand__preload-opt"
          :class="{ 'is-on': !preloadOn }"
          type="button"
          :aria-pressed="!preloadOn"
          @click.stop="setPreload(false)"
          @touchstart.stop
          @keydown.stop
        >NOT LIVE IN PASSION</button>
      </div>
    </div>

    <!-- 预载进度期间：字下方滚动显示那组问题 -->
    <div v-if="sitePreload.active" class="brand__ticker" aria-hidden="true">
      <div class="brand__ticker-track">
        <span v-for="(question, i) in tickerQuestions" :key="i" class="brand__ticker-item">
          {{ question }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.brand {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.42s ease, visibility 0.42s ease;
}

/* 底色单独一层：字往下滑的时候就把它淡掉，露出底下的主页 */
.brand__bg {
  position: absolute;
  inset: 0;
  background: #fafafa;
  transition: opacity 0.8s ease;
}

.brand.is-dark .brand__bg {
  background: #000000;
}

.brand.is-moving .brand__bg,
.brand.is-leaving .brand__bg {
  opacity: 0;
}

.brand.is-leaving,
.brand.is-gone {
  opacity: 0;
}

.brand.is-gone {
  visibility: hidden;
  pointer-events: none;
}

/* 首屏那行字。字号/字距必须和 Hero 的 .hero-wordmark **完全一致**，
   滑到底部时才是同一个东西的两段。 */
/* 进度条就是这行字本身：已下载的部分用实色，没下完的部分压暗。
   --brand-progress 由 sitePreload.progress 驱动，从左到右把字“填满”。 */
@property --brand-progress {
  syntax: '<percentage>';
  inherits: false;
  initial-value: 100%;
}

.brand__solid {
  --brand-ink: #111;
  position: relative;
  font-family: 'Oswald', sans-serif;
  font-weight: 700;
  font-size: min(9.5vw, 10rem);
  letter-spacing: 0.1em;
  white-space: nowrap;
  color: transparent;
  background-image: linear-gradient(
    90deg,
    var(--brand-ink) 0 var(--brand-progress),
    color-mix(in srgb, var(--brand-ink) 15%, transparent) var(--brand-progress) 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  /* 两段滑动的节奏 + 进度填充都走这里 */
  transition:
    transform 0.9s cubic-bezier(0.5, 0, 0.2, 1),
    opacity 0.7s ease,
    --brand-progress 0.3s ease;
}

.brand.is-dark .brand__solid {
  --brand-ink: #ffffff;
}

/* 刷新过场的问题：句子比 LIVEINPASSION 长，允许按词折行、字号收一档 */
.brand__solid.is-question {
  width: min(88vw, 1120px);
  font-size: clamp(1.6rem, 5.6vw, 6rem);
  line-height: 1.06;
  letter-spacing: 0.04em;
  white-space: normal;
  text-align: center;
}

@media (max-width: 768px) {
  .brand__solid.is-question {
    width: min(90vw, 560px);
    font-size: clamp(1.4rem, 7.4vw, 2.7rem);
    letter-spacing: 0.02em;
  }
}

/* 不支持 background-clip:text 的浏览器：回到纯色字，别让字消失 */
@supports not ((background-clip: text) or (-webkit-background-clip: text)) {
  .brand__solid {
    color: var(--brand-ink);
    background-image: none;
  }
}

.brand__actions {
  position: absolute;
  bottom: 15vh;
  left: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  transform: translateX(-50%);
}

.brand__enter {
  padding: 13px 42px;
  background: transparent;
  border: 1px solid currentcolor;
  color: #111;
  font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace;
  font-size: 11px;
  letter-spacing: 0.42em;
  text-indent: 0.42em;
  cursor: pointer;
  opacity: 0;
  transition: background-color 0.3s ease, color 0.3s ease, letter-spacing 0.45s ease,
    opacity 0.6s ease;
}

.brand.is-ready .brand__enter {
  opacity: 1;
}

.brand__enter--quiet {
  padding: 6px 0;
  border: 0;
  font-size: 9px;
  letter-spacing: 0.22em;
  text-indent: 0.22em;
  text-decoration: underline;
  text-underline-offset: 5px;
  text-decoration-thickness: 1px;
}

.brand__enter--quiet:hover {
  letter-spacing: 0.26em;
}

/* 首屏的 PRELOAD 小选择：等宽小字、斜杠分隔，选中的一条带实线下划线 */
.brand__preload {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: center;
  gap: 4px 8px;
  margin-top: 4px;
  color: #111;
  font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace;
  font-size: 8px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  opacity: 0;
  transition: opacity 0.6s ease;
}

.brand.is-ready .brand__preload {
  opacity: 1;
}

.brand.is-dark .brand__preload {
  color: #fff;
}

.brand__preload-opt {
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
  opacity: 0.38;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 4px;
  text-decoration-color: transparent;
  transition: opacity 0.2s ease, text-decoration-color 0.2s ease;
}

.brand__preload-opt:hover {
  opacity: 0.72;
}

.brand__preload-opt.is-on {
  opacity: 1;
  text-decoration-color: currentColor;
}

.brand__preload-sep {
  opacity: 0.24;
}

/* 预载期间：字下方滚动的那组问题 */
.brand__ticker {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 9vh;
  overflow: hidden;
  color: #111;
  opacity: 0.5;
  pointer-events: none;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
}

.brand.is-dark .brand__ticker {
  color: #fff;
}

.brand__ticker-track {
  display: inline-flex;
  align-items: center;
  gap: 2.6em;
  width: max-content;
  white-space: nowrap;
  font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace;
  font-size: clamp(0.5rem, 0.8vw, 0.64rem);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  animation: brand-ticker 38s linear infinite;
}

.brand__ticker-item::after {
  content: '·';
  margin-left: 1.4em;
  opacity: 0.55;
}

@keyframes brand-ticker {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

@media (max-width: 768px) {
  .brand__ticker {
    bottom: 8vh;
  }

  .brand__ticker-track {
    font-size: 0.48rem;
    letter-spacing: 0.12em;
  }
}

@media (prefers-reduced-motion: reduce) {
  .brand__ticker-track {
    animation: none;
  }
}

.brand.is-dark .brand__enter {
  color: #fff;
}

.brand__enter:hover {
  letter-spacing: 0.6em;
}

.brand:not(.is-dark) .brand__enter:hover {
  background: #111;
  color: #fafafa;
}

.brand.is-dark .brand__enter:hover {
  background: #fff;
  color: #000;
}

@media (max-width: 768px) {
  .brand__actions {
    bottom: 12vh;
  }

  .brand__enter {
    padding: 11px 30px;
    font-size: 10px;
  }

  .brand__enter--quiet {
    padding: 6px 0;
    font-size: 8px;
  }

  .brand__preload {
    font-size: 7px;
    letter-spacing: 0.12em;
  }
}
</style>
