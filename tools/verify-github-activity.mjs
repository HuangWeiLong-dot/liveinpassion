// GITHUB ACTIVITY 板块验收：LIFE 长页（panel）与仪表盘（tile）两处都出现，
// 贡献格子图（年初至今，周一对齐）、合计数字、仓库排行、缓存命中、
// 贡献蛇的推进 / 悬停暂停 / reduced-motion 停用、接口失败时的降级、手机不横向溢出。
//
//   cd app && npx vite preview --port 4174 --strictPort
//   node tools/verify-github-activity.mjs http://127.0.0.1:4174/
//
// 两个接口在页面脚本之前打桩：
//  - github-contributions-api.jogruber.de → 整年的日历（count + level）
//  - api.github.com → 最近 80 天的事件流；'fail' 模式返回 403
// 请求次数存在 localStorage，跨导航可以累计（window 上的计数每次导航都会重置）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = process.argv[2] || 'http://127.0.0.1:4174/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 固定的日历 + 事件流 ----------
// 和 useGithubActivity 一样对齐：从 1 月 1 日那一周的周一开始，到本周为止。
const WEEKS = 12; // 日历拿不到时的兜底宽度
const DAY = 86400000;
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
const YEAR = TODAY.getFullYear();
const JAN1 = new Date(YEAR, 0, 1);

const mondayOf = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};
const pad2 = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const START = mondayOf(JAN1);
const WEEKS_TOTAL = Math.round((mondayOf(TODAY) - START) / DAY / 7) + 1;
const GRID_DAYS = [];
for (let i = 0; i < WEEKS_TOTAL * 7; i++) {
  const d = new Date(START);
  d.setDate(START.getDate() + i);
  d.setHours(0, 0, 0, 0);
  GRID_DAYS.push(d);
}

const LIVE = GRID_DAYS.filter((d) => d >= JAN1 && d <= TODAY);
const EXPECTED_FUTURE = GRID_DAYS.filter((d) => d > TODAY).length;
const EXPECTED_OUTSIDE = GRID_DAYS.filter((d) => d < JAN1).length;

// 每天贡献数：周日休息，其余按一个固定节奏起伏（0 / 2 / 4 / 7 / 12）
const levelOf = (count) => (count === 0 ? 0 : count <= 2 ? 1 : count <= 4 ? 2 : count <= 7 ? 3 : 4);
const CONTRIB = new Map();
for (let k = 0; k < LIVE.length; k++) {
  const d = LIVE[k];
  let count = 0;
  if (d.getDay() !== 0) {
    const roll = (k * 7 + 3) % 10;
    count = roll < 2 ? 0 : roll < 5 ? 2 : roll < 7 ? 4 : roll < 9 ? 7 : 12;
  }
  CONTRIB.set(dayKey(d), { count, level: levelOf(count) });
}

// 日历接口覆盖整年（未来那些天 count 0），和真实接口一样
const CALENDAR = [];
for (let d = new Date(JAN1); d.getFullYear() === YEAR; d.setDate(d.getDate() + 1)) {
  const key = dayKey(d);
  const entry = CONTRIB.get(key) || { count: 0, level: 0 };
  CALENDAR.push({ date: key, count: entry.count, level: entry.level });
}

// 事件流只覆盖最近 80 天（公开事件接口的上限）
const EVENT_FROM = new Date(TODAY);
EVENT_FROM.setDate(EVENT_FROM.getDate() - 80);
const EVENT_DAYS = LIVE.filter((d) => d >= EVENT_FROM);

