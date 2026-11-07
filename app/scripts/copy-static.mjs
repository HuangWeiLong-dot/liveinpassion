// 构建后处理：
// 1. 把仓库根的静态资源复制进 app/dist（这些目录只保留一份，不进 app/）
// 2. 复制 CNAME —— 注意仓库根的 CNAME 必须原地保留，Pages 的分支发布读的是它；
//    这里只是往产物里再放一份，避免切换发布方式时自定义域名丢掉
// 3. 为每个已知路由生成静态的 <path>/index.html（GitHub Pages 上没有这个文件时，
//    深链接会落到 404.html、以 HTTP 404 返回 —— 搜索引擎会当作死链。目录索引能让
//    真实 URL 返回 200，同时把 title / description / OG / JSON-LD 预渲染进 HTML，
//    不执行 JS 的爬虫也能读到）
// 4. 生成 sitemap.xml / robots.txt
// 5. 由 index.html 生成 404.html（未知路径仍交给它，应用启动后由 vue-router 渲染 404 视图）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUTHOR,
  LIFE_ARCHIVE_KINDS,
  SITE,
  SITE_NAME,
  albumPerson,
  clamp,
  resolveSeo,
  toIso,
} from '../src/seo/meta.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(appDir, '..');
const distDir = path.join(appDir, 'dist');

// music 已迁到 Cloudflare R2 / CDN，仓库里不再保留音频文件
const STATIC_DIRS = ['icons', 'avatar', 'me', 'logo'];
const STATIC_FILES = ['favicon.png', 'CNAME'];

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('dist/index.html 不存在，先跑 vite build');
  process.exit(1);
}

for (const dir of STATIC_DIRS) {
  const from = path.join(repoRoot, dir);
  if (!fs.existsSync(from)) {
    console.warn(`跳过缺失的目录: ${dir}/`);
    continue;
  }
  fs.cpSync(from, path.join(distDir, dir), { recursive: true });
}

for (const file of STATIC_FILES) {
  const from = path.join(repoRoot, file);
  if (!fs.existsSync(from)) {
    console.warn(`跳过缺失的文件: ${file}`);
    continue;
  }
  fs.copyFileSync(from, path.join(distDir, file));
}

// ── CMS 快照 ────────────────────────────────────────────────────────────
function readSnapshot(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(appDir, 'src/data/content', file), 'utf8'));
  } catch {
    return null;
  }
}

const posts = readSnapshot('blogPosts.json')?.posts || [];
const albums = readSnapshot('albums.json')?.albums || [];

// ── 路由清单：静态页 + 博客 slug + 摄影人名 + LIFE 归档 ─────────────────
const routes = [
  { name: 'home', params: {} },
  { name: 'echoes', params: {} },
  { name: 'me', params: {} },
  { name: 'me-gallery', params: {} },
  { name: 'gallery', params: {} },
  { name: 'photography', params: {} },
  { name: 'life', params: {} },
  { name: 'me-organization', params: {} },
  { name: 'projection', params: {} },
];

for (const kind of LIFE_ARCHIVE_KINDS) {
  routes.push({ name: 'life-archive', params: { kind } });
}

for (const post of posts) {
  if (post?.slug) routes.push({ name: 'echo-detail', params: { slug: post.slug } });
}

const seenPersons = new Set();
for (const album of albums) {
  if (album.kind !== 'photography' || !album.photos?.length) continue;
  const person = albumPerson(album);
  if (!person || seenPersons.has(person)) continue;
  seenPersons.add(person);
  routes.push({ name: 'photography-person', params: { person } });
}

// ── HTML head 改写 ──────────────────────────────────────────────────────
const escapeAttr = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

function setMeta(html, key, value, property = false) {
  const a = property ? 'property' : 'name';
  const tag = `<meta ${a}="${key}" content="${escapeAttr(value)}">`;
  const re = new RegExp(`<meta ${a}="${key}" content="[^"]*">`);
  if (re.test(html)) return html.replace(re, tag);
  return html.replace('</head>', `    ${tag}\n</head>`);
}

