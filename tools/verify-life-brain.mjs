// LIFE 页「3D 机械神经网络大脑」验收。
//
//   cd app && npm run build
//   npx vite preview --port 4174 --strictPort &
//   node tools/verify-life-brain.mjs http://localhost:4174
//
// /api/life 在页面脚本执行前打桩，数据固定；不依赖真实 CMS。
// 断言：WebGL 场景起得来、节点/突触/日期珠数量、区域悬停、拖拽旋转、
// 点日期珠打开单日详情、图例联动、彩色模式、reduced-motion、手机布局、
// 空数据降级，以及零控制台报错。截图写到临时目录并打印路径。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = process.argv[2] || 'http://127.0.0.1:4174/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 固定数据 ----------
const CATS = ['Work', 'Study', 'Life', 'Transport', 'Leisure', 'Health', 'Social', 'Other'];
const END = new Date('2026-10-18T12:00:00Z');
const iso = (d) => d.toISOString().slice(0, 10);

function buildDays() {
  const days = [];
  for (let back = 29; back >= 0; back -= 1) {
    const day = iso(new Date(END.getTime() - back * 86400000));
    const idx = 29 - back;
    if (idx === 7) continue;

    const categories = {
      Work: Number((2.4 + (idx % 5) * 0.7).toFixed(2)),
      Study: idx % 3 === 0 ? 0.9 : 0,
      Life: 0.8,
      Transport: idx % 4 === 0 ? 0.3 : 0,
      Leisure: Number((1.1 + (idx % 4) * 0.3).toFixed(2)),
      Health: idx % 6 === 0 ? 0.6 : 0,
      Social: idx % 8 === 0 ? 1.2 : 0,
      Other: 0.1,
    };
    const trackedHours = Number(Object.values(categories).reduce((a, b) => a + b, 0).toFixed(2));

    days.push({
      v: 1,
      day,
      categories,
      trackedHours,
      topApps: [['VS Code', Number((categories.Work * 0.6).toFixed(2))], ['Edge', Number((categories.Work * 0.4).toFixed(2))]],
      health: {
        steps: 5200 + ((idx * 937) % 9000),
        hrAvg: 70 + (idx % 20),
        hrMin: 55,
        runs: idx % 7 === 0 ? 1 : 0,
        runKm: idx % 7 === 0 ? 5.06 : 0,
        runMinutes: idx % 7 === 0 ? 29.6 : 0,
        runPaceS: idx % 7 === 0 ? 351 : null,
        vo2max: 45.8,
      },
      location: {
        city: 'Shanghai',
        districts: idx % 2 ? [['Pudong', 3.2], ['Qingpu', 1.1]] : [["Jing'an", 2.2], ['Xuhui', 0.9]],
        movingMinutes: 20 + idx,
        stayMinutes: 400 + idx * 3,
        spanKm: 10 + idx,
        points: 500 + idx * 10,
      },
      phone: {
        unlocks: 42 + idx * 3,
        screenOn: 60 + idx,
        screenOff: 58 + idx,
        screenMinutes: 210 + idx * 4,
        appSwitches: 180 + idx * 5,
        topApps: [['WeChat', 60 + idx], ['DeepSeek', 20 + idx * 2]],
      },
      ai: {
        cost: Number((1.5 + (idx % 9) * 0.7).toFixed(2)),
        costSource: idx % 3 === 0 ? 'platform' : 'claude-estimate',
        dailyCost: 0.1,
        spend: idx % 3 === 0 ? Number((1.5 + (idx % 9) * 0.7).toFixed(2)) : null,
        estimatedCost: idx % 3 === 0 ? null : Number((1.5 + (idx % 9) * 0.7).toFixed(2)),
        calls: 10 + idx,
        callsSource: idx % 3 === 0 ? 'platform' : 'claude-estimate',
        models: [],
        projects: [],
      },
    });
  }
  return days;
}

const FULL = {
  v: 1,
  days: buildDays(),
  count: 29,
  skipped: 0,
  range: { from: buildDays()[0].day, to: buildDays()[buildDays().length - 1].day },
  generatedAt: '2026-10-18T12:00:00Z',
  updatedAt: '2026-10-18 04:00:00',
};
const EMPTY = { v: 1, days: [], count: 0, skipped: 0, range: null, generatedAt: '2026-10-18T12:00:00Z', updatedAt: null };

