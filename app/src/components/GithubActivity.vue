<script setup>
/**
 * GITHUB ACTIVITY 板块：LIFE 长页和仪表盘共用。
 * 数据由 useGithubActivity 提供（模块级单例 + localStorage 缓存 10 分钟），
 * 这里只负责画：合计 / 年初至今的贡献格子图 / 仓库排行。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { GITHUB_USER, useGithubActivity, WEEKS } from '../composables/useGithubActivity.js';

const props = defineProps({
  // panel = 长页里的一块面板；tile = 仪表盘里的 12 列板子
  variant: { type: String, default: 'panel' },
  index: { type: String, default: '08' },
});

const { data, loading, error, warn, at, isStale, load } = useGithubActivity();
const hover = ref(-1);

onMounted(() => {
  load();
  initSnake();
});

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const profileUrl = computed(() => `https://github.com/${GITHUB_USER}`);

const totals = computed(() => data.value?.totals || null);
const cells = computed(() => data.value?.cells || []);
const weeks = computed(() => data.value?.weeks || WEEKS);
const months = computed(() => data.value?.months || []);
const monthly = computed(() => data.value?.monthly || []);
const repos = computed(() => data.value?.repos || []);
const recent = computed(() => data.value?.recent || []);

const monthMax = computed(() => Math.max(1, ...monthly.value.map((m) => m.count)));
const peakMonth = computed(() => monthly.value.reduce((best, m) => (!best || m.count > best.count ? m : best), null));
const avgPerDay = computed(() => {
  const t = totals.value;
  // 缓存里可能缺新字段：宁可显示 —，也不能因为一个 undefined 把整个 LIFE 页的渲染带崩
  const avg = Number(t?.avgPerActiveDay);
  return Number.isFinite(avg) ? avg.toFixed(1) : '—';
});

const staleNow = computed(() => isStale() && !!data.value);

// CONTRIBUTIONS / ACTIVE DAYS / STREAK 是整年的；COMMITS / PR / ISSUE 明细
// 来自公开事件流，只回溯 90 天 —— 下标里的 `·90D` 就是在说这件事
const stats = computed(() => {
  const t = totals.value;
  if (!t) return [];
  const base = [
    { key: 'contributions', label: 'CONTRIBUTIONS', value: fmtNum(t.contributions) },
    { key: 'commits', label: 'COMMITS ·90D', value: fmtNum(t.commits) },
    { key: 'prs', label: 'PULL REQS ·90D', value: fmtNum(t.prs) },
    { key: 'issues', label: 'ISSUES ·90D', value: fmtNum(t.issues) },
    { key: 'active', label: 'ACTIVE DAYS', value: String(t.activeDays) },
    { key: 'streak', label: 'STREAK', value: `${t.streak}D` },
  ];
  return props.variant === 'tile' ? base.slice(0, 4) : base;
});

const updatedLabel = computed(() => {
  if (!at.value) return '';
  const d = new Date(at.value);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
});

const hoverCell = computed(() => (hover.value >= 0 ? cells.value[hover.value] : null));

/* ---------- 贡献蛇 ----------
   照 GitHub snake（Platane/snk）的意思：一条蛇沿格子逐格爬，头经过有活动的
   格子就把它吃掉（这一轮里变空），到终点停一下再从头开始。
   走法是逐列的蛇形：第 0 列从上往下，第 1 列从下往上，接缝处正好相邻。
   指针停在格子上、组件离开视口、reduced-motion 时都不推进。 */

const gridEl = ref(null);
const snakeCells = ref(new Map()); // 格子下标 → 'head' | 'body'
const eatenCells = ref(new Set());
const reducedMotion = ref(false);

const STEP = 110; // 每格毫秒数
const HOLD = 1500; // 到终点后停多久再重来
const START_LEN = 3;
const MAX_LEN = 10;

const cleanupFns = [];

let rafId = 0;
let lastTs = 0;
let acc = 0;
let pos = -1;
let len = START_LEN;
let holdUntil = 0;
let inView = true;
let io = null;
let motionQuery = null;

