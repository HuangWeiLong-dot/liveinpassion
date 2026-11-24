// CMS 手机端验收：导航菜单 + Posts 列表滚动恢复 + 编辑器内保存不跳走。
// 用法：先起 admin dev（vite），再 node tools/verify-admin-scroll.mjs http://localhost:5173/admin
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = (process.argv[2] || 'http://localhost:5173/admin').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INJECT = `
(function () {
  const makePost = (id) => ({
    id, slug: 'post-' + id, cardTitle: 'POST ' + String(id).padStart(2, '0'),
    title: 'Post ' + id, status: 'published',
    publishedAt: '2026-10-' + String(10 + (id % 18)).padStart(2, '0') + ' 10:00:00',
    createdAt: '2026-10-01 10:00:00', readTimeMin: 3,
    coverKey: '', coverFullKey: '', coverCredit: '', coverCreditUrl: '',
    category: id % 2 ? 'POEM' : 'ESSAY', tags: ['LOVE', 'NIGHT'],
    contentMd: '# Heading\\n\\n' + Array.from({ length: 40 }, (_, i) => 'Line ' + i + ' of the body.').join('\\n\\n'),
  });
  const POSTS = Array.from({ length: 24 }, (_, i) => makePost(i + 1));
  window.__posts = POSTS;
  const json = (obj) => Promise.resolve(new Response(JSON.stringify(obj), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
  const orig = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init && init.method) || 'GET';
    if (url.indexOf('/api/admin/posts') !== -1) {
      if (method === 'PUT' || method === 'PATCH' || method === 'DELETE') return json({ ok: true });
      if (url.indexOf('/api/admin/posts/') !== -1) {
        const id = Number(url.split('/').pop().split('?')[0]);
        return json(POSTS.find((p) => p.id === id) || POSTS[0]);
      }
      return json({ posts: POSTS });
    }
    return orig.apply(this, arguments);
  };
})();
`;

