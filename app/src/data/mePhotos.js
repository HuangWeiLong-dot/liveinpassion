// Me 照片文件名列表：从 CMS 快照的 Me 相册提取。
// 组件（useMeTiles / useMeGallery）自行拼接 CDN 路径（Me/{filename} / Me/compressed_me/{filename}）。

import content from './content/albums.json';
import { CDN_BASE } from './cdn.js';

const albums = (content && Array.isArray(content.albums)) ? content.albums : [];
const meAlbum = albums.find((a) => a.r2Prefix === 'Me');

export const mePhotos = (meAlbum && meAlbum.photos)
  ? meAlbum.photos.map((p) => p.filename)
  : [];
