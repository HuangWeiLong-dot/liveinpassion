// 诊断：指针滑到页脚时，"看到的方块光标" vs "实际指针位置" vs "系统光标" 三者是否一致。
//
//   node tools/diag-pointer.mjs http://localhost:4174
//
// 用 Input.dispatchMouseEvent 真的移动指针（CDP 走的是渲染进程的命中测试路径，
// 和真鼠标同一条路），然后读 .hero-cursor 方块的实际矩形。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const baseUrl = (process.argv[2] || 'http://localhost:4174').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let id = 0;
const pending = new Map();
let ws;
const send = (method, params = {}) => {
  const i = ++id;
  return new Promise((res, rej) => {
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
};
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('求值失败: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
};

async function moveMouse(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0, pointerType: 'mouse' });
  await sleep(180);
}

const CURSOR_INFO = `(() => {
  const el = document.querySelector('.hero-cursor');
  const probe = window.__probe || null;
  if (!el) return { exists: false };
  const r = el.getBoundingClientRect();
  const hero = document.querySelector('.hero-concept');
  const hr = hero ? hero.getBoundingClientRect() : null;
  return {
    exists: true,
    visibleClass: el.classList.contains('is-visible'),
    opacity: getComputedStyle(el).opacity,
    rect: { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
    center: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) },
    inlineTransform: el.style.transform,
    heroRect: hr ? { top: Math.round(hr.top), bottom: Math.round(hr.bottom), height: Math.round(hr.height) } : null,
    heroTransform: hero ? getComputedStyle(hero).transform : null,
    lastPointer: window.__lastPointer || null,
    path: window.__pointerPath || null,
    nativeCursorOnHero: hero ? getComputedStyle(hero).cursor : null,
  };
})()`;

const INSTALL = `
window.__lastPointer = null;
window.__pointerPath = null;
window.__events = [];
document.addEventListener('pointermove', (e) => {
  window.__lastPointer = { x: e.clientX, y: e.clientY, target: e.target && e.target.tagName };
  window.__events.push('move:' + e.target.tagName + ':' + e.clientX + ',' + e.clientY);
  if (window.__events.length > 40) window.__events.shift();
}, true);
document.addEventListener('pointerover', (e) => {
  const el = e.target;
  window.__events.push('over:' + el.tagName + '.' + (typeof el.className === 'string' ? el.className.split(' ')[0] : '') + ':' + e.clientX + ',' + e.clientY);
  if (window.__events.length > 40) window.__events.shift();
}, true);
`;

(async () => {
  const port = 9850 + Math.floor(Math.random() * 40);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-ptr-'));
  const child = spawn(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
     '--no-first-run', '--disable-gpu', '--disable-extensions', '--window-size=1440,1000', 'about:blank'],
    { stdio: 'ignore' }
  );
  try {
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch {}
      if (!ready) await sleep(250);
    }
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      }
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: INSTALL });

    await send('Page.navigate', { url: baseUrl + '/' });
    await sleep(1500);
    await evaluate(`document.querySelector('.brand__enter')?.click()`);
    await sleep(4000);

    console.log('== 指针滑入 Hero 中央 ==');
    await moveMouse(700, 500);
    console.log(JSON.stringify(await evaluate(CURSOR_INFO), null, 2));

    console.log('\n== 指针滑向页脚（逐步下移） ==');
    for (const y of [700, 850, 900, 940, 970, 995]) {
      await moveMouse(700, y);
      const info = await evaluate(CURSOR_INFO);
      console.log(`pointer(700,${y}) -> cursor center ${JSON.stringify(info.center)} visible=${info.visibleClass} op=${info.opacity} heroBottom=${info.heroRect?.bottom} ptr=${JSON.stringify(info.lastPointer)}`);
    }

    console.log('\n== 事件轨迹（最近 12 条） ==');
    const path = await evaluate(`JSON.stringify((window.__events || []).slice(-12))`);
    console.log(path);

    console.log('\n== 页脚元素与指针命中 ==');
    const hit = await evaluate(`(() => {
      const f = document.querySelector('footer');
      const r = f.getBoundingClientRect();
      const out = { footerRect: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }, hits: [] };
      for (const [x, y] of [[700, 900], [700, 940], [700, 970], [700, 995], [1400, 940], [60, 940]]) {
        const el = document.elementFromPoint(x, y);
        out.hits.push({ x, y, el: el ? el.tagName + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '') : null });
      }
      return out;
    })()`);
    console.log(JSON.stringify(hit, null, 2));

    // 指针停在页脚时，把 .hero-cursor 的 transform 和 lastPointer 对比，看看差在哪
    console.log('\n== 差量分析 ==');
    const diff = await evaluate(`(() => {
      const el = document.querySelector('.hero-cursor');
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const hero = document.querySelector('.hero-concept');
      return {
        cursorCenter: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
        lastPointer: window.__lastPointer,
        offset: window.__lastPointer ? {
          dx: (r.left + r.width / 2) - window.__lastPointer.x,
          dy: (r.top + r.height / 2) - window.__lastPointer.y,
        } : null,
        cursorPosition: cs.position,
        cursorTop: cs.top,
        cursorLeft: cs.left,
        htmlZoom: getComputedStyle(document.documentElement).zoom,
        bodyZoom: getComputedStyle(document.body).zoom,
        viewportScrollY: window.scrollY,
      };
    })()`);
    console.log(JSON.stringify(diff, null, 2));
  } finally {
    try { ws && ws.close(); } catch {}
    child.kill();
    await sleep(600);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
})();
