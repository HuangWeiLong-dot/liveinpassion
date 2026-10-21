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

const TEXT = 'LIVEINPASSION';
const BG_ALPHA = 0.075; // 落到背景字时的浓度（和 .hero-wordmark 的 opacity 对齐）

const { visible, phase, showEnter, bg, runId, markReady, enter } = useBrandOverlay();
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
      'is-moving': phase !== 'idle',
    }"
  >
    <div class="brand__bg" aria-hidden="true" />
    <!-- ⚠ 这行大字也要挂在 ready 上。它原来是"一直就画"，于是首屏必然先用
         兜底字体画一遍、等 Oswald 到了再换一次 —— 整屏只有这一个字，那一下很跳。
         is-ready 以前只管 ENTER 按钮，所以那套"等字体"其实没管到字。 -->
    <div
      ref="solidRef"
      class="brand__solid"
      :style="{ transform: `translateY(${ty})`, opacity: ready ? alpha : 0 }"
    >
      {{ TEXT }}
    </div>

    <div
      v-show="showEnter && phase === 'idle'"
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
.brand__solid {
  position: relative;
  font-family: 'Oswald', sans-serif;
  font-weight: 700;
  font-size: min(9.5vw, 10rem);
  letter-spacing: 0.1em;
  white-space: nowrap;
  color: #111;
  /* 两段滑动的节奏统一走这里 */
  transition: transform 0.9s cubic-bezier(0.5, 0, 0.2, 1), opacity 0.7s ease;
}

.brand.is-dark .brand__solid {
  color: #ffffff;
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
}
</style>
