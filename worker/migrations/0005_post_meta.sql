-- 博客元数据字段：分类 / 标签 / 作者自评
-- 0006_echo_seed.sql 依赖本迁移提供的列
ALTER TABLE posts ADD COLUMN category TEXT NOT NULL DEFAULT 'UNFILED';
ALTER TABLE posts ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE posts ADD COLUMN rating_json TEXT;
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
