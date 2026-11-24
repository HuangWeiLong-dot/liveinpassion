// 博客 CRUD 路由
import { Hono } from 'hono';
import { requireAccessAuth } from '../lib/auth.js';
import { renderMarkdown, sanitizeExistingHtml, estimateReadTime } from '../lib/markdown.js';
import { triggerRebuild } from '../lib/github.js';
import { normalizeCategory, normalizeTags, tagsToStored } from '../lib/meta.js';

const app = new Hono();

// 封面来源：一句说明 + 原图 / 原书链接。链接只允许 http(s)，
// 没写协议时补 https://；其它协议（javascript: 等）直接拒绝。
function normalizeCredit(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 160);
}

function normalizeCreditUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { url: '' };
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { error: true };
    return { url: parsed.toString().slice(0, 500) };
  } catch {
    return { error: true };
  }
}

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
  const coverCredit = normalizeCredit(body.coverCredit);
  const coverCreditUrl = normalizeCreditUrl(body.coverCreditUrl);
  if (coverCreditUrl.error) {
    return c.json({ error: 'coverCreditUrl must start with http:// or https://' }, 400);
  }

  try {
    const result = await db.prepare(
      `INSERT INTO posts (slug, card_title, title, status, content_format, content_md, content_html,
        cover_key, cover_full_key, cover_credit, cover_credit_url, read_time_min, category, tags_json,
        published_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'))`
    ).bind(
      slug, cardTitle, title, format, contentMd || null, contentHtml,
      coverKey || null, coverFullKey || null, coverCredit, coverCreditUrl.url, readTime,
      category, tagsJson
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

  // category/tags 允许局部更新：没传就保留现有值
  const hasCategory = 'category' in body;
  const hasTags = 'tags' in body;
  const category = hasCategory ? normalizeCategory(body.category) : existing.category;
  const tagsJson = hasTags ? tagsToStored(body.tags) : existing.tags_json;

  // 封面来源同样允许局部更新
  const hasCredit = 'coverCredit' in body;
  const hasCreditUrl = 'coverCreditUrl' in body;
  const coverCredit = hasCredit ? normalizeCredit(body.coverCredit) : (existing.cover_credit || '');
  const creditUrl = hasCreditUrl
    ? normalizeCreditUrl(body.coverCreditUrl)
    : { url: existing.cover_credit_url || '' };
  if (creditUrl.error) {
    return c.json({ error: 'coverCreditUrl must start with http:// or https://' }, 400);
  }

  try {
    await db.prepare(
      `UPDATE posts SET slug=?, card_title=?, title=?, content_format=?, content_md=?, content_html=?,
        cover_key=?, cover_full_key=?, cover_credit=?, cover_credit_url=?,
        read_time_min=?, category=?, tags_json=?,
        updated_at=datetime('now')
       WHERE id=?`
    ).bind(
      slug, body.cardTitle || existing.card_title, body.title || existing.title,
      format, contentMd, contentHtml,
      body.coverKey !== undefined ? body.coverKey : existing.cover_key,
      body.coverFullKey !== undefined ? body.coverFullKey : existing.cover_full_key,
      coverCredit, creditUrl.url,
      readTime,
      category, tagsJson,
      id
    ).run();
    // 已发布文章的任何编辑（分类 / 标签 / 正文 / 封面）都要重建前台；
    // 不调用 setStatus，所以 published_at 不变，历史编号与排序保留。
    if (existing.status === 'published') {
      c.executionCtx.waitUntil(triggerRebuild(c.env, `post ${id} updated`).catch(() => {}));
    }
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
  // 只有从未发布过的草稿才写入 now；重新发布、或发布后再取消，日期都保留，
  // 这样前台的编号 / 排序不会因为一次状态切换被改写。
  const sql = isPublished
    ? `UPDATE posts SET status='published', published_at=COALESCE(published_at, datetime('now')), updated_at=datetime('now') WHERE id=?`
    : `UPDATE posts SET status='draft', updated_at=datetime('now') WHERE id=?`;
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
            cover_key, cover_full_key, cover_credit, cover_credit_url, category, tags_json,
            published_at, created_at, updated_at
     FROM posts ORDER BY COALESCE(published_at, created_at) DESC, id DESC`
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
    coverCredit: row.cover_credit || '',
    coverCreditUrl: row.cover_credit_url || '',
    category: row.category || 'UNFILED',
    tags,
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
