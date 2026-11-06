// 共享辅助：分类白名单 / 标签归一化 / 评级等级重算
// 前端与 CMS 共用同一套规则，避免 grade 与 score 不一致

export const CATEGORY_WHITELIST = ['POEM', 'ESSAY', 'LOG', 'CRITIQUE', 'FRAGMENT', 'LETTER'];
export const DEFAULT_CATEGORY = 'UNFILED';

export const DIMENSIONS = ['language', 'emotion', 'structure', 'afterglow'];
export const DIMENSION_LABELS = {
  language: 'LANGUAGE',
  emotion: 'EMOTION',
  structure: 'STRUCTURE',
  afterglow: 'AFTERGLOW',
};

// 只接受白名单，否则回退 UNFILED
export function normalizeCategory(input) {
  const v = String(input || '').trim().toUpperCase();
  return CATEGORY_WHITELIST.includes(v) ? v : DEFAULT_CATEGORY;
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

// 把后端 rating_json / 前端传入对象都规整成统一结构，grade 由 score 推出（不信任前端传的 grade）
export function normalizeRating(input) {
  if (!input) return null;
  let obj = input;
  if (typeof input === 'string') {
    try { obj = JSON.parse(input); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object') return null;

  const rawScore = Number(obj.score);
  const score = Number.isFinite(rawScore) && rawScore >= 0 && rawScore <= 10
    ? Math.round(rawScore * 10) / 10
    : null;

  const dims = {};
  for (const d of DIMENSIONS) {
    const v = Number(obj[d]);
    if (Number.isFinite(v) && v >= 0 && v <= 10) dims[d] = Math.round(v * 10) / 10;
  }

  const verdict = typeof obj.verdict === 'string' ? obj.verdict.trim().slice(0, 180) : '';
  const note = typeof obj.note === 'string' ? obj.note.trim().slice(0, 120) : '';

  let grade = null;
  if (score !== null) {
    grade = score >= 9.0 ? 'S'
      : score >= 8.0 ? 'A'
      : score >= 7.0 ? 'B'
      : score >= 6.0 ? 'C'
      : 'D';
  }

  return { score, grade, dimensions: dims, verdict, note };
}

export function ratingToStored(rating) {
  if (!rating) return null;
  const obj = normalizeRating(rating);
  if (!obj) return null;
  const stored = {
    score: obj.score,
    grade: obj.grade,
    ...obj.dimensions,
    verdict: obj.verdict,
    note: obj.note,
  };
  return JSON.stringify(stored);
}

export function tagsToStored(tags) {
  return JSON.stringify(normalizeTags(tags));
}
