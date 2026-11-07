-- 评级系统整体移除：正文作者自评 + 封面评分
-- 需要手动执行：cd worker && npm run db:migrate:remote
ALTER TABLE posts DROP COLUMN rating_json;
ALTER TABLE posts DROP COLUMN cover_rating_json;
