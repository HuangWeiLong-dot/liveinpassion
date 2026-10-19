<script setup>
// ME 页：一条纵向滚动叙事，全程一个浏览器窗口。
//
//   0. 进来先停在一张 EXPLORE 屏上，点击之后才解锁滚动、开始自动推进。
//   1. 隧道舞台 sticky 在整个 main 的顶部：30 张照片各自在 3D 空间里有一个
//      X/Y 偏移和深度 z（-5000 … +500）。滚动时 z 整体一次性推进 12000px，
//      所有照片依次飞出镜头、不再循环重置 —— 没有「突然放大 / 瞬间跳回深处」。
//      照片全部与屏幕平行（没有旋转），只做 translate3d；30 张各用一张不同的照片。
//   2. 照片全部飞出去之后，ME / GALLERY / FRIENDS 按三个独立窗口依次滚进来。
//      每个窗口里卡片先飞入，人像再从**相反方向**飞入；FRIENDS 的群像框与整张
//      卡片同比例（1193 × 731），像一层罩子。
//   3. 人像完整显示、不裁剪、不加边框；到位后从彩色过渡到「黑白、只留外套颜色」。
//      ME / GALLERY 的人像在蓝色和红色外套之间定时交叉淡化切换。
//   4. 左侧悬浮导航列出三个窗口，滚动时高亮，点击直接跳过去。
//   5. 这一页不挂全局页脚：固定页脚会和 sticky 舞台的行程打架。
//
// 人像来源：
//   me/cutouts/*.webp          透明抠图（白边已在 tools/build-cutouts.mjs 里处理）
//   *_selective.webp           只保留蓝 / 红外套颜色的叠加层（同脚本生成）
//
// 隧道照片来自 CMS 快照里的 Me 相册（264 张）。用 thumbUrl 先缩到 900px 左右
// 再上屏：原压缩图是 4895×6528，直接把 30 张原图解码会把内存和合成器拖垮。
import {
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
} from 'vue';
import { useRouter } from 'vue-router';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useVirtue } from '../composables/useVirtue.js';
import { meQuotes } from '../data/quotes.js';
import { blogPosts } from '../data/blogPosts.js';
import { mePhotos, mePhotoByName } from '../data/mePhotos.js';
import { CDN_BASE } from '../data/cdn.js';
import { thumbUrl } from '../composables/useThumbnails.js';
import SteamGameModal from '../components/SteamGameModal.vue';
import MeModals from '../components/MeModals.vue';

gsap.registerPlugin(ScrollTrigger);

const router = useRouter();
const { virtue } = useVirtue();

const reduceMotion = () => (
  window.matchMedia('(prefers-reduced-motion: reduce)').matches
);
const REDUCED = reduceMotion();

// ── 隧道照片池 ──────────────────────────────────────────────────────────
// 30 张卡片各用一张不同的图：从相册里等距抽 30 张，避免画面里出现重复。
// 上屏前统一缩到 900px（见 requestTunnelPhotos），30 张也不会撑爆显存。
// 抽不到 CMS 数据时退回仓库里那几张本地图。
const TUNNEL_CARD_COUNT = 30;
const TUNNEL_PHOTO_COUNT = TUNNEL_CARD_COUNT;
const LOCAL_FALLBACK = [
  '/me/personas/advocate.jpg',
  '/me/personas/idealist.jpg',
  '/me/personas/observer.jpg',
  '/me/personas/romanticist.jpg',
  '/me/posters/dead_poets_society.jpg',
  '/me/posters/ok_computer.jpg',
];
const tunnelPool = (() => {
  if (!mePhotos.length) {
    return LOCAL_FALLBACK.map((src) => ({ key: src, src }));
  }
  const count = Math.min(TUNNEL_PHOTO_COUNT, mePhotos.length);
  return Array.from({ length: count }, (_, i) => {
    const index = Math.floor(((i + 0.5) * mePhotos.length) / count);
    const filename = mePhotos[index];
    const urls = mePhotoByName(filename) || {};
    return {
      key: filename,
      src: urls.src || `${CDN_BASE}/Me/compressed_me/${filename}`,
    };
  });
})();

const tunnelPhotos = ref(tunnelPool.map((p) => ({ ...p, thumb: '' })));
const tunnelCards = Array.from({ length: TUNNEL_CARD_COUNT }, (_, i) => ({
  key: `tunnel-${i}`,
  photo: i % Math.max(1, tunnelPool.length),
}));

// 人物抠图：ME / GALLERY 用两张不同姿态，FRIENDS 用群像
const FRIENDS_CUTOUT = '/me/cutouts/group_0.webp';
const selectiveSrc = (src) => src.replace(/\.webp$/i, '_selective.webp');

// ME / GALLERY 各有一组人像（蓝外套和红外套交替），滚动到位后会定时切换。
// 每组 4 张，首尾分别是蓝 / 红，保证两个窗口一上来就是一蓝一红。
const portrait = (name) => {
  const base = `/me/cutouts/HuangWeiLong_${name}.webp`;
  return { key: name, base, selective: selectiveSrc(base) };
};
const ME_PORTRAITS = ['blue_2', 'red_1', 'blue_4', 'red_2'].map(portrait);
const GALLERY_PORTRAITS = ['red_0', 'blue_5', 'red_3', 'blue_3'].map(portrait);

const mePortraitLayers = ref([ME_PORTRAITS[0], ME_PORTRAITS[1]]);
const mePortraitFront = ref(0);
const galleryPortraitLayers = ref([GALLERY_PORTRAITS[0], GALLERY_PORTRAITS[1]]);
const galleryPortraitFront = ref(0);
let mePortraitCursor = 1;
let galleryPortraitCursor = 1;
let portraitTimer = null;

function rotatePortraits() {
  mePortraitCursor = (mePortraitCursor + 1) % ME_PORTRAITS.length;
  const meHidden = 1 - mePortraitFront.value;
  const meLayers = [...mePortraitLayers.value];
  meLayers[meHidden] = ME_PORTRAITS[mePortraitCursor];
  mePortraitLayers.value = meLayers;
  requestAnimationFrame(() => { mePortraitFront.value = meHidden; });

  galleryPortraitCursor = (galleryPortraitCursor + 1) % GALLERY_PORTRAITS.length;
  const galleryHidden = 1 - galleryPortraitFront.value;
  const galleryLayers = [...galleryPortraitLayers.value];
  galleryLayers[galleryHidden] = GALLERY_PORTRAITS[galleryPortraitCursor];
  galleryPortraitLayers.value = galleryLayers;
  requestAnimationFrame(() => { galleryPortraitFront.value = galleryHidden; });
}

function preloadPortraits() {
  for (const p of [...ME_PORTRAITS, ...GALLERY_PORTRAITS]) {
    const base = new Image();
    base.src = p.base;
    const selective = new Image();
    selective.src = p.selective;
  }
}

function startPortraitTimer() {
  if (portraitTimer) return;
  preloadPortraits();
  portraitTimer = setInterval(rotatePortraits, 5200);
}

