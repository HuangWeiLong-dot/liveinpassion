// 验收：左下角作者区 / 右下那排悬浮按钮的"边缘滑出"。
//
//   cd app && npm run dev            （或 npm run build && npx vite preview --port 4174）
//   node tools/verify-edge-reveal.mjs http://localhost:4174
//
// 断言四件事：
//   1. 有真指针的设备上，四个控件默认整个在视口外（不是 opacity 0 那种"还在原地"）；
//   2. 指针进右下角 → 右侧三个滑出来；进左下角 → 作者区滑出来；回中间 → 都收回去；
//   3. 触屏（无 hover）不参与这套，控件保持常显 —— 否则手机上点不到；
//   4. X 键那套（is-chrome-hidden）没被这次改动撞坏。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const baseUrl = (process.argv[2] || 'http://localhost:4174').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true };

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

// 四个控件的位置 + <html> 上的类，一次问全
const PROBE = `JSON.stringify((function () {
  var pick = function (sel) {
    var el = document.querySelector(sel);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom,
             translate: cs.translate, opacity: cs.opacity, pointerEvents: cs.pointerEvents };
  };
  return {
    cls: document.documentElement.className,
    canHover: matchMedia('(hover: hover) and (pointer: fine)').matches,
    vw: window.innerWidth, vh: window.innerHeight,
    author: pick('.author-section'),
    theme: pick('.theme-toggle'),
    music: pick('.music-toggle-btn'),
    wall: pick('.wall-toggle')
  };
})())`;

const move = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });

// 视口外 = 整块都在边缘之外（留 1px 容差给分数像素）
const offRight = (r, vw) => r && r.left >= vw - 1;
const offLeft = (r) => r && r.right <= 1;
// 容差 4px：指针压在按钮上时它有 `transform: scale(1.1)`，56px 的圆会向外胀 2.8px，
// 量到的是缩放后的矩形，不是位移变了。
const atRight = (r, vw) => r && Math.abs(r.right - (vw - 32)) <= 4;
const atLeft = (r, left) => r && Math.abs(r.left - left) <= 4;

