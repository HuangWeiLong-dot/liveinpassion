// 页脚指针错位诊断（新旧两站通用）。
//
//   node tools/diag-footer-hover.mjs http://127.0.0.1:8123 [--legacy]
//
// 关注点：指针停在页脚处时，**谁**真的接到了指针（:hover / :active 的元素），
// 和"看到的那个元素"是否一致；以及右侧悬浮控件是否压在页脚上。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const baseUrl = (process.argv[2] || 'http://127.0.0.1:8123').replace(/\/$/, '');
const legacy = process.argv.includes('--legacy');
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
const move = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0, pointerType: 'mouse' });
  await sleep(200);
};

const tag = `const tag = (el) => {
  if (!el) return null;
  let c = el.getAttribute && el.getAttribute('class');
  c = c ? '.' + String(c).trim().split(/\\s+/)[0] : '';
  return el.tagName + c;
};`;

const STATE = `(() => {
  ${tag}
  const hovered = [...document.querySelectorAll(':hover')].map(tag).filter(Boolean);
  const e = window.__lastMove;
  return {
    scrollY: Math.round(window.scrollY),
    lastMove: e ? { x: e.clientX, y: e.clientY, target: tag(e.target) } : null,
    hoverChain: hovered,
    pointHit: (e && Number.isFinite(e.clientX) && Number.isFinite(e.clientY) && e.clientY >= 0 && e.clientY < window.innerHeight && e.clientX >= 0 && e.clientX < window.innerWidth)
      ? tag(document.elementFromPoint(e.clientX, e.clientY)) : null,
  };
})()`;

(async () => {
  const port = 9930 + Math.floor(Math.random() * 40);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-fh-'));
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
      source: `window.__lastMove = null;
        document.addEventListener('mousemove', (e) => { window.__lastMove = { x: e.clientX, y: e.clientY, target: e.target }; }, true);`,    });

    await send('Page.navigate', { url: baseUrl + '/' });
    await sleep(legacy ? 4500 : 1500);
    if (!legacy) {
      await evaluate(`document.querySelector('.brand__enter')?.click()`);
      await sleep(4200);
    }
    // 关掉平滑滚动，避免测量落在滚动中途
    await evaluate(`document.documentElement.style.scrollBehavior = 'auto'; document.body.style.scrollBehavior = 'auto';`);
    // 旧站：把加载遮罩和 no-scroll 直接收掉，模拟"ENTER 之后"
    if (legacy) {
      await evaluate(`(() => { const l = document.getElementById('loader'); if (l) l.classList.add('hidden'); document.body.classList.remove('no-scroll'); })()`);
      await sleep(300);
    }

    console.log('== 布局概览 ==');
    console.log(await evaluate(`JSON.stringify((() => {
      const de = document.documentElement;
      return {
        innerWidth: innerWidth, clientWidth: de.clientWidth, scrollbarWidth: innerWidth - de.clientWidth,
        docHeight: de.scrollHeight, bodyOverflowY: getComputedStyle(document.body).overflowY,
      };
    })())`));

    console.log('\n== 右下角悬浮控件（fixed）与页脚的几何关系 ==');
    console.log(await evaluate(`JSON.stringify((() => {
      const sel = ['.theme-toggle', '.music-toggle-btn', '.author-section', 'footer'];
      const out = {};
      for (const s of sel) {
        const el = document.querySelector(s);
        if (!el) { out[s] = null; continue; }
        const r = el.getBoundingClientRect();
        out[s] = { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), vis: getComputedStyle(el).visibility, op: getComputedStyle(el).opacity };
      }
      return out;
    })())`));

    // 滚到页脚（先关掉平滑滚动，否则量到的是滚动中途的坐标）
    await evaluate(`(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      document.body.style.scrollBehavior = 'auto';
      const f = document.querySelector('footer');
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
    })()`);
    await sleep(700);
    const geo = JSON.parse(await evaluate(`JSON.stringify((() => {
      const r = document.querySelector('footer').getBoundingClientRect();
      const p = document.querySelector('footer p').getBoundingClientRect();
      return {
        scrollY: Math.round(window.scrollY),
        viewportH: innerHeight,
        footer: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) },
        p: { top: Math.round(p.top), bottom: Math.round(p.bottom), left: Math.round(p.left), right: Math.round(p.right) },
      };
    })())`));
    console.log('\n== 滚到页脚后 ==');
    console.log(JSON.stringify(geo));

    // 只在页脚实际可见的范围内探测
    const fy0 = Math.max(0, geo.footer.top + 8);
    const fy1 = Math.min(geo.viewportH - 8, geo.footer.bottom - 8);
    const ys = [...new Set([Math.round(fy0), Math.round((fy0 + fy1) / 2), Math.round(fy1)])];
    for (const y of ys) {
      for (const x of [40, 300, 720, 1100, 1400]) {
        await move(x, y);
        const s = await evaluate(STATE);
        console.log(`指针(${x},${y}) 命中=${s.pointHit}  hover=${JSON.stringify(s.hoverChain)}`);
      }
    }

    console.log('\n== 页脚文字正上方 ==');
    const cy = Math.round((geo.p.top + geo.p.bottom) / 2);
    console.log('文字矩形:', JSON.stringify(geo.p), '探测 y =', cy);
    const xsText = [geo.p.left + 30, Math.round((geo.p.left + geo.p.right) / 2), geo.p.right - 30].map((n) => Math.round(n));
    for (const x of xsText) {
      await move(x, cy);
      const s = await evaluate(STATE);
      console.log(`指针(${x},${cy}) 命中=${s.pointHit}  hover=${JSON.stringify(s.hoverChain)}`);
    }

    console.log('\n== 光标形状 ==');
    console.log(await evaluate(`(() => {
      ${tag}
      const y = ${cy};
      const out = [];
      for (const x of [40, 720, 1400]) {
        const el = document.elementFromPoint(x, y);
        out.push({ x, y, el: tag(el), cursor: el ? getComputedStyle(el).cursor : null });
      }
      return JSON.stringify(out);
    })()`));
  } finally {
    try { ws && ws.close(); } catch {}
    child.kill();
    await sleep(600);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
})();
