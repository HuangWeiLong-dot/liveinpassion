<script setup>
// GALLERY 页。视觉参考 wndws.space：
//   - 浅灰底 + 蓝色视口外框
//   - 大片「窗户」网格：一部分装着照片，其余是空窗格
//   - 衬线字标、底部统计 / 筛选胶囊、指针旁的名字提示
//
// 数据：好友照片 + 群组照片 + ME 相册。群组页与个人相册都已并入 Gallery：
//   好友 → 个人相册灯箱；群组 → 群组照片灯箱；ME → /me/gallery
//
// 网格是确定性的：槽位打乱用固定种子，筛选只改变「哪些槽位装图」，
// 所以来回切换不会让整面墙重新洗牌。
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { clearBlockCursorHot, setBlockCursorHot } from '../composables/useBlockCursor.js';
import { thumbUrl } from '../composables/useThumbnails.js';
import { scrollHorizontallyOnWheel } from '../composables/useWheelScroll.js';
import { useLightbox } from '../composables/useLightbox.js';
import { staggerWallReveal } from '../composables/useWallMotion.js';
import { createWallEntry } from '../composables/useWallEntry.js';
import { attachCardTilt, playGlitchReveal } from '../composables/useCardFx.js';
import { resetWall, shuffleWall } from '../composables/useWallPuzzle.js';
import { useBrandOverlay } from '../composables/useBrandOverlay.js';
import { friends } from '../data/friends.js';
import { mePhotos, mePhotoByName } from '../data/mePhotos.js';
import { photoDate } from '../data/photoUtils.js';
import albumContent from '../data/content/albums.json';

const route = useRoute();
const router = useRouter();
// 灯箱的当前照片也取同一份单例状态：底部胶卷条据此高亮当前那张
const {
  open: openLightbox,
  isOpen: lightboxOpen,
  items: lightboxItems,
  index: lightboxIndex,
  close: closeLightbox,
  setStripVisible,
} = useLightbox();
const { entered: brandEntered } = useBrandOverlay();

let introPlayed = false;
let introTimer = 0;
let prefetchTimer = 0;
let resizeTimer = 0;
let stripTimer = 0;
let detachTilt = null;

// 首屏入场（参照 wndws.space）：每次进入这个页面都重播一次
const wallEntry = createWallEntry();

function scheduleIntro() {
  if (introPlayed) return;
  introPlayed = true;
  clearTimeout(introTimer);
  introTimer = setTimeout(() => {
    // 真正开演前再按当前布局/字体/滚动量一次，保证焦点窗在屏幕正中
    wallEntry.reset(wallRef.value);
    wallEntry.prime(wallRef.value);
    wallEntry.play(wallRef.value);
  }, 1400);
}

// 位移是 px 的，列数一变就不再落在格子上：停下后把窗户放回自己的槽位。
function onWallResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => resetWall(wallRef.value), 180);
}

// 140 个槽位：64 扇有照片的窗户 + 大量普通空窗格（墙面的质感）。
// 再从中挖出几个**完全不可见**的洞（.win-gap，连窗框都没有），
// 这 6 个洞是华容道唯一的移动空间，筛选切换时窗户就往里滑。
const SLOT_COUNT = 140;
const WALL_GAPS = 6;
// 墙面上的总照片数（三类相加 64）。筛选只改变可见性，不重新洗牌。
const WALL_LIMITS = { friend: 32, group: 20, me: 12 };

const FILTERS = [
  { id: 'all', label: 'all windows' },
  { id: 'friends', label: 'friends' },
  { id: 'group', label: 'group' },
  { id: 'me', label: 'me' },
];

// ── 照片池 ──────────────────────────────────────────────────────────────
// 好友：按人轮转，保证每个人都能露面；hanyong 没有照片，保留一个 "?" 窗格。
// 个人相册也已并入 Gallery：点好友窗格直接开他整组照片的灯箱。
const friendPhotoLists = Object.fromEntries(
  friends.map((f) => [f.id, f.photos || []])
);

const friendPool = (() => {
  const byFriend = friends.map((f) => (f.photos || []).map((p, photoIndex) => ({
    kind: 'friend',
    kicker: 'FRIEND',
    title: f.name,
    friendId: f.id,
    friendPhotoIndex: photoIndex,
    src: p.src,
    fullSrc: p.fullSrc,
    filename: p.filename,
    date: photoDate(p.filename),
    placeholder: false,
  })));

  const out = [{
    kind: 'friend',
    kicker: 'FRIEND',
    title: 'Han Yong',
    friendId: 'hanyong',
    friendPhotoIndex: -1,
    src: '',
    placeholder: true,
  }];

  for (let i = 0; ; i += 1) {
    let any = false;
    for (const list of byFriend) {
      if (list[i]) {
        out.push(list[i]);
        any = true;
      }
    }
    if (!any) break;
  }
  return out;
})();

