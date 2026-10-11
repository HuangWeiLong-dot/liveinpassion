#!/usr/bin/env node
// 把**旧路径**上的图片迁到**新布局**，并把 D1 里的引用一起改掉。
//
//   旧：原图 {旧前缀}/{名字}            压缩图 {旧前缀}/{...}_compressed/{名字}
//       例 blog_photos/1.jpg  ·  blog_photos/blog_photos_compressed/1.jpg
//       例 LiJiaZu/202605_1.jpg · LiJiaZu/LiJiaZu_compressed/202605_1.jpg
//   新：{type}/{yyyyMM}/{hash前8位}.{ext}  和  {type}/{yyyyMM}/_compressed/{hash8}.{ext}
//
// 走的是 worker **现成的管理 API**，所以不用改 worker 一行代码：
//   POST /api/admin/uploads          —— 按内容 hash 生成新 key（顺带去重、不改内容）
//   PUT  /api/admin/posts/:id        —— 改 coverKey / coverFullKey
//   PUT  /api/admin/albums/photos/:id—— 改 originalKey / compressedKey
//
// 用法（默认**只预演**，什么都不写）：
//   CMS_COOKIE='cms_session=...' node worker/scripts/migrate-legacy-images.mjs
//   CMS_COOKIE='cms_session=...' node worker/scripts/migrate-legacy-images.mjs --apply
//   可选： --only=posts | --only=albums | --only=all（默认 all）
//          --limit=10        只处理前 N 条（先试跑几条用）
//          --base=https://cms.liveinpassion.me
//
// cookie 怎么拿：浏览器打开 https://cms.liveinpassion.me/login 用密码登录，
// 然后 DevTools → Application → Cookies → 复制 cms_session 的值。
// ⚠ 这个脚本会**改线上数据**：先不带 --apply 跑一遍，看清它要动哪些行，再上 --apply。
//
// 迁移完的记录会写到 worker/scripts/out/migrate-<时间戳>.json（旧 key → 新 key），
// 万一要回滚就照着它改回去。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const BASE = val('base', 'https://cms.liveinpassion.me').replace(/\/$/, '');
const CDN = val('cdn', 'https://img.liveinpassion.me').replace(/\/$/, '');
const COOKIE = process.env.CMS_COOKIE || '';
const APPLY = has('--apply');
const ONLY = val('only', 'all');
const LIMIT = Number(val('limit', '0')) || 0;

// 新布局长这样：{type}/{yyyyMM}/... —— 已经是这个形状的就不用动
const NEW_KEY = /^[a-z]+\/\d{6}\//;

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out');

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
};

if (!COOKIE) {
  console.error(c.bad('缺 CMS_COOKIE。'));
  console.error('浏览器登录 https://cms.liveinpassion.me/login，然后：');
  console.error("  CMS_COOKIE='cms_session=粘贴这里' node worker/scripts/migrate-legacy-images.mjs");
  process.exit(2);
}

const auth = { Cookie: COOKIE };

async function api(method, url, body, init = {}) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { ...auth, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error(`401：cookie 失效或不对（${url}）`);
  if (!res.ok) throw new Error(`${method} ${url} → HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** 从 CDN 取回旧图（公开读，不需要鉴权） */
async function fetchImage(key) {
  const res = await fetch(`${CDN}/${key}`);
  if (!res.ok) throw new Error(`取旧图失败 ${key} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, type: res.headers.get('content-type') || 'application/octet-stream' };
}

/**
 * 上传一对图到 R2：走 worker 的上传接口，新 key 由内容 hash 生成。
 * ⚠ 原图和压缩图必须在**同一次**请求里（`file` + `compressed`）——
 *   worker 那边 `file` 是必填，分两次调用第二次会直接 400。
 */
