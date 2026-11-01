<script setup>
// 页脚抽屉：和前台 AppFooter 同样的结构 ——
//   · footer 本身留一块与页脚同高的透明占位；
//   · 真正的字标带 fixed 在视口底部，被页面内容盖住；
//   · 滚到文档末尾时占位让开，字标带才露出来。
// 巨型 LIVEINPASSION 的流体扭曲用原生 WebGL 重写（见 utils/footerDistortion.js），
// 只在页脚露出时跑 RAF；WebGL 不可用就保留 HTML 字标。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { createFooterDistortion } from '../utils/footerDistortion.js';
import { isDark } from '../theme.js';

const spacerEl = ref(null);
const bandEl = ref(null);
const canvasEl = ref(null);

const revealed = ref(false);
const webgl = ref(false);

let observer = null;
let distortion = null;
let creating = false;
let attempted = false;
let disposed = false;
let resizeTimer = 0;

function ensureDistortion() {
  if (attempted || disposed) return;
  attempted = true;
  if (creating) return;
  creating = true;
  const inst = createFooterDistortion(canvasEl.value, {
    getColor: () => (bandEl.value ? getComputedStyle(bandEl.value).color : '#1A1A1A'),
  });
  creating = false;
  if (disposed) {
    inst?.dispose();
    return;
  }
  distortion = inst;
  webgl.value = !!inst;
  if (revealed.value) distortion?.start();
}

function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => distortion?.resize(), 180);
}

onMounted(() => {
  if (!('IntersectionObserver' in window)) {
    revealed.value = true;
  } else {
    observer = new IntersectionObserver(
      (entries) => { revealed.value = entries[0]?.isIntersecting || false; },
      { threshold: 0.01 }
    );
    if (spacerEl.value) observer.observe(spacerEl.value);
  }
  window.addEventListener('resize', onResize);
});

watch(revealed, (visible) => {
  if (visible) {
    ensureDistortion();
    distortion?.start();
  } else {
    distortion?.stop();
  }
});

watch(isDark, () => {
  // 等 CSS 变量换完再重画字标贴图
  requestAnimationFrame(() => distortion?.redraw());
});

onBeforeUnmount(() => {
  disposed = true;
  observer?.disconnect();
  observer = null;
  window.removeEventListener('resize', onResize);
  clearTimeout(resizeTimer);
  distortion?.dispose();
  distortion = null;
});
</script>

<template>
  <footer class="admin-footer">
    <div ref="spacerEl" class="admin-footer__spacer" aria-hidden="true" />

    <div ref="bandEl" class="admin-footer__fixed" :class="{ 'has-webgl': webgl }">
      <div class="admin-footer__canvas-wrap">
        <canvas ref="canvasEl" class="admin-footer__canvas" aria-hidden="true" />
        <span class="admin-footer__wordmark" aria-hidden="true">LIVEINPASSION</span>
      </div>
      <div class="admin-footer__be">
        <span>Be Brave.</span>
        <span>Be Genuine.</span>
        <span>Be Humble.</span>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.admin-footer {
  /* 抽屉高度：字标画布（宽度 / 4.05）+ 三句 Be 那一行 + 上下留白 */
  --foot-h: calc(min(100vw, 1600px) / 4.05 + 76px);
  position: relative;
  width: 100%;
  background: transparent;
  color: var(--text-primary);
  padding: 0;
  border: 0;
  text-align: left;
}

/* 透明占位：它在文档最末尾，滚到它进视口时，抽屉才算拉开 */
.admin-footer__spacer {
  height: var(--foot-h);
  pointer-events: none;
}

/* 固定字标带：永远在视口底部，靠负 z-index 待在页面内容后面 */
.admin-footer__fixed {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
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

.admin-footer__canvas-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
}

.admin-footer__canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/* WebGL 不可用时的兜底字标；画布就绪后藏掉 */
.admin-footer__wordmark {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
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

.admin-footer__fixed.has-webgl .admin-footer__wordmark {
  display: none;
}

/* 字标下面三句小的 Be */
.admin-footer__be {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.4rem clamp(1rem, 3vw, 2.6rem);
  padding-top: 10px;
  font-family: var(--font-mono);
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
  .admin-footer {
    --foot-h: calc(min(100vw, 1600px) / 4.05 + 58px);
  }

  .admin-footer__fixed {
    padding: 10px 14px 12px;
  }

  .admin-footer__be {
    gap: 0.25rem 0.9rem;
    padding-top: 6px;
    letter-spacing: 0.14em;
  }
}
</style>
