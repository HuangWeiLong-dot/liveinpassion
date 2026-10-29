<script setup>
// LIFE 的仪表盘视图（dashboard）。
//
// 和长页（feed）是**同一份数据**的两种排法，不是两套页面：
//   · 数据仍然由 LifeView 拉（/api/life 60 秒轮询、/api/life/now 30 秒轮询），
//     这里只接收已经算好的 rows / kpis / rhythmRows / motionRows ……
//   · 视觉沿用 STATS/LIFE 那套语言：Oswald 小标题、JetBrains Mono 微标签、
//     1px 发丝线、方块、分类色（is-color 由外层 section 负责）。
//   · 点击任一图表仍然打开原来的弹窗（单日 / 今日 / RUNNING），不另造一套。
//
// 布局是 12 列网格，靠 1px 的 gap + 边框色画出「一张板子被切成小格」的效果，
// 和 KPI 的 bento 是同一套做法。
import { computed, ref } from 'vue';
import OdometerNumber from './OdometerNumber.vue';
import GithubActivity from './GithubActivity.vue';
import LifeRadar from './LifeRadar.vue';

const props = defineProps({
  rows: { type: Array, default: () => [] },
  kpis: { type: Array, default: () => [] },
  nowSnap: { type: Object, default: null },
  live: { type: Object, default: () => ({}) },
  todayPayload: { type: Object, default: null },
  todayRef: { type: String, default: '' },
  topApps: { type: Array, default: () => [] },
  rhythmRows: { type: Array, default: () => [] },
  rhythmLegend: { type: Array, default: () => [] },
  motionRows: { type: Array, default: () => [] },
  phoneRows: { type: Array, default: () => [] },
  aiRows: { type: Array, default: () => [] },
  weekdayRows: { type: Array, default: () => [] },
  places: { type: Object, default: () => ({}) },
  latestRun: { type: Object, default: null },
  radarRows: { type: Array, default: () => [] },
  archiveTabs: { type: Array, default: () => [] },
  colorMode: { type: Boolean, default: false },
  clock: { type: String, default: '--:--:--' },
  city: { type: String, default: '' },
  lastUpdated: { type: String, default: '—' },
  latestIsToday: { type: Boolean, default: false },
  cmsBase: { type: String, default: '' },
  reduced: { type: Boolean, default: false },
});

const emit = defineEmits(['open-day', 'open-today', 'open-runs']);

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// ── 格式化（和 LifeView 保持同一套口径） ────────────────────────────────

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function hoursLabel(h) {
  return `${(Number(h) || 0).toFixed(1)}h`;
}

function minutesLabel(m) {
  const v = Math.round(Number(m) || 0);
  if (v < 60) return `${v}m`;
  return `${Math.floor(v / 60)}h ${String(v % 60).padStart(2, '0')}m`;
}

function hoursToDuration(h) {
  const v = Number(h);
  return Number.isFinite(v) ? minutesLabel(v * 60) : '—';
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `¥${n.toFixed(2)}` : '—';
}

