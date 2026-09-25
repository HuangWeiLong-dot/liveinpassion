// 阶段 5a 验收：ME 页（GAME 弹窗 / 引用 / 最后更新 / 头像轮播 / 弹窗与 iframe 复用）。
//
//   python -m http.server 8123        # 旧站（仓库根）
//   cd app && npm run build && npx vite preview --port 4174 --strictPort
//   node tools/verify-me.mjs
//
// 本机访问不到 api.liveinpassion.me 与 img.liveinpassion.me，所以用 CDP 的 Fetch 域
// 把两者都就地应答：图片给一张 4x2 PNG，Steam 接口给固定 JSON。
// 注意伪造的 JSON 必须带 Access-Control-Allow-Origin，否则跨域 fetch 会被浏览器拦下
//（前一版就因为缺这个头，两站的弹窗都显示"加载失败"，看起来像实现有问题）。
//
// Steam 卡片已按决定取消，所以"进入 ME 页不发 Steam 请求"本身也是一条断言。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const LEGACY = process.argv[2] || 'http://localhost:8123/';
const APP = process.argv[3] || 'http://localhost:4174/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROFILE = {
  personaname: 'HuangWeiLong',
  avatarfull: 'https://img.liveinpassion.me/avatar_stub.png',
  personastate: 1,
  timecreated: 1654000000,
  loccountrycode: 'CN',
  profileurl: 'https://steamcommunity.com/id/example',
  gameid: '548430',
  gameextrainfo: 'Deep Rock Galactic',
};
const GAMES = {
  game_count: 2,
  games: [
    { appid: 548430, name: 'Deep Rock Galactic', playtime_forever: 6300, img_icon_url: '' },
    { appid: 3280350, name: 'Example Game', playtime_forever: 900, img_icon_url: '' },
  ],
};

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

const CORS = { name: 'Access-Control-Allow-Origin', value: '*' };

