<script setup>
// 「今日统计」：What I'm doing now 下面那一块。
//
// 和 LifeNow 的分工：
//   LifeNow  → /api/life/now，30 秒轮询的**瞬时快照**（当前窗口、位置、手表）
//   LifeToday → /api/life 里的今天那份聚合，1 分钟轮询，数字是会累积的
//
// 今天的聚合由 LifeLogging 的 run_live.ps1 每 2 分钟 upsert 一次，所以这里的
// 应用时长、手机用量和 AI 花费都是「当天到目前为止」，不是完整一天。
// 站点（topSites）同样进聚合，但只到域名一级；页面标题和完整 URL 只在原始归档。
import { computed } from 'vue';

const props = defineProps({
  day: { type: String, default: '' },
  payload: { type: Object, default: null },
  colorMode: { type: Boolean, default: false },
  updated: { type: String, default: '—' },
});

// 卡片是「预览」，只能放下前几条。点它打开**这一类**的完整详情
// （LifeDetailModal），不是整天的详情 —— 天的详情留给柱状图。
const emit = defineEmits(['open']);

function open(kind) {
  emit('open', kind);
}

function minutesLabel(m) {
  const v = Math.round(Number(m) || 0);
  if (v < 60) return `${v}m`;
  return `${Math.floor(v / 60)}h ${String(v % 60).padStart(2, '0')}m`;
}

// 桌面应用时长在聚合里是**小时**（站点、手机是分钟）。以前只显示一位小数的
// "3.4h"，分钟被抹掉了；换算成分钟再走 minutesLabel，显示成 "3h 24m"。
function hoursToDuration(h) {
  const v = Number(h);
  return Number.isFinite(v) ? minutesLabel(v * 60) : '—';
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `¥${n.toFixed(2)}` : '—';
}

function num(v, digits = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: digits }) : '—';
}

function dayLabel(day) {
  if (!day) return '—';
  const [y, m, d] = day.split('-');
  return `${d}.${m}.${y}`;
}

// [[name, value], ...] → 带百分比宽度的行。pct 按当天最大值归一，
// 和右侧榜单同一个算法（不按总量，避免小项全是 2px）。
function rows(pairs, cap = 8) {
  const list = Array.isArray(pairs) ? pairs.slice(0, cap) : [];
  const max = Math.max(...list.map(([, v]) => Number(v) || 0), 0.0001);
  return list.map(([name, value], i) => ({
    name,
    value: Number(value) || 0,
    pct: Math.max(((Number(value) || 0) / max) * 100, 2),
    rank: String(i + 1).padStart(2, '0'),
  }));
}

const apps = computed(() => rows(props.payload?.topApps, 6));
const sites = computed(() => rows(props.payload?.topSites, 5));
const phoneApps = computed(() => rows(props.payload?.phone?.topApps, 5));
const aiProjects = computed(() => rows(props.payload?.ai?.projects, 3));

// 列表被截断时显示 "6/23"，让点击卡片「看全部」这件事有依据。
function total(pairs) {
  return Array.isArray(pairs) ? pairs.length : 0;
}
const appTotal = computed(() => total(props.payload?.topApps));
const siteTotal = computed(() => total(props.payload?.topSites));
const phoneTotal = computed(() => total(props.payload?.phone?.topApps));
const aiTotal = computed(() => total(props.payload?.ai?.projects));
const phone = computed(() => props.payload?.phone || null);
const ai = computed(() => props.payload?.ai || null);

const AI_SOURCES = {
  platform: 'PLATFORM BILL',
  'claude-estimate': 'CLAUDE CODE EST.',
  ledger: 'PIPELINE LEDGER',
};

const aiSource = computed(() => AI_SOURCES[ai.value?.costSource] || '');
</script>

