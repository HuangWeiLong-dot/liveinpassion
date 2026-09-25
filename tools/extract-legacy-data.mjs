// 迁移工具：把仓库根 index.html 里的硬编码数据逐字提取成 app/src/data/*.js。
//
// 为什么用提取而不是手工抄：数据量很大（mePhotosData 212 个文件名、好友照片 69 条、
// 群组照片 32 张），手抄必错。这里做的是"字符串切片 + 原样输出"，不重新排版、
// 不重新序列化，所以能把抄写错误降为零；同时顺带校验几处数据关系是否如清单所述。
//
//   node tools/extract-legacy-data.mjs            # 生成数据模块并打印校验结果
//
// 切换发布、删除 index.html 之后，app/src/data/*.js 就是数据的唯一来源，本工具即可弃用。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 用新版数据层里的这两个函数来评估旧文件里的字面量：
// 这样"提取出来的文件名数组 + 移植过来的工具函数"与旧数据是交叉验证的，不是同一次计算
import { generateGalleryData } from '../app/src/data/photoUtils.js';
import { CDN_BASE } from '../app/src/data/cdn.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const dataDir = path.join(repoRoot, 'app', 'src', 'data');
fs.mkdirSync(dataDir, { recursive: true });

// ---------- 字符串感知的括号切片 ----------
// 从 src[start] 处的开括号开始，返回配对到闭括号为止的整段文本。
// 会跳过字符串、模板字符串与注释，避免把括号当成结构。
function sliceBalanced(src, start) {
  const open = src[start];
  const close = { '[': ']', '{': '}', '(': ')' }[open];
  if (!close) throw new Error(`不是开括号: ${open}`);
  let depth = 0;
  let quote = null;
  let inTemplate = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && src[i + 1] === '/') { blockComment = false; i++; } continue; }
    if (quote) { if (c === '\\') { i++; continue; } if (c === quote) quote = null; continue; }
    if (inTemplate) { if (c === '\\') { i++; continue; } if (c === '`') inTemplate = false; continue; }
    if (c === '/' && src[i + 1] === '/') { lineComment = true; continue; }
    if (c === '/' && src[i + 1] === '*') { blockComment = true; i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '`') { inTemplate = true; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('括号未配对');
}

