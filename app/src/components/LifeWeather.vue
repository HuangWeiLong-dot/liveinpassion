<template>
  <div v-if="compact" class="dash-mini">
    <div class="dash-mini-main">
      <strong>{{ hoverRow ? tempLabel(hoverRow) : latestText }}</strong>
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

  <div v-else-if="!hasData" class="life-chart life-empty-note">
    <p class="stats-empty">No weather recorded in this window.</p>
    <p class="lw-hint">
      Weather collection is off by default — it is the only source that sends
      coordinates to a third party (Open-Meteo, rounded to about 1 km).
    </p>
  </div>

  <div v-else class="life-chart">
    <div class="life-main-col">
      <div class="life-chart-main">
        <div class="life-plot">
          <div class="stats-chart-grid" aria-hidden="true"><i></i><i></i><i></i></div>

          <div v-if="meanBottom != null" class="life-mean" :style="{ bottom: meanBottom + '%' }" aria-hidden="true">
            <span>MEAN {{ meanTemp.toFixed(1) }}°</span>
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
              <!-- 温度区间带（浮动）+ 底部降水条，两种量纲各占一段高度 -->
              <span
                v-if="!r.missing"
                class="life-bar lw-band"
                :style="{ bottom: r.bottom + '%', height: r.height + '%' }"
              ></span>
              <span
                v-if="!r.missing && r.rainPct > 0"
                class="life-bar lw-rain"
                :style="{ bottom: '0%', height: r.rainPct + '%' }"
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
            <span class="stats-tip-row"><b>{{ hoverRow?.condition || '—' }}</b><em>SKY</em></span>
            <span class="stats-tip-row"><b>{{ hoverRow ? tempLabel(hoverRow) : '—' }}</b><em>TEMP</em></span>
            <span class="stats-tip-row"><b>{{ hoverRow?.rain ?? '—' }} mm</b><em>RAIN</em></span>
            <span class="stats-tip-row"><b>{{ hoverRow?.sun == null ? '—' : `${hoverRow.sun}h` }}</b><em>SUN</em></span>
          </div>
        </div>

        <div class="stats-chart-yaxis" aria-hidden="true">
          <span>{{ domain.hi }}°</span>
          <span>{{ Math.round((domain.hi + domain.lo) / 2) }}°</span>
          <span>{{ domain.lo }}°</span>
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

      <!-- 细分化：按 ISO 周聚合的周均最高温 -->
      <div class="lc-sub">
        <div class="life-rail-head">AVERAGE HIGH BY WEEK</div>
        <div class="lc-sub-row">
          <div v-for="w in byWeek" :key="w.label" class="lc-sub-col">
            <span class="lc-sub-bar" :style="{ height: w.pct + '%' }"></span>
            <em>{{ w.label }}</em>
            <b>{{ w.value }}</b>
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
  compact: { type: Boolean, default: false },
});

// 降水条最多占 plot 高度的这么多 —— 让它明显小于温度带，
// 否则一场大雨看起来像一次热浪。
const RAIN_MAX_PCT = 16;

const hover = ref(-1);

function shortDay(day) {
  return String(day || '').slice(5);
}
function fullDay(day) {
  const s = String(day || '');
  return s ? s.slice(5).replace('-', '.') : '';
}

const all = computed(() => (props.rows || []).filter((r) => r && r.day));

const validTemps = computed(() =>
  all.value.map((r) => r.payload?.weather).filter((w) => w && w.tempMin != null && w.tempMax != null),
);

const hasData = computed(() => validTemps.value.length > 0);

const domain = computed(() => {
  if (!validTemps.value.length) return { lo: 0, hi: 30 };
  const lo = Math.min(...validTemps.value.map((w) => Number(w.tempMin)));
  const hi = Math.max(...validTemps.value.map((w) => Number(w.tempMax)));
  return { lo: Math.floor(lo) - 1, hi: Math.ceil(hi) + 1 };
});

function tempPct(t) {
  const span = Math.max(1, domain.value.hi - domain.value.lo);
  return Math.max(0, Math.min(100, ((t - domain.value.lo) / span) * 100));
}

const maxRain = computed(() => {
  const m = Math.max(0, ...all.value.map((r) => Number(r.payload?.weather?.precipMm) || 0));
  return m > 0 ? m : 1;
});

const rows = computed(() => {
  const n = all.value.length;
  return all.value.map((row, i) => {
    const w = row.payload?.weather || null;
    const ok = !!w && w.tempMin != null && w.tempMax != null;
    const rain = Number(w?.precipMm) || 0;
    return {
      day: row.day,
      isToday: !!row.isToday,
      missing: !ok,
      showLabel: n <= 8 || i === 0 || i === n - 1 || i % 5 === 0,
      condition: w?.condition || '',
      rain: Number.isFinite(rain) ? Number(rain.toFixed(1)) : 0,
      sun: w?.sunshineMin == null ? null : Math.round(Number(w.sunshineMin) / 60),
      bottom: ok ? tempPct(Number(w.tempMin)) : 0,
      height: ok ? Math.max(1.2, tempPct(Number(w.tempMax)) - tempPct(Number(w.tempMin))) : 0,
      rainPct: rain > 0 ? Math.max(1.5, (rain / maxRain.value) * RAIN_MAX_PCT) : 0,
      tempMin: ok ? Number(w.tempMin) : null,
      tempMax: ok ? Number(w.tempMax) : null,
    };
  });
});

