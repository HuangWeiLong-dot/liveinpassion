// 画廊项的进场观察器。承担两件事：
//   1. 入场淡入——给 .gallery-item 加 .visible（旧 index.html L7676-L7700 的原有行为）
//   2. 【新】按可见性发起图片请求——loadOnVisible: true 时，只有进入视口（或 rootMargin
//      预留范围内）的项才会调 loadImage，看不见的图不发请求
//
// 为什么需要第 2 项：密集网格（ME 月相册每月最多几十张、好友时间线最多 33 张、群组照片 26 张）
// 如果在构建时一次性请求，绝大多数图是用户根本没滚到、也不会看的。首页画廊保持 eager
// （14 张精选，且画廊起点就在首屏边缘），密集网格用 loadOnVisible。
//
// rootMargin 的意义：给"即将进入视口"的内容留一点提前量，避免滚动时才看到骨架屏。
import { loadImage } from './useImageLoader.js';

let galleryObserver = null;

export function observeGalleryItems({ loadOnVisible = false, rootMargin = '0px' } = {}) {
  // 先取消之前的观察（与旧版一致：每次构建画廊都重建观察器）
  if (galleryObserver) {
    galleryObserver.disconnect();
  }

  galleryObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            entry.target.classList.add('visible');
          }, index * 50);

          if (loadOnVisible) {
            const img = entry.target.querySelector('img[data-full-src], img[data-src]');
            if (img) loadImage(img); // loadImage 自带去重，重复观察到同一项不会重复请求
          }
        } else {
          entry.target.classList.remove('visible');
        }
      });
    },
    { threshold: 0.1, rootMargin }
  );

  document.querySelectorAll('.gallery-item').forEach((item) => {
    galleryObserver.observe(item);
  });
}
