// 画廊数据：读取构建期从 CMS API 拉取的快照（content/albums.json）。
// 按 r2_prefix 映射到各命名导出，照片格式 { id, filename, src, fullSrc } 与旧版 generateGalleryData 一致。

import content from './content/albums.json';

const albums = (content && Array.isArray(content.albums)) ? content.albums : [];

function photosByPrefix(prefix) {
  const album = albums.find((a) => a.r2Prefix === prefix);
  return album ? album.photos : [];
}

export const lijiazuGalleryData = photosByPrefix('LiJiaZu');
export const jianghaipengGalleryData = photosByPrefix('JiangHaiPeng');
export const lixinyuGalleryData = photosByPrefix('LiXinYu');
export const wangshuaiGalleryData = photosByPrefix('WangShuai');
export const xuhaonanGalleryData = photosByPrefix('XuHaoNan');
export const sunjiajunGalleryData = photosByPrefix('SunJiaJun');
export const groupPhotosGalleryData = photosByPrefix('group_photos');
