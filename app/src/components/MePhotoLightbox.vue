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

const props = defineProps({
  visible: { type: Boolean, default: false },
  src: { type: String, default: '' },
  // 照片日期（文件名解析出来的 YYYY-MM-DD），显示在照片下方
  date: { type: String, default: '' },
});
const emit = defineEmits(['close']);

const loaded = ref(false);
const fullEl = ref(null);
const rootEl = ref(null);
// 这张图是否已经播过故障揭示（缓存命中时 load 不会再触发，需要手动补一次）
let revealedFor = '';
let detachTilt = null;

// 打开：大图直接在自己的位置上做一次故障揭示
watch(() => props.visible, async (visible) => {
  if (!visible) return;
  revealedFor = '';
  loaded.value = false;
  await nextTick();
  const img = fullEl.value;
  if (!img) return;
  // 缓存里的图不会再触发 load：直接切到已加载态并补一次揭示
  if (img.complete && img.naturalWidth) {
    loaded.value = true;
    revealIfNeeded();
  }
});

function revealIfNeeded() {
  const img = fullEl.value;
  if (!img || !img.complete || !img.naturalWidth) return;
  const key = img.getAttribute('src') || '';
  if (!key || key === revealedFor) return;
  revealedFor = key;
  playGlitchReveal(img, rootEl.value);
}

// 关闭：遮罩和大图一起淡出（CSS 的 opacity 过渡），不做飞行克隆
function requestClose() {
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
      :class="{ loaded }"
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