function patchHtml(html, meta) {
  let out = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeAttr(meta.title)}</title>`)
    .replace(
      /<link rel="canonical" href="[^"]*">/,
      `<link rel="canonical" href="${escapeAttr(meta.url)}">`
    );

  out = setMeta(out, 'description', meta.description);
  out = setMeta(out, 'robots', meta.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large');
  out = setMeta(out, 'og:type', meta.type || 'website', true);
  out = setMeta(out, 'og:title', meta.title, true);
  out = setMeta(out, 'og:description', meta.description, true);
  out = setMeta(out, 'og:url', meta.url, true);
  out = setMeta(out, 'og:image', meta.image, true);
  out = setMeta(out, 'twitter:title', meta.title);
  out = setMeta(out, 'twitter:description', meta.description);
  out = setMeta(out, 'twitter:image', meta.image);

  const json = JSON.stringify(meta.jsonLd).replace(/</g, '\\u003c');
  out = out.replace(
    /(<script id="seo-jsonld" type="application\/ld\+json">)[\s\S]*?(<\/script>)/,
    `$1${json}$2`
  );

  // 文章页补上发布时间；非文章页把模板里的残留清掉
  out = out
    .replace(/\s*<meta property="article:published_time" content="[^"]*">/g, '')
    .replace(/\s*<meta property="article:author" content="[^"]*">/g, '');

  if (meta.type === 'article' && meta.published) {
    out = out.replace(
      '</head>',
      `    <meta property="article:published_time" content="${escapeAttr(meta.published)}">\n`
      + `    <meta property="article:author" content="${escapeAttr(AUTHOR)}">\n</head>`
    );
  }

  return out;
}

// ── 无 JS 兜底 ────────────────────────────────────────────────────────────
// 站点是 SPA，静态 HTML 的 #app 是空的。给每个预生成页放一段 <noscript>：
// 站点导航 + 这一页的真实内容索引（博客正文、相册人名与照片数）。
// 正常访客完全看不到，也不会额外请求图片。
const NAV_LINKS = [
  ['Home', '/'], ['Echoes', '/echoes'], ['Photography', '/photography'],
  ['Gallery', '/gallery'], ['Life', '/life'], ['Me', '/me'],
];

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// 把 CMS 返回的 HTML 正文变成可读纯文本，保留段落/换行
function bodyText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function noscriptHtml(route, meta) {
  const nav = NAV_LINKS
    .map(([label, href]) => `<a href="${href}">${label}</a>`)
    .join(' · ');

  let body = '';

  if (route.name === 'echoes') {
    body = '<h1>Echoes</h1><ul>'
      + posts.map((post) => (
        `<li><a href="/echoes/${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a>`
        + ` — ${escapeHtml(post.date || post.cardDate || '')}</li>`
      )).join('')
      + '</ul>';
  } else if (route.name === 'echo-detail') {
    const post = posts.find((p) => p.slug === route.params.slug);
    body = post
      ? `<h1>${escapeHtml(post.title)}</h1>`
        + `<p>${escapeHtml(post.date || post.cardDate || '')} · ${escapeHtml(post.readTime || '')}</p>`
        + `<article>${escapeHtml(bodyText(post.body)).replace(/\n/g, '<br>')}</article>`
        + '<p><a href="/echoes">All echoes</a></p>'
      : `<h1>${escapeHtml(meta.title)}</h1>`;
  } else if (route.name === 'photography') {
    const list = albums.filter((a) => a.kind === 'photography' && a.photos?.length);
    body = '<h1>Photography</h1><ul>'
      + list.map((album) => (
        `<li><a href="/photography/${encodeURIComponent(albumPerson(album))}">`
        + `${escapeHtml(album.name || albumPerson(album))}</a> — ${album.photos.length} photos</li>`
      )).join('')
      + '</ul>';
  } else if (route.name === 'photography-person') {
    const album = albums.find(
      (a) => a.kind === 'photography' && albumPerson(a) === route.params.person
    );
    if (album) {
      body = `<h1>${escapeHtml(album.name || route.params.person)}</h1>`
        + `<p>${album.photos.length} photographs by ${escapeHtml(AUTHOR)}.</p><ul>`
        + album.photos.map((p) => `<li>${escapeHtml(p.filename)}</li>`).join('')
        + '</ul><p><a href="/photography">All photography</a></p>';
    } else {
      body = `<h1>${escapeHtml(meta.title)}</h1>`;
    }
  } else {
    body = `<h1>${escapeHtml(meta.title)}</h1><p>${escapeHtml(meta.description)}</p>`;
  }

  return `<noscript><style>body{overflow:auto!important;height:auto!important;background:#fff!important;color:#111!important}body.no-scroll{overflow:auto!important}a{color:#111}nav{margin-bottom:20px}article{max-width:70ch;line-height:1.6}</style><nav aria-label="Site navigation">${nav}</nav>${body}</noscript>`;
}

