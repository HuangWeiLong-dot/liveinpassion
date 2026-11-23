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
// 首屏预载默认 LIVE，测试里要跳过：否则 ENTER 会先下几百张图才进场。
try { localStorage.setItem('lip:first-screen-preload-v2', 'none'); } catch (e) {}
window.__marks = { themeAtStart: '(尚未存在)', themeByBody: null, plays: [], brandGoneAt: null, noScrollClearedAt: null };
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
      var brand = document.querySelector('.brand');
      if (brand && brand.classList.contains('is-gone') && window.__marks.brandGoneAt === null) {
        window.__marks.brandGoneAt = performance.now();
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

    console.log('\n首屏:');
    await sleep(2900);
    const brand = JSON.parse(await evaluate(`JSON.stringify({
      hasBrand: !!document.querySelector('.brand'),
      wordmark: document.querySelector('.brand__solid') ? document.querySelector('.brand__solid').textContent.trim() : null,
      enterVisible: !!document.querySelector('.brand__enter')
        && getComputedStyle(document.querySelector('.brand__enter')).display !== 'none',
      noScroll: document.body.classList.contains('no-scroll'),
      plays: window.__marks.plays.length,
    })`));
    // 旧版的加载器（#loader）已经被品牌遮罩取代，这里断言遮罩本身
    check('首屏品牌遮罩在，第一次访问显示 LIVEINPASSION', brand.hasBrand && brand.wordmark === 'LIVEINPASSION', `"${brand.wordmark}"`);
    check('ENTER 已可用、页面初始锁滚动', brand.enterVisible === true && brand.noScroll === true, `enter=${brand.enterVisible} noScroll=${brand.noScroll}`);
    check('挂载时未调用 play()', brand.plays === 0, `${brand.plays} 次`);

    console.log('\n音乐播放器初始状态:');
    const audio = JSON.parse(await evaluate(`JSON.stringify({
      muted: document.getElementById('audioPlayer').muted,
      volume: document.getElementById('audioPlayer').volume,
      src: decodeURIComponent(document.getElementById('audioPlayer').src),
      plays: window.__marks.plays.length
    })`));
    // 起播就出声：初始**不**静音（旧版是 muted = true，所谓自动播放其实是静音在放）
    check('初始不静音（起播就出声）', audio.muted === false);
    check('音量 0.3', Math.abs(audio.volume - 0.3) < 0.001, String(audio.volume));
    // 起始曲目固定第一首（旧版是 Math.random() 抽一首）
    check('固定选中第一首 Almost Nothing', /Almost Nothing - Silent PoetsOkay Kaya\.mp3/.test(audio.src), audio.src.split('/').pop());

    // 点 ENTER 进站：ENTER 就是首次交互 → 音乐起播、遮罩演完后退场
    await evaluate(`document.querySelector('.brand__enter').click(); 1`);
    let brandGone = false;
    for (let i = 0; i < 60 && !brandGone; i++) {
      brandGone = await evaluate(`!!document.querySelector('.brand.is-gone')`);
      if (!brandGone) await sleep(200);
    }
    check('点 ENTER 后品牌遮罩退场', brandGone === true);
    check('遮罩退场后滚动放开', (await evaluate(`document.body.classList.contains('no-scroll')`)) === false);
    await sleep(600);
    const afterFirst = await evaluate(`window.__marks.plays.length`);
    check('ENTER（首次交互）后播放一次', afterFirst === 1, `${afterFirst} 次`);
    // 起播的**状态**也要跟上：旧版自动起播只调 play() 不置 isPlaying，
    // 于是进度条在走、按钮还显示"播放"，用户要点两下才停得下来。
    const playIconAfter = await evaluate(`document.querySelector('.play-icon').style.display`);
    check('起播后播放键切到暂停态（isPlaying 与真实播放同步）', playIconAfter === 'none', `display=${playIconAfter}`);
    await evaluate(`document.body.click()`);
    await sleep(300);
    const afterSecond = await evaluate(`window.__marks.plays.length`);
    check('再次交互不再重复播放（监听器已移除）', afterSecond === 1, `${afterSecond} 次`);

    console.log('\n头部:');
    const headerHome = JSON.parse(await evaluate(`JSON.stringify((function(){
      var h = document.getElementById('header');
      var p = document.querySelector('.nav-pill');
      var r = h.getBoundingClientRect();
      var cs = getComputedStyle(p);
      var cur = document.querySelector('.nav-current');
      return {
        left: Math.round(r.left), right: Math.round(innerWidth - r.right), top: Math.round(r.top),
        pillBg: cs.backgroundColor,
        pillBlur: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
        current: cur ? cur.textContent.trim() : '',
        dots: !!document.querySelector('.nav-dots'),
        back: !!document.getElementById('backLink')
      };
    })())`));
    // 悬浮条：左/右留白相等 = 居中；top 贴顶
    check('导航悬浮在顶部且水平居中', Math.abs(headerHome.left - headerHome.right) <= 1 && headerHome.top === 0, `left=${headerHome.left} right=${headerHome.right} top=${headerHome.top}`);
    check('首页不显示当前板块、没有返回键', headerHome.current === '' && headerHome.back === false, `current="${headerHome.current}" back=${headerHome.back}`);
    check('条里有三个点', headerHome.dots === true);
    check('条面有毛玻璃或底色', headerHome.pillBlur !== 'none' || !/rgba\(0, 0, 0, 0\)/.test(headerHome.pillBg), `blur=${headerHome.pillBlur} bg=${headerHome.pillBg}`);
    // 撑高页面再滚动：头部是 fixed 的悬浮条，滚动时不应该跟着走
    await evaluate(`(function () {
      var spacer = document.createElement('div');
      spacer.id = '__spacer';
      spacer.style.height = '2000px';
      document.body.appendChild(spacer);
      window.scrollTo(0, 300);
      return 1;
    })()`);
    await sleep(250);
    const headerScrolled = await evaluate(`Math.round(document.getElementById('header').getBoundingClientRect().top)`);
    check('滚动后头部仍在顶部', headerScrolled === 0, `top=${headerScrolled}`);
    await evaluate(`window.scrollTo(0, 0); document.getElementById('__spacer').remove(); 1`);
    await sleep(200);

    // 三个点：所有板块入口只在窗帘里，且不写编号、不画分割线
    await evaluate(`document.querySelector('.nav-dots').click(); 1`);
    await sleep(1300);
    const curtain = JSON.parse(await evaluate(`JSON.stringify((function(){
      var c = document.getElementById('navCurtain');
      var links = c ? [...c.querySelectorAll('.nav-curtain__link')] : [];
      var first = links[0];
      var linksBox = c ? c.querySelector('.nav-curtain__links') : null;
      return {
        open: !!c && c.classList.contains('is-open'),
        linkCount: links.length,
        labels: links.map(function (a) { return a.textContent.trim(); }),
        indexes: c ? c.querySelectorAll('.nav-curtain__index').length : -1,
        linksBorder: linksBox ? getComputedStyle(linksBox).borderTopWidth : null,
        firstBorder: first ? getComputedStyle(first).borderBottomWidth : null,
        dotsMinus: document.querySelector('.nav-dots').classList.contains('is-open'),
        bodyLocked: document.documentElement.classList.contains('nav-curtain-open'),
      };
    })())`));
    check('三个点打开窗帘', curtain.open === true);
    check('窗帘里是全部板块入口', curtain.linkCount === 6 && curtain.labels.slice(0, 5).join(',') === 'HOME,ECHOES,FILM,PHOTO,LIFE', `${curtain.linkCount}: ${curtain.labels.join(',')}`);
    check('窗帘不写编号', curtain.indexes === 0, `${curtain.indexes} 个`);
    check('窗帘不画分割线', curtain.linksBorder === '0px' && curtain.firstBorder === '0px', `top=${curtain.linksBorder} bottom=${curtain.firstBorder}`);
    check('三个点变成横向减号、页面滚动被锁住', curtain.dotsMinus === true && curtain.bodyLocked === true);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 1`);
    await sleep(950);
    check('Esc 收起并卸载窗帘', (await evaluate(`!document.getElementById('navCurtain')`)) === true);

    console.log('\n跨路由不卸载:');
    await evaluate(`window.__audioEl = document.getElementById('audioPlayer'); window.__audioEl.__probe = 'kept'; document.getElementById('audioPlayer').currentTime = 1; 1`);
    await evaluate(`window.history.pushState({}, '', '/blogs'); window.dispatchEvent(new PopStateEvent('popstate')); 1`);
    // /blogs 会重定向到 /echoes，转场板子演完才换路由 —— 给足时间
    for (let i = 0; i < 20 && (await evaluate(`location.pathname`)) === '/'; i++) await sleep(200);
    await sleep(600);
    const nav = JSON.parse(await evaluate(`JSON.stringify({
      path: location.pathname,
      sameElement: document.getElementById('audioPlayer') === window.__audioEl,
      probe: document.getElementById('audioPlayer') && document.getElementById('audioPlayer').__probe,
      currentTime: document.getElementById('audioPlayer').currentTime,
      current: document.querySelector('.nav-current') ? document.querySelector('.nav-current').textContent.trim() : null,
      brandGone: !!document.querySelector('.brand.is-gone'),
      backVisible: document.getElementById('backLink') ? getComputedStyle(document.getElementById('backLink')).display : null
    })`));
    check('已切到 /echoes 且未整页刷新', nav.path === '/echoes' && nav.sameElement === true, nav.path);
    check('audio 元素身份未变、进度保留', nav.probe === 'kept' && nav.currentTime >= 0.9, `currentTime=${nav.currentTime.toFixed(2)}`);
    check('条里显示当前板块 ECHOES', nav.current === 'ECHOES', `"${nav.current}"`);
    check('返回按钮显示', nav.backVisible === 'inline-flex', nav.backVisible);
    check('路由切换没有重新显示首屏遮罩', nav.brandGone === true);

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
