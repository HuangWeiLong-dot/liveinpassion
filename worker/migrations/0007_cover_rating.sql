-- 封面评分：独立于正文的作者自评，只存 score / grade / verdict
ALTER TABLE posts ADD COLUMN cover_rating_json TEXT;
