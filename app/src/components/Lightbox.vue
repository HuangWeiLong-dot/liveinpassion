<script setup>
// 主灯箱（旧 index.html L5466-L5474 的标记 + L7702-L7749 的逻辑）。
// 打开方式变了：旧版靠模块级的 currentGalleryData/currentIndex，新版由调用方
// 传列表与起始索引（useLightbox.open(list, index)），不再有隐式全局状态。
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useLightbox } from '../composables/useLightbox.js';
import { attachCardTilt, playGlitchReveal } from '../composables/useCardFx.js';
import { photoDate } from '../data/photoUtils.js';
import {
  animateCoverFlightTo,
  beginCoverFlight,
  getCoverFlightRect,
  hideCoverFlight,
  isCoverFlightActive,
} from '../composables/useCoverFlight.js';

const {
  isOpen,
  items,
  index,
  currentItem,
  currentSrc,
  origin,
  stripVisible,
  resolve,
  close,
  prev,
  next,
  onImageSettled,
} = useLightbox();
const imgEl = ref(null);
const rootEl = ref(null);
const stageEl = ref(null);
// 这张图是否已经播过故障揭示：缓存命中时 settleIfCached() 先收尾，
// 紧接着 load 事件仍可能再来一次，不挡住就会把画布重建、揭示重播一遍。
let revealedFor = '';
let detachTilt = null;

// ── CoverFlight：缩略图 → 灯箱大图 → 缩略图 ─────────────────────────────
// 和 ECHOES 共用 body 上的那一块飞行层。打开时先把大图藏起来、让飞行层从
// 来源窗口飞过来；关闭时反过来飞回去。图始终是同一张（同一个 URL）。
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

// ── 详情舞台 ────────────────────────────────────────────────────────────
// 舞台的宽高由照片比例算出来（而不是让 <img> 自己撑开）：
// 骨架屏、大图、故障揭示画布全都用同一个矩形，切换照片时不会跳版。
const loaded = ref(false);
const failed = ref(false);
const aspect = ref(1);
const vw = ref(window.innerWidth);
const vh = ref(window.innerHeight);

// GALLERY 的底部胶卷条在详情页里仍然露着（它压在灯箱之上），
// 所以舞台要让出这条底栏：整体上移、可用高度也按让位后的算。
// 数值和 window-wall.css 的 .win-strip 高度、main.css 的 .lightbox.has-strip
// padding-bottom 保持一致（92 + 24 的缝）。
const STRIP_RESERVE = 116;

const stripOn = computed(() => stripVisible.value && vw.value > 1024);
const reserve = computed(() => (stripOn.value ? STRIP_RESERVE : 0));

const stageStyle = computed(() => {
  const a = aspect.value > 0 ? aspect.value : 1;
  const maxW = vw.value * 0.9;
  // 比 90vh 略收一点，给照片下方那行日期留出呼吸空间
  const maxH = (vh.value - reserve.value) * 0.86;
  let w = maxW;
  let h = w / a;
  if (h > maxH) {
    h = maxH;
    w = h * a;
  }
  return { width: `${w}px`, height: `${h}px` };
});

// 照片下方那行：日期（优先用条目上的 date，其次从文件名解析），没有就整行不显示
const dateLabel = computed(() => {
  const item = currentItem.value;
  if (!item) return '';
  return item.date || photoDate(item.filename) || '';
});
const rollKey = computed(() => `${index.value}|${dateLabel.value}`);
const showSkeleton = computed(() => !loaded.value && !failed.value);
const pad = (n) => String(n).padStart(2, '0');

let probeToken = 0;
function probeAspect(src) {
  if (!src) return;
  const token = ++probeToken;
  const probe = new Image();
  // 和舞台里那张 <img> 用同一个 CORS 模式：浏览器才会复用同一次下载/解码缓存，
  // 否则同一张图会被按"无 CORS"再取一遍，白多一次网络与解码。
  probe.crossOrigin = 'anonymous';
  probe.onload = () => {
    if (token !== probeToken || !probe.naturalWidth || !probe.naturalHeight) return;
    aspect.value = probe.naturalWidth / probe.naturalHeight;
  };
  probe.src = resolve(src);
}

// 缓存的图不会重新触发 load：打开同一张、或切到已缓存的图时手动收尾，
// 否则骨架屏会一直停着，useLightbox 也会一直以为在加载、锁住左右翻页。
function settleIfCached() {
  const img = imgEl.value;
  if (!img || !img.complete || !img.naturalWidth) return;
  if (img.naturalHeight) aspect.value = img.naturalWidth / img.naturalHeight;
  loaded.value = true;
  failed.value = false;
  onImageSettled();
  revealIfNeeded();
}

