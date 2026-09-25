// ME 相册的月份分组。三个提取函数逐字搬自旧文件（index.html L6037-L6071）。
//
// 分组结果放模块作用域：旧版用 meGalleryMonthGroups 缓存，整场会话只分组一次
//（212 个文件名，分组本身不贵，但语义要保持一致）。
//
// 与旧版的一处简化：旧版还有个 meGalleryMonthCache 缓存**DOM 节点**，月份来回切换时
// 直接复用节点避免重新加载。新版不缓存 DOM——月份数据与浏览器 HTTP 缓存已经能保证
// 切回来瞬间可见，少一层手工 DOM 复用也就少一处会失效的缓存。
import { ref } from 'vue';
import { mePhotos } from '../data/mePhotos.js';

// IMG_20260508_024939.jpg → "2026-05"
export function extractYearMonthFromFilename(filename) {
  const match = filename.match(/(\d{6})/);
  if (!match) return 'unknown';
  const d = match[1];
  return d.substring(0, 4) + '-' + d.substring(4, 6);
}

// IMG_20260508_024939.jpg → "2026-05-08"；只有六位数字时退化为 "2026-05"
export function extractDateFromFilename(filename) {
  const match = filename.match(/(\d{8})/);
  if (match) {
    const d = match[1];
    return d.substring(0, 4) + '-' + d.substring(4, 6) + '-' + d.substring(6, 8);
  }
  const match2 = filename.match(/(\d{6})/);
  if (match2) {
    const d = match2[1];
    return d.substring(0, 4) + '-' + d.substring(4, 6);
  }
  return '';
}

// 按月份分组，键降序（"2026-08" 在前）
export function groupPhotosByMonth(photos) {
  const groups = {};
  photos.forEach((filename) => {
    const ym = extractYearMonthFromFilename(filename);
    if (!groups[ym]) groups[ym] = [];
    groups[ym].push(filename);
  });
  return Object.keys(groups)
    .sort()
    .reverse()
    .reduce((obj, key) => {
      obj[key] = groups[key];
      return obj;
    }, {});
}

const monthGroups = groupPhotosByMonth(mePhotos);
const monthKeys = Object.keys(monthGroups);
// 默认显示最新月份（旧版取 Object.keys(...)[0]）
const activeMonth = ref(monthKeys[0] || '');

export function useMeGallery() {
  return {
    monthGroups,
    monthKeys,
    activeMonth,
    // 网格用的列表：旧版按文件名**降序**排（b.localeCompare(a)）
    photosOfMonth(ym) {
      return [...(monthGroups[ym] || [])].sort((a, b) => b.localeCompare(a));
    },
  };
}
