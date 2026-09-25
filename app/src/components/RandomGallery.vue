<script setup>
// 首页随机画廊（旧 index.html L7780-L7926 的 createHomeGallery）。
// 行为要点：每次页面加载只随机一次（12 张 ME 照 + 2 张群组照 → 打乱 → 套用随机布局），
// 之后不再变化；配合 KeepAlive，从其它页面返回时布局与图片都保持原样。
//
// 两个必须遵守的约束：
//  1. .gallery-item 上有 :class / :style 绑定，所以这个组件挂载后**不能重渲染**——
//     一旦重渲染，Vue 会重算 className，抹掉图片管线加的 .has-image/.wide/.tall。
//     做法是只从 useLightbox() 取函数、不消费其响应式状态，并且 items 用普通数组。
//  2. 图片仍是 data-src / data-full-src 驱动，交给 loadImage()，不改成响应式绑定。
import { onMounted, ref } from 'vue';
import { mePhotos } from '../data/mePhotos.js';
import { groupPhotosGalleryData } from '../data/galleries.js';
import { homeLayouts } from '../data/homeLayouts.js';
import { CDN_BASE } from '../data/cdn.js';
import { useLightbox } from '../composables/useLightbox.js';
import { loadImagesBatched } from '../composables/useImageLoader.js';
import { observeGalleryItems } from '../composables/useGalleryObserver.js';

const { open } = useLightbox();

function buildItems() {
  const mePool = mePhotos.map((name) => ({
    id: 'me-' + name,
    src: `${CDN_BASE}/Me/compressed_me/${name}`,
    fullSrc: `${CDN_BASE}/Me/${name}`,
  }));
  const groupPool = groupPhotosGalleryData.map((p) => ({ id: p.id, src: p.src, fullSrc: p.fullSrc }));

  // 各自随机后取 12 + 2，再混合打乱，保证 ME 与群组交错分布
  const mePicked = [...mePool].sort(() => Math.random() - 0.5).slice(0, 12);
  const groupPicked = [...groupPool].sort(() => Math.random() - 0.5).slice(0, 2);
  const shuffled = [...mePicked, ...groupPicked].sort(() => Math.random() - 0.5);

  const layout = homeLayouts[Math.floor(Math.random() * homeLayouts.length)];
  const count = Math.min(layout.length, shuffled.length);

  return shuffled.slice(0, count).map((item, index) => {
    const pos = layout[index];
    return {
      ...item,
      // 旧版只给 wide / big 加类，normal 不加
      layoutClass: pos.layout === 'normal' ? '' : pos.layout,
      gridColumn: pos.layout === 'wide' || pos.layout === 'big' ? `${pos.col} / span 2` : String(pos.col),
      gridRow: pos.layout === 'big' ? `${pos.row} / span 2` : String(pos.row),
    };
  });
}

const items = buildItems();
const gridEl = ref(null);

onMounted(() => {
  observeGalleryItems();
  // 分批加载（每帧 4 张），避免十几张并发请求卡住首屏
  loadImagesBatched(Array.from(gridEl.value.querySelectorAll('img')));
});

function onItemClick(index) {
  // 旧版把列表塞进全局的 currentGalleryData 再调 openLightbox；
  // 新版直接把列表和起始索引交给灯箱
  open(items, index);
}
</script>

<template>
  <section class="gallery-section" id="gallery">
    <div class="section-header">
      <h2 class="section-title">Random</h2>
      <span class="section-count">{{ items.length }} Images</span>
    </div>
    <div class="gallery-grid" id="galleryGrid" ref="gridEl">
      <div
        v-for="(item, index) in items"
        :key="item.id"
        class="gallery-item"
        :class="item.layoutClass"
        :style="{ gridColumn: item.gridColumn, gridRow: item.gridRow }"
        @click="onItemClick(index)"
      >
        <div class="skeleton-loader"></div>
        <!-- 单级加载：只给原图地址，不再挂压缩图 -->
        <img :data-full-src="item.fullSrc" :data-index="index" alt="" class="blur-placeholder">
      </div>
    </div>
  </section>
</template>
