// ENTER WITHOUT MUSIC 验收。
//
//   cd app && npx vite preview --port 5188 --strictPort
//   node tools/verify-enter-no-music.mjs http://127.0.0.1:5188
//
// 三个场景：
//   A 只点 WITHOUT MUSIC → 进入站点，一次 play() 都不能发生
//   B 键盘 Enter 落在 WITHOUT MUSIC 上 → 同样不能起播（document 的 keydown
//     会先于 click 到达；这是之前漏掉的路径）
//   C 先点了背景（音乐已经起播）再点 WITHOUT MUSIC → 必须把已播放的音频暂停，
//     并且页面进入
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = process.argv[2] || 'http://127.0.0.1:5188/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const INJECT = `
(function () {
  window.__plays = 0;
  window.__pauses = 0;
  HTMLMediaElement.prototype.play = function () {
    window.__plays += 1;
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {
    window.__pauses += 1;
  };
})();
`;

async function withPage(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enter-music-'));
  const child = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1440,1000', 'about:blank',
  ], { stdio: 'ignore' });

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
    await new Promise((res, rej) => {
      ws.addEventListener('open', res);
      ws.addEventListener('error', rej);
    });

    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errors.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
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
      const r = await send('Runtime.evaluate', { expression, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval failed');
      return r.result?.value;
    };
    const load = async () => {
      await send('Page.navigate', { url: new URL('/', APP).href });
      await sleep(3200);
      for (let i = 0; i < 30; i++) {
        const ready = await evalJs("(function(){var b=document.querySelector('.brand__enter--quiet');return !!b && b.offsetParent!==null})()");
        if (ready) return;
        await sleep(200);
      }
      throw new Error('brand quiet button did not appear');
    };
    const state = async () => JSON.parse(await evalJs(`JSON.stringify({
      plays: window.__plays,
      pauses: window.__pauses,
      brandGone: !document.querySelector('.brand') || document.querySelector('.brand').classList.contains('is-gone'),
      playIcon: document.querySelector('.play-icon')?.style.display,
    })`));

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
    const result = await fn({ send, evalJs, load, state, sleep });
    ws.close();
    return result;
  } finally {
    child.kill();
    await sleep(300);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

await withPage(async ({ send, evalJs, load, state, sleep }) => {
  console.log('A · mouse click only');
  await load();
  await evalJs("document.querySelector('.brand__enter--quiet').click()");
  await sleep(3200);
  const a = await state();
  console.log('  state:', a);
  if (!a.brandGone) throw new Error('quiet entry did not leave the brand overlay');
  if (a.plays !== 0) throw new Error(`quiet entry called play() ${a.plays} time(s)`);
  if (a.playIcon !== 'block') throw new Error('play icon should show paused after quiet entry');

  console.log('B · keyboard Enter on the quiet button');
  await load();
  const b = await evalJs(`(function () {
    var btn = document.querySelector('.brand__enter--quiet');
    btn.focus();
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    btn.click();
    return 1;
  })()`);
  if (!b) throw new Error('keyboard scenario setup failed');
  await sleep(3200);
  const bs = await state();
  console.log('  state:', bs);
  if (!bs.brandGone) throw new Error('keyboard quiet entry did not leave the overlay');
  if (bs.plays !== 0) throw new Error(`keyboard quiet entry called play() ${bs.plays} time(s)`);

  console.log('C · background click first, then quiet entry');
  await load();
  await evalJs("document.querySelector('.brand').click()");
  await sleep(500);
  const started = await state();
  console.log('  after background:', started);
  if (started.plays !== 1) throw new Error(`background click should start playback once, got ${started.plays}`);
  if (started.playIcon !== 'none') throw new Error('background click should switch the play icon to pause');
  await evalJs("document.querySelector('.brand__enter--quiet').click()");
  await sleep(3200);
  const c = await state();
  console.log('  after quiet:', c);
  if (!c.brandGone) throw new Error('quiet entry after background did not leave the overlay');
  if (c.plays !== 1) throw new Error(`quiet entry should not start a second playback, got ${c.plays}`);
  if (c.pauses < 1) throw new Error('quiet entry did not pause the already-playing audio');
  if (c.playIcon !== 'block') throw new Error('play icon should show paused after quiet entry');
});

if (errors.length) throw new Error(`console errors:\n${errors.join('\n')}`);
console.log('\nALL PASS');
