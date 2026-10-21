// LIFE 页「WHAT I'M DOING NOW」验收。
//
//   cd app && npx vite preview --port 5188 --strictPort
//   node tools/verify-life-now.mjs http://127.0.0.1:5188
//
// /api/life 与 /api/life/now 在页面脚本执行前打桩：
//   桌面：位置 + 坐标、实时问答、电脑、手机、手表、更新时间、地图链接
//   手机：单列、无横向溢出
//   404：显示等待第一份快照，不报错
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = process.argv[2] || 'http://127.0.0.1:5188/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const NOW = {
  v: 1,
  ts_utc: new Date(Date.now() - 90 * 1000).toISOString(),
  location: {
    place: 'Yingpu, Qingpu, Shanghai, CN',
    area: 'Yingpu',
    district: 'Qingpu',
    city: 'Shanghai',
    lat: 31.15676,
    lon: 121.10272,
    mode: 'stationary',
    stayMinutes: 296,
    lastSeen: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    day: '2026-10-21',
    stale: false,
  },
  desktop: {
    source: 'relay',
    running: true,
    afk: false,
    app: 'VS Code',
    title: 'CHANGELOG.md - liveinpassion - Visual Studio Code',
    category: 'Work',
    since: '18:59',
    minutes: 4,
    todayHours: 4.78,
    lastSeen: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
  },
  phone: {
    app: 'WeChat',
    screenOn: false,
    unlocks: 88,
    lastSeen: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    lastEvent: 'screen_off',
  },
  watch: {
    day: '2026-10-20',
    synced: false,
    steps: 4426,
    hrAvg: 79.3,
    hrMin: 61,
    pushedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    source: 'relay',
  },
  qa: {
    answer: 'Take the subway',
    note: null,
    question: '12:05-13:05 this period: · Computer: VS Code 29 min · Phone: 5 unlocks. What were you mainly busy with?',
    kind: 'routine',
    ts: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
  },
};

const STUB = `
(function () {
  var NOW = ${JSON.stringify(JSON.stringify(NOW))};
  var params = new URLSearchParams(location.search);
  var offline = params.get('now') === 'offline';
  var orig = window.fetch;
  function jsonResponse(value, status) {
    return Promise.resolve(new Response(JSON.stringify(value), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  }
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/life/now') >= 0) {
      if (offline) return jsonResponse({ error: 'no snapshot yet' }, 404);
      return jsonResponse(JSON.parse(NOW));
    }
    if (url.indexOf('/api/life/raw/index') >= 0) {
      return jsonResponse({ v: 1, kinds: {}, generatedAt: '2026-10-21T11:00:00Z' });
    }
    if (url.indexOf('/api/life') >= 0) {
      return jsonResponse({
        v: 1, days: [], count: 0, skipped: 0, range: null,
        generatedAt: '2026-10-21T11:00:00Z', updatedAt: '2026-10-21 11:00:00',
      });
    }
    if (url.indexOf('/api/track') >= 0) return jsonResponse({ ok: true });
    return orig.apply(this, arguments);
  };
})();
`;

