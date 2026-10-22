<script setup>
// LIFE 页（公开）。数据来自 Worker 的 /api/life，60 秒轮询一次。
//
// 和 STATS 共用同一套骨架与语言：黑白、Oswald 大标题、JetBrains Mono
// 小标签、1px 发丝线、方块；动效全部交给 GSAP。
//
// 数据形态见 LifeLogging 的 scripts/publish_life_site.py：
//   每天一份**脱敏聚合**（分类时长、步数、城市级位置、手机计数、AI 花费）。
// 页面只展示聚合数字，不展示坐标、轨迹、窗口标题、包名或余额。
//
// 三个时序/数据上的坑（和 STATS 同源）：
//  1. keep-alive：再次进入不会重跑 onMounted，重播走 onActivated；
//     已经揭示过的面板不再藏起来，否则每次回来都先闪一下空白。
//  2. 首屏品牌遮罩 / 转场板子：入场排在遮罩撤掉或板子滑走之后。
//  3. 真实数据可能只有几天：窗口按“已存最新日往前、但不早于第一条”裁，
//     中间缺日保留成虚线基线，不补 30 个空白。
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import OdometerNumber from '../components/OdometerNumber.vue';
import LifeBrain from '../components/LifeBrain.vue';
import LifeNow from '../components/LifeNow.vue';
import { useBrandOverlay } from '../composables/useBrandOverlay.js';
import {
  latestIdFor,
  getDocCache,
  setDocCache,
  setIndexCache,
} from '../data/lifeArchiveCache.js';
import {
  MAP_BATCH_DAYS,
  buildGeoMap,
  loadLifeTracks,
} from '../data/lifeGeo.js';

gsap.registerPlugin(ScrollTrigger);

const CMS_BASE =
  import.meta.env.VITE_CMS_BASE || 'https://cms.liveinpassion.me';

const { visible: brandVisible } = useBrandOverlay();

const REDUCED = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const CATEGORY_ORDER = [
  'Work', 'Study', 'Life', 'Transport', 'Leisure', 'Health', 'Social', 'Other',
];
const CATEGORY_INDEX = Object.fromEntries(CATEGORY_ORDER.map((c, i) => [c, i]));

const SOURCE_LABELS = {
  platform: 'PLATFORM BILL',
  'claude-estimate': 'CLAUDE CODE EST.',
  ledger: 'PIPELINE LEDGER',
};

const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const data = ref(null);
const rawIndex = ref(null);
const error = ref(false);
const loading = ref(true);
const clock = ref('--:--:--');
const nowMs = ref(Date.now());
const nowSnap = ref(null);
const lastUpdated = ref('—');
const todayRef = ref('');
const numbersRun = ref(0);
const titleChars = [...'LIFE'];
const rhythmHover = ref(-1);
const motionHover = ref(-1);
const phoneHover = ref(-1);
const aiHover = ref(-1);
const weekdayHover = ref(-1);

const sectionRef = ref(null);
const tickerTrackRef = ref(null);
const tipRef = ref(null);
const motionTipRef = ref(null);
const phoneTipRef = ref(null);
const aiTipRef = ref(null);
const mapEl = ref(null);
const mapSvgRef = ref(null);
const dayCloseRef = ref(null);

// ---- 彩色模式 / 单日详情 ----
const colorMode = ref(false);
try {
  colorMode.value = localStorage.getItem('lifeColorMode') === '1';
} catch {
  /* 隐私模式下 localStorage 可能不可用 */
}
const dayDetail = ref('');
let dayLocked = false;
const runsOpen = ref(false);

// ---- 地图（raw events 里的轨迹，懒加载） ----
const mapState = ref('idle'); // idle | loading | ready | empty | error
const mapTracks = ref([]);
const mapHover = ref('');
const mapDays = ref([]); // 窗口内所有有 raw events 的日子
const mapCursor = ref(0); // 已经请求过多少天（含失败的天）
const mapLoadingMore = ref(false);
const mapAllLoaded = computed(() => mapCursor.value >= mapDays.value.length);
const mapRemaining = computed(() => Math.max(0, mapDays.value.length - mapCursor.value));

const MAP_ZOOM_MIN = 1;
const MAP_ZOOM_MAX = 8;
const mapZoom = ref(1);
const mapPan = ref({ x: 0, y: 0 });
const mapDragging = ref(false);
const mapIsZoomed = computed(() => mapZoom.value > 1.001);
const mapTransform = computed(
  () => `translate(${mapPan.value.x} ${mapPan.value.y}) scale(${mapZoom.value})`,
);

// ── 格式化 ──────────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function daysWord(n) {
  return n === 1 ? 'day' : 'days';
}

function compact(n) {
  const v = Number(n || 0);
  if (v >= 1000000) return `${(v / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(v));
}

function round(n, digits = 1) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

function sum(values) {
  return values.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0);
}

function mean(values) {
  const valid = values.filter((v) => Number.isFinite(v));
  return valid.length ? sum(valid) / valid.length : null;
}

function kmLabel(km) {
  const v = Number(km);
  if (!Number.isFinite(v) || v <= 0) return '—';
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} km`;
}

function shortDay(d) {
  return d.slice(5).replace('-', '/');
}

function fullDay(d) {
  const [, mo, day] = d.split('-');
  return `${MONTHS[Number(mo) - 1]} ${day}`;
}

const WEEKDAY_LONG = [
  'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY',
];

function weekdayName(d) {
  const date = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '—';
  return WEEKDAY_LONG[(date.getUTCDay() + 6) % 7];
}

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function shanghaiToday() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function formatTime(iso) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return '—';
  }
}

// D1 的 updated_at 是 "YYYY-MM-DD HH:MM:SS"（UTC，无后缀）
function formatWhen(value) {
  if (!value) return '—';
  let iso = String(value);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(iso)) {
    iso = `${iso.replace(' ', 'T')}Z`;
  }
  return formatTime(iso);
}

function tickClock() {
  nowMs.value = Date.now();
  try {
    clock.value = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date());
  } catch {
    clock.value = new Date().toTimeString().slice(0, 8);
  }
}

function hoursLabel(h) {
  const v = Number(h) || 0;
  return `${v.toFixed(1)}h`;
}

function minutesLabel(m) {
  const v = Math.round(Number(m) || 0);
  if (v < 60) return `${v}m`;
  return `${Math.floor(v / 60)}h ${String(v % 60).padStart(2, '0')}m`;
}

function paceLabel(seconds) {
  const s = Math.round(Number(seconds));
  if (!Number.isFinite(s) || s <= 0) return '—';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} /km`;
}

// ── 日历窗口 ────────────────────────────────────────────────────────────
//
// 以已存最新日为锚，向前最多 30 天，但不早于第一条数据 —— 新装几天时
// 不会出现 20 多根空柱。中间断档保留为 missing。

const rows = computed(() => {
  const days = [...(data.value?.days || [])].sort((a, b) => a.day.localeCompare(b.day));
  if (!days.length) return [];

  const byDay = new Map(days.map((d) => [d.day, d]));
  const latest = days[days.length - 1].day;
  const earliest = days[0].day;
  const candidate = addDays(latest, -29);
  const start = candidate > earliest ? candidate : earliest;

  const out = [];
  for (let day = start; day <= latest; day = addDays(day, 1)) {
    const payload = byDay.get(day) || null;
    out.push({
      day,
      payload,
      missing: !payload,
      isToday: day === todayRef.value,
    });
  }
  return out;
});

const payloads = computed(() => rows.value.map((r) => r.payload).filter(Boolean));

// 实时发布链路上线后，“最新一天”可能就是今天；此时数字是当天到目前的，
// 不是完整一天。用它给页面加一个明确的 TODAY / 部分数据提示。
const latestIsToday = computed(() => {
  const last = rows.value[rows.value.length - 1];
  return !!last && !last.missing && last.day === todayRef.value;
});

const city = computed(() => {
  for (let i = payloads.value.length - 1; i >= 0; i -= 1) {
    const c = payloads.value[i].location?.city;
    if (c) return c;
  }
  return 'Shanghai';
});

const labelEvery = computed(() => Math.max(1, Math.ceil(rows.value.length / 6)));

function decorate(row, i) {
  const n = rows.value.length;
  const leftPct = n ? ((i + 0.5) / n) * 100 : 0;
  return {
    ...row,
    leftPct,
    tipPct: Math.min(93, Math.max(7, leftPct)),
    showLabel: i % labelEvery.value === 0 || i === n - 1,
  };
}

// ── KPI ─────────────────────────────────────────────────────────────────

const kpis = computed(() => {
  const list = payloads.value;
  const trackedDays = list.filter((p) => p.trackedHours != null).length;
  const stepDays = list.filter((p) => p.health?.steps != null).length;
  const phoneDays = list.filter((p) => p.phone != null).length;
  const locationDays = list.filter((p) => p.location != null).length;
  const aiDays = list.filter((p) => p.ai?.cost != null).length;

  const tracked = sum(list.map((p) => p.trackedHours).filter((v) => v != null));
  const steps = sum(list.map((p) => p.health?.steps).filter((v) => v != null));
  // 优先用 transitMinutes（实测 + 停留空档推断）；旧数据回退到 movingMinutes
  const movingMinutes = sum(list
    .map((p) => p.location?.transitMinutes ?? p.location?.movingMinutes)
    .filter((v) => v != null));
  const unlocks = sum(list.map((p) => p.phone?.unlocks).filter((v) => v != null));
  const aiCost = sum(list.map((p) => p.ai?.cost).filter((v) => v != null));

  const sources = [...new Set(list.map((p) => p.ai?.costSource).filter(Boolean))];
  const aiSource = sources.length === 1
    ? SOURCE_LABELS[sources[0]] || sources[0]
    : sources.length > 1
      ? 'MIXED SOURCES'
      : 'NO DATA';

  return [
    {
      key: 'tracked',
      label: 'TRACKED HOURS',
      value: trackedDays ? round(tracked, 1) : null,
      note: `${trackedDays} ${daysWord(trackedDays)} with desktop data`,
      delay: 0.1,
    },
    {
      key: 'steps',
      label: 'STEPS',
      value: stepDays ? Math.round(steps) : null,
      note: `${stepDays} ${daysWord(stepDays)} recorded`,
      delay: 0.15,
    },
    {
      key: 'moving',
      label: 'HOURS IN TRANSIT',
      value: locationDays ? round(movingMinutes / 60, 1) : null,
      note: `${locationDays} ${daysWord(locationDays)} · measured + inferred`,
      delay: 0.2,
    },
    {
      key: 'unlocks',
      label: 'PHONE UNLOCKS',
      value: phoneDays ? Math.round(unlocks) : null,
      note: `${phoneDays} ${daysWord(phoneDays)} recorded`,
      delay: 0.25,
    },
    {
      key: 'ai',
      label: 'AI SPEND',
      value: aiDays ? round(aiCost, 2) : null,
      note: `CNY · ${aiSource}`,
      delay: 0.3,
    },
  ];
});

// ── 01 每日节奏 ─────────────────────────────────────────────────────────

function rhythmDims(p) {
  // 新的七维（桌面 + GPS + 手表 + 手机）；旧 payload 退回桌面 categories。
  return p?.dimensions || p?.categories || null;
}

function rhythmTotal(d) {
  return d
    ? CATEGORY_ORDER.reduce((a, c) => a + Number(d[c] || 0), 0)
    : 0;
}

const rhythmMax = computed(() => Math.max(
  ...rows.value.map((r) => rhythmTotal(rhythmDims(r.payload))),
  1,
));

const rhythmRows = computed(() => rows.value.map((r, i) => {
  const base = decorate(r, i);
  const p = r.payload;
  const dims = rhythmDims(p);
  const total = dims ? rhythmTotal(dims) : null;

  const segments = dims
    ? CATEGORY_ORDER
      .filter((c) => (dims[c] || 0) > 0)
      .map((c) => ({
        name: c,
        hours: dims[c],
        cat: CATEGORY_INDEX[c],
        pct: total > 0 ? (dims[c] / total) * 100 : 0,
      }))
    : [];

  return {
    ...base,
    total,
    missing: !dims,
    pct: total > 0 ? Math.max((total / rhythmMax.value) * 100, 1) : 0,
    segments,
  };
}));

// 七个维度 + Other 全部列出来；当天为 0 的维度变暗，而不是从图例里消失。
// 这样前端能一眼看到 Work/Study/Transport/Leisure/Health/Life/Social 的完整结构，
// 也避免“只显示四维”被误解成数据没记录。
const rhythmLegend = computed(() => CATEGORY_ORDER.map((c) => ({
  name: c,
  index: CATEGORY_INDEX[c],
  // 图例必须和柱子用同一份数据：优先 dimensions。否则 Transport/Health/
  // Social 在柱子里有值，图例却因为桌面 categories 为 0 而一直是灰的。
  zero: !payloads.value.some((p) => {
    const d = p.dimensions || p.categories;
    return d && (d[c] || 0) > 0;
  }),
})));

const rhythmHoverRow = computed(() => rhythmRows.value[rhythmHover.value] || null);
const motionHoverRow = computed(() => motionRows.value[motionHover.value] || null);
const hrHover = ref(-1);
const hrHoverRow = computed(() => motionRows.value[hrHover.value] || null);
const hrTipPct = computed(() => {
  const n = Math.max(1, motionRows.value.length);
  return Math.max(12, Math.min(88, ((hrHover.value + 0.5) / n) * 100));
});
const phoneHoverRow = computed(() => phoneRows.value[phoneHover.value] || null);
const aiHoverRow = computed(() => aiRows.value[aiHover.value] || null);
const weekdayHoverRow = computed(() => weekdayRows.value[weekdayHover.value] || null);

const topApps = computed(() => {
  const agg = {};
  payloads.value.forEach((p) => {
    (p.topApps || []).forEach(([name, hours]) => {
      agg[name] = (agg[name] || 0) + Number(hours || 0);
    });
  });
  const rowsOut = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(...rowsOut.map(([, h]) => h), 0.0001);
  return rowsOut.map(([name, hours], i) => ({
    name,
    hours: round(hours, 1),
    pct: Math.max((hours / max) * 100, 2),
    rank: String(i + 1).padStart(2, '0'),
  }));
});

// ── 02 运动 ─────────────────────────────────────────────────────────────

const stepsMax = computed(() => Math.max(
  ...rows.value.map((r) => r.payload?.health?.steps || 0),
  1,
));

const motionRows = computed(() => rows.value.map((r, i) => {
  const base = decorate(r, i);
  const health = r.payload?.health;
  const steps = health?.steps ?? null;
  return {
    ...base,
    steps,
    hrMin: health?.hrMin ?? null,
    hrAvg: health?.hrAvg ?? null,
    hrMax: health?.hrMax ?? null,
    missing: steps == null,
    pct: steps != null && steps > 0 ? Math.max((steps / stepsMax.value) * 100, 1.2) : 0,
  };
}));

// 心率条带的纵轴范围：按窗口内实际 min/max 取整，留一点余量。
const hrScale = computed(() => {
  const vals = motionRows.value
    .flatMap((r) => [r.hrMin, r.hrMax])
    .filter((v) => v != null);
  if (!vals.length) return null;
  const lo = Math.max(30, Math.floor(Math.min(...vals) / 10) * 10 - 10);
  const hi = Math.min(220, Math.ceil(Math.max(...vals) / 10) * 10 + 10);
  return { lo, hi: Math.max(hi, lo + 40) };
});

function hrPct(value) {
  if (hrScale.value == null || value == null) return null;
  const { lo, hi } = hrScale.value;
  return ((value - lo) / (hi - lo)) * 100;
}

// 7 日滚动均值：只平均窗口内有效的步数；缺失日不出点。
const rollingMean = computed(() => {
  const vals = motionRows.value.map((r) => r.steps);
  return vals.map((_, i) => {
    const win = vals.slice(Math.max(0, i - 6), i + 1).filter((v) => v != null);
    return win.length ? sum(win) / win.length : null;
  });
});

function seriesPath(values, n, max) {
  if (!n) return '';
  const pts = values
    .map((v, i) => (v == null ? null : [i, 100 - (v / max) * 100]))
    .filter(Boolean);
  if (pts.length < 2) return '';
  return pts
    .map(([i, y], k) => `${k ? 'L' : 'M'}${(((i + 0.5) / n) * 1000).toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
}