const STUB = `
(function () {
  var FULL = ${JSON.stringify(JSON.stringify(FULL))};
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

  var rawIndex = {
    v: 1,
    kinds: {
      events: [],
      journal: [],
      notes: [],
      tasks: [],
      qa: [],
      blocks: [],
      weekly: [],
      vault: [],
    },
    generatedAt: '2026-10-18T12:00:00Z',
  };

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/life/raw/index') >= 0) return jsonResponse(rawIndex);
    if (url.indexOf('/api/life/now') >= 0) return jsonResponse({ error: 'no snapshot yet' });
    if (url.indexOf('/api/life') >= 0) {
      var body = mode === 'empty' ? EMPTY : FULL;
      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (url.indexOf('/api/track') >= 0) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, sid: 'verify-life-brain' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    return orig.apply(this, arguments);
  };
})();
`;

// ---------- CDP ----------
const errors = [];

async function withPage({ width, height, mobile, reduced, mode, label }, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-brain-'));
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
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
      } else if (m.method === 'Runtime.consoleAPICalled') {
        const text = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        if (m.params.type === 'error') {
          errors.push(text);
          console.log('  [console error]', text);
        }
      } else if (m.method === 'Runtime.exceptionThrown') {
        errors.push(m.params.exceptionDetails?.text || 'exception');
        console.log('  [exception]', m.params.exceptionDetails?.text || 'exception');
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
    const shot = async (name) => {
      const out = path.join(os.tmpdir(), `life-brain-${label}-${name}.png`);
      const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
      console.log('  screenshot:', out);
      return out;
    };
    const move = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
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
      await sleep(2600);
    } else {
      await sleep(1600);
    }

    const result = await fn({ send, evalJs, shot, move, sleep, width, height });
    ws.close();
    return result;
  } finally {
    child.kill();
    await sleep(300);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

const BRAIN_STATE = `(function () {
  var el = document.querySelector('.life-brain');
  if (!el) return JSON.stringify({ missing: true });
  var c = el.querySelector('.life-brain-canvas');
  var r = c ? c.getBoundingClientRect() : null;
  var labels = {};
  el.querySelectorAll('.life-brain-label').forEach(function (n) {
    var k = n.dataset.label;
    if (!k) return;
    labels[k] = {
      x: parseFloat(n.style.left || '0'),
      y: parseFloat(n.style.top || '0'),
      visible: n.style.visibility !== 'hidden',
      opacity: n.style.opacity,
      text: n.textContent.replace(/\\s+/g, ' ').trim(),
    };
  });
  return JSON.stringify({
    status: el.dataset.brainStatus,
    hover: el.dataset.brainHover,
    selected: el.dataset.brainSelected,
    cam: el.dataset.brainCam,
    auto: el.dataset.brainAuto,
    color: el.dataset.brainColor,
    full: el.dataset.brainFull,
    morph: el.dataset.brainMorph,
    days: Number(el.dataset.brainDays || 0),
    nodes: Number(el.dataset.brainNodes || 0),
    edges: Number(el.dataset.brainEdges || 0),
    rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
    host: (function () { var b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })(),
    readout: (el.querySelector('.life-brain-readout') || {}).textContent?.replace(/\\s+/g, ' ').trim() || '',
    chips: el.querySelectorAll('.life-brain-chip').length,
    labels: labels,
    labelCount: el.querySelectorAll('.life-brain-label').length,
    openDay: !!el.querySelector('.life-brain-open-day'),
    canvasW: c ? c.width : 0,
    canvasH: c ? c.height : 0,
    fallback: (el.querySelector('.life-brain-poster.is-note') || {}).textContent?.replace(/\\s+/g, ' ').trim() || '',
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  });
})()`;

function camOf(state) {
  return (state.cam || '').split(',').map(Number);
}

async function waitReady(evalJs, timeout = 15000) {
  const start = Date.now();
  let state = null;
  while (Date.now() - start < timeout) {
    state = JSON.parse(await evalJs(BRAIN_STATE));
    if (state.status && state.status !== 'idle' && state.status !== 'loading') return state;
    await sleep(250);
  }
  return state;
}

async function scrollBrain(evalJs) {
  await evalJs(`(function () {
    var el = document.querySelector('.life-brain-panel');
    if (!el) return;
    var y = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top: y, behavior: 'instant' });
  })()`);
  await sleep(1400);
}

function labelPoint(state, key) {
  const label = state.labels[key];
  if (!label || !state.rect) return null;
  return {
    x: state.rect.x + label.x,
    y: state.rect.y + label.y,
  };
}

async function hoverPoint(send, sleep, p) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x - 3, y: p.y - 3 });
  await sleep(70);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await sleep(220);
}

