<template>
  <div class="lp-wrap">
    <p v-if="!findings.length" class="stats-empty">
      No correlation has survived FDR correction yet.
    </p>

    <template v-else>
      <div class="lp-head-row">
        <p class="lp-caveat">
          Correlation, not causation. Each pair below passed Benjamini–Hochberg at
          q ≤ 0.10 across <b>{{ tests }}</b> tested pairs. Daily data is
          autocorrelated, so read q as a ranking, not a proof.
        </p>
        <div class="lp-key" aria-hidden="true">
          <span><i class="lp-k-pos"></i>positive</span>
          <span><i class="lp-k-neg"></i>negative</span>
          <span><i class="lp-k-ci"></i>95% CI</span>
        </div>
      </div>

      <div class="lp-grid">
        <article
          v-for="(f, i) in shown"
          :key="`${f.a}-${f.b}-${i}`"
          class="lp-card"
          :class="f.r >= 0 ? 'is-pos' : 'is-neg'"
        >
          <div class="lp-card-head">
            <span class="lp-pair">{{ f.a }}</span>
            <span class="lp-arrow">{{ f.lag === 'next-day' ? '→ next day' : '↔' }}</span>
            <span class="lp-pair">{{ f.b }}</span>
          </div>

          <div class="lp-value">
            <b>{{ signed(f.r) }}</b>
            <em>r</em>
          </div>

          <p class="lp-plain">{{ plain(f) }}</p>

          <!-- 发散轴：0 在正中，条从 0 画到 r，细线是 95% CI。
               横线跨过 0 就是在说「方向还不能断定」。 -->
          <div class="lp-track" role="img" :aria-label="aria(f)">
            <span class="lp-axis" aria-hidden="true"></span>
            <span class="lp-zero" aria-hidden="true"></span>
            <span v-if="f.ci" class="lp-ci" :style="ciStyle(f)" aria-hidden="true"></span>
            <span class="lp-bar" :style="barStyle(f)" aria-hidden="true"></span>
            <span class="lp-dot" :style="{ left: pct(f.r) + '%' }" aria-hidden="true"></span>
          </div>

          <div class="lp-card-foot">
            <span>n={{ f.n }}</span>
            <span v-if="f.ci">{{ signed(f.ci[0]) }} … {{ signed(f.ci[1]) }}</span>
            <span>q={{ Number(f.q).toFixed(3) }}</span>
            <span class="lp-strength" :class="`is-${strength(f)}`">{{ strength(f) }}</span>
          </div>
        </article>
      </div>

      <p v-if="rest > 0" class="lp-more">
        + {{ rest }} more pair{{ rest > 1 ? 's' : '' }} passed the same threshold —
        weaker effect sizes, hidden here to keep this readable.
      </p>

      <div class="life-chips life-chips-pad">
        <span class="life-chip"><em>WINDOW</em><b>{{ windowLabel }}</b></span>
        <span class="life-chip"><em>DAYS</em><b>{{ days }}</b></span>
        <span class="life-chip"><em>TESTS</em><b>{{ tests }}</b></span>
        <span class="life-chip"><em>FINDINGS</em><b>{{ findings.length }}</b></span>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  patterns: { type: Object, default: null },
});

// 一屏最多摆这么多张。20 张卡片会变成另一堵墙 —— 而且排在后面的
// 效应量本来就弱，全摆出来只会稀释注意力。
const MAX_CARDS = 8;

const findings = computed(() =>
  (props.patterns?.findings || [])
    .filter((f) => f && f.a && f.b)
    .slice()
    .sort((x, y) => Math.abs(y.r) - Math.abs(x.r)),
);
const shown = computed(() => findings.value.slice(0, MAX_CARDS));
const rest = computed(() => Math.max(0, findings.value.length - MAX_CARDS));

const days = computed(() => props.patterns?.days ?? 0);
const tests = computed(() => props.patterns?.tests ?? 0);
const windowLabel = computed(() => {
  const w = props.patterns?.window || [];
  return w.length === 2 ? `${w[0]} → ${w[1]}` : '—';
});

function pct(r) {
  return Math.max(0, Math.min(100, (Number(r) + 1) * 50));
}

/** 从 0（50%）画到 r */
function barStyle(f) {
  const a = 50;
  const b = pct(f.r);
  return { left: Math.min(a, b) + '%', width: Math.max(0.4, Math.abs(b - a)) + '%' };
}

/** CI 细线 */
function ciStyle(f) {
  const lo = pct(f.ci[0]);
  const hi = pct(f.ci[1]);
  return { left: lo + '%', width: Math.max(0.6, hi - lo) + '%' };
}

// 时间类说 later/earlier，主观评分说 better/worse，其余说 more/less。
// 这一步存在的理由：`r = -0.67` 本身不表达任何意义，读者要知道的是
// 「电脑用得多，那天手机解锁就少」。
const LATER = new Set(['Sleep midpoint', 'Bedtime']);
const RATED = new Set(['Mood', 'Energy', 'Sleep (self-rated)', 'Social', 'Rest', 'Food', 'Learning']);
// 可数名词用 fewer 不是 less
const COUNTABLE = new Set([
  'Unlocks', 'Steps', 'App switches', 'Stays', 'Districts visited',
  'Time blocks', 'Stays (location)',
]);