const motionMean = computed(() => mean(motionRows.value.map((r) => r.steps)));
const motionMeanPct = computed(() => (
  motionMean.value == null
    ? null
    : Math.max((motionMean.value / stepsMax.value) * 100, 0.6)
));

const rollingPath = computed(() => seriesPath(
  rollingMean.value, rows.value.length, stepsMax.value,
));

const rollingAreaPath = computed(() => {
  if (!rollingPath.value) return '';
  const n = rows.value.length;
  const x0 = (0.5 / n) * 1000;
  const x1 = ((n - 0.5) / n) * 1000;
  return `${rollingPath.value} L${x1.toFixed(2)},100 L${x0.toFixed(2)},100 Z`;
});

// ── 手表（并入 MOTION） ────────────────────────────────────────────────
function dayAgeLabel(day) {
  if (!day || !todayRef.value) return '';
  const a = new Date(`${day}T00:00:00`);
  const b = new Date(`${todayRef.value}T00:00:00`);
  const n = Math.round((b - a) / 86400000);
  if (n <= 0) return 'TODAY';
  if (n === 1) return 'YESTERDAY';
  return `${n}D AGO`;
}

function isoHhmm(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit',
  });
}

// 心率在 40–200 bpm 的固定刻度上的位置，用来画 MIN–MAX 区间条。
function hrZonePct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, ((n - 40) / 160) * 100));
}

const watchSummary = computed(() => {
  const days = payloads.value.filter((p) => p.health);
  const latest = [...days].reverse().find(
    (p) => p.health.hrAvg != null || p.health.steps != null,
  ) || null;
  const h = latest?.health || {};
  const stepDays = days.filter((p) => p.health.steps != null).length;
  const hrDays = days.filter((p) => p.health.hrAvg != null).length;
  const stepsAvg = mean(days.map((p) => p.health.steps).filter((v) => v != null));
  const hrAvgMean = mean(days.map((p) => p.health.hrAvg).filter((v) => v != null));
  const runs = sum(days.map((p) => p.health.runs).filter((v) => v != null));
  const km = sum(days.map((p) => p.health.runKm).filter((v) => v != null));
  const minutes = sum(days.map((p) => p.health.runMinutes).filter((v) => v != null));

  // 「最近一次跑步」和「窗口内最佳配速」分开：最佳配速可能来自很久以前，
  // 必须把日期/多久之前一起显示，不能拿它冒充今天的配速。
  const runDays = days.filter((p) => (p.health.runs || 0) > 0);
  const latestRunDay = runDays[runDays.length - 1] || null;
  const latestRun = latestRunDay?.health || null;
  const paceDays = days.filter(
    (p) => p.health.runPaceS != null && p.health.runPaceS > 0,
  );
  const winBestPaceDay = paceDays.length
    ? paceDays.reduce((a, b) => (b.health.runPaceS < a.health.runPaceS ? b : a))
    : null;
  const winLongest = days.reduce(
    (best, p) => ((p.health.runKm || 0) > (best?.health.runKm || 0) ? p : best),
    null,
  );

  // 全历史统计来自 Gadgetbridge DB，不只看 30 天窗口。旧 payload 没有
  // allTime 时退回窗口内的最佳/最长。
  const allTime = [...payloads.value].reverse().find((p) => p.allTime)?.allTime || null;
  const bestPace = allTime?.bestPaceS ?? winBestPaceDay?.health.runPaceS ?? null;
  const bestPaceDay = allTime?.bestPaceDay || winBestPaceDay?.day || null;
  const bestPaceKm = allTime?.bestPaceKm ?? null;
  const longestKm = allTime?.longestKm ?? winLongest?.health.runKm ?? null;
  const longestDay = allTime?.longestDay || winLongest?.day || null;
  const longestName = allTime?.longestName || null;
  const allRuns = allTime?.runs ?? runs;
  const allKm = allTime?.km ?? km;
  const vo2 = [...days].reverse().find((p) => p.health.vo2max != null)?.health?.vo2max ?? null;

  // 每次锻炼的明细（aggregate 的 workouts 数组）；最新的在前。
  const workouts = payloads.value
    .flatMap((p) => (p.workouts || []).map((w) => ({ ...w, day: p.day })))
    .sort((a, b) => String(b.start || '').localeCompare(String(a.start || '')));

  return {
    day: latest?.day || null,
    steps: h.steps ?? null,
    hrAvg: h.hrAvg ?? null,
    hrMin: h.hrMin ?? null,
    hrMax: h.hrMax ?? null,
    stepDays,
    hrDays,
    stepsAvg,
    hrAvgMean,
    runs,
    km,
    minutes,
    latestRunDay: latestRunDay?.day || null,
    latestRunKm: latestRun?.runKm ?? null,
    latestRunMinutes: latestRun?.runMinutes ?? null,
    latestRunPace: latestRun?.runPaceS ?? null,
    latestRunRuns: latestRun?.runs ?? null,
    latestRunAge: dayAgeLabel(latestRunDay?.day),
    bestPace,
    bestPaceDay,
    bestPaceAge: dayAgeLabel(bestPaceDay),
    bestPaceKm,
    longestKm,
    longestDay,
    longestAge: dayAgeLabel(longestDay),
    longestName,
    allRuns,
    allKm,
    vo2,
    workouts,
  };
});

// ── 实时状态（来自 LifeNow 的 /api/life/now 快照） ─────────────────────
function liveAge(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const sec = Math.max(0, (nowMs.value - d.getTime()) / 1000);
  if (sec < 45) return 'JUST NOW';
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))}M AGO`;
  if (sec < 86400) return `${Math.round(sec / 3600)}H AGO`;
  return `${Math.round(sec / 86400)}D AGO`;
}

function onNowSnapshot(snap) {
  nowSnap.value = snap;
}

const liveStatus = computed(() => {
  const s = nowSnap.value;
  const p = s?.phone || null;
  const d = s?.desktop || null;
  const l = s?.location || null;

  let phone;
  if (!p) {
    phone = { label: '—', note: 'NO PHONE DATA', tone: 'unknown' };
  } else if (p.screenOn === true) {
    phone = { label: 'SCREEN ON', note: p.app ? `APP · ${p.app}` : 'UNLOCKED', tone: 'on' };
  } else if (p.screenOn === false) {
    phone = { label: 'SCREEN OFF', note: p.app ? `LAST · ${p.app}` : 'LOCKED', tone: 'off' };
  } else {
    phone = { label: 'SCREEN —', note: p.app ? `LAST · ${p.app}` : 'NO SCREEN EVENT', tone: 'unknown' };
  }

  let desktop;
  if (!d) {
    desktop = { label: '—', note: 'NO DESKTOP DATA', tone: 'unknown' };
  } else if (d.running) {
    desktop = {
      label: 'RUNNING',
      note: [d.app, d.category].filter(Boolean).join(' · ') || 'ACTIVE',
      tone: 'on',
    };
  } else if (d.afk) {
    desktop = { label: 'AFK', note: 'AWAY FROM DESK', tone: 'off' };
  } else {
    desktop = { label: 'IDLE', note: d.app ? `LAST · ${d.app}` : 'NO WINDOW', tone: 'off' };
  }

  let location;
  if (!l) {
    location = { label: '—', note: 'NO LOCATION DATA', tone: 'unknown' };
  } else if (l.stale) {
    location = {
      label: 'STALE',
      note: [l.district || l.city].filter(Boolean).join(' · ') || 'NOT TODAY',
      tone: 'unknown',
    };
  } else if (l.mode === 'moving') {
    location = {
      label: 'MOVING',
      note: [l.district || l.city].filter(Boolean).join(' · ') || 'IN TRANSIT',
      tone: 'on',
    };
  } else {
    location = {
      label: 'STAYING',
      note: [l.district || l.city, l.stayMinutes ? minutesLabel(l.stayMinutes) : '']
        .filter(Boolean).join(' · ') || 'STATIONARY',
      tone: 'off',
    };
  }

  return {
    live: !!s,
    updated: s ? liveAge(s.ts_utc) : 'WAITING',
    phone,
    desktop,
    location,
  };
});

const places = computed(() => {
  const agg = {};
  const cityMinutes = {};
  let measured = 0;
  let inferred = 0;
  let transit = 0;
  let stay = 0;
  let span = 0;
  let points = 0;
  let any = false;

  payloads.value.forEach((p) => {
    const l = p.location;
    if (!l) return;
    any = true;
    if (l.city) cityMinutes[l.city] = (cityMinutes[l.city] || 0) + Number(l.stayMinutes || 0);
    (l.districts || []).forEach(([name, hours]) => {
      agg[name] = (agg[name] || 0) + Number(hours || 0);
    });
    const m = Number(l.movingMinutes || 0);
    const i = Number(l.inferredMinutes || 0);
    measured += m;
    inferred += i;
    transit += l.transitMinutes != null ? Number(l.transitMinutes) : m + i;
    stay += Number(l.stayMinutes || 0);
    span = Math.max(span, Number(l.spanKm || 0));
    points += Number(l.points || 0);
  });

  const list = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(...list.map(([, h]) => h), 0.0001);
  // 主城市按停留分钟算；跨城时区列表里会出现别的城市，标题要能看出来
  const mainCity = Object.entries(cityMinutes).sort((a, b) => b[1] - a[1])[0]?.[0];

  return {
    any,
    city: mainCity || city.value,
    cityCount: Object.keys(cityMinutes).length,
    rows: list.map(([name, hours]) => ({
      name,
      hours: round(hours, 1),
      pct: Math.max((hours / max) * 100, 2),
    })),
    chips: [
      { label: 'TRANSIT', value: `${round(transit / 60, 1)} h` },
      { label: 'MEASURED', value: `${round(measured / 60, 1)} h` },
      { label: 'INFERRED', value: `${round(inferred / 60, 1)} h` },
      { label: 'STAYING', value: `${round(stay / 60, 1)} h` },
      { label: 'MAX SPAN', value: span ? `${round(span, 1)} km` : '—' },
      { label: 'GPS POINTS', value: points ? fmt(Math.round(points)) : '—' },
    ],
  };
});

// ── 03 地图（轨迹来自公开的 raw events） ───────────────────────────────

const geoMap = computed(() => (
  mapTracks.value.length
    ? buildGeoMap(mapTracks.value, { width: 1000, height: 560 })
    : null
));

const mappedMinutes = computed(() => (
  Math.round(mapTracks.value.reduce((a, t) => a + (t.transports || [])
    .reduce((x, y) => x + y.minutes, 0), 0))
));

const mappedPoints = computed(() => sum(mapTracks.value.map((t) => t.points || 0)));

const mapHoverTrack = computed(() => (
  mapTracks.value.find((t) => t.day === mapHover.value) || null
));

// ── 地图缩放 / 平移 ────────────────────────────────────────────────────
// viewBox 始终是 1000×560；缩放只改 <g> 的 transform。轨迹/网格用
// vector-effect: non-scaling-stroke，线宽不随缩放变粗；文字和圆点在模板里
// 按 1/zoom 反算，保持屏幕上的可读尺寸。
function clampMapPan(x, y, z = mapZoom.value) {
  const w = geoMap.value?.width || 1000;
  const h = geoMap.value?.height || 560;
  return {
    x: Math.min(0, Math.max(w * (1 - z), x)),
    y: Math.min(0, Math.max(h * (1 - z), y)),
  };
}

function setMapZoom(next, anchor) {
  const target = Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, next));
  if (target === mapZoom.value) return;
  if (target === MAP_ZOOM_MIN) {
    resetMapZoom();
    return;
  }
  const w = geoMap.value?.width || 1000;
  const h = geoMap.value?.height || 560;
  const a = anchor || { x: w / 2, y: h / 2 };
  const old = mapZoom.value;
  const mx = (a.x - mapPan.value.x) / old;
  const my = (a.y - mapPan.value.y) / old;
  mapZoom.value = target;
  mapPan.value = clampMapPan(a.x - target * mx, a.y - target * my, target);
}

function zoomMap(factor) {
  setMapZoom(mapZoom.value * factor);
}

function resetMapZoom() {
  mapZoom.value = 1;
  mapPan.value = { x: 0, y: 0 };
  mapDragging.value = false;
}

function svgPointFromEvent(evt) {
  const svg = mapSvgRef.value;
  if (!svg || !svg.getScreenCTM()) return null;
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: p.x, y: p.y };
}

function onMapWheel(evt) {
  // 未缩放时把滚轮让给页面；已经放大后才接管，避免整页滚动被地图吃掉。
  if (!mapIsZoomed.value && !evt.ctrlKey && !evt.metaKey) return;
  const p = svgPointFromEvent(evt);
  if (!p) return;
  evt.preventDefault();
  setMapZoom(mapZoom.value * (evt.deltaY < 0 ? 1.2 : 0.82), p);
}

let mapDrag = null;

function onMapPointerDown(evt) {
  if (!mapIsZoomed.value || evt.button !== 0) return;
  const p = svgPointFromEvent(evt);
  if (!p) return;
  mapDrag = { x: p.x, y: p.y, pan: { ...mapPan.value } };
  mapDragging.value = true;
  evt.currentTarget.setPointerCapture?.(evt.pointerId);
}

function onMapPointerMove(evt) {
  if (!mapDrag) return;
  const p = svgPointFromEvent(evt);
  if (!p) return;
  evt.preventDefault();
  mapPan.value = clampMapPan(
    mapDrag.pan.x + (p.x - mapDrag.x),
    mapDrag.pan.y + (p.y - mapDrag.y),
  );
}

function onMapPointerUp(evt) {
  if (!mapDrag) return;
  mapDrag = null;
  mapDragging.value = false;
  evt.currentTarget.releasePointerCapture?.(evt.pointerId);
}

function onMapDoubleClick(evt) {
  const p = svgPointFromEvent(evt);
  if (!p) return;
  evt.preventDefault();
  setMapZoom(mapZoom.value * 1.6, p);
}

// 实际出行方式：走路 / 地铁 / 电瓶车，另外跑步单独保留。
// Dawarich 把地铁记成 driving、电瓶车记成 cycling —— 这是使用者实际的
// 出行方式，不是汽车 / 自行车。认不出的 moving(❓) 不猜，标成 MOVING。
const TRANSPORT_LABELS = {
  walking: 'WALKING',
  cycling: 'E-BIKE',
  driving: 'SUBWAY',
  running: 'RUNNING',
  'moving(❓)': 'MOVING',
};

const transportRows = computed(() => {
  const agg = {};
  mapTracks.value.forEach((t) => {
    (t.transports || []).forEach(({ mode, minutes }) => {
      const label = TRANSPORT_LABELS[mode] || String(mode).toUpperCase();
      agg[label] = (agg[label] || 0) + minutes;
    });
  });
  const list = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = Math.max(...list.map(([, minutes]) => minutes), 0.0001);
  return list.map(([name, minutes], i) => ({
    name,
    minutes: round(minutes, 1),
    pct: Math.max((minutes / max) * 100, 2),
    rank: String(i + 1).padStart(2, '0'),
  }));
});

// ── 04 手机 ─────────────────────────────────────────────────────────────

const phoneMax = computed(() => Math.max(
  ...rows.value.map((r) => r.payload?.phone?.unlocks || 0),
  1,
));

const phoneRows = computed(() => rows.value.map((r, i) => {
  const base = decorate(r, i);
  const p = r.payload?.phone;
  const unlocks = p ? Number(p.unlocks || 0) : null;
  return {
    ...base,
    unlocks,
    missing: unlocks == null,
    pct: unlocks != null && unlocks > 0 ? Math.max((unlocks / phoneMax.value) * 100, 1.2) : 0,
  };
}));

const phoneMean = computed(() => mean(phoneRows.value.map((r) => r.unlocks)));
const phoneMeanPct = computed(() => (
  phoneMean.value == null
    ? null
    : Math.max((phoneMean.value / phoneMax.value) * 100, 0.6)
));

const phoneTop = computed(() => {
  const agg = {};
  payloads.value.forEach((p) => {
    (p.phone?.topApps || []).forEach(([name, minutes]) => {
      agg[name] = (agg[name] || 0) + Number(minutes || 0);
    });
  });
  const list = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(...list.map(([, m]) => m), 0.0001);
  return list.map(([name, minutes], i) => ({
    name,
    minutes: Math.round(minutes),
    pct: Math.max((minutes / max) * 100, 2),
    rank: String(i + 1).padStart(2, '0'),
  }));
});

const phoneChips = computed(() => {
  const list = payloads.value.filter((p) => p.phone);
  const screen = sum(list.map((p) => p.phone.screenMinutes).filter((v) => v != null));
  const switches = sum(list.map((p) => p.phone.appSwitches).filter((v) => v != null));
  return [
    { label: 'SCREEN TIME', value: list.length ? minutesLabel(screen) : '—' },
    { label: 'APP SWITCHES', value: list.length ? fmt(Math.round(switches)) : '—' },
    { label: 'DAYS', value: String(list.length) },
  ];
});

// ── 05 AI 花费 ──────────────────────────────────────────────────────────

const aiMax = computed(() => Math.max(
  ...rows.value.map((r) => r.payload?.ai?.cost || 0),
  0.01,
));

const aiRows = computed(() => rows.value.map((r, i) => {
  const base = decorate(r, i);
  const a = r.payload?.ai;
  const cost = a?.cost ?? null;
  return {
    ...base,
    cost,
    missing: cost == null,
    pct: cost != null && cost > 0 ? Math.max((cost / aiMax.value) * 100, 1.2) : 0,
  };
}));

const aiMean = computed(() => mean(aiRows.value.map((r) => r.cost)));
const aiMeanPct = computed(() => (
  aiMean.value == null
    ? null
    : Math.max((aiMean.value / aiMax.value) * 100, 0.6)
));

const aiBreakdown = computed(() => {
  const models = {};
  const projects = {};
  let calls = 0;
  const sources = new Set();

  payloads.value.forEach((p) => {
    const a = p.ai;
    if (!a) return;
    (a.models || []).forEach(([name, cost]) => {
      models[name] = (models[name] || 0) + Number(cost || 0);
    });
    (a.projects || []).forEach(([name, cost]) => {
      projects[name] = (projects[name] || 0) + Number(cost || 0);
    });
    calls += Number(a.calls || 0);
    if (a.costSource) sources.add(a.costSource);
  });

  function toRows(source) {
    const list = Object.entries(source).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const max = Math.max(...list.map(([, c]) => c), 0.0001);
    return list.map(([name, cost]) => ({
      name,
      cost: round(cost, 2),
      pct: Math.max((cost / max) * 100, 2),
    }));
  }

  // 平台账单的日子有 models，估算的日子只有 projects —— 两组都展示，
  // 否则总额和明细对不上（例如总额 ¥105，模型只列出 ¥47）。
  const groups = [];
  if (Object.keys(models).length) groups.push({ kind: 'MODELS', rows: toRows(models) });
  if (Object.keys(projects).length) groups.push({ kind: 'PROJECTS', rows: toRows(projects) });

  return { groups, calls, sources: [...sources] };
});

const aiChips = computed(() => {
  const list = payloads.value.filter((p) => p.ai?.cost != null);
  const total = sum(list.map((p) => p.ai.cost));
  const sources = aiBreakdown.value.sources;
  const sourceLabel = sources.length === 1
    ? SOURCE_LABELS[sources[0]] || sources[0]
    : sources.length > 1
      ? 'MIXED'
      : '—';
  return [
    { label: 'TOTAL', value: list.length ? `¥${total.toFixed(2)}` : '—' },
    { label: 'CALLS', value: aiBreakdown.value.calls ? fmt(Math.round(aiBreakdown.value.calls)) : '—' },
    { label: 'SOURCE', value: sourceLabel },
  ];
});

const hasAi = computed(() => payloads.value.some((p) => p.ai && p.ai.cost != null));

// ── 06 星期轮廓 ─────────────────────────────────────────────────────────
//
// 只看有桌面分类数据的天。按“平均每天”而不是总和，否则样本多的星期
// 会单纯因为天数多而变长。

const weekdayRows = computed(() => {
  const buckets = WEEKDAYS.map((label) => ({
    label,
    days: 0,
    hours: 0,
    cats: Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])),
  }));

  payloads.value.forEach((p) => {
    const dims = p.dimensions || p.categories;
    if (!dims) return;
    const d = new Date(`${p.day}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return;
    const idx = (d.getUTCDay() + 6) % 7;
    const b = buckets[idx];
    b.days += 1;
    b.hours += rhythmTotal(dims);
    CATEGORY_ORDER.forEach((c) => {
      b.cats[c] += Number(dims[c] || 0);
    });
  });

  const max = Math.max(...buckets.map((b) => (b.days ? b.hours / b.days : 0)), 0.0001);

  return buckets.map((b) => {
    const total = b.days ? b.hours / b.days : null;
    const segments = total == null ? [] : CATEGORY_ORDER
      .filter((c) => b.cats[c] > 0)
      .map((c) => ({
        name: c,
        cat: CATEGORY_INDEX[c],
        hours: b.cats[c] / b.days,
      }));
    return {
      label: b.label,
      days: b.days,
      total,
      segments,
      pct: total == null ? 0 : Math.max((total / max) * 100, 1.5),
      isToday: false,
    };
  });
});

