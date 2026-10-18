<script setup>
// ME 相册页。视觉与 /gallery 共用同一套「窗户墙」（styles/window-wall.css）：
//   - 浅灰/深色底 + 蓝色视口框
//   - 月份照片散落在窗户网格里，其余是空窗格
//   - 底部是月份筛选 + 统计
// 点击窗户仍然打开原来的单图灯箱（MePhotoLightbox）。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { CDN_BASE } from '../data/cdn.js';
import { mePhotoByName } from '../data/mePhotos.js';
import { extractDateFromFilename, useMeGallery } from '../composables/useMeGallery.js';
import { clearBlockCursorHot, setBlockCursorHot } from '../composables/useBlockCursor.js';
import { thumbUrl } from '../composables/useThumbnails.js';
import {
  fadeWallImages,
  playWallIntro,
  restoreWallImages,
  staggerWallReveal,
} from '../composables/useWallMotion.js';
import { resetWall, shuffleWall } from '../composables/useWallPuzzle.js';
import { useBrandOverlay } from '../composables/useBrandOverlay.js';
import MePhotoLightbox from '../components/MePhotoLightbox.vue';

const router = useRouter();
const { monthKeys, activeMonth, photosOfMonth } = useMeGallery();
// 墙上真正显示的月份：等旧图淡出之后才切过去，避免切换瞬间直接换图
const displayMonth = ref(activeMonth.value);
const { entered: brandEntered } = useBrandOverlay();

let introPlayed = false;
let introTimer = 0;
let prefetchTimer = 0;
let resizeTimer = 0;
function onWallResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => resetWall(wallRef.value), 180);
}
function scheduleIntro() {
  if (introPlayed) return;
  introPlayed = true;
  clearTimeout(introTimer);
  introTimer = setTimeout(() => playWallIntro(wallRef.value), 1400);
}

const items = computed(() =>
  photosOfMonth(displayMonth.value).map((filename) => {
    // URL 优先取 API 的 hash 路径（新上传照片 key 不再是扁平原名），旧拼法兜底
    const urls = mePhotoByName(filename) || {};
    return {
      filename,
      date: extractDateFromFilename(filename),
      thumb: urls.src || `${CDN_BASE}/Me/compressed_me/${filename}`,
      full: urls.fullSrc || `${CDN_BASE}/Me/${filename}`,
    };
  })
);

// ── 散点布局 ────────────────────────────────────────────────────────────
// 每个月用自己的种子：切月份会换一个摆法，但同一个月来回切是稳定的。
function mulberry32(a) {
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WALL_GAPS = 6;
const wallLayout = computed(() => {
  const list = items.value;
  // 至少 6 行（16 列），小月份也把墙面撑起来；多出来的都是普通空窗格。
  const count = Math.max(96, Math.ceil((list.length + 24) / 16) * 16);
  const order = [...Array(count).keys()];
  const random = mulberry32(0x5eed1234);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const bySlot = new Map();
  order.forEach((slot, i) => {
    if (list[i]) bySlot.set(slot, list[i]);
  });
  const slots = Array.from({ length: count }, (_, i) => bySlot.get(i) || null);
  // 普通空槽还是空窗格；从它们里面等距挖几个完全不可见的洞。
  // 只有这些洞是华容道的移动空间。
  const empty = [];
  for (let i = 0; i < count; i += 1) if (!slots[i]) empty.push(i);
  const n = Math.min(WALL_GAPS, empty.length);
  const gaps = new Set();
  for (let i = 0; i < n; i += 1) {
    gaps.add(empty[Math.floor(((i + 0.5) * empty.length) / n)]);
  }
  return { slots, gaps };
});
const slots = computed(() => wallLayout.value.slots);
const gapSlots = computed(() => wallLayout.value.gaps);

const statsText = computed(
  () => `${items.value.length} windows · ${activeMonth.value} · ${monthKeys.length} months`
);

const loadedSrcs = ref(new Set());
function onImgLoad(item) {
  if (!item?.thumb) return;
  loadedSrcs.value = new Set(loadedSrcs.value).add(item.thumb);
}

// ── 指针提示 / 方块光标 ─────────────────────────────────────────────────
const tipEl = ref(null);
const wallRef = ref(null);
let wallIo = null;

// 只给接近视口的窗格挂 src，避免一次解码整月的照片
function observeWallImages() {
  wallIo?.disconnect();
  const wall = wallRef.value;
  if (!wall) return;
  const imgs = [...wall.querySelectorAll('.win__img')];
  for (const img of imgs) {
    if (img.dataset.src && img.dataset.thumbFor !== img.dataset.src) {
      img.removeAttribute('src');
      delete img.dataset.thumbFor;
    }
  }
  const applyThumb = (img) => {
    const src = img.dataset.src;
    if (!src) return;
    thumbUrl(src, 200).then((url) => {
      if (url && img.dataset.src === src) {
        img.dataset.thumbFor = src;
        img.src = url;
      }
    });
  };
  if (!('IntersectionObserver' in window)) {
    for (const img of imgs) applyThumb(img);
    return;
  }
  wallIo = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const img = entry.target;
      if (img.dataset.src && !img.getAttribute('src')) applyThumb(img);
      wallIo.unobserve(img);
    }
  }, { rootMargin: '300px 0px' });
  for (const img of imgs) if (img.dataset.src) wallIo.observe(img);
}
const tip = ref({ visible: false, kicker: '', title: '' });
const finePointer = ref(false);

