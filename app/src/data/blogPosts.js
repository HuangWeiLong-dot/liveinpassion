// 博客数据：读取构建期从 CMS API 拉取的快照（content/blogPosts.json）。
// 快照由 scripts/fetch-content.mjs 在构建前生成，仓库内保留最近一次成功版本作为兜底。

import content from './content/blogPosts.json';

const posts = (content && Array.isArray(content.posts)) ? content.posts : [];

export const blogPosts = posts;
export const blogBySlug = Object.fromEntries(posts.map((p) => [p.slug, p]));
