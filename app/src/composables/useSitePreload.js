// 首屏选 LIVE IN PASSION 时的**全站图片预载**。
//
// 范围：首页展示 / 全部博客封面 / 全部相册照片（好友、群组、ME、摄影）/ 影片海报。
// 不含 134MB 的影片本体，也不含音乐（音频按需流式播放，不是这里的卡顿来源）。
//
// 进度条直接画在首屏 LIVEINPASSION 那行字上（见 BrandOverlay 的
// --brand-progress）：字从左到右被“填满”，填满/到上限才进入站点。
//
// ⚠ 这是用户**主动选 LIVE** 才会发生的事；默认是 NOT LIVE IN PASSION，不预载。
//   全站几百张压缩图，慢网下可能要几十秒 —— 所以有 45s 上限：到点先放行，
//   剩下的继续在后台下载（不再挡首屏）。
import { reactive } from 'vue';
import { blogPosts } from '../data/blogPosts.js';
import { mePhotos, mePhotoByName } from '../data/mePhotos.js';
import { friends } from '../data/friends.js';
import albumContent from '../data/content/albums.json';
import { showcaseData } from '../data/showcase.js';

const MAX_MS = 45000;
const CONCURRENCY = 8;

export const sitePreload = reactive({
  active: false,
  done: 0,
  total: 0,
  /** 0–100；不在预载时是 100（字是满的） */
  progress: 100,
});

let started = false;
let promise = null;

function collectUrls() {
  const urls = new Set();
  const add = (url) => {
    if (url) urls.add(url);
  };

  // 首屏展示优先
  add(showcaseData.latestEcho?.image);
  add(showcaseData.latestPhotography?.image);
  showcaseData.selected.forEach((item) => add(item.image));

  // 全部博客封面（列表 / 详情用的都是压缩图）
  blogPosts.forEach((post) => add(post.image?.src));

  // 全部相册照片：friend / group / me / photography
  (albumContent.albums || []).forEach((album) => {
    (album.photos || []).forEach((photo) => add(photo.src || photo.fullSrc));
  });

  // ME 的 hash 路径（mePhotoByName 的映射比 albums 的全）
  mePhotos.forEach((name) => add(mePhotoByName(name)?.src));

  // 好友的扁平照片（部分旧相册结构在 friends.js 里）
  friends.forEach((friend) => {
    (friend.photos || []).forEach((photo) => add(photo.src || photo.fullSrc));
  });

  // 影片海报
  add('https://cms.liveinpassion.me/img/films/the-projection-poster.jpg');

  return [...urls];
}

/**
 * 开始预载。重复调用返回同一个 promise。
 * @returns {Promise<void>} 全部完成或到达 45s 上限时兑现
 */
export function preloadSiteImages() {
  if (promise) return promise;

  const urls = collectUrls();
  sitePreload.active = true;
  sitePreload.total = urls.length;
  sitePreload.done = 0;
  sitePreload.progress = 0;

  promise = new Promise((resolve) => {
    let index = 0;
    let done = 0;
    let resolved = false;
    let timer = 0;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      sitePreload.active = false;
      sitePreload.progress = 100;
      resolve();
    };

    const one = () => {
      done += 1;
      sitePreload.done = done;
      sitePreload.progress = urls.length
        ? Math.min(100, Math.round((done / urls.length) * 100))
        : 100;
      if (done >= urls.length) finish();
      else kick();
    };

    const kick = () => {
      if (index >= urls.length) return;
      const url = urls[index];
      index += 1;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = one;
      img.onerror = one;
      img.src = url;
    };

    // 45s 上限：先让用户进站，剩下的图继续在后台下载（不再更新进度）
    timer = window.setTimeout(() => {
      finish();
      // 放行之后仍然把剩下的排空 —— 只是不再挡住首屏
      while (index < urls.length) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.src = urls[index];
        index += 1;
      }
    }, MAX_MS);

    if (!urls.length) {
      finish();
      return;
    }
    for (let i = 0; i < Math.min(CONCURRENCY, urls.length); i += 1) kick();
  });

  return promise;
}