// 只走「今年今天及以前」的格子：未来那几天不画框，1 月 1 日前的半列同样不爬
const snakePath = computed(() => {
  const list = cells.value;
  const out = [];
  for (let w = 0; w < weeks.value; w += 1) {
    for (let r = 0; r < 7; r += 1) {
      const idx = w * 7 + (w % 2 === 0 ? r : 6 - r);
      const cell = list[idx];
      if (cell && !cell.future && !cell.outside) out.push(idx);
    }
  }
  return out;
});

const snakePaused = computed(
  () => hover.value >= 0 || !inView || reducedMotion.value || !data.value,
);

function resetSnake() {
  pos = -1;
  len = START_LEN;
  holdUntil = 0;
  acc = 0;
  snakeCells.value = new Map();
  eatenCells.value = new Set();
}

function snakeStep() {
  const path = snakePath.value;
  if (!path.length) return;

  if (pos >= path.length - 1) {
    // 尾巴还挂在终点上，停一会儿再整轮重来
    if (!holdUntil) holdUntil = performance.now() + HOLD;
    else if (performance.now() >= holdUntil) resetSnake();
    return;
  }

  pos += 1;
  const idx = path[pos];
  const cell = cells.value[idx];

  if (cell && cell.level > 0 && !eatenCells.value.has(idx)) {
    const next = new Set(eatenCells.value);
    next.add(idx);
    eatenCells.value = next;
    len = Math.min(MAX_LEN, len + 1);
  }

  const map = new Map();
  for (let i = Math.max(0, pos - len + 1); i <= pos; i += 1) {
    map.set(path[i], i === pos ? 'head' : 'body');
  }
  snakeCells.value = map;
}

function snakeFrame(ts) {
  if (!rafId) return;
  rafId = requestAnimationFrame(snakeFrame);
  if (!lastTs) lastTs = ts;
  // 标签页切回来时可能差好几秒，直接丢掉，别让蛇瞬移
  const dt = Math.min(80, ts - lastTs);
  lastTs = ts;

  if (snakePaused.value) {
    acc = 0;
    return;
  }

  acc += dt;
  while (acc >= STEP) {
    acc -= STEP;
    snakeStep();
  }
}

function startLoop() {
  if (rafId || reducedMotion.value) return;
  lastTs = 0;
  acc = 0;
  rafId = requestAnimationFrame(snakeFrame);
}

function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function initSnake() {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion.value = motionQuery.matches;
  const onMotionChange = (e) => {
    reducedMotion.value = e.matches;
    if (e.matches) {
      stopLoop();
      resetSnake();
    } else {
      startLoop();
    }
  };
  motionQuery.addEventListener('change', onMotionChange);
  cleanupFns.push(() => motionQuery?.removeEventListener('change', onMotionChange));

  observeGrid();
  startLoop();
  cleanupFns.push(stopLoop);
}

// 第一次渲染时报错/加载中，gridEl 还不存在：等数据到了再挂观察器
function observeGrid() {
  if (io || !gridEl.value || !('IntersectionObserver' in window)) return;
  io = new IntersectionObserver((entries) => {
    inView = entries.some((e) => e.isIntersecting);
    // 面板滚出视口就彻底停掉 RAF，回来再接着跑
    if (inView) startLoop();
    else stopLoop();
  }, { rootMargin: '120px' });
  io.observe(gridEl.value);
  cleanupFns.push(() => io?.disconnect());
}

onBeforeUnmount(() => {
  while (cleanupFns.length) {
    const fn = cleanupFns.pop();
    try { fn(); } catch {}
  }
});

// 换了一份数据（10 分钟刷新 / 新窗口）就整轮重来
watch(data, async () => {
  resetSnake();
  await nextTick();
  observeGrid();
  startLoop();
});

function fmtNum(n) {
  return (n ?? 0).toLocaleString('en-US');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 相对时间：3M / 5H / 12D —— 缓存 10 分钟，粗到这个粒度就够了
function relTime(iso) {
  const t = new Date(iso).getTime();
  if (!t) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}M`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}H`;
  return `${Math.round(hours / 24)}D`;
}

function shortDay(day) {
  if (!day) return '';
  const [, m, d] = day.split('-');
  return `${MONTHS[Number(m) - 1]} ${d}`;
}

