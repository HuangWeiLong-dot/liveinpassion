import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [vue(), cloudflare()],
  base: '/admin/',
  // 默认构建不会转译 node_modules 里的语法（vue-router 产物里残留 ?.）；
  // 显式让 esbuild 处理所有 js/mjs，保证老内核也能解析
  esbuild: {
    target: 'es2019',
    include: [/\.[cm]?[jt]sx?$/],
  },
  build: {
    // 夸克/UC/百度等安卓浏览器常搭载较旧内核；降到 ES2019
    // （可选链、空值合并、逻辑赋值、私有字段等会被转译，不要求新系统）
    target: 'es2019',
    outDir: '../worker/admin-dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});