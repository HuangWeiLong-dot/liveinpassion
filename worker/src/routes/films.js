// 影片库 CRUD（CMS 后台）
//
// 这里只管理**元数据**：视频与封面已经在 R2 里（key 手填），
// 不做大文件上传 —— 134 MB 的片子走 Worker 上传会撞请求体上限，
// 新片仍然按原来的方式放进 bucket（或另走上传工具）。
import { Hono } from 'hono';
import { requireAccessAuth } from '../lib/auth.js';
import { triggerRebuild } from '../lib/github.js';

const app = new Hono();

const STATUSES = ['draft', 'published'];

function rowToFilm(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle || '',
    description: row.description || '',
    videoKey: row.video_key || '',
    posterKey: row.poster_key || '',
    path: row.path || '/projection',
    status: row.status,
    sortOrder: row.sort_order,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizePath(raw) {
  const path = String(raw || '').trim();
  if (!path) return '/projection';
  if (/^https?:\/\//i.test(path)) return path;
  return path.startsWith('/') ? path : `/${path}`;
}

app.get('/', requireAccessAuth, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM films ORDER BY sort_order ASC, id ASC`
  ).all();
  return c.json({ films: rows.results.map(rowToFilm) });
});

app.post('/', requireAccessAuth, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();
  const slug = String(body.slug || '').trim();
  const title = String(body.title || '').trim();
  if (!slug || !title || !body.videoKey) {
    return c.json({ error: 'slug, title, videoKey are required' }, 400);
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return c.json({ error: 'slug must match [a-z0-9-]+' }, 400);
  }
  const status = STATUSES.includes(body.status) ? body.status : 'draft';

  try {
    const result = await db.prepare(
      `INSERT INTO films
        (slug, title, subtitle, description, video_key, poster_key, path, status,
         sort_order, published_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?,
         ?, CASE WHEN ?='published' THEN datetime('now') ELSE NULL END, datetime('now'))`
    ).bind(
      slug,
      title,
      body.subtitle || null,
      body.description || null,
      body.videoKey,
      body.posterKey || null,
      normalizePath(body.path),
      status,
      Number(body.sortOrder) || 0,
      status
    ).run();

    c.executionCtx.waitUntil(triggerRebuild(c.env, `film ${slug} created`).catch(() => {}));
    return c.json({ id: result.meta.last_row_id }, 201);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return c.json({ error: 'slug already exists' }, 409);
    }
    throw err;
  }
});

app.put('/:id', requireAccessAuth, async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const existing = await db.prepare('SELECT * FROM films WHERE id=?').bind(id).first();
  if (!existing) return c.json({ error: 'Film not found' }, 404);

  const slug = body.slug !== undefined ? String(body.slug).trim() : existing.slug;
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return c.json({ error: 'slug must match [a-z0-9-]+' }, 400);
  }
  const status = STATUSES.includes(body.status) ? body.status : existing.status;
  const publishedAt = status === 'published'
    ? (existing.published_at || new Date().toISOString())
    : null;

  try {
    await db.prepare(
      `UPDATE films SET slug=?, title=?, subtitle=?, description=?,
        video_key=?, poster_key=?, path=?, status=?, sort_order=?,
        published_at=?, updated_at=datetime('now')
       WHERE id=?`
    ).bind(
      slug,
      body.title !== undefined ? String(body.title).trim() : existing.title,
      body.subtitle !== undefined ? body.subtitle : existing.subtitle,
      body.description !== undefined ? body.description : existing.description,
      body.videoKey !== undefined ? body.videoKey : existing.video_key,
      body.posterKey !== undefined ? body.posterKey : existing.poster_key,
      body.path !== undefined ? normalizePath(body.path) : existing.path,
      status,
      body.sortOrder !== undefined ? Number(body.sortOrder) || 0 : existing.sort_order,
      publishedAt,
      id
    ).run();

    c.executionCtx.waitUntil(triggerRebuild(c.env, `film ${id} updated`).catch(() => {}));
    return c.json({ ok: true });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return c.json({ error: 'slug already exists' }, 409);
    }
    throw err;
  }
});

app.delete('/:id', requireAccessAuth, async (c) => {
  const id = Number(c.req.param('id'));
  const result = await c.env.DB.prepare('DELETE FROM films WHERE id=?').bind(id).run();
  if (result.meta.changes === 0) return c.json({ error: 'Film not found' }, 404);
  c.executionCtx.waitUntil(triggerRebuild(c.env, `film ${id} deleted`).catch(() => {}));
  return c.json({ ok: true });
});

export { app as filmsRoutes };
