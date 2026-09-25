// 阶段 3 验收：首页（hero + 随机画廊）在新旧两站上的结构一致性。
//
//   cd app && npm run build && npx vite preview --port 4174 --strictPort
//   node tools/verify-home.mjs http://localhost:8123/ http://localhost:4174/
//
// 首页画廊是**随机**的，所以不能比"哪 14 张"（两站抽签顺序不同），
// 而是比算法不变式：张数、ME/群组配比、栅格位置是否严格对应某套布局、
// 以及图片管线的最终类名状态（配合 --stub-images 让 CDN 图片可用）。
// 为让图片管线真的走完，这里自己也拦截 CDN 图片请求（见 injectImageStub）。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// 与 parity.mjs 里同一套：4x2 的 PNG（宽高比 2 → 触发 .wide）
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
    raw[y * stride] = 0;
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
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 与 app/src/data/homeLayouts.js 同一份数据，用于校验栅格位置
const { homeLayouts } = await import('../app/src/data/homeLayouts.js');

// 判断整份画廊签名是否严格对应**某一套**布局。
// 只比 inline 栅格位置：图片管线会往同一个元素上加 .wide/.tall，被加的 .wide 与
// 布局本身的 .wide 在 class 上无法区分，所以拿位置（列、行、是否跨 2）来判定，
// 这在四套布局里是唯一的。做法是对每一项求"可能的布局集合"再取交集。
function commonLayout(signature) {
  let candidates = homeLayouts.map((_, i) => i);
  for (const item of signature) {
    const mine = [];
    homeLayouts.forEach((layout, li) => {
      const pos = layout[item.index];
      if (!pos) return;
      const col = pos.layout === 'wide' || pos.layout === 'big' ? `${pos.col} / span 2` : String(pos.col);
      const row = pos.layout === 'big' ? `${pos.row} / span 2` : String(pos.row);
      if (item.gridColumn === col && item.gridRow === row) mine.push(li);
    });
    candidates = candidates.filter((c) => mine.includes(c));
  }
  return candidates;
}

const PROBE = `(function () {
  var items = Array.prototype.slice.call(document.querySelectorAll('#galleryGrid .gallery-item'));
  var layoutIdx = null;
  var signature = items.map(function (el, i) {
    var img = el.querySelector('img');
    return {
      index: i,
      gridColumn: el.style.gridColumn,
      gridRow: el.style.gridRow,
      cls: el.className.replace('gallery-item', '').replace('has-image', '').replace('wide', '').replace('tall', '').replace('visible', '').trim(),
      hasImage: el.classList.contains('has-image'),
      isWide: el.classList.contains('wide'),
      isTall: el.classList.contains('tall'),
      imgLoaded: img ? img.classList.contains('loaded') : false,
      imgSrc: img ? decodeURIComponent(img.getAttribute('src') || '') : '',
      dataSrc: img ? decodeURIComponent(img.getAttribute('data-src') || '') : '',
      dataFullSrc: img ? decodeURIComponent(img.getAttribute('data-full-src') || '') : ''
    };
  });
  var heroImg = document.querySelector('.hero-image .hero-img');
  var heroSkeleton = document.querySelector('.hero-image .skeleton-loader');
  return JSON.stringify({
    count: items.length,
    sectionCountText: (document.querySelector('.gallery-section .section-count') || {}).textContent,
    signature: signature,
    hero: {
      loaded: heroImg ? heroImg.classList.contains('loaded') : false,
      active: heroImg ? heroImg.classList.contains('active') : false,
      blurPlaceholder: heroImg ? heroImg.classList.contains('blur-placeholder') : null,
      skeletonHidden: heroSkeleton ? heroSkeleton.classList.contains('hidden') : null
    }
  });
})()`;