async function clickPoint(send, sleep, p) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await sleep(30);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await sleep(120);
}

console.log('LIFE brain · desktop');
await withPage({ width: 1440, height: 1000, label: 'desk' }, async ({ evalJs, shot, move, sleep, send }) => {
  await scrollBrain(evalJs);
  await waitReady(evalJs);
  await sleep(500);
  let state = JSON.parse(await evalJs(BRAIN_STATE));
  console.log('  state:', {
    status: state.status,
    nodes: state.nodes,
    edges: state.edges,
    days: state.days,
    chips: state.chips,
    labels: state.labelCount,
  });
  if (state.status !== 'ready') throw new Error(`brain not ready: ${state.status}`);
  if (state.nodes !== 38) throw new Error(`expected 8 hubs + 30 days = 38 nodes, got ${state.nodes}`);
  if (state.days !== 30) throw new Error(`expected 30 day nodes, got ${state.days}`);
  if (state.edges < 60) throw new Error(`expected a connected graph, got ${state.edges} links`);
  if (state.chips !== 8) throw new Error(`expected 8 legend chips, got ${state.chips}`);
  if (state.labelCount < 8) throw new Error(`category labels missing (${state.labelCount})`);
  if (state.canvasW < 300 || state.canvasH < 200) throw new Error('canvas has no drawing buffer');
  if (state.overflow > 0) throw new Error(`horizontal overflow ${state.overflow}px`);
  if (state.morph !== 'radial') throw new Error(`default morphology should be radial, got ${state.morph}`);
  await shot('graph');

  // 七维雷达 ↔ 神经核心联动
  // 雷达切到 DAY → 神经核心推到最新一天（day:29）
  const clickRadarRange = (label) => evalJs(`(function () {
    var b = Array.prototype.find.call(document.querySelectorAll('.life-radar-range'), function (n) {
      return n.textContent.trim() === '${label}';
    });
    if (!b) throw new Error('radar range ${label} not found');
    b.click();
  })()`);
  await clickRadarRange('DAY');
  await sleep(1800);
  state = JSON.parse(await evalJs(BRAIN_STATE));
  console.log('  radar→brain:', state.selected);
  if (state.selected !== 'day:29') {
    throw new Error(`radar DAY should select the latest day node, got ${state.selected}`);
  }
  const radarDay = JSON.parse(await evalJs(`(function () {
    var s = document.querySelector('.life-radar-select');
    var key = document.querySelector('.life-radar-key');
    return JSON.stringify({
      hasSelect: !!s,
      value: s ? s.value : '',
      last: s ? s.options[s.options.length - 1].value : '',
      legend: key ? key.textContent.replace(/\\s+/g, ' ').trim() : '',
    });
  })()`));
  if (!radarDay.hasSelect || !/^DAY · /.test(radarDay.legend)) {
    throw new Error(`radar did not switch to DAY: ${radarDay.legend}`);
  }

  // 神经核心的 DAY › 从最后一天绕回第一天 → 雷达跟着切日期
  await evalJs(`(function () {
    var b = Array.prototype.find.call(document.querySelectorAll('.life-brain-btn'), function (n) {
      return n.textContent.trim() === 'DAY ›';
    });
    if (!b) throw new Error('DAY next button not found');
    b.click();
  })()`);
  await sleep(1800);
  state = JSON.parse(await evalJs(BRAIN_STATE));
  const brainToRadar = JSON.parse(await evalJs(`(function () {
    var s = document.querySelector('.life-radar-select');
    var key = document.querySelector('.life-radar-key');
    return JSON.stringify({
      value: s ? s.value : '',
      last: s ? s.options[s.options.length - 1].value : '',
      legend: key ? key.textContent.replace(/\\s+/g, ' ').trim() : '',
    });
  })()`));
  console.log('  brain→radar:', state.selected, brainToRadar.value);
  if (state.selected !== 'day:0') {
    throw new Error(`DAY › should wrap to day:0, got ${state.selected}`);
  }
  if (brainToRadar.value !== brainToRadar.last) {
    throw new Error(`radar did not follow the brain day: ${brainToRadar.value} != ${brainToRadar.last}`);
  }
  if (!/^DAY · /.test(brainToRadar.legend)) throw new Error('radar left DAY mode after brain selection');

  // 回到默认 7D 并清掉选中，后续形态 / 拖拽 / 悬停测试不受联动状态影响
  await clickRadarRange('7D');
  await evalJs(`(function () {
    var b = Array.prototype.find.call(document.querySelectorAll('.life-brain-btn'), function (n) {
      return n.textContent.trim() === 'RESET';
    });
    if (b) b.click();
  })()`);
  await sleep(1200);
  state = JSON.parse(await evalJs(BRAIN_STATE));
  if (state.selected !== 'none') throw new Error(`RESET left a node selected: ${state.selected}`);

  // 形态切换：放射状 → 锥体。节点/连线数量不变，只是骨架重排
  const clickMorph = async (label) => evalJs(`(function () {
    var b = Array.prototype.find.call(document.querySelectorAll('.life-brain-btn'), function (n) {
      return n.textContent.trim() === '${label}';
    });
    if (!b) throw new Error('morph button ${label} not found');
    b.click();
  })()`);
  await clickMorph('RADIAL');
  await sleep(1400);
  const pyrState = JSON.parse(await evalJs(BRAIN_STATE));
  console.log('  morph:', pyrState.morph, 'nodes:', pyrState.nodes, 'edges:', pyrState.edges);
  if (pyrState.morph !== 'pyramidal') throw new Error(`morph button did not switch: ${pyrState.morph}`);
  if (pyrState.nodes !== 38) throw new Error(`pyramidal morphology lost nodes: ${pyrState.nodes}`);
  if (pyrState.labelCount < 8) throw new Error('pyramidal morphology lost labels');
  await shot('pyramidal');
  await clickMorph('PYRAMID');
  await sleep(1200);
  state = JSON.parse(await evalJs(BRAIN_STATE));
  if (state.morph !== 'radial') throw new Error(`morph button did not switch back: ${state.morph}`);

  // 拖拽旋转：镜头动的时候标签必须让路（不在屏幕上到处飘）
  const cx0 = state.rect.x + state.rect.w / 2;
  const cy0 = state.rect.y + state.rect.h / 2;
  const beforeRot = state.cam;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx0, y: cy0, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 8; i += 1) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx0 + i * 16, y: cy0 + i * 3, button: 'left' });
    await sleep(25);
  }
  await sleep(320);
  const moving = JSON.parse(await evalJs(`(function () {
    var el = document.querySelector('.life-brain');
    var labels = document.querySelector('.life-brain-labels');
    return JSON.stringify({
      moving: el.classList.contains('is-cam-moving'),
      opacity: getComputedStyle(labels).opacity,
    });
  })()`));
  console.log('  drag labels:', moving);
  if (!moving.moving) throw new Error('camera-moving state did not turn on while dragging');
  if (Number(moving.opacity) > 0.15) throw new Error(`labels stayed visible while dragging: ${moving.opacity}`);

  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx0 + 128, y: cy0 + 24, button: 'left', clickCount: 1 });
  await sleep(1400);
  const settled = JSON.parse(await evalJs(`(function () {
    var el = document.querySelector('.life-brain');
    var labels = document.querySelector('.life-brain-labels');
    return JSON.stringify({
      moving: el.classList.contains('is-cam-moving'),
      opacity: getComputedStyle(labels).opacity,
    });
  })()`));
  console.log('  settled labels:', settled);
  if (settled.moving) throw new Error('camera-moving state stuck after drag');
  if (Number(settled.opacity) < 0.9) throw new Error(`labels did not return after drag: ${settled.opacity}`);

  state = JSON.parse(await evalJs(BRAIN_STATE));
  if (state.cam === beforeRot) throw new Error('drag did not rotate the camera');
  await shot('dragged');

  // 分类标签就是节点的屏幕坐标：悬停到 Work 上
  const work = labelPoint(state, 'cat:Work');
  if (!work) throw new Error('no Work label position');
  await hoverPoint(send, sleep, work);
  let hovered = JSON.parse(await evalJs(BRAIN_STATE));
  console.log('  hover:', hovered.hover);
  if (hovered.hover !== 'cat:Work') throw new Error(`hover did not hit Work hub: ${hovered.hover}`);
  if (!hovered.readout.includes('WORK')) throw new Error('readout did not switch to Work');
  if (!hovered.readout.includes('HOVER')) throw new Error('readout should say HOVER when nothing is selected');

  // 鼠标位置必须可见：准星 + 光标旁节点名
  const cursor = JSON.parse(await evalJs(`(function () {
    var t = document.querySelector('.life-brain-cursor-tip');
    var r = document.querySelector('.life-brain-pointer');
    return JSON.stringify({
      tipDisplay: t ? getComputedStyle(t).display : 'missing',
      tipText: t ? t.textContent.replace(/\s+/g, ' ').trim() : '',
      pointerOpacity: r ? getComputedStyle(r).opacity : 'missing',
      htmlClass: document.documentElement.classList.contains('brain-pointer'),
    });
  })()`));
  console.log('  cursor:', cursor);
  if (cursor.tipDisplay === 'none' || cursor.tipDisplay === 'missing') {
    throw new Error('cursor tooltip did not appear over a node');
  }
  if (!cursor.tipText.includes('WORK')) throw new Error(`cursor tooltip missing node name: ${cursor.tipText}`);
  if (Number(cursor.pointerOpacity) < 0.8) throw new Error(`pointer reticle not visible: ${cursor.pointerOpacity}`);
  if (!cursor.htmlClass) throw new Error('brain-pointer class missing (block cursor not replaced)');
  await shot('hover');

  // 点 Work：镜头推近，target 离开原点
  const before = camOf(hovered);
  await clickPoint(send, sleep, work);
  await sleep(1800);
  state = JSON.parse(await evalJs(BRAIN_STATE));
  const workCam = camOf(state);
  console.log('  select Work:', state.selected, 'cam:', workCam);
  if (state.selected !== 'cat:Work') throw new Error(`Work hub was not selected: ${state.selected}`);
  if (!state.readout.includes('SELECTED')) throw new Error(`readout does not say SELECTED: ${state.readout}`);
  if (Math.hypot(workCam[0], workCam[1], workCam[2]) < 0.3) {
    throw new Error(`camera did not fly to the hub: ${state.cam}`);
  }
  const tipAfter = await evalJs("getComputedStyle(document.querySelector('.life-brain-cursor-tip')).display");
  if (tipAfter !== 'none') throw new Error('cursor tooltip should hide on the already-selected node');
  if (workCam[3] >= before[3]) throw new Error(`camera did not push in: ${before[3]} -> ${workCam[3]}`);
  await shot('focus-work');

  // 点另一个枢纽：镜头从 Work 推到 Life（点对点切换）
  const life = labelPoint(state, 'cat:Life');
  if (!life) throw new Error('no Life label position');
  await clickPoint(send, sleep, life);
  await sleep(300);
  const mid = camOf(JSON.parse(await evalJs(BRAIN_STATE)));
  await sleep(1600);
  state = JSON.parse(await evalJs(BRAIN_STATE));
  const lifeCam = camOf(state);
  console.log('  select Life:', state.selected, 'mid:', mid.slice(0, 3), 'cam:', lifeCam);
  if (state.selected !== 'cat:Life') throw new Error(`Life hub was not selected: ${state.selected}`);
  if (Math.abs(lifeCam[0] - workCam[0]) + Math.abs(lifeCam[2] - workCam[2]) < 0.2) {
    throw new Error('camera target did not move between hubs');
  }
  await shot('focus-life');

  // DAY：切到日期节点，读 HUD 的 OPEN DAY
  await evalJs(`(function () {
    var b = Array.prototype.find.call(document.querySelectorAll('.life-brain-btn'), function (n) {
      return n.textContent.trim().indexOf('DAY') === 0;
    });
    b.click();
  })()`);
  await sleep(1800);
  state = JSON.parse(await evalJs(BRAIN_STATE));
  console.log('  select day:', state.selected, 'openDay:', state.openDay, 'readout:', state.readout.slice(0, 80));
  console.log('  day label:', state.labels.day, 'canvas rect:', state.rect);
  if (!state.selected?.startsWith('day:')) throw new Error(`DAY did not select a day node: ${state.selected}`);
  if (!state.openDay) throw new Error('day readout missing OPEN DAY');
  if (!state.readout.includes('h')) throw new Error('day readout missing tracked hours');
  await shot('focus-day');

  // 下一天切换：selected 变、镜头 target 变
  const dayCam = camOf(state);
  await evalJs("document.querySelector('.life-brain-step').nextElementSibling.click()");
  await sleep(1800);
  const nextState = JSON.parse(await evalJs(BRAIN_STATE));
  const nextCam = camOf(nextState);
  console.log('  next day:', state.selected, '->', nextState.selected);
  if (nextState.selected === state.selected) throw new Error('next-day did not switch nodes');
  if (Math.abs(nextCam[0] - dayCam[0]) + Math.abs(nextCam[2] - dayCam[2]) < 0.05) {
    throw new Error('camera did not move between day nodes');
  }

  // OPEN DAY
  await evalJs("document.querySelector('.life-brain-open-day').click()");
  await sleep(500);
  const modal = JSON.parse(await evalJs(`(function () {
    var m = document.querySelector('.life-day-modal');
    return JSON.stringify({
      open: !!m,
      locked: document.body.classList.contains('no-scroll'),
      text: m ? m.textContent.replace(/\\s+/g, ' ').trim() : '',
    });
  })()`));
  console.log('  day modal:', { open: modal.open, text: modal.text.slice(0, 70) });
  if (!modal.open) throw new Error('OPEN DAY did not open the day modal');
  if (!modal.locked) throw new Error('day modal did not lock scroll');
  await shot('day');
  await evalJs("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await sleep(600);

  // 图例联动
  await evalJs("document.querySelector('.life-brain-chip').dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))");
  await sleep(300);
  const legendHover = JSON.parse(await evalJs(BRAIN_STATE));
  if (legendHover.hover !== 'cat:Work') throw new Error(`legend hover did not focus Work: ${legendHover.hover}`);
  await evalJs("document.querySelector('.life-brain-chip').dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))");
  await sleep(200);

  // 彩色模式
  await evalJs("document.querySelector('.life-color-toggle').click()");
  await sleep(400);
  if ((JSON.parse(await evalJs(BRAIN_STATE))).color !== '1') throw new Error('brain did not receive color mode');
  const dayColor = await evalJs("getComputedStyle(document.querySelector('.life-brain')).getPropertyValue('--life-day-color').trim()");
  const hasDayKey = await evalJs("!!document.querySelector('.life-brain-day-key')");
  console.log('  day colour:', dayColor, 'legend key:', hasDayKey);
  if (!/E8C15A/i.test(dayColor)) throw new Error(`day nodes should use their own colour, got ${dayColor}`);
  if (!hasDayKey) throw new Error('DAYS legend key missing');
  await shot('color');
  await evalJs("document.querySelector('.life-color-toggle').click()");
  await sleep(200);

  // 全屏 + 滚轮缩放
  await evalJs(`(function () {
    var b = Array.prototype.find.call(document.querySelectorAll('.life-brain-btn'), function (n) {
      return n.textContent.trim() === 'FULL';
    });
    b.click();
  })()`);
  await sleep(1200);
  const full = JSON.parse(await evalJs(BRAIN_STATE));
  console.log('  fullscreen:', { full: full.full, host: full.host });
  if (full.full !== '1') throw new Error('fullscreen state did not turn on');
  if (full.host.w < 1200 || full.host.h < 800) throw new Error(`fullscreen host did not cover viewport: ${JSON.stringify(full.host)}`);
  const beforeWheel = camOf(full)[3];
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: full.host.x + full.host.w / 2, y: full.host.y + full.host.h / 2,
    deltaX: 0, deltaY: -260,
  });
  await sleep(400);
  const zoomed = JSON.parse(await evalJs(BRAIN_STATE));
  console.log('  wheel zoom:', beforeWheel, '->', camOf(zoomed)[3]);
  if (camOf(zoomed)[3] >= beforeWheel) throw new Error('wheel did not zoom the fullscreen view');
  await shot('fullscreen');
  await evalJs(`(function () {
    var b = Array.prototype.find.call(document.querySelectorAll('.life-brain-btn'), function (n) {
      return n.textContent.trim() === 'EXIT';
    });
    b.click();
  })()`);
  await sleep(900);
  const exited = JSON.parse(await evalJs(BRAIN_STATE));
  console.log('  exit fullscreen:', exited.full, exited.host.h);
  if (exited.full !== '0') throw new Error('fullscreen state did not turn off');
  if (exited.host.h > 700) throw new Error('host did not return to panel height');

  // 浅色主题
  await evalJs("document.querySelector('#themeToggle').click()");
  await sleep(3400);
  const light = JSON.parse(await evalJs(BRAIN_STATE));
  const darkNow = await evalJs("document.documentElement.classList.contains('dark')");
  console.log('  light theme:', { status: light.status, dark: darkNow });
  if (darkNow) throw new Error('theme toggle did not switch to light');
  if (light.status !== 'ready') throw new Error('brain broke after theme change');
  await shot('light');
  await evalJs("document.querySelector('#themeToggle').click()");
  await sleep(3200);

  return true;
});

