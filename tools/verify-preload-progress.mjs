// 验收：首屏 LIVE IN PASSION 预载 + 字上进度 + 拼贴 + 读数/SKIP + 问题暂停。
//
//   cd app && npm run build
//   npx vite preview --port 4174 --strictPort
//   node tools/verify-preload-progress.mjs http://localhost:4174
//
// 图片在 CDP 里统一伪造（1×1 PNG，60ms 延迟），否则真下约 500 张会把验收拖到
// 分钟级。断言的是机制：
//   1. 默认 LIVE + NOT PATIENT（首屏优先，30 张）
//   2. loading 期间：字上进度有中间态、读数（百分比/数量）、SKIP、纵向问题、
//      字后面的拼贴；操作区隐藏
//   3. PATIENT（全站）：图片请求 > 300；点问题暂停/继续；SKIP 立即进站
//   4. NOT LIVE IN PASSION：ENTER 不预载
//   5. 首次进站后刷新：字换成随机问题，不再出现 ENTER
//   6. 零 console 报错

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const baseUrl = (process.argv[2] || 'http://localhost:4174').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

const imageUrls = new Set();
const consoleErrors = [];

const STATE = `(() => {
  const solid = document.querySelector('.brand__solid');
  const brand = document.querySelector('.brand');
  const actions = document.querySelector('.brand__actions');
  const meta = document.querySelector('.brand__loadmeta');
  const ticker = document.querySelector('.brand__ticker');
  const track = ticker?.querySelector('.brand__ticker-track');
  const collage = document.querySelector('.brand__collage');
  return {
    progress: solid ? solid.style.getPropertyValue('--brand-progress') : null,
    brandClass: brand ? brand.className : '',
    actions: actions ? getComputedStyle(actions).display : null,
    meta: meta ? meta.textContent.replace(/\\s+/g, ' ').trim() : null,
    skip: Boolean(document.querySelector('.brand__skip')),
    ticker: Boolean(ticker),
    tickerText: ticker ? ticker.textContent.replace(/\\s+/g, ' ').trim() : '',
    tickerState: track ? getComputedStyle(track).animationPlayState : null,
    collage: collage ? collage.querySelectorAll('.brand__collage__tile').length : 0,
    hero: Boolean(document.querySelector('.hero-concept')),
    questionMode: solid ? solid.classList.contains('is-question') : false,
    text: solid ? solid.textContent.trim() : '',
  };
})()`;

async function waitBrandReady() {
  for (let i = 0; i < 45; i += 1) {
    if (await evaluate(`Boolean(document.querySelector('.brand.is-ready .brand__preload'))`)) return;
    await sleep(200);
  }
}

async function freshFirstVisit({ scope, preload } = {}) {
  // 清掉 visited / cookie 与本次预载选择，回到"第一次进站"
  await evaluate(`(() => {
    try { localStorage.removeItem('lip:visited'); } catch {}
    try { document.cookie = 'lip_visited=; Max-Age=0; Path=/'; } catch {}
    try {
      localStorage.removeItem('lip:first-screen-preload-v2');
      localStorage.removeItem('lip:first-screen-preload-mode-v2');
    } catch {}
  })()`);
  await send('Page.navigate', { url: baseUrl + '/' });
  await sleep(3500);
  await waitBrandReady();
  if (preload === 'none') {
    await evaluate(`[...document.querySelectorAll('.brand__preload-opt')]
      .find((b) => b.textContent.trim() === 'NOT LIVE IN PASSION')?.click()`);
  } else if (scope === 'full') {
    await evaluate(`[...document.querySelectorAll('.brand__preload-opt')]
      .find((b) => b.textContent.trim() === 'PATIENT')?.click()`);
  }
  await sleep(200);
}

