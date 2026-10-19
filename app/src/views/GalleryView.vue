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
import { useLightbox } from '../composables/useLightbox.js';
import { staggerWallReveal } from '../composables/useWallMotion.js';
import { createWallEntry } from '../composables/useWallEntry.js';
import { resetWall, shuffleWall } from '../composables/useWallPuzzle.js';
import { useBrandOverlay } from '../composables/useBrandOverlay.js';
import { friends } from '../data/friends.js';
import { mePhotos, mePhotoByName } from '../data/mePhotos.js';
import albumContent from '../data/content/albums.json';

const route = useRoute();
const router = useRouter();
const { open: openLightbox } = useLightbox();
const { entered: brandEntered } = useBrandOverlay();

let introPlayed = false;
let introTimer = 0;
let prefetchTimer = 0;
let resizeTimer = 0;

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
  groupIndex: i,
  placeholder: false,
}));

// ME 相册现在有 264 张，隔 11 张取一张，保持墙面的比重；
// 真正的完整相册在 /me/gallery。
const mePool = mePhotos
  .filter((_, i) => i % 11 === 0)
  .map((name) => mePhotoByName(name))
  .filter(Boolean)
  .map((p) => ({
    kind: 'me',
    kicker: 'ME',
    title: 'Personal archive',
    to: '/me/gallery',
    src: p.src,
    placeholder: false,
  }));

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

// 图片真正 load 之后再加 is-loaded，配合 is-on 做淡入淡出
const loadedSrcs = ref(new Set());
function onImgLoad(item) {
  if (!item?.src) return;
  loadedSrcs.value = new Set(loadedSrcs.value).add(item.src);
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

function moveTip(event) {
  const el = tipEl.value;
  if (!el || !tip.value.visible) return;
  // 别让提示跑出视口右边
  const x = Math.min(event.clientX + 14, window.innerWidth - 180);
  const y = Math.min(event.clientY + 16, window.innerHeight - 54);
  el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
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
function originFromEvent(event) {
  const el = event?.currentTarget;
  const img = el?.querySelector('.win__img');
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

function openWindow(item, event) {
  hideTip();
  const from = originFromEvent(event);
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
  if (item.to) router.push(item.to);
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
  nextTick(observeWallImages);
  window.addEventListener('resize', onWallResize);
  // 开场之后把整面墙的缩略图在后台排进队列，后续切换筛选不再等图片
  prefetchTimer = setTimeout(() => {
    for (const item of WALL_ITEMS) if (item.src) thumbUrl(item.src, 200);
  }, 2600);
});

// keep-alive：每次从导航进入这个页面都重播一次入场
onActivated(() => {
  clearTimeout(introTimer);
  introPlayed = false;
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
  wallEntry.reset(wallRef.value);
});
</script>

<template>
  <main class="page active">
    <section class="win-page">
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
                @load="onImgLoad(item)"
              >
            </button>
          </template>
        </div>
      </div>

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

