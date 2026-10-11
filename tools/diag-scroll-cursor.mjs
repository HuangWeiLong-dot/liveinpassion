// 诊断：指针停住不动，只滚动页面 —— 看 .hero-cursor 是否跟着滚走（视觉与指针错位）。
//
//   node tools/diag-scroll-cursor.mjs http://localhost:4174

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

const PROBE = `(() => {
  const el = document.querySelector('.hero-cursor');
  const r = el ? el.getBoundingClientRect() : null;
  return {
    scrollY: window.scrollY,
    pointer: window.__lastPointer,
    cursorVisible: el ? el.classList.contains('is-visible') : null,
    cursorCenter: r ? { x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1) } : null,
    deltaVsPointer: (r && window.__lastPointer) ? {
      dx: +((r.left + r.width / 2) - window.__lastPointer.x).toFixed(1),
      dy: +((r.top + r.height / 2) - window.__lastPointer.y).toFixed(1),
    } : null,
  };
})()`;

(async () => {
  const port = 9890 + Math.floor(Math.random() * 40);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-sc-'));
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
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__lastPointer = null;
        document.addEventListener('pointermove', (e) => { window.__lastPointer = { x: e.clientX, y: e.clientY }; }, true);`,
    });

    await send('Page.navigate', { url: baseUrl + '/' });
    await sleep(1500);
    await evaluate(`document.querySelector('.brand__enter')?.click()`);
    await sleep(4000);

    console.log('页脚位置:', await evaluate(`JSON.stringify((() => { const r = document.querySelector('footer').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, docHeight: document.documentElement.scrollHeight }; })())`));

    // 指针停在页面中上部，然后把页面滚到页脚
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 900, buttons: 0, pointerType: 'mouse' });
    await sleep(300);
    console.log('\n滚动前:', JSON.stringify(await evaluate(PROBE)));

    await evaluate(`window.scrollTo(0, document.documentElement.scrollHeight)`);
    await sleep(600);
    console.log('滚到页脚后:', JSON.stringify(await evaluate(PROBE)));

    // 真·滚轮
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 900, deltaX: 0, deltaY: -400, buttons: 0 });
    await sleep(600);
    console.log('滚轮上滚 400 后:', JSON.stringify(await evaluate(PROBE)));

    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 900, deltaX: 0, deltaY: 400, buttons: 0 });
    await sleep(600);
    console.log('滚轮下滚 400 后:', JSON.stringify(await evaluate(PROBE)));

    // 再动一下指针（回到页脚上方），看错位是否被下一次 pointermove 纠正
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 995, buttons: 0, pointerType: 'mouse' });
    await sleep(300);
    console.log('再移动指针后:', JSON.stringify(await evaluate(PROBE)));

    // 停在页脚不动、也不移动指针：看系统光标是否是 none（即用户看到的是那个错位的方块）
    console.log('\n页脚处系统光标:', await evaluate(`JSON.stringify((() => {
      const f = document.querySelector('footer');
      const el = document.elementFromPoint(700, 995);
      return { hit: el ? el.tagName : null, footerCursor: getComputedStyle(f).cursor, hitCursor: el ? getComputedStyle(el).cursor : null };
    })())`));
  } finally {
    try { ws && ws.close(); } catch {}
    child.kill();
    await sleep(600);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
})();
