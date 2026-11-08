// Public 只读 API：供前台构建期拉取
import { Hono } from 'hono';
import { CDN_BASE } from '../lib/r2.js';

const app = new Hono();

function parseTags(raw) {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

// 博客列表（仅已发布）
app.get('/posts', async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(
    `SELECT slug, card_title, title, content_format, content_html,
            cover_key, cover_full_key, read_time_min, category, tags_json,
            published_at
     FROM posts WHERE status='published' ORDER BY published_at DESC`
  ).all();

  const posts = rows.results.map((row) => ({
    slug: row.slug,
    cardTitle: row.card_title,
    cardDate: formatCardDate(row.published_at),
    title: row.title,
    date: formatDate(row.published_at),
    readTime: `${row.read_time_min} min read`,
    category: row.category || 'UNFILED',
    tags: parseTags(row.tags_json),
    image: {
      src: row.cover_key ? `${CDN_BASE}/${row.cover_key}` : null,
      fullSrc: row.cover_full_key ? `${CDN_BASE}/${row.cover_full_key}` : null,
    },
    body: row.content_html,
  }));

  return c.json({ posts });
});

// ---------- AI / LLM export ----------
// 公开、只读、只含已发布文章。给 AI chat / agent 一份干净的 Markdown 全文，
// 避免它们去啃 JSON + HTML。查询参数：
//   category=LETTER  tag=LOVE  since=2026-01-01  limit=10
const SITE = 'https://liveinpassion.me';
const EXPORT_HEADERS = {
  'Content-Type': 'text/markdown; charset=utf-8',
  'Cache-Control': 'public, max-age=300',
  // 浏览器里的 AI 工具也能直接拿；服务端抓取本来就不受 CORS 限制
  'Access-Control-Allow-Origin': '*',
};

function decodeEntities(text) {
  const map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => map[n.toLowerCase()] ?? m);
}

// 只有极老的 HTML 行才走到这里；content_md 是首选。
function htmlToText(html) {
  const NL = String.fromCharCode(10);
  return decodeEntities(String(html || '')
    .replace(/<br\s*\/?>/gi, NL)
    .replace(/<\/(p|div|h[1-6]|blockquote|li)>/gi, NL + NL)
    .replace(/<[^>]+>/g, ''))
    .replace(new RegExp(NL + '{3,}', 'g'), NL + NL)
    .trim();
}

function bodyForExport(row) {
  if (row.content_md) {
    const NL = String.fromCharCode(10);
    return String(row.content_md).replace(
      /<div[^>]*class="[^"]*page-break[^"]*"[^>]*>\s*<\/div>/gi,
      NL + NL + '---' + NL + NL
    );
  }
  return htmlToText(row.content_html);
}

function filterRows(rows, c) {
  const slug = String(c.req.query('slug') || '').trim();
  const category = String(c.req.query('category') || '').trim().toUpperCase();
  const tag = String(c.req.query('tag') || '').trim().toUpperCase();
  const since = String(c.req.query('since') || '').trim().slice(0, 10);
  const rawLimit = Number(c.req.query('limit') || 0);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 0;
  let list = rows;
  if (slug) list = list.filter((r) => r.slug === slug);
  if (category) list = list.filter((r) => String(r.category || 'UNFILED').toUpperCase() === category);
  if (tag) list = list.filter((r) => parseTags(r.tags_json).map((t) => String(t).toUpperCase()).includes(tag));
  if (since) list = list.filter((r) => String(r.published_at || '').slice(0, 10) >= since);
  if (limit) list = list.slice(0, limit);
  return list;
}

app.get('/posts/export.md', async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(
    `SELECT slug, card_title, title, published_at, category, tags_json, content_md, content_html
     FROM posts WHERE status='published' ORDER BY published_at DESC`
  ).all();
  const list = filterRows(rows.results, c);
  const lines = [
    '# LIVE IN PASSION — ECHOES',
    '',
    `> ${list.length} published piece${list.length === 1 ? '' : 's'} · exported ${new Date().toISOString()}`,
    '> Only published posts. Drafts are excluded.',
    '',
    '---',
    '',
  ];
  for (const row of list) {
    const tags = parseTags(row.tags_json);
    lines.push(
      `## ${row.title || row.card_title || row.slug}`,
      '',
      `- Slug: \`${row.slug}\``,
      `- Card title: ${row.card_title || row.title || row.slug}`,
      `- Date: ${formatDate(row.published_at) || row.published_at || ''}`,
      `- Category: ${row.category || 'UNFILED'}`,
      `- Tags: ${tags.length ? tags.join(', ') : '—'}`,
      `- URL: ${SITE}/echoes/${row.slug}`,
      '',
      bodyForExport(row) || '_(empty)_',
      '',
      '---',
      '',
    );
  }
  return new Response(lines.join(String.fromCharCode(10)), { headers: EXPORT_HEADERS });
});