// 图就绪后立刻在舞台上播一次「抖色 + 逐行揭示」：
// 开图不做窗口飞行动画，点击后看到的第一帧就该是这张图自己在故障里长出来。
function revealIfNeeded() {
  const img = imgEl.value;
  if (!img || !img.complete || !img.naturalWidth) return;
  // 飞行期间舞台是空的（只有飞行层那张图）：揭示挪到落地那一刻再演
  if (flightHidden.value || flightPending.value) return;
  const key = img.getAttribute('src') || '';
  if (!key || key === revealedFor) return;
  revealedFor = key;
  playGlitchReveal(img, stageEl.value);
}

/** 飞行层落地：把大图交还给灯箱自己的 <img>；图还没解码完就多等一拍 */
function landFlight() {
  const img = imgEl.value;
  if (img && img.complete && img.naturalWidth) {
    flightHidden.value = false;
    flightPending.value = false;
    hideCoverFlight();
    if (!loaded.value) {
      loaded.value = true;
      onImageSettled();
    }
    revealIfNeeded();
    return;
  }
  // 大图还在路上：飞行层继续顶着，别让骨架屏闪一下
  flightPending.value = true;
  window.setTimeout(() => {
    if (!flightPending.value) return;
    flightPending.value = false;
    flightHidden.value = false;
    hideCoverFlight();
  }, 900);
}

function handleLoad(event) {
  const img = event.target;
  const want = resolve(currentSrc.value);
  const apply = () => {
    // load 可能晚到：确认它仍然是当前这张，否则会把上一张的比例写进来
    if (img.getAttribute('src') !== want) return;
    if (img.naturalWidth && img.naturalHeight) {
      aspect.value = img.naturalWidth / img.naturalHeight;
    }
    loaded.value = true;
    failed.value = false;
    onImageSettled();
    // 飞行层在等这张图：解码完就把舞台还回来，再演揭示
    if (flightPending.value) {
      flightPending.value = false;
      flightHidden.value = false;
      hideCoverFlight();
    }
    // 解码完成立刻来一次抖色揭示（开图和 ← → 切图都是这条路径）
    revealIfNeeded();
  };
  // decode() 把解码移出主线程，避免切换照片时主线程被大图解码卡住
  if (typeof img.decode === 'function') img.decode().then(apply).catch(apply);
  else apply();
}

function handleError() {
  loaded.value = false;
  failed.value = true;
  onImageSettled();
}

