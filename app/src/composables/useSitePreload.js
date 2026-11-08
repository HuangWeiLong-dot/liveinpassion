// 首屏选 LIVE IN PASSION 时的全站图片预载。
//
// 两种范围（LIVE 下面的 QUICK / FULL）：
//   · QUICK（默认）：只等前 QUICK_COUNT 张（展示 + 最近封面，够首屏用），
//     这批下完就放行进场；剩余继续在后台下。
//   · FULL：等全站下完或 45s 上限。
// 任何时候都可以 SKIP 先进站，下载在后台继续。
//
// 进度同时暴露：百分比 / 完成数 / 总数 / 预计剩余秒数 / 已载入的 URL
//（BrandOverlay 用它画字后面的图片拼贴、字上的填充和底部的读数）。
import { reactive } from 'vue';
import { blogPosts } from '../data/blogPosts.js';
import { mePhotos, mePhotoByName } from '../data/mePhotos.js';
import { friends } from '../data/friends.js';
import albumContent from '../data/content/albums.json';
import { showcaseData } from '../data/showcase.js';

const MAX_MS = 45000;
const CONCURRENCY = 8;
const QUICK_COUNT = 30;
const COLLAGE_MAX = 45;

export const sitePreload = reactive({
  active: false,
  scope: 'quick',
  done: 0,
  total: 0,
  /** 0–100；不在预载时是 100 */
  progress: 100,
  /** 预计剩余秒数（按已下完的平均速度估） */
  etaSec: 0,
  /** 已成功载入的 URL，给拼贴用（只留前 45 个） */
  loadedUrls: [],
});

let promise = null;
let resolveWait = null;
let startedAt = 0;
let target = 0;
let resolved = false;

function collectUrls() {
  const urls = new Set();
  const add = (url) => {
    if (url) urls.add(url);
  };

  // 首屏展示优先
  add(showcaseData.latestEcho?.image);
  add(showcaseData.latestPhotography?.image);
  showcaseData.selected.forEach((item) => add(item.image));

  // 博客封面（首页人格 / 球体用的就是这批）
  blogPosts.forEach((post) => add(post.image?.src));

  // 相册照片
  (albumContent.albums || []).forEach((album) => {
    (album.photos || []).forEach((photo) => add(photo.src || photo.fullSrc));
  });
  mePhotos.forEach((name) => add(mePhotoByName(name)?.src));
  friends.forEach((friend) => {
    (friend.photos || []).forEach((photo) => add(photo.src || photo.fullSrc));
  });

  // 影片海报
  add('https://cms.liveinpassion.me/img/films/the-projection-poster.jpg');

  return [...urls];
}

function finishWait() {
  if (resolved) return;
  resolved = true;
  sitePreload.active = false;
  sitePreload.progress = 100;
  sitePreload.etaSec = 0;
  resolveWait?.();
  resolveWait = null;
}

/** 提前进站：不等剩余图片，下载继续在后台跑 */
export function skipSitePreload() {
  finishWait();
}

/**
 * 开始预载。
 * @param {'quick'|'full'} scope
 * @returns {Promise<void>} QUICK 的批次 / FULL 的全部（或 45s 上限 / SKIP）兑现
 */
export function preloadSiteImages(scope = 'quick') {
  if (promise) return promise;

  const urls = collectUrls();
  target = scope === 'full' ? urls.length : Math.min(QUICK_COUNT, urls.length);

  sitePreload.scope = scope;
  sitePreload.active = true;
  sitePreload.done = 0;
  sitePreload.total = target;
  sitePreload.progress = target ? 0 : 100;
  sitePreload.etaSec = 0;
  sitePreload.loadedUrls = [];
  startedAt = Date.now();

  promise = new Promise((resolve) => {
    resolveWait = resolve;
  });

  let index = 0;
  let done = 0;

  const one = (url, ok) => {
    done += 1;
    if (ok && sitePreload.loadedUrls.length < COLLAGE_MAX) {
      sitePreload.loadedUrls.push(url);
    }
    // UI 只关心当前范围的那一批；后台继续下完剩余
    if (!resolved && done <= target) {
      sitePreload.done = Math.min(done, target);
      sitePreload.progress = Math.min(100, Math.round((done / target) * 100));
      const elapsed = (Date.now() - startedAt) / 1000;
      sitePreload.etaSec = done > 0
        ? Math.max(0, Math.round((elapsed / done) * (target - done)))
        : 0;
      if (done >= target) finishWait();
    }
    kick();
  };

  const kick = () => {
    // QUICK 只负责首屏那一批：这批完成（或被 SKIP）后不再启动剩余图片，
    // 否则后台几百张图会和当前页面的图片抢带宽，浏览反而更卡。
    if (resolved && sitePreload.scope === 'quick') return;
    if (index >= urls.length) return;
    const url = urls[index];
    index += 1;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => one(url, true);
    img.onerror = () => one(url, false);
    img.src = url;
  };

  // 45s 上限：先放行，剩余仍然继续（只是不再挡首屏）
  setTimeout(() => {
    finishWait();
  }, MAX_MS);

  if (!urls.length) {
    finishWait();
    return promise;
  }

  for (let i = 0; i < Math.min(CONCURRENCY, urls.length); i += 1) kick();
  return promise;
}
