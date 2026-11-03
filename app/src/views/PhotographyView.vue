<script setup>
// PHOTOGRAPHY：按人名分组的摄影作品，沿用 GALLERY 的「窗户墙」。
//   /photography           —— 人名索引，每个 photography 相册占一扇窗
//   /photography/:person   —— 某个人名下的整组照片，散落在同一面窗户墙里
//
// 窗户墙的入场（useWallEntry）、悬停倾斜（useCardFx）、行军蚁描边、
// 空窗格 / 不可见洞都来自 GALLERY 那套，只把网格调宽一点（照片是 4:3 横图）。
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import albumContent from '../data/content/albums.json';
import { photoDate } from '../data/photoUtils.js';
import { thumbUrl } from '../composables/useThumbnails.js';
import { useLightbox } from '../composables/useLightbox.js';
import { createWallEntry } from '../composables/useWallEntry.js';
import { resetWall } from '../composables/useWallPuzzle.js';
import { attachCardTilt, playGlitchReveal } from '../composables/useCardFx.js';
import { clearBlockCursorHot, setBlockCursorHot } from '../composables/useBlockCursor.js';
import { useBrandOverlay } from '../composables/useBrandOverlay.js';

const route = useRoute();
const router = useRouter();
const { open: openLightbox } = useLightbox();
const { entered: brandEntered } = useBrandOverlay();

const albums = computed(() =>
  (albumContent.albums || []).filter((a) => a.kind === 'photography' && a.photos?.length)
);

