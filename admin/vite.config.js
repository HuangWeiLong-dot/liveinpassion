import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

import { cloudflare } from "@cloudflare/vite-plugin";

// Miniflare 把 email-store 建在系统临时目录（os.tmpdir()）。本机工作区目录带 Low
// 完整性标签，node_modules 里的 workerd.exe 起的 Workers 运行时只能写工作区内，
// 于是启动即 `CreateDirectory: #5 Access is denied.; path = miniflare-email-store`。
// 把临时目录收进项目内（workerd 子进程会继承 TEMP/TMP）即可。
const localTmp = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp-miniflare');
fs.mkdirSync(localTmp, { recursive: true });
process.env.TEMP = localTmp;
process.env.TMP = localTmp;

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