function stopPortraitTimer() {
  if (portraitTimer) {
    clearInterval(portraitTimer);
    portraitTimer = null;
  }
}

// ── 隧道：3D 卡片 + 循环推进 ────────────────────────────────────────────
// 舞台 sticky 在整个 main 顶部，ScrollTrigger 的触发器就是整页。
const pageRef = ref(null);
const tunnelStageRef = ref(null);
const cardEls = [];
function setCardEl(i) {
  return (el) => {
    if (el) cardEls[i] = el;
  };
}

// 深度区间：-5000（最深）→ +500（已经擦过镜头）
const Z_FAR = -5000;
const Z_NEAR = 500;
const Z_RANGE = Z_NEAR - Z_FAR;
// 整页滚完推进 9000px：最远的一张（-5000）在 55% 进度时也飞过镜头了，
// 之后画面里不会再有照片，三张卡片才开始飞进来。
const TRAVEL = 14000;

const travelPercent = ref(0);
let travelPctLast = -1;

const cardStates = Array.from({ length: TUNNEL_CARD_COUNT }, () => {
  const state = { x: 0, y: 0, baseZ: 0, rx: 0, ry: 0 };
  randomizeCard(state, true);
  return state;
});

/** 随机一点 X/Y 偏移，避开画面正中心那一小块 */
function randomizeCardXY(state) {
  const angle = Math.random() * Math.PI * 2;
  const radius = 18 + Math.random() * 62; // 18vw ~ 80vw
  state.x = Math.cos(angle) * radius;
  state.y = Math.sin(angle) * radius;
}

function randomizeCard(state, initial) {
  randomizeCardXY(state);
  // 不做倾斜：卡片全部与屏幕平行，推进时才不会有「斜着飘」的杂乱感
  state.rx = 0;
  state.ry = 0;
  if (initial) state.baseZ = -500 - Math.random() * 4500;
}

let tunnelProgress = 0;
let tunnelTween = null;
let tunnelProxy = null;

function renderTunnel(progress) {
  tunnelProgress = progress;
  const travel = progress * TRAVEL;

  for (let i = 0; i < cardStates.length; i += 1) {
    const el = cardEls[i];
    if (!el) continue;
    const state = cardStates[i];

    // 一次性推进：不循环、不重置。所有照片一路飞出镜头，
    // 飞过 500px 之后就不再回来（滚动往回才按同一条轨迹倒放）。
    const rawZ = state.baseZ + travel;
    const z = Math.min(rawZ, Z_NEAR);
    // 0 → 500 之间淡出，越贴近镜头越透明
    const opacity = rawZ > 0 ? Math.max(0, 1 - rawZ / Z_NEAR) : 1;

    el.style.transform = `translate(-50%, -50%) translate3d(${state.x.toFixed(2)}vw, ${state.y.toFixed(2)}vw, ${z.toFixed(1)}px)`;
    el.style.opacity = opacity.toFixed(3);
    el.style.visibility = opacity < 0.002 ? 'hidden' : 'visible';
  }

  tunnelStageRef.value?.style.setProperty('--tunnel-progress', progress.toFixed(4));

  const pct = Math.round(progress * 100);
  if (pct !== travelPctLast) {
    travelPctLast = pct;
    travelPercent.value = pct;
  }
}

function requestTunnelPhotos() {
  if (TUNNEL_PHOTOS_REQUESTED) return;
  TUNNEL_PHOTOS_REQUESTED = true;
  if (!tunnelPhotos.value.length) return;

  const width = window.innerWidth <= 900 ? 640 : 900;

  // 先取最靠近镜头的那几张：首屏不会先看到一堆空框
  const order = tunnelPhotos.value
    .map((_, i) => i)
    .sort((a, b) => cardStates[b].baseZ - cardStates[a].baseZ);

  for (const i of order) {
    const photo = tunnelPhotos.value[i];
    if (!photo?.src) continue;
    thumbUrl(photo.src, width).then((url) => {
      const current = tunnelPhotos.value[i];
      if (!current) return;
      current.thumb = url || photo.src;
      tunnelPhotos.value = [...tunnelPhotos.value];
    });
  }
}
let TUNNEL_PHOTOS_REQUESTED = false;

// 某张图真的加载失败时退回占位框，避免只剩一条 1px 边框
function onTunnelImageError(index) {
  const photo = tunnelPhotos.value[index];
  if (photo) photo.thumb = '';
}

function buildTunnel() {
  killTunnel();
  renderTunnel(0);
  if (reduceMotion() || window.innerWidth <= 900 || !pageRef.value || !tunnelStageRef.value) return;

  // 触发器是整页：卡片阶段背景里的照片也还在继续飞（只是被压暗了）。
  tunnelProxy = { p: 0 };
  tunnelTween = gsap.to(tunnelProxy, {
    p: 1,
    duration: 1,
    ease: 'none',
    onUpdate: () => renderTunnel(tunnelProxy.p),
    scrollTrigger: {
      trigger: pageRef.value,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0.8,
      invalidateOnRefresh: true,
    },
  });
}

function killTunnel() {
  if (tunnelTween) {
    tunnelTween.scrollTrigger?.kill();
    tunnelTween.kill();
    tunnelTween = null;
  }
  tunnelProxy = null;
}

// ── 卡片：左右滑入 + 黑白过渡 ──────────────────────────────────────────
const beamMeRef = ref(null);
const beamGalleryRef = ref(null);
const beamFriendsRef = ref(null);
const beamRefs = [beamMeRef, beamGalleryRef, beamFriendsRef];
const beamTimelines = [];

// ── 左侧悬浮导航 ────────────────────────────────────────────────────────
// 不写 01/02/03，只用三个名字；滚动到哪个窗口，对应那条就伸长、变亮。
const NAV_ITEMS = [
  { id: 'me', label: 'ME', ref: beamMeRef },
  { id: 'gallery', label: 'GALLERY', ref: beamGalleryRef },
  { id: 'friends', label: 'FRIENDS', ref: beamFriendsRef },
];
const activeSection = ref('me');
let sectionObserver = null;

function goToSection(item) {
  const el = item.ref.value;
  if (!el) return;
  cancelAutoScroll();
  activeSection.value = item.id;
  window.scrollTo({
    top: Math.max(0, el.getBoundingClientRect().top + window.scrollY),
    behavior: reduceMotion() ? 'instant' : 'smooth',
  });
}

function observeSections() {
  sectionObserver?.disconnect();
  if (!('IntersectionObserver' in window)) return;
  sectionObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const item = NAV_ITEMS.find((n) => n.ref.value === entry.target);
        if (item) activeSection.value = item.id;
      }
    },
    { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
  );
  for (const item of NAV_ITEMS) {
    if (item.ref.value) sectionObserver.observe(item.ref.value);
  }
}

