<script setup>
// 通配路由。旧版对未知页面的处理是**静默无操作**（getElementById 返回 null 就什么都不做），
// 所以这是迁移带来的新行为——但它从 UI 上不可达，只有手输错误地址才会看到。
import { useRoute } from 'vue-router';

const route = useRoute();
</script>

<template>
  <main class="page active">
    <section class="gallery-hero">
      <div class="hero-content">
        <h1 class="hero-title">NOT FOUND</h1>
        <p class="hero-subtitle">这页不存在：{{ route.fullPath }}</p>
      </div>
    </section>
    <footer>
      <p>© 2026 LIVE IN PASSION. Be Brave. Be Genuine. Be Humble. And don't be a dick.</p>
    </footer>
  </main>
</template>
