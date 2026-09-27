import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [vue(), cloudflare()],
  base: '/admin/',
  build: {
    outDir: '../worker/admin-dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});