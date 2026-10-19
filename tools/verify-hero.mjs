// 首页概念入口（HeroConcept.vue）的验收：结构 + 光标 + 粒子重组 + 共享元素过渡 + 移动端。
//
//   cd app && npm run build && npx vite preview --port 4174 --strictPort
//   node tools/verify-hero.mjs http://localhost:4174/
//
// 粒子这块不靠肉眼看截图判断。核心断言是直接读 canvas 像素算**均方根半径**：
// 散开态粒子铺得开，成图态粒子收进图片框内，两者的 RMS 必然拉开差距；
// 顺带数非透明像素个数（确认粒子真的生成了）和平均 alpha（确认明暗变化）。
//
// 截图写到 HERO_OUT_DIR（默认系统临时目录）。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const url = process.argv[2] || 'http://localhost:4174/';
const outDir = process.env.HERO_OUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'hero-shots-'));
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const notes = [];
function check(ok, label, detail = '') {
  if (ok) notes.push(`  ok   ${label}${detail ? ` — ${detail}` : ''}`);
  else failures.push(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
}

// 在页面里跑：统计某个 canvas 上非透明像素的分布
const DUST_STATS = `
window.__dustStats = function (canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  if (!width || !height) return null;
  const d = ctx.getImageData(0, 0, width, height).data;
  let n = 0, sx = 0, sy = 0, sa = 0, sl = 0;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const a = d[(row + x) * 4 + 3];
      if (a > 8) {
        n++; sx += x; sy += y; sa += a;
        sl += d[(row + x) * 4];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (!n) return { count: 0, rms: 0, meanAlpha: 0 };
  const cx = sx / n, cy = sy / n;
  let ss = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (d[(row + x) * 4 + 3] > 8) { ss += (x - cx) ** 2 + (y - cy) ** 2; }
    }
  }
  // 稀疏采样打一个校验和：粒子只要动了，这个值就会变。
  // 用来验证"静止时粒子也在飘"——质心/rms 之类的聚合量对随机漂移不敏感。
  let hash = 0;
  for (let y = 0; y < height; y += 5) {
    const row = y * width;
    for (let x = 0; x < width; x += 3) hash = (hash * 31 + d[(row + x) * 4 + 3]) | 0;
  }

  return {
    count: n,
    // 均方根半径（相对 canvas 宽度归一化）：衡量粒子铺得多开
    rms: Math.sqrt(ss / n) / width,
    meanAlpha: sa / n,
    meanLuma: sl / n, // 画出来的粒子的平均亮度（用来验证主题反色）
    w: width, h: height,
    cx: Math.round(cx), cy: Math.round(cy),
    bbox: [minX, minY, maxX - minX, maxY - minY],
    hash,
  };
};

// 共享尘带的形态分析。四团现在混在同一块画布上，单看"铺得多开"没意义了，
// 要回答的是两件事：
//   centerFrac —— 中心是不是空的（主体在那儿）。低了才叫"环绕"而不是"一团"。
//   sectors    —— 把整圈切成 36 份，每份画了多少像素。全都有值才是"连续带"。
// 顺带把 sectors 原样返回，调用方可以比较悬停前后各扇区怎么变 ——
// 若粒子真的混在整圈上，悬停某团时**对面那一侧**也会掉像素。
window.__ringStats = function (canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const d = ctx.getImageData(0, 0, width, height).data;
  const cx = width / 2;
  const cy = height / 2;
  const innerR = width * 0.12; // 主体所占的中央区，应当基本是空的
  const sectors = new Array(36).fill(0);
  let n = 0;
  let centerN = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (d[(y * width + x) * 4 + 3] <= 8) continue;
      n++;
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      if (r < innerR) { centerN++; continue; }
      const a = Math.atan2(dy, dx) + Math.PI;
      sectors[Math.min(35, Math.floor((a / (Math.PI * 2)) * 36))]++;
    }
  }
  return {
    total: n,
    centerFrac: n ? centerN / n : 1,
    filled: sectors.filter((s) => s > 5).length,
    sectors,
  };
};

// 某个矩形区域里的绘制像素数（用来量"悬停的那一格收进去了多少"）
window.__regionCount = function (canvas, x, y, w, h) {
  const ctx = canvas.getContext('2d');
  const cw = canvas.width;
  const ch = canvas.height;
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(cw, Math.ceil(x + w));
  const y1 = Math.min(ch, Math.ceil(y + h));
  if (x1 <= x0 || y1 <= y0) return 0;
  const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
  return n;
};

// 四条流的形态：每条的"末端"（格内，应该聚着一个人形）和"中段"
// （主体边界到格心的中间，应该是那条流的路径）各有多少绘制像素。
// 这是"流是路径、末端聚成人格图"的直接证据 —— 中段空了就说明只是四个孤立的团，
// 末端空了就说明流没有末端。
window.__strandStats = function (canvas) {
  const stage = document.querySelector('.hero-concept').getBoundingClientRect();
  const subj = document.querySelector('.hero-subject').getBoundingClientRect();
  const scx = subj.left - stage.left + subj.width / 2;
  const scy = subj.top - stage.top + subj.height / 2;
  return [...document.querySelectorAll('.persona')].map((el) => {
    const r = el.getBoundingClientRect();
    const hx = r.left - stage.left + r.width / 2;
    const hy = r.top - stage.top + r.height / 2;
    const mx = (scx + hx) / 2;
    const my = (scy + hy) / 2;
    return {
      head: window.__regionCount(canvas, hx - r.width / 2, hy - r.height / 2, r.width, r.height),
      mid: window.__regionCount(canvas, mx - r.width * 0.7, my - r.height * 0.7, r.width * 1.4, r.height * 1.4),
    };
  });
};

// 两张截图在指定矩形内的差异像素数。用来验"鼠标压住的那块是静的"：
// 重组会把旗帜波纹在那块压掉，所以它几乎不动，而周围还在飘。
window.__regionDiff = async function (aB64, bB64, x, y, w, h) {
  const load = (b64) => new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = 'data:image/png;base64,' + b64;
  });
  const [A, B] = await Promise.all([load(aB64), load(bB64)]);
  const c = document.createElement('canvas');
  c.width = A.width; c.height = A.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(A, 0, 0);
  const da = ctx.getImageData(0, 0, c.width, c.height).data;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(B, 0, 0);
  const db = ctx.getImageData(0, 0, c.width, c.height).data;
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(c.width, Math.round(x + w));
  const y1 = Math.min(c.height, Math.round(y + h));
  let n = 0;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * c.width + xx) * 4;
      if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 24) n++;
    }
  }
  return { n, area: Math.max(1, (x1 - x0) * (y1 - y0)) };
};

// 主体粒子层的"静度"：隔 ms 毫秒抓两次画布像素，数指定区域里变了多少。
//
// 为什么直接读画布而不是截图：主体带着一个"风"的 CSS 动画，整体一直在位移。
// 截图里两块区域粒子密度不同，同样幅度的位移在稀的地方产生的变化像素反而更少，
// 按密度归一化之后会得出与事实相反的结论（实测过：鼠标附近"更动"）。
// 直接读画布上的像素就完全绕开了 CSS 变换。
window.__grainJitter = async function (x, y, w, h, ms) {
  const c = document.querySelector('canvas.hero-subject__grain');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(c.width, Math.round(x + w));
  const y1 = Math.min(c.height, Math.round(y + h));
  const sw = x1 - x0;
  const sh = y1 - y0;
  if (sw <= 0 || sh <= 0) return { n: 0, area: 1, pix: 0 };
  const grab = () => ctx.getImageData(x0, y0, sw, sh).data.slice();
  const a = grab();
  await new Promise((r) => setTimeout(r, ms));
  const b = grab();
  let n = 0;
  let pix = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] > 8) pix++;
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++;
  }
  return { n, area: sw * sh, pix };
};

// 两张截图在指定矩形内的平均差异幅度（每像素三通道 |Δ| 的均值）。
// 用来做受控 A/B：同一个位置，分别在"鼠标在它上面"和"鼠标在别处"时测，
// 内容带来的偏移在两次里是一样的，差出来的就是涟漪。
window.__regionMag = async function (aB64, bB64, x, y, w, h) {
  const load = (b64) => new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = 'data:image/png;base64,' + b64;
  });
  const [A, B] = await Promise.all([load(aB64), load(bB64)]);
  const c = document.createElement('canvas');
  c.width = A.width; c.height = A.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(A, 0, 0);
  const da = ctx.getImageData(0, 0, c.width, c.height).data;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(B, 0, 0);
  const db = ctx.getImageData(0, 0, c.width, c.height).data;
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(c.width, Math.round(x + w));
  const y1 = Math.min(c.height, Math.round(y + h));
  let sum = 0;
  let n = 0;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * c.width + xx) * 4;
      sum += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
      n++;
    }
  }
  return n ? sum / n : 0;
};

// 主体粒子层从边往里的密度分布。分带量：如果还有硬边，最外那一带仍会很密。
// 返回每一带的"绘制像素占比"，调用方看它是不是单调往里变密。
window.__edgeBands = function (canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const d = ctx.getImageData(0, 0, width, height).data;
  const bands = [[0, 0.05], [0.06, 0.12], [0.13, 0.20], [0.30, 1]];
  const hit = bands.map(() => 0);
  const area = bands.map(() => 0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const e = Math.min(x / width, 1 - x / width, y / height, 1 - y / height);
      const drawn = d[(y * width + x) * 4 + 3] > 8;
      for (let b = 0; b < bands.length; b++) {
        if (e >= bands[b][0] && e < bands[b][1]) {
          area[b]++;
          if (drawn) hit[b]++;
          break;
        }
      }
    }
  }
  return bands.map((_, b) => (area[b] ? hit[b] / area[b] : 0));
};

// 截图的平均亮度。用来卡"浅色主题下主体变成一块黑剪影"那类问题：
// 主体在浅色底上应该整体偏亮（照片淡向背景 = 白），不是一片黑。
window.__shotLuma = async function (b64) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = 'data:image/png;base64,' + b64;
  });
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    n++;
  }
  return n ? sum / n : 0;
};

// 某个矩形区域里绘制像素的数量与平均不透明度。
// 用来验主体粒子层的"鼠标处重组"：鼠标压住的那块应该比别处更实。
window.__regionStats = function (canvas, x, y, w, h) {
  const ctx = canvas.getContext('2d');
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(canvas.width, Math.ceil(x + w));
  const y1 = Math.min(canvas.height, Math.ceil(y + h));
  if (x1 <= x0 || y1 <= y0) return { n: 0, meanAlpha: 0 };
  const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  let n = 0;
  let sa = 0;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] > 8) { n++; sa += d[i]; }
  }
  return { n, meanAlpha: n ? sa / n : 0 };
};

// 两张截图的差异重心（归一化到 0..1）。用来验证水波纹的中心确实落在鼠标处：
// 波纹影响随距离衰减，所以"变了的地方"应该聚在鼠标周围。
window.__diffCentroid = async function (aB64, bB64, inset, threshold) {
  const TH = threshold || 24;
  const load = (b64) => new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = 'data:image/png;base64,' + b64;
  });
  const [A, B] = await Promise.all([load(aB64), load(bB64)]);
  const c = document.createElement('canvas');
  c.width = A.width; c.height = A.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(A, 0, 0);
  const da = ctx.getImageData(0, 0, c.width, c.height).data;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(B, 0, 0);
  const db = ctx.getImageData(0, 0, c.width, c.height).data;
  // inset：跳过外圈。主体是羽化的，边缘会透出后面公转的星尘，
  // 那部分像素变化跟水波纹无关，会把重心带偏。
  const pad = Math.round((inset || 0) * Math.min(c.width, c.height));
  let n = 0, sx = 0, sy = 0;
  for (let y = pad; y < c.height - pad; y++) {
    for (let x = pad; x < c.width - pad; x++) {
      const i = (y * c.width + x) * 4;
      const dd = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
      if (dd > TH) { n++; sx += x; sy += y; }
    }
  }
  // 重心仍按完整裁剪框归一化，这样期望值可以直接用鼠标在主体里的相对位置
  const area = (c.width - 2 * pad) * (c.height - 2 * pad);
  return {
    n, w: c.width, h: c.height,
    ratio: n / area, // 差异像素占比：用来判断"两张图是不是同一张"
    cx: n ? sx / n / c.width : -1,
    cy: n ? sy / n / c.height : -1,
  };
};
`;

async function run() {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-hero-'));
  // --remote-debugging-port=0：让 Chrome 自己挑空端口，再从头文件里读回来。
  // 不用 9900+random 那种写法——本机 9932 上挂着别的东西，随机撞上去时
  // /json/version 会回 426，报出来只是一句 JSON 解析失败，很难查。
  const child = spawn(
    CHROME,
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`,
     '--no-first-run', '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
     '--window-size=1440,1200', 'about:blank'],
    { stdio: 'ignore' }
  );

  try {
    const portFile = path.join(profileDir, 'DevToolsActivePort');
    let port = null;
    for (let i = 0; i < 120 && !port; i++) {
      try {
        const line = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
        if (line) port = Number(line);
      } catch {}
      if (!port) await sleep(520);
    }
    if (!port) throw new Error('Chrome 没有写出 DevToolsActivePort，起不来了');

    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

    let id = 0;
    const pending = new Map();
    const handlers = new Map();
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
    // userGesture 只在需要**用户激活**的断言上给（比如点 ENTER 之后音频要真的起播）：
    // 真实鼠标点击带激活，Runtime.evaluate 默认不带，差别就是 audio.play() 会不会
    // 被自动播放策略拒掉。
    const evaluate = async (expr, { userGesture = false } = {}) => {
      const r = await send('Runtime.evaluate', {
        expression: expr, awaitPromise: true, returnByValue: true, ...(userGesture ? { userGesture: true } : {}),
      });
      if (r.exceptionDetails) {
        throw new Error('求值失败 ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 300));
      }
      return r.result.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

    // 页面脚本跑之前就包住 startViewTransition，数它有没有被调用过
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        // 数 WebGL 的绘制调用：既证明涟漪真的在画，也证明静止时确实停了
        window.__glDraws = 0;
        window.__glByCanvas = new Map();
        for (const proto of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
          if (!proto) continue;
          for (const m of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
            const orig = proto.prototype[m];
            if (!orig) continue;
            proto.prototype[m] = function (...a) {
              window.__glDraws++;
              // 按 canvas 分开数：三维场景每帧都在画，混在一起会把
              // 涟漪静止时停止渲染那条断言淹掉。
              const c = this.canvas;
              window.__glByCanvas.set(c, (window.__glByCanvas.get(c) || 0) + 1);
              return orig.apply(this, a);
            };
          }
        }
        window.__glDrawsFor = (sel) => {
          const el = document.querySelector(sel);
          return el ? (window.__glByCanvas.get(el) || 0) : 0;
        };

        // 画布调用耗时累加器。帧间隔在无头软件渲染下被合成器主导（.persona__photo
        // 带 filter + mask-composite 又在旋转容器里，每帧都要重新光栅化），
        // 量它反映不出我们这边的优化；直接量画布调用才是能控制的那部分。
        window.__cms = { ms: 0, fills: 0 };
        (function () {
          const P = window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype;
          if (!P) return;
          for (const n of ['clearRect', 'fill', 'fillRect']) {
            const orig = P[n];
            if (!orig) continue;
            P[n] = function (...a) {
              const t = performance.now();
              const r = orig.apply(this, a);
              window.__cms.ms += performance.now() - t;
              if (n === 'fill') window.__cms.fills++;
              return r;
            };
          }
        })();

        window.__vtCalls = 0;
        window.__vtNames = [];
        window.__vtSupported = typeof document.startViewTransition === 'function';
        if (window.__vtSupported) {
          const orig = document.startViewTransition.bind(document);
          document.startViewTransition = function (cb) {
            window.__vtCalls++;
            window.__vtNames.push(
              [...document.querySelectorAll('*')]
                .map((el) => getComputedStyle(el).getPropertyValue('view-transition-name'))
                .filter((n) => n && n !== 'none')
            );
            return orig(cb);
          };
        }
      `,
    });

    const consoleErrors = [];
    on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') consoleErrors.push((p.args || []).map((a) => a.value ?? a.description).join(' '));
    });
    on('Runtime.exceptionThrown', (p) => {
      consoleErrors.push('EXCEPTION ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));
    });

    const requestUrls = new Map();
    const failedRequests = [];
    on('Network.requestWillBeSent', (p) => requestUrls.set(p.requestId, p.request.url));
    on('Network.loadingFailed', (p) => failedRequests.push(`${requestUrls.get(p.requestId) || p.requestId} (${p.errorText})`));

    // 页面起不来时（服务没跑、端口不对）Chrome 会渲染一个 40+KB 的错误页，
    // 后面所有选择器都取空，报错会变成看不懂的东西。先卡一道，把原因说清楚。
    // 开场动画的状态。headDist 是末端离舞台中心的距离 —— 开场时它从 0 长出来。
    // 开场的进度现在是 JS 内部状态（uIntro 和 introEased 都不在 DOM 上），读不到。
    // 改成量**末端离舞台中心的距离**：开场时四条塌在主体身上、距离接近 0，
    // 延伸出去之后长到环半径，之后就在环上转。
    const INTRO_PROBE = `(() => {
      const s = document.querySelector('.hero-concept__stage').getBoundingClientRect();
      const r = document.querySelector('.persona').getBoundingClientRect();
      return {
        headDist: Math.hypot(
          r.left + r.width / 2 - (s.left + s.width / 2),
          r.top + r.height / 2 - (s.top + s.height / 2)
        ),
      };
    })()`;

    // 背景字下面那行小字（INDIVIDUATION）。是逐字打的，所以"打了几个"要按每个字
    // 自己的计算不透明度数。**有效**不透明度还得把祖先链上的 opacity 乘进来 ——
    // 小字要是挂在带 0.075 的那层里面，它自己算出来是 1，整个却只有几个百分点，
    // 那种情况只有这个乘积测得到（第一版就是这么翻的车）。
    const CAPTION_PROBE = `(() => {
      const cap = document.querySelector('.hero-caption');
      const line = document.querySelector('.hero-wordmark__line');
      const ink = document.querySelector('.hero-wordmark__ink');
      if (!cap || !line) return null;
      const chars = [...cap.querySelectorAll('.hero-caption__ch')];
      const r = cap.getBoundingClientRect();
      const lr = line.getBoundingClientRect();
      let chain = 1;
      for (let el = cap; el && !el.classList.contains('hero-concept'); el = el.parentElement) {
        chain *= Number(getComputedStyle(el).opacity);
      }
      const pad = parseFloat(getComputedStyle(cap).paddingTop) || 0;
      return {
        on: cap.classList.contains('is-on'),
        text: chars.map((c) => c.textContent).join(''),
        n: chars.length,
        vis: chars.filter((c) => Number(getComputedStyle(c).opacity) > 0.5).length,
        chainOpacity: chain,
        inkOpacity: ink ? Number(getComputedStyle(ink).opacity) : null,
        capCx: Math.round(r.left + r.width / 2),
        lineCx: Math.round(lr.left + lr.width / 2),
        // 字的墨迹顶边相对背景字那一行的下沿：正数 = 在它下面
        inkGap: Math.round(r.top + pad - (lr.top + lr.height)),
        inkBox: { x: r.left, y: r.top + pad, w: r.width, h: Math.max(1, r.height - pad) },
        capCy: Math.round(r.top + pad + (r.height - pad) / 2),
        viewportCx: Math.round(window.innerWidth / 2),
        viewportCy: Math.round(window.innerHeight / 2),
      };
    })()`;

    async function goto(target, traceIntro = false) {
      await send('Page.navigate', { url: target });
      if (traceIntro) {
        // 帧耗时探针在跳转后就装上，覆盖整段（遮罩、聚拢、展开）。
        await sleep(300);
        await evaluate(`(() => {
          window.__introFrames = [];
          let last = performance.now();
          const rec = (t) => {
            window.__introFrames.push(t - last);
            last = t;
            if (window.__introFrames.length < 900) requestAnimationFrame(rec);
          };
          requestAnimationFrame(rec);
        })()`);
      }

      // 首屏现在**等用户点 Enter**，不会自动进入。这里先确认按钮出来了再点。
      await sleep(1600);
      const ok = await evaluate(`!!document.querySelector('.hero-concept')`);
      if (!ok) {
        const where = await evaluate(`document.title + ' @ ' + location.href`);
        throw new Error(`页面没渲染出 .hero-concept（${where}）——服务在跑吗？先 npm run build 再 npx vite preview --port 4174`);
      }
      const hasEnter = await evaluate(`!!document.querySelector('.brand__enter')`);
      if (traceIntro) {
        check(hasEnter, '首屏停住等用户点 Enter（不是自动进入）');
      }

      // 点之前小字必须一个都没打出来
      const capIdle = await evaluate(CAPTION_PROBE);
      if (traceIntro) {
        check(capIdle && !capIdle.on && capIdle.vis === 0, '点 Enter 之前小字一个字都没出来',
          capIdle ? `on=${capIdle.on} 已显 ${capIdle.vis} 字` : '找不到 .hero-caption');
      }
      await evaluate(`document.querySelector('.brand__enter')?.click()`, { userGesture: true });
      // 聚拢 1.3s + 停留 0.35s，然后遮罩才开始揭开、Hero 的开场才启动
      await sleep(1750);

      // 点 ENTER 同时就是音乐播放器的"首次交互"（document 上的 click 监听收到它冒泡
      // 上来的事件）—— 所以那一刻应当**已经**在放第一首，且是出声的。
      const music = JSON.parse(await evaluate(`JSON.stringify({
        src: decodeURIComponent(document.getElementById('audioPlayer').src),
        muted: document.getElementById('audioPlayer').muted,
        volume: document.getElementById('audioPlayer').volume,
        paused: document.getElementById('audioPlayer').paused,
        playIcon: document.querySelector('.play-icon').style.display,
        title: document.getElementById('playerTitle').textContent.trim()
      })`));
      check(music.title === 'Almost Nothing' && /music\/Almost Nothing - Silent PoetsOkay Kaya\.mp3$/.test(music.src),
        '点 ENTER 后正在放的是第一首 Almost Nothing', music.src.split('/').pop());
      check(music.muted === false && Math.abs(music.volume - 0.3) < 0.001,
        '起播就出声（未静音，音量 0.3）', `muted=${music.muted} volume=${music.volume}`);
      check(music.paused === false, '音频真的在放（点 ENTER 即起播）',
        music.paused ? '没在放：dist/music 里的 mp3 拿不到？' : '');
      // 这条是旧版就有的毛病：自动起播只调 play() 不置 isPlaying —— 进度条在走、
      // 按钮还显示"播放"，用户要点两下才停得下来。
      check(music.playIcon === 'none', '播放键已切到暂停态（isPlaying 与真实播放同步）',
        `play-icon display=${music.playIcon}`);

      await evaluate(DUST_STATS);

      const mid = await evaluate(INTRO_PROBE);
      if (traceIntro) {
        check(mid && mid.headDist < 300, '遮罩揭开后 Hero 的开场正在放（四条还没完全延伸出去）',
          mid ? `末端距中心 ${Math.round(mid.headDist)}px` : 'null');
      }

      // 背景那 8 张封面是延后取的（开场走完才发）。此刻开场才走到一半，
      // 一个都不该出现在请求里 —— 这是"首页多了 8 张图、首屏请求没多"的唯一凭据。
      const blogCoverReqs = [...requestUrls.values()].filter((u) => u.includes('img.liveinpassion.me/blog/'));
      if (traceIntro) {
        check(blogCoverReqs.length === 0,
          '开场没走完之前，背景那 8 张封面一个都没请求（延后取）',
          blogCoverReqs.length ? blogCoverReqs.slice(0, 3).join(', ') : '0 个请求');
      }

      // 开场（2.4s）这会儿才走到一半：小字必须还一个字都没打
      const capEarly = await evaluate(CAPTION_PROBE);
      if (traceIntro) {
        check(capEarly && !capEarly.on && capEarly.vis === 0,
          '首屏动画没走完之前小字不抢着打',
          capEarly ? `on=${capEarly.on}，已显 ${capEarly.vis} 字` : 'null');
      }

      // 等展开走完（开场 2.4s）。比"轮询到不动为止"稳：公转一开动，
      // 距离会随环的椭圆投影来回振荡，永远等不到"不动"。
      await sleep(1600);
      const done = await evaluate(INTRO_PROBE);
      if (traceIntro) {
        check(mid && done && done.headDist > mid.headDist * 1.25, '四条确实是从中心延伸出去的',
          `末端到中心 ${Math.round(mid?.headDist)}px → ${Math.round(done?.headDist)}px`);

        const fr = await evaluate(`(() => {
          const f = (window.__introFrames || []).slice().sort((a, b) => a - b);
          if (f.length < 30) return null;
          return { n: f.length, median: f[Math.floor(f.length * 0.5)], p95: f[Math.floor(f.length * 0.95)] };
        })()`);
        // 只作参考：无头软件渲染下帧间隔由合成器决定
        check(fr !== null, '开场期间采到了帧数据（参考值）',
          fr ? `中位 ${fr.median.toFixed(1)}ms / p95 ${fr.p95.toFixed(1)}ms（${fr.n} 帧）` : '采样不足');
      }
    }

    await goto(url, true);

    // ── 结构 ────────────────────────────────────────────────────────────
    const structure = await evaluate(`(() => {
      const personas = [...document.querySelectorAll('.persona')];
      const subject = document.querySelector('.hero-subject');
      return {
        personas: personas.length,
        subject: !!subject,
        subjectHref: subject?.getAttribute('href'),
        labels: personas.map((p) => p.querySelector('.persona__label')?.textContent.trim()),
        names: personas.map((p) => getComputedStyle(p).getPropertyValue('view-transition-name').trim()),
        vtClasses: personas.map((p) => getComputedStyle(p).getPropertyValue('view-transition-class').trim()),
        // 四团的粒子现在全在共享画布上，格子本身不该再有 canvas
        personaCanvases: personas.map((p) => p.querySelectorAll('canvas').length),
        dust: (() => {
          const c = document.querySelector('canvas.hero-dust');
          if (!c) return null;
          const s = document.querySelector('.hero-concept').getBoundingClientRect();
          const r = c.getBoundingClientRect();
          return {
            w: c.width, h: c.height,
            coversStage: Math.abs(r.width - s.width) < 2 && Math.abs(r.height - s.height) < 2,
          };
        })(),
        grain: (() => {
          const c = document.querySelector('canvas.hero-subject__grain');
          return c ? { w: c.width, h: c.height } : null;
        })(),
        // 静止态：真实照片应是隐藏的，看到的是星尘
        photoOpacity: personas.map((p) => getComputedStyle(p.querySelector('.persona__photo')).opacity),
        // 背景拼贴：其他博客的封面。它不进粒子系统、不承载交互，
        // 只是 Hero 背后一层底纹（见 HeroConcept 的 revealBlogWall）。
        wall: (() => {
          const w = document.querySelector('.hero-wall');
          if (!w) return null;
          const imgs = [...w.querySelectorAll('img')];
          const cs = getComputedStyle(w);
          const subj = document.querySelector('.hero-subject');
          // 网格对齐：用 offset* 量，getBoundingClientRect 会被透镜矩阵污染
          const boxes = imgs.map((i) => ({
            l: i.offsetLeft, t: i.offsetTop, w: i.offsetWidth, h: i.offsetHeight,
          }));
          const lefts = [...new Set(boxes.map((b) => b.l))].sort((a, b) => a - b);
          const steps = [];
          for (let i = 1; i < lefts.length; i++) steps.push(lefts[i] - lefts[i - 1]);
          return {
            count: imgs.length,
            srcs: imgs.filter((i) => i.getAttribute('src')).length,
            // autoAlpha 还没跑之前是 visibility:hidden + opacity:0
            opacities: imgs.map((i) => Number(getComputedStyle(i).opacity)),
            visibilities: imgs.map((i) => getComputedStyle(i).visibility),
            containerOpacity: Number(cs.opacity),
            pointerEvents: cs.pointerEvents,
            // 底纹必须在主体**下面**：同为 z-index:0 时靠 DOM 顺序决定
            beforeSubject: !!(w.compareDocumentPosition(subj) & Node.DOCUMENT_POSITION_FOLLOWING),
            hasBlur: getComputedStyle(imgs[0] || w).filter.includes('blur'),
            display: cs.display,
            gap: cs.columnGap,
            sizes: [...new Set(boxes.map((b) => b.w + 'x' + b.h))],
            colSteps: [...new Set(steps)],
          };
        })(),
        cursorExists: !!document.querySelector('.block-cursor'),
        oldHero: !!document.querySelector('.hero-flip-card'),
        oldGallery: !!document.querySelector('.gallery-masonry, .home-gallery, #home-gallery'),
      };
    })()`);

    check(structure.personas === 4, '四个人格都在', `count=${structure.personas}`);
    check(structure.subject, '主体 Individuation 在位');
    // 主体现在是个 <div>，不是链接：点它是在"人格那一圈 / 博客那一圈"之间
    // 切换聚焦（见 onSubjectClick），不再跳 /me。
    check(structure.subjectHref === null, '主体不是链接（点它只切换聚焦，不跳转）',
      String(structure.subjectHref));
    check(
      structure.labels.join('|') === 'Romantics|Idealist|Advocate|Observer',
      '标签只留名称、不带编号',
      structure.labels.join(' | ')
    );
    check(new Set(structure.names).size === 4 && structure.names.every((n) => n.startsWith('blog-cover-')),
      '四个 view-transition-name 互不相同且带 blog-cover- 前缀', structure.names.join(', '));
    check(structure.vtClasses.every((c) => c === 'blog-cover'), 'view-transition-class 全部就位');
    check(structure.personaCanvases.every((n) => n === 0), '格子里不再有各自的 canvas（粒子已收归共享画布）',
      structure.personaCanvases.join(', '));
    check(structure.dust && structure.dust.w > 0 && structure.dust.h > 0, '共享尘带画布已定尺',
      structure.dust ? `${structure.dust.w}x${structure.dust.h}` : 'MISSING');
    check(structure.dust?.coversStage, '共享画布铺满整个 hero');
    check(structure.grain && structure.grain.w > 0, '主体粒子层画布已定尺',
      structure.grain ? `${structure.grain.w}x${structure.grain.h}` : 'MISSING');
    check(structure.photoOpacity.every((o) => Number(o) === 0), '静止态真实照片隐藏（露出的是星尘）',
      structure.photoOpacity.join(', '));
    check(structure.cursorExists, '方块光标在（全站一份，见 tools/verify-block-cursor.mjs）');
    check(!structure.oldHero && !structure.oldGallery, '旧的 HeroCard 与随机画廊都不在首页');

    // ── 背景海报墙：规则网格（28 张封面循环铺 64 块）────────────────────
    const wall = structure.wall;
    check(wall && wall.count === 64, '背景海报墙铺了 64 块（28 张封面循环）',
      wall ? `count=${wall.count}` : 'MISSING');
    if (wall) {
      check(wall.display === 'grid' && wall.sizes.length === 1
        && wall.colSteps.length === 1
        && wall.colSteps[0] === parseFloat(wall.sizes[0]) + parseFloat(wall.gap),
        '海报是等宽等高的规则网格（对齐，不再是散点/随机旋转）',
        `display=${wall.display} size=${wall.sizes.join(',')} step=${wall.colSteps.join(',')} gap=${wall.gap}`);
      // 结构这一刻开场可能刚走完、图还没挂上；所以这里只断言"看不见"，
      // 真正挂上去在后面几秒再验（见下面 wallAfter）。
      check(wall.visibilities.every((v) => v === 'hidden') || wall.opacities.some((o) => o > 0),
        '拼贴要么还没出现、要么已经在淡入（不会是一次性硬闪出来）',
        wall.opacities.join(', '));
      check(wall.pointerEvents === 'none', '拼贴不吃鼠标事件（底纹不该挡住主体和人格）',
        wall.pointerEvents);
      check(wall.beforeSubject, '拼贴在主体之前（画在它下面）');
      check(!wall.hasBlur, '拼贴是清晰的（只去色，没有模糊）', wall.filter);
      check(wall.containerOpacity > 0 && wall.containerOpacity < 0.5,
        '整层浓度压得很低（是背景）', String(wall.containerOpacity));
      check(await evaluate(`!!document.querySelector('.wall-toggle')`),
        '右下角有开/关背景拼贴的按钮');
      const wallOn = await evaluate(`Number(getComputedStyle(document.querySelector('.hero-wall')).opacity)`);
      await evaluate(`document.querySelector('.wall-toggle').click()`);
      await sleep(600);
      const wallOff = await evaluate(`Number(getComputedStyle(document.querySelector('.hero-wall')).opacity)`);
      await evaluate(`document.querySelector('.wall-toggle').click()`);
      await sleep(600);
      const wallBack = await evaluate(`Number(getComputedStyle(document.querySelector('.hero-wall')).opacity)`);
      check(wallOff === 0 && wallBack === wallOn,
        '那个按钮真的能关掉/打开背景拼贴', `${wallOn} → ${wallOff} → ${wallBack}`);

      // X 键收起所有图标/按钮，Z 键切主题（X 把主题按钮藏起来之后，Z 是唯一的切法）
      const chrome = `(() => {
        const g = (q) => { const e = document.querySelector(q); return e ? Number(getComputedStyle(e).opacity) : -1; };
        return {
          html: document.documentElement.className,
          dark: document.documentElement.classList.contains('dark'),
          head: g('#header'), theme: g('.theme-toggle'),
          author: g('.author-section'), music: g('.music-toggle-btn'), wallBtn: g('.wall-toggle'),
        };
      })()`;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'x', windowsVirtualKeyCode: 88 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'x' });
      // 收起是带过渡的（0.6s，个别控件还有 0.35s 延迟）—— 采早了拿到的还是中间值
      await sleep(1400);
      const hidden = await evaluate(chrome);
      check(hidden.html.includes('is-chrome-hidden'), 'X 键把"收起悬浮件"的状态打开',
        hidden.html);
      check([hidden.head, hidden.theme, hidden.author, hidden.music, hidden.wallBtn].every((v) => v === 0),
        '收起后头部、左下角头像、主题按钮、播放器、背景开关全部不可见',
        `head=${hidden.head} author=${hidden.author} theme=${hidden.theme} music=${hidden.music} wall=${hidden.wallBtn}`);
      const themeBefore = hidden.dark;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', windowsVirtualKeyCode: 90 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z' });
      await sleep(1200);
      const afterZ = await evaluate(chrome);
      check(afterZ.dark !== themeBefore, 'Z 键切换主题（悬浮件收起时唯一的切法）',
        `${themeBefore ? 'dark' : 'light'} → ${afterZ.dark ? 'dark' : 'light'}`);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', windowsVirtualKeyCode: 90 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z' });
      await sleep(1200);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'x', windowsVirtualKeyCode: 88 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'x' });
      await sleep(1400);
      const restored = await evaluate(chrome);
      check(!restored.html.includes('is-chrome-hidden') && restored.head === 1,
        '再按 X 恢复（头部回到可见）', `head=${restored.head}`);
    }

    // ── 三维场景：透视、前后远近 ────────────────────────────────────────
    // 人格的粒子现在画在 WebGL 里，读不到像素了（同一个 canvas 已经拿了 WebGL
    // 上下文，再要 2d 会返回 null）。改成验三件真正可测的事。
    //
    // 注意：DOM 元素的落点就是投影算出来的，所以量 DOM 的位置和缩放，
    // 等价于在量三维场景 —— 两者用的是同一个公式（见 usePersonaScene.js）。
    const SCENE_PROBE = `(() => {
      const s = document.querySelector('.hero-concept__stage').getBoundingClientRect();
      const cx = s.left + s.width / 2;
      const cy = s.top + s.height / 2;
      return [...document.querySelectorAll('.persona')].map((p) => {
        const r = p.getBoundingClientRect();
        const m = new DOMMatrixReadOnly(getComputedStyle(p).transform);
        return {
          scale: m.a,
          x: r.left + r.width / 2 - cx,
          y: r.top + r.height / 2 - cy,
          w: Math.round(r.width),
        };
      });
    })()`;

    const sceneA = await evaluate(SCENE_PROBE);
    const drawA = await evaluate("window.__glDrawsFor('canvas.hero-dust')");
    await sleep(700);
    const drawB = await evaluate("window.__glDrawsFor('canvas.hero-dust')");
    check(drawB - drawA > 20, '三维场景每帧都在渲染', `700ms 内 ${drawB - drawA} 次绘制调用`);

    // 透视：四格的缩放必须互不相同。都一样就说明是正交投影、根本没有前后可言。
    const scales = sceneA.map((p) => p.scale);
    const scaleRatio = Math.max(...scales) / Math.min(...scales);
    check(scaleRatio > 1.12, '四格缩放互不相同（透视带来了前后远近）',
      `${scales.map((v) => v.toFixed(3)).join(' / ')}，最大最小比 ${scaleRatio.toFixed(3)}`);

    // 环在转 → 位置和缩放都该持续变化（远近在轮换）
    await sleep(2600);
    const sceneB = await evaluate(SCENE_PROBE);
    const orbited = sceneB.map((p, i) => Math.hypot(p.x - sceneA[i].x, p.y - sceneA[i].y));
    check(Math.min(...orbited) > 30, '四格都在环上公转（2.6s 后位置都变了）',
      orbited.map((v) => Math.round(v)).join(' / '));
    check(sceneB.some((p, i) => Math.abs(p.scale - sceneA[i].scale) > 0.02),
      '缩放随转动变化（远近在轮换，不是各转各的）',
      sceneA.map((p, i) => `${p.scale.toFixed(2)}→${sceneB[i].scale.toFixed(2)}`).join(' '));

    // 拼贴：等开场走完之后，8 张应该都挂上了 src、并且被 GSAP 淡到了显示态
    let wallState = await evaluate(`(() => {
      const w = document.querySelector('.hero-wall');
      if (!w) return null;
      const imgs = [...w.querySelectorAll('img')];
      return {
        count: imgs.length,
        withSrc: imgs.filter((i) => i.getAttribute('src')).length,
        shown: imgs.filter((i) => getComputedStyle(i).visibility !== 'hidden'
          && Number(getComputedStyle(i).opacity) > 0.9).length,
      };
    })()`);
    for (let i = 0; i < 40 && wallState && wallState.shown !== wallState.count; i++) {
      await sleep(500);
      wallState = await evaluate(`(() => {
        const imgs = [...document.querySelectorAll('.hero-wall img')];
        return {
          count: imgs.length,
          withSrc: imgs.filter((i) => i.getAttribute('src')).length,
          shown: imgs.filter((i) => getComputedStyle(i).visibility !== 'hidden'
            && Number(getComputedStyle(i).opacity) > 0.9).length,
        };
      })()`);
    }
    check(wallState && wallState.withSrc === wallState.count,
      '拼贴的 64 张封面最后都取回来了', wallState ? `${wallState.withSrc}/${wallState.count}` : 'MISSING');
    check(wallState && wallState.shown === wallState.count,
      '拼贴一张张淡进来了（GSAP 把每一张都拉到了显示态）',
      wallState ? `${wallState.shown}/${wallState.count}` : 'MISSING');

    // ── 指针透镜：指针附近的格子被弯，屏幕外的格子保持原样 ─────────────
    const heroBox = await evaluate(`(() => {
      const r = document.querySelector('.hero-concept').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(heroBox.x),
      y: Math.round(heroBox.y),
      button: 'none',
    });
    await sleep(900);
    const lens = JSON.parse(await evaluate(`(() => {
      const px = ${JSON.stringify(Math.round(heroBox.x))};
      const py = ${JSON.stringify(Math.round(heroBox.y))};
      const imgs = [...document.querySelectorAll('.hero-wall__img')].map((el) => {
        const r = el.getBoundingClientRect();
        return { el, d: Math.hypot(r.left + r.width / 2 - px, r.top + r.height / 2 - py) };
      }).sort((a, b) => a.d - b.d);
      const scaleOf = (el) => {
        const m = (el.style.transform || '').match(/matrix\\(([^)]+)\\)/);
        return m ? Number(m[1].split(',')[0]) : 1;
      };
      return JSON.stringify({
        nearDist: Math.round(imgs[0].d),
        nearScale: scaleOf(imgs[0].el),
        farScale: scaleOf(imgs[imgs.length - 1].el),
      });
    })()`));
    check(lens.nearScale > 1.03, '指针附近的海报被顶起来（原来的透镜形变生效）',
      `dist=${lens.nearDist} scale=${lens.nearScale}`);
    check(Math.abs(lens.farScale - 1) < 0.05, '屏幕外的格子没有被放大到离谱',
      `farScale=${lens.farScale}`);

    // 指针移开，让主体退出悬停/涟漪，后面量椭圆时会干净
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 20, button: 'none' });
    await sleep(900);

    await send('Page.captureScreenshot', {})
      .then((r) => fs.writeFileSync(path.join(outDir, 'hero-01-dispersed.png'), Buffer.from(r.data, 'base64')));

    // ── 背景字下面那行 INDIVIDUATION ────────────────────────────────────
    // 到这里开场已经走完 3 秒以上，逐字那 1.7s 也该跑完了。
    const cap = await evaluate(CAPTION_PROBE);
    check(cap !== null, '背景字下面那行小字在位', cap ? '' : '找不到 .hero-caption');
    if (cap) {
      check(cap.text === 'INDIVIDUATION' && cap.n === 13, '打的是 INDIVIDUATION，13 个字',
        `${cap.n} 字：${cap.text}`);
      check(cap.text === cap.text.toUpperCase(), '全大写', cap.text);
      check(cap.on && cap.vis === cap.n, '首屏动画走完之后 13 个字都打出来了',
        `on=${cap.on}，可见 ${cap.vis}/${cap.n}`);
      // 逐字的证据：这一行**不是**一口气全出来的（见下面"打字过程"那一段）
      check(Math.abs(cap.capCx - cap.lineCx) <= 1 && Math.abs(cap.capCx - cap.viewportCx) <= 1,
        '小字和背景字同一条中轴（屏幕正中）',
        `小字 ${cap.capCx} / 背景字 ${cap.lineCx} / 视口中线 ${cap.viewportCx}`);
      check(cap.inkGap > 0 && cap.inkGap < 120, '落在 LIVEINPASSION 正下方',
        `墨迹顶边在背景字下沿之下 ${cap.inkGap}px`);
      check(cap.capCy > cap.viewportCy, '落在屏幕中线之下（在字下面，不是压着字）',
        `小字中线 ${cap.capCy} vs 屏幕中线 ${cap.viewportCy}`);
      // 背景字自己只有 7.5% 浓度，但小字不能被它连坐 —— 祖先链上的 opacity 乘积必须是 1
      check(cap.chainOpacity > 0.9 && cap.inkOpacity !== null && cap.inkOpacity < 0.2,
        '小字没有被背景字那层的不透明度连坐',
        `祖先链乘积 ${cap.chainOpacity.toFixed(3)}，背景字自身 ${cap.inkOpacity}`);

      // 逐字（不是一口气全出来）—— 靠**重播**测：把 is-on 摘掉再加回去，按时间采样。
      // 干等真实那一次太靠运气：开场跑完的时刻随机器快慢飘，很容易整段错过。
      const typed = await evaluate(`(async () => {
        const cap = document.querySelector('.hero-caption');
        cap.classList.remove('is-on');
        void cap.offsetWidth; // 强制回流，动画才会从头开始
        cap.classList.add('is-on');
        const count = () => [...cap.querySelectorAll('.hero-caption__ch')]
          .filter((c) => Number(getComputedStyle(c).opacity) > 0.5).length;
        const at = (ms) => new Promise((r) => setTimeout(() => r(count()), ms));
        const out = { t0: count() };
        out.t600 = await at(600);
        out.t1200 = await at(600);  // 累计 1200ms
        out.t2600 = await at(1400); // 累计 2600ms
        return out;
      })()`);
      check(typed.t0 === 0 && typed.t1200 > typed.t600 && typed.t1200 < 13 && typed.t2600 === 13,
        '是逐字打出来的（不是一口气全出来）',
        `0ms ${typed.t0} 字 → 600ms ${typed.t600} → 1200ms ${typed.t1200} → 2600ms ${typed.t2600}`);

      // 真的画在屏幕上 —— 把那几层粒子/星尘藏掉再截，和"藏掉小字"那张比。
      // 差分出来的就是小字的墨迹：只有几个像素就说明它被主体那块不透明椭圆吃掉了
      // （或者被上面那条 opacity 连坐掉了），两种情况都过不了这一条。
      await evaluate(`
        window.__capHidden = [];
        for (const s of ['canvas.hero-dust', '.hero-concept__noise', '.orbit', '.hero-subject']) {
          const el = document.querySelector(s);
          if (el) { window.__capHidden.push([el, el.style.visibility]); el.style.visibility = 'hidden'; }
        }
      `);
      await sleep(160);
      const capClip = {
        x: Math.round(cap.inkBox.x - 6), y: Math.round(cap.inkBox.y - 6),
        width: Math.round(cap.inkBox.w + 12), height: Math.round(cap.inkBox.h + 12), scale: 1,
      };
      const withCap = await send('Page.captureScreenshot', { clip: capClip });
      await evaluate(`document.querySelector('.hero-caption').style.visibility = 'hidden'`);
      await sleep(160);
      const withoutCap = await send('Page.captureScreenshot', { clip: capClip });
      await evaluate(`document.querySelector('.hero-caption').style.visibility = ''`);
      const ink = await evaluate(
        `window.__regionDiff(${JSON.stringify(withCap.data)}, ${JSON.stringify(withoutCap.data)},
          0, 0, ${capClip.width}, ${capClip.height})`
      );
      check(ink.n / ink.area > 0.04, '小字是真画在屏幕上的（不是被主体那层盖掉）',
        `这一条里墨迹占 ${(ink.n / ink.area * 100).toFixed(1)}%（被盖掉的话是 0）`);
      fs.writeFileSync(
        path.join(outDir, 'hero-01b-caption.png'),
        Buffer.from(withCap.data, 'base64')
      );
      await evaluate(`for (const [el, v] of window.__capHidden) el.style.visibility = v`);
      await sleep(160);
    }

    // ── 悬停第一团：应该重组 ────────────────────────────────────────────
    const box = await evaluate(`(() => {
      const r = document.querySelector('.persona').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);

    // 帧耗时探针：重组期间 2000 个粒子逐帧重画，得知道跑不跑得动。
    // 注意无头 --disable-gpu 是软件渲染，真机会更好，所以阈值放得很松，
    // 只用来兜住"灾难性回退"。
    await evaluate(`(() => {
      window.__frames = [];
      window.__cms.ms = 0; window.__cms.fills = 0;
      let last = performance.now();
      const rec = (t) => {
        window.__frames.push(t - last);
        last = t;
        if (window.__frames.length < 120) requestAnimationFrame(rec);
      };
      requestAnimationFrame(rec);
    })()`);

    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, buttons: 0 });
    await sleep(1000); // 等 620ms 的重组走完

    const perf = await evaluate(`(() => {
      const f = (window.__frames || []).slice().sort((a, b) => a - b);
      if (f.length < 20) return null;
      return { n: f.length, median: f[Math.floor(f.length * 0.5)], p95: f[Math.floor(f.length * 0.95)] };
    })()`);
    // 帧间隔只作参考不作为判据：无头软件渲染下它被合成器主导，
    // 反映不出我们这边画布优化有没有生效（实测优化前后都是 33.3ms）。
    check(perf !== null, '重组期间采到了帧数据（参考值）',
      perf ? `中位 ${perf.median.toFixed(1)}ms / p95 ${perf.p95.toFixed(1)}ms（${perf.n} 帧）` : '采样不足');

    // 真正能控制的是画布调用耗时。一帧要画 5200（尘带）+ 6000（主体粒子）个粒子，
    // 逐粒子 fillRect 时这一项约 9ms，已经把 16.7ms 的预算顶掉一大半；
    // 合成 Path2D 之后约 2.5ms（单独基准测过 5200 个：4.49ms → 0.88ms）。
    const canvasCost = await evaluate(`(() => {
      const c = window.__cms;
      return c.fills ? { perDraw: c.ms / c.fills, fills: c.fills } : null;
    })()`);
    check(canvasCost && canvasCost.perDraw < 5, '每帧的画布绘制耗时在预算内',
      canvasCost ? `${canvasCost.perDraw.toFixed(2)}ms / 次绘制（${canvasCost.fills} 次）` : '没采到');

    const assembled = await evaluate(`(() => {
      const p = document.querySelector('.persona');
      return {
        photoOpacity: getComputedStyle(p.querySelector('.persona__photo')).opacity,
        otherPhotoOpacity: getComputedStyle(
          document.querySelectorAll('.persona')[1].querySelector('.persona__photo')
        ).opacity,
      };
    })()`);

    check(Number(assembled.photoOpacity) === 1, '重组到位后真实照片淡入', assembled.photoOpacity);
    check(Number(assembled.otherPhotoOpacity) === 0, '没被悬停的那几格保持散开态', assembled.otherPhotoOpacity);
    await send('Page.captureScreenshot', {})
      .then((r) => fs.writeFileSync(path.join(outDir, 'hero-02-assembled.png'), Buffer.from(r.data, 'base64')));

    const tileBox = await evaluate(`(() => {
      const r = document.querySelector('.persona').getBoundingClientRect();
      return { x: Math.max(0, r.left - 60), y: Math.max(0, r.top - 60), width: r.width + 120, height: r.height + 120, scale: 2 };
    })()`);
    const shoot = async (name, clip) => {
      const r = await send('Page.captureScreenshot', clip ? { clip } : {});
      fs.writeFileSync(path.join(outDir, name), Buffer.from(r.data, 'base64'));
    };
    await shoot('hero-02b-tile-assembled.png', tileBox);

    // 移开 → 那一条应该散回去（粒子在 WebGL 里读不到像素，看照片是否重新隐藏即可）
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 720, y: 1180, buttons: 0 });
    await sleep(1000);
    const reverted = await evaluate(`(() => {
      const p = document.querySelector('.persona');
      return { photoOpacity: getComputedStyle(p.querySelector('.persona__photo')).opacity };
    })()`);
    check(Number(reverted.photoOpacity) === 0, '移开后真实照片重新隐藏', reverted.photoOpacity);

    // ── 光标 ────────────────────────────────────────────────────────────
    // 现量体位：环一直在转，用早先那个 box 会悬空
    const cursorBox = await evaluate(`(() => {
      const r = document.querySelector('.persona').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cursorBox.x, y: cursorBox.y, buttons: 0 });
    await sleep(450);
    const cursor = await evaluate(`(() => {
      const c = document.querySelector('.block-cursor');
      if (!c) return null; // 没装这一层就别把后面几条一起带崩（本工具还要验别的）
      return {
        opacity: getComputedStyle(c).opacity,
        transform: getComputedStyle(c).transform,
        dot: getComputedStyle(c.querySelector('.block-cursor__dot')).transform,
        // 系统光标现在由 html.is-block-cursor 全站压掉，而那个类**只在第一次
        // pointermove 之后**才挂（先挂的话，从加载到第一次挪鼠标之间会一个光标都没有）。
        // 上面刚推过指针，所以这时候量才对得上。
        heroCursor: getComputedStyle(document.querySelector('.hero-concept')).cursor,
      };
    })()`);
    check(cursor !== null, '方块光标存在（components/BlockCursor.vue）');
    if (cursor) {
      check(cursor.opacity === '1', '方块光标已显示', cursor.opacity);
      check(/matrix/.test(cursor.transform), '方块光标跟随鼠标', cursor.transform);
      check(/1\.5/.test(cursor.dot), '压在星尘上时方块放大 1.5 倍', cursor.dot);
      check(cursor.heroCursor === 'none', '自定义光标生效（系统光标已隐藏）', cursor.heroCursor);
    }

    // ── 主体水波纹（WebGL）────────────────────────────────────────────────
    const rippleReady = await evaluate(`(() => {
      const c = document.querySelector('.hero-subject__ripple');
      if (!c) return null;
      return {
        ready: c.classList.contains('is-ready'),
        w: c.width,
        h: c.height,
        // canvas 应正好盖住主体图
        covers: Math.abs(c.getBoundingClientRect().width - c.parentElement.getBoundingClientRect().width) < 1,
        hasGL: !!(c.getContext('webgl2') || c.getContext('webgl')),
      };
    })()`);
    check(rippleReady && rippleReady.ready, '水波纹画布已就绪（贴图加载完成）',
      rippleReady ? `ready=${rippleReady.ready}` : 'canvas 不存在');
    check(rippleReady && rippleReady.hasGL, '拿到了 WebGL 上下文');
    check(rippleReady && rippleReady.covers && rippleReady.w > 0, '画布尺寸贴合主体',
      rippleReady ? `${rippleReady.w}x${rippleReady.h}` : '-');

    // 静止时不该占帧：涟漪幅度为 0，画面等同静态图
    const drawsIdle = await evaluate(`(() => {
      const a = window.__glDrawsFor('canvas.hero-subject__ripple');
      return new Promise((res) => setTimeout(() => res(window.__glDrawsFor('canvas.hero-subject__ripple') - a), 700));
    })()`);
    check(drawsIdle <= 2, '静止时不渲染（rAF 已停）', `700ms 内 ${drawsIdle} 次绘制调用`);

    const subjBox = await evaluate(`(() => {
      const r = document.querySelector('.hero-subject').getBoundingClientRect();
      return { x: r.left + r.width * 0.4, y: r.top + r.height * 0.45 };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: subjBox.x, y: subjBox.y, buttons: 0 });
    const drawsHover = await evaluate(`(() => {
      const a = window.__glDrawsFor('canvas.hero-subject__ripple');
      return new Promise((res) => setTimeout(() => res(window.__glDrawsFor('canvas.hero-subject__ripple') - a), 700));
    })()`);
    check(drawsHover > 10, '悬停时涟漪在持续渲染', `700ms 内 ${drawsHover} 次绘制调用`);

    // ── 主体粒子层：鼠标处重组 ───────────────────────────────────────────
    // 粒子散着的时候不透明度低、飘；鼠标压住的那块锁到准确位置并变实。
    // 所以鼠标附近那一小块的平均不透明度应该明显高于远处。
    const grainRest = await evaluate(
      `window.__dustStats(document.querySelector('canvas.hero-subject__grain'))`
    );
    check(grainRest.count > 300, '主体叠了一层粒子（轻微粒子化）', `${grainRest.count} 个绘制像素`);

    // 主体与背景融合：从边往里的粒子密度要**逐带变密**，各条边都是渐隐的。
    // 早先用径向距离除以对角线长，矩形长边中点几乎不衰减，那里会留一条硬边 ——
    // 那种情况下最外一带的密度会和相邻带差不多，不会明显偏低。
    const bands = await evaluate(
      `window.__edgeBands(document.querySelector('canvas.hero-subject__grain'))`
    );
    const pct = bands.map((v) => `${(v * 100).toFixed(1)}%`).join(' → ');
    check(bands[0] < bands[1] * 0.6, '最外一带明显比里一带稀（边缘是渐隐的，不是硬切）', `分带密度 ${pct}`);
    check(bands[1] < bands[3] && bands[2] < bands[3], '密度整体往里递增（四条边都是融合进背景的）',
      `${pct}`);

    // "重组"现在主要不是靠变实，是靠**变静** —— 旗帜波纹在鼠标处被压掉，
    // 所以那块几乎不动，周围还在飘。隔 380ms 抓两帧，比鼠标附近和角落的变化量。
    // 受控比较：**同一个区域**，分别在"鼠标压在它上面"和"鼠标移到主体另一侧"
    // 两种情况下各测一次变化率。区域相同 → 粒子密度相同，唯一的变量就是
    // 重组在不在那儿。这比拿两个不同区域比要干净得多。
    const REG = await evaluate(`(() => {
      const c = document.querySelector('canvas.hero-subject__grain');
      const r = document.querySelector('.hero-subject').getBoundingClientRect();
      const u = (${subjBox.x} - r.left) / r.width;
      const v = (${subjBox.y} - r.top) / r.height;
      // 采样区要**比重组半径小得多**：focusRadius 是 0.2×宽（约 138 画布像素），
      // 取 30px 的框，边缘的 focus 还能有 0.97；取 60px 就掉到 0.6，
      // 落在衰减段上，测出来的"静度"会被稀释。
      const s = 30 * (c.width / r.width);
      return { x: u * c.width - s / 2, y: v * c.height - s / 2, s };
    })()`);
    const jitterAt = (x, y) => evaluate(`window.__grainJitter(${x}, ${y}, ${REG.s}, ${REG.s}, 380)`);

    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: subjBox.x, y: subjBox.y, buttons: 0 });
    await sleep(900);
    const focused = await jitterAt(REG.x, REG.y);

    const away = await evaluate(`(() => {
      const r = document.querySelector('.hero-subject').getBoundingClientRect();
      return { x: r.left + r.width * 0.88, y: r.top + r.height * 0.12 };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: away.x, y: away.y, buttons: 0 });
    await sleep(900);
    const unfocused = await jitterAt(REG.x, REG.y);

    check(unfocused.pix > 40, '采样区里确实有粒子（否则比较没意义）', `${unfocused.pix} 个绘制像素`);
    check(focused.pix > 0 && focused.n < unfocused.n * 0.7,
      '鼠标压住时那块几乎不动（那里重组了，旗帜波纹被压掉）',
      `同区变化像素 ${focused.n}（鼠标在上） vs ${unfocused.n}（鼠标移开）`);

    // 粒子层也要一直在飘
    const gHash = [];
    for (let i = 0; i < 3; i++) {
      gHash.push(await evaluate(`window.__dustStats(document.querySelector('canvas.hero-subject__grain')).hash`));
      if (i < 2) await sleep(420);
    }
    check(new Set(gHash).size === 3, '主体粒子层也在持续飘动', gHash.join(' → '));

    await shoot('hero-02c-ripple.png', {
      x: Math.max(0, subjBox.x - 220), y: Math.max(0, subjBox.y - 220), width: 440, height: 440, scale: 2,
    });

    // 涟漪中心必须落在鼠标处。这是纯几何断言：截两张主体区的图（不悬停 / 悬停），
    // 差分求变化像素的重心，和鼠标在主体里的相对位置比。
    // 覆盖的是 three 的 UV 竖直方向翻转那类 bug —— 中了的话重心会跑到镜像位置。
    const subjRect = await evaluate(`(() => {
      const r = document.querySelector('.hero-subject').getBoundingClientRect();
      // scale 是 CDP 的必填项，漏了会报 "Failed to deserialize params.clip.scale"
      return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1 };
    })()`);
    // 画布必须和底图逐像素对得上：同一张图、同一个位置、同一个大小。
    // 这条专门卡顶点着色器把 NDC 算错（quad 只盖住中间一半）那类 bug ——
    // 深色主题下两层都是黑的完全看不出来，浅色底上才露馅。
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 20, buttons: 0 });
    await sleep(1300);
    // 画布必须和底图逐像素对得上（同一张图、同一位置、同一大小）。
    // 这条专门卡顶点着色器把 NDC 算错（quad 只盖住中间一半）那类 bug ——
    // 深色主题下两层都是黑的完全看不出来，浅色底上才露馅。
    //
    // 现在 uRestSolid = 0：静止时画布整片是背景色（主体完全由粒子承担），
    // 直接和底图比是没有意义的。改成**把鼠标压在主体中心**，让那一块重组显形，
    // 只比中心那一小块 —— 那里 solid = 1，画布就是照片本身，无需补偿亮度。
    // 主体在风里飘，早先量下来的中心已经不准了 —— 现读
    // 主体在风里飘，早先量下来的中心已经不准了 —— 现读。
    // 下面的裁剪框也必须用同一份坐标，否则采样点和裁剪框不是一个基准。
    const nowRect = await evaluate(`(() => {
      const r = document.querySelector('.hero-subject').getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    })()`);
    const cx0 = nowRect.x + nowRect.width / 2;
    const cy0 = nowRect.y + nowRect.height / 2;
    const clipNow = { x: nowRect.x, y: nowRect.y, width: nowRect.width, height: nowRect.height, scale: 1 };
    // 干涉项排掉：粒子层自己会飘，主体的"风"动画会让整体位移
    await evaluate(`
      document.querySelector('.hero-subject__grain').style.opacity = '0';
      document.querySelector('.hero-subject').style.animationPlayState = 'paused';
    `);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx0, y: cy0, buttons: 0 });
    await sleep(1200); // 等重组幅度涨满
    await evaluate(`document.querySelector('.hero-subject__ripple').style.opacity = '0'`);
    await sleep(400);
    const imgOnly = await send('Page.captureScreenshot', { clip: clipNow });
    await evaluate(`document.querySelector('.hero-subject__ripple').style.opacity = ''`);
    await sleep(400);
    const withCanvas = await send('Page.captureScreenshot', { clip: clipNow });
    await evaluate(`
      document.querySelector('.hero-subject__grain').style.opacity = '';
      document.querySelector('.hero-subject').style.animationPlayState = '';
    `);
    // 只比鼠标周围那一小块（重组半径内）
    const patch = await evaluate(
      `window.__regionDiff(${JSON.stringify(imgOnly.data)}, ${JSON.stringify(withCanvas.data)},
        ${nowRect.width / 2 - 10}, ${nowRect.height / 2 - 10}, 20, 20)`
    );
    // 阈值放得比较宽：画布的纹理重采样和底图的缩放算法本来就对不齐，正确对齐时
    // 稳定在 25~35%。而几何错位（比如顶点着色器 NDC 写错）会给出接近 100%，
    // 这两档区分得很清楚。
    check(patch.n / patch.area < 0.6, '重组区内画布与底图逐像素对齐（尺寸/位置一致）',
      `重组区差异 ${(patch.n / patch.area * 100).toFixed(1)}%（错位的话会接近 100%）`);

    // 光标方块的颜色混合也会计入差分，而且它就在鼠标位置上，会把重心拉向正确位置、
    // 掩盖竖直镜像的 bug。测这一条时先把它藏掉。
    await evaluate(`(() => { const c = document.querySelector('.block-cursor'); if (c) c.style.display = 'none'; return 1; })()`);

    // 涟漪跟着鼠标走 —— 用**受控 A/B** 验，不看重心的位移。
    //
    // 早先这里比的是"变化像素的重心"，但那其实是 uSolid 那个亮斑在动，
    // 不是涟漪：亮斑删掉之后，变化的像素由图像内容（脸那块对比度高）主导，
    // 重心永远落在图像中间，鼠标位置只剩二阶影响。
    //
    // 改成：取两个位置 A、B，各自测一次差分幅度（同一个位置、同一批像素）。
    //   A 点：鼠标在 A 时 vs 鼠标在 B 时
    //   B 点：鼠标在 A 时 vs 鼠标在 B 时
    // 内容带来的偏移两次里一样，差出来的就是涟漪。竖直镜像的话 B 点那组会反。
    const A = { u: 0.28, v: 0.24 };
    const B = { u: 0.74, v: 0.76 };
    const boxA = { x: subjRect.width * A.u - 30, y: subjRect.height * A.v - 30 };
    const boxB = { x: subjRect.width * B.u - 30, y: subjRect.height * B.v - 30 };

    const magAt = async (u, v) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 20, buttons: 0 });
      await sleep(1300); // 等涟漪退干净
      const base = await send('Page.captureScreenshot', { clip: subjRect });
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: subjRect.x + subjRect.width * u,
        y: subjRect.y + subjRect.height * v,
        buttons: 0,
      });
      await sleep(850); // 等幅度涨上来
      const over = await send('Page.captureScreenshot', { clip: subjRect });
      const a = `${JSON.stringify(base.data)}, ${JSON.stringify(over.data)}`;
      return {
        atA: await evaluate(`window.__regionMag(${a}, ${boxA.x}, ${boxA.y}, 60, 60)`),
        atB: await evaluate(`window.__regionMag(${a}, ${boxB.x}, ${boxB.y}, 60, 60)`),
      };
    };

    const atMouseA = await magAt(A.u, A.v);
    const atMouseB = await magAt(B.u, B.v);
    await evaluate(`(() => { const c = document.querySelector('.block-cursor'); if (c) c.style.display = ''; return 1; })()`);

    // 比的是**同一个位置**在两种鼠标位置下的扰动 —— 内容一样，差的只有涟漪距离。
    // （反过来的比法 —— 同一个鼠标位置下比两个位置 —— 会被内容对比度带偏：
    //   A 点在头发/背景上对比度低，即使位移更大，差分幅度也压不过 B 点。）
    check(atMouseA.atA > atMouseB.atA, '位置 A：鼠标压在它上面时扰动更大',
      `鼠标在 A ${atMouseA.atA.toFixed(1)} vs 鼠标在 B ${atMouseB.atA.toFixed(1)}`);
    check(atMouseB.atB > atMouseA.atB, '位置 B：鼠标压在它上面时扰动更大（未被竖直镜像）',
      `鼠标在 A ${atMouseA.atB.toFixed(1)} vs 鼠标在 B ${atMouseB.atB.toFixed(1)}`);

    // 移开主体：幅度应退回去，渲染重新停下来
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 20, buttons: 0 });
    await sleep(1600);
    const drawsAfter = await evaluate(`(() => {
      const a = window.__glDrawsFor('canvas.hero-subject__ripple');
      return new Promise((res) => setTimeout(() => res(window.__glDrawsFor('canvas.hero-subject__ripple') - a), 700));
    })()`);
    check(drawsAfter <= 2, '移开后涟漪退去、渲染停住', `700ms 内 ${drawsAfter} 次绘制调用`);

    // ── 黑白主题适配 ────────────────────────────────────────────────────
    const THEME_PROBE = `(() => {
      const hero = document.querySelector('.hero-concept');
      // 反转检查改看主体的粒子层：它是 2D 画布，读得到像素。
      // 人格的粒子在 WebGL 里，同一个 canvas 已经拿了 WebGL 上下文、要不到 2d。
      // 两边的反转是同一套逻辑（dark ? 0 : 1），验一处就够。
      const dust = window.__dustStats(document.querySelector('canvas.hero-subject__grain'));
      return {
        dark: document.documentElement.classList.contains('dark'),
        bg: getComputedStyle(hero).backgroundColor,
        labelColor: getComputedStyle(document.querySelector('.persona__label')).color,
        cursorBg: (() => { const d = document.querySelector('.block-cursor__dot'); return d ? getComputedStyle(d).backgroundColor : '(没有方块光标)'; })(),
        dustLuma: dust.meanLuma,
      };
    })()`;

    const themeMotion = await evaluate(`(() => {
      const hero = document.querySelector('.hero-concept');
      const dust = document.querySelector('canvas.hero-dust');
      return {
        bg: getComputedStyle(hero).transitionProperty,
        dust: getComputedStyle(dust).transitionProperty,
      };
    })()`);
    check(themeMotion.bg.includes('background-color'), '主题切换时背景色是过渡不是硬切', themeMotion.bg);
    check(themeMotion.dust.includes('opacity'), '粒子层有淡入淡出（换色时不会硬闪）', themeMotion.dust);

    const dark = await evaluate(THEME_PROBE);
    check(dark.dark, '初始是深色主题', String(dark.dark));
    check(dark.bg === 'rgb(0, 0, 0)', '深色主题下 hero 背景是纯黑', dark.bg);

    await evaluate(`document.querySelector('#themeToggle').click()`);
    // 换色有个 ~230ms 的淡出窗口，趁这个窗口看看过渡类有没有挂上
    await sleep(110);
    const shifting = await evaluate(
      `document.querySelector('.hero-concept').classList.contains('is-theme-shift')`
    );
    check(shifting, '切换过程中粒子层处于淡出态（先把颜色换掉再淡回来）');
    await sleep(600);
    const light = await evaluate(THEME_PROBE);
    check(!light.dark, '切换后是浅色主题', String(light.dark));
    check(light.bg === 'rgb(250, 250, 250)', '浅色主题下 hero 背景变白', light.bg);
    // 反色检查：浅色主题下的灰度应约等于 255 - 深色下的灰度。
    // 注意**不能**断言"变暗" —— 源图整体偏暗，反色后平均亮度反而是升高的。
    check(Math.abs(dark.dustLuma + light.dustLuma - 255) < 25, '浅色主题下粒子按 255−灰度 反色',
      `粒子平均亮度 ${dark.dustLuma.toFixed(0)} + ${light.dustLuma.toFixed(0)} = ${(dark.dustLuma + light.dustLuma).toFixed(0)}（应为 255）`);
    // 光标方块：亮色模式要纯黑、暗色模式纯白。用 difference 混合的话底色一变
    // 结果就不干脆（浅灰底上会给出近黑的灰），所以现在是直接给死颜色。
    check(light.cursorBg === 'rgb(0, 0, 0)', '亮色模式下光标方块是纯黑', light.cursorBg);
    check(dark.cursorBg === 'rgb(255, 255, 255)', '暗色模式下光标方块是纯白', dark.cursorBg);
    check(light.labelColor !== dark.labelColor, '标签颜色跟着主题变',
      `${dark.labelColor} → ${light.labelColor}`);

    await shoot('hero-02d-light.png');

    // 回归：浅色主题下主体曾经是一整块黑剪影 —— WebGL 那层照片淡出时淡向了黑，
    // 而不是淡向背景。现在它应该整体偏亮（融进白底）。
    const lightSubj = await evaluate(`(() => {
      const r = document.querySelector('.hero-subject').getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1 };
    })()`);
    const lightShot = await send('Page.captureScreenshot', { clip: lightSubj });
    const lightLuma = await evaluate(`window.__shotLuma(${JSON.stringify(lightShot.data)})`);
    check(lightLuma > 140, '浅色主题下主体不是一块黑剪影（淡出淡向背景而不是黑）',
      `主体区平均亮度 ${lightLuma.toFixed(0)}（全黑会是 30 上下）`);

    // 涟漪画布静止时整片等于背景色。差一点点就会露出一整块矩形 ——
    // 把 #fafafa(0.98) 当纯白(1.0) 就是这个效果，2% 的差肉眼刚好看得出来。
    // 取主体框的**角落**：那一带粒子已被 EDGE 淡出到零，量到的应该纯粹是背景。
    const corner = {
      x: lightSubj.x + 4, y: lightSubj.y + 4, width: 24, height: 24, scale: 1,
    };
    // 背景海报墙/噪点会把角落压暗，量"画布是否露出矩形"时先藏掉
    await evaluate(`document.querySelector('.hero-wall').style.opacity='0';
      document.querySelector('.hero-concept__noise').style.opacity='0';
      document.querySelector('.hero-dust').style.opacity='0'; 1`);
    await sleep(520);
    const cornerShot = await send('Page.captureScreenshot', { clip: corner });
    const cornerLuma = await evaluate(`window.__shotLuma(${JSON.stringify(cornerShot.data)})`);
    await evaluate(`document.querySelector('.hero-wall').style.opacity='';
      document.querySelector('.hero-concept__noise').style.opacity='';
      document.querySelector('.hero-dust').style.opacity=''; 1`);
    const bgLuma = await evaluate(`(() => {
      const m = getComputedStyle(document.querySelector('.hero-concept')).backgroundColor.match(/\\d+/g);
      return 0.2126 * +m[0] + 0.7152 * +m[1] + 0.0722 * +m[2];
    })()`);
    check(Math.abs(cornerLuma - bgLuma) < 4, '静止时画布那片和背景亮度一致（没有露出矩形）',
      `角落 ${cornerLuma.toFixed(1)} vs 背景 ${bgLuma.toFixed(1)}`);

    // 涟漪画布静止时整片填的是背景色，椭圆遮罩会把这块填充裁成一个椭圆。
    // 只要填充和背景差一点，那片椭圆就会显出来 —— 把粒子层藏掉直接量最干净。
    // 实测过一次：容器的 brightness(1.06) 把 #fafafa 顶成纯白，差 5/255，
    // 平色上一眼就看得出来。
    const rippleIdle = await evaluate(`(() => {
      const c = document.querySelector('.hero-subject__ripple');
      return c ? { idle: c.classList.contains('is-idle'), opacity: Number(getComputedStyle(c).opacity) } : null;
    })()`);
    check(rippleIdle && rippleIdle.idle && rippleIdle.opacity === 0,
      '主人格静止时椭圆填充层完全隐藏',
      rippleIdle ? `idle=${rippleIdle.idle} opacity=${rippleIdle.opacity}` : 'MISSING');

    const bareFill = async () => {
      await evaluate(`document.querySelector('.hero-subject__grain').style.opacity = '0';
        document.querySelector('.hero-wall').style.opacity = '0';
        document.querySelector('.hero-concept__noise').style.opacity = '0';
        document.querySelector('.hero-dust').style.opacity = '0'; 1`);
      await sleep(520);
      const r = await evaluate(`(() => {
        const b = document.querySelector('.hero-subject').getBoundingClientRect();
        return { x: b.left + b.width / 2 - 20, y: b.top + b.height / 2 - 20, width: 40, height: 40, scale: 1 };
      })()`);
      const shot = await send('Page.captureScreenshot', { clip: r });
      const luma = await evaluate(`window.__shotLuma(${JSON.stringify(shot.data)})`);
      await evaluate(`document.querySelector('.hero-subject__grain').style.opacity = '';
        document.querySelector('.hero-wall').style.opacity = '';
        document.querySelector('.hero-concept__noise').style.opacity = '';
        document.querySelector('.hero-dust').style.opacity = ''; 1`);
      return luma;
    };
    const lightFill = await bareFill();
    check(Math.abs(lightFill - bgLuma) < 2, '浅色下椭圆里那片填充和背景一模一样',
      `填充 ${lightFill.toFixed(1)} vs 背景 ${bgLuma.toFixed(1)}`);

    // 切回深色，后面的断言按深色假设
    await evaluate(`document.querySelector('#themeToggle').click()`);
    await sleep(900);
    // 深色下也量一次：填的是黑，理应和背景严丝合缝
    const darkFill = await bareFill();
    const darkBg = await evaluate(`(() => {
      const m = getComputedStyle(document.querySelector('.hero-concept')).backgroundColor.match(/\\d+/g);
      return 0.2126 * +m[0] + 0.7152 * +m[1] + 0.0722 * +m[2];
    })()`);
    check(Math.abs(darkFill - darkBg) < 2, '深色下椭圆里那片填充和背景一模一样',
      `填充 ${darkFill.toFixed(1)} vs 背景 ${darkBg.toFixed(1)}`);
    const backToDark = await evaluate(THEME_PROBE);
    check(backToDark.dark && backToDark.bg === 'rgb(0, 0, 0)', '切回深色主题',
      `${backToDark.bg} / luma ${backToDark.dustLuma.toFixed(0)}`);

    // ── 拖动人格的末端 ──────────────────────────────────────────────────
    const ringCenter = () => evaluate(`(() => {
      const r = document.querySelector('.persona').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);

    const before = await ringCenter();
    const DX = -130;
    const DY = 92;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: before.x, y: before.y, buttons: 0 });
    await sleep(450);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: before.x, y: before.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 6; i++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: before.x + (DX * i) / 6,
        y: before.y + (DY * i) / 6,
        buttons: 1,
      });
      await sleep(60);
    }
    await sleep(300);

    const during = await evaluate(`(() => {
      const p = document.querySelector('.persona');
      const r = p.getBoundingClientRect();
      return {
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        photo: getComputedStyle(p.querySelector('.persona__photo')).opacity,
      };
    })()`);

    // 环本身也在转（6°/s → 约 40px/s），所以位移对不上一点点是正常的，给 80px 容差
    check(Math.abs(during.cx - (before.x + DX)) < 80 && Math.abs(during.cy - (before.y + DY)) < 80,
      '末端跟着指针走了',
      `目标 (${Math.round(before.x + DX)}, ${Math.round(before.y + DY)}) 实际 (${Math.round(during.cx)}, ${Math.round(during.cy)})`);
    check(Number(during.photo) === 1, '拖动时那一条是聚着的（照片已淡入）', during.photo);

    await shoot('hero-02e-drag.png');

    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: before.x + DX, y: before.y + DY, button: 'left' });
    await sleep(700);

    const after = await evaluate(`(() => {
      const p = document.querySelector('.persona');
      const r = p.getBoundingClientRect();
      return {
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        path: location.pathname,
      };
    })()`);
    check(after.path === '/', '拖动不会误触发跳转（拖完松手停在首页）', after.path);

    // 松手后**停在落点**，不弹回。而且环还在继续转 —— 被放下的那一格
    // 必须靠每帧补的 transform 钉住，否则会跟着环飘走。
    const placedAt = await ringCenter();
    check(Math.hypot(placedAt.x - during.cx, placedAt.y - during.cy) < 20,
      '松手后停在落点上（没有弹回）',
      `松手时 (${Math.round(during.cx)}, ${Math.round(during.cy)}) → 现在 (${Math.round(placedAt.x)}, ${Math.round(placedAt.y)})`);

    await sleep(1800); // 60s 一圈 → 这段里环转了约 11°，不钉住的话会飘出 ~45px
    const stillThere = await ringCenter();
    check(Math.hypot(stillThere.x - placedAt.x, stillThere.y - placedAt.y) < 12,
      '环继续转，但放下的那一格钉在原地没跟着飘',
      `1.8s 后位移 ${Math.hypot(stillThere.x - placedAt.x, stillThere.y - placedAt.y).toFixed(1)}px`);

    // 拖完**马上**点一下（只隔 150ms）—— 这正是拖拽和点击最容易打架的地方。
    // 早先用 400ms 定时器吞点击，这一下会被误吞，页面不跳。
    await sleep(150);
    const quickAt = async () => evaluate(`(() => {
      const r = document.querySelector('.persona').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    const q1 = await quickAt();
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: q1.x, y: q1.y, buttons: 0 });
    await sleep(140);
    const q2 = await quickAt();
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: q2.x, y: q2.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: q2.x, y: q2.y, button: 'left', clickCount: 1 });
    await sleep(1300);
    const quickNav = await evaluate(`({ path: location.pathname, vtCalls: window.__vtCalls })`);
    check(quickNav.vtCalls === 1 && quickNav.path.startsWith('/blogs/'),
      '拖完立刻点一下仍能正常跳转（这次点击没被当成拖拽吞掉）',
      `vtCalls=${quickNav.vtCalls} path=${quickNav.path}`);
    await evaluate(`document.querySelector('.back-link')?.click()`);
    await sleep(900);

    // ── 点击 → 共享元素过渡 ─────────────────────────────────────────────
    // 环一直在转，前面那几秒的涟漪检查足够让它转走 20° 以上 ——
    // 必须现量现点，用早先那个 box 会点空。
    const liveBox = await evaluate(`(() => {
      const r = document.querySelector('.persona').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: liveBox.x, y: liveBox.y, buttons: 0 });
    await sleep(700); // 等重组走完，顺便让过渡快照抓到成图态
    const clickBox = await evaluate(`(() => {
      const r = document.querySelector('.persona').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: clickBox.x, y: clickBox.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: clickBox.x, y: clickBox.y, button: 'left', clickCount: 1 });
    await sleep(1500);

    const nav = await evaluate(`({
      path: location.pathname,
      vtSupported: window.__vtSupported,
      vtCalls: window.__vtCalls,
      namesAtCapture: window.__vtNames[0] || [],
      detailName: (() => {
        const el = document.querySelector('.blog-featured-image');
        return el ? getComputedStyle(el).getPropertyValue('view-transition-name').trim() : null;
      })(),
      detailClass: (() => {
        const el = document.querySelector('.blog-featured-image');
        return el ? getComputedStyle(el).getPropertyValue('view-transition-class').trim() : null;
      })(),
    })`);

    check(nav.vtSupported, '浏览器支持 View Transitions API');
    check(nav.path === '/blogs/romanticist-fragment-i', '点 Romantics 跳到对应那篇 fragment', nav.path);
    check(nav.vtCalls === 2, 'startViewTransition 被调用了一次（点击那次）', `calls=${nav.vtCalls}`);
    check(
      Array.isArray(nav.namesAtCapture) && nav.namesAtCapture.includes('blog-cover-romanticist-fragment-i'),
      '旧快照里带着共享元素名',
      JSON.stringify(nav.namesAtCapture)
    );
    check(nav.detailName === 'blog-cover-romanticist-fragment-i', '详情页封面用了同一个 name（共享元素成立）', String(nav.detailName));
    check(nav.detailClass === 'blog-cover', '详情页封面带同一个 class', String(nav.detailClass));

    await shoot('hero-03-detail.png');

    // ── keep-alive 返回首页后还活着吗 ───────────────────────────────────
    // 仓库有前科：setupMePageEvents 不是幂等的，每次访问都叠一套监听。
    // 这里监听都挂在 onMounted，理应只跑一次——但得实测。
    await evaluate(`document.querySelector('.back-link')?.click()`);
    await sleep(1000);
    const backHome = await evaluate(`({
      path: location.pathname,
      personas: document.querySelectorAll('.persona').length,
      wall: document.querySelectorAll('.hero-wall img').length,
      vtCalls: window.__vtCalls,
      canvasesAlive: !!document.querySelector('canvas.hero-dust')?.width,
    })`);
    check(backHome.path === '/', '从详情页返回首页', backHome.path);
    check(backHome.personas === 4, '返回后四个人格仍在（keep-alive 复用）', `count=${backHome.personas}`);
    check(backHome.wall === 64, '返回后背景海报墙也还在', `count=${backHome.wall}`);
    check(backHome.vtCalls === 2, '返回这一步没有再触发过渡', `calls=${backHome.vtCalls}`);
    check(backHome.canvasesAlive, '返回后 canvas 尺寸没被重置');

    // 环在转，每次交互前都要现量 —— 复用旧坐标会点空
    const liveCenter = () => evaluate(`(() => {
      const r = document.querySelector('.persona').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);

    const box2 = await liveCenter();
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box2.x, y: box2.y, buttons: 0 });
    await sleep(500);
    const box2b = await liveCenter(); // 追上这半秒的漂移
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box2b.x, y: box2b.y, buttons: 0 });
    await sleep(500);
    const revived = await evaluate(`(() => {
      const p = document.querySelector('.persona');
      const m = new DOMMatrixReadOnly(getComputedStyle(p).transform);
      return {
        opacity: getComputedStyle(p.querySelector('.persona__photo')).opacity,
        // 场景还在跑：DOM 的 transform 每帧被投影重写，缩放非 0 就说明还活着
        scale: m.a,
      };
    })()`);
    check(Number(revived.opacity) === 1, '返回后悬停仍能重组', revived.opacity);
    check(revived.scale > 0.5, '返回后三维场景仍在驱动 DOM 位置', revived.scale.toFixed(3));

    const box2c = await liveCenter();
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box2c.x, y: box2c.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box2c.x, y: box2c.y, button: 'left', clickCount: 1 });
    await sleep(1300);
    const second = await evaluate(`({ path: location.pathname, vtCalls: window.__vtCalls })`);
    check(second.vtCalls === 3, '第三次点击也能触发过渡（不是一次性）', `calls=${second.vtCalls}`);
    check(second.path.startsWith('/blogs/'), '第二次也跳到了详情页', second.path);

    // ── 点主体：四条一起收拢成照片，然后才走 ────────────────────────────
    // 主体是四个人格共同的来源，点它的时候它们会先后归位（各自随机错开），
    // 全收拢之后才跳到 /me。
    await evaluate(`document.querySelector('.back-link')?.click()`);
    await sleep(900);
    const subjectBox = await evaluate(`(() => {
      const r = document.querySelector('.hero-subject').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: subjectBox.x, y: subjectBox.y, buttons: 0 });
    await sleep(200);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: subjectBox.x, y: subjectBox.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: subjectBox.x, y: subjectBox.y, button: 'left', clickCount: 1 });
    // 错开最多 200ms + 重组 620ms + 照片淡入 350ms —— 1100ms 时四张应该都已经成图
    await sleep(1100);
    const gathered = await evaluate(`(() => ({
      photos: [...document.querySelectorAll('.persona .persona__photo')]
        .map((el) => Number(getComputedStyle(el).opacity)),
      path: location.pathname,
    }))()`);
    check(gathered.photos.every((v) => v === 1), '点主体后四条人格一起收拢成照片',
      `四张照片不透明度 ${gathered.photos.join(' / ')}`);
    check(gathered.path === '/', '收拢动画播完之前还没跳走', gathered.path);

    await sleep(800);
    const afterSubject = await evaluate(`location.pathname`);
    check(afterSubject === '/', '点主体收拢完之后仍留在首页（不跳转）', afterSubject);

    // ── 移动端 ──────────────────────────────────────────────────────────
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await goto(url);

    const mobile = await evaluate(`(() => {
      const personas = [...document.querySelectorAll('.persona')];
      const s = document.querySelector('.hero-concept__stage').getBoundingClientRect();
      const cx = s.left + s.width / 2;
      const cy = s.top + s.height / 2;
      const dust = document.querySelector('canvas.hero-dust').getBoundingClientRect();
      const hero = document.querySelector('.hero-concept').getBoundingClientRect();
      return {
        fine: window.matchMedia('(hover: hover) and (pointer: fine)').matches,
        cursorDisplay: (() => { const c = document.querySelector('.block-cursor'); return c ? getComputedStyle(c).display : '(没有方块光标)'; })(),
        heroCursor: getComputedStyle(document.querySelector('.hero-concept')).cursor,
        // 场景画布铺满整个 hero —— 被拖走的人格不会在舞台外被裁掉
        dustCoversHero: Math.abs(dust.width - hero.width) < 2 && Math.abs(dust.height - hero.height) < 2,
        noScene: document.querySelector('.hero-concept').classList.contains('no-scene'),
        // 三维：四格围着舞台中心散开，且各自的缩放不同（有前后）
        dists: personas.map((p) => {
          const r = p.getBoundingClientRect();
          return Math.round(Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy));
        }),
        scales: personas.map((p) => new DOMMatrixReadOnly(getComputedStyle(p).transform).a),
        noOverflowX: document.documentElement.scrollWidth <= window.innerWidth + 1,
        pageScreens: document.documentElement.scrollHeight / window.innerHeight,
      };
    })()`);

    check(!mobile.fine, '移动端不再当成精确指针', `fine=${mobile.fine}`);
    check(mobile.cursorDisplay === 'none', '移动端不渲染方块光标', mobile.cursorDisplay);
    check(mobile.heroCursor !== 'none', '移动端恢复系统光标', mobile.heroCursor);
    check(!mobile.noScene, '移动端也建起了三维场景');
    check(mobile.dustCoversHero, '场景画布铺满整个 hero');
    // 小屏改成竖构图（4/5）：整圈等比缩到一屏里，不再走"2×2 网格"那套 ——
    // 网格由 CSS 算位置、粒子和 DOM 由投影算位置，两套坐标系对不上。
    check(Math.min(...mobile.dists) > 50 && Math.max(...mobile.dists) < 420,
      '四格围着主体散开，都落在舞台范围内', mobile.dists.join(' / '));
    check(Math.max(...mobile.scales) / Math.min(...mobile.scales) > 1.05,
      '移动端也有前后远近（缩放互不相同）',
      mobile.scales.map((v) => v.toFixed(3)).join(' / '));
    check(mobile.noOverflowX, '移动端没有横向溢出');
    check(mobile.pageScreens < 3, '移动端整页没长到离谱', `${mobile.pageScreens.toFixed(1)} 屏`);

    // 触屏没有 hover，靠 IntersectionObserver 把进了视口的那几条自己重组好。
    // 粒子在 WebGL 里读不到像素，看照片的不透明度就够了。
    const READ = (i) => `(() => {
      const p = document.querySelectorAll('.persona')[${i}];
      return {
        label: p.querySelector('.persona__label').textContent.trim(),
        opacity: getComputedStyle(p.querySelector('.persona__photo')).opacity,
      };
    })()`;
    const reached = await evaluate(READ(0));
    check(Number(reached.opacity) === 1, '触屏：进了视口的那一条会自己重组', reached.label);

    // ── 网络与控制台 ────────────────────────────────────────────────────
    // 两类预期失败：
    //   1. 本机访问不到的域名（CDN 相册、CMS 埋点）
    //   2. net::ERR_ABORTED —— 客户端主动取消，最常见的是 <audio> 为做 seek/预加载
    //      发的 range 请求被浏览器掐掉，不是真的失败
    // 除此之外任何失败都算问题——尤其是 /me/personas/ 那四张。
    const LOCAL_OFFLINE = /^https:\/\/(img|cms|api)\.liveinpassion\.me\//;
    const realFailures = failedRequests.filter(
      (u) => !LOCAL_OFFLINE.test(u) && !/net::ERR_ABORTED/.test(u)
    );
    check(realFailures.length === 0, 'localhost 侧的请求全部成功（不含本机不可达的 CDN/CMS）',
      realFailures.join(', ') || `忽略了 ${failedRequests.length} 条预期失败`);

    const realErrors = consoleErrors.filter((e) => !/favicon/i.test(e));
    check(realErrors.length === 0, '零控制台报错', realErrors.join(' || '));

    console.log(notes.join('\n'));
    if (failures.length) {
      console.log('\n失败项：\n' + failures.join('\n'));
      console.log(`\n截图：${outDir}`);
      process.exitCode = 1;
    } else {
      console.log(`\n全部通过。截图：${outDir}`);
    }
  } finally {
    child.kill();
    await sleep(400);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
