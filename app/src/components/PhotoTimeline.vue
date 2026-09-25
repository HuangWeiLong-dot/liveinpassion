<script setup>
// 时间线相册（旧 index.html 的 createGroupPhotosTimeline，L7306-L7435）。
// 群组照片页与所有好友详情页共用这一个组件——旧版也是同一个函数建两种页面。
//
// 结构照搬：年份分节（两侧分隔线 + 年份标题）→ 月份组（圆点标记 + "YYYY.MM" 标题 + 照片网格）。
// 两个容易漏的细节：
//   1. 分组键取自文件名的 YYYYMM；解析不出来的照片会被丢掉（旧版同样如此）
//   2. 点开灯箱时传的是**原始数组**与**原始下标**（originalIndex），不是分组后的顺序
//
// 图片加载：单级 + 按可见性加载（observeLazyImages）。旧版是构建完 50ms 后一次性
// forEach(loadImage) 全部发出（最多 33 张 → 33 个请求），这里改成进视口才请求。
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { observeLazyImages } from '../composables/useLazyImages.js';
import { useLightbox } from '../composables/useLightbox.js';

const props = defineProps({
  // 形如 generateGalleryData 的输出：{ id, filename, src, fullSrc }[]
  photos: { type: Array, required: true },
  // 旧版两个页面给容器的 id 不同（friendDetailGallery / groupphotosGalleryGrid），照搬
  containerId: { type: String, default: '' },
});

const { open } = useLightbox();

// 年份 → 月份 → 照片，并把原始下标与全局递增下标带上
const years = computed(() => {
  const grouped = {};
  props.photos.forEach((item, index) => {
    const match = item.filename.match(/(\d{4})(\d{2})(?:_(\d+))?/);
    if (!match) return;
    const key = `${match[1]}-${match[2]}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({ ...item, originalIndex: index });
  });

  const sortedKeys = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
  const yearGroups = {};
  sortedKeys.forEach((key) => {
    const year = key.split('-')[0];
    if (!yearGroups[year]) yearGroups[year] = [];
    yearGroups[year].push(key);
  });

  let globalIndex = 0;
  return Object.keys(yearGroups)
    .sort((a, b) => b.localeCompare(a))
    .map((year) => ({
      year,
      months: yearGroups[year].map((monthKey) => {
        const [, month] = monthKey.split('-');
        return {
          key: monthKey,
          label: `${year}.${month}`,
          photos: grouped[monthKey].map((photo) => ({ ...photo, globalIndex: globalIndex++ })),
        };
      }),
    }));
});

const rootRef = ref(null);
let observer = null;

function observeItems() {
  if (observer) observer.disconnect();
  nextTick(() => {
    // 时间线的项是 .timeline-photo-item（不是 .gallery-item），所以要按它自己的选择器观察
    observer = observeLazyImages('.timeline-photo-item');
  });
}

onMounted(observeItems);
watch(() => props.photos, observeItems);

function openPhoto(item) {
  // 旧版：currentGalleryData = 完整列表，currentIndex = 该项在原始列表里的下标
  open(props.photos, item.originalIndex);
}
</script>

<template>
  <div class="timeline-container" :id="containerId || null" ref="rootRef">
    <div v-for="yearBlock in years" :key="yearBlock.year" class="timeline-year">
      <div class="timeline-year-header">
        <div class="timeline-year-divider"></div>
        <h2 class="timeline-year-title">{{ yearBlock.year }}</h2>
        <div class="timeline-year-divider"></div>
      </div>

      <div v-for="month in yearBlock.months" :key="month.key" class="timeline-month-group">
        <div class="timeline-month-marker"></div>
        <div class="timeline-month-content">
          <h3 class="timeline-month-title">{{ month.label }}</h3>
          <div class="timeline-photo-grid">
            <div v-for="photo in month.photos" :key="photo.filename" class="timeline-photo-item" @click="openPhoto(photo)">
              <div class="skeleton-loader"></div>
              <!-- 单级加载：只给原图；data-index 会被 loadImage 用来生成 alt -->
              <img :data-full-src="photo.fullSrc" :data-index="photo.globalIndex" alt="" class="blur-placeholder">
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
