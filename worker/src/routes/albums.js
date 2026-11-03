// 相册与照片 CRUD 路由
import { Hono } from 'hono';
import { requireAccessAuth } from '../lib/auth.js';
import { CDN_BASE } from '../lib/r2.js';
import { triggerRebuild } from '../lib/github.js';

const app = new Hono();

// ---------- 相册 ----------

// Admin 列表
app.get('/', requireAccessAuth, async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(
    `SELECT * FROM albums ORDER BY sort_order ASC, created_at ASC`
  ).all();
  return c.json({ albums: rows.results });
});

// 创建相册
app.post('/', requireAccessAuth, async (c) => {
  const db = c.env.DB;
  const { r2Prefix, name, kind, person, sortOrder } = await c.req.json();
  if (!r2Prefix || !name || !kind) {
    return c.json({ error: 'r2Prefix, name, kind are required' }, 400);
  }
  if (!['friend', 'group', 'me', 'photography'].includes(kind)) {
    return c.json({ error: 'kind must be friend, group, me, or photography' }, 400);
  }
  const resolvedPerson = resolvePerson(kind, person, r2Prefix);
  if (kind === 'photography' && !resolvedPerson) {
    return c.json({ error: 'person is required for photography albums' }, 400);
  }
  if (kind === 'photography' && !r2Prefix.startsWith('photography/')) {
    return c.json({ error: 'photography r2Prefix must start with photography/' }, 400);
  }
  try {
    const result = await db.prepare(
      `INSERT INTO albums (r2_prefix, name, kind, person, sort_order) VALUES (?, ?, ?, ?, ?)`
    ).bind(r2Prefix, name, kind, resolvedPerson, sortOrder || 0).run();
    c.executionCtx.waitUntil(triggerRebuild(c.env, `album ${r2Prefix} created`).catch(() => {}));
    return c.json({ id: result.meta.last_row_id }, 201);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return c.json({ error: 'r2Prefix already exists' }, 409);
    }
    throw err;
  }
});

// 更新相册
app.put('/:id', requireAccessAuth, async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const existing = await db.prepare('SELECT * FROM albums WHERE id=?').bind(id).first();
  if (!existing) return c.json({ error: 'Album not found' }, 404);

  const kind = body.kind || existing.kind;
  const r2Prefix = body.r2Prefix || existing.r2_prefix;
  const resolvedPerson = resolvePerson(kind, body.person ?? existing.person, r2Prefix);

  await db.prepare(
    `UPDATE albums SET r2_prefix=?, name=?, kind=?, person=?, cover_photo_id=?, sort_order=? WHERE id=?`
  ).bind(
    r2Prefix,
    body.name || existing.name,
    kind,
    resolvedPerson,
    body.coverPhotoId !== undefined ? body.coverPhotoId : existing.cover_photo_id,
    body.sortOrder !== undefined ? body.sortOrder : existing.sort_order,
    id
  ).run();
  c.executionCtx.waitUntil(triggerRebuild(c.env, `album ${id} updated`).catch(() => {}));
  return c.json({ ok: true });
});

// 删除相册（仅删 D1 记录，R2 对象保留）
app.delete('/:id', requireAccessAuth, async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  await db.prepare('DELETE FROM photos WHERE album_id=?').bind(id).run();
  const result = await db.prepare('DELETE FROM albums WHERE id=?').bind(id).run();
  if (result.meta.changes === 0) return c.json({ error: 'Album not found' }, 404);
  c.executionCtx.waitUntil(triggerRebuild(c.env, `album ${id} deleted`).catch(() => {}));
  return c.json({ ok: true });
});

// ---------- 照片 ----------

// 相册下的照片列表
app.get('/:id/photos', requireAccessAuth, async (c) => {
  const db = c.env.DB;
  const albumId = Number(c.req.param('id'));
  const rows = await db.prepare(
    `SELECT * FROM photos WHERE album_id=? ORDER BY sort_order ASC, id ASC`
  ).bind(albumId).all();
  return c.json({ photos: rows.results.map(rowToPhoto) });
});