app.get('/posts/index.json', async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(
    `SELECT slug, card_title, title, published_at, category, tags_json, read_time_min
     FROM posts WHERE status='published' ORDER BY published_at DESC`
  ).all();
  const list = filterRows(rows.results, c);
  return new Response(JSON.stringify({
    site: SITE,
    count: list.length,
    posts: list.map((row) => ({
      slug: row.slug,
      title: row.title,
      cardTitle: row.card_title,
      date: formatDate(row.published_at) || row.published_at || '',
      category: row.category || 'UNFILED',
      tags: parseTags(row.tags_json),
      readTime: `${row.read_time_min} min read`,
      url: `${SITE}/echoes/${row.slug}`,
      markdown: `${new URL(c.req.url).origin}/api/posts/export.md?slug=${encodeURIComponent(row.slug)}`,
    })),
  }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

// 单篇博客（仅已发布）
app.get('/posts/:slug', async (c) => {
  const db = c.env.DB;
  const slug = c.req.param('slug');
  const row = await db.prepare(
    `SELECT slug, card_title, title, content_format, content_html,
            cover_key, cover_full_key, read_time_min, category, tags_json,
            published_at
     FROM posts WHERE slug=? AND status='published'`
  ).bind(slug).first();

  if (!row) return c.json({ error: 'Post not found' }, 404);

  return c.json({
    slug: row.slug,
    cardTitle: row.card_title,
    cardDate: formatCardDate(row.published_at),
    title: row.title,
    date: formatDate(row.published_at),
    readTime: `${row.read_time_min} min read`,
    category: row.category || 'UNFILED',
    tags: parseTags(row.tags_json),
    image: {
      src: row.cover_key ? `${CDN_BASE}/${row.cover_key}` : null,
      fullSrc: row.cover_full_key ? `${CDN_BASE}/${row.cover_full_key}` : null,
    },
    body: row.content_html,
  });
});

// 相册列表（含照片，仅返回有照片的或全部？返回全部相册及其照片）
app.get('/albums', async (c) => {
  const db = c.env.DB;
  const albums = await db.prepare(
    `SELECT * FROM albums ORDER BY sort_order ASC, created_at ASC`
  ).all();
  const photos = await db.prepare(
    `SELECT * FROM photos ORDER BY sort_order ASC, id ASC`
  ).all();

  const photosByAlbum = {};
  for (const p of photos.results) {
    if (!photosByAlbum[p.album_id]) photosByAlbum[p.album_id] = [];
    photosByAlbum[p.album_id].push({
      id: p.id,
      filename: p.file_name,
      src: p.compressed_key ? `${CDN_BASE}/${p.compressed_key}` : `${CDN_BASE}/${p.original_key}`,
      fullSrc: `${CDN_BASE}/${p.original_key}`,
    });
  }

  const result = albums.results.map((a) => ({
    id: a.id,
    r2Prefix: a.r2_prefix,
    name: a.name,
    kind: a.kind,
    // photography 的人名（= /photography/:person 路由段）。老相册没有这个列值，返回 null。
    person: a.person || null,
    coverPhotoId: a.cover_photo_id,
    sortOrder: a.sort_order,
    photos: photosByAlbum[a.id] || [],
  }));

  return c.json({ albums: result });
});

// ---------- 日期格式化 ----------

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// D1 存的是 SQLite datetime('now')（UTC，无时区后缀），展示统一按北京时间（UTC+8）
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function parseDate(iso) {
  if (!iso) return null;
  const s = String(iso).trim();
  // "YYYY-MM-DD HH:MM:SS" 无时区后缀 → 显式按 UTC 解析；自带时区的 ISO 字符串直接解析
  const d = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)
    ? new Date(s.replace(' ', 'T') + 'Z')
    : new Date(s);
  return isNaN(d) ? null : d;
}

// 转为北京时间后用 UTC getter 读取墙钟值
function toBeijing(d) {
  return new Date(d.getTime() + BEIJING_OFFSET_MS);
}

// "6:05 AM"
function formatTime(bj) {
  const m = String(bj.getUTCMinutes()).padStart(2, '0');
  const ampm = bj.getUTCHours() >= 12 ? 'PM' : 'AM';
  const h = bj.getUTCHours() % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

// "SEPTEMBER 25, 2026 · 6:05 AM"
function formatCardDate(iso) {
  const d = parseDate(iso);
  if (!d) return '';
  const bj = toBeijing(d);
  return `${MONTHS[bj.getUTCMonth()]} ${bj.getUTCDate()}, ${bj.getUTCFullYear()} · ${formatTime(bj)}`;
}

// "September 25, 2026 · 6:05 AM"
function formatDate(iso) {
  const d = parseDate(iso);
  if (!d) return '';
  const bj = toBeijing(d);
  return `${MONTHS_FULL[bj.getUTCMonth()]} ${bj.getUTCDate()}, ${bj.getUTCFullYear()} · ${formatTime(bj)}`;
}

export const publicRoutes = app;