function buildBeams() {
  killBeams();
  const reduced = reduceMotion() || window.innerWidth <= 900;

  tunnelStageRef.value?.style.setProperty('--cards-in', '0');

  const entries = [];
  for (const r of beamRefs) {
    const root = r.value;
    if (!root) continue;
    const card = root.querySelector('.me-beam__card');
    const subject = root.querySelector('.me-beam__subject');
    const colors = [...root.querySelectorAll('.me-beam__img--color')];
    const selectives = [...root.querySelectorAll('.me-beam__img--selective')];
    if (!card || !subject) continue;
    entries.push({
      root,
      card,
      subject,
      colors,
      selectives,
      // 卡片和人像必须从相反方向进来
      cardFrom: root.dataset.dir === 'right' ? -120 : 120,
      subjectFrom: root.dataset.dir === 'right' ? 140 : -140,
    });
  }

  if (reduced) {
    for (const e of entries) {
      for (const el of e.selectives) el.style.opacity = '1';
      for (const el of e.colors) el.style.opacity = '0';
      gsap.set([e.card, e.subject], { clearProps: 'transform,opacity,visibility' });
    }
    return;
  }

  for (const e of entries) {
    gsap.set(e.card, { xPercent: e.cardFrom, autoAlpha: 0, y: 30, scale: 0.985 });
    gsap.set(e.subject, { xPercent: e.subjectFrom, autoAlpha: 0, y: 20 });
    gsap.set(e.selectives, { opacity: 0 });
    gsap.set(e.colors, { opacity: 1 });

    // 回到上一版的进入逻辑：随滚动进度推进（scrub），不吸附、不改成定时播放。
    // 只保留这次做慢、做柔的位移/透明度节奏。
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: e.root,
        start: 'top 75%',
        end: 'top 0%',
        scrub: 0.8,
        invalidateOnRefresh: true,
      },
    });

    // 卡片先飞进来：慢一点、带一点上浮和缩放，别像弹簧一样冲进来
    tl.fromTo(
      e.card,
      { xPercent: e.cardFrom, autoAlpha: 0, y: 30, scale: 0.985 },
      {
        xPercent: 0, autoAlpha: 1, y: 0, scale: 1,
        duration: 0.55, ease: 'power2.out',
      },
      0
    );

    // 卡片基本到位后，人像才从另一侧缓缓进来
    tl.fromTo(
      e.subject,
      { xPercent: e.subjectFrom, autoAlpha: 0, y: 20 },
      {
        xPercent: 0, autoAlpha: 1, y: 0,
        duration: 0.45, ease: 'power2.inOut',
      },
      0.5
    );

    // 停稳后收成「黑白 + 外套颜色」
    tl.fromTo(e.selectives, { opacity: 0 }, { opacity: 1, duration: 0.1, ease: 'sine.inOut' }, 0.9)
      .fromTo(e.colors, { opacity: 1 }, { opacity: 0, duration: 0.1, ease: 'sine.inOut' }, 0.9);

    beamTimelines.push(tl);
  }

  // 第一张卡片出现时 HUD 退场（照片这时已经全部飞出镜头）
  if (beamMeRef.value && tunnelStageRef.value) {
    const proxy = { v: 0 };
    const fade = gsap.to(proxy, {
      v: 1,
      ease: 'none',
      onUpdate: () => {
        tunnelStageRef.value?.style.setProperty('--cards-in', proxy.v.toFixed(3));
      },
      scrollTrigger: {
        trigger: beamMeRef.value,
        start: 'top bottom',
        end: 'top 40%',
        scrub: 0.8,
        invalidateOnRefresh: true,
      },
    });
    beamTimelines.push(fade);
  }
}

function killBeams() {
  for (const tl of beamTimelines) {
    tl.scrollTrigger?.kill();
    tl.kill();
  }
  beamTimelines.length = 0;
}

function pageScrollRange() {
  const main = pageRef.value;
  return main ? Math.max(0, main.offsetHeight - window.innerHeight) : 0;
}

function scrollToContent() {
  window.scrollTo({
    top: pageScrollRange(),
    left: 0,
    behavior: reduceMotion() ? 'instant' : 'smooth',
  });
}

// ── EXPLORE 入口 ────────────────────────────────────────────────────────
// 点击之前锁住滚动：wheel / touch / 键盘滚动的兜底都在这里。
// 舞台保持在第 0 帧，点击之后才进入整页的推进。
const explored = ref(false);

function blockExploreEvent(event) {
  if (!explored.value) event.preventDefault();
}

function guardExploreScroll() {
  if (!explored.value) {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }
}

function attachExploreLock() {
  cancelAutoScroll();
  explored.value = false;
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  window.addEventListener('wheel', blockExploreEvent, { passive: false });
  window.addEventListener('touchmove', blockExploreEvent, { passive: false });
  window.addEventListener('scroll', guardExploreScroll, { passive: true });
}

function detachExploreLock() {
  window.removeEventListener('wheel', blockExploreEvent);
  window.removeEventListener('touchmove', blockExploreEvent);
  window.removeEventListener('scroll', guardExploreScroll);
}

// 自己实现的自动滚动：不依赖 ScrollToPlugin，而且用户一动滚轮就停
let autoScrollRAF = 0;
let autoScrollCancel = null;

function cancelAutoScroll() {
  if (autoScrollRAF) cancelAnimationFrame(autoScrollRAF);
  autoScrollRAF = 0;
  if (autoScrollCancel) {
    window.removeEventListener('wheel', autoScrollCancel);
    window.removeEventListener('touchstart', autoScrollCancel);
    window.removeEventListener('pointerdown', autoScrollCancel);
    autoScrollCancel = null;
  }
}

function autoScrollTo(target, duration = 4200) {
  cancelAutoScroll();
  const from = window.scrollY;
  const distance = target - from;
  if (Math.abs(distance) < 2) return;

  autoScrollCancel = () => cancelAutoScroll();
  window.addEventListener('wheel', autoScrollCancel, { passive: true });
  window.addEventListener('touchstart', autoScrollCancel, { passive: true });
  window.addEventListener('pointerdown', autoScrollCancel, { passive: true });

  const started = performance.now();
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
  const step = (now) => {
    const t = Math.min(1, (now - started) / duration);
    window.scrollTo({
      top: from + distance * ease(t),
      left: 0,
      behavior: 'instant',
    });
    if (t < 1) autoScrollRAF = requestAnimationFrame(step);
    else {
      autoScrollRAF = 0;
      cancelAutoScroll();
    }
  };
  autoScrollRAF = requestAnimationFrame(step);
}

// EXPLORE：自动滚完整段 —— 照片飞出去、三行卡片依次飞进来
function startExplore() {
  explored.value = true;
  detachExploreLock();
  const target = pageScrollRange();
  if (reduceMotion()) {
    window.scrollTo({ top: target, left: 0, behavior: 'instant' });
    return;
  }
  autoScrollTo(target, 7000);
}

// SKIP：跳过隧道，直接到第一张卡片，后面的靠自己滚
function skipToCards() {
  explored.value = true;
  detachExploreLock();
  cancelAutoScroll();
  const root = beamMeRef.value;
  const target = root ? root.getBoundingClientRect().top + window.scrollY : 0;
  window.scrollTo({ top: Math.max(0, target), left: 0, behavior: 'instant' });
}