function albumPerson(album) {
  return album.person || String(album.r2Prefix || '').replace(/^photography\//, '');
}

const activePerson = computed(() => String(route.params.person || ''));
const activeAlbum = computed(() =>
  albums.value.find((a) => albumPerson(a) === activePerson.value)
);

const isDetail = computed(() => Boolean(activePerson.value));
const title = computed(() =>
  isDetail.value ? (activeAlbum.value?.name || activePerson.value) : 'PHOTOGRAPHY'
);

const detailPhotos = computed(() => {
  const album = activeAlbum.value;
  if (!album) return [];
  return album.photos.map((p, i) => ({
    filename: p.filename,
    src: p.src,
    fullSrc: p.fullSrc,
    date: photoDate(p.filename),
    index: i,
  }));
});

function coverOf(album) {
  if (album.coverPhotoId) {
    const hit = album.photos.find((p) => p.id === album.coverPhotoId);
    if (hit) return hit;
  }
  return album.photos[0] || null;
}

// ── 墙上的内容 ──────────────────────────────────────────────────────────
// 索引页每扇窗是一个人；详情页每扇窗是一张照片。
const wallItems = computed(() => {
  if (isDetail.value) {
    return detailPhotos.value.map((p) => ({
      kind: 'photo',
      key: `p${p.index}`,
      title: p.date || p.filename,
      kicker: 'PHOTO',
      src: p.src,
      photoIndex: p.index,
    }));
  }
  return albums.value.map((album) => {
    const cover = coverOf(album);
    return {
      kind: 'album',
      key: `a${album.id}`,
      title: album.name,
      kicker: 'PHOTOGRAPHY',
      src: cover?.src || '',
      count: album.photos.length,
      album,
    };
  });
});

const slotCount = computed(() => (
  isDetail.value
    ? Math.max(24, wallItems.value.length + 10)
    : Math.max(16, wallItems.value.length + 12)
));

const WALL_GAPS = 3;

function mulberry32(a) {
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 每个槽位固定一个打乱后的位置：切换内容时窗户不会整面重排。
const slotOrder = computed(() => {
  const count = slotCount.value;
  const arr = [...Array(count).keys()];
  const random = mulberry32(0x5eed1234 + count);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
});

const slots = computed(() => {
  const bySlot = new Map();
  wallItems.value.forEach((item, i) => bySlot.set(slotOrder.value[i], item));
  return Array.from({ length: slotCount.value }, (_, i) => bySlot.get(i) || null);
});

const gapSlots = computed(() => {
  const empty = [];
  for (let i = 0; i < slotCount.value; i += 1) if (!slots.value[i]) empty.push(i);
  const n = Math.min(WALL_GAPS, empty.length);
  const out = new Set();
  for (let i = 0; i < n; i += 1) {
    out.add(empty[Math.floor(((i + 0.5) * empty.length) / n)]);
  }
  return out;
});

const wallVisible = computed(() => wallItems.value.length > 0);

// ── 缩略图 ──────────────────────────────────────────────────────────────
// 压缩图本身仍有 3000px 宽，直接铺墙会同时解码十几张 9MP 位图。
const thumbs = ref({});
const coverThumbs = ref({});
const loadedSrcs = ref(new Set());

function markLoaded(src) {
  if (!src || loadedSrcs.value.has(src)) return;
  const next = new Set(loadedSrcs.value);
  next.add(src);
  loadedSrcs.value = next;
}

function ensureThumb(map, src, width) {
  if (!src || map.value[src]) return;
  thumbUrl(src, width).then((url) => {
    if (url) map.value = { ...map.value, [src]: url };
  });
}

function prepareImages() {
  if (isDetail.value) {
    for (const p of detailPhotos.value) ensureThumb(thumbs, p.src, 360);
  } else {
    for (const a of albums.value) {
      const cover = coverOf(a);
      if (cover) ensureThumb(coverThumbs, cover.src, 800);
    }
  }
}

function thumbFor(item) {
  return item.kind === 'album' ? (coverThumbs.value[item.src] || null) : (thumbs.value[item.src] || null);
}

function onImgLoad(item, event) {
  markLoaded(item.src);
  const img = event?.target;
  if (img) playGlitchReveal(img, img.closest('.win--filled'));
}

// ── 指针提示 ────────────────────────────────────────────────────────────
const tipEl = ref(null);
const wallRef = ref(null);
const tip = ref({ visible: false, kicker: '', title: '' });
const finePointer = ref(false);
let tipRaf = 0;
let tipX = 0;
let tipY = 0;

function moveTip(event) {
  if (!tip.value.visible) return;
  tipX = Math.min(event.clientX + 14, window.innerWidth - 180);
  tipY = Math.min(event.clientY + 16, window.innerHeight - 54);
  if (tipRaf) return;
  tipRaf = requestAnimationFrame(() => {
    tipRaf = 0;
    const el = tipEl.value;
    if (!el || !tip.value.visible) return;
    el.style.transform = `translate3d(${tipX}px, ${tipY}px, 0)`;
  });
}

function showTip(item, event) {
  if (!finePointer.value) return;
  tip.value = { visible: true, kicker: item.kicker, title: item.title };
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

// ── 打开 ────────────────────────────────────────────────────────────────
function openPhoto(index) {
  const list = detailPhotos.value.map(({ filename, src, fullSrc, date }) => ({
    filename, src, fullSrc, date,
  }));
  if (!list[index]) return;
  openLightbox(list, index);
}

function openWindow(item) {
  hideTip();
  clearBlockCursorHot();
  if (item.kind === 'album') {
    router.push({ name: 'photography-person', params: { person: albumPerson(item.album) } });
    return;
  }
  openPhoto(item.photoIndex);
}

// ── 首屏入场（和 GALLERY 一致）─────────────────────────────────────────
const wallEntry = createWallEntry();
let introPlayed = false;
let introTimer = 0;
let resizeTimer = 0;
let detachTilt = null;

function scheduleIntro() {
  if (introPlayed) return;
  introPlayed = true;
  clearTimeout(introTimer);
  introTimer = setTimeout(() => {
    wallEntry.reset(wallRef.value);
    wallEntry.prime(wallRef.value);
    wallEntry.play(wallRef.value);
  }, 1400);
}

function onWallResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => resetWall(wallRef.value), 180);
}

function restartWall() {
  clearTimeout(introTimer);
  introPlayed = false;
  wallEntry.reset(wallRef.value);
  nextTick(() => {
    requestAnimationFrame(() => {
      wallEntry.prime(wallRef.value);
    });
  });
  if (brandEntered.value) scheduleIntro();
}

// 索引 ↔ 详情是同一个组件实例（keep-alive 不按 fullPath 重建），
// 墙的内容换了要重新准备缩略图、重播入场。
watch([isDetail, activePerson], () => {
  prepareImages();
  restartWall();
});

watch(brandEntered, (v) => {
  if (v) scheduleIntro();
});

onMounted(() => {
  finePointer.value = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  prepareImages();
  detachTilt = attachCardTilt(wallRef.value);
  window.addEventListener('resize', onWallResize);
});

onActivated(() => {
  prepareImages();
  restartWall();
});

onDeactivated(() => {
  // 和 GALLERY 一样：只停计时器，别在转场板还盖着的时候重置整面墙
  clearTimeout(introTimer);
});

onBeforeUnmount(() => {
  clearBlockCursorHot();
  window.removeEventListener('resize', onWallResize);
  clearTimeout(introTimer);
  clearTimeout(resizeTimer);
  cancelAnimationFrame(tipRaf);
  wallEntry.reset(wallRef.value);
  detachTilt?.();
});
</script>

<template>
  <main class="page active">
    <section class="win-page">
      <div class="win-inner">
        <div class="win-header">
          <button
            v-if="isDetail"
            class="win-header__side"
            type="button"
            @click="router.push({ name: 'photography' })"
          >← photography</button>
          <button
            v-else
            class="win-header__side"
            type="button"
            @click="router.push('/gallery')"
          >gallery ↗</button>

          <h1 class="win-header__title">{{ title }}</h1>

          <span class="win-header__side win-header__side--end ph-count">
            {{ isDetail ? `${detailPhotos.length} photos` : `${albums.length} ${albums.length === 1 ? 'person' : 'people'}` }}
          </span>
        </div>

        <!-- 窗户墙：索引页一扇窗一个人，详情页一扇窗一张照片 -->
        <div
          v-if="wallVisible"
          ref="wallRef"
          class="win-wall ph-wall"
          @pointermove.passive="moveTip"
        >
          <template v-for="(item, index) in slots" :key="index">
            <div
              v-if="!item"
              :class="gapSlots.has(index) ? 'win-gap' : 'win win--empty ph-empty-window'"
              :data-slot="index"
              :style="{ '--win-i': index }"
              aria-hidden="true"
            />
            <button
              v-else
              class="win win--filled ph-window"
              :data-slot="index"
              :style="{ '--win-i': index }"
              type="button"
              :aria-label="item.kind === 'album' ? `${item.title} · ${item.count} photos` : item.title"
              @click="openWindow(item)"
              @pointerenter="enterWindow(item, $event)"
              @pointerleave="leaveWindow"
            >
              <img
                class="win__img"
                :class="{ 'is-on': true, 'is-loaded': loadedSrcs.has(item.src) }"
                :src="thumbFor(item)"
                :alt="item.kind === 'album'
                  ? `${item.title} — photography album, ${item.count} photos`
                  : `${activePerson} — photograph ${item.title}`"
                decoding="async"
                draggable="false"
                @load="onImgLoad(item, $event)"
              >
              <span class="ph-window__label">
                <span class="ph-window__name">{{ item.title }}</span>
                <span v-if="item.kind === 'album'" class="ph-window__count">{{ item.count }} PHOTOS</span>
              </span>
            </button>
          </template>
        </div>

        <div v-else-if="isDetail" class="ph-empty">
          <span class="ph-empty__en">Not Found</span>
          <span class="ph-empty__cn">No photography album for “{{ activePerson }}”</span>
          <button class="ph-empty__back" type="button" @click="router.push({ name: 'photography' })">
            ← back to photography
          </button>
        </div>

        <div v-else class="ph-empty">
          <span class="ph-empty__en">No Photography Yet</span>
          <span class="ph-empty__cn">Upload photos in CMS under the Photography kind</span>
        </div>
      </div>

      <div ref="tipEl" class="win-tip" :class="{ visible: tip.visible }" aria-hidden="true">
        <span class="win-tip__kicker">{{ tip.kicker }}</span>
        <span class="win-tip__title">{{ tip.title }}</span>
      </div>
    </section>
  </main>
</template>

<style scoped>
.ph-count {
  text-align: right;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

/* GALLERY 是 16 列（照片多、窗格小）；摄影是 4:3 横图，列数放宽一些。 */
.win-wall.ph-wall {
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 14px;
}

/* 4:3 横窗，不用默认的 3:4 竖窗 */
.win-wall.ph-wall .win,
.win-wall.ph-wall .win--empty,
.win-wall.ph-wall .win-gap {
  aspect-ratio: 4 / 3;
}

.ph-window__label {
  position: absolute;
  left: 3px;
  bottom: 3px;
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 7px;
  background: var(--bg);
  color: var(--text-primary);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}

.ph-window:hover .ph-window__label {
  opacity: 1;
}

.ph-window__name {
  font-family: 'Oswald', sans-serif;
  font-weight: 600;
  font-size: 0.86rem;
  line-height: 1;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.ph-window__count {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
}

/* 触屏没有 hover：名字常显，否则点进去之前不知道这是谁 */
@media (hover: none) {
  .ph-window__label { opacity: 1; }
}

/* ── 空状态 ───────────────────────────────────────────────────────────── */
.ph-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 120px 16px;
  text-align: center;
}

.ph-empty__en {
  font-family: 'Oswald', sans-serif;
  font-size: 1.3rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.ph-empty__cn {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.ph-empty__back {
  margin-top: 10px;
  border: 0;
  background: none;
  color: var(--text-primary);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.12em;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 4px;
}

/* ── 响应式：列数逐档收窄，保证 4:3 窗格还能看清 ───────────────────── */
@media (max-width: 1100px) {
  .win-wall.ph-wall {
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 12px;
  }
}

@media (max-width: 900px) {
  .win-wall.ph-wall {
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 10px;
  }
}

@media (max-width: 700px) {
  .win-wall.ph-wall {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
  }
}

@media (max-width: 520px) {
  .win-wall.ph-wall {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .win-page { padding: 96px 14px 190px; }
  .win-header { gap: 10px; margin-bottom: 24px; }
  .win-header__title { font-size: 1.45rem; }
  .ph-count { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .ph-window__label { transition: none; }
}
</style>
