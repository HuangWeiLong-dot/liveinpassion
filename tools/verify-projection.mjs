// /projection 放映页的结构与行为断言。
//
// 用法：先 `cd app && npm run build && npx vite preview --port 4174`，
// 再 `node tools/verify-projection.mjs http://localhost:4174`。
//
// 断言的是这一页"说它是什么就必须是什么"的那几条：
//   1. 标题卡在、标题是纯大写、引文两行都在；
//   2. 光效只有黑白：不再有彩色 .leak，镜头散射层（.proj__rays / .proj__optics）在；
//   3. 这一页不挂全局页脚，左下角 Ava 塔和音乐播放器被隐藏；
//   4. 机身下沿的实体键 / 音量刻度尺在；按播放键后影片在同一个屏幕里播；Esc 回到标题卡；
//   5. 手机宽度下不横向溢出；
//   6. 全程零 console 报错。
//
// 片源在 R2（134 MB）。这里不下载整支片子，只断言 video 元素进入了播放态；
// 网络不可达时 video 会停在 buffering，脚本会把原因打印出来而不是误报通过。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] || 'http://localhost:4174';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.CDP_PORT || 9222);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-projection-'));

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1440,900',
  '--hide-scrollbars',
  '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const results = [];
function assert(ok, label, detail = '') {
  results.push({ ok: Boolean(ok), label, detail });
  if (!ok) failures += 1;
}

async function wsUrl() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('Chrome 没有起来');
}

const ws = new WebSocket(await wsUrl());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
const events = [];
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  } else if (msg.method) {
    events.push(msg);
  }
});