async function probe(url) {
  const port = 9900 + Math.floor(Math.random() * 40);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-prof-'));
  const child = spawn(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
     '--no-first-run', '--disable-gpu', '--disable-extensions', '--hide-scrollbars', '--window-size=1440,1200', 'about:blank'],
    { stdio: 'ignore' }
  );
  try {
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch {}
      if (!ready) await sleep(250);
    }
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
      if (r.exceptionDetails) throw new Error('求值失败 ' + JSON.stringify(r.exceptionDetails).slice(0, 200));
      return r.result.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });

    // 拦截 CDN 图片，就地应答
    const body = makePng(4, 2, [122, 124, 132]).toString('base64');
    const imageRequests = [];
    on('Network.requestWillBeSent', (p) => {
      if (p.type === 'Image') imageRequests.push(p.request.url);
    });
    await send('Fetch.enable', { patterns: [{ urlPattern: 'https://img.liveinpassion.me/*' }] });
    on('Fetch.requestPaused', async (p) => {
      try {
        await send('Fetch.fulfillRequest', {
          requestId: p.requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'image/png' }, { name: 'Cache-Control', value: 'no-store' }],
          body,
        });
      } catch {}
    });

    const loaded = new Promise((res) => on('Page.loadEventFired', res));
    await send('Page.navigate', { url });
    await Promise.race([loaded, sleep(10000)]);
    await sleep(3200); // 等加载器与图片管线跑完

    const data = JSON.parse(await evaluate(PROBE));

    // 交互：点第 3 张 → 灯箱应打开且指向该图的原图
    // 注意：新站的 <img :src> 由 Vue 更新，点击后要等一次重渲染才能读到新值；
    // 旧站是同步写 src，直接读也行——所以这里统一先点、等一下、再读。
    const expectedSrc = await evaluate(
      `decodeURIComponent(document.querySelectorAll('#galleryGrid .gallery-item')[2].querySelector('img').getAttribute('data-full-src'))`
    );
    await evaluate(`document.querySelectorAll('#galleryGrid .gallery-item')[2].click(); 1`);
    await sleep(300);
    const lightbox = JSON.parse(await evaluate(`JSON.stringify({
      active: document.getElementById('lightbox').classList.contains('active'),
      src: decodeURIComponent(document.getElementById('lightboxImg').getAttribute('src') || ''),
      expected: ${JSON.stringify(expectedSrc)}
    })`));
    // 右键翻页 + Esc 关闭
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); 1`);
    await sleep(300);
    const afterArrow = JSON.parse(await evaluate(`JSON.stringify({
      src: decodeURIComponent(document.getElementById('lightboxImg').getAttribute('src') || ''),
      expected: decodeURIComponent(document.querySelectorAll('#galleryGrid .gallery-item')[3].querySelector('img').getAttribute('data-full-src'))
    })`));
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 1`);
    await sleep(250);
    const closed = await evaluate(`document.getElementById('lightbox').classList.contains('active')`);

    ws.close();
    return { data, imageRequests, lightbox, afterArrow, closed };
  } finally {
    child.kill();
    await sleep(300);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
}

const results = [];
const check = (label, legacyOk, appOk, detail = '') => {
  results.push({ label, legacyOk, appOk });
  const mark = (v) => (v === true ? '✓' : v === false ? '✗' : String(v));
  console.log(`  legacy ${mark(legacyOk).padEnd(3)} app ${mark(appOk).padEnd(3)}  ${label}${detail ? '  ' + detail : ''}`);
};

