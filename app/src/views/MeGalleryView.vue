<script setup>
// ME 相册页（旧 index.html 的 #me-gallery-page + populateMeGalleryGrid/loadMonthPhotos）。
// 页面标记：标题 + 副标题 + 月份标签 + 网格，没有页脚（与旧版一致）。
//
// 图片加载：单级 + **按可见性加载**（observeLazyImages）。旧版这里是一句
// "分批直接调用 loadImage，不依赖 IntersectionObserver"的注释，原因是当时网格是在
// display:none 的页面里构建的，observer 不会触发；新版网格是在页面可见时挂载/切换的，
// 因此可以用可见性门控，长月份（最多几十张）能省掉大量看不见的请求。
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { CDN_BASE } from '../data/cdn.js';
import { observeLazyImages } from '../composables/useLazyImages.js';
import { extractDateFromFilename, useMeGallery } from '../composables/useMeGallery.js';
import MeGalleryMonths from '../components/MeGalleryMonths.vue';
import MePhotoLightbox from '../components/MePhotoLightbox.vue';

const { monthGroups, monthKeys, activeMonth, photosOfMonth } = useMeGallery();

const items = computed(() =>
  photosOfMonth(activeMonth.value).map((filename) => ({
    filename,
    date: extractDateFromFilename(filename),
    full: `${CDN_BASE}/Me/${filename}`,
  }))
);

let observer = null;
function observeItems() {
  if (observer) observer.disconnect();
  // 等 DOM 更新完再观察，否则查不到新渲染出来的项
  nextTick(() => {
    observer = observeLazyImages('.me-gallery-item');
  });
}

onMounted(observeItems);
watch(activeMonth, observeItems);

// 单图灯箱
const lightboxOpen = ref(false);
const lightboxSrc = ref('');
function openPhoto(item) {
  lightboxSrc.value = item.full;
  lightboxOpen.value = true;
}
</script>

<template>
  <main class="page active">
    <div class="gallery-page-body">
      <h1 class="gallery-title">MY GALLERY</h1>
      <p class="gallery-subtitle">A collection of personal moments</p>

      <MeGalleryMonths
        :month-keys="monthKeys"
        :month-groups="monthGroups"
        :active="activeMonth"
        @select="activeMonth = $event"
      />

      <div class="me-gallery-grid" id="meGalleryGrid">
        <div v-for="item in items" :key="item.filename" class="me-gallery-item" @click="openPhoto(item)">
          <div class="skeleton-loader"></div>
          <div class="me-gallery-date">{{ item.date }}</div>
          <!-- 单级加载：只给原图；日期角标与文件名 alt 与旧版一致 -->
          <img :data-full-src="item.full" :alt="item.filename" class="blur-placeholder">
        </div>
      </div>
    </div>

    <MePhotoLightbox
      :visible="lightboxOpen"
      :src="lightboxSrc"
      :thumb="lightboxSrc"
      @close="lightboxOpen = false"
    />
  </main>
</template>
