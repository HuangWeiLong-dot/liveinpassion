// 卡片通用视觉交互（参考 oumahi.art 的卡片语言）：
//   attachCardTilt    指针跟随的轻微 3D 倾斜（只写 --fx-tilt-x / --fx-tilt-y）
//   playGlitchReveal  图片解码完成时一次「Bayer 抖色 + 逐行抖动」的故障揭示
// 两支都只在细指针、非 reduced-motion 下生效，移动端 / 读屏场景直接跳过。

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const finePointer = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

/**
 * 让 root 里的卡片在指针移动时轻微倾斜。
 * 只写两个 CSS 变量，不碰 transform —— 卡片自己的 hover 变换由样式表负责，
 * 倾斜量会顺着变量插进那条 transform 里。
 *
 * 性能：卡片矩形在指针进入这张卡时量一次并缓存（滚动/窗口变化时失效）。
 * 原来每帧都 getBoundingClientRect —— 而上一帧刚写过 CSS 变量、卡片带着
 * transform 过渡，读的时候布局是脏的，等于每帧一次强制回流，这是倾斜跟手
 * 时的主要毛刺来源。指针在卡内移动时矩形并不会变，量一次就够。
 * @param {HTMLElement} root 事件委托的容器（墙 / 世界）
 * @param {{ card?: string, maxX?: number, maxY?: number }} options
 * @returns {() => void} 解绑函数
 */
