// 分类 / 标签总览与管理。
//
// 这一页只处理**已发布**文章：草稿里的分类和标签不出现在统计里，也不会被
// 全局重命名 / 合并 / 删除波及。页面上展示的计数和操作范围保持一致。
import { Hono } from 'hono';
import { requireAccessAuth } from '../lib/auth.js';
import { triggerRebuild } from '../lib/github.js';
import { DEFAULT_CATEGORY, normalizeCategory, normalizeTags } from '../lib/meta.js';

const app = new Hono();

function parseTags(raw) {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

// 读出已发布文章的归类快照。normalize 一次，兼容早期没有归一化的旧数据。
async function loadPublished(db) {
  const rows = await db.prepare(
    `SELECT id, slug, card_title, title, category, tags_json, published_at
     FROM posts WHERE status='published' ORDER BY published_at DESC`
  ).all();
  return rows.results.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.card_title || row.title || row.slug,
    category: normalizeCategory(row.category),
    tags: normalizeTags(parseTags(row.tags_json)),
    publishedAt: row.published_at,
  }));
}

function aggregate(posts) {
  const categories = new Map();
  const tags = new Map();
  for (const post of posts) {
    categories.set(post.category, (categories.get(post.category) || 0) + 1);
    for (const tag of post.tags) tags.set(tag, (tags.get(tag) || 0) + 1);
  }
  const toList = (map) => [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { categories: toList(categories), tags: toList(tags) };
}

// 只写有变化的行；每条 UPDATE 都再确认一次 status='published'，
// 避免读取与写入之间文章被取消发布时误改草稿。
async function saveChanges(db, changes) {
  if (!changes.length) return 0;
  const statements = changes.map(({ id, category, tags }) => db.prepare(
    `UPDATE posts SET category=?, tags_json=?, updated_at=datetime('now')
     WHERE id=? AND status='published'`
  ).bind(category, JSON.stringify(tags), id));
  await db.batch(statements);
  return changes.length;
}

function rebuild(c, reason) {
  c.executionCtx.waitUntil(triggerRebuild(c.env, reason).catch(() => {}));
}

// 把一个标签改名 / 合并 / 删除。位置保持原样，重复项只保留第一次出现。
function renameTagInList(list, from, to) {
  if (!list.includes(from)) return null;
  const next = [];
  for (const tag of list) {
    if (tag === from) {
      if (to && !next.includes(to)) next.push(to);
    } else if (!next.includes(tag)) {
      next.push(tag);
    }
  }
  return normalizeTags(next);
}

// ---------- 总览 ----------

app.get('/', requireAccessAuth, async (c) => {
  const posts = await loadPublished(c.env.DB);
  const { categories, tags } = aggregate(posts);
  return c.json({ total: posts.length, categories, tags, posts });
});

// 多选批量更新：设置分类 / 加标签 / 去标签。
// 新分类、新标签都在这里"创建" —— 归类只在文章上存在，没有空的分类实体。
app.put('/posts', requireAccessAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : [];
  if (!ids.length) return c.json({ error: 'ids is required' }, 400);
  if (ids.length > 500) return c.json({ error: 'too many posts in one request (max 500)' }, 400);

  const hasCategory = body.category !== undefined && body.category !== null
    && String(body.category).trim() !== '';
  const category = hasCategory ? normalizeCategory(body.category) : '';
  const addTags = normalizeTags(body.addTags || []);
  const removeTags = new Set(normalizeTags(body.removeTags || []));
  if (!hasCategory && !addTags.length && !removeTags.size) {
    return c.json({ error: 'nothing to update' }, 400);
  }

  const posts = await loadPublished(c.env.DB);
  const byId = new Map(posts.map((post) => [post.id, post]));
  const changes = [];
  for (const id of ids) {
    const post = byId.get(id);
    if (!post) continue; // 不存在或已取消发布：静默跳过

    const nextCategory = hasCategory ? category : post.category;
    let tags = post.tags;
    if (addTags.length) tags = normalizeTags([...tags, ...addTags]);
    if (removeTags.size) tags = tags.filter((tag) => !removeTags.has(tag));

    const sameTags = JSON.stringify(tags) === JSON.stringify(post.tags);
    if (nextCategory === post.category && sameTags) continue;
    changes.push({ id, category: nextCategory, tags });
  }

  const affected = await saveChanges(c.env.DB, changes);
  if (affected) rebuild(c, `bulk taxonomy update (${affected} posts)`);
  return c.json({ ok: true, affected });
});

// ---------- 分类 ----------

// 重命名 / 合并到另一个分类（退回 UNFILED 走 DELETE）
app.put('/category', requireAccessAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  // 重命名必须显式给目标；把分类退回 UNFILED 走 DELETE，避免漏传 to 时误伤整组文章
  if (!body.from || !body.to) return c.json({ error: 'from and to are required' }, 400);
  const from = normalizeCategory(body.from);
  const to = normalizeCategory(body.to);
  if (from === to) return c.json({ ok: true, affected: 0 });

  const posts = await loadPublished(c.env.DB);
  const changes = posts
    .filter((post) => post.category === from)
    .map((post) => ({ id: post.id, category: to, tags: post.tags }));
  const affected = await saveChanges(c.env.DB, changes);
  if (affected) rebuild(c, `category ${from} → ${to}`);
  return c.json({ ok: true, affected });
});

// 删除分类：文章不删，归类退回 UNFILED
// 名字走 body 而不是路径段：分类 / 标签是自由文本，可能含 "/"，路径段会被拆开。
app.delete('/category', requireAccessAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const from = normalizeCategory(body.name);
  if (!body.name) return c.json({ error: 'name is required' }, 400);
  if (from === DEFAULT_CATEGORY) return c.json({ ok: true, affected: 0 });

  const posts = await loadPublished(c.env.DB);
  const changes = posts
    .filter((post) => post.category === from)
    .map((post) => ({ id: post.id, category: DEFAULT_CATEGORY, tags: post.tags }));
  const affected = await saveChanges(c.env.DB, changes);
  if (affected) rebuild(c, `category ${from} removed`);
  return c.json({ ok: true, affected });
});

// ---------- 标签 ----------

// 重命名 / 合并到另一个标签
app.put('/tag', requireAccessAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const from = normalizeTags([body.from])[0];
  if (!from) return c.json({ error: 'from is required' }, 400);
  // 移除标签走 DELETE；PUT 只做重命名 / 合并，必须给非空目标
  const to = normalizeTags([body.to])[0];
  if (!to) return c.json({ error: 'to is required' }, 400);
  if (from === to) return c.json({ ok: true, affected: 0 });

  const posts = await loadPublished(c.env.DB);
  const changes = [];
  for (const post of posts) {
    const next = renameTagInList(post.tags, from, to);
    if (next) changes.push({ id: post.id, category: post.category, tags: next });
  }
  const affected = await saveChanges(c.env.DB, changes);
  if (affected) rebuild(c, `tag ${from} → ${to}`);
  return c.json({ ok: true, affected });
});

// 从所有已发布文章里移除这个标签
app.delete('/tag', requireAccessAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const from = normalizeTags([body.name])[0];
  if (!from) return c.json({ error: 'name is required' }, 400);

  const posts = await loadPublished(c.env.DB);
  const changes = [];
  for (const post of posts) {
    const next = renameTagInList(post.tags, from, '');
    if (next) changes.push({ id: post.id, category: post.category, tags: next });
  }
  const affected = await saveChanges(c.env.DB, changes);
  if (affected) rebuild(c, `tag ${from} removed`);
  return c.json({ ok: true, affected });
});

export const taxonomyRoutes = app;
export { app as default };
