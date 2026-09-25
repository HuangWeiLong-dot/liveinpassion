<script setup>
// 主灯箱（旧 index.html L5466-L5474 的标记 + L7702-L7749 的逻辑）。
// 打开方式变了：旧版靠模块级的 currentGalleryData/currentIndex，新版由调用方
// 传列表与起始索引（useLightbox.open(list, index)），不再有隐式全局状态。
import { onMounted, onUnmounted } from 'vue';
import { useLightbox } from '../composables/useLightbox.js';

const { isOpen, currentSrc, resolve, close, prev, next, onImageSettled } = useLightbox();

function onKeydown(e) {
  if (!isOpen.value) return;
  if (e.key === 'Escape') close();
  if (e.key === 'ArrowLeft') prev();
  if (e.key === 'ArrowRight') next();
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onUnmounted(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="lightbox" id="lightbox" :class="{ active: isOpen }">
    <div class="lightbox-bg" id="lightboxBg" @click="close"></div>
    <div class="lightbox-nav lightbox-prev" id="lightboxPrev" @click="prev"></div>
    <div class="lightbox-nav lightbox-next" id="lightboxNext" @click="next"></div>
    <div class="lightbox-content">
      <!-- 空 src 会解析成文档自身地址，未打开时不写 src 属性 -->
      <img :src="currentSrc ? resolve(currentSrc) : null" alt="Lightbox Image" id="lightboxImg" @load="onImageSettled" @error="onImageSettled">
      <div class="lightbox-close-area" id="lightboxCloseArea" @click="close"></div>
    </div>
  </div>
</template>
