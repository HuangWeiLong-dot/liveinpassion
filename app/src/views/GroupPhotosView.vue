<script setup>
// 群组照片页（旧 index.html 的 #friend-groupphotos-page）。
//
// 根节点 id="friend-groupphotos-page" 必须保留（样式表用它覆盖 --accent-color）。
//
// 已知的内容不一致（照搬旧版，未改）：页头写死的 "26 photos" 与时间线实际用的
// groupPhotosGalleryData（32 张）不是同一份列表——26 那张是 MORE 磁贴背景池。
// 迁移期保持原样；要修的话把 count-number 绑到 32 即可（属于清理阶段的事）。
import { groupPhotosGalleryData } from '../data/galleries.js';
import PhotoTimeline from '../components/PhotoTimeline.vue';
import AppFooter from '../components/AppFooter.vue';
</script>

<template>
  <main id="friend-groupphotos-page" class="page active">
    <section class="gallery-hero">
      <div class="hero-content">
        <h1 class="hero-title">GROUP PHOTOS</h1>
        <p class="hero-subtitle">Capturing moments together</p>
        <div class="photo-count">
          <span class="count-number">26</span>
          <span class="count-label">photos</span>
        </div>
      </div>
    </section>

    <section class="gallery-timeline">
      <PhotoTimeline :photos="groupPhotosGalleryData" container-id="groupphotosGalleryGrid" />
    </section>

    <AppFooter />
  </main>
</template>
