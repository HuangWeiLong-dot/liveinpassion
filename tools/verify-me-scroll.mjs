// ME 页滚动体验验收：EXPLORE 门禁 / 有限纵深隧道 / 三张独立卡片 / 左侧导航 /
// 红蓝人像切换 / GitHub Activity 图完整显示 / 无页脚 / 零控制台报错。
//
//   cd app && npm run build && npx vite preview --port 4174 --strictPort
//   node tools/verify-me-scroll.mjs http://localhost:4174/me
//
// 隧道 30 张照片来自 CMS，本地能访问外网时才有完整画面；断言只看 DOM 与
// 计算样式，不依赖具体是哪一张图。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const url = process.argv[2] || 'http://localhost:4174/me';
const outDir = process.env.ME_OUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'me-scroll-'));
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(ok, label, detail = '') {
  results.push({ ok: Boolean(ok), label, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function withPage(fn) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'me-scroll-profile-'));
  const child = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
    '--window-size=1440,1000', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    let port = null;
    for (let i = 0; i < 120 && !port; i += 1) {
      try {
        const line = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
        if (line) port = Number(line);
      } catch {}
      if (!port) await sleep(400);
    }
    if (!port) throw new Error('Chrome 没有写出 DevToolsActivePort');

    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

    let id = 0;
    const pending = new Map();
    const handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      } else if (m.method && handlers.has(m.method)) {
        for (const f of handlers.get(m.method)) f(m.params);
      }
    });
    const send = (method, params = {}) => {
      const i = ++id;
      return new Promise((res, rej) => {
        pending.set(i, { res, rej });
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    };
    const on = (method, fn) => {
      if (!handlers.has(method)) handlers.set(method, []);
      handlers.get(method).push(fn);
    };
    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', {
        expression: expr, awaitPromise: true, returnByValue: true,
      });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
      }
      return r.result.value;
    };

    const errors = [];
    on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') errors.push((p.args || []).map((a) => a.value ?? a.description).join(' '));
    });
    on('Runtime.exceptionThrown', (p) => {
      errors.push('EXCEPTION ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
    });

    async function gotoMe() {
      await send('Page.navigate', { url });
      await sleep(3000);
      for (let i = 0; i < 25; i += 1) {
        const ready = await evaluate(`(() => {
          const b = document.querySelector('.brand__enter');
          return !!b && getComputedStyle(b).display !== 'none';
        })()`);
        if (ready) break;
        await sleep(300);
      }
      const hasEnter = await evaluate(`!!document.querySelector('.brand__enter')`);
      if (hasEnter) {
        await evaluate(`document.querySelector('.brand__enter').click()`, { userGesture: true });
        await sleep(3000);
      }
    }

    return await fn({ evaluate, send, gotoMe, errors });
  } finally {
    child.kill();
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

await withPage(async ({ evaluate, send, gotoMe, errors }) => {
  await gotoMe();

  // ── EXPLORE 门禁 ──────────────────────────────────────────────────────
  const gate = await evaluate(`(() => ({
    exists: !!document.querySelector('.me-explore'),
    nav: !!document.querySelector('.me-nav'),
    footer: !!document.querySelector('.site-footer'),
    scrollY,
  }))()`);
  check(gate.exists, '进来先显示 EXPLORE 门禁');
  check(!gate.nav, '门禁还在时左侧导航不出现');
  check(!gate.footer, 'ME 页不挂全局页脚');

  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: 720, y: 500, deltaX: 0, deltaY: 900,
  });
  await sleep(600);
  const locked = await evaluate('scrollY');
  check(locked === 0, '门禁期间滚轮被锁住', `scrollY=${locked}`);

  // ── EXPLORE 自动滚动 ──────────────────────────────────────────────────
  await evaluate(`document.querySelector('.me-explore__button').click()`, { userGesture: true });
  await sleep(1100);
  const auto = await evaluate('Math.round(scrollY)');
  check(auto > 100, '点 EXPLORE 后自动开始滚动', `scrollY=${auto}`);

  // 等自动滚动走完（7s 的慢速巡游）
  await sleep(7400);
  const end = await evaluate(`(() => ({
    scrollY: Math.round(scrollY),
    max: Math.round(document.documentElement.scrollHeight - innerHeight),
    visibleTunnel: [...document.querySelectorAll('.me-tunnel__card')]
      .filter((el) => Number(getComputedStyle(el).opacity) > 0.01).length,
  }))()`);
  check(Math.abs(end.scrollY - end.max) < 3, '自动滚动走完整段', `${end.scrollY}/${end.max}`);
  check(end.visibleTunnel === 0, '卡片窗口出现前隧道照片已经全部飞出镜头',
    `${end.visibleTunnel} 张还可见`);

  // ── 左侧导航 ──────────────────────────────────────────────────────────
  const nav = await evaluate(`(() => {
    const items = [...document.querySelectorAll('.me-nav__item')];
    return {
      labels: items.map((b) => b.textContent.replace(/\\s+/g, ' ').trim()),
      active: items.find((b) => b.classList.contains('is-active'))?.textContent.trim(),
      numbers: items.some((b) => /\\b0?[123]\\b/.test(b.textContent)),
    };
  })()`);
  check(nav.labels.join('|') === 'ME|GALLERY|FRIENDS', '左侧导航只有三个窗口名',
    nav.labels.join(' | '));
  check(!nav.numbers, '导航里没有 01/02/03 编号');
  check(nav.active === 'FRIENDS', '滚到页尾时 FRIENDS 高亮', nav.active);

  await evaluate(`[...document.querySelectorAll('.me-nav__item')]
    .find((b) => b.textContent.includes('ME')).click()`, { userGesture: true });
  await sleep(1400);
  const afterNav = await evaluate(`(() => ({
    active: [...document.querySelectorAll('.me-nav__item')]
      .find((b) => b.classList.contains('is-active'))?.textContent.trim(),
    top: Math.round(document.querySelector('.me-beam--me').getBoundingClientRect().top + scrollY),
    scrollY: Math.round(scrollY),
  }))()`);
  check(afterNav.active === 'ME', '点导航后 ME 高亮', afterNav.active);
  check(Math.abs(afterNav.scrollY - afterNav.top) < 4, '点导航跳到对应窗口',
    `scrollY=${afterNav.scrollY}, sectionTop=${afterNav.top}`);

  // ── 人像红蓝切换 ──────────────────────────────────────────────────────
  const portraitSample = `(() => {
    const out = [];
    document.querySelectorAll('.me-beam--me .me-beam__portrait, .me-beam--gallery .me-beam__portrait').forEach((layer) => {
      if (!layer.classList.contains('is-on')) return;
      out.push(layer.querySelector('.me-beam__img--color')?.getAttribute('src') || '');
    });
    return out;
  })()`;
  const before = await evaluate(portraitSample);
  await sleep(6000);
  const after = await evaluate(portraitSample);
  check(before.length === 2, '两个窗口各有一张当前可见人像', JSON.stringify(before));
  check(before.join('|') !== after.join('|'), '人像会自动切换', `${before.join(' + ')} → ${after.join(' + ')}`);
  const colors = (list) => list.map((s) => (s.includes('_red_') ? 'red' : s.includes('_blue_') ? 'blue' : ''));
  check(
    colors(after).includes('red') && colors(after).includes('blue'),
    '任意时刻一张红、一张蓝',
    colors(after).join(' + ')
  );

  // ── GitHub Activity 图 ────────────────────────────────────────────────
  const snake = await evaluate(`(() => {
    const img = document.querySelector('.me-snake__crop img');
    if (!img) return null;
    const cs = getComputedStyle(img);
    return { fit: cs.objectFit, w: img.naturalWidth, h: img.naturalHeight };
  })()`);
  check(snake && snake.w > 0, 'GitHub Activity 图已加载', snake ? `${snake.w}×${snake.h}` : 'MISSING');
  check(snake && snake.fit === 'contain', 'GitHub Activity 图完整放进卡片（不裁边）', snake?.fit);

  // ── 截图 ──────────────────────────────────────────────────────────────
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, 'me-card.png'), Buffer.from(shot.data, 'base64'));

  // ── SKIP 门禁 ─────────────────────────────────────────────────────────
  await gotoMe();
  await evaluate(`document.querySelector('.me-explore__skip').click()`, { userGesture: true });
  await sleep(900);
  const skip = await evaluate(`(() => ({
    scrollY: Math.round(scrollY),
    top: Math.round(document.querySelector('.me-beam--me').getBoundingClientRect().top + scrollY),
    gate: !!document.querySelector('.me-explore'),
  }))()`);
  check(!skip.gate, 'SKIP 之后门禁消失');
  check(Math.abs(skip.scrollY - skip.top) < 4, 'SKIP 直接落在第一张卡片',
    `scrollY=${skip.scrollY}, sectionTop=${skip.top}`);

  check(errors.length === 0, '零控制台报错', errors.join(' | '));
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
console.log(`截图：${outDir}`);
if (failed.length) process.exit(1);
