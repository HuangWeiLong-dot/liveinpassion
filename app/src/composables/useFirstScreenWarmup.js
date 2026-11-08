// 首屏 ENTER 的"预热下载"。
//
// 用户点 ENTER 进入站点的那一刻，除了起播音乐，还会顺手把接下来最可能看到的
// 一小批图片拉进缓存：首页右侧 CURATED 的图、ECHOES 最近几篇封面、摄影/画廊
// 的头几张。整段首屏动画（约 2s）就是这些请求的窗口 —— 等用户真的点进某个
// 页面时，图已经在缓存里了。
//
// 约束：
//   · 只下一次，模块级 started 守着（ENTER 可能被按钮/键盘各触发一次）；
//   · 数量刻意压得很小（≤14 张），不要变成"把全站图片都预载"；
//   · 和站内真实的 <img> 用同一个 CORS 模式（anonymous），否则缓存键不同，
//     预载一次、显示时再下一次。
import { routeAssets } from '../data/routeAssets.js';

const MAX = 14;
let started = false;

export function warmFirstScreenAssets() {
  if (started || typeof window === 'undefined') return;
  started = true;

  const urls = new Set();
  const add = (list) => {
    for (const url of list || []) {
      if (url) urls.add(url);
    }
  };

  // 首页 CURATED（最多 7 张）+ 最可能点开的几个页面各取前几张
  add(routeAssets({ name: 'home' }));
  add(routeAssets({ name: 'echoes' }).slice(0, 4));
  add(routeAssets({ name: 'photography' }).slice(0, 1));
  add(routeAssets({ name: 'gallery' }).slice(0, 3));

  for (const url of [...urls].slice(0, MAX)) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = url;
  }
}
