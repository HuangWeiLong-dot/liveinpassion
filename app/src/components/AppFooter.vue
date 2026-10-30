<script setup>
// 全站页脚。模式完全照搬 trae.cn 的"抽屉"：
//
//   · footer 本身**永远固定在视口底部**，页面内容像一个不透明的抽屉盖在它上面；
//   · 文档末尾留一块和 footer 同高的透明占位；滚到页尾时抽屉拉开，
//     固定 footer 从占位里露出来。
//   · 露出来的内容是：超大 LIVEINPASSION 字标（WebGL 网格扭曲），
//     字标下面三句小号的 Be。
//
// 所以这个组件必须挂在全局（App.vue 的 router-view 之后），不能放进每个页面 ——
// 只有页面自己的 .page 背景盖在它上面，抽屉效果才成立。
//
// BLOGS 轨道和文章详情是固定全屏布局，没有可滚动的抽屉，用 compact 变体：
// 字标和三句 Be 直接排成行内小字。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { createFooterDistortion } from '../composables/useFooterDistortion.js';
import { useTheme } from '../composables/useTheme.js';

const props = defineProps({
  compact: { type: Boolean, default: false },
});

const SLOGANS = ['Be Brave.', 'Be Genuine.', 'Be Humble.'];

const { isDark } = useTheme();
const revealEl = ref(null);
const bandEl = ref(null);
const canvasEl = ref(null);
const revealed = ref(false);
const webgl = ref(false);

let observer = null;
let distortion = null;
let creating = false;
let disposed = false;
let resizeTimer = 0;

function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => distortion?.resize(), 180);
}

async function ensureDistortion() {
  if (props.compact || distortion || creating || disposed) return;
  creating = true;
  const inst = await createFooterDistortion(canvasEl.value, {
    getColor: () => (bandEl.value ? getComputedStyle(bandEl.value).color : '#1A1A1A'),
    onReady: () => { webgl.value = true; },
  });
  creating = false;
  if (disposed) {
    inst?.dispose();
    return;
  }
  distortion = inst;
  if (revealed.value) distortion?.start();
}

onMounted(() => {
  if (props.compact) return;
  if (!('IntersectionObserver' in window)) {
    revealed.value = true;
  } else {
    observer = new IntersectionObserver(
      (entries) => { revealed.value = entries[0]?.isIntersecting || false; },
      { threshold: 0.01 }
    );
    if (revealEl.value) observer.observe(revealEl.value);
  }
  window.addEventListener('resize', onResize);
  // 提前把 WebGL 字标准备好：等滚到页尾才创建的话，会先看到一帧
  // HTML 兜底字标、再被 canvas 替换 —— 那一下就是闪烁。
  requestAnimationFrame(() => { ensureDistortion(); });
});

watch(revealed, (visible) => {
  if (props.compact) return;
  // 抽屉拉开期间，底部那批固定件（手机汉堡条 / GALLERY 的筛选条与胶卷条 /
  // 播放中的歌词）正好压在页脚那三句 Be 上，让它们先淡出（规则在 main.css）。
  document.documentElement.classList.toggle('footer-revealed', visible);
  if (!visible) {
    distortion?.stop();
    return;
  }
  ensureDistortion();
});

watch(isDark, () => {
  // 等 CSS 变量换完再重画字标贴图
  requestAnimationFrame(() => distortion?.redraw());
});

onBeforeUnmount(() => {
  disposed = true;
  document.documentElement.classList.remove('footer-revealed');
  observer?.disconnect();
  window.removeEventListener('resize', onResize);
  clearTimeout(resizeTimer);
  distortion?.dispose();
  distortion = null;
});
</script>

