// BLOGS lookback 页的取景/体检工具（开发期用，可反复跑）：
//
//   node tools/blog-shots.mjs                      # 自己起 vite dev（5199）再跑
//   node tools/blog-shots.mjs http://localhost:4174/blogs   # 用已有的 preview
//
// 做三件事：
//   1. 拦下 img.liveinpassion.me（本机常到不了 CDN），回一张内联小图 —— 截图不会满屏破图
//   2. 收 console 报错 / 失败请求
//   3. 截图（桌面 + 移动）并打印一组布局断言：卡片数、轨道是否真的是横向溢出、
//      文档有没有被撑出纵向滚动、字标高度、当前计数器
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 5199;
const APP_DIR = path.resolve('app');

const outDir = process.env.BLOG_OUT_DIR || path.join(os.tmpdir(), 'blogs-shots');
fs.mkdirSync(outDir, { recursive: true });

// 按请求的 slug / 文件名给一个**固定宽高比**的 PNG：
// 1×1 的桩会把 "naturalRatio" 算成 1，"不裁剪"这条断言就永远成立、等于没测。
// 这里让同一篇每次拿到同一个比例，断言才有意义。
const RATIOS = [[794, 1000], [1500, 1000], [1000, 1000], [664, 1000], [1600, 900]];
function ratioFor(url) {
  let h = 0;
  for (let i = 0; i < url.length; i += 1) h = (h * 31 + url.charCodeAt(i)) % 100003;
  return RATIOS[h % RATIOS.length];
}
// 生成一张真实尺寸的纯色 PNG（无压缩算法依赖：手写 IHDR/IDAT/CRC）
function makePng(w, h, rgb = [40, 40, 48]) {
  const crcTable = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // truecolor
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * (w * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x += 1) {
      const p = row + 1 + x * 3;
      raw[p] = rgb[0];
      raw[p + 1] = rgb[1];
      raw[p + 2] = rgb[2];
    }
  }
  // IDAT 必须是 zlib 流；纯色数据用 stored（未压缩）块最省事
  const zlib = (() => {
    const parts = [Buffer.from([0x78, 0x01])];
    let off = 0;
    while (off < raw.length) {
      const size = Math.min(65535, raw.length - off);
      const head = Buffer.alloc(5);
      head[0] = (off + size >= raw.length) ? 1 : 0; // BFINAL
      head.writeUInt16LE(size, 1);
      head.writeUInt16LE(0xffff - size, 3);
      parts.push(head, raw.subarray(off, off + size));
      off += size;
    }
    const adler = (() => {
      let a = 1;
      let b = 0;
      for (let i = 0; i < raw.length; i += 1) {
        a = (a + raw[i]) % 65521;
        b = (b + a) % 65521;
      }
      return ((b << 16) | a) >>> 0;
    })();
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(adler);
    parts.push(tail);
    return Buffer.concat(parts);
  })();
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const STUB_CACHE = new Map();
function stubFor(url) {
  const [w, h] = ratioFor(url);
  const key = `${w}x${h}`;
  if (!STUB_CACHE.has(key)) STUB_CACHE.set(key, makePng(w, h).toString('base64'));
  return STUB_CACHE.get(key);
}

let vite = null;
async function startVite() {
  vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: APP_DIR,
    stdio: 'ignore',
    shell: true,
  });
  for (let i = 0; i < 80; i += 1) {
    try {
      const r = await fetch(`http://localhost:${PORT}/blogs`);
      if (r.ok) return;
    } catch {
      /* 还没起来 */
    }
    await sleep(300);
  }
  throw new Error('vite dev 起不来');
}

