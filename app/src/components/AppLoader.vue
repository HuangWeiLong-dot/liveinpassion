<script setup>
// 首屏遮罩。对应旧 index.html L4848-L4850 的标记与 DOMContentLoaded 里的 hideLoader。
// 只在首次加载出现，路由切换不会再显示（状态在 useAppLoader 的模块作用域里）。
import { onMounted } from 'vue';
import { useAppLoader } from '../composables/useAppLoader.js';

const { isHidden, start } = useAppLoader();

onMounted(start);
</script>

<template>
  <div id="loader" :class="{ hidden: isHidden }">
    <div class="loader-text">LIVEINPASSION</div>
  </div>
</template>
