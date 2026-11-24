-- 封面来源：一句说明（作者 / 书名 / 出处）+ 原图或原书链接。
-- 有时候封面是别人的作品，前台在文章元信息里显示这条署名。
ALTER TABLE posts ADD COLUMN cover_credit TEXT NOT NULL DEFAULT '';
ALTER TABLE posts ADD COLUMN cover_credit_url TEXT NOT NULL DEFAULT '';
