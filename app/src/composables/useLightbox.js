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
// 打开它的那个窗口矩形（照片飞行过渡的起点）；外部直接 open 时可以为空
const origin = ref(null);
// GALLERY 的底部胶卷条是否在场。灯箱在详情页里仍然露着这条底栏，
// 所以要按它的高度给舞台让位（见 Lightbox.vue 的 stripReserve）。
const stripVisible = ref(false);

const currentItem = computed(() => items.value[index.value] || null);
const currentSrc = computed(() => {
  const item = currentItem.value;
  if (!item) return '';
  // 优先压缩图：原图往往是 3071px 以上的大文件，切换照片时要等很久才换过来，
  // 看起来就像“还停在上一次点击的那张”。压缩图足够灯箱尺寸，也能秒切。
  return item.src || item.fullSrc || '';
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
  function open(list, startIndex = 0, from = null) {
    items.value = Array.isArray(list) ? list : [];
    index.value = startIndex;
    isLoading.value = true;
    isOpen.value = true;
    origin.value = from && from.rect
      ? { rect: { ...from.rect }, src: from.src || '', aspect: from.aspect || 0 }
      : null;
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

  // 由 GALLERY 在激活/离开时调用
  function setStripVisible(value) {
    stripVisible.value = Boolean(value);
  }

  return { items, index, isOpen, isLoading, currentItem, currentSrc, origin, stripVisible, setStripVisible, resolve, open, close, prev, next, onImageSettled };
}
