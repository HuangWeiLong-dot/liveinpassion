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
import FriendDetailView from '../views/FriendDetailView.vue';
import GroupPhotosView from '../views/GroupPhotosView.vue';
import StatsView from '../views/StatsView.vue';
import NotFoundView from '../views/NotFoundView.vue';

const routes = [
  { path: '/', name: 'home', component: HomeView },
  { path: '/blogs', name: 'blogs', component: BlogsView },
  { path: '/blogs/:slug', name: 'blog-detail', component: BlogDetailView },
  { path: '/me', name: 'me', component: MeView },
  { path: '/me/gallery', name: 'me-gallery', component: MeGalleryView },
  { path: '/gallery', name: 'gallery', component: GalleryView },
  { path: '/friends/:id', name: 'friend-detail', component: FriendDetailView },
  { path: '/group-photos', name: 'group-photos', component: GroupPhotosView },
  { path: '/stats', name: 'stats', component: StatsView },
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
