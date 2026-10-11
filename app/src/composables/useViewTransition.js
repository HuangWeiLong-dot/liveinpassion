// 共享元素过渡（View Transitions API）封装。
//
// 只有一个调用方：首页概念入口点某张图 → 进博客详情。列表侧的遮罩/图片和详情页的
// 顶部大图共用同一个 view-transition-name（`blog-cover-<slug>`），浏览器就会把旧快照
// 那块矩形放大、位移到新快照的位置，形成"遮罩演变成封面"的连续感。
//
// **这是全站唯一不走"整屏缩放"那条路的导航**（见 usePageTransition.js）：根快照再叠一层
// 1.55 倍缩放 + 14px 模糊的话，封面那一下形变会被搅在里面看不清。所以这里要显式
// skipNextPageTransition() 把守卫让开，并且置上 <html data-vt="cover">，让根走干净的
// 交叉淡化（见 styles/view-transition.css）。
// 反过来，浏览器不支持 View Transitions 时不 skip —— 那种情况下它退化成普通跳转，
// 比什么都不演要好。
//
// ── 调用逻辑（这是整件事的关键）──────────────────────────────────────────
// document.startViewTransition(callback) 分三个阶段：
//   1. 立刻抓取"旧快照"（此时 DOM 还是列表页）
//   2. 执行 callback；**如果 callback 返回 Promise，浏览器会等它 resolve 之后**
//      才抓取"新快照"——所以要在这里面 await router.push() + await nextTick()，
//      否则新快照抓到的还是列表页，过渡等于没发生
//   3. 播放过渡
//
// 两个容易踩的点：
//   - view-transition-name 必须在同一份快照里唯一。首页四张图各用各的 slug，
//     不会重名；重名的话浏览器会直接跳过整次过渡（不是报错，是静默失效，很难查）。
//   - keep-alive 缓存着的首页 DOM 是脱离文档的，不参与快照，所以离开首页后
//     它那四个 name 不会和详情页的撞车。
import { nextTick } from 'vue';
// prefersReducedMotion / supportsViewTransition 只留 usePageTransition 里那一份 ——
// 两个模块判"要不要演"必须是同一个结论，否则会出现一边演一边不演的错配。
import {
  prefersReducedMotion,
  skipNextPageTransition,
  supportsViewTransition,
} from './usePageTransition.js';

/**
 * 用共享元素过渡跳转；不支持或用户要求减少动效时直接跳。
 *
 * @param {import('vue-router').Router} router
 * @param {import('vue-router').RouteLocationRaw} to
 * @param {{ beforeCapture?: () => void | Promise<void> }} [options]
 *        beforeCapture 在抓新快照前、路由切换后执行——用来把 hover 展开的遮罩
 *        收回闭合态，让快照是一块完整的白板而不是已经打开的样子。
 * @returns {Promise<void>}
 */
export async function navigateWithViewTransition(router, to, options = {}) {
  const { beforeCapture } = options;

  // 降级：没有 API，或用户开了"减少动态效果"，就普通跳转。
  // 普通跳转本身没有视觉损失，只是少了那一下形变。
  if (!supportsViewTransition() || prefersReducedMotion()) {
    await router.push(to);
    return;
  }

  // 这一次的转场由共享元素负责，别让路由守卫再发起一次整屏缩放
  skipNextPageTransition();

  // 必须在 startViewTransition **之前**置上：转场一开始 CSS 就要按这个选择器匹配。
  // 根那两条 ::view-transition-old/new(root) 的规则靠它切到"干净交叉淡化"。
  document.documentElement.dataset.vt = 'cover';

  const transition = document.startViewTransition(async () => {
    await router.push(to);
    // 等 Vue 把新视图 patch 进 DOM——详情页的 view-transition-name 必须在这之前就位
    await nextTick();
    if (beforeCapture) await beforeCapture();
  });

  try {
    await transition.finished;
  } catch {
    // 过渡被打断（用户连点、切标签页、导航被取消）时 finished 会 reject。
    // 这不是错误，导航本身已经完成了，吞掉即可。
  } finally {
    // 一定要清 —— 留着的话下一次普通导航也会走淡化而不是缩放
    delete document.documentElement.dataset.vt;
  }
}
