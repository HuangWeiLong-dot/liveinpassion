// Steam 数据（只服务 GAME 弹窗）。
//
// 历史上 ME 页还有一张 Steam 卡片（旧 index.html 的 loadSteamData()，整场会话只请求一次、
// 失败后下次进入重试），现已按决定取消；旧的卡片标记与对应样式仍留在仓库根的 index.html 里，
// 切换发布后那段就成了遗留代码。
//
// 现在唯一的消费方是 GAME 弹窗：**每次打开都重新请求**（旧版行为），所以这里不需要缓存语义。
import { ref, computed } from 'vue';
import { STEAM_API_BASE } from '../data/cdn.js';

// 与旧版一致：内部 catch，失败返回 null（不抛出）
async function fetchJson(path) {
  try {
    const response = await fetch(`${STEAM_API_BASE}${path}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('Steam 请求失败:', path, error);
    return null;
  }
}

// 旧版 getPersonaStatus 的状态映射，逐条搬过来
const STATUS_MAP = {
  0: { text: 'Offline', class: 'offline' },
  1: { text: 'Online', class: 'online' },
  2: { text: 'Busy', class: 'busy' },
  3: { text: 'Away', class: 'away' },
  4: { text: 'Snooze', class: 'away' },
  5: { text: 'Looking to Trade', class: 'online' },
  6: { text: 'Looking to Play', class: 'online' },
};
export function getPersonaStatus(code) {
  return STATUS_MAP[code] || { text: 'Offline', class: 'offline' };
}

// 弹窗状态
const loading = ref(false);
const profile = ref(null);
const games = ref(null);
const failed = ref(false);

const status = computed(() => getPersonaStatus(profile.value?.personastate));

const stats = computed(() => {
  let count = 0;
  let totalMinutes = 0;
  if (games.value && games.value.games) {
    count = games.value.games.length;
    totalMinutes = games.value.games.reduce((sum, g) => sum + (g.playtime_forever || 0), 0);
  }
  return { count, hours: Math.round(totalMinutes / 60) };
});

function memberSince(p) {
  if (!p?.timecreated) return '';
  return new Date(p.timecreated * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function useSteam() {
  async function load() {
    loading.value = true;
    failed.value = false;
    const p = await fetchJson('/api/steam/profile');
    const g = await fetchJson('/api/steam/games');
    loading.value = false;
    if (!p) {
      failed.value = true;
      return;
    }
    profile.value = p;
    games.value = g;
  }

  return { loading, profile, failed, status, stats, memberSince, load };
}
