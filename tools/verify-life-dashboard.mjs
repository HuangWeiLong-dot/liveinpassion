// LIFE 仪表盘视图验收：FEED / DASHBOARD 切换、12 列板子的内容、
// 点图表仍然开原来的弹窗、刷新后记住选择、手机不横向溢出。
//
//   cd app && npx vite preview --port 4174 --strictPort
//   node tools/verify-life-dashboard.mjs http://127.0.0.1:4174/
//
// /api/life、/api/life/now、raw 全部在页面脚本之前打桩，本机不用连 CMS。
// 截图写到临时目录并打印路径。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = process.argv[2] || 'http://127.0.0.1:4174/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 固定数据 ----------
const CATS = ['Work', 'Study', 'Life', 'Transport', 'Leisure', 'Health', 'Social', 'Other'];
const SHANGHAI_TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const END = new Date(`${SHANGHAI_TODAY}T12:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);

function buildDays() {
  const days = [];
  for (let back = 20; back >= 0; back -= 1) {
    const day = iso(new Date(END.getTime() - back * 86400000));
    const idx = 20 - back;
    if (idx === 6) continue; // 中间缺一天

    const categories = {
      Work: Number((2.4 + (idx % 5) * 0.7).toFixed(2)),
      Study: idx % 3 === 0 ? 0.5 : 0,
      Life: 0.8,
      Transport: idx % 4 === 0 ? 0.3 : 0,
      Leisure: Number((1.1 + (idx % 4) * 0.3).toFixed(2)),
      Health: 0,
      Social: 0,
      Other: 0.1,
    };
    const trackedHours = Number(Object.values(categories).reduce((a, b) => a + b, 0).toFixed(2));
    const dimensions = {
      Work: categories.Work,
      Study: categories.Study,
      Transport: idx % 4 === 0 ? 1.2 : 0.4,
      Leisure: categories.Leisure,
      Health: 0.3,
      Life: categories.Life,
      Social: 0.5,
    };

    const steps = idx === 9 ? null : 5200 + ((idx * 937) % 9000);
    const phone = idx === 11 ? null : {
      unlocks: 42 + idx * 3,
      screenOn: 60 + idx,
      screenOff: 58 + idx,
      screenMinutes: 210 + idx * 4,
      appSwitches: 180 + idx * 5,
      topApps: [['WeChat', 60 + idx], ['DeepSeek', 20 + idx * 2]],
    };

    let ai = null;
    if (idx !== 12) {
      const cost = Number((1.5 + (idx % 9) * 0.7).toFixed(2));
      const platform = idx % 3 === 0;
      ai = {
        cost,
        costSource: platform ? 'platform' : 'claude-estimate',
        dailyCost: 0.1,
        spend: platform ? cost : null,
        estimatedCost: platform ? null : cost,
        calls: 10 + idx,
        callsSource: platform ? 'platform' : 'claude-estimate',
        models: platform ? [['deepseek-chat', Number((cost * 0.7).toFixed(2))]] : [],
        projects: platform ? [] : [['app', Number((cost * 0.6).toFixed(2))]],
      };
    }

    days.push({
      v: 1,
      day,
      categories,
      trackedHours,
      dimensions,
      topApps: [
        ['VS Code', Number((categories.Work * 0.6).toFixed(2))],
        ['Edge', Number((categories.Work * 0.4).toFixed(2))],
        ['WeChat', 0.6],
      ],
      topSites: [['chat.deepseek.com', 120 + idx], ['github.com', 40 + idx]],
      health: {
        steps,
        hrAvg: 70 + (idx % 20),
        hrMin: 55,
        hrMax: 145 + (idx % 20),
        runs: idx % 5 === 0 ? 1 : 0,
        runKm: idx % 5 === 0 ? 5.06 : 0,
        runMinutes: idx % 5 === 0 ? 29.6 : 0,
        runPaceS: idx % 5 === 0 ? 351 : null,
        vo2max: 45.8,
      },
      workouts: idx % 5 === 0 ? [{
        start: `${day}T10:00:00Z`,
        end: `${day}T10:30:00Z`,
        name: 'Running',
        kind: null,
        minutes: 29.6,
        km: 5.06,
        avgHr: 162,
        maxHr: 176,
        paceS: 351,
        ascentM: 20,
        calories: 271,
        vo2max: 45.8,
        trainingEffect: 3.2,
        recoveryHours: 24,
      }] : null,
      allTime: {
        runs: 87,
        km: 312.5,
        bestPaceS: 210,
        bestPaceKm: 0.8,
        bestPaceName: 'Running',
        bestPaceDay: '2026-09-01',
        longestKm: 12.4,
        longestDay: day,
        longestName: 'Long Run',
      },
      collapsedHours: Number((dimensions.Work + dimensions.Study + dimensions.Life
        + dimensions.Leisure + dimensions.Transport + dimensions.Health).toFixed(2)),
      location: {
        city: 'Shanghai',
        movingMinutes: 40 + idx,
        inferredMinutes: 20,
        transitMinutes: 60 + idx,
        stayMinutes: 600 + idx * 5,
        spanKm: 18.4,
        points: 480,
        districts: [['Qingpu', 6.2], ['Changning', 2.1]],
      },
      phone,
      ai,
    });
  }
  return days;
}

const DAYS = buildDays();
// rows 会把中间缺的那天补成 missing 柱，所以列数是「最早→最新」的跨度，不是有效天数。
const SPAN_DAYS = 21;
const FULL = JSON.stringify({
  v: 1,
  updatedAt: new Date().toISOString(),
  timezone: 'Asia/Shanghai',
  days: DAYS,
});

function rawIndex() {
  const ids = DAYS.map((d) => d.day);
  const kinds = {};
  ['journal', 'notes', 'tasks', 'qa', 'events', 'blocks', 'weekly', 'vault'].forEach((k) => {
    kinds[k] = ids.map((id) => ({ id }));
  });
  return { kinds, watchDays: [] };
}

function rawEvents(day) {
  return {
    id: day,
    data: [
      {
        ts_utc: `${day}T00:00:00Z`,
        domain: 'location',
        metric: 'track_path',
        value_num: 300,
        value_text: '',
        source: 'dawarich',
        meta: { path: [[31.1567, 121.1027], [31.16, 121.11], [31.17, 121.12]] },
      },
      {
        ts_utc: `${day}T00:00:00Z`,
        domain: 'location',
        metric: 'visit',
        value_num: 320,
        value_text: '',
        source: 'dawarich',
        meta: { lat: 31.1567, lon: 121.1027, place: 'Qingpu, Shanghai' },
      },
      {
        ts_utc: `${day}T00:00:00Z`,
        domain: 'location',
        metric: 'transport',
        value_num: 25,
        value_text: 'walking',
        source: 'dawarich',
        meta: {},
      },
      {
        ts_utc: `${day}T10:00:00Z`,
        domain: 'fitness',
        metric: 'watch_track',
        value_num: 25,
        value_text: 'test.gpx',
        source: 'gadgetbridge-gpx',
        meta: {
          path: [[31.1567, 121.1027], [31.16, 121.11], [31.17, 121.12]],
          distance_km: 2.2,
          start_utc: `${day}T10:00:00Z`,
          end_utc: `${day}T10:25:00Z`,
        },
      },
    ],
  };
}

// ---------- 注入脚本（页面脚本之前执行） ----------
const STUB = `(() => {
  var orig = window.fetch;
  function jsonResponse(body) {
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  }
  var FULL = ${JSON.stringify(FULL)};
  var RAW_INDEX = ${JSON.stringify(JSON.stringify(rawIndex()))};
  window.__lifeFetches = 0;

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/life/raw/index') >= 0) return jsonResponse(JSON.parse(RAW_INDEX));
    if (url.indexOf('/api/life/now') >= 0) {
      var nowIso = new Date().toISOString();
      return jsonResponse({
        v: 1,
        ts_utc: nowIso,
        location: {
          mode: 'stationary', district: 'Qingpu', city: 'Shanghai', area: 'Yingpu',
          lat: 31.15665, lon: 121.10278, stayMinutes: 320,
          lastSeen: nowIso, stale: false,
        },
        desktop: { running: true, afk: false, app: 'VS Code', category: 'Work', title: 'LifeView.vue', since: '20:10', lastSeen: nowIso },
        phone: { screenOn: true, app: 'WeChat', unlocks: 87, lastSeen: nowIso },
        qa: { ts: nowIso, question: 'What are you building?', answer: 'A quieter dashboard for the same life.' },
      });
    }
    var ev = url.match(/\\/api\\/life\\/raw\\/events\\/([^/?]+)/);
    if (ev) {
      var day = decodeURIComponent(ev[1]);
      return jsonResponse({
        id: day,
        data: [
          {
            ts_utc: day + 'T00:00:00Z', domain: 'location', metric: 'track_path',
            value_num: 300, value_text: '', source: 'dawarich',
            meta: { path: [[31.1567, 121.1027], [31.16, 121.11], [31.17, 121.12]] },
          },
          {
            ts_utc: day + 'T10:00:00Z', domain: 'fitness', metric: 'watch_track',
            value_num: 25, value_text: 'test.gpx', source: 'gadgetbridge-gpx',
            meta: {
              path: [[31.1567, 121.1027], [31.16, 121.11], [31.17, 121.12]],
              distance_km: 2.2,
              start_utc: day + 'T10:00:00Z',
              end_utc: day + 'T10:25:00Z',
            },
          },
        ],
      });
    }
    if (url.indexOf('/api/life/raw/watch/') >= 0) return jsonResponse({ data: { events: [] } });
    if (url.indexOf('/api/life') >= 0) {
      window.__lifeFetches++;
      return Promise.resolve(new Response(FULL, { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (url.indexOf('/api/track') >= 0) {
      return jsonResponse({ ok: true, sid: 'verify-life-dashboard' });
    }
    return orig.apply(this, arguments);
  };
})();`;

// ---------- CDP ----------
async function withPage({ width, height, mobile, label }, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-dash-'));
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
      const out = path.join(os.tmpdir(), `life-dash-${label}-${name}.png`);
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
    await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });

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
        await sleep(3200);
      } else {
        await sleep(2400);
      }
    };

    const result = await fn({
      send, evalJs, shot, sleep, openPage, errors, width, height,
    });
    ws.close();
    return result;
  } finally {
    child.kill();
    await sleep(300);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

const DASH_STATE = `(function () {
  var q = function (s) { return document.querySelectorAll(s); };
  var dash = document.querySelector('.life-dash');
  var rhythm = dash ? dash.querySelector('.dash-rhythm') : null;
  var minis = q('.life-dash .dash-mini-chart');
  return JSON.stringify({
    path: location.pathname + location.search,
    dash: !!dash,
    feed: (function () { var n = document.querySelector('.life-now'); return !!n && n.offsetParent !== null; })(),
    tiles: q('.life-dash .dash-tile').length,
    kpis: q('.life-dash .stat-card').length,
    radar: q('.life-dash .life-radar-svg').length,
    radarRows: q('.life-dash .life-radar-row').length,
    rhythmCols: rhythm ? rhythm.querySelectorAll('.life-col').length : 0,
    rhythmSegs: rhythm ? rhythm.querySelectorAll('.life-seg').length : 0,
    minis: minis.length,
    miniCols: Array.prototype.map.call(minis, function (m) { return m.querySelectorAll('.life-col').length; }),
    weekdayRows: q('.life-dash .life-weekday-row').length,
    archiveLinks: q('.life-dash .dash-archive-link').length,
    nowText: (document.querySelector('.life-dash .dash-now') || {}).textContent?.replace(/\\s+/g, ' ').trim() || '',
    todayText: (document.querySelector('.life-dash .dash-today') || {}).textContent?.replace(/\\s+/g, ' ').trim() || '',
    runText: (document.querySelector('.life-dash .dash-run') || {}).textContent?.replace(/\\s+/g, ' ').trim() || '',
    stored: localStorage.getItem('lifeViewMode'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  });
})()`;

const FEED_STATE = `(function () {
  var q = function (s) { return document.querySelectorAll(s); };
  return JSON.stringify({
    path: location.pathname + location.search,
    dash: !!document.querySelector('.life-dash'),
    feed: (function () { var n = document.querySelector('.life-now'); return !!n && n.offsetParent !== null; })(),
    cards: q('.stat-card').length,
    panels: q('.life-panel').length,
    stored: localStorage.getItem('lifeViewMode'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  });
})()`;

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

// ---------- 桌面：默认进仪表盘 ----------
console.log('LIFE dashboard · desktop');
await withPage({ width: 1440, height: 1000, label: 'desk' }, async ({
  evalJs, shot, sleep, openPage, errors,
}) => {
  await openPage(new URL('/life?view=dashboard', APP).href);
  const state = JSON.parse(await evalJs(DASH_STATE));
  console.log('  state:', {
    tiles: state.tiles,
    kpis: state.kpis,
    rhythmCols: state.rhythmCols,
    minis: state.minis,
    stored: state.stored,
    overflow: state.overflow,
  });

  assert(state.dash, 'dashboard grid missing');
  assert(!state.feed, 'feed content still mounted in dashboard mode');
  assert(state.tiles >= 10, `expected >= 10 tiles, got ${state.tiles}`);
  assert(state.kpis === 6, `expected 6 KPI cards, got ${state.kpis}`);
  assert(state.radar === 1, 'radar svg missing');
  assert(state.rhythmCols === SPAN_DAYS, `expected ${DAYS.length} rhythm columns, got ${state.rhythmCols}`);
  assert(state.rhythmSegs > 0, 'rhythm segments missing');
  assert(state.minis === 3, `expected 3 mini charts, got ${state.minis}`);
  assert(state.miniCols.every((n) => n === SPAN_DAYS), `mini charts should have ${DAYS.length} columns, got ${state.miniCols.join(',')}`);
  assert(state.weekdayRows === 7, `expected 7 weekday rows, got ${state.weekdayRows}`);
  assert(state.archiveLinks === 8, `expected 8 archive links, got ${state.archiveLinks}`);
  assert(state.overflow <= 1, `desktop horizontal overflow ${state.overflow}px`);
  assert(/Qingpu/.test(state.nowText), 'NOW tile missing live location');
  assert(/DESKTOP/.test(state.todayText), 'TODAY tile missing desktop total');
  assert(/KM/.test(state.runText), 'LATEST RUN tile missing distance');

  await shot('top');
  await evalJs('window.scrollTo({ top: 700, behavior: "instant" })');
  await sleep(500);
  await shot('mid');
  await evalJs('window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" })');
  await sleep(600);
  await shot('bottom');

  // 点节奏图的一根柱子：应该打开原来的单日弹窗
  await evalJs('window.scrollTo({ top: 0, behavior: "instant" })');
  await sleep(300);
  await evalJs("document.querySelector('.life-dash .dash-rhythm .life-col').click()");
  await sleep(500);
  const modal = await evalJs(`(function () {
    var m = document.querySelector('.life-day-modal');
    return m ? m.textContent.replace(/\\s+/g, ' ').trim().slice(0, 80) : '';
  })()`);
  assert(modal.length > 0, 'clicking a rhythm column did not open the day modal');
  console.log('  day modal:', modal);
  await evalJs("document.querySelector('.life-day-close').click()");
  await sleep(400);

  // 切回 FEED
  await evalJs("Array.from(document.querySelectorAll('.life-view-option')).find(function (b) { return b.textContent.trim() === 'FEED'; }).click()");
  await sleep(900);
  const feed = JSON.parse(await evalJs(FEED_STATE));
  console.log('  feed state:', feed);
  assert(!feed.dash, 'dashboard still mounted after switching to FEED');
  assert(feed.feed, 'feed (LifeNow) missing after switching to FEED');
  assert(feed.cards === 6, `expected 6 KPI cards in feed, got ${feed.cards}`);
  assert(feed.panels >= 8, `expected >= 8 panels in feed, got ${feed.panels}`);
  assert(!/view=dashboard/.test(feed.path), 'URL still carries ?view=dashboard in FEED mode');
  assert(feed.stored === 'feed', `localStorage should be feed, got ${feed.stored}`);
  await shot('feed');

  // 再切回 DASHBOARD
  await evalJs("Array.from(document.querySelectorAll('.life-view-option')).find(function (b) { return b.textContent.trim() === 'DASHBOARD'; }).click()");
  await sleep(900);
  const back = JSON.parse(await evalJs(DASH_STATE));
  assert(back.dash && !back.feed, 'switching back to DASHBOARD failed');
  assert(/view=dashboard/.test(back.path), 'URL should carry ?view=dashboard');
  assert(back.stored === 'dashboard', `localStorage should be dashboard, got ${back.stored}`);

  // 刷新：应该记住仪表盘
  await openPage(new URL('/life', APP).href);
  const reload = JSON.parse(await evalJs(DASH_STATE));
  assert(reload.dash && !reload.feed, 'dashboard preference was not remembered after reload');
  assert(reload.stored === 'dashboard', 'localStorage lost after reload');

  if (errors.length) throw new Error(`console errors: ${errors.join(' | ')}`);
});

// ---------- 浅色 ----------
console.log('LIFE dashboard · light theme');
await withPage({ width: 1440, height: 1000, label: 'light' }, async ({ evalJs, shot, sleep, openPage }) => {
  await openPage(new URL('/life?view=dashboard', APP).href);
  await evalJs("document.documentElement.classList.remove('dark')");
  await sleep(400);
  await shot('top');
  await evalJs('window.scrollTo({ top: 800, behavior: "instant" })');
  await sleep(500);
  await shot('mid');
});

// ---------- 手机 ----------
console.log('LIFE dashboard · mobile');
await withPage({ width: 390, height: 844, mobile: true, label: 'mobile' }, async ({
  evalJs, shot, sleep, openPage, errors,
}) => {
  await openPage(new URL('/life?view=dashboard', APP).href);
  const state = JSON.parse(await evalJs(DASH_STATE));
  console.log('  state:', { tiles: state.tiles, kpis: state.kpis, overflow: state.overflow });
  assert(state.overflow <= 1, `mobile horizontal overflow ${state.overflow}px`);
  assert(state.kpis === 6, `mobile: expected 6 KPI cards, got ${state.kpis}`);
  assert(state.radar === 1, 'mobile: radar missing');

  await shot('top');
  await evalJs('window.scrollTo({ top: 900, behavior: "instant" })');
  await sleep(500);
  await shot('mid');
  await evalJs('window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" })');
  await sleep(500);
  await shot('bottom');

  if (errors.length) throw new Error(`mobile console errors: ${errors.join(' | ')}`);
});

console.log('done');
