<script setup>
// 首页：概念入口（页脚已按决定删除，AppFooter 组件仍被其它页面使用）。
// 原来的 HeroCard 翻转卡和随机画廊按决定从首页撤下（组件文件仍在，没有再被引用）。
import HeroConcept from '../components/HeroConcept.vue';
</script>

<template>
  <main class="page active">
    <HeroConcept />
  </main>
</template>