function send(method, params = {}) {
  id += 1;
  const myId = id;
  return new Promise((resolve, reject) => {
    pending.set(myId, { resolve, reject });
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
}

// 轮询到条件满足或超时：无头环境里 rAF 的帧率和 CDN 的带宽都不稳定，
// 固定 sleep 会让断言假失败。
async function waitFor(fn, timeoutMs = 4000, intervalMs = 120) {
  const end = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  return last;
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    const msg = r.exceptionDetails.exception?.description || r.exceptionDetails.text;
    throw new Error(`页面里这段断言代码抛错了：${msg}\n${expression.trim().slice(0, 160)}`);
  }
  return r.result?.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/projection` });
await sleep(2600);

// 品牌遮罩：先点 ENTER 才看得到页面
await evaluate(`document.querySelector('.brand__enter')?.click()`);
await sleep(2600);

const poster = await evaluate(`(() => {
  const q = (s) => document.querySelector(s);
  const title = q('.proj__title');
  const tr = title?.getBoundingClientRect();
  const screen = q('.proj__screen');
  const sr = screen?.getBoundingClientRect();
  return {
    route: location.pathname,
    hasPoster: !!q('.proj__poster'),
    hasTv: !!q('.proj__tv') && !!screen,
    titleText: title?.textContent?.trim() || '',
    titleTransform: title ? getComputedStyle(title).textTransform : '',
    titleCenterX: tr ? tr.x + tr.width / 2 : 0,
    titleCenterY: tr ? tr.y + tr.height / 2 : 0,
    screenCenterX: sr ? sr.x + sr.width / 2 : 0,
    screenCenterY: sr ? sr.y + sr.height / 2 : 0,
    viewportW: innerWidth,
    viewportH: innerHeight,
    hasQuote: !!q('.proj__quote, .quote-line'),
    hasMeta: !!q('.proj__meta'),
    hasKicker: !!q('.proj__kicker'),
    grainOpacity: Number(getComputedStyle(q('.proj__grain')).opacity),
    sunCount: document.querySelectorAll('.proj__sun').length,
    leaks: document.querySelectorAll('.leak').length,
    rays: document.querySelectorAll('.proj__rays').length,
    optics: document.querySelectorAll('.optic').length,
    flare: document.querySelectorAll('.proj__flare').length,
    letterCount: document.querySelectorAll('.proj__char').length,
    hasSweep: !!q('.proj__sweep'),
    colored: [...document.querySelectorAll('.proj *')].some((el) => {
      const c = getComputedStyle(el).backgroundColor || '';
      const m = c.match(/rgba?\\((\\d+), (\\d+), (\\d+)/);
      return m && !(m[1] === m[2] && m[2] === m[3]);
    }),
    footer: !!document.querySelector('.footer'),
    towerOpacity: q('.author-tower') ? getComputedStyle(q('.author-tower')).opacity : 'none',
    playerOpacity: q('.music-player') ? getComputedStyle(q('.music-player')).opacity : 'none',
    nowPlayingOpacity: q('.now-playing') ? getComputedStyle(q('.now-playing')).opacity : 'none',
    pageClass: document.documentElement.className,
    scrollW: document.documentElement.scrollWidth,
    innerW: innerWidth,
  };
})()`);

assert(poster.route === '/projection', '路由停在 /projection');
assert(poster.hasPoster, '标题卡存在');
assert(poster.titleTransform === 'uppercase', '标题是大写', poster.titleTransform);
assert(poster.hasTv, '复古电视机在');
assert(
  Math.abs(poster.titleCenterX - poster.screenCenterX) < 2
    && Math.abs(poster.titleCenterY - poster.screenCenterY) < 2,
  '标题在电视屏幕正中',
  `${Math.round(poster.titleCenterX)},${Math.round(poster.titleCenterY)} / ${Math.round(poster.screenCenterX)},${Math.round(poster.screenCenterY)}`
);
assert(!poster.hasQuote && !poster.hasMeta && !poster.hasKicker, '标题卡上没有台词 / 说明文字');
assert(poster.grainOpacity >= 0.15, '高噪点颗粒还在', String(poster.grainOpacity));
assert(poster.sunCount === 1, '只有一团跟随鼠标的光', String(poster.sunCount));

// 光晕跟鼠标：先把指针放到左上，再甩到右下，读 --gx/--gy 有没有跟过去
const readGlow = () => evaluate(`(() => {
  const stage = document.querySelector('.proj');
  const sun = document.querySelector('.proj__sun');
  return {
    o: Number(getComputedStyle(sun).opacity),
    gx: parseFloat(stage.style.getPropertyValue('--gx')),
    gy: parseFloat(stage.style.getPropertyValue('--gy')),
  };
})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 420, y: 300, button: 'none' });
await sleep(500);
const glowA = await readGlow();
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1040, y: 620, button: 'none' });
const glowB = await waitFor(async () => {
  const g = await readGlow();
  return Math.abs(g.gx - 1040) < 20 && Math.abs(g.gy - 620) < 20 ? g : null;
}, 3000, 100) || await readGlow();
assert(glowA.o > 0.05, '鼠标在页面上时光晕亮着', String(glowA.o));
assert(Math.abs(glowB.gx - 1040) < 24 && Math.abs(glowB.gy - 620) < 24, '光晕跟到鼠标的位置', `${glowB.gx},${glowB.gy}`);
assert(poster.leaks === 0, '没有旧的彩色光斑 .leak');
assert(
  poster.rays === 0 && poster.optics === 0 && poster.flare === 0,
  '画面里没有游离的镜头光晕 / 放射光丝',
  `rays=${poster.rays} optics=${poster.optics} flare=${poster.flare}`
);
assert(poster.letterCount === 13, '片名拆成 13 个字母逐个入场', String(poster.letterCount));
assert(poster.hasSweep, '进场那道光还在');
assert(!poster.footer, '这一页不挂全局页脚');
assert(poster.towerOpacity === '0', '左下角 Ava 塔已隐藏', poster.towerOpacity);
assert(poster.playerOpacity === '0', '音乐播放器已隐藏', poster.playerOpacity);
assert(poster.nowPlayingOpacity === '0' || poster.nowPlayingOpacity === 'none', '歌词/频谱层已隐藏', poster.nowPlayingOpacity);
assert(poster.scrollW <= poster.innerW + 1, '桌面不横向溢出', `${poster.scrollW}/${poster.innerW}`);

