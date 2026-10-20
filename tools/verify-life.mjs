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
const END = new Date('2026-10-18T12:00:00Z');
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
      topApps: [['VS Code', Number((categories.Work * 0.6).toFixed(2))], ['Edge', Number((categories.Work * 0.4).toFixed(2))]],
      health: {
        steps,
        hrAvg: 70 + (idx % 20),
        hrMin: 55,
        runs: idx % 7 === 0 ? 1 : 0,
        runKm: idx % 7 === 0 ? 5.06 : 0,
        runMinutes: idx % 7 === 0 ? 29.6 : 0,
        runPaceS: idx % 7 === 0 ? 351 : null,
        vo2max: 45.8,
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
  window.__lifeFetches = 0;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/life') >= 0) {
      window.__lifeFetches++;
      if (mode === 'error') return Promise.reject(new TypeError('Failed to fetch'));
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
  });
})()`;

const errors = [];

console.log('LIFE desktop');
await withPage({ width: 1440, height: 1000, label: 'desk' }, async ({ evalJs, shot, send, sleep }) => {
  const state = JSON.parse(await evalJs(LIFE_STATE));
  console.log('  state:', state);

  if (state.path !== '/life') throw new Error('not on /life');
  if (state.cards !== 5) throw new Error(`expected 5 KPI cards, got ${state.cards}`);
  if (state.panels !== 5) throw new Error(`expected 5 panels, got ${state.panels}`);
  if (state.titleChars !== 4) throw new Error('expected per-letter LIFE title');
  if (state.numbers.length !== 5) throw new Error(`expected 5 odometers, got ${state.numbers.length}`);
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

  // 运动面板的折线真的画出来了
  await evalJs(`(function () {
    var el = document.querySelector('[data-chart="motion"]');
    var y = el.getBoundingClientRect().top + window.scrollY - 100;
    window.scrollTo({ top: y, behavior: 'instant' });
  })()`);
  await sleep(1400);
  const line = JSON.parse(await evalJs(`(function () {
    var l = document.querySelector('[data-chart="motion"] .life-line');
    return JSON.stringify({ d: l ? l.getAttribute('d') : null, dash: l ? getComputedStyle(l).strokeDasharray : null });
  })()`));
  console.log('  line:', line);
  if (!line.d || line.d.length < 10) throw new Error('rolling mean line missing');

  // 滚到底：所有面板 + 页脚揭示
  await evalJs('window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" })');
  await sleep(1600);
  const lower = JSON.parse(await evalJs(LIFE_STATE));
  console.log('  lower:', { opacity: lower.panelOpacity, foot: lower.foot });
  if (lower.panelOpacity.some((o) => Number(o) < 0.99)) throw new Error('lower panels not revealed');
  if (Number(lower.foot) < 0.99) throw new Error('footer not revealed');
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
  if (returned.cards !== 5) throw new Error('cards lost after keep-alive');
  if (returned.numbers.length !== 5) throw new Error('odometers lost after keep-alive');
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
  await shot('top');
});

console.log('LIFE mobile');
await withPage({ width: 390, height: 844, mobile: true, label: 'mobile' }, async ({ evalJs, shot, sleep }) => {
  const state = JSON.parse(await evalJs(LIFE_STATE));
  console.log('  state:', { cards: state.cards, cols: state.rhythmCols, overflow: state.overflow });
  if (state.cards !== 5) throw new Error('mobile: expected 5 KPI cards');
  if (state.rhythmCols !== 30) throw new Error('mobile: expected 30 columns');
  if (state.overflow > 1) throw new Error(`mobile: horizontal overflow ${state.overflow}px`);
  await shot('top');
  await evalJs('window.scrollTo({ top: 900, behavior: "instant" })');
  await sleep(1200);
  await shot('rhythm');
  await evalJs('window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" })');
  await sleep(1400);
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
  if (state.cards !== 5) throw new Error('empty: KPI cards missing');
  if (state.numbers.length !== 0) throw new Error('empty: expected no odometers');
  if (state.panels !== 5) throw new Error('empty: panels missing');
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
