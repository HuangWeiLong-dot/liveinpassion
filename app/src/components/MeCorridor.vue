<script setup>
// ME 页电视机里的 CH 04「THE CORRIDOR」。
//
// 版面与动效参照 inherited.band：六栏细线、超大字、卡片从幕布中揭开、
// 非当前展位缩到 0.4 并淡出、说明行左右交错、整屏背景用遮罩切换。
// 但不使用任何自拍或博文照片 —— 每个展位是一块本站配色的色块：
// 电视 RGB 的蓝 / 红，配本站的纸白 / 近黑。
//
// 滚动是竖向的：每个展位一屏，滚动发生在电视屏幕内部。
// 背景是一摞叠在走廊背后的整屏色块，下一块从底部用 clip-path 推上来换场。
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  reactive,
  ref,
} from 'vue';
import { blogBySlug, blogPosts } from '../data/blogPosts.js';
import { thumbUrl } from '../composables/useThumbnails.js';

// 入口那一屏沿用电视里原来的 ME 频道资料：名字 / 人格 / 最后更新 / 引言。
const props = defineProps({
  virtue: { type: String, default: '' },
  quote: { type: String, default: '' },
  lastUpdate: { type: String, default: '' },
});

// 走廊底片池：ECHOES 里的环境封面，循环给每一站当整屏背景。
const BG_POOL_SLUGS = [
  'aftermath',
  'those-ineffable-feelings',
  'next-to-me',
  'rain',
  'wandering',
  'contemplating',
  'upward',
  'when-i-lay-my-hand-upon-you',
];
const bgPool = BG_POOL_SLUGS.map((slug, i) => ({
  key: `pool-${i}`,
  src: blogBySlug[slug]?.image?.src || '',
}));
// 入口 / 出口的底片等文章列表建好后再取靠后的封面，避开前几幕，
// 免得滚得快时刚看过入口又撞上同一张。
let introBgSrc = '';
let outroBgSrc = '';

// 开场：ECHOES 封面硬切闪过，像参考站开场那组快速图片替换。
const BURST_ORDER = [0, 2, 4, 1, 3, 5, 0, 3, 5, 2];
const burstIndex = ref(-1);
const burstPlayed = ref(false);
let burstTimer = 0;
let burstStep = 0;
let burstFallback = 0;

const corridorLetters = 'CORRIDOR'.split('');
const outroLetters = 'ECHOES'.split('');

function pad(value) {
  return String(value).padStart(2, '0');
}

// 只取正文开头几行：`<br>` 和段落边界换成换行，再解掉标签 / 实体。
// 不做改写，保证回廊里的句子和 ECHOES 原文一字不差。
function plainLines(html, max = 3) {
  const marked = String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n');
  const doc = new DOMParser().parseFromString(marked, 'text/html');
  const lines = (doc.body.textContent || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const picked = [];
  for (const line of lines) {
    if (picked.length >= max) break;
    picked.push(line);
    if (picked.join(' ').length >= 140) break;
  }
  return picked;
}

function dateOnly(value) {
  return String(value || '').split('·')[0].trim();
}

// 标题按“词 → 字母”拆开：词不拆行，字母各自从遮罩里升起。
// i 是整条标题里的序号，动画靠它错开。
function titleWords(title) {
  let i = 0;
  return String(title || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ({
      key: word,
      letters: [...word].map((ch) => ({ ch, i: i++ })),
    }));
}

// 每一篇有封面的 ECHOES 都进走廊：篇数有多少，走廊就能滚多长。
const echoPosts = blogPosts.filter((post) => post?.image?.src);
const stations = echoPosts.map((post, i) => {
  const title = post.cardTitle || post.title || post.slug;
  return {
    type: 'echo',
    key: post.slug,
    slug: post.slug,
    number: i + 1,
    category: post.category || 'ECHO',
    title,
    words: titleWords(title),
    date: dateOnly(post.date),
    lines: plainLines(post.body),
    img: post.image?.src || '',
    // 每一站的整屏底片取另一篇 ECHOES 的封面：不循环那 8 张，也不会和卡片重复
    bgSrc: echoPosts[(i + 7) % echoPosts.length]?.image?.src || post.image?.src || '',
    caption: `ECHO COVER / ${dateOnly(post.date)}`,
    alt: `${post.title || post.slug} — cover`,
  };
});
const echoCount = stations.length;
introBgSrc = echoPosts[echoPosts.length - 5]?.image?.src || bgPool[5]?.src || '';
outroBgSrc = echoPosts[echoPosts.length - 8]?.image?.src || bgPool[7]?.src || introBgSrc;

// 每 4 篇插一张整屏封面当间奏：封面从两张展位之间滚过去。
const scenes = [];
for (let i = 0; i < stations.length; i += 1) {
  scenes.push(stations[i]);
  if ((i + 1) % 4 === 0 && i < stations.length - 1) {
    const cover = echoPosts[(i + 11) % echoPosts.length];
    scenes.push({
      type: 'cover',
      key: `cover-${i}`,
      number: Math.floor(i / 4) + 1,
      category: cover.category || 'ECHO',
      title: cover.cardTitle || cover.title || cover.slug,
      date: dateOnly(cover.date),
      bgSrc: cover.image.src,
    });
  }
}

// ── 当前展位 / 整屏底片 ────────────────────────────────────────────────
const rootRef = ref(null);
const introRef = ref(null);
const outroRef = ref(null);
const introSeen = ref(false);
const outroSeen = ref(false);
const focusIndex = ref(-1);
// 整屏背景当前显示到第几幕：0 = 入口，1..scenes.length = 内容，最后 = 出口
const bgIndex = ref(0);
// 卡片图（1200px）与整屏底片（900px），都来自 ECHOES
const images = reactive({});
const bgCache = reactive({});
const bgPromises = new Map();
// 两层底片：base 永远铺着上一张，incoming 从底部揭开下一张，揭完再换底
const bgBase = ref('');
const bgIncoming = ref('');
const bgIncomingOn = ref(false);
const bgIncomingPrep = ref(false);
const loadingAssets = new Set();

let raf = 0;
let attached = false;
let resizeTimer = 0;
let sceneObserver = null;
let cardObserver = null;
let bgSwapTimer = 0;
let bgSyncTimer = 0;
// 快速滚动时会有多幕同时请求底片；只让最后一幕开始揭开
let bgRequestId = 0;
// 背景动画一次只跑完一个；滚动再快也只排一个“最后要去的那一幕”
let bgAnimating = false;
let appliedBgIndex = 0;
let pendingBgIndex = null;
// 走廊的滚动容器是电视屏幕内部那一格（.me-tv__channel-stage），不是 window。
let scrollerEl = null;

function getScroller() {
  return scrollerEl || rootRef.value?.parentElement || null;
}

const railScene = computed(() => (
  focusIndex.value >= 0 ? scenes[focusIndex.value] : null
));
const railLabel = computed(() => {
  const scene = railScene.value;
  if (!scene) return '';
  return scene.type === 'cover'
    ? `INTERLUDE ${pad(scene.number)}`
    : `${pad(scene.number)} / ${pad(echoCount)}`;
});

function prefersReduced() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function loadCard(station) {
  if (!station?.img) return;
  // 先把原图放上去，快速滚到某一站时不会先看到空框；
  // 缩略图生成好再无缝替换。
  if (!images[station.key]) images[station.key] = station.img;
  if (images[station.key] !== station.img || loadingAssets.has(station.key)) return;
  loadingAssets.add(station.key);
  thumbUrl(station.img, 1200)
    .then((url) => {
      if (url) images[station.key] = url;
    })
    .finally(() => loadingAssets.delete(station.key));
}

function decodeImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    if (img.decode) {
      img.decode().then(() => resolve(true)).catch(() => resolve(false));
    } else {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
    }
  });
}

