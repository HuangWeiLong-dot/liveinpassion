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

function parseDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}

// "SEPTEMBER 25, 2026"
function formatCardDate(iso) {
  const d = parseDate(iso);
  if (!d) return '';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// "September 25, 2026"
function formatDate(iso) {
  const d = parseDate(iso);
  if (!d) return '';
  return `${MONTHS_FULL[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export const publicRoutes = app;
