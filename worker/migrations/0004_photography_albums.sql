-- 相册新增 photography 分类（摄影作品，按人名分子路由）
--   kind: friend / group / me / photography
--   person: photography 相册的人名（同时作为 /photography/:person 的路由段与 R2 子目录）
--
-- SQLite 不能直接改 CHECK 约束，只能重建 albums。
-- 重建期间 photos 有外键指向 albums，所以先把 photos 数据备份到无外键的临时表、
-- 依次删掉 child / parent，再按新结构恢复 —— 不能直接 DROP albums，否则
-- foreign_keys 开启时会触发 ON DELETE CASCADE 把照片记录一起删掉。

CREATE TABLE albums_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_prefix TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'friend' CHECK(kind IN ('friend', 'group', 'me', 'photography')),
  person TEXT,
  cover_photo_id INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO albums_new (id, r2_prefix, name, kind, person, cover_photo_id, sort_order, created_at)
SELECT id, r2_prefix, name, kind, NULL, cover_photo_id, sort_order, created_at FROM albums;

CREATE TABLE photos_backup AS SELECT * FROM photos;

DROP TABLE photos;
DROP TABLE albums;

ALTER TABLE albums_new RENAME TO albums;

CREATE TABLE photos (
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

INSERT INTO photos (id, album_id, file_name, original_key, compressed_key, width, height, size_bytes, sort_order, created_at)
SELECT id, album_id, file_name, original_key, compressed_key, width, height, size_bytes, sort_order, created_at FROM photos_backup;

DROP TABLE photos_backup;

CREATE INDEX IF NOT EXISTS idx_albums_kind ON albums(kind);
CREATE INDEX IF NOT EXISTS idx_albums_sort ON albums(sort_order);
CREATE INDEX IF NOT EXISTS idx_photos_album ON photos(album_id);
CREATE INDEX IF NOT EXISTS idx_photos_sort ON photos(album_id, sort_order);
