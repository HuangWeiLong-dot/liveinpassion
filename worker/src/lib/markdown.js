// Markdown 渲染与 XSS 净化
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

// 保留现有博客用到的标签
const ALLOWED_TAGS = [
  'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'ul', 'ol', 'li',
  'strong', 'em', 'b', 'i', 'u', 's', 'del',
  'a', 'img',
  'code', 'pre',
  'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  // 照片排版容器：gallery / media-text
  'figure', 'figcaption', 'div', 'section', 'span',
];

const ALLOWED_ATTRS = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  '*': ['class', 'data-gid'],
};

const ALLOWED_SCHEMES = ['http', 'https', 'mailto'];

// marked 配置
marked.setOptions({
  gfm: true,
  breaks: true,
});

// 清除 media-text 块末尾的孤立空 <p>。
// 旧模板在 HTML 块内手写 <p>…</p>，用户用空行分段后 marked 会输出标签错位，
// 浏览器把孤立的 </p> 补成空 <p>，成为 grid 容器的第三个子项，打乱图文左右布局。
// 限定在 media-text 块内、且只匹配 body 收尾 </div> 后的空段落，避免误伤正文。
// body 收尾 </div> 与外层 </div> 之间只允许出现：空 <p></p>（旧版 sanitize-html 产物）
// 或孤立 </p>（marked 原样透传、浏览器会补成空 <p>）
const MEDIA_STRAY_P_RE =
  /(<div class="media-text[^"]*"[^>]*>(?:(?!<\/div>)[\s\S])*<\/div>)\s*(?:<p>\s*<\/p>|<\/p>)\s*(<\/div>)/g;

function normalizeMediaBlocks(html) {
  return html.replace(MEDIA_STRAY_P_RE, '$1\n$2');
}

/**
 * 渲染并净化 Markdown
 * @param {string} md
 * @returns {string} 净化后的 HTML
 */
export function renderMarkdown(md) {
  const raw = marked.parse(md);
  const clean = sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    allowedSchemes: ALLOWED_SCHEMES,
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    disallowedTagsMode: 'discard',
  });
  return normalizeMediaBlocks(clean);
}

/**
 * 直接净化已有 HTML（用于旧博客迁移）
 */
export function sanitizeExistingHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    allowedSchemes: ALLOWED_SCHEMES,
    disallowedTagsMode: 'discard',
  });
}

/**
 * 估算阅读时间（中文 + 英文混合）
 * 规则：中文 300 字/分钟，英文 200 词/分钟，取较大者近似
 */
export function estimateReadTime(text) {
  if (!text) return 1;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.replace(/[\u4e00-\u9fa5]/g, ' ').match(/\b\w+\b/g) || []).length;
  const minutes = Math.max(chineseChars / 300, englishWords / 200);
  return Math.max(1, Math.round(minutes));
}