// ── 生命周期 ────────────────────────────────────────────────────────────
let activationCount = 0;
let resizeTimer = 0;

function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    ScrollTrigger.refresh();
    renderTunnel(tunnelProgress);
  }, 180);
}

onMounted(() => {
  requestTunnelPhotos();
  startPortraitTimer();
  attachExploreLock();
  window.addEventListener('resize', onResize);
  nextTick(() => {
    buildTunnel();
    buildBeams();
    observeSections();
    ScrollTrigger.refresh();
  });
  document.fonts?.ready
    ?.then(() => ScrollTrigger.refresh())
    .catch(() => {});
});

onActivated(() => {
  startPortraitTimer();
  activationCount += 1;
  if (activationCount > 1) {
    quote.value = meQuotes[Math.floor(Math.random() * meQuotes.length)];
  }
  // 已经 Explore 过就不再弹入口；只有第一次进入（或上次没点就离开）才显示
  if (explored.value) {
    cancelAutoScroll();
    detachExploreLock();
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  } else {
    attachExploreLock();
  }
  nextTick(() => {
    buildTunnel();
    buildBeams();
    observeSections();
    ScrollTrigger.refresh();
  });
});

onDeactivated(() => {
  sectionObserver?.disconnect();
  stopPortraitTimer();
  cancelAutoScroll();
  detachExploreLock();
  killTunnel();
  killBeams();
});

onBeforeUnmount(() => {
  sectionObserver?.disconnect();
  stopPortraitTimer();
  cancelAutoScroll();
  detachExploreLock();
  killTunnel();
  killBeams();
  clearTimeout(resizeTimer);
  window.removeEventListener('resize', onResize);
});

// ── 内容 ────────────────────────────────────────────────────────────────
const lastUpdate = blogPosts[0].cardDate;
const quote = ref(meQuotes[Math.floor(Math.random() * meQuotes.length)]);

const gameOpen = ref(false);
const movieOpen = ref(false);
const albumOpen = ref(false);
const kookOpen = ref(false);

function goGallery() {
  router.push('/gallery');
}

function goFriends() {
  router.push({ path: '/gallery', query: { filter: 'friends' } });
}

function copyWeChat() {
  navigator.clipboard.writeText('X15021373202');
  alert('WeChat ID copied: X15021373202');
}
</script>