// 找到 `const NAME = `（或 let）之后的第一段括号字面量
function declarationLiteral(name) {
  const re = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*`, 'g');
  const m = re.exec(source);
  if (!m) throw new Error(`找不到声明: ${name}`);
  let i = m.index + m[0].length;
  while (source[i] === ' ' || source[i] === '\n') i++;
  if (!'[{('.includes(source[i])) throw new Error(`${name} 后面不是括号字面量`);
  return sliceBalanced(source, i);
}

// `const NAME = generateGalleryData(...)` 整条语句
function galleryCall(name) {
  const re = new RegExp(`^[ \\t]*const\\s+${name}\\s*=\\s*`, 'm');
  const m = re.exec(source);
  if (!m) throw new Error(`找不到 ${name}`);
  const eq = m.index + m[0].length;
  const parenStart = source.indexOf('(', eq);
  const call = sliceBalanced(source, parenStart);
  const lineStart = m.index;
  const lineEnd = source.indexOf('\n', parenStart + call.length);
  return source.slice(lineStart, lineEnd).trim();
}

// 取一段 HTML 里某个 class 的 div 的内部 HTML（按 div 深度配对）
function innerHtmlOfClass(html, className, fromIndex = 0) {
  const marker = `class="${className}"`;
  const at = html.indexOf(marker, fromIndex);
  if (at === -1) throw new Error(`找不到 class="${className}"`);
  const openTagStart = html.lastIndexOf('<div', at);
  const contentStart = html.indexOf('>', at) + 1;
  let depth = 1;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = contentStart;
  let m;
  while ((m = re.exec(html))) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return { html: html.slice(contentStart, m.index), end: m.index, openTagStart };
  }
  throw new Error('div 未配对');
}

const write = (file, contents) => {
  fs.writeFileSync(path.join(dataDir, file), contents);
  console.log(`  ✓ ${file}`);
};

const header = (origin) =>
  `// 由 tools/extract-legacy-data.mjs 从仓库根 index.html 逐字提取（${origin}）。\n` +
  `// 提取时未重新排版，改动请改此文件本身或重跑提取工具。\n\n`;

console.log('提取数据层 → app/src/data/');

// ---------- 1. CDN 常量 ----------
write('cdn.js', `${header('L5580 / L6879')}export const CDN_BASE = 'https://img.liveinpassion.me';\nexport const STEAM_API_BASE = 'https://api.liveinpassion.me';\n`);

// ---------- 2. 画廊来源（7 组：6 位好友 + 群组照片；home_photos 是死数据，不迁移） ----------
const galleryNames = [
  'lijiazuGalleryData',
  'jianghaipengGalleryData',
  'lixinyuGalleryData',
  'wangshuaiGalleryData',
  'xuhaonanGalleryData',
  'sunjiajunGalleryData',
  'groupPhotosGalleryData',
];
const galleryBody = galleryNames.map((n) => 'export ' + galleryCall(n) + ';').join('\n\n');
write(
  'galleries.js',
  `${header('L5665-L5717')}import { CDN_BASE } from './cdn.js';\nimport { generateGalleryData } from './photoUtils.js';\n\n${galleryBody}\n`
);

// 数据一致性校验：friendGalleryMap[id].data 与 friendsData[i].photos 是否同集合
const friendsDataLiteral = declarationLiteral('friendsData');
const friendMapLiteral = declarationLiteral('friendGalleryMap');
const groupPhotosDataLiteral = declarationLiteral('groupPhotosData');
const mePhotosLiteral = declarationLiteral('mePhotosData');
const meQuotesLiteral = declarationLiteral('meQuotes');
const fullLayoutsLiteral = declarationLiteral('fullLayouts');
const playlistLiteral = declarationLiteral('playlist');

// ---------- 3. 好友（合并 friendsData 与 friendGalleryMap） ----------
const friendsData = eval(friendsDataLiteral);

// friendGalleryMap 的值是变量引用，无法直接 eval；这里只取它的 name（页面标题用的全大写名）
const friendTitleNames = {};
for (const m of friendMapLiteral.matchAll(/'([a-z]+)':\s*\{\s*name:\s*'([^']*)'/g)) {
  friendTitleNames[m[1]] = m[2];
}

// 旧文件里的文件名数组 + 新版 generateGalleryData（见文件顶部 import）
// 注意只能 eval 等号右侧的表达式：eval('const x = ...') 的完成值是 undefined
const evalGallery = (name) => {
  const stmt = galleryCall(name);
  return eval(stmt.slice(stmt.indexOf('=') + 1).replace(/;\s*$/, ''));
};
const galleryByName = Object.fromEntries(galleryNames.map((n) => [n, evalGallery(n)]));

const mapVarToFriend = {
  lijiazuGalleryData: 'lijiazu',
  jianghaipengGalleryData: 'jianghaipeng',
  lixinyuGalleryData: 'lixinyu',
  wangshuaiGalleryData: 'wangshuai',
  xuhaonanGalleryData: 'xuhaonan',
  sunjiajunGalleryData: 'sunjiajun',
};

const problems = [];
const merged = friendsData.map((f) => {
  const titleName = friendTitleNames[f.id];
  if (!titleName) throw new Error(`friendGalleryMap 缺少 ${f.id}`);
  const galVar = Object.keys(mapVarToFriend).find((k) => mapVarToFriend[k] === f.id);
  const gallery = galVar ? galleryByName[galVar] : [];
  // 一致性校验：画廊数组应与好友照片列表逐项对应（文件名集合与排序后顺序）
  const galleryFiles = gallery.map((p) => p.filename).sort();
  const friendFiles = f.photos.map((p) => p.compressed.split('/').pop()).sort();
  if (JSON.stringify(galleryFiles) !== JSON.stringify(friendFiles)) {
    problems.push(
      `${f.id}: 照片集合不一致（friendGalleryMap ${gallery.length} 项 / friendsData ${f.photos.length} 项）`
    );
  }
  return {
    id: f.id,
    // 两处名字大小写不同，都要保留：跑马灯用 Title Case，页面标题用全大写
    name: f.name,
    titleName,
    bio: f.bio,
    photos: gallery,
  };
});

// 群组照片有**两份不同长度**的列表，都要保留：
//   groupPhotosGalleryData(32) → 群组照片页的时间线
//   groupPhotosData(26)        → MORE 磁贴随机背景池，页面上的 "26 photos" 指的就是它
const groupPhotosData = eval(`(${groupPhotosDataLiteral})`);
const groupMorePhotos = groupPhotosData.photos.map((p) => ({
  compressed: p.compressed,
  full: p.full,
}));

write(
  'friends.js',
  `${header('L6534-L6617 + L5720-L5730')}// 已合并原先重复的两份数据：friendsData[i].photos 与 friendGalleryMap[id].data\n` +
    `//   photos  —— 由 generateGalleryData 生成，带 CDN 绝对地址，页面时间线使用（与旧 friendGalleryMap 完全一致）\n` +
    `//   name    —— Title Case，好友跑马灯使用\n` +
    `//   titleName —— 全大写，好友详情页标题使用\n` +
    `export const friends = ${JSON.stringify(merged, null, 4)};\n\n` +
    `export const friendById = Object.fromEntries(friends.map((f) => [f.id, f]));\n`
);

write(
  'groupPhotos.js',
  `${header('L6620-L6651')}// 对应旧 groupPhotosData：26 张，用于 MORE 磁贴的随机背景池，
// 也是页面上 "26 photos" 这个数字的来源（注意与 galleries.js 里 32 张的群组照片时间线不是同一份列表）
export const groupMorePhotos = ${JSON.stringify(groupMorePhotos, null, 4)};
`
);

// ---------- 4. ME 照片文件名 ----------
const mePhotos = eval(mePhotosLiteral);
write('mePhotos.js', `${header('L6654-L6708')}export const mePhotos = ${JSON.stringify(mePhotos, null, 4)};\n`);

// ---------- 5. 引用 ----------
const meQuotes = eval(meQuotesLiteral);
write('quotes.js', `${header('L5878-L5886')}export const meQuotes = ${JSON.stringify(meQuotes, null, 4)};\n`);

// ---------- 6. 首页随机布局 ----------
const fullLayouts = eval(fullLayoutsLiteral);
write(
  'homeLayouts.js',
  `${header('L7797-L7862')}// 首页随机画廊的 4 套布局，每套描述各格子在栅格中的位置与尺寸
export const homeLayouts = ${JSON.stringify(fullLayouts, null, 4)};
`
);

// ---------- 7. 歌单 ----------
const playlist = eval(playlistLiteral);
write('playlist.js', `${header('L7978-L7987')}export const playlist = ${JSON.stringify(playlist, null, 4)};\n`);

// ---------- 8. 博客（卡片 + 详情两处合并；正文取自详情的 HTML） ----------
const SLUGS = {
  'blog-detail-6': 'in-the-middle-of-the-world',
  'blog-detail': 'life-is-a-fantasy',
  'blog-detail-2': 'the-two-halves-of-a-heart',
  'blog-detail-3': 'just-another-timeline-no',
  'blog-detail-4': 'dont-be-a-dick',
  'blog-detail-5': 'before-heading-out',
};

const cardRe = /<article class="blog-card" onclick="navigateTo\('([^']+)'\)">([\s\S]*?)<\/article>/g;
const cards = {};
let cm;
while ((cm = cardRe.exec(source))) {
  const [, page, block] = cm;
  const date = /class="blog-card-date">([^<]*)</.exec(block)?.[1]?.trim();
  const title = /class="blog-card-title">([^<]*)</.exec(block)?.[1]?.trim();
  const src = /data-src="([^"]+)"/.exec(block)?.[1];
  const fullSrc = /data-full-src="([^"]+)"/.exec(block)?.[1];
  cards[page] = { date, title, src, fullSrc };
}

