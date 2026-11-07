// 验收：首页右侧悬浮展示（Home Showcase）
//
//   cd app && npm run build
//   npx vite preview --port 4174 --strictPort
//   node tools/verify-home-showcase.mjs http://localhost:4174
//
// 断言：
//   1. 品牌遮罩揭开前不出现，ENTER 之后淡入
//   2. 三组内容（LATEST ECHO / LATEST PHOTO / SELECTED）与构建快照一致
//   3. 每张卡片的标题 / 跳转地址取对（文章、摄影作者、影片）
//   4. 收起 / 展开可用
//   5. 亮暗主题下面板颜色跟着变
//   6. 手机上变成底部横条：贴底、三张缩略图同排、INDEX 展开、页面无横向溢出
//   7. 零 console 报错 / 未捕获异常
//
// 图片用 CDP 伪造（1×1 PNG），不依赖 CDN，也不会因为图片慢而抖动。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const baseUrl = (process.argv[2] || 'http://localhost:4174').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'app/src/data/content/showcase.json'), 'utf8')
);

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let id = 0;
const pending = new Map();
const handlers = new Map();
let ws;
const send = (method, params = {}) => {
  const i = ++id;
  return new Promise((res, rej) => {
    pending.set(i, { res, rej });
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

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
};

const SNAPSHOT_JS = `(() => {
  const panel = document.querySelector('.home-showcase');
  if (!panel) return { missing: true };
  const rect = panel.getBoundingClientRect();
  const content = panel.querySelector('.hs-content');
  const tab = panel.querySelector('.hs-tab');
  const sheet = document.querySelector('.hs-sheet');
  const backdrop = document.querySelector('.hs-backdrop');
  const cardsOf = (root) => [...root.querySelectorAll('.hs-card')].map((a) => ({
    href: a.getAttribute('href'),
    title: a.querySelector('.hs-card__title')?.textContent.trim() || '',
    meta: a.querySelector('.hs-card__meta')?.textContent.trim() || '',
    rect: (() => { const r = a.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
  }));
  const ty = (el) => {
    if (!el) return null;
    const m = /matrix\\(([^)]+)\\)/.exec(getComputedStyle(el).transform);
    return m ? Math.round(Number(m[1].split(',')[5])) : 0;
  };
  return {
    missing: false,
    className: panel.className,
    opacity: Number(getComputedStyle(panel).opacity),
    contentOpacity: content ? Number(getComputedStyle(content).opacity) : 0,
    tabOpacity: tab ? Number(getComputedStyle(tab).opacity) : 0,
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height), bottom: Math.round(rect.bottom) },
    groups: [...panel.querySelectorAll('.hs-content .hs-group__title > span:first-child')].map((n) => n.textContent.trim()),
    cards: cardsOf(panel.querySelector('.hs-content') || panel),
    collapsed: panel.classList.contains('is-collapsed'),
    sheet: sheet ? {
      open: sheet.classList.contains('is-open'),
      ty: ty(sheet),
      cards: cardsOf(sheet),
      rect: (() => { const r = sheet.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height) }; })(),
    } : null,
    backdropOpacity: backdrop ? Number(getComputedStyle(backdrop).opacity) : 0,
    docScroll: [document.documentElement.scrollWidth, window.innerWidth],
  };
})()`;

const consoleErrors = [];

(async () => {
  const port = 9890 + Math.floor(Math.random() * 40);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'showcase-prof-'));
  const child = spawn(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
     '--no-first-run', '--disable-gpu', '--disable-extensions', '--window-size=1440,900', 'about:blank'],
    { stdio: 'ignore' }
  );

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
    await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });

    on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') {
        consoleErrors.push((p.args || []).map((a) => a.value || a.description || '').join(' '));
      }
    });
    on('Runtime.exceptionThrown', (p) => {
      consoleErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'exception');
    });

    on('Fetch.requestPaused', (p) => {
      const { requestId, resourceType } = p;
      if (resourceType !== 'Image') {
        send('Fetch.continueRequest', { requestId }).catch(() => {});
        return;
      }
      send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'image/png' },
          { name: 'Access-Control-Allow-Origin', value: '*' },
          { name: 'Cache-Control', value: 'max-age=3600' },
        ],
        body: PNG,
      }).catch(() => {});
    });

    const loaded = new Promise((res) => on('Page.loadEventFired', res));
    await send('Page.navigate', { url: baseUrl + '/' });
    await Promise.race([loaded, sleep(10000)]);
    await sleep(1500);

    console.log('出现时机:');
    const before = await evaluate(SNAPSHOT_JS);
    check('组件已挂载（等待品牌遮罩揭开）', before.missing === false);
    check('ENTER 之前不可见', before.missing || before.opacity < 0.05, `opacity=${before.opacity}`);

    // 品牌遮罩的 ENTER 要等字体/首屏准备完才出现；不要死等固定毫秒，
    // 没出现就再点一次（enter() 自己有 phase 守卫，重复点不会重播）
    let after = await evaluate(SNAPSHOT_JS);
    for (let i = 0; i < 50 && (after?.opacity ?? 0) < 0.9; i += 1) {
      await evaluate(`document.querySelector('.brand__enter')?.click()`);
      await sleep(200);
      after = await evaluate(SNAPSHOT_JS);
    }
    check('ENTER 之后淡入', !after.missing && after.opacity > 0.9, `opacity=${after.opacity}`);

    console.log('\n内容:');
    check('三组齐全：LATEST ECHO / LATEST PHOTO / SELECTED',
      JSON.stringify(after.groups) === JSON.stringify(['LATEST ECHO', 'LATEST PHOTO', 'SELECTED']),
      after.groups.join(' / '));

    const expected = [
      SNAPSHOT.latestEcho,
      SNAPSHOT.latestPhotography,
      ...(SNAPSHOT.selected || []),
    ].filter(Boolean);

    check('卡片数量与快照一致', after.cards.length === expected.length,
      `${after.cards.length} / ${expected.length}`);

    let contentOk = true;
    for (let i = 0; i < expected.length; i += 1) {
      const want = expected[i];
      const got = after.cards[i] || {};
      const same = got.href === want.href
        && got.title === String(want.title)
        && got.meta === want.meta;
      if (!same) {
        contentOk = false;
        console.log(`    ✗ #${i} 期望 ${want.href} / ${want.title} / ${want.meta}，实际 ${got.href} / ${got.title} / ${got.meta}`);
      }
    }
    check('每张卡片的标题 / meta / 跳转地址取对', contentOk);

    console.log('\n收起 / 展开动画:');
    const beforeCollapse = await evaluate(SNAPSHOT_JS);

    // 页面内逐帧记录宽度：CDP 往返有几十毫秒抖动，采样单点容易错过中间态
    await evaluate(`window.__widths = []; (function rec(){
      const p = document.querySelector('.home-showcase');
      if (p) window.__widths.push(Math.round(p.getBoundingClientRect().width));
      if (window.__widths.length < 50) requestAnimationFrame(rec);
    })()`);
    await evaluate(`document.querySelector('.hs-btn--collapse')?.click()`);
    await sleep(800);
    const collapseWidths = JSON.parse(await evaluate('JSON.stringify(window.__widths)'));
    const sawCollapseMid = collapseWidths.some(
      (w) => w > 52 && w < beforeCollapse.rect.w - 6
    );
    check('收起是过渡动画（宽度经过中间值）', sawCollapseMid,
      collapseWidths.filter((_, i) => i % 6 === 0).join(' → '));

    const collapsed = await evaluate(SNAPSHOT_JS);
    check('收起终态：46px 竖标签、内容不可见',
      collapsed.collapsed && collapsed.rect.w <= 48
      && collapsed.contentOpacity < 0.05 && collapsed.tabOpacity > 0.9,
      `${collapsed.rect.w}px / content ${collapsed.contentOpacity} / tab ${collapsed.tabOpacity}`);

    await evaluate(`window.__widths = []; (function rec(){
      const p = document.querySelector('.home-showcase');
      if (p) window.__widths.push(Math.round(p.getBoundingClientRect().width));
      if (window.__widths.length < 50) requestAnimationFrame(rec);
    })()`);
    await evaluate(`document.querySelector('.hs-tab')?.click()`);
    await sleep(800);
    const expandWidths = JSON.parse(await evaluate('JSON.stringify(window.__widths)'));
    const sawExpandMid = expandWidths.some(
      (w) => w > 52 && w < beforeCollapse.rect.w - 6
    );
    check('展开是过渡动画（宽度经过中间值）', sawExpandMid,
      expandWidths.filter((_, i) => i % 6 === 0).join(' → '));

    const expanded = await evaluate(SNAPSHOT_JS);
    check('展开终态：内容完整、标签隐藏',
      !expanded.collapsed && expanded.rect.w >= beforeCollapse.rect.w - 2
      && expanded.contentOpacity > 0.9 && expanded.tabOpacity < 0.1,
      `${expanded.rect.w}px / content ${expanded.contentOpacity} / tab ${expanded.tabOpacity}`);

    console.log('\n主题:');
    const darkBg = await evaluate(`getComputedStyle(document.querySelector('.home-showcase')).backgroundColor`);
    await evaluate(`document.documentElement.classList.remove('dark')`);
    await sleep(300);
    const lightBg = await evaluate(`getComputedStyle(document.querySelector('.home-showcase')).backgroundColor`);
    await evaluate(`document.documentElement.classList.add('dark')`);
    check('亮暗主题下面板底色不同', darkBg !== lightBg, `${darkBg} / ${lightBg}`);

    console.log('\n移动端:');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
    });
    await sleep(700);
    const mobile = await evaluate(SNAPSHOT_JS);
    check('面板贴底（bottom ≈ 视口底部）',
      Math.abs(mobile.rect.bottom - 844) <= 24,
      `bottom=${mobile.rect.bottom}`);
    check('三张缩略图在同一排（x 递增）',
      mobile.cards.length >= 3
      && mobile.cards.every((card, i) => i === 0 || card.rect.x > mobile.cards[i - 1].rect.x),
      mobile.cards.map((c) => c.rect.x).join(' / '));
    check('手机页面没有横向溢出',
      mobile.docScroll[0] <= mobile.docScroll[1] + 1,
      `${mobile.docScroll[0]} / ${mobile.docScroll[1]}`);
    check('抽屉默认停在屏幕外',
      mobile.sheet && !mobile.sheet.open && mobile.sheet.ty > 20,
      `ty=${mobile.sheet?.ty}`);

    await evaluate(`window.__tys = []; (function rec(){
      const s = document.querySelector('.hs-sheet');
      if (s) {
        const m = /matrix\\(([^)]+)\\)/.exec(getComputedStyle(s).transform);
        window.__tys.push(m ? Math.round(Number(m[1].split(',')[5])) : -1);
      }
      if (window.__tys.length < 50) requestAnimationFrame(rec);
    })()`);
    await evaluate(`document.querySelector('.hs-btn--index')?.click()`);
    await sleep(800);
    const tys = JSON.parse(await evaluate('JSON.stringify(window.__tys)'));
    const sawSlide = tys.some((ty) => ty > 8 && ty < mobile.sheet.ty - 8);
    check('INDEX 展开是上滑动画（位移经过中间值）', sawSlide,
      tys.filter((_, i) => i % 6 === 0).join(' → '));

    const open = await evaluate(SNAPSHOT_JS);
    check('抽屉到位、遮罩淡入',
      open.sheet.open && Math.abs(open.sheet.ty) <= 2 && open.backdropOpacity > 0.5,
      `ty=${open.sheet.ty} / backdrop=${open.backdropOpacity}`);
    check('展开后能看到完整标题',
      open.sheet.cards.length >= 3 && open.sheet.cards.every((card) => card.title.length > 0),
      `${open.sheet.cards.length} 张`);

    await evaluate(`document.querySelector('.hs-backdrop').click()`);
    await sleep(700);
    const closed = await evaluate(SNAPSHOT_JS);
    check('点遮罩收起：抽屉滑回屏幕外、遮罩淡出',
      !closed.sheet.open && closed.sheet.ty > 20 && closed.backdropOpacity < 0.2,
      `ty=${closed.sheet.ty} / backdrop=${closed.backdropOpacity}`);

    console.log('\n控制台:');
    const clean = consoleErrors.filter((e) => e && !/Failed to load resource/i.test(e));
    check('零 console 报错 / 未捕获异常', clean.length === 0, clean.slice(0, 3).join(' | '));
  } finally {
    try { await send('Browser.close'); } catch {}
    child.kill();
    await sleep(400);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} 条通过`);
    process.exit(failed.length ? 1 : 0);
  }
})();
