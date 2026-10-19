<script setup>
// 首页：概念入口。
// 原来的 HeroCard 翻转卡和随机画廊按决定从首页撤下（组件文件仍在，没有再被引用）。
// 页脚是全局的（App.vue），不在这里挂：它固定在底部，被首页内容盖住，
// 滚到页尾才露出来。
import HeroConcept from '../components/HeroConcept.vue';
</script>

<template>
  <main class="page active">
    <HeroConcept />
  </main>
</template>