// 格子的 aria：读屏用户拿到的是一整句话，不依赖颜色深浅
function cellLabel(c) {
  if (c.future || c.outside) return '';
  const head = `${shortDay(c.day)}: ${c.count} contributions`;
  if (!c.events) return head;
  return `${head}, ${c.commits} commits, ${c.prs} pull requests, ${c.issues} issues`;
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
        @{{ GITHUB_USER }} · {{ data?.year || '' }} · {{ totals?.windowDays || WEEKS * 7 }}D
      </span>
    </div>

    <div v-if="!data && loading" class="gh-loading" aria-label="Loading GitHub activity">
      <span v-for="n in 308" :key="n"></span>
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

        <!-- 贡献格子图：从 1 月 1 日那周开始，一周一列、一行一个工作日之外的星期，深浅 0–4 级 -->
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

            <div ref="gridEl" class="gh-grid" role="grid" :aria-label="`GitHub activity, ${data?.year || ''} to date`">
              <span
                v-for="(c, i) in cells"
                :key="c.day"
                class="gh-cell"
                :class="[
                  `lvl-${c.level}`,
                  {
                    'is-outside': c.outside,
                    'is-future': c.future,
                    'is-today': c.isToday,
                    'is-eaten': eatenCells.has(i),
                    'is-snake': snakeCells.has(i),
                    'is-snake-head': snakeCells.get(i) === 'head',
                  },
                ]"
                :tabindex="c.future || c.outside ? -1 : 0"
                role="gridcell"
                :aria-label="cellLabel(c)"
                @pointerenter="c.future || c.outside ? null : (hover = i)"
                @pointerleave="hover = -1"
                @focus="c.future || c.outside ? null : (hover = i)"
                @blur="hover = -1"
              ></span>
            </div>
          </div>
        </div>

        <div class="gh-readout" aria-live="off">
          <span v-if="hoverCell && !hoverCell.future && !hoverCell.outside">
            {{ shortDay(hoverCell.day) }} · {{ hoverCell.count }} CONTRIBUTIONS<span v-if="hoverCell.events"> · {{ hoverCell.commits }} COMMITS · {{ hoverCell.prs }} PRs · {{ hoverCell.issues }} ISSUES</span>
          </span>
          <span v-else>{{ totals?.contributions || 0 }} CONTRIBUTIONS · {{ totals?.activeDays || 0 }} ACTIVE DAYS</span>

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

        <!-- 格子图下方：月度柱 + 四个「一眼」数字，把这一列的空洞填满 -->
        <div class="gh-extra">
          <div class="gh-facts">
            <span class="gh-fact">
              <em>BUSIEST DAY</em>
              <b>{{ totals?.busiest ? `${shortDay(totals.busiest.day)} · ${totals.busiest.count}` : '—' }}</b>
            </span>
            <span class="gh-fact">
              <em>BUSIEST WEEKDAY</em>
              <b>{{ totals?.weekdayTop ? `${totals.weekdayTop.label} · ${totals.weekdayTop.count}` : '—' }}</b>
            </span>
            <span class="gh-fact">
              <em>AVG / ACTIVE DAY</em>
              <b>{{ avgPerDay }}</b>
            </span>
            <span class="gh-fact">
              <em>LONGEST RUN</em>
              <b>{{ totals?.longest || 0 }}D</b>
            </span>
          </div>

          <div class="gh-bymonth">
            <div class="gh-bymonth-head">
              <span>BY MONTH · {{ data?.year }}</span>
              <span>{{ peakMonth ? `PEAK ${peakMonth.label} · ${peakMonth.count}` : '' }} / {{ monthly.length }} MONTHS</span>
            </div>
            <div class="gh-bars" :style="{ '--m': monthly.length || 1 }">
              <span
                v-for="m in monthly"
                :key="m.key"
                class="gh-bar"
                :title="`${m.label} · ${m.count} contributions`"
              >
                <b :style="{ height: `${Math.max(3, (m.count / monthMax) * 100)}%` }"></b>
                <i>{{ m.label.slice(0, 1) }}</i>
              </span>
            </div>
          </div>

        </div>
      </div>

      <div class="gh-repos">
        <div class="gh-repos-head">
          <span>TOP REPOSITORIES</span>
          <span>{{ totals?.repos || 0 }} TOUCHED</span>
        </div>

        <!-- 右栏是纯文字列表：仓库排行 + 最近动态。这里不画进度条 / 柱图，
             左栏已经有格子图和月度柱，右栏再来一根根条子就不协调了 -->
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
        </a>

        <p v-if="!repos.length" class="gh-repos-empty">NO PUBLIC EVENTS IN THE WINDOW</p>

        <!-- 最近动态：同样是文字行，跟着仓库排行把右栏填满 -->
        <div v-if="recent.length" class="gh-recent">
          <div class="gh-bymonth-head">
            <span>RECENT EVENTS</span>
            <span>PUBLIC · LAST 90D</span>
          </div>
          <a
            v-for="r in recent"
            :key="r.id"
            class="gh-event"
            :href="r.url"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span class="gh-event-type">{{ r.type }}</span>
            <span class="gh-event-repo">{{ r.repo }}</span>
            <span class="gh-event-at">{{ relTime(r.at) }}</span>
          </a>
        </div>

        <a class="gh-profile" :href="profileUrl" target="_blank" rel="noopener noreferrer">
          OPEN PROFILE <span aria-hidden="true">↗</span>
        </a>
      </div>
    </div>

    <p class="gh-foot">
      <span v-if="error && data" class="gh-foot-err">{{ warn || 'LAST FETCH FAILED' }} · SHOWING CACHE</span>
      <span v-else-if="warn" class="gh-foot-err">{{ warn }}</span>
      <span v-else>{{ data ? `FETCHED ${updatedLabel}` : 'NOT FETCHED' }}</span>
      <span>{{ variant === 'tile' ? 'YEAR TO DATE' : 'CACHED 10 MIN · UNAUTHENTICATED API' }}</span>
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
  margin-top: 14px;
  /* 照 snk 的比例：小方块 + 均匀窄缝，年初至今整条铺满 —— 格子尺寸由列宽自动算 */
  width: 100%;
  max-width: 760px;
  min-width: 0;
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
  position: relative;
  aspect-ratio: 1;
  background: var(--border);
  /* snk 的格子是圆角小方块，间隙均匀 */
  border-radius: 2px;
  cursor: crosshair;
  outline: none;
  transition: opacity 0.15s ease;
}