const hoverRow = computed(() => (hover.value >= 0 ? rows.value[hover.value] || null : null));
const hoverPct = computed(() => {
  const n = rows.value.length || 1;
  return `${(((Math.max(0, hover.value) + 0.5) / n) * 100).toFixed(2)}%`;
});

const meanTemp = computed(() => {
  const vs = validTemps.value.map((w) => (Number(w.tempMin) + Number(w.tempMax)) / 2);
  return vs.reduce((a, b) => a + b, 0) / Math.max(1, vs.length);
});
const meanBottom = computed(() => (hasData.value ? tempPct(meanTemp.value) : null));

function tempLabel(r) {
  return r.tempMin == null ? '—' : `${Math.round(r.tempMin)}°–${Math.round(r.tempMax)}°`;
}
function ariaFor(r) {
  return r.missing
    ? `${r.day}: no weather recorded`
    : `${r.day}: ${r.condition}, ${r.tempMin}° to ${r.tempMax}°, ${r.rain} mm rain`;
}

const chips = computed(() => {
  const ws = validTemps.value;
  if (!ws.length) return [{ label: 'DAYS', value: '0' }];
  const avg = (pick) => {
    const xs = ws.map(pick).filter((n) => Number.isFinite(n));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const hi = avg((w) => Number(w.tempMax));
  const lo = avg((w) => Number(w.tempMin));
  const sun = avg((w) => Number(w.sunshineMin));
  const rainy = ws.filter((w) => (Number(w.precipMm) || 0) >= 1).length;
  const totalRain = ws.reduce((a, w) => a + (Number(w.precipMm) || 0), 0);
  return [
    { label: 'AVG HIGH', value: hi == null ? '—' : `${hi.toFixed(1)}°` },
    { label: 'AVG LOW', value: lo == null ? '—' : `${lo.toFixed(1)}°` },
    { label: 'RAIN', value: `${rainy}d · ${totalRain.toFixed(0)}mm` },
    { label: 'SUN', value: sun == null ? '—' : `${Math.round(sun / 60)}h` },
    { label: 'DAYS', value: `${ws.length}/${rows.value.length}` },
  ];
});


// 按 ISO 周聚合。窗口只有 30 天时大概是 5 根，够看出冷空气过境那周。
const byWeek = computed(() => {
  const buckets = new Map();
  rows.value.forEach((r) => {
    if (r.missing) return;
    const d = new Date(`${r.day}T00:00:00`);
    if (Number.isNaN(d.getTime())) return;
    // ISO 周：把日期挪到本周四，年份取那天所在的年
    const th = new Date(d);
    th.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
    const key = `${th.getFullYear()}-${String(1 + Math.floor((th - new Date(th.getFullYear(), 0, 4)) / 604800000)).padStart(2, '0')}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push((r.tempMin + r.tempMax) / 2);
  });
  const entries = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const avgs = entries.map(([, xs]) => xs.reduce((a, b) => a + b, 0) / xs.length);
  const max = avgs.length ? Math.max(...avgs) : 1;
  const min = avgs.length ? Math.min(...avgs) : 0;
  return entries.map(([key, xs], i) => ({
    label: `W${key.slice(5)}`,
    value: `${Math.round(avgs[i])}°`,
    pct: 18 + ((avgs[i] - min) / Math.max(0.1, max - min)) * 82,
  }));
});

const latest = computed(() => [...rows.value].reverse().find((r) => !r.missing) || null);
const latestText = computed(() => (latest.value ? tempLabel(latest.value) : '—'));
const latestCaption = computed(() => {
  if (!latest.value) return 'NO WEATHER DATA';
  return `${latest.value.isToday ? 'TODAY' : fullDay(latest.value.day)} · ${latest.value.condition || '—'}`;
});
</script>

<style scoped>
/* dashboard 迷你柱用 .mbar —— .life-bar 会被 LifeView 的入场动画归零，
   而 dashboard 小卡不在那条链路上。见 LifeSleep.vue 里的同一段说明。 */
.mbar {
  position: absolute;
  left: 0;
  right: 0;
  background: var(--text-primary);
  opacity: 0.8;
}
.life-col.is-today .mbar {
  background: repeating-linear-gradient(
    135deg,
    var(--text-primary) 0 2px,
    transparent 2px 4px
  );
  opacity: 1;
}

/* 温度带浮动，降水条贴底 —— 两者都是 .life-bar 的变体，靠高度分段区分 */
.lw-band {
  position: absolute;
  left: 0;
  right: 0;
  opacity: 0.8;
}
.lw-rain {
  position: absolute;
  left: 0;
  right: 0;
  opacity: 0.3;
  background: repeating-linear-gradient(
    135deg,
    var(--text-primary) 0 2px,
    transparent 2px 4px
  );
}

.life-empty-note { padding-bottom: 4px; }

.lc-sub { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--border); }
.lc-sub-row { display: flex; gap: 10px; align-items: flex-end; height: 74px; margin-top: 10px; }
.lc-sub-col { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; height: 100%; }
.lc-sub-bar { width: 100%; max-width: 34px; background: var(--text-primary); opacity: 0.75; min-height: 2px; }
.lc-sub-col em { font-style: normal; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.5rem; letter-spacing: 0.12em; color: var(--text-secondary); }
.lc-sub-col b { font-family: 'Oswald', sans-serif; font-size: 0.62rem; font-weight: 500; letter-spacing: 0.08em; color: var(--text-primary); }
.lw-hint {
  margin: 8px 0 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.55rem;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  max-width: 60ch;
}
</style>
