<template>
  <div v-if="compact" class="dash-mini">
    <div class="dash-mini-main">
      <strong>{{ hoverRow ? hb(hoverRow.avg) : latestText }}</strong>
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
          <span v-if="!r.missing" class="mbar" :style="{ bottom: r.bottom + '%', height: r.height + '%' }"></span>
        </div>
      </div>
    </div>
  </div>

  <div v-else-if="!hasData" class="life-chart life-empty-note">
    <p class="stats-empty">No heart-rate readings in this window.</p>
    <p class="lh-hint">
      These come from the watch's daily min / average / max — the band is the range
      the sensor actually saw, not a resting-heart-rate estimate.
    </p>
  </div>

  <div v-else class="life-chart">
    <div class="life-main-col">
      <div class="life-chart-main">
        <div class="life-plot">
          <div class="stats-chart-grid" aria-hidden="true"><i></i><i></i><i></i></div>

          <div v-if="meanBottom != null" class="life-mean" :style="{ bottom: meanBottom + '%' }" aria-hidden="true">
            <span>MEAN {{ Math.round(meanAvg) }} BPM</span>
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
              <!-- 区间带：当天看到的最低 → 最高 -->
              <span
                v-if="!r.missing"
                class="mbar lh-band"
                :style="{ bottom: r.bottom + '%', height: r.height + '%' }"
              ></span>
              <!-- 均值：一条更实的细线压在区间里 -->
              <span
                v-if="!r.missing"
                class="mbar lh-avg"
                :style="{ bottom: r.avgBottom + '%', height: '3px', opacity: 1 }"
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
            <span class="stats-tip-row"><b>{{ hoverRow ? hb(hoverRow.max) : '—' }}</b><em>MAX</em></span>
            <span class="stats-tip-row"><b>{{ hoverRow ? hb(hoverRow.avg) : '—' }}</b><em>AVG</em></span>
            <span class="stats-tip-row"><b>{{ hoverRow ? hb(hoverRow.min) : '—' }}</b><em>MIN</em></span>
          </div>
        </div>

        <div class="stats-chart-yaxis" aria-hidden="true">
          <span>{{ domain.hi }}</span>
          <span>{{ Math.round((domain.hi + domain.lo) / 2) }}</span>
          <span>{{ domain.lo }}</span>
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
    </div>

    <!-- 细分化：一周七天各自的平均心率，把「工作日偏高、周末偏低」直接摊开 -->
    <aside class="life-rail">
      <div class="life-rail-group">
        <div class="life-rail-head">AVERAGE BY WEEKDAY</div>
        <div v-for="(d, i) in byWeekday" :key="d.label" class="life-row">
          <span class="life-rank">{{ String(i + 1).padStart(2, '0') }}</span>
          <span class="life-name">{{ d.label }}</span>
          <span class="life-num">{{ d.value }}</span>
          <span class="life-track"><span class="life-fill" :style="{ width: d.pct + '%' }"></span></span>
        </div>
      </div>
    </aside>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  rows: { type: Array, default: () => [] },
  compact: { type: Boolean, default: false },
});

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const hover = ref(-1);

function shortDay(day) {
  return String(day || '').slice(5);
}
function fullDay(day) {
  const s = String(day || '');
  return s ? s.slice(5).replace('-', '.') : '';
}
function hb(v) {
  return v == null || !Number.isFinite(Number(v)) ? '—' : `${Math.round(Number(v))}`;
}

const all = computed(() => (props.rows || []).filter((r) => r && r.day));

const valid = computed(() =>
  all.value.map((r) => r.payload?.health).filter((h) => h && h.hrAvg != null),
);
const hasData = computed(() => valid.value.length > 0);

// 纵轴留 5 bpm 余量，条不会顶到框线
const domain = computed(() => {
  const hs = all.value.map((r) => r.payload?.health).filter(Boolean);
  const mins = hs.map((h) => Number(h.hrMin)).filter(Number.isFinite);
  const maxs = hs.map((h) => Number(h.hrMax)).filter(Number.isFinite);
  const lo = mins.length ? Math.min(...mins) : 50;
  const hi = maxs.length ? Math.max(...maxs) : 160;
  return { lo: Math.max(0, Math.floor(lo) - 5), hi: Math.ceil(hi) + 5 };
});

function pct(v) {
  const span = Math.max(1, domain.value.hi - domain.value.lo);
  return Math.max(0, Math.min(100, ((v - domain.value.lo) / span) * 100));
}