async function uploadPair(name, type, originalBuf, compressedBuf) {
  const form = new FormData();
  form.set('type', type);
  form.set('file', new Blob([originalBuf]), name);
  if (compressedBuf) form.set('compressed', new Blob([compressedBuf]), name);
  const res = await fetch(`${BASE}/api/admin/uploads`, { method: 'POST', headers: auth, body: form });
  if (!res.ok) throw new Error(`上传失败 → HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json(); // { original: {key,url} | null, compressed: {key,url} | null }
}

const str = (v) => (v == null ? '' : String(v));
const pick = (o, ...names) => {
  for (const n of names) if (o[n] != null) return o[n];
  return undefined;
};

const changes = [];
const errors = [];

// ── 文章封面 ────────────────────────────────────────────────────────────
async function migratePosts() {
  const { posts = [] } = await api('GET', '/api/admin/posts');
  let done = 0;
  for (const p of posts) {
    const coverKey = str(pick(p, 'coverKey', 'cover_key'));
    const fullKey = str(pick(p, 'coverFullKey', 'cover_full_key'));
    if (!coverKey && !fullKey) continue;
    if (NEW_KEY.test(coverKey) && NEW_KEY.test(fullKey)) continue; // 已是新布局
    if (LIMIT && done >= LIMIT) break;
    done += 1;
    const slug = pick(p, 'slug') || p.id;
    console.log(`\n${c.dim('文章')} ${slug}  (id=${p.id})`);
    console.log(`  旧 key  压缩=${coverKey || '-'}  原图=${fullKey || '-'}`);
    if (!APPLY) {
      console.log(c.warn('  → 预演：会把这两张传成新 key，并写回 D1'));
      changes.push({ kind: 'post', id: p.id, slug, from: { coverKey, fullKey } });
      continue;
    }
    try {
      const originalBuf = fullKey ? (await fetchImage(fullKey)).buf : null;
      const compressedBuf = coverKey ? (await fetchImage(coverKey)).buf : null;
      const name = (fullKey || coverKey).split('/').pop();
      const out = await uploadPair(name, 'blog', originalBuf, compressedBuf);
      console.log(`  ${c.ok('✓')} ${coverKey} → ${out.compressed?.key || '-'}`);
      console.log(`  ${c.ok('✓')} ${fullKey} → ${out.original?.key || '-'}`);
      await api('PUT', `/api/admin/posts/${p.id}`, {
        coverKey: out.compressed ? out.compressed.key : coverKey,
        coverFullKey: out.original ? out.original.key : fullKey,
      });
      console.log(`  ${c.ok('✓ 已写回 D1')}`);
      changes.push({
        kind: 'post', id: p.id, slug,
        from: { coverKey, fullKey },
        to: { coverKey: out.compressed?.key, fullKey: out.original?.key },
      });
    } catch (e) {
      console.log(`  ${c.bad('✗ ' + e.message)}`);
      errors.push({ kind: 'post', id: p.id, slug, error: e.message });
    }
  }
  console.log(`\n文章：${done} 条需要迁移`);
}

// ── 相册照片 ────────────────────────────────────────────────────────────
async function migrateAlbums() {
  const { albums = [] } = await api('GET', '/api/admin/albums');
  let done = 0;
  for (const a of albums) {
    let photos = [];
    try {
      ({ photos = [] } = await api('GET', `/api/admin/albums/${a.id}/photos`));
    } catch (e) {
      errors.push({ kind: 'album', id: a.id, error: e.message });
      continue;
    }
    const legacy = photos.filter((ph) => {
      const ok = str(pick(ph, 'originalKey', 'original_key'));
      const ck = str(pick(ph, 'compressedKey', 'compressed_key'));
      return !(NEW_KEY.test(ok) && (!ck || NEW_KEY.test(ck)));
    });
    if (!legacy.length) continue;
    console.log(`\n${c.dim('相册')} ${pick(a, 'name')}  (id=${a.id}, ${pick(a, 'kind')})  `
      + `需迁移 ${legacy.length}/${photos.length}`);
    // 新布局的 type 前缀：me 相册 → me，其余 → album
    const type = str(pick(a, 'kind')) === 'me' ? 'me' : 'album';
    for (const ph of legacy) {
      if (LIMIT && done >= LIMIT) break;
      done += 1;
      const originalKey = str(pick(ph, 'originalKey', 'original_key'));
      const compressedKey = str(pick(ph, 'compressedKey', 'compressed_key'));
      const name = str(pick(ph, 'fileName', 'file_name')) || originalKey.split('/').pop();
      if (!APPLY) {
        changes.push({ kind: 'photo', id: ph.id, albumId: a.id, name, from: { originalKey, compressedKey } });
        continue;
      }
      try {
        const originalBuf = originalKey ? (await fetchImage(originalKey)).buf : null;
        const compressedBuf = compressedKey ? (await fetchImage(compressedKey)).buf : null;
        if (!originalBuf && !compressedBuf) throw new Error('两个 key 都取不到图');
        // worker 的 `file` 是必填：只有压缩图时拿它顶上
        const out = await uploadPair(name, type, originalBuf || compressedBuf, originalBuf ? compressedBuf : null);
        await api('PUT', `/api/admin/albums/photos/${ph.id}`, {
          fileName: name,
          originalKey: out.original ? out.original.key : originalKey,
          compressedKey: out.compressed ? out.compressed.key : (compressedKey || undefined),
        });
        console.log(`  ${c.ok('✓')} ${name}  → ${out.original?.key || ''}`);
        changes.push({
          kind: 'photo', id: ph.id, albumId: a.id, name,
          from: { originalKey, compressedKey },
          to: { originalKey: out.original?.key, compressedKey: out.compressed?.key },
        });
      } catch (e) {
        console.log(`  ${c.bad('✗ ' + name + '：' + e.message)}`);
        errors.push({ kind: 'photo', id: ph.id, albumId: a.id, name, error: e.message });
      }
    }
  }
  console.log(`\n相册：${done} 张需要迁移`);
}

console.log(`${APPLY ? c.bad('== 执行 ==') : c.warn('== 预演（不写任何东西）==')}  base=${BASE}`);
try {
  if (ONLY === 'all' || ONLY === 'posts') await migratePosts();
  if (ONLY === 'all' || ONLY === 'albums') await migrateAlbums();
} catch (e) {
  console.error(c.bad('\n中断：' + e.message));
  errors.push({ kind: 'fatal', error: e.message });
}

console.log(`\n待迁移/已迁移：${changes.length} 条${errors.length ? `，出错 ${errors.length} 条` : ''}`);
if (!APPLY) console.log(c.warn('这是预演。确认无误后加 --apply 真跑。'));
if (APPLY && changes.length) {
  fs.mkdirSync(outDir, { recursive: true });
  const f = path.join(outDir, `migrate-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(f, JSON.stringify({ base: BASE, applied: true, changes, errors }, null, 2));
  console.log(`映射已写到 ${f}（回滚可照着它改回去）`);
}
if (errors.length) process.exitCode = 1;
