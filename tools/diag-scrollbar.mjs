// 诊断：首屏（ENTER 之前 / 之后）默认滚动条与布局宽度是否变化，
// 以及页脚区域的指针命中是否与视觉位置一致。
//
//   node tools/diag-scrollbar.mjs http://localhost:4174
//
// 刻意**不加** --hide-scrollbars：这里要看的正是那条滚动条。

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
  if (r.exceptionDetails) throw new Error('页面求值失败: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
};

const MEASURE = `(() => {
  const de = document.documentElement;
  const cs = getComputedStyle(de);
  const bodyCs = getComputedStyle(document.body);
  const scrollbarWidth = window.innerWidth - de.clientWidth;
  const htmlSbW = getComputedStyle(de).getPropertyValue('scrollbar-width');
  // 找一个"宽度应当铺满 100%"的元素来暴露布局位移（header 是 fixed left/right 0）
  const header = document.querySelector('header');
  const app = document.getElementById('app');
  return {
    innerWidth: window.innerWidth,
    clientWidth: de.clientWidth,
    scrollbarWidth,
    scrollHeight: de.scrollHeight,
    clientHeight: de.clientHeight,
    canScroll: de.scrollHeight > de.clientHeight,
    htmlOverflowY: cs.overflowY,
    htmlScrollbarWidth: htmlSbW,
    htmlScrollbarGutter: cs.scrollbarGutter,
    bodyOverflowY: bodyCs.overflowY,
    bodyClass: document.body.className,
    headerRight: header ? header.getBoundingClientRect().right : null,
    appRight: app ? app.getBoundingClientRect().right : null,
    appWidth: app ? app.getBoundingClientRect().width : null,
  };
})()`;

(async () => {
  const port = 9810 + Math.floor(Math.random() * 40);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-sb-'));
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

    const consoleErrors = [];
    const logs = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
      }
      if (m.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
      }
    });

    await send('Page.navigate', { url: baseUrl + '/' });
    await sleep(1200);

    console.log('== ENTER 之前（首屏遮罩还在） ==');
    const before = await evaluate(MEASURE);
    console.log(JSON.stringify(before, null, 2));

    // 点击 ENTER（如果按钮已经就绪）
    const clicked = await evaluate(`(() => {
      const btn = document.querySelector('.brand__enter');
      if (!btn) return 'no-enter-button';
      btn.click();
      return 'clicked';
    })()`);
    console.log('\nENTER:', clicked);
    await sleep(4000);

    console.log('\n== ENTER 之后（遮罩撤掉、页面可滚） ==');
    const after = await evaluate(MEASURE);
    console.log(JSON.stringify(after, null, 2));

    console.log('\n位移: scrollbarWidth', before.scrollbarWidth, '->', after.scrollbarWidth);
    console.log('      appRight      ', before.appRight, '->', after.appRight);
    console.log('      appWidth      ', before.appWidth, '->', after.appWidth);

    // 页脚指针命中：滚到页脚，取 <footer> 的视口坐标，用视口坐标做 elementFromPoint，
    // 看命中的是不是页脚本身（指针"位置不符合"会在这里露出来）。
    console.log('\n== 页脚命中测试 ==');
    const footerProbe = await evaluate(`(async () => {
      const footer = document.querySelector('footer');
      if (!footer) return { error: 'no footer' };
      footer.scrollIntoView({ block: 'end' });
      await new Promise(r => setTimeout(r, 400));
      const r = footer.getBoundingClientRect();
      const cs = getComputedStyle(footer);
      const probes = [];
      const xs = [r.left + 20, r.left + r.width / 2, r.right - 20];
      const ys = [r.top + 6, r.top + r.height / 2, r.bottom - 6];
      for (const x of xs) for (const y of ys) {
        const el = document.elementFromPoint(x, y);
        probes.push({ x: Math.round(x), y: Math.round(y), hit: el ? (el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').join('.') : '')) : null });
      }
      return {
        rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) },
        style: { position: cs.position, transform: cs.transform, zoom: cs.zoom, willChange: cs.willChange, filter: cs.filter, backdropFilter: cs.backdropFilter, pointerEvents: cs.pointerEvents, marginTop: cs.marginTop },
        scrollY: window.scrollY,
        docHeight: document.documentElement.scrollHeight,
        viewportH: window.innerHeight,
        probes,
      };
    })()`);
    console.log(JSON.stringify(footerProbe, null, 2));

    console.log('\n控制台错误:', consoleErrors.length ? consoleErrors : '（无）');
  } finally {
    try { ws && ws.close(); } catch {}
    child.kill();
    await sleep(600);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
})();
