// 阶段 6 验收：GALLERY 页（精选轮播 + 好友跑马灯）、好友详情、群组照片时间线。
//
//   python -m http.server 8123        # 旧站（仓库根）
//   cd app && npm run build && npx vite preview --port 4174 --strictPort
//   node tools/verify-gallery.mjs
//
// 新站用 history.pushState + popstate 驱动路由（vue-router 监听 popstate），
// 旧站用页内的 navigateTo()。两边的图片请求都用 CDP 伪造。
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

const ACTIVE = `var ROOT = document.querySelector('main.page.active') || document;`;
const GALLERY = `(function () {
  ${ACTIVE}  var imgs = Array.prototype.slice.call(ROOT.querySelectorAll('.gallery-featured-image .group-featured-img'));
  var cards = Array.prototype.slice.call(ROOT.querySelectorAll('.friend-card'));
  var left = document.getElementById('friendsScrollLeft');
  var right = document.getElementById('friendsScrollRight');
  return JSON.stringify({
    featuredCount: imgs.length,
    featuredActive: imgs.filter(function (i) { return i.classList.contains('active'); }).length,
    featuredLoaded: imgs.filter(function (i) { return i.classList.contains('loaded'); }).length,
    featuredSrcs: imgs.map(function (i) { return i.getAttribute('src') ? decodeURIComponent(i.getAttribute('src')).split('/').pop() : null; }),
    overlayTitle: (ROOT.querySelector('.gallery-featured-overlay h3') || {}).textContent || null,
    overlayCount: (ROOT.querySelector('.gallery-featured-count') || {}).textContent || null,
    cardCount: cards.length,
    names: cards.map(function (c) { return (c.querySelector('.friend-name') || {}).textContent; }),
    counts: cards.map(function (c) { return (c.querySelector('.friend-photo-count') || {}).textContent.replace(/\\s+/g, ' ').trim(); }),
    placeholders: cards.filter(function (c) { return c.querySelector('.friend-placeholder'); }).length,
    avatarSrcs: cards.map(function (c) { var im = c.querySelector('img'); return im ? decodeURIComponent(im.getAttribute('data-src') || '').split('/').slice(-2).join('/') : null; }),
    leftHidden: left ? left.classList.contains('hidden') : null,
    rightHidden: right ? right.classList.contains('hidden') : null,
    scrollMax: (function () { var s = document.getElementById('friendsScrollContainer'); return s ? s.scrollWidth - s.clientWidth : null; })()
  });
})()`;

const TIMELINE = `(function () {
  ${ACTIVE}  var items = Array.prototype.slice.call(ROOT.querySelectorAll('.timeline-photo-item'));
  return JSON.stringify({
    title: (ROOT.querySelector('.hero-title') || {}).textContent,
    count: (ROOT.querySelector('.photo-count .count-number') || {}).textContent,
    containerId: (ROOT.querySelector('.timeline-container') || {}).id,
    years: Array.prototype.map.call(ROOT.querySelectorAll('.timeline-year-title'), function (e) { return e.textContent; }),
    months: Array.prototype.map.call(ROOT.querySelectorAll('.timeline-month-title'), function (e) { return e.textContent; }),
    itemCount: items.length,
    dividersPerYear: ROOT.querySelectorAll('.timeline-year').length,
    markers: ROOT.querySelectorAll('.timeline-month-marker').length,
    firstSrcs: items.slice(0, 4).map(function (i) { var im = i.querySelector('img'); return im ? decodeURIComponent(im.getAttribute('data-full-src') || '').split('/').pop() : null; }),
    loadedCount: items.filter(function (i) { return i.classList.contains('has-image'); }).length
  });
})()`;

