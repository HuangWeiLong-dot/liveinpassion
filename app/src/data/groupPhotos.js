// MORE 磁贴背景池：从 CMS 快照的 group_photos 相册提取。
// 格式 { compressed, full } 为 **绝对地址**（当前快照来自 cms.liveinpassion.me）。
//
// 之前这里按 CDN_BASE（img.liveinpassion.me）拼相对路径；快照换成 CMS 域名后
// 两边对不上，拼出来的 URL 会变成 `https://img.liveinpassion.me/https://cms...`。
// 现在直接把快照里的 src/fullSrc 交出去，调用方不再二次拼接。
import content from './content/albums.json';

const albums = (content && Array.isArray(content.albums)) ? content.albums : [];
const groupAlbum = albums.find((a) => a.r2Prefix === 'group_photos');

export const groupMorePhotos = (groupAlbum && groupAlbum.photos)
  ? groupAlbum.photos.map((p) => ({
      compressed: p.src,
      full: p.fullSrc,
    }))
  : [];