function mean(values) {
  const valid = values.filter((v) => Number.isFinite(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

function shortDay(d) {
  return d.slice(5).replace('-', '/');
}

function fullDay(d) {
  if (!d) return '—';
  const [, mo, day] = d.split('-');
  return `${MONTHS[Number(mo) - 1]} ${day}`;
}

function weekdayName(d) {
  const date = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '—';
  return ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'][(date.getUTCDay() + 6) % 7];
}

function hhmm(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function paceLabel(seconds) {
  const s = Math.round(Number(seconds));
  if (!Number.isFinite(s) || s <= 0) return '—';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} /KM`;
}

// 取窗口里最后一个有这一项数据的整天（不是 rows 的最后一根 —— 今天可能还没同步）。
function lastWith(list, key) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.[key] != null) return list[i];
  }
  return null;
}

// ── NOW ─────────────────────────────────────────────────────────────────

const loc = computed(() => props.nowSnap?.location || null);
const qa = computed(() => props.nowSnap?.qa || null);

const placeName = computed(() => {
  const l = loc.value;
  if (!l) return 'NO LOCATION';
  const main = l.district || l.city || '—';
  return l.area && l.area !== l.district ? `${main} · ${l.area}` : main;
});

const mapUrl = computed(() => {
  const l = loc.value;
  if (!l || l.lat == null || l.lon == null) return '';
  return `https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lon}#map=16/${l.lat}/${l.lon}`;
});

const nowRows = computed(() => {
  const d = props.live?.desktop || {};
  const p = props.live?.phone || {};
  const rows = [
    { key: 'desktop', name: 'DESKTOP', status: d.label || '—', note: d.note || 'NO DESKTOP DATA', tone: d.tone || 'unknown' },
    { key: 'phone', name: 'PHONE', status: p.label || '—', note: p.note || 'NO PHONE DATA', tone: p.tone || 'unknown' },
  ];
  // 手表可能比其它来源滞后；同步状态放在第三行，没有就不占位。
  const w = props.nowSnap?.watch;
  if (w) {
    rows.push({
      key: 'watch',
      name: 'WATCH',
      status: w.hrAvg != null ? `${Math.round(w.hrAvg)} BPM` : (w.steps != null ? `${fmt(w.steps)} STEPS` : 'SYNCED'),
      note: [w.steps != null ? `${fmt(w.steps)} STEPS` : '', w.synced ? '' : 'NOT TODAY']
        .filter(Boolean).join(' · ') || 'NO STEP DATA',
      tone: w.synced ? 'on' : 'off',
    });
  }
  return rows;
});

const placeMeta = computed(() => {
  const l = loc.value;
  if (!l) return '';
  return [
    l.stayMinutes ? minutesLabel(l.stayMinutes) : '',
    l.lastSeen ? `SEEN ${hhmm(l.lastSeen)}` : '',
    l.stale ? 'NOT TODAY' : '',
  ].filter(Boolean).join(' · ');
});

// ── TODAY ───────────────────────────────────────────────────────────────

const today = computed(() => props.todayPayload || null);

const todayDesktop = computed(() => hoursToDuration(today.value?.trackedHours));

const todayPhone = computed(() => (
  today.value?.phone?.screenMinutes == null
    ? '—'
    : minutesLabel(today.value.phone.screenMinutes)
));

const todayUnlocks = computed(() => (
  today.value?.phone?.unlocks == null ? '—' : fmt(today.value.phone.unlocks)
));

const todayAi = computed(() => money(today.value?.ai?.cost));

const todayApps = computed(() => (today.value?.topApps || []).slice(0, 3).map(([name, hours], i) => ({
  name,
  hours: Number(hours) || 0,
  rank: String(i + 1).padStart(2, '0'),
})));

// ── 三张迷你柱线：步数 / 解锁 / AI ──────────────────────────────────────

function miniSummary(rows, key, formatter) {
  const last = lastWith(rows, key);
  const avg = mean(rows.map((r) => r[key]));
  return {
    today: last ? formatter(last[key]) : '—',
    todayDay: last?.day || '',
    isToday: !!last?.isToday,
    avg: avg == null ? '—' : formatter(avg),
  };
}

const stepsSummary = computed(() => miniSummary(props.motionRows, 'steps', (v) => fmt(Math.round(v))));
const phoneSummary = computed(() => miniSummary(props.phoneRows, 'unlocks', (v) => fmt(Math.round(v))));
const aiSummary = computed(() => miniSummary(props.aiRows, 'cost', (v) => money(v)));

const aiTotal = computed(() => {
  const values = props.aiRows.map((r) => r.cost).filter((v) => Number.isFinite(v));
  return values.length ? money(values.reduce((a, b) => a + b, 0)) : '—';
});

// ── 悬停读数（每张图各自记，不互相干扰） ───────────────────────────────

const rhythmHover = ref(-1);
const motionHover = ref(-1);
const phoneHover = ref(-1);
const aiHover = ref(-1);
const weekdayHover = ref(-1);

const rhythmHoverRow = computed(() => props.rhythmRows[rhythmHover.value] || null);
const motionHoverRow = computed(() => props.motionRows[motionHover.value] || null);
const phoneHoverRow = computed(() => props.phoneRows[phoneHover.value] || null);
const aiHoverRow = computed(() => props.aiRows[aiHover.value] || null);
const weekdayHoverRow = computed(() => props.weekdayRows[weekdayHover.value] || null);

const rhythmSub = computed(() => {
  const r = rhythmHoverRow.value;
  if (r) return `${fullDay(r.day)} · ${r.total == null ? 'NO DATA' : hoursLabel(r.total)}`;
  return `${props.rhythmRows.length}D · DESKTOP + GPS + WATCH + PHONE`;
});

const weekdayChips = computed(() => {
  const valid = props.weekdayRows.filter((d) => d.total != null);
  const busiest = [...valid].sort((a, b) => b.total - a.total)[0];
  const quietest = [...valid].sort((a, b) => a.total - b.total)[0];
  return [
    { label: 'BUSIEST', value: busiest ? busiest.label : '—' },
    { label: 'QUIETEST', value: quietest ? quietest.label : '—' },
  ];
});

// ── 最近一跑 ────────────────────────────────────────────────────────────

const runPace = computed(() => {
  const r = props.latestRun;
  if (!r) return '—';
  if (r.paceS) return paceLabel(r.paceS);
  if (r.km && r.minutes) return paceLabel((r.minutes * 60) / r.km);
  return '—';
});

const runWhen = computed(() => {
  const r = props.latestRun;
  if (!r) return '—';
  return `${fullDay(r.day)} · ${hhmm(r.start)}`;
});

const archiveCount = computed(() => (
  props.archiveTabs.reduce((a, t) => a + (t.count || 0), 0)
));

function openDay(day) {
  if (day) emit('open-day', day);
}
</script>

<template>
  <div class="life-dash">
    <!-- 01 NOW -->
    <article class="dash-tile span-7 dash-now">
      <div class="stats-panel-head">
        <div class="stats-panel-title">
          <span class="stats-panel-index">01</span>
          <h2>NOW</h2>
        </div>
        <span class="stats-panel-sub">
          {{ live?.live ? `UPDATED ${live.updated}` : 'WAITING FOR LIVE SNAPSHOT' }}
        </span>
      </div>

      <div class="dash-now-body">
        <div class="dash-now-place">
          <span class="dash-now-flag" :class="{ 'is-on': live?.location?.tone === 'on' }">
            {{ live?.location?.label || '—' }}
          </span>
          <strong>{{ placeName }}</strong>
          <a v-if="mapUrl" :href="mapUrl" target="_blank" rel="noopener" class="dash-now-map">
            MAP ↗
          </a>
          <span v-if="placeMeta" class="dash-now-meta">{{ placeMeta }}</span>
        </div>

        <div class="dash-now-columns">
          <div class="dash-now-rows">
            <div
              v-for="row in nowRows"
              :key="row.key"
              class="dash-now-row"
            >
              <em>{{ row.name }}</em>
              <b :class="`is-${row.tone}`">{{ row.status }}</b>
              <span>{{ row.note }}</span>
            </div>
          </div>

          <div class="dash-now-qa">
            <em>LIVE Q&amp;A</em>
            <strong v-if="qa">{{ qa.answer || '—' }}</strong>
            <strong v-else class="is-muted">NO ANSWER YET</strong>
            <span v-if="qa?.question">{{ qa.question }}</span>
            <span v-if="qa" class="dash-now-qa-age">{{ hhmm(qa.ts) }}</span>
          </div>
        </div>
      </div>
    </article>

    <!-- 02 TODAY -->
    <article
      class="dash-tile span-5 dash-today"
      :class="{ 'is-clickable': !!today }"
      :role="today ? 'button' : undefined"
      :tabindex="today ? 0 : undefined"
      aria-label="Open today's desktop details"
      @click="today && emit('open-today', 'desktop')"
      @keydown.enter.prevent="today && emit('open-today', 'desktop')"
      @keydown.space.prevent="today && emit('open-today', 'desktop')"
    >
      <div class="stats-panel-head">
        <div class="stats-panel-title">
          <span class="stats-panel-index">02</span>
          <h2>TODAY</h2>
        </div>
        <span class="stats-panel-sub">
          {{ today ? `${todayRef.split('-').reverse().join('.')} · SO FAR` : 'NO SNAPSHOT YET' }}
        </span>
      </div>

      <div v-if="today" class="dash-today-body">
        <div class="dash-today-main">
          <strong>{{ todayDesktop }}</strong>
          <span>DESKTOP · WINDOW-ACTIVE</span>
        </div>
        <div class="dash-today-grid">
          <span><em>PHONE</em><b>{{ todayPhone }}</b></span>
          <span><em>UNLOCKS</em><b>{{ todayUnlocks }}</b></span>
          <span><em>AI SPEND</em><b>{{ todayAi }}</b></span>
        </div>
        <div class="dash-today-apps">
          <span v-for="a in todayApps" :key="a.name">
            <i>{{ a.rank }}</i>{{ a.name }}<b>{{ hoursLabel(a.hours) }}</b>
          </span>
        </div>
      </div>
      <p v-else class="dash-empty">TODAY HAS NOT BEEN AGGREGATED YET.</p>
    </article>

    <!-- 03 KPI：6 张读数卡，复用 .stat-card 的排版与反色悬浮 -->
    <article
      v-for="(card, i) in kpis"
      :key="card.key"
      class="stat-card dash-kpi span-2"
      :class="{ 'is-openable': card.key === 'screen' }"
      :role="card.key === 'screen' ? 'button' : undefined"
      :tabindex="card.key === 'screen' ? 0 : undefined"
      @click="card.key === 'screen' && emit('open-today', 'screen')"
      @keydown.enter.prevent="card.key === 'screen' && emit('open-today', 'screen')"
      @keydown.space.prevent="card.key === 'screen' && emit('open-today', 'screen')"
    >
      <div class="stat-card-head">
        <span class="stat-index">{{ String(i + 1).padStart(2, '0') }}</span>
        <span class="stat-eyebrow">{{ card.label }}</span>
      </div>
      <div class="stat-number-wrap">
        <OdometerNumber
          v-if="card.value !== null"
          class="stat-number"
          :value="card.value"
          :run="1"
          :delay="card.delay"
          :reduced="reduced"
        />
        <span v-else class="stat-number life-null">—</span>
      </div>
      <div class="stat-card-foot">
        <span class="stat-note">{{ card.note }}</span>
        <span v-if="card.key === 'screen'" class="stat-trend stat-open">
          VIEW <i aria-hidden="true">→</i>
        </span>
      </div>
    </article>

    <!-- 04 七维雷达：compact 版，只收起右侧列表 -->
    <article class="dash-tile span-5">
      <div class="stats-panel-head">
        <div class="stats-panel-title">
          <span class="stats-panel-index">04</span>
          <h2>SEVEN-DIMENSION</h2>
        </div>
        <span class="stats-panel-sub">OTHER EXCLUDED</span>
      </div>
      <LifeRadar
        compact
        :rows="radarRows"
        :color-mode="colorMode"
        :cms-base="cmsBase"
      />
    </article>

    <!-- 05 每日节奏 -->
    <article class="dash-tile span-7">
      <div class="stats-panel-head">
        <div class="stats-panel-title">
          <span class="stats-panel-index">05</span>
          <h2>DAILY RHYTHM</h2>
        </div>
        <span class="stats-panel-sub">Click a day for the full breakdown</span>
      </div>

      <div class="dash-chart-body">
        <div class="dash-chart dash-rhythm">
          <div class="stats-chart-grid" aria-hidden="true"><i></i><i></i><i></i></div>
          <div class="life-bars" :class="{ 'is-hovering': rhythmHover >= 0 }">
            <div
              v-for="(r, i) in rhythmRows"
              :key="r.day"
              class="life-col"
              :class="{ 'is-missing': r.missing, 'is-today': r.isToday }"
              tabindex="0"
              role="img"
              :aria-label="`${fullDay(r.day)}: ${r.total == null ? 'no desktop data' : hoursLabel(r.total)}`"
              @pointerenter="rhythmHover = i"
              @pointerleave="rhythmHover = -1"
              @focus="rhythmHover = i"
              @blur="rhythmHover = -1"
              @click="openDay(r.day)"
              @keydown.enter.prevent="openDay(r.day)"
            >
              <div
                v-if="r.segments.length"
                class="life-stack"
                :style="{ height: `${r.pct}%` }"
              >
                <span
                  v-for="s in r.segments"
                  :key="s.name"
                  class="life-seg"
                  :class="`cat-${s.cat}`"
                  :style="{ flexGrow: s.hours }"
                ></span>
              </div>
            </div>
          </div>
        </div>

        <div class="dash-readout">
          <span>{{ rhythmSub }}</span>
          <span class="dash-readout-legend">
            <i v-for="c in rhythmLegend" :key="c.name" :class="{ 'is-zero': c.zero }">
              <b class="life-swatch" :class="`cat-${c.index}`"></b>{{ c.name }}
            </i>
          </span>
        </div>

        <div class="dash-axis" aria-hidden="true">
          <span v-for="r in rhythmRows" :key="r.day">{{ r.showLabel ? shortDay(r.day) : '' }}</span>
        </div>
      </div>
    </article>

    <!-- 06 / 07 / 08 三张迷你柱线 -->
    <article class="dash-tile span-4">
      <div class="stats-panel-head">
        <div class="stats-panel-title">
          <span class="stats-panel-index">06</span>
          <h2>MOTION</h2>
        </div>
        <span class="stats-panel-sub">STEPS</span>
      </div>
      <div class="dash-mini">
        <div class="dash-mini-main">
          <strong>{{ motionHoverRow ? fmt(motionHoverRow.steps ?? 0) : stepsSummary.today }}</strong>
          <span>
            {{ motionHoverRow ? fullDay(motionHoverRow.day) : `${stepsSummary.isToday ? 'TODAY' : 'LATEST'} · AVG ${stepsSummary.avg}` }}
          </span>
        </div>
        <div class="dash-mini-chart">
          <div class="life-bars" :class="{ 'is-hovering': motionHover >= 0 }">
            <div
              v-for="(r, i) in motionRows"
              :key="r.day"
              class="life-col"
              :class="{ 'is-missing': r.missing, 'is-today': r.isToday }"
              @pointerenter="motionHover = i"
              @pointerleave="motionHover = -1"
              @click="openDay(r.day)"
            >
              <span v-if="!r.missing" class="life-bar" :style="{ height: `${r.pct}%` }"></span>
            </div>
          </div>
        </div>
      </div>
    </article>

    <article class="dash-tile span-4">
      <div class="stats-panel-head">
        <div class="stats-panel-title">
          <span class="stats-panel-index">07</span>
          <h2>PHONE</h2>
        </div>
        <span class="stats-panel-sub">UNLOCKS</span>
      </div>
      <div class="dash-mini">
        <div class="dash-mini-main">
          <strong>{{ phoneHoverRow ? fmt(phoneHoverRow.unlocks ?? 0) : phoneSummary.today }}</strong>
          <span>
            {{ phoneHoverRow ? fullDay(phoneHoverRow.day) : `${phoneSummary.isToday ? 'TODAY' : 'LATEST'} · AVG ${phoneSummary.avg}` }}
          </span>
        </div>
        <div class="dash-mini-chart">
          <div class="life-bars" :class="{ 'is-hovering': phoneHover >= 0 }">
            <div
              v-for="(r, i) in phoneRows"
              :key="r.day"
              class="life-col"
              :class="{ 'is-missing': r.missing, 'is-today': r.isToday }"
              @pointerenter="phoneHover = i"
              @pointerleave="phoneHover = -1"
              @click="openDay(r.day)"
            >
              <span v-if="!r.missing" class="life-bar" :style="{ height: `${r.pct}%` }"></span>
            </div>
          </div>
        </div>
      </div>
    </article>

    <article class="dash-tile span-4 dash-ai-tile">
      <div class="stats-panel-head">
        <div class="stats-panel-title">
          <span class="stats-panel-index">08</span>
          <h2>AI SPEND</h2>
        </div>
        <span class="stats-panel-sub">{{ aiTotal }} · WINDOW TOTAL</span>
      </div>
      <div class="dash-mini">
        <div class="dash-mini-main">
          <strong>{{ aiHoverRow ? money(aiHoverRow.cost ?? 0) : aiSummary.today }}</strong>
          <span>
            {{ aiHoverRow ? fullDay(aiHoverRow.day) : `${aiSummary.isToday ? 'TODAY' : 'LATEST'} · AVG ${aiSummary.avg}` }}
          </span>
        </div>
        <div class="dash-mini-chart">
          <div class="life-bars" :class="{ 'is-hovering': aiHover >= 0 }">
            <div
              v-for="(r, i) in aiRows"
              :key="r.day"
              class="life-col"
              :class="{ 'is-missing': r.missing, 'is-today': r.isToday }"
              @pointerenter="aiHover = i"
              @pointerleave="aiHover = -1"
              @click="openDay(r.day)"
            >
              <span v-if="!r.missing" class="life-bar" :style="{ height: `${r.pct}%` }"></span>
            </div>
          </div>
        </div>
      </div>
    </article>

    <!-- 09 PLACES -->
    <article class="dash-tile span-5">
      <div class="stats-panel-head">
        <div class="stats-panel-title">
          <span class="stats-panel-index">09</span>
          <h2>PLACES</h2>
        </div>
        <span class="stats-panel-sub">{{ places?.city || city }} · {{ places?.cityCount || 0 }} CITIES</span>
      </div>

      <div class="dash-places">
        <div
          v-for="(row, i) in (places?.rows || []).slice(0, 5)"
          :key="row.name"
          class="life-row"
        >
          <span class="life-rank">{{ String(i + 1).padStart(2, '0') }}</span>
          <span class="life-name">{{ row.name }}</span>
          <span class="life-num">{{ hoursLabel(row.hours) }}</span>
          <span class="life-track"><span class="life-fill" :style="{ width: row.pct + '%' }"></span></span>
        </div>
        <p v-if="!places?.rows?.length" class="dash-empty">NO LOCATION DATA YET.</p>
        <div class="dash-chips">
          <span v-for="c in (places?.chips || []).slice(0, 3)" :key="c.label" class="life-chip">
            <em>{{ c.label }}</em><b>{{ c.value }}</b>
          </span>
        </div>
      </div>
    </article>

    <!-- 10 最近一跑 -->
    <article
      class="dash-tile span-7 dash-run"
      :class="{ 'is-clickable': !!latestRun }"
      :role="latestRun ? 'button' : undefined"
      :tabindex="latestRun ? 0 : undefined"
      aria-label="Open all runs"
      @click="latestRun && emit('open-runs')"
      @keydown.enter.prevent="latestRun && emit('open-runs')"
      @keydown.space.prevent="latestRun && emit('open-runs')"
    >
      <div class="stats-panel-head">
        <div class="stats-panel-title">
          <span class="stats-panel-index">10</span>
          <h2>LATEST RUN</h2>
        </div>
        <span class="stats-panel-sub">
          {{ latestRun ? runWhen : 'NO RUNS IN THIS WINDOW' }}
          <template v-if="latestRun?.watchOnly"> · WATCH ONLY</template>
        </span>
      </div>

      <div v-if="latestRun" class="dash-run-body">
        <div class="dash-run-numbers">
          <strong>
            {{ latestRun.km != null ? Number(latestRun.km).toFixed(2) : '—' }}<small>KM</small>
          </strong>
          <div>
            <span><em>TIME</em><b>{{ latestRun.minutes ? minutesLabel(latestRun.minutes) : '—' }}</b></span>
            <span><em>PACE</em><b>{{ runPace }}</b></span>
            <span><em>NAME</em><b>{{ latestRun.name || 'RUN' }}</b></span>
          </div>
        </div>

        <div class="dash-run-route">
          <svg
            v-if="latestRun.route"
            :viewBox="`0 0 ${latestRun.route.width} ${latestRun.route.height}`"
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          >
            <path :d="latestRun.route.d" class="life-run-route-line" />
            <circle
              :cx="latestRun.route.start.x"
              :cy="latestRun.route.start.y"
              r="2.6"
              class="life-run-route-dot is-start"
            />
            <circle
              :cx="latestRun.route.end.x"
              :cy="latestRun.route.end.y"
              r="2.6"
              class="life-run-route-dot is-end"
            />
          </svg>
          <span v-else class="dash-empty">NO ROUTE</span>
        </div>
      </div>
      <p v-else class="dash-empty">NO RUNS IN THIS WINDOW.</p>
    </article>

    <!-- 11 TOP APPLICATIONS -->
    <article class="dash-tile span-6">
      <div class="stats-panel-head">
        <div class="stats-panel-title">
          <span class="stats-panel-index">11</span>
          <h2>TOP APPLICATIONS</h2>
        </div>
        <span class="stats-panel-sub">{{ topApps.length }} APPS · WINDOW TOTAL</span>
      </div>
      <div class="dash-apps">
        <div v-for="a in topApps.slice(0, 6)" :key="a.name" class="life-row">
          <span class="life-rank">{{ a.rank }}</span>
          <span class="life-name">{{ a.name }}</span>
          <span class="life-num">{{ hoursLabel(a.hours) }}</span>
          <span class="life-track"><span class="life-fill" :style="{ width: a.pct + '%' }"></span></span>
        </div>
        <p v-if="!topApps.length" class="dash-empty">NO DESKTOP ACTIVITY YET.</p>
      </div>
    </article>

    <!-- 12 WEEKDAY -->
    <article class="dash-tile span-6">
      <div class="stats-panel-head">
        <div class="stats-panel-title">
          <span class="stats-panel-index">12</span>
          <h2>WEEKDAY PROFILE</h2>
        </div>
        <span class="stats-panel-sub">AVERAGE PER WEEKDAY</span>
      </div>

      <div class="dash-weekday">
        <div class="life-weekday-rows">
          <div
            v-for="(d, i) in weekdayRows"
            :key="d.label"
            class="life-weekday-row"
            :class="{ 'is-empty': d.total == null, 'is-hover': weekdayHover === i }"
            @pointerenter="weekdayHover = i"
            @pointerleave="weekdayHover = -1"
          >
            <span class="life-weekday-label">{{ d.label }}</span>
            <span class="life-weekday-track">
              <span class="life-weekday-bar" :style="{ width: d.pct + '%' }">
                <span
                  v-for="s in d.segments"
                  :key="s.name"
                  class="life-seg"
                  :class="`cat-${s.cat}`"
                  :style="{ flexGrow: s.hours }"
                ></span>
              </span>
            </span>
            <span class="life-weekday-value">{{ d.total == null ? '—' : hoursLabel(d.total) }}</span>
            <span class="life-weekday-count">{{ d.days }}d</span>
          </div>
        </div>
        <div class="dash-chips">
          <span v-for="c in weekdayChips" :key="c.label" class="life-chip">
            <em>{{ c.label }}</em><b>{{ c.value }}</b>
          </span>
          <span v-if="weekdayHoverRow?.total != null" class="life-chip life-chip-live">
            <em>{{ weekdayHoverRow.label }}</em><b>{{ hoursLabel(weekdayHoverRow.total) }} avg</b>
          </span>
        </div>
      </div>
    </article>

    <!-- 13 GitHub 公开事件：数据自己拉（useGithubActivity），不占 LifeView 的 props -->
    <article class="dash-tile span-12 dash-github">
      <GithubActivity variant="tile" index="13" />
    </article>

    <!-- 14 归档入口 -->
    <article class="dash-tile span-12">
      <div class="stats-panel-head">
        <div class="stats-panel-title">
          <span class="stats-panel-index">14</span>
          <h2>THE ARCHIVE</h2>
        </div>
        <span class="stats-panel-sub">{{ archiveCount }} ENTRIES · UNFILTERED</span>
      </div>
      <div class="dash-archive">
        <router-link
          v-for="t in archiveTabs"
          :key="t.kind"
          :to="`/life/archive/${t.kind}`"
          class="dash-archive-link"
        >
          <span>{{ t.label }}</span>
          <b>{{ t.count }}</b>
        </router-link>
      </div>
    </article>
  </div>
</template>

<style scoped>
/* 12 列板子：1px 的 gap 露出背景色 = 发丝线，和 KPI bento 同一套做法 */
.life-dash {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  margin-top: 26px;
}

.span-2 { grid-column: span 2; }
.span-4 { grid-column: span 4; }
.span-5 { grid-column: span 5; }
.span-6 { grid-column: span 6; }
.span-7 { grid-column: span 7; }
.span-12 { grid-column: span 12; }

.dash-tile {
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.dash-tile .stats-panel-head {
  padding: 13px 18px;
  gap: 6px 12px;
}

.dash-tile .stats-panel-head h2 {
  font-size: 0.82rem;
}

.dash-tile .stats-panel-sub {
  font-size: 0.5rem;
  letter-spacing: 0.08em;
  text-align: right;
}

.dash-tile.is-clickable {
  cursor: pointer;
}

/* ---------- KPI ---------- */

.dash-kpi.stat-card {
  min-height: 148px;
  padding: 18px 20px 16px;
  gap: 12px;
}

.dash-kpi.stat-card .stat-number {
  font-size: clamp(1.5rem, 2.1vw, 2.1rem);
}

.dash-kpi.stat-card .stat-number-wrap {
  margin-top: auto;
}

.dash-kpi.stat-card .stat-note {
  font-size: 0.5rem;
}

/* ---------- NOW ---------- */

.dash-now-body {
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.dash-now-place {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
}

.dash-now-flag {
  padding: 2px 6px;
  border: 1px solid var(--border);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.46rem;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.dash-now-flag.is-on {
  border-color: var(--text-primary);
  background: var(--text-primary);
  color: var(--bg);
}

.dash-now-place strong {
  font-family: 'Oswald', sans-serif;
  font-size: 1.15rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--text-primary);
}

.dash-now-map {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.5rem;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
  text-decoration: none;
  border-bottom: 1px solid var(--border);
}

.dash-now-map:hover {
  color: var(--text-primary);
  border-bottom-color: var(--text-primary);
}

.dash-now-meta {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.46rem;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
  white-space: nowrap;
}

.dash-now-columns {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.dash-now-rows {
  display: grid;
  grid-template-columns: 1fr;
}

.dash-now-row {
  display: grid;
  grid-template-columns: 66px 84px minmax(0, 1fr);
  align-items: baseline;
  gap: 10px;
  padding: 7px 0;
  border-top: 1px solid var(--border);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.5rem;
  letter-spacing: 0.08em;
  min-width: 0;
}

.dash-now-row em {
  font-style: normal;
  color: var(--text-secondary);
  opacity: 0.7;
}

.dash-now-row b {
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
}

.dash-now-row b.is-off {
  color: var(--text-secondary);
}

.dash-now-row b.is-unknown {
  color: var(--text-secondary);
}

.dash-now-row span,
.dash-now-row > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}

.dash-now-qa {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-left: 18px;
  border-left: 1px solid var(--border);
  min-width: 0;
}

.dash-now-qa em {
  font-style: normal;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.46rem;
  letter-spacing: 0.12em;
  color: var(--text-secondary);
}

.dash-now-qa strong {
  font-family: 'Oswald', sans-serif;
  font-size: 1.05rem;
  font-weight: 500;
  line-height: 1.2;
  color: var(--text-primary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.dash-now-qa strong.is-muted {
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.5rem;
  letter-spacing: 0.1em;
}

.dash-now-qa > span {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.48rem;
  letter-spacing: 0.06em;
  line-height: 1.6;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.dash-now-qa-age {
  margin-top: auto;
  opacity: 0.7;
}

/* ---------- TODAY ---------- */

.dash-today-body {
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dash-today-main strong {
  display: block;
  font-family: 'Oswald', sans-serif;
  font-size: clamp(1.9rem, 3vw, 2.6rem);
  font-weight: 600;
  line-height: 1;
  color: var(--text-primary);
}

.dash-today-main span {
  display: block;
  margin-top: 6px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.5rem;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
}

.dash-today-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.dash-today-grid > span {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 9px 0;
  min-width: 0;
}

.dash-today-grid > span + span {
  padding-left: 12px;
  border-left: 1px solid var(--border);
}

.dash-today-grid em {
  font-style: normal;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.46rem;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
}

.dash-today-grid b {
  font-family: 'Oswald', sans-serif;
  font-size: 1rem;
  font-weight: 500;
  color: var(--text-primary);
}

.dash-today-apps {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.dash-today-apps span {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.5rem;
  letter-spacing: 0.06em;
  color: var(--text-primary);
  min-width: 0;
}

.dash-today-apps i {
  font-style: normal;
  color: var(--text-secondary);
  opacity: 0.6;
}

.dash-today-apps b {
  margin-left: auto;
  font-weight: 400;
  color: var(--text-secondary);
  white-space: nowrap;
}

/* ---------- 图 ---------- */

.dash-chart-body {
  padding: 16px 18px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
}

.dash-chart {
  position: relative;
  height: 156px;
}

.dash-rhythm .stats-chart-grid {
  inset: 0;
}

.dash-readout {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 14px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.48rem;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.dash-readout-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
}

.dash-readout-legend i {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-style: normal;
}

.dash-readout-legend i.is-zero {
  opacity: 0.35;
}

.dash-readout-legend b {
  width: 7px;
  height: 7px;
  display: inline-block;
  background: var(--text-primary);
  font-weight: 400;
}

.dash-axis {
  display: flex;
  gap: 4px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.44rem;
  letter-spacing: 0.02em;
  color: var(--text-secondary);
}

.dash-axis span {
  flex: 1;
  min-width: 0;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
}

/* ---------- 迷你柱线 ---------- */

.dash-mini {
  padding: 14px 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
}

.dash-mini-main strong {
  display: block;
  font-family: 'Oswald', sans-serif;
  font-size: clamp(1.6rem, 2.4vw, 2.2rem);
  font-weight: 600;
  line-height: 1;
  color: var(--text-primary);
}

.dash-mini-main span {
  display: block;
  margin-top: 5px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.46rem;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dash-mini-chart {
  position: relative;
  height: 82px;
  margin-top: auto;
}

/* ---------- PLACES / TOP APPS ---------- */

.dash-places,
.dash-apps {
  padding: 12px 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  flex: 1;
}

.dash-places .life-row,
.dash-apps .life-row {
  align-items: center;
}

.dash-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

/* ---------- RUN ---------- */

.dash-run-body {
  padding: 16px 18px 18px;
  display: flex;
  align-items: stretch;
  gap: 18px;
  flex: 1;
}

.dash-run-numbers {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
}

.dash-run-numbers > strong {
  font-family: 'Oswald', sans-serif;
  font-size: clamp(2rem, 3.2vw, 2.8rem);
  font-weight: 600;
  line-height: 1;
  color: var(--text-primary);
}

.dash-run-numbers > strong small {
  font-size: 0.34em;
  letter-spacing: 0.16em;
  margin-left: 6px;
  color: var(--text-secondary);
}

.dash-run-numbers > div {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 26px;
}

.dash-run-numbers span {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.dash-run-numbers em {
  font-style: normal;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.46rem;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
}

.dash-run-numbers b {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.56rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: var(--text-primary);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dash-run-route {
  flex: 0 0 42%;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-left: 1px solid var(--border);
  padding-left: 18px;
}

.dash-run-route svg {
  width: 100%;
  height: 100%;
  max-height: 132px;
}

/* ---------- WEEKDAY ---------- */

.dash-weekday {
  padding: 8px 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.dash-weekday .life-weekday-rows {
  padding: 0;
}

/* ---------- ARCHIVE ---------- */

.dash-archive {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 1px;
  background: var(--border);
  flex: 1;
}

.dash-archive-link {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  background: var(--bg);
  color: var(--text-secondary);
  text-decoration: none;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.5rem;
  letter-spacing: 0.1em;
  transition: background 0.2s ease, color 0.2s ease;
}

.dash-archive-link b {
  font-weight: 400;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.dash-archive-link:hover {
  background: var(--text-primary);
  color: var(--bg);
}

.dash-archive-link:hover b {
  color: var(--bg);
}

/* ---------- 空态 ---------- */

.dash-empty {
  margin: 0;
  padding: 16px 18px 18px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.5rem;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

/* ---------- 响应式 ---------- */

@media (max-width: 1180px) {
  .dash-now,
  .dash-today { grid-column: span 12; }
  .dash-kpi { grid-column: span 4; }
  .dash-kpi.stat-card { min-height: 138px; }
  .dash-tile.span-5,
  .dash-tile.span-7 { grid-column: span 12; }
  .dash-tile.span-4 { grid-column: span 6; }
  .dash-ai-tile { grid-column: span 12; }
  .dash-tile.span-6 { grid-column: span 12; }
  .dash-archive { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}

@media (max-width: 760px) {
  .dash-kpi { grid-column: span 6; }
  .dash-tile.span-4 { grid-column: span 12; }
  .dash-now-columns { grid-template-columns: 1fr; }
  .dash-now-qa {
    padding-left: 0;
    border-left: 0;
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }
  .dash-now-row { grid-template-columns: 64px minmax(0, 1fr); }
  .dash-now-row > span { display: none; }
  .dash-run-body { flex-direction: column; }
  .dash-run-route {
    border-left: 0;
    border-top: 1px solid var(--border);
    padding: 12px 0 0;
    flex: 0 0 auto;
  }
  .dash-run-route svg { max-height: 120px; }
  .dash-archive { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 480px) {
  .dash-kpi { grid-column: span 12; }
  .dash-kpi.stat-card { min-height: 124px; }
  .dash-today-grid { grid-template-columns: 1fr; }
  .dash-today-grid > span + span {
    padding-left: 0;
    border-left: 0;
    border-top: 1px solid var(--border);
  }
  .dash-readout-legend { display: none; }
}
</style>
