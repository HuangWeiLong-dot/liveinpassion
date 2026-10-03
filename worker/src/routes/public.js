// Public 只读 API：供前台构建期拉取
import { Hono } from 'hono';
import { CDN_BASE } from '../lib/r2.js';

const app = new Hono();

// 博客列表（仅已发布）
app.get('/posts', async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(
    `SELECT slug, card_title, title, content_format, content_html,
            cover_key, cover_full_key, read_time_min, published_at
     FROM posts WHERE status='published' ORDER BY published_at DESC`
  ).all();

  const posts = rows.results.map((row) => ({
    slug: row.slug,
    cardTitle: row.card_title,
    cardDate: formatCardDate(row.published_at),
    title: row.title,
    date: formatDate(row.published_at),
    readTime: `${row.read_time_min} min read`,
    image: {
      src: row.cover_key ? `${CDN_BASE}/${row.cover_key}` : null,
      fullSrc: row.cover_full_key ? `${CDN_BASE}/${row.cover_full_key}` : null,
    },
    body: row.content_html,
  }));

  return c.json({ posts });
});

// 单篇博客（仅已发布）
app.get('/posts/:slug', async (c) => {
  const db = c.env.DB;
  const slug = c.req.param('slug');
  const row = await db.prepare(
    `SELECT slug, card_title, title, content_format, content_html,
            cover_key, cover_full_key, read_time_min, published_at
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
