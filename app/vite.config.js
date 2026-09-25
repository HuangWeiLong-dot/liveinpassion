import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, '..');

// 仓库根的静态资源只有一份（8 个 mp3、头像、图标等），不复制进 app/。
// 开发服务器默认不服务工程根之外的文件，所以这里补一层只读中间件。
const ROOT_STATIC_DIRS = ['icons', 'avatar', 'me', 'logo', 'music'];
const ROOT_STATIC_FILES = ['favicon.png'];

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
};

function serveRepoRootAssets() {
  return {
    name: 'serve-repo-root-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const urlPath = decodeURIComponent((req.url || '').split('?')[0]);
        const first = urlPath.split('/')[1] || '';
        if (!ROOT_STATIC_DIRS.includes(first) && !ROOT_STATIC_FILES.includes(first)) return next();

        const filePath = path.join(repoRoot, urlPath.slice(1));
        // 防目录穿越：解析后必须仍在仓库根内
        if (!filePath.startsWith(repoRoot + path.sep) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          return next();
        }
        res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [vue(), serveRepoRootAssets()],
  // 站点在自定义域名根路径下提供服务，深链接（/blogs/xxx）也要求绝对资源路径
  base: '/',
  // publicDir 关掉：静态资源只有仓库根那一份，构建时由 scripts/copy-static.mjs 复制进 dist
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
