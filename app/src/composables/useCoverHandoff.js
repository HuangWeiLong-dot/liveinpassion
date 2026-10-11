// 列表 / 首页 → 博客详情 的**封面位置交接**。
//
// 为什么需要它：详情页的封面动画是 GSAP FLIP —— 起点取"刚被点的那一格在屏幕上的
// 矩形"，终点是详情页封面栏里的位置。但点下去之后组件就换了（列表被 keep-alive
// 收走、详情挂上来），起点那个元素已经拿不到了，所以只能用一次性的交接数据把它带过去。
//
// 为什么不用浏览器的 View Transitions 共享元素（`blog-cover-<slug>`）：
// 那套快照活在视口坐标系里，而当时根快照同时在整页竖直滑动 —— 两个坐标系各动各的，
// 封面在过渡中段必然错位，而且要每帧重绘那块大图，切换时看得出卡顿。
// 现在只有一条 GSAP 时间线，起点终点同源。
const KEY = 'lip:blog-cover-handoff';

/**
 * 记下"这一篇是从哪一格点进来的"。
 *
 * @param {string} slug  目标文章
 * @param {Element|null} el 被点的元素（卡片 / 首页磁贴）；会被夹到它内部的
 *                          `.jb-media`（博客卡片的封面那一格）或 `img/figure`
 * @param {{ index?: number, listLeft?: number, neighbors?: Array<{slug:string, rect:DOMRect|object}>,
 *           stageBg?: string }} [extra]
 *        轨道下标、当时的横向滚动量，**相邻那一两格的屏幕矩形**，以及**列表这一页的底色**。
 *        相邻矩形是给详情页"三格"用的：参考站点一张卡时，上一篇/下一篇的封面
 *        也是从列表里各自那一格飞过去的（stagger 0.035），不是凭空淡入。
 *        stageBg 是给"底色别跳"用的：列表页底色比站点默认更深（--jb-bg），详情页那边
 *        要在交接这段时间顶着同一个底色，否则切换那一帧整屏会亮/暗一档。
 */
export function rememberCoverHandoff(slug, el, extra = {}) {
  if (!slug || !el || typeof window === 'undefined') return;
  try {
    const fig = el.querySelector?.('.jb-media') || el.querySelector?.('figure') || el;
    const r = fig.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const rect = (b) => (b && b.width && b.height
      ? { left: b.left, top: b.top, width: b.width, height: b.height }
      : null);
    const neighbors = Array.isArray(extra.neighbors)
      ? extra.neighbors
        .map((n) => ({ slug: n?.slug, rect: rect(n?.rect) }))
        .filter((n) => n.slug && n.rect)
      : [];
    window.sessionStorage.setItem(KEY, JSON.stringify({
      slug,
      index: typeof extra.index === 'number' ? extra.index : null,
      listLeft: typeof extra.listLeft === 'number' ? extra.listLeft : 0,
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      neighbors,
      // 只收计算后的 rgb()/rgba() 串（getComputedStyle 的输出）；其它形状一律当没有。
      stageBg: typeof extra.stageBg === 'string' && /^rgba?\([\d\s.,%]+\)$/.test(extra.stageBg)
        ? extra.stageBg
        : null,
    }));
  } catch {
    /* 隐私模式下 sessionStorage 可能直接抛错：没有交接数据就退化成"不做 FLIP" */
  }
}

/** 读回交接数据；slug 对不上（直接开链接 / 刷新）就返回 null，详情页会跳过 FLIP。 */
export function readCoverHandoff(slug) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && data.slug === slug ? data : null;
  } catch {
    return null;
  }
}

/** 用完即弃：避免"返回列表再点同名的另一篇"时用到过期的矩形。 */
export function clearCoverHandoff() {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* 同上 */
  }
}

// ── "刚从详情返回"这个信号 ──────────────────────────────────────────────
// 详情页在退出时置位，列表在 onActivated 里取用（取用即清）。
//
// 为什么用一个内存标记、而不是去 DOM 里找（比如"被点那张卡的 .is-flying"还在不在）：
//   onActivated 触发的那一刻，keep-alive 还没把列表的 DOM 重新插回文档，
//   querySelector 一律返回 null —— 实测就是这里漏判，返回时周围元素没有渐入。
// 也不能靠"详情在跳转前挂的类"：那个类在跳转后的几帧里会被别的清理逻辑摘掉。
// 内存标记跟 DOM 无关，谁先谁后都不影响。
let returningFromDetail = false;

export function markReturningFromDetail() {
  returningFromDetail = true;
}

/** 取用即清：同一次返回只算一次。 */
export function consumeReturningFromDetail() {
  const v = returningFromDetail;
  returningFromDetail = false;
  return v;
}