// 生成缩略图并等浏览器真正解码完，再交给背景层。
// 这样快速换场时不会先露出 incoming 里上一张还没换掉的图。
function ensureBg(src) {
  if (!src) return Promise.resolve('');
  if (bgCache[src]) return Promise.resolve(bgCache[src]);
  if (bgPromises.has(src)) return bgPromises.get(src);

  const promise = thumbUrl(src, 900)
    .then((url) => {
      const final = url || src;
      return decodeImage(final).then(() => final);
    })
    .then((final) => {
      bgCache[src] = final;
      noteBgReady();
      return final;
    })
    .finally(() => bgPromises.delete(src));

  bgPromises.set(src, promise);
  return promise;
}

function loadBgSrc(src) {
  ensureBg(src);
}

function bgUrl(src) {
  return bgCache[src] || src || '';
}

// 只预载底片池和间奏封面，卡片等滚近了再取。
function preloadBgs() {
  // 只预载开场用的 8 张底片池；每一站的背景滚近时再取，避免一次拉 59 张。
  bgPool.forEach((pool) => pool.src && loadBgSrc(pool.src));
}

function bgForIndex(index) {
  if (index <= 0) return introBgSrc;
  if (index > scenes.length) return outroBgSrc;
  return scenes[index - 1]?.bgSrc || '';
}

// 当前这一幕和后面两幕的底片提前取：滚到换场点时不会先黑一下再出图。
function preloadAround(index) {
  for (let i = index; i <= index + 2; i += 1) loadBgSrc(bgForIndex(i));
}

// 滚动的每一帧不立刻换背景；等手停下来 140ms，只换最后一次要去的那一幕。
function scheduleSceneBg(scene) {
  if (scene === appliedBgIndex && !bgAnimating) {
    pendingBgIndex = null;
    return;
  }
  pendingBgIndex = scene;
  clearTimeout(bgSyncTimer);
  bgSyncTimer = setTimeout(() => {
    if (bgAnimating || pendingBgIndex == null) return;
    const target = pendingBgIndex;
    pendingBgIndex = null;
    runSceneBg(target);
  }, 140);
}

// 下一张底片盖在上一张上面；1.25s 后把新图写到底层，再把上层收起。
async function runSceneBg(index) {
  if (bgAnimating) {
    pendingBgIndex = index;
    return;
  }
  if (index === appliedBgIndex) {
    pendingBgIndex = null;
    return;
  }
  const target = bgForIndex(index);
  if (!target) return;

  const request = ++bgRequestId;
  clearTimeout(bgSwapTimer);
  // 先把 incoming 静默收起，屏幕只剩最后一张稳定底片。
  // 快速滚动时旧图不会再被揭开第二次。
  bgIncomingPrep.value = true;
  bgIncomingOn.value = false;

  // 下一幕的底片也顺手取上；
  // 当前这张必须等缩略图解码完，才允许揭示。
  loadBgSrc(bgForIndex(index + 1));
  const url = await ensureBg(target);
  if (request !== bgRequestId || !url) return;
  if (url === bgBase.value) {
    appliedBgIndex = index;
    pendingBgIndex = null;
    return;
  }

  bgAnimating = true;
  bgIncoming.value = url;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (request !== bgRequestId) {
        bgAnimating = false;
        return;
      }
      bgIncomingPrep.value = false;
      bgIncomingOn.value = true;
    });
  });
  bgSwapTimer = setTimeout(() => {
    if (request !== bgRequestId) return;
    bgBase.value = url;
    bgIncomingOn.value = false;
    bgAnimating = false;
    appliedBgIndex = index;

    // 动画完整跑完后，如果滚动期间又攒了新的目标，再换一次。
    if (pendingBgIndex != null && pendingBgIndex !== appliedBgIndex) {
      scheduleSceneBg(pendingBgIndex);
    } else {
      pendingBgIndex = null;
    }
  }, 1250);
}

function stopBurst() {
  clearInterval(burstTimer);
  clearTimeout(burstFallback);
  burstTimer = 0;
  burstFallback = 0;
  burstStep = 0;
  burstIndex.value = -1;
}

function startBurst() {
  stopBurst();
  if (prefersReduced() || !bgPool.length) return;
  burstIndex.value = BURST_ORDER[0];
  burstTimer = setInterval(() => {
    burstStep += 1;
    if (burstStep >= BURST_ORDER.length) {
      stopBurst();
      return;
    }
    burstIndex.value = BURST_ORDER[burstStep];
  }, 110);
}

// 底片没到就别切：至少三张底片进了缓存再开演；网慢时 2.2s 兜底。
function startBurstOnce() {
  if (burstPlayed.value) return;
  burstPlayed.value = true;
  startBurst();
}

function noteBgReady() {
  if (!introSeen.value || burstPlayed.value) return;
  const ready = bgPool.filter((pool) => bgCache[pool.src]).length;
  if (ready >= 3) startBurstOnce();
}

function revealAll() {
  introSeen.value = true;
  outroSeen.value = true;
  preloadBgs();
}

// 一屏之内只有当前展位是亮的；整屏背景用一条阅读线判定，
// 下一张 ECHOES 底片滚到阅读线时开始从底部用遮罩推上来。
function updateFocus() {
  raf = 0;
  const root = rootRef.value;
  const scroller = getScroller();
  if (!root || !scroller) return;

  const screen = scroller.getBoundingClientRect();
  const scrollable = scroller.scrollHeight - scroller.clientHeight;
  const progress = scrollable > 0
    ? Math.min(1, Math.max(0, scroller.scrollTop / scrollable))
    : 0;
  root.style.setProperty('--mc-progress', progress.toFixed(4));

  // “当前展位”以电视屏幕的中心为准，不是浏览器视口中心 —— 屏幕才是舞台。
  const mid = screen.top + screen.height / 2;
  let best = -1;
  let bestDist = Infinity;
  const sceneEls = root.querySelectorAll('.mc-scene');
  sceneEls.forEach((el, i) => {
    const box = el.getBoundingClientRect();
    const center = box.top + box.height / 2;
    const dist = Math.abs(center - mid);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  });
  // 入口 / 出口没有近处的场景：让编号轨空着
  if (bestDist > screen.height * 0.55) best = -1;
  if (best !== focusIndex.value) focusIndex.value = best;

  // 背景换场：阅读线落在哪一幕，下一张底片就从底部推上来。
  const line = screen.top + screen.height * 0.42;
  const introBox = introRef.value?.getBoundingClientRect();
  const outroBox = outroRef.value?.getBoundingClientRect();
  let scene = 0;
  if (outroBox && outroBox.top <= line) {
    scene = scenes.length + 1;
  } else if (introBox && introBox.bottom <= line) {
    sceneEls.forEach((el, i) => {
      const box = el.getBoundingClientRect();
      if (box.top <= line && box.bottom > line) scene = i + 1;
    });
  }
  if (scene !== bgIndex.value) {
    bgIndex.value = scene;
    preloadAround(scene);
    scheduleSceneBg(scene);
  }
}