function injectSeo(html, route, meta) {
  let out = html.replace('<div id="app"></div>', `${noscriptHtml(route, meta)}\n    <div id="app"></div>`);
  if (meta.preloadImage) {
    out = out.replace(
      '</head>',
      `    <link rel="preload" as="image" href="${escapeAttr(meta.preloadImage)}" fetchpriority="high">\n</head>`
    );
  }
  return out;
}

const template = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
let written = 0;

for (const route of routes) {
  const meta = resolveSeo(route.name, route.params, posts, albums);
  const html = injectSeo(patchHtml(template, meta), route, meta);

  if (route.name === 'home') {
    fs.writeFileSync(path.join(distDir, 'index.html'), html);
    written += 1;
    continue;
  }

  const cleanPath = decodeURIComponent(meta.path).replace(/^\/+/, '');
  const targetDir = path.join(distDir, ...cleanPath.split('/'));
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'index.html'), html);
  written += 1;
}

// ── 旧 /blogs → /echoes 跳转页（GitHub Pages 做不到真 301，用 meta refresh + JS） ────
// 这些页 canonical 指向新址、robots=noindex、保留 query/hash 传给新 URL，
// 让搜索引擎把权重传递到 /echoes 而不是留在旧地址
function redirectHtml(fromPath, toPath) {
  const fromFull = `${SITE}${fromPath}`;
  const toFull = `${SITE}${toPath}`;
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <meta http-equiv="refresh" content="0;url=' + escapeAttr(toPath) + '">',
    '  <meta name="robots" content="noindex, follow">',
    '  <link rel="canonical" href="' + escapeAttr(toFull) + '">',
    `  <title>Echoes — ${SITE_NAME}</title>`,
    '</head>',
    '<body style="margin:0;padding:0;background:#0b0b0c;color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">',
    '  <div style="text-align:center">',
    `    <h1 style="font-size:18px;font-weight:500;letter-spacing:0.12em;text-transform:uppercase">Echoes has moved</h1>`,
    `    <p style="margin-top:12px;opacity:0.7">You are being redirected to <a href="${escapeAttr(toPath)}" style="color:#f5f5f5">${escapeAttr(toPath)}</a></p>`,
    '  </div>',
    '  <script>location.replace(' + JSON.stringify(toPath) + ' + window.location.search + window.location.hash);</script>',
    '</body>',
    '</html>',
  ].join('\n');
}

// /blogs/ → /echoes/
const blogsIndexDir = path.join(distDir, 'blogs');
fs.mkdirSync(blogsIndexDir, { recursive: true });
fs.writeFileSync(path.join(blogsIndexDir, 'index.html'), redirectHtml('/blogs', '/echoes'));
written += 1;

// /blogs/<slug>/ → /echoes/<slug>/
for (const post of posts) {
  if (!post?.slug) continue;
  const slug = encodeURIComponent(post.slug);
  const dir = path.join(distDir, 'blogs', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), redirectHtml(`/blogs/${slug}`, `/echoes/${slug}`));
  written += 1;
}

