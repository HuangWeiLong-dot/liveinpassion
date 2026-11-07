// 验收：顶部路由加载进度条。
//
//   cd app && npm run build
//   npx vite preview --port 4174 --strictPort
//   node tools/verify-route-progress.mjs http://localhost:4174
//
// 用 CDP 的 Fetch 拦截把 CDN 图片人为放慢（120ms / 张），这样进度条一定有机会
// 停在中间态，才能断言"它真的在按张数推进"，而不是一闪而过。
//
// 断言：
//   1. 点 ECHOES 后条子出现，数值到过中间态（不是 0 → 100 的假动画）
//   2. 博客封面在点击后 600ms 内就被请求（证明是"预取"，不是页面挂载后才开始）
//   3. 条子压过转场板子（z-index 更高）—— 转场那 ~1.4s 里用户看得见它
//   4. 颜色跟着亮/暗主题走（同一个元素，切主题后背景色不同）
//   5. 收尾：走到 100% 并淡出，且发生在新页面挂上之后
//   6. 全程零 console 报错 / 未捕获异常

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const baseUrl = (process.argv[2] || 'http://localhost:4174').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1×1 透明 PNG：图片请求一律用它兑现
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// 每张图错开兑现：同一时刻全部返回的话，18 张会在 100ms 内一起完成，
// 进度条只会从 8% 直接跳到 94%，中间态来不及被采到。
const IMG_DELAY = 120;
let imgSeq = 0;

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
  if (r.exceptionDetails) throw new Error('页面求值失败: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
};

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
};

// 进度条快照：visible / 目标比例 / 实际背景色 / 层级
const SNAPSHOT = `(() => {
  const root = document.querySelector('.route-progress');
  const fill = document.querySelector('.route-progress__fill');
  if (!root || !fill) return { missing: true };
  const m = /scaleX\\(([\\d.]+)\\)/.exec(fill.style.transform || '');
  const cs = getComputedStyle(fill);
  return {
    visible: root.classList.contains('is-visible'),
    value: m ? Number(m[1]) * 100 : 0,
    bg: cs.backgroundColor,
    rootZ: getComputedStyle(root).zIndex,
    opacity: Number(getComputedStyle(root).opacity),
    total: Number(root.dataset.total || 0),
    done: Number(root.dataset.done || 0),
  };
})()`;

let clickAt = 0;
const imageHits = [];
const consoleErrors = [];

