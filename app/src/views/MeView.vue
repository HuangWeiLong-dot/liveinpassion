<script setup>
// ME 页：一条纵向滚动叙事，最后落在一台复古电视机上。
//
//   0. 进来先停在一张 EXPLORE 屏上：背景照片**一开始是隐藏的**，点击 EXPLORE
//      之后才逐张浮现（近处先出现、远处后出现），浮现完镜头才开始向前推进。
//      点击之前滚动被锁住，页面停在起点。
//   1. 隧道舞台 sticky 在整个 main 的顶部：30 张照片各自在 3D 空间里有一个
//      X/Y 偏移和深度 z（-5000 … +500）。滚动时 z 整体一次性推进 10000px。
//      每张照片是一张被风吹着的纸片：不同初始倾角、各自的风向漂移、持续扇动
//      + skew，加上不规则摆动的旗帜轮廓，从不同角度翻进镜头，不再循环重置。
//   2. 照片全部飞出去之后，一台**方角复古 CRT 电视机**平滑浮上来：ME / GALLERY /
//      FRIENDS 是屏幕内的三个频道，首屏只播 ME，底部按钮切换；切换时出现雪花
//      花屏 + 横向撕裂的故障效果。机身是中性灰塑料，上沿右侧写着
//      where are you my love? / searching for meaning，下沿只保留有实际功能的按键。
//   3. 这一页不挂全局页脚：固定页脚会和 sticky 舞台的行程打架。
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

// 电视里的三个频道：首屏只放 ME，下面的频道按钮负责切换
const CHANNELS = [
  { id: 'me', label: 'ME' },
  { id: 'gallery', label: 'GALLERY' },
  { id: 'friends', label: 'FRIENDS' },
];
const activeChannel = ref(0);
const switching = ref(false);

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
// 整页滚完推进 10000px：最远的一张（-5000）在约 55% 进度时也飞过镜头了，
// 之后画面里不会再有照片，复古电视机才开始升上来。
const TRAVEL = 10000;

const travelPercent = ref(0);
let travelPctLast = -1;

