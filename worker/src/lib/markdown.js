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
];

const ALLOWED_ATTRS = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  '*': ['class'],
};

const ALLOWED_SCHEMES = ['http', 'https', 'mailto'];

// marked 配置
marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * 渲染并净化 Markdown
 * @param {string} md
 * @returns {string} 净化后的 HTML
 */
export function renderMarkdown(md) {
  const raw = marked.parse(md);
  return sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    allowedSchemes: ALLOWED_SCHEMES,
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    disallowedTagsMode: 'discard',
  });
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
