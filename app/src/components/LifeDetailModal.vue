<script setup>
// 今日统计卡片的「完整信息」弹窗。
//
// 和单日详情（LifeView 里的 .life-day-modal）的分工：
//   点 TODAY 的某张卡 → 只显示这一类数据，但**不截断**
//   点任意一天的柱子 → 显示那一天所有数据源（分类/桌面/手机/健康/地点/AI/锻炼）
//
// 数据仍然来自 /api/life 的今日聚合，不额外发请求。
import { computed, nextTick, ref, watch } from 'vue';

const props = defineProps({
  kind: { type: String, default: '' },
  day: { type: String, default: '' },
  payload: { type: Object, default: null },
  // 屏幕亮起时间的窗口汇总（LifeView 的 screenTotals）。今天的 payload
  // 只够显示「今天」，卡片上的数字是 30 天窗口，两份数据都要。
  screen: { type: Object, default: null },
  colorMode: { type: Boolean, default: false },
});

defineEmits(['close']);

const TITLES = {
  desktop: 'DESKTOP',
  phone: 'PHONE',
  ai: 'AI SPEND',
  screen: 'SCREEN TIME',
};

const title = computed(() => TITLES[props.kind] || '');

function hoursLabel(h) {
  const v = Number(h);
  return Number.isFinite(v) ? `${v.toFixed(1)}h` : '—';
}

function minutesLabel(m) {
  const v = Math.round(Number(m) || 0);
  if (v < 60) return `${v}m`;
  return `${Math.floor(v / 60)}h ${String(v % 60).padStart(2, '0')}m`;
}

// 桌面应用时长是小时（站点、手机是分钟）；换算成分钟，保留到分钟。
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
  return Number.isFinite(n)
    ? n.toLocaleString('en-US', { maximumFractionDigits: digits })
    : '—';
}

function dayLabel(day) {
  if (!day) return '—';
  const [y, m, d] = day.split('-');
  return `${d}.${m}.${y}`;
}

function shortDay(day) {
  if (!day) return '—';
  const [y, m, d] = day.split('-');
  return `${d}.${m}.${y.slice(2)}`;
}

function rows(pairs) {
  const list = Array.isArray(pairs) ? pairs : [];
  const max = Math.max(...list.map(([, v]) => Number(v) || 0), 0.0001);
  return list.map(([name, value], i) => ({
    name,
    value: Number(value) || 0,
    pct: Math.max(((Number(value) || 0) / max) * 100, 2),
    rank: String(i + 1).padStart(2, '0'),
  }));
}

const apps = computed(() => rows(props.payload?.topApps));
const sites = computed(() => rows(props.payload?.topSites));
const phone = computed(() => props.payload?.phone || null);
const phoneApps = computed(() => rows(phone.value?.topApps));
const ai = computed(() => props.payload?.ai || null);
const aiModels = computed(() => rows(ai.value?.models));
const aiProjects = computed(() => rows(ai.value?.projects));

const AI_SOURCES = {
  platform: 'PLATFORM BILL',
  'claude-estimate': 'CLAUDE CODE EST.',
  ledger: 'PIPELINE LEDGER',
};
const aiSource = computed(() => AI_SOURCES[ai.value?.costSource] || '—');

const fillCat = computed(() => ({ desktop: 0, phone: 1, ai: 3 }[props.kind] ?? 0));

// 屏幕时间：今天两台设备的分钟数，条形按两者最大值归一。
const screenToday = computed(() => {
  const s = props.screen;
  if (!s) return [];
  const list = [
    { name: 'DESKTOP · WINDOW-ACTIVE', value: s.todayDesktopMinutes, cat: 0 },
    { name: 'PHONE · SCREEN-ON', value: s.todayPhoneMinutes, cat: 1 },
  ].filter((r) => r.value != null);
  const max = Math.max(...list.map((r) => r.value), 0.0001);
  return list.map((r, i) => ({
    ...r,
    rank: String(i + 1).padStart(2, '0'),
    pct: Math.max((r.value / max) * 100, 2),
  }));
});

const screenDays = computed(() => (props.screen?.perDay || []).map((d) => ({
  ...d,
  totalHours: d.desktopHours == null && d.phoneHours == null
    ? null
    : (d.desktopHours || 0) + (d.phoneHours || 0),
})));

// 打开时把焦点送进弹窗，Esc / CLOSE 之后由 LifeView 送回卡片。
const closeRef = ref(null);
watch(
  () => props.kind,
  (kind) => {
    if (kind) nextTick(() => closeRef.value?.focus());
  }
);
</script>

