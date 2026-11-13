<script setup>
// 统一的一套线性图标：24x24、stroke 1.6、颜色跟随 currentColor。
// 只画轮廓不画填充，和站点的细线风格一致。
defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 14 },
});
</script>

<template>
  <svg
    class="life-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'location'">
      <path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z" />
      <circle cx="12" cy="11" r="2.4" />
    </template>
    <template v-else-if="name === 'qa'">
      <path d="M4 5h16v11H9l-5 4V5Z" />
    </template>
    <template v-else-if="name === 'desktop'">
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4" />
    </template>
    <template v-else-if="name === 'phone'">
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18.5h2" />
    </template>
    <template v-else-if="name === 'watch'">
      <rect x="7" y="6" width="10" height="12" rx="2" />
      <path d="M9 6V3h6v3M9 18v3h6v-3" />
    </template>
    <template v-else-if="name === 'music'">
      <path d="M9 18V6l10-2v12" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="16" r="2" />
    </template>
    <template v-else-if="name === 'bell'">
      <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </template>
    <template v-else-if="name === 'battery'">
      <rect x="2" y="8" width="17" height="8" rx="2" />
      <path d="M21 11v2" />
      <path d="M5 11h7v2H5z" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'wifi'">
      <path d="M2.5 8.5a16 16 0 0 1 19 0" />
      <path d="M6 12a11 11 0 0 1 12 0" />
      <path d="M9.5 15.5a6 6 0 0 1 5 0" />
      <path d="M12 19h.01" />
    </template>
    <template v-else-if="name === 'signal'">
      <path d="M5 19v-4M10 19v-8M15 19v-12M20 19V4" />
    </template>
    <template v-else-if="name === 'screen'">
      <rect x="3" y="4" width="18" height="13" rx="1.5" />
      <path d="M8 20h8" />
    </template>
    <template v-else-if="name === 'heart'">
      <path d="M12 20.2 4.9 13.1a4.7 4.7 0 0 1 6.6-6.6l.5.5.5-.5a4.7 4.7 0 0 1 6.6 6.6Z" />
    </template>
    <template v-else-if="name === 'steps'">
      <path d="M8.5 20.5c-1.4 0-2.4-.9-2.4-2.3 0-1.9.9-3.3 1.4-5.2.5-1.9.5-3.8.5-5.7 0-1.6.9-2.8 2.4-2.8s2.4 1.1 2.4 2.8c0 1.9-.5 3.8-1 5.7-.5 1.9-1.4 3.3-1.4 5.2 0 1.4-1 2.3-2.4 2.3Z" />
      <path d="M15.8 18.8c1.2.2 2-.5 2.2-1.7.3-1.7-.4-3.1-.7-4.9-.3-1.8-.2-3.6 0-5.4.2-1.5-.4-2.7-1.7-2.9-1.3-.2-2.2.8-2.4 2.3-.2 1.8-.1 3.6.1 5.4.3 1.8 1 3.2 1 4.9.1 1.3.5 2.1 1.5 2.3Z" />
    </template>
  </svg>
</template>

<style scoped>
.life-icon {
  flex: none;
  vertical-align: -2px;
}
</style>