<template>
  <main ref="pageRef" class="page active me-intro-page" :class="{ 'is-reduced': REDUCED }">
    <!-- 点击 EXPLORE 才进入：在那之前滚动被拦住，镜头停在起点 -->
    <div
      v-if="!explored"
      class="me-explore"
      @wheel.prevent
      @touchmove.prevent
    >
      <div class="me-explore__panel">
        <p class="me-explore__kicker">ME</p>
        <p class="me-explore__title">LIVE IN PASSION</p>
        <button class="me-explore__button" type="button" @click="startExplore">
          EXPLORE <span aria-hidden="true">↗</span>
        </button>
        <button class="me-explore__skip" type="button" @click="skipToCards">
          SKIP TO CARDS
        </button>
        <p class="me-explore__hint">SCROLL TO FLY THROUGH</p>
      </div>
    </div>

    <!-- 左侧悬浮导航：三个窗口来回跳 -->
    <aside v-if="explored" class="me-nav" aria-label="ME sections">
      <button
        v-for="item in NAV_ITEMS"
        :key="item.id"
        type="button"
        class="me-nav__item"
        :class="{ 'is-active': activeSection === item.id }"
        @click="goToSection(item)"
      >
        <span class="me-nav__line" aria-hidden="true" />
        <span class="me-nav__label">{{ item.label }}</span>
      </button>
    </aside>

    <!-- 整页只有一个浏览器窗口：这层隧道 sticky 在整个 main 的顶部，
         卡片从 runway 之后随窗口滚上来、压在它上面。 -->
    <div ref="tunnelStageRef" class="me-tunnel__stage" aria-label="Photo tunnel">
      <div class="me-tunnel__layers" aria-hidden="true">
        <figure
          v-for="(card, i) in tunnelCards"
          :key="card.key"
          :ref="setCardEl(i)"
          class="me-tunnel__card"
        >
          <span class="me-tunnel__placeholder" />
          <img
            v-if="tunnelPhotos[card.photo]?.thumb"
            :src="tunnelPhotos[card.photo].thumb"
            alt=""
            decoding="async"
            draggable="false"
            @error="onTunnelImageError(card.photo)"
          >
        </figure>
      </div>

      <div class="me-tunnel__vignette" aria-hidden="true" />

      <div v-if="explored" class="me-tunnel__hud">
        <div class="me-tunnel__hud-top">
          <span>ME</span>
          <span>BE {{ virtue }}</span>
        </div>
        <div class="me-tunnel__hud-bottom">
          <button class="me-tunnel__scroll" type="button" @click="scrollToContent">
            SCROLL <span aria-hidden="true">↓</span>
          </button>
          <span class="me-tunnel__count">
            {{ String(travelPercent).padStart(2, '0') }}%
          </span>
        </div>
      </div>

      <div v-if="explored" class="me-tunnel__meter" aria-hidden="true"><i /></div>
    </div>

    <!-- 摄像机先飞完，三张卡片随后各占一个窗口滚进来 -->
    <div class="me-tunnel__runway" aria-hidden="true" />

    <!-- ── ME ────────────────────────────────────────────────────────── -->
    <section ref="beamMeRef" class="me-beam me-beam--me" data-dir="left">
      <div class="me-beam__inner">
        <div class="me-beam__subject me-beam__subject--me" aria-hidden="true">
          <div class="me-beam__strip">
            <div
              v-for="(layer, li) in mePortraitLayers"
              :key="`me-layer-${li}`"
              class="me-beam__portrait"
              :class="{ 'is-on': mePortraitFront === li }"
            >
              <img
                class="me-beam__img me-beam__img--gray"
                :src="layer.base"
                alt=""
                decoding="async"
                draggable="false"
              >
              <img
                class="me-beam__img me-beam__img--selective"
                :src="layer.selective"
                alt=""
                decoding="async"
                draggable="false"
              >
              <img
                class="me-beam__img me-beam__img--color"
                :src="layer.base"
                alt=""
                decoding="async"
                draggable="false"
              >
            </div>
          </div>
        </div>

        <article class="me-beam__card me-beam__card--me">
          <div class="me-card__copy">
            <p class="me-card__kicker">ME</p>
            <h2 class="me-card__title">HUANG WEI LONG</h2>
            <p class="me-card__sub">DREAMER &amp; IDEALIST · BE {{ virtue }}</p>
            <p class="me-card__meta">LAST UPDATED · {{ lastUpdate }}</p>
            <p class="me-card__desc">
              Chasing dreams, collecting moments, and trying to stay a little
              more {{ virtue.toLowerCase() }} every day.
            </p>

            <blockquote class="me-card__quote">
              <span>{{ quote }}</span>
              <cite>— LIVE IN PASSION</cite>
            </blockquote>
          </div>

          <div class="me-card__aside">
            <p class="me-card__aside-label">ELSEWHERE</p>
            <div class="me-socials">
              <a href="#" class="me-social" title="WeChat: X15021373202" @click.prevent="copyWeChat">
                <svg xmlns="http://www.w3.org/2000/svg" stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 16 16">
                  <path d="M2.678 11.894a1 1 0 0 1 .287.801 11 11 0 0 1-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 0 1 .71-.074A8 8 0 0 0 8 14c3.996 0 7-2.807 7-6s-3.004-6-7-6-7 2.808-7 6c0 1.468.617 2.83 1.678 3.894m-.493 3.905a22 22 0 0 1-.713.129c-.2.032-.352-.176-.273-.362a10 10 0 0 0 .244-.637l.003-.01c.248-.72.45-1.548.524-2.319C.743 11.37 0 9.76 0 8c0-3.866 3.582-7 8-7s8 3.134 8 7-3.582 7-8 7a9 9 0 0 1-2.347-.306c-.52.263-1.639.742-3.468 1.105"/>
                </svg>
              </a>
              <a href="https://github.com/HuangWeiLong-dot" target="_blank" rel="noopener noreferrer" class="me-social" title="GitHub">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.026A9.578 9.578 0 0112 6.844c.85.004 1.705.114 2.504.336 1.909-1.295 2.747-1.026 2.747-1.026.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.482A10.02 10.02 0 0022 12.017C22 6.484 17.522 2 12 2z" clip-rule="evenodd"/>
                </svg>
              </a>
              <a href="https://x.com/HuangWeiLong525" target="_blank" rel="noopener noreferrer" class="me-social" title="X (Twitter)">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
                </svg>
              </a>
              <a href="mailto:3571676852@qq.com" class="me-social" title="Email">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
              </a>
              <a href="#" class="me-social" title="Kook Community" @click.prevent="kookOpen = true">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.486 2 2 6.486 2 12c0 1.8.478 3.487 1.31 4.953L2 22l5.047-1.31A9.96 9.96 0 0012 22c5.514 0 10-4.486 10-10S17.514 2 12 2zm0 18a8 8 0 01-4.072-1.116l-.292-.175-3.008.783.783-3.008-.175-.292A8 8 0 1112 20zm4.4-5.4c-.243-.121-1.434-.708-1.654-.787-.221-.08-.382-.121-.543.121-.161.243-.625.787-.767.95-.141.161-.282.181-.524.06-.243-.121-1.024-.377-1.95-1.204-.721-.643-1.208-1.437-1.349-1.679-.141-.243-.015-.374.106-.495.109-.109.243-.282.364-.423.121-.141.161-.243.243-.404.08-.161.04-.302-.02-.423-.06-.121-.543-1.31-.744-1.793-.196-.470-.395-.406-.543-.413l-.464-.008c-.161 0-.423.060-.645.302-.222.243-.847.828-.847 2.018 0 1.19.868 2.341.989 2.502.121.161 1.706 2.604 4.135 3.65.578.249 1.029.398 1.379.509.579.184 1.104.158 1.52.096.464-.069 1.434-.585 1.635-1.15.201-.565.201-1.05.141-1.15-.060-.099-.221-.16-.464-.281z"/>
                </svg>
              </a>
            </div>

            <p class="me-card__aside-label">OPEN</p>
            <div class="me-actions">
              <button type="button" @click="movieOpen = true">
                <span>FAVOURITE MOVIE</span><span>↗</span>
              </button>
              <button type="button" @click="albumOpen = true">
                <span>FAVOURITE ALBUM</span><span>↗</span>
              </button>
              <button type="button" @click="gameOpen = true">
                <span>GAME</span><span>↗</span>
              </button>
              <button type="button" @click="router.push('/me/gallery')">
                <span>MY GALLERY</span><span>↗</span>
              </button>
            </div>

            <div class="me-snake">
              <span class="me-snake__label">GITHUB ACTIVITY</span>
              <div class="me-snake__crop">
                <img
                  src="https://raw.githubusercontent.com/HuangWeiLong-dot/liveinpassion/output/github-contribution-grid-snake.gif"
                  alt="GitHub Contribution Snake"
                >
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>

    <!-- ── GALLERY ───────────────────────────────────────────────────── -->
    <section ref="beamGalleryRef" class="me-beam me-beam--gallery" data-dir="right">
      <div class="me-beam__inner">
        <div class="me-beam__subject me-beam__subject--gallery" aria-hidden="true">
          <div class="me-beam__strip">
            <div
              v-for="(layer, li) in galleryPortraitLayers"
              :key="`gallery-layer-${li}`"
              class="me-beam__portrait"
              :class="{ 'is-on': galleryPortraitFront === li }"
            >
              <img
                class="me-beam__img me-beam__img--gray"
                :src="layer.base"
                alt=""
                decoding="async"
                draggable="false"
              >
              <img
                class="me-beam__img me-beam__img--selective"
                :src="layer.selective"
                alt=""
                decoding="async"
                draggable="false"
              >
              <img
                class="me-beam__img me-beam__img--color"
                :src="layer.base"
                alt=""
                decoding="async"
                draggable="false"
              >
            </div>
          </div>
        </div>

        <article
          class="me-beam__card me-beam__card--link"
          role="link"
          tabindex="0"
          @click="goGallery"
          @keydown.enter.self="goGallery"
        >
          <div class="me-card__copy">
            <p class="me-card__kicker">GALLERY</p>
            <h2 class="me-card__title">GALLERY</h2>
            <p class="me-card__desc">
              The window wall. Friends, group moments, and a personal archive
              — one grid of windows, all at once.
            </p>
            <p class="me-card__link">OPEN GALLERY <span>↗</span></p>
            <button
              class="me-card__secondary"
              type="button"
              @click.stop="router.push('/me/gallery')"
            >
              MY GALLERY <span>↗</span>
            </button>
          </div>
        </article>
      </div>
    </section>

    <!-- ── FRIENDS ───────────────────────────────────────────────────── -->
    <section ref="beamFriendsRef" class="me-beam me-beam--cover" data-dir="left">
      <div class="me-beam__inner">
        <div class="me-beam__subject" aria-hidden="true">
          <div class="me-beam__strip">
            <img
              class="me-beam__img me-beam__img--gray"
              :src="FRIENDS_CUTOUT"
              alt=""
              decoding="async"
              draggable="false"
            >
            <img
              class="me-beam__img me-beam__img--selective"
              :src="selectiveSrc(FRIENDS_CUTOUT)"
              alt=""
              decoding="async"
              draggable="false"
            >
            <img
              class="me-beam__img me-beam__img--color"
              :src="FRIENDS_CUTOUT"
              alt=""
              decoding="async"
              draggable="false"
            >
          </div>
        </div>

        <article
          class="me-beam__card me-beam__card--link"
          role="link"
          tabindex="0"
          @click="goFriends"
          @keydown.enter.self="goFriends"
        >
          <div class="me-card__copy">
            <p class="me-card__kicker">FRIENDS</p>
            <h2 class="me-card__title">FRIENDS</h2>
            <p class="me-card__desc">
              The people who show up in the moments — an open wall of faces,
              places, and the stories in between.
            </p>
            <p class="me-card__link">OPEN FRIENDS <span>↗</span></p>
          </div>
        </article>
      </div>
    </section>

    <SteamGameModal :visible="gameOpen" @close="gameOpen = false" />
    <MeModals
      :movie="movieOpen"
      :album="albumOpen"
      :kook="kookOpen"
      @close-movie="movieOpen = false"
      @close-album="albumOpen = false"
      @close-kook="kookOpen = false"
    />
  </main>
