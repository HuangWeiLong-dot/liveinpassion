// ORGANIZATION 页验收：一屏一页的翻页行为、内容装得下、字体与基调。
//
//   cd app && npx vite --port 5199 --strictPort
//   node tools/verify-organization.mjs
//
// 断言的是"行为"，不是像素：
//   · 八屏，任何时刻**只有一屏可见**（这是这一页的核心约束）
//   · 文档不滚动（scrollHeight ≤ 视口高、scrollY 恒为 0）
//   · 滚轮 / 一次手势只翻一页 / 点击空白翻页 / 点击链接不翻页
//   · 方向键、Home/End、右边缘页码跳转
//   · 手机上下滑翻页
//   · 每屏内容都装得下（scrollHeight ≤ clientHeight），四种窗口尺寸
//   · 标题是 LIVE IN PASSION（不是 LIVING），字体仍是 Oswald / Poppins / JetBrains Mono
//   · reduced-motion 下仍然一屏一页
// 截图写到临时目录，路径会打印出来。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = process.argv[2] || 'http://127.0.0.1:5199/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 翻页冷却 620ms，步骤之间要等过它
const STEP = 760;

const failures = [];
function ok(name, cond, extra = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
  if (!cond) failures.push(name);
}

async function withPage({ width, height, mobile, label, reduced = false }, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'org-'));
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--disable-extensions',
    '--hide-scrollbars',
    `--window-size=${width},${height}`,
    'about:blank',
  ];
  if (mobile) args.push('--touch-events=enabled');
  const child = spawn(CHROME, args, { stdio: 'ignore' });

  const errors = [];
  try {
    let port = null;
    for (let i = 0; i < 100 && !port; i++) {
      try {
        // 这个文件是边写边读的，偶尔会读到半行（比如 "50"）——
        // 那种端口要么连不上、要么被 undici 当保留端口拒掉，必须重读
        const line = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0] || '';
        if (/^\d{4,5}$/.test(line.trim())) {
          const n = Number(line);
          if (n >= 1024) port = n;
        }
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
      } else if (m.method === 'Runtime.consoleAPICalled') {
        const text = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        if (m.params.type === 'error') {
          errors.push(text);
          console.log('  [console.error]', text);
        }
      } else if (m.method === 'Runtime.exceptionThrown') {
        errors.push(m.params.exceptionDetails?.text || 'exception');
        console.log('  [exception]', m.params.exceptionDetails?.text || '');
      }
    });

    const send = (method, params = {}) => new Promise((res, rej) => {
      const n = ++id;
      pending.set(n, { res, rej });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
    const evalJs = async (expression, awaitPromise = false) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate failed');
      return r.result?.value;
    };
    const shot = async (name) => {
      const out = path.join(os.tmpdir(), `org-${label}-${name}.png`);
      const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
      console.log('  screenshot:', out);
      return out;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: !!mobile,
    });
    if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    if (reduced) {
      await send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });
    }
    await send('Page.navigate', { url: new URL('/organization', APP).href });
    await sleep(1200);

    // 首屏品牌遮罩
    let enterVisible = false;
    for (let i = 0; i < 60 && !enterVisible; i++) {
      enterVisible = await evalJs(`(function () {
        var b = document.querySelector('.brand__enter');
        return !!b && b.offsetParent !== null;
      })()`);
      if (!enterVisible) await sleep(200);
    }
    if (enterVisible) {
      await evalJs("document.querySelector('.brand__enter').click()");
      for (let i = 0; i < 60; i++) {
        const gone = await evalJs("(function () { var b = document.querySelector('.brand'); return !b || b.classList.contains('is-gone'); })()");
        if (gone) break;
        await sleep(200);
      }
      await sleep(1600);
    }

    const result = await fn({ send, evalJs, shot, sleep, width, height, errors });
    ws.close();
    return result;
  } finally {
    child.kill();
    await sleep(300);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

// 注意：不能拿 scrollHeight 量"装不装得下" —— 内容比盒子高时是**上下均分**地溢出
// （flex 居中），盒子上方那一截不进 scrollHeight，量出来永远是 0。
// 这里直接量内层内容块的矩形，跟 .org-slide 的 padding 盒比。
const STATE = `(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll('.org-slide'));
  var visible = slides.map(function (e) {
    var c = getComputedStyle(e);
    return c.visibility !== 'hidden' && Number(c.opacity) > 0.02;
  });
  var doc = document.scrollingElement;
  var title = document.querySelector('.org-hero__title');
  var body = document.querySelector('.org-chapter__copy p');
  var mono = document.querySelector('.org-eyebrow');
  var hdr = document.querySelector('#header');
  var headerBottom = hdr ? hdr.getBoundingClientRect().bottom : 0;
  return JSON.stringify({
    count: slides.length,
    active: slides.findIndex(function (e) { return e.classList.contains('is-current'); }),
    visibleCount: visible.filter(Boolean).length,
    visible: visible,
    headerBottom: Math.round(headerBottom),
    // > 0 表示内容顶破了 padding 盒（上或下）。
    // 手机上底部还有一条浮着的 MobileDock，正文得停在它上面。
    fits: slides.map(function (s) {
      var inner = s.querySelector('.org-chapter, .org-hero__inner, .org-outro__inner');
      if (!inner) return 0;
      var b = inner.getBoundingClientRect();
      var sb = s.getBoundingClientRect();
      var cs = getComputedStyle(s);
      var top = sb.top + parseFloat(cs.paddingTop);
      var bottom = sb.bottom - parseFloat(cs.paddingBottom);
      var dock = document.querySelector('.dock-btn');
      if (dock && dock.offsetParent !== null) {
        bottom = Math.min(bottom, dock.getBoundingClientRect().top - 8);
      }
      // 上限留了多少（负数 = 还有余量）——顶部和底部取更紧的那边
      return Math.round(Math.max(top - b.top, b.bottom - bottom));
    }),
    // < 0 表示内容钻到了固定头部底下（导航栏重叠）
    navClear: slides.map(function (s) {
      var inner = s.querySelector('.org-chapter, .org-hero__inner, .org-outro__inner');
      if (!inner) return 999;
      return Math.round(headerBottom - inner.getBoundingClientRect().top);
    }),
    metaPosition: (function () {
      var m = document.querySelector('.org-chapter__meta');
      return m ? getComputedStyle(m).position : null;
    })(),
    docScrollable: doc.scrollHeight - window.innerHeight,
    docWide: doc.scrollWidth - window.innerWidth,
    scrollY: window.scrollY,
    railNow: document.querySelector('.org-rail__now').textContent.trim(),
    title: title ? title.innerText.replace(/\\s+/g, ' ').trim() : '',
    fonts: {
      title: title ? getComputedStyle(title).fontFamily : '',
      body: body ? getComputedStyle(body).fontFamily : '',
      mono: mono ? getComputedStyle(mono).fontFamily : '',
    },
  });
})()`;

const wheel = (dy) => `window.dispatchEvent(new WheelEvent('wheel', { deltaY: ${dy}, cancelable: true }))`;
const key = (k) => `window.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', cancelable: true }))`;
const clickStage = "document.querySelector('.org-stage').click()";
const clickRail = (i) => `document.querySelectorAll('.org-rail__tick')[${i}].click()`;

async function state(evalJs) {
  return JSON.parse(await evalJs(STATE));
}

async function expectSlide(evalJs, n, label) {
  const s = await state(evalJs);
  ok(label, s.active === n && s.visibleCount === 1 && s.visible[n], `active ${s.active}, visible ${s.visibleCount}`);
  return s;
}

async function main() {
  // ── 桌面：翻页行为 ──────────────────────────────────────────────────
  console.log('\n[desktop 1440x900]');
  await withPage({ width: 1440, height: 900, label: 'desk' }, async ({ evalJs, shot, sleep, errors }) => {
    const s0 = await state(evalJs);
    ok('8 屏', s0.count === 8, `got ${s0.count}`);
    ok('初始停在第 0 屏', s0.active === 0 && s0.visibleCount === 1, `active ${s0.active}, visible ${s0.visibleCount}`);
    ok('文档不滚动', s0.docScrollable <= 1 && s0.scrollY === 0, `overflow ${s0.docScrollable}, y ${s0.scrollY}`);
    ok('封面标题是 LIVE IN PASSION', s0.title.includes('WHAT IS LIVE IN PASSION'), s0.title);
    ok('标题不是 LIVING', !/LIVING\\s+PASSION/i.test(s0.title), s0.title);
    ok('标题用 Oswald', /Oswald/.test(s0.fonts.title), s0.fonts.title);
    ok('正文用 Poppins', /Poppins/.test(s0.fonts.body), s0.fonts.body);
    ok('标签用 JetBrains Mono', /JetBrains Mono/.test(s0.fonts.mono), s0.fonts.mono);
    ok('八屏内容都装得下', s0.fits.every((d) => d <= 1), s0.fits.join(','));
    ok('内容都不压在导航栏下', s0.navClear.every((d) => d < 0), s0.navClear.join(','));
    // 回归守卫：章节顶部那行页码 / 章名曾经用了 <header>，被全站的
    // `header { position: fixed }` 钉到视口顶部，正好压在导航栏上
    ok('页码那行不是 fixed 定位', s0.metaPosition === 'static', s0.metaPosition);
    await shot('00-hero');

    // 浅色主题
    await evalJs("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }))");
    await sleep(1300);
    ok('Z 键切到浅色主题', await evalJs("!document.documentElement.classList.contains('dark')"));
    await shot('00-hero-light');
    await evalJs("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }))");
    await sleep(1300);

    // 滚轮往下 —— 立刻翻页，且过程中不会同时出现两屏
    await evalJs(wheel(120));
    await sleep(80);
    let mid = await state(evalJs);
    ok('滚轮翻页时也只有一屏可见', mid.visibleCount === 1, `visible ${mid.visibleCount}`);
    await sleep(STEP);
    await expectSlide(evalJs, 1, '滚轮往下 → 第 1 屏');
    await shot('01-name');

    // 一次手势只翻一页
    await evalJs(`(function(){ for (var i=0;i<6;i++) window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, cancelable: true })); })()`);
    await sleep(STEP);
    await expectSlide(evalJs, 2, '一次手势只翻一页（连发 6 个 wheel）');

    // 往上回
    await evalJs(wheel(-120));
    await sleep(STEP);
    await expectSlide(evalJs, 1, '滚轮往上 → 回到第 1 屏');

    // 点击空白翻页
    await evalJs(clickStage);
    await sleep(STEP);
    await expectSlide(evalJs, 2, '点击空白 → 第 2 屏');
    await shot('02-belief');

    // 键盘
    await evalJs(key('ArrowDown'));
    await sleep(STEP);
    await expectSlide(evalJs, 3, '↓ → 第 3 屏');
    await shot('03-project');
    await evalJs(key('ArrowUp'));
    await sleep(STEP);
    await expectSlide(evalJs, 2, '↑ → 回到第 2 屏');

    // 右轨跳转
    await evalJs(clickRail(6));
    await sleep(STEP);
    await expectSlide(evalJs, 6, '点右轨 06 → 第 6 屏');
    await shot('06-roadmap');
    await evalJs(key('End'));
    await sleep(STEP);
    await expectSlide(evalJs, 7, 'End → 最后一屏');
    await shot('07-outro');

    // 点链接不翻页
    await evalJs(`(function(){
      var a = document.querySelector('.org-slide--outro .org-cta__item');
      a.addEventListener('click', function (e) { e.preventDefault(); }, { capture: true, once: true });
      a.click();
    })()`);
    await sleep(STEP);
    await expectSlide(evalJs, 7, '点 CTA 链接不翻页');

    await evalJs(key('Home'));
    await sleep(STEP);
    await expectSlide(evalJs, 0, 'Home → 回到第 0 屏');

    // keep-alive 往返后重新从第一屏开始
    await evalJs(clickRail(4));
    await sleep(STEP);
    await evalJs("document.querySelector('nav a[href=\"/blogs\"]').click()");
    await sleep(1900);
    await evalJs("document.querySelector('nav a[href=\"/organization\"]').click()");
    await sleep(2200);
    const back = await state(evalJs);
    ok('keep-alive 回来仍是一屏一页', back.count === 8 && back.visibleCount === 1, `${back.count} / ${back.visibleCount}`);
    ok('keep-alive 回来从第 0 屏开始', back.active === 0, `active ${back.active}`);

    ok('零控制台报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  });

  // ── 内容装得下：四种窗口 ────────────────────────────────────────────
  for (const vp of [
    { width: 1280, height: 800, label: 'laptop' },
    { width: 1024, height: 768, label: 'small' },
    { width: 390, height: 844, mobile: true, label: 'phone' },
    { width: 390, height: 667, mobile: true, label: 'phone-se' },
    { width: 844, height: 390, mobile: true, label: 'landscape' },
  ]) {
    console.log(`\n[fit ${vp.width}x${vp.height}]`);
    await withPage({ width: vp.width, height: vp.height, mobile: vp.mobile, label: vp.label }, async ({ evalJs, shot, sleep, errors }) => {
      const s = await state(evalJs);
      const bad = s.fits.map((d, i) => [i, d]).filter(([, d]) => d > 1);
      ok('八屏内容都装得下', bad.length === 0, bad.map(([i, d]) => `${i}:+${d}`).join(','));
      const hit = s.navClear.map((d, i) => [i, d]).filter(([, d]) => d >= 0);
      ok('内容都不压在导航栏下', hit.length === 0, hit.map(([i, d]) => `${i}:${d}`).join(','));
      ok('文档不滚动', s.docScrollable <= 1, `overflow ${s.docScrollable}`);
      ok('只有一屏可见', s.visibleCount === 1, `visible ${s.visibleCount}`);
      ok('无横向溢出', s.docWide <= 1, `wide ${s.docWide}`);
      await shot('00-hero');

      // 滚一遍每一屏，确认每屏都是一屏一页
      for (let i = 1; i < 8; i += 1) {
        await evalJs(clickRail(i));
        await sleep(120);
      }
      await sleep(400);
      const last = await state(evalJs);
      ok('右轨能走到最后一屏', last.active === 7 && last.visibleCount === 1, `active ${last.active}`);
      ok('零控制台报错', errors.length === 0, errors.slice(0, 3).join(' | '));
      if (vp.mobile) await shot('07-outro');
    });
  }

  // ── 手机：上下滑 ────────────────────────────────────────────────────
  console.log('\n[mobile swipe 390x844]');
  await withPage({ width: 390, height: 844, mobile: true, label: 'swipe' }, async ({ evalJs, sleep, errors }) => {
    ok('手机上收起右轨', await evalJs("getComputedStyle(document.querySelector('.org-rail')).display") === 'none');
    const swipe = (type, y) => `(function(){
      var el = document.querySelector('.org-stage');
      var t = new Touch({ identifier: 1, target: el, clientX: 200, clientY: ${y}, pageX: 200, pageY: ${y} });
      el.dispatchEvent(new TouchEvent('${type}', {
        bubbles: true, cancelable: true,
        touches: ${type === 'touchstart' ? '[t]' : '[]'},
        targetTouches: ${type === 'touchstart' ? '[t]' : '[]'},
        changedTouches: [t],
      }));
    })()`;
    await evalJs(swipe('touchstart', 640));
    await evalJs(swipe('touchend', 480));
    await sleep(STEP);
    await expectSlide(evalJs, 1, '上滑 → 第 1 屏');
    await evalJs(swipe('touchstart', 480));
    await evalJs(swipe('touchend', 640));
    await sleep(STEP);
    await expectSlide(evalJs, 0, '下滑 → 回到第 0 屏');
    ok('手机零控制台报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  });

  // ── reduced-motion ──────────────────────────────────────────────────
  console.log('\n[reduced-motion 1280x800]');
  await withPage({ width: 1280, height: 800, label: 'rm', reduced: true }, async ({ evalJs, sleep, errors }) => {
    // 照样要等过 620ms 的冷却：减动效去掉的是动画，不是"一次手势只翻一页"
    await evalJs(wheel(120));
    await sleep(STEP);
    await expectSlide(evalJs, 1, 'reduced-motion 下仍是一屏一页');
    await evalJs(wheel(120));
    await sleep(STEP);
    await expectSlide(evalJs, 2, 'reduced-motion 下继续翻页');
    ok('reduced-motion 零控制台报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  });

  console.log(`\n${failures.length ? `❌ ${failures.length} failed` : '✅ all passed'}`);
  if (failures.length) {
    console.log(failures.map((f) => `  - ${f}`).join('\n'));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
