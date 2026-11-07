// 首页右侧展示（Home Showcase）的构建期快照。
//
// 数据由 scripts/fetch-content.mjs 从 Worker 的 /api/showcase 拉取后写入
// content/showcase.json；CMS 保存后会触发 repository_dispatch 重新构建。
// 快照缺失时整块展示不渲染 —— 不要在这里编造条目。
import content from './content/showcase.json';

const raw = content && typeof content === 'object' ? content : {};
const selected = Array.isArray(raw.selected) ? raw.selected : [];

export const showcaseData = {
  latestEcho: raw.latestEcho || null,
  latestPhotography: raw.latestPhotography || null,
  limits: {
    echo: 4,
    photography: 3,
    film: 2,
    ...(raw.limits || {}),
  },
  selected,
};

export function hasShowcase() {
  return Boolean(
    showcaseData.latestEcho
    || showcaseData.latestPhotography
    || showcaseData.selected.length
  );
}
