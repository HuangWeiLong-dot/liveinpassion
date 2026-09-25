// 阶段 2 验收：全局外壳（主题 / 加载器 / 播放器 / 头部 / 跨路由不卸载）。
//
//   cd app && npm run build && npx vite preview --port 4174 --strictPort
//   node tools/verify-shell.mjs http://localhost:4174
//
// 断言的是"迁移前后行为一致"，不是"随便能跑"，所以每条都对着旧版的实现写。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const baseUrl = (process.argv[2] || 'http://localhost:4174').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 在页面任何脚本之前注入：记录主题落地时机、play() 调用次数。
// 注意这段代码在 document-start 执行，那时 document.documentElement 还是 null，
// 所以既不能直接读它的 className，也不能把它当观察目标——观察 document 本身即可。
const INJECT = `
window.__marks = { themeAtStart: '(尚未存在)', themeByBody: null, plays: [], loaderHiddenAt: null, noScrollClearedAt: null };
(function () {
  try {
    if (document.documentElement) window.__marks.themeAtStart = document.documentElement.className;
  } catch (e) {}
  new MutationObserver(function () {
    try {
      if (document.documentElement && window.__marks.themeAtStart === '(尚未存在)') {
        window.__marks.themeAtStart = document.documentElement.className;
      }
      if (document.body && window.__marks.themeByBody === null) window.__marks.themeByBody = document.documentElement.className;
      var loader = document.getElementById('loader');
      if (loader && loader.classList.contains('hidden') && window.__marks.loaderHiddenAt === null) {
        window.__marks.loaderHiddenAt = performance.now();
      }
      if (document.body && !document.body.classList.contains('no-scroll') && window.__marks.noScrollClearedAt === null) {
        window.__marks.noScrollClearedAt = performance.now();
      }
    } catch (e) {}
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  var orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { window.__marks.plays.push(Date.now()); return orig.apply(this, arguments); };
})();
`;

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

