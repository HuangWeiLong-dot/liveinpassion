-- LifeLogging → 站点：每天一份脱敏聚合快照
-- 只存聚合数字（分类时长、步数、城市级位置、手机计数、AI 花费），
-- 不存坐标、轨迹、窗口标题/URL、应用包名。字段白名单校验在 routes/life.js。

CREATE TABLE IF NOT EXISTS life_days (
  day        TEXT PRIMARY KEY,          -- YYYY-MM-DD（Asia/Shanghai）
  payload    TEXT NOT NULL,             -- 单日快照 JSON
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
