import { createRouter, createWebHistory } from 'vue-router';

// 路由表。左侧是旧版靠 navigateTo() 切换的"页面"，右侧是新的真实 URL。
// 旧版 14 个 <main class="page"> 里的 friends-page（死页）、friend-videos-page（不可达）
// 按迁移决定删除；5 个 blog-detail-N 合并成一个带 slug 参数的视图。
//
// 视图全部静态 import：站点体积很小，静态打包可让点击导航瞬时完成，
// 不再像懒加载那样首次点击要等待 chunk 下载。
import HomeView from '../views/HomeView.vue';
import BlogsView from '../views/BlogsView.vue';
import BlogDetailView from '../views/BlogDetailView.vue';
import MeView from '../views/MeView.vue';
import MeGalleryView from '../views/MeGalleryView.vue';
import GalleryView from '../views/GalleryView.vue';
import PhotographyView from '../views/PhotographyView.vue';
import LifeView from '../views/LifeView.vue';
import LifeArchiveView from '../views/LifeArchiveView.vue';
import OrganizationView from '../views/OrganizationView.vue';
import ProjectionView from '../views/ProjectionView.vue';
import NotFoundView from '../views/NotFoundView.vue';

const routes = [
  { path: '/', name: 'home', component: HomeView },
  { path: '/echoes', name: 'echoes', component: BlogsView },
  { path: '/echoes/:slug', name: 'echo-detail', component: BlogDetailView },
  // 旧路由 → 新地址重定向（保留 query / hash）
  { path: '/blogs', redirect: (to) => ({ name: 'echoes', query: to.query, hash: to.hash }) },
  { path: '/blogs/:slug', redirect: (to) => ({
    name: 'echo-detail',
    params: { slug: to.params.slug },
    query: to.query,
    hash: to.hash,
  }) },
  // 短片放映页：独立作品，不是站点的普通内容页（见 views/ProjectionView.vue）
  { path: '/projection', name: 'projection', component: ProjectionView },
  { path: '/me', name: 'me', component: MeView },
  { path: '/me/gallery', name: 'me-gallery', component: MeGalleryView },
  { path: '/gallery', name: 'gallery', component: GalleryView },
  // 摄影作品：索引 + 按人名分组（person 同时是 CMS 里 photography 相册的人名）
  { path: '/photography', name: 'photography', component: PhotographyView },
  { path: '/photography/:person', name: 'photography-person', component: PhotographyView },
  { path: '/life', name: 'life', component: LifeView },
  { path: '/life/archive/:kind', name: 'life-archive', component: LifeArchiveView },
  { path: '/me/organization', name: 'me-organization', component: OrganizationView },
  // 旧地址保留：statistics 现在是 LIFE 的第三个视图，organization 现在挂在 ME 下
  { path: '/stats', redirect: { name: 'life', query: { view: 'stats' } } },
  { path: '/organization', redirect: { name: 'me-organization' } },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView },
];

export default createRouter({
  history: createWebHistory(),
  routes,
  // 路由切换时立刻回到顶部（instant），避免 html 的 scroll-behavior: smooth
  // 让页面切换带着一段平滑上滑，造成"点击后没有立即跳转"的迟滞感。
  // 页内锚点链接不受影响，仍然平滑滚动。
  scrollBehavior() {
    return { top: 0, behavior: 'instant' };
  },
});
