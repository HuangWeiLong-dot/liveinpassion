// LIFE 归档页验收：六个 tab、日期切换、日记 Markdown、随手记、任务、
// 问答、原始事件（筛选 / META / LOAD MORE）、空周总结、手机无溢出、零控制台报错。
//
//   cd app && npx vite --port 5199 --strictPort
//   node tools/verify-life-archive.mjs
//
// /api/life、/api/life/raw/index 和 /api/life/raw/:kind/:id 都在页面脚本执行前
// 用 fetch 打桩，不依赖真实 R2。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = process.argv[2] || 'http://127.0.0.1:5199/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 固定数据 ----------

const DAYS = ['2026-10-19', '2026-10-18'];

const INDEX = {
  v: 1,
  kinds: {
    journal: DAYS.map((id) => ({ id, size: 5100, uploaded: '2026-10-20T04:00:00Z' })),
    notes: DAYS.map((id) => ({ id, size: 4800, uploaded: '2026-10-20T04:00:00Z' })),
    tasks: DAYS.map((id) => ({ id, size: 800, uploaded: '2026-10-20T04:00:00Z' })),
    qa: DAYS.map((id) => ({ id, size: 29000, uploaded: '2026-10-20T04:00:00Z' })),
    events: DAYS.map((id) => ({ id, size: 190000, uploaded: '2026-10-20T04:00:00Z' })),
    blocks: DAYS.map((id) => ({ id, size: 7000, uploaded: '2026-10-20T04:00:00Z' })),
    weekly: [],
    vault: [
      { id: 'tasks-master', size: 2100, uploaded: '2026-10-20T04:00:00Z' },
      { id: 'review-2026-w42', size: 1200, uploaded: '2026-10-20T04:00:00Z' },
      { id: 'ai-session-2026-10-19', size: 900, uploaded: '2026-10-20T04:00:00Z' },
    ],
  },
  generatedAt: '2026-10-20T04:00:00Z',
};

const JOURNAL_HTML = `
<h1>2026-10-19 Monday</h1>
<h2>Time Log</h2>
<ul>
  <li>[time:: 13:57-14:10] [category:: Work] 整理 LifeLogging 与站点的数据链路</li>
  <li>[time:: 14:10-15:06] [category:: Life] 煮面、煎蛋，顺便把手机里的照片导出来</li>
</ul>
<h2>Tasks</h2>
<ul>
  <li><input type="checkbox" checked disabled> 把 LIFE 页发布到站点</li>
  <li><input type="checkbox" disabled> 看完学习通的课程视频</li>
</ul>
<h2>Review</h2>
<p>今天终于把聚合页和原始归档接上了，晚上又试了一遍手机端。</p>
<table><thead><tr><th>指标</th><th>值</th></tr></thead><tbody><tr><td>步数</td><td>6,767</td></tr></tbody></table>
`;
const JOURNAL_RAW = `---
date: "2026-10-19"
total_hours: 7.1
---

# 2026-10-19 Monday

## Time Log

- [time:: 13:57-14:10] [category:: Work] 整理 LifeLogging 与站点的数据链路

## Tasks

- [x] 把 LIFE 页发布到站点
- [ ] 看完学习通的课程视频

## Review

今天终于把聚合页和原始归档接上了。
`;

const NOTES = [
  { ts_utc: '2026-10-19T03:59:14Z', source: 'feishu', text: '刚才把那个删掉了，跟那个女孩子说，很多时候没有看一眼，想了想，我们聊了一下。' },
  { ts_utc: '2026-10-19T14:00:29Z', source: 'feishu', text: '今天复盘：手机解锁 86 次，切换 507 次，亮屏 7 小时 35 分。\n位置：Yingpu, Qingpu, Shanghai, CN，6 小时 37 分。' },
];

