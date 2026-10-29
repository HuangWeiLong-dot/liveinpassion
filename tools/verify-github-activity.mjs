// GITHUB ACTIVITY 板块验收：LIFE 长页（panel）与仪表盘（tile）两处都出现，
// 贡献格子图（12 周 × 7 天）、合计数字、仓库排行、缓存命中、
// 接口失败时的降级、手机不横向溢出。
//
//   cd app && npx vite preview --port 4174 --strictPort
//   node tools/verify-github-activity.mjs http://127.0.0.1:4174/
//
// api.github.com 在页面脚本之前打桩：第一段返回固定事件流，第三段返回 403。
// 请求次数存在 localStorage，跨导航可以累计（window 上的计数每次导航都会重置）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = process.argv[2] || 'http://127.0.0.1:4174/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 固定事件流 ----------
// 和 useGithubActivity 一样对齐：最后一列的周一所在周是本周，往前 12 列。
const WEEKS = 12;
const END = new Date();
END.setHours(0, 0, 0, 0);
const DOW = (END.getDay() + 6) % 7; // 周一 = 0
const MONDAY = new Date(END);
MONDAY.setDate(END.getDate() - DOW);
const START = new Date(MONDAY);
START.setDate(MONDAY.getDate() - (WEEKS - 1) * 7);

const pad2 = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const EVENTS = [];
const PAST_DAYS = []; // 窗口内「今天及以前」的日期，按时间顺序
for (let i = 0; i < WEEKS * 7; i++) {
  const d = new Date(START);
  d.setDate(START.getDate() + i);
  d.setHours(0, 0, 0, 0);
  if (d > END) continue;
  PAST_DAYS.push({ date: d, i });
}

// 每周的周日（i % 7 === 6）留空，其余日子都有活动
const ACTIVE = PAST_DAYS.filter(({ i }) => i % 7 !== 6);
const ACTIVE_KEYS = new Set(ACTIVE.map(({ date }) => dayKey(date)));

const EXPECT = { commits: 0, pushes: 0, prs: 0, issues: 0, other: 0 };
for (const { date, i } of ACTIVE) {
  const at = new Date(date);
  at.setHours(12, 0, 0, 0);
  const key = dayKey(date);

  EVENTS.push({
    id: `${key}-push`,
    type: 'PushEvent',
    repo: { name: 'HuangWeiLong-dot/liveinpassion' },
    created_at: at.toISOString(),
    payload: { commits: [{ sha: `${key}-a` }, { sha: `${key}-b` }] },
  });
  EXPECT.pushes += 1;
  EXPECT.commits += 2;

  if (i % 2 === 0) {
    EVENTS.push({
      id: `${key}-pr`,
      type: 'PullRequestEvent',
      repo: { name: 'HuangWeiLong-dot/LifeLogging' },
      created_at: at.toISOString(),
      payload: { action: 'opened' },
    });
    EXPECT.prs += 1;
  }

  if (i % 5 === 0) {
    EVENTS.push({
      id: `${key}-issue`,
      type: 'IssuesEvent',
      repo: { name: 'HuangWeiLong-dot/LifeLogging' },
      created_at: at.toISOString(),
      payload: { action: 'opened' },
    });
    EXPECT.issues += 1;
  }

  if (i % 4 === 0) {
    EVENTS.push({
      id: `${key}-watch`,
      type: 'WatchEvent',
      repo: { name: 'HuangWeiLong-dot/LifeLogging' },
      created_at: at.toISOString(),
      payload: { action: 'started' },
    });
    EXPECT.other += 1;
  }
}
EVENTS.reverse(); // 接口是新的在前

EXPECT.events = EXPECT.pushes + EXPECT.prs + EXPECT.issues + EXPECT.other;
EXPECT.activeDays = ACTIVE.length;
EXPECT.windowDays = PAST_DAYS.length;

