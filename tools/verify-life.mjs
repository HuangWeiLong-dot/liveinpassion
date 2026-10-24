// LIFE 页验收：KPI、五个面板、缺日虚线、悬浮提示、滚动揭示、keep-alive 重播、
// reduced-motion、手机布局，以及稀疏 / 空数据 / 请求失败三种降级。
//
//   cd app && npx vite --port 5199 --strictPort
//   node tools/verify-life.mjs
//
// /api/life 与 /api/track 都在页面脚本执行前用 fetch 打桩，所以本机不用连 CMS，
// 数据固定（否则截图和断言会随真实数据变化）。截图写到临时目录并打印路径。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = process.argv[2] || 'http://127.0.0.1:5199/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 固定数据 ----------
const CATS = ['Work', 'Study', 'Life', 'Transport', 'Leisure', 'Health', 'Social', 'Other'];
const SHANGHAI_TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const END = new Date(`${SHANGHAI_TODAY}T12:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);

function buildFull() {
  const days = [];
  for (let back = 29; back >= 0; back -= 1) {
    const day = iso(new Date(END.getTime() - back * 86400000));
    const idx = 29 - back;
    if (idx === 7) continue; // 中间故意缺一天

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

    const steps = idx === 10 ? null : idx === 11 ? 0 : 5200 + ((idx * 937) % 9000);
    const phone = idx === 12 ? null : {
      unlocks: idx === 13 ? 0 : 42 + idx * 3,
      screenOn: 60 + idx,
      screenOff: 58 + idx,
      screenMinutes: 210 + idx * 4,
      appSwitches: 180 + idx * 5,
      topApps: [['WeChat', 60 + idx], ['DeepSeek', 20 + idx * 2]],
    };

    let ai = null;
    if (idx !== 14) {
      const cost = idx === 15 ? 0 : Number((1.5 + (idx % 9) * 0.7).toFixed(2));
      const platform = idx % 3 === 0;
      ai = {
        cost,
        costSource: idx === 15 ? 'ledger' : platform ? 'platform' : 'claude-estimate',
        dailyCost: 0.1,
        spend: platform ? cost : null,
        estimatedCost: platform ? null : cost,
        calls: 10 + idx,
        callsSource: platform ? 'platform' : 'claude-estimate',
        models: platform ? [['deepseek-chat', Number((cost * 0.7).toFixed(2))]] : [],
        projects: platform ? [] : [['app', Number((cost * 0.6).toFixed(2))], ['liveinpassion', Number((cost * 0.4).toFixed(2))]],
      };
    }

    days.push({
      v: 1,
      day,
      categories,
      trackedHours,
      dimensions,
      topApps: [['VS Code', Number((categories.Work * 0.6).toFixed(2))], ['Edge', Number((categories.Work * 0.4).toFixed(2))]],
      topSites: idx === 12 ? null : [['chat.deepseek.com', 120 + idx], ['github.com', 40 + idx]],
      health: {
        steps,
        hrAvg: 70 + (idx % 20),
        hrMin: 55,
        hrMax: 145 + (idx % 20),
        runs: idx % 7 === 0 ? 1 : 0,
        runKm: idx % 7 === 0 ? 5.06 : 0,
        runMinutes: idx % 7 === 0 ? 29.6 : 0,
        runPaceS: idx % 7 === 0 ? 351 : null,
        vo2max: 45.8,
      },
      workouts: idx % 7 === 0 ? [{
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
        bestPaceStart: '2026-09-01T10:00:00Z',
        longestKm: 12.3,
        longestName: 'Running',
        longestDay: '2026-08-15',
        longestStart: '2026-08-15T10:00:00Z',
      },
      location: {
        city: idx === 3 ? 'Suzhou' : 'Shanghai',
        districts: idx === 3
          ? [['Suzhou', 4.0]]
          : idx % 2 ? [['Pudong', 3.2], ['Qingpu', 1.1]] : [["Jing'an", 2.2], ['Xuhui', 0.9]],
        movingMinutes: 20 + idx,
        stayMinutes: 400 + idx * 3,
        spanKm: 10 + idx,
        points: 500 + idx * 10,
      },
      phone,
      ai,
    });
  }
  return { v: 1, days, count: days.length, skipped: 0, range: { from: days[0].day, to: days[days.length - 1].day }, generatedAt: '2026-10-18T12:00:00Z', updatedAt: '2026-10-18 04:00:00' };
}

const FULL = buildFull();
const SPARSE = {
  v: 1,
  days: FULL.days.slice(-3),
  count: 3,
  skipped: 0,
  range: { from: FULL.days[FULL.days.length - 3].day, to: FULL.days[FULL.days.length - 1].day },
  generatedAt: '2026-10-18T12:00:00Z',
  updatedAt: '2026-10-18 04:00:00',
};
const EMPTY = {
  v: 1, days: [], count: 0, skipped: 0, range: null,
  generatedAt: '2026-10-18T12:00:00Z', updatedAt: null,
};

const STUB = `
(function () {
  var FULL = ${JSON.stringify(JSON.stringify(FULL))};
  var SPARSE = ${JSON.stringify(JSON.stringify(SPARSE))};
  var EMPTY = ${JSON.stringify(JSON.stringify(EMPTY))};
  var params = new URLSearchParams(location.search);
  var mode = params.get('mode') || 'full';
  var orig = window.fetch;

  function jsonResponse(value) {
    return Promise.resolve(new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  }

  function source() {
    if (mode === 'sparse') return JSON.parse(SPARSE);
    if (mode === 'empty') return JSON.parse(EMPTY);
    return JSON.parse(FULL);
  }

  var rawDays = (source().days || [])
    .filter(function (d) { return d.location; })
    .map(function (d) { return d.day; })
    .slice(-9);

  function rawIndex() {
    return {
      v: 1,
      kinds: {
        events: rawDays.map(function (day) {
          return { id: day, key: 'life/raw/events/' + day + '.json', size: 120000, uploaded: day + 'T12:00:00Z' };
        }),
        journal: rawDays.slice(-2).map(function (day) {
          return { id: day, key: 'life/raw/journal/' + day + '.md', size: 4000, uploaded: day + 'T12:00:00Z' };
        }),
      },
      generatedAt: '2026-10-18T12:00:00Z',
    };
  }

  // 两条固定端点之间来回一趟，和真实轨迹一样覆盖“家 ↔ 工作”走廊。
  function rawEvents(day) {
    var home = [31.1567, 121.1027];
    var work = [31.315, 121.4787];
    var path = [];
    var i;
    for (i = 0; i < 60; i += 1) {
      var t = i / 59;
      path.push([
        home[0] + (work[0] - home[0]) * t + (i % 3) * 0.00002,
        home[1] + (work[1] - home[1]) * t + (i % 2) * 0.00003,
      ]);
    }
    for (i = 58; i >= 0; i -= 1) {
      var u = i / 59;
      path.push([
        home[0] + (work[0] - home[0]) * u,
        home[1] + (work[1] - home[1]) * u,
      ]);
    }
    return {
      v: 1,
      kind: 'events',
      id: day,
      format: 'json',
      data: [
        {
          ts_utc: day + 'T00:00:00Z',
          domain: 'location',
          metric: 'tracked_points',
          value_num: path.length,
          value_text: 'Yingpu, Qingpu, Shanghai, CN',
          source: 'dawarich',
          meta: { lat_center: 31.23, lon_center: 121.29, span_km: 42 },
        },
        {
          ts_utc: day + 'T00:00:00Z',
          domain: 'location',
          metric: 'track_path',
          value_num: path.length,
          value_text: '',
          source: 'dawarich',
          meta: { path: path },
        },
        {
          ts_utc: day + 'T00:00:00Z',
          domain: 'location',
          metric: 'visit',
          value_num: 240,
          value_text: 'Yingpu, Qingpu, Shanghai, CN',
          source: 'dawarich',
          meta: { lat: home[0], lon: home[1] },
        },
        {
          ts_utc: day + 'T00:00:00Z',
          domain: 'location',
          metric: 'visit',
          value_num: 120,
          value_text: 'Zhabei, Pudong, Shanghai, CN',
          source: 'dawarich',
          meta: { lat: work[0], lon: work[1] },
        },
        {
          ts_utc: day + 'T00:00:00Z',
          domain: 'location',
          metric: 'transport',
          value_num: 18.4,
          value_text: 'driving',
          source: 'dawarich',
          meta: {},
        },
        {
          ts_utc: day + 'T00:00:00Z',
          domain: 'location',
          metric: 'transport',
          value_num: 3.4,
          value_text: 'cycling',
          source: 'dawarich',
          meta: {},
        },
        {
          ts_utc: day + 'T00:00:00Z',
          domain: 'location',
          metric: 'transport',
          value_num: 2.1,
          value_text: 'walking',
          source: 'dawarich',
          meta: {},
        },
        {
          ts_utc: day + 'T10:00:00Z',
          domain: 'fitness',
          metric: 'watch_track',
          value_num: 25,
          value_text: 'test.gpx',
          source: 'gadgetbridge-gpx',
          meta: {
            path: [[31.1567, 121.1027], [31.16, 121.11], [31.17, 121.12]],
            distance_km: 2.2,
            start_utc: day + 'T10:00:00Z',
            end_utc: day + 'T10:25:00Z',
          },
        },
        {
          ts_utc: day + 'T00:00:00Z',
          domain: 'screen',
          metric: 'unlocks',
          value_num: 42,
          value_text: '',
          source: 'phone',
          meta: {},
        },
      ],
    };
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (mode === 'error' && url.indexOf('/api/life') >= 0) {
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    if (url.indexOf('/api/life/raw/index') >= 0) {
      return jsonResponse(rawIndex());
    }
    // 「我现在在干嘛」是独立轮询；给它一份固定快照，验证 MOTION 里的实时状态行。
    if (url.indexOf('/api/life/now') >= 0) {
      var nowIso = new Date().toISOString();
      return jsonResponse({
        v: 1,
        ts_utc: nowIso,
        location: {
          mode: 'stationary', district: 'Qingpu', city: 'Shanghai',
          lat: 31.15665, lon: 121.10278, stayMinutes: 320,
          lastSeen: nowIso, stale: false,
        },
        desktop: {
          running: true, afk: false, app: 'VS Code', category: 'Work',
          title: 'LifeView.vue', since: '20:10', lastSeen: nowIso,
        },
        phone: {
          screenOn: true, app: 'WeChat', unlocks: 87, lastSeen: nowIso,
        },
        qa: null,
      });
    }
    var ev = url.match(/\\/api\\/life\\/raw\\/events\\/([^/?]+)/);
    if (ev) {
      return jsonResponse(rawEvents(decodeURIComponent(ev[1])));
    }
    if (url.indexOf('/api/life') >= 0) {
      window.__lifeFetches++;
      var body = mode === 'sparse' ? SPARSE : mode === 'empty' ? EMPTY : FULL;
      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (url.indexOf('/api/track') >= 0) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, sid: 'verify-life' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return orig.apply(this, arguments);
  };
})();
`;

async function withPage({ width, height, mobile, label, reduced = false, mode = '' }, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-'));
  const args = [
    '--headless=new',
    // 固定端口在本机的 Chrome 上起不来 DevTools 服务；用 0 让它自己挑
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
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) {
        if (m.method === 'Runtime.consoleAPICalled') {
          const argsText = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
          console.log('  [console]', m.params.type, argsText);
          if (m.params.type === 'error') errors.push(argsText);
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
      const out = path.join(os.tmpdir(), `life-${label}-${name}.png`);
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
    await send('Page.navigate', { url: new URL(`/life${mode ? `?mode=${mode}` : ''}`, APP).href });
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
      await sleep(3600);
    } else {
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

const LIFE_STATE = `(function () {
  var q = function (s) { return document.querySelectorAll(s); };
  var panel = function (name) { return document.querySelector('[data-chart="' + name + '"]'); };
  var rhythm = panel('rhythm');
  var motion = panel('motion');
  var phone = panel('phone');
  var ai = panel('ai');
  var stack = rhythm ? rhythm.querySelector('.life-stack') : null;
  var line = motion ? motion.querySelector('.life-line') : null;
  var title = document.querySelector('.stats-title');
  return JSON.stringify({
    path: location.pathname,
    fetches: window.__lifeFetches,
    cards: q('.stat-card').length,
    panels: q('.life-panel').length,
    means: q('.life-mean').length,
    weekdayRows: q('.life-weekday-row').length,
    weekdaySegs: q('.life-weekday-bar .life-seg').length,
    heartHero: q('[data-chart="motion"] .life-heart-hero').length,
    heartBig: (document.querySelector('[data-chart="motion"] .life-heart-big') || {}).textContent || '',
    watchMetrics: q('[data-chart="motion"] .life-watch-metric').length,
    watchText: Array.prototype.map.call(
      q('[data-chart="motion"] .life-watch-metric'),
      function (e) { return e.textContent.replace(/\s+/g, ' ').trim(); },
    ).join(' | '),
    watchHrCols: q('[data-chart="motion"] .life-hr-col').length,
    runRows: q('[data-chart="motion"] .life-run').length,
    liveStatus: q('[data-chart="motion"] .life-status').length,
    liveStatusText: Array.prototype.map.call(
      q('[data-chart="motion"] .life-status'),
      function (e) { return e.textContent.replace(/\s+/g, ' ').trim(); },
    ).join(' | '),
    legendZero: Array.prototype.map.call(
      q('[data-chart="rhythm"] .stats-legend span'),
      function (e) { return e.classList.contains('is-zero'); },
    ),
    mapTracks: q('[data-chart="places"] .life-map-track:not(.is-watch)').length,
    watchTracks: q('[data-chart="places"] .life-map-track.is-watch').length,
    mapDots: q('[data-chart="places"] .life-map-dot').length,
    mapLabels: q('[data-chart="places"] .life-map-labels text').length,
    mapDays: q('.life-map-day').length,
    mapActive: q('.life-map-day.is-active').length,
    mapReadout: (document.querySelector('.life-map-readout') || {}).textContent || '',
    transportRows: q('.life-map-rail .life-rail-group .life-row').length,
    numbers: Array.prototype.map.call(q('.sn-sr'), function (e) { return e.textContent; }),
    titleChars: title ? title.querySelectorAll('.stats-char').length : 0,
    rhythmCols: rhythm ? rhythm.querySelectorAll('.life-col').length : 0,
    rhythmMissing: rhythm ? rhythm.querySelectorAll('.life-col.is-missing').length : 0,
    rhythmSegs: rhythm ? rhythm.querySelectorAll('.life-seg').length : 0,
    motionCols: motion ? motion.querySelectorAll('.life-col').length : 0,
    motionMissing: motion ? motion.querySelectorAll('.life-col.is-missing').length : 0,
    phoneCols: phone ? phone.querySelectorAll('.life-col').length : 0,
    phoneMissing: phone ? phone.querySelectorAll('.life-col.is-missing').length : 0,
    aiCols: ai ? ai.querySelectorAll('.life-col').length : 0,
    aiMissing: ai ? ai.querySelectorAll('.life-col.is-missing').length : 0,
    stackTransform: stack ? getComputedStyle(stack).transform : null,
    lineDash: line ? getComputedStyle(line).strokeDasharray : null,
    linePath: line ? line.getAttribute('d') : null,
    panelOpacity: Array.prototype.map.call(q('[data-reveal]'), function (e) { return getComputedStyle(e).opacity; }),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    emptyText: document.querySelector('.stats-empty')?.textContent.replace(/\\s+/g, ' ').trim() || '',
    retry: !!document.querySelector('.stats-retry'),
    aiSource: ai ? ai.querySelector('.stats-panel-sub')?.textContent || '' : '',
    foot: document.querySelector('.stats-foot') ? getComputedStyle(document.querySelector('.stats-foot')).opacity : null,
    today: !!document.querySelector('.life-today'),
    todayText: (document.querySelector('.life-today') || {}).textContent?.replace(/\\s+/g, ' ').trim() || '',
    todayDesktopRows: q('.life-today .is-desktop .life-row').length,
    todayPhoneRows: q('.life-today .life-today-card:nth-child(2) .life-row').length,
    todayAiRows: q('.life-today .life-today-card:nth-child(3) .life-row').length,
    radarControls: q('.life-radar-range').length,
    radarAxes: q('.life-radar-axis').length,
    radarRows: q('.life-radar-row').length,
    radarActive: (document.querySelector('.life-radar-range.is-active') || {}).textContent?.trim() || '',
    radarLegend: (document.querySelector('.life-radar-key') || {}).textContent?.replace(/\\s+/g, ' ').trim() || '',
    radarCount: (document.querySelector('.life-radar-count') || {}).textContent?.trim() || '',
    radarSelect: !!document.querySelector('.life-radar-select'),
    radarFirst: (document.querySelector('.life-radar-value') || {}).textContent?.trim() || '',
    radarToolbarH: (document.querySelector('.life-radar-toolbar') || {}).getBoundingClientRect
      ? document.querySelector('.life-radar-toolbar').getBoundingClientRect().height
      : 0,
    radarCurrent: (document.querySelector('.life-radar-current') || {}).getAttribute
      ? document.querySelector('.life-radar-current').getAttribute('points')
      : '',
  });
})()`;

const errors = [];

console.log('LIFE desktop');
await withPage({ width: 1440, height: 1000, label: 'desk' }, async ({ evalJs, shot, send, sleep }) => {
  const state = JSON.parse(await evalJs(LIFE_STATE));
  console.log('  state:', state);

  if (state.path !== '/life') throw new Error('not on /life');
  const liveBadge = await evalJs("(function () { var b = document.querySelector('.life-live-badge'); return b ? b.textContent.replace(/\s+/g, ' ').trim() : ''; })()");
  console.log('  live badge:', liveBadge);
  if (!/TODAY/.test(liveBadge)) throw new Error('latest day should be marked TODAY · LIVE');
  if (state.cards !== 6) throw new Error(`expected 6 KPI cards, got ${state.cards}`);
  if (state.panels !== 9) throw new Error(`expected 9 panels (radar + brain + 7 charts), got ${state.panels}`);

  // 七维雷达：五档统计窗口，默认 7D；单日模式才出现日期步进 / 下拉
  if (state.radarControls !== 5) throw new Error(`expected 5 radar ranges, got ${state.radarControls}`);
  if (state.radarAxes !== 7) throw new Error(`expected 7 radar axes, got ${state.radarAxes}`);
  if (state.radarRows !== 7) throw new Error(`expected 7 radar rows, got ${state.radarRows}`);
  if (state.radarActive !== '7D') throw new Error(`radar default range should be 7D, got ${state.radarActive}`);
  if (!/LAST 7D/.test(state.radarLegend)) throw new Error(`radar legend missing 7D: ${state.radarLegend}`);
  // 日期控件常驻 DOM（占位防止页面跳动），可见性由后面的 dayHidden 断言检查
  if ((state.radarCurrent.match(/,/g) || []).length !== 7) {
    throw new Error(`radar polygon should have 7 vertices, got ${state.radarCurrent}`);
  }

  const radarState = () => evalJs(`(function () {
    var key = document.querySelector('.life-radar-key');
    var cur = document.querySelector('.life-radar-current');
    var sel = document.querySelector('.life-radar-select');
    return JSON.stringify({
      active: (document.querySelector('.life-radar-range.is-active') || {}).textContent?.trim() || '',
      legend: key ? key.textContent.replace(/\\s+/g, ' ').trim() : '',
      count: (document.querySelector('.life-radar-count') || {}).textContent?.trim() || '',
      day: sel ? sel.value : '',
      options: sel ? sel.options.length : 0,
      hasSelect: !!sel,
      selectAlign: sel ? getComputedStyle(sel).textAlign : '',
      points: cur ? cur.getAttribute('points') : '',
      baselinePoints: (document.querySelector('.life-radar-baseline') || {}).getAttribute
        ? document.querySelector('.life-radar-baseline').getAttribute('points')
        : '',
      firstValue: (document.querySelector('.life-radar-value') || {}).textContent?.trim() || '',
      firstFill: (document.querySelector('.life-radar-fill') || {}).style?.width || '',
      toolbarH: (document.querySelector('.life-radar-toolbar') || {}).getBoundingClientRect
        ? document.querySelector('.life-radar-toolbar').getBoundingClientRect().height
        : 0,
      // 用类名判断，而不是 computed visibility：面板未滚动揭示时祖先也可能是 hidden
      dayHidden: (function () {
        var d = document.querySelector('.life-radar-day');
        return d ? d.classList.contains('is-inactive') : 'missing';
      })(),
    });
  })()`);
  const clickRange = (label) => evalJs(`(function () {
    var b = Array.prototype.find.call(document.querySelectorAll('.life-radar-range'), function (e) {
      return e.textContent.trim() === '${label}';
    });
    if (!b) return 'missing';
    b.click();
    return 'ok';
  })()`);

  const initialRadar = JSON.parse(await radarState());
  if (initialRadar.dayHidden !== true) {
    throw new Error(`day picker should be inactive outside DAY, got ${initialRadar.dayHidden}`);
  }

  if (await clickRange('YEAR') !== 'ok') throw new Error('YEAR range button missing');
  await sleep(300);
  const yearState = JSON.parse(await radarState());
  if (yearState.active !== 'YEAR') throw new Error(`YEAR not active: ${yearState.active}`);
  if (!/YEAR · 29D AVAILABLE/.test(yearState.legend)) {
    throw new Error(`YEAR should label actual tracked days: ${yearState.legend}`);
  }
  if (!/29 TRACKED DAYS/.test(yearState.count)) throw new Error(`YEAR day count wrong: ${yearState.count}`);
  if (yearState.points === state.radarCurrent) throw new Error('YEAR polygon did not change');
  if (yearState.firstValue === state.radarFirst) {
    throw new Error(`YEAR did not refresh the dimension values (${yearState.firstValue})`);
  }

  if (await clickRange('ALL') !== 'ok') throw new Error('ALL range button missing');
  const allEarly = JSON.parse(await radarState());
  await sleep(140);
  const allMid = JSON.parse(await radarState());
  await sleep(500);
  const allState = JSON.parse(await radarState());
  if (allState.active !== 'ALL') throw new Error(`ALL not active: ${allState.active}`);
  if (!/ALL · 29D/.test(allState.legend)) throw new Error(`ALL legend wrong: ${allState.legend}`);
  // 切换必须真的在缓动：至少有一个中间采样与终值不同
  if (allEarly.firstValue === allState.firstValue && allMid.firstValue === allState.firstValue) {
    throw new Error(`ALL switch did not animate (${allEarly.firstValue} → ${allState.firstValue})`);
  }
  if (allEarly.points === allState.points && allMid.points === allState.points) {
    throw new Error('solid radar outline did not animate');
  }
  if (allEarly.baselinePoints === allState.baselinePoints
    && allMid.baselinePoints === allState.baselinePoints) {
    throw new Error('dashed baseline did not animate out');
  }
  if (Math.abs(allState.toolbarH - initialRadar.toolbarH) > 1) {
    throw new Error(`switching to ALL moved the toolbar (${initialRadar.toolbarH} → ${allState.toolbarH})`);
  }

  if (await clickRange('DAY') !== 'ok') throw new Error('DAY range button missing');
  await sleep(600);
  const dayState = JSON.parse(await radarState());
  if (dayState.dayHidden !== false) throw new Error('day picker should be active in DAY mode');
  if (dayState.selectAlign !== 'center') {
    throw new Error(`date should be centered in the picker, got ${dayState.selectAlign}`);
  }
  await shot('radar-day');
  if (Math.abs(dayState.toolbarH - initialRadar.toolbarH) > 1) {
    throw new Error(`switching to DAY moved the toolbar (${initialRadar.toolbarH} → ${dayState.toolbarH})`);
  }
  if (!dayState.hasSelect) throw new Error('DAY mode should show the date dropdown');
  if (dayState.options !== 29) throw new Error(`date dropdown should list 29 tracked days, got ${dayState.options}`);
  if (!/^DAY · /.test(dayState.legend)) throw new Error(`DAY legend wrong: ${dayState.legend}`);
  if (!/1 TRACKED DAYS/.test(dayState.count)) throw new Error(`DAY count wrong: ${dayState.count}`);
  if (!dayState.day) throw new Error('DAY mode should select a date by default');

  // 日期步进：往前一天，图与下拉都要跟着动
  await evalJs("document.querySelector('.life-radar-day .life-radar-step').click()");
  await sleep(300);
  const stepperState = JSON.parse(await radarState());
  if (stepperState.day === dayState.day) throw new Error('date stepper did not move');
  if (stepperState.legend === dayState.legend) throw new Error('date stepper did not refresh the radar');

  // 下拉框：选更早的一天
  await evalJs(`(function () {
    var s = document.querySelector('.life-radar-select');
    s.selectedIndex = 3;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(300);
  const selectState = JSON.parse(await radarState());
  if (selectState.day === stepperState.day) throw new Error('date dropdown did not change the day');
  if (selectState.legend === stepperState.legend) throw new Error('date dropdown did not refresh the radar');

  await clickRange('7D');
  await sleep(300);

  // 真实指针点击（不是 DOM .click()）：确认没有被浮层挡住
  await evalJs(`document.querySelector('[data-chart="radar"]').scrollIntoView({ block: 'center' })`);
  await sleep(600);
  await shot('radar-7d');
  const yearBtn = JSON.parse(await evalJs(`(function () {
    var b = Array.prototype.find.call(document.querySelectorAll('.life-radar-range'), function (n) {
      return n.textContent.trim() === 'YEAR';
    });
    var r = b.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height });
  })()`));
  console.log('  radar YEAR button:', yearBtn);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: yearBtn.x, y: yearBtn.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: yearBtn.x, y: yearBtn.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: yearBtn.x, y: yearBtn.y, button: 'left', clickCount: 1 });
  await sleep(500);
  const realClick = JSON.parse(await radarState());
  console.log('  radar after real click:', realClick.active);
  if (realClick.active !== 'YEAR') {
    throw new Error(`real pointer click did not switch the radar range (active=${realClick.active})`);
  }
  await shot('radar-year');
  await clickRange('7D');
  await sleep(300);
  if (!state.today) throw new Error('today section missing under WHAT I AM DOING NOW');
  if (!/TODAY/.test(state.todayText)) throw new Error('today section missing TODAY heading');
  if (!/DESKTOP/.test(state.todayText) || !/PHONE/.test(state.todayText) || !/AI SPEND/.test(state.todayText)) {
    throw new Error(`today section missing desktop/phone/AI: ${state.todayText.slice(0, 120)}`);
  }
  if (state.todayDesktopRows !== 4) {
    throw new Error(`today desktop should list 2 apps + 2 sites, got ${state.todayDesktopRows}`);
  }
  if (state.todayPhoneRows !== 2) throw new Error(`today phone rows: ${state.todayPhoneRows}`);
  if (state.todayAiRows !== 2) throw new Error(`today AI project rows: ${state.todayAiRows}`);
  if (state.legendZero.slice(0, 7).some(Boolean)) {
    throw new Error(`legend dimmed a dimension that has data: ${JSON.stringify(state.legendZero)}`);
  }
  if (state.heartHero !== 1) throw new Error(`expected 1 heart hero, got ${state.heartHero}`);
  if (!/bpm/i.test(state.heartBig)) throw new Error(`heart readout missing bpm: ${state.heartBig}`);
  if (state.watchMetrics !== 6) throw new Error(`expected 6 watch metrics, got ${state.watchMetrics}`);
  if (!/3:30 \/km/.test(state.watchText)) throw new Error('all-time best pace missing');
  if (!/12.3/.test(state.watchText)) throw new Error('all-time longest distance missing');
  if (!/87/.test(state.watchText) || !/312.5/.test(state.watchText)) throw new Error('all-time totals missing');
  if (state.watchHrCols !== 30) throw new Error(`expected 30 HR columns, got ${state.watchHrCols}`);
  if (state.runRows < 1) throw new Error(`expected run rows, got ${state.runRows}`);
  if (state.liveStatus !== 4) throw new Error(`expected 4 live status cells, got ${state.liveStatus}`);
  if (!/SCREEN ON/.test(state.liveStatusText)) throw new Error(`live phone status wrong: ${state.liveStatusText}`);
  if (!/RUNNING/.test(state.liveStatusText)) throw new Error(`live desktop status wrong: ${state.liveStatusText}`);
  if (!/STAYING/.test(state.liveStatusText)) throw new Error(`live location status wrong: ${state.liveStatusText}`);

  // 点 RUNNING 卡 → 打开逐次跑步详情；Escape 关闭
  await evalJs("document.querySelector('[data-chart=\"motion\"] .life-watch-run').click()");
  await sleep(400);
  const runsModal = JSON.parse(await evalJs(`(function () {
    var m = document.querySelector('.life-runs-modal');
    return JSON.stringify({
      open: !!m,
      rows: document.querySelectorAll('.life-run-modal-item').length,
      text: m ? m.textContent.replace(/\\s+/g, ' ').trim() : '',
      locked: document.body.classList.contains('no-scroll'),
    });
  })()`));
  console.log('  runs modal:', { open: runsModal.open, rows: runsModal.rows, locked: runsModal.locked });
  if (!runsModal.open) throw new Error('runs modal did not open');
  if (runsModal.rows !== state.runRows) throw new Error(`runs modal rows ${runsModal.rows} != ${state.runRows}`);
  if (!/AVG HR/.test(runsModal.text) || !/km/i.test(runsModal.text)) throw new Error('runs modal missing details');
  if (!runsModal.locked) throw new Error('runs modal did not lock body scroll');
  await evalJs("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await sleep(400);
  const runsClosed = JSON.parse(await evalJs(`(function () {
    return JSON.stringify({
      modal: !!document.querySelector('.life-runs-modal'),
      locked: document.body.classList.contains('no-scroll'),
    });
  })()`));
  if (runsClosed.modal) throw new Error('runs modal did not close');
  if (runsClosed.locked) throw new Error('runs modal left body locked');
  if (state.titleChars !== 4) throw new Error('expected per-letter LIFE title');
  if (state.numbers.length !== 6) throw new Error(`expected 6 odometers, got ${state.numbers.length}`);
  if (state.means !== 3) throw new Error(`expected 3 mean lines, got ${state.means}`);
  if (state.weekdayRows !== 7) throw new Error(`expected 7 weekday rows, got ${state.weekdayRows}`);
  if (state.weekdaySegs < 7) throw new Error('weekday stacks not rendered');
  if (state.rhythmCols !== 30) throw new Error(`expected 30 rhythm columns, got ${state.rhythmCols}`);
  if (state.rhythmMissing < 1) throw new Error('missing day not rendered as dashed baseline');
  if (state.rhythmSegs < 30) throw new Error('category stacks not rendered');
  if (state.motionCols !== 30) throw new Error('expected 30 motion columns');
  if (state.motionMissing < 2) throw new Error('null steps not treated as missing');
  if (state.phoneCols !== 30) throw new Error('expected 30 phone columns');
  if (state.phoneMissing < 2) throw new Error('null phone day not treated as missing');
  if (state.aiCols !== 30) throw new Error('expected 30 AI columns');
  if (state.aiMissing < 2) throw new Error('null AI day not treated as missing');
  if (!state.aiSource.includes('MIXED')) throw new Error(`AI source should be MIXED, got ${state.aiSource}`);
  await shot('top');

  // 彩色模式：分类色块/堆叠柱换成各自的色相，再切回黑白
  await evalJs("document.querySelector('.life-color-toggle').click()");
  await sleep(250);
  const color = JSON.parse(await evalJs(`(function () {
    var swatch = document.querySelector('[data-chart="rhythm"] .life-swatch.cat-0');
    var seg = document.querySelector('[data-chart="rhythm"] .life-seg.cat-0');
    var bar = document.querySelector('[data-chart="motion"] .life-bar');
    return JSON.stringify({
      on: document.querySelector('.life-section').classList.contains('is-color'),
      swatch: swatch ? getComputedStyle(swatch).backgroundColor : '',
      seg: seg ? getComputedStyle(seg).backgroundColor : '',
      bar: bar ? getComputedStyle(bar).backgroundColor : '',
      pressed: document.querySelector('.life-color-toggle').getAttribute('aria-pressed'),
    });
  })()`));
  console.log('  color mode:', color);
  if (!color.on || color.pressed !== 'true') throw new Error('color mode did not turn on');
  if (!/rgb\(59, 130, 246\)/.test(color.swatch)) throw new Error(`category swatch not colored: ${color.swatch}`);
  if (!/rgb\(59, 130, 246\)/.test(color.seg)) throw new Error(`stack segment not colored: ${color.seg}`);
  if (!/rgb\(20, 184, 166\)/.test(color.bar)) throw new Error(`motion bars not colored: ${color.bar}`);
  await shot('color');
  await evalJs("document.querySelector('.life-color-toggle').click()");
  await sleep(200);
  if (await evalJs("document.querySelector('.life-section').classList.contains('is-color')")) {
    throw new Error('color mode did not turn off');
  }

  // 滚动到 01，等揭示 + 柱体动画
  await evalJs(`(function () {
    var el = document.querySelector('[data-chart="rhythm"]');
    var y = el.getBoundingClientRect().top + window.scrollY - 100;
    window.scrollTo({ top: y, behavior: 'instant' });
  })()`);
  await sleep(1500);
  const revealed = JSON.parse(await evalJs(LIFE_STATE));
  console.log('  revealed:', { stack: revealed.stackTransform, opacity: revealed.panelOpacity });
  if (!/matrix\(1, 0, 0, 1,/.test(revealed.stackTransform)) throw new Error('stack did not animate to scaleY 1');
  // 只检查当前滚到的 01 面板；02 及以下要滚到底才揭示
  if (Number(revealed.panelOpacity[0]) < 0.99) throw new Error('rhythm panel not revealed after scroll');
  await shot('rhythm');

  // 悬浮提示
  const rect = JSON.parse(await evalJs(`(function () {
    var cols = document.querySelectorAll('[data-chart="rhythm"] .life-col');
    var b = cols[15].getBoundingClientRect();
    return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height - 60 });
  })()`));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x - 2, y: rect.y - 2 });
  await sleep(120);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
  await sleep(500);
  const tip = JSON.parse(await evalJs(`(function () {
    var t = document.querySelector('.life-tooltip');
    return JSON.stringify({ opacity: getComputedStyle(t).opacity, text: t.textContent.replace(/\\s+/g, ' ').trim() });
  })()`));
  console.log('  tooltip:', tip);
  if (Number(tip.opacity) < 0.8) throw new Error('tooltip did not appear');
  if (!/WORK|STUDY|LIFE|LEISURE|TRANSPORT|HEALTH|SOCIAL|OTHER/.test(tip.text)) {
    throw new Error('tooltip missing category breakdown');
  }
  await shot('tooltip');

  // 今天那根柱子的提示必须标明是“到目前为止”
  const lastCol = JSON.parse(await evalJs(`(function () {
    var cols = document.querySelectorAll('[data-chart="rhythm"] .life-col');
    var b = cols[cols.length - 1].getBoundingClientRect();
    return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height - 60 });
  })()`));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: lastCol.x - 2, y: lastCol.y - 2 });
  await sleep(120);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: lastCol.x, y: lastCol.y });
  await sleep(400);
  const todayTip = await evalJs("(document.querySelector('.life-tooltip') || {}).textContent?.replace(/\s+/g, ' ').trim() || ''");
  console.log('  today tooltip:', todayTip);
  if (!/SO FAR/.test(todayTip)) throw new Error(`today tooltip missing SO FAR: ${todayTip}`);

  // 单日详情：点柱子打开，Escape 关闭
  await evalJs(`document.querySelectorAll('[data-chart="rhythm"] .life-col')[15].click()`);
  await sleep(400);
  const dayModal = JSON.parse(await evalJs(`(function () {
    var m = document.querySelector('.life-day-modal');
    return JSON.stringify({
      open: !!m,
      text: m ? m.textContent.replace(/\\s+/g, ' ').trim() : '',
      locked: document.body.classList.contains('no-scroll'),
    });
  })()`));
  console.log('  day modal:', { open: dayModal.open, locked: dayModal.locked, text: dayModal.text.slice(0, 90) });
  if (!dayModal.open) throw new Error('day modal did not open');
  if (!dayModal.locked) throw new Error('day modal did not lock body scroll');
  if (!/CATEGORIES/.test(dayModal.text)) throw new Error('day modal missing categories');
  if (!/TRACKED/.test(dayModal.text)) throw new Error('day modal missing overview');
  if (!/DESKTOP/.test(dayModal.text) || !/APPLICATIONS/.test(dayModal.text)) {
    throw new Error('day modal missing desktop apps');
  }
  if (!/SITES/.test(dayModal.text) || !/chat\.deepseek\.com/.test(dayModal.text)) {
    throw new Error('day modal missing browsing sites');
  }
  await shot('day');
  await evalJs("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await sleep(800);
  const closed = JSON.parse(await evalJs(`(function () {
    return JSON.stringify({
      modal: !!document.querySelector('.life-day-modal'),
      locked: document.body.classList.contains('no-scroll'),
    });
  })()`));
  console.log('  day modal closed:', closed);
  if (closed.modal) throw new Error('day modal did not close on Escape');
  if (closed.locked) throw new Error('body scroll stayed locked');

  // 键盘 Enter 也能打开
  const enterOpened = await evalJs(`(function () {
    var col = document.querySelectorAll('[data-chart="motion"] .life-col')[12];
    col.focus();
    col.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve(!!document.querySelector('.life-day-modal'));
      }, 300);
    });
  })()`, true);
  console.log('  day modal via Enter:', enterOpened);
  if (!enterOpened) throw new Error('keyboard Enter did not open the day modal');
  await evalJs("document.querySelector('.life-day-close').click()");
  await sleep(700);

  // 「今日统计」的卡片打开的是**分类详情**：只显示这一类、列全不截断，
  // 不是整天的详情（整天留给柱子）。
  await evalJs("document.querySelector('.life-today .is-desktop').click()");
  await sleep(400);
  const todayDetail = JSON.parse(await evalJs(`(function () {
    var m = document.querySelector('.life-detail-modal');
    return JSON.stringify({
      open: !!m,
      // 分类详情复用了 .life-day-modal 的皮，这里要排除它才算“整天详情”
      dayOpen: !!document.querySelector('.life-day-modal:not(.life-detail-modal)'),
      locked: document.body.classList.contains('no-scroll'),
      text: m ? m.textContent.replace(/\\s+/g, ' ').trim() : '',
      rows: m ? m.querySelectorAll('.life-day-row').length : 0,
    });
  })()`));
  console.log('  today desktop detail:', {
    open: todayDetail.open,
    rows: todayDetail.rows,
    text: todayDetail.text.slice(0, 90),
  });
  if (!todayDetail.open) throw new Error('today desktop card did not open the detail modal');
  if (todayDetail.dayOpen) throw new Error('today desktop card opened the whole day modal');
  if (!todayDetail.locked) throw new Error('today detail did not lock body scroll');
  if (!/DESKTOP/.test(todayDetail.text)) throw new Error('today detail missing DESKTOP title');
  if (!/APPLICATIONS/.test(todayDetail.text) || !/SITES/.test(todayDetail.text)) {
    throw new Error('today detail missing applications/sites sections');
  }
  if (!/chat\.deepseek\.com/.test(todayDetail.text)) throw new Error('today detail missing full site list');
  if (/CATEGORIES|HEALTH|PLACES|WORKOUTS/.test(todayDetail.text)) {
    throw new Error('today detail leaked other day sections');
  }
  // 预览截到 6+5，详情必须是全部：stub 里今天正好 2 应用 + 2 站点
  if (todayDetail.rows !== 4) throw new Error(`today detail should list all 2 apps + 2 sites, got ${todayDetail.rows}`);
  await shot('today-detail');
  await evalJs("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await sleep(700);
  const detailClosed = JSON.parse(await evalJs(`(function () {
    return JSON.stringify({
      modal: !!document.querySelector('.life-detail-modal'),
      locked: document.body.classList.contains('no-scroll'),
    });
  })()`));
  console.log('  today detail closed:', detailClosed);
  if (detailClosed.modal) throw new Error('today detail did not close on Escape');
  if (detailClosed.locked) throw new Error('today detail left body locked');

  // PHONE 卡同理：只出手机自己的数据
  await evalJs("document.querySelector('.life-today .life-today-card:nth-child(2)').click()");
  await sleep(400);
  const phoneDetail = await evalJs(`(function () {
    var m = document.querySelector('.life-detail-modal');
    return m ? m.textContent.replace(/\\s+/g, ' ').trim() : '';
  })()`);
  console.log('  today phone detail:', phoneDetail.slice(0, 90));
  if (!/PHONE/.test(phoneDetail) || !/SCREEN TIME/.test(phoneDetail)) {
    throw new Error('today phone card did not open phone detail');
  }
  if (!/WeChat/.test(phoneDetail)) throw new Error('phone detail missing app list');
  if (/SITES|CATEGORIES|DESKTOP/.test(phoneDetail)) {
    throw new Error('phone detail leaked desktop sections');
  }
  await evalJs("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await sleep(600);

  // 屏幕亮起时间：KPI 行最后一张卡可点开，弹窗同时给电脑和手机
  await evalJs("document.querySelector('.life-cards .stat-card.is-openable').click()");
  await sleep(400);
  const screenDetail = JSON.parse(await evalJs(`(function () {
    var m = document.querySelector('.life-detail-modal');
    return JSON.stringify({
      open: !!m,
      locked: document.body.classList.contains('no-scroll'),
      text: m ? m.textContent.replace(/\\s+/g, ' ').trim() : '',
      rows: m ? m.querySelectorAll('.life-detail-day:not(.is-head)').length : 0,
      today: m ? m.querySelectorAll('.life-day-row').length : 0,
    });
  })()`));
  console.log('  screen detail:', { open: screenDetail.open, rows: screenDetail.rows, today: screenDetail.today });
  if (!screenDetail.open) throw new Error('screen card did not open the detail modal');
  if (!screenDetail.locked) throw new Error('screen detail did not lock body scroll');
  if (!/SCREEN TIME/.test(screenDetail.text)) throw new Error('screen detail missing title');
  if (!/DESKTOP/.test(screenDetail.text) || !/PHONE/.test(screenDetail.text)) {
    throw new Error('screen detail missing desktop/phone breakdown');
  }
  // 逐日列表覆盖整个窗口（stub 里 29 天有数据，缺的那天不出行）
  if (screenDetail.rows !== 29) throw new Error(`screen detail should list all 29 days, got ${screenDetail.rows}`);
  if (screenDetail.today !== 2) throw new Error(`screen detail should show today's 2 devices, got ${screenDetail.today}`);
  await shot('screen-detail');
  await evalJs("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await sleep(600);

  // 单日详情里的 WORKOUTS：点有锻炼的那一天
  await evalJs(`document.querySelectorAll('[data-chart="rhythm"] .life-col')[14].click()`);
  await sleep(400);
  const workoutModal = await evalJs(`(function () {
    var m = document.querySelector('.life-day-modal');
    return m ? m.textContent.replace(/\\s+/g, ' ').trim() : '';
  })()`);
  console.log('  workout modal:', workoutModal.slice(0, 100));
  if (!/WORKOUTS/.test(workoutModal) || !/5\.06 KM/.test(workoutModal)) {
    throw new Error('day modal missing workout details');
  }
  await evalJs("document.querySelector('.life-day-close').click()");
  await sleep(600);

  // 运动面板的折线真的画出来了（MOTION 顶部现在有手表/跑步列表，
  // 要滚到 chart 本身，不然柱子会在视口外，悬浮事件落空）
  await evalJs(`(function () {
    var el = document.querySelector('[data-chart="motion"] .life-plot');
    var y = el.getBoundingClientRect().top + window.scrollY - 160;
    window.scrollTo({ top: y, behavior: 'instant' });
  })()`);
  await sleep(1400);
  const line = JSON.parse(await evalJs(`(function () {
    var l = document.querySelector('[data-chart="motion"] .life-line');
    return JSON.stringify({ d: l ? l.getAttribute('d') : null, dash: l ? getComputedStyle(l).strokeDasharray : null });
  })()`));
  console.log('  line:', line);
  if (!line.d || line.d.length < 10) throw new Error('rolling mean line missing');

  // 02 的悬浮提示（和新加的分面板 tooltip 共用同一套逻辑）
  const mrect = JSON.parse(await evalJs(`(function () {
    var cols = document.querySelectorAll('[data-chart="motion"] .life-col');
    var b = cols[12].getBoundingClientRect();
    return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height - 40 });
  })()`));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mrect.x - 2, y: mrect.y - 2 });
  await sleep(120);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mrect.x, y: mrect.y });
  await sleep(500);
  const mtip = JSON.parse(await evalJs(`(function () {
    var t = document.querySelector('[data-chart="motion"] .life-tooltip');
    return JSON.stringify({ opacity: getComputedStyle(t).opacity, text: t.textContent.replace(/\\s+/g, ' ').trim() });
  })()`));
  console.log('  motion tooltip:', mtip);
  if (Number(mtip.opacity) < 0.8) throw new Error('motion tooltip did not appear');
  if (!/STEPS/.test(mtip.text)) throw new Error('motion tooltip missing steps');

  // 滚到底：所有面板 + 页脚揭示；地图在这附近懒加载
  await evalJs('window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" })');
  let mapReady = false;
  for (let i = 0; i < 40 && !mapReady; i += 1) {
    mapReady = await evalJs(`document.querySelectorAll('[data-chart="places"] .life-map-track').length > 0`);
    if (!mapReady) await sleep(150);
  }
  await sleep(1600);
  const lower = JSON.parse(await evalJs(LIFE_STATE));
  console.log('  lower:', {
    opacity: lower.panelOpacity,
    foot: lower.foot,
    mapTracks: lower.mapTracks,
    mapDots: lower.mapDots,
    mapDays: lower.mapDays,
    transportRows: lower.transportRows,
  });
  if (lower.panelOpacity.some((o) => Number(o) < 0.99)) throw new Error('lower panels not revealed');
  if (Number(lower.foot) < 0.99) throw new Error('footer not revealed');
  if (lower.mapTracks < 1) throw new Error('route map tracks missing');
  if (lower.watchTracks < 1) throw new Error('watch GPX tracks missing');
  if (lower.mapDots < 2) throw new Error('map stay clusters missing');
  if (lower.mapLabels < 1) throw new Error('map place labels missing');
  if (lower.mapDays !== lower.mapTracks + 1) throw new Error('map day tabs mismatch');
  if (lower.mapActive !== 1) throw new Error('no selected map day');
  if (lower.transportRows < 1) throw new Error('transport breakdown missing');

  // 地图日期按钮：切换后高亮与读数跟着走
  const daySwitch = JSON.parse(await evalJs(`(function () {
    var days = document.querySelectorAll('.life-map-day');
    days[2].focus();
    return JSON.stringify({
      active: document.querySelectorAll('.life-map-day.is-active').length,
      text: (document.querySelector('.life-map-day.is-active') || {}).textContent || '',
    });
  })()`));
  await sleep(200);
  const readout = await evalJs("(document.querySelector('.life-map-readout') || {}).textContent || ''");
  console.log('  map day switch:', daySwitch, readout.replace(/\\s+/g, ' ').trim());
  if (daySwitch.active !== 1) throw new Error('map day switch lost active state');
  if (!/\d+m/i.test(readout)) throw new Error('map readout missing transit minutes');

  // 无限天数 + 按需加载：首屏只取 MAP_BATCH_DAYS 天，LOAD MORE 再追加。
  const beforeMore = JSON.parse(await evalJs(`(function () {
    var btn = document.querySelector('.life-map-more-btn');
    return JSON.stringify({
      tracks: document.querySelectorAll('[data-chart="places"] .life-map-track').length,
      more: btn ? btn.textContent.replace(/\\s+/g, ' ').trim() : '',
      total: (document.querySelector('.life-map-more-row > span') || {}).textContent || '',
    });
  })()`));
  console.log('  map before load more:', beforeMore);
  if (!/LOAD MORE/.test(beforeMore.more)) throw new Error('map load-more button missing');
  if (!/^2$/.test((beforeMore.more.match(/(\d+)$/) || [])[1] || '')) {
    throw new Error(`map load-more count wrong: ${beforeMore.more}`);
  }
  await evalJs("document.querySelector('.life-map-more-btn').click()");
  await sleep(1200);
  const afterMore = JSON.parse(await evalJs(`(function () {
    return JSON.stringify({
      tracks: document.querySelectorAll('[data-chart="places"] .life-map-track').length,
      moreBtn: !!document.querySelector('.life-map-more-btn'),
      done: (document.querySelector('.life-map-more-done') || {}).textContent || '',
    });
  })()`));
  console.log('  map after load more:', afterMore);
  if (afterMore.tracks <= beforeMore.tracks) throw new Error('map load more added no tracks');
  if (afterMore.moreBtn) throw new Error('map load-more button did not disappear');
  if (!/ALL LOADED/.test(afterMore.done)) throw new Error('map all-loaded marker missing');

  // 缩放：点 + 后 viewport 的 transform 必须真的变化，RESET 回到 1。
  await evalJs("document.querySelector('.life-map-zoom button').click()");
  await sleep(180);
  const zoom = JSON.parse(await evalJs(`(function () {
    var g = document.querySelector('.life-map-viewport');
    return JSON.stringify({
      transform: g.getAttribute('transform') || '',
      resetVisible: !!document.querySelector('.life-map-zoom .is-reset'),
    });
  })()`));
  console.log('  map zoom:', zoom);
  if (!/scale\(1\.5\)/.test(zoom.transform)) throw new Error(`map zoom transform wrong: ${zoom.transform}`);
  if (!zoom.resetVisible) throw new Error('map reset button missing after zoom');
  await evalJs("document.querySelector('.life-map-zoom .is-reset').click()");
  await sleep(180);
  const reset = JSON.parse(await evalJs(`(function () {
    return JSON.stringify({
      transform: document.querySelector('.life-map-viewport').getAttribute('transform') || '',
    });
  })()`));
  if (!/scale\(1\)/.test(reset.transform)) throw new Error(`map reset wrong: ${reset.transform}`);

  await shot('bottom');

  // keep-alive：离开再回来，重播且重新拉数据
  const fetchesBefore = await evalJs('window.__lifeFetches');
  await evalJs("document.querySelectorAll('nav a')[0].click()");
  await sleep(2600);
  if (await evalJs('location.pathname') !== '/') throw new Error('did not navigate home');
  await evalJs('document.querySelector(\'nav a[href="/life"]\').click()');
  await sleep(4600);
  const returned = JSON.parse(await evalJs(LIFE_STATE));
  console.log('  returned:', { path: returned.path, fetches: returned.fetches, cards: returned.cards });
  if (returned.path !== '/life') throw new Error('did not return to life');
  if (returned.cards !== 6) throw new Error('cards lost after keep-alive');
  if (returned.numbers.length !== 6) throw new Error('odometers lost after keep-alive');
  if (returned.fetches <= fetchesBefore) throw new Error('no refresh fetch on re-activation');
  await shot('return');
});

