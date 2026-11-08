import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  { path: '/', name: 'blog-list', component: () => import('../views/BlogList.vue') },
  { path: '/blogs/new', name: 'blog-new', component: () => import('../views/BlogEdit.vue') },
  { path: '/blogs/:id', name: 'blog-edit', component: () => import('../views/BlogEdit.vue'), props: true },
  { path: '/albums', name: 'albums', component: () => import('../views/AlbumManage.vue') },
  { path: '/showcase', name: 'showcase', component: () => import('../views/ShowcaseManage.vue') },
  { path: '/films', name: 'films', component: () => import('../views/FilmManage.vue') },
  { path: '/taxonomy', name: 'taxonomy', component: () => import('../views/TaxonomyManage.vue') },
];

export default createRouter({
  history: createWebHistory('/admin/'),
  routes,
});
