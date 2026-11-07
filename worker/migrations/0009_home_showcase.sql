-- 首页右侧展示（Home Showcase）：
--   films            影片库（CMS 可增删改；目前只有《The Projection》）
--   showcase_items   Author's Selected 的手动挑选清单（echo / photography / film）
--   showcase_settings 每一类最多显示几条（0 表示该类不显示）
--
-- 说明：
--   · showcase_items.ref_id 指向 posts.id / albums.id / films.id，不做外键 ——
--     删除文章/相册时不该连带删掉精选记录，解析时找不到就跳过即可。
--   · 影片不在这里上传视频：video_key / poster_key 填 R2 里的对象名，
--     path 是前台卡片的跳转地址（默认 /projection，以后新片可以指向新页面）。

CREATE TABLE IF NOT EXISTS films (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  video_key TEXT NOT NULL,
  poster_key TEXT,
  path TEXT NOT NULL DEFAULT '/projection',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_films_status ON films(status);
CREATE INDEX IF NOT EXISTS idx_films_sort ON films(sort_order);

CREATE TABLE IF NOT EXISTS showcase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('echo', 'photography', 'film')),
  ref_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(kind, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_showcase_items_sort ON showcase_items(sort_order);

CREATE TABLE IF NOT EXISTS showcase_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 把现有短片登记成一条影片记录（重复执行不会覆盖后台改过的内容）
INSERT OR IGNORE INTO films
  (slug, title, subtitle, description, video_key, poster_key, path, status, sort_order, published_at)
VALUES
  ('the-projection', 'The Projection', 'A short film',
   'Black and white. 1''18". Breathing only.',
   'films/the-projection.mp4', 'films/the-projection-poster.jpg',
   '/projection', 'published', 0, datetime('now'));

INSERT OR IGNORE INTO showcase_settings (key, value) VALUES
  ('echo_limit', '4'),
  ('photography_limit', '3'),
  ('film_limit', '2');

-- 精选默认放一部影片，首页右侧不至于只有两条"最新"。
-- 不预选文章/相册：它们和 latestEcho / latestPhotography 会重复。
INSERT OR IGNORE INTO showcase_items (kind, ref_id, sort_order)
SELECT 'film', id, 0 FROM films WHERE slug = 'the-projection';
