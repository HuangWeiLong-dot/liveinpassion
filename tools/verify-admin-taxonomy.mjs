// CMS /taxonomy（分类 / 标签总览）验收：重命名、合并、删除、手机布局、零报错。
// 用法：先起 admin dev（vite），再 node tools/verify-admin-taxonomy.mjs http://localhost:5173/admin
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const baseUrl = (process.argv[2] || 'http://localhost:5173/admin').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INJECT = `
(function () {
  const state = {
    posts: [
      { id: 1, slug: 'first-light', title: 'First Light', category: 'POEM', tags: ['LOVE', 'NIGHT'], publishedAt: '2026-10-03 10:00:00' },
      { id: 2, slug: 'second-light', title: 'Second Light', category: 'POEM', tags: ['LOVE'], publishedAt: '2026-10-02 10:00:00' },
      { id: 3, slug: 'third-light', title: 'Third Light', category: 'ESSAY', tags: ['NIGHT', 'SOLITUDE'], publishedAt: '2026-10-01 10:00:00' },
      { id: 4, slug: 'unfiled-note', title: 'Unfiled Note', category: 'UNFILED', tags: [], publishedAt: '2026-09-30 10:00:00' },
    ],
    categories: [],
    tags: [],
  };
  window.__tx = state;
  const jsonResponse = (obj, status) => Promise.resolve(new Response(JSON.stringify(obj), {
    status: status || 200, headers: { 'Content-Type': 'application/json' },
  }));
  function summarize() {
    const cats = new Map();
    const tagMap = new Map();
    for (const p of state.posts) {
      cats.set(p.category, (cats.get(p.category) || 0) + 1);
      for (const t of p.tags) tagMap.set(t, (tagMap.get(t) || 0) + 1);
    }
    const toList = (map) => [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    state.categories = toList(cats);
    state.tags = toList(tagMap);
  }
  summarize();
  function renameCategory(from, to) {
    let n = 0;
    for (const p of state.posts) if (p.category === from) { p.category = to; n++; }
    summarize();
    return n;
  }
  function renameTag(from, to) {
    let n = 0;
    for (const p of state.posts) {
      if (!p.tags.includes(from)) continue;
      p.tags = p.tags.filter((t) => t !== from);
      if (to && !p.tags.includes(to)) p.tags.push(to);
      n++;
    }
    summarize();
    return n;
  }
  function removeTag(name) {
    let n = 0;
    for (const p of state.posts) {
      if (!p.tags.includes(name)) continue;
      p.tags = p.tags.filter((t) => t !== name);
      n++;
    }
    summarize();
    return n;
  }
  function bulkUpdate(body) {
    const ids = new Set(body.ids || []);
    const add = body.addTags || [];
    const remove = new Set(body.removeTags || []);
    let n = 0;
    for (const p of state.posts) {
      if (!ids.has(p.id)) continue;
      let changed = false;
      if (body.category && p.category !== body.category) { p.category = body.category; changed = true; }
      for (const t of add) if (!p.tags.includes(t)) { p.tags.push(t); changed = true; }
      if (remove.size) {
        const before = p.tags.length;
        p.tags = p.tags.filter((t) => !remove.has(t));
        if (p.tags.length !== before) changed = true;
      }
      if (changed) n++;
    }
    summarize();
    return n;
  }
  const orig = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init && init.method) || 'GET';
    if (url.indexOf('/api/admin/taxonomy') === 0) {
      const body = init && init.body ? JSON.parse(init.body) : {};
      if (method === 'GET') {
        return jsonResponse({
          total: state.posts.length,
          categories: state.categories,
          tags: state.tags,
          posts: state.posts,
        });
      }
      if (url === '/api/admin/taxonomy/posts' && method === 'PUT') {
        return jsonResponse({ ok: true, affected: bulkUpdate(body) });
      }
      if (url === '/api/admin/taxonomy/category' && method === 'PUT') {
        return jsonResponse({ ok: true, affected: renameCategory(body.from, body.to) });
      }
      if (url === '/api/admin/taxonomy/tag' && method === 'PUT') {
        return jsonResponse({ ok: true, affected: renameTag(body.from, body.to) });
      }
      if (url === '/api/admin/taxonomy/category' && method === 'DELETE') {
        return jsonResponse({ ok: true, affected: renameCategory(body.name, 'UNFILED') });
      }
      if (url === '/api/admin/taxonomy/tag' && method === 'DELETE') {
        return jsonResponse({ ok: true, affected: removeTag(body.name) });
      }
      return jsonResponse({ error: 'not stubbed' }, 404);
    }
    return orig.apply(this, arguments);
  };
})();
`;

