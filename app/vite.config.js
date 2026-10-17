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
  '.flac': 'audio/flac',
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

        const stat = fs.statSync(filePath);
        const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        res.setHeader('Content-Type', type);
        res.setHeader('Accept-Ranges', 'bytes');

        // 必须支持 Range：<audio> 拖动进度条 / 跳到未缓冲的位置时，浏览器会发
        // `Range: bytes=…`，只回 200 整份文件时它无法定位，进度会直接回到 0。
        // 生产环境的 GitHub Pages 本来就走 206，这里只是让本地 dev 对齐。
        const range = req.headers.range;
        const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
        if (match) {
          let start = match[1] === '' ? null : Number(match[1]);
          let end = match[2] === '' ? null : Number(match[2]);
          if (start === null) {
            // 后缀范围：bytes=-N，取文件末尾 N 字节
            start = Math.max(0, stat.size - (end ?? 0));
            end = stat.size - 1;
          } else {
            end = end === null ? stat.size - 1 : Math.min(end, stat.size - 1);
          }
          if (start >= stat.size || start > end) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${stat.size}`);
            return res.end();
          }
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
          res.setHeader('Content-Length', end - start + 1);
          if (req.method === 'HEAD') return res.end();
          return fs.createReadStream(filePath, { start, end }).pipe(res);
        }

        res.setHeader('Content-Length', stat.size);
        if (req.method === 'HEAD') return res.end();
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