</template>

<style scoped>
.me-intro-page {
  --me-line: var(--border-color);
  position: relative;
  background: var(--bg);
  color: var(--text-primary);
  /* .page 的 overflow-x: hidden 会把整个 main 变成滚动容器，
     隧道里的 position: sticky 因此失效（舞台会跟着页面滚走）。
     本页的横向溢出由根元素兜住，这里必须放开。 */
  overflow: visible;
}

/* ── 左侧悬浮导航 ─────────────────────────────────────────────────────── */
@keyframes me-nav-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.me-nav {
  position: fixed;
  animation: me-nav-fade 0.7s ease both;
  top: 50%;
  left: clamp(14px, 2.2vw, 34px);
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.85rem;
  transform: translateY(-50%);
}

.me-nav__item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 4px 0;
  border: 0;
  border-radius: 0;
  background: none;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  text-align: left;
  cursor: pointer;
  transition: color 0.25s ease;
}

.me-nav__line {
  display: block;
  width: 18px;
  height: 1px;
  background: currentcolor;
  opacity: 0.45;
  transform-origin: 0 50%;
  transition: width 0.3s ease, opacity 0.3s ease;
}

.me-nav__item:hover,
.me-nav__item.is-active {
  color: var(--text-primary);
}

.me-nav__item:hover .me-nav__line {
  width: 30px;
  opacity: 1;
}

.me-nav__item.is-active .me-nav__line {
  width: 40px;
  opacity: 1;
}

/* ── EXPLORE 入口 ─────────────────────────────────────────────────────── */
.me-explore {
  position: fixed;
  inset: 0;
  z-index: 60; /* 低于全局 header(100)，上面那行导航仍然可点 */
  display: grid;
  place-items: center;
  background: radial-gradient(
    ellipse at 50% 50%,
    color-mix(in srgb, var(--bg) 58%, transparent) 0%,
    var(--bg) 74%
  );
  backdrop-filter: blur(2px);
}

.me-explore__panel {
  display: grid;
  justify-items: center;
  gap: 1.15rem;
  padding: 2rem;
  text-align: center;
}

.me-explore__kicker,
.me-explore__hint {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.me-explore__title {
  margin: 0;
  font-family: 'Oswald', sans-serif;
  font-weight: 700;
  font-size: clamp(2rem, 5.2vw, 4.8rem);
  line-height: 0.95;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--text-primary);
}

.me-explore__button {
  display: inline-flex;
  align-items: center;
  gap: 0.8rem;
  padding: 14px 44px;
  border: 1px solid var(--text-primary);
  border-radius: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.25s ease, color 0.25s ease;
}

.me-explore__button:hover,
.me-explore__button:focus-visible {
  background: var(--text-primary);
  color: var(--bg);
}

.me-explore__skip {
  margin-top: 0.35rem;
  padding: 6px 0;
  border: 0;
  border-radius: 0;
  background: none;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  text-decoration: underline;
  text-underline-offset: 5px;
  text-decoration-thickness: 1px;
  cursor: pointer;
  transition: color 0.2s ease;
}

.me-explore__skip:hover,
.me-explore__skip:focus-visible {
  color: var(--text-primary);
}

/* ── 照片隧道 ─────────────────────────────────────────────────────────── */
/* 舞台 sticky 在 main 顶部、一直跟到整页结束；后面的 runway 和卡片
   从它上面滚过去。整页只有一个窗口，没有「跳到下一屏」。 */
.me-tunnel__stage {
  position: sticky;
  top: 0;
  z-index: 0;
  height: 100vh;
  height: 100svh;
  overflow: hidden;
  isolation: isolate;
  background: var(--bg);
  /* 30 张卡片真的在 3D 空间里：近大远小、互相遮挡都由透视矩阵算，
     滚动期间只改每张卡片的 translate3d，不触发重排。 */
  perspective: 1000px;
  perspective-origin: 50% 50%;
}

/* 摄像机飞完的行程；卡片窗口紧接在后面 */
.me-tunnel__runway {
  height: 300vh;
  pointer-events: none;
}

.me-tunnel__layers {
  position: absolute;
  inset: 0;
  z-index: 1;
  transform-style: preserve-3d;
  /* 第一张卡片上来时照片整体淡出：不是压暗，是平滑消失 */
  opacity: calc(1 - var(--cards-in, 0));
}

.me-tunnel__card {
  position: absolute;
  top: 50%;
  left: 50%;
  width: clamp(160px, 17vw, 300px);
  margin: 0;
  transform-style: preserve-3d;
  transform-origin: 50% 50%;
  /* JS 第一次渲染之前先藏起来，避免 30 张图叠在正中间闪一帧 */
  opacity: 0;
  will-change: transform, opacity;
  backface-visibility: hidden;
  pointer-events: none;
}

.me-tunnel__placeholder {
  display: block;
  width: 100%;
  aspect-ratio: 3 / 4;
  border: 1px solid color-mix(in srgb, var(--text-primary) 16%, transparent);
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--text-primary) 7%, transparent),
      transparent 60%
    ),
    var(--background-secondary);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
}

/* 图片盖在占位框上：加载完成前框已经有完整高度，不会只剩顶部一条线 */
.me-tunnel__card img {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border: 1px solid color-mix(in srgb, var(--text-primary) 16%, transparent);
  background: var(--background-secondary);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
  animation: me-tunnel-photo-in 0.6s ease both;
}

@keyframes me-tunnel-photo-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.me-tunnel__vignette {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background: radial-gradient(
    ellipse at 50% 50%,
    transparent 26%,
    color-mix(in srgb, var(--bg) 42%, transparent) 74%,
    var(--bg) 100%
  );
}

.me-tunnel__hud {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: clamp(74px, 10vh, 118px) clamp(20px, 4vw, 52px) clamp(30px, 5vh, 58px);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-secondary);
  pointer-events: none;
  opacity: calc(1 - var(--cards-in, 0));
}

.me-tunnel__hud-top,
.me-tunnel__hud-bottom {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.2rem;
}

.me-tunnel__scroll {
  display: inline-flex;
  align-items: center;
  gap: 0.55em;
  padding: 6px 0;
  border: 0;
  border-radius: 0;
  background: none;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
  pointer-events: auto;
}