// 连续天数：今天没活动就从昨天起算（和组件里的口径一致）
EXPECT.streak = (() => {
  let cursor = PAST_DAYS.length - 1;
  if (cursor >= 0 && !ACTIVE_KEYS.has(dayKey(PAST_DAYS[cursor].date))) cursor -= 1;
  let n = 0;
  while (cursor >= 0 && ACTIVE_KEYS.has(dayKey(PAST_DAYS[cursor].date))) {
    n += 1;
    cursor -= 1;
  }
  return n;
})();

const EXPECT_LEVELS = Math.max(1, ...ACTIVE.map(({ date }) => {
  const key = dayKey(date);
  return EVENTS.filter((e) => e.created_at.slice(0, 10) === key).length;
})) > 1;

function stubSource(mode) {
  // mode: 'ok' | 'fail'
  return `(() => {
  var orig = window.fetch;
  var EVENTS = ${JSON.stringify(EVENTS)};
  var MODE = ${JSON.stringify(mode)};
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('api.github.com') >= 0) {
      var n = Number(localStorage.getItem('__ghFetches') || 0) + 1;
      localStorage.setItem('__ghFetches', String(n));
      if (MODE === 'fail') {
        return Promise.resolve(new Response('{"message":"API rate limit exceeded"}', {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      var page = Number((url.match(/[?&]page=(\\d+)/) || [])[1] || 1);
      var body = page === 1 ? EVENTS : [];
      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    return orig.apply(this, arguments);
  };
})();`;
}

// ---------- CDP ----------
async function withPage({ width, height, mobile, label, mode = 'ok' }, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-act-'));
  const args = [
    '--headless=new',
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
    const errors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) {
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
          errors.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
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
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate failed');
      return r.result?.value;
    };
    const shot = async (name, full = false) => {
      const out = path.join(os.tmpdir(), `gh-act-${label}-${name}.png`);
      const r = await send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: full, fromSurface: true,
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
    await send('Page.addScriptToEvaluateOnNewDocument', { source: stubSource(mode) });
    // LIFE 自己的数据也要打桩，否则页面停在 loading，图表根本不渲染
    await send('Page.addScriptToEvaluateOnNewDocument', { source: LIFE_STUB });

    const openPage = async (url) => {
      await send('Page.navigate', { url });
      await sleep(1200);
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
        for (let i = 0; i < 50; i++) {
          const gone = await evalJs("(function () { var b = document.querySelector('.brand'); return !b || b.classList.contains('is-gone'); })()");
          if (gone) break;
          await sleep(200);
        }
      }
      await sleep(3200);
    };

    const result = await fn({ send, evalJs, shot, sleep, openPage, errors, width, height });
    ws.close();
    return result;
  } finally {
    child.kill();
    await sleep(300);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

// LIFE 的接口：只要 days 数组能算出柱线就行，内容越简单越好
const LIFE_DAYS = (() => {
  const out = [];
  for (let back = 29; back >= 0; back -= 1) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - back);
    out.push({
      v: 1,
      day: dayKey(d),
      trackedHours: 4,
      categories: { Work: 4, Study: 0, Life: 0, Transport: 0, Leisure: 0, Health: 0, Social: 0, Other: 0 },
      dimensions: { Work: 4, Study: 0, Life: 0, Transport: 0, Leisure: 0, Health: 0, Social: 0 },
      topApps: [['VS Code', 4]],
      topSites: [['github.com', 30]],
      health: { steps: 6000 },
      collapsedHours: 4,
      location: { city: 'Shanghai', stayMinutes: 600, points: 100 },
      phone: { unlocks: 40, screenMinutes: 200 },
    });
  }
  return out;
})();

