<script setup>
// 博客卡片（旧 index.html L4896-L4954 的 .blog-card，共 5 张）。
// 仍用 <article> 而不是 <router-link>：样式是按 class 写的，而且旧版把点击绑在 article 上。
// 图片元素只挂静态 class，加载由 loadImage 命令式驱动。
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { loadImage } from '../composables/useImageLoader.js';

const props = defineProps({
  post: { type: Object, required: true },
});

const router = useRouter();
const imgRef = ref(null);

onMounted(() => loadImage(imgRef.value));

function open() {
  router.push(`/blogs/${props.post.slug}`);
}
</script>

<template>
  <article class="blog-card" @click="open">
    <div class="blog-card-image">
      <div class="skeleton-loader"></div>
      <img ref="imgRef" :data-full-src="post.image.fullSrc" alt="Blog Featured Image" class="blur-placeholder">
    </div>
    <div class="blog-card-overlay">
      <span class="blog-card-date">{{ post.cardDate }}</span>
      <h3 class="blog-card-title">{{ post.cardTitle }}</h3>
      <span class="blog-card-read">READ</span>
    </div>
  </article>
</template>