console.log('LIFE light theme');
await withPage({ width: 1440, height: 1000, label: 'light' }, async ({ evalJs, shot, sleep }) => {
  await evalJs("document.documentElement.classList.remove('dark')");
  await sleep(400);
  await shot('top');
  await evalJs('window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" })');
  await sleep(1400);
  await shot('bottom');
});

console.log('LIFE reduced motion');
await withPage({ width: 1440, height: 1000, label: 'reduced', reduced: true }, async ({ evalJs, shot }) => {
  const state = JSON.parse(await evalJs(LIFE_STATE));
  console.log('  state:', { cols: state.rhythmCols, stack: state.stackTransform, lineDash: state.lineDash, opacity: state.panelOpacity });
  if (state.rhythmCols !== 30) throw new Error('reduced: expected 30 columns');
  if (!/matrix\(1, 0, 0, 1,/.test(state.stackTransform)) throw new Error('reduced: stacks hidden');
  if (state.lineDash && state.lineDash !== 'none') throw new Error('reduced: line still dashed');
  if (state.panelOpacity.some((o) => Number(o) < 0.99)) throw new Error('reduced: panels hidden');
  if (state.means !== 3) throw new Error('reduced: mean lines missing');
  if (state.weekdayRows !== 7) throw new Error('reduced: weekday rows missing');
  await shot('top');
});

console.log('LIFE mobile');
await withPage({ width: 390, height: 844, mobile: true, label: 'mobile' }, async ({ evalJs, shot, sleep }) => {
  const state = JSON.parse(await evalJs(LIFE_STATE));
  console.log('  state:', { cards: state.cards, cols: state.rhythmCols, overflow: state.overflow });
  if (state.cards !== 6) throw new Error('mobile: expected 6 KPI cards');
  if (state.rhythmCols !== 30) throw new Error('mobile: expected 30 columns');
  if (state.heartHero !== 1) throw new Error(`mobile: expected 1 heart hero, got ${state.heartHero}`);
  if (state.watchMetrics !== 6) throw new Error(`mobile: expected 6 watch metrics, got ${state.watchMetrics}`);
  if (state.watchHrCols !== 30) throw new Error(`mobile: expected 30 HR columns, got ${state.watchHrCols}`);
  if (state.liveStatus !== 4) throw new Error(`mobile: expected 4 live status cells, got ${state.liveStatus}`);
  if (state.overflow > 1) throw new Error(`mobile: horizontal overflow ${state.overflow}px`);
  await shot('top');
  await evalJs('window.scrollTo({ top: 900, behavior: "instant" })');
  await sleep(1200);
  await shot('rhythm');
  await evalJs(`document.querySelector('[data-chart="radar"]').scrollIntoView({ block: 'center' })`);
  await sleep(900);
  await shot('radar');
  const radarMobile = JSON.parse(await evalJs(LIFE_STATE));
  if (radarMobile.overflow > 1) throw new Error(`mobile: radar overflow ${radarMobile.overflow}px`);
  if (radarMobile.radarAxes !== 7) throw new Error('mobile: radar axes missing');
  // 手机先滚到 PLACES（不要从 01 直接跳到页尾，地图会整段掠过观察区）
  await evalJs(`(function () {
    var el = document.querySelector('[data-chart="places"]');
    var y = el.getBoundingClientRect().top + window.scrollY - 200;
    window.scrollTo({ top: y, behavior: 'instant' });
  })()`);
  let mapReady = false;
  for (let i = 0; i < 40 && !mapReady; i += 1) {
    mapReady = await evalJs(`document.querySelectorAll('[data-chart="places"] .life-map-track').length > 0`);
    if (!mapReady) await sleep(150);
  }
  await evalJs('window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" })');
  await sleep(1200);
  const lower = JSON.parse(await evalJs(LIFE_STATE));
  console.log('  lower:', { mapTracks: lower.mapTracks, overflow: lower.overflow });
  if (lower.mapTracks < 1) throw new Error('mobile: route map tracks missing');
  if (lower.overflow > 1) throw new Error(`mobile: overflow after map ${lower.overflow}px`);
  await shot('bottom');
  await evalJs('window.scrollTo({ top: 0, behavior: "instant" })');
  await sleep(300);
  await shot('full', true);
});

console.log('LIFE sparse (3 days)');
await withPage({ width: 1440, height: 1000, label: 'sparse', mode: 'sparse' }, async ({ evalJs }) => {
  const state = JSON.parse(await evalJs(LIFE_STATE));
  console.log('  state:', { cols: state.rhythmCols, missing: state.rhythmMissing, overflow: state.overflow });
  if (state.rhythmCols !== 3) throw new Error(`sparse: expected 3 columns, got ${state.rhythmCols}`);
  if (state.rhythmMissing !== 0) throw new Error('sparse: unexpected missing columns');
  if (state.rhythmSegs < 3) throw new Error('sparse: no category stacks');
});

console.log('LIFE empty response');
await withPage({ width: 1440, height: 1000, label: 'empty', mode: 'empty' }, async ({ evalJs, shot }) => {
  const state = JSON.parse(await evalJs(LIFE_STATE));
  console.log('  state:', { cards: state.cards, numbers: state.numbers.length, panels: state.panels });
  if (state.cards !== 6) throw new Error('empty: KPI cards missing');
  if (state.numbers.length !== 0) throw new Error('empty: expected no odometers');
  if (state.panels !== 9) throw new Error('empty: panels missing');
  await shot('top');
});

console.log('LIFE fetch failure');
await withPage({ width: 1440, height: 1000, label: 'error', mode: 'error' }, async ({ evalJs, shot }) => {
  const state = JSON.parse(await evalJs(LIFE_STATE));
  console.log('  state:', { emptyText: state.emptyText, retry: state.retry });
  if (!state.emptyText.includes('temporarily unavailable')) throw new Error('error state not shown');
  if (!state.retry) throw new Error('retry button missing');
  await shot('error');
});

if (errors.length) {
  console.error('console errors:', errors);
  process.exitCode = 1;
}
console.log('done');