const EVENTS = [];
const EXPECT = { commits: 0, pushes: 0, prs: 0, issues: 0, other: 0 };
EVENT_DAYS.forEach((date, n) => {
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

  if (n % 2 === 0) {
    EVENTS.push({
      id: `${key}-pr`,
      type: 'PullRequestEvent',
      repo: { name: 'HuangWeiLong-dot/LifeLogging' },
      created_at: at.toISOString(),
      payload: { action: 'opened' },
    });
    EXPECT.prs += 1;
  }

  if (n % 5 === 0) {
    EVENTS.push({
      id: `${key}-issue`,
      type: 'IssuesEvent',
      repo: { name: 'HuangWeiLong-dot/LifeLogging' },
      created_at: at.toISOString(),
      payload: { action: 'opened' },
    });
    EXPECT.issues += 1;
  }

  if (n % 4 === 0) {
    EVENTS.push({
      id: `${key}-watch`,
      type: 'WatchEvent',
      repo: { name: 'HuangWeiLong-dot/LifeLogging' },
      created_at: at.toISOString(),
      payload: { action: 'started' },
    });
    EXPECT.other += 1;
  }
});
EVENTS.reverse(); // 接口是新的在前

EXPECT.events = EXPECT.pushes + EXPECT.prs + EXPECT.issues + EXPECT.other;
EXPECT.windowDays = LIVE.length;
EXPECT.contributions = LIVE.reduce((n, d) => n + CONTRIB.get(dayKey(d)).count, 0);

// 有日历贡献，或者有公开事件（事件可能落在日历为 0 的那天）才算「活跃日」——
// 和组件里 isActive 的判断一致
const EVENT_KEYS = new Set(EVENT_DAYS.map(dayKey));
const isActiveDay = (d) => CONTRIB.get(dayKey(d)).count > 0 || EVENT_KEYS.has(dayKey(d));
EXPECT.activeDays = LIVE.filter(isActiveDay).length;
EXPECT.contribDays = LIVE.filter((d) => CONTRIB.get(dayKey(d)).count > 0).length;

// 连续天数：今天没活动就从昨天起算（和组件里的口径一致）
EXPECT.streak = (() => {
  let cursor = LIVE.length - 1;
  if (cursor >= 0 && !isActiveDay(LIVE[cursor])) cursor -= 1;
  let n = 0;
  while (cursor >= 0 && isActiveDay(LIVE[cursor])) {
    n += 1;
    cursor -= 1;
  }
  return n;
})();

// 每一档的格子数（0 档另外还要加上未来和去年那半列）
const EXPECT_LEVELS = { lvl0: 0, lvl1: 0, lvl2: 0, lvl3: 0, lvl4: 0 };
for (const d of LIVE) {
  const { level } = CONTRIB.get(dayKey(d));
  EXPECT_LEVELS[`lvl${level}`] += 1;
}

function stubSource(mode) {
  // mode: 'ok' | 'fail'（两个接口都挂） | 'nocal'（只有日历挂）
  return `(() => {
  var orig = window.fetch;
  var EVENTS = ${JSON.stringify(EVENTS)};
  var CALENDAR = ${JSON.stringify(CALENDAR)};
  var MODE = ${JSON.stringify(mode)};
  function json(body, status) {
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  }
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('github-contributions-api') >= 0) {
      if (MODE === 'fail' || MODE === 'nocal') {
        return json({ message: 'upstream error' }, 502);
      }
      return json({ total: (function () { var t = {}; t[${YEAR}] = ${EXPECT.contributions}; return t; })(), contributions: CALENDAR });
    }
    if (url.indexOf('api.github.com') >= 0) {
      var n = Number(localStorage.getItem('__ghFetches') || 0) + 1;
      localStorage.setItem('__ghFetches', String(n));
      if (MODE === 'fail') {
        return json({ message: 'API rate limit exceeded' }, 403);
      }
      var page = Number((url.match(/[?&]page=(\\d+)/) || [])[1] || 1);
      return json(page === 1 ? EVENTS : []);
    }
    return orig.apply(this, arguments);
  };
})();`;
}

