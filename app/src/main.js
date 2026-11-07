import { createApp } from 'vue';
import App from './App.vue';
import router from './router/index.js';
import { installTracker } from './composables/useTracker.js';
import { installSeo } from './composables/useSeo.js';
import { installPageTransition } from './composables/usePageTransition.js';
import { installRouteProgress } from './composables/useRouteProgress.js';
import './styles/main.css';
import './styles/view-transition.css';
import './styles/window-wall.css';

const app = createApp(App);
app.use(router);
installTracker(router);
// SEO：路由切换时写入 title / description / canonical / OG / JSON-LD
installSeo(router);
// 顶部加载进度：点导航后立刻开始预取目标页首屏图片。
// ⚠ 必须在 installPageTransition 之前注册 —— 守卫按注册顺序执行，
// 排在转场后面的话要等板子那 ~700ms 走完才开始下载，预取就白做了。
installRouteProgress(router);
// 通用转场：每次路由切换都"画面放大冲过去 → 再从放大态缩回"
installPageTransition(router);

// 等首次路由解析完再挂载，否则首帧会先渲染一次"无匹配路由"的空白
await router.isReady();
app.mount('#app');
