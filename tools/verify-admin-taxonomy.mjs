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
    posts: 9,
    categories: [
      { name: 'POEM', count: 5 },
      { name: 'ESSAY', count: 3 },
      { name: 'UNFILED', count: 1 },
    ],
    tags: [
      { name: 'LOVE', count: 4 },
      { name: 'NIGHT', count: 3 },
      { name: 'SOLITUDE', count: 2 },
    ],
  };
  window.__tx = state;
  const jsonResponse = (obj, status) => Promise.resolve(new Response(JSON.stringify(obj), {
    status: status || 200, headers: { 'Content-Type': 'application/json' },
  }));
  function rename(list, from, to) {
    const src = list.find((x) => x.name === from);
    if (!src) return 0;
    const dst = list.find((x) => x.name === to);
    if (dst) dst.count += src.count;
    else list.push({ name: to, count: src.count });
    list.splice(list.indexOf(src), 1);
    return src.count;
  }
  function drop(list, name) {
    const src = list.find((x) => x.name === name);
    if (!src) return 0;
    list.splice(list.indexOf(src), 1);
    return src.count;
  }
  const orig = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init && init.method) || 'GET';
    if (url.indexOf('/api/admin/taxonomy') === 0) {
      const body = init && init.body ? JSON.parse(init.body) : {};
      if (method === 'GET') return jsonResponse(state);
      if (url === '/api/admin/taxonomy/category' && method === 'PUT') {
        const n = rename(state.categories, body.from, body.to);
        return jsonResponse({ ok: true, affected: n });
      }
      if (url === '/api/admin/taxonomy/tag' && method === 'PUT') {
        const n = rename(state.tags, body.from, body.to);
        return jsonResponse({ ok: true, affected: n });
      }
      if (url === '/api/admin/taxonomy/category' && method === 'DELETE') {
        const n = rename(state.categories, body.name, 'UNFILED');
        return jsonResponse({ ok: true, affected: n });
      }
      if (url === '/api/admin/taxonomy/tag' && method === 'DELETE') {
        return jsonResponse({ ok: true, affected: drop(state.tags, body.name) });
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
    check('Meta 统计 9 published / 3 categories / 3 tags', /9 Published/.test(head.meta) && /3 Categories/.test(head.meta) && /3 Tags/.test(head.meta), head.meta);
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
      stored: window.__tx.categories.map((c) => c.name),
    })`);
    check('重命名后列表变成 VERSE 且保留 5 篇', afterRename.names.includes('VERSE') && !afterRename.names.includes('POEM'), JSON.stringify(afterRename.names));
    check('重命名落到已发布文章（stub 收到 PUT）', afterRename.stored.includes('VERSE') && !afterRename.stored.includes('POEM'), JSON.stringify(afterRename.stored));
    check('成功提示显示受影响篇数', /5 published posts/.test(afterRename.notice || ''), afterRename.notice);

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
    check('合并后 LOVE 消失、NIGHT 计数 7', afterMerge.names.includes('NIGHT') && !afterMerge.names.includes('LOVE') && afterMerge.tags.find((t) => t.name === 'NIGHT')?.count === 7, JSON.stringify(afterMerge.tags));
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
    })`);
    check('标签从全部已发布文章移除', !afterDelete.names.includes('SOLITUDE') && !afterDelete.tags.includes('SOLITUDE'), JSON.stringify(afterDelete));

    section('手机 390px');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await sleep(600);
    const mobile = await json(`(function () {
      const de = document.documentElement;
      const cols = getComputedStyle(document.querySelector('.tx-layout')).gridTemplateColumns;
      const small = [];
      for (const el of document.querySelectorAll('.tx-panel .btn, .tx-merge, .tx-rename__input')) {
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
