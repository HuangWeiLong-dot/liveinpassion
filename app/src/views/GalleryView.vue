<script setup>
// GALLERY 页（旧 index.html 的 #gallery-page）：群组精选大图 + 好友跑马灯。
//
// 精选图是 5 张写死的群组照片（旧标记里的 202605_{0,4,8,12,16}），每 5 秒轮换一次 .active，
// 且**只在第 0 张加载完成后才开始轮换**（旧版靠 groupFeaturedRotationStarted 控制），
// 轮换时也只跳到"已经加载好"的下一张。
//
// 与旧版差异：旧版是"压缩图探到之后再取原图"的两级；这里单级，直接加载原图。
// 这 5 张不在 .gallery-item / .timeline-photo-item 里，也不走 loadImage，
// 所以可以安全地用响应式 class 绑定（不会和图片管线的命令式类名打架）。
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { CDN_BASE } from '../data/cdn.js';
import FriendMarquee from '../components/FriendMarquee.vue';

const router = useRouter();

const featured = [0, 4, 8, 12, 16].map((n) => ({
  full: `${CDN_BASE}/group_photos/202605_${n}.jpg`,
}));

const loaded = ref(featured.map(() => false));
const activeIndex = ref(0);
const skeletonHidden = ref(false);
let rotationStarted = false;
let timer = null;

onMounted(() => {
  featured.forEach((item, index) => {
    const probe = new Image();
    probe.onload = () => {
      loaded.value[index] = true;
      if (index === 0) {
        activeIndex.value = 0;
        skeletonHidden.value = true;
        rotationStarted = true;
      }
    };
    probe.onerror = () => {
      // 旧版失败时回退到压缩图；单级加载下没有可回退的来源，保持未加载
    };
    probe.src = item.full;
  });

  timer = setInterval(() => {
    if (!rotationStarted) return;
    const next = (activeIndex.value + 1) % featured.length;
    if (loaded.value[next]) activeIndex.value = next;
  }, 5000);
});

onUnmounted(() => clearInterval(timer));
</script>

<template>
  <main class="page active">
    <div class="gallery-page-body">
      <h1 class="gallery-title">GALLERY</h1>
      <p class="gallery-subtitle">A collection of moments captured through time</p>

      <div class="gallery-featured">
        <div class="gallery-featured-large" @click="router.push('/group-photos')">
          <div class="gallery-featured-image" style="position: relative;">
            <div class="skeleton-loader" :class="{ hidden: skeletonHidden }"></div>
            <img
              v-for="(item, index) in featured"
              :key="item.full"
              :src="loaded[index] ? item.full : null"
              :class="{ 'group-featured-img': true, active: index === activeIndex, loaded: loaded[index] }"
              alt="Group Photos"
            >
          </div>
          <div class="gallery-featured-overlay">
            <h3>GROUP PHOTOS</h3>
            <!-- 与旧版一致：这里写死 26（时间线实际是 32 张，见 GroupPhotosView 的说明） -->
            <span class="gallery-featured-count">26 photos</span>
          </div>
        </div>
      </div>

      <FriendMarquee />
    </div>
  </main>
</template>