let id = 0; const pending = new Map(); const handlers = new Map(); let ws;
const send = (method, params = {}, timeout = 15000) => new Promise((res, rej) => {
  const i = ++id; const t = setTimeout(() => { if (pending.delete(i)) rej(new Error('timeout ' + method)); }, timeout);
  pending.set(i, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const on = (m, f) => { if (!handlers.has(m)) handlers.set(m, []); handlers.get(m).push(f); };
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
};
const json = async (expr) => JSON.parse(await evaluate(`JSON.stringify(${expr})`));
const results = [];
const check = (label, ok, detail = '') => { results.push({ label, ok }); console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`); };

const port = 9970 + Math.floor(Math.random() * 20);
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-scroll-'));
const child = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--disable-gpu', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
try {
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) { try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch {} if (!ready) await sleep(250); }
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method && handlers.has(m.method)) for (const f of handlers.get(m.method)) f(m.params);
  });
  await send('Page.enable'); await send('Runtime.enable');
  const consoleErrors = [];
  on('Runtime.exceptionThrown', (p) => consoleErrors.push(p.exceptionDetails?.text || 'exception'));
  on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') consoleErrors.push(p.args.map((a) => a.value || a.description).join(' ')); });
  on('Page.javascriptDialogOpening', () => send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });

  const goto = async (p, wait = 1800) => {
    const loaded = new Promise((res) => on('Page.loadEventFired', res));
    await send('Page.navigate', { url: BASE + p });
    await Promise.race([loaded, sleep(10000)]);
    await sleep(wait);
  };

  console.log('\n列表 → 编辑器 → 返回');
  await goto('/');
  const listInfo = await json(`({ h: document.documentElement.scrollHeight, rows: document.querySelectorAll('.post-row').length })`);
  check('列表有足够长度可滚动', listInfo.rows >= 20 && listInfo.h > 2000, JSON.stringify(listInfo));
  await evaluate(`window.scrollTo(0, 900); 1`);
  await sleep(300);
  const before = await json(`window.scrollY`);
  check('列表已滚到 900', Math.abs(before - 900) < 5, String(before));
  await evaluate(`document.querySelector('.post-row__title').click(); 1`);
  await sleep(1800);
  const onEditor = await json(`({ path: location.pathname, title: document.querySelector('.page-head h1')?.textContent.trim() })`);
  check('进入编辑器', onEditor.path.indexOf('/blogs/') !== -1, JSON.stringify(onEditor));
  await evaluate(`(function () {
    const b = [...document.querySelectorAll('button')].find((x) => /Back to Posts/.test(x.textContent));
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(1800);
  const afterBack = await json(`({ path: location.pathname, y: Math.round(window.scrollY), rows: document.querySelectorAll('.post-row').length })`);
  check('返回列表后仍在列表页', afterBack.path.indexOf('/blogs/') === -1 && afterBack.rows >= 20, JSON.stringify(afterBack));
  check('返回列表后滚动位置恢复到 900 附近', Math.abs(afterBack.y - 900) < 40, JSON.stringify(afterBack));

  console.log('\n编辑器内保存不跳走、不重置滚动');
  await evaluate(`window.scrollTo(0, 900); 1`); await sleep(200);
  await evaluate(`document.querySelector('.post-row__title').click(); 1`);
  await sleep(1800);
  await evaluate(`window.scrollTo(0, 1200); 1`); await sleep(300);
  const editorY = await json(`Math.round(window.scrollY)`);
  check('编辑器已滚到 1200', Math.abs(editorY - 1200) < 5, String(editorY));
  await evaluate(`(function () {
    const b = [...document.querySelectorAll('.action-bar__btns .btn')].find((x) => /Update/.test(x.textContent));
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(900);
  const afterUpdate = await json(`({
    path: location.pathname, y: Math.round(window.scrollY),
    toast: document.querySelector('.save-toast')?.textContent.trim() || '',
  })`);
  check('Update 后仍留在编辑器', afterUpdate.path.indexOf('/blogs/') !== -1, JSON.stringify(afterUpdate));
  check('Update 后滚动位置不变', Math.abs(afterUpdate.y - editorY) < 10, JSON.stringify(afterUpdate));
  check('Update 后出现保存提示', /Updated/.test(afterUpdate.toast), afterUpdate.toast);

  await evaluate(`(function () {
    const b = [...document.querySelectorAll('.action-bar__btns .btn')].find((x) => /Save changes/.test(x.textContent));
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(1200);
  const afterSave = await json(`({
    path: location.pathname, y: Math.round(window.scrollY),
    toast: document.querySelector('.save-toast')?.textContent.trim() || '',
  })`);
  check('Save changes 后仍留在编辑器', afterSave.path.indexOf('/blogs/') !== -1, JSON.stringify(afterSave));
  check('Save changes 后滚动位置不变', Math.abs(afterSave.y - editorY) < 10, JSON.stringify(afterSave));
  check('Save changes 后出现保存提示', /Updated/.test(afterSave.toast), afterSave.toast);

  console.log('\n手机导航菜单');
  await evaluate(`document.querySelector('.nav-menu-toggle').click(); 1`);
  await sleep(350);
  const menu = await json(`(function () {
    const links = document.querySelector('.nav-links');
    const items = [...document.querySelectorAll('.nav-item, .theme-toggle')].filter((e) => {
      const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0;
    });
    return { open: getComputedStyle(links).display !== 'none', count: items.length,
             inView: items.every((e) => { const r = e.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1; }),
             navH: Math.round(document.querySelector('.admin-nav').getBoundingClientRect().height) };
  })()`);
  check('菜单打开后所有入口在视口内', menu.open && menu.inView && menu.count >= 7, JSON.stringify(menu));

  console.log('\n控制台');
  check('无控制台报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) { console.log('未通过:'); for (const f of failed) console.log('  · ' + f.label); }
  process.exitCode = failed.length ? 1 : 0;
} finally {
  try { ws && ws.close(); } catch {}
  child.kill(); await sleep(400);
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
}