const TASKS = [
  { done: true, text: '把 LIFE 页发布到站点' },
  { done: true, text: '整理照片素材' },
  { done: false, text: '看完学习通的课程视频' },
  { done: false, text: '决定兼职：600 CNY 的西装 vs 11:00-19:00 的班' },
];

const QA = {
  qa: [
    {
      id: '2026-10-19-1', ts_utc: '2026-10-19T00:33:02Z', source: 'live', kind: 'routine',
      text: '07:03–08:03 这一段：\n· 键盘：msedge.exe 28 分、Code.exe 24 分\n· 手机：解锁 8 次\n\n主要在忙什么？',
      answer: '在去学校的路上，地铁上太困了，基本一直在闭眼休息。',
      note: '',
      options: [],
    },
    {
      id: '2026-10-19-2', ts_utc: '2026-10-19T12:00:00Z', source: 'live', kind: 'task_check',
      text: '任务检查：学习通课程视频看完了吗？',
      answer: '还没。',
      note: '晚上补。',
      options: ['看了', '还没'],
    },
  ],
};

const EVENTS = [];
for (let i = 0; i < 200; i++) {
  const domain = i % 4 === 0 ? 'location' : i % 4 === 1 ? 'phone' : i % 4 === 2 ? 'screen' : 'manual';
  EVENTS.push({
    ts_utc: new Date(Date.UTC(2026, 9, 19, 0, 0, 0) + i * 60000).toISOString(),
    domain,
    metric: domain === 'location' ? 'visit' : domain === 'phone' ? 'app_switch' : domain === 'screen' ? 'app_usage' : 'note',
    value_num: i % 7 === 0 ? 31.15678 : 42 + i,
    value_text: domain === 'phone' ? 'com.tencent.mm' : domain === 'manual' ? `第 ${i} 条随手记` : `页面标题 ${i}`,
    source: domain === 'location' ? 'dawarich' : domain === 'phone' ? 'tasker' : 'activitywatch',
    meta: i % 3 === 0 ? { lat: 31.15678, lon: 121.10274, label: `停留点 ${i}` } : {},
    ingested_at: '2026-10-19T12:00:00Z',
  });
}

const BLOCKS = [
  {
    start_utc: '2026-10-19T05:57:00Z', end_utc: '2026-10-19T06:10:00Z', hours: 0.22,
    category: 'Work', app: 'Code.exe', title: 'main.py - LifeLogging - Visual Studio Code',
    url: 'file:///C:/Users/LongGe/Desktop/LifeLogging/main.py', confidence: 'rule',
    blackhole: false, source: 'normalize',
  },
  {
    start_utc: '2026-10-19T06:10:00Z', end_utc: '2026-10-19T07:06:00Z', hours: 0.93,
    category: 'Life', app: 'Weixin.exe', title: '微信 / 文件传输助手',
    url: null, confidence: 'llm', blackhole: false, source: 'normalize',
  },
  {
    start_utc: '2026-10-19T09:00:00Z', end_utc: '2026-10-19T09:10:00Z', hours: 0.16,
    category: 'Leisure', app: 'msedge.exe', title: '抖音 - 推荐',
    url: 'https://www.douyin.com/discover', confidence: 'rule',
    blackhole: true, source: 'normalize',
  },
];

const VAULT_HTML = `
<h1>Tasks</h1>
<h2>Open</h2>
<ul>
  <li><input type="checkbox" disabled> Finish the city.aep edit against the reference clip</li>
  <li><input type="checkbox" disabled> Decide on the part-time job</li>
</ul>
<h2>Done</h2>
<ul>
  <li><input type="checkbox" checked disabled> Deploy the life-logging system</li>
</ul>
`;
const VAULT_RAW = `# Tasks

## Open

- [ ] Finish the city.aep edit against the reference clip

## Done

- [x] Deploy the life-logging system
`;