// ── 404.html ────────────────────────────────────────────────────────────
// Pages 对未知路径返回这份文件。它必须 noindex、并且不带 canonical ——
// 否则任何深链接/死链被索引时都会被算成首页的副本。
let html404 = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
html404 = html404
  .replace(
    /<meta name="robots" content="[^"]*">/,
    '<meta name="robots" content="noindex, follow">'
  )
  .replace(/<link rel="canonical" href="[^"]*">\s*\n?/, '');
fs.writeFileSync(path.join(distDir, '404.html'), html404);

// ── sitemap.xml / robots.txt ────────────────────────────────────────────
const BUILD_DATE = new Date().toISOString().slice(0, 10);
const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function dateOf(text) {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(text || '');
  if (!m || !MONTHS[m[1].toLowerCase()]) return BUILD_DATE;
  const pad = (n) => String(n).padStart(2, '0');
  return `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(Number(m[2]))}`;
}

const xmlEscape = (url) => url
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const entries = routes.map((route) => {
  const meta = resolveSeo(route.name, route.params, posts, albums);
  const post = route.name === 'blog-detail'
    ? posts.find((p) => p.slug === route.params.slug)
    : null;
  const album = route.name === 'photography-person'
    ? albums.find((a) => a.kind === 'photography' && albumPerson(a) === route.params.person)
    : null;

  // 图片站点地图：博客封面 + 摄影相册照片，帮助图片搜索发现
  const images = [];
  if (post?.image?.src) {
    images.push({ loc: post.image.src, title: post.title });
  }
  if (album) {
    for (const photo of album.photos.slice(0, 200)) {
      images.push({
        loc: photo.src,
        title: `${album.name || route.params.person} — ${photo.filename}`,
      });
    }
  }

  return {
    loc: meta.url,
    lastmod: post ? dateOf(post.date || post.cardDate) : BUILD_DATE,
    noindex: meta.noindex,
    images,
  };
}).filter((entry) => !entry.noindex);

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
  ...entries.map(({ loc, lastmod, images }) => (
    `  <url><loc>${xmlEscape(loc)}</loc><lastmod>${lastmod}</lastmod>`
    + images.map((img) => (
      `<image:image><image:loc>${xmlEscape(img.loc)}</image:loc>`
      + `<image:title>${xmlEscape(img.title)}</image:title></image:image>`
    )).join('')
    + '</url>'
  )),
  '</urlset>',
  '',
].join('\n');
fs.writeFileSync(path.join(distDir, 'sitemap.xml'), sitemap);

// ── RSS 2.0 ─────────────────────────────────────────────────────────────
const rssItems = posts.map((post) => {
  const meta = resolveSeo('blog-detail', { slug: post.slug }, posts, albums);
  const iso = toIso(post.date || post.cardDate);
  const pubDate = iso ? new Date(iso).toUTCString() : new Date().toUTCString();
  return [
    '    <item>',
    `      <title>${xmlEscape(post.title)}</title>`,
    `      <link>${xmlEscape(meta.url)}</link>`,
    `      <guid isPermaLink="true">${xmlEscape(meta.url)}</guid>`,
    `      <pubDate>${pubDate}</pubDate>`,
    `      <description>${xmlEscape(clamp(post.body, 300))}</description>`,
    '    </item>',
  ].join('\n');
}).join('\n');

const rss = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<rss version="2.0">',
  '  <channel>',
  `    <title>${SITE_NAME} — Echoes</title>`,
  `    <link>${SITE}/echoes</link>`,
  `    <description>Poems, notes and stories by ${AUTHOR}.</description>`,
  '    <language>en</language>',
  rssItems,
  '  </channel>',
  '</rss>',
  '',
].join('\n');
fs.writeFileSync(path.join(distDir, 'feed.xml'), rss);

const robots = [
  'User-agent: *',
  'Allow: /',
  'Disallow: /404.html',
  '',
  `Sitemap: ${SITE}/sitemap.xml`,
  '',
].join('\n');
fs.writeFileSync(path.join(distDir, 'robots.txt'), robots);

console.log(`静态资源与 CNAME 已复制，生成 ${written} 个路由页，sitemap 收录 ${entries.length} 条，RSS ${posts.length} 条`);