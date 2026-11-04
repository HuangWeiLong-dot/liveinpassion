// 博客正文 SEO 增强（构建期自动执行，新文章上传后随下一次构建自动生效）。
//
// 做四件事，且全部幂等（重复处理不会叠加属性）：
//   1. 正文里若出现 <h1>，降到 <h2> —— 文章标题已经是页面的 H1，正文再出 H1 会破坏层级
//   2. 给所有 h2–h6 补稳定 id，标题可被直接链接/作为目录锚点
//   3. 给正文图片补 alt（优先 figcaption，其次「文章标题 + 序号」）、loading=lazy、decoding=async
//   4. 算出 wordCount / 阅读时间 / 关键词，供 BlogPosting 结构化数据与页面元数据使用
//
// 由 scripts/fetch-content.mjs 写入快照前调用；运行时（useSeo / BlogDetailView）直接用增强后的 body。

import { stripHtml } from './meta.js';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'had', 'was', 'were', 'are',
  'but', 'not', 'you', 'your', 'they', 'them', 'their', 'his', 'her', 'she', 'him', 'its', 'it',
  'will', 'would', 'can', 'could', 'should', 'about', 'into', 'over', 'under', 'then', 'than',
  'there', 'here', 'when', 'where', 'what', 'who', 'why', 'how', 'all', 'any', 'some', 'more',
  'most', 'very', 'just', 'like', 'one', 'two', 'also', 'been', 'being', 'because', 'while',
  'after', 'before', 'through', 'during', 'without', 'within', 'onto', 'upon', 'only', 'own',
  'same', 'such', 'too', 'now', 'out', 'off', 'again', 'once', 'each', 'every', 'other', 'another',
  'get', 'got', 'make', 'made', 'say', 'said', 'see', 'seen', 'know', 'knew', 'think', 'thought',
  'feel', 'felt', 'want', 'wanted', 'need', 'needed', 'look', 'looked', 'come', 'came', 'take',
  'took', 'give', 'gave', 'day', 'days', 'time', 'times', 'still', 'even', 'much', 'many',
]);

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
};

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&apos;/gi, "'");
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function slugify(text) {
  return decodeEntities(stripHtml(text))
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function hasAttr(attrs, name) {
  return new RegExp(`\\b${name}\\s*=`, 'i').test(attrs);
}

function attrValue(attrs, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs);
  return m ? decodeEntities(m[1]) : null;
}

function setAttr(attrs, name, value) {
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i');
  if (re.test(attrs)) return attrs.replace(re, `${name}="${value}"`);
  return `${attrs} ${name}="${value}"`;
}

// 正文里的 <h1> 统一降为 <h2>，保持「文章标题 H1 / 正文 H2 起」的层级
function demoteH1(html) {
  return html
    .replace(/<h1(\s[^>]*)?>/gi, '<h2$1>')
    .replace(/<\/h1>/gi, '</h2>');
}

// 标题补 id（已有 id 的不动），同名标题自动加序号
function addHeadingIds(html) {
  const used = new Set();
  return html.replace(
    /<h([2-6])([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (match, level, attrs, inner) => {
      if (hasAttr(attrs, 'id')) return match;
      const base = slugify(inner) ? `sec-${slugify(inner)}` : `sec-section-${used.size + 1}`;
      let id = base;
      let n = 2;
      while (used.has(id)) id = `${base}-${n++}`;
      used.add(id);
      return `<h${level}${attrs} id="${id}">${inner}</h${level}>`;
    }
  );
}

// 图片：先按 figure/figcaption 补 alt，再给剩余图片一个可读的兜底 alt
function enhanceImages(html, postTitle) {
  let out = html;

  // figure 内带说明文字的，用说明文字当 alt
  out = out.replace(/<figure\b[\s\S]*?<\/figure>/gi, (block) => {
    const cap = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(block);
    const caption = cap ? decodeEntities(stripHtml(cap[1])) : '';
    if (!caption) return block;
    return block.replace(/<img\b([^>]*)>/gi, (m, attrs) => {
      const alt = attrValue(attrs, 'alt');
      if (alt) return m;
      return `<img${setAttr(attrs, 'alt', escapeAttr(caption))}>`;
    });
  });

  let index = 0;
  out = out.replace(/<img\b([^>]*?)\s*\/?>/gi, (m, attrs) => {
    index += 1;
    let next = attrs;
    const alt = attrValue(next, 'alt');
    if (!alt) {
      const fallback = `${postTitle || 'LIVEINPASSION'} — photograph ${index}`;
      next = setAttr(next, 'alt', escapeAttr(fallback));
    }
    if (!hasAttr(next, 'loading')) next = `${next} loading="lazy"`;
    if (!hasAttr(next, 'decoding')) next = `${next} decoding="async"`;
    return `<img${next}>`;
  });

  return out;
}

/**
 * 正文增强入口
 * @param {string} body CMS 返回的 HTML
 * @param {string} postTitle 文章标题（用于图片兜底 alt）
 * @returns {string}
 */
export function enhanceBlogBody(body, postTitle = '') {
  if (!body) return body;
  let out = demoteH1(body);
  out = addHeadingIds(out);
  out = enhanceImages(out, postTitle);
  return out;
}

/**
 * 正文统计：词数、阅读分钟、关键词
 * @param {string} body
 * @param {string} title
 * @returns {{wordCount:number, readingMinutes:number, keywords:string[]}}
 */
export function blogSeoStats(body, title = '') {
  const plain = decodeEntities(stripHtml(body));
  const words = plain.match(/[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g) || [];
  const chinese = (plain.match(/[\u4e00-\u9fa5]/g) || []).length;
  const wordCount = words.length + chinese;
  const readingMinutes = Math.max(1, Math.round(words.length / 200 + chinese / 300));

  const counts = new Map();
  const titleWords = new Set(
    (title.toLowerCase().match(/[a-z0-9]+(?:['’\-][a-z0-9]+)*/g) || []).filter(
      (w) => w.length >= 3 && !STOPWORDS.has(w)
    )
  );

  for (const raw of words) {
    const w = raw.toLowerCase();
    // 缩写（i'm / it's / don't）不作为关键词
    if (w.includes("'") || w.includes('’')) continue;
    if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) || 0) + (titleWords.has(w) ? 2 : 1));
  }

  const keywords = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([w]) => w)
    .slice(0, 6);

  return { wordCount, readingMinutes, keywords };
}

/**
 * 给整份快照的 posts 补 SEO 字段与增强后的 body（返回新数组，不改入参）
 */
export function enhancePosts(posts = []) {
  return posts.map((post) => {
    const body = enhanceBlogBody(post.body, post.title);
    const stats = blogSeoStats(body, post.title);
    return {
      ...post,
      body,
      wordCount: stats.wordCount,
      readingMinutes: stats.readingMinutes,
      keywords: stats.keywords,
    };
  });
}