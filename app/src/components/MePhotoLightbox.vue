<script setup>
// ME 相册的单图灯箱。旧版是首次点击时用 createElement 现场创建（index.html L6180-L6226），
// 新版常驻组件 + v-show（元素只创建一次，切换照片只是换 src）。
//
// 与主灯箱（Lightbox.vue）的区别，全部保留：
//   - 单图，没有左右翻页、没有键盘响应
//   - **不锁 body 滚动**
//   - 用 img.decode() 把解码移出主线程
//
// 打开不做"窗口克隆飞到屏幕中间"的过渡，也不再垫一层模糊缩略图：
// 点击之后直接就是这张图本身在自己的位置上做故障揭示。
// 关闭同样只让遮罩和大图一起淡出，不再生成一个飞回窗口的克隆。
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { attachCardTilt, playGlitchReveal } from '../composables/useCardFx.js';
import {
  animateCoverFlightTo,
  beginCoverFlight,
  getCoverFlightRect,
  hideCoverFlight,
  isCoverFlightActive,
} from '../composables/useCoverFlight.js';

const props = defineProps({
  visible: { type: Boolean, default: false },
  src: { type: String, default: '' },
  // 照片日期（文件名解析出来的 YYYY-MM-DD），显示在照片下方
  date: { type: String, default: '' },
  // 点击的那一扇窗（CoverFlight 的开/关都从它量落点）
  sourceEl: { type: Object, default: null },
});
const emit = defineEmits(['close']);

const loaded = ref(false);
const fullEl = ref(null);
const rootEl = ref(null);
// 这张图是否已经播过故障揭示（缓存命中时 load 不会再触发，需要手动补一次）
let revealedFor = '';
let detachTilt = null;

// ── CoverFlight：墙上的小图 ⇄ 灯箱大图 ────────────────────────────────────
const flightHidden = ref(false);
const flightPending = ref(false);
const closingFlight = ref(false);
const reducedMotion = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function rectOf(el) {
  const r = el?.getBoundingClientRect?.();
  return r && r.width && r.height
    ? { left: r.left, top: r.top, width: r.width, height: r.height }
    : null;
}

function sourceRectOf(el) {
  if (!el) return null;
  const img = el.matches?.('img') ? el : el.querySelector?.('img');
  return rectOf(img || el);
}

/** 飞行层落地：把大图交还给灯箱自己的 <img>；图还没解码完就多等一拍 */
function landFlight() {
  const img = fullEl.value;
  if (img && img.complete && img.naturalWidth) {
    flightHidden.value = false;
    flightPending.value = false;
    hideCoverFlight();
    loaded.value = true;
    revealIfNeeded();
    return;
  }
  flightPending.value = true;
  window.setTimeout(() => {
    if (!flightPending.value) return;
    flightPending.value = false;
    flightHidden.value = false;
    hideCoverFlight();
  }, 900);
}

// 打开：墙上的小图交给飞行层飞过来；落地同一帧再让大图显形并做故障揭示。
watch(() => props.visible, async (visible) => {
  if (!visible) {
    // 关闭飞行自己拥有飞行层，别在这里收掉
    if (closingFlight.value) return;
    if (isCoverFlightActive()) hideCoverFlight();
    flightHidden.value = false;
    flightPending.value = false;
    return;
  }

  revealedFor = '';
  loaded.value = false;
  const willFly = !reducedMotion && Boolean(props.sourceEl) && Boolean(props.src);
  flightHidden.value = willFly;
  flightPending.value = false;
  closingFlight.value = false;

  await nextTick();
  const img = fullEl.value;
  if (!img) {
    flightHidden.value = false;
    return;
  }
  // 缓存里的图不会再触发 load：文案/揭示先收尾（飞行期间揭示会被 gate 住）
  if (img.complete && img.naturalWidth) {
    loaded.value = true;
    revealIfNeeded();
  }

  if (!willFly) return;
  const srcRect = sourceRectOf(props.sourceEl);
  if (!srcRect) {
    flightHidden.value = false;
    return;
  }
  const started = beginCoverFlight({
    src: props.src,
    mode: 'enter',
    rect: srcRect,
    sourceEl: props.sourceEl,
  });
  if (!started) {
    flightHidden.value = false;
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!props.visible) return;
    const box = rectOf(fullEl.value);
    if (!box) {
      flightHidden.value = false;
      hideCoverFlight();
      return;
    }
    animateCoverFlightTo(box, {
      duration: 0.72,
      ease: 'power2.inOut',
      onComplete: landFlight,
    });
  }));
});

