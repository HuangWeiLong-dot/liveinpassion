import { createApp } from 'vue';
import App from './App.vue';
import router from './router/index.js';
import { installTracker } from './composables/useTracker.js';
import { installPageTransition } from './composables/usePageTransition.js';
import './styles/main.css';
import './styles/view-transition.css';
import './styles/window-wall.css';

const app = createApp(App);
app.use(router);
installTracker(router);
// 通用转场：每次路由切换都"画面放大冲过去 → 再从放大态缩回"
installPageTransition(router);

// 等首次路由解析完再挂载，否则首帧会先渲染一次"无匹配路由"的空白
await router.isReady();
app.mount('#app');