const weekdayChips = computed(() => {
  const valid = weekdayRows.value.filter((d) => d.total != null);
  const busiest = [...valid].sort((a, b) => b.total - a.total)[0];
  const quietest = [...valid].sort((a, b) => a.total - b.total)[0];
  const work = payloads.value.reduce((a, p) => (
    a + Number((p.dimensions || p.categories)?.Work || 0)
  ), 0);
  const total = payloads.value.reduce((a, p) => (
    a + rhythmTotal(p.dimensions || p.categories)
  ), 0);

  return [
    { label: 'BUSIEST', value: busiest ? busiest.label : '—' },
    { label: 'QUIETEST', value: quietest ? quietest.label : '—' },
    { label: 'WORK SHARE', value: total ? `${Math.round((work / total) * 100)}%` : '—' },
    { label: 'SAMPLE', value: `${valid.reduce((a, d) => a + d.days, 0)} days` },
  ];
});

// ── 单日详情 ────────────────────────────────────────────────────────────
//
// 点任意一天任意一根柱子，或者用键盘 Enter，打开当天所有数据源的快照。
// 数据仍然来自同一个窗口，不额外发请求；缺数据的源显示为 —。

function pairRows(pairs, digits = 2) {
  const list = Array.isArray(pairs) ? pairs : [];
  const max = Math.max(...list.map(([, v]) => Number(v) || 0), 0.0001);
  return list.map(([name, value], i) => ({
    name,
    value: round(value, digits),
    pct: Math.max(((Number(value) || 0) / max) * 100, 2),
    rank: String(i + 1).padStart(2, '0'),
  }));
}

const dayView = computed(() => {
  const row = rows.value.find((r) => r.day === dayDetail.value);
  if (!row) return null;
  const p = row.payload;
  if (!p) return { row, payload: null };

  const categories = p.categories
    ? CATEGORY_ORDER
      .filter((c) => (p.categories[c] || 0) > 0)
      .map((c) => ({
        name: c,
        cat: CATEGORY_INDEX[c],
        hours: p.categories[c],
        pct: p.trackedHours ? (p.categories[c] / p.trackedHours) * 100 : 0,
      }))
    : [];

  const h = p.health;
  const healthRows = h ? [
    h.steps != null && ['STEPS', fmt(h.steps)],
    h.hrAvg != null && ['AVG HR', `${Math.round(h.hrAvg)} bpm`],
    h.hrMin != null && ['MIN HR', `${Math.round(h.hrMin)} bpm`],
    h.runs != null && ['RUNS', String(Math.round(h.runs))],
    h.runKm != null && ['DISTANCE', `${h.runKm.toFixed(2)} km`],
    h.runMinutes != null && ['RUN TIME', minutesLabel(h.runMinutes)],
    h.runPaceS != null && h.runPaceS > 0 && ['BEST PACE', paceLabel(h.runPaceS)],
    h.vo2max != null && ['VO2MAX', String(h.vo2max)],
  ].filter(Boolean) : [];

  const l = p.location;
  const districts = l?.districts?.length ? pairRows(l.districts) : [];

  const ph = p.phone;
  const phoneApps = ph?.topApps?.length ? pairRows(ph.topApps, 1) : [];

  const a = p.ai;
  const aiGroups = a ? [
    a.models?.length && { kind: 'MODELS', rows: pairRows(a.models) },
    a.projects?.length && { kind: 'PROJECTS', rows: pairRows(a.projects) },
  ].filter(Boolean) : [];

  return {
    row,
    payload: p,
    categories,
    healthRows,
    districts,
    phoneApps,
    aiGroups,
  };
});

function openDay(day) {
  if (!day) return;
  dayDetail.value = day;
  if (!document.body.classList.contains('no-scroll')) {
    dayLocked = true;
    document.body.classList.add('no-scroll');
  }
  nextTick(() => dayCloseRef.value?.focus());
}

function closeDay() {
  if (!dayDetail.value) return;
  dayDetail.value = '';
  if (dayLocked) {
    dayLocked = false;
    document.body.classList.remove('no-scroll');
  }
}

function openRuns() {
  if (!watchSummary.value.workouts.length) return;
  runsOpen.value = true;
  document.body.classList.add('no-scroll');
}

function closeRuns() {
  if (!runsOpen.value) return;
  runsOpen.value = false;
  document.body.classList.remove('no-scroll');
}

function onDayKey(e) {
  if (e.key !== 'Escape') return;
  closeDay();
  closeRuns();
}

watch(colorMode, (v) => {
  try {
    localStorage.setItem('lifeColorMode', v ? '1' : '0');
  } catch {
    /* 存不了就只在本次会话生效 */
  }
});

const tickerItems = computed(() => [
  'Live aggregate every 2 minutes',
  'Today is partial until the 23:00 close',
  'Click any bar for a single-day view',
  'Full raw archive below',
  'Journals · notes · tasks · events',
  'Credential-like URL values redacted',
  data.value?.timezone || 'Asia/Shanghai (UTC+8)',
  'Refreshes every 60 seconds',
]);

const ARCHIVE_TABS = [
  { kind: 'journal', label: 'JOURNAL', note: 'Full daily entries' },
  { kind: 'notes', label: 'NOTES', note: 'Quick notes and recaps' },
  { kind: 'tasks', label: 'TASKS', note: 'Done and open' },
  { kind: 'qa', label: 'Q & A', note: 'Questions answered' },
  { kind: 'events', label: 'EVENTS', note: 'Raw event stream' },
  { kind: 'blocks', label: 'BLOCKS', note: 'Window titles and URLs' },
  { kind: 'weekly', label: 'REVIEWS', note: 'Weekly summaries' },
  { kind: 'vault', label: 'VAULT', note: 'Tasks, reviews and AI sessions' },
];

const archiveTabs = computed(() => ARCHIVE_TABS.map((t) => {
  const items = rawIndex.value?.kinds?.[t.kind] || [];
  return { ...t, count: items.length, latest: items[0]?.id || null };
}));

const archiveTotal = computed(() => archiveTabs.value.reduce((a, t) => a + t.count, 0));

// ── 拉数据 ──────────────────────────────────────────────────────────────

let pollTimer = null;
let clockTimer = null;
let activeNow = false;
let introStarted = false;
let mountedAt = performance.now();
let introTimer = null;
let introTl = null;
let tickerTween = null;
let dotTween = null;
let stopBrandWatch = null;
let abortCtl = null;
const revealTriggers = [];

