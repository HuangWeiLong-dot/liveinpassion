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
import { useBrandOverlay } from '../composables/useBrandOverlay.js';
import {
  latestIdFor,
  getDocCache,
  setDocCache,
  setIndexCache,
} from '../data/lifeArchiveCache.js';

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

const data = ref(null);
const rawIndex = ref(null);
const error = ref(false);
const loading = ref(true);
const clock = ref('--:--:--');
const lastUpdated = ref('—');
const todayRef = ref('');
const numbersRun = ref(0);
const titleChars = [...'LIFE'];
const rhythmHover = ref(-1);

const sectionRef = ref(null);
const tickerTrackRef = ref(null);
const tipRef = ref(null);

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

function shortDay(d) {
  return d.slice(5).replace('-', '/');
}

function fullDay(d) {
  const [, mo, day] = d.split('-');
  return `${MONTHS[Number(mo) - 1]} ${day}`;
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
  const movingMinutes = sum(list.map((p) => p.location?.movingMinutes).filter((v) => v != null));
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
      label: 'HOURS MOVING',
      value: locationDays ? round(movingMinutes / 60, 1) : null,
      note: `${locationDays} ${daysWord(locationDays)} with location`,
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

const rhythmMax = computed(() => Math.max(
  ...rows.value.map((r) => r.payload?.trackedHours || 0),
  1,
));

const rhythmRows = computed(() => rows.value.map((r, i) => {
  const base = decorate(r, i);
  const p = r.payload;
  const total = p?.trackedHours ?? null;
  const cats = p?.categories;

  const segments = cats
    ? CATEGORY_ORDER
      .filter((c) => (cats[c] || 0) > 0)
      .map((c) => ({
        name: c,
        hours: cats[c],
        cat: CATEGORY_INDEX[c],
        pct: total > 0 ? (cats[c] / total) * 100 : 0,
      }))
    : [];

  return {
    ...base,
    total,
    missing: !cats,
    pct: total > 0 ? Math.max((total / rhythmMax.value) * 100, 1) : 0,
    segments,
  };
}));

const rhythmLegend = computed(() => CATEGORY_ORDER.filter((c) => payloads.value.some(
  (p) => p.categories && (p.categories[c] || 0) > 0,
)));

const rhythmHoverRow = computed(() => rhythmRows.value[rhythmHover.value] || null);

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
  const steps = r.payload?.health?.steps ?? null;
  return {
    ...base,
    steps,
    missing: steps == null,
    pct: steps != null && steps > 0 ? Math.max((steps / stepsMax.value) * 100, 1.2) : 0,
  };
}));

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

const runSummary = computed(() => {
  const list = payloads.value;
  const runs = sum(list.map((p) => p.health?.runs).filter((v) => v != null));
  const km = sum(list.map((p) => p.health?.runKm).filter((v) => v != null));
  const minutes = sum(list.map((p) => p.health?.runMinutes).filter((v) => v != null));
  const paces = list.map((p) => p.health?.runPaceS).filter((v) => v != null && v > 0);
  const bestPace = paces.length ? Math.min(...paces) : null;
  const hrs = list.map((p) => p.health?.hrAvg).filter((v) => v != null);
  const vo2 = [...list].reverse().find((p) => p.health?.vo2max != null)?.health?.vo2max ?? null;

  return [
    { label: 'RUNS', value: runs ? String(Math.round(runs)) : '—' },
    { label: 'DISTANCE', value: km ? `${km.toFixed(1)} km` : '—' },
    { label: 'TIME', value: minutes ? minutesLabel(minutes) : '—' },
    { label: 'BEST PACE', value: paceLabel(bestPace) },
    { label: 'AVG HR', value: hrs.length ? `${Math.round(sum(hrs) / hrs.length)} bpm` : '—' },
    { label: 'VO2MAX', value: vo2 != null ? String(vo2) : '—' },
  ];
});

// ── 03 地点 ─────────────────────────────────────────────────────────────

