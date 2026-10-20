// LIFE 归档的会话内缓存。
//
// 两个用途：
//  1. /life 总览本来就会拉一次 /api/life/raw/index（用来显示 8 张归档卡的
//     条目数）。归档页复用它，不再一进来就等一次 R2 list。
//  2. 文档按 kind/id 缓存。切回看过的 tab / 日期是瞬时的；悬停卡片/标签时
//     也会预取默认文档，点下去不用再等网络。
//
// 只活在当前浏览器会话里，刷新页面就没了 —— 数据结构小、每晚才变一次，
// 没必要进 localStorage。

const INDEX_TTL = 5 * 60 * 1000;
const DOC_TTL = 5 * 60 * 1000;

let indexCache = null;
const docCache = new Map();

export function setIndexCache(data) {
  indexCache = { at: Date.now(), data };
}

export function getIndexCache(maxAge = INDEX_TTL) {
  if (!indexCache) return null;
  return Date.now() - indexCache.at <= maxAge ? indexCache.data : null;
}

export function setDocCache(kind, id, data) {
  if (!kind || !id) return;
  docCache.set(`${kind}/${id}`, { at: Date.now(), data });
}

export function getDocCache(kind, id, maxAge = DOC_TTL) {
  if (!kind || !id) return null;
  const entry = docCache.get(`${kind}/${id}`);
  if (!entry) return null;
  return Date.now() - entry.at <= maxAge ? entry.data : null;
}

/** vault 的展示顺序：主任务 → 周回顾 → 成本台账 → AI 会话 */
export function vaultRank(id) {
  if (id === 'tasks-master') return 0;
  if (id.startsWith('review-') && id !== 'review-cost-ledger') return 1;
  if (id === 'review-cost-ledger') return 2;
  if (id.startsWith('ai-session-')) return 3;
  return 9;
}

/** 某个 kind 的 id 列表（vault 按上面的语义顺序，其余保持接口返回的倒序） */
export function sortedItems(index, kind) {
  const items = index?.kinds?.[kind] || [];
  if (kind !== 'vault') return items;
  return [...items].sort(
    (a, b) => vaultRank(a.id) - vaultRank(b.id) || b.id.localeCompare(a.id),
  );
}

/** 默认要打开的那一条（LIFE 卡片悬停预取、归档页默认选中都用它） */
export function latestIdFor(index, kind) {
  return sortedItems(index, kind)[0]?.id || null;
}
