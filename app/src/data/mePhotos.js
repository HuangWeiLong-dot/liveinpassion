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

// 快照里同一张图会有两条记录：原名（IMG_20260921_202245.jpg）和带 hash 的别名
// （IMG_20260921_202245-15f39dd91c2f.jpg），src / fullSrc 完全相同。
// 不按图片地址去重的话，墙面和底部胶卷条里会并排出现同一张照片。
// 用 src（没有就用 fullSrc、再退文件名）做键，真实身份只有一个。
const seenSrc = new Set();
export const mePhotos = [...mePhotoMap.keys()].filter((filename) => {
  const p = mePhotoMap.get(filename);
  const key = p?.src || p?.fullSrc || filename;
  if (seenSrc.has(key)) return false;
  seenSrc.add(key);
  return true;
});

export function mePhotoByName(filename) {
  const p = mePhotoMap.get(filename);
  if (!p) return null;
  return {
    src: p.src || `${CDN_BASE}/Me/compressed_me/${filename}`,
    fullSrc: p.fullSrc || `${CDN_BASE}/Me/${filename}`,
  };
}