// 按**卡片在标记里的顺序**生成（旧站列表是新→旧），这样 blogPosts[0] 就是最新一篇，
// ME 页的"最后更新"直接取 blogPosts[0].cardDate 即可，不用再假设顺序
const posts = Object.keys(cards).map((page) => {
  const slug = SLUGS[page];
  if (!slug) throw new Error(`缺少 ${page} 的 slug 映射`);
  const mainAt = source.indexOf(`<main id="${page}-page"`);
  if (mainAt === -1) throw new Error(`找不到 ${page}`);
  const section = source.slice(mainAt, source.indexOf('</main>', mainAt));
  const dateLabel = /class="blog-date">([^<]*)</.exec(section)?.[1]?.trim();
  const title = /class="blog-detail-title">([^<]*)</.exec(section)?.[1]?.trim();
  // 详情页的元信息是「日期 · N min read」，阅读时长的那个 span 没有 class，
  // 所以在 .blog-meta 块里找所有无属性 <span>，取以 "read" 结尾的那个
  const metaBlock = /class="blog-meta">([\s\S]*?)<\/div>/.exec(section)?.[1] || '';
  const readTime = [...metaBlock.matchAll(/<span>([^<]+)<\/span>/g)]
    .map((m) => m[1].trim())
    .find((t) => /read$/.test(t));
  const src = /data-src="([^"]+)"/.exec(section)?.[1];
  const fullSrc = /data-full-src="([^"]+)"/.exec(section)?.[1];
  const body = innerHtmlOfClass(section, 'blog-detail-content').html;
  const card = cards[page];
  if (!card) throw new Error(`卡片里没有指向 ${page} 的条目`);
  return {
    slug,
    // 卡片与详情的标题**确实不同**（如第 3 篇卡片是 "JUST ANOTHER TIMELINE? NO."，
    // 详情是 "May 25 – Just Another Timeline? No."），两个都保留
    cardTitle: card.title,
    cardDate: card.date,
    title,
    date: dateLabel,
    readTime,
    image: { src: src || card.src, fullSrc: fullSrc || card.fullSrc },
    body: body.replace(/^\n\s*/, '').replace(/\s+$/, ''),
  };
});