async function loadRawIndex() {
  try {
    const res = await fetch(`${CMS_BASE}/api/life/raw/index`, { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      rawIndex.value = json;
      // 归档页复用它，避免进去再等一次 R2 list
      setIndexCache(json);
      return json;
    }
  } catch {
    /* 归档计数是附加信息，失败不影响总览 */
  }
  return null;
}

// 窗口内**所有**有 raw events 的日子，最新的在前。加载由 mapCursor 控制：
// 首屏先取 MAP_BATCH_DAYS 天，之后 LOAD MORE 再往后追加。
function mapEventDays(index) {
  const ids = (index?.kinds?.events || []).map((x) => x.id).filter(Boolean);
  if (!ids.length || !rows.value.length) return [];
  const from = rows.value[0].day;
  const to = rows.value[rows.value.length - 1].day;
  return ids
    .filter((id) => id >= from && id <= to)
    .sort()
    .reverse();
}

let mapObserver = null;
let mapAbort = null;
let mapStarted = false;

async function loadTracks(force = false) {
  if (!activeNow || mapState.value === 'loading' || mapLoadingMore.value) return;
  if (mapStarted && !force) return;
  mapStarted = true;

  if (force) {
    mapTracks.value = [];
    mapDays.value = [];
    mapCursor.value = 0;
    resetMapZoom();
  }
  mapState.value = 'loading';

  if (mapAbort) mapAbort.abort();
  mapAbort = new AbortController();

  try {
    const index = rawIndex.value || await loadRawIndex();
    const days = mapEventDays(index);
    mapDays.value = days;
    if (!days.length) {
      mapState.value = 'empty';
      return;
    }

    const batch = days.slice(0, MAP_BATCH_DAYS);
    mapCursor.value = batch.length;
    const tracks = await loadLifeTracks(batch, {
      base: CMS_BASE,
      signal: mapAbort.signal,
      concurrency: 3,
    });
    if (!activeNow) return;

    mapTracks.value = tracks;
    mapState.value = tracks.length ? 'ready' : 'empty';
    if (tracks.length) {
      mapHover.value = tracks[0].day;
      await nextTick();
      animateMap();
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
    mapState.value = 'error';
    mapStarted = false;
  }
}

async function loadMoreTracks() {
  if (!activeNow || mapLoadingMore.value || mapAllLoaded.value) return;
  if (mapState.value !== 'ready' && mapState.value !== 'empty') return;
  const batch = mapDays.value.slice(mapCursor.value, mapCursor.value + MAP_BATCH_DAYS);
  if (!batch.length) return;

  mapLoadingMore.value = true;
  mapCursor.value += batch.length;
  try {
    const tracks = await loadLifeTracks(batch, {
      base: CMS_BASE,
      signal: mapAbort?.signal,
      concurrency: 3,
    });
    if (!activeNow) return;
    const byDay = new Map(mapTracks.value.map((t) => [t.day, t]));
    tracks.forEach((t) => byDay.set(t.day, t));
    mapTracks.value = [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
    if (mapTracks.value.length) mapState.value = 'ready';
    // 投影范围会随着新日期扩大；缩放后的旧视口不再对得上，回到全局。
    resetMapZoom();
    await nextTick();
    animateMap();
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error('load more tracks failed', err);
    }
  } finally {
    mapLoadingMore.value = false;
  }
}

// 面板离视口还有 700px 就开始拉，滚到跟前时轨迹已经画好。
function observeMap() {
  if (mapStarted || !activeNow || !places.value.any) return;
  nextTick(() => {
    const el = mapEl.value;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      loadTracks();
      return;
    }
    if (mapObserver) mapObserver.disconnect();
    mapObserver = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      mapObserver.disconnect();
      mapObserver = null;
      loadTracks();
    }, { rootMargin: '700px 0px' });
    mapObserver.observe(el);
  });
}

// 归档是 LIFE 的延续：不演整屏板子。悬停时预取默认文档，点下去直接出内容。
const prefetching = new Set();

async function prefetchArchive(kind) {
  const id = latestIdFor(rawIndex.value, kind);
  if (!id || getDocCache(kind, id)) return;
  const key = `${kind}/${id}`;
  if (prefetching.has(key)) return;
  prefetching.add(key);
  try {
    const res = await fetch(`${CMS_BASE}/api/life/raw/${kind}/${encodeURIComponent(id)}`, {
      cache: 'no-store',
    });
    if (res.ok) setDocCache(kind, id, await res.json());
  } catch {
    /* 预取失败不影响点击；点击时归档页会自己再拉 */
  } finally {
    prefetching.delete(key);
  }
}


async function load() {
  if (abortCtl) abortCtl.abort();
  abortCtl = new AbortController();

  try {
    const res = await fetch(`${CMS_BASE}/api/life?days=30`, {
      cache: 'no-store',
      signal: abortCtl.signal,
    });
    if (!res.ok) throw new Error(`life ${res.status}`);
    const json = await res.json();

    todayRef.value = shanghaiToday();
    data.value = json;
    error.value = false;
    loading.value = false;
    lastUpdated.value = formatWhen(json.updatedAt || json.generatedAt);
    loadRawIndex();

    await nextTick();
    if (!activeNow) return;
    observeMap();
    if (!introStarted) {
      prepareCharts();
      scheduleIntro();
    } else {
      ScrollTrigger.refresh();
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
    loading.value = false;
    if (!data.value) error.value = true;
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(load, 60000);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

function startClock() {
  stopClock();
  tickClock();
  clockTimer = setInterval(tickClock, 1000);
}

function stopClock() {
  clearInterval(clockTimer);
  clockTimer = null;
}

// ── 入场编排 ────────────────────────────────────────────────────────────

function scheduleIntro() {
  if (!activeNow || !data.value || introStarted) return;
  if (brandVisible.value) return;
  clearTimeout(introTimer);
  const wait = Math.max(0, 420 - (performance.now() - mountedAt));
  introTimer = setTimeout(() => {
    introTimer = null;
    if (activeNow && !brandVisible.value && !introStarted) playIntro(false);
  }, wait);
}

async function playIntro(replay) {
  if (!activeNow || !data.value) return;
  clearTimeout(introTimer);
  introTimer = null;
  introStarted = true;

  await nextTick();
  if (!activeNow) return;

  killIntro();
  numbersRun.value += 1;

  const q = (sel) => (sectionRef.value ? sectionRef.value.querySelectorAll(sel) : []);
  const kickers = q('.stats-kicker');
  const chars = q('.stats-char');
  const ruleFill = q('.stats-hero-rule span');
  const subtitle = q('.stats-subtitle');
  const meta = q('.stats-hero-meta');
  const ticker = q('.stats-ticker');
  const cardsEls = q('.stat-card');

  gsap.set([...kickers, ...subtitle, ...meta, ...ticker, ...cardsEls], {
    clearProps: 'opacity,visibility,transform',
  });
  // 数字卡片不做整块隐藏：卡片保持可见，入场交给 OdometerNumber 从 0 滚上来。
  gsap.set(cardsEls, { autoAlpha: 1, y: 0 });
  gsap.set([...chars, ...ruleFill], { clearProps: 'opacity,visibility,transform' });

  startTicker();
  startLive();

  if (REDUCED) {
    if (!replay) buildScrollReveals(true);
    return;
  }

  introTl = gsap.timeline({ defaults: { ease: 'power3.out' } });
  introTl
    .fromTo(kickers, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.6 }, 0)
    .fromTo(chars, { yPercent: 118 }, {
      yPercent: 0, duration: 1.15, stagger: 0.05, ease: 'power4.out',
    }, 0.08)
    .fromTo(ruleFill, { scaleX: 0 }, { scaleX: 1, duration: 1.1, ease: 'power3.inOut' }, 0.36)
    .fromTo(subtitle, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 0.5)
    .fromTo(meta, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.75 }, 0.62)
    .fromTo(ticker, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.7 }, 0.7);

  if (!replay) {
    prepareCharts();
    buildScrollReveals(true);
  } else {
    buildScrollReveals(false);
  }
}

function killIntro() {
  clearTimeout(introTimer);
  introTimer = null;
  if (introTl) {
    introTl.kill();
    introTl = null;
  }
  if (!sectionRef.value) return;
  gsap.killTweensOf(sectionRef.value.querySelectorAll(
    '.stats-kicker, .stats-char, .stats-hero-rule span, .stats-subtitle, .stats-hero-meta, .stats-ticker, .stat-card',
  ));
}

// ── 滚动揭示 ────────────────────────────────────────────────────────────

function killReveals() {
  revealTriggers.forEach((t) => t.kill());
  revealTriggers.length = 0;
}

function revealChildren(panel) {
  const fills = panel.querySelectorAll('.life-fill');
  const rowsEls = panel.querySelectorAll('.life-row');
  if (REDUCED) {
    if (fills.length) gsap.set(fills, { scaleX: 1 });
    if (rowsEls.length) gsap.set(rowsEls, { autoAlpha: 1, y: 0 });
    return;
  }
  if (fills.length) {
    gsap.fromTo(fills, { scaleX: 0 }, {
      scaleX: 1, duration: 1.1, ease: 'power3.out', stagger: 0.05,
    });
  }
  if (rowsEls.length) {
    gsap.fromTo(rowsEls, { autoAlpha: 0, y: 12 }, {
      autoAlpha: 1, y: 0, duration: 0.55, ease: 'power2.out', stagger: 0.045,
    });
  }
}

function buildScrollReveals(reset) {
  killReveals();
  if (!sectionRef.value) return;

  const panels = Array.from(sectionRef.value.querySelectorAll('[data-reveal]'));

  panels.forEach((panel) => {
    const style = window.getComputedStyle(panel);
    const alreadySeen = style.visibility !== 'hidden' && Number(style.opacity) > 0.99;
    if (!reset && alreadySeen) return;

    if (REDUCED) {
      gsap.set(panel, { autoAlpha: 1, y: 0 });
      revealChildren(panel);
      return;
    }

    gsap.set(panel, { autoAlpha: 0, y: 44 });
    const hasChart = panel.hasAttribute('data-chart');

    const trigger = ScrollTrigger.create({
      trigger: panel,
      start: 'top 90%',
      once: true,
      onEnter: () => {
        gsap.to(panel, {
          autoAlpha: 1, y: 0, duration: 0.95, ease: 'power3.out',
        });
        revealChildren(panel);
        if (hasChart) animateChart(panel, 0.2);
      },
    });
    revealTriggers.push(trigger);
  });

  ScrollTrigger.refresh();
}

// ── 图表动画 ────────────────────────────────────────────────────────────
//
// 每个带 data-chart 的面板各自动画自己内部的柱子 —— 不能像 STATS 那样
// 用一整张页面级的 chartRef，否则 02 面板入场会把 05 的柱子也一起拨。

function prepareCharts() {
  if (!sectionRef.value) return;
  const panels = sectionRef.value.querySelectorAll('[data-chart]');

  panels.forEach((panel) => {
    const bars = panel.querySelectorAll('.life-bar, .life-stack');
    const lines = panel.querySelectorAll('.life-line');
    const areas = panel.querySelectorAll('.life-area');
    const fills = panel.querySelectorAll('.life-fill, .life-weekday-bar');

    if (REDUCED) {
      if (bars.length) gsap.set(bars, { scaleY: 1 });
      lines.forEach((line) => gsap.set(line, {
        clearProps: 'strokeDasharray,strokeDashoffset', opacity: 1,
      }));
      if (areas.length) gsap.set(areas, { opacity: 1 });
      if (fills.length) gsap.set(fills, { scaleX: 1 });
      return;
    }

    if (bars.length) gsap.set(bars, { scaleY: 0 });
    lines.forEach((line) => {
      if (line.getAttribute('d')) {
        const len = line.getTotalLength();
        gsap.set(line, { strokeDasharray: len, strokeDashoffset: len, opacity: 1 });
      }
    });
    if (areas.length) gsap.set(areas, { opacity: 0 });
    if (fills.length) gsap.set(fills, { scaleX: 0 });
  });
}

function animateChart(panel, delay = 0) {
  if (!panel || REDUCED) {
    if (panel) prepareCharts();
    return;
  }

  const bars = panel.querySelectorAll('.life-bar, .life-stack');
  if (bars.length) {
    gsap.to(bars, {
      scaleY: 1,
      duration: 0.85,
      ease: 'power3.out',
      stagger: 0.016,
      delay,
      overwrite: 'auto',
    });
  }

  const line = panel.querySelector('.life-line');
  if (line && line.getAttribute('d')) {
    const len = line.getTotalLength();
    gsap.set(line, { strokeDasharray: len, strokeDashoffset: len });
    gsap.to(line, {
      strokeDashoffset: 0,
      duration: 1.45,
      ease: 'power2.inOut',
      delay: delay + 0.15,
      onComplete: () => gsap.set(line, { clearProps: 'strokeDasharray,strokeDashoffset' }),
    });
  }

  const area = panel.querySelector('.life-area');
  if (area) {
    gsap.fromTo(area, { opacity: 0 }, {
      opacity: 1, duration: 1, ease: 'power1.out', delay: delay + 0.5,
    });
  }

  const fills = panel.querySelectorAll('.life-fill, .life-weekday-bar');
  if (fills.length) {
    gsap.to(fills, {
      scaleX: 1, duration: 1.05, ease: 'power3.out', stagger: 0.045, delay,
    });
  }

  if (panel.querySelector('.life-map')) animateMap();
}

// ── 循环动效 ────────────────────────────────────────────────────────────

function killTicker() {
  if (tickerTween) {
    tickerTween.kill();
    tickerTween = null;
  }
}

function startTicker() {
  killTicker();
  const track = tickerTrackRef.value;
  if (!track) return;
  gsap.set(track, { xPercent: 0 });
  if (REDUCED) return;
  tickerTween = gsap.to(track, {
    xPercent: -50, duration: 34, ease: 'none', repeat: -1,
  });
}

function killLive() {
  if (dotTween) {
    dotTween.kill();
    dotTween = null;
  }
  const dot = sectionRef.value?.querySelector('.stats-live-dot');
  if (dot) gsap.set(dot, { clearProps: 'opacity' });
}

function startLive() {
  killLive();
  const dot = sectionRef.value?.querySelector('.stats-live-dot');
  if (REDUCED) {
    if (dot) gsap.set(dot, { opacity: 1 });
    return;
  }
  if (dot) {
    dotTween = gsap.to(dot, {
      opacity: 0.2, duration: 0.85, ease: 'sine.inOut', yoyo: true, repeat: -1,
    });
  }
}

// 悬浮提示：位置由 CSS 的 left 过渡，显隐交给 GSAP。
// 五个面板共用同一套节奏，避免每个图表各写一遍。
async function animateTip(el, row) {
  await nextTick();
  if (!el) return;
  if (REDUCED) {
    gsap.set(el, { opacity: row ? 1 : 0 });
    return;
  }
  if (row) {
    gsap.fromTo(el, { opacity: 0, y: 8, xPercent: -50 }, {
      opacity: 1, y: 0, xPercent: -50, duration: 0.26, ease: 'power2.out',
    });
  } else {
    gsap.to(el, { opacity: 0, y: 6, xPercent: -50, duration: 0.16, ease: 'power1.in' });
  }
}

watch(rhythmHoverRow, (v) => animateTip(tipRef.value, v));
watch(motionHoverRow, (v) => animateTip(motionTipRef.value, v));
watch(phoneHoverRow, (v) => animateTip(phoneTipRef.value, v));
watch(aiHoverRow, (v) => animateTip(aiTipRef.value, v));

function animateMap() {
  const svg = mapSvgRef.value;
  if (!svg) return;
  const tracks = svg.querySelectorAll('.life-map-track');
  const dots = svg.querySelectorAll('.life-map-dot');
  if (REDUCED) {
    tracks.forEach((t) => gsap.set(t, { clearProps: 'strokeDasharray,strokeDashoffset' }));
    if (dots.length) gsap.set(dots, { scale: 1, opacity: 1 });
    return;
  }
  tracks.forEach((t, i) => {
    const len = t.getTotalLength();
    if (!len) return;
    gsap.set(t, { strokeDasharray: len, strokeDashoffset: len });
    gsap.to(t, {
      strokeDashoffset: 0,
      duration: 1.25,
      delay: i * 0.08,
      ease: 'power2.out',
      overwrite: 'auto',
      onComplete: () => gsap.set(t, { clearProps: 'strokeDasharray,strokeDashoffset' }),
    });
  });
  if (dots.length) {
    gsap.fromTo(dots, { scale: 0.35, opacity: 0 }, {
      scale: 1,
      opacity: 1,
      duration: 0.7,
      delay: 0.35,
      stagger: 0.04,
      ease: 'power2.out',
      overwrite: 'auto',
    });
  }
}