(async () => {
  const port = 9860 + Math.floor(Math.random() * 40);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-prof-'));
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
    await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
    const loaded = new Promise((res) => on('Page.loadEventFired', res));
    const navStart = Date.now();
    await send('Page.navigate', { url: baseUrl + '/' });
    await Promise.race([loaded, sleep(10000)]);

    console.log('主题:');
    const theme = await evaluate('JSON.stringify(window.__marks)');
    const marks = JSON.parse(theme);
    check('文档开始时 <html> 尚无 dark（说明还没跑引导脚本）', !String(marks.themeAtStart).includes('dark'), `"${marks.themeAtStart}"`);
    check('<body> 出现时 dark 已落地（首帧不会闪浅色）', String(marks.themeByBody).includes('dark'), `"${marks.themeByBody}"`);
    const stored = await evaluate(`localStorage.getItem('themeState')`);
    check('无存储时默认暗色且不写入 localStorage（与旧版一致）', stored === null, String(stored));

    console.log('\n加载器:');
    await sleep(2900);
    const loader = await evaluate(`JSON.stringify({
      hidden: document.getElementById('loader').classList.contains('hidden'),
      hiddenAt: window.__marks.loaderHiddenAt,
      noScroll: document.body.classList.contains('no-scroll'),
      noScrollClearedAt: window.__marks.noScrollClearedAt
    })`);
    const l = JSON.parse(loader);
    check('加载器已隐藏', l.hidden === true);
    // 显示时长 = max(1000ms 下限, min(load, 2500ms 兜底))。
    // 下限是为了不让遮罩一闪而过（旧站实测 1.5-2.5s，新站原生只要 ~100ms）。
    check('显示时长在 1000-2500ms 之间', l.hiddenAt !== null && l.hiddenAt >= 950 && l.hiddenAt <= 3200, `${Math.round(l.hiddenAt)}ms`);
    check('body 的 no-scroll 已移除（可滚动）', l.noScroll === false);

    console.log('\n音乐播放器初始状态:');
    const audio = JSON.parse(await evaluate(`JSON.stringify({
      muted: document.getElementById('audioPlayer').muted,
      volume: document.getElementById('audioPlayer').volume,
      src: decodeURIComponent(document.getElementById('audioPlayer').src),
      plays: window.__marks.plays.length
    })`));
    check('初始静音（为自动播放做准备）', audio.muted === true);
    check('音量 0.3', Math.abs(audio.volume - 0.3) < 0.001, String(audio.volume));
    check('已随机选中一首歌', /music\/.+\.mp3$/.test(audio.src), audio.src.split('/').pop());
    check('挂载时未调用 play()', audio.plays === 0, `${audio.plays} 次`);

    // 首次用户交互触发一次播放，且监听器自移除
    await evaluate(`document.body.click()`);
    await sleep(600);
    const afterFirst = await evaluate(`window.__marks.plays.length`);
    check('首次交互后播放一次', afterFirst === 1, `${afterFirst} 次`);
    await evaluate(`document.body.click()`);
    await sleep(300);
    const afterSecond = await evaluate(`window.__marks.plays.length`);
    check('再次交互不再重复播放（监听器已移除）', afterSecond === 1, `${afterSecond} 次`);

    console.log('\n头部:');
    const headerHome = await evaluate(`document.getElementById('header').className`);
    check('首页无 centered', !headerHome.includes('centered'), `"${headerHome}"`);
    // 撑高页面再滚动：当前视图内容很少，不撑高的话窗口根本滚不动，测不到 scrolled
    await evaluate(`(function () {
      var spacer = document.createElement('div');
      spacer.id = '__spacer';
      spacer.style.height = '2000px';
      document.body.appendChild(spacer);
      window.scrollTo(0, 300);
      return 1;
    })()`);
    await sleep(250);
    const headerScrolled = await evaluate(`document.getElementById('header').className`);
    check('滚动超过 50px 后加 scrolled', headerScrolled.includes('scrolled'), `"${headerScrolled}"`);
    await evaluate(`window.scrollTo(0, 0); document.getElementById('__spacer').remove(); 1`);
    await sleep(200);

    console.log('\n跨路由不卸载:');
    await evaluate(`window.__audioEl = document.getElementById('audioPlayer'); window.__audioEl.__probe = 'kept'; document.getElementById('audioPlayer').currentTime = 1; 1`);
    await evaluate(`window.history.pushState({}, '', '/blogs'); window.dispatchEvent(new PopStateEvent('popstate')); 1`);
    await sleep(700);
    const nav = JSON.parse(await evaluate(`JSON.stringify({
      path: location.pathname,
      sameElement: document.getElementById('audioPlayer') === window.__audioEl,
      probe: document.getElementById('audioPlayer') && document.getElementById('audioPlayer').__probe,
      currentTime: document.getElementById('audioPlayer').currentTime,
      headerClass: document.getElementById('header').className,
      loaderStillHidden: document.getElementById('loader').classList.contains('hidden'),
      backVisible: getComputedStyle(document.getElementById('backLink')).display
    })`));
    check('已切到 /blogs 且未整页刷新', nav.path === '/blogs' && nav.sameElement === true);
    check('audio 元素身份未变、进度保留', nav.probe === 'kept' && nav.currentTime >= 0.9, `currentTime=${nav.currentTime.toFixed(2)}`);
    check('非首页加 centered', nav.headerClass.includes('centered'), `"${nav.headerClass}"`);
    check('返回按钮显示', nav.backVisible === 'flex', nav.backVisible);
    check('路由切换没有重新显示加载器', nav.loaderStillHidden === true);

    console.log('\n主题切换:');
    // 点击后要等 Vue 的重渲染（微任务）落地再读按钮 class，否则读到的是旧值
    await evaluate(`document.getElementById('themeToggle').click(); 1`);
    await sleep(120);
    const toggled = JSON.parse(await evaluate(`JSON.stringify({
      html: document.documentElement.className,
      button: document.getElementById('themeToggle').className,
      stored: localStorage.getItem('themeState')
    })`));
    check('切换后 <html> 移除 dark', !toggled.html.includes('dark'), `"${toggled.html}"`);
    check('按钮 class 同步', !toggled.button.includes('dark'), `"${toggled.button}"`);
    check('写入 localStorage 且格式不变', toggled.stored === '{"isDark":false}', String(toggled.stored));

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