write(
  'blogPosts.js',
  `${header('L4896-L4954 卡片 + L4962-L5144 详情')}// 5 篇博客。旧版本把元数据同时写在这两处（卡片与详情），迁移后合并为单一来源，
// 但两个标题字符串都保留：卡片标题与详情标题在原文里并不完全一致。
export const blogPosts = ${JSON.stringify(posts, null, 4)};

export const blogBySlug = Object.fromEntries(blogPosts.map((p) => [p.slug, p]));
`
);

// ---------- 校验输出 ----------
console.log('\n数量校验（与迁移清单记录的数字对比）:');
const report = [
  ['好友数', merged.length, 7],
  ['好友照片合计', merged.reduce((n, f) => n + f.photos.length, 0), 69],
  ['mePhotos', mePhotos.length, 212],
  ['群组照片时间线 (galleries.js)', galleryByName.groupPhotosGalleryData.length, 32],
  ['MORE 背景池 (groupPhotosData)', groupMorePhotos.length, 26],
  ['引用', meQuotes.length, 7],
  ['首页布局套数', fullLayouts.length, 4],
  ['歌单', playlist.length, 8],
  ['博客', posts.length, 6],
];
let allOk = true;
for (const [label, got, want] of report) {
  const ok = got === want && got > 0;
  if (!ok) allOk = false;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${got}${ok ? '' : ` (期望 ${want})`}`);
}
console.log('\n好友两处数据一致性: ' + (problems.length ? `✗\n   - ${problems.join('\n   - ')}` : '✓ 7 位全部一致'));
if (!allOk || problems.length) process.exit(1);
