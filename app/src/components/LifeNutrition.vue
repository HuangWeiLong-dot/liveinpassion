<template>
  <div v-if="compact" class="dash-mini">
    <div class="dash-mini-main">
      <strong>{{ hoverRow ? (hoverRow.calories == null ? '—' : fmtKcal(hoverRow.calories)) : latestText }}</strong>
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
          <span v-if="!r.missing" class="mbar" :style="{ height: r.pct + '%' }"></span>
        </div>
      </div>
    </div>
  </div>

  <div v-else-if="!hasData" class="life-chart life-empty-note">
    <p class="stats-empty">No meals logged in this window.</p>
    <p class="ln-hint">
      Send “meal: lunch, chicken breast 200g, rice” in Feishu and it gets parsed
      into calories and macros overnight.
    </p>
  </div>

  <div v-else class="life-chart">
    <!-- 覆盖率低的时候必须先说清楚，否则「平均 2100 kcal」读起来和
         30 天的平均值一模一样，那是假的。 -->
    <p v-if="sparse" class="ln-warn">
      ONLY {{ logged }} OF {{ rows.length }} DAYS LOGGED — AVERAGES DESCRIBE THOSE DAYS ONLY
    </p>

    <div class="life-split">
      <div class="life-main-col">
        <div class="life-chart-main">
          <div class="life-plot">
            <div class="stats-chart-grid" aria-hidden="true"><i></i><i></i><i></i></div>

            <div v-if="meanPct != null" class="life-mean" :style="{ bottom: meanPct + '%' }" aria-hidden="true">
              <span>MEAN {{ fmtKcal(meanKcal) }}</span>
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
                <span
                  v-if="!r.missing"
                  class="life-bar"
                  :class="{ 'is-low': r.confidence === 'low' }"
                  :style="{ height: r.pct + '%' }"
                ></span>
              </div>
            </div>

            <div
              class="stats-chart-cursor"
              aria-hidden="true"
              :style="{ left: hoverPct, opacity: hover >= 0 ? 1 : 0 }"
            ></div>

            <div class="stats-chart-tooltip" :style="{ left: hoverPct, opacity: hover >= 0 ? 1 : 0 }" aria-hidden="true">
              <span class="stats-tip-date">{{ hoverRow ? fullDay(hoverRow.day) : '' }}<template v-if="hoverRow?.isToday"> · SO FAR</template></span>
              <span class="stats-tip-row"><b>{{ hoverRow?.calories == null ? '—' : fmtKcal(hoverRow.calories) }}</b><em>KCAL</em></span>
              <span class="stats-tip-row"><b>{{ hoverRow?.protein == null ? '—' : `${hoverRow.protein}g` }}</b><em>PROTEIN</em></span>
              <span class="stats-tip-row"><b>{{ hoverRow?.meals || 0 }}</b><em>MEALS</em></span>
            </div>
          </div>

          <div class="stats-chart-yaxis" aria-hidden="true">
            <span>{{ fmtKcal(maxKcal) }}</span>
            <span>{{ fmtKcal(maxKcal / 2) }}</span>
            <span>0</span>
          </div>
        </div>

        <div class="stats-chart-xaxis life-xaxis" aria-hidden="true">
          <span v-for="r in rows" :key="r.day">{{ r.showLabel ? shortDay(r.day) : '' }}</span>
        </div>
      </div>

      <!-- 右侧：宏量供能比。和 AI SPEND 的 breakdown rail 是同一套排法 -->
      <aside class="life-rail">
        <div class="life-rail-group">
          <div class="life-rail-head">AVERAGE MACROS · % OF ENERGY</div>
          <div v-for="(m, i) in macros" :key="m.name" class="life-row">
            <span class="life-rank">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="life-name">{{ m.name }}</span>
            <span class="life-num">{{ m.grams }}g</span>
            <span class="life-track"><span class="life-fill" :style="{ width: m.pct + '%' }"></span></span>
          </div>
        </div>
      </aside>
    </div>

    <div class="life-chips life-chips-pad">
      <span v-for="c in chips" :key="c.label" class="life-chip">
        <em>{{ c.label }}</em><b>{{ c.value }}</b>
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  rows: { type: Array, default: () => [] },
  compact: { type: Boolean, default: false },
});

const hover = ref(-1);

function shortDay(day) {
  return String(day || '').slice(5);
}
function fullDay(day) {
  const s = String(day || '');
  return s ? s.slice(5).replace('-', '.') : '';
}
function fmtKcal(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return String(Math.round(Number(v)));
}

const all = computed(() => (props.rows || []).filter((r) => r && r.day));

const entries = computed(() =>
  all.value.map((r) => ({ row: r, n: r.payload?.nutrition || null })),
);