// ---------- CDP ----------
async function withPage({ width, height, mobile, label, mode = 'ok', reducedMotion = false }, fn) {
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
    if (reducedMotion) {
      await send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });
    }
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
  var headIndex = -1;
  var snake = 0;
  var eaten = 0;
  if (grid) {
    Array.prototype.forEach.call(grid.querySelectorAll('.gh-cell'), function (c, i) {
      var lvl = (c.className.match(/lvl-(\\d)/) || [])[1];
      levels['lvl' + lvl] = (levels['lvl' + lvl] || 0) + 1;
      if (c.classList.contains('is-snake')) snake += 1;
      if (c.classList.contains('is-eaten')) eaten += 1;
      if (c.classList.contains('is-snake-head')) headIndex = i;
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
    outside: grid ? grid.querySelectorAll('.gh-cell.is-outside').length : 0,
    today: grid ? grid.querySelectorAll('.gh-cell.is-today').length : 0,
    levels: levels,
    weekdays: gh.querySelectorAll('.gh-days span').length,
    months: gh.querySelectorAll('.gh-months span').length,
    snake: snake,
    snakeHead: headIndex,
    eaten: eaten,
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
    weeks: WEEKS_TOTAL,
    outside: state.outside,
    future: state.future,
    levels: state.levels,
    repos: state.repos?.length,
    fetches: state.fetches,
    overflow: state.overflow,
  });

  assert(state.found, 'github panel missing in dashboard');
  assert(state.tile, 'dashboard instance should use the tile variant');
  assert(/GITHUB ACTIVITY/.test(state.head), 'panel head missing title');
  assert(new RegExp(String(YEAR)).test(state.head), `head should name the year: ${state.head}`);
  assert(state.cells === WEEKS_TOTAL * 7, `expected ${WEEKS_TOTAL * 7} cells, got ${state.cells}`);
  assert(state.outside === EXPECTED_OUTSIDE, `expected ${EXPECTED_OUTSIDE} cells before Jan 1, got ${state.outside}`);
  assert(state.future === EXPECTED_FUTURE, `expected ${EXPECTED_FUTURE} future cells, got ${state.future}`);
  assert(state.today === 1, `expected exactly one today cell, got ${state.today}`);
  assert(state.weekdays === 7, `expected 7 weekday labels, got ${state.weekdays}`);
  assert(state.months >= 5, `expected the chart to span the year (5+ month ticks), got ${state.months}`);
  assert(
    state.levels.lvl0 === EXPECT_LEVELS.lvl0 + EXPECTED_FUTURE + EXPECTED_OUTSIDE,
    `level 0 cells wrong: ${JSON.stringify(state.levels)} vs ${JSON.stringify(EXPECT_LEVELS)}`,
  );
  const activeCells = state.levels.lvl1 + state.levels.lvl2 + state.levels.lvl3 + state.levels.lvl4;
  assert(activeCells === EXPECT.contribDays, `level 1-4 cells should add up to ${EXPECT.contribDays}, got ${activeCells}`);
  for (const key of ['lvl1', 'lvl2', 'lvl3', 'lvl4']) {
    assert(state.levels[key] === EXPECT_LEVELS[key], `${key} count wrong: ${state.levels[key]} vs ${EXPECT_LEVELS[key]}`);
  }
  assert(state.repos.length === EXPECTED_REPOS, `expected ${EXPECTED_REPOS} repos, got ${state.repos.length}`);
  assert(state.stats.length === 4, `tile should show 4 stats, got ${state.stats.length}`);
  assert(state.stats.some((s) => s === `CONTRIBUTIONS=${EXPECT.contributions.toLocaleString('en-US')}`), `contributions stat wrong: ${state.stats.join(' | ')}`);
  assert(state.stats.some((s) => s === `COMMITS ·90D=${EXPECT.commits.toLocaleString('en-US')}`), `commits stat wrong: ${state.stats.join(' | ')}`);
  assert(state.overflow <= 1, `dashboard horizontal overflow ${state.overflow}px`);
  assert(state.fetches === EXPECTED_PAGES, `expected ${EXPECTED_PAGES} GitHub requests, got ${state.fetches}`);

  // 悬停一个格子：读数行显示当天贡献数
  await evalJs(`(function () {
    var cells = Array.prototype.filter.call(document.querySelectorAll('.gh .gh-cell'), function (c) {
      return !c.classList.contains('is-future') && !c.classList.contains('is-outside') && !c.classList.contains('lvl-0');
    });
    cells[0].dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
  })()`);
  await sleep(300);
  const readout = await evalJs("(document.querySelector('.gh .gh-readout') || {}).textContent.replace(/\\s+/g, ' ').trim()");
  assert(/CONTRIBUTIONS/.test(readout), `hover readout missing contributions: ${readout}`);
  console.log('  readout:', readout);

  // ---- 贡献蛇：在爬、悬停时暂停、换页后重新开始 ----
  // 蛇是离屏不跑的，先把面板滚进视口；指针也别停在格子上
  await evalJs("(function () { var el = document.querySelector('.gh'); window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: 'instant' }); })()");
  await evalJs("document.querySelector('.gh .gh-cell')?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))");
  await sleep(900);
  const before = JSON.parse(await evalJs(GH_STATE));
  assert(before.snake > 0, 'snake should be drawn over the grid');
  assert(before.snakeHead >= 0, 'snake should have a head cell');
  await evalJs("document.querySelector('.gh .gh-cell')?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))");
  await sleep(900);
  const moved = JSON.parse(await evalJs(GH_STATE));
  assert(moved.snakeHead !== before.snakeHead, `snake head should advance, stayed at ${before.snakeHead}`);
  assert(moved.eaten >= before.eaten, 'eaten cells should only accumulate within a lap');
  console.log('  snake:', { from: before.snakeHead, to: moved.snakeHead, eaten: moved.eaten });

  // 指针停在格子上 → 暂停
  await evalJs(`(function () {
    var c = document.querySelector('.gh .gh-cell:not(.is-future):not(.is-outside)');
    c.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
  })()`);
  await sleep(200);
  const held = JSON.parse(await evalJs(GH_STATE));
  await sleep(700);
  const stillHeld = JSON.parse(await evalJs(GH_STATE));
  assert(stillHeld.snakeHead === held.snakeHead, `hover should pause the snake (${held.snakeHead} → ${stillHeld.snakeHead})`);
  await evalJs("document.querySelectorAll('.gh .gh-cell.is-snake')[0]?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))");
  await sleep(300);

  await evalJs("(function () { var el = document.querySelector('.gh'); window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: 'instant' }); })()");
  await sleep(500);
  await shot('tile');

  // COLOR 模式不能给 LIFE 整页铺底色（`:global()` 后代选择器踩过这个坑），
  // 格子图本身也保持灰阶
  await evalJs("document.querySelector('.life-color-toggle').click()");
  await sleep(600);
  const colorMode = JSON.parse(await evalJs(`(function () {
    var section = document.querySelector('.life-section');
    var cell = document.querySelector('.gh-cell.lvl-4');
    return JSON.stringify({
      sectionBg: getComputedStyle(section).backgroundColor,
      cellBg: cell ? getComputedStyle(cell).backgroundColor : '',
      isColor: section.classList.contains('is-color'),
    });
  })()`));
  console.log('  color mode:', colorMode);
  assert(colorMode.isColor, 'color toggle did not switch the section class');
  assert(/rgba\(0, 0, 0, 0\)|transparent/.test(colorMode.sectionBg), `LIFE section got a background in color mode: ${colorMode.sectionBg}`);
  const cellRgb = (colorMode.cellBg.match(/rgba?\(([^)]+)\)/) || [])[1] || '';
  const [cr, cg, cb] = cellRgb.split(',').map((x) => parseFloat(x));
  assert(Math.abs(cr - cg) < 6 && Math.abs(cg - cb) < 6, `activity cells should stay greyscale in color mode, got ${colorMode.cellBg}`);
  await evalJs("document.querySelector('.life-color-toggle').click()");
  await sleep(400);

  // 切到长页：同一个组件换 variant，缓存还在，不应该再请求
  await evalJs("Array.from(document.querySelectorAll('.life-view-option')).find(function (b) { return b.textContent.trim() === 'FEED'; }).click()");
  await sleep(1000);
  state = JSON.parse(await evalJs(GH_STATE));
  assert(state.panel, 'feed instance should use the panel variant');
  assert(state.stats.length === 6, `feed panel should show 6 stats, got ${state.stats.length}`);
  assert(state.cells === WEEKS_TOTAL * 7, `feed panel expected ${WEEKS_TOTAL * 7} cells, got ${state.cells}`);
  assert(state.stats.some((s) => s === `ACTIVE DAYS=${EXPECT.activeDays}`), `active days stat wrong: ${state.stats.join(' | ')}`);
  assert(state.stats.some((s) => s === `STREAK=${EXPECT.streak}D`), `streak stat wrong: ${state.stats.join(' | ')}`);
  assert(state.fetches === EXPECTED_PAGES, `switching views should reuse the cache, fetch count ${state.fetches}`);
  assert(state.snake >= 0, 'feed panel should mount the snake');

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
  assert(cached.found && cached.cells === WEEKS_TOTAL * 7, 'cached panel did not render after reload');

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
  assert(state.cells === WEEKS_TOTAL * 7, `mobile expected ${WEEKS_TOTAL * 7} cells, got ${state.cells}`);
  // 一整年的格子塞不进手机屏：格子图自己横向滚，页面不能跟着溢出
  assert(state.overflow <= 1, `mobile horizontal overflow ${state.overflow}px`);
  const scroller = JSON.parse(await evalJs(`(function () {
    var el = document.querySelector('.gh-chart');
    var grid = document.querySelector('.gh-cell');
    return JSON.stringify({
      scrolls: el ? el.scrollWidth > el.clientWidth + 1 : false,
      cell: grid ? Math.round(grid.getBoundingClientRect().width) : 0,
    });
  })()`));
  console.log('  chart:', scroller);
  assert(scroller.scrolls, 'on mobile the year-wide chart should scroll horizontally');
  assert(scroller.cell >= 8, `mobile cells should stay readable, got ${scroller.cell}px`);
  await evalJs("(function () { var el = document.querySelector('.gh'); window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: 'instant' }); })()");
  await sleep(900);
  await shot('mobile');
  assert(errors.length === 0, `console errors: ${errors.join(' | ')}`);
});

