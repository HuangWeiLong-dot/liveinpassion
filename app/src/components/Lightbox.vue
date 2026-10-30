<script setup>
// 主灯箱（旧 index.html L5466-L5474 的标记 + L7702-L7749 的逻辑）。
// 打开方式变了：旧版靠模块级的 currentGalleryData/currentIndex，新版由调用方
// 传列表与起始索引（useLightbox.open(list, index)），不再有隐式全局状态。
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useLightbox } from '../composables/useLightbox.js';
import { flyPhoto, photoTargetRect, rectOf } from '../composables/usePhotoFlight.js';
import { attachCardTilt, playGlitchReveal } from '../composables/useCardFx.js';
import { photoDate } from '../data/photoUtils.js';

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
// 正在播"窗口 → 大图"的飞行动画：这期间的 load 不触发抖色揭示，
// 等飞完落定再来一次，才看得见（否则会被飞行的克隆盖住）。
let opening = false;
let detachTilt = null;

// ── 详情舞台 ────────────────────────────────────────────────────────────
// 舞台的宽高由照片比例算出来（而不是让 <img> 自己撑开）：
// 打开时的飞行落点、骨架屏、大图全都用同一个矩形，切换照片时不会跳版。
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
    // 关闭时留下的行内 opacity:0 要清掉，否则 .is-loaded 也压不过它
    img.style.opacity = '';
    loaded.value = true;
    failed.value = false;
    onImageSettled();
    // 切换照片（← →）没有飞行，解码完成立刻来一次抖色揭示
    if (!opening) playGlitchReveal(img, stageEl.value);
  };
  // decode() 把解码移出主线程，避免切换照片时主线程被大图解码卡住
  if (typeof img.decode === 'function') img.decode().then(apply).catch(apply);
  else apply();
}

function handleError() {
  loaded.value = false;
  failed.value = true;
  opening = false;
  onImageSettled();
}

// 打开：照片从点击的窗口飞到大图位置（参照 wndws.space）
watch(isOpen, async (open) => {
  if (!open) { opening = false; return; }
  opening = true;
  loaded.value = false;
  failed.value = false;
  await nextTick();
  settleIfCached();
  probeAspect(currentSrc.value);
  const img = imgEl.value;
  if (img) img.style.opacity = '';
  const from = origin.value;
  if (!img || !from?.rect) { opening = false; return; }
  const a = from.aspect
    || (img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0)
    || from.rect.width / from.rect.height;
  if (a > 0) aspect.value = a;
  // 落点必须和舞台尺寸一致（0.9 / 0.86 / 底部让位）
  const to = photoTargetRect(a, 0.9, 0.86, reserve.value);
  img.style.opacity = '0';
  flyPhoto({
    from: from.rect,
    to,
    // 优先用来源窗口里**已经加载好**的缩略图：灯箱大图可能还在解码，
    // 用它会先出现一帧黑底
    src: from.src || img.getAttribute('src'),
    duration: 0.68,
    fromGray: true,
    toGray: false,
    onDone: () => {
      // 克隆还在时就把大图交还给 CSS（已加载则由 .is-loaded 淡入，
      // 没加载则由下面的骨架屏继续撑着，不会闪黑）
      img.style.opacity = '';
      // 落定之后再来一次抖色故障揭示：小窗长大图的那一下就是从这里接上的
      opening = false;
      playGlitchReveal(img, stageEl.value);
    },
  });
});

// 切换照片：骨架屏重新盖住舞台，新图解码完成后再淡入
watch(currentSrc, async () => {
  if (!isOpen.value) return;
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

// 关闭：大图飞回原来的窗口；背景同时开始淡出
function closeWithFlight() {
  if (!isOpen.value) return;
  const img = imgEl.value;
  const from = origin.value;
  if (!img || !from?.rect) { close(); return; }
  const start = rectOf(img);
  const src = img.currentSrc || from.src || img.getAttribute('src');
  img.style.opacity = '0';
  close();
  flyPhoto({
    from: start,
    to: from.rect,
    src,
    duration: 0.55,
    fromGray: false,
    toGray: true,
  });
}

function onKeydown(e) {
  if (!isOpen.value) return;
  if (e.key === 'Escape') closeWithFlight();
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
  <div class="lightbox" id="lightbox" ref="rootEl" :class="{ active: isOpen, 'has-strip': stripOn }">
    <div class="lightbox-bg" id="lightboxBg" @click="closeWithFlight"></div>
    <div class="lightbox-nav lightbox-prev" id="lightboxPrev" @click="prev"></div>
    <div class="lightbox-nav lightbox-next" id="lightboxNext" @click="next"></div>
    <div class="lightbox-content" :style="stageStyle">
      <div class="lightbox-stage" ref="stageEl">
        <!-- 空 src 会解析成文档自身地址，未打开时不写 src 属性 -->
        <img
          ref="imgEl"
          class="lightbox-img"
          :class="{ 'is-loaded': loaded }"
          :src="currentSrc ? resolve(currentSrc) : null"
          alt="Lightbox Image"
          id="lightboxImg"
          crossorigin="anonymous"
          @load="handleLoad"
          @error="handleError"
        >
        <!-- 大图解码完成前先盖一块 shimmer 骨架，避免切换时闪黑 -->
        <div class="lightbox-skeleton" :class="{ hidden: !showSkeleton }" aria-hidden="true"></div>
        <div class="lightbox-close-area" id="lightboxCloseArea" @click="closeWithFlight"></div>
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
