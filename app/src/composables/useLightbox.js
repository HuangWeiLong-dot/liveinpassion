// 主灯箱（全局单例）。
// 迁移前它靠模块级的 currentGalleryData / currentIndex 两个裸变量工作：
// 画廊在构建时把列表塞进去，openLightbox(src) 只负责换图。
// 这里改成"谁打开谁把列表和起始索引传进来"，去掉了那份隐式全局状态。
//
// 保留的旧行为：
//   - lightboxImageLoading 期间忽略左右翻页（图没加载完就不响应）
//   - 翻页首尾环绕
//   - 打开时锁 body 滚动，关闭时恢复
//   - 取图优先 fullSrc，回退 src
import { ref, computed } from 'vue';

const items = ref([]);
const index = ref(0);
const isOpen = ref(false);
const isLoading = ref(false);

const currentItem = computed(() => items.value[index.value] || null);
const currentSrc = computed(() => {
  const item = currentItem.value;
  if (!item) return '';
  return item.fullSrc || item.src || '';
});

function resolve(url) {
  // 旧代码用 new URL(src, location.href) 解析；CDN 绝对地址下等价，保留以便相对路径也能工作
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

export function useLightbox() {
  function open(list, startIndex = 0) {
    items.value = Array.isArray(list) ? list : [];
    index.value = startIndex;
    isLoading.value = true;
    isOpen.value = true;
    document.body.style.overflow = 'hidden';
  }

  function close() {
    isOpen.value = false;
    isLoading.value = false;
    document.body.style.overflow = '';
  }

  function prev() {
    if (!items.value.length || isLoading.value) return;
    index.value = (index.value - 1 + items.value.length) % items.value.length;
    isLoading.value = true;
  }

  function next() {
    if (!items.value.length || isLoading.value) return;
    index.value = (index.value + 1) % items.value.length;
    isLoading.value = true;
  }

  // 由 <img> 的 load/error 调用
  function onImageSettled() {
    isLoading.value = false;
  }

  return { items, index, isOpen, isLoading, currentSrc, resolve, open, close, prev, next, onImageSettled };
}
