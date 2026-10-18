// STATS 页验收：GSAP 入场、数字滚轮、30 天图表、悬浮提示、滚动揭示。
//
//   cd app && npx vite --port 5199 --strictPort
//   node tools/verify-stats.mjs
//
// /api/stats 与 /api/track 都在页面脚本执行前用 fetch 打桩，所以本机不用连 CMS，
// 数据也是固定的（否则截图和断言会随真实访问量变化）。
// 截图写到临时目录，路径会打印出来。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = process.argv[2] || 'http://127.0.0.1:5199/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 固定数据 ----------
const now = new Date('2026-10-18T12:00:00Z');
const daily = [];
for (let i = 29; i >= 0; i--) {
  const d = new Date(now.getTime() - i * 86400000);
  const dow = d.getUTCDay();
  const wave = Math.round(55 + 45 * Math.sin((29 - i) / 3.1) + (dow === 0 || dow === 6 ? 26 : 0));
  daily.push({
    day: d.toISOString().slice(0, 10),
    pv: Math.max(18, wave),
    uv: Math.max(9, Math.round(wave * 0.46)),
  });
}
const MOCK = {
  timezone: 'Asia/Shanghai (UTC+8)',
  since: '2025-09-01',
  totals: { pageViews: 48213, visitors: 9124 },
  today: { day: '2026-10-18', pageViews: 128, visitors: 47, yesterdayPv: 116, yesterdayUv: 42 },
  onlineNow: 3,
  daily,
  monthly: [
    { month: '2026-10', pv: 1832, uv: 624 },
    { month: '2026-09', pv: 4210, uv: 1388 },
    { month: '2026-08', pv: 3975, uv: 1260 },
    { month: '2026-07', pv: 3602, uv: 1188 },
    { month: '2026-06', pv: 4118, uv: 1322 },
    { month: '2026-05', pv: 3244, uv: 1054 },
    { month: '2026-04', pv: 2870, uv: 948 },
    { month: '2026-03', pv: 2455, uv: 806 },
  ],
  topPaths: [
    { path: '/', views: 18244 },
    { path: '/me', views: 9871 },
    { path: '/blogs', views: 7632 },
    { path: '/gallery', views: 5204 },
    { path: '/group-photos', views: 3890 },
    { path: '/me/gallery', views: 3105 },
    { path: '/friends/:id', views: 2088 },
    { path: '/stats', views: 1444 },
  ],
  generatedAt: '2026-10-18T12:00:00Z',
};

const STUB = `
(function () {
  var MOCK = ${JSON.stringify(JSON.stringify(MOCK))};
  var orig = window.fetch;
  window.__statsFetches = 0;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/stats') >= 0) {
      window.__statsFetches++;
      return Promise.resolve(new Response(MOCK, { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (url.indexOf('/api/track') >= 0) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, sid: 'verify-stats' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return orig.apply(this, arguments);
  };
})();
`;

