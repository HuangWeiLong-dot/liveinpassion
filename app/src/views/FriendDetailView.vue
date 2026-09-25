<script setup>
// 好友详情（旧 index.html 的共用模板 #friend-detail-page + navigateTo 里的重填逻辑）。
//
// 关键点：**所有好友共用同一个视图实例**（KeepAlive 缓存），切换好友只换内容、不替换
// 时间线容器——旧版也是往同一个容器里重填。所以这里用 computed 跟着 route.params.id 走，
// 而不是给 <router-view> 按 id 加 key（那会缓存 7 个实例）。
//
// 根节点的 id="friend-detail-page" 必须保留：样式表用它覆盖 --accent-color。
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { friendById } from '../data/friends.js';
import PhotoTimeline from '../components/PhotoTimeline.vue';
import AppFooter from '../components/AppFooter.vue';

const route = useRoute();
const friend = computed(() => friendById[route.params.id] || null);
const title = computed(() => (friend.value ? friend.value.titleName : 'NOT FOUND'));
const photos = computed(() => (friend.value ? friend.value.photos : []));
</script>

<template>
  <main id="friend-detail-page" class="page active">
    <!-- 注意旧版这里的标记里有个多余的 </div>，浏览器把它丢弃了，实际 DOM 中
         没有 .hero-content 包裹（与群组照片页不同）。所以这里也不加包裹层。 -->
    <section class="gallery-hero">
      <h1 class="hero-title" id="friendDetailTitle">{{ title }}</h1>
      <p class="hero-subtitle" id="friendDetailSubtitle">
        <template v-if="friend">Personal gallery</template>
        <template v-else>没有这位：{{ route.params.id }} · <router-link to="/gallery">← 回到 GALLERY</router-link></template>
      </p>
      <div class="photo-count" id="friendDetailPhotoCount">
        <span class="count-number">{{ photos.length }}</span>
        <span class="count-label">photos</span>
      </div>
    </section>

    <section class="gallery-timeline">
      <PhotoTimeline :photos="photos" container-id="friendDetailGallery" />
    </section>

    <AppFooter />
  </main>
</template>
