// 验收：方块光标"全局"。
//
//   cd app && npm run build && npx vite preview --port 4174 --strictPort
//   node tools/verify-block-cursor.mjs http://localhost:4174
//
// 迁移前它是首页 Hero 自己的东西（HeroConcept.vue 里的 .hero-cursor，
// 只在 .hero-concept 这个作用域里生效，系统光标也只在那一段里被压掉）；
// 现在是 components/BlockCursor.vue，挂在 App.vue（<router-view> 之外）、Teleport 到 body。
//
// 要证的是"每一页都有，而且任何时候都不会出现'一个光标都没有'"：
//   1. 每条路由上：方块在 body 直下、html.is-block-cursor 挂上、系统光标被压成 none；
//   2. 方块的矩形就等于指针的视口坐标（**滚动之后也是** —— 这正是当初把它 Teleport
//      出 Hero 的原因：被 transform 的祖先会把 fixed 的包含块换成它自己）；
//   3. 压在可交互物上放大、挪到没人认领的地方缩回；
//   4. 压在所有浮层之上（品牌遮罩 9999 / 转场板子 90000）；
//   5. 指针离开文档 → 方块藏起、系统光标**还回去**（不能两边都没有）；
//   6. 触屏：整个不出，而且不压系统光标；
//   7. 方块自己不拦点击（pointer-events: none）。
//
// 指针一律用 Input.dispatchMouseEvent 真的推（走渲染进程的命中测试，和真鼠标同一条路），
// 这样 e.target / closest() 那一串才和真机一致。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const baseUrl = (process.argv[2] || 'http://localhost:4174').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (r.exceptionDetails) throw new Error('求值失败: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
};

/** 真的把指针推到 (x, y)，等两帧让 rAF 落定。 */
async function moveMouse(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0, pointerType: 'mouse' });
  // 250ms：方块的放大是个 0.28s 的过渡，量早了会读到还没长完的中间值
  await sleep(250);
}

// 和 BlockCursor.vue 里那份名单**保持同一份**。这里用它当"这块地方点不点得动"的
// 判据（不是重复实现：真正要验的是"事件 → 一帧 → 类名"这条链路通不通）。
const HOT = `'a[href], button, summary, [role="button"], [role="link"],' +
  '.gallery-item, .gallery-featured-large, .blog-card, .friend-card,' +
  '.timeline-photo-item, .back-link, .scroll-arrow,' +
  '.me-gallery-item, .me-section-box, .me-game-btn, .me-gallery-month-btn,' +
  '.steam-profile-btn,' +
  '.lightbox-nav, .lightbox-close-area, .me-photo-lightbox-close,' +
  '.bd-closezone, .modal-close, .jb-card, .playlist-item,' +
  '.dock-btn, .dock-item, .brand__enter, .wall-toggle, .menu-toggle,' +
  '.theme-toggle, .music-toggle-btn, .author-avatar,' +
  '.player-btn, .player-play-btn, .stats-retry'`;

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
};

// 视口内找一个"点得动"的点和一个"点不动"的点。
// ⚠ 先扫**页头以下**那块（y >= 200）：页头本来就横着一条导航，从 y=60 起扫的话
//   每个页面第一个命中的都是导航链接 —— 那就等于只验了通用选择器 a[href]，
//   站点自己那串类名（.jb-card / .gallery-item …）一个都没碰到。
const FIND_POINTS = `(() => {
  const hot = ${HOT};
  // ⚠ 只要求"有体积"，**不要**再要求整个矩形都在视口里：群里那些照片格
  //   （248×186）在 765 高的视口里只露出小半个，按"完整可见"筛的话会全被筛掉，
  //   于是退回页头那条导航 —— 等于又只验了 a[href]。
  //   落点本身一定是能命中的（它就是 elementFromPoint 返回的那个元素）。
  const ok = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 16 && r.height > 16;
  };
  const scan = (y0, y1, want) => {
    for (let y = y0; y < y1; y += 16) {
      for (let x = 16; x < innerWidth - 16; x += 16) {
        const el = document.elementFromPoint(x, y);
        if (!el) continue;
        const h = el.closest(hot);
        if (want ? (h && ok(h)) : !h) return { x, y, el: h || el };
      }
    }
    return null;
  };
  const N = (p) => p && {
    x: p.x, y: p.y,
    cls: String(p.el.className).slice(0, 60),
    tag: p.el.tagName,
    inHeader: !!(p.el.closest && p.el.closest('#header')),
  };
  const hotPt = N(scan(200, innerHeight - 10, true)) || N(scan(60, innerHeight - 10, true));
  const coldPt = N(scan(200, innerHeight - 10, false)) || N(scan(60, innerHeight - 10, false));
  return JSON.stringify({ hotPt, coldPt });
})()`;