<template>
  <!-- 完整版：文档末尾只放一块透明占位；真正的 footer 是 fixed 的 -->
  <footer v-if="!compact" class="site-footer">
    <div ref="revealEl" class="site-footer__spacer" aria-hidden="true" />

    <div ref="bandEl" class="site-footer__fixed" :class="{ 'has-webgl': webgl }">
      <div class="site-footer__canvas-wrap">
        <canvas ref="canvasEl" class="site-footer__canvas" aria-hidden="true" />
        <span class="site-footer__wordmark" aria-hidden="true">LIVEINPASSION</span>
      </div>
      <div class="site-footer__be">
        <span v-for="slogan in SLOGANS" :key="slogan">{{ slogan }}</span>
      </div>
    </div>
  </footer>

  <!-- 紧凑版：BLOGS 轨道 / 文章详情的固定布局里用 -->
  <footer v-else class="site-footer is-compact">
    <div class="site-footer__inner">
      <div class="site-footer__wordmark site-footer__wordmark--inline" aria-hidden="true">
        LIVEINPASSION
      </div>
      <div class="site-footer__slogans">
        <p v-for="slogan in SLOGANS" :key="slogan" class="site-footer__slogan">{{ slogan }}</p>
      </div>
      <p class="site-footer__legal">© 2026 LIVE IN PASSION.</p>
    </div>
  </footer>
</template>

<style scoped>
.site-footer {
  /* 抽屉高度：字标画布（宽度 / 4.05）+ 三句 Be 那一行 + 上下留白 */
  --foot-h: calc(min(100vw, 1600px) / 4.05 + 76px);
  position: relative;
  width: 100%;
  background: transparent;
  color: var(--text-primary);
  /* main.css 里有一条全局 footer { padding: 48px 64px; ... }，会把这层撑出
     一段空白、让固定 footer 和占位对不齐；这里必须压掉。 */
  padding: 0;
  border-top: 0;
  text-align: left;
}

/* 透明占位：它在文档最末尾，滚到它进视口时，抽屉才算拉开 */
.site-footer__spacer {
  height: var(--foot-h);
  pointer-events: none;
}

/* 固定 footer：永远在视口底部，靠负 z-index 待在页面内容后面 */
.site-footer__fixed {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  /* 页面内容（.page，z-index 1）盖住它；但必须高于 body 背景——
     BLOGS 页给 html/body 单独设了底色，负 z-index 会被那层底色吃掉。 */
  z-index: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  height: var(--foot-h);
  padding: 16px clamp(16px, 3vw, 32px) 18px;
  background: var(--text-primary);
  color: var(--bg);
  overflow: hidden;
  pointer-events: none;
}

.site-footer__canvas-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
}

.site-footer__canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/* WebGL 不可用时的兜底字标；画布就绪后藏掉 */
.site-footer__wordmark {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Oswald', sans-serif;
  font-weight: 700;
  font-size: clamp(2.4rem, 13.5vw, 16rem);
  line-height: 0.78;
  letter-spacing: -0.018em;
  white-space: nowrap;
  color: var(--bg);
  user-select: none;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.site-footer__fixed.has-webgl .site-footer__wordmark {
  display: none;
}

/* 字标下面三句小的 Be */
.site-footer__be {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.4rem clamp(1rem, 3vw, 2.6rem);
  padding-top: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: clamp(9px, 0.8vw, 11px);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--bg);
  opacity: 0.68;
  white-space: nowrap;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

@media (max-width: 700px) {
  .site-footer {
    --foot-h: calc(min(100vw, 1600px) / 4.05 + 58px);
  }

  .site-footer__fixed {
    padding: 10px 14px 12px;
  }

  .site-footer__be {
    gap: 0.25rem 0.9rem;
    padding-top: 6px;
    letter-spacing: 0.14em;
  }
}

/* ── 紧凑版（BLOGS / 文章详情）───────────────────────────────────────── */
.site-footer.is-compact {
  --foot-h: 0px;
}

.site-footer.is-compact .site-footer__inner {
  padding: 0.5rem 0 0;
}

.site-footer__wordmark--inline {
  position: relative;
  display: block;
  inset: auto;
  font-size: clamp(1.6rem, 4vw, 2.4rem);
  line-height: 1;
  letter-spacing: 0.08em;
  font-weight: 500;
  text-align: center;
  color: var(--text-primary);
}

.site-footer__slogans {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.15rem 1.1rem;
  padding-top: 0.4rem;
}

.site-footer__slogan {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.6rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.site-footer__legal {
  margin: 0.45rem 0 0;
  text-align: center;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.55rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-secondary);
}
</style>