// ── 生命周期 ────────────────────────────────────────────────────────────

let firstActivation = true;

onMounted(() => {
  activeNow = true;
  mountedAt = performance.now();
  startClock();
  startPolling();
  window.addEventListener('keydown', onDayKey);
  load();

  stopBrandWatch = watch(brandVisible, (v) => {
    if (!v && activeNow && !introStarted) scheduleIntro();
  });

  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      if (activeNow) ScrollTrigger.refresh();
    }).catch(() => {});
  }
});

onActivated(() => {
  if (firstActivation) {
    firstActivation = false;
    return;
  }
  activeNow = true;
  mountedAt = performance.now();
  startClock();
  startPolling();
  load();
  if (data.value) observeMap();
  if (data.value) {
    clearTimeout(introTimer);
    introTimer = setTimeout(() => {
      introTimer = null;
      if (activeNow) playIntro(introStarted);
    }, 420);
  }
});

function teardownMap() {
  if (mapObserver) {
    mapObserver.disconnect();
    mapObserver = null;
  }
  if (mapAbort) {
    mapAbort.abort();
    mapAbort = null;
  }
  if (mapState.value === 'loading') {
    mapStarted = false;
    mapState.value = mapTracks.value.length ? 'ready' : 'idle';
  }
}

onDeactivated(() => {
  activeNow = false;
  closeDay();
  stopPolling();
  stopClock();
  killIntro();
  killTicker();
  killLive();
  killReveals();
  teardownMap();
});

onBeforeUnmount(() => {
  activeNow = false;
  window.removeEventListener('keydown', onDayKey);
  closeDay();
  stopPolling();
  stopClock();
  killIntro();
  killTicker();
  killLive();
  killReveals();
  teardownMap();
  if (stopBrandWatch) stopBrandWatch();
  if (abortCtl) abortCtl.abort();
});
</script>

