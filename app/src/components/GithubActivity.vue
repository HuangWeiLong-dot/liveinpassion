<script setup>
/**
 * GITHUB ACTIVITY 板块：LIFE 长页和仪表盘共用。
 * 数据由 useGithubActivity 提供（模块级单例 + localStorage 缓存 10 分钟），
 * 这里只负责画：合计 / 12 周 × 7 天的贡献格子图 / 仓库排行。
 */
import { computed, onMounted, ref } from 'vue';
import { GITHUB_USER, useGithubActivity, WEEKS } from '../composables/useGithubActivity.js';

const props = defineProps({
  // panel = 长页里的一块面板；tile = 仪表盘里的 12 列板子
  variant: { type: String, default: 'panel' },
  index: { type: String, default: '08' },
});

const { data, loading, error, at, isStale, load } = useGithubActivity();
const hover = ref(-1);

onMounted(() => {
  load();
});

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const profileUrl = computed(() => `https://github.com/${GITHUB_USER}`);

const totals = computed(() => data.value?.totals || null);
const cells = computed(() => data.value?.cells || []);
const weeks = computed(() => data.value?.weeks || WEEKS);
const months = computed(() => data.value?.months || []);
const repos = computed(() => data.value?.repos || []);

const staleNow = computed(() => isStale() && !!data.value);

const stats = computed(() => {
  const t = totals.value;
  if (!t) return [];
  const base = [
    { key: 'commits', label: 'COMMITS', value: fmtNum(t.commits) },
    { key: 'prs', label: 'PULL REQS', value: fmtNum(t.prs) },
    { key: 'issues', label: 'ISSUES', value: fmtNum(t.issues) },
    { key: 'events', label: 'EVENTS', value: fmtNum(t.events) },
    { key: 'active', label: 'ACTIVE DAYS', value: String(t.activeDays) },
    { key: 'streak', label: 'STREAK', value: `${t.streak}D` },
  ];
  return props.variant === 'tile' ? base.slice(0, 4) : base;
});

const repoMax = computed(() => Math.max(1, ...repos.value.map((r) => r.events)));

const updatedLabel = computed(() => {
  if (!at.value) return '';
  const d = new Date(at.value);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
});

const hoverCell = computed(() => (hover.value >= 0 ? cells.value[hover.value] : null));

