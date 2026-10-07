// CMS（admin/）移动端可用性验收：在 iPhone / iPad 尺寸 + 触摸仿真下驱动真实页面。
//
//   cd admin && npm run dev          # http://localhost:5173/admin/
//   node tools/verify-admin-mobile.mjs [http://localhost:5173/admin]
//
// 断言的不是"能跑"，而是"不用鼠标也能把活干完"：
//   · 页面不横向溢出、点按目标 ≥ 44px
//   · 原先只在 :hover 下才现身的控件在粗指针下必须常显
//   · 排序这类原先只有 HTML5 拖放的操作，触摸下必须真能拖动（用触摸事件实测一次）
//
// 本地 dev 没有 D1/R2 绑定，所以 /api/admin/* 全部打桩；CDN 图片也由 CDP 顶掉，
// 免得断言依赖 img.liveinpassion.me 能不能连上。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const baseUrl = (process.argv[2] || 'http://localhost:5173/admin').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1×1 PNG：把 CDN 图片顶成"能解码"的图，排版块才有真实高度
const PX_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const CDN_PATTERN = 'https://img.liveinpassion.me/*';

// 在页面脚本之前注入：打桩 /api/admin/*，返回带排版块的假数据
const INJECT = `
(function () {
  const GALLERY_MD = [
    '## Heading',
    '',
    '<figure class="gallery gallery-masonry" data-gid="g1">',
    '<img src="https://img.liveinpassion.me/demo/a.jpg" alt="">',
    '<img src="https://img.liveinpassion.me/demo/b.jpg" alt="">',
    '<figcaption class="gallery-caption">demo</figcaption>',
    '</figure>',
    '',
    'Some body text.',
  ].join('\\n');
  const POST = {
    id: 1, slug: 'demo', cardTitle: 'DEMO', title: 'Demo Post',
    status: 'draft', publishedAt: null, createdAt: Date.now(), readTimeMin: 3,
    coverKey: '', coverFullKey: '', contentMd: GALLERY_MD,
  };
  const ALBUM = { id: 1, r2Prefix: 'Demo', name: 'Demo Album', kind: 'friend' };
  const photo = (id, name) => ({ id, fileName: name, originalKey: name, compressedKey: null,
                                 originalUrl: '', compressedUrl: '', sortOrder: id - 1 });
  const PHOTOS = [photo(1, 'a.jpg'), photo(2, 'b.jpg'), photo(3, 'c.jpg')];
  const routes = [
    [/\\/api\\/admin\\/albums\\/\\d+\\/photos\\/reorder$/, () => ({ ok: true })],
    [/\\/api\\/admin\\/albums\\/\\d+\\/photos$/, () => ({ photos: PHOTOS.slice() })],
    [/\\/api\\/admin\\/albums$/, () => ({ albums: [ALBUM] })],
    [/\\/api\\/admin\\/posts\\/\\d+$/, () => POST],
    [/\\/api\\/admin\\/posts$/, () => ({ posts: [POST] })],
  ];
  const orig = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    for (const [re, make] of routes) {
      if (re.test(url)) {
        return Promise.resolve(new Response(JSON.stringify(make(init)), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
    }
    return orig.apply(this, arguments);
  };
})();
`;

// 页面内的量具
const PROBE = `
window.__probe = function (sel) {
  const el = document.querySelector(sel);
  if (!el) return { sel, found: false };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const top = r.width && r.height ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
  return {
    sel, found: true, hidden: el.hidden === true,
    opacity: Number(cs.opacity), visibility: cs.visibility, display: cs.display,
    w: Math.round(r.width), h: Math.round(r.height),
    hit: top ? (el === top || el.contains(top)) : false,
  };
};
window.__overflow = function () {
  const de = document.documentElement;
  const over = [];
  if (de.scrollWidth > de.clientWidth) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right > de.clientWidth + 0.5 && r.width > 0) {
        over.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), right: Math.round(r.right) });
        if (over.length >= 6) break;
      }
    }
  }
  return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, over };
};
// 只量真正的控件：行内文字链接本来就不该按 44px 要求
const TAP_SELECTORS = 'button, .btn, .photo-remove, .gallery-editbtn, .layout-thumb-x, select, input[type=file]';
window.__tapTargets = function () {
  const small = [];
  for (const el of document.querySelectorAll(TAP_SELECTORS)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (getComputedStyle(el).visibility === 'hidden') continue;
    if (r.height < 44 || r.width < 44) {
      small.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
    }
  }
  return small;
};
window.__photoOrder = function () {
  return [...document.querySelectorAll('.photo-cell img')].map((im) => im.getAttribute('alt'));
};
`;

