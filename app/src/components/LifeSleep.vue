<template>
  <!-- 紧凑模式：dashboard 的 dash-mini 小卡，和 MOTION / PHONE 同一种排法 -->
  <div v-if="compact" class="dash-mini">
    <div class="dash-mini-main">
      <strong>{{ hoverRow ? (hoverRow.hours == null ? '—' : `${hoverRow.hours.toFixed(1)}h`) : latestText }}</strong>
      <span>{{ hoverRow ? fullDay(hoverRow.day) : latestCaption }}</span>
    </div>
    <div class="dash-mini-chart">
      <div class="life-bars" :class="{ 'is-hovering': hover >= 0 }">
        <div
          v-for="(r, i) in rows"
          :key="r.day"
          class="life-col"
          :class="{ 'is-missing': r.missing, 'is-today': r.isToday }"
          @pointerenter="hover = i"
          @pointerleave="hover = -1"
        >
          <span
            v-if="!r.missing"
            class="mbar"
            :style="{ bottom: r.bottom + '%', height: r.height + '%' }"
          ></span>
        </div>
      </div>
    </div>
  </div>

  <!-- 长页模式：和其他面板同一套 plot / y 轴 / x 轴 / chips -->
  <div v-else-if="!hasData" class="life-chart life-empty-note">
    <p class="stats-empty">No sleep window recorded in this window.</p>
    <p class="ls-hint">
      It is inferred from phone / desktop silence — the watch has no sleep sensor.
      A day with no signal stays missing; it never becomes a zero.
    </p>
  </div>

  <div v-else class="life-chart">
    <div class="life-main-col">
      <div class="life-chart-main">
        <div class="life-plot">
          <div class="stats-chart-grid" aria-hidden="true"><i></i><i></i><i></i></div>

          <div v-if="meanBottom != null" class="life-mean" :style="{ bottom: meanBottom + '%' }" aria-hidden="true">
            <span>MEAN {{ meanOnsetLabel }}</span>
          </div>

          <div class="life-bars" :class="{ 'is-hovering': hover >= 0 }">
            <div
              v-for="(r, i) in rows"
              :key="r.day"
              class="life-col"
              :class="{ 'is-missing': r.missing, 'is-today': r.isToday }"
              tabindex="0"
              role="img"
              :aria-label="ariaFor(r)"
              @pointerenter="hover = i"
              @pointerleave="hover = -1"
              @focus="hover = i"
              @blur="hover = -1"
            >
              <!-- 浮动的区间条：bottom 是入睡，height 是睡多久 -->
              <span
                v-if="!r.missing"
                class="life-bar ls-band"
                :class="{ 'is-manual': r.manual, 'is-low': r.confidence === 'low' }"
                :style="{ bottom: r.bottom + '%', height: r.height + '%' }"
              ></span>
            </div>
          </div>

          <div
            class="stats-chart-cursor"
            aria-hidden="true"
            :style="{ left: hoverPct, opacity: hover >= 0 ? 1 : 0 }"
          ></div>

          <div class="stats-chart-tooltip" :style="{ left: hoverPct, opacity: hover >= 0 ? 1 : 0 }" aria-hidden="true">
            <span class="stats-tip-date">{{ hoverRow ? fullDay(hoverRow.day) : '' }}</span>
            <span class="stats-tip-row"><b>{{ hoverRow?.onset || '—' }}</b><em>ASLEEP</em></span>
            <span class="stats-tip-row"><b>{{ hoverRow?.wake || '—' }}</b><em>WAKE</em></span>
            <span class="stats-tip-row"><b>{{ hoverRow?.hours == null ? '—' : `${hoverRow.hours.toFixed(1)}h` }}</b><em>TOTAL</em></span>
          </div>
        </div>

        <div class="stats-chart-yaxis" aria-hidden="true">
          <span>18:00</span><span>03:00</span><span>12:00</span>
        </div>
      </div>

      <div class="stats-chart-xaxis life-xaxis" aria-hidden="true">
        <span v-for="r in rows" :key="r.day">{{ r.showLabel ? shortDay(r.day) : '' }}</span>
      </div>

      <div class="life-chips life-chips-pad">
        <span v-for="c in chips" :key="c.label" class="life-chip">
          <em>{{ c.label }}</em><b>{{ c.value }}</b>
        </span>
      </div>

      <!-- 细分化：一周七天各自的平均睡眠。平均值最容易被「工作日缺觉、
           周末补觉」互相抵消掉，摊开成七天才看得出来。 -->
      <div class="lc-sub">
        <div class="life-rail-head">AVERAGE BY WEEKDAY</div>
        <div class="lc-sub-row">
          <div v-for="d in byWeekday" :key="d.label" class="lc-sub-col">
            <span class="lc-sub-bar" :style="{ height: d.pct + '%' }"></span>
            <em>{{ d.label }}</em>
            <b>{{ d.value }}</b>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  rows: { type: Array, default: () => [] },
  // dashboard 用的小卡形态（和 LifeRadar 的 compact 同一个意思）
  compact: { type: Boolean, default: false },
});

