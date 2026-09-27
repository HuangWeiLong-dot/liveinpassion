// Me 照片数据：从 CMS 快照的 Me 相册提取。
// - mePhotos：文件名列表（useMeGallery 按文件名正则做月份分组、useMeTiles/RandomGallery 随机抽样）
// - mePhotoByName：API 返回的 src/fullSrc（R2 hash 路径）。
//   迁移的旧文件 key 就是扁平原名（Me/{filename}、Me/compressed_me/{filename}），
//   新上传的照片 key 是 hash 路径（Me/{yyyyMM}/{hash}.jpg），必须用 API 值才能显示；
//   快照缺字段时回退旧拼法，保证旧数据兜底可用。

import content from './content/albums.json';
import { CDN_BASE } from './cdn.js';

const albums = (content && Array.isArray(content.albums)) ? content.albums : [];
const meAlbum = albums.find((a) => a.r2Prefix === 'Me');

const mePhotoMap = new Map(
  (meAlbum && meAlbum.photos ? meAlbum.photos : []).map((p) => [p.filename, p])
);

export const mePhotos = [...mePhotoMap.keys()];

export function mePhotoByName(filename) {
  const p = mePhotoMap.get(filename);
  if (!p) return null;
  return {
    src: p.src || `${CDN_BASE}/Me/compressed_me/${filename}`,
    fullSrc: p.fullSrc || `${CDN_BASE}/Me/${filename}`,
  };
}
