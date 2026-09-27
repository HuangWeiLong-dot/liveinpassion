// 存量照片迁移脚本：基于内容快照创建相册与照片记录
// 用法：node scripts/migrate-photos.mjs [API_BASE]
//
// 数据来源：app/src/data/content/albums.json（构建期快照，含全部相册与照片）
//
// R2 结构：
//   {prefix}/          —— 原图
//   {prefix}/{prefix}_compressed/ —— 压缩图（朋友画廊、合影）
//   Me/                —— Me 原图
//   Me/compressed_me/  —— Me 压缩图

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const snapshotPath = resolve(__dirname, '../../app/src/data/content/albums.json');
const { albums: snapshotAlbums } = JSON.parse(readFileSync(snapshotPath, 'utf-8'));

const API_BASE = process.argv[2] || 'http://127.0.0.1:8787';

// 相册定义：kind 由 r2Prefix 推断，其余直接来自快照
const ALBUMS = snapshotAlbums.map((a) => ({
  r2Prefix: a.r2Prefix,
  name: a.name,
  kind: a.kind,
  photos: a.photos,
}));

const CDN_BASE = 'https://img.liveinpassion.me';

function urlToKey(url) {
  if (!url) return null;
  return url.replace(CDN_BASE + '/', '');
}

async function createAlbum(albumDef, sortOrder) {
  const res = await fetch(`${API_BASE}/api/admin/albums`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      r2Prefix: albumDef.r2Prefix,
      name: albumDef.name,
      kind: albumDef.kind,
      sortOrder,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create album ${albumDef.r2Prefix}: ${res.status} ${err}`);
  }
  return (await res.json()).id;
}

async function addPhotos(albumId, photos) {
  const payload = photos.map((p, idx) => ({
    fileName: p.filename,
    originalKey: urlToKey(p.fullSrc),
    compressedKey: urlToKey(p.src),
    sortOrder: idx,
  }));
  const res = await fetch(`${API_BASE}/api/admin/albums/${albumId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photos: payload }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to add photos to album ${albumId}: ${res.status} ${err}`);
  }
  return res.json();
}

async function main() {
  const allAlbums = ALBUMS;
  console.log(`Migrating ${allAlbums.length} albums...`);

  for (let i = 0; i < allAlbums.length; i++) {
    const albumDef = allAlbums[i];
    try {
      const albumId = await createAlbum(albumDef, i);
      await addPhotos(albumId, albumDef.photos);
      console.log(`  ✓ ${albumDef.r2Prefix} (id=${albumId}): ${albumDef.photos.length} photos`);
    } catch (err) {
      console.error(`  ✗ ${albumDef.r2Prefix}: ${err.message}`);
    }
  }

  console.log('Photo migration complete.');
}

main().catch(console.error);