const STATE = `(() => {
  const el = document.querySelector('.block-cursor');
  if (!el) return JSON.stringify({ exists: false });
  const r = el.getBoundingClientRect();
  const dot = el.querySelector('.block-cursor__dot');
  return JSON.stringify({
    exists: true,
    inBody: el.parentElement === document.body,
    visible: el.classList.contains('is-visible'),
    active: el.classList.contains('is-active'),
    dark: el.classList.contains('is-dark'),
    htmlClass: document.documentElement.classList.contains('is-block-cursor'),
    z: getComputedStyle(el).zIndex,
    left: Math.round(r.left),
    top: Math.round(r.top),
    dotW: dot ? Math.round(dot.getBoundingClientRect().width) : 0,
    // 视口里随便挑一个链接，看系统光标是不是真的被压掉了
    linkCursor: (() => {
      const a = document.querySelector('a[href]');
      return a ? getComputedStyle(a).cursor : '(没有链接)';
    })(),
    // 触屏那条断言的参照：没有 is-block-cursor 时系统光标应该是正常的
    rawCursor: (() => {
      const a = document.querySelector('a[href]');
      return a ? a.style.cursor : '';
    })(),
  });
})()`;

const ROUTES = [
  // expect：这一页页头以下第一个"点得动"的东西应该是什么。拿它卡住
  // "站点自己那串类名也真的认"——只有 a[href] 被认到的话这几条会当场露馅。
  { path: '/', name: '首页', scrollable: true, expect: 'persona' },
  { path: '/blogs', name: '博客', expect: 'jb-card' },
  { path: '/me', name: 'ME', expect: 'me-' },
  { path: '/me/gallery', name: 'ME 相册', expect: 'me-gallery' },
  { path: '/gallery', name: 'GALLERY', expect: 'gallery' },
  { path: '/friends/lijiazu', name: '好友详情', expect: 'timeline' },
  { path: '/group-photos', name: '群组照片', expect: 'timeline' },
];

/** 新站用 pushState + popstate 驱动 vue-router（见 tools/verify-gallery.mjs） */
const go = (p) =>
  `history.pushState({}, '', ${JSON.stringify(p)}); window.dispatchEvent(new PopStateEvent('popstate')); 1`;

// 屏幕正中这会儿是谁。首屏品牌遮罩盖着（没点 ENTER 的话它一直盖着）、
// 或者转场板子正划过来的时候，底下的页面是量不到的 —— 那种时候先等它走完。
const CLEAR = `(() => {
  // 转场板子按**矩形**判，不是按"盖没盖住中心"：它划进来的半路上中心可能是空的，
  // 而那时底下的旧页面还没换掉（keep-alive 是等板子盖满才换的）—— 那半秒里量到的
  // 是上一页的元素。滑走之后它整个矩形会离开视口，这才是"真的演完了"。
  const panel = document.querySelector('.transition-panel');
  if (panel) {
    const r = panel.getBoundingClientRect();
    const gone = r.right < 2 || r.left > innerWidth - 2 || r.bottom < 2 || r.top > innerHeight - 2;
    if (!gone) return '转场板';
  }
  const el = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight / 2));
  if (el && el.closest('.brand')) return '品牌遮罩';
  return 'clear';
})()`;

async function waitClear(timeout = 9000, label = '') {
  const t0 = Date.now();
  for (;;) {
    if ((await evaluate(CLEAR)) === 'clear') return true;
    if (Date.now() - t0 > timeout) {
      check(`等浮层走开${label ? '（' + label + '）' : ''}`, false, `等了 ${timeout}ms 还盖着`);
      return false;
    }
    await sleep(200);
  }
}

