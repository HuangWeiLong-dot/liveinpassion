// 图片加载管线（网格用压缩图，原图只在灯箱按需加载）。
//
// 加载策略（2026-09 性能优化）：
//   - 网格/列表缩略图：优先加载 data-src（1920px 压缩图，约 200-500KB），
//     原图动辄 3-8MB，之前网格直接拉原图是卡顿的最大来源；
//   - 灯箱：点开时才请求 fullSrc 原图（useLightbox 已按 fullSrc 优先解析）；
//   - 只写了 data-full-src 的调用方仍然可用（回退链 data-src → data-full-src）。
// 好处：单张字节量降 90%+，解码压力骤减；坏处：失去模糊预览（骨架屏顶上）。
//
// 类名契约保持不变（.skeleton-loader / .has-image / .loaded / .wide / .tall），
// 所以样式表不用改，图片层"只能挂静态 class"的约束也不变。
//
// 不在本管线内的用途：好友跑马灯头像、ME 头像、MORE/GALLERY 磁贴背景——它们本来就是
// 单源的压缩小图，继续直接使用压缩图地址。

export function showLoadError(parent, skeleton, img) {
  if (skeleton) skeleton.classList.add('hidden');
  if (img) img.style.display = 'none';

  let errorMsg = parent.querySelector('.load-error-msg');
  if (!errorMsg) {
    errorMsg = document.createElement('div');
    errorMsg.className = 'load-error-msg';
    errorMsg.textContent = 'Loading Failed';
    parent.appendChild(errorMsg);
  }
  errorMsg.style.display = 'flex';
}

export function loadImage(img) {
  // 网格加载压缩图优先（data-src），没写压缩图地址的调用方回退原图
  const src = img.dataset.src || img.dataset.fullSrc;

  if (!src) return;
  if (img.dataset.loading === 'true') return;
  if (img.classList.contains('loaded') && img.src) return;

  img.dataset.loading = 'true';
  // 解码移出主线程，避免画廊缩略图同步解码阻塞交互（INP）
  img.decoding = 'async';

  const parent = img.parentElement;
  const skeleton =
    parent?.querySelector('.skeleton-loader') || parent?.parentElement?.querySelector('.skeleton-loader');

  if (skeleton) skeleton.classList.remove('hidden');

  const reveal = () => {
    requestAnimationFrame(() => {
      if (skeleton) skeleton.classList.add('hidden');
      if (parent) {
        parent.classList.add('has-image');
        // 宽高比仍决定 .wide / .tall（阈值与旧版一致）
        const ratio = img.naturalWidth / img.naturalHeight;
        if (ratio > 1.5) parent.classList.add('wide');
        else if (ratio < 0.8) parent.classList.add('tall');
      }
      img.classList.remove('blur-placeholder');
      img.classList.add('loaded');
      img.dataset.loading = 'false';
    });
  };

  // 直接给 <img> 赋 src 即可：可见性由 .has-image 控制（CSS 里 img 默认 opacity: 0），
  // 不需要旧版"先用 new Image() 探一探、再赋给元素"的那次额外往返。
  img.onload = () => {
    if (img.dataset.index !== undefined) {
      img.alt = `Gallery Image ${parseInt(img.dataset.index) + 1}`;
    }
    reveal();
  };
  img.onerror = () => {
    showLoadError(parent, skeleton, img);
    img.dataset.loading = 'false';
  };
  img.src = src;
}

// 分批加载：每帧 4 张，避免十几张图同时请求卡住首屏（旧版 loadHomeGalleryBatch / loadInitBatch 的做法）
export function loadImagesBatched(imgs, perFrame = 4) {
  let cursor = 0;
  (function nextBatch() {
    imgs.slice(cursor, cursor + perFrame).forEach((img) => loadImage(img));
    cursor += perFrame;
    if (cursor < imgs.length) requestAnimationFrame(nextBatch);
  })();
}

// Hero 图：同样只加载原图。与 loadImage 的唯一区别是它还要负责 img 的 .active
// （样式表里 .hero-image img.hero-img.active 才可见）以及隐藏 hero 自己的骨架屏。
export function loadHeroImage(img, skeleton) {
  const src = img.dataset.fullSrc || img.dataset.src;
  if (!src) return;

  img.decoding = 'async';

  img.onload = () => {
    requestAnimationFrame(() => {
      if (skeleton && !skeleton.classList.contains('hidden')) skeleton.classList.add('hidden');
      if (!document.querySelector('.hero-image .hero-img.active')) img.classList.add('active');
      img.classList.remove('blur-placeholder');
      img.classList.add('loaded');
    });
  };
  img.onerror = () => {
    // 加载失败：只隐藏骨架屏，不留永久黑块（与旧版的失败兜底一致）
    if (skeleton) skeleton.classList.add('hidden');
  };
  img.src = src;
}
