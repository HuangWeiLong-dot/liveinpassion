<script setup>
// 首页：hero 翻转卡 + 随机排布画廊 + 页脚（旧 index.html L4852-L4888）。
import HeroCard from '../components/HeroCard.vue';
import RandomGallery from '../components/RandomGallery.vue';
import AppFooter from '../components/AppFooter.vue';
</script>

<template>
  <main class="page active">
    <HeroCard />
    <RandomGallery />
    <AppFooter />
  </main>
</template>
