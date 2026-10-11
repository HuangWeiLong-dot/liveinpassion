// 通用转场（View Transitions API）的验收。三套皮肤全在这里验。
//
//   cd app && npx vite --port 4174 --strictPort
//   node tools/verify-page-transition.mjs http://127.0.0.1:4174/
//
// 三套皮肤与各自的判据：
//   ① 普通导航 → 黑场滑块  → **逐帧**读覆盖面板：覆盖率轨迹、亮字轨迹、帧间距
//   ② 主题切换 → 整屏缩放  → 读 ::view-transition-old(root) 的真实 transform/filter
//   ③ 首页封面 → 博客详情 → 共享元素形变，根只淡化不缩放（同上，反向断言）
//
// 为什么要两套判据（这不是重复）：
//   · 滑块是一条**普通 DOM**，能逐帧量它的矩形、覆盖率、每个字的 opacity，
//     是最直接的证据；
//   · 缩放那条根本没有 DOM 节点 —— 伪元素全由浏览器挂在根上，querySelector
//     一个都选不到，只能读 getComputedStyle(root, '::view-transition-*')。
// 写在一个文件里是因为三套共用同一份无头 Chrome 引导；拆开只会让"哪条坏了"
// 更难判断。
//
// 逐帧为什么必须：覆盖率、亮字这些都是**中间态**。等转场结束再查什么都看不到 ——
// 元素已经摘掉了。
//
// 顺带守住三条踩过的坑（前两条的表现都是"动画没演完"）：
//   · 逐字亮不许出现 filter: blur() —— 二三十个 span 各挂一条模糊 = 主线程喂满，
//     滑块被拖到滑不完；
//   · 滑块矩形必须**越出**视口两个像素 —— 否则分数像素的边缘会露缝；
//   · "守卫里发起过渡、afterEach 放行没送到"会让屏幕永远停在旧页面，
//     所以"跑起来了"和"收尾了"必须分开断言。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const url = process.argv.slice(2).find((a) => a.startsWith('http')) || 'http://127.0.0.1:4174/';
const outDir = process.env.PT_OUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'pt-'));
fs.mkdirSync(outDir, { recursive: true });

const VW = 1440;
const VH = 900;