.me-tunnel__scroll span {
  display: inline-block;
  animation: me-scroll-bob 1.8s ease-in-out infinite;
}

@keyframes me-scroll-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(5px); }
}

.me-tunnel__count {
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.me-tunnel__meter {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 3;
  height: 1px;
  background: var(--me-line);
  pointer-events: none;
  opacity: calc(1 - var(--cards-in, 0));
}

.me-tunnel__meter i {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--text-primary);
  transform: scaleX(var(--tunnel-progress, 0));
  transform-origin: 0 50%;
}

/* ── 卡片 + 人像（每个窗口一张） ─────────────────────────────────────── */
.me-beam {
  --subject-aspect: 0.67;
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  min-height: 100vh;
  min-height: 100svh;
  padding: 12vh clamp(16px, 4vw, 56px);
  background: transparent;
  overflow: visible;
}

.me-beam--gallery { --subject-aspect: 0.67; }
.me-beam--friends { --subject-aspect: 1.632; }

/* 每个 section 就是一张卡片窗口；卡片和人物到位后随时间缓慢入场 */
.me-beam__inner {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  max-width: 100%;
  height: auto;
}

.me-beam[data-dir='right'] .me-beam__inner {
  flex-direction: row-reverse;
}

/* 人像完整显示、不裁剪：高度定死，宽度由原图比例算出来 */
.me-beam__subject {
  position: relative;
  z-index: 3;
  flex: 0 0 auto;
  height: min(62vh, 620px);
  aspect-ratio: var(--subject-aspect);
  pointer-events: none;
  will-change: transform, opacity;
}

.me-beam:not(.me-beam--cover)[data-dir='left'] .me-beam__subject {
  margin-right: -3vw;
}

.me-beam:not(.me-beam--cover)[data-dir='right'] .me-beam__subject {
  margin-left: -3vw;
}

.me-beam__strip {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: transparent;
}

/* 每个窗口的人像有两层：蓝 / 红交替，定时交叉淡化 */
.me-beam__portrait {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 1.1s cubic-bezier(0.4, 0, 0.2, 1);
}

.me-beam__portrait.is-on {
  opacity: 1;
}

.me-beam__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  max-width: none;
  object-fit: contain;
  object-position: 50% 50%;
  user-select: none;
  -webkit-user-drag: none;
  /* 照片本体底部渐隐：抠图是硬切的，直接露出来会有一道齐边 */
  -webkit-mask-image: linear-gradient(
    to bottom,
    #000 0%,
    #000 84%,
    rgba(0, 0, 0, 0.4) 94%,
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    #000 0%,
    #000 84%,
    rgba(0, 0, 0, 0.4) 94%,
    transparent 100%
  );
}

/* 底图始终是黑白的；彩色层在上面，滚到中段时淡出，
   selective（只剩外套颜色）同时淡入 —— 最终就是「黑白，但衣服有颜色」。 */
.me-beam__img--gray {
  filter: grayscale(1) contrast(1.04) brightness(0.96);
}

.me-beam__img--selective {
  opacity: 0;
}

.me-beam__img--color {
  opacity: 1;
}

.me-beam__card {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(0, 0.92fr);
  gap: clamp(1rem, 2.2vw, 2.2rem);
  align-items: stretch;
  height: min(62vh, 620px);
  width: min(860px, 62vw);
  padding: clamp(1.2rem, 2.2vw, 2.2rem);
  border: 1px solid var(--me-line);
  background: color-mix(in srgb, var(--text-primary) 6%, var(--bg));
  box-shadow:
    10px 14px 0 rgba(0, 0, 0, 0.5),
    0 26px 52px rgba(0, 0, 0, 0.25);
  overflow: hidden;
  pointer-events: auto;
  will-change: transform, opacity;
}

/* 人像压住卡片的那一侧多留出 3vw，正文不会钻到人物后面 */
.me-beam:not(.me-beam--cover)[data-dir='left'] .me-beam__card {
  padding-left: calc(3vw + clamp(1.2rem, 2.2vw, 2.2rem));
}

.me-beam:not(.me-beam--cover)[data-dir='right'] .me-beam__card {
  padding-right: calc(3vw + clamp(1.2rem, 2.2vw, 2.2rem));
}

.me-beam--gallery .me-beam__subject,
.me-beam--gallery .me-beam__card {
  height: min(52vh, 540px);
}

.me-beam--gallery .me-beam__card {
  grid-template-columns: minmax(0, 1fr);
  width: min(800px, 58vw);
}

/* ── FRIENDS：卡片尺寸就是群像的比例，群像整张罩在卡片上 ─────────────── */
.me-beam--cover .me-beam__inner {
  position: relative;
  display: block;
  width: fit-content;
  max-width: 100%;
  height: auto;
  padding: 0;
}

/* 群像和卡片同尺寸、同比例，叠在窗口正中 */
.me-beam--cover .me-beam__subject {
  /* 直接和 inner（也就是卡片）同尺寸，避免 50% + translate
     被 GSAP 的 xPercent 变换覆盖后位置偏掉 */
  position: absolute;
  inset: 0;
  width: auto;
  height: auto;
  aspect-ratio: auto;
  translate: none;
  margin: 0;
}

.me-beam--cover .me-beam__card {
  width: auto;
  height: min(62vh, 620px);
  aspect-ratio: 1193 / 731;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
}