export function attachCardTilt(root, { card = '.win--filled', maxX = 6, maxY = 9 } = {}) {
  if (!root || reduceMotion() || !finePointer()) return () => {};

  let active = null;
  let rect = null; // 当前卡片的矩形（客户端坐标），进入卡片时量一次
  let raf = 0;
  let pending = null;
  let lastX = '';
  let lastY = '';

  const reset = (el) => {
    if (!el) return;
    el.style.setProperty('--fx-tilt-x', '0deg');
    el.style.setProperty('--fx-tilt-y', '0deg');
  };

  const apply = () => {
    raf = 0;
    const e = pending;
    pending = null;
    if (!e) return;
    const target = e.target instanceof Element ? e.target : null;
    const el = target?.closest(card);
    if (!el) {
      reset(active);
      active = null;
      rect = null;
      lastX = '';
      lastY = '';
      return;
    }
    if (active !== el) {
      reset(active);
      active = el;
      rect = null;
      lastX = '';
      lastY = '';
    }
    if (!rect) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      rect = { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    const px = (e.clientX - rect.left) / rect.width; // 0..1
    const py = (e.clientY - rect.top) / rect.height;
    // 指针在左/右侧时，卡片绕 Y 轴轻轻转；上/下侧时绕 X 轴转
    const x = `${((0.5 - py) * 2 * maxX).toFixed(2)}deg`;
    const y = `${((px - 0.5) * 2 * maxY).toFixed(2)}deg`;
    if (x !== lastX) {
      el.style.setProperty('--fx-tilt-x', x);
      lastX = x;
    }
    if (y !== lastY) {
      el.style.setProperty('--fx-tilt-y', y);
      lastY = y;
    }
  };

  const onMove = (e) => {
    if (e.pointerType === 'touch') return;
    pending = e;
    if (!raf) raf = requestAnimationFrame(apply);
  };

  const onLeave = () => {
    pending = null;
    reset(active);
    active = null;
    rect = null;
    lastX = '';
    lastY = '';
  };

  // 滚动 / 窗口变化之后缓存的矩形就过期了，下次指针移动时重量一次
  const invalidate = () => {
    rect = null;
  };

  root.addEventListener('pointermove', onMove, { passive: true });
  root.addEventListener('pointerleave', onLeave);
  root.addEventListener('pointercancel', onLeave);
  window.addEventListener('scroll', invalidate, { passive: true, capture: true });
  window.addEventListener('resize', invalidate, { passive: true });

  return () => {
    cancelAnimationFrame(raf);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerleave', onLeave);
    root.removeEventListener('pointercancel', onLeave);
    window.removeEventListener('scroll', invalidate, { capture: true });
    window.removeEventListener('resize', invalidate);
    onLeave();
  };
}

// Bayer 8x8 有序抖色矩阵（值 0..63）
const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

// 阈值先算成 0..255：抖色表只建一次，内层循环里不再做除法
const BAYER_LEVEL = BAYER8.map((v) => (v / 64) * 255);

// 画布像素按 32 位整字写入（比逐通道写 4 次快得多）。字节序按平台判断一次。
const LITTLE_ENDIAN = (() => {
  const probe = new Uint8Array(4);
  new Uint32Array(probe.buffer)[0] = 1;
  return probe[0] === 1;
})();
const pack = LITTLE_ENDIAN
  ? (r, g, b) => 0xff000000 | (b << 16) | (g << 8) | r
  : (r, g, b) => (r << 24) | (g << 16) | (b << 8) | 0xff;
const INK_WHITE = pack(255, 255, 255);
const INK_LIGHT = pack(232, 232, 232);
const INK_DARK = pack(14, 14, 14);

const wrapX = (x, n) => (x < 0 ? x + n : x >= n ? x - n : x);

/**
 * 图片加载完成时，在卡片上叠一块低分辨率画布：未揭示的部分是 Bayer 抖色，
 * 逐行向下揭示，前缘 9 行做像素错位 + 红蓝通道分离，约 1s 后整块淡出。
 * 时长刻意放慢：0.3s 那档扫得太快，抖色只闪一两帧，几乎看不出是"故障"。
 *
 * 性能：画面里只有「前缘 9 行」是逐像素算的；已经揭示的整段、还没揭示的
 * 整段都在创建时预计算成两张 Uint32 表，逐帧只做整行拷贝。原来每帧全图
 * 逐像素读通道 + 写 4 次，灯箱大图一帧要扫十几万像素，是开图/切图时最重
 * 的一笔主线程开销，也是抖色揭示看起来卡顿的根因。
 * @param {HTMLImageElement} img 触发 load 的那张图
 * @param {HTMLElement} host 卡片（position: relative，overflow: hidden）
 */
export function playGlitchReveal(img, host, { duration = 1000, dot = 3 } = {}) {
  if (!img || !host || reduceMotion() || document.hidden) return;
  if (!img.complete || !img.naturalWidth || !img.naturalHeight) return;

  // 用布局尺寸，不取 getBoundingClientRect：悬浮缩放/倾斜不影响画布对齐
  const w = img.clientWidth || img.offsetWidth;
  const h = img.clientHeight || img.offsetHeight;
  if (w < 12 || h < 12) return;

  // 同一张卡重复触发时，先把上一块画布摘掉
  host.querySelectorAll('.fx-glitch').forEach((node) => node.remove());

  const dw = Math.max(6, Math.round(w / dot));
  const dh = Math.max(6, Math.round(h / dot));

  // 原图 → 低分辨率底图（按 object-fit: cover 的裁法）
  const off = document.createElement('canvas');
  off.width = dw;
  off.height = dh;
  const octx = off.getContext('2d', { willReadFrequently: true });
  if (!octx) return;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const dstAspect = w / h;
  let sx = 0;
  let sy = 0;
  let sw = iw;
  let sh = ih;
  if (iw / ih > dstAspect) {
    sw = ih * dstAspect;
    sx = (iw - sw) / 2;
  } else {
    sh = iw / dstAspect;
    sy = (ih - sh) / 2;
  }
  octx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  let data;
  try {
    data = octx.getImageData(0, 0, dw, dh).data;
  } catch {
    // 跨域图片（没带 crossorigin）会污染画布：读不到像素就静默跳过，
    // 图片本身照常显示，不能在控制台留错误。
    return;
  }

  // 两张预计算表：
  //   color  已揭示区的真实颜色
  //   dither 未揭示区的 Bayer-1bit 黑白
  const len = dw * dh;
  const color = new Uint32Array(len);
  const dither = new Uint32Array(len);
  for (let y = 0; y < dh; y++) {
    const row = y * dw;
    const bayerRow = (y & 7) * 8;
    for (let x = 0; x < dw; x++) {
      const i = row + x;
      const si = i * 4;
      const r = data[si];
      const g = data[si + 1];
      const b = data[si + 2];
      color[i] = pack(r, g, b);
      const v = r * 0.299 + g * 0.587 + b * 0.114;
      dither[i] = v > BAYER_LEVEL[bayerRow + (x & 7)] ? INK_LIGHT : INK_DARK;
    }
  }

  const cv = document.createElement('canvas');
  cv.className = 'fx-glitch';
  cv.width = dw;
  cv.height = dh;
  Object.assign(cv.style, {
    position: 'absolute',
    left: `${img.offsetLeft}px`,
    top: `${img.offsetTop}px`,
    width: `${w}px`,
    height: `${h}px`,
    pointerEvents: 'none',
    zIndex: '4',
    opacity: '1',
    transition: 'opacity 0.34s linear',
    imageRendering: 'pixelated',
  });
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  host.appendChild(cv);
  const out = ctx.createImageData(dw, dh);
  const out32 = new Uint32Array(out.data.buffer);

  const start = performance.now();

  const paint = (now) => {
    // 页面切走 / 卡片被摘出文档：直接收工
    if (!cv.isConnected) return;
    const t = Math.min(1, (now - start) / duration);
    if (t >= 1) {
      // 画布上已经是干净的整张图了，淡出交还给真实 <img>
      cv.style.opacity = '0';
      window.setTimeout(() => cv.remove(), 340);
      return;
    }
    // 匀速扫过：0.3s 那档用 easeOut 前段太快，抖色只闪一两帧；
    // 现在整条前缘是稳定往下走的，每一行都看得见。
    const front = Math.round(t * (dh + 14));

    // 1) 前缘以上（含原本就该整行拷的稳定区）：整行拷贝
    const solidEnd = Math.max(0, Math.min(dh, front - 8));
    for (let y = 0; y < solidEnd; y++) {
      const row = y * dw;
      out32.set(color.subarray(row, row + dw), row);
    }

    // 2) 前缘 9 行是「色散带」：整段都做错位 + 红蓝分离，只有这几行逐像素
    const bandEnd = Math.min(dh, front);
    for (let y = solidEnd; y < bandEnd; y++) {
      const row = y * dw;
      const inTear = y === front - 1 || y === front - 7;
      const jitter = Math.round((Math.random() - 0.5) * (inTear ? 26 : 10));
      const split = inTear ? 7 : 6;
      for (let x = 0; x < dw; x++) {
        const ax = wrapX(x - jitter, dw);
        const si = (row + ax) * 4;
        let r = data[si];
        const g = data[si + 1];
        let b = data[si + 2];
        // 前缘：红/蓝通道错开，色边比原来宽一倍
        const offX = split + Math.round(Math.random() * 2);
        r = data[(row + wrapX(x + offX, dw)) * 4];
        b = data[(row + wrapX(x - offX, dw)) * 4];
        out32[row + x] = pack(r, g, b);
      }
    }

    // 3) 前缘那一行留白边
    if (front < dh) out32.fill(INK_WHITE, front * dw, front * dw + dw);

    // 4) 未揭示区：抖色；偶尔整行跳一下，让抖色块看起来是碎的
    for (let y = front + 1; y < dh; y++) {
      const row = y * dw;
      if (Math.random() >= 0.32) {
        out32.set(dither.subarray(row, row + dw), row);
        continue;
      }
      const jitter = Math.round((Math.random() - 0.5) * 12);
      let s = jitter % dw;
      if (s < 0) s += dw;
      if (s === 0) {
        out32.set(dither.subarray(row, row + dw), row);
      } else {
        // 行内水平环绕：目的 [s, dw) ← 源 [0, dw-s)，目的 [0, s) ← 源 [dw-s, dw)
        out32.set(dither.subarray(row, row + dw - s), row + s);
        out32.set(dither.subarray(row + dw - s, row + dw), row);
      }
    }

    ctx.putImageData(out, 0, 0);
    requestAnimationFrame(paint);
  };

  requestAnimationFrame(paint);
}