(async () => {
  const legacyUrl = process.argv[2] || 'http://localhost:8123/';
  const appUrl = process.argv[3] || 'http://localhost:4174/';
  console.log('采集旧站…');
  const legacy = await probe(legacyUrl);
  console.log('采集新站…\n');
  const app = await probe(appUrl);

  const s = (r) => r.data.signature;
  const layoutOk = (r) => commonLayout(r.data.signature).length === 1;

  // 只统计"就是这 14 张画廊图"的请求：旧站页面里还预加载了 /gallery 的 5 张精选图
  //（也在 /group_photos/ 下），按 URL 归属于画廊项来过滤才不会把它们算进来
  const itemUrls = (r) =>
    new Set(
      r.data.signature
        .flatMap((it) => [it.dataSrc, it.dataFullSrc])
        .filter(Boolean)
        .map((u) => decodeURIComponent(u))
    );
  const galleryRequests = (r) => r.imageRequests.map((u) => decodeURIComponent(u)).filter((u) => itemUrls(r).has(u));
  // 按文档顺序，每一项的首个请求应依次出现（验证分批没有打乱顺序）
  const inDocumentOrder = (r) => {
    const reqs = galleryRequests(r);
    let cursor = -1;
    for (const item of r.data.signature) {
      const at = reqs.indexOf(item.dataFullSrc);
      if (at === -1 || at < cursor) return false;
      cursor = at;
    }
    return true;
  };

  console.log('画廊结构:');
  check('项数 14', legacy.data.count === 14, app.data.count === 14, `legacy=${legacy.data.count} app=${app.data.count}`);
  check(
    'section-count 文案',
    legacy.data.sectionCountText === '14 Images',
    app.data.sectionCountText === '14 Images',
    `legacy="${legacy.data.sectionCountText}" app="${app.data.sectionCountText}"`
  );
  const meCount = (r) => s(r).filter((it) => it.dataFullSrc.includes('/Me/')).length;
  const groupCount = (r) => s(r).filter((it) => it.dataFullSrc.includes('/group_photos/')).length;
  check('ME(12) + 群组(2) 配比', meCount(legacy) === 12 && groupCount(legacy) === 2, meCount(app) === 12 && groupCount(app) === 2, `legacy=${meCount(legacy)}+${groupCount(legacy)} app=${meCount(app)}+${groupCount(app)}`);
  check(
    '整份画廊严格对应同一套布局',
    layoutOk(legacy),
    layoutOk(app),
    `legacy=布局${commonLayout(legacy.data.signature)} app=布局${commonLayout(app.data.signature)}`
  );
  // 这里两站的**期望值不同**，是有意改动：
  //   旧站 = 压缩图 + 原图两级加载，每张 2 个请求；新站 = 只加载原图，每张 1 个请求
  const perItem = (r) => (galleryRequests(r).length / r.data.count).toFixed(2);
  check(
    '每张图的请求数（旧站应 2.00，新站应 1.00）',
    perItem(legacy) === '2.00',
    perItem(app) === '1.00',
    `legacy=${perItem(legacy)} app=${perItem(app)}`
  );
  check(
    '新站不再引用任何压缩图地址',
    true,
    s(app).every((it) => !it.dataSrc && !it.dataFullSrc.includes('_compressed')),
    '（旧站标记里仍带 data-src 压缩图，这是已知差异）'
  );
  check(
    '画廊请求按文档顺序发起',
    inDocumentOrder(legacy),
    inDocumentOrder(app),
    `legacy ${galleryRequests(legacy).length} 个 / app ${galleryRequests(app).length} 个（共 ${legacy.imageRequests.length} vs ${app.imageRequests.length}，含其它图片）`
  );

  console.log('\n图片管线终态（CDN 已用 4x2 PNG 顶替，宽高比 2 应触发 .wide）:');
  const all = (r, f) => r.data.signature.every(f);
  check('每项父元素有 .has-image', all(legacy, (it) => it.hasImage), all(app, (it) => it.hasImage));
  check('每张 img 有 .loaded', all(legacy, (it) => it.imgLoaded), all(app, (it) => it.imgLoaded));
  check('宽高比 2 触发 .wide', all(legacy, (it) => it.isWide), all(app, (it) => it.isWide));

  console.log('\nhero:');
  check(
    'img 已加 .loaded + .active',
    legacy.data.hero.loaded && legacy.data.hero.active,
    app.data.hero.loaded && app.data.hero.active,
    `legacy loaded=${legacy.data.hero.loaded} active=${legacy.data.hero.active} / app loaded=${app.data.hero.loaded} active=${app.data.hero.active}`
  );
  check('骨架屏已隐藏', legacy.data.hero.skeletonHidden === true, app.data.hero.skeletonHidden === true);

  console.log('\n灯箱交互:');
  check('点第 3 张 → 打开且指向该图原图', legacy.lightbox.active && legacy.lightbox.src === legacy.lightbox.expected, app.lightbox.active && app.lightbox.src === app.lightbox.expected);
  check('→ 键翻到第 4 张', legacy.afterArrow.src === legacy.afterArrow.expected, app.afterArrow.src === app.afterArrow.expected);
  check('Esc 关闭', legacy.closed === false, app.closed === false);

  const bad = results.filter((r) => r.legacyOk !== true || r.appOk !== true);
  console.log(`\n结果: ${results.length - bad.length}/${results.length} 两站均通过`);
  if (bad.length) {
    console.log('未通过项:');
    for (const b of bad) console.log(`  - ${b.label} legacy=${b.legacyOk} app=${b.appOk}`);
    process.exit(1);
  }
})().catch((e) => {
  console.error('验收失败: ' + e.message);
  process.exit(1);
});