<template>
  <section class="life-today" aria-label="Today's statistics">
    <div class="life-today-head">
      <span class="life-today-kicker">
        <i class="life-today-dot" aria-hidden="true"></i>
        TODAY
        <em class="life-today-date">{{ dayLabel(day) }}</em>
      </span>
      <span class="life-today-updated">
        <template v-if="payload">
          TRACKED {{ hoursToDuration(payload.trackedHours) }} · UPDATED {{ updated }}
        </template>
        <template v-else>WAITING FOR TODAY'S FIRST SNAPSHOT</template>
      </span>
    </div>

    <div v-if="payload" class="life-today-grid">
      <article
        class="life-today-card is-desktop is-openable"
        role="button"
        tabindex="0"
        aria-label="Open today's full desktop details"
        @click="open('desktop')"
        @keydown.enter.prevent="open('desktop')"
        @keydown.space.prevent="open('desktop')"
      >
        <div class="life-today-label">
          <span>01</span> DESKTOP
          <span class="life-today-open">VIEW ALL <i aria-hidden="true">→</i></span>
        </div>

        <h5 class="life-today-sub">
          APPLICATIONS
          <em v-if="appTotal > apps.length">{{ apps.length }}/{{ appTotal }}</em>
        </h5>
        <div v-for="a in apps" :key="a.name" class="life-row">
          <span class="life-rank">{{ a.rank }}</span>
          <span class="life-name">{{ a.name }}</span>
          <span class="life-num">{{ hoursToDuration(a.value) }}</span>
          <span class="life-track">
            <span
              class="life-fill"
              :style="{ width: a.pct + '%', background: colorMode ? 'var(--cat-0)' : null }"
            ></span>
          </span>
        </div>
        <p v-if="!apps.length" class="life-today-empty">NO DESKTOP APPS YET.</p>

        <template v-if="sites.length">
          <h5 class="life-today-sub">
            SITES
            <em v-if="siteTotal > sites.length">{{ sites.length }}/{{ siteTotal }}</em>
          </h5>
          <div v-for="s in sites" :key="s.name" class="life-row">
            <span class="life-rank">{{ s.rank }}</span>
            <span class="life-name">{{ s.name }}</span>
            <span class="life-num">{{ minutesLabel(s.value) }}</span>
            <span class="life-track">
              <span
                class="life-fill"
                :style="{ width: s.pct + '%', background: colorMode ? 'var(--cat-2)' : null }"
              ></span>
            </span>
          </div>
        </template>
        <!-- v-else-if 必须紧跟在 v-if 后面；这里前面是 v-for，只能用独立条件 -->
        <p v-if="!sites.length && apps.length" class="life-today-empty">SITES PUBLISH WITH THE NEXT AGGREGATE.</p>
      </article>

      <article
        class="life-today-card is-openable"
        role="button"
        tabindex="0"
        aria-label="Open today's full phone details"
        @click="open('phone')"
        @keydown.enter.prevent="open('phone')"
        @keydown.space.prevent="open('phone')"
      >
        <div class="life-today-label">
          <span>02</span> PHONE
          <span class="life-today-open">VIEW ALL <i aria-hidden="true">→</i></span>
        </div>

        <template v-if="phone">
          <strong class="life-today-big">
            {{ phone.screenMinutes == null ? '—' : minutesLabel(phone.screenMinutes) }}
          </strong>
          <div class="life-today-meta">
            <span>SCREEN TIME</span>
            <span>{{ num(phone.unlocks) }} UNLOCKS</span>
            <span>{{ num(phone.appSwitches) }} SWITCHES</span>
          </div>

          <h5 v-if="phoneApps.length" class="life-today-sub">
            APPLICATIONS
            <em v-if="phoneTotal > phoneApps.length">{{ phoneApps.length }}/{{ phoneTotal }}</em>
          </h5>
          <div v-for="a in phoneApps" :key="a.name" class="life-row">
            <span class="life-rank">{{ a.rank }}</span>
            <span class="life-name">{{ a.name }}</span>
            <span class="life-num">{{ minutesLabel(a.value) }}</span>
            <span class="life-track">
              <span
                class="life-fill"
                :style="{ width: a.pct + '%', background: colorMode ? 'var(--cat-1)' : null }"
              ></span>
            </span>
          </div>
          <p v-if="!phoneApps.length" class="life-today-empty">NO PHONE APP USAGE YET.</p>
        </template>
        <p v-else class="life-today-empty">NO PHONE DATA TODAY.</p>
      </article>

      <article
        class="life-today-card is-openable"
        role="button"
        tabindex="0"
        aria-label="Open today's full AI spend details"
        @click="open('ai')"
        @keydown.enter.prevent="open('ai')"
        @keydown.space.prevent="open('ai')"
      >
        <div class="life-today-label">
          <span>03</span> AI SPEND
          <span class="life-today-open">VIEW ALL <i aria-hidden="true">→</i></span>
        </div>

        <template v-if="ai">
          <strong class="life-today-big">{{ money(ai.cost) }}</strong>
          <div class="life-today-meta">
            <span>{{ num(ai.calls) }} CALLS</span>
            <span v-if="aiSource">{{ aiSource }}</span>
          </div>

          <h5 v-if="aiProjects.length" class="life-today-sub">
            PROJECTS
            <em v-if="aiTotal > aiProjects.length">{{ aiProjects.length }}/{{ aiTotal }}</em>
          </h5>
          <div v-for="p in aiProjects" :key="p.name" class="life-row">
            <span class="life-rank">{{ p.rank }}</span>
            <span class="life-name">{{ p.name }}</span>
            <span class="life-num">{{ money(p.value) }}</span>
            <span class="life-track">
              <span
                class="life-fill"
                :style="{ width: p.pct + '%', background: colorMode ? 'var(--cat-3)' : null }"
              ></span>
            </span>
          </div>
          <p v-if="!aiProjects.length" class="life-today-empty is-soft">NO PROJECT BREAKDOWN.</p>
        </template>
        <p v-else class="life-today-empty">NO AI SPEND TODAY.</p>
      </article>
    </div>

    <p v-else class="life-today-empty is-block">NO AGGREGATE FOR TODAY YET.</p>
  </section>
