-- 网站访问统计（无 IP、无 Cookie，仅匿名随机 ID 存浏览器 localStorage 用于 UV 去重）

-- 每日汇总：PV（页面浏览）与 UV（去重会话）
CREATE TABLE IF NOT EXISTS visit_days (
  day TEXT PRIMARY KEY,          -- Asia/Shanghai 日期 'YYYY-MM-DD'
  pv  INTEGER NOT NULL DEFAULT 0,
  uv  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_visit_days_day ON visit_days(day);

-- 每日按路径计数
CREATE TABLE IF NOT EXISTS visit_daily_paths (
  day   TEXT NOT NULL,
  path  TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);

-- 匿名会话：随机 ID，记录首次/最近访问时间（用于 UV 与在线人数）
CREATE TABLE IF NOT EXISTS visit_sessions (
  sid        TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visit_sessions_last ON visit_sessions(last_seen);

-- 会话 × 日期：存在即代表该会话当天来过，用于每日 UV 去重
CREATE TABLE IF NOT EXISTS visit_session_days (
  sid TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (sid, day)
);