async function withPage({ width, height, mobile, label, reduced = false }, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-'));
  const args = [
    '--headless=new',
    // 固定端口在本机这台 Chrome 155 上起不来 DevTools 服务；用 0 让它自己挑，
    // 端口号从 profile 里的 DevToolsActivePort 读
    '--remote-debugging-port=0',
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--disable-gpu',
    '--disable-extensions',
    '--hide-scrollbars',
    `--window-size=${width},${height}`,
    'about:blank',
  ];
  if (mobile) args.push('--touch-events=enabled');
  const child = spawn(CHROME, args, { stdio: 'ignore' });

  try {
    let port = null;
    for (let i = 0; i < 100 && !port; i++) {
      try {
        const raw = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split(/\r?\n/);
        if (raw[0]) port = Number(raw[0]);
      } catch {}
      if (!port) await sleep(200);
    }
    if (!port) throw new Error('Chrome did not start');

    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res);
      ws.addEventListener('error', rej);
    });

    let id = 0;
    const pending = new Map();
    const events = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) {
        events.push(m);
        if (m.method === 'Runtime.consoleAPICalled') {
          const args = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
          console.log('  [console]', m.params.type, args);
          if (m.params.type === 'error') errors.push(args);
        }
        if (m.method === 'Runtime.exceptionThrown') {
          errors.push(m.params.exceptionDetails?.text || 'exception');
        }
      }
    });

    const send = (method, params = {}) => new Promise((res, rej) => {
      const n = ++id;
      pending.set(n, { res, rej });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
    const evalJs = async (expression, awaitPromise = false) => {
      const r = await send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise,
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate failed');
      return r.result?.value;
    };
    const shot = async (name, full = false) => {
      const out = path.join(os.tmpdir(), `stats-${label}-${name}.png`);
      const r = await send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: full,
        fromSurface: true,
      });
      fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
      console.log('  screenshot:', out);
      return out;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: !!mobile,
    });
    if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    if (reduced) {
      await send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });
    }
    await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
    await send('Page.navigate', { url: new URL('/stats', APP).href });
    await sleep(1200);

    // 首屏品牌遮罩：要等字体就绪、ENTER 真的可见之后才点得动
    let enterVisible = false;
    for (let i = 0; i < 60 && !enterVisible; i++) {
      enterVisible = await evalJs(`(function () {
        var b = document.querySelector('.brand__enter');
        return !!b && b.offsetParent !== null;
      })()`);
      if (!enterVisible) await sleep(200);
    }
    if (enterVisible) {
      await evalJs("document.querySelector('.brand__enter').click()");
      // 等遮罩完全撤掉
      for (let i = 0; i < 50; i++) {
        const gone = await evalJs("(function () { var b = document.querySelector('.brand'); return !b || b.classList.contains('is-gone'); })()");
        if (gone) break;
        await sleep(200);
      }
      await sleep(3600);
    } else {
      // 没有遮罩（例如热更新后）：等入场
      await sleep(2600);
    }

    const result = await fn({ send, evalJs, shot, sleep, width, height });
    ws.close();
    return result;
  } finally {
    child.kill();
    await sleep(300);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

const CHART_STATE = `(function () {
  var cards = document.querySelectorAll('.stat-card');
  var bars = document.querySelectorAll('.stats-bar');
  var rows = document.querySelectorAll('.stats-month-row');
  var paths = document.querySelectorAll('.stats-path-item');
  var title = document.querySelector('.stats-title');
  var cs = getComputedStyle(document.querySelector('.stats-chart-line'));
  return JSON.stringify({
    cards: cards.length,
    numbers: Array.prototype.map.call(document.querySelectorAll('.sn-sr'), function (e) { return e.textContent; }),
    bars: bars.length,
    barScale: bars.length ? getComputedStyle(bars[15]).transform : null,
    lineDash: cs.strokeDasharray,
    rows: rows.length,
    paths: paths.length,
    titleChars: title ? title.querySelectorAll('.stats-char').length : 0,
    titleTransform: title ? getComputedStyle(title.querySelector('.stats-char')).transform : null,
    tiles: document.querySelectorAll('.stat-live-rings i').length,
    ticker: document.querySelectorAll('.stats-ticker-item').length,
    panelOpacity: Array.prototype.map.call(document.querySelectorAll('[data-reveal]'), function (e) { return getComputedStyle(e).opacity; }),
    consoleErrors: 0
  });
})()`;

const errors = [];

console.log('STATS desktop');
const desktop = await withPage({ width: 1440, height: 1000, mobile: false, label: 'desk' }, async ({ evalJs, shot, sleep, send }) => {
  const state = JSON.parse(await evalJs(CHART_STATE));
  console.log('  state:', state);
  if (state.cards !== 4) throw new Error('expected 4 KPI cards');
  if (state.bars !== 30) throw new Error('expected 30 bars');
  if (state.titleChars !== 10) throw new Error('expected per-letter title');
  if (state.tiles !== 3) throw new Error('expected 3 live rings');
  if (!state.numbers[0] || state.numbers[0] === '0') throw new Error('odometer numbers empty');
  await shot('top');

  // 卡片悬浮：整张卡应该翻成反色
  const cardRect = JSON.parse(await evalJs(`(function () {
    var r = document.querySelector('.stat-card').getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cardRect.x, y: cardRect.y });
  await sleep(800);
  const cardHover = JSON.parse(await evalJs(`(function () {
    var c = document.querySelector('.stat-card');
    return JSON.stringify({
      before: getComputedStyle(c, '::before').transform,
      numberColor: getComputedStyle(c.querySelector('.stat-number')).color
    });
  })()`));
  console.log('  card hover:', cardHover);
  if (!/matrix\(1, 0, 0, 1,/.test(cardHover.before)) throw new Error('card inverse wipe did not expand');
  await shot('cardhover');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 });
  await sleep(400);

  // 图表静止态
  await evalJs(`(function () {
    var el = document.querySelector('.stats-chart-plot');
    var y = el.getBoundingClientRect().top + window.scrollY - 120;
    window.scrollTo({ top: y, behavior: 'instant' });
  })()`);
  await sleep(700);
  await shot('chart');
  const rect = await evalJs(`(function () {
    var b = document.querySelectorAll('.stats-bar-col')[15].getBoundingClientRect();
    return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height - 60 });
  })()`);
  const p = JSON.parse(rect);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x - 2, y: p.y - 2 });
  await sleep(120);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await sleep(500);
  const tip = JSON.parse(await evalJs(`(function () {
    var t = document.querySelector('.stats-chart-tooltip');
    return JSON.stringify({ opacity: getComputedStyle(t).opacity, text: t.textContent.replace(/\\s+/g, ' ').trim() });
  })()`));
  console.log('  tooltip:', tip);
  if (Number(tip.opacity) < 0.8) throw new Error('tooltip did not appear');
  await shot('tooltip');

  // 滚到底：月度 / 热门页面 / 页脚揭示
  await evalJs('window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" })');
  await sleep(1600);
  const lower = JSON.parse(await evalJs(`(function () {
    var panels = document.querySelectorAll('.stats-panel');
    return JSON.stringify({
      opacities: Array.prototype.map.call(panels, function (e) { return getComputedStyle(e).opacity; }),
      monthFill: getComputedStyle(document.querySelector('.stats-month-fill')).transform,
      foot: getComputedStyle(document.querySelector('.stats-foot')).opacity
    });
  })()`));
  console.log('  lower:', lower);
  if (lower.opacities.some((o) => Number(o) < 0.99)) throw new Error('panels not revealed');
  await shot('bottom');

  // keep-alive：离开 STATS 再回来，页面应该重播动画、内容保持可见、不重复拉数据爆炸
  const fetchesBefore = await evalJs('window.__statsFetches');
  await evalJs("document.querySelectorAll('nav a')[0].click()");
  await sleep(2600);
  const pathHome = await evalJs('location.pathname');
  if (pathHome !== '/') throw new Error('did not navigate home');
  await evalJs(`document.querySelector('nav a[href="/stats"]').click()`);
  await sleep(4600);
  const returned = JSON.parse(await evalJs(`(function () {
    var cards = document.querySelectorAll('.stat-card');
    var bars = document.querySelectorAll('.stats-bar');
    return JSON.stringify({
      path: location.pathname,
      fetches: window.__statsFetches,
      cards: cards.length,
      cardOpacity: cards.length ? getComputedStyle(cards[0]).opacity : null,
      bars: bars.length,
      barScale: bars.length ? getComputedStyle(bars[15]).transform : null,
      title: document.querySelector('.stats-title')?.textContent.trim()
    });
  })()`));
  console.log('  returned:', returned, 'fetchesBefore:', fetchesBefore);
  if (returned.path !== '/stats') throw new Error('did not return to stats');
  if (returned.cards !== 4) throw new Error('cards lost after keep-alive');
  if (Number(returned.cardOpacity) < 0.99) throw new Error('cards stayed hidden after keep-alive');
  if (!/matrix\(1, 0, 0, 1,/.test(returned.barScale)) throw new Error('chart reset after keep-alive');
  if (returned.fetches <= fetchesBefore) throw new Error('no refresh fetch on re-activation');
  await shot('return');

  return state;
});

console.log('STATS light theme');
await withPage({ width: 1440, height: 1000, mobile: false, label: 'light' }, async ({ evalJs, shot, sleep }) => {
  await evalJs("document.documentElement.classList.remove('dark')");
  await sleep(400);
  await shot('top');
  await evalJs('window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" })');
  await sleep(1200);
  await shot('bottom');
});

console.log('STATS reduced motion');
await withPage({ width: 1440, height: 1000, mobile: false, label: 'reduced', reduced: true }, async ({ evalJs, shot }) => {
  const state = JSON.parse(await evalJs(CHART_STATE));
  console.log('  state:', state);
  if (state.bars !== 30) throw new Error('reduced: expected 30 bars');
  if (!/matrix\(1, 0, 0, 1,/.test(state.barScale)) throw new Error('reduced: bars hidden');
  if (state.lineDash !== 'none') throw new Error('reduced: line still dashed');
  if (state.panelOpacity.some((o) => Number(o) < 0.99)) throw new Error('reduced: panels hidden');
  await shot('top');
});

console.log('STATS mobile');
const mobileState = await withPage({ width: 390, height: 844, mobile: true, label: 'mobile' }, async ({ evalJs, shot, sleep }) => {
  const state = JSON.parse(await evalJs(CHART_STATE));
  console.log('  state:', state);
  if (state.cards !== 4) throw new Error('mobile: expected 4 KPI cards');
  if (state.bars !== 30) throw new Error('mobile: expected 30 bars');
  const legend = Number(await evalJs(`(function () {
    return Array.prototype.filter.call(document.querySelectorAll('.stats-legend span'), function (e) {
      return getComputedStyle(e).display !== 'none';
    }).length;
  })()`));
  if (legend !== 2) throw new Error(`mobile: legend entries hidden (${legend})`);
  await shot('top');
  await evalJs('window.scrollTo({ top: 620, behavior: "instant" })');
  await sleep(1100);
  await shot('chart');
  await evalJs('window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" })');
  await sleep(1400);
  await shot('bottom');
  await evalJs('window.scrollTo({ top: 0, behavior: "instant" })');
  await sleep(300);
  await shot('full', true);
  return state;
});

if (errors.length) {
  console.error('console errors:', errors);
  process.exitCode = 1;
}
console.log('done');
