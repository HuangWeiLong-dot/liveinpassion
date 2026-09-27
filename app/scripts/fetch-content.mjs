// 构建期内容拉取脚本
// 从 Worker public API 拉取博客与相册数据，写入 app/src/data/content/*.json
// 失败时保留仓库内最近一次快照（不覆盖为空），确保不发布空站
//
// 用法：node scripts/fetch-content.mjs
// 环境变量：
//   CMS_API_BASE  —— Worker API 地址，默认 https://cms.liveinpassion.me
//   CMS_TIMEOUT   —— 请求超时毫秒，默认 15000

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

  // 拉取博客
  try {
    const data = await fetchJson('/api/posts');
    safeWrite(resolve(contentDir, 'blogPosts.json'), data);
    blogOk = true;
  } catch (err) {
    console.warn(`  ⚠ Blog fetch failed: ${err.message}`);
    console.warn('    Keeping existing blogPosts.json snapshot.');
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

  if (!blogOk || !albumsOk) {
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