function onScroll() {
  if (!raf) raf = requestAnimationFrame(updateFocus);
}

function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    updateFocus();
  }, 140);
}

function attach() {
  if (attached) return;
  attached = true;
  scrollerEl = scrollerEl || rootRef.value?.parentElement || null;
  scrollerEl?.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  updateFocus();
}

function detach() {
  if (!attached) return;
  attached = false;
  scrollerEl?.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', onResize);
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

// 入口 / 出口的揭示与开场闪色。展位内容由 is-focus 控制，不在这里观察。
function observeScenes() {
  if (!('IntersectionObserver' in window)) {
    revealAll();
    startBurst();
    return;
  }
  const scroller = getScroller();
  sceneObserver?.disconnect();
  sceneObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      if (entry.target === introRef.value) {
        introSeen.value = true;
        preloadBgs();
        clearTimeout(burstFallback);
        burstFallback = setTimeout(startBurstOnce, 2200);
      } else if (entry.target === outroRef.value) {
        outroSeen.value = true;
      }
      sceneObserver.unobserve(entry.target);
    }
  }, { root: scroller, threshold: 0.32 });
  if (introRef.value) sceneObserver.observe(introRef.value);
  if (outroRef.value) sceneObserver.observe(outroRef.value);
}

// 卡片图只在靠近屏幕时生成；篇数多了也不会一次把整条走廊拉下来。
function observeCards() {
  const frames = rootRef.value?.querySelectorAll('[data-card-key]');
  if (!frames?.length) return;
  if (!('IntersectionObserver' in window)) {
    stations.forEach(loadCard);
    return;
  }
  const scroller = getScroller();
  cardObserver?.disconnect();
  cardObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const station = stations.find((item) => item.key === entry.target.dataset.cardKey);
      if (station) loadCard(station);
      cardObserver.unobserve(entry.target);
    }
  }, { root: scroller, rootMargin: '120% 0px' });
  frames.forEach((frame) => cardObserver.observe(frame));
}

onMounted(() => {
  scrollerEl = rootRef.value?.parentElement || null;
  // 从别的频道切回来时，舞台可能还留着上一次的 scrollTop
  if (scrollerEl) scrollerEl.scrollTop = 0;
  bgAnimating = false;
  appliedBgIndex = 0;
  pendingBgIndex = null;
  clearTimeout(bgSyncTimer);
  clearTimeout(bgSwapTimer);
  bgBase.value = bgUrl(introBgSrc);
  preloadAround(0);
  if (prefersReduced()) revealAll();
  attach();
  nextTick(() => {
    if (!prefersReduced()) observeScenes();
    observeCards();
    updateFocus();
  });
});

// keep-alive：每次回到 ME 都从走廊入口重新开始
onActivated(() => {
  scrollerEl = scrollerEl || rootRef.value?.parentElement || null;
  if (scrollerEl) scrollerEl.scrollTop = 0;
  bgRequestId += 1;
  bgAnimating = false;
  appliedBgIndex = 0;
  pendingBgIndex = null;
  clearTimeout(bgSyncTimer);
  clearTimeout(bgSwapTimer);
  bgIncomingOn.value = false;
  bgIncoming.value = '';
  bgBase.value = bgUrl(introBgSrc);
  bgIndex.value = 0;
  preloadAround(0);
  if (prefersReduced()) revealAll();
  attach();
  nextTick(() => {
    if (!prefersReduced()) observeScenes();
    observeCards();
    updateFocus();
  });
});

onDeactivated(() => {
  detach();
  stopBurst();
  sceneObserver?.disconnect();
  sceneObserver = null;
  cardObserver?.disconnect();
  cardObserver = null;
  bgRequestId += 1;
  bgAnimating = false;
  pendingBgIndex = null;
  clearTimeout(bgSyncTimer);
  clearTimeout(bgSwapTimer);
});

onBeforeUnmount(() => {
  detach();
  stopBurst();
  sceneObserver?.disconnect();
  sceneObserver = null;
  cardObserver?.disconnect();
  cardObserver = null;
  bgRequestId += 1;
  bgAnimating = false;
  pendingBgIndex = null;
  clearTimeout(bgSyncTimer);
  clearTimeout(bgSwapTimer);
  clearTimeout(resizeTimer);
});
</script>

