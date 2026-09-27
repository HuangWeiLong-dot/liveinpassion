import { createApp } from 'vue';
import App from './App.vue';
import router from './router/index.js';
import 'md-editor-v3/lib/style.css';

createApp(App).use(router).mount('#app');