// 打开：直接让大图在灯箱舞台上做一次故障揭示。
// 不再做"窗口克隆飞到大图位置"的过渡 —— 那个克隆只是点击图的一张替代品，
// 点击之后应该看到的就是这张图本身逐渐加载出来。
watch(isOpen, async (open) => {
  if (!open) {
    // 关闭飞行自己拥有飞行层，别在这里把它收掉
    if (closingFlight.value) return;
    if (isCoverFlightActive()) hideCoverFlight();
    flightHidden.value = false;
    flightPending.value = false;
    return;
  }

  revealedFor = '';
  loaded.value = false;
  failed.value = false;
  const from = origin.value;
  const willFly = !reducedMotion && Boolean(from?.rect) && Boolean(currentSrc.value);
  flightHidden.value = willFly;
  flightPending.value = false;
  closingFlight.value = false;

  await nextTick();
  settleIfCached();
  probeAspect(currentSrc.value);
  const img = imgEl.value;
  if (!img) {
    flightHidden.value = false;
    hideCoverFlight();
    return;
  }
  // 先按来源窗口里那张图的比例把舞台撑好，故障揭示才有正确的尺寸；
  // 大图解码完成后再由 handleLoad 用真实比例校正
  const a = from?.aspect
    || (img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0)
    || (from?.rect ? from.rect.width / from.rect.height : 0);
  if (a > 0) aspect.value = a;

  if (!willFly) return;

  // 从来源窗口飞到大图舞台。大图自己的 <img> 先藏着（flightHidden），
  // 落地同一帧再交还 —— 中间不存在第二个元素换手。
  const started = beginCoverFlight({
    src: resolve(currentSrc.value),
    mode: 'enter',
    rect: from.rect,
    sourceEl: from.sourceEl || null,
  });
  if (!started) {
    flightHidden.value = false;
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!isOpen.value) return;
    const box = rectOf(stageEl.value);
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

// 切换照片：骨架屏重新盖住舞台，新图解码完成后再淡入并重新揭示
watch(currentSrc, async () => {
  if (!isOpen.value) return;
  revealedFor = '';
  loaded.value = false;
  failed.value = false;
  await nextTick();
  settleIfCached();
  probeAspect(currentSrc.value);
});

function onResize() {
  vw.value = window.innerWidth;
  vh.value = window.innerHeight;
}

// 关闭：整块灯箱（遮罩 + 大图）一起淡出。
// 不再生成"飞回原来那扇窗"的克隆：大图先被瞬间藏掉、再让一个带描边的
// 替代品飞回去，看起来就是闪一下；和开图那边一致地只做淡出才顺。
function requestClose() {
  if (!isOpen.value) return;

  // 有关闭飞行：从大图舞台飞回来源窗口。来源窗口现场量 —— 筛选、华容道
  // 位移、窗口 resize 之后它的位置都可能和打开时不同。
  const from = origin.value;
  if (!reducedMotion && from?.rect && currentSrc.value) {
    const starting = (isCoverFlightActive() && getCoverFlightRect())
      || rectOf(stageEl.value)
      || rectOf(imgEl.value);
    const src = resolve(currentSrc.value);
    if (starting && src) {
      closingFlight.value = true;
      flightHidden.value = true;
      flightPending.value = false;
      if (!isCoverFlightActive()) {
        beginCoverFlight({
          src,
          mode: 'exit',
          rect: starting,
          sourceEl: from.sourceEl || null,
        });
      }
      const target = sourceRectOf(from.sourceEl) || from.rect;
      animateCoverFlightTo(target, {
        duration: 0.72,
        ease: 'power2.inOut',
        opacity: 1,
        onComplete: () => {
          hideCoverFlight();
          closingFlight.value = false;
        },
      });
      // 遮罩和大图一起淡出；飞行层始终压在它们上面
      close();
      return;
    }
  }

  if (isCoverFlightActive()) hideCoverFlight();
  flightHidden.value = false;
  flightPending.value = false;
  close();
}

function onKeydown(e) {
  if (!isOpen.value) return;
  if (e.key === 'Escape') requestClose();
  if (e.key === 'ArrowLeft') prev();
  if (e.key === 'ArrowRight') next();
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', onResize);
  // 大图随指针轻微倾斜（角度变量写在 .lightbox-content 上）
  detachTilt = attachCardTilt(rootEl.value, { card: '.lightbox-content', maxX: 5, maxY: 8 });
});
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', onResize);
  detachTilt?.();
});
</script>

<template>
  <div
    class="lightbox"
    id="lightbox"
    ref="rootEl"
    :class="{ active: isOpen, 'has-strip': stripOn, 'is-flight': flightHidden }"
  >
    <div class="lightbox-bg" id="lightboxBg" @click="requestClose"></div>
    <div class="lightbox-nav lightbox-prev" id="lightboxPrev" @click="prev"></div>
    <div class="lightbox-nav lightbox-next" id="lightboxNext" @click="next"></div>
    <div class="lightbox-content" :style="stageStyle">
      <div class="lightbox-stage" ref="stageEl">
        <!-- 空 src 会解析成文档自身地址，未打开时不写 src 属性 -->
        <img
          ref="imgEl"
          class="lightbox-img"
          :class="{ 'is-loaded': loaded, 'is-flight-hidden': flightHidden }"
          :src="currentSrc ? resolve(currentSrc) : null"
          alt="Lightbox Image"
          id="lightboxImg"
          crossorigin="anonymous"
          @load="handleLoad"
          @error="handleError"
        >
        <!-- 大图解码完成前先盖一块 shimmer 骨架，避免切换时闪黑 -->
        <div class="lightbox-skeleton" :class="{ hidden: !showSkeleton }" aria-hidden="true"></div>
        <div class="lightbox-close-area" id="lightboxCloseArea" @click="requestClose"></div>
      </div>

      <!-- 照片下方：日期 + 位置。日期切换时上下滚动交换（参照 oumahi.art） -->
      <div v-if="dateLabel" class="lightbox-meta" aria-live="polite">
        <div class="lightbox-date">
          <transition name="lb-roll">
            <span :key="rollKey" class="lightbox-date__text">{{ dateLabel }}</span>
          </transition>
        </div>
        <span v-if="items.length > 1" class="lightbox-count">
          {{ pad(index + 1) }} / {{ pad(items.length) }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 飞行层接管的这段时间：舞台上的大图和骨架都先别露出来 */
.lightbox-img.is-flight-hidden {
  opacity: 0 !important;
}

.lightbox.is-flight .lightbox-skeleton {
  opacity: 0 !important;
}
</style>