// 睡眠日从 18:00 到次日 12:00，共 18 小时 —— 和 plot 的纵向刻度一致
const SPAN_MIN = 18 * 60;

const hover = ref(-1);

function onsetMin(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return ((h >= 18 ? h : h + 24) - 18) * 60 + m;
}
function wakeMin(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return (h + 24 - 18) * 60 + m;
}
function pct(min) {
  return (Math.max(0, Math.min(SPAN_MIN, min)) / SPAN_MIN) * 100;
}

function shortDay(day) {
  return String(day || '').slice(5);
}
function fullDay(day) {
  const s = String(day || '');
  return s ? s.slice(5).replace('-', '.') : '';
}

const all = computed(() => (props.rows || []).filter((r) => r && r.day));

const rows = computed(() => {
  const n = all.value.length;
  return all.value.map((row, i) => {
    const s = row.payload?.sleep || null;
    const a = s ? onsetMin(s.onset) : null;
    const b = s ? wakeMin(s.wake) : null;
    const ok = a != null && b != null && b > a;
    return {
      day: row.day,
      isToday: !!row.isToday,
      missing: !ok,
      // x 轴只标首、尾和每 5 天，和 AI / 运动面板一样
      showLabel: n <= 8 || i === 0 || i === n - 1 || i % 5 === 0,
      onset: s?.onset || '',
      wake: s?.wake || '',
      hours: ok ? Number(s.hours) : null,
      confidence: s?.confidence || '',
      manual: s?.basis === 'manual',
      bottom: ok ? pct(a) : 0,
      height: ok ? Math.max(1.2, pct(b) - pct(a)) : 0,
    };
  });
});

const hasData = computed(() => rows.value.some((r) => !r.missing));

const hoverRow = computed(() => (hover.value >= 0 ? rows.value[hover.value] || null : null));

const hoverPct = computed(() => {
  const n = rows.value.length || 1;
  return `${(((Math.max(0, hover.value) + 0.5) / n) * 100).toFixed(2)}%`;
});

function ariaFor(r) {
  return r.missing
    ? `${r.day}: no sleep recorded`
    : `${r.day}: ${r.onset} to ${r.wake}, ${r.hours?.toFixed(1)}h`;
}

// ── 均值线：平均入睡时刻 ────────────────────────────────────────────────
const meanOnset = computed(() => {
  const xs = rows.value.filter((r) => !r.missing).map((r) => onsetMin(r.onset)).filter((n) => n != null);
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
});
const meanBottom = computed(() => (meanOnset.value == null ? null : pct(meanOnset.value)));
const meanOnsetLabel = computed(() => {
  if (meanOnset.value == null) return '';
  const total = Math.round(meanOnset.value) + 18 * 60;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
});

