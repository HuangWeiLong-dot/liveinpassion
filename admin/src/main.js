import { createApp } from 'vue';
import App from './App.vue';
import router from './router/index.js';
// 编辑器相关（样式 / md-editor 配置）都留在编辑器路由里，
// 列表与相册页不为它买单
import './styles/admin.css';

createApp(App).use(router).mount('#app');
