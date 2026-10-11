<script setup>
// 主题切换按钮。旧版把 class="dark" 写死在标记里再由 loadThemeState() 同步；
// 新版从 <html> 上的 class 读初值（首帧已由 index.html 的内联脚本设好），避免两个来源打架。
import { useTheme } from '../composables/useTheme.js';
import { useBrandOverlay } from '../composables/useBrandOverlay.js';

const { isDark } = useTheme();
// 切换走品牌遮罩：屏幕被完全盖住之后才真正换主题，用户看不到颜色硬切
const { switchTheme } = useBrandOverlay();
</script>

<template>
  <button class="theme-toggle" :class="{ dark: isDark }" id="themeToggle" aria-label="Toggle theme" tabindex="-1" @click="switchTheme">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="5"></circle>
      <line x1="12" y1="1" x2="12" y2="3"></line>
      <line x1="12" y1="21" x2="12" y2="23"></line>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
      <line x1="1" y1="12" x2="3" y2="12"></line>
      <line x1="21" y1="12" x2="23" y2="12"></line>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
    </svg>
  </button>
</template>
