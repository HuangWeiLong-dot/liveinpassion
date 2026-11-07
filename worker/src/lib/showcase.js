// 首页右侧展示的解析层（public 与 admin 共用）。
//
// 输出统一的卡片形状：
//   { kind, refId, title, meta, image, href }
// kind: echo | photography | film
//
// "latest" 是自动的（最新已发布文章 / 最新摄影照片所属相册），
// "selected" 是后台手动挑的，按 sort_order 排、按每类 limit 截断。

import { CDN_BASE } from './r2.js';

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

export const DEFAULT_LIMITS = { echo: 4, photography: 3, film: 2 };
export const KINDS = ['echo', 'photography', 'film'];

function toDate(ts) {
  if (!ts) return null;
  const raw = String(ts).trim();
  const d = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(raw)
    ? new Date(raw.replace(' ', 'T') + 'Z')
    : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "2026.11"（北京时间） */
function beijingMonth(ts) {
  const d = toDate(ts);
  if (!d) return '';
  const bj = new Date(d.getTime() + BEIJING_OFFSET_MS);
  return `${bj.getUTCFullYear()}.${String(bj.getUTCMonth() + 1).padStart(2, '0')}`;
}

function coverUrl(key) {
  return key ? `${CDN_BASE}/${key}` : '';
}

function echoCard(row) {
  if (!row) return null;
  const date = beijingMonth(row.published_at);
  return {
    kind: 'echo',
    refId: row.id,
    title: row.card_title || row.title || row.slug,
    meta: [row.category || 'UNFILED', date].filter(Boolean).join(' · '),
    image: coverUrl(row.cover_key),
    href: `/echoes/${row.slug}`,
  };
}

function photographyCard(row) {
  if (!row) return null;
  const person = row.person
    || String(row.r2_prefix || '').replace(/^photography\//, '');
  return {
    kind: 'photography',
    refId: row.id,
    title: row.name || person || 'Photography',
    meta: 'PHOTOGRAPHY',
    image: coverUrl(row.compressed_key || row.original_key),
    href: person
      ? `/photography/${encodeURIComponent(person)}`
      : '/photography',
  };
}

function filmCard(row) {
  if (!row) return null;
  return {
    kind: 'film',
    refId: row.id,
    title: row.title,
    meta: 'FILM',
    image: coverUrl(row.poster_key),
    href: row.path || '/projection',
  };
}

// 摄影相册的封面：优先 cover_photo_id，否则第一张（sort_order）
const ALBUM_WITH_COVER = `
  SELECT a.id, a.name, a.person, a.r2_prefix, a.cover_photo_id,
         p.compressed_key, p.original_key, p.file_name, p.created_at
  FROM albums a
  LEFT JOIN photos p ON p.album_id = a.id AND p.id = COALESCE(
    a.cover_photo_id,
    (SELECT p2.id FROM photos p2
      WHERE p2.album_id = a.id
      ORDER BY p2.sort_order ASC, p2.id ASC LIMIT 1)
  )
`;

async function readLimits(db) {
  const limits = { ...DEFAULT_LIMITS };
  try {
    const rows = await db.prepare('SELECT key, value FROM showcase_settings').all();
    for (const row of rows.results) {
      const key = String(row.key || '').replace(/_limit$/, '');
      if (!KINDS.includes(key)) continue;
      const n = Number(row.value);
      if (Number.isFinite(n)) limits[key] = Math.max(0, Math.min(12, Math.trunc(n)));
    }
  } catch {
    // 迁移还没跑：用默认值，页面不至于整个挂掉
  }
  return limits;
}

async function latestEcho(db) {
  const row = await db.prepare(
    `SELECT id, slug, card_title, title, category, cover_key, published_at
     FROM posts
     WHERE status='published'
     ORDER BY published_at DESC, id DESC
     LIMIT 1`
  ).first();
  return echoCard(row);
}

async function latestPhotography(db) {
  // 最新一张照片所在的摄影相册 —— "最新摄影"字面意义上的最新
  const row = await db.prepare(
    `SELECT a.id, a.name, a.person, a.r2_prefix,
            p.compressed_key, p.original_key, p.file_name, p.created_at
     FROM albums a
     JOIN photos p ON p.album_id = a.id
     WHERE a.kind='photography'
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT 1`
  ).first();
  return photographyCard(row);
}

async function cardForItem(db, kind, refId) {
  if (!Number.isInteger(refId) || refId <= 0) return null;

  if (kind === 'echo') {
    const row = await db.prepare(
      `SELECT id, slug, card_title, title, category, cover_key, published_at
       FROM posts WHERE id=? AND status='published'`
    ).bind(refId).first();
    return echoCard(row);
  }

  if (kind === 'photography') {
    const row = await db.prepare(
      `${ALBUM_WITH_COVER} WHERE a.id=? AND a.kind='photography'`
    ).bind(refId).first();
    return photographyCard(row);
  }

  if (kind === 'film') {
    const row = await db.prepare(
      `SELECT id, title, poster_key, path FROM films WHERE id=? AND status='published'`
    ).bind(refId).first();
    return filmCard(row);
  }

  return null;
}

/**
 * 前台展示数据。构建期由 /api/showcase 拉取，写进快照。
 * @param {D1Database} db
 */
export async function buildShowcase(db) {
  const limits = await readLimits(db);
  const [latestEchoCard, latestPhotographyCard] = await Promise.all([
    latestEcho(db),
    latestPhotography(db),
  ]);

  const rows = await db.prepare(
    `SELECT kind, ref_id FROM showcase_items ORDER BY sort_order ASC, id ASC`
  ).all();

  // 精选里如果又挑了"最新"那一条，前台会出现重复卡片 —— 直接跳过。
  // （后台仍保留这条记录，取消/恢复 latest 时不用重新编辑精选。）
  const latestKeys = new Set();
  for (const card of [latestEchoCard, latestPhotographyCard]) {
    if (card) latestKeys.add(`${card.kind}:${card.refId}`);
  }

  const counts = { echo: 0, photography: 0, film: 0 };
  const selected = [];
  for (const row of rows.results) {
    if (latestKeys.has(`${row.kind}:${row.ref_id}`)) continue;
    if (counts[row.kind] >= limits[row.kind]) continue;
    const card = await cardForItem(db, row.kind, Number(row.ref_id));
    if (!card) continue; // 文章取消发布 / 相册被删：静默跳过
    counts[row.kind] += 1;
    selected.push(card);
  }

  return {
    latestEcho: latestEchoCard,
    latestPhotography: latestPhotographyCard,
    limits,
    selected,
  };
}

/** 后台挑选清单需要的可选项（含缩略图），一次请求拿全 */
export async function listShowcaseOptions(db) {
  const [posts, albums, films] = await Promise.all([
    db.prepare(
      `SELECT id, slug, card_title, title, category, cover_key, published_at
       FROM posts WHERE status='published'
       ORDER BY published_at DESC, id DESC`
    ).all(),
    db.prepare(
      `${ALBUM_WITH_COVER}
       WHERE a.kind='photography'
       ORDER BY a.sort_order ASC, a.created_at ASC`
    ).all(),
    db.prepare(
      `SELECT id, title, poster_key, path, status FROM films
       ORDER BY sort_order ASC, id ASC`
    ).all(),
  ]);

  return {
    echo: posts.results.map((row) => ({
      ...echoCard(row),
      href: undefined,
    })),
    photography: albums.results.map((row) => ({
      ...photographyCard(row),
      href: undefined,
    })),
    film: films.results.map((row) => ({
      ...filmCard(row),
      href: undefined,
      status: row.status,
    })),
  };
}

/** 把后台提交的 items 规范化：只留合法 kind、正整数 refId，并按 kind+refId 去重 */
export function normalizeItems(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const kind = item?.kind;
    const refId = Number(item?.refId);
    if (!KINDS.includes(kind) || !Number.isInteger(refId) || refId <= 0) continue;
    const key = `${kind}:${refId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, refId });
  }
  return out;
}

export function normalizeLimits(raw) {
  const limits = { ...DEFAULT_LIMITS };
  if (!raw || typeof raw !== 'object') return limits;
  for (const kind of KINDS) {
    const n = Number(raw[kind]);
    if (Number.isFinite(n)) limits[kind] = Math.max(0, Math.min(12, Math.trunc(n)));
  }
  return limits;
}
