<script setup>
// LIFE 的「七维雷达图」：Work / Study / Life / Transport / Leisure / Health / Social。
//
// 七维就是 LifeLogging 的 dimensions：桌面分类 + GPS 通勤 + 手表跑步 + 手机社交，
// Other 是「没认出来」，不进入雷达（和 LifeLogging 的 build_dimensions 一致）。
//
// 统计窗口可以切换：单日 / 完整 / 最近 7 日 / 最近 30 日 / 年（用实际拿到的天数）。
// 每一档显示的都是**该窗口内的累计小时**（单日就是那一天），所以窗口一变数字必然变。
// 实线是当前窗口，虚线是「完整」基线；切换时用 rAF 把轮廓和数字一起渐变过去。
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { BRAIN_COLOR } from '../data/lifeBrain.js';

const props = defineProps({
  // 已是「按天排好、带 payload」的完整窗口，雷达自己再按范围切片。
  rows: { type: Array, default: () => [] },
  colorMode: { type: Boolean, default: false },
  // 与 3D 神经核心联动：父级选中的日期（YYYY-MM-DD）
  focusDay: { type: String, default: '' },
  // 七维详情要读原始 blocks（桌面分类活动），和页面共用同一个 CMS 地址
  cmsBase: { type: String, default: '' },
});

const emit = defineEmits(['update:focusDay']);

const AXES = ['Work', 'Study', 'Life', 'Transport', 'Leisure', 'Health', 'Social'];

// SVG 坐标系：视图里留出标签的空间
const W = 420;
const H = 352;
const CX = 210;
const CY = 176;
const R = 116;
const RINGS = [0.25, 0.5, 0.75, 1];

const TAU = Math.PI * 2;
const DAY_MS = 86400000;
const ANIM_MS = 620;

const REDUCED = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 顺序按用户给的口径：单日 → 完整 → 最近 7 日 → 月 → 年
const RANGES = [
  { key: 'day', label: 'DAY' },
  { key: 'all', label: 'ALL' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: 'year', label: 'YEAR' },
];

const range = ref('7d');
const selectedDay = ref('');

function dimsOf(p) {
  return p?.dimensions || p?.categories || null;
}

const samples = computed(() => props.rows
  .filter((row) => row?.day && !row.missing && dimsOf(row.payload))
  .map((row) => ({ day: row.day, dims: dimsOf(row.payload), payload: row.payload }))
  .sort((a, b) => a.day.localeCompare(b.day)));

const latestDay = computed(() => samples.value[samples.value.length - 1]?.day || '');

function shiftDay(day, delta) {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1, d) + delta * DAY_MS).toISOString().slice(0, 10);
}

// 窗口按「最新一天」向前数日历天，断档不会把更早的数据偷偷算进来。
const windowSamples = computed(() => {
  const list = samples.value;
  if (!list.length) return [];
  if (range.value === 'all') return list;

  if (range.value === 'day') {
    return list.filter((sample) => sample.day === selectedDay.value);
  }

  const span = range.value === '7d' ? 7 : range.value === '30d' ? 30 : 365;
  const start = shiftDay(latestDay.value, -(span - 1));
  return list.filter((sample) => sample.day >= start);
});

function totalOf(list, key) {
  if (!list.length) return 0;
  return list.reduce((acc, sample) => acc + (Number(sample.dims[key]) || 0), 0);
}

const showBaseline = computed(() => range.value !== 'all');

// 目标值：当前窗口的累计小时 + 完整窗口的累计基线
const series = computed(() => {
  const list = windowSamples.value;
  const all = samples.value;
  const days = Math.max(1, list.length);
  const avgDays = Math.max(1, all.length);
  const values = AXES.map((key) => {
    const current = totalOf(list, key);
    // 基线 = 完整窗口的日均 × 当前窗口天数。直接拿完整窗口的总量比会把
    // 7 天的轮廓压成一个点，这也让「高于 / 低于平均」的读数有意义。
    const baseline = (totalOf(all, key) / avgDays) * days;
    return { key, current, baseline, delta: current - baseline };
  });
  const peak = Math.max(1, ...values.flatMap((v) => (showBaseline.value ? [v.current, v.baseline] : [v.current])));
  return {
    values,
    scaleMax: Math.max(1, Math.ceil(peak)),
    days: list.length,
    totalDays: all.length,
  };
});

// 动画层：切换窗口时把实线、虚线、数字、比例尺一起缓动过去。
// 虚线也要逐帧插值 —— 否则它在淡出前会先“啪”地跳到新形状。
const shown = ref({
  current: AXES.map(() => 0),
  baseline: AXES.map(() => 0),
  scaleMax: 1,
});
let raf = 0;
let fromCurrent = AXES.map(() => 0);
let fromBaseline = AXES.map(() => 0);
let fromScale = 1;
let animStart = 0;

function stopAnim() {
  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t ** 3 : 1 - ((-2 * t + 2) ** 3) / 2;
}

watch(series, (next) => {
  const toCurrent = next.values.map((v) => v.current);
  const toBaseline = next.values.map((v) => v.baseline);
  const toScale = next.scaleMax;

  if (REDUCED) {
    shown.value = { current: toCurrent, baseline: toBaseline, scaleMax: toScale };
    return;
  }

  stopAnim();
  fromCurrent = shown.value.current.slice();
  fromBaseline = shown.value.baseline.slice();
  fromScale = shown.value.scaleMax;
  animStart = performance.now();

  const tick = (now) => {
    const t = Math.min(1, (now - animStart) / ANIM_MS);
    const ease = easeInOutCubic(t);
    shown.value = {
      current: toCurrent.map((v, i) => fromCurrent[i] + (v - fromCurrent[i]) * ease),
      baseline: toBaseline.map((v, i) => fromBaseline[i] + (v - fromBaseline[i]) * ease),
      scaleMax: fromScale + (toScale - fromScale) * ease,
    };
    raf = t < 1 ? requestAnimationFrame(tick) : 0;
  };
  raf = requestAnimationFrame(tick);
}, { immediate: true });