<template>
  <Teleport to="body">
    <Transition name="life-day">
      <div v-if="kind" class="life-day-backdrop" @click.self="$emit('close')">
        <div
          class="life-day-modal life-detail-modal"
          :class="{ 'is-color': colorMode }"
          role="dialog"
          aria-modal="true"
          :aria-label="`Today ${title} details`"
        >
          <div class="life-day-head">
            <div>
              <span class="life-day-kicker">
                <template v-if="kind === 'screen'">
                  Last {{ screenDays.length }} days · Desktop + Phone
                </template>
                <template v-else>Today · {{ dayLabel(day) }} · Complete</template>
              </span>
              <h3>{{ title }}</h3>
            </div>
            <button ref="closeRef" class="life-day-close" aria-label="Close details" @click="$emit('close')">
              CLOSE <span aria-hidden="true">×</span>
            </button>
          </div>

          <div class="life-day-body life-detail-body">
            <!-- DESKTOP：当天所有应用 + 所有站点 -->
            <template v-if="kind === 'desktop'">
              <section v-if="apps.length" class="life-day-block">
                <h4>APPLICATIONS · {{ apps.length }}</h4>
                <div v-for="a in apps" :key="a.name" class="life-day-row">
                  <span class="life-rank">{{ a.rank }}</span>
                  <span class="life-name">{{ a.name }}</span>
                  <span class="life-num">{{ hoursToDuration(a.value) }}</span>
                  <span class="life-track">
                    <span
                      class="life-fill"
                      :style="{
                        width: a.pct + '%',
                        background: colorMode ? `var(--cat-${fillCat})` : null,
                      }"
                    ></span>
                  </span>
                </div>
              </section>

              <section v-if="sites.length" class="life-day-block">
                <h4>SITES · {{ sites.length }}</h4>
                <div v-for="s in sites" :key="s.name" class="life-day-row">
                  <span class="life-rank">{{ s.rank }}</span>
                  <span class="life-name">{{ s.name }}</span>
                  <span class="life-num">{{ minutesLabel(s.value) }}</span>
                  <span class="life-track">
                    <span
                      class="life-fill"
                      :style="{
                        width: s.pct + '%',
                        background: colorMode ? 'var(--cat-2)' : null,
                      }"
                    ></span>
                  </span>
                </div>
              </section>

              <p v-if="!apps.length && !sites.length" class="life-day-empty">
                No desktop data recorded for today yet.
              </p>
              <p v-else class="life-day-foot">
                Full URLs, page titles and window titles live in THE ARCHIVE
              </p>
            </template>

            <!-- PHONE：当天所有手机应用 + 用量 -->
            <template v-else-if="kind === 'phone'">
              <div v-if="phone" class="life-day-stats life-detail-stats">
                <span>
                  <em>SCREEN TIME</em>
                  <b>{{ phone.screenMinutes == null ? '—' : minutesLabel(phone.screenMinutes) }}</b>
                </span>
                <span>
                  <em>UNLOCKS</em>
                  <b>{{ num(phone.unlocks) }}</b>
                </span>
                <span>
                  <em>APP SWITCHES</em>
                  <b>{{ num(phone.appSwitches) }}</b>
                </span>
                <span>
                  <em>SCREEN ON / OFF</em>
                  <b>{{ num(phone.screenOn) }} / {{ num(phone.screenOff) }}</b>
                </span>
              </div>

              <section v-if="phoneApps.length" class="life-day-block">
                <h4>APPLICATIONS · {{ phoneApps.length }}</h4>
                <div v-for="a in phoneApps" :key="a.name" class="life-day-row">
                  <span class="life-rank">{{ a.rank }}</span>
                  <span class="life-name">{{ a.name }}</span>
                  <span class="life-num">{{ minutesLabel(a.value) }}</span>
                  <span class="life-track">
                    <span
                      class="life-fill"
                      :style="{
                        width: a.pct + '%',
                        background: colorMode ? `var(--cat-${fillCat})` : null,
                      }"
                    ></span>
                  </span>
                </div>
              </section>

              <p v-if="!phone" class="life-day-empty">No phone data recorded for today.</p>
            </template>

            <!-- AI：当天所有模型 / 项目 -->
            <template v-else-if="kind === 'ai'">
              <div v-if="ai" class="life-day-stats life-detail-stats">
                <span>
                  <em>SPEND</em>
                  <b>{{ money(ai.cost) }}</b>
                </span>
                <span>
                  <em>CALLS</em>
                  <b>{{ num(ai.calls) }}</b>
                </span>
                <span>
                  <em>SOURCE</em>
                  <b>{{ aiSource }}</b>
                </span>
              </div>

              <section v-if="aiModels.length" class="life-day-block">
                <h4>MODELS · {{ aiModels.length }}</h4>
                <div v-for="m in aiModels" :key="m.name" class="life-day-row">
                  <span class="life-rank">{{ m.rank }}</span>
                  <span class="life-name">{{ m.name }}</span>
                  <span class="life-num">{{ money(m.value) }}</span>
                  <span class="life-track">
                    <span
                      class="life-fill"
                      :style="{
                        width: m.pct + '%',
                        background: colorMode ? `var(--cat-${fillCat})` : null,
                      }"
                    ></span>
                  </span>
                </div>
              </section>

              <section v-if="aiProjects.length" class="life-day-block">
                <h4>PROJECTS · {{ aiProjects.length }}</h4>
                <div v-for="p in aiProjects" :key="p.name" class="life-day-row">
                  <span class="life-rank">{{ p.rank }}</span>
                  <span class="life-name">{{ p.name }}</span>
                  <span class="life-num">{{ money(p.value) }}</span>
                  <span class="life-track">
                    <span
                      class="life-fill"
                      :style="{
                        width: p.pct + '%',
                        background: colorMode ? `var(--cat-${fillCat})` : null,
                      }"
                    ></span>
                  </span>
                </div>
              </section>

              <p v-if="!ai" class="life-day-empty">No AI spend recorded for today.</p>
            </template>

            <!-- SCREEN：电脑 + 手机，先给窗口合计，再给今天和逐日 -->
            <template v-else-if="kind === 'screen'">
              <template v-if="screen">
                <div class="life-day-stats life-detail-stats">
                  <span>
                    <em>DESKTOP · {{ screen.desktopDays }}D</em>
                    <b>{{ hoursLabel(screen.desktopHours) }}</b>
                  </span>
                  <span>
                    <em>PHONE · {{ screen.phoneDays }}D</em>
                    <b>{{ hoursLabel(screen.phoneHours) }}</b>
                  </span>
                  <span>
                    <em>COMBINED</em>
                    <b>{{ hoursLabel(screen.totalHours) }}</b>
                  </span>
                  <span>
                    <em>TODAY SO FAR</em>
                    <b>{{ screen.todayMinutes == null ? '—' : minutesLabel(screen.todayMinutes) }}</b>
                  </span>
                </div>

                <section v-if="screenToday.length" class="life-day-block">
                  <h4>TODAY · PER DEVICE</h4>
                  <div v-for="r in screenToday" :key="r.name" class="life-day-row">
                    <span class="life-rank">{{ r.rank }}</span>
                    <span class="life-name">{{ r.name }}</span>
                    <span class="life-num">{{ minutesLabel(r.value) }}</span>
                    <span class="life-track">
                      <span
                        class="life-fill"
                        :style="{
                          width: r.pct + '%',
                          background: colorMode ? `var(--cat-${r.cat})` : null,
                        }"
                      ></span>
                    </span>
                  </div>
                </section>

                <section v-if="screenDays.length" class="life-day-block">
                  <h4>PER DAY · LATEST FIRST</h4>
                  <div class="life-detail-day is-head">
                    <span>DAY</span><span>DESKTOP</span><span>PHONE</span><span>TOTAL</span>
                  </div>
                  <div v-for="d in screenDays" :key="d.day" class="life-detail-day">
                    <span>{{ shortDay(d.day) }}</span>
                    <span>{{ d.desktopHours == null ? '—' : hoursLabel(d.desktopHours) }}</span>
                    <span>{{ d.phoneHours == null ? '—' : hoursLabel(d.phoneHours) }}</span>
                    <span>{{ d.totalHours == null ? '—' : hoursLabel(d.totalHours) }}</span>
                  </div>
                </section>

                <p class="life-day-foot">
                  Desktop = window-active time (lock screen excluded) · Phone = measured
                  screen-on intervals · Today is partial until the 23:00 close
                </p>
              </template>

              <p v-else class="life-day-empty">No screen time recorded yet.</p>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.life-detail-modal {
  width: min(760px, 100%);
}

