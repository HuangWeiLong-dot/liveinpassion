// 验收：CoverFlight 飞行层（ECHOES 封面 + 三个相册灯箱）+ FILM 返回 HOME 的类清理。
//
//   cd app && npm run build
//   npx vite preview --port 4174 --strictPort
//   node tools/verify-cover-flight.mjs http://localhost:4174
//
// 断言的核心不是"有动画"，而是**同一张图、同一个元素**从起点连续走到终点：
//   · 路由切换时飞行层不能消失（它挂在 body 上，跨视图存活）
//   · 灯箱自己的图在飞行期间 opacity = 0，落地后才交还
//   · 返回时的落点是**现场量**的（切篇后的归档焦点、灯箱来源窗口）
//   · FILM 是 keep-alive 页：离开后 projection-page 必须摘掉，否则 HOME 的
//     头部字色和左下角 Avatar 会坏掉

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const baseUrl = (process.argv[2] || 'http://localhost:4174').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let id = 0;
const pending = new Map();
const handlers = new Map();
let ws;
const send = (method, params = {}) => {
  const i = ++id;
  return new Promise((res, rej) => {
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
};
const on = (m, f) => {
  if (!handlers.has(m)) handlers.set(m, []);
  handlers.get(m).push(f);
};
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
};

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
};

const consoleErrors = [];

const FLIGHT = `(() => {
  const layer = document.querySelector('.cover-flight');
  if (!layer) return { missing: true };
  const r = layer.getBoundingClientRect();
  const cs = getComputedStyle(layer);
  return {
    missing: false,
    visible: cs.display !== 'none' && Number(cs.opacity) > 0.05,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
  };
})()`;

const detailCover = `(() => {
  const inner = document.querySelector('.bd-media__inner');
  const r = inner ? inner.getBoundingClientRect() : null;
  return inner ? {
    opacity: Number(getComputedStyle(inner).opacity),
    rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
  } : null;
})()`;

async function navigateAndEnter(url) {
  await send('Page.navigate', { url });
  await sleep(4200);
  for (let i = 0; i < 45; i += 1) {
    const ok = await evaluate(
      `getComputedStyle(document.querySelector('.author-tower') || document.body).opacity === '1'`
    );
    if (ok) break;
    await evaluate(`document.querySelector('.brand__enter')?.click()`);
    await sleep(200);
  }
  await sleep(800);
}

const distance = (a, b) => (a && b
  ? Math.hypot(a.x - b.x, a.y - b.y) + Math.abs(a.w - b.w) + Math.abs(a.h - b.h)
  : 999);