const failures = [];
const notes = [];
const check = (ok, label, detail = '') => {
  (ok ? notes : failures).push(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

// ── 页面内探针 ────────────────────────────────────────────────────────
// 一帧一条记录。普通导航那条路现在是一块**普通 DOM** 板子（GSAP 驱动），
// 所以几乎全部读数都能直接从它身上量；伪元素那两项只用来证明"导航没走 VT"，
// 以及主题切换 / 首页磁贴那两条路（它们**仍然**走 VT）。
const PROBES = `
window.__ptScale = function (t) {
  if (!t || t === 'none') return 1;
  var m = /matrix\\(([^)]+)\\)/.exec(t);
  if (!m) return 1;
  var p = m[1].split(',').map(Number);
  return Math.hypot(p[0], p[1]);
};
window.__ptBlur = function (f) {
  if (!f || f === 'none') return 0;
  var m = /blur\\(([\\d.]+)px\\)/.exec(f);
  return m ? Number(m[1]) : 0;
};

window.__ptSample = function () {
  var root = document.documentElement;
  var panel = document.querySelector('.transition-panel');
  var read = function (pe) {
    try {
      var cs = getComputedStyle(root, pe);
      var m = /matrix\(([^)]+)\)/.exec(cs.transform);
      var p = m ? m[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
      return {
        scale: window.__ptScale(cs.transform),
        tx: p[4], ty: p[5],
        blur: window.__ptBlur(cs.filter),
        anim: cs.animationName,
        dur: cs.animationDuration,
      };
    } catch (e) { return null; }
  };
  var anims = document.getAnimations().filter(function (a) {
    return a.effect && a.effect.pseudoElement
      && a.effect.pseudoElement.indexOf('::view-transition') === 0;
  });
  var out = {
    t: performance.now(),
    path: location.pathname,
    vt: root.dataset.vt || '',
    dark: root.classList.contains('dark'),
    fonts: document.fonts ? document.fonts.status : '?',
    pseudo: anims.length,
    states: anims.map(function (a) { return a.playState + ':' + Math.round(a.currentTime || 0); }).join(' '),
    old: read('::view-transition-old(root)'),
    neu: read('::view-transition-new(root)'),
    hasPanel: !!panel,
  };
  if (panel) {
    var r = panel.getBoundingClientRect();
    var pcs = getComputedStyle(panel);
    var x = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    var y = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    out.cover = Math.round((x * y) / (innerWidth * innerHeight) * 100);
    out.rect = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
    out.z = pcs.zIndex;
    // 板子离"正中"有多远 —— 进场/退场那两段全靠它证明确实动了
    var m3 = /matrix\(([^)]+)\)/.exec(pcs.transform);
    var p3 = m3 ? m3[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
    out.off = Math.round(Math.hypot(p3[4], p3[5]));
    var glyphs = panel.querySelectorAll('.transition-panel__glyph');
    out.glyphs = glyphs.length;
    out.label = (panel.querySelector('.transition-panel__text') || {}).textContent || '';
    var lit = 0, blur = 0;
    for (var i = 0; i < glyphs.length; i++) {
      var gs = getComputedStyle(glyphs[i]);
      if (Number(gs.opacity) > 0.5) lit++;
      var m2 = /blur\\(([\\d.]+)px\\)/.exec(gs.filter);
      if (m2 && Number(m2[1]) > 0.01) blur = Math.max(blur, Number(m2[1]));
    }
    out.lit = lit;
    out.maxBlur = blur;
    var text = panel.querySelector('.transition-panel__text');
    if (text) {
      // 触发一次布局，再取一次 —— 否则面板刚插进 DOM 的那几帧量到的是空矩形
      var tr = text.getBoundingClientRect();
      panel.offsetWidth;
      tr = text.getBoundingClientRect();
      out.textRect = [tr.left, tr.top, tr.width, tr.height].map(Math.round).join(',');
      // ⚠ 溢出判据不能拿 text 的矩形直接和视口比：它自己就有 6vw 的内边距，
      // 正常状态下本来就会"超出"视口两侧 6vw —— 那不是裁切。
      // 真正的裁切是**字**越过了面板的可视范围。
      var pad = parseFloat(getComputedStyle(text).paddingLeft) || 0;
      out.overflow = Math.max(0, Math.round(-tr.left - pad), Math.round(tr.right - innerWidth - pad),
                              Math.round(-tr.top - pad), Math.round(tr.bottom - innerHeight - pad));
    }
  }
  return out;
};

// 全部数值都从 __ptSample 里取，保持"一帧一条记录"
window.__ptRoot = function () {
  var s = window.__ptSample();
  return { n: s.pseudo, states: s.states, old: s.old, neu: s.neu };
};

// 帧间距：requestAnimationFrame 的相邻时间差 —— 最直接的"卡不卡"证据
window.__ptStart = function () {
  var rec = window.__ptRec = { on: true, frames: [], gaps: [], last: 0 };
  var tick = function (now) {
    if (!rec.on) return;
    if (rec.last) rec.gaps.push(Math.round(now - rec.last));
    rec.last = now;
    rec.frames.push(window.__ptSample());
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
window.__ptStop = function () {
  window.__ptRec.on = false;
  return { frames: window.__ptRec.frames, gaps: window.__ptRec.gaps };
};

window.__ptJank = { long: [] };
try {
  new PerformanceObserver(function (list) {
    list.getEntries().forEach(function (e) {
      window.__ptJank.long.push({ t: Math.round(e.startTime), d: Math.round(e.duration) });
    });
  }).observe({ entryTypes: ['longtask'] });
} catch (e) { /* 不支持就算了 */ }

window.__reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// 博客卡片：<article class="jb-card"> 上**没有** href（点它走 openPost → 共享元素过渡），
// 所以只能从卡片里那格 view-transition-name 反推 slug，再模拟一次点击。
window.__ptCardSlug = function (card) {
  var el = card.querySelector('[style*="view-transition-name"]');
  var name = el ? (el.style.viewTransitionName || '') : '';
  var m = /^blog-cover-(.+)$/.exec(name);
  return m ? m[1] : null;
};
window.__ptClickCard = function () {
  var c = document.querySelector('.jb-card');
  if (!c) return false;
  c.click();
  return true;
};
`;

async function run() {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-pt-'));
  const child = spawn(
    CHROME,
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`,
     '--no-first-run', '--disable-extensions', '--hide-scrollbars',
     `--window-size=${VW},${VH}`, 'about:blank'],
    { stdio: 'ignore' },
  );

  try {
    // Chrome 起不来时把"为什么"带出来，别只报一句"起不来了"
    let chromeDied = null;
    child.on('exit', (code) => { if (code !== null && code !== 0) chromeDied = code; });

    const portFile = path.join(profileDir, 'DevToolsActivePort');
    let port = null;
    for (let i = 0; i < 160 && !port; i++) {
      try {
        const line = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
        if (line) port = Number(line);
      } catch {}
      if (!port) await sleep(250);
    }
    if (!port) throw new Error(`Chrome 起不来（DevToolsActivePort 没写出${chromeDied ? `，进程退出码 ${chromeDied}` : ''}）`);

    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

    let id = 0;
    const pending = new Map();
    const handlers = new Map();
    const consoleErrors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method && handlers.has(m.method)) for (const f of handlers.get(m.method)) f(m.params);
    });
    const send = (method, params = {}) => {
      const i = ++id;
      return new Promise((res, rej) => { pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
    };
    const on = (m, f) => { if (!handlers.has(m)) handlers.set(m, []); handlers.get(m).push(f); };
    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('求值失败 ' + (r.exceptionDetails.exception?.description || '').slice(0, 300));
      return r.result.value;
    };
    const shot = async (name) => {
      const r = await send('Page.captureScreenshot', {});
      fs.writeFileSync(path.join(outDir, name), Buffer.from(r.data, 'base64'));
    };
    const waitFor = async (expr, ms = 20000, label = expr) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (await evaluate(expr)) return true;
        await sleep(80);
      }
      failures.push(`  FAIL 等不到：${label}`);
      return false;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: PROBES });
    on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? '').join(' '));
    });
    on('Runtime.exceptionThrown', (p) => consoleErrors.push(p.exceptionDetails?.exception?.description || 'exception'));

    /**
     * 触发一次动作，逐帧录到"伪元素和滑块都收干净"或超时。
     * @param {string} trigger 在页面里执行的表达式
     * @param {string} expectPath 结束时应该停在哪个路由
     */
    async function recordRun(trigger, expectPath, maxMs = 6000) {
      // ⚠ 先等上一次清干净再开录，否则会把上一轮的收尾状态录进来
      for (let i = 0; i < 80; i++) {
        const clean = await evaluate('(function(){var s=window.__ptSample();return !s.hasPanel && s.pseudo===0;})()');
        if (clean) break;
        await sleep(50);
      }
      await evaluate('window.__ptJank.long.length = 0');
      await evaluate('window.__ptStart()');
      // ⚠ 必须**立刻**挂上 catch：触发表达式抛异常时这个 promise 会变成
      // unhandled rejection，Node 24 默认直接终止进程 —— 连 try/catch 都轮不到。
      let triggerError = null;
      const fired = evaluate(trigger).catch((e) => { triggerError = e; });
      const t0 = Date.now();
      let seenSomething = false;
      while (Date.now() - t0 < maxMs) {
        const s = await evaluate('window.__ptSample()');
        if (s.pseudo > 0 || s.hasPanel) seenSomething = true;
        if (seenSomething && s.pseudo === 0 && !s.hasPanel) break;
        await sleep(40);
      }
      await fired;
      if (triggerError) failures.push(`  FAIL 触发失败：${trigger}\n       ${triggerError.message.slice(0, 200)}`);
      const rec = await evaluate('window.__ptStop()');
      return { ...rec, jank: await evaluate('window.__ptJank'), expectPath };
    }

    // ── 断言 A：滑块（普通导航）──────────────────────────────────────
    // 这条路是一块**普通 DOM** 板子 + GSAP 时间线，不碰 View Transitions，
    // 所以判据全部落在板子自己身上：
    //   起点在视口外 → 划进来盖满 → 字逐字亮 → 再滑出去
    // 顺带证明"导航确实没走 VT"（伪元素一个都不该有）。
    function assertSlider(run, label) {
      const { frames, gaps, jank } = run;
      const withPanel = frames.filter((f) => f.hasPanel);
      check(withPanel.length > 0, `${label}：录到了带板子的帧`, `${withPanel.length}/${frames.length} 帧`);

      // ① 导航期间**不该有** ::view-transition 伪元素 —— 有的话就是又走回 VT 了：
      //    那意味着伪元素树（top layer）会盖住板子，而且每次导航都要抓一张整页位图
      //   （点下去那一下卡顿的来源）。
      const vtw = frames.filter((f) => f.pseudo > 0);
      check(vtw.length === 0, `${label}：导航没有走 View Transitions（没有伪元素树）`,
        vtw.length ? `${vtw.length} 帧带 ::view-transition 动画` : '全程 0 帧');

      // ② 起点必须在视口外：板子是从外面**划进来**的，不是当帧盖满。
      //    阈值按**短边**的 0.9 倍取，不取满：纵向往外那一趟是 112vh（1008px），
      //    但逐帧采样总会漏掉开头几帧（第一条记录已经在路上了），拿 1008 去卡会偶发失败。
      //    0.9 倍短边仍然远大于"没在动"，足以区分。
      const maxOff = Math.max(0, ...frames.map((f) => f.off || 0));
      check(maxOff > Math.min(VW, VH) * 0.9, `${label}：板子确实从视口外划进来/滑出去`,
        `离正中最大 ${Math.round(maxOff)}px`);

      // ③ 中途必须真的盖满过
      const maxCover = Math.max(0, ...frames.map((f) => f.cover || 0));
      check(maxCover >= 100, `${label}：板子盖满过整屏`, `峰值覆盖 ${maxCover}%`);

      // ④ 盖满的那一段里，字必须全部亮齐；这一段也是唯一能量几何的时刻
      //   （划进来/滑出去那两段板子本来就在视口外，量 rect 只会误报）。
      const covered = frames.filter((f) => (f.cover || 0) >= 100 && (f.rect || '').split(',').map(Number)[2] > 0);
      const total = covered.length ? covered[0].glyphs : 0;
      const maxLit = Math.max(0, ...covered.map((f) => f.lit || 0));
      check(maxLit === total && total > 0, `${label}：所有字都亮齐了`, `${maxLit}/${total}`);

      const maxOverflow = Math.max(0, ...covered.map((f) => f.overflow || 0));
      check(maxOverflow === 0, `${label}：字没有被视口裁掉`, `最大溢出 ${maxOverflow}px`);
      const widest = covered.length ? Math.max(...covered.map((f) => {
        const t = (f.textRect || '0,0,0,0').split(',').map(Number);
        return t[2];
      })) : 0;
      check(widest > 80, `${label}：那行字确实有宽度（不是空元素）`, `最宽 ${widest}px`);

      // 板子矩形必须越出视口（防"边缘露缝"）。
      // ⚠ 只量**真的停稳了**的那几帧（离正中 ≤ 2px）。GSAP 是每帧写 transform 的，
      // 盖满的头一两帧可能还差几个像素 —— 那时上边缘还在视口里，量出来当然"没越界"，
      // 但那是它还在路上，不是缝。
      const rects = covered.filter((f) => (f.off || 0) <= 2).map((f) => f.rect.split(',').map(Number));
      const bad = rects.find((r) => !(r[0] <= -1 && r[1] <= -1
        && r[0] + r[2] >= VW + 1 && r[1] + r[3] >= VH + 1));
      check(rects.length > 0 && !bad, `${label}：板子矩形越出视口（不会在边缘露缝）`,
        bad ? `rect ${bad.join(',')}` : (rects.length ? `${rects.length} 帧全部越界，例 ${rects[0].join(',')}` : '没有盖满的帧可量'));

      const maxBlur = Math.max(0, ...frames.map((f) => f.maxBlur || 0));
      check(maxBlur === 0, `${label}：逐字亮没有用 filter: blur（那是卡顿的根源）`, `峰值 blur ${maxBlur}px`);

      const sorted = [...gaps].sort((a, b) => a - b);
      const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
      const worstGap = sorted.length ? sorted[sorted.length - 1] : 0;
      check(p95 < 34, `${label}：帧间距 p95 < 34ms（≈30fps 以上）`, `p95 ${p95}ms，最差 ${worstGap}ms`);
      const longest = (jank.long || []).length ? Math.max(...jank.long.map((l) => l.d)) : 0;
      check(longest < 150, `${label}：转场期间没有超过 150ms 的长任务`, `最长 ${longest}ms，共 ${(jank.long || []).length} 个`);

      const last = frames[frames.length - 1];
      check(last.path === run.expectPath, `${label}：停在 ${run.expectPath}`, last.path);

      notes.push(`  note ${label}｜覆盖率 ${frames.map((f) => f.cover || 0).join('→')}`);
      notes.push(`  note ${label}｜离正中 ${frames.map((f) => f.off || 0).join('→')}`);
      notes.push(`  note ${label}｜亮字 ${frames.map((f) => (f.hasPanel ? `${f.lit}/${f.glyphs}` : '-')).join(' ')}`);
      notes.push(`  note ${label}｜帧间距 ${gaps.join(',')}`);
    }

    // ── 断言 B：伪元素那条（缩放 / 共享元素）─────────────────────────
    function assertPseudo(run, label, opts = {}) {
      const { frames } = run;
      const zoom = opts.zoom !== false;
      const peak = frames.filter((f) => f.pseudo > 0);
      check(peak.length > 0, `${label}：转场确实起来了`,
        peak.length ? `${peak.length} 帧带 ::view-transition 动画` : '整段没录到');
      if (!peak.length) return;

      if (zoom) {
        const maxScale = Math.max(...peak.map((f) => (f.old ? f.old.scale : 1)));
        const maxBlur = Math.max(...peak.map((f) => (f.old ? f.old.blur : 0)));
        check(maxScale >= 1.4, `${label}：旧画面确实被推近了`, `峰值 scale ${maxScale.toFixed(2)}`);
        check(maxBlur >= 10, `${label}：推近的同时糊掉了`, `峰值 blur ${maxBlur.toFixed(1)}px`);
        const newScale = Math.max(...peak.map((f) => (f.neu ? f.neu.scale : 1)));
        check(newScale >= 1.4, `${label}：新画面是从放大态缩回的`, `起始 scale ${newScale.toFixed(2)}`);
      } else {
        const maxScale = Math.max(...peak.map((f) => (f.old ? f.old.scale : 1)));
        const names = [...new Set(peak.map((f) => (f.old ? f.old.anim : '?')))].join(',');
        check(maxScale < 1.1, `${label}：这条路上根没有缩放`, `峰值 scale ${maxScale.toFixed(2)}｜old 动画 = ${names}`);
      }

      const advanced = peak.some((f) => f.states && f.states.indexOf('running') === 0);
      check(advanced, `${label}：动画真的在走（不是卡在 pending）`,
        peak[Math.floor(peak.length / 2)].states);

      // ⚠ 判据是"没有 pending / running"，不是"动画数为 0"：跑完之后伪元素树
      // 要等下一次渲染才被清掉，此时 n 仍 >0 但状态已是 finished —— 那正是"跑完了"。
      const last = frames[frames.length - 1];
      const stuck = /pending:|running:/.test(last.states || '');
      check(!stuck, `${label}：转场收尾了，没有卡在半路`,
        stuck ? `末帧仍有未完成的动画：${last.states}` : `末帧 ${last.states || '(已清理)'}`);
      const lastP = frames[frames.length - 1];
      check(lastP.path === run.expectPath, `${label}：停在 ${run.expectPath}`, lastP.path);
    }

    // ── 进入站点 ────────────────────────────────────────────────────
    await send('Page.navigate', { url });
    if (!await waitFor('!!document.querySelector(".brand__enter") && getComputedStyle(document.querySelector(".brand__enter")).opacity !== "0"', 30000, 'ENTER 出现')) return finish(child, profileDir);

    // ── 先确认跑的是不是当前这份代码 ────────────────────────────────
    // ⚠ 这条是拿血换来的：上一次验证全程跑在一个**过期的 app/dist** 上
    //（4174 上是个残留的 vite preview，服务的是改动之前打出来的包），
    // 量到的全是旧实现的读数，白折腾一轮。
    //
    // 判据取"旧的 View Transitions 那套痕迹已经不在"：老实现会在导航发起时往
    // <html> 上写一串 --vt-page-* 的自定义属性（--vt-page-in 是第一个）。
    // 现在普通导航整条路都不碰 VT 了，这几个属性一个都不该存在。
    // 这条同时也是"导航没走 VT"的旁证 —— 走了就会写回来。
    const staleVars = await evaluate(
      `['--vt-page-in','--vt-page-root','--vt-page-out','--vt-in-x']
        .filter(function(k){ return getComputedStyle(document.documentElement).getPropertyValue(k).trim(); })
        .join(', ')`);
    const fresh = staleVars === '';
    check(fresh, '跑的确实是当前这份代码（旧的 --vt-page-* 一套已经不在）',
      fresh ? 'HTML 上没有任何旧的转场变量'
        : `⚠ 量到旧变量：${staleVars} —— app/dist 没重建、端口上挂着旧的 vite preview，`
          + '下面的数字全部作废');
    await evaluate('document.querySelector(".brand__enter").click()');
    if (!await waitFor('document.body.classList.contains("ui-ready")', 20000, '首屏揭幕')) return finish(child, profileDir);

    const bootErrors = consoleErrors.slice();
    if (bootErrors.length) {
      notes.push(`  note 启动期报错 ${bootErrors.length} 条（疑似既有问题，不计入转场验收）`);
      notes.push(`       ${bootErrors[0].split('\n')[0].slice(0, 150)}`);
    }

    // ── 1. HOME → BLOGS（黑场滑块）──────────────────────────────────
    const r1 = await recordRun('document.querySelector(\'nav a[href="/blogs"]\').click()', '/blogs');
    assertSlider(r1, 'HOME → BLOGS');
    check(r1.frames.every((f) => f.vt === ''), 'HOME → BLOGS：导航期间没有落 data-vt 皮肤');
    check(await evaluate('!!document.querySelector(".blogs-lookback-page")'), 'BLOGS 页真的渲染出来了');

    // ── 2. 浏览器返回（popstate）—— 选守卫式发起的全部理由 ───────────
    const r2 = await recordRun('history.back()', '/');
    assertSlider(r2, '浏览器返回 BLOGS → HOME');

    // ── 3. 主题切换（不是导航，走 runPageTransition）：整屏缩放那条 ──
    const darkBefore = await evaluate('window.__ptSample().dark');
    const r3 = await recordRun('document.querySelector("#themeToggle").click()', '/');
    assertPseudo(r3, '主题切换', { zoom: true });
    check(await evaluate('window.__ptSample().dark') !== darkBefore, '主题切换：颜色真的翻了');
    check(r3.frames.every((f) => !f.hasPanel), '主题切换不出现滑块');

    // ── 4. BLOGS → 博客详情：共享元素那条不走黑场滑块 ────────────────
    const r4a = await recordRun('document.querySelector(\'nav a[href="/blogs"]\').click()', '/blogs');
    assertSlider(r4a, '再次进入 BLOGS');
    const slug = await evaluate('(function(){var c=document.querySelector(".jb-card");return c?window.__ptCardSlug(c):null;})()');
    notes.push(`  note 第一张博客卡片 = ${slug}`);
    if (slug) {
      const r4 = await recordRun(`window.__ptClickCard()`);
      const peak4 = r4.frames.filter((f) => f.pseudo > 0);
      check(r4.frames.every((f) => !f.hasPanel), '博客详情：不走滑块（共享元素自己演）');
      if (peak4.length) {
        check(peak4.some((f) => f.vt === 'cover'), '博客详情：转场期间置上了 data-vt="cover"');
        const maxScale = Math.max(...peak4.map((f) => (f.old ? f.old.scale : 1)));
        check(maxScale < 1.1, '博客详情：根没有缩放（走的是干净淡化）', `峰值 scale ${maxScale.toFixed(2)}`);
      } else {
        notes.push('  note 这次点击没触发转场，跳过共享元素那条的断言');
      }
    } else {
      notes.push('  note 博客卡片没找到，跳过共享元素那条');
    }

    // ── 5. 首页封面 → 博客详情：同样不走黑场滑块 ────────────────────
    await evaluate('document.querySelector(\'nav a[href="/"]\').click()');
    await waitFor('location.pathname === "/"', 8000, '回到首页');
    let hasPersona = false;
    for (let i = 0; i < 40 && !hasPersona; i++) {
      hasPersona = await evaluate('!!document.querySelector(".persona")');
      if (!hasPersona) await sleep(100);
    }
    if (hasPersona) {
      const r5 = await recordRun('document.querySelector(".persona").click()');
      const peak5 = r5.frames.filter((f) => f.pseudo > 0);
      if (peak5.length) {
        check(peak5.some((f) => f.vt === 'cover'), '首页封面那条路：转场期间置上了 data-vt="cover"');
        check(r5.frames.every((f) => !f.hasPanel), '首页封面那条路不走滑块');
        const maxScale = Math.max(...peak5.map((f) => (f.old ? f.old.scale : 1)));
        check(maxScale < 1.1, '首页封面那条路：根没有缩放', `峰值 scale ${maxScale.toFixed(2)}`);
      } else {
        notes.push('  note 首页磁贴这次没触发转场，跳过封面那条路的断言');
      }
    } else {
      notes.push('  note 首页磁贴没渲染出来（HeroConcept 的既有缺陷），跳过封面那条路');
    }

    // ── 5. 减少动态效果：整段不做 ───────────────────────────────────
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await send('Page.navigate', { url: `${url.replace(/\/$/, '')}/blogs` });
    // ⚠ 必须等到按钮**可用**（opacity ≠ 0），不能只等它出现。
    // BrandOverlay 的 ENTER 是 v-show 的：字体还没就绪时它已经在 DOM 里，
    // 只是 display: none / opacity: 0，这时点下去 enter() 会被 showEnter 挡掉，
    // 于是下面的 ui-ready 永远等不到（上一版就是这么偶发失败的）。
    await waitFor(
      '!!document.querySelector(".brand__enter") && getComputedStyle(document.querySelector(".brand__enter")).opacity !== "0"',
      30000, '再次出现 ENTER（可点）');
    check(await evaluate('window.__reduced()'), '浏览器已进入 prefers-reduced-motion: reduce');
    await evaluate('document.querySelector(".brand__enter")?.click()');
    await waitFor('document.body.classList.contains("ui-ready")', 20000, '第二次揭幕');
    const r5 = await recordRun('document.querySelector("#meNavLink").click()', '/me', 1500);
    check(r5.frames.every((f) => !f.hasPanel), '减少动态效果下不出现滑块');
    check(await evaluate('window.__ptSample().path === "/me"'), '减少动态效果下导航照常完成');

    // ── 截图：单独跑，不进任何计时循环 ──────────────────────────────
    // 黑场那条整段 ~1.6s，而 headless 下 captureScreenshot 要几百毫秒 ——
    // 只能"边跑边按快门"。放慢 0.2 倍之后才够按三次快门看清整条弧线。
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await send('Animation.enable');
    await send('Animation.setPlaybackRate', { playbackRate: 0.2 });
    await evaluate('document.querySelector(\'nav a[href="/"]\').click()');
    for (const [i, w] of [1200, 2000, 2000].entries()) {
      await sleep(w);
      await shot(`滑块-${i + 1}.png`);
    }
    await sleep(2000);
    await evaluate('document.querySelector("#themeToggle").click()');
    for (const [i, w] of [900, 1000, 1000].entries()) {
      await sleep(w);
      await shot(`主题-${i + 1}.png`);
    }
    await send('Animation.setPlaybackRate', { playbackRate: 1 });

    // ── 控制台 ─────────────────────────────────────────────────────
    const KNOWN = [/getImageData[^\n]*tainted by cross-origin/i];
    const runErrors = consoleErrors.slice(bootErrors.length);
    for (const e of runErrors) {
      if (KNOWN.some((re) => re.test(e))) {
        notes.push('  note 既有的跨域 canvas 报错（首页涟漪直接 getImageData 了 CDN 图片，与转场无关）');
      }
    }
    const novel = runErrors.filter((e) => !KNOWN.some((re) => re.test(e)));
    check(novel.length === 0, '转场过程中无控制台报错', novel.slice(0, 2).join(' | '));

    return finish(child, profileDir);
  } catch (e) {
    failures.push('  FAIL 脚本异常：' + e.message);
    return finish(child, profileDir);
  }
}

function finish(child, profileDir) {
  child.kill();
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  console.log(notes.join('\n'));
  console.log(`\n输出目录：${outDir}`);
  if (failures.length) {
    console.log('\n' + failures.join('\n'));
    console.log(`\n${failures.length} 项未通过`);
    process.exitCode = 1;
  } else {
    console.log('\n全部通过');
  }
}

await run();