function strength(f) {
  const r = Math.abs(Number(f.r) || 0);
  if (r >= 0.6) return 'strong';
  if (r >= 0.4) return 'moderate';
  return 'weak';
}

function plain(f) {
  const up = Number(f.r) > 0;
  const a = String(f.a || '').toLowerCase();
  const bName = String(f.b || '');
  const bLower = bName.toLowerCase();
  const tail = f.lag === 'next-day' ? ', and this held into the next day' : '';

  if (LATER.has(bName)) {
    return `More ${a} went with a ${up ? 'later' : 'earlier'} ${bLower}${tail}.`;
  }
  if (RATED.has(bName)) {
    return `More ${a} went with ${up ? 'better' : 'worse'} ${bLower}${tail}.`;
  }
  const down = COUNTABLE.has(bName) ? 'fewer' : 'less';
  return `More ${a} went with ${up ? 'more' : down} ${bLower}${tail}.`;
}

function signed(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2);
}

function aria(f) {
  return `${f.a} ${f.lag === 'next-day' ? 'predicts next-day' : 'and'} ${f.b}: `
    + `r=${signed(f.r)}, 95% CI ${f.ci ? signed(f.ci[0]) + ' to ' + signed(f.ci[1]) : 'n/a'}, n=${f.n}`;
}
</script>

<style scoped>
.lp-wrap { width: 100%; }

.lp-head-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 28px;
  margin-bottom: 22px;
}

.lp-caveat {
  margin: 0;
  max-width: 66ch;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.55rem;
  line-height: 1.75;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  border-left: 2px solid var(--border);
  padding-left: 12px;
}

.lp-key {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: none;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.5rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-secondary);
}
.lp-key span { display: flex; align-items: center; gap: 7px; }
.lp-key i { width: 14px; height: 3px; display: block; }
.lp-k-pos { background: var(--text-primary); }
.lp-k-neg { background: var(--text-primary); opacity: 0.45; }
.lp-k-ci { height: 2px; background: var(--text-primary); opacity: 0.22; }

/* 卡片网格：1px gap 露出边框色 = 发丝分割线 */
.lp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 14px;
}

.lp-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 20px 16px;
  background: var(--bg);
  border: 1px solid var(--border);
  align-self: start;
}

.lp-card-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.56rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-secondary);
}
.lp-pair { color: var(--text-primary); }
.lp-arrow { opacity: 0.6; }

.lp-value {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.lp-value b {
  font-family: 'Oswald', sans-serif;
  font-size: 1.9rem;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.02em;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.lp-value em {
  font-style: normal;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.5rem;
  letter-spacing: 0.16em;
  color: var(--text-secondary);
}

/* 负相关用更淡的条 —— 不靠颜色也能读出方向 */
.lp-card.is-neg .lp-bar { opacity: 0.45; }

.lp-track {
  position: relative;
  height: 18px;
}

.lp-axis {
  position: absolute;
  left: 0;
  right: 0;
  top: 8px;
  height: 1px;
  background: var(--border);
}

.lp-zero {
  position: absolute;
  left: 50%;
  top: 2px;
  bottom: 2px;
  width: 1px;
  background: var(--text-secondary);
  opacity: 0.55;
}

.lp-ci {
  position: absolute;
  top: 7px;
  height: 3px;
  background: var(--text-primary);
  opacity: 0.2;
}

.lp-bar {
  position: absolute;
  top: 6px;
  height: 5px;
  background: var(--text-primary);
}

.lp-dot {
  position: absolute;
  top: 3px;
  width: 11px;
  height: 11px;
  margin-left: -5.5px;
  border-radius: 50%;
  background: var(--text-primary);
  z-index: 2;
}

.lp-plain {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.6rem;
  line-height: 1.6;
  letter-spacing: 0.03em;
  color: var(--text-secondary);
}

.lp-strength {
  margin-left: auto;
  text-transform: uppercase;
  letter-spacing: 0.14em;
}
.lp-strength.is-strong { color: var(--text-primary); }
.lp-strength.is-moderate { opacity: 0.85; }
.lp-strength.is-weak { opacity: 0.55; }

.lp-card-foot {
  display: flex;
  gap: 16px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.5rem;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.lp-more {
  margin: 14px 0 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.52rem;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
}

/* 颜色模式：正相关绿、负相关红。默认单色，方向靠「条画在哪一侧」表达 */
.is-color .lp-card.is-pos .lp-bar,
.is-color .lp-card.is-pos .lp-dot { background: var(--cat-2); }
.is-color .lp-card.is-neg .lp-bar,
.is-color .lp-card.is-neg .lp-dot { background: var(--cat-4); opacity: 1; }
</style>