/* 格子图始终是灰阶：它的第五档颜色是「多/少」，不是某类活动，
   跟着 COLOR 模式变化只会把整张图染成 Work 的蓝。
   也不要在这里写 :global(.is-color) 后代选择器 —— 它会被编译成
   `.is-color{background:…}`，直接给整个 LIFE section 铺底色。 */
.gh-cell.lvl-1 { background: var(--text-primary); opacity: 0.24; }
.gh-cell.lvl-2 { background: var(--text-primary); opacity: 0.42; }
.gh-cell.lvl-3 { background: var(--text-primary); opacity: 0.64; }
.gh-cell.lvl-4 { background: var(--text-primary); opacity: 0.9; }

/* 未来几天不画框：格子图右下角自然收边，和 GitHub 一样；
   1 月 1 日之前那半列同理，只是不占统计 */
.gh-cell.is-future,
.gh-cell.is-outside {
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

/* ---- 蛇：吃过变空，身体整块实心，头上有两点眼睛 ---- */
.gh-cell.is-eaten {
  background: var(--border);
  opacity: 1;
}

/* 身体放大一点点盖住格子缝，视觉上连成一条，和 snk 的蛇一样是连着的 */
.gh-cell.is-snake {
  background: var(--text-primary);
  opacity: 1;
  border-radius: 2px;
  transform: scale(1.14);
  z-index: 1;
}

.gh-cell.is-snake-head {
  transform: scale(1.24);
  z-index: 2;
}

.gh-cell.is-snake-head::before,
.gh-cell.is-snake-head::after {
  content: '';
  position: absolute;
  top: 32%;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--bg);
}

.gh-cell.is-snake-head::before { left: 26%; }
.gh-cell.is-snake-head::after { right: 26%; }

