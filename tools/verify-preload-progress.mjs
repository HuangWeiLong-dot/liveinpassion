// 验收：首屏 LIVE IN PASSION 的全站预载 + 字上的进度填充。
//
//   cd app && npm run build
//   npx vite preview --port 4174 --strictPort
//   node tools/verify-preload-progress.mjs http://localhost:4174
//
// 图片在 CDP 里统一伪造（1×1 PNG，20ms 延迟），否则真下约 500 张会把验收拖到
// 分钟级。断言的是**机制**：
//   1. 默认 NOT LIVE IN PASSION，ENTER 直接进场（进度保持 100%，没有全量请求）
//   2. 选 LIVE 后 --brand-progress 从 0 涨到 100（中间态存在），loading 期间
//      操作区隐藏、底板不淡
//   3. 预载范围是全站（唯一图片请求数 > 300），不是原来那十几张
//   4. 100% 之后入场动画才继续，最终 brand 收起、hero 出现
//   5. 零 console 报错

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
  return {
    progress: solid ? solid.style.getPropertyValue('--brand-progress') : null,
    brandClass: brand ? brand.className : '',
    actions: actions ? getComputedStyle(actions).display : null,
    hero: Boolean(document.querySelector('.hero-concept')),
  };
})()`;

async function waitBrandReady() {
  for (let i = 0; i < 40; i += 1) {
    if (await evaluate(`Boolean(document.querySelector('.brand.is-ready .brand__preload'))`)) return;
    await sleep(200);
  }
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
      }, 20);
    });

    // ── 1. 默认 NOT：ENTER 直接进场，没有全量请求 ───────────────────────
    console.log('默认 NOT LIVE IN PASSION:');
    const loaded = new Promise((res) => on('Page.loadEventFired', res));
    await send('Page.navigate', { url: baseUrl + '/' });
    await Promise.race([loaded, sleep(10000)]);
    await sleep(3500);
    await waitBrandReady();

    const initial = await evaluate(`JSON.stringify({
      options: [...document.querySelectorAll('.brand__preload-opt')].map((b) => ({
        text: b.textContent.trim(),
        on: b.classList.contains('is-on'),
      })),
      stored: localStorage.getItem('lip:first-screen-preload'),
    })`);
    const init = JSON.parse(initial);
    const notBtn = init.options.find((o) => o.text === 'NOT LIVE IN PASSION');
    check('默认选中 NOT LIVE IN PASSION', Boolean(notBtn?.on), initial);

    imageUrls.clear();
    await evaluate(`document.querySelector('.brand__enter')?.click()`);
    await sleep(250);
    const notState = await evaluate(STATE);
    check('默认路径 ENTER 不触发进度（保持 100%）', notState.progress === '100%', notState.progress);
    await sleep(2600);
    const notDone = await evaluate(STATE);
    check('默认路径很快完成入场', notDone.brandClass.includes('is-gone') && notDone.hero);
    check('默认路径没有全量预载', imageUrls.size < 100, `${imageUrls.size} 张图片请求`);

    // ── 2. LIVE：全站预载 + 字上进度 ────────────────────────────────────
    // 上一轮进场已经写下 `lip:visited`（还有同名 cookie），不清掉的话这一轮
    // 会走"刷新过场"：随机问题 + 自动进站，既没有 ENTER 也不会预载。
    await evaluate(`(() => {
      localStorage.removeItem('lip:visited');
      localStorage.removeItem('lip:first-screen-preload');
      document.cookie = 'lip_visited=; Max-Age=0; Path=/';
    })()`);
    console.log('\nLIVE IN PASSION:');
    await send('Page.navigate', { url: baseUrl + '/' });
    await sleep(3500);
    await waitBrandReady();
    await evaluate(`[...document.querySelectorAll('.brand__preload-opt')]
      .find((b) => b.textContent.trim() === 'LIVE IN PASSION')?.click()`);
    await sleep(250);
    const chosen = await evaluate(`JSON.stringify({
      stored: localStorage.getItem('lip:first-screen-preload'),
      liveOn: [...document.querySelectorAll('.brand__preload-opt')]
        .find((b) => b.textContent.trim() === 'LIVE IN PASSION')?.classList.contains('is-on'),
    })`);
    const chosenState = JSON.parse(chosen);
    check('选 LIVE 后写入 localStorage 并高亮', chosenState.stored === '1' && chosenState.liveOn, chosen);

    imageUrls.clear();
    await evaluate(`document.querySelector('.brand__enter')?.click()`);
    const seq = [];
    for (let i = 0; i < 36; i += 1) {
      await sleep(150);
      seq.push(await evaluate(STATE));
    }
    const values = seq
      .map((s) => Number(String(s.progress || '').replace('%', '')))
      .filter((n) => Number.isFinite(n));
    const sawMid = values.some((v) => v > 0 && v < 100);
    const reached = values.some((v) => v >= 100);
    check('字上进度经过中间态', sawMid, seq.map((s) => s.progress).slice(0, 8).join(' → '));
    check('字上进度到达 100%', reached);
    check('loading 期间操作区隐藏', seq.some((s) => s.actions === 'none' && s.progress !== '100%'));
    check('预载的是全站资源（>300 张）', imageUrls.size > 300, `${imageUrls.size} 张图片请求`);
    check('进度完成前不收起品牌遮罩',
      seq.filter((s) => s.progress !== '100%').every((s) => !s.brandClass.includes('is-gone')));
    await sleep(2600);
    const finalState = await evaluate(STATE);
    check('100% 之后才完成入场', finalState.brandClass.includes('is-gone') && finalState.hero);

    // ── 3. 刷新过场：上一轮已经写下 lip:visited，这次不再出现 ENTER ──────
    console.log('\n刷新过场:');
    await send('Page.navigate', { url: baseUrl + '/' });
    await sleep(2600);
    // 自动进站的时序是「字体就绪 → 900ms → 上浮/回落/撤场」，等它走完
    for (let i = 0; i < 30; i += 1) {
      const gone = await evaluate(`document.querySelector('.brand')?.classList.contains('is-gone') ?? true`);
      if (gone) break;
      await sleep(250);
    }
    const refreshState = JSON.parse(await evaluate(`JSON.stringify({
      text: document.querySelector('.brand__solid')?.textContent.trim() || '',
      enterShown: [...document.querySelectorAll('.brand__enter')].some((b) => b.offsetParent !== null),
      gone: document.querySelector('.brand')?.classList.contains('is-gone') ?? true,
      hero: Boolean(document.querySelector('.hero-concept')),
    })`));
    check('刷新后字换成一个问题（不再是 LIVEINPASSION）',
      Boolean(refreshState.text) && refreshState.text !== 'LIVEINPASSION', refreshState.text);
    check('刷新过场没有 ENTER 按钮', !refreshState.enterShown);
    check('刷新过场自动进站', refreshState.gone && refreshState.hero);

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