let id = 0;
const pending = new Map();
const handlers = new Map();
let ws;
const send = (method, params = {}, timeoutMs = 15000) => {
  const i = ++id;
  return new Promise((res, rej) => {
    // 任何一条 CDP 命令不回就整个脚本挂死，超时兜底并把方法名报出来
    const timer = setTimeout(() => {
      if (pending.delete(i)) rej(new Error(`CDP 超时: ${method}`));
    }, timeoutMs);
    pending.set(i, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
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
const json = async (expr) => JSON.parse(await evaluate(`JSON.stringify(${expr})`));

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
};
const section = (t) => console.log(`\n${t}`);

// 用真实触摸事件走一遍"按住 → 拖到目标 → 松手"。
// 按住超过 pressDrag 的 300ms 长按阈值，触摸设备才会进入拖拽。
async function touchDragTo(fromSel, toSel) {
  const box = await json(`(function () {
    var a = document.querySelector(${JSON.stringify(fromSel)});
    var b = document.querySelector(${JSON.stringify(toSel)});
    if (!a || !b) return null;
    a.scrollIntoView({ block: 'center' });
    var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return { ax: ra.left + ra.width / 2, ay: ra.top + ra.height / 2,
             bx: rb.left + rb.width / 2, by: rb.top + rb.height / 2 };
  })()`);
  if (!box) throw new Error(`找不到拖拽两端: ${fromSel} → ${toSel}`);
  const pt = (x, y) => [{ x, y }];
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(box.ax, box.ay) });
  await sleep(450);
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: pt(box.ax + ((box.bx - box.ax) * i) / steps, box.ay + ((box.by - box.ay) * i) / steps),
    });
    await sleep(50);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(500);
}

// 鼠标拖拽：按下即拖，不需要长按
async function mouseDragTo(fromSel, toSel) {
  const box = await json(`(function () {
    var a = document.querySelector(${JSON.stringify(fromSel)});
    var b = document.querySelector(${JSON.stringify(toSel)});
    if (!a || !b) return null;
    a.scrollIntoView({ block: 'center' });
    var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return { ax: ra.left + ra.width / 2, ay: ra.top + ra.height / 2,
             bx: rb.left + rb.width / 2, by: rb.top + rb.height / 2 };
  })()`);
  if (!box) throw new Error(`找不到拖拽两端: ${fromSel} → ${toSel}`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.ax, y: box.ay, button: 'left', buttons: 1, clickCount: 1 });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', button: 'left', buttons: 1,
      x: box.ax + ((box.bx - box.ax) * i) / steps,
      y: box.ay + ((box.by - box.ay) * i) / steps,
    });
    await sleep(30);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.bx, y: box.by, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(500);
}

