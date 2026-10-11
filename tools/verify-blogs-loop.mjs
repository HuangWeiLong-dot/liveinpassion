// BLOGS 轨道"无限循环"的验收：**回卷那一帧不能整排变空**。
//
//   node tools/verify-blogs-loop.mjs                        # 自己起 vite dev（5199）再跑
//   node tools/verify-blogs-loop.mjs http://localhost:4174/blogs   # 用已有的 preview
//
// 为什么单为这件事写一条：轨道铺了三份、靠"整体平移一个周期"做无缝循环（见 wrapLoop）。
// 一次回卷 = 平移 13060px ≈ 9 屏，而 releaseObserver 在卡片离开视野 ±3 屏时就会摘掉
// src（为了释放那批几千万像素的解码位图，是故意的）。**两者叠加**的结果是：回卷落点
// 上那一屏在回卷前离视口整整一个周期，早被摘干净了 —— 回卷那一帧屏幕上四张一起变空，
// 再等懒加载"每批 2 张 / 隔 40ms"慢慢补。实测空 5～6 帧（约 200ms）才回来，四张填满
// 要 8 帧以上，眼睛看到的就是"滚到某一处整排闪一下"。
// 回卷点落在哪一篇是固定的（由 ringRadius 的"一份绕一整圈"和卡片宽度算出），所以这个
// 闪是**恒定复现**的，不是偶发 —— 这一版数据正好落在第 13～14 篇之间。
//
// 断言（两个方向各跑一遍）：
//   ① 回卷那一帧，屏幕上每一张卡都必须已经有图（有 src）—— 这是病根，最硬的断言；
//   ② 整段跑动里，任何一帧都不允许出现"可见却没图"的卡片；
//   ③ 可见卡必须带 transform（姿态没丢）、且不能是 is-back（标签不会整片消失）；
//   ④ 读数（计数器）连续：相邻帧之间变化不超过 1（允许 01↔25 的绕环）；
//   ⑤ 零 console 报错 / 零未捕获异常。
//
// 逆天的滚动速度不算数：这里用 deltaY 900 的滚轮推进（≈ 550px/次），比真手快得多 ——
// 预热提前量（WRAP_PRIME_LEAD）在最大甩速下的余量就是为了这种场景。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 5199;
const APP_DIR = path.resolve('app');

// CDN 图片桩：1×1 PNG，带 CORS 头（页面按 crossOrigin 取图，缺头会走"失败再重试"
// 那条路 —— 那是线上不会发生、本地必然发生的分支，测到这里只会把噪音当成结论）。
const STUB = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let vite = null;
async function startVite() {
  vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: APP_DIR, stdio: 'ignore', shell: true,
  });
  for (let i = 0; i < 80; i += 1) {
    try { const r = await fetch(`http://localhost:${PORT}/blogs`); if (r.ok) return; } catch { /* 还没起来 */ }
    await sleep(300);
  }
  throw new Error('vite dev 起不来');
}

// 一帧一帧地记：可见卡（渲染矩形与视口相交）的 pi / 位置 / 有没有图 / 有没有姿态 / 是不是背面。
const RECORDER = `window.__rec = []; window.__stop = false;
  window.__root = document.querySelector('.jb-carousel');
  window.__tick = function () {
    if (window.__stop) return;
    var root = window.__root;
    var all = Array.prototype.slice.call(root.querySelectorAll('.jb-card'));
    var vis = [];
    for (var k = 0; k < all.length; k += 1) {
      var c = all[k];
      var r = c.getBoundingClientRect();
      if (r.width <= 10 || r.right <= 0 || r.left >= innerWidth) continue;
      var im = c.querySelector('img');
      vis.push({
        pi: Number(c.dataset.postIndex) + 1,
        x: Math.round(r.left),
        hasSrc: !!(im && im.getAttribute('src')),
        loaded: !!(im && im.classList.contains('loaded')),
        posed: !!c.style.transform,
        back: c.classList.contains('is-back'),
      });
    }
    var idxEl = document.querySelector('.jb-rail-idx');
    window.__rec.push({
      left: Math.round(root.scrollLeft),
      idx: Number(idxEl ? idxEl.textContent : 0),
      vis: vis,
    });
    requestAnimationFrame(window.__tick);
  };
  requestAnimationFrame(window.__tick);
  1;`;

function analyze(label, rec) {
  const fails = [];
  let wrapFrames = 0;
  let prev = null;
  rec.forEach((f, i) => {
    if (!f.vis.length) return;
    // ① / ② 可见卡必须有图
    const bare = f.vis.filter((v) => !v.hasSrc);
    if (bare.length) fails.push(`帧${i}（left=${f.left}）：可见却没图 → ${bare.map((v) => v.pi).join(',')}`);
    // ③ 姿态与背面标签
    const flat = f.vis.filter((v) => !v.posed);
    if (flat.length) fails.push(`帧${i}：可见卡没写 transform → ${flat.map((v) => v.pi).join(',')}`);
    const back = f.vis.filter((v) => v.back);
    if (back.length) fails.push(`帧${i}：可见卡被判成背面（标签会消失）→ ${back.map((v) => v.pi).join(',')}`);
    // ④ 计数器连续
    if (prev && f.idx) {
      const jump = Math.abs(f.idx - prev.idx);
      const ring = (prev.idx === 25 && f.idx === 1) || (prev.idx === 1 && f.idx === 25);
      if (jump > 1 && !ring) fails.push(`帧${i}：读数跳 ${prev.idx} → ${f.idx}`);
    }
    // 回卷帧
    if (prev && Math.abs(Math.abs(f.left - prev.left) - 0) > 4000) wrapFrames += 1;
    prev = f;
  });
  console.log(`--- ${label} ---`);
  console.log(`  帧数 ${rec.length}，回卷 ${wrapFrames} 次，可见卡最多 ${Math.max(0, ...rec.map((f) => f.vis.length))} 张`);
  const wrapBare = fails.filter((s) => s.includes('可见却没图')).length;
  console.log(`  可见却没图的帧：${wrapBare}`);
  if (fails.length) {
    console.log(`  FAIL（${fails.length} 条，前 8 条）`);
    fails.slice(0, 8).forEach((s) => console.log('    ' + s));
  } else {
    console.log('  PASS');
  }
  return { fails, wrapFrames };
}

