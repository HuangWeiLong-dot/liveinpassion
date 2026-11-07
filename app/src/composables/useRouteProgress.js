// 顶部加载进度：点导航的那一刻开始，把目标页面首屏要用的图片提前下载下来，
// 条子上走的是**真实完成比例**（下载完一张加一格），不是定时器假装在跑。
//
// 为什么在 beforeEach 里开始：installPageTransition 的守卫会把导航推迟到板子
// 盖满（约 700ms）—— 这段时间 DOM 还是旧页面，正好用来下载新页面的图。
// ⚠ main.js 里必须先 installRouteProgress 再 installPageTransition：
//    守卫按注册顺序执行，排在后面的话要等板子那 700ms 走完才开始下载。
//
// 收尾条件有两个，必须**都**满足：
//   · 图片先下完：不能在新页面还没出现时就把条子收掉，看起来像早就切好了；
//   · 新页面先挂上：图还在路上时条子继续待在顶上，和页面里的骨架屏是同一件事。
import { nextTick, reactive } from 'vue';
import { routeAssets } from '../data/routeAssets.js';

export const routeProgress = reactive({
  /** 是否显示 */
  visible: false,
  /** 0–100，填充宽度 */
  value: 0,
  /** 重新开始时把 CSS 过渡关掉，避免条子从 100 往回倒着缩 */
  noTransition: false,
  /** 这一趟要预取的图片总数 / 已下完数（组件上以 data-* 暴露，便于验收） */
  total: 0,
  done: 0,
});

const FLOOR = 8;             // 一出现就有的起始量，避免 0 → 第一张之间的空档
const CEIL = 94;             // 收尾前的上限；100 只留给"图片与页面都到位"
const ASSET_CAP_MS = 9000;   // CDN 卡住时的兜底，不能让条子永久停在半路
const SWAP_CAP_MS = 4000;    // 路由守卫异常时的兜底
const RUN_CAP_MS = 7000;     // 整趟导航的兜底：守卫被取消 / afterEach 丢失时也得收场

let runId = 0;
let awaitingRun = 0;
let pendingPath = '';
let assetsDone = false;
let arrived = false;
let images = [];
let crawlTimer = 0;
let assetTimer = 0;
let hideTimer = 0;
let runTimer = 0;

function clearTimers() {
  clearInterval(crawlTimer);
  clearTimeout(assetTimer);
  clearTimeout(hideTimer);
  clearTimeout(runTimer);
  crawlTimer = 0;
  assetTimer = 0;
  hideTimer = 0;
  runTimer = 0;
}

/** 两个条件都满足才收尾：先滑到 100%，淡出 */
function settle(id) {
  if (id !== runId || !assetsDone || !arrived) return;
  clearTimers();
  routeProgress.value = 100;
  hideTimer = setTimeout(() => {
    if (id !== runId) return;
    routeProgress.visible = false;
    awaitingRun = 0;
    pendingPath = '';
  }, 220);
}

function start(to) {
  const id = ++runId;
  clearTimers();
  images = [];
  assetsDone = false;
  arrived = false;
  awaitingRun = id;
  pendingPath = to.fullPath;

  // 重新开始：先把条子瞬间归零再淡入，不要从上次的 100 倒着缩回来
  routeProgress.noTransition = true;
  routeProgress.value = 0;
  routeProgress.total = 0;
  routeProgress.done = 0;
  routeProgress.visible = true;
  requestAnimationFrame(() => {
    if (id !== runId) return;
    routeProgress.noTransition = false;
    // 缓存命中时图片可能在这一帧之前就下完了，别把进度倒回起点
    if (!assetsDone) routeProgress.value = Math.max(routeProgress.value, FLOOR);
  });

  const finishAssets = () => {
    if (id !== runId || assetsDone) return;
    assetsDone = true;
    clearTimeout(assetTimer);
    assetTimer = 0;
    // 没有图片的路由还留着 crawl 定时器：让它继续走到 70% 等页面挂上
    settle(id);
  };

  // 省流 / 2G：不抢带宽，条子退化成导航指示器（页面自己仍会按需加载）
  const conn = typeof navigator !== 'undefined' ? navigator.connection : null;
  const stingy = Boolean(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '')));

  const urls = stingy ? [] : routeAssets(to);

  // 整趟导航的兜底：路由守卫被取消 / afterEach 没来，也必须在 7s 内收场
  runTimer = setTimeout(() => {
    if (id !== runId) return;
    assetsDone = true;
    arrived = true;
    settle(id);
  }, RUN_CAP_MS);

  if (!urls.length) {
    // 没有可预取的图片（LIFE / ME / 组织页等）：条子退化成"导航正在发生"。
    // 指数逼近 70%，但页面挂上之前绝不到 100。
    crawlTimer = setInterval(() => {
      if (id !== runId || routeProgress.value >= 70) return;
      routeProgress.value = Math.min(
        70,
        routeProgress.value + (70 - routeProgress.value) * 0.12 + 0.5
      );
    }, 120);
    // 至少让条子被看见一帧，再视为"没有东西要预取"
    assetTimer = setTimeout(finishAssets, 260);
    return;
  }

  let done = 0;
  const total = urls.length;
  routeProgress.total = total;
  const onOne = () => {
    if (id !== runId) return;
    done += 1;
    routeProgress.done = done;
    // 每下完一张推进一格；199 张也不会超过 CEIL
    routeProgress.value = Math.min(
      CEIL,
      FLOOR + ((CEIL - FLOOR) * done) / total
    );
    if (done >= total) finishAssets();
  };

  for (const url of urls) {
    const img = new Image();
    img.decoding = 'async';
    // 失败也算一格：404 / CDN 抖动不能让条子永远停住
    img.onload = onOne;
    img.onerror = onOne;
    img.src = url;
    // 保持引用：某些浏览器会在图片对象被回收时取消还没跑完的请求
    images.push(img);
  }

  assetTimer = setTimeout(finishAssets, ASSET_CAP_MS);
}

function arrive(to) {
  const id = awaitingRun;
  if (!id || id !== runId) return;
  // 只认这次导航自己；点当前页链接等场景也会触发 afterEach，不能拿来提前收尾
  if (pendingPath && to.fullPath !== pendingPath) return;
  awaitingRun = 0;

  // 和转场组件用同一个"新页面真的画出来"的时机：nextTick + 两帧
  nextTick()
    .then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    .then(() => {
      if (id !== runId) return;
      arrived = true;
      settle(id);
    });

  // 页面迟迟挂不上时兜底，别让条子停在 90 多
  setTimeout(() => {
    if (id !== runId || arrived) return;
    arrived = true;
    settle(id);
  }, SWAP_CAP_MS);
}

/**
 * 挂到 router 上。
 * ⚠ 必须在 installPageTransition 之前调用（见文件头的说明）。
 *
 * @param {import('vue-router').Router} router
 */
export function installRouteProgress(router) {
  router.beforeEach((to, from) => {
    // 首屏那次导航没有 from —— 那一段由品牌遮罩负责
    if (!from.name) return true;
    // 点同一个链接（含重复点当前页）：没有画面切换，别闪条子
    if (to.fullPath === from.fullPath) return true;
    start(to);
    return true;
  });

  router.afterEach((to) => arrive(to));
}
