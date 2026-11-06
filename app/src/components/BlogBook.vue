<script setup>
// 多页正文的阅读器：一页纸 + 翻页动画 + 前后按钮。
//
// 结构上只有两层纸：leaf（当前页，负责转动）和 under（下一页/上一页，垫在下面）。
// 向前翻：leaf 绕左边书脊转 -104°，露出 under；到 90° 后 backface 隐藏，纸就"翻过去了"。
// 向后翻：把上一页放回 leaf、从 -104° 转回 0°，等于把那张纸翻回来盖住当前页。
// 鼠标在右边缘的窄条上按住左拖，也能实时把纸拉起来；松手过 30% 就完成翻页。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { gsap } from 'gsap';

const props = defineProps({
  pages: { type: Array, default: () => [] },
});

const paperRef = ref(null);
const leafRef = ref(null);
const shadeRef = ref(null);

const index = ref(0);
const leafHtml = ref('');
const underHtml = ref('');
const turning = ref(false);

const total = computed(() => props.pages.length);
const hasPrev = computed(() => index.value > 0);
const hasNext = computed(() => index.value < total.value - 1);

const MAX_TURN = 104;
const reduced = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let timeline = null;
let drag = null;

function pad(n) {
  return String(n).padStart(2, '0');
}

function resetLeaf() {
  if (leafRef.value) gsap.set(leafRef.value, { rotateY: 0 });
  if (shadeRef.value) gsap.set(shadeRef.value, { opacity: 0 });
}

function kill() {
  timeline?.kill();
  timeline = null;
  removeDragListeners();
  drag = null;
}

function finishForward() {
  index.value = Math.min(total.value - 1, index.value + 1);
  leafHtml.value = props.pages[index.value] || '';
  underHtml.value = '';
  resetLeaf();
  turning.value = false;
  timeline = null;
}

function finishBackward() {
  index.value = Math.max(0, index.value - 1);
  leafHtml.value = props.pages[index.value] || '';
  underHtml.value = '';
  resetLeaf();
  turning.value = false;
  timeline = null;
}

function turnForward() {
  if (!hasNext.value) return;
  turning.value = true;
  underHtml.value = props.pages[index.value + 1] || '';
  if (!leafRef.value || reduced) {
    finishForward();
    return;
  }
  gsap.set(leafRef.value, { rotateY: 0 });
  gsap.set(shadeRef.value, { opacity: 0 });
  timeline = gsap.timeline({ onComplete: finishForward });
  timeline
    .to(leafRef.value, { rotateY: -MAX_TURN, duration: 0.86, ease: 'power2.inOut' }, 0)
    .to(shadeRef.value, { opacity: 0.4, duration: 0.28, ease: 'power1.out' }, 0)
    .to(shadeRef.value, { opacity: 0, duration: 0.4, ease: 'power1.in' }, 0.48);
}

function turnBackward() {
  if (!hasPrev.value) return;
  turning.value = true;
  // 上一页放在 leaf 上，当前页垫在下面；leaf 从背面（-104°）转回来
  underHtml.value = props.pages[index.value] || '';
  leafHtml.value = props.pages[index.value - 1] || '';
  if (!leafRef.value || reduced) {
    finishBackward();
    return;
  }
  gsap.set(leafRef.value, { rotateY: -MAX_TURN });
  gsap.set(shadeRef.value, { opacity: 0.4 });
  timeline = gsap.timeline({ onComplete: finishBackward });
  timeline
    .to(leafRef.value, { rotateY: 0, duration: 0.86, ease: 'power2.inOut' }, 0)
    .to(shadeRef.value, { opacity: 0, duration: 0.56, ease: 'power1.inOut' }, 0);
}

function turn(dir) {
  if (turning.value || drag) return;
  if (dir > 0) turnForward();
  else turnBackward();
}

// ---- 鼠标拖拽翻页（只有右边缘 30px 的窄条接手势，不挡正文/链接）----
function removeDragListeners() {
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragCancel);
}

function onDragStart(e) {
  if (e.pointerType !== 'mouse' || turning.value || !hasNext.value) return;
  e.preventDefault();
  underHtml.value = props.pages[index.value + 1] || '';
  gsap.set(leafRef.value, { rotateY: 0 });
  gsap.set(shadeRef.value, { opacity: 0 });
  drag = { startX: e.clientX, progress: 0 };
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragCancel);
}

function onDragMove(e) {
  if (!drag) return;
  const w = paperRef.value?.clientWidth || 1;
  // 拖过纸宽 78% 就算满页；留一点余量，手感不至于扯不动
  const p = Math.max(0, Math.min(1, (drag.startX - e.clientX) / (w * 0.78)));
  drag.progress = p;
  gsap.set(leafRef.value, { rotateY: -MAX_TURN * p });
  gsap.set(shadeRef.value, { opacity: p * 0.4 });
}

function onDragEnd() {
  if (!drag) return;
  const p = drag.progress;
  removeDragListeners();
  drag = null;
  turning.value = true;
  if (p >= 0.3) {
    timeline = gsap.timeline({ onComplete: finishForward });
    timeline
      .to(leafRef.value, { rotateY: -MAX_TURN, duration: 0.34, ease: 'power2.out' }, 0)
      .to(shadeRef.value, { opacity: 0, duration: 0.34 }, 0.14);
  } else {
    timeline = gsap.timeline({
      onComplete: () => {
        underHtml.value = '';
        resetLeaf();
        turning.value = false;
        timeline = null;
      },
    });
    timeline
      .to(leafRef.value, { rotateY: 0, duration: 0.28, ease: 'power2.out' }, 0)
      .to(shadeRef.value, { opacity: 0, duration: 0.28 }, 0);
  }
}

