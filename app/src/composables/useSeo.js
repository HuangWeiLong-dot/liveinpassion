// 全站 SEO：路由切换时同步 <head> 里的 title / description / canonical / Open Graph /
// Twitter Card / JSON-LD。站点是单页应用，静态 head 只是首屏兜底，真正的元数据由这里按路由写。
// 元数据怎么算在 src/seo/meta.js（构建脚本也用同一份，保证静态页和运行时一致）。
//
// 约定：
//  · 所有 meta 都走 upsert，路由来回切换不会叠加重复标签。
//  · canonical 只取 path，忽略 ?view=corner 这类查询参数，避免同一内容被算成两个 URL。
//  · JSON-LD 固定复用 <script id="seo-jsonld">，index.html 里已预置一份首页版本。

import { blogPosts } from '../data/blogPosts.js';
import albumContent from '../data/content/albums.json';
import { AUTHOR, SITE, resolveSeo } from '../seo/meta.js';

const albums = albumContent?.albums || [];

function upsertMeta(key, content, property = false) {
  if (!content) return;
  const attr = property ? 'property' : 'name';
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function setJsonLd(data) {
  let el = document.head.querySelector('script#seo-jsonld');
  if (!el) {
    el = document.createElement('script');
    el.id = 'seo-jsonld';
    el.type = 'application/ld+json';
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

function apply(route) {
  const meta = resolveSeo(route.name, route.params, blogPosts, albums);

  document.title = meta.title;
  upsertMeta('description', meta.description);
  upsertMeta('robots', meta.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large');
  upsertMeta('theme-color', '#050505');

  upsertLink('canonical', meta.url);
  upsertLink('sitemap', `${SITE}/sitemap.xml`);

  const ogType = meta.type || 'website';
  upsertMeta('og:type', ogType, true);
  upsertMeta('og:title', meta.title, true);
  upsertMeta('og:description', meta.description, true);
  upsertMeta('og:url', meta.url, true);
  upsertMeta('og:image', meta.image, true);

  // 非文章页把上一页留下的文章时间清掉，避免分享卡片显示错的日期
  const publishedEl = document.head.querySelector('meta[property="article:published_time"]');
  if (ogType === 'article' && meta.published) {
    upsertMeta('article:published_time', meta.published, true);
    upsertMeta('article:author', AUTHOR, true);
  } else if (publishedEl) {
    publishedEl.remove();
    document.head.querySelector('meta[property="article:author"]')?.remove();
  }

  upsertMeta('twitter:card', 'summary_large_image');
  upsertMeta('twitter:site', '@HuangWeiLong525');
  upsertMeta('twitter:title', meta.title);
  upsertMeta('twitter:description', meta.description);
  upsertMeta('twitter:image', meta.image);

  setJsonLd(meta.jsonLd);
}

export function installSeo(router) {
  router.afterEach((to) => apply(to));
  apply(router.currentRoute.value);
}
