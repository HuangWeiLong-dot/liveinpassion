-- 相关性结论（scripts/patterns.py 算出来的）是**跨天**的，不属于某一天，
-- 所以不能塞进 life_days 的某一个 payload 里 —— 那样它会被"最后一天"绑架，
-- 而且每天重发会把其余天一起覆盖。
--
-- 用一张极小的 key-value 表：目前只有 patterns 这一个 key，但下次要存
-- 「本周复盘」「月度摘要」之类的东西时不用再建表。

CREATE TABLE IF NOT EXISTS life_meta (
  key        TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