// 直接用 CMS 快照里的 src/fullSrc（现在是 cms.liveinpassion.me 的绝对地址）。
// groupPhotos.js 里那套 `CDN_BASE + 相对路径` 的拼法对现在的快照已经失效了，
// 这里不经过它，避免拼出 https://img.liveinpassion.me/https://cms... 这种地址。
const groupAlbum = (albumContent.albums || []).find((a) => a.r2Prefix === 'group_photos');
const groupPool = (groupAlbum?.photos || []).map((p, i) => ({
  kind: 'group',
  kicker: 'GROUP',
  title: 'Group moment',
  src: p.src,
  fullSrc: p.fullSrc,
  filename: p.filename,
  date: photoDate(p.filename),
  groupIndex: i,
  placeholder: false,
}));

// ME 相册现在有 264 张，隔 11 张取一张，保持墙面的比重；
// 真正的完整相册在 /me/gallery。
const mePool = mePhotos
  .filter((_, i) => i % 11 === 0)
  .flatMap((name) => {
    const p = mePhotoByName(name);
    if (!p) return [];
    return [{
      kind: 'me',
      kicker: 'ME',
      title: 'Personal archive',
      to: '/me/gallery',
      src: p.src,
      fullSrc: p.fullSrc,
      filename: name,
      date: photoDate(name),
      placeholder: false,
    }];
  });

function interleave(...lists) {
  const out = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i += 1) {
    for (const list of lists) if (list[i]) out.push(list[i]);
  }
  return out;
}

// 整面墙的固定内容：三类各自取一部分，交错后每个 item 永久绑定一个槽位。
// 筛选 = 只切换哪些 item 可见，槽位不动 —— 所以切换时旧图淡出、新图在
// 原本空着的窗格里淡入，而不是整面墙重新洗牌。
const WALL_ITEMS = interleave(
  friendPool.slice(0, WALL_LIMITS.friend),
  groupPool.slice(0, WALL_LIMITS.group),
  mePool.slice(0, WALL_LIMITS.me)
);

