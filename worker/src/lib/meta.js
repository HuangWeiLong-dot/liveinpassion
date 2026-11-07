// 共享辅助：分类 / 标签归一化

export const CATEGORY_WHITELIST = ['POEM', 'ESSAY', 'LOG', 'CRITIQUE', 'FRAGMENT', 'LETTER'];
export const DEFAULT_CATEGORY = 'UNFILED';

// 分类是自由文本（CMS 里可输入或点选历史分类），这里只做大小写/空白归一化。
// 早期版本限定白名单，会把作者自己起的分类静默改成 UNFILED。
export function normalizeCategory(input) {
  const v = String(input || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
  return (v || DEFAULT_CATEGORY).slice(0, 24);
}

// 去空去重统一大写；最多 12 个，每个最长 24 字符（超长后端截断，防止恶意输入）
export function normalizeTags(input) {
  let arr = [];
  if (Array.isArray(input)) arr = input;
  else if (typeof input === 'string') {
    try { arr = JSON.parse(input); } catch { arr = input.split(/[,\s，、]+/); }
  }
  const seen = new Set();
  const out = [];
  for (const t of arr) {
    const v = String(t || '').trim().toUpperCase();
    if (!v || v.length > 24) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= 12) break;
  }
  return out;
}

export function tagsToStored(tags) {
  return JSON.stringify(normalizeTags(tags));
}
