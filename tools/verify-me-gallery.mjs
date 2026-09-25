// 阶段 5b 验收：ME 相册（月份标签 / 网格内容 / 按可见性加载 / 单图灯箱）。
//
//   python -m http.server 8123        # 旧站（仓库根）
//   cd app && npm run build && npx vite preview --port 4174 --strictPort
//   node tools/verify-me-gallery.mjs
//
// 两站的进入方式不同：旧站的网格只由 ME 页的 GALLERY 磁贴触发构建（navigateTo('me-gallery')
// 本身不建网格），新站是直接走路由 /me/gallery。所以两边都用"点击磁贴"这条用户路径。
//
// 按可见性加载是本次的有意差异：旧站进页面就把当月照片分批全发（4 张/300ms），
// 新站只请求视口内的。所以"初始请求数"这条断言两站期望值不同，但"滚到底后全部加载"
// 两站都必须成立。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const LEGACY = process.argv[2] || 'http://localhost:8123/';
const APP = process.argv[3] || 'http://localhost:4174/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c; }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
function makePng(w, h, rgb) {
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; for (let x = 0; x < w; x++) { const o = y * stride + 1 + x * 3; raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; } }
  const chunk = (t, d) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const tb = Buffer.from(t, 'ascii'); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([tb, d])));
    return Buffer.concat([len, tb, d, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const GRID = `(function () {
  var items = Array.prototype.slice.call(document.querySelectorAll('.me-gallery-item'));
  var btns = Array.prototype.slice.call(document.querySelectorAll('.me-gallery-month-btn'));
  return JSON.stringify({
    months: btns.map(function (b) { return b.textContent.trim(); }),
    activeMonth: (btns.filter(function (b) { return b.classList.contains('active'); })[0] || {}).textContent || null,
    count: items.length,
    dates: items.slice(0, 5).map(function (i) { return (i.querySelector('.me-gallery-date') || {}).textContent; }),
    srcs: items.map(function (i) { var im = i.querySelector('img'); return im ? decodeURIComponent(im.getAttribute('data-full-src') || '') : null; }),
    loadedCount: items.filter(function (i) { return i.classList.contains('has-image'); }).length,
    bodyOverflow: document.body.style.overflow
  });
})()`;

async function withPage(url, fn) {
  const port = 9500 + Math.floor(Math.random() * 90);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meg-'));
  const child = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--no-first-run', '--disable-gpu', '--disable-extensions', '--hide-scrollbars', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
  try {
    let ok = false;
    for (let i = 0; i < 80 && !ok; i++) { try { ok = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch {} if (!ok) await sleep(250); }
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    let id = 0;
    const pending = new Map();
    const handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
      else if (m.method && handlers.has(m.method)) for (const f of handlers.get(m.method)) f(m.params);
    });
    const send = (method, params = {}) => { const i = ++id; return new Promise((res, rej) => { pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); };
    const on = (m, f) => { if (!handlers.has(m)) handlers.set(m, []); handlers.get(m).push(f); };
    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('求值失败: ' + JSON.stringify(r.exceptionDetails).slice(0, 250));
      return r.result.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

    let meRequests = 0;
    on('Network.requestWillBeSent', (p) => {
      if (p.type === 'Image' && p.request.url.includes('/Me/')) meRequests++;
    });

    const png = makePng(4, 2, [122, 124, 132]).toString('base64');
    await send('Fetch.enable', { patterns: [{ urlPattern: 'https://img.liveinpassion.me/*' }] });
    on('Fetch.requestPaused', async (p) => {
      try {
        await send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/png' }], body: png });
      } catch {}
    });

    const loaded = new Promise((res) => on('Page.loadEventFired', res));
    await send('Page.navigate', { url });
    await Promise.race([loaded, sleep(10000)]);
    await sleep(2600);
    return await fn({ evaluate, getMeRequests: () => meRequests });
  } finally {
    child.kill();
    await sleep(300);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

const results = [];
const check = (label, legacyOk, appOk, detail = '') => {
  results.push({ label, legacyOk, appOk });
  const m = (v) => (v === true ? '✓' : v === false ? '✗' : String(v));
  console.log(`  legacy ${m(legacyOk).padEnd(3)} app ${m(appOk).padEnd(3)}  ${label}${detail ? '  ' + detail : ''}`);
};

// 旧站：进 ME 页 → 点 GALLERY 磁贴；新站：直接进 /me/gallery
async function collect(base, { legacy }) {
  return withPage(base, async ({ evaluate, getMeRequests }) => {
    if (legacy) {
      await evaluate(`navigateTo('me'); 1`);
      await sleep(600);
      await evaluate(`document.getElementById('meGalleryBtn').click(); 1`);
    } else {
      await evaluate(`document.querySelector('nav a[href="/me"]').click(); 1`);
      await sleep(500);
      await evaluate(`document.getElementById('meGalleryBtn').click(); 1`);
    }
    await sleep(1500);
    const grid = JSON.parse(await evaluate(GRID));
    const requestsAfterOpen = getMeRequests();

    // 滚到底：视口外的项这时才该加载
    await evaluate(`window.scrollTo(0, document.body.scrollHeight); 1`);
    await sleep(1500);
    await evaluate(`window.scrollTo(0, document.body.scrollHeight); 1`);
    await sleep(1500);
    const afterScroll = JSON.parse(await evaluate(GRID));
    const requestsAfterScroll = getMeRequests();

    // 切到第二个月份
    const secondMonth = await evaluate(`(function () {
      var btns = document.querySelectorAll('.me-gallery-month-btn');
      if (btns.length < 2) return null;
      btns[1].click();
      return btns[1].textContent.trim();
    })()`);
    await sleep(1200);
    const month2 = JSON.parse(await evaluate(GRID));

    // 点第一张照片 → 单图灯箱
    // 旧站的处理器绑在 <img> 上，新站绑在条目 div 上——点 img 两边都能触发（事件会冒泡）
    await evaluate(`document.querySelectorAll('.me-gallery-item')[0].querySelector('img').click(); 1`);
    await sleep(900);
    const lightbox = JSON.parse(await evaluate(`JSON.stringify({
      active: (document.getElementById('mePhotoLightbox') || { classList: { contains: function () { return false; } } }).classList.contains('active'),
      fullSrc: decodeURIComponent((document.querySelector('.me-photo-lightbox-full') || {}).src || ''),
      hasThumb: !!document.querySelector('.me-photo-lightbox-thumb'),
      thumbActive: !!(document.querySelector('.me-photo-lightbox-thumb') || {}).classList && document.querySelector('.me-photo-lightbox-thumb').classList.contains('active'),
      bodyOverflow: document.body.style.overflow
    })`));
    // Esc 不应关闭（旧版单图灯箱没有键盘响应）
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 1`);
    await sleep(300);
    const stillOpen = await evaluate(`!!(document.getElementById('mePhotoLightbox') || {}).classList && document.getElementById('mePhotoLightbox').classList.contains('active')`);
    // 点遮罩关闭
    await evaluate(`(document.getElementById('mePhotoLightbox') || { click: function () {} }).click(); 1`);
    await sleep(400);
    const closed = await evaluate(`!!(document.getElementById('mePhotoLightbox') || {}).classList && document.getElementById('mePhotoLightbox').classList.contains('active')`);

    return { grid, month2, secondMonth, lightbox, stillOpen, closed, requestsAfterOpen, requestsAfterScroll, afterScroll };
  });
}

console.log('采集旧站…');
const legacy = await collect(LEGACY, { legacy: true });
console.log('采集新站…\n');
const app = await collect(APP, { legacy: false });

console.log('月份标签:');
check('月份标签集合与计数一致', legacy.grid.months.join('|') === app.grid.months.join('|'), legacy.grid.months.join('|') === app.grid.months.join('|'), `${app.grid.months.length} 个月，第一个 ${app.grid.months[0]}`);
check('默认选中最新月份', legacy.grid.activeMonth === app.grid.activeMonth, legacy.grid.activeMonth === app.grid.activeMonth, `"${app.grid.activeMonth}"`);

console.log('\n网格内容:');
check('条目数一致（当月张数）', legacy.grid.count === app.grid.count, legacy.grid.count === app.grid.count, `${app.grid.count} 张`);
check('前 5 个日期角标一致', legacy.grid.dates.join('|') === app.grid.dates.join('|'), legacy.grid.dates.join('|') === app.grid.dates.join('|'), app.grid.dates.slice(0, 3).join(' '));
check('图片地址（原图）与顺序一致', legacy.grid.srcs.join('|') === app.grid.srcs.join('|'), legacy.grid.srcs.join('|') === app.grid.srcs.join('|'), `${String(app.grid.srcs[0]).split('/').pop()}`);

console.log('\n按可见性加载（有意差异）:');
check('旧站进页面即全部请求', legacy.requestsAfterOpen >= legacy.grid.count, true, `legacy ${legacy.requestsAfterOpen} 个请求 / ${legacy.grid.count} 张`);
check('新站初始只请求可见部分', true, app.requestsAfterOpen < app.grid.count, `app 初始 ${app.requestsAfterOpen} 个请求 / ${app.grid.count} 张`);
check('滚到底后两站都全部加载', legacy.afterScroll.loadedCount === legacy.grid.count, app.afterScroll.loadedCount === app.grid.count, `legacy ${legacy.afterScroll.loadedCount} / app ${app.afterScroll.loadedCount} 张已加载`);

console.log('\n切换月份:');
check('切到第二个月后条目数变化且一致', legacy.month2.count === app.month2.count, legacy.month2.count === app.month2.count, `${app.secondMonth} → ${app.month2.count} 张`);
check('切换后选中态跟着变', legacy.month2.activeMonth === legacy.secondMonth, app.month2.activeMonth === app.secondMonth, `"${app.month2.activeMonth}"`);

console.log('\n单图灯箱:');
check('点击后打开', legacy.lightbox.active, app.lightbox.active);
check('显示的是原图', legacy.lightbox.fullSrc.includes('/Me/'), app.lightbox.fullSrc.includes('/Me/'), String(app.lightbox.fullSrc).split('/').pop());
check('Esc 不关闭（无键盘响应）', legacy.stillOpen === true, app.stillOpen === true);
check('点遮罩关闭', legacy.closed === false, app.closed === false);
check('不锁 body 滚动', legacy.lightbox.bodyOverflow === '', app.lightbox.bodyOverflow === '', `"${app.lightbox.bodyOverflow}"`);

const bad = results.filter((r) => r.legacyOk !== true || r.appOk !== true);
console.log(`\n结果: ${results.length - bad.length}/${results.length} 两站均通过`);
if (bad.length) {
  for (const b of bad) console.log(`  未通过: ${b.label} (legacy=${b.legacyOk} app=${b.appOk})`);
  process.exit(1);
}