async function withPage(url, fn) {
  const port = 9400 + Math.floor(Math.random() * 90);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gal-'));
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
      if (r.exceptionDetails) throw new Error('求值失败: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 250));
      return r.result.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

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
    return await fn({ evaluate });
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

// 新站用 pushState + popstate 驱动 vue-router；旧站用 navigateTo，但旧站要的是**页名**
//（gallery / friend-lijiazu / friend-groupphotos），不是新站的 URL 路径
const LEGACY_PAGE = {
  '/gallery': 'gallery',
  '/group-photos': 'friend-groupphotos',
  '/friends/lijiazu': 'friend-lijiazu',
  '/friends/hanyong': 'friend-hanyong',
};
const go = (path, legacy) =>
  legacy
    ? `navigateTo(${JSON.stringify(LEGACY_PAGE[path] || path)}); 1`
    : `history.pushState({}, '', ${JSON.stringify(path)}); window.dispatchEvent(new PopStateEvent('popstate')); 1`;

async function collect(base, { legacy }) {
  return withPage(base, async ({ evaluate }) => {
    // ---- GALLERY 页 ----
    await evaluate(go('/gallery', legacy));
    await sleep(1800);
    const galleryInit = JSON.parse(await evaluate(GALLERY));

    // 滚到最右端，看右箭头是否隐藏
    // 容器的 CSS 里有 scroll-behavior: smooth，直接赋 scrollLeft 是动画过去的，
    // 立刻读还是旧位置——所以要等动画结束，再补一次 scroll 事件触发重新评估
    await evaluate(`(function () { var s = document.getElementById('friendsScrollContainer'); s.scrollTo({ left: s.scrollWidth, behavior: 'instant' }); return 1; })()`);
    await sleep(700);
    await evaluate(`document.getElementById('friendsScrollContainer').dispatchEvent(new Event('scroll')); 1`);
    await sleep(500);
    const galleryScrolled = JSON.parse(await evaluate(GALLERY));
    // 滚回最左
    await evaluate(`(function () { var s = document.getElementById('friendsScrollContainer'); s.scrollLeft = 0; s.dispatchEvent(new Event('scroll')); return 1; })()`);
    await sleep(400);

    // ---- 好友详情 ----
    await evaluate(go('/friends/lijiazu', legacy));
    await sleep(1500);
    const friend = JSON.parse(await evaluate(TIMELINE));

    // 点第 3 张 → 灯箱应指向**原始列表**里对应的那张
    const clickResult = JSON.parse(await evaluate(`(function () {
      var items = (document.querySelector('main.page.active') || document).querySelectorAll('.timeline-photo-item');
      var target = items[2];
      var expected = decodeURIComponent(target.querySelector('img').getAttribute('data-full-src'));
      target.click();
      return JSON.stringify({ expected: expected });
    })()`));
    await sleep(700);
    const lightboxSrc = await evaluate(`decodeURIComponent((document.getElementById('lightboxImg') || {}).getAttribute('src') || '')`);
    const lightboxOpen = await evaluate(`document.getElementById('lightbox').classList.contains('active')`);

    // 滚到底，确认时间线图片最终都加载
    await evaluate(`window.scrollTo(0, document.body.scrollHeight); 1`);
    await sleep(1600);
    await evaluate(`window.scrollTo(0, document.body.scrollHeight); 1`);
    await sleep(1600);
    const friendScrolled = JSON.parse(await evaluate(TIMELINE));
    await evaluate(`window.scrollTo(0, 0); 1`);

    // ---- 群组照片 ----
    await evaluate(go('/group-photos', legacy));
    await sleep(1500);
    const group = JSON.parse(await evaluate(TIMELINE));

    // ---- 没有照片的好友 ----
    await evaluate(go('/friends/hanyong', legacy));
    await sleep(1200);
    const hanyong = JSON.parse(await evaluate(TIMELINE));

    return { galleryInit, galleryScrolled, friend, friendScrolled, group, hanyong, clickResult, lightboxSrc, lightboxOpen };
  });
}

console.log('采集旧站…');
const legacy = await collect(LEGACY, { legacy: true });
console.log('采集新站…\n');
const app = await collect(APP, { legacy: false });

console.log('GALLERY 页:');
check('精选图 5 张', legacy.galleryInit.featuredCount === 5, app.galleryInit.featuredCount === 5);
check('同一时刻只有一张 active', legacy.galleryInit.featuredActive === 1, app.galleryInit.featuredActive === 1, `app active=${app.galleryInit.featuredActive}`);
check('5 张都加载完成', legacy.galleryInit.featuredLoaded === 5, app.galleryInit.featuredLoaded === 5, `app loaded=${app.galleryInit.featuredLoaded}`);
check('精选图文件名与旧站一致', legacy.galleryInit.featuredSrcs.join('|') === app.galleryInit.featuredSrcs.join('|'), legacy.galleryInit.featuredSrcs.join('|') === app.galleryInit.featuredSrcs.join('|'), app.galleryInit.featuredSrcs.join(' '));
check('浮层标题与计数一致', legacy.galleryInit.overlayTitle === app.galleryInit.overlayTitle && legacy.galleryInit.overlayCount === app.galleryInit.overlayCount, legacy.galleryInit.overlayTitle === app.galleryInit.overlayTitle && legacy.galleryInit.overlayCount === app.galleryInit.overlayCount, `"${app.galleryInit.overlayTitle} / ${app.galleryInit.overlayCount}"`);

console.log('\n好友跑马灯:');
check('7 张卡片', legacy.galleryInit.cardCount === 7, app.galleryInit.cardCount === 7);
check('名字与顺序一致', legacy.galleryInit.names.join('|') === app.galleryInit.names.join('|'), legacy.galleryInit.names.join('|') === app.galleryInit.names.join('|'), app.galleryInit.names.slice(0, 3).join(' / '));
check('照片计数文案一致', legacy.galleryInit.counts.map((c) => c.replace(/[^0-9a-z]/gi, '')) .join('|') === app.galleryInit.counts.map((c) => c.replace(/[^0-9a-z]/gi, '')).join('|'), legacy.galleryInit.counts.map((c) => c.replace(/[^0-9a-z]/gi, '')).join('|') === app.galleryInit.counts.map((c) => c.replace(/[^0-9a-z]/gi, '')).join('|'), app.galleryInit.counts.join(' '));
check('无照片的好友显示 "?" 占位', legacy.galleryInit.placeholders === 1, app.galleryInit.placeholders === 1);
{
  const withImg = (list) => list.filter(Boolean);
  check('有照片的好友头像都指向压缩图', withImg(legacy.galleryInit.avatarSrcs).every((s) => s.includes('_compressed')) && withImg(legacy.galleryInit.avatarSrcs).length === 6, withImg(app.galleryInit.avatarSrcs).every((s) => s.includes('_compressed')) && withImg(app.galleryInit.avatarSrcs).length === 6, `app ${withImg(app.galleryInit.avatarSrcs).length} 个 / 例 ${String(app.galleryInit.avatarSrcs[0])}`);
}
check('初始左箭头隐藏、右箭头显示', legacy.galleryInit.leftHidden === true && legacy.galleryInit.rightHidden === false, app.galleryInit.leftHidden === true && app.galleryInit.rightHidden === false, `app left=${app.galleryInit.leftHidden} right=${app.galleryInit.rightHidden}`);
check('滚到最右后右箭头隐藏', legacy.galleryScrolled.rightHidden === true, app.galleryScrolled.rightHidden === true, `内容可滚 ${app.galleryInit.scrollMax}px`);

console.log('\n好友详情（LI JIAZU）:');
check('标题一致', legacy.friend.title === app.friend.title, legacy.friend.title === app.friend.title, `"${app.friend.title}"`);
check('照片计数一致', legacy.friend.count === app.friend.count, legacy.friend.count === app.friend.count, `${app.friend.count} 张`);
check('时间线容器 id 保留', legacy.friend.containerId === 'friendDetailGallery', app.friend.containerId === 'friendDetailGallery');
check('年份列表一致', legacy.friend.years.join('|') === app.friend.years.join('|'), legacy.friend.years.join('|') === app.friend.years.join('|'), app.friend.years.join(' '));
check('月份列表一致', legacy.friend.months.join('|') === app.friend.months.join('|'), legacy.friend.months.join('|') === app.friend.months.join('|'), `${app.friend.months.length} 个月份组`);
check('照片项数与位置一致', legacy.friend.itemCount === app.friend.itemCount && legacy.friend.firstSrcs.join('|') === app.friend.firstSrcs.join('|'), legacy.friend.itemCount === app.friend.itemCount && legacy.friend.firstSrcs.join('|') === app.friend.firstSrcs.join('|'), `${app.friend.itemCount} 张`);
check('分隔线/圆点数量一致', legacy.friend.dividersPerYear === app.friend.dividersPerYear && legacy.friend.markers === app.friend.markers, legacy.friend.dividersPerYear === app.friend.dividersPerYear && legacy.friend.markers === app.friend.markers);
check('点第 3 张 → 灯箱指向该图原图', legacy.lightboxOpen && legacy.lightboxSrc === legacy.clickResult.expected, app.lightboxOpen && app.lightboxSrc === app.clickResult.expected, String(app.lightboxSrc).split('/').pop());
check('滚到底后时间线全部加载', legacy.friendScrolled.loadedCount === legacy.friend.itemCount, app.friendScrolled.loadedCount === app.friend.itemCount, `${app.friendScrolled.loadedCount}/${app.friend.itemCount}`);

console.log('\n群组照片页:');
{
  const same = legacy.group.title === app.group.title && legacy.group.count === app.group.count;
  if (!same) console.log(`    legacy "${legacy.group.title}"/${legacy.group.count}   app "${app.group.title}"/${app.group.count}`);
  check('标题与计数（写死的 26）一致', same, same);
}
{
  const same = legacy.group.itemCount === app.group.itemCount;
  if (!same) console.log(`    legacy ${legacy.group.itemCount} 张 / app ${app.group.itemCount} 张`);
  check('时间线条目数一致（32 张）', same, same, `${app.group.itemCount} 张`);
}
{
  const same = legacy.group.years.join('|') === app.group.years.join('|') && legacy.group.months.join('|') === app.group.months.join('|');
  if (!same) {
    console.log(`    legacy years=${legacy.group.years.join(',')} months=${legacy.group.months.length}`);
    console.log(`    app    years=${app.group.years.join(',')} months=${app.group.months.length}`);
  }
  check('年份/月份分组一致', same, same, app.group.years.join(' '));
}

console.log('\n没有照片的好友（HAN YONG）:');
{
  const lOk = legacy.hanyong.count === '0' && legacy.hanyong.itemCount === 0;
  const aOk = app.hanyong.count === '0' && app.hanyong.itemCount === 0;
  if (!lOk || !aOk) {
    console.log(`    legacy "${legacy.hanyong.title}" ${legacy.hanyong.count} / ${legacy.hanyong.itemCount} 项`);
    console.log(`    app    "${app.hanyong.title}" ${app.hanyong.count} / ${app.hanyong.itemCount} 项`);
  }
  check('计数为 0 且时间线为空', lOk, aOk, `"${app.hanyong.title}"`);
}

const bad = results.filter((r) => r.legacyOk !== true || r.appOk !== true);
console.log(`\n结果: ${results.length - bad.length}/${results.length} 两站均通过`);
if (bad.length) {
  for (const b of bad) console.log(`  未通过: ${b.label} (legacy=${b.legacyOk} app=${b.appOk})`);
  process.exit(1);
}
