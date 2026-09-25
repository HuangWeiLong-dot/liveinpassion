// 新旧站点同路由对比工具。
//
// 为什么需要它：这次迁移的验收标准是"视觉与交互保持不变"，而仓库里没有任何测试设施。
// 这个脚本用无头 Chrome + CDP 驱动两个站点的同一个路由，在相同的随机种子下比较
// 图片请求顺序、DOM 快照、控制台报错，并输出截图供肉眼核对。
//
// 用法（两个站点各自起服务）：
//   # 旧站：仓库根（别用 8080——Steam 的 steamwebhelper 会占用它）
//   python -m http.server 8123
//   # 新站：app/ 构建产物
//   cd app && npm run build && npx vite preview --port 4174
//
//   # Git Bash 会把单独的 "/" 参数改写成 Windows 路径，必须关掉它的路径转换：
//   MSYS_NO_PATHCONV=1 node tools/parity.mjs --legacy http://localhost:8123 --app http://localhost:4174 \
//        --routes /,/blogs --out tools/parity-out
//
// 想让两站抽出完全相同的照片与布局（截图可逐格对照）时加 --random-const。
// 本机访问不到 img.liveinpassion.me 时加 --stub-images：用 CDP 把 CDN 图片就地应答成
// 一张 4x2 的 PNG（宽高比 2，会走到 .wide 分支），这样两站的图片管线都能跑完再对比。
//
// 旧站是单 URL 的 SPA，只有 "/" 一个真实地址，其它"页面"靠页内 navigateTo() 到达。
// 所以跨站对比要用映射文件描述"新站路径 ↔ 旧站页名"：
//   MSYS_NO_PATHCONV=1 node tools/parity.mjs --legacy ... --app ... \
//        --routes-file tools/parity-routes.json --out tools/parity-out
// 文件格式：[{ "appPath": "/blogs/dont-be-a-dick", "legacyPage": "blog-detail-4" }, ...]
//
// 产物：out/<target>/<width>/<route>.{html,png} 与 out/summary.json
//
// 注意：DOM 快照是原样保存的，不做容错归一化——新旧结构本来就不该逐字节相同
//（新站多一层 #app 包装、资源带哈希、样式合并成一个文件）。它服务于"看差异"，
// 不是自动判定器；自动化判定在每条路由的验收断言里单独做。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
];

// ---------- 参数 ----------
function parseArgs(argv) {
  const args = { widths: [1440, 375], settle: 2600, seed: 20260925, out: 'tools/parity-out' };
  let routeList = ['/'];
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === '--legacy') args.legacy = val;
    else if (key === '--app') args.app = val;
    else if (key === '--routes') routeList = val.split(',').map((s) => s.trim()).filter(Boolean);
    else if (key === '--routes-file') args.routesFile = val;
    else if (key === '--widths') args.widths = val.split(',').map(Number);
    else if (key === '--settle') args.settle = Number(val);
    else if (key === '--seed') args.seed = Number(val);
    else if (key === '--out') args.out = val;
    else if (key === '--random-const') args.randomConst = true;
    else if (key === '--stub-images') args.stubImages = true;
    else if (key === '--stub-images=false') args.stubImages = false;
  }
  if (!args.app && !args.legacy) {
    console.error('至少需要一个站点地址：--legacy <url> 和/或 --app <url>');
    process.exit(1);
  }

  if (args.routesFile) {
    const parsed = JSON.parse(fs.readFileSync(args.routesFile, 'utf8'));
    args.cases = parsed.map((entry) => ({
      label: entry.appPath,
      appPath: entry.appPath,
      legacyPage: entry.legacyPage || null,
    }));
  } else {
    args.cases = routeList.map((r) => ({ label: r, appPath: r, legacyPage: null }));
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 注入脚本：在页面脚本之前执行 ----------
// 1. 固定 Math.random，让随机布局/随机头像/随机歌都可比
//    两种固定方式：
//      seed  —— 同一个种子序列。注意两站消耗随机数的**顺序不同**（旧站解析期先建首页画廊，
//               新站先挑美德），所以同一种子抽到的并不是同一批数据，只能比结构不变式。
//      const —— 恒返回 0.5。所有"随机"结果都变成确定的第一个候选，两站因此抽出
//               **完全相同**的照片与布局，可以直接逐格比对截图与 DOM。
// 2. 记录图片请求顺序与页面报错
function injectionFor(seed, constRandom) {
  const randomImpl = constRandom
    ? 'Math.random = function () { return 0.5; };'
    : `var s = ${seed} >>> 0;
  Math.random = function () {           // mulberry32
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };`;
  return `
(function () {
  ${randomImpl}
  window.__parityImages = [];
  window.__parityErrors = [];
  window.addEventListener('error', function (e) {
    window.__parityErrors.push('error: ' + (e.message || e.type));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    window.__parityErrors.push('rejection: ' + String(e.reason));
  });
})();
`;
}

// ---------- 伪造 CDN 图片 ----------
// 本机常常访问不到 img.liveinpassion.me（外网被限制或 CDN 慢），
// 一旦图片拿不到，两站的图片管线都不会走完，视觉对比就失去意义。
// 用 CDP 的 Fetch 域把这些请求就地应答成一张固定尺寸的 PNG：
//   4x2 的图 → 宽高比 2 → 触发 .wide 分支（aspect-ratio > 1.5），两站走同一条路径。
let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function makePng(width, height, rgb) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // 过滤方式 none
    for (let x = 0; x < width; x++) {
      const off = y * stride + 1 + x * 3;
      raw[off] = rgb[0];
      raw[off + 1] = rgb[1];
      raw[off + 2] = rgb[2];
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 2; // 颜色类型：真彩色
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- CDP 小客户端 ----------
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method && this.handlers.has(msg.method)) {
        for (const fn of this.handlers.get(msg.method)) fn(msg.params);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
}

async function findChrome() {
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('找不到 Chrome，可用 CHROME_PATH 环境变量指定');
}

async function launchChrome({ stubImages = false } = {}) {
  const port = 9800 + Math.floor(Math.random() * 400);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-prof-'));
  const chrome = process.env.CHROME_PATH || (await findChrome());
  const child = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-extensions',
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) break;
    } catch {}
    await sleep(250);
    if (i === 99) throw new Error('Chrome 调试端口未就绪');
  }

  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });

  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Log.enable');

  if (stubImages) {
    const body = makePng(4, 2, [122, 124, 132]).toString('base64');
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://img.liveinpassion.me/*' }] });
    cdp.on('Fetch.requestPaused', async (p) => {
      try {
        await cdp.send('Fetch.fulfillRequest', {
          requestId: p.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'Content-Type', value: 'image/png' },
            { name: 'Cache-Control', value: 'no-store' },
          ],
          body,
        });
      } catch {
        // 请求可能已经取消/超时，忽略
      }
    });
  }

  return {
    cdp,
    async close() {
      try { ws.close(); } catch {}
      child.kill();
      // Chrome 被杀后配置目录偶尔仍被占用，删不掉就算了（位于系统临时目录）
      await sleep(300);
      try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
    },
  };
}

