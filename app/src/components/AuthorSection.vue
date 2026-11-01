<script setup>
// 桌面端左下角的「Ava 塔」：头像常驻，指针停到头像上之后，
// 社交 / 主题 / 音乐 / 背景开关从它后面往上滑出来。
//
// 之所以拆回左下角：这批控件本来就在屏幕底部，鼠标不用横跨整个屏幕；
// 头像本身就是一个明确的锚点，悬停它比悬停 LOGO 更符合直觉。
// ≤1024px 整个塔让位（那批控件在右上角汉堡里，见 AppHeader 的 nav-tools）。
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ICONS, LOCAL_ASSETS } from '../data/assets.js';
import { useMusicPlayer } from '../composables/useMusicPlayer.js';
import { useBrandOverlay } from '../composables/useBrandOverlay.js';
import { useWallPref } from '../composables/useWallPref.js';
import { useRoute } from 'vue-router';
import { playGlitchRevealCanvas } from '../composables/useCardFx.js';

const { playerVisible, togglePlayer } = useMusicPlayer();
const { switchTheme } = useBrandOverlay();
const { wallHidden } = useWallPref();
const route = useRoute();
const isHome = computed(() => route.path === '/');

function toggleWall() {
  wallHidden.value = !wallHidden.value;
}

const avatar = LOCAL_ASSETS.authorAvatar;

// 触屏设备没有 hover：塔保持常开，否则永远叫不出来。
const fineHover = window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches ?? false;
const open = ref(!fineHover);
const rootRef = ref(null);
const stackRef = ref(null);

// 每次滑出都来一次「Bayer 抖色 + 逐行揭示」——和照片加载时那一下是同一套。
let revealRun = 0;

function dropGlitch() {
  stackRef.value?.querySelectorAll('.fx-glitch').forEach((node) => node.remove());
}

function openTower() {
  if (open.value) return;
  open.value = true;
  const run = ++revealRun;
  requestAnimationFrame(() => revealStack(run));
}

function closeTower() {
  if (!fineHover) return;
  open.value = false;
  revealRun++;
  dropGlitch();
}

function onFocusOut(event) {
  if (rootRef.value?.contains(event.relatedTarget)) return;
  closeTower();
}

function loadSvgIcon(svg, color) {
  const clone = svg.cloneNode(true);
  clone.setAttribute('style', `color:${color}`);
  const xml = new XMLSerializer().serializeToString(clone);
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  return image.decode().then(() => image, () => null);
}

// 把塔里的按钮画成一张低分辨率位图，交给揭示动画。
// 位置一律用 offset*（不含 translate）：滑出过程中按钮带着位移，
// 用 getBoundingClientRect 会把"半路"的位置画进底图，和落点对不上。
async function buildStackBitmap(host) {
  const w = host.clientWidth;
  const h = host.clientHeight;
  if (w < 12 || h < 12) return null;

  const dot = 2;
  const dw = Math.max(6, Math.round(w / dot));
  const dh = Math.max(6, Math.round(h / dot));
  const bitmap = document.createElement('canvas');
  bitmap.width = dw;
  bitmap.height = dh;
  const ctx = bitmap.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const sx = dw / w;
  const sy = dh / h;
  const rootStyle = getComputedStyle(document.documentElement);
  const pageBg = rootStyle.getPropertyValue('--bg').trim() || '#fafafa';

  ctx.fillStyle = pageBg;
  ctx.fillRect(0, 0, dw, dh);

  const jobs = [];
  host.querySelectorAll('.brand-tool').forEach((el) => {
    const bw = Math.max(1, el.offsetWidth) * sx;
    const bh = Math.max(1, el.offsetHeight) * sy;
    const x = el.offsetLeft * sx;
    const y = el.offsetTop * sy;
    const style = getComputedStyle(el);

    const bg = style.backgroundColor;
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, bw, bh);
    }

    const borderWidth = parseFloat(style.borderTopWidth) || 0;
    if (borderWidth > 0) {
      ctx.strokeStyle = style.borderTopColor;
      ctx.lineWidth = Math.max(1, Math.round(borderWidth * sx));
      ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, bw - 1), Math.max(1, bh - 1));
    }

    const svg = el.querySelector('svg');
    const img = el.querySelector('img');
    if (svg) {
      jobs.push(loadSvgIcon(svg, style.color).then((icon) => {
        if (!icon) return;
        const size = 17 * sx;
        ctx.drawImage(icon, x + (bw - size) / 2, y + (bh - size) / 2, size, size);
      }));
    } else if (img) {
      if (img.complete && img.naturalWidth) {
        // 播放器图标是黑色 SVG，靠 CSS filter 反色；快照里也得带上同一个滤镜。
        const filter = getComputedStyle(img).filter;
        const size = 18 * sx;
        ctx.filter = filter && filter !== 'none' ? filter : 'none';
        ctx.drawImage(img, x + (bw - size) / 2, y + (bh - size) / 2, size, size);
        ctx.filter = 'none';
      }
    }
  });

  await Promise.all(jobs);
  return bitmap;
}