.life-detail-body {
  padding-top: 14px;
  padding-bottom: 26px;
}

/* 覆盖 .life-day-stats 的 5 列：这里最多 4 项。scoped 选择器优先级更高，
   main.css 里的手机断点管不到这里，所以断点要自己写。 */
.life-detail-stats {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-bottom: 10px;
  border-top: 1px solid var(--border);
}

/* 屏幕时间的逐日表：日期 + 三列时长，等宽数字对齐 */
.life-detail-day {
  display: grid;
  grid-template-columns: minmax(0, 1fr) repeat(3, 62px);
  column-gap: 12px;
  align-items: baseline;
  padding: 7px 0;
  border-bottom: 1px solid var(--border);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.54rem;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
  text-transform: uppercase;
  color: var(--text-primary);
}

.life-detail-day:last-child {
  border-bottom: none;
}

.life-detail-day span:not(:first-child) {
  text-align: right;
}

.life-detail-day.is-head {
  padding-top: 0;
  color: var(--text-secondary);
  letter-spacing: 0.12em;
}

@media (max-width: 860px) {
  .life-detail-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .life-detail-stats span:nth-child(2n) {
    border-right: none;
  }

  .life-detail-day {
    grid-template-columns: minmax(0, 1fr) repeat(3, 50px);
    column-gap: 8px;
  }
}
</style>