async function withPage(url, fn) {
  const port = 9600 + Math.floor(Math.random() * 90);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'me-'));
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
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

    const steamCalls = [];
    await send('Fetch.enable', { patterns: [{ urlPattern: 'https://img.liveinpassion.me/*' }, { urlPattern: 'https://api.liveinpassion.me/*' }, { urlPattern: 'https://store.steampowered.com/*' }] });
    const png = makePng(4, 2, [122, 124, 132]).toString('base64');
    on('Fetch.requestPaused', async (p) => {
      const target = p.request.url;
      try {
        if (target.includes('api.liveinpassion.me')) {
          steamCalls.push(target.replace('https://api.liveinpassion.me', ''));
          const body = target.includes('/profile') ? PROFILE : GAMES;
          await send('Fetch.fulfillRequest', {
            requestId: p.requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, CORS],
            body: Buffer.from(JSON.stringify(body)).toString('base64'),
          });
          return;
        }
        // 商店 iframe / CDN 图片：给空内容或一张小图，避免卡住
        if (target.includes('store.steampowered.com')) {
          await send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from('<!doctype html><title>stub</title>').toString('base64') });
          return;
        }
        await send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/png' }, CORS], body: png });
      } catch {}
    });

    const loaded = new Promise((res) => on('Page.loadEventFired', res));
    await send('Page.navigate', { url });
    await Promise.race([loaded, sleep(10000)]);
    await sleep(2600);
    return await fn({ evaluate, steamCalls });
  } finally {
    child.kill();
    await sleep(300);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
// 逐字段取，不用 textContent 拼接：旧版模板里元素之间有换行、新版是紧凑的，
// 拼接结果会差一个空格，但那只是源码排版的痕迹，渲染上没有区别。
const MODAL = `(function () {
  var root = document.getElementById('modalSteamProfile');
  var stats = Array.prototype.map.call(root.querySelectorAll('.steam-profile-stats .steam-profile-stat'), function (e) { return e.textContent; });
  var memberLine = Array.prototype.filter.call(root.querySelectorAll('.steam-profile-stat'), function (e) { return !e.querySelector('strong'); })[0];
  var btn = root.querySelector('.steam-profile-btn');
  return JSON.stringify({
    open: document.getElementById('gameModal').classList.contains('active'),
    name: (root.querySelector('h4') || {}).textContent || null,
    status: (root.querySelector('.steam-profile-status') || {}).textContent || null,
    stats: stats,
    member: memberLine ? memberLine.textContent : null,
    btn: btn ? btn.textContent : null,
    avatarSrc: (root.querySelector('img') || {}).src || null,
    btnHref: btn ? btn.getAttribute('href') : null
  });
})()`;

const results = [];
const check = (label, legacyOk, appOk, detail = '') => {
  results.push({ label, legacyOk, appOk });
  const m = (v) => (v === true ? '✓' : v === false ? '✗' : String(v));
  console.log(`  legacy ${m(legacyOk).padEnd(3)} app ${m(appOk).padEnd(3)}  ${label}${detail ? '  ' + detail : ''}`);
};

const KEYWORDS = ['HuangWeiLong', 'Online', '2', '120', 'Member since'];

async function run(page, goToMe, goHome) {
  return withPage(page, async ({ evaluate, steamCalls }) => {
    await evaluate(goToMe);
    await sleep(1500);
    const cardGone = await evaluate(`!document.querySelector('.steam-card')`);
    const callsOnMe = steamCalls.length;

    await evaluate(`document.getElementById('gameBtn').click(); 1`);
    await sleep(1300);
    const modal1 = JSON.parse(await evaluate(MODAL));
    const afterOpen1 = steamCalls.length;

    await evaluate(`document.getElementById('gameModalClose').click(); 1`);
    await sleep(400);
    await evaluate(`document.getElementById('gameBtn').click(); 1`);
    await sleep(1300);
    const modal2 = JSON.parse(await evaluate(MODAL));
    const afterOpen2 = steamCalls.length;
    const iframeBefore = await evaluate(`!!document.querySelector('#kookModal iframe')`);

    const quote1 = await evaluate(`document.getElementById('quoteText').textContent`);
    await evaluate(goHome);
    await sleep(400);
    await evaluate(goToMe);
    await sleep(900);
    const quote2 = await evaluate(`document.getElementById('quoteText').textContent`);
    const lastUpdate = await evaluate(`document.getElementById('meLastUpdate').textContent`);
    const iframeAfter = await evaluate(`!!document.querySelector('#kookModal iframe')`);
    const pageTitle = await evaluate(`document.getElementById('mePageTitle').textContent`);
    const pageDesc = await evaluate(`document.getElementById('mePageDescription').textContent`);
    const navLabel = await evaluate(`document.getElementById('meNavLink').textContent`);

    return { cardGone, callsOnMe, modal1, modal2, open1Added: afterOpen1 - callsOnMe, open2Added: afterOpen2 - afterOpen1, quote1, quote2, lastUpdate, iframeBefore, iframeAfter, pageTitle, pageDesc, navLabel };
  });
}

console.log('采集旧站…');
const legacy = await run(LEGACY, `navigateTo('me'); 1`, `navigateTo('home'); 1`);
console.log('采集新站…\n');
const app = await run(APP, `document.querySelector('nav a[href="/me"]').click(); 1`, `document.querySelector('nav a[href="/"]').click(); 1`);

console.log('Steam 卡片已取消:');
check('ME 页没有 .steam-card', legacy.cardGone, app.cardGone);
check('进入 ME 页不发 Steam 请求', legacy.callsOnMe === 0, app.callsOnMe === 0, `legacy ${legacy.callsOnMe} / app ${app.callsOnMe}`);

console.log('\nGAME 弹窗:');
check('弹窗打开', legacy.modal1.open, app.modal1.open);
{
  const all = (m) => [norm(m.name), norm(m.status), m.stats.map(norm).join(' '), norm(m.member)].join(' ');
  check('内容含名字/在线/游戏数/时长/加入时间', KEYWORDS.every((k) => all(legacy.modal1).includes(k)), KEYWORDS.every((k) => all(app.modal1).includes(k)), `app: "${all(app.modal1)}"`);
}
{
  const fields = (m) => [norm(m.name), norm(m.status), m.stats.map(norm).join('|'), norm(m.member), norm(m.btn)].join(' ‖ ');
  const same = fields(legacy.modal1) === fields(app.modal1);
  if (!same) {
    console.log('    legacy:', fields(legacy.modal1));
    console.log('    app   :', fields(app.modal1));
  }
  check('弹窗各字段与旧站一致', same, same);
}
check('头像用了 API 返回的地址', String(legacy.modal1.avatarSrc).includes('avatar_stub'), String(app.modal1.avatarSrc).includes('avatar_stub'));
check('View Steam Profile 链接正确', legacy.modal1.btnHref === PROFILE.profileurl, app.modal1.btnHref === PROFILE.profileurl, app.modal1.btnHref);
check('每次打开都重新请求（+2）', legacy.open1Added === 2 && legacy.open2Added === 2, app.open1Added === 2 && app.open2Added === 2, `第1次 +${app.open1Added}，第2次 +${app.open2Added}`);
check('关闭后再次打开内容仍在', norm(legacy.modal2.name).includes('HuangWeiLong'), norm(app.modal2.name).includes('HuangWeiLong'));

console.log('\nME 页其他行为:');
check('引用每次进入都换', legacy.quote1 !== legacy.quote2, app.quote1 !== app.quote2, `app: "${app.quote1.slice(0, 20)}" → "${app.quote2.slice(0, 20)}"`);
check('LAST UPDATED = 最新博客日期', legacy.lastUpdate === 'SEPTEMBER 25, 2026', app.lastUpdate === 'SEPTEMBER 25, 2026', `app: "${app.lastUpdate}"`);
check('Kook iframe 一直存在', legacy.iframeBefore && legacy.iframeAfter, app.iframeBefore && app.iframeAfter);
check('标题/副标题用同一个随机美德', legacy.pageTitle === legacy.navLabel && legacy.pageDesc === `BE ${legacy.navLabel}`, app.pageTitle === app.navLabel && app.pageDesc === `BE ${app.navLabel}`, `app: ${app.navLabel} / ${app.pageDesc}`);

const bad = results.filter((r) => r.legacyOk !== true || r.appOk !== true);
console.log(`\n结果: ${results.length - bad.length}/${results.length} 两站均通过`);
if (bad.length) {
  for (const b of bad) console.log(`  未通过: ${b.label} (legacy=${b.legacyOk} app=${b.appOk})`);
  process.exit(1);
}
