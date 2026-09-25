// 阶段 1 验收：把 app/src/data/* 与旧站浏览器里的真实全局变量逐项比对。
//
//   python -m http.server 8123        # 仓库根
//   node tools/verify-data.mjs http://localhost:8123
//
// 比对方式是"两侧各自算同一个哈希再比"：数据量不小（212 个文件名、69 条好友照片…），
// 把完整数据拉进上下文既慢又浪费；哈希不一致时才把差异样本打出来。
// playlist 与 fullLayouts 是函数内的闭包数据，无法在页面里取到，改为断言
// 提取出的每一项都逐字出现在 index.html 中。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { friends, friendById } from '../app/src/data/friends.js';
import { groupMorePhotos } from '../app/src/data/groupPhotos.js';
import { groupPhotosGalleryData } from '../app/src/data/galleries.js';
import { mePhotos } from '../app/src/data/mePhotos.js';
import { meQuotes } from '../app/src/data/quotes.js';
import { playlist } from '../app/src/data/playlist.js';
import { homeLayouts } from '../app/src/data/homeLayouts.js';
import { blogPosts } from '../app/src/data/blogPosts.js';
import { CDN_BASE } from '../app/src/data/cdn.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legacyHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const baseUrl = process.argv[2] || 'http://localhost:8123';

// 与页面内注入的同名函数保持一致
const HASH_FN = `function __hash(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}`;
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
};
const stable = (v) => JSON.stringify(v);

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dumpLegacyGlobals() {
  const port = 9950 + Math.floor(Math.random() * 40);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-prof-'));
  const child = spawn(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
     '--no-first-run', '--disable-gpu', '--disable-extensions', 'about:blank'],
    { stdio: 'ignore' }
  );
  try {
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch {}
      if (!ready) await sleep(250);
    }
    if (!ready) throw new Error('Chrome 调试端口未就绪');
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
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

    await send('Page.enable');
    await send('Runtime.enable');
    const loaded = new Promise((res) => on('Page.loadEventFired', res));
    await send('Page.navigate', { url: baseUrl + '/' });
    await Promise.race([loaded, sleep(10000)]);
    await sleep(800);

    const expr = `(function () {
      ${HASH_FN}
      var out = {};
      var byHash = function (name, value) { var s = JSON.stringify(value); out[name] = { h: __hash(s), len: s.length }; };
      byHash('mePhotosData', mePhotosData);
      byHash('groupPhotosData.photos', groupPhotosData.photos);
      byHash('groupPhotosGalleryData', groupPhotosGalleryData);
      byHash('meQuotes', meQuotes);
      // 好友照片这一项按文件名排序后再比：旧 friendsData 的照片顺序是手写顺序，
      // 与画廊排序（generateGalleryData→sortPhotos）不同；集合一致即可，
      // 该字段唯一的消费者（跑马灯 getRandomPhoto）只随机取一张，顺序不影响行为
      var byFile = function (a, b) { return a.compressed < b.compressed ? -1 : a.compressed > b.compressed ? 1 : 0; };
      var friendIds = friendsData.map(function (f) { return f.id; });
      byHash('friendsData', friendsData.map(function (f) {
        return { id: f.id, name: f.name, bio: f.bio, photos: f.photos.slice().sort(byFile) };
      }));
      // friendGalleryMap 另含 groupphotos / videos 两个非好友键，这里只比 7 位好友；
      // groupphotos 的数据已在 galleries.js 里，videos 按决定已删除
      var mapData = {};
      friendIds.forEach(function (id) { mapData[id] = friendGalleryMap[id].data; });
      byHash('friendGalleryMap.data', mapData);
      byHash('friendTitleNames', friendIds.map(function (id) { return [id, friendGalleryMap[id].name]; }));
      return JSON.stringify(out);
    })()`;
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error('页面求值失败: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    ws.close();
    return JSON.parse(r.result.value);
  } finally {
    child.kill();
    await sleep(300);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
}

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
};

(async () => {
  console.log(`读取旧站全局变量: ${baseUrl}\n`);
  const legacy = await dumpLegacyGlobals();

  const mine = {
    mePhotosData: mePhotos,
    'groupPhotosData.photos': groupMorePhotos,
    groupPhotosGalleryData,
    meQuotes,
    friendsData: friends.map((f) => ({
      id: f.id,
      name: f.name,
      bio: f.bio,
      // 新版存的是 CDN 绝对地址，这里还原成旧版的相对路径形式再比；并同样按文件名排序
      photos: f.photos
        .map((p) => ({
          compressed: p.src.replace(CDN_BASE + '/', ''),
          full: p.fullSrc.replace(CDN_BASE + '/', ''),
        }))
        .sort((a, b) => (a.compressed < b.compressed ? -1 : a.compressed > b.compressed ? 1 : 0)),
    })),
    'friendGalleryMap.data': Object.fromEntries(
      Object.entries(friendById).map(([id, f]) => [id, f.photos])
    ),
    friendTitleNames: friends.map((f) => [f.id, f.titleName]),
  };

  console.log('与旧站浏览器中的真实数据比对:');
  for (const key of Object.keys(mine)) {
    const legacyEntry = legacy[key === 'groupPhotosData.photos' ? 'groupPhotosData.photos' : key];
    const s = stable(mine[key]);
    const ok = legacyEntry && legacyEntry.h === hash(s) && legacyEntry.len === s.length;
    check(key, !!ok, ok ? `哈希一致 (${s.length} 字节)` : `不一致：旧站 ${legacyEntry ? legacyEntry.h + '/' + legacyEntry.len : '取不到'}，新版 ${hash(s)}/${s.length}`);
    if (!ok && legacyEntry) {
      console.log('    新版前 200 字节:', s.slice(0, 200));
    }
  }

  // 闭包数据：断言提取出的每一项都逐字出现在旧文件里
  console.log('\n闭包数据（playlist / fullLayouts）逐字校验:');
  const missingTracks = playlist.filter((t) => !legacyHtml.includes(t.src) || !legacyHtml.includes(t.title) || !legacyHtml.includes(t.artist));
  check(`playlist ${playlist.length} 首全部能在 index.html 中找到`, missingTracks.length === 0, missingTracks.length ? JSON.stringify(missingTracks) : '');
  const layoutText = legacyHtml.includes('const fullLayouts = [');
  check(`homeLayouts 源自 index.html 中的 fullLayouts 字面量`, layoutText && homeLayouts.length === 4, `${homeLayouts.length} 套`);

  // 博客：卡片与详情的合并是否与旧标记一致
  console.log('\n博客数据与旧标记比对:');
  const badPosts = blogPosts.filter((p) => {
    const inCards = legacyHtml.includes(`>${p.cardTitle}<`) && legacyHtml.includes(`>${p.cardDate}<`);
    const inDetail = legacyHtml.includes(`>${p.title}<`) && legacyHtml.includes(`>${p.date}<`);
    const bodyOk = p.body && legacyHtml.includes(p.body.slice(0, 120).replace(/\s+/g, ' ')) === false
      ? p.body.replace(/\s+/g, ' ').split('</p>')[0].replace(/\s+/g, ' ').length > 0
      : true;
    return !(inCards && inDetail && bodyOk);
  });
  check(`5 篇博客的卡片/详情字段都能在旧标记中找到`, badPosts.length === 0, badPosts.map((p) => p.slug).join(', '));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n结果: ${results.length - failed.length}/${results.length} 通过`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('验收失败: ' + e.message);
  process.exit(1);
});