(async () => {
  const port = 9940 + Math.floor(Math.random() * 40);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-prof-'));
  const child = spawn(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
     '--no-first-run', '--disable-gpu', '--disable-extensions', '--window-size=1440,900', 'about:blank'],
    { stdio: 'ignore' }
  );

  try {
    let ready = false;
    for (let i = 0; i < 80 && !ready; i += 1) {
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
      } else if (m.method && handlers.has(m.method)) {
        for (const f of handlers.get(m.method)) f(m.params);
      }
    });

    await send('Page.enable');
    await send('Runtime.enable');
    on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') consoleErrors.push((p.args || []).map((a) => a.value || a.description || '').join(' '));
    });
    on('Runtime.exceptionThrown', (p) => {
      consoleErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'exception');
    });

    // ── 1. ECHOES：封面飞进详情，ESC 飞回 ────────────────────────────────
    console.log('ECHOES 封面:');
    await navigateAndEnter(`${baseUrl}/echoes`);
    const slug = await evaluate(`document.querySelector('.ba-frame.is-active')?.dataset.slug || ''`);
    check('ARCHIVE 找到当前篇', Boolean(slug), slug);
    const sourceRect = await evaluate(`(() => {
      const img = document.querySelector('.ba-frame.is-active img');
      const r = img.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
    })()`).then(JSON.parse);

    await evaluate(`document.querySelector('.ba-frame.is-active').click()`);
    await sleep(80);
    const f1 = await evaluate(FLIGHT);
    check('点击后飞行层立刻出现', f1.missing === false && f1.visible, JSON.stringify(f1.rect));
    check('起点贴着被点的相框', distance(f1.rect, sourceRect) < 40, `${distance(f1.rect, sourceRect).toFixed(0)}px`);

    await sleep(300);
    const mid = await evaluate(FLIGHT);
    check('路由切换后飞行层仍在（跨视图存活）', mid.visible, JSON.stringify(mid.rect));
    const innerMid = await evaluate(detailCover);
    check('详情自己的封面在飞行期间是隐藏的', innerMid && innerMid.opacity < 0.05, `opacity=${innerMid?.opacity}`);

    await sleep(900);
    const landedInner = await evaluate(detailCover);
    const layerGone = await evaluate(FLIGHT);
    check('落地：灯箱外的详情封面交还', landedInner && landedInner.opacity > 0.9, `opacity=${landedInner?.opacity}`);
    check('落地：飞行层收起', !layerGone.visible);

    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await sleep(90);
    const exitStart = await evaluate(FLIGHT);
    check('ESC：飞行层从详情封面起飞', exitStart.visible, JSON.stringify(exitStart.rect));
    await sleep(320);
    const exitMid = await evaluate(FLIGHT);
    check('返回换页期间飞行层仍在', exitMid.visible, JSON.stringify(exitMid.rect));
    await sleep(900);
    const exitEnd = await evaluate(FLIGHT);
    const targetImg = await evaluate(`(() => {
      const img = document.querySelector('.ba-frame[data-slug="${slug}"] img');
      return img ? Number(getComputedStyle(img).opacity) : -1;
    })()`);
    check('返回落地：飞行层收起、相框的图重新可见', !exitEnd.visible && targetImg > 0.9, `img opacity=${targetImg}`);

    // ── 2. 灯箱：PHOTOGRAPHY / GALLERY / ME GALLERY ────────────────────
    for (const [label, url, cardSel, closeScript] of [
      ['PHOTOGRAPHY', `${baseUrl}/photography/HanYong`, '.ph-window',
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`],
      ['GALLERY', `${baseUrl}/gallery`, '.win--filled',
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`],
      ['ME GALLERY', `${baseUrl}/me/gallery`, '.win--filled',
        `document.querySelector('.me-photo-lightbox-close')?.click()`],
    ]) {
      console.log(`\n${label} 灯箱:`);
      await navigateAndEnter(url);
      const card = await evaluate(`(() => {
        const el = [...document.querySelectorAll('${cardSel}')].find((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 40 && r.height > 40 && r.right > 0 && r.left < innerWidth
            && r.bottom > 40 && r.top < innerHeight - 40;
        });
        if (!el) return null;
        const img = el.querySelector('img') || el;
        const r = img.getBoundingClientRect();
        return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height });
      })()`);
      check('找到可点的照片窗', Boolean(card));
      const cardRect = card ? JSON.parse(card) : null;
      await evaluate(`(() => {
        const el = [...document.querySelectorAll('${cardSel}')].find((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 40 && r.height > 40 && r.right > 0 && r.left < innerWidth
            && r.bottom > 40 && r.top < innerHeight - 40;
        });
        el?.click();
      })()`);
      await sleep(90);
      const openFlight = await evaluate(FLIGHT);
      check('打开：飞行层从窗口起飞', openFlight.visible, JSON.stringify(openFlight.rect));
      check('打开：起点对着窗口', distance(openFlight.rect, cardRect) < 24, `${distance(openFlight.rect, cardRect).toFixed(0)}px`);
      await sleep(1400);
      const lbImg = await evaluate(`(() => {
        // 两个灯箱都常驻 DOM：必须取**打开着的那个**，否则会读到全局灯箱里
        // opacity: 0 的那张（ME 测的就是这个坑）
        const img = document.querySelector('.me-photo-lightbox.active .me-photo-lightbox-full')
          || document.querySelector('.lightbox.active .lightbox-img');
        return img ? Number(getComputedStyle(img).opacity) : -1;
      })()`);
      const openEnd = await evaluate(FLIGHT);
      check('打开落地：灯箱大图交还、飞行层收起', !openEnd.visible && lbImg > 0.9, `img opacity=${lbImg}`);

      await evaluate(closeScript);
      await sleep(90);
      const closeStart = await evaluate(FLIGHT);
      check('关闭：飞行层从大图起飞', closeStart.visible, JSON.stringify(closeStart.rect));
      await sleep(1100);
      const closeEnd = await evaluate(FLIGHT);
      check('关闭落地：飞行层收起', !closeEnd.visible);
    }

    // ── 3. FILM → HOME 的 keep-alive 类清理 ───────────────────────────
    console.log('\nFILM → HOME:');
    await navigateAndEnter(`${baseUrl}/projection`);
    const filmClass = await evaluate(`document.documentElement.classList.contains('projection-page')`);
    check('FILM 页挂上 projection-page', filmClass);
    await evaluate(`document.querySelector('a[href="/"]').click()`);
    await sleep(2800);
    const home = await evaluate(`JSON.stringify({
      projectionPage: document.documentElement.classList.contains('projection-page'),
      towerOpacity: getComputedStyle(document.querySelector('.author-tower') || document.body).opacity,
      headerColor: getComputedStyle(document.querySelector('#header nav a') || document.body).color,
    })`);
    const h = JSON.parse(home);
    check('回 HOME 后 projection-page 已摘掉', !h.projectionPage);
    check('左下角 Avatar 回来', Number(h.towerOpacity) > 0.9, `opacity=${h.towerOpacity}`);

    console.log('\n控制台:');
    const clean = consoleErrors.filter((e) => e && !/Failed to load resource/i.test(e));
    check('零 console 报错 / 未捕获异常', clean.length === 0, clean.slice(0, 3).join(' | '));
  } finally {
    try { await send('Browser.close'); } catch {}
    child.kill();
    await sleep(400);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} 条通过`);
    process.exit(failed.length ? 1 : 0);
  }
})();