function revealIfNeeded() {
  const img = fullEl.value;
  if (!img || !img.complete || !img.naturalWidth) return;
  // 飞行期间大图是藏着的：揭示挪到落地那一刻再演
  if (flightHidden.value || flightPending.value) return;
  const key = img.getAttribute('src') || '';
  if (!key || key === revealedFor) return;
  revealedFor = key;
  playGlitchReveal(img, rootEl.value);
}

// 关闭：把大图交给飞行层飞回墙上那一格；遮罩与大图自己的淡出照旧
function requestClose() {
  if (!props.visible) return;

  const srcRect = sourceRectOf(props.sourceEl);
  const startRect = (isCoverFlightActive() && getCoverFlightRect()) || rectOf(fullEl.value);
  if (!reducedMotion && props.src && startRect && srcRect) {
    closingFlight.value = true;
    flightHidden.value = true;
    flightPending.value = false;
    if (!isCoverFlightActive()) {
      beginCoverFlight({
        src: props.src,
        mode: 'exit',
        rect: startRect,
        sourceEl: props.sourceEl,
      });
    }
    animateCoverFlightTo(srcRect, {
      duration: 0.72,
      ease: 'power2.inOut',
      opacity: 1,
      onComplete: () => {
        hideCoverFlight();
        closingFlight.value = false;
      },
    });
    emit('close');
    return;
  }

  if (isCoverFlightActive()) hideCoverFlight();
  flightHidden.value = false;
  flightPending.value = false;
  emit('close');
}

// 胶卷条换图：src 一变就回到未加载态，等新图解码完再揭示
watch(
  () => [props.visible, props.src],
  () => {
    if (!props.visible) return;
    revealedFor = '';
    loaded.value = false;
  },
  { immediate: true }
);

function onFullLoad(e) {
  const img = e.target;
  const show = () => {
    loaded.value = true;
    // 飞行层还在等这张图：解码完就把舞台还回来
    if (flightPending.value) {
      flightPending.value = false;
      flightHidden.value = false;
      hideCoverFlight();
    }
    revealIfNeeded();
  };
  // decode() 把大图解码移出主线程，避免点击→绘制被同步解码阻塞（INP）
  if (typeof img.decode === 'function') {
    img.decode().then(show).catch(show);
  } else {
    show();
  }
}

onMounted(() => {
  detachTilt = attachCardTilt(rootEl.value, { card: '.me-photo-lightbox-full', maxX: 6, maxY: 9 });
});

onUnmounted(() => {
  detachTilt?.();
});
</script>

<template>
  <div
    class="me-photo-lightbox"
    id="mePhotoLightbox"
    ref="rootEl"
    :class="{ active: visible }"
    @click.self="requestClose"
  >
    <span class="me-photo-lightbox-close" @click="requestClose">&times;</span>
    <!-- 关闭后的 0.4s 淡出里要留着 src：一旦在这里把它摘掉，屏幕中间
         会先闪出破图图标和 alt 文字（"Full size"），正好落在正在淡出的背景上。 -->
    <img
      ref="fullEl"
      class="me-photo-lightbox-full"
      :class="{ loaded, 'is-flight-hidden': flightHidden }"
      :src="src || null"
      alt=""
      crossorigin="anonymous"
      @load="onFullLoad"
      @error="loaded = false"
    >
    <!-- 照片下方：日期。点胶卷条换下一张时，日期也上下滚动交换（同主灯箱） -->
    <div v-if="date" class="me-photo-lightbox-meta" aria-live="polite">
      <div class="lightbox-date">
        <transition name="lb-roll">
          <span :key="date" class="lightbox-date__text">{{ date }}</span>
        </transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 飞行层接管的这段时间：灯箱大图先别露出来 */
.me-photo-lightbox-full.is-flight-hidden {
  opacity: 0 !important;
}
</style>
