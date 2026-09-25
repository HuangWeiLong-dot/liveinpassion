// 由仓库根 index.html 的 L5618-L5652 逐字搬运（只加了 export 与 CDN_BASE 的 import）。
// 照片文件名里的 YYYYMM_N 是排序与月份分组的唯一依据，别改这两个函数的规则。
import { CDN_BASE } from './cdn.js';

// 辅助函数：按年份月份排序
export function sortPhotos(photos) {
    return photos.sort((a, b) => {
        const dateA = a.filename.match(/(\d{4})(\d{2})_(\d+)/);
        const dateB = b.filename.match(/(\d{4})(\d{2})_(\d+)/);
        if (!dateA || !dateB) return 0;
        const yearA = parseInt(dateA[1]);
        const yearB = parseInt(dateB[1]);
        const monthA = parseInt(dateA[2]);
        const monthB = parseInt(dateB[2]);
        const numA = parseInt(dateA[3]);
        const numB = parseInt(dateB[3]);
        if (yearA !== yearB) return yearB - yearA;
        if (monthA !== monthB) return monthB - monthA;
        return numB - numA;
    });
}

// 辅助函数：生成画廊数据
export function generateGalleryData(folder, compressedFolder, filenames, shouldSort = true) {
    const photos = filenames.map(filename => {
        return {
            filename: filename,
            src: `${CDN_BASE}/${compressedFolder}/${filename}`,
            fullSrc: `${CDN_BASE}/${folder}/${filename}`
        };
    });
    const sorted = shouldSort ? sortPhotos(photos) : photos;
    return sorted.map((p, idx) => ({
        id: idx + 1,
        filename: p.filename,
        src: p.src,
        fullSrc: p.fullSrc
    }));
}