<template>
  <section ref="rootRef" class="me-corridor" aria-label="The Corridor — echoes">
    <!-- 整屏底片：base 铺着上一张，incoming 从底部揭开下一张 ECHOES 封面 -->
    <div class="me-corridor__bg" aria-hidden="true">
      <span
        class="mc-bg-base"
        :style="{ backgroundImage: bgBase ? `url(${bgBase})` : 'none' }"
      />
      <span
        class="mc-bg-incoming"
        :class="{ 'is-on': bgIncomingOn, 'is-prep': bgIncomingPrep }"
        :style="{ backgroundImage: bgIncoming ? `url(${bgIncoming})` : 'none' }"
      />
    </div>

    <!-- 参考站的六栏网格：贯整条回廊，只是刻度，不承载点击 -->
    <div class="me-corridor__grid" aria-hidden="true">
      <i v-for="n in 6" :key="n" />
    </div>

    <!-- 00 入口 -->
    <header ref="introRef" class="mc-intro" :class="{ 'is-seen': introSeen }">
      <!-- 开场：ECHOES 封面硬切闪过，对应参考站开场那一下快速换图 -->
      <div class="mc-intro__burst" aria-hidden="true">
        <img
          v-for="(pool, i) in bgPool"
          v-show="burstIndex === i"
          :key="pool.key"
          :src="bgCache[pool.src]"
          alt=""
          decoding="async"
          draggable="false"
        >
      </div>

      <div class="mc-intro__top">
        <span>ME / ECHOES / CORRIDOR</span>
        <span>{{ pad(echoCount) }} ECHOES</span>
      </div>

      <div class="mc-intro__center">
        <p class="mc-intro__eyebrow"><i aria-hidden="true" />WHO ARE YOU / WHO I AM</p>
        <h2 class="mc-intro__title" aria-label="The Corridor">
          <span class="mc-intro__the" aria-hidden="true">THE</span>
          <span class="mc-intro__word" aria-hidden="true">
            <span
              v-for="(letter, i) in corridorLetters"
              :key="i"
              class="mc-glyph"
              :style="{ '--i': i }"
            ><span class="mc-glyph__inner">{{ letter }}</span></span>
          </span>
        </h2>
        <p class="mc-intro__note">
          <span>where are you my love?</span>
          <span>searching for meaning</span>
        </p>
      </div>

      <div class="mc-intro__bottom">
        <span class="mc-intro__cue">SCROLL TO WALK <i aria-hidden="true" /></span>
        <div class="mc-intro__profile">
          <p class="mc-intro__name">HUANG WEI LONG</p>
          <p class="mc-intro__tag">
            DREAMER &amp; IDEALIST<template v-if="virtue"> · BE {{ virtue }}</template>
          </p>
          <p v-if="lastUpdate" class="mc-intro__meta">LAST UPDATED · {{ lastUpdate }}</p>
          <blockquote v-if="quote">
            <span>“{{ quote }}”</span>
            <cite>— LIVE IN PASSION</cite>
          </blockquote>
        </div>
      </div>
    </header>

    <!-- 01..N 场：ECHOES 展位之间偶尔插一张整屏封面当间奏 -->
    <template v-for="(scene, si) in scenes" :key="scene.key">
      <article
        v-if="scene.type === 'echo'"
        class="mc-scene mc-station"
        :class="{
          'is-focus': focusIndex === si,
          'is-echo': scene.number % 2 === 0,
        }"
      >
        <div class="mc-station__top">
          <span>ECHO {{ pad(scene.number) }}</span>
          <span>{{ scene.category }}</span>
          <span>{{ scene.date }}</span>
        </div>

        <figure class="mc-frame" :data-card-key="scene.key">
          <div class="mc-frame__box">
            <div class="mc-frame__mask">
              <img
                v-if="images[scene.key]"
                class="mc-frame__img"
                :src="images[scene.key]"
                :alt="scene.alt"
                decoding="async"
                draggable="false"
              >
            </div>
          </div>
          <figcaption>
            <span>{{ scene.caption }}</span>
            <span>{{ scene.category }}</span>
          </figcaption>
        </figure>

        <div class="mc-copy">
          <p class="mc-copy__kicker">
            <i aria-hidden="true" />{{ scene.category }} / ECHO {{ pad(scene.number) }}
          </p>

          <h3 class="mc-copy__title" :aria-label="scene.title">
            <span
              v-for="(word, wi) in scene.words"
              :key="wi"
              class="mc-title__word"
              aria-hidden="true"
            >
              <span
                v-for="letter in word.letters"
                :key="letter.i"
                class="mc-title__letter"
              ><span class="mc-title__glyph" :style="{ '--i': letter.i }">{{ letter.ch }}</span></span>
            </span>
          </h3>

          <blockquote class="mc-copy__quote">
            <span
              v-for="(line, li) in scene.lines"
              :key="li"
              class="mc-copy__line"
              :style="{ '--i': li, '--dir': li % 2 === 0 ? '1' : '-1' }"
            >{{ line }}</span>
          </blockquote>

          <router-link :to="`/echoes/${scene.slug}`" class="mc-copy__link">
            READ THE ECHO <span aria-hidden="true">↗</span>
          </router-link>
        </div>

        <span class="mc-station__index" aria-hidden="true">{{ pad(scene.number) }}</span>
      </article>

      <article
        v-else
        class="mc-scene mc-cover"
        :class="{ 'is-focus': focusIndex === si }"
      >
        <div class="mc-cover__top">
          <span>INTERLUDE {{ pad(scene.number) }}</span>
          <span>{{ scene.category }}</span>
          <span>{{ scene.date }}</span>
        </div>
        <div class="mc-cover__center">
          <p class="mc-cover__eyebrow"><i aria-hidden="true" />ECHOES / COVER</p>
          <h3 class="mc-cover__title">{{ scene.title }}</h3>
        </div>
        <div class="mc-cover__bottom">
          <span>SCROLL</span>
          <span>{{ pad(echoCount) }} ECHOES</span>
        </div>
      </article>
    </template>

    <!-- 出口 -->
    <footer ref="outroRef" class="mc-outro" :class="{ 'is-seen': outroSeen }">
      <div class="mc-outro__top">
        <span>END OF THE CORRIDOR</span>
        <span>{{ pad(echoCount) }} / {{ pad(echoCount) }}</span>
      </div>

      <div class="mc-outro__center">
        <p class="mc-outro__eyebrow"><i aria-hidden="true" />KEEP WALKING</p>
        <h2 class="mc-outro__title" aria-label="Echoes">
          <span
            v-for="(letter, i) in outroLetters"
            :key="i"
            class="mc-glyph"
            :style="{ '--i': i }"
            aria-hidden="true"
          ><span class="mc-glyph__inner">{{ letter }}</span></span>
        </h2>
        <div class="mc-outro__links">
          <router-link to="/echoes" class="mc-outro__link">
            ALL ECHOES <span aria-hidden="true">↗</span>
          </router-link>
          <router-link to="/me/gallery" class="mc-outro__link">
            MY GALLERY <span aria-hidden="true">↗</span>
          </router-link>
        </div>
      </div>

      <p class="mc-outro__note">where are you my love?</p>
    </footer>

    <!-- 右侧进度轨：篇数多了就不铺 59 个按钮，只留进度与当前场次 -->
    <div class="me-corridor__rail">
      <div class="me-corridor__rail-inner">
        <span class="me-corridor__rail-line" aria-hidden="true">
          <i />
        </span>
        <span class="me-corridor__rail-label">{{ railLabel }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* ── 走廊底座 ─────────────────────────────────────────────────────────── */
.me-corridor {
  --mc-ink: #050607;
  --mc-paper: #f4f0e8;
  /* 整屏背景是 ECHOES 的黑白底片，UI 重音统一用纸白 */
  --mc-accent: var(--mc-paper);
  /* 单位全部改成容器单位：这里的一屏是电视屏幕内部那一格，
     不是浏览器视口。cqw / cqh 相对 .me-tv__channel-stage.is-walk。 */
  --mc-pad-x: clamp(18px, 4.6cqw, 84px);
  --mc-ease: cubic-bezier(0.6, 0.14, 0, 1);

  position: relative;
  z-index: 1;
  width: 100%;
  /* main.css 给所有 section 写了 overflow-x: hidden；这里放开，
     右侧编号轨要能贴到视口边缘。 */
  overflow: visible;
  background: var(--mc-ink);
  color: var(--mc-paper);
}

/* ── 整屏色块：换场遮罩 ───────────────────────────────────────────────── */
.me-corridor__bg {
  /* 不占文档流：负 margin 把自己的高度抵掉，只留下贴着屏幕的 sticky 色层 */
  position: sticky;
  top: 0;
  z-index: 0;
  height: 100cqh;
  margin-bottom: -100cqh;
  overflow: hidden;
  pointer-events: none;
}

.mc-bg-base,
.mc-bg-incoming {
  position: absolute;
  inset: 0;
  background-color: var(--mc-ink);
  background-position: center;
  background-size: cover;
  filter: grayscale(1) contrast(1.12) brightness(0.58);
}

.mc-bg-base {
  z-index: 0;
}

.mc-bg-incoming {
  z-index: 1;
  /* 干净的直线遮罩：从底部整条推上来，不做羽化、不做透明叠化 */
  clip-path: inset(100% 0 0 0);
  transition: clip-path 1.15s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: clip-path;
}

.mc-bg-incoming.is-on {
  clip-path: inset(0 0 0 0);
}

/* 连续换场前的静默复位：不要过渡，先把遮罩收回 100% */
.mc-bg-incoming.is-prep {
  transition: none;
}

/* 暗罩压在两层底片之上，保证纸白字始终压得住 */
.me-corridor__bg::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 2;
  background: rgba(5, 6, 7, 0.72);
}