// 批量添加照片
app.post('/:id/photos', requireAccessAuth, async (c) => {
  const db = c.env.DB;
  const albumId = Number(c.req.param('id'));
  const { photos } = await c.req.json();
  if (!Array.isArray(photos) || photos.length === 0) {
    return c.json({ error: 'photos array is required' }, 400);
  }

  const album = await db.prepare('SELECT * FROM albums WHERE id=?').bind(albumId).first();
  if (!album) return c.json({ error: 'Album not found' }, 404);

  const stmt = db.prepare(
    `INSERT INTO photos (album_id, file_name, original_key, compressed_key, width, height, size_bytes, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const batch = photos.map((p, idx) => stmt.bind(
    albumId, p.fileName, p.originalKey, p.compressedKey || null,
    p.width || null, p.height || null, p.sizeBytes || null, p.sortOrder ?? idx
  ));
  await db.batch(batch);
  c.executionCtx.waitUntil(triggerRebuild(c.env, `photos added to album ${albumId}`).catch(() => {}));
  return c.json({ ok: true, count: photos.length }, 201);
});

// 更新单张照片
app.put('/photos/:photoId', requireAccessAuth, async (c) => {
  const db = c.env.DB;
  const photoId = Number(c.req.param('photoId'));
  const body = await c.req.json();
  const existing = await db.prepare('SELECT * FROM photos WHERE id=?').bind(photoId).first();
  if (!existing) return c.json({ error: 'Photo not found' }, 404);

  await db.prepare(
    `UPDATE photos SET file_name=?, original_key=?, compressed_key=?, sort_order=? WHERE id=?`
  ).bind(
    body.fileName || existing.file_name,
    body.originalKey || existing.original_key,
    body.compressedKey !== undefined ? body.compressedKey : existing.compressed_key,
    body.sortOrder !== undefined ? body.sortOrder : existing.sort_order,
    photoId
  ).run();
  c.executionCtx.waitUntil(triggerRebuild(c.env, `photo ${photoId} updated`).catch(() => {}));
  return c.json({ ok: true });
});

// 批量更新排序
app.put('/:id/photos/reorder', requireAccessAuth, async (c) => {
  const db = c.env.DB;
  const albumId = Number(c.req.param('id'));
  const { orders } = await c.req.json(); // [{id, sortOrder}]
  if (!Array.isArray(orders)) return c.json({ error: 'orders array required' }, 400);

  const batch = orders.map((o) =>
    db.prepare('UPDATE photos SET sort_order=? WHERE id=? AND album_id=?').bind(o.sortOrder, o.id, albumId)
  );
  await db.batch(batch);
  c.executionCtx.waitUntil(triggerRebuild(c.env, `album ${albumId} photos reordered`).catch(() => {}));
  return c.json({ ok: true });
});

// 从相册移除照片（仅删 D1 记录，R2 对象保留）
app.delete('/photos/:photoId', requireAccessAuth, async (c) => {
  const db = c.env.DB;
  const photoId = Number(c.req.param('photoId'));
  const result = await db.prepare('DELETE FROM photos WHERE id=?').bind(photoId).run();
  if (result.meta.changes === 0) return c.json({ error: 'Photo not found' }, 404);
  c.executionCtx.waitUntil(triggerRebuild(c.env, `photo ${photoId} removed`).catch(() => {}));
  return c.json({ ok: true });
});

// ---------- 辅助 ----------

// photography 的人名同时是 /photography/:person 的路由段与 R2 子目录：
// 优先用显式传入的 person，其次从 r2Prefix（photography/xxx）里取。
function resolvePerson(kind, person, r2Prefix) {
  if (kind !== 'photography') return null;
  // 存进 D1 的是路由段（去掉空格），展示名走 albums.name
  const explicit = String(person || '').trim().replace(/\s+/g, '');
  if (explicit) return explicit;
  const prefix = String(r2Prefix || '');
  return prefix.startsWith('photography/') ? prefix.slice('photography/'.length) : null;
}

function rowToPhoto(row) {
  return {
    id: row.id,
    albumId: row.album_id,
    fileName: row.file_name,
    originalKey: row.original_key,
    compressedKey: row.compressed_key,
    originalUrl: `${CDN_BASE}/${row.original_key}`,
    compressedUrl: row.compressed_key ? `${CDN_BASE}/${row.compressed_key}` : null,
    width: row.width,
    height: row.height,
    sizeBytes: row.size_bytes,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

export const albumsRoutes = app;
