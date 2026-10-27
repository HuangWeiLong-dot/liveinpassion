// 转场中间那行字：路由 → 要显示的名称。
//
// 为什么单独一个文件、而不是写在 usePageTransition 里：
// 它要读数据层（blogBySlug / friendById），而 usePageTransition 是纯时序模块。
// 时序归时序、文案归文案 —— 以后加一块"板块"（新路由）只改这一张表。
//
// ⚠ 这个函数在 **beforeEach 里同步调用**（见 usePageTransition.js）：
// 名字必须在转场发起之前就定下来，那一刻 DOM 还是旧页面，没有别的地方能读到它。
// 所以这里只允许同步查表，不许出现 await / fetch。
import { blogBySlug } from '../data/blogPosts.js';
import { friendById } from '../data/friends.js';

// 固定板块直接用路由名查表 —— 和 router/index.js 的 name 一一对应。
// 值是**大写**：屏幕正中那行字沿用的是站内导航的字形（BLOGS / STATS 那个调子），
// 小写会和四角那些 Oswald 大写标签打架。
const SECTIONS = {
  home: 'HOME',
  blogs: 'BLOGS',
  me: 'ME',
  'me-gallery': 'PHOTOS',
  gallery: 'GALLERY',
  stats: 'STATS',
  life: 'LIFE',
  'life-archive': 'ARCHIVE',
  organization: 'ORGANIZATION',
  'not-found': 'NOT FOUND',
};

/**
 * 这次导航要在屏幕中间显示哪行字。
 *
 * @param {import('vue-router').RouteLocationNormalized} to 目标路由
 * @returns {string} 已经是大写的显示文本；查不到时回退成 NOT FOUND（宁可显示一个
 *          让人一眼看出问题的字，也不要空着一块黑屏）
 */
export function sectionLabelFor(to) {
  const name = to?.name;

  // 博客详情：显示这篇的标题（S & N / MIRAGE …）。
  // 正文标题里带 `&`、`-` 这类符号，大写之后仍然好读，直接沿用。
  if (name === 'blog-detail') {
    const post = blogBySlug[to.params?.slug];
    if (post?.title) return post.title.toUpperCase();
  }

  // 好友页：用 titleName（已经是大写）、退回 name。
  if (name === 'friend-detail') {
    const friend = friendById[to.params?.id];
    if (friend) return friend.titleName || friend.name;
  }

  return SECTIONS[name] || 'NOT FOUND';
}