function fmtNum(n) {
  return (n ?? 0).toLocaleString('en-US');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function shortDay(day) {
  if (!day) return '';
  const [, m, d] = day.split('-');
  return `${MONTHS[Number(m) - 1]} ${d}`;
}

// 格子的 aria：读屏用户拿到的是一整句话，不依赖颜色深浅
function cellLabel(c) {
  if (c.future) return '';
  if (!c.events) return `${shortDay(c.day)}: no public activity`;
  return `${shortDay(c.day)}: ${c.commits} commits, ${c.prs} pull requests, ${c.issues} issues`;
}

function retry() {
  load(true);
}
</script>

<template>
  <div class="gh" :class="`is-${variant}`">
    <div class="stats-panel-head">
      <div class="stats-panel-title">
        <span class="stats-panel-index">{{ index }}</span>
        <h2>GITHUB ACTIVITY</h2>
      </div>
      <span class="stats-panel-sub">
        <span v-if="staleNow" class="gh-flag">CACHED</span>
        @{{ GITHUB_USER }} · {{ totals?.windowDays || WEEKS * 7 }}D · PUBLIC EVENTS
      </span>
    </div>

    <div v-if="!data && loading" class="gh-loading" aria-label="Loading GitHub activity">
      <span v-for="n in 84" :key="n"></span>
    </div>

    <div v-else-if="!data" class="gh-empty">
      <p>GitHub activity is unavailable right now.</p>
      <button type="button" class="gh-retry" @click="retry">RETRY</button>
    </div>

    <div v-else class="gh-body">
      <div class="gh-main">
        <div class="gh-stats">
          <span v-for="s in stats" :key="s.key" class="gh-stat">
            <em>{{ s.label }}</em><b>{{ s.value }}</b>
          </span>
        </div>

        <!-- 贡献格子图：12 列（周）× 7 行（星期），深浅 0–4 级 -->
        <div class="gh-chart" :style="{ '--weeks': weeks }">
          <div class="gh-months">
            <span
              v-for="m in months"
              :key="m.index"
              :style="{ gridColumnStart: m.index + 1 }"
            >{{ m.label }}</span>
          </div>

          <div class="gh-gridwrap">
            <div class="gh-days" aria-hidden="true">
              <span v-for="(d, i) in WEEKDAYS" :key="d">{{ i % 2 === 0 && i < 6 ? d : '' }}</span>
            </div>

            <div class="gh-grid" role="grid" :aria-label="`GitHub activity, last ${weeks} weeks`">
              <span
                v-for="(c, i) in cells"
                :key="c.day"
                class="gh-cell"
                :class="[`lvl-${c.level}`, { 'is-future': c.future, 'is-today': c.isToday }]"
                :tabindex="c.future ? -1 : 0"
                role="gridcell"
                :aria-label="cellLabel(c)"
                @pointerenter="c.future ? null : (hover = i)"
                @pointerleave="hover = -1"
                @focus="c.future ? null : (hover = i)"
                @blur="hover = -1"
              ></span>
            </div>
          </div>
        </div>

        <div class="gh-readout" aria-live="off">
          <span v-if="hoverCell && !hoverCell.future">
            {{ shortDay(hoverCell.day) }} · {{ hoverCell.commits }} COMMITS · {{ hoverCell.prs }} PRs · {{ hoverCell.issues }} ISSUES
          </span>
          <span v-else>{{ totals?.activeDays || 0 }} ACTIVE DAYS · {{ totals?.longest || 0 }}D LONGEST RUN</span>

          <span class="gh-legend" aria-hidden="true">
            <i>LESS</i>
            <b class="gh-swatch lvl-0"></b>
            <b class="gh-swatch lvl-1"></b>
            <b class="gh-swatch lvl-2"></b>
            <b class="gh-swatch lvl-3"></b>
            <b class="gh-swatch lvl-4"></b>
            <i>MORE</i>
          </span>
        </div>
      </div>

      <div class="gh-repos">
        <div class="gh-repos-head">
          <span>TOP REPOSITORIES</span>
          <span>{{ totals?.repos || 0 }} TOUCHED</span>
        </div>

        <a
          v-for="(row, i) in repos"
          :key="row.name"
          class="life-row gh-repo"
          :href="row.url"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span class="life-rank">{{ pad2(i + 1) }}</span>
          <span class="life-name">{{ row.name }}</span>
          <span class="life-num">{{ row.events }} EV</span>
          <span class="life-track"><span class="life-fill" :style="{ width: `${(row.events / repoMax) * 100}%` }"></span></span>
        </a>

        <p v-if="!repos.length" class="gh-repos-empty">NO PUBLIC EVENTS IN THE WINDOW</p>

        <a class="gh-profile" :href="profileUrl" target="_blank" rel="noopener noreferrer">
          OPEN PROFILE <span aria-hidden="true">↗</span>
        </a>
      </div>
    </div>

    <p class="gh-foot">
      <span v-if="error && data" class="gh-foot-err">LAST FETCH FAILED · SHOWING CACHE</span>
      <span v-else>{{ data ? `FETCHED ${updatedLabel}` : 'NOT FETCHED' }}</span>
      <span>{{ variant === 'tile' ? '12 WEEKS' : 'CACHED 10 MIN · UNAUTHENTICATED API' }}</span>
    </p>
  </div>
</template>

<style scoped>
.gh {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.gh-body {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(240px, 1fr);
  gap: 30px;
  padding: 16px 22px 4px;
}

.gh-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* ---------- 合计 ---------- */

.gh-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 26px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}

.gh-stat {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 68px;
}

.gh-stat em {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.48rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-secondary);
  font-style: normal;
}

.gh-stat b {
  font-family: 'Oswald', sans-serif;
  font-size: 1.24rem;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

/* ---------- 格子图 ---------- */

.gh-chart {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 18px;
  max-width: 460px;
}

.gh-months {
  display: grid;
  grid-template-columns: repeat(var(--weeks, 12), minmax(0, 1fr));
  gap: 3px;
  margin-left: 32px;
  height: 12px;
}

.gh-months span {
  grid-row: 1;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.44rem;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
  white-space: nowrap;
}

.gh-gridwrap {
  display: flex;
  gap: 8px;
}

.gh-days {
  display: grid;
  grid-template-rows: repeat(7, minmax(0, 1fr));
  gap: 3px;
  width: 24px;
  flex: none;
}

.gh-days span {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.4rem;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  align-self: center;
  line-height: 1;
}

.gh-grid {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(7, minmax(0, 1fr));
  grid-auto-columns: minmax(0, 1fr);
  gap: 3px;
}

.gh-cell {
  display: block;
  aspect-ratio: 1;
  background: var(--border);
  cursor: crosshair;
  outline: none;
  transition: opacity 0.15s ease;
}

.gh-cell.lvl-1 { background: var(--text-primary); opacity: 0.24; }
.gh-cell.lvl-2 { background: var(--text-primary); opacity: 0.42; }
.gh-cell.lvl-3 { background: var(--text-primary); opacity: 0.64; }
.gh-cell.lvl-4 { background: var(--text-primary); opacity: 0.9; }

/* 未来几天不画框：格子图右下角自然收边，和 GitHub 一样 */
.gh-cell.is-future {
  background: transparent;
  cursor: default;
  pointer-events: none;
}

/* 今天用外描边标出来，深色和浅色主题下都看得出来 */
.gh-cell.is-today {
  outline: 1px solid var(--text-secondary);
  outline-offset: 1px;
}

.gh-cell:not(.is-future):hover,
.gh-cell:not(.is-future):focus-visible {
  outline: 1px solid var(--text-primary);
  outline-offset: 1px;
  opacity: 1;
}

/* 彩色模式下格子跟着分类色走（其余视图仍是黑白灰阶） */
:global(.is-color) .gh-cell.lvl-1 { background: var(--cat-3); opacity: 0.55; }
:global(.is-color) .gh-cell.lvl-2 { background: var(--cat-3); opacity: 0.75; }
:global(.is-color) .gh-cell.lvl-3 { background: var(--cat-0); opacity: 0.55; }
:global(.is-color) .gh-cell.lvl-4 { background: var(--cat-0); opacity: 0.95; }

.gh-readout {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-height: 20px;
  margin-top: 12px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.5rem;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
  text-transform: uppercase;
}

.gh-legend {
  display: flex;
  align-items: center;
  gap: 3px;
  flex: none;
}

.gh-legend i {
  font-style: normal;
  margin: 0 4px;
  font-size: 0.44rem;
}

.gh-swatch {
  display: block;
  width: 8px;
  height: 8px;
  background: var(--border);
}

.gh-swatch.lvl-1 { background: var(--text-primary); opacity: 0.24; }
.gh-swatch.lvl-2 { background: var(--text-primary); opacity: 0.42; }
.gh-swatch.lvl-3 { background: var(--text-primary); opacity: 0.64; }
.gh-swatch.lvl-4 { background: var(--text-primary); opacity: 0.9; }

/* ---------- 仓库 ---------- */

.gh-repos {
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding-top: 2px;
}

.gh-repos-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.48rem;
  letter-spacing: 0.16em;
  color: var(--text-secondary);
  text-transform: uppercase;
}