const rows = computed(() => {
  const n = all.value.length;
  return all.value.map((row, i) => {
    const h = row.payload?.health || null;
    const min = h?.hrMin == null ? null : Number(h.hrMin);
    const max = h?.hrMax == null ? null : Number(h.hrMax);
    const avg = h?.hrAvg == null ? null : Number(h.hrAvg);
    const ok = min != null && max != null && max > min;
    return {
      day: row.day,
      isToday: !!row.isToday,
      missing: !ok,
      showLabel: n <= 8 || i === 0 || i === n - 1 || i % 5 === 0,
      min,
      max,
      avg,
      bottom: ok ? pct(min) : 0,
      height: ok ? Math.max(1.2, pct(max) - pct(min)) : 0,
      avgBottom: avg == null ? 0 : pct(avg),
    };
  });
});

const hoverRow = computed(() => (hover.value >= 0 ? rows.value[hover.value] || null : null));
const hoverPct = computed(() => {
  const n = rows.value.length || 1;
  return `${(((Math.max(0, hover.value) + 0.5) / n) * 100).toFixed(2)}%`;
});

const meanAvg = computed(() => {
  const xs = rows.value.filter((r) => !r.missing && r.avg != null).map((r) => r.avg);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
});
const meanBottom = computed(() => (hasData.value ? pct(meanAvg.value) : null));

function ariaFor(r) {
  return r.missing
    ? `${r.day}: no heart-rate reading`
    : `${r.day}: ${r.min} to ${r.max} bpm, average ${r.avg}`;
}

const chips = computed(() => {
  const hs = all.value.map((r) => r.payload?.health).filter((h) => h && h.hrAvg != null);
  if (!hs.length) return [{ label: 'DAYS', value: '0' }];
  const avgOf = (key) => {
    const xs = hs.map((h) => Number(h[key])).filter(Number.isFinite);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const a = avgOf('hrAvg');
  const lo = avgOf('hrMin');
  const hi = avgOf('hrMax');
  return [
    { label: 'AVG', value: a == null ? '—' : `${Math.round(a)} BPM` },
    { label: 'RESTING', value: lo == null ? '—' : `${Math.round(lo)} BPM` },
    { label: 'PEAK', value: hi == null ? '—' : `${Math.round(hi)} BPM` },
    { label: 'DAYS', value: `${hs.length}/${all.value.length}` },
  ];
});

// 细分化：按星期几聚合。数据不够时给 null，不要编一个平均数出来。
const byWeekday = computed(() => {
  const buckets = WEEKDAYS.map(() => []);
  all.value.forEach((row, i) => {
    const h = row.payload?.health;
    if (!h || h.hrAvg == null) return;
    // 用日期本身算星期，不依赖 rows 的下标
    const d = new Date(`${row.day}T00:00:00`);
    if (Number.isNaN(d.getTime())) return;
    const idx = (d.getDay() + 6) % 7;   // 0=周一
    buckets[idx].push(Number(h.hrAvg));
  });
  const avgs = buckets.map((xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null));
  const values = avgs.filter((v) => v != null);
  const max = values.length ? Math.max(...values) : 1;
  const min = values.length ? Math.min(...values) : 0;
  return WEEKDAYS.map((label, i) => ({
    label,
    value: avgs[i] == null ? '—' : `${Math.round(avgs[i])}`,
    // 用相对区间而不是绝对值：七天都在 70 上下时，绝对刻度看不出差别
    pct: avgs[i] == null ? 0 : 20 + ((avgs[i] - min) / Math.max(1, max - min)) * 80,
  }));
});

const latest = computed(() => [...rows.value].reverse().find((r) => !r.missing) || null);
const latestText = computed(() => (latest.value ? hb(latest.value.avg) : '—'));
const latestCaption = computed(() => {
  if (!latest.value) return 'NO HEART-RATE DATA';
  return `${latest.value.isToday ? 'TODAY' : fullDay(latest.value.day)} · ${latest.value.min}–${latest.value.max} BPM`;
});
</script>

<style scoped>
/* 紧凑态用 .mbar（不吃 LifeView 的 scaleY 归零动画） */
.mbar {
  position: absolute;
  left: 0;
  right: 0;
  background: var(--text-primary);
}
.life-col.is-today .mbar {
  background: repeating-linear-gradient(
    135deg,
    var(--text-primary) 0 2px,
    transparent 2px 4px
  );
}

/* 区间带必须画得很淡。min→max 的跨度常常有 100 bpm，0.55 的白柱叠在一起
   会糊成一整块灰砖（实测在 dashboard 里就是这个效果）—— 区间只提供「范围」
   的上下文，主角是中间那条均值线。 */
.lh-band { opacity: 0.18; }
.lh-avg { opacity: 1; }

.life-empty-note { padding-bottom: 4px; }
.lh-hint {
  margin: 8px 0 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.55rem;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  max-width: 60ch;
}
</style>
