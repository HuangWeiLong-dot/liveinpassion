<script setup>
// 首页：概念入口。
// 原来的 HeroCard 翻转卡和随机画廊按决定从首页撤下（组件文件仍在，没有再被引用）。
// 页脚是全局的（App.vue），不在这里挂：它固定在底部，被首页内容盖住，
// 滚到页尾才露出来。
import HeroConcept from '../components/HeroConcept.vue';
</script>

<template>
  <main class="page active">
    <!-- 页面标题：可见字标是逐字动画的装饰元素（aria-hidden），这里给搜索与读屏一份真实 H1 -->
    <h1 class="sr-only">LIVEINPASSION — Huang Wei Long · Photography, Stories &amp; Friends</h1>
    <HeroConcept />
  </main>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
</style>
