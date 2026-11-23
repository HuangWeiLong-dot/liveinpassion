// CMS（admin/）打字机验收：Typewriter Nocturne 的 3D 打字机与打字音效。
//
//   cd admin && npm run dev          # http://localhost:5174/admin/
//   node tools/verify-admin-nocturne.mjs [http://localhost:5174/admin]
//
// 断言的是"机器真的在跟着光标走、真的在响"，不是"组件挂上了"：
//   · 舞台进入 Nocturne 模式后，3D 模型编译完并画出（dataset.machine = drawn）
//   · 打字时打字头跟着光标移动（车架位置 ≈ 光标位置）
//   · 每次按键都真的开始一个音频缓冲源（AudioContext.createBufferSource 计数）
//   · Enter 让压纸滚筒前进一格，空格 / 退格各有自己的声音
//   · 关掉声音后按键不再发声；关掉 Nocturne 后舞台收起、模型画布隐藏，再打开能恢复
//   · 手机宽度下不横向溢出，机器仍然画出来
//
// 本地 dev 没有 D1/R2，/api/admin/* 全部打桩（与 verify-admin-mobile.mjs 同一套写法）。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const baseUrl = (process.argv[2] || 'http://localhost:5174/admin').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INJECT = `
(function () {
  const POST = {
    id: 1, slug: 'nocturne-demo', cardTitle: 'NOCTURNE', title: 'Nocturne Demo',
    status: 'draft', publishedAt: null, createdAt: Date.now(), readTimeMin: 3,
    coverKey: '', coverFullKey: '',
    contentMd: '# Nocturne\\n\\nThe type head rides the rail.\\n\\nA second paragraph, long enough to wrap.\\n',
  };
  const routes = [
    [/\\/api\\/admin\\/posts\\/\\d+$/, () => POST],
    [/\\/api\\/admin\\/posts$/, () => ({ posts: [POST] })],
  ];
  const orig = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    for (const [re, make] of routes) {
      if (re.test(url)) {
        return Promise.resolve(new Response(JSON.stringify(make(init)), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
    }
    return orig.apply(this, arguments);
  };
  // 打字音效的探针：数一数真正开始的音频缓冲源（离线渲染用的是 OfflineAudioContext，不算）
  window.__sounds = 0;
  const original = AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource = function () {
    window.__sounds += 1;
    return original.apply(this, arguments);
  };
})();
`;

let id = 0;
const pending = new Map();
const handlers = new Map();
let ws;
const send = (method, params = {}, timeoutMs = 20000) => {
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
const until = async (expr, timeout = 12000, every = 200) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expr)) return true;
    await sleep(every);
  }
  return false;
};

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
};
const section = (t) => console.log(`\n${t}`);

async function key(desc) {
  await send('Input.dispatchKeyEvent', desc);
}
async function typeText(text) {
  for (const ch of text) {
    const code = ch === ' ' ? 'Space' : `Key${ch.toUpperCase()}`;
    const keyCode = ch === ' ' ? 32 : ch.toUpperCase().charCodeAt(0);
    await key({ type: 'keyDown', key: ch, code, text: ch, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    await key({ type: 'keyUp', key: ch, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    await sleep(60);
  }
}
async function pressKey(keyName, code, keyCode) {
  await key({ type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await key({ type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await sleep(80);
}
async function click(sel) {
  const box = await json(`(function () {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!box) throw new Error('找不到元素: ' + sel);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(250);
}

const state = async () => json(`(function () {
  const stage = document.querySelector('.tn-stage');
  const canvas = document.querySelector('.tn-machine');
  const inst = stage && stage.__nocturne;
  const r = stage ? stage.getBoundingClientRect() : null;
  const c = canvas ? canvas.getBoundingClientRect() : null;
  return {
    live: Boolean(stage && stage.classList.contains('is-live')),
    stage: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
    canvasShown: Boolean(c && c.width > 0 && c.height > 0 && getComputedStyle(canvas).display !== 'none'),
    drawn: Boolean(stage && stage.dataset.machine === 'drawn'),
    built: Boolean(stage && stage.dataset.machine),
    headX: inst ? Math.round(inst.carriage.position) : null,
    targetX: inst ? Math.round(inst.targetX) : null,
    platenTarget: inst ? Math.round(inst.platenTarget) : null,
    soundOn: (function () {
      const b = document.querySelector('.ns-toggle');
      return b ? b.classList.contains('is-on') : null;
    })(),
    sounds: window.__sounds | 0,
    textH: (function () {
      const el = document.querySelector('.tn-stage.is-live .md-editor');
      return el ? Math.round(el.getBoundingClientRect().height) : 0;
    })(),
  };
})()`);

(async () => {
  const port = 9900 + Math.floor(Math.random() * 40);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-nocturne-prof-'));
  const child = spawn(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
     '--no-first-run', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-extensions',
     '--window-size=1440,1000', 'about:blank'],
    { stdio: 'ignore' }
  );
  const errors = [];
  try {
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch {}
      if (!ready) await sleep(250);
    }
    if (!ready) throw new Error('Chrome 没有起来');
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.rej(new Error(JSON.stringify(msg.error))); else p.res(msg.result);
      } else if (msg.method) {
        (handlers.get(msg.method) || []).forEach((f) => f(msg.params));
      }
    };
    on('Runtime.exceptionThrown', (p) => {
      errors.push('exception: ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || ''));
    });
    on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') {
        errors.push('console.error: ' + (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 240));
      }
    });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

    console.log(`\n打开 ${baseUrl}/blogs/1`);
    await send('Page.navigate', { url: `${baseUrl}/blogs/1` });

    section('舞台与 3D 机器');
    const live = await until(`Boolean(document.querySelector('.tn-stage.is-live'))`, 20000);
    check('Nocturne 舞台已挂载（.tn-stage.is-live）', live);
    const editor = await until(`Boolean(document.querySelector('.cm-content'))`, 15000);
    check('Markdown 编辑器已挂载（.cm-content）', editor);
    const wired = await until(`Boolean(document.querySelector('.tn-stage').__nocturne)`, 8000);
    check('舞台控制器已接到编辑器上（__nocturne）', wired);

    // 等模型编译完并画第一帧（SwiftShader 下要几秒）
    const drawn = await until(
      `Boolean(document.querySelector('.tn-stage') && document.querySelector('.tn-stage').dataset.machine === 'drawn')`,
      30000,
      300
    );
    let s = await state();
    check('3D 打字机已编译并画出（dataset.machine = drawn）', drawn, JSON.stringify({ built: s.built, canvas: s.canvasShown }));
    check('机器画布可见且铺满舞台', s.canvasShown && s.stage && s.stage.w > 400 && s.stage.h > 400, JSON.stringify(s.stage));
    check('稿纸里编辑器只占上半截（bail 上方留出机器）', s.textH > 150 && s.textH < s.stage.h, `text=${s.textH} stage=${s.stage.h}`);

    section('左右分栏：左边打字机 + 稿纸，右边打印出来的信');
    const letter = await json(`(function () {
      const panel = document.querySelector('.letter-panel');
      const sheet = document.querySelector('.letter-sheet');
      const head = document.querySelector('.letter-head .letter-brand');
      const body = document.querySelector('.letter-sheet .md-editor-preview');
      const stage = document.querySelector('.tn-stage');
      if (!panel || !sheet || !stage) return null;
      const p = panel.getBoundingClientRect();
      const st = stage.getBoundingClientRect();
      return {
        panelVisible: getComputedStyle(panel).display !== 'none',
        sideBySide: p.left >= st.right - 4 && Math.abs(p.height - st.height) < 4,
        brand: head ? head.textContent.trim() : '',
        hasBody: Boolean(body && body.textContent.trim().length > 20),
        mainPreviewCount: document.querySelectorAll('.editor-main .md-editor-preview').length,
      };
    })()`);
    check('信件面板在右侧、与舞台等高并排', Boolean(letter && letter.panelVisible && letter.sideBySide), JSON.stringify(letter && { sideBySide: letter.sideBySide }));
    check('信头写 LIVEINPASSION，正文是渲染好的 Markdown', Boolean(letter && letter.brand === 'LIVEINPASSION' && letter.hasBody), JSON.stringify(letter && { brand: letter.brand, hasBody: letter.hasBody }));
    check('打字机那一栏不再自带分栏预览', Boolean(letter && letter.mainPreviewCount === 0), JSON.stringify(letter && { mainPreviewCount: letter.mainPreviewCount }));

    section('Lint：点击开关 + 实时检测');
    const lintState = async () => json(`(function () {
      const btn = document.querySelector('.lint-toggle');
      const panel = document.querySelector('.lint-panel');
      return {
        label: btn ? btn.textContent.trim().replace(/\\s+/g, ' ') : '',
        on: btn ? btn.getAttribute('aria-pressed') === 'true' : false,
        panel: Boolean(panel),
        issues: panel ? panel.querySelectorAll('.lint-item').length : 0,
      };
    })()`);
    const lintBefore = await lintState();
    check('默认 Lint 关闭：按钮写 off、面板不在', lintBefore.on === false && lintBefore.panel === false && /off$/i.test(lintBefore.label), JSON.stringify(lintBefore));
    await click('.lint-toggle');
    await sleep(450);
    const lintAfter = await lintState();
    check('点击后 Lint 打开：面板出现', lintAfter.on === true && lintAfter.panel === true, JSON.stringify(lintAfter));
    // 通过编辑器视图在文末补一个错字，等实时检查跑完
    await evaluate(`(function () {
      const stage = document.querySelector('.tn-stage');
      const view = stage && stage.__nocturne && stage.__nocturne.getView();
      if (!view) return false;
      view.dispatch({ changes: { from: view.state.doc.length, insert: '\\n\\nteh cat' } });
      return true;
    })()`);
    // 没有防抖：一次改动后 150ms 内就必须看到新问题
    await sleep(150);
    const lintTyped = await lintState();
    check('实时检测：输入后 150ms 内问题数就更新', lintTyped.issues > lintAfter.issues, `${lintAfter.issues} → ${lintTyped.issues}`);
    check('按钮摘要跟着更新（不是 clean）', /issue/i.test(lintTyped.label), lintTyped.label);
    await click('.lint-toggle');
    await sleep(350);
    const lintOff = await lintState();
    check('再点一下关闭：面板收起、检测停止', lintOff.on === false && lintOff.panel === false, JSON.stringify(lintOff));

    section('打字：声音与打字头');
    await click('.cm-content');
    const before = await state();
    const beforeSounds = before.sounds;
    await typeText('typewriter');
    await sleep(900);
    const after = await state();
    check('每次按键都开始一次音频缓冲源（音效真的在放）',
      after.sounds - beforeSounds >= 8, `${beforeSounds} → ${after.sounds}`);
    check('打字头跟着光标移动', after.headX !== null && after.headX > before.headX + 10,
      `head ${before.headX} → ${after.headX}`);
    check('打字头落位到光标处（|head - target| ≤ 2px）',
      after.headX !== null && Math.abs(after.headX - after.targetX) <= 2,
      `${after.headX} vs ${after.targetX}`);
    const beforeEnter = after;
    await pressKey('Enter', 'Enter', 13);
    await sleep(600);
    const afterEnter = await state();
    check('Enter 让压纸滚筒前进一格（+10°）',
      afterEnter.platenTarget === beforeEnter.platenTarget + 10,
      `${beforeEnter.platenTarget} → ${afterEnter.platenTarget}`);
    check('Enter 也有自己的声音', afterEnter.sounds >= beforeEnter.sounds + 1,
      `${beforeEnter.sounds} → ${afterEnter.sounds}`);
    check('回车后打字头回到行首（target 比刚才小）', afterEnter.targetX < after.targetX,
      `${after.targetX} → ${afterEnter.targetX}`);
    await pressKey(' ', 'Space', 32);
    await pressKey('Backspace', 'Backspace', 8);
    await sleep(400);
    const afterEdits = await state();
    check('空格 / 退格也各发一次声', afterEdits.sounds >= afterEnter.sounds + 2,
      `${afterEnter.sounds} → ${afterEdits.sounds}`);

    section('声音开关');
    await click('.ns-toggle');
    await sleep(300);
    const muted = await state();
    check('声音按钮已切到 MUTED', muted.soundOn === false);
    const mutedSounds = muted.sounds;
    await click('.cm-content');
    await typeText('quiet');
    await sleep(700);
    const stillMuted = await state();
    check('关掉声音后按键不再发声', stillMuted.sounds === mutedSounds, `${mutedSounds} → ${stillMuted.sounds}`);
    await click('.ns-toggle');
    await sleep(300);
    check('再打开声音后按钮恢复 SOUND ON', (await state()).soundOn === true);

    section('Nocturne 开关');
    await click('.nocturne-toggle');
    await sleep(500);
    const off = await json(`(function () {
      const stage = document.querySelector('.tn-stage');
      const canvas = document.querySelector('.tn-machine');
      return {
        live: stage.classList.contains('is-live'),
        canvasHidden: getComputedStyle(canvas).display === 'none',
        height: Math.round(stage.getBoundingClientRect().height),
        editorHeight: Math.round(document.querySelector('.md-editor').getBoundingClientRect().height),
      };
    })()`);
    check('关掉 Nocturne：舞台收起、机器画布隐藏', !off.live && off.canvasHidden, JSON.stringify(off));
    check('关掉后编辑器回到原来的 62vh 高度', off.editorHeight > 400, `editor=${off.editorHeight}`);
    await click('.nocturne-toggle');
    await sleep(600);
    const backOn = await until(
      `Boolean(document.querySelector('.tn-stage.is-live') && document.querySelector('.tn-stage').dataset.machine === 'drawn')`,
      15000
    );
    check('再打开 Nocturne：舞台和模型都回来了', backOn);

    section('站点明暗切换');
    // 书房不跟着后台上色：切浅色 / 切回深色后，稿纸仍是象牙色，机器仍在。
    const paperColor = () => `getComputedStyle(document.querySelector('.tn-sheet')).backgroundColor`;
    const ivory = await evaluate(paperColor());
    await click('.theme-toggle');
    await sleep(900);
    const inLight = await evaluate(paperColor());
    const lightState = await state();
    check('切到浅色后台：舞台与机器仍在', lightState.live && lightState.drawn);
    check('稿纸仍是暖象牙色（不是黑白稿纸）', ivory === inLight, `${ivory} / ${inLight}`);
    await click('.theme-toggle');
    await sleep(900);
    const inDark = await evaluate(paperColor());
    const darkState = await state();
    check('切回深色后台：舞台与机器仍在', darkState.live && darkState.drawn);
    check('深色后台下稿纸也不变黑', ivory === inDark, `${ivory} / ${inDark}`);

    section('手机宽度');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(1200);
    const phone = await json(`(function () {
      const de = document.documentElement;
      return {
        overflow: de.scrollWidth - de.clientWidth,
        stage: (function () {
          const r = document.querySelector('.tn-stage').getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        })(),
        textH: Math.round(document.querySelector('.tn-stage.is-live .md-editor').getBoundingClientRect().height),
        drawn: document.querySelector('.tn-stage').dataset.machine === 'drawn',
        canvas: (function () {
          const c = document.querySelector('.tn-machine').getBoundingClientRect();
          return { w: Math.round(c.width), h: Math.round(c.height) };
        })(),
        letterHidden: (function () {
          const el = document.querySelector('.letter-panel');
          return !el || getComputedStyle(el).display === 'none';
        })(),
      };
    })()`);
    check('手机宽度下不横向溢出', phone.overflow <= 1, `overflow=${phone.overflow}`);
    check('手机上编辑器仍可用（>180px 高）', phone.textH > 180, `text=${phone.textH}`);
    check('手机上机器仍然画出', phone.drawn && phone.canvas.w > 300,
      JSON.stringify({ canvas: phone.canvas, stage: phone.stage }));
    check('手机上收起信件，编辑区独占整行', phone.letterHidden);

    section('控制台');
    check('零 console.error / 未捕获异常', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (error) {
    console.error('\n验收脚本中断:', error.message);
    results.push({ label: '脚本执行', ok: false });
  } finally {
    try { await send('Browser.close'); } catch {}
    try { child.kill(); } catch {}
    await sleep(400);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) {
    console.log('失败：' + failed.map((r) => r.label).join('、'));
    process.exit(1);
  }
})();