(async () => {
  const port = 9900 + Math.floor(Math.random() * 60);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-prof-'));
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
    await send('Emulation.setDeviceMetricsOverride', DESKTOP);

    // ⚠ 必须点一次 ENTER：那批悬浮控件的 opacity 是靠 `.shell.is-ready` 放开的，
    // 而 is-ready 要等首屏遮罩那套动画走完才加。不点的话它们一直是 opacity:0，
    // 几何断言还能过（translate 不认 opacity），但"看得见看不见"就完全没验到。
    const load = async () => {
      const done = new Promise((res) => on('Page.loadEventFired', res));
      await send('Page.navigate', { url: baseUrl + '/' });
      await Promise.race([done, sleep(10000)]);
      // ⚠ 按钮是 v-show 控制的：元素一开始就在 DOM 里（display:none），
      // 但 showEnter 要等字体那步走完（最长 2.5s 兜底）才置真。所以轮询"看得见"，
      // 不能轮询"存在" —— 早点了 enter() 会因为 showEnter 还是 false 直接 return。
      for (let i = 0; i < 60; i++) {
        const shown = await evaluate(
          `(function () { var el = document.querySelector('.brand__enter'); return !!el && getComputedStyle(el).display !== 'none'; })()`
        );
        if (shown) break;
        await sleep(250);
      }
      await evaluate(`document.querySelector('.brand__enter').click()`);
      await sleep(3200); // lift 820 + drop 900 + leave 420 + 余量
    };
    await load();

    let p = JSON.parse(await evaluate(PROBE));
    check('桌面视口 1440x900 生效', p.vw === 1440 && p.vh === 900, `${p.vw}x${p.vh}`);
    check('无头 Chrome 报的是"有真指针"', p.canHover === true, `hover 媒体查询 = ${p.canHover}`);
    check('<html> 挂上 is-edge-hover', p.cls.includes('is-edge-hover'), `"${p.cls}"`);
    check('点完 ENTER 外壳已就绪（控件是真的画出来的，不是 opacity:0）',
      parseFloat(p.theme.opacity) === 1 && parseFloat(p.author.opacity) === 1,
      `theme=${p.theme.opacity} author=${p.author.opacity}`);

    console.log('\n初始（指针还没进过页面）:');
    check('作者区整个在左边之外', offLeft(p.author), `right=${p.author && p.author.right.toFixed(1)}`);
    check('主题按钮在右边之外', offRight(p.theme, p.vw), `left=${p.theme && p.theme.left.toFixed(1)} / vw=${p.vw}`);
    check('播放器按钮在右边之外', offRight(p.music, p.vw), `left=${p.music && p.music.left.toFixed(1)}`);
    check('背景开关在右边之外', offRight(p.wall, p.vw), `left=${p.wall && p.wall.left.toFixed(1)}`);
    check('滑出用的是独立 translate（没动 transform）',
      p.theme && p.theme.translate !== 'none' && p.theme.translate.includes('112px'), `translate=${p.theme && p.theme.translate}`);

    console.log('\n指针进右下角:');
    await move(p.vw - 10, p.vh - 10);
    await sleep(900);
    p = JSON.parse(await evaluate(PROBE));
    check('主题按钮滑出来（right 回到 32）', atRight(p.theme, p.vw), `right=${p.theme.right.toFixed(1)}`);
    check('播放器按钮滑出来', atRight(p.music, p.vw), `right=${p.music.right.toFixed(1)}`);
    check('背景开关滑出来', atRight(p.wall, p.vw), `right=${p.wall.right.toFixed(1)}`);
    check('作者区没跟着动（还在左边之外）', offLeft(p.author), `right=${p.author.right.toFixed(1)}`);

    console.log('\n指针停在按钮身上（离开边缘）:');
    await move(p.vw - 60, p.vh - 60);
    await sleep(600);
    p = JSON.parse(await evaluate(PROBE));
    check('右侧三个保持滑出（热区把控件自己的地盘也算进去了）', atRight(p.theme, p.vw), `right=${p.theme.right.toFixed(1)}`);

    console.log('\n指针进左下角:');
    await move(10, p.vh - 10);
    await sleep(900);
    p = JSON.parse(await evaluate(PROBE));
    check('作者区滑出来（left 回到 32）', atLeft(p.author, 32), `left=${p.author.left.toFixed(1)}`);
    check('右侧三个收了回去', offRight(p.theme, p.vw), `left=${p.theme.left.toFixed(1)}`);
    check('社交图标仍然只在 hover 作者区时才露',
      parseFloat(await evaluate(`getComputedStyle(document.querySelector('.social-links')).opacity`)) === 0,
      '热区里但没压到头像上，应为 0');

    console.log('\n指针回到屏幕中间:');
    await move(Math.round(p.vw / 2), Math.round(p.vh / 2));
    await sleep(900);
    p = JSON.parse(await evaluate(PROBE));
    check('作者区收回屏幕外', offLeft(p.author), `right=${p.author.right.toFixed(1)}`);
    check('右侧三个收回屏幕外', offRight(p.theme, p.vw) && offRight(p.music, p.vw) && offRight(p.wall, p.vw));

    console.log('\n指针移出窗口:');
    await move(p.vw - 10, p.vh - 10);
    await sleep(700);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: -20, button: 'none', buttons: 0 });
    // 真的把指针挪出去得靠 mouseleave：CDP 里用 mouseMoved 到视口外不会派发 mouseleave，
    // 这里直接派一个，等于把"指针离开窗口"这一步走完
    await evaluate(`document.dispatchEvent(new MouseEvent('mouseleave')); 1`);
    await sleep(800);
    p = JSON.parse(await evaluate(PROBE));
    check('指针离开窗口后右侧三个也收回去', offRight(p.theme, p.vw), `left=${p.theme.left.toFixed(1)}`);

    console.log('\nX 键（is-chrome-hidden）没被撞坏:');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88, nativeVirtualKeyCode: 88 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88, nativeVirtualKeyCode: 88 });
    await sleep(900); // 淡出走的是 App.vue 那条 0.6s（不是名单里的 0.35s，权重输给它了）
    p = JSON.parse(await evaluate(PROBE));
    check('X 键后右侧按钮 opacity 归零', parseFloat(p.theme.opacity) === 0, `opacity=${p.theme.opacity}`);
    check('X 键后右侧按钮不可点', p.theme.pointerEvents === 'none', p.theme.pointerEvents);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88, nativeVirtualKeyCode: 88 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88, nativeVirtualKeyCode: 88 });
    await sleep(1200); // 恢复走的是 0.6s 淡入 + 0.1s 错峰延迟
    p = JSON.parse(await evaluate(PROBE));
    check('再按一次恢复', parseFloat(p.theme.opacity) === 1 && offRight(p.theme, p.vw), `opacity=${p.theme.opacity}`);

    console.log('\n混合设备（触摸屏笔记本）兜底:');
    // 这台机器在媒体查询里仍是"有真指针"，但用户真拿手去点屏幕了 ——
    // 控件必须立刻常显，否则手指够不到它们
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 700, y: 850 }] });
    await sleep(800);
    p = JSON.parse(await evaluate(PROBE));
    check('出现真实触摸后不再收起', !p.cls.includes('is-edge-hover'), `"${p.cls}"`);
    check('控件回到常显位置', atLeft(p.author, 32) && atRight(p.theme, p.vw),
      `author=${p.author.left.toFixed(1)} theme=${p.theme.right.toFixed(1)}`);

    console.log('\n触屏（无 hover）:');
    await send('Emulation.setDeviceMetricsOverride', PHONE);
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
    await load();
    p = JSON.parse(await evaluate(PROBE));
    check('触屏下媒体查询判为"没有真指针"', p.canHover === false, `hover 媒体查询 = ${p.canHover}`);
    check('触屏下不加 is-edge-hover', !p.cls.includes('is-edge-hover'), `"${p.cls}"`);
    check('触屏下作者区常显（left 12）', atLeft(p.author, 12), `left=${p.author.left.toFixed(1)}`);
    check('触屏下右侧按钮常显（right 12）', p.theme && Math.abs(p.theme.right - (p.vw - 12)) <= 2, `right=${p.theme && p.theme.right.toFixed(1)}`);

    const failed = results.filter((r) => !r.ok);
    console.log(`\n结果: ${results.length - failed.length}/${results.length} 通过`);
    process.exit(failed.length ? 1 : 0);
  } finally {
    try { ws && ws.close(); } catch {}
    child.kill();
    await sleep(300);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
})().catch((e) => {
  console.error('验收失败: ' + e.message);
  process.exit(1);
});