/* ── 六栏刻度 ─────────────────────────────────────────────────────────── */
.me-corridor__grid {
  position: absolute;
  inset: 0;
  /* 参考站的网格压在所有内容之上；线本身很淡，不抢图 */
  z-index: 4;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  padding: 0 var(--mc-pad-x);
  pointer-events: none;
}

.me-corridor__grid i {
  border-left: 1px solid rgba(244, 240, 232, 0.07);
}

.me-corridor__grid i:last-child {
  border-right: 1px solid rgba(244, 240, 232, 0.07);
}

/* ── 入口 / 场景 / 出口公共 ───────────────────────────────────────────── */
.mc-intro,
.mc-scene,
.mc-outro {
  position: relative;
  z-index: 1;
  min-height: 620px;
  /* 一屏 = 电视屏幕的高度；内容更高时允许被撑开，屏幕内部继续滚 */
  min-height: 100cqh;
}

/* 标题逐字从遮罩里升起：入口与出口共用。
   line-height 不能压到 0.8 以下，否则 Oswald 的字母上下缘会被遮罩切掉。 */
.mc-glyph {
  display: inline-block;
  overflow: hidden;
  vertical-align: top;
  line-height: 0.98;
}

.mc-glyph__inner {
  display: inline-block;
  transform: translateY(115%);
  opacity: 0;
  transition:
    transform 1.25s cubic-bezier(0.19, 1, 0.22, 1),
    opacity 0.9s ease;
  transition-delay: calc(var(--i, 0) * 42ms + 120ms);
}

.is-seen .mc-glyph__inner {
  transform: translateY(0);
  opacity: 1;
}

/* ── 入口 ─────────────────────────────────────────────────────────────── */
.mc-intro {
  display: flex;
  flex-direction: column;
  /* main.css 里有一条全局 header {}：display:flex + align-items:center。
     不显式拉回 stretch，入口这一屏的标题、上下两行会被缩到内容宽度再居中。 */
  align-items: stretch;
  justify-content: space-between;
  padding: clamp(30px, 6.2cqh, 64px) var(--mc-pad-x) clamp(26px, 5cqh, 52px);
}

/* 开场的切图层：ECHOES 封面硬切、去色、压暗；字始终在它上面 */
.mc-intro__burst {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

.mc-intro__burst img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: grayscale(1) contrast(1.12) brightness(0.6);
  opacity: 0.9;
}

.mc-intro__burst::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(5, 6, 7, 0.6);
}

.mc-intro__top,
.mc-intro__center,
.mc-intro__bottom {
  position: relative;
  z-index: 1;
}

.mc-intro__top,
.mc-outro__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(244, 240, 232, 0.16);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgba(244, 240, 232, 0.46);
}

.mc-intro__top span,
.mc-intro__bottom span {
  opacity: 0;
  transform: translateY(10px);
  transition:
    opacity 0.9s ease,
    transform 1.1s cubic-bezier(0.19, 1, 0.22, 1);
}

.mc-intro.is-seen .mc-intro__top span,
.mc-intro.is-seen .mc-intro__bottom span {
  opacity: 1;
  transform: none;
}

.mc-intro.is-seen .mc-intro__top span:nth-child(2),
.mc-intro.is-seen .mc-intro__bottom span:nth-child(2) {
  transition-delay: 0.12s;
}

.mc-intro__center {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: clamp(8px, 1.8cqh, 18px);
  margin: auto 0;
}

.mc-intro__eyebrow,
.mc-outro__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgba(244, 240, 232, 0.58);
}

.mc-intro__eyebrow i,
.mc-outro__eyebrow i,
.mc-copy__kicker i {
  display: block;
  width: 5px;
  height: 5px;
  background: var(--mc-accent);
}

.mc-intro__title {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin: 0;
  font-family: 'Oswald', sans-serif;
  font-weight: 700;
  line-height: 0.8;
  letter-spacing: -0.02em;
  text-transform: uppercase;
}

.mc-intro__the {
  margin-left: 0.24em;
  font-size: clamp(0.7rem, 1.6cqw, 1.4rem);
  letter-spacing: 0.46em;
  color: rgba(244, 240, 232, 0.44);
  opacity: 0;
  transform: translateY(12px);
  transition:
    opacity 0.9s ease 0.45s,
    transform 1.1s cubic-bezier(0.19, 1, 0.22, 1) 0.45s;
}

.mc-intro.is-seen .mc-intro__the {
  opacity: 1;
  transform: none;
}

.mc-intro__word {
  display: flex;
  margin-top: 0.06em;
  font-size: clamp(2.6rem, 11cqw, 9.5rem);
}

.mc-intro__note {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem 1.6rem;
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(244, 240, 232, 0.4);
  opacity: 0;
  transform: translateY(14px);
  transition:
    opacity 0.9s ease 0.6s,
    transform 1.1s cubic-bezier(0.19, 1, 0.22, 1) 0.6s;
}

.mc-intro.is-seen .mc-intro__note {
  opacity: 1;
  transform: none;
}

.mc-intro__bottom {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
}

.mc-intro__cue {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgba(244, 240, 232, 0.6);
}

.mc-intro__cue i {
  position: relative;
  display: block;
  width: 1px;
  height: 34px;
  overflow: hidden;
  background: rgba(244, 240, 232, 0.18);
}

.mc-intro__cue i::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--mc-paper);
  animation: mc-cue 1.8s cubic-bezier(0.6, 0.14, 0, 1) infinite;
}

/* 入口右下角的身份块：沿用原来 ME 频道里的名字 / 人格 / 最后更新 / 引言 */
.mc-intro__profile {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  max-width: 26rem;
  text-align: right;
}

.mc-intro__name {
  margin: 0;
  font-family: 'Oswald', sans-serif;
  font-weight: 600;
  font-size: clamp(0.85rem, 1.4cqw, 1.15rem);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(244, 240, 232, 0.82);
}

.mc-intro__tag,
.mc-intro__meta {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 7.5px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(244, 240, 232, 0.42);
}

