import { createApp } from 'vue';
import App from './App.vue';
import router from './router/index.js';
import './styles/main.css';

const app = createApp(App);
app.use(router);

// 等首次路由解析完再挂载，否则首帧会先渲染一次"无匹配路由"的空白
await router.isReady();
app.mount('#app');
