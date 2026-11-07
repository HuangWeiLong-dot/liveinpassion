<script setup>
// 顶部加载进度条。状态在 composables/useRouteProgress.js，这里只负责画。
//
// 位置：固定在视口最上方、压过转场板子（板子 z-index 90000）。下载新页面图片
// 最忙的那一段正好是板子盖住整屏的时候 —— 条子必须在那上面，否则用户全程看不见。
// 颜色跟着主题走：深色主题 --text-primary 是 #FAFAFA、浅色是 #1A1A1A，
// 轨道用同色 10% 透明度，在两种主题、以及转场板子（--bg）上都读得出来。
import { routeProgress } from '../composables/useRouteProgress.js';
</script>

<template>
  <Teleport to="body">
    <div
      class="route-progress"
      :class="{ 'is-visible': routeProgress.visible }"
      :data-total="routeProgress.total"
      :data-done="routeProgress.done"
      aria-hidden="true"
    >
      <span class="route-progress__track"></span>
      <span
        class="route-progress__fill"
        :class="{ 'is-instant': routeProgress.noTransition }"
        :style="{ transform: `scaleX(${routeProgress.value / 100})` }"
      ></span>
    </div>
  </Teleport>
</template>

<style scoped>
.route-progress {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  /* 压过转场板子（90000），但仍低于方块光标（100000） */
  z-index: 95000;
  /* 条子只在导航期间存在，不占布局、不吃点击 */
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.24s ease;
}

.route-progress.is-visible {
  opacity: 1;
}

.route-progress__track {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--text-primary) 10%, transparent);
}

.route-progress__fill {
  position: absolute;
  inset: 0;
  transform: scaleX(0);
  transform-origin: 0 50%;
  background: var(--text-primary);
  /* 轻微的外发光，让 2px 的条子在白底/黑底上都有一层边缘 */
  box-shadow: 0 0 12px color-mix(in srgb, var(--text-primary) 28%, transparent);
  transition: transform 0.2s cubic-bezier(0.22, 0.61, 0.36, 1);
  will-change: transform;
}

/* 重新导航时归零：不要演"从 100 倒着缩回 0" */
.route-progress__fill.is-instant {
  transition: none;
}

@media (prefers-reduced-motion: reduce) {
  .route-progress__fill {
    transition: none;
  }
}
</style>