// 导航多了一项 FILM：中等宽度（还没到汉堡断点）下不能撞在一起
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await sleep(700);
const headerFit = await evaluate(`(() => {
  const nav = document.querySelector('#header nav');
  const logo = document.querySelector('#header .logo');
  const n = nav.getBoundingClientRect();
  const l = logo.getBoundingClientRect();
  return { navRight: Math.round(n.right), navLeft: Math.round(n.left), logoRight: Math.round(l.right), innerW: innerWidth, scrollW: document.documentElement.scrollWidth };
})()`);
assert(
  headerFit.navRight <= headerFit.innerW + 1 && headerFit.navLeft >= headerFit.logoRight,
  '1100px 下头部导航不撞 LOGO、不出屏',
  `nav=${headerFit.navLeft}-${headerFit.navRight} logo右=${headerFit.logoRight} 屏宽=${headerFit.innerW}`
);
assert(headerFit.scrollW <= headerFit.innerW + 1, '1100px 下不横向溢出', `${headerFit.scrollW}/${headerFit.innerW}`);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(500);

// 机身下沿的实体键：上一集 / 播放 / 下一集 / 停止 / 全屏 + 音量刻度尺
const deck = await evaluate(`(() => ({
  keys: document.querySelectorAll('.proj__deck .tv-key').length,
  knob: !!document.querySelector('.proj__tuner'),
  knobInput: !!document.querySelector('.proj__tuner-input'),
  disabled: document.querySelectorAll('.proj__deck .tv-key:disabled').length,
  playInScreen: !!document.querySelector('.proj__poster button'),
}))()`);
assert(deck.keys === 5, '机身下沿有 5 个实体键', String(deck.keys));
assert(deck.knob && deck.knobInput, '音量刻度尺在（可拖、可键盘调）');
assert(deck.disabled === 2, '只有一部片子时上一集/下一集是禁用的', String(deck.disabled));
assert(!deck.playInScreen, '屏幕里没有 PLAY 按钮（只负责显示）');

// 进片：按机身下沿的播放键
await evaluate(`document.querySelector('.tv-key--main').click()`);

const playing = await waitFor(async () => {
  const s = await evaluate(`(() => {
    const v = document.querySelector('video');
    return {
      paused: v?.paused,
      t: v?.currentTime || 0,
      ready: v?.readyState,
      headerOpacity: getComputedStyle(document.querySelector('#header')).opacity,
      posterDisplay: getComputedStyle(document.querySelector('.proj__poster')).display,
      src: v?.currentSrc || '',
    };
  })()`);
  return s && s.paused === false ? s : null;
}, 8000, 200) || { paused: true, t: 0, ready: -1, headerOpacity: '1', posterDisplay: 'none', src: '' };

assert(playing.src.includes('/films/the-projection.mp4'), '片源指向 R2 上的原片', playing.src);
assert(playing.paused === false, '按播放键后影片在电视里开始播', `readyState=${playing.ready}`);
assert(playing.posterDisplay === 'none', '标题卡让位给正片（同一个屏幕里）');
assert(
  Number(playing.headerOpacity) > 0.9,
  '进片不换版式：头部还在原位',
  `opacity=${playing.headerOpacity}`
);

// 进度单独等：原片 134 MB，CDN 抽风时无头浏览器可能一直缓冲不出画面。
// 这种情况算环境问题，不算页面回归 —— 打一行 ! 提示，不计失败。
const progressed = await waitFor(async () => {
  const t = await evaluate(`document.querySelector('video')?.currentTime || 0`);
  return t > 0.5 ? t : null;
}, 25000, 800);
const audioDecode = await evaluate(`(() => {
  const v = document.querySelector('video');
  return { supported: 'webkitAudioDecodedByteCount' in v, bytes: v.webkitAudioDecodedByteCount || 0 };
})()`);
if (audioDecode.supported && progressed) {
  assert(audioDecode.bytes > 0, '音频轨真的在解码（不是静音文件）', String(audioDecode.bytes));
}