const DOCS = {
  journal: { v: 1, kind: 'journal', id: '2026-10-19', format: 'md', html: JOURNAL_HTML, raw: JOURNAL_RAW },
  notes: { v: 1, kind: 'notes', id: '2026-10-19', format: 'json', data: NOTES },
  tasks: { v: 1, kind: 'tasks', id: '2026-10-19', format: 'json', data: TASKS },
  qa: { v: 1, kind: 'qa', id: '2026-10-19', format: 'json', data: QA },
  events: { v: 1, kind: 'events', id: '2026-10-19', format: 'json', data: EVENTS },
  blocks: { v: 1, kind: 'blocks', id: '2026-10-19', format: 'json', data: BLOCKS },
  weekly: { v: 1, kind: 'weekly', id: '2026-10-19', format: 'json', data: null },
  vault: { v: 1, kind: 'vault', id: 'tasks-master', format: 'md', html: VAULT_HTML, raw: VAULT_RAW },
};

const AGG = {
  v: 1,
  days: [{
    v: 1, day: '2026-10-19',
    categories: { Work: 5.17, Study: 0, Life: 0.22, Transport: 0, Leisure: 1.73, Health: 0, Social: 0, Other: 0.05 },
    trackedHours: 7.17,
    topApps: [['Edge', 3.2], ['VS Code', 2.1]],
    health: { steps: 6767, hrAvg: 79, hrMin: 61, runs: 1, runKm: 5.06, runMinutes: 29.6, runPaceS: 351, vo2max: 45.8 },
    location: { city: 'Shanghai', districts: [['Qingpu', 6.2]], movingMinutes: 20, stayMinutes: 400, spanKm: 42, points: 1010 },
    phone: { unlocks: 86, screenOn: 90, screenOff: 89, screenMinutes: 300, appSwitches: 507, topApps: [['WeChat', 155.9]] },
    ai: { cost: 20.94, costSource: 'claude-estimate', dailyCost: 0.08, spend: null, estimatedCost: 20.94, calls: 900, callsSource: 'claude-estimate', models: [], projects: [['app', 10.05]] },
  }],
  count: 1,
  skipped: 0,
  range: { from: '2026-10-19', to: '2026-10-19' },
  generatedAt: '2026-10-20T04:00:00Z',
  updatedAt: '2026-10-20 04:00:00',
};

const STUB = `
(function () {
  var INDEX = ${JSON.stringify(JSON.stringify(INDEX))};
  var DOCS = ${JSON.stringify(DOCS)};
  var AGG = ${JSON.stringify(JSON.stringify(AGG))};
  var orig = window.fetch;
  window.__archiveFetches = 0;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/life/raw/index') >= 0) {
      window.__archiveFetches++;
      return Promise.resolve(new Response(INDEX, { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (url.indexOf('/api/life/raw/') >= 0) {
      window.__archiveFetches++;
      var m = url.match(/\\/api\\/life\\/raw\\/([a-z]+)\\//);
      var doc = m && DOCS[m[1]];
      if (!doc) return Promise.resolve(new Response('{}', { status: 404 }));
      return Promise.resolve(new Response(JSON.stringify(doc), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (url.indexOf('/api/life') >= 0) {
      return Promise.resolve(new Response(AGG, { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (url.indexOf('/api/track') >= 0) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, sid: 'verify-archive' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return orig.apply(this, arguments);
  };
})();
`;

