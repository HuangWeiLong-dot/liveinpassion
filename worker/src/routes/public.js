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
  'Access-Control-Expose-Headers': 'X-Total-Count, X-Export-Start, X-Export-Count',
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

// 导出单篇的 Markdown 片段。分页 / 分块时按这个长度估算字节数，
// 保证一块不会因为某篇特别长而超出 AI 的一次输入上限。
function exportEntry(row) {
  const NL = String.fromCharCode(10);
  const tags = parseTags(row.tags_json);
  const text = [
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
  ].join(NL);
  return { row, text, chars: text.length, tags };
}

// 只保留「筛选用」的参数，分页参数不往下传。
function exportFilters(c) {
  const params = new URLSearchParams();
  for (const key of ['slug', 'category', 'tag', 'since', 'limit']) {
    const value = String(c.req.query(key) || '').trim();
    if (value) params.set(key, value);
  }
  return params;
}

function exportUrlWith(c, params) {
  const origin = new URL(c.req.url).origin;
  const qs = params.toString();
  return `${origin}/api/posts/export.md${qs ? `?${qs}` : ''}`;
}

app.get('/posts/export.md', async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(
    `SELECT slug, card_title, title, published_at, category, tags_json, content_md, content_html
     FROM posts WHERE status='published' ORDER BY published_at DESC, slug DESC`
  ).all();
  const list = filterRows(rows.results, c);
  const entries = list.map(exportEntry);

  // 分页：offset/per_page 直接切片；page/per_page 是给人手敲的等价写法。
  const perPageRaw = Number(c.req.query('per_page') || 0);
  const perPage = Number.isFinite(perPageRaw) && perPageRaw > 0
    ? Math.min(Math.floor(perPageRaw), 200) : 0;
  const offsetRaw = Number(c.req.query('offset') || 0);
  const pageRaw = Number(c.req.query('page') || 1);
  let offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;
  if (!offset && perPage && Number.isFinite(pageRaw) && pageRaw > 1) {
    offset = (Math.floor(pageRaw) - 1) * perPage;
  }

  const total = entries.length;
  const totalChars = entries.reduce((sum, entry) => sum + entry.chars, 0);
  const start = Math.min(offset, total);
  const slice = perPage ? entries.slice(start, start + perPage) : entries.slice(start);
  const origin = new URL(c.req.url).origin;
  const NL = String.fromCharCode(10);
  const lines = [
    '# LIVE IN PASSION — ECHOES',
    '',
    `> ${total} published piece${total === 1 ? '' : 's'} · ${totalChars} chars · exported ${new Date().toISOString()}`,
    '> Only published posts. Drafts are excluded.',
  ];
  if (slice.length) {
    lines.push(
      `> Showing ${start + 1}–${start + slice.length} of ${total}${perPage ? ` · per_page=${perPage}` : ''}`,
      `> Chunked export (recommended for AI): ${origin}/api/posts/export/manifest.json`,
    );
  } else {
    lines.push(`> No pieces in this range (offset ${offset}, total ${total}).`);
  }
  lines.push(
    `> Metadata index: ${origin}/api/posts/index.json`,
    '',
    '---',
    '',
  );
  for (const entry of slice) lines.push(entry.text);
  return new Response(lines.join(NL), {
    headers: {
      ...EXPORT_HEADERS,
      'X-Total-Count': String(total),
      'X-Export-Start': String(start),
      'X-Export-Count': String(slice.length),
    },
  });
});

// 分块清单：给 AI 一次看清「一共多少篇、每块多大、下一块去哪拿」。
// 按字符预算（默认 24k，约 6k tokens）切块，块边界永远落在文章之间。
app.get('/posts/export/manifest.json', async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(
    `SELECT slug, card_title, title, published_at, category, tags_json, content_md, content_html
     FROM posts WHERE status='published' ORDER BY published_at DESC, slug DESC`
  ).all();
  const list = filterRows(rows.results, c);
  const entries = list.map(exportEntry);
  const totalChars = entries.reduce((sum, entry) => sum + entry.chars, 0);
  const CHUNK_CHARS = 24000;
  const chunks = [];
  let start = 0;
  while (start < entries.length) {
    let end = start;
    let chars = 0;
    while (end < entries.length && (end === start || chars + entries[end].chars <= CHUNK_CHARS)) {
      chars += entries[end].chars;
      end += 1;
    }
    chunks.push({
      index: chunks.length + 1,
      from: start + 1,
      to: end,
      count: end - start,
      chars,
      approxTokens: Math.ceil(chars / 4),
      titles: entries.slice(start, end).map((entry) => entry.row.title || entry.row.card_title || entry.row.slug),
    });
    start = end;
  }

  const origin = new URL(c.req.url).origin;
  const filters = exportFilters(c);
  for (const chunk of chunks) {
    const params = new URLSearchParams(filters);
    params.set('offset', String(chunk.from - 1));
    params.set('per_page', String(chunk.count));
    chunk.url = exportUrlWith(c, params);
  }

  return new Response(JSON.stringify({
    site: SITE,
    generatedAt: new Date().toISOString(),
    count: entries.length,
    totalChars,
    chunkChars: CHUNK_CHARS,
    chunkCount: chunks.length,
    fullExport: exportUrlWith(c, filters),
    index: `${origin}/api/posts/index.json`,
    chunks,
    posts: entries.map((entry) => ({
      slug: entry.row.slug,
      title: entry.row.title,
      cardTitle: entry.row.card_title,
      date: formatDate(entry.row.published_at) || entry.row.published_at || '',
      category: entry.row.category || 'UNFILED',
      tags: entry.tags,
      chars: entry.chars,
      approxTokens: Math.ceil(entry.chars / 4),
      url: `${SITE}/echoes/${entry.row.slug}`,
      markdown: exportUrlWith(c, new URLSearchParams({ slug: entry.row.slug })),
    })),
  }, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

app.get('/posts/index.json', async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(
    `SELECT slug, card_title, title, published_at, category, tags_json, read_time_min
     FROM posts WHERE status='published' ORDER BY published_at DESC, slug DESC`
  ).all();
  const list = filterRows(rows.results, c);
  const origin = new URL(c.req.url).origin;
  return new Response(JSON.stringify({
    site: SITE,
    count: list.length,
    fullExport: `${origin}/api/posts/export.md`,
    manifest: `${origin}/api/posts/export/manifest.json`,
    posts: list.map((row) => ({
      slug: row.slug,
      title: row.title,
      cardTitle: row.card_title,
      date: formatDate(row.published_at) || row.published_at || '',
      category: row.category || 'UNFILED',
      tags: parseTags(row.tags_json),
      readTime: `${row.read_time_min} min read`,
      url: `${SITE}/echoes/${row.slug}`,
      markdown: `${origin}/api/posts/export.md?slug=${encodeURIComponent(row.slug)}`,
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