.gh-readout {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-height: 18px;
  margin-top: 8px;
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

/* ---------- 格子图下方：月度柱 + 几个数字 ---------- */

/* 紧贴格子图下方：这块就是「补在蛇图下面的数据」，不留空档 */
.gh-extra {
  padding-top: 10px;
}

.gh-facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px 18px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}

.gh-fact {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.gh-fact em {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.46rem;
  letter-spacing: 0.14em;
  color: var(--text-secondary);
  font-style: normal;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gh-fact b {
  font-family: 'Oswald', sans-serif;
  font-size: 0.94rem;
  font-weight: 500;
  letter-spacing: 0.05em;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gh-bymonth {
  margin-top: 10px;
}

.gh-bymonth-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.46rem;
  letter-spacing: 0.14em;
  color: var(--text-secondary);
}

.gh-bars {
  display: grid;
  grid-template-columns: repeat(var(--m, 12), minmax(0, 1fr));
  gap: 3px;
  margin-top: 7px;
  position: relative;
}

/* 基线画在柱体和月份字母之间：没活动的月份也有一条刻度，不至于看着像空行 */
.gh-bars::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 56px;
  border-top: 1px solid var(--border);
  pointer-events: none;
}

/* 每根柱：上面是可伸缩的柱体区，下面是月份首字母 */
.gh-bar {
  display: grid;
  grid-template-rows: 56px auto;
  row-gap: 4px;
  align-items: end;
  min-width: 0;
}

.gh-bar b {
  display: block;
  width: 100%;
  /* 柱子本身窄一点：太宽会变成一排骨牌，看不出高低 */
  max-width: 22px;
  min-height: 4px;
  margin: 0 auto;
  background: var(--text-primary);
  opacity: 0.5;
  border-radius: 2px 2px 0 0;
}

.gh-bar i {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.4rem;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  font-style: normal;
  text-align: center;
  line-height: 1;
}

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
  /* 比长页里的通用列表再紧一档：右栏是文字清单，不是主列表 */
  padding-top: 7px;
  padding-bottom: 8px;
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

/* ---------- 最近动态 ---------- */

.gh-recent {
  margin-top: 12px;
}

.gh-event {
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 5px 0;
  border-bottom: 1px solid var(--border);
  text-decoration: none;
  color: inherit;
}

.gh-event-type {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.46rem;
  letter-spacing: 0.12em;
  color: var(--text-secondary);
  white-space: nowrap;
}

.gh-event-repo {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.54rem;
  letter-spacing: 0.02em;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gh-event-at {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.46rem;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.gh-event:hover .gh-event-repo,
.gh-event:focus-visible .gh-event-repo {
  text-decoration: underline;
  text-underline-offset: 4px;
}

/* 紧接仓库列表，不要 margin-top:auto 钉到底：那会在右栏中间撑出一整块空白 */
.gh-profile {
  margin-top: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.52rem;
  letter-spacing: 0.14em;
  color: var(--text-primary);
  text-decoration: none;
}

/* 最近动态最后一行本来就带分隔线，这里不要再叠一条 */
.gh-recent + .gh-profile {
  margin-top: 6px;
  padding-top: 8px;
  border-top: none;
}

.gh-profile:hover { text-decoration: underline; text-underline-offset: 4px; }

/* ---------- 状态 ---------- */

.gh-loading {
  display: grid;
  grid-template-columns: repeat(44, minmax(0, 1fr));
  grid-template-rows: repeat(7, minmax(0, 1fr));
  gap: 3px;
  width: min(700px, calc(100% - 44px));
  aspect-ratio: 44 / 7;
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
  max-width: 720px;
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

  /* 手机上一年的格子塞不进一屏：格子保底 9px，整条横向滚动（GitHub 自己也是这么处理） */
  .gh-chart {
    max-width: none;
    overflow-x: auto;
    padding-bottom: 3px;
    scrollbar-width: thin;
  }

  .gh-months {
    min-width: calc(var(--weeks, 44) * 12px);
  }

  .gh-gridwrap {
    min-width: calc(var(--weeks, 44) * 12px + 32px);
  }

  .gh-legend {
    display: none;
  }

  .gh-readout {
    font-size: 0.46rem;
  }

  .gh-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
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
