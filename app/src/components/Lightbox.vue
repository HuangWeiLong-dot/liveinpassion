<script setup>
// 主灯箱（旧 index.html L5466-L5474 的标记 + L7702-L7749 的逻辑）。
// 打开方式变了：旧版靠模块级的 currentGalleryData/currentIndex，新版由调用方
// 传列表与起始索引（useLightbox.open(list, index)），不再有隐式全局状态。
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useLightbox } from '../composables/useLightbox.js';
import { flyPhoto, photoTargetRect, rectOf } from '../composables/usePhotoFlight.js';

const { isOpen, currentSrc, origin, resolve, close, prev, next, onImageSettled } = useLightbox();
const imgEl = ref(null);

// 打开：照片从点击的窗口飞到大图位置（参照 wndws.space）
watch(isOpen, async (open) => {
  if (!open) return;
  await nextTick();
  const img = imgEl.value;
  const from = origin.value;
  if (!img || !from?.rect) return;
  const aspect = from.aspect
    || (img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0)
    || from.rect.width / from.rect.height;
  const to = photoTargetRect(aspect);
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
      // 克隆还在时就先把大图切成可见，避免交接那一帧闪黑
      img.style.transition = 'none';
      img.style.opacity = '1';
      requestAnimationFrame(() => { img.style.transition = ''; });
    },
  });
});

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

onMounted(() => document.addEventListener('keydown', onKeydown));
onUnmounted(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="lightbox" id="lightbox" :class="{ active: isOpen }">
    <div class="lightbox-bg" id="lightboxBg" @click="closeWithFlight"></div>
    <div class="lightbox-nav lightbox-prev" id="lightboxPrev" @click="prev"></div>
    <div class="lightbox-nav lightbox-next" id="lightboxNext" @click="next"></div>
    <div class="lightbox-content">
      <!-- 空 src 会解析成文档自身地址，未打开时不写 src 属性 -->
      <img ref="imgEl" :src="currentSrc ? resolve(currentSrc) : null" alt="Lightbox Image" id="lightboxImg" @load="onImageSettled" @error="onImageSettled">
      <div class="lightbox-close-area" id="lightboxCloseArea" @click="closeWithFlight"></div>
    </div>
  </div>
</template>
