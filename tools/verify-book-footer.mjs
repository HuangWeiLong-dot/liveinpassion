// 分页书验收：最后一页有经典网站页脚，前面的页没有，长页滚到底也能看到。
// 用法：先起 app dev（vite），再 node tools/verify-book-footer.mjs http://localhost:5173
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = (process.argv[2] || 'http://localhost:4176').replace(/\/$/, '');
const SNAPSHOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app/src/data/content/blogPosts.json');
const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
const paginated = (snapshot.posts || []).find((p) => /class="[^"]*page-break/.test(p.body || ''));
if (!paginated) {
  console.error('Snapshot has no post with a page-break — cannot verify the book footer.');
  process.exit(1);
}
const SLUG = paginated.slug;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 0; const pending = new Map(); const handlers = new Map(); let ws;
const send = (method, params = {}, timeout = 15000) => new Promise((res, rej) => {
  const i = ++id; const t = setTimeout(() => { if (pending.delete(i)) rej(new Error('timeout ' + method)); }, timeout);
  pending.set(i, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const on = (m, f) => { if (!handlers.has(m)) handlers.set(m, []); handlers.get(m).push(f); };
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
};
const json = async (expr) => JSON.parse(await evaluate(`JSON.stringify(${expr})`));
const results = [];
const check = (label, ok, detail = '') => { results.push({ label, ok }); console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`); };

const port = 9960 + Math.floor(Math.random() * 20);
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'book-footer-'));
const child = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--disable-gpu', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const loaded = new Promise((res) => on('Page.loadEventFired', res));
  await send('Page.navigate', { url: `${BASE}/echoes/${SLUG}` });
  await Promise.race([loaded, sleep(12000)]);
  await sleep(1600);
  const enter = await json(`!!document.querySelector('.brand__enter:not(.brand__enter--quiet)')`);
  if (enter) {
    await evaluate(`document.querySelector('.brand__enter:not(.brand__enter--quiet)').click(); 1`);
    await sleep(1200);
    // 首屏如果进入全站预载，点 SKIP 直接进站，别让遮罩盖住后面的截图
    for (let i = 0; i < 20; i++) {
      const skip = await json(`!!document.querySelector('.brand__skip')`);
      if (skip) {
        await evaluate(`document.querySelector('.brand__skip').click(); 1`);
        break;
      }
      const gone = await json(`!document.querySelector('.brand') || getComputedStyle(document.querySelector('.brand')).display === 'none'`);
      if (gone) break;
      await sleep(400);
    }
    await sleep(1500);
  }
  for (let i = 0; i < 30; i++) {
    if (await json(`!!document.querySelector('.bd-book')`)) break;
    await sleep(300);
  }
  await sleep(700);

  console.log('\n分页书结构');
  const book = await json(`(function () {
    const stamp = document.querySelector('.bd-book__stamp');
    return {
      found: !!document.querySelector('.bd-book'),
      stamp: stamp ? stamp.textContent.replace(/\\s+/g, ' ').trim() : '',
      pages: document.querySelectorAll('.bd-book__leaf .bd-book__body').length,
      next: !!document.querySelector('.bd-book__btn:not([disabled])'),
    };
  })()`);
  check('进入分页书模式', book.found === true, JSON.stringify(book));

  const total = Number((book.stamp.match(/\/\s*(\d+)/) || [])[1] || 0);
  check('读到总页数', total > 1, `${total} (${book.stamp})`);

  console.log('\n前面的页没有页脚');
  const first = await json(`({
    colophon: document.querySelectorAll('.bd-book__leaf .bd-book__colophon').length,
    footer: document.querySelectorAll('.bd-book__leaf .site-footer').length,
    stamp: document.querySelector('.bd-book__stamp')?.textContent.trim(),
  })`);
  check('第一页不渲染页脚', first.colophon === 0 && first.footer === 0, JSON.stringify(first));

  console.log('\n翻到最后一页');
  for (let i = 0; i < total + 2; i++) {
    const hasNext = await json(`[...document.querySelectorAll('.bd-book__btn')].some((b) => /Next/.test(b.textContent) && !b.disabled)`);
    if (!hasNext) break;
    await evaluate(`[...document.querySelectorAll('.bd-book__btn')].find((b) => /Next/.test(b.textContent) && !b.disabled).click(); 1`);
    await sleep(420);
  }
  await sleep(500);
  const last = await json(`(function () {
    const leaf = document.querySelector('.bd-book__leaf');
    const col = leaf?.querySelector('.bd-book__colophon');
    const foot = leaf?.querySelector('.site-footer.is-compact');
    const content = leaf?.querySelector('.bd-book__content');
    const stamp = document.querySelector('.bd-book__stamp')?.textContent.replace(/\\s+/g, ' ').trim();
    let rect = null;
    if (foot) { const r = foot.getBoundingClientRect(); rect = { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) }; }
    return {
      stamp,
      colophon: !!col,
      footer: !!foot,
      text: foot ? foot.textContent.replace(/\\s+/g, ' ').trim().slice(0, 120) : '',
      rect,
      contentScrollable: content ? content.scrollHeight > content.clientHeight + 2 : false,
      contentH: content ? { sh: content.scrollHeight, ch: content.clientHeight } : null,
      underColophon: document.querySelectorAll('.bd-book__under .bd-book__colophon').length,
      nextDisabled: [...document.querySelectorAll('.bd-book__btn')].find((b) => /Next/.test(b.textContent))?.disabled,
    };
  })()`);
  check('停在最后一页', /\/\s*\d+/.test(last.stamp || '') && last.nextDisabled === true, JSON.stringify({ stamp: last.stamp, nextDisabled: last.nextDisabled }));
  check('最后一页渲染页脚插槽', last.colophon === true && last.footer === true, JSON.stringify({ colophon: last.colophon, footer: last.footer }));
  check('页脚内容是经典字标 + 三句 Be + 版权', /LIVEINPASSION/.test(last.text) && /Be Brave/.test(last.text) && /Be Genuine/.test(last.text) && /Be Humble/.test(last.text) && /© 2026/.test(last.text), last.text);
  check('页脚有实际尺寸', last.rect && last.rect.w > 200 && last.rect.h > 40, JSON.stringify(last.rect));
  check('under 纸面没有残留页脚', last.underColophon === 0, String(last.underColophon));

  // 如果是长页，滚到页底，确认页脚真的可达
  const reachable = await json(`(function () {
    const leaf = document.querySelector('.bd-book__leaf');
    const content = leaf?.querySelector('.bd-book__content');
    const foot = leaf?.querySelector('.site-footer.is-compact');
    if (!content || !foot) return { found: false };
    content.scrollTop = content.scrollHeight;
    const r = foot.getBoundingClientRect();
    const paper = document.querySelector('.bd-book__paper').getBoundingClientRect();
    return { found: true, visible: r.bottom <= paper.bottom + 1 && r.top < paper.bottom, top: Math.round(r.top), paperBottom: Math.round(paper.bottom) };
  })()`);
  check('滚到页底后页脚可见（长页也可达）', reachable.found && reachable.visible, JSON.stringify(reachable));


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