// ── chips ──────────────────────────────────────────────────────────────
const chips = computed(() => {
  const ns = rows.value.filter((r) => !r.missing);
  if (!ns.length) return [{ label: 'NIGHTS', value: '0' }];

  const hours = ns.map((r) => r.hours).filter((n) => Number.isFinite(n));
  const avgH = hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null;

  const onsets = ns.map((r) => onsetMin(r.onset)).filter((n) => n != null);
  const m = onsets.reduce((a, b) => a + b, 0) / Math.max(1, onsets.length);
  const sd = Math.sqrt(onsets.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, onsets.length));

  const wakes = ns.map((r) => wakeMin(r.wake)).filter((n) => n != null);
  const wm = wakes.reduce((a, b) => a + b, 0) / Math.max(1, wakes.length);
  const wakeTotal = Math.round(wm) + 18 * 60;
  const wakeLabel = `${String(Math.floor(wakeTotal / 60) % 24).padStart(2, '0')}:${String(wakeTotal % 60).padStart(2, '0')}`;

  return [
    { label: 'AVG SLEEP', value: avgH == null ? '—' : `${avgH.toFixed(1)}h` },
    { label: 'BEDTIME', value: meanOnsetLabel.value || '—' },
    { label: 'WAKE', value: wakeLabel },
    { label: 'CONSISTENCY', value: Number.isFinite(sd) ? `±${Math.round(sd)}m` : '—' },
    { label: 'NIGHTS', value: `${ns.length}/${rows.value.length}` },
  ];
});


// 按星期几聚合平均睡眠时长。样本不足的星期给 null，不编数字。
const byWeekday = computed(() => {
  const LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const buckets = LABELS.map(() => []);
  rows.value.forEach((r) => {
    if (r.missing) return;
    const d = new Date(`${r.day}T00:00:00`);
    if (Number.isNaN(d.getTime())) return;
    buckets[(d.getDay() + 6) % 7].push(r.hours);
  });
  const avgs = buckets.map((xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null));
  const vals = avgs.filter((v) => v != null);
  const max = vals.length ? Math.max(...vals) : 1;
  const min = vals.length ? Math.min(...vals) : 0;
  return LABELS.map((label, i) => ({
    label,
    value: avgs[i] == null ? '—' : `${avgs[i].toFixed(1)}h`,
    pct: avgs[i] == null ? 0 : 18 + ((avgs[i] - min) / Math.max(0.1, max - min)) * 82,
  }));
});

// ── 紧凑模式文案 ────────────────────────────────────────────────────────
const latest = computed(() => [...rows.value].reverse().find((r) => !r.missing) || null);
const latestText = computed(() => (latest.value ? `${latest.value.hours.toFixed(1)}h` : '—'));
const latestCaption = computed(() => {
  if (!latest.value) return 'NO SLEEP DATA';
  return `${latest.value.isToday ? 'TODAY' : fullDay(latest.value.day)} · ${latest.value.onset}→${latest.value.wake}`;
});
</script>

<style scoped>
/* dashboard 迷你柱用 .mbar，不用 .life-bar。
   ⚠️ LifeView 的 prepareCharts() 会把所有 [data-chart] 里的 .life-bar
      先 scaleY(0)，等进入视野再动画；而 dashboard 的小卡不在那条驱动链上，
      用 .life-bar 的话柱子会永远停在 0 高度（实测踩到）。 */
.mbar {
  position: absolute;
  left: 0;
  right: 0;
  background: var(--text-primary);
  opacity: 0.85;
}
.life-col.is-today .mbar {
  background: repeating-linear-gradient(
    135deg,
    var(--text-primary) 0 2px,
    transparent 2px 4px
  );
  opacity: 1;
}

/* 浮动区间条：main.css 里的 .life-bar 是从底部长的，
   睡眠要同时指定 bottom 和 height 才能悬在中间。 */
.ls-band {
  position: absolute;
  left: 0;
  right: 0;
  opacity: 0.85;
}
/* 手记的比推断的可信，画得更实 */
.ls-band.is-manual { opacity: 1; }
.ls-band.is-low { opacity: 0.4; }

.life-empty-note { padding-bottom: 4px; }

/* 细分小图：七天平均，和正图共用同一套单色语言 */
.lc-sub { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--border); }
.lc-sub-row { display: flex; gap: 10px; align-items: flex-end; height: 74px; margin-top: 10px; }
.lc-sub-col { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; height: 100%; }
.lc-sub-bar { width: 100%; max-width: 34px; background: var(--text-primary); opacity: 0.75; min-height: 2px; }
.lc-sub-col em { font-style: normal; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.5rem; letter-spacing: 0.12em; color: var(--text-secondary); }
.lc-sub-col b { font-family: 'Oswald', sans-serif; font-size: 0.62rem; font-weight: 500; letter-spacing: 0.08em; color: var(--text-primary); }
.ls-hint {
  margin: 8px 0 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.55rem;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  max-width: 60ch;
}
</style>