</template>

<style scoped>
.life-today {
  margin-top: 12px;
  border: 1px solid var(--border);
  background: var(--bg);
}

.life-today-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 20px;
  padding: 15px 24px;
  border-bottom: 1px solid var(--border);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.56rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.life-today-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-primary);
}

.life-today-date {
  font-style: normal;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.life-today-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-primary);
  animation: life-today-pulse 1.5s steps(2, end) infinite;
}

.life-today-updated {
  color: var(--text-secondary);
}

.life-today-grid {
  display: grid;
  grid-template-columns: 1.5fr 1fr 1fr;
}

.life-today-card {
  min-width: 0;
  padding: 16px 20px 18px;
  border-right: 1px solid var(--border);
}

.life-today-card:last-child {
  border-right: 0;
}

.life-today-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.5rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.life-today-label span:first-child {
  opacity: 0.55;
}

.life-today-open {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary);
  letter-spacing: 0.08em;
  opacity: 0.75;
}

.life-today-open i {
  font-style: normal;
}

.life-today-card.is-openable {
  cursor: pointer;
  transition: background 0.2s ease;
}

.life-today-card.is-openable:hover,
.life-today-card.is-openable:focus-visible {
  background: color-mix(in srgb, var(--text-primary) 4%, transparent);
  outline: none;
}

.life-today-card.is-openable:hover .life-today-open,
.life-today-card.is-openable:focus-visible .life-today-open {
  color: var(--text-primary);
  opacity: 1;
}

.life-today-sub {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin: 13px 0 2px;
  padding-bottom: 7px;
  border-bottom: 1px solid var(--border);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.46rem;
  font-weight: 400;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.life-today-sub em {
  font-style: normal;
  letter-spacing: 0.06em;
  opacity: 0.7;
}

.life-today-sub + .life-row {
  border-bottom: 1px solid var(--border);
}

.life-today-big {
  display: block;
  margin-top: 12px;
  font-family: 'Oswald', sans-serif;
  font-size: 1.5rem;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.03em;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.life-today-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 9px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.46rem;
  letter-spacing: 0.08em;
  line-height: 1.5;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.life-today-empty {
  display: block;
  padding: 12px 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.5rem;
  letter-spacing: 0.1em;
  line-height: 1.6;
  text-transform: uppercase;
  color: var(--text-secondary);
  opacity: 0.7;
}

.life-today-empty.is-block {
  padding: 20px 24px;
}

.life-today-empty.is-soft {
  opacity: 0.5;
}

@keyframes life-today-pulse {
  0%, 55% { opacity: 1; }
  56%, 100% { opacity: 0.18; }
}

@media (max-width: 1024px) {
  .life-today-grid {
    grid-template-columns: 1fr 1fr;
  }

  .life-today-card {
    border-bottom: 1px solid var(--border);
  }

  .life-today-card.is-desktop {
    grid-column: 1 / -1;
    border-right: 0;
  }

  .life-today-card:last-child {
    border-right: 0;
    border-bottom: 0;
  }
}

@media (max-width: 640px) {
  .life-today-head {
    padding: 14px 16px;
  }

  .life-today-grid {
    grid-template-columns: 1fr;
  }

  .life-today-card {
    border-right: 0;
    border-bottom: 1px solid var(--border);
    padding: 16px;
  }

  .life-today-card:last-child {
    border-bottom: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .life-today-dot {
    animation: none;
  }
}
</style>
