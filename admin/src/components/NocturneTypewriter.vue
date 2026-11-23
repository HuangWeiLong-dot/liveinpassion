<script setup>
// Typewriter Nocturne 舞台：把 Markdown 编辑器放进一张稿纸里，稿纸下方是一台 3D 打字机。
// 打字头的横向位置跟着编辑器光标走，每次按键都敲一下、响一声。
//
// 关闭 Nocturne 时这里只是一个普通容器：稿纸 / 机器 / 声音都不挂载。

import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { NocturneStage } from '../nocturne/stage.js';

const props = defineProps({
  active: { type: Boolean, default: true },
  sound: { type: Boolean, default: true },
  volume: { type: Number, default: 0.4 },
  voice: { type: String, default: 'standard' },
  height: { type: String, default: '66vh' },
  // () => CodeMirror EditorView | null：由 BlogEdit 传进来，用来读光标和字符网格
  getView: { type: Function, required: true },
});

const stageEl = ref(null);
const sheetEl = ref(null);
const canvasEl = ref(null);
const paperCanvasEl = ref(null);
const glowCanvasEl = ref(null);
let stage = null;

function syncOptions() {
  stage?.setOptions({
    sound: props.sound,
    volume: props.volume,
    voice: props.voice,
  });
}

onMounted(async () => {
  stage = new NocturneStage({
    stageEl: stageEl.value,
    sheetEl: sheetEl.value,
    canvasEl: canvasEl.value,
    paperCanvasEl: paperCanvasEl.value,
    glowCanvasEl: glowCanvasEl.value,
    getView: props.getView,
  });
  // 验收脚本（tools/verify-admin-nocturne.mjs）用它读打字头的实际位置
  stageEl.value.__nocturne = stage;
  syncOptions();
  stage.setActive(props.active);
  // md-editor 自己也在首帧测量尺寸，等一帧再排一次
  await nextTick();
  if (props.active) {
    stage.syncLayout();
  }
});

watch(
  () => props.active,
  async (active) => {
    stage?.setActive(active);
    if (active) {
      await nextTick();
      stage?.syncLayout();
    }
  }
);

watch(() => props.sound, syncOptions);
watch(() => props.volume, syncOptions);
watch(() => props.voice, syncOptions);

onBeforeUnmount(() => {
  stage?.destroy();
  stage = null;
  if (stageEl.value) {
    delete stageEl.value.__nocturne;
  }
});
</script>

<template>
  <div
    ref="stageEl"
    class="tn-stage"
    :class="{ 'is-live': active }"
    :style="{ '--tn-stage-h': height }"
  >
    <div ref="sheetEl" class="tn-sheet">
      <slot />
      <canvas ref="paperCanvasEl" class="tn-paper-light" aria-hidden="true"></canvas>
      <canvas ref="glowCanvasEl" class="tn-glow" aria-hidden="true"></canvas>
    </div>
    <canvas ref="canvasEl" class="tn-machine" aria-hidden="true"></canvas>
  </div>
</template>