async function run(target) {
  const url = target || `http://localhost:${PORT}/blogs`;
  const origin = new URL(url).origin;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blogs-shots-'));
  const child = spawn(
    CHROME,
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`,
     '--no-first-run', '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
     '--window-size=1440,900', 'about:blank'],
    { stdio: 'ignore' }
  );

  const errors = [];
  try {
    const portFile = path.join(profileDir, 'DevToolsActivePort');
    let port = null;
    for (let i = 0; i < 120 && !port; i += 1) {
      try {
        const line = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
        if (line) port = Number(line);
      } catch {
        /* 等 */
      }
      if (!port) await sleep(250);
    }
    if (!port) throw new Error('Chrome 没写出 DevToolsActivePort');

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
    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('求值失败: ' + (r.exceptionDetails.exception?.description || '').slice(0, 300));
      return r.result.value;
    };
    const shoot = async (name) => {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      const p = path.join(outDir, name);
      fs.writeFileSync(p, Buffer.from(data, 'base64'));
      return p;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Animation.enable');
    // ⚠ 动画速率必须保持 1：品牌遮罩的 ENTER 序列是 setTimeout 驱动的
    //（LIFT 820ms + DROP 900ms + LEAVE 420ms），把它放慢会连带把遮罩退场拖到 9 秒，
    // 后续所有合成鼠标事件都会被那层吃掉，测出来全是"没反应"。
    // 想看详情页入场动画的中段，在点卡片之前再单独把它调到 0.25。
    await send('Animation.setPlaybackRate', { playbackRate: 1 });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

    on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error' || p.type === 'warning') {
        errors.push(`[${p.type}] ` + p.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 300));
      }
    });
    on('Runtime.exceptionThrown', (p) => {
      errors.push('[exception] ' + (p.exceptionDetails?.exception?.description || JSON.stringify(p.exceptionDetails)).slice(0, 400));
    });
    on('Network.loadingFailed', (p) => {
      if (p.blockedReason) return;
      errors.push(`[net] ${p.errorText} ${p.type}`);
    });

    await send('Fetch.enable', { patterns: [{ urlPattern: 'https://img.liveinpassion.me/*' }] });
    on('Fetch.requestPaused', async (p) => {
      try {
        await send('Fetch.fulfillRequest', {
          requestId: p.requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'image/png' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
          body: stubFor(p.request.url),
        });
      } catch {
        /* 页面已经走了 */
      }
    });

    // 共享元素过渡是不是真的演了：pagereveal 会在每次 view transition 开始时派发，
    // 并且带上那个 ViewTransition 对象。异步页面（router.push 之后才抓新快照）
    // 必然走这条路 —— 所以这个计数器就是"封面形变发生过"的证据。
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__vt = { pagereveal: 0, names: [], reduced: matchMedia('(prefers-reduced-motion: reduce)').matches };
        addEventListener('pagereveal', (e) => {
          window.__vt.pagereveal++;
          const types = e.viewTransition && e.viewTransition.types;
          window.__vt.names.push(types ? [...types].join(',') : '');
        });
      `,
    });

    await send('Page.navigate', { url: origin + '/' });
    await sleep(3000);

    // 站点首屏盖着品牌遮罩（点 ENTER 才揭开）。不先过掉它，后面所有鼠标事件
    // 都被那层 9999 的遮罩吃掉 —— 悬停/拖拽会全部测成"没反应"。
    const enterBox = await evaluate(`(() => {
      const el = document.querySelector('.brand__enter') || document.querySelector('.brand');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: r.left + r.width / 2, y: r.top + r.height / 2, cls: el.className,
        disabled: el.disabled === true,
        pe: getComputedStyle(el).pointerEvents,
        op: getComputedStyle(el).opacity,
      };
    })()`);
    console.log('--- ENTER 按钮 ---');
    console.log(JSON.stringify(enterBox));
    if (enterBox) {
      // 先看合成点击到底有没有送到按钮上：headless 里 CDP 的鼠标事件偶尔到不了
      // 第一层元素（这属于测试工具的问题，不是页面的问题）。
      await evaluate(`(() => {
        const b = document.querySelector('.brand__enter');
        window.__enterClick = 0;
        b.addEventListener('click', () => { window.__enterClick += 1; }, true);
      })()`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: enterBox.x, y: enterBox.y });
      await sleep(80);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: enterBox.x, y: enterBox.y, button: 'left', buttons: 1, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: enterBox.x, y: enterBox.y, button: 'left', buttons: 0, clickCount: 1 });
      await sleep(400);
      const got = await evaluate(`window.__enterClick`);
      console.log('--- 合成点击是否到达按钮 ---', got);
      if (!got) {
        console.log('  → CDP 鼠标事件没落到按钮上，改用 DOM 的 click() 过掉遮罩（只为跑后续用例）');
        await evaluate(`document.querySelector('.brand__enter').click()`);
      }
      // 遮罩是"淡完再 visible:hidden + pointer-events:none"：等它真的退场，
      // 否则后面所有合成鼠标事件都会被那层吃掉，测出来全是"没反应"。
      for (let i = 0; i < 40; i += 1) {
        await sleep(300);
        const probe = await evaluate(`(() => {
          const el = document.elementFromPoint(700, 500);
          const brand = document.querySelector('.brand');
          return {
            hit: el ? (el.className || el.tagName) : null,
            inBrand: !!(el && el.closest && el.closest('.brand')),
            brandOpacity: brand ? getComputedStyle(brand).opacity : null,
          };
        })()`);
        if (i % 4 === 0) console.log('  轮询', JSON.stringify(probe));
        if (!probe.inBrand) break;
      }
    }
    const veil = await evaluate(`(() => {
      const b = document.querySelector('.brand');
      if (!b) return { present: false };
      const cs = getComputedStyle(b);
      return { present: true, opacity: cs.opacity, visibility: cs.visibility, pe: cs.pointerEvents, z: cs.zIndex };
    })()`);
    console.log('--- 品牌遮罩 ---');
    console.log(JSON.stringify(veil));

    await send('Page.navigate', { url: origin + '/blogs' });
    await sleep(4500);

    // 直接在 /blogs 冷启动时，品牌遮罩仍然是 visible=true（它是"首屏进入"用的）。
    // headless 里它即使 opacity 已经 0 也照样吃掉 CDP 合成出来的鼠标事件，
    // 会把 hover/拖拽/点击全部测成"没反应"。这里把它从 DOM 里摘掉，
    // 好让后面测的是真正的事件路径（这是测试夹具的动作，不是页面的行为）。
    // ⚠ 每次回到 /blogs 都要重新摘 —— 上面那次直调探针会跳去详情页，
    //   路由切回来时 keep-alive 把 BlogsView 又挂上了，遮罩跟着回来。
    const dropVeil = async () => {
      const removed = await evaluate(`(() => {
        const b = document.querySelector('.brand');
        if (!b) return false;
        b.remove();
        return true;
      })()`);
      return removed;
    };
    console.log('--- 移除残留遮罩 ---', await dropVeil());
    await sleep(300);

    // 探针：直接调业务函数，绕开输入层。这一步用来区分
    // "导航本身坏了" 和 "合成鼠标事件没落到卡片上"。
    console.log('--- 直调 openPost（绕开输入层） ---');
    const direct = await evaluate(`(async () => {
      const before = location.pathname;
      window.__jb.openAt(3);
      await new Promise((r) => setTimeout(r, 1200));
      return { before, after: location.pathname, state: window.__jb.state() };
    })()`);
    console.log(JSON.stringify(direct));
    if (direct.after !== direct.before) {
      console.log('  → 业务逻辑能跳转；如果合成点击跳不了，问题在输入层');
      await send('Page.navigate', { url: origin + '/blogs' });
      await sleep(3000);
      // ⚠ 整页重载会把首屏 ENTER 遮罩再挂回来（它是"每个文档一次"的，而它要等字体
      //   就绪才出现 —— 摘早了它还没来，摘一次不够）。不摘干净的话后面所有合成点击
      //   都打在遮罩上（实测 hit: brand__bg，点击全部落空、"点不开详情"）。
      for (let i = 0; i < 10; i += 1) {
        await dropVeil();
        await sleep(250);
      }
    }

    const metrics = await evaluate(`(() => {
      const root = document.querySelector('.jb-carousel');
      const cards = root ? root.querySelectorAll('.jb-card') : [];
      const wm = document.querySelector('.jb-wordmark');
      return {
        url: location.pathname,
        cardCount: cards.length,
        cardW: cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : 0,
        cardH: cards[0] ? Math.round(cards[0].getBoundingClientRect().height) : 0,
        overflowX: root ? Math.round(root.scrollWidth - root.clientWidth) : 0,
        docOverflowY: Math.round(document.documentElement.scrollHeight - window.innerHeight),
        docOverflowX: Math.round(document.documentElement.scrollWidth - window.innerWidth),
        wmH: wm ? Math.round(wm.offsetHeight) : 0,
        wmFont: wm ? getComputedStyle(wm.querySelector('.jb-wm-title')).fontFamily : '',
        counter: document.querySelector('.jb-rail-idx')?.textContent,
        total: document.querySelector('.jb-rail-sep')?.textContent,
        firstNum: document.querySelector('.jb-num')?.textContent,
        tiltFirst: cards[0] ? (cards[0].style.transform || '(none)') : '',
        tiltLast: cards[cards.length - 1] ? (cards[cards.length - 1].style.transform || '(none)') : '',
        tiltedCount: [...cards].filter((c) => c.style.transform).length,
        // 轨道里只应该有压缩图地址（原图留给详情页）
        carouselFullSrc: document.querySelectorAll('.jb-carousel img[data-full-src]').length,
        carouselDataSrc: document.querySelectorAll('.jb-carousel img[data-src]').length,
        imgsLoaded: [...document.querySelectorAll('.jb-media img')].filter((i) => i.classList.contains('loaded')).length,
        htmlClass: document.documentElement.className,
      };
    })()`);

    console.log('--- 桌面 1440x900 ---');
    console.log(JSON.stringify(metrics, null, 2));

    const shotDesktop = await shoot('desktop.png');

    // 悬停第三张：标题/阅读时长的滑出
    await dropVeil();
    await sleep(200);
    // ⚠ 取"当前落在视口里的第 3 张"：轨道为无限循环铺了三份，写死的 [2] 现在是屏幕外
    // 那一份，指针移过去什么也命中不了（实测 hover 一直 false）。
    const hover = await evaluate(`(() => {
      const c = [...document.querySelectorAll('.jb-card')]
        .filter((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })[2];
      if (!c) return null;
      c.dataset.hoverProbe = '1';
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width/2, y: r.top + r.height/2, top: document.elementFromPoint(r.left + r.width/2, r.top + r.height/2)?.className };
    })()`);
    if (hover) {
      console.log('--- 悬停命中检查 ---');
      console.log(JSON.stringify(hover));
      // 先把指针挪开再回来：CDP 只在坐标真的变化时才派发 mouseMoved，
      // 停在原地重复同一个坐标是收不到事件的。
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hover.x - 40, y: hover.y - 40 });
      await sleep(120);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hover.x, y: hover.y });
      await sleep(900);
      const hovered = await evaluate(`(() => {
        const c = document.querySelector('.jb-card[data-hover-probe="1"]');
        const t = c.querySelector('.jb-title');
        return {
          opacity: getComputedStyle(t).opacity,
          title: t.textContent.trim().slice(0, 40),
          hovered: c.matches(':hover'),
          hit: document.elementFromPoint(${hover.x}, ${hover.y})?.className,
        };
      })()`);
      console.log('--- hover 第 3 张 ---');
      console.log(JSON.stringify(hovered));
      await shoot('desktop-hover.png');
    }

    // 横向拖拽：按下 → 移动 → 抬起，再等阻尼收尾
    const before = await evaluate(`Math.round(document.querySelector('.jb-carousel').scrollLeft)`);
    // 先移指针到位：CDP 的 mousePressed 只是按下，指针坐标得自己先建立。
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 500 });
    await sleep(80);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 500, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 12; i += 1) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700 - i * 30, y: 500, button: 'left', buttons: 1 });
      await sleep(16);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 340, y: 500, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(700);
    const after = await evaluate(`(() => {
      const r = document.querySelector('.jb-carousel');
      const cards = [...r.querySelectorAll('.jb-card')];
      return {
        scrollLeft: Math.round(r.scrollLeft),
        counter: document.querySelector('.jb-rail-idx').textContent,
        path: location.pathname,
        dragging: r.classList.contains('is-dragging'),
        // 进度条改成了带刻度的时间线：读数在播放头上（原来是一个 scaleX 的 span）
        progress: document.querySelector('.jb-progress .jb-playhead')?.style.left || null,
        tilts: cards.slice(0, 4).map((c) => c.style.transform).filter(Boolean).length,
      };
    })()`);
    console.log('--- 拖拽 ---');
    console.log(JSON.stringify({ before, ...after }));

    // 阻尼收尾：再等一会儿，看是否继续滑一小段然后停住
    await sleep(1200);
    console.log('--- 拖拽松手后 1.2s ---');
    console.log(JSON.stringify(await evaluate(`({ scrollLeft: Math.round(document.querySelector('.jb-carousel').scrollLeft) })`)));
    await shoot('desktop-dragged.png');

    // 滚轮：连续三次，看是不是累加 + 平滑（第三次之后的 scrollLeft 应该明显大于第一次）
    await evaluate(`document.querySelector('.jb-carousel').scrollTo({ left: 0, behavior: 'instant' })`);
    await sleep(400);
    const wheelTrace = [];
    for (let i = 0; i < 3; i += 1) {
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 500, deltaX: 0, deltaY: 240 });
      await sleep(260);
      wheelTrace.push(await evaluate(`Math.round(document.querySelector('.jb-carousel').scrollLeft)`));
    }
    await sleep(800);
    const wheelRest = await evaluate(`Math.round(document.querySelector('.jb-carousel').scrollLeft)`);
    console.log('--- 滚轮（每次 260ms 采样） ---');
    console.log(JSON.stringify({ trace: wheelTrace, rest: wheelRest }));
    await shoot('desktop-wheeled.png');

    // 帧率探针：把"微倾 + 惯性"这段最重的路径跑 2.4s，取 rAF 间隔的 p50 / p95。
    // 8.3ms 是 120Hz 的帧预算，16.7ms 是 60Hz —— 看 p95 有没有越过 16.7 就知道卡不卡。
    const fps = await evaluate(`new Promise((resolve) => {
      const root = document.querySelector('.jb-carousel');
      root.scrollTo({ left: 0, behavior: 'instant' });
      const gaps = [];
      let last = 0;
      let n = 0;
      function step(now) {
        if (last) gaps.push(now - last);
        last = now;
        n += 1;
        if (n % 6 === 0) {
          root.dispatchEvent(new WheelEvent('wheel', { deltaY: 130, bubbles: true, cancelable: true }));
        }
        if (n < 240) requestAnimationFrame(step);
        else {
          gaps.sort((a, b) => a - b);
          const at = (q) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))];
          resolve({ frames: gaps.length, p50: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), max: +gaps[gaps.length - 1].toFixed(2), scrollLeft: Math.round(root.scrollLeft) });
        }
      }
      requestAnimationFrame(step);
    })`);
    console.log('--- 帧间隔（滚轮驱动，2.4s） ---');
    console.log(JSON.stringify(fps));

    // 键盘 ←
    await evaluate(`document.querySelector('.jb-carousel').focus()`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
    await sleep(900);
    console.log('--- 键盘 ← ---');
    console.log(JSON.stringify(await evaluate(`({ scrollLeft: Math.round(document.querySelector('.jb-carousel').scrollLeft), counter: document.querySelector('.jb-rail-idx').textContent })`)));

    // 点卡片：应该走共享元素过渡进详情页
    await evaluate(`window.__vt.pagereveal = 0`);
    // 先滚回起点，保证要点的那张确实在视口里（键盘那步已经滚到 6000+ 了）
    const resetInfo = await evaluate(`(async () => {
      const r = document.querySelector('.jb-carousel');
      r.scrollTo({ left: 0, behavior: 'instant' });
      await new Promise((res) => setTimeout(res, 500));
      return { scrollLeft: Math.round(r.scrollLeft) };
    })()`);
    console.log('--- 回到起点 ---', JSON.stringify(resetInfo));
    await sleep(300);
    // 探针：模板绑定的处理函数到底有没有被调用
    await evaluate(`(() => {
      window.__clicks = [];
      window.__downs = [];
      const root = document.querySelector('.jb-carousel');
      root.addEventListener('click', (e) => {
        window.__clicks.push({ target: e.target?.className || e.target?.tagName, card: !!e.target?.closest?.('.jb-card') });
      }, true);
      root.addEventListener('pointerdown', (e) => {
        window.__downs.push({ type: e.pointerType, target: e.target?.className || e.target?.tagName });
      }, true);
      root.addEventListener('pointerup', (e) => {
        window.__downs.push({ type: 'up:' + e.pointerType, target: e.target?.className || e.target?.tagName });
      }, true);
    })()`);
    // 这里才把动画放慢：详情页的逐段显现要抓中段（≈1.5s → ≈6s）
    await send('Animation.setPlaybackRate', { playbackRate: 0.25 });
    const clickTarget = await evaluate(`(() => {
      const all = [...document.querySelectorAll('.jb-card')];
      const r0 = document.querySelector('.jb-carousel').getBoundingClientRect();
      // 取"完全落在视口里"的第一张卡片：不假设滚动位置，直接按实测矩形点。
      const c = all.find((el) => {
        const r = el.getBoundingClientRect();
        return r.left > r0.left + 8 && r.right < r0.right - 8 && r.width > 10;
      }) || all[0];
      const r = c.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      return {
        x, y, w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right),
        idx: all.indexOf(c),
        hit: document.elementFromPoint(x, y)?.className || null,
        scrollLeft: Math.round(document.querySelector('.jb-carousel').scrollLeft),
      };
    })()`);
    console.log('--- 点击目标 ---', JSON.stringify(clickTarget));
    // 点下卡片的那一瞬间：记下"列表里那一格"的矩形，
    // 再采样封面在动画中的位置 —— 用来验证 FLIP 的起点是否与它吻合。
    // ⚠ 必须取**被点的那一张**（clickTarget.idx）：轨道为无限循环铺了三份，
    // 写死的 [0] 是另一份里的同一篇，可能整块在屏幕外（实测拿到过 left:-9758）。
    const sourceRect = await evaluate(`(() => {
      const fig = document.querySelectorAll('.jb-card')[${clickTarget.idx}].querySelector('.jb-media');
      const r = fig.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    })()`);
    console.log('--- 列表里那一格 ---', JSON.stringify(sourceRect));
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: clickTarget.x - 30, y: clickTarget.y - 30 });
    await sleep(60);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: clickTarget.x, y: clickTarget.y });
    await sleep(60);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: clickTarget.x, y: clickTarget.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: clickTarget.x, y: clickTarget.y, button: 'left', buttons: 0, clickCount: 1 });
    // 采样封面在进入动画前几帧的位置：必须从"列表那一格"出发
    const coverTrace = await evaluate(`new Promise((resolve) => {
      const out = [];
      let n = 0;
      function step() {
        const el = document.querySelector('.bd-cover .bd-media');
        if (el) {
          const r = el.getBoundingClientRect();
          out.push({ t: n, left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), vt: document.documentElement.dataset.vt || null });
        }
        n += 1;
        if (n <= 14) requestAnimationFrame(step); else resolve(out);
      }
      requestAnimationFrame(step);
    })`);
    console.log('--- 封面轨迹（进入前 15 帧） ---');
    console.log(JSON.stringify(coverTrace.slice(0, 8)));
    await sleep(400);
    // 点下卡片后**立刻**采样几次：data-vt='cover' 只在这一段挂着，
    // 它是"共享元素 + 竖直滑动那条皮肤在生效"的直接证据。
    const skin = [];
    for (let i = 0; i < 6; i += 1) {
      await sleep(120);
      skin.push(await evaluate(`({ t: ${i}, vt: document.documentElement.dataset.vt || null, path: location.pathname })`));
    }
    console.log('--- data-vt 采样 ---');
    console.log(JSON.stringify(skin));
    await shoot('transition-mid.png');
    const midway = await evaluate(`(() => {
      const title = document.querySelector('.blog-detail-title');
      return {
        path: location.pathname,
        clicks: window.__clicks,
        downs: window.__downs,
        state: window.__jb ? window.__jb.state() : null,
        running: document.getAnimations().filter((a) => a.playState === 'running').length,
        detailBlocks: document.querySelectorAll('.blog-detail.is-reveal > *').length,
        delays: [...document.querySelectorAll('.blog-detail.is-reveal > *')].slice(0, 4)
          .map((el) => getComputedStyle(el).animationDelay),
        revealZero: [...document.querySelectorAll('.blog-detail.is-reveal .blog-detail-content > * > *')]
          .filter((el) => getComputedStyle(el).animationDelay === '0s').length,
        titleOpacity: title ? getComputedStyle(title).opacity : null,
      };
    })()`);
    console.log('--- 点开后 ~0.7s（动画 4 倍慢速） ---');
    console.log(JSON.stringify(midway));
    await shoot('detail-mid.png');
    await sleep(6000);
    const settled = await evaluate(`(() => {
      const hero = document.querySelector('.bd-cover .bd-media img');
      return {
        path: location.pathname,
        vt: window.__vt,
        titleOpacity: document.querySelector('.blog-detail-title') ? getComputedStyle(document.querySelector('.blog-detail-title')).opacity : null,
        heroLoaded: !!document.querySelector('.bd-cover .bd-media img.loaded'),
        heroSrc: hero ? hero.currentSrc || hero.src : null,
        // 封面走的是**压缩图**（和列表同一张 URL，缓存命中、秒出）。
        // 之前这里断言"详情用原图"：原图是另一个 URL，一打开就冷启动下十几 MB 的 PNG，
        // 真实网络下表现成"封面半天出不来"。新版面里封面最宽 ~478px，用压缩图足够。
        heroSrcCompressed: /_compressed/.test(hero?.currentSrc || hero?.src || ''),
        carouselHasFullSrc: !!document.querySelector('.jb-carousel img[data-full-src]'),
        running: document.getAnimations().filter((a) => a.playState === 'running').length,
      };
    })()`);
    console.log('--- 详情页落定 ---');
    console.log(JSON.stringify(settled, null, 2));
    // 封面有没有被裁剪 / 拉伸：等**封面自己报出"已就位"**（data-settled，由 GSAP
    // 的 onComplete 挂上）之后再量，不靠猜时长。
    const crop = await evaluate(`new Promise((resolve) => {
      let n = 0;
      const tick = () => {
        const box = document.querySelector('.bd-cover .bd-media');
        const img = box?.querySelector('img');
        if ((box && box.querySelector('.bd-media__inner')?.dataset.settled === '1' && img) || n > 90) {
          if (!img || !box) return resolve(null);
          const r = img.getBoundingClientRect();
          const br = box.getBoundingClientRect();
          return resolve({
            natural: [img.naturalWidth, img.naturalHeight],
            naturalRatio: +(img.naturalWidth / img.naturalHeight).toFixed(3),
            imgRatio: +(r.width / r.height).toFixed(3),
            boxRatio: +(br.width / br.height).toFixed(3),
            fit: getComputedStyle(img).objectFit,
            boxW: Math.round(br.width),
            boxH: Math.round(br.height),
            inlineStyle: box.getAttribute('style') || '',
          });
        }
        n += 1;
        requestAnimationFrame(tick);
      };
      tick();
    })`);
    console.log('--- 封面裁剪检查 ---');
    console.log(JSON.stringify(crop));
    await shoot('detail.png');
    console.log('--- 返回列表（浏览器后退） ---');
    await send('Animation.setPlaybackRate', { playbackRate: 1 });
    await evaluate(`history.back()`);
    await sleep(2500);
    const backState = await evaluate(`(() => {
      const root = document.querySelector('.jb-carousel');
      return {
        path: location.pathname,
        carousel: !!root,
        cards: root ? root.querySelectorAll('.jb-card').length : 0,
        tilted: root ? [...root.querySelectorAll('.jb-card')].filter((c) => c.style.transform).length : 0,
        brandPresent: !!document.querySelector('.brand'),
      };
    })()`);
    console.log(JSON.stringify(backState));

    // 换一篇竖幅的再点一次：封面不能因为比例不同就被裁掉/变形
    //（shoot 只截当前视口，所以这一轮只量数据）
    // ⚠ 挑"当前落在视口里"的那张：轨道为无限循环铺了三份，写死的 all[1] 在屏幕外，
    // 点下去等于点空（合成点击的坐标必须落在可见区域）。
    const second = await evaluate(`(async () => {
      const root = document.querySelector('.jb-carousel');
      const all = [...document.querySelectorAll('.jb-card')];
      const mid = root.scrollLeft + root.clientWidth / 2;
      const near = (el) => Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
      const pick = all.filter((el) => { const r = el.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth; }).sort((a, b) => near(a) - near(b))[1] || all[1];
      const r = pick.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), slug: pick.querySelector('.jb-title')?.textContent?.trim() };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: second.x, y: second.y });
    await sleep(60);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: second.x, y: second.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: second.x, y: second.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(2200);
    const crop2 = await evaluate(`(() => {
      const img = document.querySelector('.bd-cover .bd-media img');
      if (!img) return { path: location.pathname, img: false };
      const r = img.getBoundingClientRect();
      return {
        path: location.pathname,
        naturalRatio: +(img.naturalWidth / img.naturalHeight).toFixed(3),
        renderedRatio: +(r.width / r.height).toFixed(3),
        fit: getComputedStyle(img).objectFit,
        boxH: Math.round(r.height),
        viewportH: window.innerHeight,
      };
    })()`);
    console.log('--- 第二篇（' + second.slug + '）封面 ---');
    console.log(JSON.stringify(crop2));
    await shoot('detail-2.png');

    // 详情页里翻篇：**页面上没有可见控件**（左键 / 横滑，探针直接调业务函数）。
    // 用 __bd.go 而不是合成点击：这条路没有可点的 DOM，合成事件无从下手。
    const before2 = await evaluate(`({ path: location.pathname, title: document.querySelector('.blog-detail-title')?.textContent })`);
    const arrow = await evaluate(`(() => ({ via: '__bd.go(1)', ok: !!window.__bd?.go }))()`);
    console.log('--- 翻篇方式 ---', JSON.stringify(arrow));
    if (arrow?.ok) {
      await evaluate(`window.__bd.go(1)`);
      await sleep(2200);
      const after2 = await evaluate(`new Promise((resolve) => {
        let n = 0;
        const tick = () => {
          const box = document.querySelector('.bd-cover .bd-media');
          const img = box?.querySelector('img');
          if ((box && box.querySelector('.bd-media__inner')?.dataset.settled === '1' && img && img.classList.contains('loaded')) || n > 90) {
            return resolve({
              path: location.pathname,
              title: document.querySelector('.blog-detail-title')?.textContent,
              imgLoaded: !!img?.classList.contains('loaded'),
              src: img?.getAttribute('src') || null,
              ratio: img ? +(img.naturalWidth / img.naturalHeight).toFixed(3) : null,
            });
          }
          n += 1;
          requestAnimationFrame(tick);
        };
        tick();
      })`);
      console.log('--- 翻篇：' + before2.title + ' → ' + JSON.stringify(after2));
      if (after2.path === before2.path) failures.push('  FAIL 详情页翻篇没有换篇');
      await shoot('detail-3.png');
    }
    // ⚠ 只 back 一次：详情页翻篇走的是 router.replace（不往历史里堆文章），
    // 所以「返回」一步就回到列表。多按一次会直接退出站点，后面所有断言都拿不到元素。
    await evaluate(`history.back()`);
    await sleep(2500);
    await evaluate(`() => new Promise((r) => { if (document.querySelector('.jb-carousel')) r(1); else setTimeout(() => r(1), 800); })()`);

    // 移动端
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(900);
    const mobile = await evaluate(`(() => {
      const root = document.querySelector('.jb-carousel');
      const cards = root.querySelectorAll('.jb-card');
      return { cardW: Math.round(cards[0].getBoundingClientRect().width), overflowX: Math.round(root.scrollWidth - root.clientWidth), docOverflowY: Math.round(document.documentElement.scrollHeight - window.innerHeight), wmH: Math.round(document.querySelector('.jb-wordmark').offsetHeight) };
    })()`);
    console.log('--- 移动 390x844 ---');
    console.log(JSON.stringify(mobile));
    await shoot('mobile.png');

    console.log('--- console / network 问题 ---');
    console.log(errors.length ? errors.slice(0, 25).join('\n') : '(无)');
    console.log('--- 截图 ---');
    console.log(
      ['desktop.png', 'desktop-hover.png', 'desktop-dragged.png', 'desktop-wheeled.png', 'detail-mid.png', 'detail.png', 'mobile.png']
        .map((n) => path.join(outDir, n))
        .join('\n')
    );

    ws.close();
  } finally {
    child.kill();
    if (vite) vite.kill();
  }
}

const arg = process.argv[2];
if (!arg) await startVite();
await run(arg);
process.exit(0);