.mc-intro__profile blockquote {
  max-width: 24rem;
  margin: 9px 0 0;
  padding-right: 10px;
  border-right: 1px solid rgba(244, 240, 232, 0.28);
  font-family: 'Poppins', sans-serif;
  font-weight: 300;
  font-size: clamp(0.66rem, 0.86cqw, 0.8rem);
  line-height: 1.5;
  color: rgba(244, 240, 232, 0.56);
}

.mc-intro__profile cite {
  display: block;
  margin-top: 4px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-style: normal;
  font-size: 6.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(244, 240, 232, 0.34);
}

@keyframes mc-cue {
  0% { transform: translateY(-100%); }
  55%, 100% { transform: translateY(100%); }
}

/* ── 展位 ─────────────────────────────────────────────────────────────── */
.mc-station {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  align-items: center;
  gap: clamp(20px, 3.6cqw, 72px);
  padding: clamp(58px, 10.5cqh, 104px) var(--mc-pad-x) clamp(40px, 7.5cqh, 76px);
  border-top: 1px solid rgba(244, 240, 232, 0.1);
}

/* 双数位镜像：字在左、窗在右 —— 一屏一站地交错下去 */
.mc-station.is-echo {
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
}

.mc-station.is-echo .mc-frame {
  order: 2;
  justify-self: start;
}

.mc-station.is-echo .mc-copy {
  order: 1;
  justify-self: end;
}

.mc-station__top {
  position: absolute;
  top: clamp(26px, 5.4cqh, 56px);
  left: var(--mc-pad-x);
  right: var(--mc-pad-x);
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 1rem;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(244, 240, 232, 0.14);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(244, 240, 232, 0.42);
}

.mc-station__top span {
  opacity: 0;
  transform: translateY(8px);
  transition:
    opacity 0.8s ease,
    transform 0.9s cubic-bezier(0.19, 1, 0.22, 1);
}

.mc-station.is-focus .mc-station__top span {
  opacity: 1;
  transform: none;
}

.mc-station.is-focus .mc-station__top span:nth-child(2) { transition-delay: 0.08s; }
.mc-station.is-focus .mc-station__top span:nth-child(3) { transition-delay: 0.16s; }

.mc-station__top span:nth-child(2) {
  color: rgba(244, 240, 232, 0.7);
}

.mc-station__top span:last-child {
  text-align: right;
}

/* 色块：先由下方幕布揭开，再从 1.12 倍回落到 1。
   原站的卡片就是这套 clip-path + scale 的两段式，只是画面换成纯色。 */
.mc-frame {
  position: relative;
  z-index: 2;
  justify-self: end;
  width: min(26cqw, 56cqh);
  margin: 0;
  /* 参考站的非当前成员卡：缩到 0.4 并淡出；只有当前展位把照片推到 1 */
  opacity: 0;
  transform: scale(0.4);
  transition:
    opacity 1.1s ease,
    transform 1.7s var(--mc-ease);
}

.mc-station.is-focus .mc-frame {
  opacity: 1;
  transform: scale(1);
}

.mc-frame__box {
  position: relative;
  aspect-ratio: 341 / 428;
  border: 1px solid rgba(244, 240, 232, 0.18);
  background: #0b0d0e;
}

/* 左上角那颗点：窗的“通电”指示灯 */
.mc-frame__box::before {
  content: '';
  position: absolute;
  z-index: 4;
  top: -1px;
  left: -1px;
  width: 5px;
  height: 5px;
  background: var(--mc-paper);
  box-shadow: 0 0 0 1px rgba(5, 6, 7, 0.35);
}

.mc-frame__mask {
  position: absolute;
  inset: 0;
  overflow: hidden;
  clip-path: inset(100% 0 0 0);
  transition: clip-path 1.7s var(--mc-ease) 0.08s;
}

.mc-station.is-focus .mc-frame__mask {
  clip-path: inset(0 0 0 0);
}

/* 卡片照片：从 1.55 倍回落到 1，和幕布揭开的 1.7s 错开 */
.mc-frame__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: grayscale(0.3) contrast(1.06) brightness(0.9);
  transform: scale(1.55);
  transition:
    transform 2s var(--mc-ease),
    filter 0.6s ease;
}

.mc-station.is-focus .mc-frame__img {
  transform: scale(1);
}

.mc-station.is-focus .mc-frame:hover .mc-frame__img {
  filter: grayscale(0) contrast(1.02) brightness(1);
  transform: scale(1.03);
}

.mc-frame figcaption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 7.5px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(244, 240, 232, 0.42);
  opacity: 0;
  transform: translateX(-18px);
  transition:
    opacity 0.9s ease 0.35s,
    transform 1.1s cubic-bezier(0.19, 1, 0.22, 1) 0.35s;
}

.mc-station.is-focus .mc-frame figcaption {
  opacity: 1;
  transform: none;
}

/* ── 字块 ─────────────────────────────────────────────────────────────── */
.mc-copy {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  max-width: 36rem;
  min-width: 0;
  /* 参考站只在当前成员里写字；离开视线的整块文字退掉 */
  opacity: 0;
  transition: opacity 0.8s ease;
}

.mc-station.is-focus .mc-copy {
  opacity: 1;
}

.mc-copy__kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgba(244, 240, 232, 0.56);
  opacity: 0;
  transform: translateX(-26px);
  transition:
    opacity 0.9s ease,
    transform 1.1s cubic-bezier(0.19, 1, 0.22, 1);
}

.mc-station.is-focus .mc-copy__kicker {
  opacity: 1;
  transform: none;
}

.mc-copy__title {
  margin: clamp(6px, 1.2cqh, 14px) 0 0;
  font-family: 'Oswald', sans-serif;
  font-weight: 700;
  font-size: clamp(1.4rem, 4.2cqw, 3.6rem);
  /* 遮罩行高留一点余量，长标题与字母上下缘都不会被切 */
  line-height: 1.02;
  letter-spacing: -0.012em;
  text-transform: uppercase;
  overflow-wrap: anywhere;
}

.mc-title__word {
  display: inline-block;
  max-width: 100%;
  margin-right: 0.24em;
  white-space: normal;
}

.mc-title__letter {
  display: inline-block;
  overflow: hidden;
  vertical-align: top;
  line-height: 1.02;
}

.mc-title__glyph {
  display: inline-block;
  line-height: 1.02;
  transform: translateY(112%);
  opacity: 0;
  transition:
    transform 1.2s cubic-bezier(0.19, 1, 0.22, 1),
    opacity 0.8s ease;
  transition-delay: calc(var(--i, 0) * 24ms + 120ms);
}

.mc-station.is-focus .mc-title__glyph {
  transform: translateY(0);
  opacity: 1;
}

/* 参考站那种字上的“噪声”：指到标题时，每个字母按自己的相位轻轻抖 */
.mc-copy__title:hover .mc-title__glyph,
.mc-intro__title:hover .mc-glyph__inner {
  animation: mc-letter-noise 0.62s steps(2, end) infinite;
  animation-delay: calc(var(--i, 0) * -31ms);
}