function moveTip(event) {
  const el = tipEl.value;
  if (!el || !tip.value.visible) return;
  const x = Math.min(event.clientX + 14, window.innerWidth - 180);
  const y = Math.min(event.clientY + 16, window.innerHeight - 54);
  el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}

function showTip(item, event) {
  if (!finePointer.value) return;
  tip.value = { visible: true, kicker: 'ME', title: item.date || item.filename };
  moveTip(event);
}

function hideTip() {
  tip.value.visible = false;
}

function enterWindow(item, event) {
  setBlockCursorHot(event.currentTarget, true);
  showTip(item, event);
}

function leaveWindow() {
  clearBlockCursorHot();
  hideTip();
}

function setMonth(ym) {
  if (activeMonth.value === ym) return;
  activeMonth.value = ym;
  clearBlockCursorHot();
  hideTip();
}

watch(activeMonth, async () => {
  clearBlockCursorHot();
  hideTip();
  // 窗户从真正的空洞里滑过去（华容道）
  await shuffleWall(wallRef.value);
  const wall = wallRef.value;
  // 旧月份先淡出，再换内容：避免滑完后一刀切
  await fadeWallImages(wall);
  displayMonth.value = activeMonth.value;
  await nextTick();
  if (wall) {
    // 先排好延迟再撤掉淡出用内联样式：撤掉的那一刻才会开始淡入。
    // 新照片是异步加载的，哪张先到哪张先淡入，但整体按落点顺序铺开。
    staggerWallReveal(wall, () => true);
    restoreWallImages(wall);
    for (const el of wall.querySelectorAll('.win--filled')) el.style.opacity = '1';
  }
  observeWallImages();
});

onMounted(() => {
  finePointer.value = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  nextTick(observeWallImages);
  window.addEventListener('resize', onWallResize);
  if (brandEntered.value) scheduleIntro();
  prefetchTimer = setTimeout(() => {
    for (const it of items.value) if (it.thumb) thumbUrl(it.thumb, 200);
  }, 2600);
});

watch(brandEntered, (v) => {
  if (v) scheduleIntro();
});

onBeforeUnmount(() => {
  clearBlockCursorHot();
  wallIo?.disconnect();
  window.removeEventListener('resize', onWallResize);
  clearTimeout(introTimer);
  clearTimeout(prefetchTimer);
  clearTimeout(resizeTimer);
});

// ── 单图灯箱 ────────────────────────────────────────────────────────────
const lightboxOpen = ref(false);
const lightboxSrc = ref('');
const lightboxThumb = ref('');
function openPhoto(item) {
  hideTip();
  // 灯箱主图用压缩图（原图太大，切换时容易停在上一张）；
  // 先挂 200px 缩略图做模糊占位，主图载入后由组件无缝替换。
  lightboxSrc.value = item.thumb;
  lightboxThumb.value = '';
  lightboxOpen.value = true;
  thumbUrl(item.thumb, 200).then((url) => {
    if (lightboxOpen.value && lightboxSrc.value === item.thumb) {
      lightboxThumb.value = url;
    }
  });
}
</script>

<template>
  <main class="page active">
    <section class="win-page">
      <div class="win-inner">
        <div class="win-header">
          <button class="win-header__side" type="button" @click="router.push('/me')">me</button>
          <h1 class="win-header__title">MY GALLERY</h1>
          <button class="win-header__side win-header__side--end" type="button" @click="router.push('/gallery')">gallery ↗</button>
        </div>

        <div ref="wallRef" class="win-wall" @pointermove.passive="moveTip">
          <!-- 有照片的槽位保持同一个 <button>（月份切换时只换内容，translate
               记录的华容道位置才不会跳）；空槽平时是空窗格，挑出来的几个
               是完全不可见的洞（.win-gap），只有它们能参与滑动。 -->
          <template v-for="(item, index) in slots" :key="index">
            <div
              v-if="!item"
              :class="gapSlots.has(index) ? 'win-gap' : 'win win--empty'"
              :data-slot="index"
              :style="{ '--win-i': index }"
              aria-hidden="true"
            />
            <button
              v-else
              class="win win--filled"
              :data-slot="index"
              :style="{ '--win-i': index }"
              type="button"
              :aria-label="`ME: ${item.date || item.filename}`"
              @click="openPhoto(item)"
              @pointerenter="enterWindow(item, $event)"
              @pointerleave="leaveWindow()"
            >
              <img
                class="win__img"
                :class="{ 'is-on': true, 'is-loaded': loadedSrcs.has(item.thumb) }"
                :data-src="item.thumb"
                :data-photo="item.thumb"
                :alt="item.filename"
                decoding="async"
                draggable="false"
                @load="onImgLoad(item)"
              >
            </button>
          </template>
        </div>
      </div>

      <div class="win-dock">
        <span class="win-stats" aria-live="polite">{{ statsText }}</span>
        <div class="win-months">
          <button
            v-for="ym in monthKeys"
            :key="ym"
            class="win-filter"
            :class="{ active: activeMonth === ym }"
            :aria-pressed="activeMonth === ym"
            type="button"
            @click="setMonth(ym)"
          >
            {{ ym }}
          </button>
        </div>
      </div>

      <div ref="tipEl" class="win-tip" :class="{ visible: tip.visible }" aria-hidden="true">
        <span class="win-tip__kicker">{{ tip.kicker }}</span>
        <span class="win-tip__title">{{ tip.title }}</span>
      </div>
    </section>

    <MePhotoLightbox
      :visible="lightboxOpen"
      :src="lightboxSrc"
      :thumb="lightboxThumb"
      @close="lightboxOpen = false"
    />
  </main>
</template>
