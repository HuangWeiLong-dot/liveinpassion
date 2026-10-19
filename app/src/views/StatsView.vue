<script setup>
// STATS 页（公开）。数据来自 Worker 的 /api/stats，60 秒轮询一次。
//
// 视觉基调跟全站一致：黑白、Oswald 大标题、JetBrains Mono 小标签、
// 1px 发丝线、方块。动效全部交给 GSAP —— 逐字标题、KPI 数字滚轮、
// 30 天柱+线绘制、面板滚动揭示、实时脉冲、跑马灯。
//
// 两个时序上的坑：
//  1. keep-alive：首次挂载后再次进入不会重跑 onMounted，所以重播走 onActivated。
//     数据与 DOM 都还在，只把动画复位再演一遍；已经揭示过的面板不再藏起来，
//     否则每次回来页面都先闪一下空白。
//  2. 首屏品牌遮罩 / 通用转场板子：直接打开 /stats 时页面在遮罩底下，站内点
//     STATS 进来时页面前 ~380ms 在转场板子底下。早演等于白演，所以入场排在
//     "遮罩撤掉"或"板子滑走"之后（见 scheduleIntro）。
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import OdometerNumber from '../components/OdometerNumber.vue';
import { useBrandOverlay } from '../composables/useBrandOverlay.js';

gsap.registerPlugin(ScrollTrigger);

const CMS_BASE =
  import.meta.env.VITE_CMS_BASE || 'https://cms.liveinpassion.me';

const { visible: brandVisible } = useBrandOverlay();

const REDUCED = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

const data = ref(null);
const error = ref(false);
const loading = ref(true);
const clock = ref('--:--:--');
const lastUpdated = ref('—');
const hoverIndex = ref(-1);
// 每次 +1 让 KPI 数字重新滚一遍（0 = 还没开始）
const numbersRun = ref(0);
const titleChars = [...'STATISTICS'];

const sectionRef = ref(null);
const tickerTrackRef = ref(null);
const liveRef = ref(null);
const chartRef = ref(null);
const plotRef = ref(null);
const lineRef = ref(null);
const areaRef = ref(null);
const scanRef = ref(null);
const tipRef = ref(null);