const logged = computed(() => entries.value.filter((e) => e.n && e.n.calories != null).length);
const hasData = computed(() => logged.value > 0);
const sparse = computed(() => hasData.value && logged.value < all.value.length * 0.6);

const maxKcal = computed(() => {
  const m = Math.max(0, ...entries.value.map((e) => Number(e.n?.calories) || 0));
  return m > 0 ? m * 1.1 : 2500;
});

const rows = computed(() => {
  const n = all.value.length;
  return entries.value.map((e, i) => {
    const cal = Number(e.n?.calories);
    const ok = !!e.n && Number.isFinite(cal);
    return {
      day: e.row.day,
      isToday: !!e.row.isToday,
      missing: !ok,
      showLabel: n <= 8 || i === 0 || i === n - 1 || i % 5 === 0,
      calories: ok ? cal : null,
      protein: e.n?.proteinG == null ? null : Number(e.n.proteinG),
      meals: Number(e.n?.meals) || 0,
      confidence: e.n?.confidence || '',
      pct: ok ? Math.max(1.2, (cal / maxKcal.value) * 100) : 0,
    };
  });
});

const hoverRow = computed(() => (hover.value >= 0 ? rows.value[hover.value] || null : null));
const hoverPct = computed(() => {
  const n = rows.value.length || 1;
  return `${(((Math.max(0, hover.value) + 0.5) / n) * 100).toFixed(2)}%`;
});

const meanKcal = computed(() => {
  const xs = rows.value.filter((r) => !r.missing).map((r) => r.calories);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
});
const meanPct = computed(() => (hasData.value ? (meanKcal.value / maxKcal.value) * 100 : null));

function ariaFor(r) {
  return r.missing
    ? `${r.day}: no meals logged`
    : `${r.day}: ${Math.round(r.calories)} kcal, ${r.protein ?? '—'} g protein`;
}

const averages = computed(() => {
  const ns = entries.value.map((e) => e.n).filter((n) => n && n.calories != null);
  const avg = (pick) => {
    const xs = ns.map(pick).filter((n) => Number.isFinite(n));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  return {
    kcal: avg((n) => Number(n.calories)),
    protein: avg((n) => Number(n.proteinG)),
    carbs: avg((n) => Number(n.carbsG)),
    fat: avg((n) => Number(n.fatG)),
  };
});

// 宏量供能比：蛋白 4 kcal/g、碳水 4、脂肪 9
const macros = computed(() => {
  const a = averages.value;
  const list = [
    { name: 'PROTEIN', grams: a.protein, kcal: (a.protein || 0) * 4 },
    { name: 'CARBS', grams: a.carbs, kcal: (a.carbs || 0) * 4 },
    { name: 'FAT', grams: a.fat, kcal: (a.fat || 0) * 9 },
  ];
  const total = list.reduce((s, m) => s + m.kcal, 0);
  return list.map((m) => ({
    name: m.name,
    grams: m.grams == null ? '—' : Math.round(m.grams),
    pct: total > 0 ? Math.round((m.kcal / total) * 100) : 0,
  }));
});

const chips = computed(() => {
  const a = averages.value;
  const split = macros.value.map((m) => m.pct).join('/');
  return [
    { label: 'AVG KCAL', value: a.kcal == null ? '—' : fmtKcal(a.kcal) },
    { label: 'AVG PROTEIN', value: a.protein == null ? '—' : `${Math.round(a.protein)}g` },
    { label: 'MACROS', value: a.protein == null ? '—' : split },
    { label: 'LOGGED', value: `${logged.value}/${all.value.length}` },
  ];
});

const latest = computed(() => [...rows.value].reverse().find((r) => !r.missing) || null);
const latestText = computed(() => (latest.value ? fmtKcal(latest.value.calories) : '—'));
const latestCaption = computed(() => {
  if (!latest.value) return 'NO MEAL LOG';
  return `${latest.value.isToday ? 'TODAY' : fullDay(latest.value.day)} · ${latest.value.protein ?? '—'}g PROTEIN`;
});
</script>

<style scoped>
/* dashboard 迷你柱用 .mbar —— .life-bar 会被 LifeView 的入场动画归零，
   而 dashboard 小卡不在那条链路上。见 LifeSleep.vue 里的同一段说明。 */
.mbar {
  width: 100%;
  background: var(--text-primary);
  opacity: 0.9;
}
.life-col.is-today .mbar {
  background: repeating-linear-gradient(
    135deg,
    var(--text-primary) 0 2px,
    transparent 2px 4px
  );
  opacity: 1;
}

.life-bar.is-low { opacity: 0.42; }

.ln-warn {
  margin: 0 0 14px;
  padding: 8px 12px;
  border-left: 2px solid var(--text-primary);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.55rem;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
}

.life-empty-note { padding-bottom: 4px; }
.ln-hint {
  margin: 8px 0 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.55rem;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  max-width: 60ch;
}
</style>