const slugify = (route) => (route === '/' ? 'root' : route.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, ''));

async function capture(cdp, { base, appPath, legacyPage, isLegacy, width, settle, outDir, label, seed, constRandom }) {
  const url = isLegacy && legacyPage ? base + '/' : base + appPath;
  const images = [];
  const errors = [];
  const onRequest = (p) => {
    if (p.type === 'Image' && p.request?.url) images.push(p.request.url);
  };
  const onConsole = (p) => {
    if (p.type === 'error') errors.push('console: ' + (p.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
  };
  const onException = (p) => errors.push('exception: ' + (p.exceptionDetails?.text || '') + ' ' + (p.exceptionDetails?.exception?.description || ''));
  const onLog = (p) => {
    if (p.entry?.level === 'error') errors.push('log: ' + p.entry.text);
  };

  cdp.on('Network.requestWillBeSent', onRequest);
  cdp.on('Runtime.consoleAPICalled', onConsole);
  cdp.on('Runtime.exceptionThrown', onException);
  cdp.on('Log.entryAdded', onLog);

  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: injectionFor(seed, constRandom) });

    const loaded = new Promise((res) => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.navigate', { url });
    await Promise.race([loaded, sleep(10000)]);

    // 旧站只有 "/" 一个真实地址，"页面"靠页内跳转到达
    if (isLegacy && legacyPage) {
      const nav = await cdp.send('Runtime.evaluate', {
        expression: `typeof navigateTo === 'function' ? (navigateTo(${JSON.stringify(legacyPage)}), 'ok') : 'navigateTo 不存在'`,
        returnByValue: true,
      });
      if (nav.result.value !== 'ok') throw new Error(`旧站页内跳转失败: ${nav.result.value}`);
    }

    await sleep(settle); // 等加载器隐藏（2500ms）与首轮图片批次跑完

    const dom = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        title: document.title,
        lang: document.documentElement.lang,
        htmlClass: document.documentElement.className,
        bodyClass: document.body.className,
        elementCount: document.getElementsByTagName('*').length,
        counts: (function () {
          var out = {};
          ['main','section','div','img','a','iframe','button','article','h1','h2','h3','p'].forEach(function (t) {
            out[t] = document.getElementsByTagName(t).length;
          });
          return out;
        })(),
        loaderHidden: !!(document.getElementById('loader') && document.getElementById('loader').classList.contains('hidden')),
        headerClass: (document.getElementById('header') || {}).className || null,
        pageErrors: window.__parityErrors || []
      })`,
      returnByValue: true,
    });

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const shotPath = path.join(outDir, `${width}`, `${slugify(label)}.png`);
    fs.mkdirSync(path.dirname(shotPath), { recursive: true });
    fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));

    // DOM 快照：去掉注入的 script，便于阅读
    const html = await cdp.send('Runtime.evaluate', {
      expression: `'<!DOCTYPE html>\\n' + document.documentElement.outerHTML.replace(/<script>[\\s\\S]*?mulberry32[\\s\\S]*?<\\/script>/, '<!-- parity injection removed -->')`,
      returnByValue: true,
    });
    fs.writeFileSync(path.join(outDir, `${width}`, `${slugify(label)}.html`), html.result.value);

    return {
      route: label,
      legacyPage: legacyPage || null,
      width,
      stats: JSON.parse(dom.result.value),
      consoleErrors: errors,
      imageCount: images.length,
      images,
      screenshot: shotPath,
    };
  } finally {
    cdp.handlers.set('Network.requestWillBeSent', []);
    cdp.handlers.set('Runtime.consoleAPICalled', []);
    cdp.handlers.set('Runtime.exceptionThrown', []);
    cdp.handlers.set('Log.entryAdded', []);
  }
}

// 图片路径比较时抹掉 CDN 主机与压缩目录差异以外的部分，只留下末段文件名，便于人读
const imageTail = (u) => {
  try {
    return decodeURIComponent(new URL(u).pathname).split('/').slice(-2).join('/');
  } catch {
    return u;
  }
};

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const outRoot = path.resolve(args.out);
  const targets = [];
  if (args.legacy) targets.push({ name: 'legacy', base: args.legacy.replace(/\/$/, '') });
  if (args.app) targets.push({ name: 'app', base: args.app.replace(/\/$/, '') });

  const { cdp, close } = await launchChrome({ stubImages: args.stubImages });
  const results = [];
  try {
    for (const target of targets) {
      for (const width of args.widths) {
        for (const c of args.cases) {
          const outDir = path.join(outRoot, target.name);
          const isLegacy = target.name === 'legacy';
          const url = isLegacy && c.legacyPage ? target.base + '/' : target.base + c.appPath;
          const how = isLegacy && c.legacyPage ? `（页内 navigateTo('${c.legacyPage}')）` : '';
          process.stdout.write(`→ ${target.name} ${width}px ${c.label}${how}\n`);
          const r = await capture(cdp, {
            base: target.base,
            appPath: c.appPath,
            legacyPage: c.legacyPage,
            isLegacy,
            width,
            settle: args.settle,
            outDir,
            label: c.label,
            seed: args.seed,
            constRandom: args.randomConst,
          });
          results.push({ target: target.name, ...r, url });
        }
      }
    }
  } finally {
    await close();
  }

  fs.mkdirSync(outRoot, { recursive: true });
  fs.writeFileSync(path.join(outRoot, 'summary.json'), JSON.stringify(results, null, 2));

  // ---------- 汇总 ----------
  console.log('\n================ 汇总 ================');
  for (const width of args.widths) {
    console.log(`\n--- 视口宽度 ${width}px ---`);
    const routes = [...new Set(results.map((r) => r.route))];
    for (const route of routes) {
      const row = results.filter((r) => r.route === route && r.width === width);
      const legacy = row.find((r) => r.target === 'legacy');
      const app = row.find((r) => r.target === 'app');
      console.log(`\n${route}`);
      for (const r of row) {
        console.log(
          `  ${r.target.padEnd(7)} 元素 ${String(r.stats.elementCount).padStart(6)}  图片 ${String(r.imageCount).padStart(3)}  ` +
            `报错 ${r.consoleErrors.length}  加载器已隐藏 ${r.stats.loaderHidden}  html.class="${r.stats.htmlClass}"`
        );
        if (r.consoleErrors.length) {
          for (const e of r.consoleErrors.slice(0, 5)) console.log(`      ! ${e}`);
        }
      }
      if (legacy && app) {
        const sameOrder = JSON.stringify(legacy.images.map(imageTail)) === JSON.stringify(app.images.map(imageTail));
        console.log(`  图片请求顺序一致: ${sameOrder ? '是' : '否'}`);
        if (!sameOrder) {
          console.log(`    legacy: ${legacy.images.map(imageTail).slice(0, 8).join(' | ')}`);
          console.log(`    app   : ${app.images.map(imageTail).slice(0, 8).join(' | ')}`);
        }
      }
    }
  }
  console.log(`\n产物目录: ${outRoot}`);
})().catch((err) => {
  console.error('对比失败: ' + err.message);
  process.exit(1);
});
