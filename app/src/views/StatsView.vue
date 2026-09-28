<script setup>
// 访问统计页（公开）。运行时从 Worker /api/stats 拉数据，纯 CSS 条形图，零图表依赖。
import { computed, onMounted, onUnmounted, ref } from 'vue';
import AppFooter from '../components/AppFooter.vue';

const CMS_BASE =
  import.meta.env.VITE_CMS_BASE || 'https://cms.liveinpassion.me';

const data = ref(null);
const error = ref(false);
let timer = null;

const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

async function load() {
  try {
    const res = await fetch(`${CMS_BASE}/api/stats`);
    if (!res.ok) throw new Error('bad status');
    data.value = await res.json();
    error.value = false;
  } catch {
    error.value = true;
  }
}

onMounted(() => {
  load();
  timer = setInterval(load, 60000);
});
onUnmounted(() => clearInterval(timer));

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function monthLabel(m) {
  const [y, mo] = m.split('-');
  return `${MONTHS[Number(mo) - 1]} ${y}`;
}

function shortDay(d) {
  return d.slice(5).replace('-', '/');
}

function pathName(p) {
  const names = {
    '/': 'HOME',
    '/blogs': 'BLOGS',
    '/me': 'ME',
    '/me/gallery': 'ME — GALLERY',
    '/gallery': 'GALLERY',
    '/group-photos': 'GROUP PHOTOS',
    '/friends/:id': 'FRIENDS',
    '/stats': 'STATS',
  };
  return names[p] || p.replace(/^\//, '').toUpperCase();
}

// 近 30 天柱高（以 PV 最大值归一）
const dailyBars = computed(() => {
  if (!data.value?.daily?.length) return [];
  const rows = data.value.daily;
  const max = Math.max(...rows.map((r) => r.pv), 1);
  return rows.map((r, i) => ({
    ...r,
    pct: Math.max((r.pv / max) * 100, r.pv > 0 ? 3 : 0),
    label: shortDay(r.day),
    showLabel: i % 5 === 0 || i === rows.length - 1,
  }));
});

// 热门路径条宽
const pathBars = computed(() => {
  if (!data.value?.topPaths?.length) return [];
  const rows = data.value.topPaths;
  const max = Math.max(...rows.map((r) => r.views), 1);
  return rows.map((r) => ({
    ...r,
    name: pathName(r.path),
    pct: Math.max((r.views / max) * 100, 4),
  }));
});

// 今日相对昨日变化（百分比，正值绿色语义用箭头表达，不依赖颜色）
function trend(now, prev) {
  if (!prev) return now > 0 ? 'NEW' : '—';
  const diff = Math.round(((now - prev) / prev) * 100);
  return diff >= 0 ? `+${diff}%` : `${diff}%`;
}
</script>

<template>
  <main class="page active">
    <section class="stats-section">
      <h1 class="gallery-title">STATISTICS</h1>
      <p class="gallery-subtitle">Who passes through Live in Passion</p>

      <!-- 加载 / 错误 -->
      <div v-if="!data && !error" class="stats-loading">
        <div class="skeleton-loader" style="height: 120px"></div>
      </div>
      <div v-else-if="error" class="stats-empty">
        <p>Statistics are temporarily unavailable.</p>
        <button class="stats-retry" @click="load">RETRY</button>
      </div>

      <template v-else>
        <!-- 大数字 -->
        <div class="stats-cards">
          <div class="stat-card">
            <span class="stat-eyebrow">TOTAL VIEWS</span>
            <span class="stat-number">{{ fmt(data.totals.pageViews) }}</span>
          </div>
          <div class="stat-card">
            <span class="stat-eyebrow">TOTAL VISITORS</span>
            <span class="stat-number">{{ fmt(data.totals.visitors) }}</span>
          </div>
          <div class="stat-card">
            <span class="stat-eyebrow">TODAY</span>
            <span class="stat-number">{{ fmt(data.today.pageViews) }}</span>
            <span class="stat-note">
              {{ fmt(data.today.visitors) }} visitors ·
              {{ trend(data.today.pageViews, data.today.yesterdayPv) }} vs. yesterday
            </span>
          </div>
          <div class="stat-card stat-card-live">
            <span class="stat-eyebrow">ONLINE NOW</span>
            <span class="stat-number">{{ fmt(data.onlineNow) }}</span>
            <span class="stat-pulse" aria-hidden="true"></span>
          </div>
        </div>

        <!-- 近 30 天 -->
        <div class="stats-panel">
          <div class="stats-panel-head">
            <h2>LAST 30 DAYS</h2>
            <span>Daily page views</span>
          </div>
          <div class="stats-bars">
            <div
              v-for="b in dailyBars"
              :key="b.day"
              class="stats-bar-col"
              :title="`${b.day} — ${b.pv} views, ${b.uv} visitors`"
            >
              <div class="stats-bar-track">
                <div class="stats-bar" :style="{ height: b.pct + '%' }"></div>
              </div>
              <span v-if="b.showLabel" class="stats-bar-label">{{ b.label }}</span>
            </div>
          </div>
        </div>

        <div class="stats-two-col">
          <!-- 按月 -->
          <div class="stats-panel">
            <div class="stats-panel-head">
              <h2>MONTHLY</h2>
              <span>Views / visitors</span>
            </div>
            <table class="stats-table">
              <tbody>
                <tr v-for="m in data.monthly" :key="m.month">
                  <td class="stats-table-label">{{ monthLabel(m.month) }}</td>
                  <td class="stats-table-num">{{ fmt(m.pv) }}</td>
                  <td class="stats-table-num stats-table-muted">{{ fmt(m.uv) }}</td>
                </tr>
                <tr v-if="!data.monthly.length">
                  <td colspan="3" class="stats-table-empty">No monthly data yet.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 热门页面 -->
          <div class="stats-panel">
            <div class="stats-panel-head">
              <h2>TOP PAGES</h2>
              <span>All time views</span>
            </div>
            <ul class="stats-paths">
              <li v-for="p in pathBars" :key="p.path">
                <div class="stats-path-row">
                  <span class="stats-path-name">{{ p.name }}</span>
                  <span class="stats-path-num">{{ fmt(p.views) }}</span>
                </div>
                <div class="stats-path-track">
                  <div class="stats-path-fill" :style="{ width: p.pct + '%' }"></div>
                </div>
              </li>
              <li v-if="!pathBars.length" class="stats-table-empty">No data yet.</li>
            </ul>
          </div>
        </div>

        <p class="stats-foot">
          Tracking since {{ data.since || '—' }} · {{ data.timezone }} ·
          no cookies, no IPs — an anonymous random ID in your browser only
        </p>
      </template>
    </section>
    <AppFooter />
  </main>
</template>