.gh-repo {
  text-decoration: none;
  color: inherit;
}

.gh-repo:hover .life-name,
.gh-repo:focus-visible .life-name {
  text-decoration: underline;
  text-underline-offset: 4px;
}

.gh-repos-empty {
  margin: 14px 0 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.5rem;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
}

.gh-profile {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.52rem;
  letter-spacing: 0.14em;
  color: var(--text-primary);
  text-decoration: none;
}

.gh-profile:hover { text-decoration: underline; text-underline-offset: 4px; }

/* ---------- 状态 ---------- */

.gh-loading {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-auto-rows: 1fr;
  gap: 3px;
  width: min(460px, calc(100% - 44px));
  aspect-ratio: 12 / 5;
  margin: 20px 22px;
}

.gh-loading span {
  background: var(--border);
  animation: gh-pulse 1.4s ease-in-out infinite;
}

.gh-loading span:nth-child(3n) { animation-delay: 0.15s; }
.gh-loading span:nth-child(3n + 1) { animation-delay: 0.3s; }

@keyframes gh-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.75; }
}

.gh-empty {
  padding: 26px 22px;
  display: flex;
  align-items: center;
  gap: 18px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.56rem;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
  text-transform: uppercase;
}

.gh-empty p { margin: 0; }

.gh-retry {
  font: inherit;
  letter-spacing: 0.14em;
  color: var(--text-primary);
  background: none;
  border: 1px solid var(--border);
  padding: 6px 12px;
  cursor: pointer;
}

.gh-retry:hover { background: var(--text-primary); color: var(--bg); }

.gh-flag {
  display: inline-block;
  margin-right: 8px;
  padding: 1px 5px;
  border: 1px solid var(--border);
  color: var(--text-primary);
}

.gh-foot {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  margin: 10px 0 0;
  padding: 10px 22px 0;
  border-top: 1px solid var(--border);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.46rem;
  letter-spacing: 0.12em;
  color: var(--text-secondary);
  text-transform: uppercase;
}

.gh-foot-err { color: var(--text-primary); }

/* ---------- 仪表盘里的窄版 ---------- */

.gh.is-tile {
  height: 100%;
}

/* 仪表盘里的 Head 也要收一档：那块 padding 写在 LifeDashboard 的 scoped 样式里，
   跨组件不生效，只能在这里对齐同一组数值 */
.gh.is-tile .stats-panel-head {
  padding: 13px 18px;
}

.gh.is-tile .stats-panel-head h2 {
  font-size: 0.82rem;
}

.gh.is-tile .stats-panel-sub {
  font-size: 0.5rem;
  letter-spacing: 0.08em;
}

.gh.is-tile .gh-body {
  grid-template-columns: minmax(0, 1.55fr) minmax(220px, 1fr);
  gap: 24px;
  padding: 14px 18px 0;
}

.gh.is-tile .gh-chart {
  max-width: 420px;
}

.gh.is-tile .gh-stat b {
  font-size: 1.05rem;
}

.gh.is-tile .gh-foot {
  padding: 8px 18px 0;
}

@media (max-width: 900px) {
  .gh-body,
  .gh.is-tile .gh-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .gh-repos {
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }
}

@media (max-width: 600px) {
  .gh-stats {
    gap: 10px 18px;
  }

  .gh-stat {
    min-width: 62px;
  }

  .gh-chart {
    max-width: none;
  }

  .gh-legend {
    display: none;
  }

  .gh-readout {
    font-size: 0.46rem;
  }

  .gh-foot {
    flex-direction: column;
    gap: 4px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .gh-loading span {
    animation: none;
    opacity: 0.5;
  }
}
</style>
