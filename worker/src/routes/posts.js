// 博客 CRUD 路由
import { Hono } from 'hono';
import { requireAccessAuth } from '../lib/auth.js';
import { renderMarkdown, sanitizeExistingHtml, estimateReadTime } from '../lib/markdown.js';
import { triggerRebuild } from '../lib/github.js';
import { normalizeCategory, normalizeTags, normalizeRating, ratingToStored, tagsToStored } from '../lib/meta.js';

const app = new Hono();

// ---------- Admin 写接口（需鉴权） ----------

// 创建文章
app.post('/', requireAccessAuth, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();
  const { slug, cardTitle, title, contentMd, contentFormat, coverKey, coverFullKey } = body;

  if (!slug || !title || !cardTitle) {
    return c.json({ error: 'slug, cardTitle, title are required' }, 400);
  }
  // slug 白名单：小写字母、数字、连字符
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return c.json({ error: 'slug must match [a-z0-9-]+' }, 400);
  }

  const format = contentFormat || 'md';
  let contentHtml = '';
  if (format === 'md') {
    contentHtml = renderMarkdown(contentMd || '');
  } else {
    contentHtml = sanitizeExistingHtml(body.contentHtml || '');
  }

  const readTime = estimateReadTime(contentMd || body.contentHtml || '');
  const category = normalizeCategory(body.category);
  const tagsJson = tagsToStored(body.tags);
  const ratingStored = ratingToStored(body.rating);

  try {
    const result = await db.prepare(
      `INSERT INTO posts (slug, card_title, title, status, content_format, content_md, content_html,
        cover_key, cover_full_key, read_time_min, category, tags_json, rating_json,
        published_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'))`
    ).bind(
      slug, cardTitle, title, format, contentMd || null, contentHtml,
      coverKey || null, coverFullKey || null, readTime,
      category, tagsJson, ratingStored
    ).run();

    return c.json({ id: result.meta.last_row_id, slug }, 201);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return c.json({ error: 'slug already exists' }, 409);
    }
    throw err;
  }
});

// 更新文章
app.put('/:id', requireAccessAuth, async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const body = await c.req.json();

  const existing = await db.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Post not found' }, 404);

  const slug = body.slug || existing.slug;
  if (body.slug && !/^[a-z0-9-]+$/.test(body.slug)) {
    return c.json({ error: 'slug must match [a-z0-9-]+' }, 400);
  }

  const format = body.contentFormat || existing.content_format;
  let contentHtml = existing.content_html;
  let contentMd = existing.content_md;
  if (format === 'md' && body.contentMd !== undefined) {
    contentMd = body.contentMd;
    contentHtml = renderMarkdown(body.contentMd);
  } else if (format === 'html' && body.contentHtml !== undefined) {
    contentHtml = sanitizeExistingHtml(body.contentHtml);
  }

  const readTime = estimateReadTime(contentMd || contentHtml);

  // category/tags/rating 允许局部更新：没传就保留现有值，显式 null/undefined 才清空评级
  const hasCategory = 'category' in body;
  const hasTags = 'tags' in body;
  const hasRating = 'rating' in body;
  const category = hasCategory ? normalizeCategory(body.category) : existing.category;
  const tagsJson = hasTags ? tagsToStored(body.tags) : existing.tags_json;
  let ratingStored = existing.rating_json;
  if (hasRating) {
    ratingStored = body.rating == null ? null : ratingToStored(body.rating);
  }

  try {
    await db.prepare(
      `UPDATE posts SET slug=?, card_title=?, title=?, content_format=?, content_md=?, content_html=?,
        cover_key=?, cover_full_key=?, read_time_min=?, category=?, tags_json=?, rating_json=?,
        updated_at=datetime('now')
       WHERE id=?`
    ).bind(
      slug, body.cardTitle || existing.card_title, body.title || existing.title,
      format, contentMd, contentHtml,
      body.coverKey !== undefined ? body.coverKey : existing.cover_key,
      body.coverFullKey !== undefined ? body.coverFullKey : existing.cover_full_key,
      readTime,
      category, tagsJson, ratingStored,
      id
    ).run();
    return c.json({ ok: true });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return c.json({ error: 'slug already exists' }, 409);
    }
    throw err;
  }
});

// 发布/取消发布
app.patch('/:id/status', requireAccessAuth, async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const { status } = await c.req.json();
  if (!['draft', 'published'].includes(status)) {
    return c.json({ error: 'status must be draft or published' }, 400);
  }
  const isPublished = status === 'published';
  const sql = isPublished
    ? `UPDATE posts SET status='published', published_at=datetime('now'), updated_at=datetime('now') WHERE id=?`
    : `UPDATE posts SET status='draft', published_at=NULL, updated_at=datetime('now') WHERE id=?`;
  const result = await db.prepare(sql).bind(id).run();
  if (result.meta.changes === 0) return c.json({ error: 'Post not found' }, 404);
  // 触发前台重建（waitUntil 注册：响应返回后 Worker 仍会执行完 GitHub 调用）
  c.executionCtx.waitUntil(triggerRebuild(c.env, `post ${id} ${status}`).catch(() => {}));
  return c.json({ ok: true });
});

// 删除文章
app.delete('/:id', requireAccessAuth, async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const result = await db.prepare('DELETE FROM posts WHERE id=?').bind(id).run();
  if (result.meta.changes === 0) return c.json({ error: 'Post not found' }, 404);
  c.executionCtx.waitUntil(triggerRebuild(c.env, `post ${id} deleted`).catch(() => {}));
  return c.json({ ok: true });
});

// Admin 列表（含草稿）
app.get('/', requireAccessAuth, async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(
    `SELECT id, slug, card_title, title, status, content_format, read_time_min,
            cover_key, cover_full_key, category, tags_json, rating_json,
            published_at, created_at, updated_at
     FROM posts ORDER BY COALESCE(published_at, created_at) DESC`
  ).all();
  return c.json({ posts: rows.results.map(rowToPostAdmin) });
});

// Admin 单篇详情
app.get('/:id', requireAccessAuth, async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const row = await db.prepare('SELECT * FROM posts WHERE id=?').bind(id).first();
  if (!row) return c.json({ error: 'Post not found' }, 404);
  return c.json(rowToPostAdmin(row, true));
});

// ---------- 辅助函数 ----------

function rowToPostAdmin(row, withContent = false) {
  let tags = [];
  try { tags = row.tags_json ? JSON.parse(row.tags_json) : []; } catch { tags = []; }
  const rating = normalizeRating(row.rating_json);

  const post = {
    id: row.id,
    slug: row.slug,
    cardTitle: row.card_title,
    title: row.title,
    status: row.status,
    contentFormat: row.content_format,
    readTimeMin: row.read_time_min,
    coverKey: row.cover_key,
    coverFullKey: row.cover_full_key,
    category: row.category || 'UNFILED',
    tags,
    rating,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (withContent) {
    post.contentMd = row.content_md;
    post.contentHtml = row.content_html;
  }
  return post;
}

export { postsRoutes as default };
export const postsRoutes = app;