const places = computed(() => {
  const agg = {};
  const cityMinutes = {};
  let moving = 0;
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
    moving += Number(l.movingMinutes || 0);
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
      { label: 'MOVING', value: `${round(moving / 60, 1)} h` },
      { label: 'STAYING', value: `${round(stay / 60, 1)} h` },
      { label: 'MAX SPAN', value: span ? `${round(span, 1)} km` : '—' },
      { label: 'GPS POINTS', value: points ? fmt(Math.round(points)) : '—' },
    ],
  };
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

const tickerItems = computed(() => [
  'Aggregated nightly at 23:00',
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
    }
  } catch {
    /* 归档计数是附加信息，失败不影响总览 */
  }
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
    .fromTo(ticker, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.7 }, 0.7)
    .fromTo(cardsEls, { autoAlpha: 0, y: 48 }, {
      autoAlpha: 1, y: 0, duration: 0.85, stagger: 0.08,
    }, 0.64);

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
    const fills = panel.querySelectorAll('.life-fill');

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

  const fills = panel.querySelectorAll('.life-fill');
  if (fills.length) {
    gsap.to(fills, {
      scaleX: 1, duration: 1.05, ease: 'power3.out', stagger: 0.045, delay,
    });
  }
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

// 悬浮提示：位置由 CSS 的 left 过渡，显隐交给 GSAP
watch(rhythmHoverRow, async (v) => {
  await nextTick();
  const el = tipRef.value;
  if (!el) return;
  if (REDUCED) {
    gsap.set(el, { opacity: v ? 1 : 0 });
    return;
  }
  if (v) {
    gsap.fromTo(el, { opacity: 0, y: 8, xPercent: -50 }, {
      opacity: 1, y: 0, xPercent: -50, duration: 0.26, ease: 'power2.out',
    });
  } else {
    gsap.to(el, { opacity: 0, y: 6, xPercent: -50, duration: 0.16, ease: 'power1.in' });
  }
});

// ── 生命周期 ────────────────────────────────────────────────────────────

let firstActivation = true;

onMounted(() => {
  activeNow = true;
  mountedAt = performance.now();
  startClock();
  startPolling();
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
  if (data.value) {
    clearTimeout(introTimer);
    introTimer = setTimeout(() => {
      introTimer = null;
      if (activeNow) playIntro(introStarted);
    }, 420);
  }
});

onDeactivated(() => {
  activeNow = false;
  stopPolling();
  stopClock();
  killIntro();
  killTicker();
  killLive();
  killReveals();
});

onBeforeUnmount(() => {
  activeNow = false;
  stopPolling();
  stopClock();
  killIntro();
  killTicker();
  killLive();
  killReveals();
  if (stopBrandWatch) stopBrandWatch();
  if (abortCtl) abortCtl.abort();
});
</script>

