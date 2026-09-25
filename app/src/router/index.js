import { createRouter, createWebHistory } from 'vue-router';

// 路由表。左侧是旧版靠 navigateTo() 切换的"页面"，右侧是新的真实 URL。
// 旧版 14 个 <main class="page"> 里的 friends-page（死页）、friend-videos-page（不可达）
// 按迁移决定删除；5 个 blog-detail-N 合并成一个带 slug 参数的视图。
const routes = [
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
  { path: '/blogs', name: 'blogs', component: () => import('../views/BlogsView.vue') },
  { path: '/blogs/:slug', name: 'blog-detail', component: () => import('../views/BlogDetailView.vue') },
  { path: '/me', name: 'me', component: () => import('../views/MeView.vue') },
  { path: '/me/gallery', name: 'me-gallery', component: () => import('../views/MeGalleryView.vue') },
  { path: '/gallery', name: 'gallery', component: () => import('../views/GalleryView.vue') },
  { path: '/friends/:id', name: 'friend-detail', component: () => import('../views/FriendDetailView.vue') },
  { path: '/group-photos', name: 'group-photos', component: () => import('../views/GroupPhotosView.vue') },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('../views/NotFoundView.vue') },
];

export default createRouter({
  history: createWebHistory(),
  routes,
  // 旧版每次导航都回顶部；html 上有 scroll-behavior: smooth，所以实际是平滑滚动。
  // 不要传 behavior: 'instant'——那会改变现有观感。
  scrollBehavior() {
    return { top: 0 };
  },
});
