// LifeLogging 的**原始**数据（不脱敏，只遮盖凭证参数）。
//
//   POST /api/life/raw/ingest       本地流水线带 Bearer token 写入 R2
//   GET  /api/life/raw/index        有哪些 kind / 哪些 id（归档页的日期选择器）
//   GET  /api/life/raw/:kind/:id    单篇：journal 返回渲染后的 HTML + 原文；
//                                   其余 kind 返回解析后的 JSON
//
// 存储用 R2（不是 D1）：一天的事件 JSON 约 30–50 KB，日记/问答也不大，
// 但 R2 没有 D1 行大小与 SQL 长度限制，归档增长更稳。
//
// 公开边界由上游 publish_life_raw.py 负责：它只遮盖 URL 里像 token/state/code
// 的 query 值和 sk-/ghp_ 这类 key，日记、随手记、坐标、窗口标题、URL 路径全部保留。
// 这里不做字段白名单 —— 全量是这个接口的设计目标。
import { Hono } from 'hono';
import { lifeAuth } from './life.js';
import { renderMarkdown } from '../lib/markdown.js';

export const lifeRawRoutes = new Hono();

const PREFIX = 'life/raw/';
// watch：服务器侧单独发布的「手表路线」文档（GPX/FIT 解析结果）。
// 笔记本关机时它仍然每 15 分钟更新一次，地图靠它画虚线；笔记本发布的那份
// `events` 里也可能有同一批 watch_track，站点按开始时间去重，不会画两条。
const KINDS = new Set(['journal', 'notes', 'tasks', 'qa', 'events', 'blocks', 'weekly', 'vault', 'watch']);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_RE = /^\d{4}-W\d{2}$/;
const VAULT_ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_DOC_BYTES = 4 * 1024 * 1024;
const MAX_DOCS = 200;
const MAX_INDEX_PER_KIND = 365;

function objectKey(kind, id, format) {
  return `${PREFIX}${kind}/${id}.${format}`;
}

function metaOf(obj) {
  return {
    id: obj.key.slice(PREFIX.length).replace(/^[^/]+\//, '').replace(/\.(md|json)$/, ''),
    key: obj.key,
    size: obj.size,
    uploaded: obj.uploaded instanceof Date ? obj.uploaded.toISOString() : null,
  };
}

// ---------- POST /api/life/raw/ingest ----------

lifeRawRoutes.post('/life/raw/ingest', async (c) => {
  const denied = await lifeAuth(c);
  if (denied) return denied;

  const declared = Number(c.req.header('Content-Length') || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return c.json({ error: 'payload too large' }, 413);
  }

  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return c.json({ error: 'payload too large' }, 413);
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  if (!body || body.v !== 1 || !Array.isArray(body.docs)) {
    return c.json({ error: 'invalid body' }, 400);
  }
  if (body.docs.length < 1 || body.docs.length > MAX_DOCS) {
    return c.json({ error: 'invalid docs length' }, 400);
  }

  const seen = new Set();
  for (const doc of body.docs) {
    if (!doc || typeof doc !== 'object') return c.json({ error: 'invalid doc' }, 400);
    if (!KINDS.has(doc.kind)) return c.json({ error: 'invalid kind' }, 400);
    const idOk = doc.kind === 'weekly'
      ? WEEK_RE.test(doc.id)
      : doc.kind === 'vault'
        ? VAULT_ID_RE.test(doc.id)
        : DAY_RE.test(doc.id);
    if (!idOk) return c.json({ error: 'invalid id', kind: doc.kind }, 400);
    if (doc.format !== 'md' && doc.format !== 'json') {
      return c.json({ error: 'invalid format', kind: doc.kind, id: doc.id }, 400);
    }
    if (doc.format === 'md' && doc.kind !== 'journal' && doc.kind !== 'vault') {
      return c.json({ error: 'md only allowed for journal/vault' }, 400);
    }
    if (typeof doc.content !== 'string') {
      return c.json({ error: 'invalid content', kind: doc.kind, id: doc.id }, 400);
    }
    if (new TextEncoder().encode(doc.content).length > MAX_DOC_BYTES) {
      return c.json({ error: 'doc too large', kind: doc.kind, id: doc.id }, 413);
    }
    const key = objectKey(doc.kind, doc.id, doc.format);
    if (seen.has(key)) return c.json({ error: 'duplicate doc', kind: doc.kind, id: doc.id }, 400);
    seen.add(key);
  }

  try {
    for (const doc of body.docs) {
      const key = objectKey(doc.kind, doc.id, doc.format);
      await c.env.IMG_BUCKET.put(key, doc.content, {
        httpMetadata: {
          contentType: doc.format === 'md'
            ? 'text/markdown; charset=utf-8'
            : 'application/json; charset=utf-8',
        },
      });
    }
  } catch (err) {
    console.error('life raw ingest failed:', err?.message || err);
    return c.json({ error: 'store unavailable' }, 503);
  }

  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, accepted: body.docs.length });
});