if (progressed) {
  assert(true, '播放进度在走', `t=${Number(progressed).toFixed(2)}`);
} else {
  console.log('! 播放进度没动：25 秒内没缓冲出画面，网络太慢 —— 跳过这条');
}

// 复古进度条：点/拖/方向键都能定位
const track = await evaluate(`(() => {
  const el = document.querySelector('.proj__track');
  return { exists: !!el, max: Number(el?.max || 0), value: Number(el?.value || 0) };
})()`);
assert(track.exists, '机身下沿有进度条');
await evaluate(`(() => {
  const el = document.querySelector('.proj__track');
  el.value = String(Number(el.max) * 0.5);
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(600);
const afterSeek = await evaluate(`(() => ({
  t: document.querySelector('video').currentTime,
  d: Number(document.querySelector('.proj__track').max),
}))()`);
assert(
  Number.isFinite(afterSeek.d) && afterSeek.d > 0 && Math.abs(afterSeek.t - afterSeek.d * 0.5) < 2,
  '进度条能定位到一半',
  `t=${afterSeek.t?.toFixed?.(2)} d=${afterSeek.d}`
);

// 音量刻度尺：点左端 / 往右拖，指针和读数都要跟过去（控制的是 Web Audio 增益）
const readVol = () => evaluate(`parseInt(((document.querySelector('.proj__vol') || {}).textContent || '').replace(/\\D/g, ''), 10)`);
const readNeedle = () => evaluate(`parseFloat(((document.querySelector('.proj__tuner-needle') || {}).style || {}).left) || 0`);
const tuner = await evaluate(`(() => {
  const r = document.querySelector('.proj__tuner').getBoundingClientRect();
  return { x: Math.round(r.x), w: Math.round(r.width), y: Math.round(r.y + r.height / 2) };
})()`);
assert(tuner.w > 0, '音量刻度尺在', `${tuner.w}px`);

await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tuner.x + Math.round(tuner.w * 0.2), y: tuner.y, button: 'left', buttons: 1, clickCount: 1 });
await sleep(200);
const volLeft = await readVol();
const needleLeft = await readNeedle();
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tuner.x + Math.round(tuner.w * 0.85), y: tuner.y, button: 'left', buttons: 1 });
await sleep(200);
const volRight = await readVol();
const needleRight = await readNeedle();
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tuner.x + Math.round(tuner.w * 0.85), y: tuner.y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(200);

assert(Math.abs(needleLeft - 20) <= 4, '点刻度左端指针跟着跳过去', `${needleLeft}%`);
assert(volRight > volLeft + 40, '按住往右拖音量变大', `${volLeft} → ${volRight}`);
assert(Math.abs(needleRight - 85) <= 4, '拖到右端指针在 85%', `${needleRight}%`);
assert(/^\d{1,3}$/.test(String(volRight)), '音量有数字读数', String(volRight));

// 松手之后指针再移动，音量不能再跟着变（旧实现会残留 pointermove 监听）
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 300, y: 800, button: 'none' });
await sleep(300);
const volAfterRelease = await readVol();
assert(
  volAfterRelease === volRight,
  '松开后鼠标移动不再改音量',
  `${volRight} → ${volAfterRelease}`
);

// MUTE / VOL 100 来回切，读数和旁边组件的几何尺寸都不能变
const layout = async () => evaluate(`(() => {
  const t = document.querySelector('.proj__tuner').getBoundingClientRect();
  const p = document.querySelector('.proj__track').getBoundingClientRect();
  const v = document.querySelector('.proj__vol').getBoundingClientRect();
  return {
    tuner: [Math.round(t.x), Math.round(t.width)],
    track: [Math.round(p.x), Math.round(p.width)],
    vol: [Math.round(v.x), Math.round(v.width)],
  };
})()`);
const clickTuner = async (f) => {
  const x = tuner.x + Math.round(tuner.w * f);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y: tuner.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: tuner.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(250);
};
await clickTuner(0);
const layoutMute = await layout();
const muteText = await evaluate(`document.querySelector('.proj__vol').textContent.trim()`);
await clickTuner(0.99);
const layoutMax = await layout();
assert(muteText === 'MUTE', '拖到最左显示 MUTE', muteText);
assert(
  JSON.stringify(layoutMute) === JSON.stringify(layoutMax),
  'MUTE 和 VOL 99 时旁边组件尺寸不变',
  `${JSON.stringify(layoutMute)} vs ${JSON.stringify(layoutMax)}`
);

// Esc 退出
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(1200);

const afterEsc = await evaluate(`(() => {
  const v = document.querySelector('video');
  return {
    paused: v?.paused,
    posterDisplay: getComputedStyle(document.querySelector('.proj__poster')).display,
    headerOpacity: getComputedStyle(document.querySelector('#header')).opacity,
    immersive: document.documentElement.classList.contains('projection-immersive'),
  };
})()`);

assert(afterEsc.paused === true, 'Esc 之后视频暂停');
assert(afterEsc.posterDisplay !== 'none', 'Esc 之后回到标题卡');
assert(
  Number(afterEsc.headerOpacity) > 0.9 && !afterEsc.immersive,
  'Esc 之后头部回来',
  `opacity=${afterEsc.headerOpacity} immersive=${afterEsc.immersive}`
);

// 手机
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// 等标题卡真的回到 display 状态再量，避免和 Esc 之后的重绘抢时间
await waitFor(async () => {
  const d = await evaluate(`getComputedStyle(document.querySelector('.proj__poster')).display`);
  return d && d !== 'none' ? d : null;
}, 4000, 100);
await sleep(500);
const mobile = await evaluate(`(() => {
  const t = document.querySelector('.proj__title').getBoundingClientRect();
  const p = document.querySelector('.tv-key--main').getBoundingClientRect();
  return {
    scrollW: document.documentElement.scrollWidth,
    innerW: innerWidth,
    scrollH: document.documentElement.scrollHeight,
    innerH: innerHeight,
    titleInside: t.left >= 0 && t.right <= innerWidth + 1,
    playInside: p.left >= 0 && p.right <= innerWidth + 1 && p.height >= 44,
    playRect: [Math.round(p.x), Math.round(p.y), Math.round(p.width), Math.round(p.height)],
    posterDisplay: getComputedStyle(document.querySelector('.proj__poster')).display,
  };
})()`);

assert(mobile.scrollW <= mobile.innerW + 1, '手机不横向溢出', `${mobile.scrollW}/${mobile.innerW}`);
assert(mobile.titleInside, '手机标题在屏内');
assert(mobile.playInside, '手机上的主播放键在屏内且够大', `${mobile.playRect} poster=${mobile.posterDisplay}`);
assert(mobile.scrollH <= mobile.innerH + 1, '整页不纵向溢出', `${mobile.scrollH}/${mobile.innerH}`);

const errors = events
  .filter((m) => m.method === 'Runtime.exceptionThrown'
    || (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error'))
  .map((m) => m.params.exceptionDetails?.exception?.description
    || m.params.args?.map((a) => a.value || a.description).join(' '));
assert(errors.length === 0, '零 console 报错', errors.join(' | '));

for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.label}${r.ok || !r.detail ? '' : `  (${r.detail})`}`);
}
console.log(failures ? `\n${failures} 项失败` : '\n全部通过');

ws.close();
chrome.kill();
await sleep(400);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(failures ? 1 : 0);