async function run(url) {
  const origin = new URL(url).origin;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blogl-blogs-'));
  const child = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`,
    '--no-first-run', '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
    '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  try {
    const portFile = path.join(profileDir, 'DevToolsActivePort');
    let port = null;
    for (let i = 0; i < 120 && !port; i += 1) {
      try { const line = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim(); if (line) port = Number(line); } catch { /* 等 */ }
      if (!port) await sleep(250);
    }
    if (!port) throw new Error('Chrome 没写出 DevToolsActivePort');
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

    let id = 0; const pending = new Map(); const handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id); pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method && handlers.has(m.method)) for (const f of handlers.get(m.method)) f(m.params);
    });
    const send = (method, params = {}) => {
      const i = ++id;
      return new Promise((res, rej) => { pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
    };
    const on = (m, f) => { if (!handlers.has(m)) handlers.set(m, []); handlers.get(m).push(f); };

    const consoleErrors = [];
    on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 200)); });
    on('Runtime.exceptionThrown', (p) => { consoleErrors.push('[exception] ' + (p.exceptionDetails?.exception?.description || '').slice(0, 300)); });

    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await send('Fetch.enable', { patterns: [{ urlPattern: 'https://img.liveinpassion.me/*' }] });
    on('Fetch.requestPaused', async (p) => {
      try {
        await send('Fetch.fulfillRequest', {
          requestId: p.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'image/png' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
          body: STUB,
        });
      } catch { /* 页面已经走了 */ }
    });

    await send('Page.navigate', { url: origin + '/blogs' });
    await sleep(4500);
    // 首屏那层品牌遮罩会吃掉合成事件（测夹具的动作，不是页面的行为）
    const dropVeil = async () => {
      const r = await send('Runtime.evaluate', { expression: `(() => { const b = document.querySelector('.brand'); if (b) { b.remove(); return 1; } return 0; })()`, returnByValue: true });
      return r.result?.value;
    };
    for (let i = 0; i < 8; i += 1) { await dropVeil(); await sleep(200); }

    const meta = await send('Runtime.evaluate', { expression: `(() => {
      const s = window.__jb && window.__jb.state();
      return { cards: s ? s.cards : 0, cycleWidth: s ? Math.round(s.cycleWidth) : 0, vw: innerWidth };
    })()`, returnByValue: true });
    const { cards, cycleWidth, vw } = meta.result.value || {};
    console.log(`轨道：${cards} 张卡，一份 ${cycleWidth}px，视口 ${vw}px`);
    if (!cycleWidth) throw new Error('没量到 cycleWidth（轨道还没就绪）');
    const C = cycleWidth;

    const result = { fails: [], wrapFrames: 0 };
    const collect = (r) => { result.fails.push(...r.fails); result.wrapFrames += r.wrapFrames; };

    const phases = [
      // 往右滚：起点放在两个预热区**之外**（0.5C+lead 与 1.5C-lead 之间），
      // 这样"上膛 → 进预热区 → 回卷"整条链真的走一遍。
      { label: '往右滚过回卷点', from: Math.round(C * 0.5) + 4000, dir: 1, steps: 12 },
      { label: '往左滚过回卷点', from: Math.round(C * 0.5) + 5000, dir: -1, steps: 12 },
    ];
    for (const ph of phases) {
      await send('Runtime.evaluate', { expression: RECORDER });
      await send('Runtime.evaluate', {
        expression: `new Promise((r) => { const root = document.querySelector('.jb-carousel'); root.scrollLeft = ${ph.from}; requestAnimationFrame(() => requestAnimationFrame(r)); })`,
        awaitPromise: true,
      });
      await sleep(700);
      await send('Runtime.evaluate', { expression: 'window.__rec.length = 0' });
      for (let i = 0; i < ph.steps; i += 1) {
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 500, deltaX: 0, deltaY: ph.dir * 900 });
        await sleep(90);
      }
      await sleep(900);
      await send('Runtime.evaluate', { expression: 'window.__stop = true' });
      const rec = await send('Runtime.evaluate', { expression: 'window.__rec', returnByValue: true });
      collect(analyze(ph.label, rec.result.value || []));
    }

    console.log('--- console 报错 ---');
    console.log(consoleErrors.length ? consoleErrors.slice(0, 8).join('\n') : '(无)');

    const ok = result.fails.length === 0 && result.wrapFrames >= 2 && consoleErrors.length === 0;
    console.log('---');
    console.log(ok
      ? `PASS：${result.wrapFrames} 次回卷全程没有出现过"可见却没图"，读数连续，零报错`
      : `FAIL：问题 ${result.fails.length} 条，回卷捕获 ${result.wrapFrames} 次，console 报错 ${consoleErrors.length} 条`);
    ws.close();
    return ok;
  } finally {
    child.kill();
    if (vite) vite.kill();
  }
}

const arg = process.argv[2];
if (!arg) await startVite();
const ok = await run(arg || `http://localhost:${PORT}/blogs`);
process.exit(ok ? 0 : 1);