<template>
  <main class="page active">
    <section
      ref="sectionRef"
      class="stats-section life-section"
      :class="{ 'is-color': colorMode }"
    >
      <!-- 用 div 不用 header：全局 header 是 position: fixed -->
      <div class="stats-hero">
        <div class="stats-hero-kicker">
          <span class="stats-kicker stats-live">
            <i class="stats-live-dot" aria-hidden="true"></i>
            Live life feed
          </span>
          <span class="stats-kicker stats-kicker-rule" aria-hidden="true"></span>
          <span class="stats-kicker stats-clock">UTC+8 <b>{{ clock }}</b></span>
        </div>

        <h1 class="stats-title" aria-label="LIFE">
          <span class="stats-title-line" aria-hidden="true">
            <span v-for="(ch, i) in titleChars" :key="i" class="stats-char">{{ ch }}</span>
          </span>
        </h1>

        <div class="stats-hero-rule" aria-hidden="true"><span></span></div>

        <p class="stats-subtitle">A quiet record of time, motion, places and attention</p>

        <div class="stats-hero-meta">
          <span>Last {{ rows.length || '—' }} {{ rows.length === 1 ? 'day' : 'days' }}</span>
          <i aria-hidden="true"></i>
          <span>{{ city }}</span>
          <i aria-hidden="true"></i>
          <span>Updated {{ lastUpdated }}</span>
          <template v-if="latestIsToday">
            <i aria-hidden="true"></i>
            <span class="life-live-badge" title="Today's figures are partial until the 23:00 close">
              <i aria-hidden="true"></i>TODAY · LIVE
            </span>
          </template>
          <i aria-hidden="true"></i>
          <button
            class="life-color-toggle"
            :class="{ 'is-on': colorMode }"
            :aria-pressed="colorMode"
            @click="colorMode = !colorMode"
          >
            <span class="life-color-dots" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
            {{ colorMode ? 'COLOR ON' : 'COLOR OFF' }}
          </button>
        </div>
      </div>

      <div v-if="loading" class="stats-loading life-loading" aria-label="Loading life data">
        <span v-for="n in 5" :key="n"></span>
      </div>

      <div v-else-if="error" class="stats-empty">
        <p>Life data is temporarily unavailable.</p>
        <button class="stats-retry" @click="load">RETRY</button>
      </div>

      <template v-else>
        <div class="stats-ticker" aria-hidden="true">
          <div ref="tickerTrackRef" class="stats-ticker-track">
            <div v-for="g in 2" :key="g" class="stats-ticker-group">
              <span v-for="(item, i) in tickerItems" :key="i" class="stats-ticker-item">
                {{ item }}<i class="stats-ticker-sep"></i>
              </span>
            </div>
          </div>
        </div>

        <!-- 现在在干嘛（独立轮询 /api/life/now） -->
        <LifeNow @snapshot="onNowSnapshot" />

        <!-- KPI -->
        <div class="stats-cards life-cards">
          <article v-for="(card, i) in kpis" :key="card.key" class="stat-card">
            <div class="stat-card-head">
              <span class="stat-index">{{ String(i + 1).padStart(2, '0') }}</span>
              <span class="stat-eyebrow">{{ card.label }}</span>
            </div>

            <div class="stat-number-wrap">
              <OdometerNumber
                v-if="card.value !== null"
                class="stat-number"
                :value="card.value"
                :run="numbersRun"
                :delay="card.delay"
                :reduced="REDUCED"
              />
              <span v-else class="stat-number life-null">—</span>
            </div>

            <div class="stat-card-foot">
              <span class="stat-note">{{ card.note }}</span>
            </div>
          </article>
        </div>

        <!-- 00 神经网络大脑（交互 3D） -->
        <div class="stats-panel life-panel life-brain-panel" data-reveal>
          <div class="stats-panel-head">
            <div class="stats-panel-title">
              <span class="stats-panel-index">00</span>
              <h2>NEURAL CORE</h2>
            </div>
            <div class="stats-panel-head-right">
              <span class="stats-panel-sub">8 REGIONS · {{ rows.length }} DAYS · LIVE GRAPH</span>
            </div>
          </div>
          <LifeBrain
            :rows="rows"
            :color-mode="colorMode"
            :reduced="REDUCED"
            @select-day="openDay"
          />
        </div>

        <!-- 01 每日节奏 -->
        <div class="stats-panel life-panel" data-reveal data-chart="rhythm">
          <div class="stats-panel-head">
            <div class="stats-panel-title">
              <span class="stats-panel-index">01</span>
              <h2>DAILY RHYTHM</h2>
            </div>
            <span class="stats-panel-sub">7D · DESKTOP + GPS + WATCH + PHONE</span>
            <div class="stats-legend">
              <span v-for="c in rhythmLegend" :key="c.name" :class="{ 'is-zero': c.zero }">
                <i class="life-swatch" :class="`cat-${c.index}`"></i>{{ c.name }}
              </span>
            </div>
          </div>

          <div v-if="rhythmRows.length" class="life-chart">
            <div class="life-split">
              <div class="life-main-col">
                <div class="life-chart-main">
                  <div class="life-plot">
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

                    <div
                      class="stats-chart-cursor"
                      aria-hidden="true"
                      :style="{
                        left: rhythmHoverRow ? rhythmHoverRow.leftPct + '%' : '0%',
                        opacity: rhythmHoverRow ? 1 : 0,
                      }"
                    ></div>

                    <div
                      ref="tipRef"
                      class="stats-chart-tooltip life-tooltip"
                      aria-hidden="true"
                      :style="{ left: rhythmHoverRow ? rhythmHoverRow.tipPct + '%' : '0%' }"
                    >
                      <span class="stats-tip-date">{{ rhythmHoverRow ? fullDay(rhythmHoverRow.day) : '' }}<template v-if="rhythmHoverRow?.isToday"> · SO FAR</template></span>
                      <span class="stats-tip-row">
                        <b>{{ rhythmHoverRow?.total == null ? '—' : hoursLabel(rhythmHoverRow.total) }}</b>
                        <em>7D TOTAL</em>
                      </span>
                      <span
                        v-for="s in (rhythmHoverRow?.segments || []).slice(0, 4)"
                        :key="s.name"
                        class="stats-tip-row"
                      >
                        <b>{{ hoursLabel(s.hours) }}</b><em>{{ s.name.toUpperCase() }}</em>
                      </span>
                    </div>
                  </div>

                  <div class="stats-chart-yaxis" aria-hidden="true">
                    <span>{{ rhythmMax.toFixed(1) }}h</span>
                    <span>{{ (rhythmMax / 2).toFixed(1) }}h</span>
                    <span>0</span>
                  </div>
                </div>

                <div class="stats-chart-xaxis life-xaxis" aria-hidden="true">
                  <span v-for="r in rhythmRows" :key="r.day">{{ r.showLabel ? shortDay(r.day) : '' }}</span>
                </div>
              </div>

              <aside class="life-rail">
                <div class="life-rail-head">TOP APPLICATIONS</div>
                <div v-for="a in topApps" :key="a.name" class="life-row">
                  <span class="life-rank">{{ a.rank }}</span>
                  <span class="life-name">{{ a.name }}</span>
                  <span class="life-num">{{ hoursLabel(a.hours) }}</span>
                  <span class="life-track"><span class="life-fill" :style="{ width: a.pct + '%' }"></span></span>
                </div>
                <p v-if="!topApps.length" class="life-rail-empty">No desktop data yet.</p>
              </aside>
            </div>
          </div>

          <p v-else class="stats-panel-empty">No desktop activity recorded yet.</p>
        </div>

        <!-- 02 运动 -->
        <div class="stats-panel life-panel" data-reveal data-chart="motion">
          <div class="stats-panel-head">
            <div class="stats-panel-title">
              <span class="stats-panel-index">02</span>
              <h2>MOTION</h2>
            </div>
            <div class="stats-legend">
              <span><i class="lg-swatch"></i>Steps</span>
              <span><i class="lg-line"></i>7-day mean</span>
              <span><i class="lg-mean"></i>Period mean</span>
            </div>
          </div>

          <div v-if="motionRows.length" class="life-chart">
            <!-- 手表数据并入 MOTION：大爱心 + 心率 + 跑步 / 步数 -->
            <div v-if="watchSummary.stepDays || watchSummary.hrDays" class="life-motion-watch">
              <div class="life-heart-hero">
                <div class="life-heart-stage" aria-hidden="true">
                  <span class="life-heart-ring"></span>
                  <svg class="life-heart-icon" viewBox="0 0 24 24">
                    <path d="M12 20.2 4.9 13.1a4.7 4.7 0 0 1 6.6-6.6l.5.5.5-.5a4.7 4.7 0 0 1 6.6 6.6Z" />
                  </svg>
                  <!-- 波形在爱心下面：爱心压住中间，两侧仍能看到心跳线 -->
                  <svg class="life-heart-ecg" viewBox="0 0 320 80" preserveAspectRatio="none">
                    <path d="M0 40H120l8-2 8-22 10 44 10-32 8 12H200l10-24 10 34 8-10H320" />
                  </svg>
                </div>
                <div class="life-heart-readout">
                  <span class="life-heart-label">
                    HEART RATE · {{ watchSummary.day ? fullDay(watchSummary.day) : 'LATEST' }}
                  </span>
                  <strong class="life-heart-big">
                    {{ watchSummary.hrAvg != null ? Math.round(watchSummary.hrAvg) : '—' }}<em>BPM</em>
                  </strong>
                  <div
                    v-if="watchSummary.hrMin != null && watchSummary.hrMax != null"
                    class="life-heart-range"
                    aria-hidden="true"
                  >
                    <span class="life-heart-range-track"></span>
                    <span
                      class="life-heart-range-fill"
                      :style="{
                        left: hrZonePct(watchSummary.hrMin) + '%',
                        width: Math.max(hrZonePct(watchSummary.hrMax) - hrZonePct(watchSummary.hrMin), 0.8) + '%',
                      }"
                    ></span>
                    <span
                      v-if="watchSummary.hrAvg != null"
                      class="life-heart-range-avg"
                      :style="{ left: hrZonePct(watchSummary.hrAvg) + '%' }"
                    ></span>
                  </div>
                  <div class="life-heart-range-labels">
                    <span>MIN {{ watchSummary.hrMin != null ? Math.round(watchSummary.hrMin) : '—' }}</span>
                    <span>AVG {{ watchSummary.hrAvg != null ? Math.round(watchSummary.hrAvg) : '—' }}</span>
                    <span>MAX {{ watchSummary.hrMax != null ? Math.round(watchSummary.hrMax) : '—' }}</span>
                  </div>
                </div>
              </div>

              <div class="life-watch-metrics">
                <div class="life-watch-metric">
                  <span class="life-watch-metric-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <rect x="7.5" y="7.5" width="9" height="9" rx="2" />
                      <path d="M9.5 7.5V4.5h5v3M9.5 16.5v3h5v-3" />
                      <path d="M12 10.5v2l1.2 1" />
                    </svg>
                  </span>
                  <span class="life-watch-metric-label">STEPS</span>
                  <b>{{ watchSummary.steps != null ? fmt(Math.round(watchSummary.steps)) : '—' }}</b>
                  <em v-if="watchSummary.stepsAvg != null">
                    AVG {{ fmt(Math.round(watchSummary.stepsAvg)) }} · {{ watchSummary.stepDays }}D
                  </em>
                </div>

                <div
                  class="life-watch-metric life-watch-run"
                  role="button"
                  tabindex="0"
                  :aria-label="`Open running details, ${watchSummary.workouts.length} runs`"
                  @click="openRuns"
                  @keydown.enter.prevent="openRuns"
                  @keydown.space.prevent="openRuns"
                >
                  <span class="life-watch-metric-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <circle cx="15" cy="4.5" r="1.8" />
                      <path d="M13.2 8.2 10.5 13l-3.8 1.2" />
                      <path d="M13.2 8.2 16.6 10l2.4 3.6" />
                      <path d="M10.5 13l3.2 2.6.8 4.9" />
                      <path d="M10.5 13 8.2 17.2 5 19.5" />
                    </svg>
                  </span>
                  <span class="life-watch-metric-label">RUNNING</span>
                  <b>
                    {{ watchSummary.latestRunKm != null ? Number(watchSummary.latestRunKm).toFixed(1) : '—' }}<small>km</small>
                  </b>
                  <em v-if="watchSummary.latestRunDay">
                    {{ watchSummary.latestRunAge }} · {{ fullDay(watchSummary.latestRunDay) }}
                    · {{ watchSummary.latestRunRuns ? Math.round(watchSummary.latestRunRuns) : '—' }} runs
                    · {{ watchSummary.latestRunMinutes ? minutesLabel(watchSummary.latestRunMinutes) : '—' }}
                    · {{ watchSummary.latestRunPace ? paceLabel(watchSummary.latestRunPace) : '—' }}
                  </em>
                  <em v-if="watchSummary.runs != null">
                    WINDOW · {{ Number(watchSummary.km || 0).toFixed(1) }} km · {{ Math.round(watchSummary.runs) }} runs
                  </em>
                  <em class="life-watch-run-more">VIEW RUNS →</em>
                </div>

                <div class="life-watch-metric">
                  <span class="life-watch-metric-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M4 18c3-6 5-9 8-9s5 3 8 9" />
                      <circle cx="12" cy="9" r="2" />
                    </svg>
                  </span>
                  <span class="life-watch-metric-label">BEST PACE · ALL TIME</span>
                  <b>{{ watchSummary.bestPace ? paceLabel(watchSummary.bestPace) : '—' }}</b>
                  <em v-if="watchSummary.bestPaceDay">
                    {{ watchSummary.bestPaceAge }} · {{ fullDay(watchSummary.bestPaceDay) }}
                    <template v-if="watchSummary.bestPaceKm != null"> · {{ watchSummary.bestPaceKm }} km</template>
                  </em>
                  <em v-else>NO RUNS</em>
                </div>

                <div class="life-watch-metric">
                  <span class="life-watch-metric-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M4 12h4l2-6 4 12 2-6h4" />
                    </svg>
                  </span>
                  <span class="life-watch-metric-label">VO2MAX</span>
                  <b>{{ watchSummary.vo2 ?? '—' }}</b>
                  <em>ESTIMATE</em>
                </div>

                <div class="life-watch-metric">
                  <span class="life-watch-metric-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M4 18c3-6 5-9 8-9s5 3 8 9" />
                      <path d="M4 18h16" />
                    </svg>
                  </span>
                  <span class="life-watch-metric-label">LONGEST · ALL TIME</span>
                  <b>
                    {{ watchSummary.longestKm != null ? Number(watchSummary.longestKm).toFixed(1) : '—' }}<small>km</small>
                  </b>
                  <em v-if="watchSummary.longestDay">
                    {{ watchSummary.longestAge }} · {{ fullDay(watchSummary.longestDay) }}
                    <template v-if="watchSummary.longestName"> · {{ watchSummary.longestName }}</template>
                  </em>
                  <em v-else>NO RUNS</em>
                </div>

                <div class="life-watch-metric">
                  <span class="life-watch-metric-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="8" />
                      <path d="M12 7v5l3 2" />
                    </svg>
                  </span>
                  <span class="life-watch-metric-label">ALL TIME</span>
                  <b>{{ Math.round(watchSummary.allRuns || 0) }}<small>runs</small></b>
                  <em>{{ Number(watchSummary.allKm || 0).toFixed(1) }} km total</em>
                </div>
              </div>

              <div class="life-live-status">
                <div class="life-status" :class="`is-${liveStatus.phone.tone}`">
                  <span class="life-status-head"><i class="life-status-dot"></i> PHONE</span>
                  <b>{{ liveStatus.phone.label }}</b>
                  <em>{{ liveStatus.phone.note }}</em>
                </div>
                <div class="life-status" :class="`is-${liveStatus.desktop.tone}`">
                  <span class="life-status-head"><i class="life-status-dot"></i> DESKTOP</span>
                  <b>{{ liveStatus.desktop.label }}</b>
                  <em>{{ liveStatus.desktop.note }}</em>
                </div>
                <div class="life-status" :class="`is-${liveStatus.location.tone}`">
                  <span class="life-status-head"><i class="life-status-dot"></i> LOCATION</span>
                  <b>{{ liveStatus.location.label }}</b>
                  <em>{{ liveStatus.location.note }}</em>
                </div>
                <div class="life-status life-status-updated" :class="{ 'is-live': liveStatus.live }">
                  <span class="life-status-head"><i class="life-status-dot"></i> LIVE SNAPSHOT</span>
                  <b>{{ liveStatus.updated }}</b>
                  <em>PHONE · DESKTOP · GPS</em>
                </div>
              </div>
            </div>

            <div v-if="hrScale" class="life-hr life-motion-hr">
              <div class="life-hr-head">
                <span>HEART RATE · LAST {{ motionRows.length }} DAYS · {{ watchSummary.hrDays }} WITH DATA</span>
                <span>{{ hrScale.lo }}–{{ hrScale.hi }} BPM · DOT = AVG · HOVER FOR DETAILS</span>
              </div>
              <div class="life-hr-body">
                <div class="life-hr-main">
                  <div class="life-hr-track" @pointerleave="hrHover = -1">
                    <div
                      v-for="(r, i) in motionRows"
                      :key="r.day"
                      class="life-hr-col"
                      :class="{ 'is-missing': r.hrMax == null, 'is-today': r.isToday }"
                      @pointerenter="hrHover = i"
                      @focus="hrHover = i"
                      tabindex="0"
                    >
                      <span
                        v-if="r.hrMin != null && r.hrMax != null"
                        class="life-hr-range"
                        :style="{
                          bottom: hrPct(r.hrMin) + '%',
                          height: Math.max(hrPct(r.hrMax) - hrPct(r.hrMin), 0.5) + '%',
                        }"
                      ></span>
                      <span
                        v-if="r.hrAvg != null"
                        class="life-hr-avg"
                        :style="{ bottom: hrPct(r.hrAvg) + '%' }"
                      ></span>
                    </div>

                    <div
                      v-if="hrHoverRow"
                      class="life-hr-tip"
                      :style="{ left: hrTipPct + '%' }"
                    >
                      <span>{{ fullDay(hrHoverRow.day) }}<template v-if="hrHoverRow.isToday"> · TODAY</template></span>
                      <b v-if="hrHoverRow.hrAvg != null">
                        {{ Math.round(hrHoverRow.hrMin) }}–{{ Math.round(hrHoverRow.hrMax) }}
                        · AVG {{ Math.round(hrHoverRow.hrAvg) }}
                      </b>
                      <b v-else>NO HR DATA</b>
                    </div>
                  </div>
                  <div class="life-hr-axis" aria-hidden="true">
                    <span v-for="r in motionRows" :key="r.day">{{ r.showLabel ? shortDay(r.day) : '' }}</span>
                  </div>
                </div>
                <div class="life-hr-yaxis" aria-hidden="true">
                  <span>{{ hrScale.hi }}</span>
                  <span>{{ Math.round((hrScale.lo + hrScale.hi) / 2) }}</span>
                  <span>{{ hrScale.lo }}</span>
                </div>
              </div>
            </div>

            <div v-if="watchSummary.workouts.length" class="life-runs">
              <div class="life-runs-head">
                <span>RUNS · {{ watchSummary.workouts.length }} IN WINDOW</span>
                <span>CLICK A RUN FOR DETAILS</span>
              </div>
              <details
                v-for="w in watchSummary.workouts"
                :key="w.start"
                class="life-run"
              >
                <summary>
                  <span class="life-run-when">{{ fullDay(w.day) }} · {{ isoHhmm(w.start) }}</span>
                  <span class="life-run-name">{{ w.name || 'RUN' }}</span>
                  <span class="life-run-km">{{ w.km != null ? Number(w.km).toFixed(2) : '—' }} km</span>
                  <span class="life-run-time">{{ w.minutes ? minutesLabel(w.minutes) : '—' }}</span>
                  <span class="life-run-pace">{{ w.paceS ? paceLabel(w.paceS) : '—' }}</span>
                </summary>
                <div class="life-run-detail">
                  <span v-if="w.avgHr != null">AVG HR {{ w.avgHr }}</span>
                  <span v-if="w.maxHr != null">MAX HR {{ w.maxHr }}</span>
                  <span v-if="w.calories != null">CAL {{ w.calories }}</span>
                  <span v-if="w.cadence != null">CADENCE {{ w.cadence }} spm</span>
                  <span v-if="w.ascentM != null">ASCENT {{ w.ascentM }} m</span>
                  <span v-if="w.vo2max != null">VO2MAX {{ w.vo2max }}</span>
                  <span v-if="w.trainingEffect != null">TE {{ w.trainingEffect }}</span>
                  <span v-if="w.recoveryHours != null">RECOVERY {{ w.recoveryHours }} h</span>
                  <span v-if="w.end">{{ isoHhmm(w.start) }}–{{ isoHhmm(w.end) }}</span>
                </div>
              </details>
            </div>

            <div class="life-chart-main">
              <div class="life-plot">
                <div class="stats-chart-grid" aria-hidden="true"><i></i><i></i><i></i></div>

                <svg
                  class="stats-chart-svg life-svg"
                  viewBox="0 0 1000 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id="lifeStepsAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color="currentColor" stop-opacity="0.16" />
                      <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
                    </linearGradient>
                  </defs>
                  <path :d="rollingAreaPath" class="life-area" />
                  <path :d="rollingPath" class="life-line" />
                </svg>

                <div
                  v-if="motionMeanPct != null"
                  class="life-mean"
                  :style="{ bottom: motionMeanPct + '%' }"
                  aria-hidden="true"
                >
                  <span>MEAN {{ compact(Math.round(motionMean)) }} STEPS</span>
                </div>

                <div class="life-bars" :class="{ 'is-hovering': motionHover >= 0 }">
                  <div
                    v-for="(r, i) in motionRows"
                    :key="r.day"
                    class="life-col"
                    :class="{ 'is-missing': r.missing, 'is-today': r.isToday }"
                    tabindex="0"
                    role="img"
                    :aria-label="`${fullDay(r.day)}: ${r.steps == null ? 'no steps data' : fmt(r.steps) + ' steps'}`"
                    @pointerenter="motionHover = i"
                    @pointerleave="motionHover = -1"
                    @focus="motionHover = i"
                    @blur="motionHover = -1"
                    @click="openDay(r.day)"
                    @keydown.enter.prevent="openDay(r.day)"
                  >
                    <div class="life-bar" :style="{ height: r.pct + '%' }"></div>
                  </div>
                </div>

                <div
                  class="stats-chart-cursor"
                  aria-hidden="true"
                  :style="{
                    left: motionHoverRow ? motionHoverRow.leftPct + '%' : '0%',
                    opacity: motionHoverRow ? 1 : 0,
                  }"
                ></div>

                <div
                  ref="motionTipRef"
                  class="stats-chart-tooltip life-tooltip"
                  aria-hidden="true"
                  :style="{ left: motionHoverRow ? motionHoverRow.tipPct + '%' : '0%' }"
                >
                  <span class="stats-tip-date">{{ motionHoverRow ? fullDay(motionHoverRow.day) : '' }}<template v-if="motionHoverRow?.isToday"> · SO FAR</template></span>
                  <span class="stats-tip-row">
                    <b>{{ motionHoverRow?.steps == null ? '—' : fmt(motionHoverRow.steps) }}</b>
                    <em>STEPS</em>
                  </span>
                  <span class="stats-tip-row">
                    <b>{{ compact(Math.round(rollingMean[motionHover] ?? 0)) }}</b>
                    <em>7-DAY MEAN</em>
                  </span>
                  <span v-if="motionHoverRow?.hrAvg != null" class="stats-tip-row">
                    <b>{{ Math.round(motionHoverRow.hrAvg) }}</b><em>HR AVG</em>
                  </span>
                  <span
                    v-if="motionHoverRow?.hrMin != null && motionHoverRow?.hrMax != null"
                    class="stats-tip-row"
                  >
                    <b>{{ Math.round(motionHoverRow.hrMin) }}–{{ Math.round(motionHoverRow.hrMax) }}</b>
                    <em>HR RANGE</em>
                  </span>
                </div>
              </div>

              <div class="stats-chart-yaxis" aria-hidden="true">
                <span>{{ compact(stepsMax) }}</span>
                <span>{{ compact(Math.round(stepsMax / 2)) }}</span>
                <span>0</span>
              </div>
            </div>

            <div class="stats-chart-xaxis life-xaxis" aria-hidden="true">
              <span v-for="r in motionRows" :key="r.day">{{ r.showLabel ? shortDay(r.day) : '' }}</span>
            </div>

          </div>

          <p v-else class="stats-panel-empty">No health data recorded yet.</p>
        </div>

        <!-- 03 地点：区级时长 + 轨迹地图 -->
        <div class="stats-panel life-panel" data-reveal data-chart="places">
          <div class="stats-panel-head">
            <div class="stats-panel-title">
              <span class="stats-panel-index">03</span>
              <h2>PLACES</h2>
            </div>
            <span class="stats-panel-sub">
              {{ places.city }}<template v-if="places.cityCount > 1"> +{{ places.cityCount - 1 }}</template>
              · {{ (mapState === 'ready' || mapState === 'empty')
                ? `${mapTracks.length} days mapped${mapRemaining ? ` · ${mapRemaining} more` : ''}`
                : 'city level' }}
            </span>
          </div>

          <div v-if="places.any" class="life-places">
            <div class="life-map-grid">
              <div class="life-map-col">
                <div ref="mapEl" class="life-map" :class="{ 'is-hovering': !!mapHover }">
                  <div class="life-map-head">
                    <span>ROUTE MAP</span>
                    <span v-if="mapState === 'loading'">LOADING TRACKS…</span>
                    <span v-else-if="mapState === 'ready'">
                      {{ mapTracks.length }} DAYS · {{ fmt(mappedMinutes) }} MIN · {{ fmt(mappedPoints) }} PTS
                    </span>
                    <span v-else-if="mapState === 'error'">TRACK ARCHIVE UNAVAILABLE</span>
                    <span v-else-if="mapState === 'empty'">{{ mapRemaining ? 'NO TRACKS IN FIRST BATCH' : 'NO TRACKS IN WINDOW' }}</span>
                    <span v-else>PUBLIC TRACK ARCHIVE</span>
                  </div>

                  <div v-if="mapHoverTrack" class="life-map-readout">
                    <span>{{ fullDay(mapHoverTrack.day) }}</span>
                    <span>{{ minutesLabel(mapHoverTrack.minutes || mapHoverTrack.watchMinutes) }}</span>
                    <span>{{ fmt(mapHoverTrack.points) }} pts</span>
                  </div>

                  <div v-if="geoMap" class="life-map-zoom" @pointerdown.stop @wheel.stop>
                    <button
                      type="button"
                      :disabled="mapZoom >= MAP_ZOOM_MAX"
                      aria-label="Zoom in"
                      title="Zoom in · Ctrl + wheel"
                      @click="zoomMap(1.5)"
                    >+</button>
                    <button
                      type="button"
                      :disabled="mapZoom <= MAP_ZOOM_MIN"
                      aria-label="Zoom out"
                      title="Zoom out · Ctrl + wheel"
                      @click="zoomMap(1 / 1.5)"
                    >−</button>
                    <button
                      v-if="mapIsZoomed"
                      type="button"
                      class="is-reset"
                      aria-label="Reset zoom"
                      title="Reset zoom"
                      @click="resetMapZoom"
                    >RESET</button>
                  </div>

                  <svg
                    v-if="geoMap"
                    ref="mapSvgRef"
                    class="life-map-svg"
                    :class="{ 'is-zoomed': mapIsZoomed, 'is-dragging': mapDragging }"
                    :viewBox="`0 0 ${geoMap.width} ${geoMap.height}`"
                    preserveAspectRatio="xMidYMid meet"
                    :style="{ touchAction: mapIsZoomed ? 'none' : 'auto' }"
                    role="img"
                    :aria-label="`Route map: ${mapTracks.length} days around ${places.city}`"
                    @wheel="onMapWheel"
                    @pointerdown="onMapPointerDown"
                    @pointermove="onMapPointerMove"
                    @pointerup="onMapPointerUp"
                    @pointercancel="onMapPointerUp"
                    @pointerleave="onMapPointerUp"
                    @dblclick="onMapDoubleClick"
                  >
                    <g class="life-map-viewport" :transform="mapTransform">
                    <g class="life-map-grid" aria-hidden="true">
                      <line
                        v-for="x in geoMap.gridX"
                        :key="'gx' + x"
                        :x1="x"
                        y1="0"
                        :x2="x"
                        :y2="geoMap.height"
                      />
                      <line
                        v-for="y in geoMap.gridY"
                        :key="'gy' + y"
                        x1="0"
                        :y1="y"
                        :x2="geoMap.width"
                        :y2="y"
                      />
                    </g>

                    <text
                      class="life-map-watermark"
                      :x="geoMap.width - 24"
                      :y="geoMap.height - 30"
                      :style="{ fontSize: `${64 / mapZoom}px` }"
                      text-anchor="end"
                      aria-hidden="true"
                    >{{ places.city.toUpperCase() }}</text>

                    <g class="life-map-visits" aria-hidden="true">
                      <g v-for="(v, i) in geoMap.visits" :key="'v' + i">
                        <circle
                          class="life-map-visit-ring"
                          :cx="v.x"
                          :cy="v.y"
                          :r="(v.r + 4) / mapZoom"
                        />
                        <circle
                          class="life-map-dot"
                          :cx="v.x"
                          :cy="v.y"
                          :r="v.r / mapZoom"
                        />
                      </g>
                    </g>

                    <g class="life-map-routes" aria-hidden="true">
                      <path
                        v-for="(t, i) in geoMap.paths"
                        :key="t.day"
                        class="life-map-track"
                        :class="{
                          'is-active': t.day === mapHover,
                          'is-latest': t.day === mapTracks[0].day,
                        }"
                        :style="colorMode ? { stroke: `var(--cat-${i % 8})` } : null"
                        :d="t.d"
                      />
                    </g>

                    <g v-if="geoMap.watchPaths.length" class="life-map-watch-routes" aria-hidden="true">
                      <path
                        v-for="(p, i) in geoMap.watchPaths"
                        :key="'watch' + i"
                        class="life-map-track is-watch"
                        :class="{ 'is-active': p.day === mapHover }"
                        :d="p.d"
                      />
                    </g>

                    <g class="life-map-labels" aria-hidden="true">
                      <text
                        v-for="(l, i) in geoMap.labels"
                        :key="'l' + i"
                        :x="l.x + l.dx"
                        :y="l.y + 3"
                        :text-anchor="l.anchor"
                        :style="{ fontSize: `${11 / mapZoom}px`, strokeWidth: `${3 / mapZoom}px` }"
                      >{{ l.text }}</text>
                    </g>
                    </g>

                    <g v-if="!mapIsZoomed" class="life-map-scale" aria-hidden="true">
                      <line
                        :x1="geoMap.scale.x"
                        :y1="geoMap.scale.y"
                        :x2="geoMap.scale.x + geoMap.scale.px"
                        :y2="geoMap.scale.y"
                      />
                      <line
                        :x1="geoMap.scale.x"
                        :y1="geoMap.scale.y - 4"
                        :x2="geoMap.scale.x"
                        :y2="geoMap.scale.y + 4"
                      />
                      <line
                        :x1="geoMap.scale.x + geoMap.scale.px"
                        :y1="geoMap.scale.y - 4"
                        :x2="geoMap.scale.x + geoMap.scale.px"
                        :y2="geoMap.scale.y + 4"
                      />
                      <text
                        :x="geoMap.scale.x"
                        :y="geoMap.scale.y - 10"
                      >{{ geoMap.scale.km }} KM</text>
                    </g>

                    <g class="life-map-compass" aria-hidden="true" :transform="`translate(${geoMap.width - 46} 48)`">
                      <line x1="0" y1="16" x2="0" y2="-8" />
                      <path d="M-4 -1 L0 -10 L4 -1" />
                      <text x="0" y="30" text-anchor="middle">N</text>
                    </g>
                  </svg>

                  <div v-else class="life-map-placeholder">
                    <span class="life-map-skeleton" aria-hidden="true"><i></i><i></i><i></i></span>
                    <span>
                      {{ mapState === 'loading'
                        ? 'Reading public track archive…'
                        : mapState === 'error'
                          ? 'Tracks are temporarily unavailable.'
                          : (mapRemaining ? 'No tracks in the first batch. Load more below.' : 'No track data in this window.') }}
                    </span>
                    <button
                      v-if="mapState === 'error'"
                      class="life-map-retry"
                      @click="loadTracks(true)"
                    >RETRY TRACKS</button>
                  </div>
                </div>

                <div v-if="mapTracks.length" class="life-map-days" role="tablist" aria-label="Mapped days">
                  <button
                    class="life-map-day"
                    :class="{ 'is-active': !mapHover }"
                    role="tab"
                    :aria-selected="!mapHover"
                    @pointerenter="mapHover = ''"
                    @focus="mapHover = ''"
                    @click="mapHover = ''"
                  >
                    ALL
                  </button>
                  <button
                    v-for="t in mapTracks"
                    :key="t.day"
                    class="life-map-day"
                    :class="{ 'is-active': t.day === mapHover }"
                    role="tab"
                    :aria-selected="t.day === mapHover"
                    :aria-label="`${fullDay(t.day)}: ${minutesLabel(t.minutes || t.watchMinutes)}`"
                    @pointerenter="mapHover = t.day"
                    @focus="mapHover = t.day"
                    @click="mapHover = t.day"
                  >
                    <span>{{ shortDay(t.day) }}</span>
                    <b>{{ (t.minutes || t.watchMinutes) ? Math.round(t.minutes || t.watchMinutes) : '·' }}</b>
                  </button>
                </div>

                <div v-if="mapState === 'ready' || mapState === 'empty'" class="life-map-more-row">
                  <span>{{ mapTracks.length }} / {{ mapDays.length }} DAYS</span>
                  <button
                    v-if="mapRemaining"
                    type="button"
                    class="life-map-more-btn"
                    :disabled="mapLoadingMore"
                    @click="loadMoreTracks"
                  >
                    {{ mapLoadingMore ? 'LOADING…' : `LOAD MORE · ${mapRemaining}` }}
                  </button>
                  <span v-else class="life-map-more-done">ALL LOADED</span>
                </div>
              </div>

              <aside class="life-rail life-map-rail">
                <div class="life-rail-head">STAYS BY DISTRICT</div>
                <div v-for="(p, i) in places.rows" :key="p.name" class="life-row">
                  <span class="life-rank">{{ String(i + 1).padStart(2, '0') }}</span>
                  <span class="life-name">{{ p.name }}</span>
                  <span class="life-num">{{ hoursLabel(p.hours) }}</span>
                  <span class="life-track"><span class="life-fill" :style="{ width: p.pct + '%' }"></span></span>
                </div>
                <p v-if="!places.rows.length" class="life-rail-empty">No district stays yet.</p>

                <div v-if="transportRows.length" class="life-rail-group">
                  <div class="life-rail-head">TRANSPORT · MAPPED DAYS</div>
                  <div v-for="t in transportRows" :key="t.name" class="life-row">
                    <span class="life-rank">{{ t.rank }}</span>
                    <span class="life-name">{{ t.name }}</span>
                    <span class="life-num">{{ minutesLabel(t.minutes) }}</span>
                    <span class="life-track"><span class="life-fill" :style="{ width: t.pct + '%' }"></span></span>
                  </div>
                </div>
              </aside>
            </div>

            <div class="life-chips life-chips-pad">
              <span v-for="c in places.chips" :key="c.label" class="life-chip">
                <em>{{ c.label }}</em><b>{{ c.value }}</b>
              </span>
              <span v-if="mapTracks.length" class="life-chip">
                <em>MAPPED DAYS</em><b>{{ mapTracks.length }}</b>
              </span>
            </div>
          </div>

          <p v-else class="stats-panel-empty">No location data recorded yet.</p>
        </div>

        <!-- 04 手机 -->
        <div class="stats-panel life-panel" data-reveal data-chart="phone">
          <div class="stats-panel-head">
            <div class="stats-panel-title">
              <span class="stats-panel-index">04</span>
              <h2>PHONE</h2>
            </div>
            <div class="stats-legend">
              <span><i class="lg-swatch"></i>Unlocks</span>
              <span><i class="lg-mean"></i>Period mean</span>
            </div>
          </div>

          <div v-if="phoneRows.length" class="life-chart">
            <div class="life-split">
              <div class="life-main-col">
                <div class="life-chart-main">
                  <div class="life-plot">
                    <div class="stats-chart-grid" aria-hidden="true"><i></i><i></i><i></i></div>

                    <div
                      v-if="phoneMeanPct != null"
                      class="life-mean"
                      :style="{ bottom: phoneMeanPct + '%' }"
                      aria-hidden="true"
                    >
                      <span>MEAN {{ compact(Math.round(phoneMean)) }} UNLOCKS</span>
                    </div>

                    <div class="life-bars" :class="{ 'is-hovering': phoneHover >= 0 }">
                      <div
                        v-for="(r, i) in phoneRows"
                        :key="r.day"
                        class="life-col"
                        :class="{ 'is-missing': r.missing, 'is-today': r.isToday }"
                        tabindex="0"
                        role="img"
                        :aria-label="`${fullDay(r.day)}: ${r.unlocks == null ? 'no phone data' : fmt(r.unlocks) + ' unlocks'}`"
                        @pointerenter="phoneHover = i"
                        @pointerleave="phoneHover = -1"
                        @focus="phoneHover = i"
                        @blur="phoneHover = -1"
                        @click="openDay(r.day)"
                        @keydown.enter.prevent="openDay(r.day)"
                      >
                        <div class="life-bar" :style="{ height: r.pct + '%' }"></div>
                      </div>
                    </div>

                    <div
                      class="stats-chart-cursor"
                      aria-hidden="true"
                      :style="{
                        left: phoneHoverRow ? phoneHoverRow.leftPct + '%' : '0%',
                        opacity: phoneHoverRow ? 1 : 0,
                      }"
                    ></div>

                    <div
                      ref="phoneTipRef"
                      class="stats-chart-tooltip life-tooltip"
                      aria-hidden="true"
                      :style="{ left: phoneHoverRow ? phoneHoverRow.tipPct + '%' : '0%' }"
                    >
                      <span class="stats-tip-date">{{ phoneHoverRow ? fullDay(phoneHoverRow.day) : '' }}<template v-if="phoneHoverRow?.isToday"> · SO FAR</template></span>
                      <span class="stats-tip-row">
                        <b>{{ phoneHoverRow?.unlocks == null ? '—' : fmt(phoneHoverRow.unlocks) }}</b>
                        <em>UNLOCKS</em>
                      </span>
                      <span class="stats-tip-row">
                        <b>{{ phoneHoverRow?.payload?.phone?.screenMinutes == null ? '—' : minutesLabel(phoneHoverRow.payload.phone.screenMinutes) }}</b>
                        <em>SCREEN TIME</em>
                      </span>
                    </div>
                  </div>
                  <div class="stats-chart-yaxis" aria-hidden="true">
                    <span>{{ compact(phoneMax) }}</span>
                    <span>{{ compact(Math.round(phoneMax / 2)) }}</span>
                    <span>0</span>
                  </div>
                </div>

                <div class="stats-chart-xaxis life-xaxis" aria-hidden="true">
                  <span v-for="r in phoneRows" :key="r.day">{{ r.showLabel ? shortDay(r.day) : '' }}</span>
                </div>
              </div>

              <aside class="life-rail">
                <div class="life-rail-head">MOST USED</div>
                <div v-for="a in phoneTop" :key="a.name" class="life-row">
                  <span class="life-rank">{{ a.rank }}</span>
                  <span class="life-name">{{ a.name }}</span>
                  <span class="life-num">{{ minutesLabel(a.minutes) }}</span>
                  <span class="life-track"><span class="life-fill" :style="{ width: a.pct + '%' }"></span></span>
                </div>
                <p v-if="!phoneTop.length" class="life-rail-empty">No app usage yet.</p>
              </aside>
            </div>

            <div class="life-chips life-chips-pad">
              <span v-for="c in phoneChips" :key="c.label" class="life-chip">
                <em>{{ c.label }}</em><b>{{ c.value }}</b>
              </span>
            </div>
          </div>

          <p v-else class="stats-panel-empty">No phone data recorded yet.</p>
        </div>

        <!-- 05 AI 花费 -->
        <div class="stats-panel life-panel" data-reveal data-chart="ai">
          <div class="stats-panel-head">
            <div class="stats-panel-title">
              <span class="stats-panel-index">05</span>
              <h2>AI SPEND</h2>
            </div>
            <div class="stats-panel-head-right">
              <span class="stats-panel-sub">CNY · {{ aiChips[2].value }}</span>
              <div class="stats-legend">
                <span><i class="lg-swatch"></i>Daily cost</span>
                <span><i class="lg-mean"></i>Period mean</span>
              </div>
            </div>
          </div>

          <div v-if="hasAi" class="life-chart">
            <div class="life-split">
              <div class="life-main-col">
                <div class="life-chart-main">
                  <div class="life-plot">
                    <div class="stats-chart-grid" aria-hidden="true"><i></i><i></i><i></i></div>

                    <div
                      v-if="aiMeanPct != null"
                      class="life-mean"
                      :style="{ bottom: aiMeanPct + '%' }"
                      aria-hidden="true"
                    >
                      <span>MEAN ¥{{ aiMean.toFixed(2) }}</span>
                    </div>

                    <div class="life-bars" :class="{ 'is-hovering': aiHover >= 0 }">
                      <div
                        v-for="(r, i) in aiRows"
                        :key="r.day"
                        class="life-col"
                        :class="{ 'is-missing': r.missing, 'is-today': r.isToday }"
                        tabindex="0"
                        role="img"
                        :aria-label="`${fullDay(r.day)}: ${r.cost == null ? 'no AI data' : '¥' + r.cost}`"
                        @pointerenter="aiHover = i"
                        @pointerleave="aiHover = -1"
                        @focus="aiHover = i"
                        @blur="aiHover = -1"
                        @click="openDay(r.day)"
                        @keydown.enter.prevent="openDay(r.day)"
                      >
                        <div class="life-bar" :style="{ height: r.pct + '%' }"></div>
                      </div>
                    </div>

                    <div
                      class="stats-chart-cursor"
                      aria-hidden="true"
                      :style="{
                        left: aiHoverRow ? aiHoverRow.leftPct + '%' : '0%',
                        opacity: aiHoverRow ? 1 : 0,
                      }"
                    ></div>

                    <div
                      ref="aiTipRef"
                      class="stats-chart-tooltip life-tooltip"
                      aria-hidden="true"
                      :style="{ left: aiHoverRow ? aiHoverRow.tipPct + '%' : '0%' }"
                    >
                      <span class="stats-tip-date">{{ aiHoverRow ? fullDay(aiHoverRow.day) : '' }}<template v-if="aiHoverRow?.isToday"> · SO FAR</template></span>
                      <span class="stats-tip-row">
                        <b>{{ aiHoverRow?.cost == null ? '—' : `¥${aiHoverRow.cost.toFixed(2)}` }}</b>
                        <em>SPEND</em>
                      </span>
                      <span class="stats-tip-row">
                        <b>{{ aiHoverRow?.payload?.ai?.calls == null ? '—' : fmt(aiHoverRow.payload.ai.calls) }}</b>
                        <em>CALLS</em>
                      </span>
                    </div>
                  </div>
                  <div class="stats-chart-yaxis" aria-hidden="true">
                    <span>¥{{ aiMax.toFixed(2) }}</span>
                    <span>¥{{ (aiMax / 2).toFixed(2) }}</span>
                    <span>0</span>
                  </div>
                </div>

                <div class="stats-chart-xaxis life-xaxis" aria-hidden="true">
                  <span v-for="r in aiRows" :key="r.day">{{ r.showLabel ? shortDay(r.day) : '' }}</span>
                </div>
              </div>

              <aside class="life-rail">
                <div v-for="g in aiBreakdown.groups" :key="g.kind" class="life-rail-group">
                  <div class="life-rail-head">{{ g.kind }}</div>
                  <div v-for="(a, i) in g.rows" :key="a.name" class="life-row">
                    <span class="life-rank">{{ String(i + 1).padStart(2, '0') }}</span>
                    <span class="life-name">{{ a.name }}</span>
                    <span class="life-num">¥{{ a.cost.toFixed(2) }}</span>
                    <span class="life-track"><span class="life-fill" :style="{ width: a.pct + '%' }"></span></span>
                  </div>
                </div>
                <p v-if="!aiBreakdown.groups.length" class="life-rail-empty">No breakdown available.</p>
              </aside>
            </div>

            <div class="life-chips life-chips-pad">
              <span v-for="c in aiChips" :key="c.label" class="life-chip">
                <em>{{ c.label }}</em><b>{{ c.value }}</b>
              </span>
            </div>
          </div>

          <p v-else class="stats-panel-empty">No AI spend recorded in this window.</p>
        </div>

        <!-- 06 星期轮廓 -->
        <div class="stats-panel life-panel" data-reveal data-chart="weekday">
          <div class="stats-panel-head">
            <div class="stats-panel-title">
              <span class="stats-panel-index">06</span>
              <h2>WEEKDAY PROFILE</h2>
            </div>
            <span class="stats-panel-sub">7D · DESKTOP + GPS + WATCH + PHONE</span>
            <div class="stats-legend">
              <span v-for="c in rhythmLegend" :key="c.name" :class="{ 'is-zero': c.zero }">
                <i class="life-swatch" :class="`cat-${c.index}`"></i>{{ c.name }}
              </span>
            </div>
          </div>

          <div class="life-weekday">
            <div class="life-weekday-rows">
              <div
                v-for="(d, i) in weekdayRows"
                :key="d.label"
                class="life-weekday-row"
                :class="{ 'is-empty': d.total == null, 'is-hover': weekdayHover === i }"
                tabindex="0"
                role="img"
                :aria-label="`${d.label}: ${d.total == null ? 'no data' : hoursLabel(d.total) + ' average tracked'}`"
                @pointerenter="weekdayHover = i"
                @pointerleave="weekdayHover = -1"
                @focus="weekdayHover = i"
                @blur="weekdayHover = -1"
              >
                <span class="life-weekday-label">{{ d.label }}</span>
                <span class="life-weekday-track">
                  <span
                    class="life-weekday-bar"
                    :style="{ width: d.pct + '%' }"
                  >
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

            <div class="life-chips life-chips-pad">
              <span v-for="c in weekdayChips" :key="c.label" class="life-chip">
                <em>{{ c.label }}</em><b>{{ c.value }}</b>
              </span>
              <span v-if="weekdayHoverRow && weekdayHoverRow.total != null" class="life-chip life-chip-live">
                <em>{{ weekdayHoverRow.label }}</em>
                <b>{{ hoursLabel(weekdayHoverRow.total) }} avg</b>
              </span>
            </div>
          </div>
        </div>

        <!-- 07 归档：全量原始数据 -->
        <div class="stats-panel life-panel life-archive-panel" data-reveal>
          <div class="stats-panel-head">
            <div class="stats-panel-title">
              <span class="stats-panel-index">07</span>
              <h2>THE ARCHIVE</h2>
            </div>
            <span class="stats-panel-sub">Unfiltered · {{ archiveTotal }} entries</span>
          </div>

          <div class="life-archive-grid">
            <router-link
              v-for="(t, i) in archiveTabs"
              :key="t.kind"
              :to="`/life/archive/${t.kind}`"
              class="life-archive-card"
              @pointerenter="prefetchArchive(t.kind)"
              @focus="prefetchArchive(t.kind)"
            >
              <span class="life-archive-index">{{ String(i + 1).padStart(2, '0') }}</span>
              <span class="life-archive-name">{{ t.label }}</span>
              <span class="life-archive-note">{{ t.note }}</span>
              <span class="life-archive-meta">
                {{ t.count ? t.count + ' entries' : 'No entries yet' }}
              </span>
              <span class="life-archive-arrow" aria-hidden="true">→</span>
            </router-link>
          </div>

          <p class="life-archive-privacy">
            <i aria-hidden="true"></i>
            Raw life log: coordinates, window titles, URLs, journals and notes are public.
            Credential-like URL query values are replaced with REDACTED.
          </p>
        </div>

        <p class="stats-foot" data-reveal>
          <span><i aria-hidden="true"></i>Raw archive includes coordinates and window titles</span>
          <span><i aria-hidden="true"></i>Credential-like URL values redacted</span>
          <span><i aria-hidden="true"></i>{{ data.timezone }}</span>
          <span><i aria-hidden="true"></i>Refreshes every 60 seconds</span>
        </p>
      </template>
    </section>

    <!-- 单日详情：点任意一天的柱子打开 -->
    <Teleport to="body">
      <Transition name="life-day">
        <div v-if="dayDetail" class="life-day-backdrop" @click.self="closeDay">
          <div
            class="life-day-modal"
            :class="{ 'is-color': colorMode }"
            role="dialog"
            aria-modal="true"
            :aria-label="`${fullDay(dayDetail)} data`"
          >
            <div class="life-day-head">
              <div>
                <span class="life-day-kicker">
                  Single day · {{ weekdayName(dayDetail) }}
                  <template v-if="dayDetail === todayRef"> · TODAY · IN PROGRESS</template>
                </span>
                <h3>{{ fullDay(dayDetail) }}</h3>
              </div>
              <button
                ref="dayCloseRef"
                class="life-day-close"
                aria-label="Close day view"
                @click="closeDay"
              >CLOSE <span aria-hidden="true">×</span></button>
            </div>

            <template v-if="dayView?.payload">
              <div class="life-day-stats">
                <span>
                  <em>TRACKED</em>
                  <b>{{ dayView.payload.trackedHours == null ? '—' : hoursLabel(dayView.payload.trackedHours) }}</b>
                </span>
                <span>
                  <em>STEPS</em>
                  <b>{{ dayView.payload.health?.steps == null ? '—' : fmt(dayView.payload.health.steps) }}</b>
                </span>
                <span>
                  <em>TRANSIT</em>
                  <b>{{
                    (dayView.payload.location?.transitMinutes ?? dayView.payload.location?.movingMinutes) == null
                      ? '—'
                      : minutesLabel(dayView.payload.location.transitMinutes ?? dayView.payload.location.movingMinutes)
                  }}</b>
                </span>
                <span>
                  <em>UNLOCKS</em>
                  <b>{{ dayView.payload.phone?.unlocks == null ? '—' : fmt(dayView.payload.phone.unlocks) }}</b>
                </span>
                <span>
                  <em>AI SPEND</em>
                  <b>{{ dayView.payload.ai?.cost == null ? '—' : `¥${dayView.payload.ai.cost.toFixed(2)}` }}</b>
                </span>
              </div>

              <div class="life-day-body">
                <div class="life-day-grid">
                  <section v-if="dayView.categories.length" class="life-day-block">
                    <h4>CATEGORIES</h4>
                    <div v-for="c in dayView.categories" :key="c.name" class="life-day-row">
                      <i class="life-swatch" :class="`cat-${c.cat}`"></i>
                      <span class="life-name">{{ c.name }}</span>
                      <span class="life-num">{{ hoursLabel(c.hours) }}</span>
                      <span class="life-track">
                        <span
                          class="life-fill"
                          :style="{
                            width: c.pct + '%',
                            background: colorMode ? `var(--cat-${c.cat})` : null,
                          }"
                        ></span>
                      </span>
                    </div>
                  </section>

                  <section v-if="dayView.healthRows.length" class="life-day-block">
                    <h4>HEALTH</h4>
                    <div v-for="r in dayView.healthRows" :key="r[0]" class="life-day-kv-row">
                      <span>{{ r[0] }}</span><b>{{ r[1] }}</b>
                    </div>
                  </section>

                  <section v-if="dayView.payload.location" class="life-day-block">
                    <h4>PLACES · {{ dayView.payload.location.city || 'UNKNOWN CITY' }}</h4>
                    <div v-for="d in dayView.districts" :key="d.name" class="life-day-row">
                      <span></span>
                      <span class="life-name">{{ d.name }}</span>
                      <span class="life-num">{{ hoursLabel(d.hours) }}</span>
                      <span class="life-track">
                        <span
                          class="life-fill"
                          :style="{
                            width: d.pct + '%',
                            background: colorMode ? 'var(--cat-2)' : null,
                          }"
                        ></span>
                      </span>
                    </div>
                    <div class="life-day-kv-row">
                      <span>STAYING</span>
                      <b>{{ minutesLabel(dayView.payload.location.stayMinutes) }}</b>
                    </div>
                    <div class="life-day-kv-row">
                      <span>MAX SPAN</span>
                      <b>{{ kmLabel(dayView.payload.location.spanKm) }}</b>
                    </div>
                    <div class="life-day-kv-row">
                      <span>GPS POINTS</span>
                      <b>{{ dayView.payload.location.points == null ? '—' : fmt(dayView.payload.location.points) }}</b>
                    </div>
                  </section>

                  <section v-if="dayView.payload.phone" class="life-day-block">
                    <h4>PHONE</h4>
                    <div class="life-day-kv-row">
                      <span>SCREEN TIME</span>
                      <b>{{ minutesLabel(dayView.payload.phone.screenMinutes) }}</b>
                    </div>
                    <div class="life-day-kv-row">
                      <span>APP SWITCHES</span>
                      <b>{{ dayView.payload.phone.appSwitches == null ? '—' : fmt(dayView.payload.phone.appSwitches) }}</b>
                    </div>
                    <div v-for="a in dayView.phoneApps" :key="a.name" class="life-day-row">
                      <span class="life-rank">{{ a.rank }}</span>
                      <span class="life-name">{{ a.name }}</span>
                      <span class="life-num">{{ minutesLabel(a.value) }}</span>
                      <span class="life-track">
                        <span
                          class="life-fill"
                          :style="{
                            width: a.pct + '%',
                            background: colorMode ? 'var(--cat-1)' : null,
                          }"
                        ></span>
                      </span>
                    </div>
                  </section>

                  <section v-if="dayView.payload.ai" class="life-day-block">
                    <h4>AI SPEND</h4>
                    <div class="life-day-kv-row">
                      <span>TOTAL</span>
                      <b>{{ dayView.payload.ai.cost == null ? '—' : `¥${dayView.payload.ai.cost.toFixed(2)}` }}</b>
                    </div>
                    <div class="life-day-kv-row">
                      <span>CALLS</span>
                      <b>{{ dayView.payload.ai.calls == null ? '—' : fmt(dayView.payload.ai.calls) }}</b>
                    </div>
                    <div v-for="g in dayView.aiGroups" :key="g.kind" class="life-day-subgroup">
                      <h5>{{ g.kind }}</h5>
                      <div v-for="r in g.rows" :key="r.name" class="life-day-row">
                        <span class="life-rank">{{ r.rank }}</span>
                        <span class="life-name">{{ r.name }}</span>
                        <span class="life-num">¥{{ r.value.toFixed(2) }}</span>
                        <span class="life-track">
                          <span
                            class="life-fill"
                            :style="{
                              width: r.pct + '%',
                              background: colorMode ? 'var(--cat-3)' : null,
                            }"
                          ></span>
                        </span>
                      </div>
                    </div>
                  </section>
                </div>

                <p class="life-day-foot">
                  Aggregated snapshot · raw events, window titles and coordinates live in THE ARCHIVE
                </p>
              </div>
            </template>

            <p v-else class="life-day-empty">
              No aggregate data recorded for this day.
            </p>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 跑步详情：点 MOTION 里的 RUNNING 卡打开 -->
    <Teleport to="body">
      <Transition name="life-day">
        <div v-if="runsOpen" class="life-day-backdrop" @click.self="closeRuns">
          <div
            class="life-day-modal life-runs-modal"
            :class="{ 'is-color': colorMode }"
            role="dialog"
            aria-modal="true"
            aria-label="Running details"
          >
            <div class="life-day-head">
              <div>
                <span class="life-day-kicker">
                  Running · {{ watchSummary.workouts.length }} runs in window
                </span>
                <h3>RUNNING</h3>
              </div>
              <button class="life-day-close" aria-label="Close running details" @click="closeRuns">
                CLOSE <span aria-hidden="true">×</span>
              </button>
            </div>

            <div class="life-runs-modal-body">
              <article
                v-for="w in watchSummary.workouts"
                :key="w.start"
                class="life-run-modal-item"
              >
                <div class="life-run-modal-head">
                  <span class="life-run-modal-when">{{ fullDay(w.day) }} · {{ isoHhmm(w.start) }}</span>
                  <span class="life-run-modal-name">{{ w.name || 'RUN' }}</span>
                  <strong>{{ w.km != null ? Number(w.km).toFixed(2) : '—' }}<small>km</small></strong>
                  <span>{{ w.minutes ? minutesLabel(w.minutes) : '—' }}</span>
                  <span>{{ w.paceS ? paceLabel(w.paceS) : '—' }}</span>
                </div>
                <div class="life-run-modal-meta">
                  <span v-if="w.avgHr != null">AVG HR {{ w.avgHr }}</span>
                  <span v-if="w.maxHr != null">MAX HR {{ w.maxHr }}</span>
                  <span v-if="w.calories != null">CAL {{ w.calories }}</span>
                  <span v-if="w.cadence != null">CADENCE {{ w.cadence }} spm</span>
                  <span v-if="w.ascentM != null">ASCENT {{ w.ascentM }} m</span>
                  <span v-if="w.vo2max != null">VO2MAX {{ w.vo2max }}</span>
                  <span v-if="w.trainingEffect != null">TE {{ w.trainingEffect }}</span>
                  <span v-if="w.recoveryHours != null">RECOVERY {{ w.recoveryHours }} h</span>
                  <span v-if="w.end">{{ isoHhmm(w.start) }}–{{ isoHhmm(w.end) }}</span>
                </div>
              </article>
              <p v-if="!watchSummary.workouts.length" class="stats-panel-empty">
                No individual workouts in this window yet.
              </p>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </main>
</template>