// ── 数据整形 ────────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function compact(n) {
  const v = Number(n || 0);
  if (v >= 1000000) return `${(v / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(v);
}

function monthLabel(m) {
  const [y, mo] = String(m).split('-');
  return `${MONTHS[Number(mo) - 1]} ${y}`;
}

function shortDay(d) {
  return d.slice(5).replace('-', '/');
}

function fullDay(d) {
  const [, mo, day] = d.split('-');
  return `${MONTHS[Number(mo) - 1]} ${day}`;
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

// 近 30 天：柱是 PV、线是 UV，二者共用同一个纵轴刻度，
// 所以线永远在柱顶之下或与柱齐平，不会因为各自归一化而互相撒谎。
const chartMax = computed(() => {
  const rows = data.value?.daily || [];
  return Math.max(...rows.map((r) => Math.max(r.pv, r.uv)), 1);
});

const dailyBars = computed(() => {
  const rows = data.value?.daily || [];
  if (!rows.length) return [];
  const n = rows.length;
  const max = chartMax.value;
  return rows.map((r, i) => {
    const leftPct = ((i + 0.5) / n) * 100;
    return {
      ...r,
      label: shortDay(r.day),
      fullLabel: fullDay(r.day),
      pvPct: r.pv > 0 ? Math.max((r.pv / max) * 100, 1.2) : 0,
      uvPct: Math.max((r.uv / max) * 100, 0),
      leftPct,
      // 两端的提示框不能越出画布
      tipPct: Math.min(93, Math.max(7, leftPct)),
      showLabel: i % 5 === 0 || i === n - 1,
      isToday: i === n - 1,
    };
  });
});

const hoverData = computed(() => dailyBars.value[hoverIndex.value] || null);

const linePath = computed(() => {
  const rows = dailyBars.value;
  if (!rows.length) return '';
  const n = rows.length;
  return rows
    .map((r, i) => `${i === 0 ? 'M' : 'L'}${(((i + 0.5) / n) * 1000).toFixed(2)},${(100 - r.uvPct).toFixed(2)}`)
    .join(' ');
});

const areaPath = computed(() => {
  const rows = dailyBars.value;
  if (!rows.length) return '';
  const n = rows.length;
  const x0 = (0.5 / n) * 1000;
  const x1 = ((n - 0.5) / n) * 1000;
  return `${linePath.value} L${x1.toFixed(2)},100 L${x0.toFixed(2)},100 Z`;
});

// 今日相对昨日（百分比）。不靠颜色表达方向：箭头 + 符号就是语义。
const trend = computed(() => {
  const t = data.value?.today;
  if (!t) return null;
  const prev = Number(t.yesterdayPv) || 0;
  if (!prev) {
    return t.pageViews > 0
      ? { dir: 'up', arrow: '▲', text: 'NEW' }
      : { dir: 'flat', arrow: '·', text: '—' };
  }
  const diff = Math.round(((t.pageViews - prev) / prev) * 100);
  return {
    dir: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
    arrow: diff > 0 ? '▲' : diff < 0 ? '▼' : '·',
    text: `${diff > 0 ? '+' : ''}${diff}%`,
  };
});

const cards = computed(() => {
  const d = data.value;
  if (!d) return [];
  return [
    {
      key: 'pv',
      label: 'TOTAL PAGE VIEWS',
      value: d.totals.pageViews,
      note: 'All time',
      delay: 0.1,
    },
    {
      key: 'uv',
      label: 'UNIQUE VISITORS',
      value: d.totals.visitors,
      note: 'Anonymous browsers',
      delay: 0.15,
    },
    {
      key: 'today',
      label: 'TODAY',
      value: d.today.pageViews,
      note: `${fmt(d.today.visitors)} visitors today`,
      delay: 0.2,
      trend: trend.value,
    },
    {
      key: 'online',
      label: 'ONLINE NOW',
      value: d.onlineNow,
      note: 'Active in the last 5 minutes',
      delay: 0.25,
      live: true,
    },
  ];
});

const monthlyRows = computed(() => {
  const rows = data.value?.monthly || [];
  const max = Math.max(...rows.map((r) => r.pv), 1);
  return rows.map((r) => ({
    ...r,
    name: monthLabel(r.month),
    pct: r.pv > 0 ? Math.max((r.pv / max) * 100, 2) : 0,
  }));
});

const pathRows = computed(() => {
  const rows = data.value?.topPaths || [];
  const max = Math.max(...rows.map((r) => r.views), 1);
  return rows.map((r) => ({
    ...r,
    name: pathName(r.path),
    pct: r.views > 0 ? Math.max((r.views / max) * 100, 2) : 0,
  }));
});

function pathName(p) {
  const names = {
    '/': 'HOME',
    '/blogs': 'BLOGS',
    '/me': 'ME',
    '/me/gallery': 'ME — GALLERY',
    '/gallery': 'GALLERY',
    '/stats': 'STATS',
  };
  return names[p] || String(p).replace(/^\//, '').toUpperCase();
}

const tickerItems = computed(() => [
  'No cookies',
  'No IP logging',
  'Anonymous random ID',
  data.value?.timezone || 'Asia/Shanghai (UTC+8)',
  'Refreshes every 60 seconds',
  `Tracking since ${data.value?.since || '—'}`,
]);

// ── 拉数据 ──────────────────────────────────────────────────────────────

let pollTimer = null;
let clockTimer = null;
let activeNow = false;
let introStarted = false;
let mountedAt = performance.now();
let introTimer = null;
let introTl = null;
let tickerTween = null;
let liveTween = null;
let dotTween = null;
let stopBrandWatch = null;
const revealTriggers = [];

async function load() {
  try {
    const res = await fetch(`${CMS_BASE}/api/stats`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`stats ${res.status}`);
    const json = await res.json();
    data.value = json;
    error.value = false;
    loading.value = false;
    lastUpdated.value = formatTime(json.generatedAt || new Date().toISOString());
    await nextTick();
    if (!activeNow) return;
    if (!introStarted) {
      // 先把柱子和线定在"未绘制"态，避免数据一到位先闪一帧满格柱图
      prepareChart();
      scheduleIntro();
    }
  } catch {
    loading.value = false;
    // 后台刷新失败时保留旧数据，只有首屏失败才显示错误态
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
  // 首屏品牌遮罩还盖着：等它撤（下面的 watch 会再来一次）
  if (brandVisible.value) return;
  clearTimeout(introTimer);
  // 站内导航进来：转场板子在新页挂载后还要 ~380ms 才滑走
  const wait = Math.max(0, 420 - (performance.now() - mountedAt));
  introTimer = setTimeout(() => {
    introTimer = null;
    // 数据加载与遮罩撤掉可能各排一次；播放本身再挡一道
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

  // 数字滚轮：首次从 0 滚到目标；重进页面也重滚一遍
  numbersRun.value += 1;

  const q = (sel) => (sectionRef.value ? sectionRef.value.querySelectorAll(sel) : []);
  const kickers = q('.stats-kicker');
  const chars = q('.stats-char');
  const ruleFill = q('.stats-hero-rule span');
  const subtitle = q('.stats-subtitle');
  const meta = q('.stats-hero-meta');
  const ticker = q('.stats-ticker');
  const cardsEls = q('.stat-card');

  // 上一次可能演到一半就离开了：先把内联状态清掉再重排
  gsap.set([...kickers, ...subtitle, ...meta, ...ticker, ...cardsEls], { clearProps: 'opacity,visibility,transform' });
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
    // 逐字从线下升起来。父级 overflow: hidden 就是遮罩。
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

  // 第一次进来才铺滚动揭示；重进时已经看过的面板保持原样，只补没揭示过的
  if (!replay) {
    prepareChart();
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
    '.stats-kicker, .stats-char, .stats-hero-rule span, .stats-subtitle, .stats-hero-meta, .stats-ticker, .stat-card'
  ));
}

// ── 滚动揭示 ────────────────────────────────────────────────────────────

function killReveals() {
  revealTriggers.forEach((t) => t.kill());
  revealTriggers.length = 0;
}

function revealChildren(panel) {
  const fills = panel.querySelectorAll('.stats-month-fill, .stats-path-fill');
  const rows = panel.querySelectorAll('.stats-month-row, .stats-path-item');
  if (REDUCED) {
    // 图表 / 页脚那几个 [data-reveal] 里没有行，空 NodeList 会让 GSAP 报
    // "target not found" 警告 —— 先判长度再设
    if (fills.length) gsap.set(fills, { scaleX: 1 });
    if (rows.length) gsap.set(rows, { autoAlpha: 1, y: 0 });
    return;
  }
  if (fills.length) {
    gsap.fromTo(fills, { scaleX: 0 }, {
      scaleX: 1, duration: 1.1, ease: 'power3.out', stagger: 0.05,
    });
  }
  if (rows.length) {
    gsap.fromTo(rows, { autoAlpha: 0, y: 12 }, {
      autoAlpha: 1, y: 0, duration: 0.55, ease: 'power2.out', stagger: 0.045,
    });
  }
}

/**
 * @param {boolean} reset true = 第一次进入，全部重新藏起来再揭示；
 *                        false = 重进页面，只处理还没揭示过的
 */
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
        if (hasChart) animateChart(0.2);
      },
    });
    revealTriggers.push(trigger);
  });

  ScrollTrigger.refresh();
}

// ── 图表 ────────────────────────────────────────────────────────────────

function prepareChart() {
  if (!chartRef.value) return;
  const bars = chartRef.value.querySelectorAll('.stats-bar');
  const line = lineRef.value;
  const area = areaRef.value;

  if (REDUCED) {
    if (bars.length) gsap.set(bars, { scaleY: 1 });
    if (line) gsap.set(line, { clearProps: 'strokeDasharray,strokeDashoffset', opacity: 1 });
    if (area) gsap.set(area, { opacity: 1 });
    return;
  }

  if (bars.length) gsap.set(bars, { scaleY: 0 });
  if (line && line.getAttribute('d')) {
    const len = line.getTotalLength();
    gsap.set(line, { strokeDasharray: len, strokeDashoffset: len, opacity: 1 });
  }
  if (area) gsap.set(area, { opacity: 0 });
  if (scanRef.value) gsap.set(scanRef.value, { x: 0, opacity: 0 });
  if (tipRef.value) gsap.set(tipRef.value, { opacity: 0 });
}

function animateChart(delay = 0) {
  if (!chartRef.value) return;
  if (REDUCED) {
    prepareChart();
    return;
  }

  const bars = chartRef.value.querySelectorAll('.stats-bar');
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

  const line = lineRef.value;
  if (line && line.getAttribute('d')) {
    const len = line.getTotalLength();
    gsap.set(line, { strokeDasharray: len, strokeDashoffset: len });
    gsap.to(line, {
      strokeDashoffset: 0,
      duration: 1.45,
      ease: 'power2.inOut',
      delay: delay + 0.15,
      // 画完后清掉 dash 属性：之后数据刷新导致路径变长时不会出现断口
      onComplete: () => gsap.set(line, { clearProps: 'strokeDasharray,strokeDashoffset' }),
    });
  }

  if (areaRef.value) {
    gsap.fromTo(areaRef.value, { opacity: 0 }, {
      opacity: 1, duration: 1, ease: 'power1.out', delay: delay + 0.5,
    });
  }

  // 扫过整张图的一道细光：像数据刚被读进来
  const scan = scanRef.value;
  const width = plotRef.value?.clientWidth || 0;
  if (scan && width) {
    gsap.timeline({ delay })
      .set(scan, { x: 0, opacity: 0 })
      .to(scan, { opacity: 1, duration: 0.15, ease: 'power1.out' })
      .to(scan, { x: width, duration: 1.05, ease: 'power2.inOut' }, '<')
      .to(scan, { opacity: 0, duration: 0.3, ease: 'power1.in' }, '>-0.2');
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
  // 两组完全相同的内容，滚到 -50% 后无缝接回
  tickerTween = gsap.to(track, {
    xPercent: -50,
    duration: 34,
    ease: 'none',
    repeat: -1,
  });
}

function killLive() {
  if (liveTween) {
    liveTween.kill();
    liveTween = null;
  }
  if (dotTween) {
    dotTween.kill();
    dotTween = null;
  }
  if (liveRef.value) {
    gsap.set(liveRef.value.querySelectorAll('i'), { clearProps: 'transform,opacity' });
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
  const rings = liveRef.value?.querySelectorAll('i');
  if (!rings?.length) return;
  liveTween = gsap.fromTo(
    rings,
    { scale: 1, opacity: 0.85 },
    {
      scale: 5,
      opacity: 0,
      duration: 2.1,
      ease: 'power1.out',
      stagger: 0.55,
      repeat: -1,
    }
  );
}

// 悬浮提示：位置由 CSS 的 left 过渡，显隐交给 GSAP
watch(hoverData, async (v) => {
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

  // 首屏遮罩撤掉的那一刻再排入场（直接打开 /stats 时的路径）
  stopBrandWatch = watch(brandVisible, (v) => {
    if (!v && activeNow && !introStarted) scheduleIntro();
  });

  // 字体到位后面板高度会变，滚动触发点要重算一次
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      if (activeNow) ScrollTrigger.refresh();
    }).catch(() => {});
  }
});

onActivated(() => {
  // 首挂载时 onMounted 与 onActivated 会各来一次，第一次交给 onMounted
  if (firstActivation) {
    firstActivation = false;
    return;
  }
  activeNow = true;
  mountedAt = performance.now();
  startClock();
  startPolling();
  load();
  // 和站内首次进入一样，等转场板子滑走再演；introStarted 还是 false 说明上次
  // 在入场排期之前就离开了 —— 按"第一次"处理，不能走 replay 的捷径
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
});

// 暴露给模板：卡片里的在线脉冲是从 v-for 里渲染的，用函数 ref 拿到那一个
function setLiveEl(el) {
  liveRef.value = el;
}
</script>

<template>
  <main class="page active">
    <section ref="sectionRef" class="stats-section">
      <!-- 注意用 div 不用 header：站点顶栏的全局 `header { position: fixed; display: flex }`
           会连这个页内头部一起吃掉，整块 hero 会飞到屏幕顶上变成一排 -->
      <div class="stats-hero">
        <div class="stats-hero-kicker">
          <span class="stats-kicker stats-live">
            <i class="stats-live-dot" aria-hidden="true"></i>
            Live data feed
          </span>
          <span class="stats-kicker stats-kicker-rule" aria-hidden="true"></span>
          <span class="stats-kicker stats-clock">UTC+8 <b>{{ clock }}</b></span>
        </div>

        <h1 class="stats-title" aria-label="STATISTICS">
          <span class="stats-title-line" aria-hidden="true">
            <span v-for="(ch, i) in titleChars" :key="i" class="stats-char">{{ ch }}</span>
          </span>
        </h1>

        <div class="stats-hero-rule" aria-hidden="true"><span></span></div>

        <p class="stats-subtitle">Who passes through Live in Passion</p>

        <div class="stats-hero-meta">
          <template v-if="data?.since">
            <span>Tracking since {{ data.since }}</span>
            <i aria-hidden="true"></i>
          </template>
          <span>{{ data?.timezone || 'Asia/Shanghai (UTC+8)' }}</span>
          <i aria-hidden="true"></i>
          <span>Updated {{ lastUpdated }}</span>
        </div>
      </div>

      <div v-if="loading" class="stats-loading" aria-label="Loading statistics">
        <span v-for="n in 4" :key="n"></span>
      </div>

      <div v-else-if="error" class="stats-empty">
        <p>Statistics are temporarily unavailable.</p>
        <button class="stats-retry" @click="load">RETRY</button>
      </div>

      <template v-else>
        <!-- 系统信息跑马灯 -->
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
        <div class="stats-cards">
          <article
            v-for="(card, i) in cards"
            :key="card.key"
            class="stat-card"
            :class="{ 'stat-card-live': card.live }"
          >
            <div class="stat-card-head">
              <span class="stat-index">{{ String(i + 1).padStart(2, '0') }}</span>
              <span class="stat-eyebrow">{{ card.label }}</span>
            </div>

            <div class="stat-number-wrap">
              <OdometerNumber
                class="stat-number"
                :value="card.value"
                :run="numbersRun"
                :delay="card.delay"
                :reduced="REDUCED"
              />
            </div>

            <div class="stat-card-foot">
              <template v-if="card.trend">
                <span class="stat-trend" :class="`is-${card.trend.dir}`">
                  <span class="stat-trend-arrow" aria-hidden="true">{{ card.trend.arrow }}</span>{{ card.trend.text }}
                </span>
                <span class="stat-note">vs. yesterday · {{ fmt(data.today.visitors) }} visitors</span>
              </template>
              <span v-else class="stat-note">{{ card.note }}</span>
            </div>

            <span
              v-if="card.live"
              :ref="setLiveEl"
              class="stat-live-rings"
              aria-hidden="true"
            >
              <b></b><i></i><i></i><i></i>
            </span>
          </article>
        </div>

        <!-- 近 30 天：柱 = PV，线 = UV -->
        <div ref="chartRef" class="stats-panel stats-chart-panel" data-reveal data-chart>
          <div class="stats-panel-head">
            <div class="stats-panel-title">
              <span class="stats-panel-index">01</span>
              <h2>LAST 30 DAYS</h2>
            </div>
            <div class="stats-legend">
              <span><i class="lg-swatch"></i>Page views</span>
              <span><i class="lg-line"></i>Visitors</span>
            </div>
          </div>

          <div v-if="dailyBars.length" class="stats-chart">
            <div class="stats-chart-main">
              <div ref="plotRef" class="stats-chart-plot">
                <div class="stats-chart-grid" aria-hidden="true">
                  <i></i><i></i><i></i>
                </div>

                <svg
                  class="stats-chart-svg"
                  viewBox="0 0 1000 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id="statsAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color="currentColor" stop-opacity="0.16" />
                      <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
                    </linearGradient>
                  </defs>
                  <path ref="areaRef" :d="areaPath" class="stats-chart-area" />
                  <path ref="lineRef" :d="linePath" class="stats-chart-line" />
                </svg>

                <div class="stats-bars" :class="{ 'is-hovering': hoverIndex >= 0 }">
                  <div
                    v-for="(b, i) in dailyBars"
                    :key="b.day"
                    class="stats-bar-col"
                    :class="{ 'is-today': b.isToday }"
                    tabindex="0"
                    role="img"
                    :aria-label="`${b.fullLabel}: ${fmt(b.pv)} page views, ${fmt(b.uv)} visitors`"
                    @pointerenter="hoverIndex = i"
                    @pointerleave="hoverIndex = -1"
                    @focus="hoverIndex = i"
                    @blur="hoverIndex = -1"
                  >
                    <div class="stats-bar" :style="{ height: b.pvPct + '%' }"></div>
                  </div>
                </div>

                <div ref="scanRef" class="stats-chart-scan" aria-hidden="true"></div>

                <div
                  class="stats-chart-cursor"
                  aria-hidden="true"
                  :style="{ left: hoverData ? hoverData.leftPct + '%' : '0%', opacity: hoverData ? 1 : 0 }"
                ></div>

                <div
                  ref="tipRef"
                  class="stats-chart-tooltip"
                  aria-hidden="true"
                  :style="{ left: hoverData ? hoverData.tipPct + '%' : '0%' }"
                >
                  <span class="stats-tip-date">{{ hoverData?.fullLabel || '' }}</span>
                  <span class="stats-tip-row">
                    <b>{{ fmt(hoverData?.pv || 0) }}</b><em>PAGE VIEWS</em>
                  </span>
                  <span class="stats-tip-row">
                    <b>{{ fmt(hoverData?.uv || 0) }}</b><em>VISITORS</em>
                  </span>
                </div>
              </div>

              <div class="stats-chart-yaxis" aria-hidden="true">
                <span>{{ compact(chartMax) }}</span>
                <span>{{ compact(Math.round(chartMax / 2)) }}</span>
                <span>0</span>
              </div>
            </div>

            <div class="stats-chart-xaxis" aria-hidden="true">
              <span v-for="b in dailyBars" :key="b.day">{{ b.showLabel ? b.label : '' }}</span>
            </div>
          </div>

          <p v-else class="stats-panel-empty">No visits recorded yet.</p>
        </div>

        <div class="stats-two-col">
          <!-- 按月 -->
          <div class="stats-panel" data-reveal data-stagger>
            <div class="stats-panel-head">
              <div class="stats-panel-title">
                <span class="stats-panel-index">02</span>
                <h2>MONTHLY</h2>
              </div>
              <span class="stats-panel-sub">Page views / visitors</span>
            </div>

            <div v-if="monthlyRows.length" class="stats-month-list">
              <div class="stats-month-head" aria-hidden="true">
                <span>Month</span><span></span><span>PV</span><span>UV</span>
              </div>
              <div v-for="m in monthlyRows" :key="m.month" class="stats-month-row">
                <span class="stats-month-label">{{ m.name }}</span>
                <span class="stats-month-track">
                  <span class="stats-month-fill" :style="{ width: m.pct + '%' }"></span>
                </span>
                <span class="stats-month-pv">{{ fmt(m.pv) }}</span>
                <span class="stats-month-uv">{{ fmt(m.uv) }}</span>
              </div>
            </div>
            <p v-else class="stats-panel-empty">No monthly data yet.</p>
          </div>

          <!-- 热门页面 -->
          <div class="stats-panel" data-reveal data-stagger>
            <div class="stats-panel-head">
              <div class="stats-panel-title">
                <span class="stats-panel-index">03</span>
                <h2>TOP PAGES</h2>
              </div>
              <span class="stats-panel-sub">All time views</span>
            </div>

            <ol v-if="pathRows.length" class="stats-paths">
              <li v-for="(p, i) in pathRows" :key="p.path" class="stats-path-item">
                <span class="stats-rank">{{ String(i + 1).padStart(2, '0') }}</span>
                <span class="stats-path-name">{{ p.name }}</span>
                <span class="stats-path-num">{{ fmt(p.views) }}</span>
                <span class="stats-path-track">
                  <span class="stats-path-fill" :style="{ width: p.pct + '%' }"></span>
                </span>
              </li>
            </ol>
            <p v-else class="stats-panel-empty">No data yet.</p>
          </div>
        </div>

        <p class="stats-foot" data-reveal>
          <span><i aria-hidden="true"></i>Tracking since {{ data.since || '—' }}</span>
          <span><i aria-hidden="true"></i>{{ data.timezone }}</span>
          <span><i aria-hidden="true"></i>No cookies, no IPs — an anonymous random ID only</span>
          <span><i aria-hidden="true"></i>Refreshes every 60 seconds</span>
        </p>
      </template>
    </section>
  </main>
</template>