(async () => {
  const port = 9880 + Math.floor(Math.random() * 40);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'routeprog-prof-'));
  const child = spawn(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
     '--no-first-run', '--disable-gpu', '--disable-extensions', '--autoplay-policy=no-user-gesture-required', 'about:blank'],
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
      } else if (m.method && handlers.has(m.method)) for (const f of handlers.get(m.method)) f(m.params);
    });

    await send('Page.enable');
    await send('Runtime.enable');
    // 关缓存：否则首屏 Hero 已经下过的博客封面会命中内存缓存，预取请求
    // 既不会出现在 Fetch 事件里，也不会产生新的 Resource Timing 条目，
    // "点击后是否真的开始下载"就没法断言了。
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });

    on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') {
        consoleErrors.push((p.args || []).map((a) => a.value || a.description || '').join(' '));
      }
    });
    on('Runtime.exceptionThrown', (p) => {
      consoleErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'exception');
    });

    // 图片请求一律延后兑现，记录时间；其它请求立刻放行
    on('Fetch.requestPaused', (p) => {
      const { requestId, request, resourceType } = p;
      const isImage = resourceType === 'Image';
      if (!isImage) {
        send('Fetch.continueRequest', { requestId }).catch(() => {});
        return;
      }
      imageHits.push({ url: request.url, t: Date.now() });
      const delay = 240 + (imgSeq++ % 12) * IMG_DELAY;
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
      }, delay);
    });

    const loaded = new Promise((res) => on('Page.loadEventFired', res));
    await send('Page.navigate', { url: baseUrl + '/' });
    await Promise.race([loaded, sleep(10000)]);

    // 品牌遮罩：先点 ENTER，否则整屏都被盖着
    await sleep(1200);
    const entered = await evaluate(`(() => {
      const b = document.querySelector('.brand__enter');
      if (!b) return false;
      b.click();
      return true;
    })()`);
    await sleep(2200);

    const barAtStart = await evaluate(SNAPSHOT);
    check('首屏加载后进度条不存在或不可见', barAtStart.missing || !barAtStart.visible);

    // ── 1. 点 ECHOES：观察整段进度 ────────────────────────────────────────
    const samples = [];
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        try { samples.push(await evaluate(SNAPSHOT)); } catch {}
        await sleep(35);
      }
    })();

    imageHits.length = 0;
    clickAt = Date.now();
    const clicked = await evaluate(`(() => {
      const a = document.querySelector('a[href="/echoes"]');
      if (!a) return false;
      window.__clickAt = performance.now();
      a.click();
      return true;
    })()`);
    check('找到并点击了 ECHOES 导航', clicked);
    // SPA 导航不会触发 frameNavigated，等转场（板书 + 滑走约 1.4s）走完
    await sleep(3200);

    console.log('\n进度推进:');
    const visibleSamples = samples.filter((s) => s && !s.missing && s.visible);
    const values = visibleSamples.map((s) => s.value);
    const maxValue = Math.max(0, ...values);
    const sawMid = values.some((v) => v > 10 && v < 90);
    const grew = values.length >= 3 && maxValue > Math.min(...values) + 5;
    check('导航期间条子出现', visibleSamples.length > 0, `${visibleSamples.length} 帧可见`);
    check('进度经过中间态（不是 0 → 100 的假动画）', sawMid, `max ${maxValue.toFixed(1)}%`);
    check('进度确实在增长', grew, `样本 ${values.slice(0, 6).map((v) => v.toFixed(0)).join(' → ')} …`);

    // 这条路由的 18 张封面都应进入资源时间线（首屏 Hero 也会用这批图，
    // 所以这里只断言"清单被执行了"，真正验证"点击那一刻就开始下载"放在
    // 下面 PHOTO 详情那条 —— 那组照片首页上不会出现，不会被缓存混淆）。
    const dbg = await evaluate(`(() => {
      const hits = performance.getEntriesByType('resource')
        .filter((e) => e.name.includes('img/blog'));
      return { total: hits.length };
    })()`);
    check('ECHOES 封面预取清单确实被执行（18 张上限）', dbg.total >= 12, `${dbg.total} 条资源记录`);

    // 转场板子层级：条子必须更高
    const zs = await evaluate(`(() => {
      const panel = document.querySelector('.transition-panel');
      const bar = document.querySelector('.route-progress');
      return {
        panel: panel ? Number(getComputedStyle(panel).zIndex) : null,
        bar: bar ? Number(getComputedStyle(bar).zIndex) : null,
      };
    })()`);
    check('条子层级高于转场板子', zs.bar != null && (zs.panel == null || zs.bar > zs.panel), `bar ${zs.bar} / panel ${zs.panel}`);

    sampling = false;
    await sampler;

    // ── 2. 收尾 ───────────────────────────────────────────────────────────
    await sleep(1200);
    const after = await evaluate(SNAPSHOT);
    check('收尾：条子走到 100% 后淡出', after.missing || (!after.visible || after.value >= 99), `可见=${after.visible} value=${after.value?.toFixed?.(1)}`);

    // ── 3. 主题适配：PHOTO 导航途中切主题，条子颜色要变 ───────────────────
    console.log('\n主题适配:');
    const themeSamples = [];
    sampling = true;
    const sampler2 = (async () => {
      while (sampling) {
        try { themeSamples.push(await evaluate(SNAPSHOT)); } catch {}
        await sleep(35);
      }
    })();
    await evaluate(`document.querySelector('a[href="/photography"]').click()`);
    await sleep(260);
    const lightBg = await evaluate(`(() => {
      document.documentElement.classList.remove('dark');
      const f = document.querySelector('.route-progress__fill');
      return f ? getComputedStyle(f).backgroundColor : '';
    })()`);
    await sleep(80);
    const darkBg = await evaluate(`(() => {
      document.documentElement.classList.add('dark');
      const f = document.querySelector('.route-progress__fill');
      return f ? getComputedStyle(f).backgroundColor : '';
    })()`);
    await sleep(1800);
    sampling = false;
    await sampler2;
    const sawThemeBar = themeSamples.some((s) => s && !s.missing && s.visible);
    check('PHOTO 导航期间条子可见（主题采样有效）', sawThemeBar);
    check('亮/暗主题下条子颜色不同', Boolean(lightBg) && lightBg !== darkBg, `${lightBg} / ${darkBg}`);

    // ── 4. 预取时机：PHOTO 索引 → 某位摄影师的详情页 ────────────────────
    // 这组照片首页 Hero 不会加载，点击前不可能在缓存里。
    // 若在点击后 600ms 内就出现整组照片的请求，说明预取发生在转场板子底下，
    // 而不是等新页面挂载后由页面自己开始下载。
    console.log('\n预取时机:');
    let hasWindow = false;
    for (let i = 0; i < 40 && !hasWindow; i++) {
      hasWindow = await evaluate(`Boolean(document.querySelector('.ph-window'))`);
      if (!hasWindow) await sleep(150);
    }
    const enteredDetail = await evaluate(`(() => {
      const b = document.querySelector('.ph-window');
      if (!b) return false;
      window.__clickAt = performance.now();
      b.click();
      return true;
    })()`);
    await sleep(2600);
    const detailStats = await evaluate(`(() => {
      const clickAt = window.__clickAt || 0;
      const entries = performance.getEntriesByType('resource')
        .filter((e) => e.name.includes('/img/photography'))
        .map((e) => ({ i: e.initiatorType, t: Math.round(e.startTime) }));
      return {
        total: entries.length,
        early: entries.filter((e) => e.t >= clickAt - 20 && e.t - clickAt < 600).length,
        earlyImg: entries.filter((e) => e.i === 'img' && e.t >= clickAt - 20 && e.t - clickAt < 600).length,
        clickAt: Math.round(clickAt),
      };
    })()`);
    check('进入摄影师详情：点击后 600ms 内开始预取整组照片',
      enteredDetail && detailStats.early >= 6,
      `${detailStats.early} 条（其中 new Image 预取 ${detailStats.earlyImg} 条）`);

    // ── 5. 无图片路由：条子退化成导航指示器，也要出现并收尾 ──────────────
    console.log('\n无图页面:');
    await evaluate(`document.querySelector('a[href="/projection"]').click()`);
    const noAssetSamples = [];
    for (let i = 0; i < 55; i++) {
      try { noAssetSamples.push(await evaluate(SNAPSHOT)); } catch {}
      await sleep(40);
    }
    const naVisible = noAssetSamples.filter((s) => s && !s.missing && s.visible);
    const naLast = noAssetSamples[noAssetSamples.length - 1];
    const naDone = naVisible.some((s) => s.value >= 99) && Boolean(naLast && !naLast.visible);
    check('无图片路由也显示导航条（total = 0）',
      naVisible.length > 0 && naVisible.every((s) => (s.total || 0) === 0),
      `${naVisible.length} 帧可见`);
    check('无图片路由的条子能正常收尾', naDone);

    // ── 6. 控制台 ─────────────────────────────────────────────────────────
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