const LIFE_STUB = `(() => {
  var orig = window.fetch;
  var FULL = ${JSON.stringify(JSON.stringify({
    v: 1,
    updatedAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    days: LIFE_DAYS,
  }))};
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    function json(body, status) {
      return Promise.resolve(new Response(body, {
        status: status || 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (url.indexOf('/api/life/raw/index') >= 0) return json(JSON.stringify({ kinds: {}, watchDays: [] }));
    if (url.indexOf('/api/life/now') >= 0) {
      return json(JSON.stringify({
        v: 1,
        ts_utc: new Date().toISOString(),
        location: { mode: 'stationary', city: 'Shanghai', district: 'Qingpu', stayMinutes: 120, lastSeen: new Date().toISOString(), stale: false },
        desktop: { running: true, afk: false, app: 'VS Code', category: 'Work' },
        phone: { screenOn: true, app: 'WeChat' },
      }));
    }
    var ev = url.match(/\\/api\\/life\\/raw\\/events\\/([^/?]+)/);
    if (ev) return json(JSON.stringify({ id: decodeURIComponent(ev[1]), data: [] }));
    if (url.indexOf('/api/life/raw/watch/') >= 0) return json(JSON.stringify({ data: { events: [] } }));
    if (url.indexOf('/api/life') >= 0) return json(FULL);
    if (url.indexOf('/api/track') >= 0) return json(JSON.stringify({ ok: true }));
    return orig.apply(this, arguments);
  };
})();`;

const GH_STATE = `(function () {
  var gh = document.querySelector('.gh');
  if (!gh) return JSON.stringify({ found: false });
  var grid = gh.querySelector('.gh-grid');
  var stats = Array.prototype.map.call(gh.querySelectorAll('.gh-stat'), function (s) {
    return (s.querySelector('em') || {}).textContent + '=' + (s.querySelector('b') || {}).textContent;
  });
  var levels = {};
  if (grid) {
    Array.prototype.forEach.call(grid.querySelectorAll('.gh-cell'), function (c) {
      var lvl = (c.className.match(/lvl-(\\d)/) || [])[1];
      levels['lvl' + lvl] = (levels['lvl' + lvl] || 0) + 1;
    });
  }
  return JSON.stringify({
    found: true,
    tile: gh.classList.contains('is-tile'),
    panel: gh.classList.contains('is-panel'),
    head: (gh.querySelector('.stats-panel-head') || {}).textContent?.replace(/\\s+/g, ' ').trim() || '',
    stats: stats,
    cells: grid ? grid.querySelectorAll('.gh-cell').length : 0,
    future: grid ? grid.querySelectorAll('.gh-cell.is-future').length : 0,
    today: grid ? grid.querySelectorAll('.gh-cell.is-today').length : 0,
    levels: levels,
    weekdays: gh.querySelectorAll('.gh-days span').length,
    months: gh.querySelectorAll('.gh-months span').length,
    rowCount: grid ? grid.querySelectorAll('.gh-cell').length : 0,
    repos: Array.prototype.map.call(gh.querySelectorAll('.gh-repo'), function (r) {
      return (r.querySelector('.life-name') || {}).textContent;
    }),
    empty: !!gh.querySelector('.gh-empty'),
    retry: !!gh.querySelector('.gh-retry'),
    foot: (gh.querySelector('.gh-foot') || {}).textContent?.replace(/\\s+/g, ' ').trim() || '',
    fetches: Number(localStorage.getItem('__ghFetches') || 0),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  });
})()`;

const FEED_ORDER = `(function () {
  var gh = document.querySelector('.gh.is-panel');
  var idx = gh ? (gh.querySelector('.stats-panel-index') || {}).textContent : '';
  var archive = document.querySelector('.life-archive-panel');
  var archiveIndex = archive ? (archive.querySelector('.stats-panel-index') || {}).textContent : '';
  return JSON.stringify({
    ghIndex: idx,
    archiveIndex: archiveIndex,
    ghBeforeArchive: !!(gh && archive && (gh.compareDocumentPosition(archive) & Node.DOCUMENT_POSITION_FOLLOWING)),
  });
})()`;

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const EXPECTED_FUTURE = WEEKS * 7 - PAST_DAYS.length;
// 打桩把整份事件都塞在第 1 页；超过 100 条时组件会再翻一页，拿到空数组后停
const EXPECTED_PAGES = EVENTS.length >= 100 ? 2 : 1;
const EXPECTED_REPOS = 2;

