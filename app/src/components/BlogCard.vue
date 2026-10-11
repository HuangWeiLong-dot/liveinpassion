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

// ⚠ 不能叫 open：模板里 `@click="open"` 会解析成全局 window.open，
// 点下去只是调用了一个空窗口，页面不跳也不报错。见 views/BlogsView.vue 同类注释。
function openPost() {
  router.push(`/blogs/${props.post.slug}`);
}
</script>

<template>
  <article class="blog-card" @click="openPost">
    <div class="blog-card-image">
      <div class="skeleton-loader"></div>
      <!-- 列表卡片只加载压缩图（loadImage 的取值顺序 data-src → data-full-src）：
           原图只在详情页那张大图上请求。 -->
      <img ref="imgRef" :data-src="post.image.src" alt="Blog Featured Image" class="blur-placeholder">
    </div>
    <div class="blog-card-overlay">
      <span class="blog-card-date">{{ post.cardDate }}</span>
      <h3 class="blog-card-title">{{ post.cardTitle }}</h3>
      <span class="blog-card-read">READ</span>
    </div>
  </article>
</template>
