<template>
  <!-- dashboard 紧凑形态：只留每个源的天数，格子太密看不见 -->
  <div v-if="compact" class="lc-chips">
    <span v-for="s in sources" :key="s.key" class="life-chip">
      <em>{{ s.label }}</em><b>{{ s.count }}/{{ days.length }}</b>
    </span>
  </div>

  <div v-else class="life-chart lc-wrap">
    <div class="lc-rows">
      <div v-for="s in sources" :key="s.key" class="lc-row">
        <span class="lc-name">{{ s.label }}</span>
        <span class="lc-cells">
          <i
            v-for="(on, i) in s.cells"
            :key="i"
            :class="{ 'is-on': on, 'is-today': days[i]?.isToday }"
            :title="`${days[i]?.day || ''} · ${on ? 'has data' : 'no data'}`"
          ></i>
        </span>
        <span class="lc-count" :class="{ 'is-thin': s.count < days.length * 0.6 }">
          {{ s.count }}/{{ days.length }}
        </span>
      </div>
    </div>

    <div class="lc-axis">
      <span>{{ days.length ? shortDay(days[0].day) : '' }}</span>
      <span>{{ days.length ? shortDay(days[days.length - 1].day) : '' }}</span>
    </div>

    <div class="life-chips life-chips-pad">
      <span class="life-chip"><em>WINDOW</em><b>{{ days.length }}D</b></span>
      <span class="life-chip"><em>FULL COVERAGE</em><b>{{ fullDays }}/{{ days.length }}</b></span>
      <span class="life-chip"><em>WEAKEST</em><b>{{ weakest }}</b></span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  rows: { type: Array, default: () => [] },
  compact: { type: Boolean, default: false },
});

function shortDay(day) {
  return String(day || '').slice(5);
}

const days = computed(() => (props.rows || []).filter((r) => r && r.day));

// 每一个源一条记录。判据是**字段在不在**，不是值大不大：
// 一个源当真没有数据时，发布层给的是 null，不是 0。
const SOURCES = [
  { key: 'desktop', label: 'DESKTOP', test: (p) => p.categories != null || p.trackedHours != null },
  { key: 'phone', label: 'PHONE', test: (p) => p.phone != null },
  { key: 'places', label: 'PLACES', test: (p) => p.location != null },
  { key: 'health', label: 'HEALTH', test: (p) => p.health != null },
  { key: 'sleep', label: 'SLEEP', test: (p) => p.sleep != null },
  { key: 'weather', label: 'WEATHER', test: (p) => p.weather != null },
  { key: 'food', label: 'FOOD', test: (p) => p.nutrition != null },
  { key: 'runs', label: 'RUNS', test: (p) => Array.isArray(p.workouts) && p.workouts.length > 0 },
  { key: 'ai', label: 'AI', test: (p) => p.ai != null },
];

const sources = computed(() =>
  SOURCES.map((s) => {
    const cells = days.value.map((r) => (r.payload ? s.test(r.payload) : false));
    return {
      key: s.key,
      label: s.label,
      cells,
      count: cells.filter(Boolean).length,
    };
  }),
);

const fullDays = computed(
  () => days.value.filter((r) => r.payload && SOURCES.every((s) => s.test(r.payload))).length,
);

// 覆盖率最低的那个源 —— 一眼看出该去修哪条采集链路
const weakest = computed(() => {
  const sorted = [...sources.value].sort((a, b) => a.count - b.count);
  return sorted.length ? `${sorted[0].label} ${sorted[0].count}` : '—';
});
</script>

<style scoped>
.lc-wrap { margin-top: 6px; }

.lc-rows {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.lc-row {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr) 56px;
  align-items: center;
  gap: 14px;
}

.lc-name {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.55rem;
  letter-spacing: 0.14em;
  color: var(--text-secondary);
}

.lc-cells {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 2px;
}

.lc-cells i {
  display: block;
  height: 14px;
  border: 1px solid var(--border);
  background: transparent;
}

/* 有数据 = 实心；没数据 = 空的细框。不做灰度渐变 ——
   这一格只回答「有没有」，不回答「多少」。 */
.lc-cells i.is-on {
  background: var(--text-primary);
  border-color: var(--text-primary);
  opacity: 0.85;
}

/* 今天那列用斜纹，和别的图里 IS-TODAY 的处理保持一致 */
.lc-cells i.is-today.is-on {
  background: repeating-linear-gradient(
    135deg,
    var(--text-primary) 0 2px,
    transparent 2px 4px
  );
  opacity: 1;
}

.lc-count {
  text-align: right;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.55rem;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}
.lc-count.is-thin { color: var(--text-primary); opacity: 0.95; }

.lc-axis {
  display: flex;
  justify-content: space-between;
  margin: 10px 70px 0 98px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.5rem;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

.lc-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 26px;
}
</style>