const cardStates = Array.from({ length: TUNNEL_CARD_COUNT }, () => {
  const state = {
    x: 0,
    y: 0,
    baseZ: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    revealDelay: 0,
    flutterAmp: 0,
    flutterSpeed: 0,
    flutterPhase: 0,
    windAngle: 0,
    windPower: 0,
  };
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
  if (initial) {
    state.baseZ = -500 - Math.random() * 4500;
    // 浮现顺序按深度错开：离镜头越近越早出现（远处最后从黑暗里浮出来）
    const depth = (state.baseZ - Z_FAR) / (0 - Z_FAR); // 0 最远 → 1 最近
    state.revealDelay = Math.min(0.55, (1 - depth) * 0.55);

    // 纸片姿态：每张卡从不同角度翻进来，不是正面平推
    state.rx = (Math.random() - 0.5) * 20;
    state.ry = (Math.random() - 0.5) * 26;
    state.rz = (Math.random() - 0.5) * 12;

    // 每张纸有自己的风速 / 相位 / 风向，推进时不会整齐划一地摆动
    state.flutterAmp = 5 + Math.random() * 4.5;
    state.flutterSpeed = 0.55 + Math.random() * 0.9;
    state.flutterPhase = Math.random() * Math.PI * 2;
    state.windAngle = Math.random() * Math.PI * 2;
    state.windPower = 3 + Math.random() * 5;
  }
}

let tunnelProgress = 0;
let tunnelTween = null;
let tunnelProxy = null;
// 点 EXPLORE 之后的一小段「阵风」：风速先大后小，照片像被吹起来
let windGustStart = 0;

// 开场浮现：0 → 1。未点 EXPLORE 时保持 0，照片完全不出现。
const TUNNEL_REVEAL_SECONDS = 1.5;
const tunnelReveal = { v: 0 };
let tunnelRevealTween = null;

function killRevealTween() {
  if (tunnelRevealTween) {
    tunnelRevealTween.kill();
    tunnelRevealTween = null;
  }
}

function renderTunnel(progress) {
  tunnelProgress = progress;
  const travel = progress * TRAVEL;
  const reveal = tunnelReveal.v;
  const now = performance.now();
  const t = now / 1000;
  const gustAge = windGustStart ? now - windGustStart : 9999;
  const gust = 1 + Math.max(0, 1 - gustAge / 1800) * 0.55;

  for (let i = 0; i < cardStates.length; i += 1) {
    const el = cardEls[i];
    if (!el) continue;
    const state = cardStates[i];

    // 一次性推进：不循环、不重置。所有照片一路飞出镜头，
    // 飞过 500px 之后就不再回来（滚动往回才按同一条轨迹倒放）。
    const rawZ = state.baseZ + travel;
    const z = Math.min(rawZ, Z_NEAR);
    // 0 → 500 之间淡出，越贴近镜头越透明
    const baseOpacity = rawZ > 0 ? Math.max(0, 1 - rawZ / Z_NEAR) : 1;

    // 每张照片按自己的深度错开浮现；easeInOut 让出现不是线性淡入
    const delay = state.revealDelay || 0;
    const local = delay >= 0.999
      ? 1
      : Math.max(0, Math.min(1, (reveal - delay) / (1 - delay)));
    const eased = local * local * (3 - 2 * local);
    const opacity = baseOpacity * eased;
    const scale = 0.88 + 0.12 * eased;

    // 风感：时间相位 + 每张纸自己的风向，旗帜式来回扇动 + 横向剪切
    const flutter = Math.sin(t * state.flutterSpeed + state.flutterPhase);
    const flutterB = Math.cos(t * state.flutterSpeed * 0.77 + state.flutterPhase);
    const flutterC = Math.sin(t * state.flutterSpeed * 1.6 + state.flutterPhase * 1.3);
    const amp = state.flutterAmp * gust;
    const windDriftX = Math.cos(state.windAngle) * progress * state.windPower;
    const windDriftY = Math.sin(state.windAngle) * progress * state.windPower;
    const swayX = Math.sin(t * 0.62 + state.flutterPhase) * 1.4;
    const swayY = Math.cos(t * 0.51 + state.flutterPhase * 1.2) * 1.1;
    const rx = state.rx + flutter * amp;
    const ry = state.ry + flutterB * amp * 1.15;
    const rz = state.rz + flutter * amp * 0.7;
    // 像旗面被风扯动：整张纸做一点 skew，再配合 3D 倾倒和风向漂移
    const skewY = flutterC * (amp * 0.6);
    const skewX = flutterB * (amp * 0.25);
    const liftZ = Math.sin(t * 0.9 + state.flutterPhase) * 14;

    el.style.transform = `translate(-50%, -50%) translate3d(${(state.x + windDriftX + swayX).toFixed(2)}vw, ${(state.y + windDriftY + swayY).toFixed(2)}vw, ${(z + liftZ).toFixed(1)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg) skewY(${skewY.toFixed(2)}deg) skewX(${skewX.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
    el.style.opacity = opacity.toFixed(3);
    el.style.visibility = opacity < 0.002 ? 'hidden' : 'visible';

    // 不规则的旗帜轮廓：上下边缘轻微起伏，右侧自由边随时间摆动
    if (opacity > 0.01) {
      const clipPhase = t * 2.1 + state.flutterPhase;
      const clip = ['0% 0%'];
      for (let k = 1; k <= 4; k += 1) {
        const x = k * 25;
        const y = Math.sin(clipPhase + k * 0.8) * 1.2;
        clip.push(`${x}% ${y.toFixed(2)}%`);
      }
      for (let k = 1; k <= 6; k += 1) {
        const y = (k * 100) / 7;
        const x = 100 - 1.5 - Math.sin(clipPhase + k * 1.15) * 3.5;
        clip.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
      }
      clip.push('100% 100%');
      for (let k = 3; k >= 1; k -= 1) {
        const x = k * 25;
        const y = 100 + Math.sin(clipPhase + k * 0.7) * 1.2;
        clip.push(`${x}% ${y.toFixed(2)}%`);
      }
      clip.push('0% 100%');
      el.style.clipPath = `polygon(${clip.join(', ')})`;
    }

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

  // 触发器是整页：窗口阶段背景里的照片也还在继续飞（只是被压暗了）。
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

// ── 复古电视机：机身平滑浮现，屏幕内容再淡入 ────────────────────────────
const cardsRef = ref(null);
const tvRef = ref(null);
const noiseRef = ref(null);
const cardTimelines = [];

function tvScreenParts() {
  const root = tvRef.value;
  if (!root) return {};
  return {
    inner: root.querySelector('.me-tv__screen-inner'),
  };
}

function buildCards() {
  killCards();
  tunnelStageRef.value?.style.setProperty('--cards-in', '0');

  const reduced = reduceMotion() || window.innerWidth <= 900;
  if (reduced) {
    if (tvRef.value) gsap.set(tvRef.value, { clearProps: 'transform,opacity,visibility' });
    const { inner } = tvScreenParts();
    if (inner) gsap.set(inner, { clearProps: 'transform,opacity,visibility' });
    return;
  }
  if (!cardsRef.value || !tvRef.value) return;

  const { inner } = tvScreenParts();

  gsap.set(tvRef.value, { y: 46, autoAlpha: 0, scale: 0.985 });
  if (inner) gsap.set(inner, { autoAlpha: 0 });

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: cardsRef.value,
      start: 'top bottom',
      end: 'top 8%',
      scrub: 0.8,
      invalidateOnRefresh: true,
    },
  });

  // 机身先平滑悬浮上来（位移 + 轻微缩放，不做硬切）
  tl.to(tvRef.value, {
    y: 0, autoAlpha: 1, scale: 1, duration: 0.7, ease: 'power2.out',
  }, 0);

  // 屏幕内容随后淡入，不做白闪 / 跳变
  if (inner) {
    tl.to(inner, { autoAlpha: 1, duration: 0.45, ease: 'power1.out' }, 0.18);
  }

  cardTimelines.push(tl);

  // 电视进场时隧道 HUD / 进度线退场（照片这时已经全部飞出镜头）
  const proxy = { v: 0 };
  const fade = gsap.to(proxy, {
    v: 1,
    ease: 'none',
    onUpdate: () => tunnelStageRef.value?.style.setProperty('--cards-in', proxy.v.toFixed(3)),
    scrollTrigger: {
      trigger: cardsRef.value,
      start: 'top bottom',
      end: 'top 55%',
      scrub: 0.8,
      invalidateOnRefresh: true,
    },
  });
  cardTimelines.push(fade);
}

function killCards() {
  for (const tl of cardTimelines) {
    tl.scrollTrigger?.kill();
    tl.kill();
  }
  cardTimelines.length = 0;
}

// ── 频道切换：雪花花屏 + 横向撕裂的故障效果 ─────────────────────────────
let noiseRAF = 0;
let switchTimerA = 0;
let switchTimerB = 0;

function stopNoise() {
  if (noiseRAF) cancelAnimationFrame(noiseRAF);
  noiseRAF = 0;
}

function playNoise(duration = 460) {
  stopNoise();
  const canvas = noiseRef.value;
  if (!canvas) return;

  // 分辨率够高，雪花才细，不会放大成一块块马赛克
  const w = 640;
  const h = 360;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const end = performance.now() + duration;
  let last = 0;

  const step = (now) => {
    // 20fps 左右就够像老电视了，没必要每帧都重画
    if (now - last > 45) {
      last = now;

      const img = ctx.createImageData(w, h);
      const data = img.data;
      for (let i = 0; i < data.length; i += 4) {
        // 只用中低灰阶，避免整屏纯白刺眼
        const v = 16 + Math.random() * 128;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);

      // 一两道很淡的横向撕裂
      const bars = 1 + Math.floor(Math.random() * 2);
      ctx.fillStyle = 'rgba(244, 240, 232, 0.16)';
      for (let b = 0; b < bars; b += 1) {
        const y = Math.floor(Math.random() * h);
        ctx.fillRect(0, y, w, 1);
      }
    }

    if (now < end) noiseRAF = requestAnimationFrame(step);
    else noiseRAF = 0;
  };

  noiseRAF = requestAnimationFrame(step);
}

function cancelChannelSwitch() {
  stopNoise();
  clearTimeout(switchTimerA);
  clearTimeout(switchTimerB);
  switchTimerA = 0;
  switchTimerB = 0;
  switching.value = false;
}

function switchChannel(index) {
  if (index === activeChannel.value || switching.value) return;

  if (reduceMotion()) {
    activeChannel.value = index;
    return;
  }

  switching.value = true;
  playNoise(460);
  clearTimeout(switchTimerA);
  clearTimeout(switchTimerB);

  // 雪花最强的时候换内容；雪花退场时新频道已经就位
  switchTimerA = setTimeout(() => {
    activeChannel.value = index;
  }, 190);
  switchTimerB = setTimeout(() => {
    switching.value = false;
  }, 470);
}

function pageScrollRange() {
  const main = pageRef.value;
  return main ? Math.max(0, main.offsetHeight - window.innerHeight) : 0;
}

// 跳到电视这一屏的顶部。桌面上刚好等于整页滚到底；手机上电视按内容
// 高度铺开、可能比一屏更高，必须落到 section 顶部而不是页尾。
function cardsScrollTop() {
  const el = cardsRef.value;
  if (!el) return pageScrollRange();
  return Math.max(0, el.getBoundingClientRect().top + window.scrollY);
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
// 舞台保持在第 0 帧、照片保持隐藏，点击之后才浮现并进入整页的推进。
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
  killRevealTween();
  tunnelReveal.v = 0;
  explored.value = false;
  renderTunnel(0);
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
let exploreStartTimer = 0;
let exploreStartCleanup = null;

function cancelScheduledScroll() {
  if (exploreStartTimer) {
    clearTimeout(exploreStartTimer);
    exploreStartTimer = 0;
  }
  if (exploreStartCleanup) {
    exploreStartCleanup();
    exploreStartCleanup = null;
  }
}

function cancelAutoScroll() {
  cancelScheduledScroll();
  if (autoScrollRAF) cancelAnimationFrame(autoScrollRAF);
  autoScrollRAF = 0;
  if (autoScrollCancel) {
    window.removeEventListener('wheel', autoScrollCancel);
    window.removeEventListener('touchstart', autoScrollCancel);
    window.removeEventListener('pointerdown', autoScrollCancel);
    autoScrollCancel = null;
  }
}

function autoScrollTo(target, duration = 7600) {
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

// 照片浮现完再开始推进；这段时间里用户自己一动滚轮，就取消自动推进
function scheduleExploreScroll(target) {
  cancelScheduledScroll();
  const cancel = () => cancelScheduledScroll();

  exploreStartCleanup = () => {
    window.removeEventListener('wheel', cancel);
    window.removeEventListener('keydown', cancel);
    window.removeEventListener('touchstart', cancel);
    window.removeEventListener('pointerdown', cancel);
  };

  window.addEventListener('wheel', cancel, { passive: true });
  window.addEventListener('keydown', cancel, { passive: true });
  window.addEventListener('touchstart', cancel, { passive: true });
  window.addEventListener('pointerdown', cancel, { passive: true });

  // 和 TUNNEL_REVEAL_SECONDS 对齐：照片全部浮现之后镜头才真正开始推进
  exploreStartTimer = setTimeout(() => {
    cancelScheduledScroll();
    autoScrollTo(target);
  }, TUNNEL_REVEAL_SECONDS * 1000);
}

// EXPLORE：照片逐张浮现 → 镜头推进 → 复古电视机升起
function startExplore() {
  explored.value = true;
  detachExploreLock();
  const target = pageScrollRange();

  // 减少动态 / 手机：没有隧道可飞，直接落到窗口
  if (REDUCED || window.innerWidth <= 900) {
    killRevealTween();
    tunnelReveal.v = 1;
    renderTunnel(tunnelProgress);
    window.scrollTo({ top: cardsScrollTop(), left: 0, behavior: 'instant' });
    return;
  }

  cancelAutoScroll();
  killRevealTween();
  tunnelReveal.v = 0;
  windGustStart = performance.now();
  renderTunnel(tunnelProgress);

  tunnelRevealTween = gsap.to(tunnelReveal, {
    v: 1,
    duration: TUNNEL_REVEAL_SECONDS,
    ease: 'power2.out',
    onUpdate: () => renderTunnel(tunnelProgress),
    onComplete: () => {
      tunnelRevealTween = null;
    },
  });

  scheduleExploreScroll(target);
}

// SKIP：跳过隧道，直接到电视机
function skipToCards() {
  explored.value = true;
  detachExploreLock();
  cancelAutoScroll();
  killRevealTween();
  tunnelReveal.v = 1;
  renderTunnel(tunnelProgress);
  window.scrollTo({ top: cardsScrollTop(), left: 0, behavior: 'instant' });
}

// ── 生命周期 ────────────────────────────────────────────────────────────
let activationCount = 0;
let resizeTimer = 0;
let lastNarrow = window.innerWidth <= 900;

function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    // 跨过 900px 断点时必须重建：桌面端的 GSAP 会把电视设成 autoAlpha 0，
    // 直接切到手机布局会留下一台透明的电视。
    const narrow = window.innerWidth <= 900;
    if (narrow !== lastNarrow) {
      lastNarrow = narrow;
      buildTunnel();
      buildCards();
    }
    ScrollTrigger.refresh();
    renderTunnel(tunnelProgress);
  }, 180);
}

onMounted(() => {
  requestTunnelPhotos();
  attachExploreLock();
  window.addEventListener('resize', onResize);
  nextTick(() => {
    buildTunnel();
    buildCards();
    ScrollTrigger.refresh();
  });
  document.fonts?.ready
    ?.then(() => ScrollTrigger.refresh())
    .catch(() => {});
});

onActivated(() => {
  activationCount += 1;
  if (activationCount > 1) {
    quote.value = meQuotes[Math.floor(Math.random() * meQuotes.length)];
  }
  // 已经 Explore 过就不再弹入口；只有第一次进入（或上次没点就离开）才显示
  if (explored.value) {
    cancelAutoScroll();
    detachExploreLock();
    tunnelReveal.v = 1;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  } else {
    attachExploreLock();
  }
  nextTick(() => {
    buildTunnel();
    buildCards();
    ScrollTrigger.refresh();
  });
});

onDeactivated(() => {
  cancelAutoScroll();
  detachExploreLock();
  cancelChannelSwitch();
  killRevealTween();
  killTunnel();
  killCards();
});

onBeforeUnmount(() => {
  cancelAutoScroll();
  detachExploreLock();
  cancelChannelSwitch();
  killRevealTween();
  killTunnel();
  killCards();
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

function copyWeChat() {
  navigator.clipboard.writeText('X15021373202');
  alert('WeChat ID copied: X15021373202');
}
</script>

<template>
  <main ref="pageRef" class="page active me-intro-page" :class="{ 'is-reduced': REDUCED }">
    <!-- 点击 EXPLORE 才进入：在那之前滚动被拦住，照片保持隐藏 -->
    <Transition name="me-explore-fade">
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
    </Transition>

    <!-- 整页最后落在一台复古电视上：这层隧道 sticky 在整个 main 的顶部 -->
    <div ref="tunnelStageRef" class="me-tunnel__stage" aria-label="Photo tunnel">
      <div class="me-tunnel__layers" aria-hidden="true">
        <figure
          v-for="(card, i) in tunnelCards"
          :key="card.key"
          :ref="setCardEl(i)"
          class="me-tunnel__card"
        >
          <!-- 占位框决定卡片高度；真正的纸面叠在它上面 -->
          <span class="me-tunnel__placeholder" />

          <div class="me-tunnel__paper">
            <!-- 完整照片：整张纸保持完整，只随风扇动 / 倾斜 -->
            <img
              v-if="tunnelPhotos[card.photo]?.thumb"
              class="me-tunnel__paper-source"
              :src="tunnelPhotos[card.photo].thumb"
              alt=""
              decoding="async"
              draggable="false"
              @error="onTunnelImageError(card.photo)"
            >
          </div>
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

    <!-- 摄像机先飞完，一台复古电视机随后升起来 -->
    <div class="me-tunnel__runway" aria-hidden="true" />

    <!-- ── 一台电视里的三个频道：ME / GALLERY / FRIENDS ─────────────────── -->
    <section ref="cardsRef" class="me-tv-stage" aria-label="ME, Gallery and Friends">
      <div ref="tvRef" class="me-tv">
        <!-- 机身上沿：品牌 / 型号 / 信号灯 -->
        <div class="me-tv__bezel">
          <span class="me-tv__brand">
            <i class="me-tv__brand-dot" aria-hidden="true" />
            LIVEINPASSION
          </span>
          <span class="me-tv__bezel-note">where are you my love?</span>
          <span class="me-tv__signal-top">
            <i aria-hidden="true" />
            searching for meaning
          </span>
        </div>

        <!-- 屏幕：一次只播一个频道，底部按钮负责切换 -->
        <div class="me-tv__screen" :class="{ 'is-switching': switching }">
          <div class="me-tv__screen-inner">
            <div class="me-tv__osd">
              <span class="me-tv__osd-label">CHANNEL DIRECTORY</span>
              <span class="me-tv__osd-meta">CH {{ String(activeChannel + 1).padStart(2, '0') }} · BE {{ virtue }}</span>
            </div>

            <div class="me-tv__channel-stage">
              <!-- 01 ME -->
              <div v-if="activeChannel === 0" class="me-channel me-channel--me">
                <div class="me-channel__main">
                  <div class="me-channel__wordbox">
                    <span class="me-channel__ghost" aria-hidden="true">ME</span>
                    <h2 class="me-channel__word">ME</h2>
                  </div>
                </div>
                <div class="me-channel__aside">
                  <p class="me-channel__eyebrow">IDENTITY / PROFILE</p>
                  <p class="me-channel__name">HUANG WEI LONG</p>
                  <p class="me-channel__tag">DREAMER &amp; IDEALIST · BE {{ virtue }}</p>
                  <p class="me-channel__meta">LAST UPDATED · {{ lastUpdate }}</p>
                  <blockquote class="me-channel__quote">
                    <span>“{{ quote }}”</span>
                    <cite>— LIVE IN PASSION</cite>
                  </blockquote>
                </div>
              </div>

              <!-- 02 GALLERY -->
              <div v-else-if="activeChannel === 1" class="me-channel">
                <div class="me-channel__main">
                  <div class="me-channel__wordbox">
                    <span class="me-channel__ghost" aria-hidden="true">GALLERY</span>
                    <h2 class="me-channel__word">GALLERY</h2>
                  </div>
                </div>
                <div class="me-channel__aside">
                  <p class="me-channel__eyebrow">THE WINDOW WALL</p>
                  <p class="me-channel__desc">
                    Friends, group moments, and a personal archive — one grid of
                    windows, all at once.
                  </p>
                  <router-link to="/gallery" class="me-channel__cta">
                    OPEN GALLERY <span aria-hidden="true">↗</span>
                  </router-link>
                </div>
              </div>

              <!-- 03 FRIENDS -->
              <div v-else class="me-channel">
                <div class="me-channel__main">
                  <div class="me-channel__wordbox">
                    <span class="me-channel__ghost" aria-hidden="true">FRIENDS</span>
                    <h2 class="me-channel__word">FRIENDS</h2>
                  </div>
                </div>
                <div class="me-channel__aside">
                  <p class="me-channel__eyebrow">THE PEOPLE</p>
                  <p class="me-channel__desc">
                    The people who show up in the moments — an open wall of faces,
                    places, and the stories in between.
                  </p>
                  <router-link :to="{ path: '/gallery', query: { filter: 'friends' } }" class="me-channel__cta">
                    OPEN FRIENDS <span aria-hidden="true">↗</span>
                  </router-link>
                </div>
              </div>
            </div>

            <div class="me-tv__osd me-tv__osd--bottom">
              <div class="me-tv__tabs" role="tablist" aria-label="Channels">
                <button
                  v-for="(channel, i) in CHANNELS"
                  :key="channel.id"
                  type="button"
                  role="tab"
                  class="me-tv__tab"
                  :class="{ 'is-active': activeChannel === i }"
                  :aria-selected="String(activeChannel === i)"
                  @click="switchChannel(i)"
                >
                  <b>{{ String(i + 1).padStart(2, '0') }}</b>{{ channel.label }}
                </button>
              </div>
              <span class="me-tv__meter" aria-hidden="true"><i /><i /><i /><i /></span>
              <span class="me-tv__osd-meta">WHO ARE YOU / WHO I AM</span>
            </div>
          </div>

          <span class="me-tv__glare" aria-hidden="true" />
          <span class="me-tv__scanlines" aria-hidden="true" />
          <span class="me-tv__rollbar" aria-hidden="true" />
          <canvas ref="noiseRef" class="me-tv__noise" aria-hidden="true" />
        </div>

        <!-- 机身下沿：只保留有实际功能的按键和社交入口 -->
        <div class="me-tv__deck">
          <div class="me-tv__controls">
            <button class="me-tv__key" type="button" @click="movieOpen = true">
              MOVIE <span aria-hidden="true">↗</span>
            </button>
            <button class="me-tv__key" type="button" @click="albumOpen = true">
              ALBUM <span aria-hidden="true">↗</span>
            </button>
            <button class="me-tv__key" type="button" @click="gameOpen = true">
              GAME <span aria-hidden="true">↗</span>
            </button>
            <button class="me-tv__key" type="button" @click="router.push('/me/gallery')">
              MY GALLERY <span aria-hidden="true">↗</span>
            </button>
            <button class="me-tv__key" type="button" @click="router.push('/me/organization')">
              ORGANIZATION <span aria-hidden="true">↗</span>
            </button>
          </div>

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
        </div>
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

/* ── EXPLORE 入口 ─────────────────────────────────────────────────────── */
.me-explore-fade-leave-active {
  transition: opacity 0.55s ease;
}

.me-explore-fade-leave-to {
  opacity: 0;
}

.me-explore {
  position: fixed;
  inset: 0;
  z-index: 60; /* 低于全局 header(100)，上面那行导航仍然可点 */
  display: grid;
  place-items: center;
  /* 照片默认是隐藏的，门禁本身就是一张干净的纯色屏 —— 不再用半透明径向遮罩，
     手机上电视也不会提前透出来 */
  background: var(--bg);
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
/* 舞台 sticky 在 main 顶部、一直跟到整页结束；后面的 runway 和窗口
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

/* 摄像机飞完的行程；复古电视机紧接在后面。
   200vh 让电视在照片全部飞出后不久就开始浮现，衔接更顺 */
.me-tunnel__runway {
  height: 200vh;
  pointer-events: none;
}

.me-tunnel__layers {
  position: absolute;
  inset: 0;
  z-index: 1;
  transform-style: preserve-3d;
  /* 窗口上来时照片整体淡出：不是压暗，是平滑消失 */
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
  will-change: transform, opacity, clip-path;
  backface-visibility: hidden;
  pointer-events: none;
  filter: drop-shadow(0 18px 26px rgba(0, 0, 0, 0.42));
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

/* 纸面盖在占位框上；高度仍由占位框决定 */
.me-tunnel__paper {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--text-primary) 7%, transparent),
      transparent 60%
    ),
    var(--background-secondary);
}

/* 整张照片：保持完整，只随卡片一起倾斜 / 扇动 */
.me-tunnel__paper-source {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}



.me-tunnel__vignette {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  opacity: calc(1 - var(--cards-in, 0));
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

/* ── 复古电视机：整台机器就是三个板块的容器 ──────────────────────────── */
.me-tv-stage {
  /* 宽高同时受视口限制：矮屏时整台电视自动缩小，始终装得下一屏 */
  --tv-w: min(1240px, 86vw, calc((100svh - 200px) * 1.5));
  --tv-paper: #f4f0e8;
  --tv-ink: #050607;
  /* 机身只用克制的中性灰：亮色主题偏浅灰，暗色主题偏深灰 */
  --tv-plastic: color-mix(in srgb, var(--text-primary) 26%, var(--bg));
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100svh;
  /* 底部 112px 是给左下角作者头像塔留的位置 */
  padding: clamp(76px, 9vh, 104px) clamp(14px, 3vw, 44px) 112px;
  /* 这一屏没有自己的背景板：只有电视机本体在原有页面底色上浮出来 */
  background: transparent;
  overflow: visible;
  isolation: isolate;
}

.me-tv {
  position: relative;
  z-index: 1;
  width: var(--tv-w);
  padding: clamp(12px, 1.4vw, 18px);
  border-radius: 0;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, #fff 18%, var(--tv-plastic)) 0%,
      var(--tv-plastic) 38%,
      color-mix(in srgb, #000 26%, var(--tv-plastic)) 100%
    );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.26),
    inset 0 -5px 10px rgba(0, 0, 0, 0.4),
    0 28px 60px rgba(0, 0, 0, 0.5),
    0 4px 0 rgba(0, 0, 0, 0.35);
  will-change: transform, opacity;
}

/* 机身上沿：品牌 / 两句话 / 信号灯 */
.me-tv__bezel {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: clamp(8px, 1.2vw, 16px);
  padding: 0 clamp(8px, 1vw, 14px) clamp(9px, 1.2vh, 13px);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--text-primary) 52%, var(--tv-plastic));
}

.me-tv__brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: color-mix(in srgb, var(--text-primary) 78%, var(--tv-plastic));
  font-weight: 600;
}

.me-tv__brand-dot {
  display: block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tv-paper);
  box-shadow: 0 0 10px rgba(244, 240, 232, 0.55);
}

/* 这两个句子固定在机身上沿右侧 */
.me-tv__bezel-note {
  margin-left: auto;
  color: color-mix(in srgb, var(--text-primary) 72%, var(--tv-plastic));
  text-transform: none;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.me-tv__signal-top {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: color-mix(in srgb, var(--text-primary) 68%, var(--tv-plastic));
  letter-spacing: 0.06em;
  text-transform: none;
  white-space: nowrap;
}

.me-tv__signal-top i {
  display: block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  animation: me-tv-blink 1.8s steps(2, start) infinite;
}

/* 屏幕：方角玻璃 + 内阴影，永远近黑；扫描线压在内容上方 */
.me-tv__screen {
  position: relative;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 0;
  /* 屏幕自身作为容器：巨字用 cqw 计算，避免被列宽截断 */
  container-type: inline-size;
  background: var(--tv-ink);
  color: var(--tv-paper);
  box-shadow:
    inset 0 0 0 2px #17191a,
    inset 0 0 0 6px color-mix(in srgb, #000 42%, var(--tv-plastic)),
    inset 0 0 70px rgba(0, 0, 0, 0.8),
    0 0 0 1px rgba(0, 0, 0, 0.55);
}

.me-tv__screen-inner {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  padding: clamp(10px, 1.4vw, 18px) clamp(12px, 1.8vw, 24px) clamp(8px, 1.2vw, 14px);
}

.me-tv__osd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: clamp(6px, 0.8vh, 9px);
  border-bottom: 1px dashed rgba(244, 240, 232, 0.2);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: clamp(7px, 0.55vw, 9px);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(244, 240, 232, 0.58);
}

.me-tv__osd--bottom {
  padding-top: clamp(6px, 0.8vh, 9px);
  padding-bottom: 0;
  border-top: 1px dashed rgba(244, 240, 232, 0.2);
  border-bottom: 0;
}

.me-tv__osd-label {
  color: var(--tv-paper);
  opacity: 0.8;
  white-space: nowrap;
}

.me-tv__osd-meta {
  white-space: nowrap;
}

/* 屏幕里的信号强度条 */
.me-tv__meter {
  display: inline-flex;
  align-items: flex-end;
  gap: 3px;
  margin-left: auto;
  height: 10px;
}

.me-tv__meter i {
  display: block;
  width: 3px;
  background: var(--tv-paper);
  opacity: 0.65;
}

.me-tv__meter i:nth-child(1) { height: 3px; }
.me-tv__meter i:nth-child(2) { height: 5px; }
.me-tv__meter i:nth-child(3) { height: 7px; }
.me-tv__meter i:nth-child(4) { height: 10px; }

/* CRT 扫描线 / 眩光 / 一条慢慢下滚的亮带 / 通电白闪 */
.me-tv__scanlines {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.42) 0 1px,
    transparent 1px 3px
  );
  opacity: 0.45;
}

.me-tv__glare {
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  background:
    radial-gradient(120% 80% at 18% 0%, rgba(255, 255, 255, 0.14), transparent 46%),
    linear-gradient(115deg, rgba(255, 255, 255, 0.07) 0%, transparent 30%);
  opacity: 0.55;
}

.me-tv__rollbar {
  position: absolute;
  z-index: 3;
  top: -22%;
  right: -10%;
  left: -10%;
  height: 22%;
  pointer-events: none;
  background: linear-gradient(
    to bottom,
    transparent,
    rgba(244, 240, 232, 0.05),
    transparent
  );
  animation: me-tv-roll 9s linear infinite;
}

@keyframes me-tv-roll {
  0% { transform: translateY(0); }
  100% { transform: translateY(560%); }
}

@keyframes me-tv-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* 机身下沿：只保留真正能点的按键和社交入口 */
.me-tv__deck {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  padding: clamp(10px, 1.4vh, 15px) clamp(8px, 1vw, 14px) 2px;
}

.me-tv__controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
}

.me-tv__key {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: clamp(6px, 0.8vh, 8px) clamp(8px, 1vw, 12px);
  border: 1px solid rgba(0, 0, 0, 0.2);
  border-radius: 0;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, #fff 14%, var(--tv-plastic)),
    color-mix(in srgb, #000 12%, var(--tv-plastic))
  );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.26),
    0 2px 0 rgba(0, 0, 0, 0.18);
  color: color-mix(in srgb, var(--text-primary) 62%, var(--tv-plastic));
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 7.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
}

.me-tv__key:hover {
  background: var(--text-primary);
  color: var(--bg);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

.me-tv__key span {
  transition: transform 0.2s ease;
}

.me-tv__key:hover span {
  transform: translate(2px, -2px);
}

.me-socials {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.7rem;
  margin-left: auto;
}

.me-social {
  display: inline-flex;
  width: 15px;
  height: 15px;
  color: color-mix(in srgb, var(--text-primary) 55%, var(--tv-plastic));
  transition: color 0.2s ease, transform 0.2s ease;
}

.me-social:hover {
  color: var(--text-primary);
  transform: translateY(-2px);
}

.me-social svg {
  width: 100%;
  height: 100%;
}

/* 屏幕里的单频道舞台：一次只播一个频道 */
.me-tv__channel-stage {
  position: relative;
  display: flex;
  min-height: 0;
  overflow: visible;
}

/* 频道内容：左边巨字，右边信息 */
.me-channel {
  display: grid;
  grid-template-columns: minmax(0, 1.18fr) minmax(180px, 0.82fr);
  align-items: center;
  gap: clamp(0.9rem, 2.4vw, 2.6rem);
  width: 100%;
  min-height: 0;
  padding: clamp(6px, 1.2vh, 14px) clamp(6px, 1vw, 12px);
  color: var(--tv-paper);
}

.me-channel__main {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  height: 100%;
}

/* 巨字用屏幕自身的宽度（cqw）计算：整词完整显示，不截断 */
.me-channel__wordbox {
  position: relative;
  width: fit-content;
  max-width: 100%;
  font-size: clamp(2.4rem, min(9.4vw, 27vh), 15rem);
  font-size: clamp(2.4rem, min(14cqw, 27vh), 15rem);
  line-height: 0.82;
}

.me-channel__word,
.me-channel__ghost {
  margin: 0;
  font-family: 'Oswald', sans-serif;
  font-weight: 700;
  font-size: 1em;
  line-height: inherit;
  letter-spacing: -0.012em;
  text-transform: uppercase;
  white-space: nowrap;
}

.me-channel__word {
  position: relative;
  color: var(--tv-paper);
  text-shadow: 0 0 26px rgba(244, 240, 232, 0.12);
}

.me-channel__ghost {
  position: absolute;
  inset: 0;
  pointer-events: none;
  color: transparent;
  -webkit-text-stroke: 1px currentColor;
  opacity: 0.16;
  transform: translate(0.06em, 0.06em);
}

.me-channel__aside {
  display: flex;
  flex-direction: column;
  justify-content: center;
  justify-self: end;
  gap: 0.35rem;
  width: 100%;
  max-width: 24rem;
  min-width: 0;
  color: var(--tv-paper);
}

.me-channel__eyebrow {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 7.5px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(244, 240, 232, 0.52);
}

.me-channel__name {
  margin: 0;
  font-family: 'Oswald', sans-serif;
  font-weight: 600;
  font-size: clamp(1rem, 1.4vw, 1.45rem);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--tv-paper);
}

.me-channel__tag,
.me-channel__meta {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 7.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(244, 240, 232, 0.5);
}

.me-channel__desc {
  margin: 0;
  font-size: clamp(0.68rem, 0.85vw, 0.85rem);
  line-height: 1.55;
  color: rgba(244, 240, 232, 0.68);
}

.me-channel__quote {
  margin: 0.55rem 0 0;
  padding-left: 0.7rem;
  border-left: 1px solid rgba(244, 240, 232, 0.3);
  font-size: clamp(0.68rem, 0.8vw, 0.8rem);
  line-height: 1.5;
  color: rgba(244, 240, 232, 0.72);
}

.me-channel__quote cite {
  display: block;
  margin-top: 0.3rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-style: normal;
  font-size: 6.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(244, 240, 232, 0.45);
}

/* CTA 是真正的链接按钮：方角、细边、hover 反色 */
.me-channel__cta {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 0.55rem;
  margin: 0.7rem 0 0;
  padding: 0.5rem 0.8rem;
  border: 1px solid rgba(244, 240, 232, 0.45);
  border-radius: 0;
  background: transparent;
  color: var(--tv-paper);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  text-decoration: none;
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
}

.me-channel__cta:hover {
  background: var(--tv-paper);
  border-color: var(--tv-paper);
  color: var(--tv-ink);
}

.me-channel__cta span {
  display: inline-block;
  transition: transform 0.2s ease;
}

.me-channel__cta:hover span {
  transform: translate(2px, -2px);
}

/* 屏幕底部的频道切换按钮 */
.me-tv__tabs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.me-tv__tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.55rem;
  border: 1px solid rgba(244, 240, 232, 0.3);
  border-radius: 0;
  background: transparent;
  color: rgba(244, 240, 232, 0.6);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 7.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
}

.me-tv__tab b {
  font-weight: 700;
}

.me-tv__tab:hover {
  border-color: rgba(244, 240, 232, 0.7);
  background: rgba(244, 240, 232, 0.08);
  color: var(--tv-paper);
}

.me-tv__tab.is-active {
  border-color: var(--tv-paper);
  background: var(--tv-paper);
  color: var(--tv-ink);
}

/* 花屏 / 故障：雪花画布 + 频道内容的横向撕裂 */
.me-tv__noise {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease;
}

.me-tv__screen.is-switching .me-tv__noise {
  opacity: 0.46;
}

.me-tv__screen.is-switching .me-tv__channel-stage {
  animation: me-tv-glitch 0.46s steps(2, end) both;
}

@keyframes me-tv-glitch {
  0% { transform: translate(0, 0); filter: none; }
  12% { transform: translate(-4px, 2px); filter: contrast(1.2) brightness(1.08); }
  26% { transform: translate(3px, -2px); }
  40% { transform: translate(-2px, 1px); }
  58% { transform: translate(2px, -1px); filter: none; }
  76% { transform: translate(-1px, 0); }
  100% { transform: translate(0, 0); }
}



/* ── 响应式 ───────────────────────────────────────────────────────────── */
@media (max-width: 900px) {
  /* 手机 / 平板：隐藏隧道，电视按屏幕比例铺开 */
  .me-tunnel__stage,
  .me-tunnel__runway {
    display: none;
  }

  .me-tv-stage {
    --tv-w: calc(100vw - 20px);
    display: flex;
    min-height: 100svh;
    justify-content: center;
    padding: 82px 10px 24px;
    overflow: visible;
  }

  .me-tv {
    width: var(--tv-w);
    padding: 10px;
    border-radius: 0;
  }

  .me-tv__bezel {
    gap: 8px;
    padding-bottom: 8px;
    font-size: 7px;
    letter-spacing: 0.14em;
  }

  .me-tv__signal-top {
    font-size: 7px;
  }

  /* 手机上不要在 aspect-ratio + min-height 同时使用：
     两者会把宽度撑出电视机身。这里用高度下限，宽度始终 100%。 */
  .me-tv__screen {
    aspect-ratio: auto;
    min-height: clamp(280px, 52vw, 468px);
    border-radius: 0;
  }

  .me-tv__screen-inner {
    padding: 10px 10px 9px;
  }

  .me-tv__osd {
    font-size: 6.5px;
    letter-spacing: 0.14em;
  }

  .me-channel {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.35rem;
    padding: 6px 6px 8px;
  }

  .me-channel__main {
    justify-content: flex-start;
  }

  .me-channel__wordbox {
    font-size: clamp(2rem, 16cqw, 5rem);
  }

  .me-channel__aside {
    justify-self: start;
    max-width: none;
    margin-top: 0;
  }

  .me-channel__name {
    font-size: 1rem;
  }

  .me-channel__desc {
    font-size: 0.68rem;
  }

  .me-channel__quote {
    margin-top: 0.35rem;
    font-size: 0.66rem;
  }

  .me-tv__tabs {
    width: 100%;
  }

  .me-tv__tab {
    flex: 1 1 0;
    justify-content: center;
  }

  .me-tv__osd--bottom {
    flex-wrap: wrap;
    gap: 0;
  }

  .me-tv__meter {
    display: none;
  }

  /* 手机上把右下角那句放到底部第二行，仍然保持右对齐 */
  .me-tv__osd--bottom .me-tv__osd-meta {
    width: 100%;
    padding-top: 3px;
    text-align: right;
  }

  .me-tv__deck {
    align-items: flex-start;
    gap: 0.45rem;
    padding: 9px 4px 2px;
  }

  .me-tv__controls {
    width: 100%;
  }

  .me-tv__key {
    flex: 1 1 auto;
    justify-content: center;
    padding: 6px 7px;
    font-size: 7px;
  }

  .me-socials {
    width: 100%;
    margin-left: 0;
    margin-top: 0.1rem;
  }
}

/* 平板竖屏：屏幕已经足够宽，恢复左右两栏，别让巨字和资料都挤在左边 */
@media (min-width: 600px) and (max-width: 900px) {
  .me-channel {
    grid-template-columns: minmax(0, 1.18fr) minmax(180px, 0.82fr);
    align-items: center;
    gap: clamp(1rem, 2.4vw, 2rem);
    padding: 8px 10px;
  }

  .me-channel__main {
    justify-content: center;
  }

  .me-channel__wordbox {
    font-size: clamp(2.6rem, 14cqw, 6rem);
  }

  .me-channel__aside {
    justify-self: end;
    max-width: 22rem;
    margin-top: 0;
  }
}

@media (max-width: 520px) {
  .me-tv-stage {
    padding: 78px 8px 16px;
  }

  .me-tv {
    padding: 8px;
  }

  .me-tv__screen {
    min-height: 280px;
  }

  .me-tv__screen-inner {
    padding: 8px 8px 7px;
  }

  .me-tv__key {
    font-size: 6.8px;
    padding: 5px 6px;
  }

  .me-tv__tab {
    padding: 0.26rem 0.4rem;
    font-size: 7px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .me-tv__rollbar,
  .me-tv__signal-top i {
    animation: none;
  }

  .me-tv__noise {
    display: none;
  }

  .me-tv__screen.is-switching .me-tv__channel-stage {
    animation: none;
  }

  .me-tunnel__scroll span {
    animation: none;
  }

  .me-channel__cta,
  .me-tv__key,
  .me-tv__tab {
    transition: none;
  }
}

/* 减少动态：隐藏隧道，电视按普通流居中 */
.is-reduced .me-tunnel__stage,
.is-reduced .me-tunnel__runway {
  display: none;
}

.is-reduced .me-tv-stage {
  min-height: 100vh;
  min-height: 100svh;
}
</style>
