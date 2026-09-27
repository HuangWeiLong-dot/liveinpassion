-- 初始化 D1 表结构
-- posts: 博客文章
-- albums: 相册分组
-- photos: 照片

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  card_title TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published')),
  content_format TEXT NOT NULL DEFAULT 'md' CHECK(content_format IN ('md', 'html')),
  content_md TEXT,
  content_html TEXT NOT NULL,
  cover_key TEXT,
  cover_full_key TEXT,
  read_time_min INTEGER NOT NULL DEFAULT 1,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);

CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_prefix TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'friend' CHECK(kind IN ('friend', 'group', 'me')),
  cover_photo_id INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_albums_kind ON albums(kind);
CREATE INDEX IF NOT EXISTS idx_albums_sort ON albums(sort_order);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  original_key TEXT NOT NULL,
  compressed_key TEXT,
  width INTEGER,
  height INTEGER,
  size_bytes INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_photos_album ON photos(album_id);
CREATE INDEX IF NOT EXISTS idx_photos_sort ON photos(album_id, sort_order);