<template>
  <main class="page active">
    <section ref="sectionRef" class="stats-section life-section">
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

        <!-- 01 每日节奏 -->
        <div class="stats-panel life-panel" data-reveal data-chart="rhythm">
          <div class="stats-panel-head">
            <div class="stats-panel-title">
              <span class="stats-panel-index">01</span>
              <h2>DAILY RHYTHM</h2>
            </div>
            <div class="stats-legend">
              <span v-for="c in rhythmLegend" :key="c">
                <i class="life-swatch" :class="`cat-${CATEGORY_INDEX[c]}`"></i>{{ c }}
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
                      <span class="stats-tip-date">{{ rhythmHoverRow ? fullDay(rhythmHoverRow.day) : '' }}</span>
                      <span class="stats-tip-row">
                        <b>{{ rhythmHoverRow?.total == null ? '—' : hoursLabel(rhythmHoverRow.total) }}</b>
                        <em>TRACKED</em>
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
            </div>
          </div>

          <div v-if="motionRows.length" class="life-chart">
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

                <div class="life-bars">
                  <div
                    v-for="r in motionRows"
                    :key="r.day"
                    class="life-col"
                    :class="{ 'is-missing': r.missing, 'is-today': r.isToday }"
                    role="img"
                    :aria-label="`${fullDay(r.day)}: ${r.steps == null ? 'no steps data' : fmt(r.steps) + ' steps'}`"
                  >
                    <div class="life-bar" :style="{ height: r.pct + '%' }"></div>
                  </div>
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

            <div class="life-chips">
              <span v-for="c in runSummary" :key="c.label" class="life-chip">
                <em>{{ c.label }}</em><b>{{ c.value }}</b>
              </span>
            </div>
          </div>

          <p v-else class="stats-panel-empty">No health data recorded yet.</p>
        </div>

        <!-- 03 地点 -->
        <div class="stats-panel life-panel" data-reveal>
          <div class="stats-panel-head">
            <div class="stats-panel-title">
              <span class="stats-panel-index">03</span>
              <h2>PLACES</h2>
            </div>
            <span class="stats-panel-sub">
              {{ places.city }}<template v-if="places.cityCount > 1"> +{{ places.cityCount - 1 }}</template>
              · city level only
            </span>
          </div>

          <div v-if="places.any" class="life-places">
            <div v-if="places.rows.length" class="life-rows">
              <div v-for="(p, i) in places.rows" :key="p.name" class="life-row life-row-wide">
                <span class="life-rank">{{ String(i + 1).padStart(2, '0') }}</span>
                <span class="life-name">{{ p.name }}</span>
                <span class="life-num">{{ hoursLabel(p.hours) }}</span>
                <span class="life-track"><span class="life-fill" :style="{ width: p.pct + '%' }"></span></span>
              </div>
            </div>
            <p v-else class="stats-panel-empty">No city-level stays recorded yet.</p>

            <div class="life-chips life-chips-pad">
              <span v-for="c in places.chips" :key="c.label" class="life-chip">
                <em>{{ c.label }}</em><b>{{ c.value }}</b>
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
            </div>
          </div>

          <div v-if="phoneRows.length" class="life-chart">
            <div class="life-split">
              <div class="life-main-col">
                <div class="life-chart-main">
                  <div class="life-plot">
                    <div class="stats-chart-grid" aria-hidden="true"><i></i><i></i><i></i></div>
                    <div class="life-bars">
                      <div
                        v-for="r in phoneRows"
                        :key="r.day"
                        class="life-col"
                        :class="{ 'is-missing': r.missing, 'is-today': r.isToday }"
                        role="img"
                        :aria-label="`${fullDay(r.day)}: ${r.unlocks == null ? 'no phone data' : fmt(r.unlocks) + ' unlocks'}`"
                      >
                        <div class="life-bar" :style="{ height: r.pct + '%' }"></div>
                      </div>
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
            <span class="stats-panel-sub">CNY · {{ aiChips[2].value }}</span>
          </div>

          <div v-if="hasAi" class="life-chart">
            <div class="life-split">
              <div class="life-main-col">
                <div class="life-chart-main">
                  <div class="life-plot">
                    <div class="stats-chart-grid" aria-hidden="true"><i></i><i></i><i></i></div>
                    <div class="life-bars">
                      <div
                        v-for="r in aiRows"
                        :key="r.day"
                        class="life-col"
                        :class="{ 'is-missing': r.missing, 'is-today': r.isToday }"
                        role="img"
                        :aria-label="`${fullDay(r.day)}: ${r.cost == null ? 'no AI data' : '¥' + r.cost}`"
                      >
                        <div class="life-bar" :style="{ height: r.pct + '%' }"></div>
                      </div>
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

        <!-- 06 归档：全量原始数据 -->
        <div class="stats-panel life-panel life-archive-panel" data-reveal>
          <div class="stats-panel-head">
            <div class="stats-panel-title">
              <span class="stats-panel-index">06</span>
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
  </main>
</template>
