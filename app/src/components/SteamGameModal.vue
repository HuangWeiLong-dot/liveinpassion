<script setup>
// GAME 弹窗（旧 index.html 的 #gameModal 标记 + 打开时重新请求并拼 innerHTML 的逻辑）。
// 每次打开都重新请求（旧版行为），不缓存——这也是 ME 页现在唯一的 Steam 消费方。
import { watch } from 'vue';
import { useSteam } from '../composables/useSteam.js';

const props = defineProps({
  visible: { type: Boolean, default: false },
});
const emit = defineEmits(['close']);

const { profile, failed, status, stats, memberSince, load } = useSteam();

watch(
  () => props.visible,
  (open) => {
    if (open) load();
  }
);
</script>

<template>
  <div class="modal-overlay" id="gameModal" :class="{ active: visible }" @click.self="emit('close')">
    <div class="modal-content">
      <span class="modal-close" id="gameModalClose" @click="emit('close')">&times;</span>
      <h3>Steam Profile</h3>

      <div class="modal-steam-profile" id="modalSteamProfile">
        <template v-if="profile">
          <div class="steam-profile-row">
            <div class="steam-profile-avatar">
              <img :src="profile.avatarfull" :alt="profile.personaname">
            </div>
            <div class="steam-profile-info">
              <h4>{{ profile.personaname }}</h4>
              <div class="steam-profile-status">
                <span class="status-indicator" :class="status.class"></span>
                {{ status.text }}
              </div>
            </div>
          </div>
          <div class="steam-profile-divider"></div>
          <div class="steam-profile-stats">
            <div class="steam-profile-stat"><strong>{{ stats.count }}</strong> Games Owned</div>
            <div class="steam-profile-stat"><strong>{{ stats.hours }}</strong> Hours Played</div>
          </div>
          <div class="steam-profile-divider"></div>
          <div class="steam-profile-stat">Member since {{ memberSince(profile) }}</div>
          <div class="steam-profile-actions">
            <a :href="profile.profileurl || '#'" target="_blank" class="steam-profile-btn">View Steam Profile</a>
          </div>
        </template>

        <p v-else-if="failed" style="text-align: center; color: var(--text-secondary); margin: 16px 0;">Failed to load Steam profile</p>

        <div v-else class="skeleton-loader" style="width: 100%; height: 200px; display: block;"></div>
      </div>
    </div>
  </div>
</template>