@keyframes mc-letter-noise {
  0%, 100% { transform: translateY(0); opacity: 1; }
  36% { transform: translateY(-0.03em) skewX(2deg); opacity: 0.62; }
  72% { transform: translateY(0.02em) skewX(-1deg); opacity: 0.9; }
}

.mc-copy__quote {
  display: flex;
  flex-direction: column;
  gap: 0.18em;
  margin: clamp(10px, 1.7cqh, 20px) 0 0;
  padding-left: 12px;
  border-left: 1px solid rgba(244, 240, 232, 0.24);
  font-family: 'Poppins', sans-serif;
  font-weight: 300;
  font-size: clamp(0.72rem, 0.95cqw, 0.92rem);
  line-height: 1.55;
  color: rgba(244, 240, 232, 0.62);
}

/* 说明行左右交错：奇数行从右、偶数行从左，像原站成员资料那几行 */
.mc-copy__line {
  display: block;
  opacity: 0;
  transform: translateX(calc(var(--dir, 1) * 34px));
  transition:
    opacity 0.9s ease,
    transform 1.05s cubic-bezier(0.19, 1, 0.22, 1);
  transition-delay: calc(var(--i, 0) * 110ms + 260ms);
}

.mc-station.is-focus .mc-copy__line {
  opacity: 1;
  transform: none;
}

.mc-copy__link {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  position: relative;
  margin-top: clamp(10px, 1.8cqh, 22px);
  padding-bottom: 4px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  text-decoration: none;
  color: rgba(244, 240, 232, 0.78);
  opacity: 0;
  transform: translateY(16px);
  transition:
    opacity 0.9s ease 0.42s,
    transform 1.05s cubic-bezier(0.19, 1, 0.22, 1) 0.42s,
    color 0.25s ease;
}

.mc-station.is-focus .mc-copy__link {
  opacity: 1;
  transform: none;
}

/* 参考站的悬停：底线平时只留 20%，指上去从左拉满 */
.mc-copy__link::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 1px;
  background: currentColor;
  transform: scaleX(0.2);
  transform-origin: 0% 100%;
  transition: transform 0.8s cubic-bezier(0.35, 0.42, 0, 1);
}

.mc-copy__link:hover {
  color: var(--mc-paper);
}

.mc-copy__link:hover::after {
  transform: scaleX(1);
  background: var(--mc-accent);
}

.mc-copy__link span {
  transition: transform 0.25s ease;
}

.mc-copy__link:hover span {
  transform: translate(2px, -2px);
}

/* 背后那枚巨大的编号：只描边，压到最低的对比度 */
.mc-station__index {
  position: absolute;
  right: 1.5vw;
  bottom: 2cqh;
  z-index: 1;
  font-family: 'Oswald', sans-serif;
  font-weight: 700;
  font-size: min(22cqw, 38cqh);
  line-height: 0.72;
  letter-spacing: -0.04em;
  color: transparent;
  -webkit-text-stroke: 1px rgba(244, 240, 232, 0.1);
  /* 不吃屏幕总的红/蓝色散：编号只留中性的描边，别再跑出参考站那种红紫 */
  text-shadow: none;
  pointer-events: none;
  user-select: none;
  opacity: 0;
  transition: opacity 1.2s ease 0.2s;
}

.mc-station.is-focus .mc-station__index {
  opacity: 1;
}

.mc-station.is-echo .mc-station__index {
  right: auto;
  left: 1.5vw;
}

/* ── 间奏封面：两张展位之间的一整张 ECHOES 封面 ─────────────────────── */
.mc-cover {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: clamp(30px, 6.2cqh, 64px) var(--mc-pad-x) clamp(26px, 5cqh, 52px);
  border-top: 1px solid rgba(244, 240, 232, 0.1);
  text-align: left;
}

.mc-cover__top,
.mc-cover__bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgba(244, 240, 232, 0.46);
  opacity: 0;
  transform: translateY(10px);
  transition:
    opacity 0.8s ease,
    transform 0.9s cubic-bezier(0.19, 1, 0.22, 1);
}

.mc-cover__top {
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(244, 240, 232, 0.16);
}

.mc-cover__bottom {
  padding-top: 12px;
  border-top: 1px solid rgba(244, 240, 232, 0.16);
}

.mc-cover__center {
  width: 100%;
  max-width: 92%;
  margin: auto 0;
}

.mc-cover__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgba(244, 240, 232, 0.58);
}

.mc-cover__eyebrow i {
  display: block;
  width: 5px;
  height: 5px;
  background: var(--mc-accent);
}

.mc-cover__title {
  margin: clamp(10px, 1.6cqh, 18px) 0 0;
  font-family: 'Oswald', sans-serif;
  font-weight: 700;
  font-size: clamp(2rem, 8cqw, 7rem);
  line-height: 1.02;
  letter-spacing: -0.02em;
  text-transform: uppercase;
  text-wrap: balance;
  color: var(--mc-paper);
  /* 从下往上像幕布一样揭开 */
  clip-path: inset(100% 0 0 0);
  opacity: 0;
  transition:
    clip-path 1.5s var(--mc-ease) 0.1s,
    opacity 0.9s ease 0.1s;
}

.mc-cover.is-focus .mc-cover__top,
.mc-cover.is-focus .mc-cover__bottom {
  opacity: 1;
  transform: none;
}

.mc-cover.is-focus .mc-cover__title {
  clip-path: inset(0 0 0 0);
  opacity: 1;
}

/* ── 出口 ─────────────────────────────────────────────────────────────── */
.mc-outro {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: clamp(30px, 6.2cqh, 64px) var(--mc-pad-x) clamp(26px, 5cqh, 52px);
  border-top: 1px solid rgba(244, 240, 232, 0.1);
  /* 全局 footer {} 带 text-align: center；这一屏的落款要贴左 */
  text-align: left;
}

.mc-outro__center {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: clamp(14px, 2vh, 24px);
  margin: auto 0;
}

.mc-outro__title {
  display: flex;
  margin: 0;
  font-family: 'Oswald', sans-serif;
  font-weight: 700;
  font-size: clamp(2.4rem, 11cqw, 10rem);
  line-height: 0.8;
  letter-spacing: -0.03em;
  text-transform: uppercase;
}

.mc-outro__links {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: clamp(8px, 1.4vh, 16px);
  opacity: 0;
  transform: translateY(20px);
  transition:
    opacity 0.9s ease 0.45s,
    transform 1.1s cubic-bezier(0.19, 1, 0.22, 1) 0.45s;
}

.mc-outro.is-seen .mc-outro__links {
  opacity: 1;
  transform: none;
}

.mc-outro__link {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  padding: 11px 16px;
  border: 1px solid rgba(244, 240, 232, 0.3);
  border-radius: 0;
  background: transparent;
  color: var(--mc-paper);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.25s ease, color 0.25s ease, border-color 0.25s ease;
}