// ---------- 日历接口挂了：退回最近 12 周，不清空 ----------
console.log('GITHUB ACTIVITY · calendar unavailable');
await withPage({ width: 1440, height: 1000, label: 'nocal', mode: 'nocal' }, async ({ evalJs, sleep, openPage, errors }) => {
  await openPage(new URL('/life?view=dashboard', APP).href);
  await sleep(800);
  const state = JSON.parse(await evalJs(GH_STATE));
  console.log('  state:', { cells: state.cells, foot: state.foot });
  assert(state.found, 'panel missing when the calendar API fails');
  assert(!state.empty, 'events alone should still render a grid');
  assert(state.cells === WEEKS * 7, `fallback should be ${WEEKS * 7} cells, got ${state.cells}`);
  assert(/CALENDAR UNAVAILABLE/.test(state.foot), `foot should say the calendar failed: ${state.foot}`);
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
  await sleep(700);
  const again = JSON.parse(await evalJs(GH_STATE));
  assert(again.empty && again.fetches === 2, `retry should issue one more request, got ${again.fetches}`);
  assert(errors.length === 0, `console errors after retry: ${errors.join(' | ')}`);
});

// ---------- reduced-motion：蛇完全不动 ----------
console.log('GITHUB ACTIVITY · reduced motion');
await withPage({ width: 1440, height: 1000, label: 'rm', reducedMotion: true }, async ({ evalJs, sleep, openPage, errors }) => {
  await openPage(new URL('/life?view=dashboard', APP).href);
  await sleep(1200);
  const state = JSON.parse(await evalJs(GH_STATE));
  console.log('  state:', { snake: state.snake, eaten: state.eaten, cells: state.cells });
  assert(state.found && state.cells === WEEKS_TOTAL * 7, 'grid should still render under reduced motion');
  assert(state.snake === 0 && state.eaten === 0, `reduced motion should not draw the snake (snake=${state.snake}, eaten=${state.eaten})`);
  assert(errors.length === 0, `console errors: ${errors.join(' | ')}`);
});

console.log('done');