// ---------- 桌面：仪表盘 ----------
console.log('GITHUB ACTIVITY · dashboard');
await withPage({ width: 1440, height: 1000, label: 'dash' }, async ({ evalJs, shot, sleep, openPage, errors }) => {
  await openPage(new URL('/life?view=dashboard', APP).href);
  await sleep(800);

  let state = JSON.parse(await evalJs(GH_STATE));
  console.log('  state:', {
    stats: state.stats,
    cells: state.cells,
    future: state.future,
    levels: state.levels,
    repos: state.repos?.length,
    fetches: state.fetches,
    overflow: state.overflow,
  });

  assert(state.found, 'github panel missing in dashboard');
  assert(state.tile, 'dashboard instance should use the tile variant');
  assert(/GITHUB ACTIVITY/.test(state.head), 'panel head missing title');
  assert(state.cells === WEEKS * 7, `expected ${WEEKS * 7} cells, got ${state.cells}`);
  assert(state.future === EXPECTED_FUTURE, `expected ${EXPECTED_FUTURE} future cells, got ${state.future}`);
  assert(state.today === 1, `expected exactly one today cell, got ${state.today}`);
  assert(state.weekdays === 7, `expected 7 weekday labels, got ${state.weekdays}`);
  assert(state.months >= 2, `expected month ticks, got ${state.months}`);
  assert(state.levels.lvl0 === EXPECTED_FUTURE + (EXPECT.windowDays - EXPECT.activeDays), `level 0 cells wrong: ${JSON.stringify(state.levels)}`);
  assert(state.levels.lvl1 + state.levels.lvl2 + state.levels.lvl3 + state.levels.lvl4 === EXPECT.activeDays, `level 1-4 cells should add up to ${EXPECT.activeDays}: ${JSON.stringify(state.levels)}`);
  assert(EXPECT_LEVELS && state.levels.lvl4 > 0, 'no level-4 cells (busiest days)');
  assert(state.repos.length === EXPECTED_REPOS, `expected ${EXPECTED_REPOS} repos, got ${state.repos.length}`);
  assert(state.stats.length === 4, `tile should show 4 stats, got ${state.stats.length}`);
  assert(state.stats.some((s) => s === `COMMITS=${EXPECT.commits.toLocaleString('en-US')}`), `commits stat wrong: ${state.stats.join(' | ')}`);
  assert(state.stats.some((s) => s === `EVENTS=${EXPECT.events.toLocaleString('en-US')}`), `events stat wrong: ${state.stats.join(' | ')}`);
  assert(state.overflow <= 1, `dashboard horizontal overflow ${state.overflow}px`);
  assert(state.fetches === EXPECTED_PAGES, `expected ${EXPECTED_PAGES} GitHub requests, got ${state.fetches}`);

  // 悬停一个格子：读数行显示当天明细
  await evalJs(`(function () {
    var cells = Array.prototype.filter.call(document.querySelectorAll('.gh .gh-cell'), function (c) {
      return !c.classList.contains('is-future') && !c.classList.contains('lvl-0');
    });
    cells[0].dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
  })()`);
  await sleep(300);
  const readout = await evalJs("(document.querySelector('.gh .gh-readout') || {}).textContent.replace(/\\s+/g, ' ').trim()");
  assert(/COMMITS/.test(readout) && /PRs/.test(readout), `hover readout missing detail: ${readout}`);
  console.log('  readout:', readout);

  await evalJs("(function () { var el = document.querySelector('.gh'); window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: 'instant' }); })()");
  await sleep(500);
  await shot('tile');

  // 切到长页：同一个组件换 variant，缓存还在，不应该再请求
  await evalJs("Array.from(document.querySelectorAll('.life-view-option')).find(function (b) { return b.textContent.trim() === 'FEED'; }).click()");
  await sleep(1000);
  state = JSON.parse(await evalJs(GH_STATE));
  assert(state.panel, 'feed instance should use the panel variant');
  assert(state.stats.length === 6, `feed panel should show 6 stats, got ${state.stats.length}`);
  assert(state.cells === WEEKS * 7, `feed panel expected ${WEEKS * 7} cells, got ${state.cells}`);
  assert(state.stats.some((s) => s === `ACTIVE DAYS=${EXPECT.activeDays}`), `active days stat wrong: ${state.stats.join(' | ')}`);
  assert(state.stats.some((s) => s === `STREAK=${EXPECT.streak}D`), `streak stat wrong: ${state.stats.join(' | ')}`);
  assert(state.fetches === EXPECTED_PAGES, `switching views should reuse the cache, fetch count ${state.fetches}`);

  const order = JSON.parse(await evalJs(FEED_ORDER));
  console.log('  feed order:', order);
  assert(order.ghBeforeArchive, 'GITHUB panel should sit before THE ARCHIVE');
  assert(order.ghIndex === '08', `github panel index should be 08, got ${order.ghIndex}`);
  assert(order.archiveIndex === '09', `archive panel index should be 09, got ${order.archiveIndex}`);

  await evalJs("(function () { var el = document.querySelector('.gh'); window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: 'instant' }); })()");
  await sleep(600);
  await shot('feed');

  // 浅色主题看一眼格子深浅还能分得开
  await evalJs("document.querySelector('.theme-toggle')?.click()");
  await sleep(700);
  await shot('feed-light');
  await evalJs("document.querySelector('.theme-toggle')?.click()");
  await sleep(500);

  // 刷新：localStorage 里的缓存还没过期，不应该重新请求
  await openPage(new URL('/life', APP).href);
  await sleep(600);
  const afterReload = await evalJs("Number(localStorage.getItem('__ghFetches') || 0)");
  assert(afterReload === EXPECTED_PAGES, `reload inside the 10 min TTL should not refetch, got ${afterReload}`);
  const cached = JSON.parse(await evalJs(GH_STATE));
  assert(cached.found && cached.cells === WEEKS * 7, 'cached panel did not render after reload');

  assert(errors.length === 0, `console errors: ${errors.join(' | ')}`);
});