(async () => {
  const port = 9950 + Math.floor(Math.random() * 40);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preload-prof-'));
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
    await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });

    on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') consoleErrors.push((p.args || []).map((a) => a.value || a.description || '').join(' '));
    });
    on('Runtime.exceptionThrown', (p) => {
      consoleErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'exception');
    });
    on('Fetch.requestPaused', (p) => {
      const { requestId, resourceType, request } = p;
      if (resourceType !== 'Image') {
        send('Fetch.continueRequest', { requestId }).catch(() => {});
        return;
      }
      imageUrls.add(request.url);
      setTimeout(() => {
        send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'Content-Type', value: 'image/png' },
            { name: 'Access-Control-Allow-Origin', value: '*' },
            { name: 'Cache-Control', value: 'max-age=3600' },
          ],
          body: PNG,
        }).catch(() => {});
      }, 60);
    });

    // ── 1. 默认 LIVE + NOT PATIENT：首屏优先 ────────────────────────────
    console.log('默认 LIVE + NOT PATIENT:');
    await freshFirstVisit();
    const initial = await evaluate(`JSON.stringify(
      [...document.querySelectorAll('.brand__preload-opt')].map((b) => ({
        text: b.textContent.trim(),
        on: b.classList.contains('is-on'),
      }))
    )`);
    const opts = JSON.parse(initial);
    const onOf = (text) => Boolean(opts.find((o) => o.text === text)?.on);
    check('默认 LIVE IN PASSION', onOf('LIVE IN PASSION'), initial);
    check('默认 NOT PATIENT（首屏优先）', onOf('NOT PATIENT'), initial);

    await evaluate(`document.querySelector('.brand__enter')?.click()`);
    const seq = [];
    for (let i = 0; i < 10; i += 1) {
      await sleep(90);
      seq.push(await evaluate(STATE));
    }
    const values = seq.map((s) => Number(String(s.progress || '').replace('%', ''))).filter(Number.isFinite);
    check('字上进度经过中间态', values.some((v) => v > 0 && v < 100), seq.map((s) => s.progress).slice(0, 6).join(' → '));
    check('loading 期间操作区隐藏', seq.some((s) => s.actions === 'none'));
    check('有百分比 / 数量读数', seq.some((s) => s.meta && /\d+%/.test(s.meta) && /\/\s*\d+/.test(s.meta)), seq[0]?.meta);
    check('有 SKIP', seq.some((s) => s.skip));
    check('字后面有图片拼贴', seq.some((s) => s.collage > 0), `${Math.max(...seq.map((s) => s.collage))} 格`);
    check('有问题纵向滚动带', seq.some((s) => s.ticker && s.tickerText.includes('WHO ARE YOU?')));
    await sleep(2800);
    const afterQuick = await evaluate(STATE);
    check('首屏批次完成后进站', afterQuick.brandClass.includes('is-gone') && afterQuick.hero);

    // ── 2. PATIENT：全站 + 问题暂停/继续 + SKIP ────────────────────────
    console.log('\nPATIENT（全站）:');
    await freshFirstVisit({ scope: 'full' });
    imageUrls.clear();
    await evaluate(`document.querySelector('.brand__enter')?.click()`);
    await sleep(420);
    const fullState = await evaluate(STATE);
    check('PATIENT 使用全站总量（>300）', Number(String(fullState.meta || '').match(/\/(\d+)/)?.[1] || 0) > 300,
      fullState.meta);
    check('全站加载期间有问题带', fullState.ticker);
    await evaluate(`document.querySelector('.brand__ticker-item')?.click()`);
    await sleep(120);
    const paused = await evaluate(STATE);
    check('点问题暂停滚动', paused.tickerState === 'paused', paused.tickerState);
    await evaluate(`document.querySelector('.brand__ticker-item')?.click()`);
    await sleep(120);
    const resumed = await evaluate(STATE);
    check('再点继续滚动', resumed.tickerState === 'running', resumed.tickerState);
    await evaluate(`document.querySelector('.brand__skip')?.click()`);
    await sleep(2800);
    const skipped = await evaluate(STATE);
    check('SKIP 立即进站', skipped.brandClass.includes('is-gone') && skipped.hero);
    check('全站请求确实发生（>300）', imageUrls.size > 300, `${imageUrls.size} 张`);

    // ── 3. NOT LIVE：不预载 ─────────────────────────────────────────────
    console.log('\nNOT LIVE IN PASSION:');
    await freshFirstVisit({ preload: 'none' });
    imageUrls.clear();
    await evaluate(`document.querySelector('.brand__enter')?.click()`);
    await sleep(300);
    const notState = await evaluate(STATE);
    check('NOT 路径没有 loading 读数/问题带', !notState.meta && !notState.ticker);
    await sleep(2600);
    const notDone = await evaluate(STATE);
    check('NOT 路径直接进站', notDone.brandClass.includes('is-gone') && notDone.hero);
    check('NOT 路径没有全量请求', imageUrls.size < 100, `${imageUrls.size} 张`);

    // ── 4. 刷新：随机问题，不再要 ENTER ───────────────────────────────
    console.log('\n刷新过场:');
    await send('Page.navigate', { url: baseUrl + '/' });
    await sleep(3000);
    await waitBrandReady();
    const refresh = await evaluate(STATE);
    check('刷新后字是问题', refresh.questionMode && refresh.text !== 'LIVEINPASSION', refresh.text);
    check('刷新过场不显示 ENTER / 预载选择', refresh.actions === 'none');
    await sleep(2600);
    const refreshDone = await evaluate(STATE);
    check('问题过场自动进站', refreshDone.brandClass.includes('is-gone') && refreshDone.hero);

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
