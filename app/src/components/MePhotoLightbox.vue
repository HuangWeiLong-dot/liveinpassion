<script setup>
// ME 相册的单图灯箱。旧版是首次点击时用 createElement 现场创建（index.html L6180-L6226），
// 新版常驻组件 + v-show（元素只创建一次，切换照片只是换 src）。
//
// 与主灯箱（Lightbox.vue）的区别，全部保留：
//   - 单图，没有左右翻页、没有键盘响应
//   - **不锁 body 滚动**
//   - 原图就绪前先显示压缩图占位（与网格同源，通常已在 HTTP 缓存里，近乎即时），
//     且用 img.decode() 把解码移出主线程
//   - 原图失败时保留压缩图占位当兜底
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { flyPhoto, photoTargetRect, rectOf } from '../composables/usePhotoFlight.js';
import { attachCardTilt, playGlitchReveal } from '../composables/useCardFx.js';

const props = defineProps({
  visible: { type: Boolean, default: false },
  src: { type: String, default: '' },
  thumb: { type: String, default: '' },
  // 照片日期（文件名解析出来的 YYYY-MM-DD），显示在照片下方
  date: { type: String, default: '' },
  // 底部胶卷条要让出的高度；落点必须和 CSS 的让位一致，否则飞行会落偏
  reserve: { type: Number, default: 0 },
  // 打开它的那扇窗：{ rect, src, aspect }
  origin: { type: Object, default: null },
});
const emit = defineEmits(['close']);

const loaded = ref(false);
const thumbActive = ref(false);
const fullEl = ref(null);
const rootEl = ref(null);
const leaving = ref(false);
let closing = false;
// 正在播开图飞行：这期间的 load 不揭示，等落定再补一次
let opening = false;
let detachTilt = null;

// 打开：照片从窗口飞到大图位置（参照 wndws.space）
watch(() => props.visible, async (visible) => {
  if (!visible) { opening = false; return; }
  opening = true;
  leaving.value = false;
  await nextTick();
  const img = fullEl.value;
  const o = props.origin;
  if (!img || !o?.rect) { opening = false; return; }
  // 缓存里的图不会再触发 load：这里先把模糊占位收掉，否则那块 blur(20px)
  // 的缩略图会一直垫在大图底下，看起来就是屏幕中间一团虚影
  if (img.complete && img.naturalWidth) {
    loaded.value = true;
    thumbActive.value = false;
  }
  const aspect = o.aspect
    || (img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0)
    || o.rect.width / o.rect.height;
  const to = photoTargetRect(aspect, 0.9, 0.9, props.reserve);
  img.style.opacity = '0';
  flyPhoto({
    from: o.rect,
    to,
    // 优先用窗口里已加载的缩略图，避免大图未解码时出现一帧黑底
    src: o.src || img.getAttribute('src'),
    duration: 0.68,
    fromGray: true,
    toGray: false,
    onDone: () => {
      // 克隆还在时先让大图可见（没加载完也没关系，后面的模糊缩略图还在）
      img.style.transition = 'none';
      img.style.opacity = '1';
      requestAnimationFrame(() => { img.style.transition = ''; });
      // 落定之后做一次抖色故障揭示，接上"小图长大图"的那一下
      opening = false;
      playGlitchReveal(img, rootEl.value);
    },
  });
});

// 关闭：大图飞回窗口，遮罩同时淡出
function requestClose() {
  if (closing) return;
  const img = fullEl.value;
  const o = props.origin;
  if (!img || !o?.rect) { emit('close'); return; }
  closing = true;
  const from = rectOf(img);
  const src = img.currentSrc || o.src || img.getAttribute('src');
  img.style.opacity = '0';
  leaving.value = true;
  flyPhoto({
    from,
    to: o.rect,
    src,
    duration: 0.55,
    fromGray: false,
    toGray: true,
    onDone: () => {
      closing = false;
      leaving.value = false;
      emit('close');
    },
  });
}

watch(
  () => [props.visible, props.src],
  () => {
    if (!props.visible) return;
    loaded.value = false;
    thumbActive.value = !!props.thumb;
  },
  { immediate: true }
);

// 缩略图是异步生成的：它晚于 open() 到达时也要接住，否则模糊占位永远不出现
watch(
  () => props.thumb,
  (thumb) => {
    if (!props.visible || !thumb) return;
    if (!loaded.value) thumbActive.value = true;
  }
);

function onFullLoad(e) {
  const img = e.target;
  const show = () => {
    loaded.value = true;
    thumbActive.value = false;
    // 胶卷条切换照片时没有飞行，解码完成直接来一次抖色揭示
    if (!opening) playGlitchReveal(img, rootEl.value);
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
    :class="{ active: visible, leaving }"
    @click.self="requestClose"
  >
    <span class="me-photo-lightbox-close" @click="requestClose">&times;</span>
    <img class="me-photo-lightbox-thumb" :class="{ active: thumbActive }" :src="thumbActive ? thumb : null" alt="">
    <img
      ref="fullEl"
      class="me-photo-lightbox-full"
      :class="{ loaded }"
      :src="visible ? src : null"
      alt="Full size"
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
