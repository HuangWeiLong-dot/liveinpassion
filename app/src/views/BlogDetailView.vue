<script setup>
// 博客详情（旧 index.html 里 5 个独立的 <main id="blog-detail-N-page">，形制完全相同）。
// 现在是同一个视图按 slug 渲染，所以：
//   - KeepAlive 会复用同一个实例，slug 变化时题图必须重新加载，因此图片容器按 slug 加 key，
//     强制 Vue 重建 <img>（否则 loadImage 会因为 .loaded 的守卫直接跳过）
//   - 卡片标题与详情标题在原文里不一致（如第 3 篇），所以数据里 cardTitle / title 分开存
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { blogBySlug } from '../data/blogPosts.js';
import { loadImage } from '../composables/useImageLoader.js';
import AppFooter from '../components/AppFooter.vue';

const route = useRoute();
const post = computed(() => blogBySlug[route.params.slug] || null);
const imgRef = ref(null);

function loadFeatured() {
  if (imgRef.value) loadImage(imgRef.value);
}

onMounted(loadFeatured);
watch(
  () => route.params.slug,
  async () => {
    await nextTick(); // 等新元素渲染出来再加载
    loadFeatured();
  }
);
</script>

<template>
  <main class="page active">
    <section v-if="post" class="blog-detail">
      <div class="blog-meta">
        <span class="blog-date">{{ post.date }}</span>
        <span>·</span>
        <span>{{ post.readTime }}</span>
      </div>
      <h1 class="blog-detail-title">{{ post.title }}</h1>

      <!-- key 用 slug：换文章时重建 img 与骨架屏，避免复用带 .loaded 的旧元素 -->
      <div :key="post.slug" class="blog-featured-image" style="position: relative;">
        <div class="skeleton-loader"></div>
        <img ref="imgRef" :data-full-src="post.image.fullSrc" alt="Featured Image" class="blur-placeholder">
      </div>

      <!-- 正文是作者自己写的 HTML（从旧标记逐字提取），用 v-html 输出 -->
      <div class="blog-detail-content" v-html="post.body"></div>
    </section>

    <section v-else class="blog-detail">
      <h1 class="blog-detail-title">POST NOT FOUND</h1>
      <div class="blog-detail-content">
        <p>没有这篇：{{ route.params.slug }}</p>
        <p><router-link to="/blogs">← 回到 BLOGS</router-link></p>
      </div>
    </section>

    <AppFooter />
  </main>
</template>
