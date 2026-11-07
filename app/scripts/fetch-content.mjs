// 构建期内容拉取脚本
// 从 Worker public API 拉取博客与相册数据，写入 app/src/data/content/*.json
// 博客正文会先经过 src/seo/enhanceBody.js 的 SEO 增强（标题层级/锚点/图片 alt/关键词）
// 失败时保留仓库内最近一次快照（不覆盖为空），确保不发布空站
//
// 用法：node scripts/fetch-content.mjs
// 环境变量：
//   CMS_API_BASE  —— Worker API 地址，默认 https://cms.liveinpassion.me
//   CMS_TIMEOUT   —— 请求超时毫秒，默认 15000

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enhancePosts } from '../src/seo/enhanceBody.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, '..');
const contentDir = resolve(appDir, 'src/data/content');

const API_BASE = process.env.CMS_API_BASE || 'https://cms.liveinpassion.me';
const TIMEOUT = Number(process.env.CMS_TIMEOUT || 15000);

function fetchWithTimeout(url) {
  return Promise.race([
    fetch(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout fetching ${url}`)), TIMEOUT)),
  ]);
}

async function fetchJson(path) {
  const url = `${API_BASE}${path}`;
  console.log(`Fetching ${url}...`);
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

function safeWrite(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`  ✓ Wrote ${file}`);
}

async function main() {
  let blogOk = false;
  let albumsOk = false;
  let showcaseOk = false;

  // 拉取博客
  try {
    const data = await fetchJson('/api/posts');
    // 旧版 Worker 还可能带 rating / coverRating；评级系统已删除，构建快照里也不再保留。
    data.posts = (data.posts || []).map(({ rating, coverRating, ...post }) => post);
    // 正文 SEO 增强：标题层级、标题锚点、图片 alt/lazy、词数与关键词。
    // 新文章上传后由 CMS 触发重建，下一次构建会自动跑到这里。
    data.posts = enhancePosts(data.posts);
    safeWrite(resolve(contentDir, 'blogPosts.json'), data);
    blogOk = true;
  } catch (err) {
    console.warn(`  ⚠ Blog fetch failed: ${err.message}`);
    console.warn('    Keeping existing blogPosts.json snapshot.');
    // 网络失败时也把本地快照增强一遍，保证兜底版本同样带 SEO 字段
    try {
      const snapshotPath = resolve(contentDir, 'blogPosts.json');
      if (existsSync(snapshotPath)) {
        const local = JSON.parse(readFileSync(snapshotPath, 'utf8'));
        if (Array.isArray(local.posts)) {
          local.posts = enhancePosts(local.posts);
          safeWrite(snapshotPath, local);
        }
      }
    } catch (enhanceErr) {
      console.warn(`    ⚠ Snapshot enhancement skipped: ${enhanceErr.message}`);
    }
  }

  // 拉取相册
  try {
    const data = await fetchJson('/api/albums');
    safeWrite(resolve(contentDir, 'albums.json'), data);
    albumsOk = true;
  } catch (err) {
    console.warn(`  ⚠ Albums fetch failed: ${err.message}`);
    console.warn('    Keeping existing albums.json snapshot.');
  }

  // 首页右侧展示（latest echo / latest photo / author's selected）
  // 失败时同样保留上一份快照：不能让一次 404（旧 Worker 还没部署新路由）把首页展示清空。
  try {
    const data = await fetchJson('/api/showcase');
    safeWrite(resolve(contentDir, 'showcase.json'), data);
    showcaseOk = true;
  } catch (err) {
    console.warn(`  ⚠ Showcase fetch failed: ${err.message}`);
    console.warn('    Keeping existing showcase.json snapshot.');
  }

  if (!blogOk || !albumsOk || !showcaseOk) {
    console.warn('\n⚠ Some content fetches failed. Build will use last committed snapshot.');
    // 不退出非零：让构建继续使用快照，不阻断发布
  } else {
    console.log('\n✓ All content fetched successfully.');
  }
}

main().catch((err) => {
  console.error('Fatal error in fetch-content:', err);
  process.exit(1);
});