// ---------- 手机 ----------
console.log('GITHUB ACTIVITY · mobile');
await withPage({ width: 390, height: 844, mobile: true, label: 'mob' }, async ({ evalJs, shot, sleep, openPage, errors }) => {
  await openPage(new URL('/life?view=dashboard', APP).href);
  await sleep(800);
  const state = JSON.parse(await evalJs(GH_STATE));
  console.log('  state:', { cells: state.cells, overflow: state.overflow, repos: state.repos?.length });
  assert(state.found, 'github panel missing on mobile');
  assert(state.cells === WEEKS * 7, `mobile expected ${WEEKS * 7} cells, got ${state.cells}`);
  assert(state.overflow <= 1, `mobile horizontal overflow ${state.overflow}px`);
  await evalJs("(function () { var el = document.querySelector('.gh'); window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: 'instant' }); })()");
  await sleep(900);
  await shot('mobile');
  assert(errors.length === 0, `console errors: ${errors.join(' | ')}`);
});

// ---------- 接口失败：没有缓存时显示 RETRY ----------
console.log('GITHUB ACTIVITY · failure');
await withPage({ width: 1440, height: 1000, label: 'fail', mode: 'fail' }, async ({ evalJs, shot, sleep, openPage, errors }) => {
  await openPage(new URL('/life?view=dashboard', APP).href);
  await sleep(800);
  const state = JSON.parse(await evalJs(GH_STATE));
  console.log('  state:', { empty: state.empty, retry: state.retry, fetches: state.fetches });
  assert(state.found, 'github panel missing when the API fails');
  assert(state.empty, 'failed fetch should render the empty state');
  assert(state.retry, 'empty state should offer RETRY');
  assert(state.fetches === 1, `expected a single attempt, got ${state.fetches}`);
  await evalJs("(function () { var el = document.querySelector('.gh'); window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: 'instant' }); })()");
  await sleep(400);
  await shot('fail');
  assert(errors.length === 0, `console errors: ${errors.join(' | ')}`);

  // 退避期内点 RETRY 会强制重来一次；仍然 403，不应该抛未捕获异常
  await evalJs("document.querySelector('.gh-retry').click()");
  await sleep(600);
  const again = JSON.parse(await evalJs(GH_STATE));
  assert(again.empty && again.fetches === 2, `retry should issue one more request, got ${again.fetches}`);
  assert(errors.length === 0, `console errors after retry: ${errors.join(' | ')}`);
});

console.log('done');
