// 路由预取清单：进入某条路由之前，提前把首屏会用到的图片下载进浏览器缓存。
//
// 只列**图片** —— 页面代码全部静态打进主包（见 router/index.js 顶部注释），
// 数据 JSON 也随包到达；真正从网络下载的只有 CMS/R2 上的照片、封面。
//
// 每条路由只取前若干张：画廊 / 窗户墙 / 博客轨道都是按可见性懒加载的，
// 一上来把几百张全预取只会抢掉真正要显示的那几张的带宽。

import { blogPosts, blogBySlug } from './blogPosts.js';
import { friends } from './friends.js';
import { mePhotos, mePhotoByName } from './mePhotos.js';
import albumContent from './content/albums.json';
import { showcaseData } from './showcase.js';
import { useMeGallery } from '../composables/useMeGallery.js';

// 单次预取上限。18 张 ≈ 一个首屏多一点，手机上也不会把流量吃光。
const MAX = 18;

const srcOf = (photo) => (photo && (photo.src || photo.fullSrc)) || '';

/** 去空、去重、截断 */
function head(list, n = MAX) {
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const url = typeof raw === 'string' ? raw : srcOf(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= n) break;
  }
  return out;
}

/** 正文里夹带的 <img>（目前只有一篇）—— 详情页真的会请求它们 */
function inlineImages(html) {
  const out = [];
  const re = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || '')))) out.push(m[1]);
  return out;
}

function photographyAlbums() {
  return (albumContent.albums || []).filter(
    (a) => a.kind === 'photography' && a.photos?.length
  );
}

function personOf(album) {
  return album.person || String(album.r2Prefix || '').replace(/^photography\//, '');
}

/** GALLERY 墙面入口顺序：好友按人轮转 → 群组 → ME 抽样（和 GalleryView 一致） */
function galleryWall() {
  const perFriend = friends
    .map((f) => (f.photos || []).map(srcOf).filter(Boolean));

  const out = [];
  for (let i = 0; out.length < MAX; i += 1) {
    let found = false;
    for (const list of perFriend) {
      if (list[i]) {
        out.push(list[i]);
        found = true;
      }
      if (out.length >= MAX) break;
    }
    if (!found) break;
  }

  if (out.length < MAX) {
    const group = (albumContent.albums || []).find((a) => a.r2Prefix === 'group_photos');
    out.push(...head((group?.photos || []).map(srcOf), MAX - out.length));
  }
  if (out.length < MAX) {
    out.push(...head(
      mePhotos
        .filter((_, i) => i % 11 === 0)
        .map((name) => mePhotoByName(name)?.src),
      MAX - out.length
    ));
  }
  return head(out);
}

/** ME 相册：当前选中月份（用户可能停在旧月份）里最新的那些 */
function meGalleryMonth() {
  const { activeMonth, photosOfMonth } = useMeGallery();
  return head(photosOfMonth(activeMonth.value).map((name) => mePhotoByName(name)?.src));
}

/**
 * 目标路由首屏会请求的图片地址。
 *
 * 没有图片的页面（LIFE / ME / ORGANIZATION / PROJECTION 标题卡）返回空数组，
 * 进度条会退化成"导航正在发生"的指示器 —— 这些页面的数据/画布在挂载后才开始，
 * 构建期无从得知，硬列清单反而会预取到错误的 URL。
 *
 * @param {import('vue-router').RouteLocationNormalized} to
 * @returns {string[]}
 */
export function routeAssets(to) {
  switch (to.name) {
    // 首页右侧展示的缩略图（首页通常是首屏导航，不会走到这里；
    // 从别处返回首页、或者直接深链到别的路由再回首页时才有意义）
    case 'home':
      return head([
        showcaseData.latestEcho?.image,
        showcaseData.latestPhotography?.image,
        ...showcaseData.selected.map((item) => item.image),
      ]);

    case 'echoes':
      return head(blogPosts.map((p) => srcOf(p.image)));

    case 'echo-detail': {
      const post = blogBySlug[to.params.slug];
      if (!post) return [];
      return head([srcOf(post.image), ...inlineImages(post.body)]);
    }

    case 'gallery':
      return galleryWall();

    case 'me-gallery':
      return meGalleryMonth();

    case 'photography':
      // 索引页每扇窗是相册封面
      return head(photographyAlbums().map((a) => {
        if (a.coverPhotoId) {
          const hit = (a.photos || []).find((p) => p.id === a.coverPhotoId);
          if (hit) return srcOf(hit);
        }
        return srcOf((a.photos || [])[0]);
      }));

    case 'photography-person': {
      const person = String(to.params.person || '');
      const album = photographyAlbums().find((a) => personOf(a) === person);
      return head((album?.photos || []).map(srcOf));
    }

    // home 的随机画廊要等组件挂载才知道抽了哪 12 张；LIFE 等页面没有图片；
    // PROJECTION 只有 134 MB 的片子，绝不能预取。
    default:
      return [];
  }
}