async function tap(sel) {
  const box = await json(`(function () {
    var el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!box) throw new Error('找不到元素: ' + sel);
  const p = [{ x: box.x, y: box.y }];
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: p });
  await sleep(60);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
}

(async () => {
  const port = 9860 + Math.floor(Math.random() * 40);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-mobile-prof-'));
  const child = spawn(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
     '--no-first-run', '--disable-gpu', '--disable-extensions', 'about:blank'],
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
    await send('Fetch.enable', { patterns: [{ urlPattern: CDN_PATTERN, requestStage: 'Request' }] });

    const consoleErrors = [];
    on('Log.entryAdded', ({ entry }) => {
      // favicon 的 404 与移动端无关（线上由 Worker 的 assets 兜底），不计入
      if (entry.level === 'error' && !entry.text.includes('favicon')) consoleErrors.push(entry.text);
    });
    // alert/confirm 会把页面冻住，后面的求值全部超时 —— 一律自动确认；消息留档备查
    const dialogs = [];
    on('Page.javascriptDialogOpening', ({ message }) => {
      dialogs.push(message || '');
      send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    });
    on('Fetch.requestPaused', ({ requestId }) => {
      send('Fetch.fulfillRequest', {
        requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'image/png' }],
        body: PX_PNG,
      }).catch(() => {});
    });

    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }],
    });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    // mobile: true 会把 hover/pointer 锁成 none/coarse，桌面回归必须关掉它
    const setViewport = (width, height, mobile = true) =>
      send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 3 : 1, mobile });
    await setViewport(390, 844);

    await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });

    const goto = async (p) => {
      const loaded = new Promise((res) => on('Page.loadEventFired', res));
      await send('Page.navigate', { url: baseUrl + p });
      await Promise.race([loaded, sleep(10000)]);
      await sleep(1500);
    };

    // ---------- 0. 仿真前提 ----------
    await goto('/');
    section('仿真前提');
    const env = await json(`({
      hoverNone: matchMedia('(hover: none)').matches,
      coarse: matchMedia('(pointer: coarse)').matches,
      vw: window.innerWidth,
    })`);
    check('(hover: none) 生效 —— 页面确实处于"没有 hover"的环境', env.hoverNone === true, JSON.stringify(env));

    // ---------- 1. 博客列表 ----------
    section('博客列表 — 移动端布局');
    const lo = await json('window.__overflow()');
    check('页面不横向溢出', lo.scrollWidth <= lo.clientWidth,
      `${lo.scrollWidth} / ${lo.clientWidth}` + (lo.over.length ? '  溢出: ' + JSON.stringify(lo.over) : ''));
    const navBox = await json(`(function () {
      var n = document.querySelector('.admin-nav'); var r = n.getBoundingClientRect();
      return { h: Math.round(r.height),
               linksRight: [...document.querySelectorAll('.nav-item')].map(function (e) { return Math.round(e.getBoundingClientRect().right); }),
               innerW: window.innerWidth };
    })()`);
    check('导航按钮都在视口内', navBox.linksRight.every((r) => r <= navBox.innerW + 0.5), JSON.stringify(navBox));
    const listSmall = await json('window.__tapTargets()');
    check('列表页无 <44px 的点按目标', listSmall.length === 0, listSmall.length ? JSON.stringify(listSmall.slice(0, 6)) : '');

    // ---------- 2. 相册 ----------
    await goto('/albums');
    section('相册页 — 删除按钮与排序');
    const rm = await json('window.__probe(".photo-remove")');
    check('未触摸时 .photo-remove 就可见（不再依赖 hover）', rm.found && rm.opacity > 0.5, `opacity=${rm.opacity}`);
    check('.photo-remove 可命中且 ≥ 44×44', rm.hit === true && rm.w >= 44 && rm.h >= 44,
      `hit=${rm.hit} ${rm.w}×${rm.h}`);
    const albumSmall = await json('window.__tapTargets()');
    check('相册页无 <44px 的点按目标', albumSmall.length === 0, albumSmall.length ? JSON.stringify(albumSmall.slice(0, 6)) : '');

    const before = await json('window.__photoOrder()');
    await touchDragTo('.photo-cell[data-idx="0"]', '.photo-cell[data-idx="1"]');
    const after = await json('window.__photoOrder()');
    check('长按拖拽能重排（触摸，不是 HTML5 拖放）',
      after[0] === before[1] && after[1] === before[0],
      `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    const dragLeftover = await json(`({
      dragging: document.querySelectorAll('.photo-cell.is-dragging').length,
      dropTarget: document.querySelectorAll('.photo-cell.is-drop-target').length,
    })`);
    check('松手后拖拽态已清干净', dragLeftover.dragging === 0 && dragLeftover.dropTarget === 0, JSON.stringify(dragLeftover));

    // ---------- 3. 编辑器：手机 ----------
    await goto('/blogs/1');
    section('编辑器 — 手机（390px）');
    const edMobile = await json(`(function () {
      var wrap = document.querySelector('.md-editor-input-wrapper');
      var ed = document.querySelector('.md-editor');
      function box(e) { if (!e) return null; var r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }
      return { editor: box(ed), input: box(wrap), previewShown: !!document.querySelector('.md-editor-preview') };
    })()`);
    check('手机默认不显示预览（分栏会把输入区压到 155px）', edMobile.previewShown === false);
    check('输入区占满整宽（≥ 编辑器宽度的 90%）',
      edMobile.input && edMobile.editor && edMobile.input.w >= edMobile.editor.w * 0.9,
      JSON.stringify(edMobile));
    const edSmall = await json('window.__tapTargets()');
    check('编辑器页无 <44px 的点按目标', edSmall.length === 0, edSmall.length ? JSON.stringify(edSmall.slice(0, 8)) : '');

    // ---------- 3b. 照片排版弹窗 ----------
    section('照片排版弹窗 — 手机（390px）');
    await evaluate(`(function () {
      var t = document.querySelector('.md-editor-toolbar-item[title="Photo Layout"]');
      if (t) t.click();
      return 1;
    })()`);
    await sleep(400);
    // 直接往隐藏的 file input 里塞文件：绕开系统选图框，走的仍是组件的 change 路径
    const picked = await json(`(function () {
      var input = document.querySelector('.layout-pick-btn input[type=file]');
      if (!input) return 'no input';
      var dt = new DataTransfer();
      ['a', 'b', 'c'].forEach(function (n, i) {
        dt.items.add(new File([new Uint8Array([137, 80, 78, 71, i])], n + '.png', { type: 'image/png' }));
      });
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    check('弹窗能打开并吃到选中的照片', picked === 'ok', String(picked));
    await sleep(400);
    const thumbs = await json(`[...document.querySelectorAll('.layout-thumb')].map(function (t) {
      var r = t.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) };
    })`);
    check('缩略图都渲染出来了', thumbs.length === 3, JSON.stringify(thumbs));
    const thumbX = await json('window.__probe(".layout-thumb-x")');
    check('缩略图上的删除钮 ≥ 44×44 且可命中',
      thumbX.found && thumbX.w >= 44 && thumbX.h >= 44 && thumbX.hit === true, JSON.stringify(thumbX));
    const dialogSmall = await json('window.__tapTargets()');
    check('弹窗内无 <44px 的点按目标', dialogSmall.length === 0, dialogSmall.length ? JSON.stringify(dialogSmall.slice(0, 8)) : '');

    const thumbSrcs = `[...document.querySelectorAll('.layout-thumb img')].map(function (i) { return i.src; })`;
    const thumbsBefore = await json(thumbSrcs);
    await touchDragTo('.layout-thumb[data-idx="0"]', '.layout-thumb[data-idx="1"]');
    const thumbsAfter = await json(thumbSrcs);
    check('缩略图长按拖拽能换位（触摸）',
      thumbsAfter[0] === thumbsBefore[1] && thumbsAfter[1] === thumbsBefore[0],
      `${JSON.stringify(thumbsBefore.map((s) => s.slice(-8)))} → ${JSON.stringify(thumbsAfter.map((s) => s.slice(-8)))}`);
    await evaluate(`(function () { var b = document.querySelector('.layout-x'); if (b) b.click(); return 1; })()`);
    await sleep(300);

    // ---------- 4. 编辑器：平板（仍无 hover）----------
    // 预览关着就看不到排版块。换成 iPad 尺寸，既打开预览，媒体特性仍是粗指针 ——
    // 顺带验证 matchMedia 的 change 监听有没有跟上视口变化。
    await setViewport(820, 1180);
    await sleep(900);
    await goto('/blogs/1');
    section('编辑器 — 平板（820px，仍无 hover）');
    const edTablet = await json(`(function () {
      var wrap = document.querySelector('.md-editor-input-wrapper');
      var ed = document.querySelector('.md-editor');
      function box(e) { if (!e) return null; var r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }
      return { editor: box(ed), input: box(wrap), previewShown: !!document.querySelector('.md-editor-preview') };
    })()`);
    check('宽屏显示预览', edTablet.previewShown === true, JSON.stringify(edTablet));

    const bar = await json('window.__probe(".gallery-editbar")');
    check('排版块工具条未触摸即可见（不再靠 :hover 现身）', bar.found && bar.opacity > 0.5, JSON.stringify(bar));
    check('工具条是块底部的一条带，没有盖住整张图', bar.found && bar.h <= 60 && bar.w > bar.h,
      `${bar.w}×${bar.h}`);
    const barBtns = await json(`[...document.querySelectorAll('.gallery-editbtn')].map(function (b) {
      var r = b.getBoundingClientRect(); return { cmd: b.dataset.cmd, w: Math.round(r.width), h: Math.round(r.height) };
    })`);
    check('工具条 7 个按钮都在且 ≥ 44×44',
      barBtns.length === 7 && barBtns.every((b) => b.w >= 44 && b.h >= 44), JSON.stringify(barBtns));
    // 排版块本身的宽度：md-editor-v3 预览自带 figure{display:inline-flex} 会把块压成一条
    const figures = await json(`[...document.querySelectorAll('.md-editor-preview figure.gallery')].map(function (f) {
      var r = f.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) };
    })`);
    const previewW = await json(`Math.round(document.querySelector('.md-editor-preview').getBoundingClientRect().width)`);
    check('排版块没有塌成一条（宽度接近预览区）',
      figures.length > 0 && figures.every((f) => f.w >= previewW * 0.8 && f.h >= 60),
      `preview=${previewW} figs=${JSON.stringify(figures)}`);
    const barHit = await json(`(function () {
      var b = document.querySelector('.gallery-editbtn[data-cmd="delete"]');
      if (!b) return null;
      var r = b.getBoundingClientRect();
      var top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { hit: b === top || b.contains(top), inView: r.top >= 0 && r.bottom <= window.innerHeight };
    })()`);
    check('删除块按钮可命中且在视口内', barHit && barHit.hit === true && barHit.inView === true, JSON.stringify(barHit));

    // 单图删除钮：触屏靠点按唤出（原实现只有 mouseover）
    await tap('.md-editor-preview figure.gallery img');
    const fly = await json('window.__probe(".gallery-img-remove")');
    const flyDiag = await json(`(function () {
      var b = document.querySelector('.gallery-img-remove');
      if (!b) return null;
      var r = b.getBoundingClientRect();
      var top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      var i = document.querySelector('.md-editor-preview figure.gallery img');
      var ri = i.getBoundingClientRect();
      return { btn: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
               img: [Math.round(ri.left), Math.round(ri.top), Math.round(ri.width), Math.round(ri.height)],
               topEl: top ? top.tagName + '.' + String(top.className).slice(0, 30) : 'null',
               vh: window.innerHeight };
    })()`);
    check('点一下图就能唤出单图删除钮',
      fly.found && fly.hidden === false && fly.display !== 'none' && fly.opacity > 0.5 && fly.hit === true,
      JSON.stringify(fly) + ' ' + JSON.stringify(flyDiag));
    check('单图删除钮 ≥ 44×44', fly.found && fly.w >= 44 && fly.h >= 44, fly.found ? `${fly.w}×${fly.h}` : '');
    const tappedOrder = await json('window.__photoOrder()');
    const dragLeftover2 = await json(`document.querySelectorAll('.md-editor-preview .is-dragging').length`);
    check('轻点不会误起拖拽', dragLeftover2 === 0, `is-dragging=${dragLeftover2} / order=${JSON.stringify(tappedOrder)}`);

    // ---------- 5. 桌面回归：拖拽整个换了实现，鼠标这条路必须没坏 ----------
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'pointer', value: 'fine' }, { name: 'hover', value: 'hover' }],
    });
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await setViewport(1280, 900, false);
    await sleep(600);

    await goto('/albums');
    section('桌面回归 — 鼠标路径');
    check('(hover: none) 已关掉，本次跑的是细指针环境',
      (await json(`matchMedia('(hover: none)').matches`)) === false);
    const rmDesk = await json('window.__probe(".photo-remove")');
    check('桌面仍是 hover 才现身的小删除钮（24px）', rmDesk.opacity === 0 && rmDesk.w === 24, JSON.stringify(rmDesk));
    const beforeDesk = await json('window.__photoOrder()');
    await mouseDragTo('.photo-cell[data-idx="0"]', '.photo-cell[data-idx="1"]');
    const afterDesk = await json('window.__photoOrder()');
    check('鼠标按下即拖、能重排',
      afterDesk[0] === beforeDesk[1] && afterDesk[1] === beforeDesk[0],
      `${JSON.stringify(beforeDesk)} → ${JSON.stringify(afterDesk)}`);

    // 每个拖拽面都压在可点控件上，而 pointerdown 里调了 preventDefault()。
    // 有的引擎会因此吞掉随后的 click —— 必须确认删除钮仍然点得动。
    dialogs.length = 0;
    await evaluate(`document.querySelector('.photo-cell[data-idx="0"] .photo-remove').click(); 1`);
    await sleep(400);
    check('照片删除钮在 pointerdown 之后仍能收到 click',
      dialogs.some((m) => /Remove .* from this album/.test(m)), JSON.stringify(dialogs));

    await goto('/blogs/1');
    const barDesk = await json('window.__probe(".gallery-editbar")');
    check('桌面工具条仍是 hover 才现身（没有因为修复而常显）',
      barDesk.found && barDesk.opacity === 0, JSON.stringify(barDesk));
    const srcs = `[...document.querySelectorAll('.md-editor-preview figure.gallery img')].map(function (i) { return i.getAttribute('src').split('/').pop(); })`;
    const orderBefore = await json(srcs);
    // 分步做，好在失败时看出是"没起拖""没找到落点"还是"没写回"
    const imgBox = await json(`(function () {
      var ims = document.querySelectorAll('.md-editor-preview figure.gallery img');
      if (ims.length < 2) return null;
      ims[0].scrollIntoView({ block: 'center' });
      var a = ims[0].getBoundingClientRect(), b = ims[1].getBoundingClientRect();
      // 落点取目标图的右下象限：落在中心之前是"插到它前面"（顺序不变），
      // 只有越过中点才是"插到它后面"，才看得出顺序真的换了
      return { ax: a.left + a.width / 2, ay: a.top + a.height / 2,
               bx: b.left + b.width * 0.75, by: b.top + b.height * 0.75 };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: imgBox.ax, y: imgBox.ay, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(120);
    const engaged = await json(`document.querySelectorAll('.md-editor-preview img.is-dragging').length`);
    for (let i = 1; i <= 6; i++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', button: 'left', buttons: 1,
        x: imgBox.ax + ((imgBox.bx - imgBox.ax) * i) / 6,
        y: imgBox.ay + ((imgBox.by - imgBox.ay) * i) / 6,
      });
      await sleep(30);
    }
    const hinted = await json(`document.querySelectorAll('.md-editor-preview img.drop-hint').length`);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: imgBox.bx, y: imgBox.by, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(500);
    const orderAfter = await json(srcs);

    // 工具条按钮同样长在 pointerdown 覆盖区里：点一下必须真的切布局
    await evaluate(`(function () {
      var b = document.querySelector('.gallery-editbtn[data-cmd="justified"]');
      if (b) b.click();
      return 1;
    })()`);
    await sleep(600);
    const switched = await json(`!!document.querySelector('.md-editor-preview figure.gallery.gallery-justified')`);
    check('排版块工具条按钮仍能收到 click（切换布局生效）', switched === true);
    check('鼠标拖拽能调换排版块内的照片顺序',
      orderBefore.length === 2 && orderAfter[0] === orderBefore[1] && orderAfter[1] === orderBefore[0],
      `${JSON.stringify(orderBefore)} → ${JSON.stringify(orderAfter)}  按下后 is-dragging=${engaged} 移动后 drop-hint=${hinted}`);

    section('控制台');
    check('无控制台报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} 通过`);
    if (failed.length) {
      console.log('未通过:');
      for (const f of failed) console.log('  · ' + f.label);
    }
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    try { ws && ws.close(); } catch {}
    child.kill();
    await sleep(400);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
})();
