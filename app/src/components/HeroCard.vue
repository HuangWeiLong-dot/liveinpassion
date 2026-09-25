<script setup>
// 首页 hero（旧 index.html L4853-L4874 的标记 + L7169-L7244 的加载逻辑）。
// 图片走 hero 专用的两阶段加载（见 useImageLoader.loadHeroImage），
// 旧版那套轮播状态机因为标记里只有一张 .hero-img 而空转，按决定不迁移。
import { onMounted, ref } from 'vue';
import { CDN_BASE } from '../data/cdn.js';
import { loadHeroImage } from '../composables/useImageLoader.js';

// 单级加载：只用原图，不再准备压缩图地址
const HERO_FULL = `${CDN_BASE}/hero_photos/1.jpg`;

const imgRef = ref(null);
const skeletonRef = ref(null);

onMounted(() => loadHeroImage(imgRef.value, skeletonRef.value));
</script>

<template>
  <section class="hero">
    <h1>LIVE IN PASSION</h1>
    <p>Carpe diem.</p>
    <p>Seize the day.</p>
    <p>Make your lives extraordinary.</p>
    <div class="hero-flip-card">
      <div class="hero-flip-inner">
        <div class="hero-flip-front">
          <!-- 这个 <img> 由 hero 加载器命令式驱动，所以只有静态 class，不能挂绑定 -->
          <div class="hero-image">
            <div class="skeleton-loader" ref="skeletonRef"></div>
            <img
              ref="imgRef"
              decoding="async"
              :data-full-src="HERO_FULL"
              alt="Hero Image"
              class="hero-img"
            >
          </div>
        </div>
        <div class="hero-flip-back">
          <div class="hero-flip-text">
            <p>Be Brave.</p>
            <p>Be Genuine.</p>
            <p>Be Humble.</p>
            <p>And Don't Be A Dick.</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