/** 真的用鼠标点一下（按下 + 抬起），走的是和用户一样的那条路 */
async function clickAt(x, y) {
  await moveMouse(x, y);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

/** 某个选择器的中心点（视口坐标） */
const centerOf = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return 'null';
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return 'null';
  return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
})()`;

(async () => {
  const port = 9880 + Math.floor(Math.random() * 40);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-prof-'));
  const child = spawn(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
     '--no-first-run', '--disable-gpu', '--disable-extensions',
     '--autoplay-policy=no-user-gesture-required', // 点 ENTER 会起播，别让 autoplay 拦截算成报错
     '--window-size=1280,860', 'about:blank'],
    { stdio: 'ignore' }
  );

  const consoleErrors = [];
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
    const load = () => new Promise((res) => on('Page.loadEventFired', res));
    on('Runtime.exceptionThrown', (p) =>
      consoleErrors.push('exception: ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text)));
    on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') consoleErrors.push('console: ' + p.args.map((a) => a.value || a.description || '').join(' '));
    });

    const loaded = load();
    await send('Page.navigate', { url: baseUrl + '/' });
    await Promise.race([loaded, sleep(15000)]);
    await sleep(3200); // 等品牌遮罩那一场走完

    console.log('指针能力:');
    const media = JSON.parse(await evaluate(`JSON.stringify({
      fine: matchMedia('(hover: hover) and (pointer: fine)').matches,
      touch: matchMedia('(hover: none)').matches
    })`));
    check('无头里被认成精确指针（有 hover）', media.fine === true, JSON.stringify(media));

    console.log('\n首屏（指针还没动过）:');
    // ⚠ 这一条只能在**最开始**查一次：方块是常驻的，指针动过之后类就一直挂着，
    //   换路由也不会摘（那是想要的 —— 换页时不该闪一下系统光标）。
    const first = JSON.parse(await evaluate(STATE));
    check('指针未动时先不压系统光标（避免"两边都没有"）',
      first.htmlClass === false && first.visible === false, `htmlClass=${first.htmlClass}`);
    check('品牌遮罩那一屏方块就已经在（否则这一屏没有光标）', first.exists === true && first.inBody === true);

    // 点首屏那个 ENTER，把遮罩揭开 —— 不点的话它一直盖在页面上，
    // 下面每条路由量到的都是遮罩而不是页面本身。
    const enter = JSON.parse(await evaluate(centerOf('.brand__enter')));
    if (enter === null) {
      check('首屏有 ENTER 可点', false);
    } else {
      await clickAt(enter.x, enter.y);
      check('点 ENTER 把品牌遮罩揭开', await waitClear(9000, 'ENTER 之后'), '');
    }

    console.log('\n逐条路由:');
    for (const route of ROUTES) {
      await evaluate(go(route.path));
      await sleep(600);
      await waitClear(9000, route.name);
      const pts = JSON.parse(await evaluate(FIND_POINTS));

      // 推一下指针
      await moveMouse(640, 420);
      const st = JSON.parse(await evaluate(STATE));
      check(`[${route.name}] 方块在 body 直下`, st.exists && st.inBody === true);

      // ③ 方块矩形 = 指针的视口坐标
      const at = JSON.parse(await evaluate(`(() => {
        const el = document.querySelector('.block-cursor');
        const r = el.getBoundingClientRect();
        return JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) });
      })()`));
      check(`[${route.name}] 方块矩形 = 指针视口坐标`,
        Math.abs(at.left - 640) <= 1 && Math.abs(at.top - 420) <= 1,
        `方块 ${at.left},${at.top} vs 指针 640,420`);
      check(`[${route.name}] 方块可见`, st.visible === true);
      check(`[${route.name}] html.is-block-cursor 已挂`, st.htmlClass === true);

      check(`[${route.name}] 系统光标被压成 none`, st.linkCursor === 'none', String(st.linkCursor));

      // ④ 浮层之上：转场板子 90000、品牌遮罩 9999
      check(`[${route.name}] 压在所有浮层之上`, Number(st.z) > 90000, `z-index ${st.z}`);

      // ⑤ 可交互物上放大 / 空白处缩回
      if (pts.hotPt) {
        await moveMouse(pts.hotPt.x, pts.hotPt.y);
        const hot = JSON.parse(await evaluate(STATE));
        check(`[${route.name}] 压在可交互物上放大`, hot.active === true, `落点 ${pts.hotPt.cls}`);
        check(`[${route.name}] 放大后方块真的变大（宽 >10px）`, hot.dotW > 10, `${hot.dotW}px`);
        // 落点必须是**页面内容**，不是页头那条横导航 —— 否则这一条只验到了
        // 通用选择器 a[href]，站点自己那串类名一个都没碰到。
        check(`[${route.name}] 落点是页面内容（页头以下）`, pts.hotPt.inHeader === false, pts.hotPt.cls);
        if (route.expect) {
          check(`[${route.name}] 认到的是本页自己的那类东西`,
            String(pts.hotPt.cls).includes(route.expect), `${pts.hotPt.cls} 应含 "${route.expect}"`);
        }
      } else {
        check(`[${route.name}] 找得到可交互物（用于 hover 判定）`, false, '视口里没找到');
      }
      if (pts.coldPt) {
        await moveMouse(pts.coldPt.x, pts.coldPt.y);
        const cold = JSON.parse(await evaluate(STATE));
        check(`[${route.name}] 挪到空白处缩回`, cold.active === false, `落点 ${pts.coldPt.tag}`);
      } else {
        check(`[${route.name}] 找得到空白处（用于缩回判定）`, false, '整屏都是可交互物');
      }

      // ⑥ 滚动之后依然对得上（这是当初把它 Teleport 出 Hero 的理由）
      if (route.scrollable !== false) {
        await evaluate(`window.scrollTo(0, Math.min(600, document.body.scrollHeight - innerHeight)); 1`);
        await sleep(300);
        await moveMouse(600, 300);
        const sc = JSON.parse(await evaluate(`(() => {
          const el = document.querySelector('.block-cursor');
          const r = el.getBoundingClientRect();
          return JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) });
        })()`));
        check(`[${route.name}] 滚动后方块仍钉在指针上`,
          Math.abs(sc.left - 600) <= 1 && Math.abs(sc.top - 300) <= 1, `方块 ${sc.left},${sc.top}`);
        await evaluate('window.scrollTo(0, 0); 1');
        await sleep(200);
      }
    }

    console.log('\n指针离开文档:');
    // 真机上"移出窗口"没法用 CDP 模拟，这里直接往 html 上派一个 pointerleave
    // （监听器就挂在那儿，见 BlockCursor.vue）。
    await moveMouse(640, 420);
    await evaluate(`document.documentElement.dispatchEvent(new PointerEvent('pointerleave')); 1`);
    await sleep(200);
    const left = JSON.parse(await evaluate(STATE));
    check('方块藏起来', left.visible === false);
    check('系统光标还回去（不能两边都没有）', left.htmlClass === false);
    await moveMouse(300, 300);
    const back = JSON.parse(await evaluate(STATE));
    check('指针再进来方块又出现', back.visible === true && back.htmlClass === true);

    console.log('\n不拦点击:');
    await evaluate(go('/blogs'));
    await sleep(600);
    await waitClear(9000, '博客页');
    const nav = JSON.parse(await evaluate(`(() => {
      const a = [...document.querySelectorAll('#header a[href]')].find((x) => !x.href.endsWith('/blogs'));
      if (!a) return 'null';
      const r = a.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), href: a.getAttribute('href') });
    })()`));
    if (nav === 'null') {
      check('头部有可点的导航链接', false);
    } else {
      const { x, y, href } = nav;
      await clickAt(x, y);
      await sleep(1800);
      const after = await evaluate('location.pathname');
      check('方块下面的链接照样点得动（pointer-events: none）', after !== '/blogs', `点 ${href} → ${after}`);
    }

    console.log('\n首页主体（手动举旗那条路）:');
    // 主体是一张铺满的 <div>，没有任何可认的语义标签 —— 自动判定认不出来。
    // 它靠 HeroConcept 里的 setBlockCursorHot 举旗（这次改动动了那两处调用）。
    await evaluate(go('/'));
    await sleep(600);
    await waitClear(9000, '首页');
    const subj = JSON.parse(await evaluate(`(() => {
      const el = document.querySelector('.hero-subject');
      if (!el) return 'null';
      const r = el.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      const under = document.elementFromPoint(x, y);
      return JSON.stringify({
        x, y,
        under: under ? under.tagName + '.' + String(under.className).slice(0, 40) : null,
        underHot: !!(under && under.closest(${HOT})),
      });
    })()`));
    if (subj === 'null') {
      check('首页找得到 .hero-subject', false);
    } else {
      await moveMouse(subj.x, subj.y);
      const s = JSON.parse(await evaluate(STATE));
      check('压在主体上放大', s.active === true, `落点 ${subj.under}`);
      check('这一条只可能来自手动举旗（该点不在自动名单里，自动判定认不出来）',
        subj.underHot === false, subj.underHot ? '该点恰好也落在自动名单里，这一条不算数' : '该点不在自动名单里');
      await moveMouse(640, 760);
      const off = JSON.parse(await evaluate(STATE));
      check('挪开就缩回（旗子放得下）', off.active === false);
    }

    console.log('\n换页时举的旗要收回来:');
    // 这一条是修掉的那个缺陷的回归位：指针停在人格卡上时点它 → 换页 → 整张卡连同
    // 首页被 keep-alive 摘出文档，而**元素被摘走时浏览器不会补 pointerleave** ——
    // 靠 leave 放旗的话那杆旗会一直举着，方块从那一刻起在**每一页**都是放大态
    // （实测：换到 /me、指针底下是 .me-name，照样是放大的）。
    await evaluate(go('/'));
    await sleep(600);
    await waitClear(9000, '首页');
    const per = JSON.parse(await evaluate(centerOf('a.persona')));
    if (per === null) {
      check('首页找得到人格卡（a.persona）', false);
    } else {
      await moveMouse(per.x, per.y);
      const onP = JSON.parse(await evaluate(STATE));
      check('先压在人格卡上（放大态）', onP.active === true);
      await evaluate(go('/me'));
      await sleep(800);
      await waitClear(9000, 'ME');
      // 指针一步都没动 —— 这就是"点了卡片就换页"那一刻的真实状态
      const stuck = JSON.parse(await evaluate(STATE));
      check('换页之后立刻不再是放大态', stuck.active === false, `active=${stuck.active}`);
      await moveMouse(per.x + 6, per.y + 6);
      const after3 = JSON.parse(await evaluate(STATE));
      check('指针稍微一动，自检也把它收干净', after3.active === false, `active=${after3.active}`);
    }

    console.log('\n主题色:');
    const dotColor = `(() => {
      const el = document.querySelector('.block-cursor');
      const dot = el.querySelector('.block-cursor__dot');
      return JSON.stringify({
        dark: el.classList.contains('is-dark'),
        htmlDark: document.documentElement.classList.contains('dark'),
        color: getComputedStyle(dot).backgroundColor,
      });
    })()`;
    const before2 = JSON.parse(await evaluate(dotColor));
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, text: 'z' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 });
    await sleep(1600);
    const after2 = JSON.parse(await evaluate(dotColor));
    const want = (d) => (d ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)');
    check('切换前：方块颜色跟着当前主题（暗=纯白 / 亮=纯黑）',
      before2.dark === before2.htmlDark && before2.color === want(before2.dark),
      `dark=${before2.dark} ${before2.color}`);
    check('按 Z 换主题后方块跟着翻色',
      after2.htmlDark !== before2.htmlDark && after2.color === want(after2.dark) && after2.dark === after2.htmlDark,
      `${before2.color} → ${after2.color}`);
    // 换回去，别把后面的断言留在另一个主题上
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, text: 'z' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 });
    await sleep(1600);

    console.log('\n触屏:');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const loaded2 = load();
    await send('Page.navigate', { url: baseUrl + '/me' });
    await Promise.race([loaded2, sleep(15000)]);
    await sleep(2200);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 400 }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
    const touch = JSON.parse(await evaluate(`(() => {
      const el = document.querySelector('.block-cursor');
      const a = document.querySelector('a[href]');
      const r = el ? el.getBoundingClientRect() : null;
      return JSON.stringify({
        exists: !!el,
        display: el ? getComputedStyle(el).display : '(没有)',
        htmlClass: document.documentElement.classList.contains('is-block-cursor'),
        linkCursor: a ? getComputedStyle(a).cursor : '(没有链接)',
        fine: matchMedia('(hover: hover) and (pointer: fine)').matches,
      });
    })()`));
    check('触屏上认成粗指针（没有 hover）', touch.fine === false);
    check('触屏上不压系统光标', touch.htmlClass === false && touch.linkCursor !== 'none', `link cursor = ${touch.linkCursor}`);
    check('触屏上方块不显示', touch.exists === false || touch.display === 'none', `display = ${touch.display}`);

    console.log('\n控制台:');
    check('全程零控制台报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  } finally {
    try { ws?.close(); } catch {}
    child.kill();
    await sleep(400);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) {
    console.log('未通过:');
    for (const f of failed) console.log('  ✗ ' + f.label);
    process.exitCode = 1;
  }
})();
