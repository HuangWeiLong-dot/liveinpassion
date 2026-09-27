// 旧博客迁移脚本：将 app/src/data/content/blogPosts.json 的文章写入 D1
// 用法：node scripts/migrate-blog.mjs [API_BASE]
//   API_BASE 默认 http://127.0.0.1:8787（本地），生产传 https://cms.liveinpassion.me
// 注意：旧文为 HTML，content_format=html，封面沿用现有 R2 key（不重新上传）

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const snapshotPath = resolve(__dirname, '../../app/src/data/content/blogPosts.json');
const { posts: blogPosts } = JSON.parse(readFileSync(snapshotPath, 'utf-8'));

const API_BASE = process.argv[2] || 'http://127.0.0.1:8787';
const CDN_BASE = 'https://img.liveinpassion.me';

function urlToKey(url) {
  if (!url) return null;
  return url.replace(CDN_BASE + '/', '');
}

async function main() {
  console.log(`Migrating ${blogPosts.length} blog posts to ${API_BASE}...`);

  for (const post of blogPosts) {
    const coverKey = urlToKey(post.image?.src);       // 压缩图
    const coverFullKey = urlToKey(post.image?.fullSrc); // 原图

    const body = {
      slug: post.slug,
      cardTitle: post.cardTitle,
      title: post.title,
      contentFormat: 'html',
      contentHtml: post.body,
      coverKey,
      coverFullKey,
    };

    const res = await fetch(`${API_BASE}/api/admin/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`Failed to create ${post.slug}: ${res.status} ${err}`);
      continue;
    }

    const data = await res.json();
    // 发布
    const pubRes = await fetch(`${API_BASE}/api/admin/posts/${data.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'published' }),
    });

    if (pubRes.ok) {
      console.log(`  ✓ ${post.slug} (id=${data.id}) published`);
    } else {
      console.error(`  ✗ ${post.slug} published failed: ${pubRes.status}`);
    }
  }

  console.log('Migration complete.');
}

main().catch(console.error);