onBeforeUnmount(stopAnim);

const shownSeries = computed(() => ({
  values: series.value.values.map((v, i) => {
    const current = shown.value.current[i] ?? 0;
    const baseline = shown.value.baseline[i] ?? 0;
    return { ...v, current, baseline, delta: current - baseline };
  }),
  scaleMax: shown.value.scaleMax,
  days: series.value.days,
  totalDays: series.value.totalDays,
}));

const hasData = computed(() => windowSamples.value.length > 0);

const hourFmt = (v) => `${v.toFixed(1)}h`;

const rangeLabel = computed(() => {
  switch (range.value) {
    case 'day':
      return `DAY · ${labelDay(selectedDay.value)}`;
    case 'all':
      return `ALL · ${series.value.totalDays}D`;
    case '30d':
      return 'LAST 30D';
    case 'year':
      return `YEAR · ${series.value.days}D AVAILABLE`;
    default:
      return 'LAST 7D';
  }
});

const baselineLabel = computed(() => `AVG · ${series.value.totalDays}D`);

const ariaLabel = computed(() => {
  const parts = shownSeries.value.values
    .map((v) => `${v.key} ${v.current.toFixed(1)} hours`)
    .join(', ');
  const base = showBaseline.value
    ? ` Dashed outline is the ${series.value.totalDays}-day average scaled to this window.`
    : '';
  return `Seven-dimension radar chart. ${rangeLabel.value}: ${parts}.${base}`;
});

function angleAt(i) {
  return -Math.PI / 2 + (i / AXES.length) * TAU;
}

function pointAt(i, radius) {
  const a = angleAt(i);
  return [CX + Math.cos(a) * radius, CY + Math.sin(a) * radius];
}

function polygonAt(fraction) {
  return AXES
    .map((_, i) => pointAt(i, R * fraction).map((n) => n.toFixed(2)).join(','))
    .join(' ');
}

const rings = RINGS.map((fraction) => ({ fraction, points: polygonAt(fraction) }));

const spokes = AXES.map((_, i) => {
  const [x, y] = pointAt(i, R);
  return { x1: CX, y1: CY, x2: x, y2: y };
});

function seriesPoints(key) {
  const scale = Math.max(0.001, shownSeries.value.scaleMax);
  return shownSeries.value.values
    .map((v, i) => {
      const r = (v[key] / scale) * R;
      return pointAt(i, r).map((n) => n.toFixed(2)).join(',');
    })
    .join(' ');
}

const currentPoints = computed(() => seriesPoints('current'));
const baselinePoints = computed(() => seriesPoints('baseline'));

const dots = computed(() => shownSeries.value.values.map((v, i) => {
  const scale = Math.max(0.001, shownSeries.value.scaleMax);
  const r = (v.current / scale) * R;
  const [x, y] = pointAt(i, r);
  return {
    key: v.key,
    x,
    y,
    color: props.colorMode ? BRAIN_COLOR[v.key] : 'currentColor',
  };
}));

// 轴标签贴着外圈放；左右两侧分别左右对齐，避免压到图形
const axisLabels = AXES.map((key, i) => {
  const a = angleAt(i);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return {
    key,
    x: CX + cos * (R + 16),
    y: CY + sin * (R + 16) + (Math.abs(sin) > 0.9 ? (sin < 0 ? -2 : 10) : 3),
    anchor: cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle',
  };
});