async function withPage({ width, height, mobile, label, mode }, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-now-'));
  const args = [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars',
    `--window-size=${width},${height}`, 'about:blank',
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
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errors.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
      } else if (m.method === 'Runtime.exceptionThrown') {
        errors.push(m.params.exceptionDetails?.text || 'exception');
      }
    });
    const send = (method, params = {}) => new Promise((res, rej) => {
      const n = ++id;
      pending.set(n, { res, rej });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval failed');
      return r.result?.value;
    };
    const shot = async (name) => {
      const out = path.join(os.tmpdir(), `life-now-${label}-${name}.png`);
      const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
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
    await send('Page.navigate', {
      url: new URL(`/life${mode ? `?now=${mode}` : ''}`, APP).href,
    });
    await sleep(1400);
    for (let i = 0; i < 40; i++) {
      const visible = await evalJs("(function(){var b=document.querySelector('.brand__enter');return !!b && b.offsetParent!==null})()");
      if (visible) break;
      await sleep(200);
    }
    await evalJs("document.querySelector('.brand__enter')?.click()");
    await sleep(4200);

    const state = JSON.parse(await evalJs(`(function () {
      var el = document.querySelector('.life-now');
      if (!el) return JSON.stringify({ missing: true });
      var cards = [];
      el.querySelectorAll('.life-now-card').forEach(function (c) {
        cards.push(c.textContent.replace(/\\s+/g, ' ').trim());
      });
      var link = el.querySelector('.life-now-coords');
      return JSON.stringify({
        exists: true,
        header: (el.querySelector('.life-now-updated') || {}).textContent || '',
        text: el.textContent.replace(/\\s+/g, ' ').trim(),
        cards: cards,
        href: link ? link.getAttribute('href') : '',
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      });
    })()`));

    const result = await fn({ evalJs, shot, sleep, state });
    ws.close();
    return result;
  } finally {
    child.kill();
    await sleep(300);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

console.log('NOW · desktop');
await withPage({ width: 1440, height: 1100, label: 'desk' }, async ({ shot, state }) => {
  console.log('  state:', state.text.slice(0, 260));
  if (!state.exists) throw new Error('the NOW panel did not render');
  if (!/Qingpu/.test(state.text)) throw new Error('location district missing');
  if (!/31\.15676, 121\.10272/.test(state.text)) throw new Error('coordinates missing');
  if (!/STAYING/.test(state.text)) throw new Error('location mode missing');
  if (!/Take the subway/.test(state.text)) throw new Error('live Q&A answer missing');
  if (!/What were you mainly busy with/.test(state.text)) throw new Error('live Q&A question missing');
  if (!/VS Code/.test(state.text) || !/CHANGELOG/.test(state.text)) throw new Error('desktop snapshot missing');
  if (!/WeChat/.test(state.text) || !/88 UNLOCKS/.test(state.text)) throw new Error('phone snapshot missing');
  if (!/4,426/.test(state.text) || !/NOT TODAY/.test(state.text)) throw new Error('watch snapshot missing');
  if (!/UPDATED/.test(state.text)) throw new Error('watch last-update time missing');
  if (!/UPDATED/.test(state.header)) throw new Error(`updated line missing: ${state.header}`);
  if (!/openstreetmap\.org/.test(state.href) || !/mlat=31\.15676/.test(state.href)) {
    throw new Error(`map link wrong: ${state.href}`);
  }
  if (state.overflow > 0) throw new Error(`desktop overflow ${state.overflow}px`);
  await shot('desktop');
});

console.log('NOW · mobile');
await withPage({ width: 390, height: 844, mobile: true, label: 'mobile' }, async ({ shot, state }) => {
  console.log('  state:', { overflow: state.overflow, text: state.text.slice(0, 100) });
  if (!state.exists) throw new Error('the NOW panel did not render on mobile');
  if (!/Take the subway/.test(state.text)) throw new Error('mobile lost the Q&A answer');
  if (state.overflow > 0) throw new Error(`mobile overflow ${state.overflow}px`);
  await shot('mobile');
});

console.log('NOW · no snapshot yet');
await withPage({ width: 1440, height: 1100, label: 'offline', mode: 'offline' }, async ({ shot, state }) => {
  console.log('  state:', state.text.slice(0, 160));
  if (!state.exists) throw new Error('the NOW panel did not render when the snapshot is missing');
  if (!/WAITING FOR THE FIRST LIVE SNAPSHOT/.test(state.header)) {
    throw new Error(`offline header missing: ${state.header}`);
  }
  if (!/NO LOCATION DATA/.test(state.text)) throw new Error('offline empty state missing');
  await shot('offline');
});

if (errors.length) throw new Error(`console errors:\n${errors.join('\n')}`);
console.log('\nALL PASS');