let id = 0;
const pending = new Map();
const handlers = new Map();
let ws;
const send = (method, params = {}, timeoutMs = 15000) => {
  const i = ++id;
  return new Promise((res, rej) => {
    const timer = setTimeout(() => {
      if (pending.delete(i)) rej(new Error(`CDP 超时: ${method}`));
    }, timeoutMs);
    pending.set(i, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
};
const on = (m, f) => {
  if (!handlers.has(m)) handlers.set(m, []);
  handlers.get(m).push(f);
};
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('页面求值失败: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
};
const json = async (expr) => JSON.parse(await evaluate(`JSON.stringify(${expr})`));

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
};
const section = (t) => console.log(`\n${t}`);

(async () => {
  const port = 9870 + Math.floor(Math.random() * 30);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-check-'));
  const child = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
    '--no-first-run', '--disable-gpu', '--disable-extensions', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch {}
      if (!ready) await sleep(250);
    }
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method && handlers.has(m.method)) for (const f of handlers.get(m.method)) f(m.params);
    });

    await send('Page.enable');
    await send('Runtime.enable');
    const consoleErrors = [];
    const dialogs = [];
    on('Runtime.exceptionThrown', (p) => consoleErrors.push(p.exceptionDetails?.text || 'exception'));
    on('Page.javascriptDialogOpening', ({ message }) => {
      dialogs.push(message || '');
      send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    });
    on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') consoleErrors.push(p.args.map((a) => a.value || a.description).join(' '));
    });

    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });

    const loaded = new Promise((res) => on('Page.loadEventFired', res));
    await send('Page.navigate', { url: baseUrl + '/taxonomy' });
    await Promise.race([loaded, sleep(12000)]);
    await sleep(1800);

    section('总览');
    const head = await json(`({
      h1: document.querySelector('.page-head h1')?.textContent.trim(),
      meta: document.querySelector('.meta-line')?.textContent.replace(/\\s+/g, ' ').trim(),
      cats: [...document.querySelectorAll('.tx-panel')][0]?.querySelectorAll('.tx-row').length,
      tags: [...document.querySelectorAll('.tx-panel')][1]?.querySelectorAll('.tx-row').length,
      catNames: [...document.querySelectorAll('.tx-panel')][0] ? [...[...document.querySelectorAll('.tx-panel')][0].querySelectorAll('.tx-row__name')].map((e) => e.textContent.trim()) : [],
      tagNames: [...document.querySelectorAll('.tx-panel')][1] ? [...[...document.querySelectorAll('.tx-panel')][1].querySelectorAll('.tx-row__name')].map((e) => e.textContent.trim()) : [],
      cols: getComputedStyle(document.querySelector('.tx-layout')).gridTemplateColumns,
    })`);
    check('页面标题正确', head.h1 === 'Tags & Categories', head.h1);
    check('Meta 统计 4 published / 3 categories / 3 tags', /4 Published/.test(head.meta) && /3 Categories/.test(head.meta) && /3 Tags/.test(head.meta), head.meta);
    check('分类与标签各 3 行', head.cats === 3 && head.tags === 3, `${head.cats} / ${head.tags}`);
    check('桌面两栏布局', head.cols.split(' ').length === 2, head.cols);
    check('分类顺序按篇数', JSON.stringify(head.catNames) === JSON.stringify(['POEM', 'ESSAY', 'UNFILED']), JSON.stringify(head.catNames));

    section('重命名分类');
    await evaluate(`document.querySelectorAll('.tx-panel')[0].querySelector('.tx-row__actions .btn').click()`);
    await sleep(200);
    const editing = await json(`({
      input: !!document.querySelector('.tx-rename__input'),
      value: document.querySelector('.tx-rename__input')?.value,
      focused: document.activeElement?.className,
    })`);
    check('Rename 打开行内输入框并聚焦', editing.input && editing.value === 'POEM' && editing.focused === 'tx-rename__input', JSON.stringify(editing));
    await evaluate(`(function () {
      const i = document.querySelector('.tx-rename__input');
      i.value = 'verse';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return 1;
    })()`);
    await sleep(100);
    await evaluate(`document.querySelector('.tx-rename .btn-primary').click()`);
    await sleep(900);
    const afterRename = await json(`({
      names: [...document.querySelectorAll('.tx-panel')[0].querySelectorAll('.tx-row__name')].map((e) => e.textContent.trim()),
      notice: document.querySelector('.notice-line')?.textContent.trim(),
      stored: window.__tx.posts.map((p) => p.category),
    })`);
    check('重命名后列表变成 VERSE 且保留 2 篇', afterRename.names.includes('VERSE') && !afterRename.names.includes('POEM'), JSON.stringify(afterRename.names));
    check('重命名落到已发布文章（stub 收到 PUT）', afterRename.stored.includes('VERSE') && !afterRename.stored.includes('POEM'), JSON.stringify(afterRename.stored));
    check('成功提示显示受影响篇数', /2 published posts/.test(afterRename.notice || ''), afterRename.notice);

    section('合并标签');
    const mergeInfo = await json(`(function () {
      const panel = document.querySelectorAll('.tx-panel')[1];
      const sel = panel.querySelector('.tx-row .tx-merge');
      return { options: [...sel.options].map((o) => o.value).filter(Boolean) };
    })()`);
    check('合并下拉列出其他标签', mergeInfo.options.includes('NIGHT') && mergeInfo.options.includes('SOLITUDE') && !mergeInfo.options.includes('LOVE'), JSON.stringify(mergeInfo.options));
    await evaluate(`(function () {
      const sel = document.querySelectorAll('.tx-panel')[1].querySelector('.tx-row .tx-merge');
      sel.value = 'NIGHT';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return 1;
    })()`);
    await sleep(900);
    const afterMerge = await json(`({
      tags: window.__tx.tags,
      names: [...document.querySelectorAll('.tx-panel')[1].querySelectorAll('.tx-row__name')].map((e) => e.textContent.trim()),
    })`);
    check('合并后 LOVE 消失、NIGHT 计数 3', afterMerge.names.includes('NIGHT') && !afterMerge.names.includes('LOVE') && afterMerge.tags.find((t) => t.name === 'NIGHT')?.count === 3, JSON.stringify(afterMerge.tags));
    check('合并前弹出确认', dialogs.some((d) => /Merge tag/.test(d)), JSON.stringify(dialogs));

    section('删除标签（生日防误删）');
    await evaluate(`(function () {
      const panel = document.querySelectorAll('.tx-panel')[1];
      const rows = [...panel.querySelectorAll('.tx-row')];
      const row = rows.find((r) => r.querySelector('.tx-row__name')?.textContent.trim() === 'SOLITUDE');
      row.querySelector('.btn-danger').click();
      return 1;
    })()`);
    await sleep(400);
    const guardOpen = await json(`!!document.querySelector('#delete-guard-password')`);
    check('删除标签弹出防误删弹窗', guardOpen === true);
    await evaluate(`(function () {
      const i = document.querySelector('#delete-guard-password');
      i.value = '2007-05-25';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return 1;
    })()`);
    await sleep(100);
    await evaluate(`[...document.querySelectorAll('.delete-guard__actions .btn')].find((b) => /Delete/.test(b.textContent)).click()`);
    await sleep(900);
    const afterDelete = await json(`({
      names: [...document.querySelectorAll('.tx-panel')[1].querySelectorAll('.tx-row__name')].map((e) => e.textContent.trim()),
      tags: window.__tx.tags.map((t) => t.name),
      postTags: window.__tx.posts.map((p) => p.tags),
    })`);
    check('标签从全部已发布文章移除', !afterDelete.names.includes('SOLITUDE') && !afterDelete.tags.includes('SOLITUDE')
      && afterDelete.postTags.every((tags) => !tags.includes('SOLITUDE')), JSON.stringify(afterDelete));

    section('多选批量归类');
    const postRows = await json(`({
      rows: document.querySelectorAll('.tx-post').length,
      selected: document.querySelector('.tx-bulk__count')?.textContent.trim(),
      firstTitle: document.querySelector('.tx-post__title')?.textContent.trim(),
      firstTags: [...document.querySelectorAll('.tx-post')[0].querySelectorAll('.tx-post__tag')].map((e) => e.textContent.trim()),
    })`);
    check('已发布文章列表渲染 4 行', postRows.rows === 4, JSON.stringify(postRows));
    check('文章行显示标题与标签', postRows.firstTitle === 'First Light' && postRows.firstTags.includes('NIGHT'), JSON.stringify(postRows));

    // 搜索过滤
    await evaluate(`(function () {
      const i = document.querySelector('.tx-search');
      i.value = 'third-light';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return 1;
    })()`);
    await sleep(200);
    const searchRows = await json(`document.querySelectorAll('.tx-post').length`);
    check('搜索按 slug 过滤到 1 行', searchRows === 1, String(searchRows));
    await evaluate(`(function () {
      const i = document.querySelector('.tx-search');
      i.value = '';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return 1;
    })()`);
    await sleep(200);

    // 全选
    await evaluate(`(function () {
      const cb = document.querySelector('.tx-check input');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      return 1;
    })()`);
    await sleep(200);
    const selectedAll = await json(`({
      count: document.querySelector('.tx-bulk__count')?.textContent.trim(),
      checks: [...document.querySelectorAll('.tx-post input')].filter((c) => c.checked).length,
      applied: document.querySelectorAll('.tx-post.is-selected').length,
    })`);
    check('Select all shown 选中全部 4 篇', /4 selected/.test(selectedAll.count) && selectedAll.checks === 4 && selectedAll.applied === 4, JSON.stringify(selectedAll));

    // 批量新建分类并应用
    await evaluate(`(function () {
      const sel = document.querySelectorAll('.tx-bulk__row')[1].querySelector('select');
      sel.value = '__new__';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return 1;
    })()`);
    await sleep(150);
    await evaluate(`(function () {
      const i = document.querySelector('.tx-bulk__row:nth-child(2) .tx-newinput');
      i.value = 'hymn';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return 1;
    })()`);
    await sleep(100);
    await evaluate(`document.querySelectorAll('.tx-bulk__row')[1].querySelector('.btn-primary').click()`);
    await sleep(900);
    const bulkCategory = await json(`({
      categories: window.__tx.posts.map((p) => p.category),
      summary: window.__tx.categories,
      notice: document.querySelector('.notice-line')?.textContent.trim(),
      selected: document.querySelector('.tx-bulk__count')?.textContent.trim(),
    })`);
    check('批量新建 HYMN 并应用到全部选中文章', bulkCategory.categories.every((c) => c === 'HYMN'), JSON.stringify(bulkCategory.categories));
    check('分类计数合并为 HYMN 4', bulkCategory.summary.length === 1 && bulkCategory.summary[0].name === 'HYMN' && bulkCategory.summary[0].count === 4, JSON.stringify(bulkCategory.summary));
    check('提示说明是新建并应用', /Created and applied/.test(bulkCategory.notice || ''), bulkCategory.notice);
    check('批量操作后仍保持 4 篇选中', /4 selected/.test(bulkCategory.selected || ''), bulkCategory.selected);

    // 批量加标签（新的 + 大的写）
    await evaluate(`(function () {
      const i = document.querySelector('.tx-newinput--tags');
      i.value = 'hope, calm';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return 1;
    })()`);
    await sleep(100);
    await evaluate(`document.querySelectorAll('.tx-bulk__row')[2].querySelector('.btn-primary').click()`);
    await sleep(900);
    const bulkTags = await json(`({
      tags: window.__tx.posts.map((p) => p.tags),
      notice: document.querySelector('.notice-line')?.textContent.trim(),
    })`);
    check('批量给每篇加 HOPE / CALM', bulkTags.tags.every((tags) => tags.includes('HOPE') && tags.includes('CALM')), JSON.stringify(bulkTags.tags));
    check('提示列出新加的标签', /HOPE/.test(bulkTags.notice || '') && /CALM/.test(bulkTags.notice || ''), bulkTags.notice);

    // 批量移除标签
    await evaluate(`(function () {
      const sel = document.querySelectorAll('.tx-bulk__row')[2].querySelector('select');
      sel.value = 'CALM';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return 1;
    })()`);
    await sleep(100);
    await evaluate(`document.querySelectorAll('.tx-bulk__row')[2].querySelector('.btn-danger').click()`);
    await sleep(900);
    const removeTags = await json(`({
      tags: window.__tx.posts.map((p) => p.tags),
      available: window.__tx.tags.map((t) => t.name),
    })`);
    check('批量移除 CALM 但保留 HOPE', removeTags.tags.every((tags) => !tags.includes('CALM') && tags.includes('HOPE')), JSON.stringify(removeTags));

    // 清空选择
    await evaluate(`[...document.querySelectorAll('.tx-bulk__row .btn-secondary')].find((b) => /Clear/.test(b.textContent)).click()`);
    await sleep(200);
    const cleared = await json(`document.querySelector('.tx-bulk__count')?.textContent.trim()`);
    check('Clear 清空选择', /0 selected/.test(cleared || ''), cleared);

    section('手机 390px');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await sleep(600);
    const mobile = await json(`(function () {
      const de = document.documentElement;
      const cols = getComputedStyle(document.querySelector('.tx-layout')).gridTemplateColumns;
      const small = [];
      for (const el of document.querySelectorAll('.tx-panel .btn, .tx-merge, .tx-rename__input, .tx-posts .btn, .tx-filter, .tx-search, .tx-newinput, .tx-check')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height < 44 || r.width < 44) small.push({ cls: el.className, w: Math.round(r.width), h: Math.round(r.height) });
      }
      return { sw: de.scrollWidth, cw: de.clientWidth, cols, small };
    })()`);
    check('手机无横向溢出', mobile.sw <= mobile.cw, `${mobile.sw} / ${mobile.cw}`);
    check('手机单列', mobile.cols.split(' ').length === 1, mobile.cols);
    check('粗指针下按钮 ≥44px', mobile.small.length === 0, JSON.stringify(mobile.small.slice(0, 5)));

    section('控制台');
    check('无控制台报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} 通过`);
    if (failed.length) {
      console.log('未通过:');
      for (const f of failed) console.log('  · ' + f.label);
    }
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    try { ws && ws.close(); } catch {}
    child.kill();
    await sleep(400);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
})();