function deltaLabel(v) {
  if (!showBaseline.value) return '—';
  const d = v.delta;
  if (Math.abs(d) < 0.05) return '±0.0';
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`;
}

function deltaClass(v) {
  if (!showBaseline.value) return '';
  if (v.delta > 0.05) return 'is-up';
  if (v.delta < -0.05) return 'is-down';
  return '';
}

function barWidth(v) {
  return `${Math.max(2, (v.current / Math.max(0.001, shownSeries.value.scaleMax)) * 100)}%`;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function parseDay(day) {
  const [y, m, d] = String(day || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function labelDay(day) {
  const date = parseDay(day);
  if (!date) return '—';
  return `${String(date.getUTCDate()).padStart(2, '0')} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function optionDay(day) {
  const date = parseDay(day);
  if (!date) return day;
  return `${day} · ${WEEKDAYS[date.getUTCDay()]}`;
}

const dayOptions = computed(() => [...samples.value].reverse());
const dayIndex = computed(() => samples.value.findIndex((sample) => sample.day === selectedDay.value));
const canOlder = computed(() => dayIndex.value > 0);
const canNewer = computed(() => dayIndex.value >= 0 && dayIndex.value < samples.value.length - 1);

function useDay(day, notify = true) {
  if (!day) return;
  selectedDay.value = day;
  range.value = 'day';
  if (notify) emit('update:focusDay', day);
}

function stepDay(delta) {
  const next = samples.value[dayIndex.value + delta];
  if (next) useDay(next.day);
}

function onSelectDay(event) {
  useDay(event.target.value);
}

function setRange(key) {
  range.value = key;
  // 进入单日模式时把当前这一天同步给 3D 神经核心
  if (key === 'day' && selectedDay.value) emit('update:focusDay', selectedDay.value);
}

// 数据到达 / 刷新后保持选中：默认最新一天，旧日期被滚出窗口时回落到最新。
watch(samples, (list) => {
  if (!list.length) {
    selectedDay.value = '';
    return;
  }
  if (!list.some((sample) => sample.day === selectedDay.value)) {
    selectedDay.value = list[list.length - 1].day;
  }
}, { immediate: true });

// 3D 神经核心里点日期节点 → 雷达自动切到单日
watch(() => props.focusDay, (day) => {
  if (!day || day === selectedDay.value) return;
  if (!samples.value.some((sample) => sample.day === day)) return;
  selectedDay.value = day;
  range.value = 'day';
});

// ---- 七维详情：点任一维度，看它在这个窗口里实际干了什么 ----------------------
//
// 桌面四维（Work / Study / Life / Leisure）只有原始 blocks 能归因到应用和窗口，
// 所以按天拉 /api/life/raw/blocks/:day；一年 365 天全拉太重，只取窗口最后 30 天。
// 其余三维直接来自 payload：Transport = location，Health = health/workouts，
// Social = phone.topApps 里属于社交应用的那部分。
const DESKTOP_DIMS = new Set(['Work', 'Study', 'Life', 'Leisure']);
const SOCIAL_APPS = new Set([
  'WeChat', 'QQ', 'Telegram', 'WhatsApp', 'Signal', 'Line', 'Discord',
  'Weibo', 'Xiaohongshu', 'Instagram', 'Facebook', 'Threads', 'LinkedIn',
]);
// 手机上的对话式 AI 并入 Study（publish_life_site.py 的 PHONE_STUDY_APPS）。
// Study 的总数 = 桌面分类 + 手机 AI，所以详情里必须把后者单列，否则总数对不上。
const PHONE_STUDY_APPS = new Set([
  'DeepSeek', 'ChatGPT', 'Claude', 'Gemini', 'Copilot', 'Perplexity',
]);
const DETAIL_CAP = 30;

const detail = ref('');
const dimCloseRef = ref(null);
const blockStatus = ref('idle'); // idle | loading | ready | error
const blockPartial = ref(false);
const blockMap = ref(new Map());
// 会话内按天缓存：同一天反复打开详情不重复请求
const blockCache = new Map();
let blockSeq = 0;
let dimLocked = false;

const isDesktopDim = computed(() => DESKTOP_DIMS.has(detail.value));

const detailTotal = computed(() => (detail.value ? totalOf(windowSamples.value, detail.value) : 0));

const detailActiveDays = computed(() => windowSamples.value
  .filter((sample) => (Number(sample.dims[detail.value]) || 0) > 0.05).length);

const detailAvg = computed(() => (detailActiveDays.value
  ? detailTotal.value / detailActiveDays.value
  : 0));

const detailShare = computed(() => {
  const tracked = AXES.reduce((acc, key) => acc + totalOf(windowSamples.value, key), 0);
  return tracked > 0 ? (detailTotal.value / tracked) * 100 : 0;
});

const detailTimeline = computed(() => {
  const key = detail.value;
  if (!key) return [];
  const list = windowSamples.value;
  const max = Math.max(0.001, ...list.map((sample) => Number(sample.dims[key]) || 0));
  return list.map((sample) => {
    const hours = Number(sample.dims[key]) || 0;
    return {
      day: sample.day,
      hours,
      pct: hours > 0 ? Math.max(4, (hours / max) * 100) : 0,
    };
  });
});

const blockDays = computed(() => windowSamples.value.slice(-DETAIL_CAP).map((sample) => sample.day));
const blockCovered = computed(() => blockDays.value.length);

async function fetchBlocks(day) {
  if (blockCache.has(day)) return blockCache.get(day);
  const base = String(props.cmsBase || '').replace(/\/+$/, '');
  const res = await fetch(`${base}/api/life/raw/blocks/${encodeURIComponent(day)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`blocks ${res.status}`);
  const json = await res.json();
  const list = Array.isArray(json?.data) ? json.data : [];
  blockCache.set(day, list);
  return list;
}

async function loadBlockDetail() {
  const days = blockDays.value;
  blockPartial.value = false;

  if (!days.length) {
    blockMap.value = new Map();
    blockStatus.value = 'ready';
    return;
  }

  // 全部命中缓存就同步出结果，避免打开时闪一下 LOADING
  if (days.every((day) => blockCache.has(day))) {
    blockMap.value = new Map(days.map((day) => [day, blockCache.get(day)]));
    blockStatus.value = 'ready';
    return;
  }

  const seq = ++blockSeq;
  blockStatus.value = 'loading';
  const result = new Map();
  let cursor = 0;
  let failed = 0;

  // 并发 6：一天一个请求，30 天也不会把 Worker 打满
  await Promise.all(Array.from({ length: Math.min(6, days.length) }, async () => {
    while (cursor < days.length) {
      const day = days[cursor];
      cursor += 1;
      try {
        result.set(day, await fetchBlocks(day));
      } catch {
        result.set(day, []);
        failed += 1;
      }
    }
  }));

  if (seq !== blockSeq) return;
  blockMap.value = result;
  blockStatus.value = failed === days.length ? 'error' : 'ready';
  blockPartial.value = failed > 0 && failed < days.length;
}

const dimBlocks = computed(() => {
  const key = detail.value;
  if (!DESKTOP_DIMS.has(key)) return [];
  const out = [];
  for (const [day, list] of blockMap.value) {
    for (const block of list) {
      if (!block || block.category !== key) continue;
      const hours = Number(block.hours) || 0;
      if (hours <= 0.001) continue;
      out.push({ ...block, day, hours });
    }
  }
  return out;
});

function appName(block) {
  const raw = String(block?.app || '').trim();
  return raw.replace(/\.exe$/i, '') || 'UNKNOWN';
}

function blockLabel(block) {
  if (block?.blackhole) return 'PRIVATE BLOCK';
  const title = String(block?.title || '').trim();
  return title || appName(block);
}

function hostOf(url) {
  if (!url) return '';
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function topRows(list, pick, limit = 8) {
  const agg = new Map();
  list.forEach((item) => {
    const key = pick(item);
    if (!key) return;
    agg.set(key, (agg.get(key) || 0) + item.hours);
  });
  const sorted = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const max = sorted[0]?.[1] || 1;
  return sorted.map(([name, hours], index) => ({
    name,
    hours,
    pct: Math.max(2, (hours / max) * 100),
    rank: String(index + 1).padStart(2, '0'),
  }));
}

const blockApps = computed(() => topRows(dimBlocks.value, appName));
const blockTitles = computed(() => topRows(dimBlocks.value, blockLabel));
const blockSites = computed(() => topRows(dimBlocks.value, (block) => hostOf(block.url)));

// 维度颜色跟随站点的 COLOR 开关；关掉时保持全站的黑白口径。
const dimAccent = computed(() => (props.colorMode && detail.value
  ? BRAIN_COLOR[detail.value]
  : 'var(--text-primary)'));

// 今天的原始 blocks 要等当天归档发布（run_daily，23:00）之后才有；在那之前
// 单日视图只有聚合数字。这里拿当天的 topApps 兜底，但明确标成「未分类」。
const todayOnly = computed(() => windowSamples.value.length === 1
  && windowSamples.value[0].day === latestDay.value);

const todayApps = computed(() => {
  if (!todayOnly.value) return [];
  const payload = windowSamples.value[0]?.payload;
  const list = Array.isArray(payload?.topApps) ? payload.topApps : [];
  const rows = list
    .map((entry) => (Array.isArray(entry)
      ? { name: String(entry[0] || ''), hours: Number(entry[1]) || 0 }
      : null))
    .filter((row) => row && row.name && row.hours > 0);
  const max = Math.max(0.001, ...rows.map((row) => row.hours));
  return rows.map((row, index) => ({
    ...row,
    rank: String(index + 1).padStart(2, '0'),
    pct: Math.max(2, (row.hours / max) * 100),
  }));
});

const windowHasToday = computed(() => windowSamples.value.some((sample) => sample.day === latestDay.value));

const todayPending = computed(() => isDesktopDim.value
  && todayOnly.value
  && blockStatus.value === 'ready'
  && dimBlocks.value.length === 0);

const transportStats = computed(() => {
  const locations = windowSamples.value.map((sample) => sample.payload?.location).filter(Boolean);
  const sum = (pick) => locations.reduce((acc, location) => acc + (Number(pick(location)) || 0), 0);
  const districts = new Map();
  locations.forEach((location) => {
    (Array.isArray(location.districts) ? location.districts : []).forEach((entry) => {
      if (!Array.isArray(entry)) return;
      const [name, minutes] = entry;
      if (!name) return;
      districts.set(name, (districts.get(name) || 0) + (Number(minutes) || 0));
    });
  });
  const ranked = [...districts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = ranked[0]?.[1] || 1;
  return {
    days: locations.length,
    transit: sum((location) => location.transitMinutes ?? location.movingMinutes),
    moving: sum((location) => location.movingMinutes),
    inferred: sum((location) => location.inferredMinutes),
    stay: sum((location) => location.stayMinutes),
    km: sum((location) => location.spanKm),
    districts: ranked.map(([name, minutes], index) => ({
      name,
      hours: minutes / 60,
      pct: Math.max(2, (minutes / max) * 100),
      rank: String(index + 1).padStart(2, '0'),
    })),
  };
});

const healthStats = computed(() => {
  const payloads = windowSamples.value.map((sample) => sample.payload).filter(Boolean);
  const workouts = payloads
    .flatMap((payload) => (Array.isArray(payload.workouts) ? payload.workouts : []))
    .filter((workout) => workout && Number(workout.minutes) > 0);
  const healths = payloads.map((payload) => payload.health).filter(Boolean);
  const sum = (list, pick) => list.reduce((acc, item) => acc + (Number(pick(item)) || 0), 0);
  const hrValues = healths.map((health) => Number(health.hrAvg)).filter((hr) => hr > 0);
  const paced = workouts.filter((workout) => Number(workout.paceS) > 0 && Number(workout.km) > 0.1);
  const best = paced.length
    ? paced.reduce((fastest, workout) => (workout.paceS < fastest.paceS ? workout : fastest))
    : null;

  return {
    days: healths.length,
    runs: workouts.length,
    km: sum(workouts, (workout) => workout.km),
    minutes: sum(workouts, (workout) => workout.minutes),
    steps: sum(healths, (health) => health.steps),
    avgHr: hrValues.length ? hrValues.reduce((a, b) => a + b, 0) / hrValues.length : 0,
    best,
    workouts: [...workouts]
      .sort((a, b) => String(b.start || '').localeCompare(String(a.start || '')))
      .slice(0, 12),
  };
});

const socialStats = computed(() => {
  const payloads = windowSamples.value.map((sample) => sample.payload).filter(Boolean);
  const agg = new Map();
  let days = 0;
  let screen = 0;
  let unlocks = 0;
  let switches = 0;

  payloads.forEach((payload) => {
    const phone = payload.phone;
    if (!phone) return;
    days += 1;
    screen += Number(phone.screenMinutes) || 0;
    unlocks += Number(phone.unlocks) || 0;
    switches += Number(phone.appSwitches) || 0;
    (Array.isArray(phone.topApps) ? phone.topApps : []).forEach((entry) => {
      if (!Array.isArray(entry)) return;
      const [name, minutes] = entry;
      if (!SOCIAL_APPS.has(name)) return;
      agg.set(name, (agg.get(name) || 0) + (Number(minutes) || 0));
    });
  });

  const ranked = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max = ranked[0]?.[1] || 1;
  return {
    days,
    screen,
    unlocks,
    switches,
    apps: ranked.map(([name, minutes], index) => ({
      name,
      hours: minutes / 60,
      pct: Math.max(2, (minutes / max) * 100),
      rank: String(index + 1).padStart(2, '0'),
    })),
  };
});

const phoneStudy = computed(() => {
  const agg = new Map();
  let days = 0;
  windowSamples.value.forEach((sample) => {
    const phone = sample.payload?.phone;
    if (!phone) return;
    days += 1;
    (Array.isArray(phone.topApps) ? phone.topApps : []).forEach((entry) => {
      if (!Array.isArray(entry)) return;
      const [name, minutes] = entry;
      if (!PHONE_STUDY_APPS.has(name)) return;
      agg.set(name, (agg.get(name) || 0) + (Number(minutes) || 0));
    });
  });
  const ranked = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max = ranked[0]?.[1] || 1;
  return {
    days,
    hours: [...agg.values()].reduce((acc, minutes) => acc + minutes, 0) / 60,
    apps: ranked.map(([name, minutes], index) => ({
      name,
      hours: minutes / 60,
      pct: Math.max(2, (minutes / max) * 100),
      rank: String(index + 1).padStart(2, '0'),
    })),
  };
});

// 七维之和 vs 同一天所有来源区间的并集。重复只来自跨源（最典型：电脑前刷手机），
// 桌面分类之间本身是互斥的。字段缺失的旧数据不参与，避免把 0 当成“没有重叠”。
const collapsedStats = computed(() => {
  const covered = windowSamples.value.filter(
    (sample) => Number.isFinite(sample.payload?.collapsedHours),
  );
  if (!covered.length) return { has: false };
  const unique = covered.reduce(
    (acc, sample) => acc + Number(sample.payload.collapsedHours),
    0,
  );
  const dims = AXES.reduce(
    (acc, key) => acc + covered.reduce(
      (sum, sample) => sum + (Number(sample.dims[key]) || 0),
      0,
    ),
    0,
  );
  return {
    has: true,
    unique,
    overlap: Math.max(0, dims - unique),
    covered: covered.length,
    total: windowSamples.value.length,
  };
});

function durationFmt(minutes) {
  const m = Math.round(Number(minutes) || 0);
  if (m < 60) return `${m}m`;
  return `${(m / 60).toFixed(1)}h`;
}

function paceLabel(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (!s) return '—';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} /KM`;
}

function dayMonth(value) {
  const day = String(value || '').slice(0, 10);
  const match = day.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}.${match[2]}` : '—';
}

function openDimension(key) {
  if (!key) return;
  detail.value = key;
  if (DESKTOP_DIMS.has(key)) loadBlockDetail();
  else blockStatus.value = 'idle';
}

function closeDimension() {
  detail.value = '';
}

function onDimKey(event) {
  if (event.key === 'Escape') closeDimension();
}

function lockDimScroll() {
  if (document.body.classList.contains('no-scroll')) return;
  document.body.classList.add('no-scroll');
  dimLocked = true;
}

function unlockDimScroll() {
  if (!dimLocked) return;
  document.body.classList.remove('no-scroll');
  dimLocked = false;
}

watch(detail, (value) => {
  if (value) {
    window.addEventListener('keydown', onDimKey);
    lockDimScroll();
    nextTick(() => dimCloseRef.value?.focus());
  } else {
    window.removeEventListener('keydown', onDimKey);
    unlockDimScroll();
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onDimKey);
  unlockDimScroll();
  blockSeq += 1;
});
</script>

<template>
  <div class="life-radar">
    <div class="life-radar-toolbar">
      <div class="life-radar-ranges" role="group" aria-label="Radar statistics range">
        <button
          v-for="option in RANGES"
          :key="option.key"
          type="button"
          class="life-radar-range"
          :class="{ 'is-active': range === option.key }"
          :aria-pressed="range === option.key"
          @click="setRange(option.key)"
        >{{ option.label }}</button>
      </div>

      <!-- 日期控件常驻布局：切到别的窗口时只隐藏，避免工具栏高度变化把页面顶一下 -->
      <div
        class="life-radar-day"
        :class="{ 'is-inactive': range !== 'day' }"
        :aria-hidden="range !== 'day'"
      >
        <button
          type="button"
          class="life-radar-step"
          :disabled="!canOlder"
          aria-label="Previous day"
          @click="stepDay(-1)"
        >‹</button>
        <select
          class="life-radar-select"
          :value="selectedDay"
          aria-label="Single day"
          @change="onSelectDay"
        >
          <option v-for="sample in dayOptions" :key="sample.day" :value="sample.day">
            {{ optionDay(sample.day) }}
          </option>
        </select>
        <button
          type="button"
          class="life-radar-step"
          :disabled="!canNewer"
          aria-label="Next day"
          @click="stepDay(1)"
        >›</button>
      </div>

      <span class="life-radar-count">{{ series.days }} TRACKED DAYS</span>
    </div>

    <figure class="life-radar-figure">
      <svg
        class="life-radar-svg"
        :viewBox="`0 0 ${W} ${H}`"
        role="img"
        :aria-label="ariaLabel"
      >
        <g class="life-radar-grid" aria-hidden="true">
          <polygon v-for="ring in rings" :key="ring.fraction" :points="ring.points" />
          <line
            v-for="(s, i) in spokes"
            :key="`spoke-${i}`"
            class="life-radar-spoke"
            :x1="s.x1"
            :y1="s.y1"
            :x2="s.x2"
            :y2="s.y2"
          />
        </g>

        <template v-if="hasData">
          <polygon
            class="life-radar-baseline"
            :class="{ 'is-hidden': !showBaseline }"
            :points="baselinePoints"
          />
          <polygon class="life-radar-current" :points="currentPoints" />

          <circle
            v-for="dot in dots"
            :key="`dot-${dot.key}`"
            class="life-radar-dot is-clickable"
            :cx="dot.x"
            :cy="dot.y"
            r="3.2"
            :fill="dot.color"
            role="button"
            tabindex="0"
            :aria-label="`Open ${dot.key} detail`"
            @click="openDimension(dot.key)"
            @keydown.enter.prevent="openDimension(dot.key)"
            @keydown.space.prevent="openDimension(dot.key)"
          />
        </template>

        <text
          v-for="label in axisLabels"
          :key="`axis-${label.key}`"
          class="life-radar-axis is-clickable"
          :x="label.x"
          :y="label.y"
          :text-anchor="label.anchor"
          role="button"
          tabindex="0"
          :aria-label="`Open ${label.key} detail`"
          @click="openDimension(label.key)"
          @keydown.enter.prevent="openDimension(label.key)"
          @keydown.space.prevent="openDimension(label.key)"
        >{{ label.key.toUpperCase() }}</text>
      </svg>
      <figcaption class="life-radar-key">
        <span><i class="is-current" aria-hidden="true"></i>{{ rangeLabel }}</span>
        <span v-if="showBaseline"><i class="is-baseline" aria-hidden="true"></i>{{ baselineLabel }}</span>
        <span class="life-radar-scale">OUTER RING {{ shownSeries.scaleMax.toFixed(0) }}H TOTAL</span>
      </figcaption>
    </figure>

    <div class="life-radar-side">
      <p class="life-radar-hint">CLICK A DIMENSION TO SEE WHAT ACTUALLY HAPPENED.</p>

      <ul class="life-radar-list">
        <li v-for="v in shownSeries.values" :key="v.key" class="life-radar-item">
          <button
            type="button"
            class="life-radar-row"
            :aria-label="`Open ${v.key} detail, ${hourFmt(v.current)} in ${rangeLabel}`"
            @click="openDimension(v.key)"
          >
            <i
              class="life-radar-swatch"
              :style="colorMode ? { background: BRAIN_COLOR[v.key] } : null"
              aria-hidden="true"
            ></i>
            <span class="life-radar-name">{{ v.key.toUpperCase() }}</span>
            <b class="life-radar-value">{{ hourFmt(v.current) }}</b>
            <em class="life-radar-delta" :class="deltaClass(v)">{{ deltaLabel(v) }}</em>
            <span class="life-radar-track" aria-hidden="true">
              <span class="life-radar-fill" :style="{ width: barWidth(v) }"></span>
            </span>
          </button>
        </li>
        <li v-if="!hasData" class="life-radar-empty">NO TRACKED DAYS IN THIS WINDOW.</li>
      </ul>

      <p
        v-if="collapsedStats.has"
        class="life-radar-unique"
        title="UNIQUE = union of desktop blocks, transport, workouts and phone apps. OVERLAP = the 7-DIM sum minus that union."
      >
        <span>UNIQUE TRACKED <b>{{ hourFmt(collapsedStats.unique) }}</b></span>
        <span>OVERLAP <b>{{ hourFmt(collapsedStats.overlap) }}</b></span>
        <em v-if="collapsedStats.covered < collapsedStats.total">
          {{ collapsedStats.covered }}/{{ collapsedStats.total }} DAYS
        </em>
      </p>
    </div>

    <Teleport to="body">
      <Transition name="life-day">
        <div v-if="detail" class="life-day-backdrop" @click.self="closeDimension">
          <div
            class="life-day-modal life-dim-modal"
            role="dialog"
            aria-modal="true"
            :aria-label="`${detail} activity detail`"
            :style="{ '--dim-accent': dimAccent }"
          >
            <div class="life-day-head">
              <div>
                <span class="life-day-kicker">{{ rangeLabel }} · {{ detailTimeline.length }} TRACKED DAYS</span>
                <h3>
                  <i class="life-dim-swatch" aria-hidden="true"></i>{{ detail.toUpperCase() }} · {{ hourFmt(detailTotal) }}
                </h3>
              </div>
              <button ref="dimCloseRef" type="button" class="life-day-close" @click="closeDimension">
                CLOSE ✕
              </button>
            </div>

            <div class="life-day-stats life-dim-stats">
              <span><em>TOTAL</em><b>{{ hourFmt(detailTotal) }}</b></span>
              <span><em>ACTIVE DAYS</em><b>{{ detailActiveDays }} / {{ detailTimeline.length }}</b></span>
              <span><em>PER ACTIVE DAY</em><b>{{ hourFmt(detailAvg) }}</b></span>
              <span><em>SHARE OF 7-DIM</em><b>{{ detailShare.toFixed(0) }}%</b></span>
            </div>

            <div class="life-day-body life-dim-body">
              <div class="life-dim-timeline-wrap">
                <div
                  class="life-dim-timeline"
                  role="img"
                  :aria-label="`${detail} hours per tracked day`"
                >
                  <span
                    v-for="bar in detailTimeline"
                    :key="bar.day"
                    class="life-dim-bar"
                    :title="`${bar.day} · ${hourFmt(bar.hours)}`"
                  >
                    <i :style="{ height: `${bar.pct}%` }"></i>
                  </span>
                </div>
                <div v-if="detailTimeline.length" class="life-dim-timeline-axis">
                  <span>{{ labelDay(detailTimeline[0].day) }}</span>
                  <span>{{ labelDay(detailTimeline[detailTimeline.length - 1].day) }}</span>
                </div>
              </div>

              <!-- 桌面四维：原始 blocks 归因到应用 / 窗口 / 站点 -->
              <template v-if="isDesktopDim">
                <p class="life-dim-note">
                  <template v-if="blockStatus === 'loading'">LOADING ACTIVITY BLOCKS…</template>
                  <template v-else-if="blockStatus === 'error'">RAW BLOCKS UNAVAILABLE — SHOWING TOTALS ONLY.</template>
                  <template v-else>
                    DESKTOP BLOCKS · LAST {{ blockCovered }} DAYS<template v-if="windowHasToday"> · TODAY PENDING</template><template v-if="blockPartial"> · SOME DAYS UNAVAILABLE</template><template v-if="detail === 'Study'"> · STUDY TOTAL ALSO INCLUDES PHONE AI</template>
                  </template>
                </p>

                <div
                  v-if="blockStatus !== 'error' && (blockApps.length || blockTitles.length || blockSites.length)"
                  class="life-dim-columns"
                >
                  <section class="life-dim-section">
                    <h4>APPS</h4>
                    <ul class="life-dim-list">
                      <li v-for="row in blockApps" :key="`app-${row.name}`" class="life-dim-list-row">
                        <span class="life-dim-rank">{{ row.rank }}</span>
                        <span class="life-dim-label" :title="row.name">{{ row.name }}</span>
                        <b class="life-dim-value">{{ hourFmt(row.hours) }}</b>
                        <span class="life-dim-track" aria-hidden="true">
                          <i :style="{ width: `${row.pct}%` }"></i>
                        </span>
                      </li>
                    </ul>
                  </section>

                  <section class="life-dim-section">
                    <h4>WINDOW TITLES</h4>
                    <ul class="life-dim-list">
                      <li v-for="row in blockTitles" :key="`title-${row.name}`" class="life-dim-list-row">
                        <span class="life-dim-rank">{{ row.rank }}</span>
                        <span class="life-dim-label" :title="row.name">{{ row.name }}</span>
                        <b class="life-dim-value">{{ hourFmt(row.hours) }}</b>
                        <span class="life-dim-track" aria-hidden="true">
                          <i :style="{ width: `${row.pct}%` }"></i>
                        </span>
                      </li>
                    </ul>
                  </section>

                  <section v-if="blockSites.length" class="life-dim-section">
                    <h4>SITES</h4>
                    <ul class="life-dim-list">
                      <li v-for="row in blockSites" :key="`site-${row.name}`" class="life-dim-list-row">
                        <span class="life-dim-rank">{{ row.rank }}</span>
                        <span class="life-dim-label" :title="row.name">{{ row.name }}</span>
                        <b class="life-dim-value">{{ hourFmt(row.hours) }}</b>
                        <span class="life-dim-track" aria-hidden="true">
                          <i :style="{ width: `${row.pct}%` }"></i>
                        </span>
                      </li>
                    </ul>
                  </section>
                </div>

                <template v-else-if="todayPending">
                  <p class="life-dim-note">
                    TODAY'S BLOCK DETAIL ISN'T PUBLISHED YET — RAW BLOCKS LAND AFTER THE DAY CLOSES.
                    <template v-if="todayApps.length && detailTotal > 0.05"> UNTIL THEN, TODAY'S DESKTOP APPS ARE SHOWN UNCLASSIFIED.</template>
                  </p>
                  <section v-if="todayApps.length && detailTotal > 0.05" class="life-dim-section">
                    <h4>TODAY · DESKTOP APPS (UNCLASSIFIED)</h4>
                    <ul class="life-dim-list">
                      <li v-for="row in todayApps" :key="`today-${row.name}`" class="life-dim-list-row">
                        <span class="life-dim-rank">{{ row.rank }}</span>
                        <span class="life-dim-label" :title="row.name">{{ row.name }}</span>
                        <b class="life-dim-value">{{ hourFmt(row.hours) }}</b>
                        <span class="life-dim-track" aria-hidden="true">
                          <i :style="{ width: `${row.pct}%` }"></i>
                        </span>
                      </li>
                    </ul>
                  </section>
                </template>

                <p v-else-if="blockStatus === 'ready'" class="life-dim-empty">
                  NO BLOCKS WERE RECORDED FOR THIS DIMENSION IN THE COVERED DAYS.
                </p>

                <!-- Study = 桌面分类 + 手机对话式 AI；这里把手机那一半单列出来 -->
                <section v-if="detail === 'Study'" class="life-dim-section">
                  <h4>PHONE AI · COUNTED IN STUDY</h4>
                  <ul v-if="phoneStudy.apps.length" class="life-dim-list">
                    <li v-for="row in phoneStudy.apps" :key="`phone-study-${row.name}`" class="life-dim-list-row">
                      <span class="life-dim-rank">{{ row.rank }}</span>
                      <span class="life-dim-label" :title="row.name">{{ row.name }}</span>
                      <b class="life-dim-value">{{ hourFmt(row.hours) }}</b>
                      <span class="life-dim-track" aria-hidden="true">
                        <i :style="{ width: `${row.pct}%` }"></i>
                      </span>
                    </li>
                  </ul>
                  <p v-if="!phoneStudy.apps.length" class="life-dim-empty">
                    NO PHONE AI TIME IN THIS WINDOW.
                  </p>
                  <p v-else class="life-dim-note">
                    {{ hourFmt(phoneStudy.hours) }} ACROSS {{ phoneStudy.days }} DAYS. PHONE TIME IS COUNTED INDEPENDENTLY — IT CAN OVERLAP DESKTOP.
                  </p>
                </section>
              </template>

              <!-- 交通：GPS 通勤 -->
              <template v-else-if="detail === 'Transport'">
                <p class="life-dim-note">GPS TRACKS · {{ transportStats.days }} DAYS WITH LOCATION</p>
                <div class="life-dim-columns">
                  <section class="life-dim-section">
                    <h4>MOVEMENT</h4>
                    <div class="life-dim-kv"><span>IN TRANSIT</span><b>{{ durationFmt(transportStats.transit) }}</b></div>
                    <div class="life-dim-kv"><span>MEASURED MOVING</span><b>{{ durationFmt(transportStats.moving) }}</b></div>
                    <div class="life-dim-kv"><span>INFERRED TRANSIT</span><b>{{ durationFmt(transportStats.inferred) }}</b></div>
                    <div class="life-dim-kv"><span>STAYED</span><b>{{ durationFmt(transportStats.stay) }}</b></div>
                    <div class="life-dim-kv"><span>DISTANCE</span><b>{{ transportStats.km.toFixed(1) }} KM</b></div>
                  </section>

                  <section class="life-dim-section">
                    <h4>TOP DISTRICTS</h4>
                    <ul class="life-dim-list">
                      <li v-for="row in transportStats.districts" :key="`district-${row.name}`" class="life-dim-list-row">
                        <span class="life-dim-rank">{{ row.rank }}</span>
                        <span class="life-dim-label" :title="row.name">{{ row.name }}</span>
                        <b class="life-dim-value">{{ hourFmt(row.hours) }}</b>
                        <span class="life-dim-track" aria-hidden="true">
                          <i :style="{ width: `${row.pct}%` }"></i>
                        </span>
                      </li>
                    </ul>
                    <p v-if="!transportStats.districts.length" class="life-dim-empty">NO DISTRICT STAYS IN THIS WINDOW.</p>
                  </section>
                </div>
              </template>

              <!-- 健康：手表跑步 -->
              <template v-else-if="detail === 'Health'">
                <p class="life-dim-note">WATCH HEALTH · {{ healthStats.days }} DAYS TRACKED</p>
                <div class="life-dim-columns">
                  <section class="life-dim-section">
                    <h4>RUNNING</h4>
                    <div class="life-dim-kv"><span>RUNS</span><b>{{ healthStats.runs }}</b></div>
                    <div class="life-dim-kv"><span>DISTANCE</span><b>{{ healthStats.km.toFixed(2) }} KM</b></div>
                    <div class="life-dim-kv"><span>RUN TIME</span><b>{{ durationFmt(healthStats.minutes) }}</b></div>
                    <div class="life-dim-kv"><span>BEST PACE</span><b>{{ healthStats.best ? paceLabel(healthStats.best.paceS) : '—' }}</b></div>
                  </section>

                  <section class="life-dim-section">
                    <h4>DAILY</h4>
                    <div class="life-dim-kv"><span>STEPS</span><b>{{ Math.round(healthStats.steps).toLocaleString('en-US') }}</b></div>
                    <div class="life-dim-kv"><span>AVG HR</span><b>{{ healthStats.avgHr ? `${Math.round(healthStats.avgHr)} BPM` : '—' }}</b></div>
                  </section>
                </div>

                <section class="life-dim-section">
                  <h4>WORKOUTS</h4>
                  <ul class="life-dim-workouts">
                    <li v-for="(workout, index) in healthStats.workouts" :key="`workout-${index}-${workout.start}`" class="life-dim-workout">
                      <div class="life-dim-workout-head">
                        <span>{{ dayMonth(workout.start) }}</span>
                        <b>{{ String(workout.name || 'WORKOUT').toUpperCase() }}</b>
                        <em>{{ paceLabel(workout.paceS) }}</em>
                      </div>
                      <div class="life-dim-workout-meta">
                        <span>{{ Number(workout.km || 0).toFixed(2) }} KM</span>
                        <span>{{ Math.round(Number(workout.minutes) || 0) }} MIN</span>
                        <span v-if="workout.avgHr">{{ Math.round(workout.avgHr) }} BPM</span>
                      </div>
                    </li>
                  </ul>
                  <p v-if="!healthStats.workouts.length" class="life-dim-empty">NO WATCH WORKOUTS IN THIS WINDOW.</p>
                </section>
              </template>

              <!-- 社交：手机社交应用 -->
              <template v-else-if="detail === 'Social'">
                <p class="life-dim-note">PHONE SOCIAL APPS · {{ socialStats.days }} DAYS WITH PHONE DATA</p>
                <div class="life-dim-columns">
                  <section class="life-dim-section">
                    <h4>SOCIAL APPS</h4>
                    <ul class="life-dim-list">
                      <li v-for="row in socialStats.apps" :key="`social-${row.name}`" class="life-dim-list-row">
                        <span class="life-dim-rank">{{ row.rank }}</span>
                        <span class="life-dim-label" :title="row.name">{{ row.name }}</span>
                        <b class="life-dim-value">{{ hourFmt(row.hours) }}</b>
                        <span class="life-dim-track" aria-hidden="true">
                          <i :style="{ width: `${row.pct}%` }"></i>
                        </span>
                      </li>
                    </ul>
                    <p v-if="!socialStats.apps.length" class="life-dim-empty">NO SOCIAL APP TIME IN THIS WINDOW.</p>
                  </section>

                  <section class="life-dim-section">
                    <h4>PHONE CONTEXT</h4>
                    <div class="life-dim-kv"><span>SCREEN ON</span><b>{{ durationFmt(socialStats.screen) }}</b></div>
                    <div class="life-dim-kv"><span>UNLOCKS</span><b>{{ socialStats.unlocks.toLocaleString('en-US') }}</b></div>
                    <div class="life-dim-kv"><span>APP SWITCHES</span><b>{{ socialStats.switches.toLocaleString('en-US') }}</b></div>
                    <p class="life-dim-note">ONLY APPS IN THE SOCIAL SET COUNT. PHONE TIME IS COUNTED INDEPENDENTLY — IT CAN OVERLAP DESKTOP AND TRANSIT.</p>
                  </section>
                </div>
              </template>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
