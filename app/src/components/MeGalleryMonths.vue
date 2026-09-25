<script setup>
// ME 相册的月份标签（旧版在 populateMeGalleryGrid 里用 innerHTML 拼的按钮）。
// 按钮内容严格保持旧版的拼接方式：月份 + 括号里的张数，中间不留空格。
defineProps({
  monthKeys: { type: Array, required: true },
  monthGroups: { type: Object, required: true },
  active: { type: String, default: '' },
});
const emit = defineEmits(['select']);
</script>

<template>
  <div class="me-gallery-months" id="meGalleryMonths">
    <button
      v-for="ym in monthKeys"
      :key="ym"
      class="me-gallery-month-btn"
      :class="{ active: ym === active }"
      :data-month="ym"
      @click="emit('select', ym)"
    >{{ ym }}<span class="month-count">({{ monthGroups[ym].length }})</span></button>
  </div>
</template>