function onDragCancel() {
  if (!drag) return;
  removeDragListeners();
  drag = null;
  turning.value = true;
  timeline = gsap.timeline({
    onComplete: () => {
      underHtml.value = '';
      resetLeaf();
      turning.value = false;
      timeline = null;
    },
  });
  timeline
    .to(leafRef.value, { rotateY: 0, duration: 0.25, ease: 'power2.out' }, 0)
    .to(shadeRef.value, { opacity: 0, duration: 0.25 }, 0);
}

// ---- 换篇：页数组变了一律回到第 0 页 ----
watch(() => props.pages, (pages) => {
  kill();
  index.value = 0;
  leafHtml.value = pages[0] || '';
  underHtml.value = '';
  turning.value = false;
  nextTick(resetLeaf);
}, { immediate: true });

onMounted(() => resetLeaf());

onBeforeUnmount(() => {
  kill();
  if (leafRef.value) gsap.killTweensOf(leafRef.value);
  if (shadeRef.value) gsap.killTweensOf(shadeRef.value);
});
</script>

<template>
  <div class="bd-book">
    <div ref="paperRef" class="bd-book__paper">
      <div class="bd-book__under" aria-hidden="true">
        <div class="bd-book__content blog-detail-content" v-html="underHtml"></div>
      </div>

      <div ref="leafRef" class="bd-book__leaf">
        <div class="bd-book__content blog-detail-content" v-html="leafHtml"></div>
      </div>

      <div ref="shadeRef" class="bd-book__shade" aria-hidden="true"></div>
      <div class="bd-book__gutter" aria-hidden="true"></div>
      <div class="bd-book__stamp" aria-hidden="true">{{ pad(index + 1) }} <i>/</i> {{ pad(total) }}</div>
      <div class="bd-book__drag" aria-hidden="true" @pointerdown="onDragStart"></div>
    </div>

    <div class="bd-book__bar">
      <button
        type="button"
        class="bd-book__btn"
        :disabled="!hasPrev || turning"
        @click="turn(-1)"
      >← Prev</button>
      <div class="bd-book__progress" aria-hidden="true">
        <i :style="{ width: total ? ((index + 1) / total * 100) + '%' : '0%' }"></i>
      </div>
      <button
        type="button"
        class="bd-book__btn"
        :disabled="!hasNext || turning"
        @click="turn(1)"
      >Next →</button>
    </div>
  </div>
</template>

<style scoped>
.bd-book {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 一页纸：1px 书框 + 左书脊；透视挂在纸上，翻页时纸才有厚度 */
.bd-book__paper {
  position: relative;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  background: var(--bg);
  overflow: hidden;
  perspective: 1600px;
}

.bd-book__under,
.bd-book__leaf {
  position: absolute;
  inset: 0;
  background: var(--bg);
}

.bd-book__under { z-index: 1; }

/* 当前页：绕左边缘（书脊）转；转过 90° 后背面不可见，像真的翻过去 */
.bd-book__leaf {
  z-index: 4;
  transform-origin: left center;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  will-change: transform;
  box-shadow:
    1px 0 0 var(--border),
    10px 0 26px color-mix(in srgb, var(--text-primary) 9%, transparent);
}

.bd-book__content {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 30px 34px 46px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.bd-book__content::-webkit-scrollbar { display: none; }
/* 底下那张只是翻页途中露出来，不参与滚动 */
.bd-book__under .bd-book__content { overflow: hidden; }

/* 翻页时压在被翻出来的那一页上的阴影 */
.bd-book__shade {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  opacity: 0;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--text-primary) 28%, transparent),
    transparent 68%
  );
}

/* 左书脊：一条极淡的暗部，让页面看起来是"装订在左边"的 */
.bd-book__gutter {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 5;
  width: 10px;
  pointer-events: none;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--text-primary) 12%, transparent),
    transparent
  );
  opacity: 0.55;
}

.bd-book__stamp {
  position: absolute;
  right: 14px;
  bottom: 10px;
  z-index: 6;
  font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
  font-size: 0.55rem;
  letter-spacing: 0.12em;
  color: var(--text-secondary);
  pointer-events: none;
  user-select: none;
}
.bd-book__stamp i { font-style: normal; opacity: 0.45; margin: 0 2px; }

/* 右边缘手势条：鼠标在这里按住左拖就能把纸拉起来 */
.bd-book__drag {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 7;
  width: 30px;
  cursor: grab;
}
.bd-book__drag::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 10px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--text-primary) 9%, transparent));
  opacity: 0.45;
  transition: opacity 0.2s ease;
}
.bd-book__drag:hover::after { opacity: 0.9; }
.bd-book__drag:active { cursor: grabbing; }

.bd-book__bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 14px;
}

.bd-book__btn {
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid var(--text-primary);
  border-radius: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
  font-size: 0.58rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background-color 0.18s ease, color 0.18s ease, opacity 0.18s ease;
}
.bd-book__btn:hover:not(:disabled) { background: var(--text-primary); color: var(--bg); }
.bd-book__btn:disabled { opacity: 0.35; cursor: not-allowed; }

.bd-book__progress {
  position: relative;
  flex: 1;
  height: 1px;
  background: var(--border);
}
.bd-book__progress i {
  position: absolute;
  left: 0;
  top: 0;
  height: 1px;
  background: var(--text-primary);
  transition: width 0.45s cubic-bezier(0.19, 1, 0.22, 1);
}

@media (hover: none) {
  .bd-book__btn { min-height: 44px; }
}

@media (prefers-reduced-motion: reduce) {
  .bd-book__progress i { transition: none; }
  .bd-book__leaf { will-change: auto; }
}
</style>