// ── 确定性的散点布局 ────────────────────────────────────────────────────
function mulberry32(a) {
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const slotOrder = (() => {
  const arr = [...Array(SLOT_COUNT).keys()];
  const random = mulberry32(0x5eed1234);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
})();

// 支持从 ME 页的 FRIENDS 卡片直接带筛选进来：/gallery?filter=friends
const FILTER_IDS = new Set(FILTERS.map((f) => f.id));
const filterFromQuery = (value) => (
  typeof value === 'string' && FILTER_IDS.has(value) ? value : 'all'
);
const initialFilter = filterFromQuery(route.query.filter);
const selectedFilter = ref(initialFilter);
const displayFilter = ref(initialFilter);

const slots = (() => {
  const bySlot = new Map();
  WALL_ITEMS.forEach((item, i) => bySlot.set(slotOrder[i], item));
  return Array.from({ length: SLOT_COUNT }, (_, i) => bySlot.get(i) || null);
})();

// 普通空槽仍然是空窗格；再从空槽里等距挑几个做成完全不可见的洞。
// 只有 .win-gap 是华容道的移动空间，其余空窗格只是墙的底色。
const gapSlots = (() => {
  const empty = [];
  for (let i = 0; i < SLOT_COUNT; i += 1) if (!slots[i]) empty.push(i);
  const n = Math.min(WALL_GAPS, empty.length);
  const out = new Set();
  for (let i = 0; i < n; i += 1) {
    out.add(empty[Math.floor(((i + 0.5) * empty.length) / n)]);
  }
  return out;
})();

function isActive(item) {
  if (!item) return false;
  if (displayFilter.value === 'all') return true;
  if (displayFilter.value === 'friends') return item.kind === 'friend';
  return item.kind === displayFilter.value;
}

const friendIdSet = new Set(
  WALL_ITEMS.filter((i) => i.kind === 'friend').map((i) => i.friendId)
);

const statsText = computed(() => {
  const n = WALL_ITEMS.filter((item) => isActive(item)).length;
  if (displayFilter.value === 'friends') return `${n} windows · ${friendIdSet.size} friends`;
  if (displayFilter.value === 'group') return `${n} group moments`;
  if (displayFilter.value === 'me') return `${n} personal moments`;
  const moments = WALL_ITEMS.filter((i) => i.kind !== 'friend').length;
  return `${n} windows · ${friendIdSet.size} friends · ${moments} moments`;
});

// 图片真正 load 之后再加 is-loaded，配合 is-on 做淡入淡出；
// 同时在这扇窗上来一次抖色故障揭示（参考站的加载镜头）。
// 「已加载」状态用 rAF 合批：首屏几十张缩略图往往在同一帧里陆续 load，
// 每张都重建一次 Set 会让整面墙（140 个槽位）跟着重渲染几十次。
const loadedSrcs = ref(new Set());
let loadedQueue = new Set();
let loadedRaf = 0;

function flushLoaded() {
  loadedRaf = 0;
  if (!loadedQueue.size) return;
  const next = new Set(loadedSrcs.value);
  for (const src of loadedQueue) next.add(src);
  loadedQueue = new Set();
  loadedSrcs.value = next;
}

function onImgLoad(item, event) {
  if (!item?.src) return;
  loadedQueue.add(item.src);
  if (!loadedRaf) loadedRaf = requestAnimationFrame(flushLoaded);
  const img = event?.target;
  if (img) playGlitchReveal(img, img.closest('.win--filled'));
}

// ── 底部胶卷条（参照 oumahi.art）────────────────────────────────────────
// 把当前筛选下墙上的照片再排成一条固定底栏；点缩略图直接进详情。
// 缩略图复用 thumbUrl 的 200px 缓存，不在墙上重复解码。
const stripRef = ref(null);
// 胶卷条只在这个页面驻留：它被 Teleport 到 body，keep-alive 换页后
// 不能指望节点一定跟着被摘掉，所以用这个开关按页面激活状态收起。
const stripAlive = ref(false);
const stripThumbs = ref({});
let stripThumbQueue = {};
let stripThumbRaf = 0;
const stripItems = computed(() => WALL_ITEMS.filter((item) => item.src && isActive(item)));
// 灯箱里正在看的那张：按 src 匹配，跨不同相册列表也能对上高亮
const lightboxSrc = computed(
  () => (lightboxOpen.value ? (lightboxItems.value[lightboxIndex.value]?.src || '') : '')
);

function loadStripThumb(item) {
  if (!item?.src || stripThumbs.value[item.src] || stripThumbQueue[item.src]) return;
  thumbUrl(item.src, 200).then((url) => {
    if (!url) return;
    // 缩略图是逐张异步生成的：同一帧里到的几张合并成一次对象替换，
    // 否则一条 60 格的胶卷条会被逐张重渲染几十次。
    stripThumbQueue[item.src] = url;
    if (stripThumbRaf) return;
    stripThumbRaf = requestAnimationFrame(() => {
      stripThumbRaf = 0;
      const pending = stripThumbQueue;
      stripThumbQueue = {};
      stripThumbs.value = { ...stripThumbs.value, ...pending };
    });
  });
}

// 首次不要跟墙上的缩略图抢队列：等入场动画开始后再灌胶卷条
watch(stripItems, (list) => {
  for (const item of list) loadStripThumb(item);
});

function scrollStrip(direction) {
  const row = stripRef.value;
  if (!row) return;
  row.scrollBy({ left: direction * Math.min(row.clientWidth * 0.8, 520), behavior: 'smooth' });
}

// ── 指针旁的提示 ────────────────────────────────────────────────────────
const tipEl = ref(null);
const wallRef = ref(null);
let wallIo = null;

// 窗户很多，图片又是 CMS 上的大压缩图；只给接近视口的窗格挂 src。
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
let tipRaf = 0;
let tipX = 0;
let tipY = 0;

function moveTip(event) {
  if (!tip.value.visible) return;
  // 别让提示跑出视口右边
  tipX = Math.min(event.clientX + 14, window.innerWidth - 180);
  tipY = Math.min(event.clientY + 16, window.innerHeight - 54);
  // pointermove 可能比屏幕刷新还密（高刷鼠标 / 触控笔），写到 rAF 里合并
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

function setFilter(id) {
  if (selectedFilter.value === id) return;
  selectedFilter.value = id;
  clearBlockCursorHot();
  hideTip();
  // 筛选状态同步到 URL，ME 页的 FRIENDS 卡片才能反复把人带到同一个视图
  router.replace({
    query: { ...route.query, filter: id === 'all' ? undefined : id },
  });
}

watch(
  () => route.query.filter,
  (value) => {
    const next = filterFromQuery(value);
    if (next !== selectedFilter.value) setFilter(next);
  }
);

// 照片详情的飞行起点：当前这扇窗里的照片矩形 + 图片地址/比例
// （底部胶卷条传 .win-strip__img，墙上的窗格用默认的 .win__img）
function originFromEvent(event, selector = '.win__img') {
  const el = event?.currentTarget;
  const img = el?.querySelector(selector);
  const r = (img || el)?.getBoundingClientRect();
  if (!r) return null;
  return {
    rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    src: img?.currentSrc || img?.getAttribute('src') || '',
    aspect: img?.naturalWidth && img?.naturalHeight
      ? img.naturalWidth / img.naturalHeight
      : r.width / r.height,
  };
}

function openWindow(item, event, selector) {
  hideTip();
  const from = originFromEvent(event, selector);
  // 群组 / 个人相册都没有独立页面了：直接在 Gallery 里开灯箱
  if (item.kind === 'friend') {
    const list = friendPhotoLists[item.friendId] || [];
    if (item.friendPhotoIndex >= 0 && list[item.friendPhotoIndex]) {
      openLightbox(list, item.friendPhotoIndex, from);
    }
    return;
  }
  if (item.kind === 'group') {
    openLightbox(groupPool, item.groupIndex, from);
    return;
  }
  if (item.to) {
    // 去 ME 相册是换页、不是开灯箱：上一张还开着的话必须先关掉 ——
    // 这盏灯箱是全局单例，isOpen 不会因为换路由自动复位，
    // 不关的话大图会跟着跳到 ME 页面，一直停在屏幕中间。
    if (lightboxOpen.value) closeLightbox();
    router.push(item.to);
  }
}

let swapId = 0;
watch(selectedFilter, async (next) => {
  hideTip();
  clearBlockCursorHot();
  if (next === displayFilter.value) return;
  const token = ++swapId;
  const targetKind = next === 'all' ? null : (next === 'friends' ? 'friend' : next);
  // 缩略图在后台预热，但**不要等它**：等图会把切换拖到几秒之后。
  // 新图会随着加载完成、按落点顺序错开淡入。
  WALL_ITEMS
    .filter((item) => item.src && (!targetKind || item.kind === targetKind))
    .forEach((item) => { thumbUrl(item.src, 200); });
  // 窗户从真正的空洞里滑过去（华容道）
  await shuffleWall(wallRef.value);
  if (token !== swapId) return;

  const wall = wallRef.value;
  // 滑到位之后，新内容按落点的先后错开淡入；不属于新筛选的窗立即淡出
  if (wall) {
    staggerWallReveal(wall, (el) => !targetKind || el.dataset.kind === targetKind);
  }
  displayFilter.value = next;
  await nextTick();
  if (wall) {
    for (const img of wall.querySelectorAll('.win__img')) img.style.opacity = '';
    for (const el of wall.querySelectorAll('.win--filled')) {
      el.style.opacity = el.classList.contains('is-muted') ? '0.45' : '1';
    }
  }
  observeWallImages();
});

onMounted(() => {
  finePointer.value = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  stripAlive.value = true;
  setStripVisible(stripItems.value.length > 0);
  nextTick(observeWallImages);
  detachTilt = attachCardTilt(wallRef.value);
  window.addEventListener('resize', onWallResize);
  // 开场之后把整面墙的缩略图在后台排进队列，后续切换筛选不再等图片
  prefetchTimer = setTimeout(() => {
    for (const item of WALL_ITEMS) if (item.src) thumbUrl(item.src, 200);
  }, 2600);
  stripTimer = setTimeout(() => {
    for (const item of stripItems.value) loadStripThumb(item);
  }, 1200);
});

// keep-alive：每次从导航进入这个页面都重播一次入场
onActivated(() => {
  clearTimeout(introTimer);
  introPlayed = false;
  // 胶卷条只在 GALLERY 出现：灯箱要据此给这条底栏让位
  stripAlive.value = true;
  setStripVisible(stripItems.value.length > 0);
  wallEntry.reset(wallRef.value);
  nextTick(() => {
    // 等路由的 scrollBehavior 把页面滚回顶部后再量；nextTick 里量到的
    // 可能还是上一页的滚动位置，焦点窗会因此偏出屏幕中心。
    requestAnimationFrame(() => {
      wallEntry.prime(wallRef.value);
      observeWallImages();
    });
  });
  if (brandEntered.value) scheduleIntro();
});

onDeactivated(() => {
  // 只停掉计时器：不要在这里 reset。页面正在被转场板带走，
  // 这时把墙恢复成"完好的整面墙"会在转场边缘闪一下。
  // 重置放到下一次 onActivated、首帧绘制之前做。
  clearTimeout(introTimer);
  stripAlive.value = false;
  setStripVisible(false);
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
  clearTimeout(stripTimer);
  cancelAnimationFrame(loadedRaf);
  cancelAnimationFrame(tipRaf);
  cancelAnimationFrame(stripThumbRaf);
  wallEntry.reset(wallRef.value);
  detachTilt?.();
  stripAlive.value = false;
  setStripVisible(false);
});
</script>

<template>
  <main class="page active">
    <section class="win-page win-page--strip">
      <div class="win-inner">
        <!-- 用 div 而不是 <header>：main.css 里有一条全局的 header{position:fixed}，
             是给站点页头写的，套在内页字标上会把它钉到视口顶部。 -->
        <div class="win-header">
          <button class="win-header__side" type="button" @click="router.push('/me/gallery')">archive</button>
          <h1 class="win-header__title">MOMENTS</h1>
          <button class="win-header__side win-header__side--end" type="button" @click="router.push('/me')">me ↗</button>
        </div>

        <div ref="wallRef" class="win-wall" @pointermove.passive="moveTip">
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
              :class="{ 'is-muted': !isActive(item) }"
              :data-kind="item.kind"
              :data-slot="index"
              :style="{ '--win-i': index }"
              type="button"
              :tabindex="isActive(item) ? 0 : -1"
              :aria-hidden="!isActive(item)"
              :aria-label="`${item.kicker}: ${item.title}`"
              @click="isActive(item) && openWindow(item, $event)"
              @pointerenter="isActive(item) && enterWindow(item, $event)"
              @pointerleave="leaveWindow"
            >
              <span v-if="item.placeholder" class="win__placeholder">?</span>
              <img
                v-else
                class="win__img"
                :class="{ 'is-on': isActive(item), 'is-loaded': loadedSrcs.has(item.src) }"
                :data-src="isActive(item) ? item.src : null"
                :data-photo="item.src"
                :alt="item.title"
                decoding="async"
                draggable="false"
                @load="onImgLoad(item, $event)"
              >
            </button>
          </template>
        </div>
      </div>

      <!-- 底部胶卷条：当前筛选下墙上的照片，点缩略图直接进详情。
           必须 Teleport 到 body：.page 自带 z-index: 1 会把它关进这个层叠上下文，
           于是灯箱（1002）永远盖住它。挂到 body 直下，它才能在详情页里一直露着。 -->
      <Teleport to="body">
        <div v-if="stripAlive && stripItems.length" class="win-strip" aria-label="Photo filmstrip">
          <button
            class="win-strip__edge"
            type="button"
            aria-label="Scroll left"
            @click="scrollStrip(-1)"
          >‹</button>
          <div ref="stripRef" class="win-strip__row" @wheel="scrollHorizontallyOnWheel">
            <button
              v-for="item in stripItems"
              :key="item.src"
              class="win-strip__thumb"
              :class="{ 'is-active': item.src === lightboxSrc }"
              type="button"
              :aria-label="`${item.kicker}: ${item.title}${item.date ? ` · ${item.date}` : ''}`"
              @click="openWindow(item, $event, '.win-strip__img')"
            >
              <img
                class="win-strip__img"
                :src="stripThumbs[item.src] || null"
                :alt="item.title"
                loading="lazy"
                decoding="async"
                draggable="false"
              >
            </button>
          </div>
          <button
            class="win-strip__edge"
            type="button"
            aria-label="Scroll right"
            @click="scrollStrip(1)"
          >›</button>
        </div>
      </Teleport>

      <div class="win-dock">
        <span class="win-stats" aria-live="polite">{{ statsText }}</span>
        <div class="win-filters">
          <button
            v-for="f in FILTERS"
            :key="f.id"
            class="win-filter"
            :class="{ active: selectedFilter === f.id }"
            :aria-pressed="selectedFilter === f.id"
            type="button"
            @click="setFilter(f.id)"
          >
            {{ f.label }}
          </button>
        </div>
      </div>

      <div ref="tipEl" class="win-tip" :class="{ visible: tip.visible }" aria-hidden="true">
        <span class="win-tip__kicker">{{ tip.kicker }}</span>
        <span class="win-tip__title">{{ tip.title }}</span>
      </div>
    </section>
  </main>
</template>