.mc-outro__link:hover {
  background: var(--mc-paper);
  border-color: var(--mc-paper);
  color: var(--mc-ink);
}

.mc-outro__link span {
  transition: transform 0.25s ease;
}

.mc-outro__link:hover span {
  transform: translate(2px, -2px);
}

.mc-outro__note {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(244, 240, 232, 0.36);
  opacity: 0;
  transform: translateY(12px);
  transition:
    opacity 0.9s ease 0.55s,
    transform 1.1s cubic-bezier(0.19, 1, 0.22, 1) 0.55s;
}

.mc-outro.is-seen .mc-outro__note {
  opacity: 1;
  transform: none;
}

/* ── 右侧编号轨 ───────────────────────────────────────────────────────── */
.me-corridor__rail {
  position: absolute;
  z-index: 5;
  top: 0;
  bottom: 0;
  right: clamp(8px, 1.4vw, 20px);
  width: 24px;
  pointer-events: none;
}

.me-corridor__rail-inner {
  position: sticky;
  top: 50cqh;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  pointer-events: auto;
}

.me-corridor__rail-line {
  position: absolute;
  top: -18px;
  bottom: -18px;
  left: 50%;
  width: 1px;
  background: rgba(244, 240, 232, 0.12);
}

.me-corridor__rail-line i {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--mc-accent);
  transform: scaleY(var(--mc-progress, 0));
  transform-origin: 50% 0;
}

.me-corridor__rail-label {
  position: relative;
  z-index: 1;
  padding: 7px 2px;
  background: rgba(5, 6, 7, 0.72);
  writing-mode: vertical-rl;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 7px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(244, 240, 232, 0.72);
  white-space: nowrap;
}

/* ── 响应式 ───────────────────────────────────────────────────────────── */
@media (max-width: 1100px) {
  .mc-station {
    gap: 20px;
    padding-left: clamp(16px, 3.4cqw, 48px);
    padding-right: clamp(16px, 3.4cqw, 48px);
  }

  .mc-frame {
    width: min(28cqw, 52cqh);
  }

  .mc-copy__title {
    font-size: clamp(1.3rem, 3.8cqw, 3rem);
  }
}

@media (max-width: 900px) {
  .me-corridor {
    --mc-pad-x: 16px;
  }

  .mc-intro,
  .mc-outro {
    padding: clamp(26px, 6cqh, 54px) 16px clamp(22px, 5cqh, 44px);
  }

  .mc-intro__word {
    font-size: clamp(2rem, 14cqw, 4.6rem);
  }

  .mc-intro__note {
    flex-direction: column;
    gap: 0.35rem;
  }

  .mc-intro__bottom {
    gap: 0.8rem;
  }

  .mc-intro__profile {
    max-width: 60%;
  }

  .mc-intro__profile blockquote {
    display: none;
  }

  .mc-station,
  .mc-station.is-echo {
    grid-template-columns: minmax(0, 1fr);
    align-content: center;
    gap: 12px;
    padding: clamp(52px, 10cqh, 84px) 16px clamp(36px, 7cqh, 64px);
  }

  /* 手机上统一“窗在上、字在下”，不再左右镜像 */
  .mc-station.is-echo .mc-frame,
  .mc-station.is-echo .mc-copy {
    order: 0;
    justify-self: start;
  }

  .mc-frame {
    justify-self: center;
    width: min(62cqw, 42cqh);
  }

  .mc-copy {
    max-width: none;
  }

  .mc-copy__title {
    margin-top: 6px;
    font-size: clamp(1.1rem, 5.8cqw, 2rem);
  }

  .mc-copy__quote {
    margin-top: 10px;
    font-size: 0.74rem;
    line-height: 1.5;
  }

  .mc-copy__link {
    margin-top: 12px;
  }

  .mc-station__top {
    top: clamp(26px, 5.4cqh, 48px);
    left: 16px;
    right: 16px;
    grid-template-columns: auto 1fr auto;
    font-size: 7px;
    letter-spacing: 0.14em;
  }

  .mc-station__top span:nth-child(2) {
    justify-self: end;
    margin-right: 10px;
  }

  .mc-station__index {
    font-size: 34cqw;
    bottom: 1cqh;
  }

  .mc-outro__links {
    width: 100%;
  }

  .mc-outro__link {
    flex: 1 1 auto;
    justify-content: center;
  }

  /* 手机上不挂悬浮编号轨，避免压住文字 */
  .me-corridor__rail {
    display: none;
  }
}

@media (max-width: 520px) {
  .mc-frame {
    width: min(70cqw, 40cqh);
  }

  .mc-copy__title {
    font-size: clamp(1.05rem, 6cqw, 1.7rem);
  }

  .mc-copy__kicker {
    font-size: 7px;
  }

  .mc-intro__bottom {
    align-items: flex-start;
    flex-direction: column;
    gap: 0.6rem;
  }

  .mc-intro__profile {
    max-width: 100%;
    align-items: flex-start;
    text-align: left;
  }
}

/* 矮屏幕：先保证一屏装得下，再谈细节 */
@media (max-height: 620px) {
  .mc-station {
    padding-top: clamp(48px, 9cqh, 70px);
    padding-bottom: clamp(30px, 6cqh, 52px);
    gap: 10px;
  }

  .mc-copy__quote {
    display: none;
  }

  .mc-copy__title {
    font-size: clamp(1.05rem, 3.4cqw, 1.8rem);
  }

  .mc-frame {
    width: min(28cqw, 38cqh);
  }

  .mc-station__top {
    top: clamp(24px, 5cqh, 44px);
  }

  .mc-intro,
  .mc-outro {
    padding-top: clamp(24px, 5cqh, 50px);
    padding-bottom: clamp(20px, 4cqh, 40px);
  }
}

/* ── reduced-motion：所有揭示直接落到终态，编号轨收起 ─────────────────── */
@media (prefers-reduced-motion: reduce) {
  .me-corridor__rail {
    display: none;
  }

  .mc-glyph__inner,
  .mc-intro__the,
  .mc-intro__note,
  .mc-intro__top span,
  .mc-intro__bottom span,
  .mc-station__top span,
  .mc-title__glyph,
  .mc-copy__kicker,
  .mc-copy__line,
  .mc-copy,
  .mc-copy__link,
  .mc-frame,
  .mc-frame figcaption,
  .mc-station__index,
  .mc-outro__links,
  .mc-outro__note {
    opacity: 1 !important;
    transform: none !important;
  }

  .mc-frame__mask {
    clip-path: inset(0 0 0 0) !important;
    opacity: 1 !important;
  }

  .mc-frame__img {
    transform: none !important;
  }

  .mc-bg-incoming {
    transition: none !important;
  }

  .mc-cover__top,
  .mc-cover__bottom,
  .mc-cover__title {
    opacity: 1 !important;
    transform: none !important;
    clip-path: none !important;
  }

  .mc-intro__burst {
    display: none !important;
  }

  .mc-intro__cue i::after {
    animation: none;
  }
}
</style>
