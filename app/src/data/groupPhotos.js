// MORE 磁贴背景池：从 CMS 快照的 group_photos 相册提取。
// 格式 { compressed, full } 为相对路径（不含 CDN_BASE），与旧版一致。

import content from './content/albums.json';
import { CDN_BASE } from './cdn.js';

const albums = (content && Array.isArray(content.albums)) ? content.albums : [];
const groupAlbum = albums.find((a) => a.r2Prefix === 'group_photos');

function stripCdn(url) {
  if (!url) return '';
  return url.replace(CDN_BASE + '/', '');
}

export const groupMorePhotos = (groupAlbum && groupAlbum.photos)
  ? groupAlbum.photos.map((p) => ({
      compressed: stripCdn(p.src),
      full: stripCdn(p.fullSrc),
    }))
  : [];