async function revealStack(run) {
  const host = stackRef.value;
  if (!host) return;
  const bitmap = await buildStackBitmap(host);
  if (!bitmap || run !== revealRun) return;
  playGlitchRevealCanvas(host, bitmap, {
    width: host.clientWidth,
    height: host.clientHeight,
    duration: 620,
  });
}

onBeforeUnmount(() => {
  revealRun++;
  dropGlitch();
});

// 换页时收起：首页才有背景开关，跨页留着一条展开的塔会和新页面打架。
watch(() => route.path, () => {
  open.value = false;
  revealRun++;
  dropGlitch();
});
</script>

<template>
  <div
    ref="rootRef"
    class="author-tower"
    :class="{ 'is-open': open }"
    @mouseenter="openTower"
    @mouseleave="closeTower"
    @focusin="openTower"
    @focusout="onFocusOut"
  >
    <!-- 从下往上：GitHub、X、主题、音乐、背景开关（模板里是这个顺序的倒序）。
         --i 决定滑出的先后：离头像越近越早。 -->
    <div ref="stackRef" class="author-tower__stack">
      <button
        v-if="isHome"
        class="brand-tool"
        type="button"
        style="--i: 4"
        aria-label="切换背景封面"
        :aria-pressed="String(!wallHidden)"
        :class="{ 'is-off': wallHidden }"
        @click="toggleWall"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7.5" height="7.5" rx="1" />
          <rect x="13.5" y="3" width="7.5" height="7.5" rx="1" />
          <rect x="3" y="13.5" width="7.5" height="7.5" rx="1" />
          <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1" />
        </svg>
      </button>
      <button
        class="brand-tool"
        type="button"
        style="--i: 3"
        aria-label="Toggle music player"
        :class="{ 'is-active': playerVisible }"
        @click="togglePlayer"
      >
        <img :src="ICONS.notes" alt="Music">
      </button>
      <button class="brand-tool" type="button" style="--i: 2" aria-label="Toggle theme" @click="switchTheme">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"></circle>
          <line x1="12" y1="1" x2="12" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="23"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="1" y1="12" x2="3" y2="12"></line>
          <line x1="21" y1="12" x2="23" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
      </button>
      <a class="brand-tool" style="--i: 1" href="https://x.com/HuangWeiLong525" aria-label="Twitter/X" target="_blank" rel="noopener noreferrer">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"></path>
        </svg>
      </a>
      <a class="brand-tool" style="--i: 0" href="https://github.com/HuangWeiLong-dot" aria-label="GitHub" target="_blank" rel="noopener noreferrer">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
        </svg>
      </a>
    </div>

    <div class="author-tower__avatar">
      <img :src="avatar" alt="Author Avatar">
    </div>
  </div>
</template>
