<script setup>
// 博客列表（旧 index.html L4890-L4960）。数据来自 app/src/data/blogPosts.js，
// 顺序就是旧站卡片的顺序（新→旧），不要再排序。
import { blogPosts } from '../data/blogPosts.js';
import BlogCard from '../components/BlogCard.vue';
import AppFooter from '../components/AppFooter.vue';
</script>

<template>
  <main class="page active">
    <section class="blog-section">
      <h1 class="gallery-title">BLOGS</h1>
      <p class="gallery-subtitle">Stories and reflections from the journey</p>

      <div class="blog-grid">
        <BlogCard v-for="post in blogPosts" :key="post.slug" :post="post" />
      </div>
    </section>
    <AppFooter />
  </main>
</template>
