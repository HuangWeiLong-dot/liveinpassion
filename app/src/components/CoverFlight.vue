<script setup>
// 整站唯一的"会飞的封面"。挂一次在 App.vue 里，Teleport 到 body：
//   · body 直下、没有任何 transform 祖先 —— fixed 不会以别的元素为包含块；
//   · z-index 94000：高于页面（.page 是 1）和固定头部（100），
//     低于转场板子（90000 之上？板子被跳过；仍留出层级）与方块光标（100000）。
//
// 这里**只画一张图**，不持有时序。所有 begin / lift / fly / hide 都在
// composables/useCoverFlight.js 里，由列表和详情两个视图调用。
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { registerCoverFlight } from '../composables/useCoverFlight.js';

const host = ref(null);
const img = ref(null);

onMounted(() => registerCoverFlight(host.value, img.value));
onBeforeUnmount(() => registerCoverFlight(null, null));
</script>

<template>
  <Teleport to="body">
    <div ref="host" class="cover-flight" aria-hidden="true">
      <!-- ⚠ 必须和站内其它大图用同一个 CORS 模式（anonymous）：
           列表卡片、详情封面、灯箱、thumbUrl 的 fetch 都是 CORS 请求。
           飞行层如果走 no-cors，同一个 URL 会被浏览器当成另一份缓存键，
           点击一次就会多下/多解一遍 —— 那就违背了"每张图首次只加载一次"。 -->
      <img ref="img" alt="" decoding="async" crossorigin="anonymous" draggable="false">
    </div>
  </Teleport>
</template>

<style scoped>
.cover-flight {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 94000;
  display: none;
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
  background: transparent;
  will-change: left, top, width, height;
}

.cover-flight img {
  display: block;
  width: 100%;
  height: 100%;
  /* 列表和详情右列在飞行途中都是"填满盒子"；终点的盒子比例等于图的比例，
     cover 与 contain 等价，所以落定后交还给详情自己的封面不会有二次裁切 */
  object-fit: cover;
  user-select: none;
  -webkit-user-drag: none;
}
</style>