// ---------- GET /api/life/raw/index ----------

lifeRawRoutes.get('/life/raw/index', async (c) => {
  const kinds = {};
  // watch 不进 `kinds`（归档页只认那 8 个），但**日期要能列出来**：
  // 笔记本整天关机时，那天的原始数据只有 watch 一份，地图得知道有这一天。
  const watchDays = [];
  let cursor = undefined;

  try {
    for (let page = 0; page < 10; page += 1) {
      const res = await c.env.IMG_BUCKET.list({ prefix: PREFIX, cursor, limit: 1000 });
      for (const obj of res.objects || []) {
        const rest = obj.key.slice(PREFIX.length);
        const slash = rest.indexOf('/');
        if (slash < 0) continue;
        const kind = rest.slice(0, slash);
        if (!KINDS.has(kind)) continue;
        // watch 是给地图读的内部文档，不进归档索引 —— 归档页只认那 8 个 kind。
        // 只留日期，放在单独的 watchDays 里给地图发现用。
        if (kind === 'watch') {
          watchDays.push(metaOf(obj).id);
          continue;
        }
        (kinds[kind] ||= []).push(metaOf(obj));
      }
      if (!res.truncated) break;
      cursor = res.cursor;
    }
  } catch (err) {
    console.error('life raw index failed:', err?.message || err);
    return c.json({ error: 'store unavailable' }, 503);
  }

  for (const kind of Object.keys(kinds)) {
    kinds[kind].sort((a, b) => b.id.localeCompare(a.id));
    kinds[kind] = kinds[kind].slice(0, MAX_INDEX_PER_KIND);
  }

  watchDays.sort((a, b) => b.localeCompare(a));

  c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  return c.json({
    v: 1,
    kinds,
    watchDays: watchDays.slice(0, MAX_INDEX_PER_KIND),
    generatedAt: new Date().toISOString(),
  });
});

// ---------- GET /api/life/raw/:kind/:id ----------

lifeRawRoutes.get('/life/raw/:kind/:id', async (c) => {
  const kind = c.req.param('kind');
  const id = c.req.param('id');
  if (!KINDS.has(kind)) return c.json({ error: 'invalid kind' }, 400);
  const idOk = kind === 'weekly'
    ? WEEK_RE.test(id)
    : kind === 'vault'
      ? VAULT_ID_RE.test(id)
      : DAY_RE.test(id);
  if (!idOk) return c.json({ error: 'invalid id' }, 400);

  const format = kind === 'journal' || kind === 'vault' ? 'md' : 'json';
  const key = objectKey(kind, id, format);

  let obj;
  try {
    obj = await c.env.IMG_BUCKET.get(key);
  } catch (err) {
    console.error('life raw read failed:', err?.message || err);
    return c.json({ error: 'store unavailable' }, 503);
  }
  if (!obj) return c.json({ error: 'not found', kind, id }, 404);

  const text = await obj.text();
  c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');

  if (kind === 'journal' || kind === 'vault') {
    // 去掉 Obsidian frontmatter 再渲染；原文一并返回，归档页可切换查看
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    return c.json({ v: 1, kind, id, format: 'md', html: renderMarkdown(body), raw: text });
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error('life raw json is invalid:', key);
    return c.json({ error: 'invalid stored json' }, 500);
  }
  return c.json({ v: 1, kind, id, format: 'json', data });
});
