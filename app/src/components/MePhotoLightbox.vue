<script setup>
// ME 相册的单图灯箱。旧版是首次点击时用 createElement 现场创建（index.html L6180-L6226），
// 新版常驻组件 + v-show（元素只创建一次，切换照片只是换 src）。
//
// 与主灯箱（Lightbox.vue）的区别，全部保留：
//   - 单图，没有左右翻页、没有键盘响应
//   - **不锁 body 滚动**
//   - 原图就绪前先显示一张模糊缩略图占位，且用 img.decode() 把解码移出主线程
//   - 原图失败时保留模糊占位当兜底
// 缩略图与网格里显示的是同一张图（单级加载后网格里就是原图），所以实际效果是即时显示。
import { ref, watch } from 'vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
  src: { type: String, default: '' },
  thumb: { type: String, default: '' },
});
const emit = defineEmits(['close']);

const loaded = ref(false);
const thumbActive = ref(false);

watch(
  () => [props.visible, props.src],
  () => {
    if (!props.visible) return;
    loaded.value = false;
    thumbActive.value = !!props.thumb;
  },
  { immediate: true }
);

function onFullLoad(e) {
  const img = e.target;
  const show = () => {
    loaded.value = true;
    thumbActive.value = false;
  };
  // decode() 把大图解码移出主线程，避免点击→绘制被同步解码阻塞（INP）
  if (typeof img.decode === 'function') {
    img.decode().then(show).catch(show);
  } else {
    show();
  }
}
</script>

<template>
  <div class="me-photo-lightbox" id="mePhotoLightbox" :class="{ active: visible }" @click.self="emit('close')">
    <span class="me-photo-lightbox-close" @click="emit('close')">&times;</span>
    <img class="me-photo-lightbox-thumb" :class="{ active: thumbActive }" :src="thumbActive ? thumb : null" alt="">
    <img
      class="me-photo-lightbox-full"
      :class="{ loaded }"
      :src="visible ? src : null"
      alt="Full size"
      @load="onFullLoad"
      @error="loaded = false"
    >
  </div>
</template>