async function withPage({ width, height, mobile, label, routeUrl }, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-arc-'));
  const args = [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    '--no-first-run', '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
    `--window-size=${width},${height}`, 'about:blank',
  ];
  if (mobile) args.push('--touch-events=enabled');
  const child = spawn(CHROME, args, { stdio: 'ignore' });

  try {
    let port = null;
    for (let i = 0; i < 100 && !port; i++) {
      try {
        const raw = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split(/\r?\n/);
        if (raw[0]) port = Number(raw[0]);
      } catch {}
      if (!port) await sleep(200);
    }
    if (!port) throw new Error('Chrome did not start');

    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method === 'Runtime.consoleAPICalled') {
        const text = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        console.log('  [console]', m.params.type, text);
        if (m.params.type === 'error') errors.push(text);
      } else if (m.method === 'Runtime.exceptionThrown') {
        errors.push(m.params.exceptionDetails?.text || 'exception');
      }
    });

    const send = (method, params = {}) => new Promise((res, rej) => {
      const n = ++id;
      pending.set(n, { res, rej });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate failed');
      return r.result?.value;
    };
    const shot = async (name, full = false) => {
      const out = path.join(os.tmpdir(), `life-arc-${label}-${name}.png`);
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, fromSurface: true });
      fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
      console.log('  screenshot:', out);
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: !!mobile });
    if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
    await send('Page.navigate', { url: new URL(routeUrl, APP).href });
    await sleep(1200);

    let enter = false;
    for (let i = 0; i < 60 && !enter; i++) {
      enter = await evalJs("(function(){var b=document.querySelector('.brand__enter');return !!b&&b.offsetParent!==null;})()");
      if (!enter) await sleep(200);
    }
    if (enter) {
      await evalJs("document.querySelector('.brand__enter').click()");
      for (let i = 0; i < 50; i++) {
        const gone = await evalJs("(function(){var b=document.querySelector('.brand');return !b||b.classList.contains('is-gone');})()");
        if (gone) break;
        await sleep(200);
      }
      await sleep(2600);
    } else {
      await sleep(2200);
    }

    const result = await fn({ evalJs, shot, sleep, send });
    ws.close();
    return result;
  } finally {
    child.kill();
    await sleep(300);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

const errors = [];

console.log('LIFE archive desktop');
await withPage({ width: 1440, height: 1000, label: 'desk', routeUrl: '/life/archive/journal' }, async ({ evalJs, shot, sleep }) => {
  const state = JSON.parse(await evalJs(`(function(){
    return JSON.stringify({
      path: location.pathname,
      tabs: document.querySelectorAll('.life-archive-tab').length,
      activeTab: document.querySelector('.life-archive-tab.is-active')?.textContent.replace(/\\s+/g,' ').trim(),
      days: document.querySelectorAll('.life-day').length,
      activeDay: document.querySelector('.life-day.is-active')?.textContent.trim(),
      title: document.querySelector('.life-archive-title')?.textContent.trim(),
      journalH1: document.querySelector('.life-doc h1')?.textContent.trim(),
      checkboxes: document.querySelectorAll('.life-doc input[type=checkbox]').length,
      tables: document.querySelectorAll('.life-doc table').length,
      raw: !!document.querySelector('.life-raw-details'),
      fetches: window.__archiveFetches,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    });
  })()`));
  console.log('  state:', state);
  if (state.path !== '/life/archive/journal') throw new Error('not on journal archive');
  if (state.tabs !== 8) throw new Error(`tabs ${state.tabs}`);
  if (state.activeTab.indexOf('JOURNAL') < 0) throw new Error('journal tab not active');
  if (state.days !== 2) throw new Error(`days ${state.days}`);
  if (state.title !== 'ARCHIVE') throw new Error('title missing');
  if (!state.journalH1?.includes('2026-10-19')) throw new Error('journal h1 missing');
  if (state.checkboxes !== 2) throw new Error(`checkboxes ${state.checkboxes}`);
  if (state.tables !== 1) throw new Error('journal table missing');
  if (!state.raw) throw new Error('raw markdown toggle missing');
  if (state.overflow > 1) throw new Error('desktop overflow');

  // 内容不满一屏时，.page 也要撑满视口，否则固定 footer 会从底部漏一条反色边
  const footerTop = JSON.parse(await evalJs(`(function(){
    var main = document.querySelector('main.page.active');
    var foot = document.querySelector('.site-footer__fixed');
    var b = main ? main.getBoundingClientRect() : null;
    return JSON.stringify({
      hasFooter: !!foot,
      pageBottom: b ? Math.round(b.bottom) : 0,
      vh: window.innerHeight,
      scrollY: Math.round(window.scrollY),
    });
  })()`));
  console.log('  footer (top):', footerTop);
  if (!footerTop.hasFooter) throw new Error('global footer missing on archive');
  if (footerTop.scrollY === 0 && footerTop.pageBottom < footerTop.vh - 1) {
    throw new Error(`page shorter than viewport (${footerTop.pageBottom} < ${footerTop.vh}): footer peeks through`);
  }
  await shot('journal');

  // 切换日期
  const before = state.fetches;
  await evalJs("document.querySelectorAll('.life-day')[1].click()");
  await sleep(700);
  const dayState = JSON.parse(await evalJs(`(function(){
    return JSON.stringify({
      active: document.querySelector('.life-day.is-active')?.textContent.trim(),
      day: document.querySelector('.life-doc-day')?.textContent.trim(),
      fetches: window.__archiveFetches,
      h1: document.querySelector('.life-doc h1')?.textContent.trim(),
    });
  })()`));
  console.log('  day switch:', dayState, 'before:', before);
  if (dayState.day !== '2026-10-18') throw new Error('day header did not change');
  if (dayState.fetches <= before) throw new Error('no fetch on day switch');

  // NOTES
  await evalJs("document.querySelector('.life-archive-tab[href=\"/life/archive/notes\"]').click()");
  await sleep(1500);
  const notes = JSON.parse(await evalJs(`(function(){
    return JSON.stringify({
      path: location.pathname,
      rows: document.querySelectorAll('.life-note').length,
      text: document.querySelector('.life-note-text')?.textContent.slice(0, 20),
      active: document.querySelector('.life-archive-tab.is-active')?.textContent.replace(/\\s+/g,' ').trim(),
    });
  })()`));
  console.log('  notes:', notes);
  if (notes.path !== '/life/archive/notes') throw new Error('notes route');
  if (notes.rows !== 2) throw new Error(`notes rows ${notes.rows}`);
  if (!notes.active.includes('NOTES')) throw new Error('notes tab not active');
  if (!notes.text) throw new Error('note text missing');
  await shot('notes');

  // TASKS
  await evalJs("document.querySelector('.life-archive-tab[href=\"/life/archive/tasks\"]').click()");
  await sleep(1500);
  const tasks = JSON.parse(await evalJs(`(function(){
    return JSON.stringify({
      rows: document.querySelectorAll('.life-task').length,
      done: document.querySelectorAll('.life-task.is-done').length,
      text: document.querySelector('.life-task-text')?.textContent,
    });
  })()`));
  console.log('  tasks:', tasks);
  if (tasks.rows !== 4) throw new Error(`tasks rows ${tasks.rows}`);
  if (tasks.done !== 2) throw new Error(`done tasks ${tasks.done}`);
  if (!tasks.text) throw new Error('task text missing');
  await shot('tasks');

  // QA
  await evalJs("document.querySelector('.life-archive-tab[href=\"/life/archive/qa\"]').click()");
  await sleep(1500);
  const qa = JSON.parse(await evalJs(`(function(){
    return JSON.stringify({
      rows: document.querySelectorAll('.life-qa').length,
      question: document.querySelector('.life-qa-question')?.textContent.slice(0, 12),
      answer: document.querySelector('.life-qa-answer')?.textContent.slice(0, 12),
      notes: document.querySelectorAll('.life-qa-note').length,
      options: document.querySelectorAll('.life-qa-options li').length,
    });
  })()`));
  console.log('  qa:', qa);
  if (qa.rows !== 2) throw new Error(`qa rows ${qa.rows}`);
  if (!qa.question || !qa.answer) throw new Error('qa text missing');
  if (qa.notes !== 1) throw new Error('qa note missing');
  if (qa.options !== 2) throw new Error('qa options missing');
  await shot('qa');

  // BLOCKS（带窗口标题 / URL / 黑洞标记）
  await evalJs("document.querySelector('.life-archive-tab[href=\"/life/archive/blocks\"]').click()");
  await sleep(1500);
  const blockState = JSON.parse(await evalJs(`(function(){
    return JSON.stringify({
      rows: document.querySelectorAll('.life-block').length,
      title: document.querySelector('.life-block-title')?.textContent,
      links: document.querySelectorAll('.life-block-url a').length,
      blackhole: document.querySelectorAll('.life-block.is-blackhole').length,
      urls: [...document.querySelectorAll('.life-block-url')].map(e=>e.textContent.trim()),
    });
  })()`));
  console.log('  blocks:', blockState);
  if (blockState.rows !== 3) throw new Error(`block rows ${blockState.rows}`);
  if (!blockState.title?.includes('LifeLogging')) throw new Error('block title missing');
  if (blockState.links !== 1) throw new Error(`block links ${blockState.links}`);
  if (blockState.blackhole !== 1) throw new Error('blackhole marker missing');
  if (!blockState.urls.some((u) => u.startsWith('file://'))) throw new Error('file url not rendered as text');
  await shot('blocks');

  // EVENTS
  await evalJs("document.querySelector('.life-archive-tab[href=\"/life/archive/events\"]').click()");
  await sleep(1600);
  const ev = JSON.parse(await evalJs(`(function(){
    return JSON.stringify({
      rows: document.querySelectorAll('.life-event').length,
      filters: document.querySelectorAll('.life-filter').length,
      meta: document.querySelectorAll('.life-event-meta').length,
      loadmore: !!document.querySelector('.life-loadmore'),
      first: document.querySelector('.life-event-value')?.textContent,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    });
  })()`));
  console.log('  events:', ev);
  if (ev.rows !== 120) throw new Error(`event rows ${ev.rows}`);
  if (ev.filters !== 5) throw new Error(`filters ${ev.filters}`);
  if (!ev.meta) throw new Error('event meta missing');
  if (!ev.loadmore) throw new Error('load more missing');
  if (ev.overflow > 1) throw new Error('events overflow');
  await shot('events');

  // 筛选 location，再 LOAD MORE
  await evalJs("[...document.querySelectorAll('.life-filter')].find(b=>b.textContent.trim().startsWith('location')).click()");
  await sleep(500);
  const filtered = JSON.parse(await evalJs(`(function(){
    return JSON.stringify({
      rows: document.querySelectorAll('.life-event').length,
      domains: [...new Set([...document.querySelectorAll('.life-event-domain')].map(e=>e.textContent.trim()))],
      loadmore: !!document.querySelector('.life-loadmore'),
    });
  })()`));
  console.log('  filtered:', filtered);
  if (filtered.domains.length !== 1 || filtered.domains[0] !== 'location') throw new Error('domain filter failed');
  if (filtered.rows !== 50) throw new Error(`filtered rows ${filtered.rows}`);
  if (filtered.loadmore) throw new Error('filtered load more should be hidden');

  // 回到 ALL，再 LOAD MORE 到 200 行
  await evalJs("[...document.querySelectorAll('.life-filter')].find(b=>b.textContent.trim().startsWith('ALL')).click()");
  await sleep(500);
  await evalJs("document.querySelector('.life-loadmore').click()");
  await sleep(600);
  const paged = JSON.parse(await evalJs(`(function(){
    return JSON.stringify({
      rows: document.querySelectorAll('.life-event').length,
      loadmore: !!document.querySelector('.life-loadmore'),
    });
  })()`));
  console.log('  paged:', paged);
  if (paged.rows !== 200) throw new Error(`paged rows ${paged.rows}`);
  if (paged.loadmore) throw new Error('load more should disappear after 200 rows');

  // REVIEWS（空）
  await evalJs("document.querySelector('.life-archive-tab[href=\"/life/archive/weekly\"]').click()");
  await sleep(1500);
  const weekly = JSON.parse(await evalJs(`(function(){
    return JSON.stringify({
      empty: document.querySelector('.stats-empty')?.textContent.replace(/\\s+/g,' ').trim() || '',
      panels: document.querySelectorAll('.life-doc-panel').length,
    });
  })()`));
  console.log('  weekly:', weekly);
  if (!weekly.empty.includes('No entries')) throw new Error('weekly empty state missing');

  // VAULT（主任务清单 / 周回顾 / AI 会话）
  await evalJs("document.querySelector('.life-archive-tab[href=\"/life/archive/vault\"]').click()");
  await sleep(1500);
  const vault = JSON.parse(await evalJs(`(function(){
    return JSON.stringify({
      path: location.pathname,
      days: document.querySelectorAll('.life-day').length,
      labels: [...document.querySelectorAll('.life-day')].map(e=>e.textContent.trim()),
      active: document.querySelector('.life-day.is-active')?.textContent.trim(),
      day: document.querySelector('.life-doc-day')?.textContent.trim(),
      h1: document.querySelector('.life-doc h1')?.textContent.trim(),
      checks: document.querySelectorAll('.life-doc input[type=checkbox]').length,
      raw: !!document.querySelector('.life-raw-details'),
    });
  })()`));
  console.log('  vault:', vault);
  if (vault.path !== '/life/archive/vault') throw new Error('vault route');
  if (vault.days !== 3) throw new Error(`vault days ${vault.days}`);
  if (vault.labels[0] !== 'MASTER TASKS') throw new Error(`vault labels ${vault.labels}`);
  if (vault.active !== 'MASTER TASKS') throw new Error('vault default not master tasks');
  if (vault.day !== 'MASTER TASKS') throw new Error('vault header');
  if (vault.h1 !== 'Tasks') throw new Error(`vault h1 ${vault.h1}`);
  if (vault.checks !== 3) throw new Error(`vault checkboxes ${vault.checks}`);
  if (!vault.raw) throw new Error('vault raw missing');
  await shot('vault');

  // keep-alive：回首页再进归档
  const fetchesBefore = await evalJs('window.__archiveFetches');
  await evalJs("document.querySelectorAll('nav a')[0].click()");
  await sleep(2200);
  await evalJs("document.querySelector('nav a[href=\"/life\"]').click()");
  await sleep(2600);
  const lifeState = JSON.parse(await evalJs(`(function(){
    return JSON.stringify({
      path: location.pathname,
      cards: document.querySelectorAll('.life-archive-card').length,
      indexCards: document.querySelectorAll('.life-archive-card').length,
      fetches: window.__archiveFetches,
    });
  })()`));
  console.log('  life overview:', lifeState, 'fetchesBefore:', fetchesBefore);
  if (lifeState.path !== '/life') throw new Error('did not return to life');
  if (lifeState.cards !== 8) throw new Error(`archive cards ${lifeState.cards}`);
  if (lifeState.fetches <= fetchesBefore) throw new Error('raw index not refetched on life');
  await shot('overview');

  await evalJs("document.querySelector('.life-archive-panel').scrollIntoView({ block: 'center', behavior: 'instant' })");
  await sleep(900);
  const cardState = JSON.parse(await evalJs(`(function(){
    return JSON.stringify({
      cards: document.querySelectorAll('.life-archive-card').length,
      counts: [...document.querySelectorAll('.life-archive-meta')].map(e=>e.textContent.trim()),
      opacity: getComputedStyle(document.querySelector('.life-archive-panel')).opacity,
      htmlClass: document.documentElement.className,
      headerBg: getComputedStyle(document.querySelector('header')).backgroundColor,
      scrollY: window.scrollY,
    });
  })()`));
  console.log('  archive cards:', cardState);
  if (cardState.cards !== 8) throw new Error(`archive links ${cardState.cards}`);
  if (Number(cardState.opacity) < 0.99) throw new Error('archive panel not revealed');
  await shot('archive-links');

  // 从 LIFE 点归档卡：不应再出现整屏 ARCHIVE 转场板子（重复/慢的根因）
  await evalJs("document.querySelector('.life-archive-card').click()");
  await sleep(160);
  const cardNav = JSON.parse(await evalJs(`(function(){
    return JSON.stringify({
      path: location.pathname,
      board: !!document.querySelector('.transition-panel'),
      archive: !!document.querySelector('.life-archive-section'),
    });
  })()`));
  console.log('  card nav:', cardNav);
  if (cardNav.path !== '/life/archive/journal') throw new Error(`card nav path ${cardNav.path}`);
  if (cardNav.board) throw new Error('page transition board still appears on archive card click');
  if (!cardNav.archive) throw new Error('archive section not mounted after card click');
  await sleep(900);

  // 滚到页尾：footer 抽屉要完整露出，且不能压住归档声明
  await evalJs('window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" })');
  await sleep(900);
  const footerBottom = JSON.parse(await evalJs(`(function(){
    var foot = document.querySelector('.site-footer__fixed');
    var disc = document.querySelector('.life-archive-disclaimer');
    var f = foot ? foot.getBoundingClientRect() : null;
    var d = disc ? disc.getBoundingClientRect() : null;
    return JSON.stringify({
      footTop: f ? Math.round(f.top) : null,
      vh: window.innerHeight,
      discBottom: d ? Math.round(d.bottom) : null,
    });
  })()`));
  console.log('  footer (bottom):', footerBottom);
  if (footerBottom.footTop == null || footerBottom.footTop >= footerBottom.vh) {
    throw new Error('footer not revealed at document end');
  }
  if (footerBottom.discBottom != null && footerBottom.discBottom > footerBottom.footTop + 1) {
    throw new Error('archive disclaimer is hidden behind the footer');
  }
});

console.log('LIFE archive mobile');
await withPage({ width: 390, height: 844, mobile: true, label: 'mobile', routeUrl: '/life/archive/journal' }, async ({ evalJs, shot, sleep }) => {
  const state = JSON.parse(await evalJs(`(function(){
    return JSON.stringify({
      tabs: document.querySelectorAll('.life-archive-tab').length,
      days: document.querySelectorAll('.life-day').length,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      h1: document.querySelector('.life-doc h1')?.textContent.trim(),
    });
  })()`));
  console.log('  state:', state);
  if (state.tabs !== 8) throw new Error('mobile tabs');
  if (state.days !== 2) throw new Error('mobile days');
  if (state.overflow > 1) throw new Error(`mobile overflow ${state.overflow}`);
  const mFooter = JSON.parse(await evalJs(`(function(){
    var main = document.querySelector('main.page.active');
    var b = main ? main.getBoundingClientRect() : null;
    return JSON.stringify({
      pageBottom: b ? Math.round(b.bottom) : 0,
      vh: window.innerHeight,
      scrollY: Math.round(window.scrollY),
    });
  })()`));
  console.log('  footer (mobile top):', mFooter);
  if (mFooter.scrollY === 0 && mFooter.pageBottom < mFooter.vh - 1) {
    throw new Error('mobile: footer peeks through short archive page');
  }
  await shot('journal');
  await evalJs("document.querySelector('.life-archive-tab[href=\"/life/archive/events\"]').click()");
  await sleep(1600);
  const ev = JSON.parse(await evalJs(`(function(){
    return JSON.stringify({
      rows: document.querySelectorAll('.life-event').length,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    });
  })()`));
  console.log('  mobile events:', ev);
  if (ev.rows !== 120) throw new Error('mobile event rows');
  if (ev.overflow > 1) throw new Error(`mobile events overflow ${ev.overflow}`);
  await shot('events');
});

if (errors.length) {
  console.error('console errors:', errors);
  process.exitCode = 1;
}
console.log('done');
