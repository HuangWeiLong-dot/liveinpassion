// 按可见性加载图片：给一个选择器建一个观察器，元素进入视口（含 rootMargin 预留）才调 loadImage。
//
// 与 useGalleryObserver 的分工：那个负责"入场淡入"（.visible 与旧版一致），
// 这个只负责"看不见就不发请求"。密集网格（ME 月相册）用这个。
//
// rootMargin 的作用是留一点提前量，避免滚动时才看到骨架屏。
import { loadImage } from './useImageLoader.js';

export function observeLazyImages(selector, { rootMargin = '300px' } = {}) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const img = entry.target.querySelector('img[data-full-src], img[data-src]');
        if (img) loadImage(img);
        // 触发过就不再观察：加载成功后没什么可做的了（失败也不自动重试，与旧版一致）
        observer.unobserve(entry.target);
      });
    },
    { rootMargin }
  );

  document.querySelectorAll(selector).forEach((el) => observer.observe(el));
  return observer;
}