console.log('LIFE brain · reduced motion');
await withPage({ width: 1440, height: 1000, reduced: true, label: 'reduced' }, async ({ evalJs, shot, sleep, send }) => {
  await scrollBrain(evalJs);
  await waitReady(evalJs);
  await sleep(500);
  const st = JSON.parse(await evalJs(BRAIN_STATE));
  console.log('  state:', { status: st.status, auto: st.auto, nodes: st.nodes });
  if (st.status !== 'ready') throw new Error('brain not ready under reduced motion');
  if (st.auto !== '0') throw new Error('reduced motion should start in manual mode');
  if (!(await evalJs("document.querySelectorAll('.life-brain-btn')[0].disabled"))) {
    throw new Error('AUTO should be disabled under reduced motion');
  }
  // reduced motion 下推镜应该立即落位，不是缓动
  const work = labelPoint(st, 'cat:Work');
  await clickPoint(send, sleep, work);
  await sleep(150);
  const after = camOf(JSON.parse(await evalJs(BRAIN_STATE)));
  console.log('  instant focus:', after.slice(0, 3));
  if (Math.hypot(after[0], after[1], after[2]) < 0.3) {
    throw new Error('reduced motion did not snap the camera to the node');
  }
  await shot('reduced');
});

console.log('LIFE brain · mobile');
await withPage({ width: 390, height: 844, mobile: true, label: 'mobile' }, async ({ evalJs, shot, sleep }) => {
  await scrollBrain(evalJs);
  await waitReady(evalJs);
  await sleep(500);
  const state = JSON.parse(await evalJs(BRAIN_STATE));
  console.log('  state:', {
    status: state.status, days: state.days, overflow: state.overflow, rect: state.rect,
    labels: state.labelCount,
  });
  if (state.status !== 'ready') throw new Error('brain not ready on mobile');
  if (state.days !== 30) throw new Error('mobile lost the day nodes');
  if (state.overflow > 0) throw new Error(`mobile horizontal overflow ${state.overflow}px`);
  if (!state.rect || state.rect.h < 300) throw new Error('brain collapsed on mobile');
  await shot('mobile');

  // 手机上全屏：CSS 覆盖层也必须铺满视口
  await evalJs(`(function () {
    var b = Array.prototype.find.call(document.querySelectorAll('.life-brain-btn'), function (n) {
      return n.textContent.trim() === 'FULL';
    });
    b.click();
  })()`);
  await sleep(1000);
  const full = JSON.parse(await evalJs(BRAIN_STATE));
  console.log('  mobile fullscreen:', full.full, full.host);
  if (full.full !== '1') throw new Error('mobile fullscreen did not turn on');
  if (full.host.w < 380 || full.host.h < 800) throw new Error('mobile fullscreen did not cover the viewport');
  await shot('mobile-full');
});

console.log('LIFE brain · empty data');
await withPage({ width: 1440, height: 1000, mode: 'empty', label: 'empty' }, async ({ evalJs, shot }) => {
  await scrollBrain(evalJs);
  const state = await waitReady(evalJs);
  console.log('  state:', { status: state.status, fallback: state.fallback });
  if (state.status !== 'empty') throw new Error(`expected empty brain, got ${state.status}`);
  if (!/NO DAYS IN THE GRAPH/.test(state.fallback)) throw new Error('empty state poster missing');
  await shot('empty');
});

if (errors.length) {
  throw new Error(`console errors:\n${errors.join('\n')}`);
}

console.log('\nALL PASS');