.me-beam--cover .me-beam__img {
  right: auto;
  left: 34%;
  width: 66%;
  object-fit: contain;
  object-position: 100% 100%;
  /* 群像边缘稍微羽化：左右各淡 8%，底部继续渐隐，人物不会像贴纸一样硬切 */
  -webkit-mask-image:
    linear-gradient(to right, transparent 0%, #000 8%, #000 92%, transparent 100%),
    linear-gradient(to bottom, #000 0%, #000 82%, transparent 100%);
  -webkit-mask-composite: source-in;
  mask-image:
    linear-gradient(to right, transparent 0%, #000 8%, #000 92%, transparent 100%),
    linear-gradient(to bottom, #000 0%, #000 82%, transparent 100%);
  mask-composite: intersect;
}

/* 群像在右半边，正文留在左边透明的区域 */
.me-beam--cover .me-card__copy {
  max-width: 30%;
  margin-left: 0;
}

/* ── 卡片内容 ─────────────────────────────────────────────────────────── */
.me-card__copy {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 0;
  max-width: none;
}

.me-card__kicker {
  margin: 0 0 0.6rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.me-card__title {
  margin: 0;
  font-family: 'Oswald', sans-serif;
  font-weight: 700;
  font-size: clamp(1.7rem, 2.6vw, 2.5rem);
  line-height: 0.94;
  letter-spacing: 0.01em;
  text-transform: uppercase;
}

.me-card__sub {
  margin: 0.55rem 0 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.me-card__meta {
  margin: 0.55rem 0 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.me-card__desc {
  max-width: 30rem;
  margin: 0.8rem 0 0;
  font-size: 0.82rem;
  line-height: 1.62;
  color: var(--text-secondary);
}

.me-card__quote {
  margin: 1rem 0 0;
  padding: 0.7rem 0 0;
  border-top: 1px solid var(--me-line);
  display: grid;
  gap: 0.35rem;
  font-size: 0.82rem;
  line-height: 1.6;
  color: var(--text-primary);
}

.me-card__quote cite {
  font-style: normal;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.me-card__link {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  margin: 1.1rem 0 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-primary);
}

.me-card__secondary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.6rem 0 0;
  padding: 0.45rem 0;
  border: 0;
  border-radius: 0;
  background: none;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-secondary);
  cursor: pointer;
}

.me-card__secondary:hover {
  color: var(--text-primary);
}

/* ── 社交 / 动作 / 蛇 ─────────────────────────────────────────────────── */
.me-card__aside {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 0;
  padding-left: clamp(0.8rem, 1.4vw, 1.3rem);
  border-left: 1px solid var(--me-line);
}

.me-card__aside-label {
  margin: 0 0 0.45rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.me-card__aside-label + .me-socials {
  margin-top: 0;
}

.me-card__aside-label:not(:first-child) {
  margin-top: 1rem;
}

.me-socials {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.8rem;
}

.me-social {
  display: inline-flex;
  width: 17px;
  height: 17px;
  color: var(--text-secondary);
  transition: color 0.25s ease, transform 0.25s ease;
}

.me-social:hover {
  color: var(--text-primary);
  transform: translateY(-2px);
}

.me-social svg {
  width: 100%;
  height: 100%;
}

.me-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-top: 1px solid var(--me-line);
  border-left: 1px solid var(--me-line);
}

.me-actions button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  min-height: 34px;
  padding: 0.42rem 0.6rem;
  border: 0;
  border-right: 1px solid var(--me-line);
  border-bottom: 1px solid var(--me-line);
  border-radius: 0;
  background: transparent;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-align: left;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.me-actions button:hover {
  background: var(--text-primary);
  color: var(--bg);
}

.me-snake {
  margin-top: 1rem;
  min-height: 0;
}

.me-snake__label {
  display: block;
  margin-bottom: 0.35rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.me-snake__crop {
  overflow: hidden;
  border: 1px solid var(--me-line);
  aspect-ratio: 1180 / 230;
  background: var(--bg);
}

/* 完整放进格子（不再用 118% + 负 margin 去裁），GitHub 的统计图才不会缺边 */
.me-snake__crop img {
  display: block;
  width: 100%;
  height: 100%;
  margin: 0;
  object-fit: contain;
}

/* GitHub 的 snake.gif 是白底；深色主题下反相 + 转回绿色，别让卡片里出现一块白 */
:root.dark .me-snake__crop img {
  filter: invert(1) hue-rotate(180deg);
}

/* 桌面端：人物整体再放大一点；FRIENDS 的群像（cover）保持原比例不动。
   46vw / 44vw 是窄桌面下的宽度上限，避免人物把卡片挤出视口。 */
@media (min-width: 901px) {
  .me-beam--me .me-beam__subject {
    height: min(72vh, 720px, 50vw);
  }

  .me-beam--gallery .me-beam__subject {
    height: min(66vh, 660px, 48vw);
  }
}

/* ── 响应式 ───────────────────────────────────────────────────────────── */
@media (max-width: 1100px) {
  .me-beam__inner {
    height: min(62vh, 620px);
  }

  .me-beam__card {
    width: min(760px, 58vw);
  }

  .me-beam--gallery .me-beam__card {
    width: min(700px, 54vw);
  }
}

@media (max-width: 900px) {
  /* 手机 / 平板：隐藏隧道和左侧导航，三张卡片按普通文档流纵向排开 */
  .me-nav {
    display: none;
  }

  .me-tunnel__stage,
  .me-tunnel__runway {
    display: none;
  }

  .me-beam {
    display: block;
    min-height: 0;
    height: auto;
    padding: 9vh 5vw;
    margin-bottom: 10vh;
  }

  .me-beam:not(.me-beam--cover) .me-beam__inner {
    position: static;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    height: auto;
  }

  .me-beam:not(.me-beam--cover) .me-beam__subject {
    height: min(46vh, 420px);
    width: auto;
    margin: 0 0 1.4rem;
  }

  .me-beam[data-dir='right']:not(.me-beam--cover) .me-beam__subject {
    margin-left: 0;
  }

  .me-beam__card,
  .me-beam--gallery .me-beam__card,
  .me-beam--cover .me-beam__card {
    grid-template-columns: minmax(0, 1fr);
    width: 100%;
    height: auto;
    min-height: 0;
    aspect-ratio: auto;
    padding: 1.2rem;
  }

  .me-beam:not(.me-beam--cover)[data-dir='left'] .me-beam__card,
  .me-beam:not(.me-beam--cover)[data-dir='right'] .me-beam__card {
    padding: 1.2rem;
  }

  .me-beam--cover .me-beam__inner {
    position: static;
    display: block;
    width: 100%;
    height: auto;
  }

  .me-beam--cover .me-beam__subject {
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    translate: none;
    aspect-ratio: auto;
  }

  /* 手机上保持「卡片 = 群像比例」，群像放右半边，正文留左边 */
  .me-beam--cover .me-beam__card {
    aspect-ratio: 1193 / 731;
    min-height: 0;
    padding: 0.9rem;
  }

  .me-beam--cover .me-beam__img {
    left: 34%;
    width: 66%;
    object-fit: contain;
    object-position: 100% 100%;
  }

  .me-beam--cover .me-card__copy {
    max-width: 30%;
    margin-left: 0;
  }

  .me-beam--cover .me-card__title {
    font-size: clamp(1rem, 4vw, 1.4rem);
  }

  .me-beam--cover .me-card__desc {
    margin-top: 0.4rem;
    font-size: 0.6rem;
    line-height: 1.4;
  }

  .me-beam--cover .me-card__link {
    margin-top: 0.4rem;
    font-size: 7px;
  }

  .me-card__aside {
    margin-top: 1.2rem;
    padding-top: 1.2rem;
    padding-left: 0;
    border-top: 1px solid var(--me-line);
    border-left: 0;
  }
}

@media (max-width: 520px) {
  .me-beam {
    padding: 7vh 4vw;
  }

  .me-beam__card {
    padding: 1rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .me-tunnel__scroll span {
    animation: none;
  }

  .me-tunnel__card img {
    animation: none;
  }

  .me-beam__portrait {
    transition: none;
  }
}

/* 减少动态：隐藏隧道，卡片按普通窗口居中对齐 */
.is-reduced .me-tunnel__stage,
.is-reduced .me-tunnel__runway {
  display: none;
}

.is-reduced .me-beam {
  display: grid;
  place-items: center;
  min-height: 100vh;
  min-height: 100svh;
  padding: 12vh 4vw;
}

.is-reduced .me-beam__inner {
  position: static;
  height: auto;
}

</style>
