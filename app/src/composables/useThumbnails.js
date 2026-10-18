// 运行期缩略图。
//
// 相册里的“压缩图”其实是 3071×3071 左右的原尺寸 JPEG（约 90KB 一个）。
// 几十张铺在 70px 的窗格里，浏览器要解码出几十张 9MP 位图 —— 内存和主线程
// 都会被拖垮，这是 Gallery 卡顿的根因。这里在图片进入视口附近时：
//   fetch → createImageBitmap(resizeWidth) → canvas → 小 JPEG blob URL
// 让页面只持有几百像素宽的位图。
//
// 两层缓存：
//   内存 Map（本次会话） + Cache Storage（跨刷新，键是 宽度|原图地址）。
// 同一个 src 不会重复下载/解码。
const CACHE_NAME = 'lip-gallery-thumbs-v1';
const cache = new Map();
const pending = new Map();

const MAX_ACTIVE = 6;
const queue = [];
let active = 0;

function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift();
    active += 1;
    job.fn()
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1;
        pump();
      });
  }
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}

function cacheKeyUrl(key) {
  return new URL(`/__gallery_thumb/${encodeURIComponent(key)}`, location.origin).href;
}

async function cacheLookup(key) {
  if (typeof caches === 'undefined') return '';
  try {
    const store = await caches.open(CACHE_NAME);
    const hit = await store.match(cacheKeyUrl(key));
    if (!hit) return '';
    const blob = await hit.blob();
    return URL.createObjectURL(blob);
  } catch {
    return '';
  }
}

async function cacheStore(key, blob) {
  if (typeof caches === 'undefined') return;
  try {
    const store = await caches.open(CACHE_NAME);
    await store.put(
      cacheKeyUrl(key),
      new Response(blob, { headers: { 'Content-Type': 'image/jpeg' } })
    );
  } catch {
    // 隐私模式/配额不足就只留内存缓存
  }
}

async function makeThumb(src, width) {
  const res = await fetch(src, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(String(res.status));
  const blob = await res.blob();
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob, {
      resizeWidth: width,
      resizeQuality: 'medium',
    });
  } catch {
    // 不支持 resizeWidth 时退回普通解码
    bitmap = await createImageBitmap(blob);
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78));
  if (!out) throw new Error('toBlob failed');
  return out;
}

/**
 * 取一张照片的小缩略图（blob URL）。
 * @param {string} src 原始（压缩）图片地址
 * @param {number} width 目标宽度，默认 200
 * @returns {Promise<string>} 失败时返回空字符串
 */
export function thumbUrl(src, width = 200) {
  if (!src) return Promise.resolve('');
  const key = `${width}|${src}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (pending.has(key)) return pending.get(key);

  const promise = (async () => {
    const fromDisk = await cacheLookup(key);
    if (fromDisk) {
      cache.set(key, fromDisk);
      return fromDisk;
    }
    const blob = await enqueue(() => makeThumb(src, width));
    await cacheStore(key, blob);
    const url = URL.createObjectURL(blob);
    cache.set(key, url);
    return url;
  })()
    .catch(() => {
      cache.set(key, '');
      return '';
    })
    .finally(() => {
      pending.delete(key);
    });

  pending.set(key, promise);
  return promise;
}
