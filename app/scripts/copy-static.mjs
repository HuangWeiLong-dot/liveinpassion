// 构建后处理：
// 1. 把仓库根的静态资源复制进 app/dist（这些目录只保留一份，不进 app/）
// 2. 复制 CNAME —— 注意仓库根的 CNAME 必须原地保留，Pages 的分支发布读的是它；
//    这里只是往产物里再放一份，避免切换发布方式时自定义域名丢掉
// 3. 由 index.html 生成 404.html：History 模式下深链接直达时，
//    Pages 会把未知路径交给 404.html，应用启动后由 vue-router 渲染正确视图
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(appDir, '..');
const distDir = path.join(appDir, 'dist');

const STATIC_DIRS = ['icons', 'avatar', 'me', 'logo', 'music'];
const STATIC_FILES = ['favicon.png', 'CNAME'];

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('dist/index.html 不存在，先跑 vite build');
  process.exit(1);
}

for (const dir of STATIC_DIRS) {
  const from = path.join(repoRoot, dir);
  if (!fs.existsSync(from)) {
    console.warn(`跳过缺失的目录: ${dir}/`);
    continue;
  }
  fs.cpSync(from, path.join(distDir, dir), { recursive: true });
}

for (const file of STATIC_FILES) {
  const from = path.join(repoRoot, file);
  if (!fs.existsSync(from)) {
    console.warn(`跳过缺失的文件: ${file}`);
    continue;
  }
  fs.copyFileSync(from, path.join(distDir, file));
}

fs.copyFileSync(path.join(distDir, 'index.html'), path.join(distDir, '404.html'));

console.log('静态资源与 CNAME 已复制，404.html 已生成');
