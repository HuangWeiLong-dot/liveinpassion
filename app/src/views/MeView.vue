<script setup>
// ME 页（旧 index.html L5155-L5364）。对应关系：
//   页面标题/副标题 ← 随机美德（useVirtue，与导航栏那个词必须是同一个）
//   LAST UPDATED   ← 最新一篇博客的卡片日期（旧版是去读 DOM 里第一张卡片，现在直接取数据）
//   引用            ← 每次进入本页换一条（旧版 refreshMeQuote 在守卫之前）
//   头像/封面/背景   ← startMeTiles（5s / 20s+7s / 20s+14s）
//   GAME 弹窗       ← SteamGameModal（每次打开都重新请求）
//   电影/专辑/Kook  ← MeModals
//
// 视觉：整页做成一块「浏览器窗口」式的画框，人物站在画框右侧、身体溢出框沿。
// 人物是自带 alpha 的全身抠图（黑白 + 保留外套颜色），压成 WebP 使用。
import { nextTick, onActivated, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useVirtue } from '../composables/useVirtue.js';
import { startMeTiles } from '../composables/useMeTiles.js';
import { useTheme } from '../composables/useTheme.js';
import { meQuotes } from '../data/quotes.js';
import { blogPosts } from '../data/blogPosts.js';
import { LOCAL_ASSETS } from '../data/assets.js';
import SteamGameModal from '../components/SteamGameModal.vue';
import MeModals from '../components/MeModals.vue';

const router = useRouter();
const { virtue } = useVirtue();
const { isDark } = useTheme();

// 四张人物照：都是透明底抠图（黑白 + 保留外套颜色），
// 统一裁成 722×1317 的画布，底边对齐。左右两侧各显示一张，定时随机切换。
const PORTRAITS = [
  '/me/hero_compressed/HuangWeiLong_0.webp',
  '/me/hero_compressed/HuangWeiLong_1.webp',
  '/me/hero_compressed/HuangWeiLong_2.webp',
  '/me/hero_compressed/HuangWeiLong_3.webp',
];
const BACKDROP = '/me/1.jpg';

const portraitLayers = ref([PORTRAITS[0], PORTRAITS[1]]);
const portraitFront = ref(0);
let portraitTimer = null;
const preloadedPortraits = [];

function preloadPortraits() {
  if (preloadedPortraits.length) return;
  for (const src of PORTRAITS) {
    const img = new Image();
    img.src = src;
    preloadedPortraits.push(img);
  }
}

function randomOther(current) {
  let i;
  do {
    i = Math.floor(Math.random() * PORTRAITS.length);
  } while (i === current);
  return i;
}

function rotatePortrait() {
  const current = PORTRAITS.indexOf(portraitLayers.value[portraitFront.value]);
  const next = randomOther(current);
  const hidden = 1 - portraitFront.value;
  const layers = [...portraitLayers.value];
  layers[hidden] = PORTRAITS[next];
  portraitLayers.value = layers;

  // 先让隐藏层拿到新图（已预加载），下一帧再交叉淡入
  requestAnimationFrame(() => {
    portraitFront.value = hidden;
  });
}

// 卡片顺序就是旧站卡片的顺序（新→旧），所以第一篇即最新
const lastUpdate = blogPosts[0].cardDate;

// 引用：setup 先给一次随机值（等价于首次进入），之后每次激活再换
const quote = ref(meQuotes[Math.floor(Math.random() * meQuotes.length)]);
let activationCount = 0;
onActivated(() => {
  activationCount += 1;
  if (activationCount > 1) {
    quote.value = meQuotes[Math.floor(Math.random() * meQuotes.length)];
  }
  // 引用长度变化会改变画框高度，重新算一次缩放
  scheduleFit();
});

const avatarRef = ref(null);
const coverRef = ref(null);
const moreRef = ref(null);
const stageRef = ref(null);
const fitEl = ref(null);
const rigEl = ref(null);

// ── 整个构图缩放到视口里 ────────────────────────────────────────────────
// 画框 + 右侧人物是一个整体：先量出它的自然包围盒（人物是绝对定位，
// 会伸到画框右边和上面），再把包围盒缩放到舞台的可用区域里并居中。
// 这样任何分辨率下都能一眼看全，不需要滚动。
let fitRaf = 0;
let fitObserver = null;

function fitComposition() {
  const stage = stageRef.value;
  const fit = fitEl.value;
  const rig = rigEl.value;
  const subjects = rig ? [...rig.querySelectorAll('.me-subject')] : [];
  if (!stage || !fit || !rig || !subjects.length) return;

  // offset* 不受 transform 影响，量到的是构图的设计尺寸
  const fw = rig.offsetWidth;
  const fh = rig.offsetHeight;

  // 肖像的高度基准是 .me-frame__body（画框里那块内容），不是整个画框：
  //   底边与 body 底边对齐；顶部让出一点点。
  const body = rig.querySelector('.me-frame__body');
  let bodyTop = 0;
  let bodyH = fh;
  if (body) {
    let node = body;
    while (node && node !== rig) {
      bodyTop += node.offsetTop;
      node = node.offsetParent;
    }
    bodyH = body.offsetHeight;
  }
  const headGap = Math.round(bodyH * 0.12);
  for (const subject of subjects) {
    subject.style.top = `${bodyTop + headGap}px`;
    subject.style.height = `${Math.max(1, bodyH - headGap)}px`;
    subject.style.bottom = 'auto';
  }

  let left = 0;
  let top = 0;
  let right = fw;
  let bottom = fh;
  for (const subject of subjects) {
    left = Math.min(left, subject.offsetLeft);
    top = Math.min(top, subject.offsetTop);
    right = Math.max(right, subject.offsetLeft + subject.offsetWidth);
    bottom = Math.max(bottom, subject.offsetTop + subject.offsetHeight);
  }
  const bw = Math.max(1, right - left);
  const bh = Math.max(1, bottom - top);

  fit.style.width = `${bw}px`;
  fit.style.height = `${bh}px`;
  rig.style.left = `${-left}px`;
  rig.style.top = `${-top}px`;

  const cs = getComputedStyle(stage);
  const padL = parseFloat(cs.paddingLeft);
  const padT = parseFloat(cs.paddingTop);
  const padR = parseFloat(cs.paddingRight);
  const padB = parseFloat(cs.paddingBottom);
  const contentW = stage.clientWidth - padL - padR;
  const contentH = stage.clientHeight - padT - padB;
  const cx = padL + contentW / 2;
  const cy = padT + contentH / 2;

  // 目标是让 **ME 画框的中心** 落在舞台内容区中心（而不是整个包围盒的中心）。
  // 人物在右侧探出去，所以画框会保持居中，人物占用右侧留白。
  const fcx = fw / 2 - left;
  const fcy = fh / 2 - top;
  const eps = 0.001;
  const limits = [
    (cx - padL) / Math.max(eps, fcx - left),
    (stage.clientWidth - padR - cx) / Math.max(eps, right - fcx),
    (cy - padT) / Math.max(eps, fcy - top),
    (stage.clientHeight - padB - cy) / Math.max(eps, bottom - fcy),
  ];
  const scale = Math.max(0.05, Math.min(1, ...limits));
  const x = cx - fcx * scale;
  const y = cy - fcy * scale;
  fit.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}

function scheduleFit() {
  if (fitRaf) return;
  fitRaf = requestAnimationFrame(() => {
    fitRaf = 0;
    fitComposition();
  });
}

// ── 画框透视 ────────────────────────────────────────────────────────────
// 指针在画框内的相对位置（-1..1）写成 CSS 变量：
//   画框轻微 rotateX/rotateY，人物再多走一截 —— 两者的位移差就是「离镜头更近」。
// 触屏和 prefers-reduced-motion 下不绑定，变量保持 0。
const finePointer = ref(false);
const reducedMotion = ref(false);

function onStageMove(event) {
  if (!finePointer.value || reducedMotion.value) return;
  const stage = stageRef.value;
  const rig = stage?.querySelector('.me-rig');
  if (!rig) return;
  const r = rig.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const mx = Math.max(-1.4, Math.min(1.4, ((event.clientX - r.left) / r.width) * 2 - 1));
  const my = Math.max(-1.4, Math.min(1.4, ((event.clientY - r.top) / r.height) * 2 - 1));
  stage.style.setProperty('--mx', mx.toFixed(3));
  stage.style.setProperty('--my', my.toFixed(3));
}

function onStageLeave() {
  const stage = stageRef.value;
  if (!stage) return;
  stage.style.setProperty('--mx', '0');
  stage.style.setProperty('--my', '0');
}

onMounted(() => {
  finePointer.value = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  reducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  startMeTiles({ avatar: avatarRef.value, cover: coverRef.value, more: moreRef.value });
  preloadPortraits();
  portraitTimer = setInterval(rotatePortrait, 6000);

  nextTick(() => {
    fitComposition();
    // 字体/引用/头像变化都会改画框高度，观察设计尺寸而不是缩放后的视觉尺寸
    if (typeof ResizeObserver !== 'undefined') {
      fitObserver = new ResizeObserver(scheduleFit);
      if (rigEl.value) fitObserver.observe(rigEl.value);
    }
  });
  document.fonts?.ready.then(scheduleFit);
  window.addEventListener('resize', scheduleFit);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', scheduleFit);
  fitObserver?.disconnect();
  if (fitRaf) cancelAnimationFrame(fitRaf);
  if (portraitTimer) clearInterval(portraitTimer);
});

const gameOpen = ref(false);
const movieOpen = ref(false);
const albumOpen = ref(false);
const kookOpen = ref(false);

// 旧版是内联 onclick 里直接调 clipboard + alert
function copyWeChat() {
  navigator.clipboard.writeText('X15021373202');
  alert('WeChat ID copied: X15021373202');
}
</script>

<template>
  <main class="page active">
    <section
      ref="stageRef"
      class="me-stage"
      :class="{ 'is-dark': isDark }"
      @pointermove.passive="onStageMove"
      @pointerleave="onStageLeave"
    >
      <div class="me-stage__bg" :style="{ backgroundImage: `url(${BACKDROP})` }" aria-hidden="true" />
      <div class="me-stage__veil" aria-hidden="true" />

      <div ref="fitEl" class="me-fit">
      <div ref="rigEl" class="me-rig">
        <div class="me-frame">
          <div class="me-frame__bar">
            <div class="me-frame__tabs">
              <span class="me-frame__tab is-active">PROFILE</span>
              <button class="me-frame__tab" type="button" @click="router.push('/me/gallery')">GALLERY</button>
            </div>
          </div>

          <div class="me-frame__body">
            <div class="me-hero">
              <div class="me-hero__copy">
                <p class="me-eyebrow">ME / 01</p>
                <h1 class="me-virtue" id="mePageTitle">{{ virtue }}</h1>
                <p class="me-virtue-sub">BE {{ virtue }}</p>

                <div class="me-identity">
                  <div class="me-avatar-wrapper">
                    <img ref="avatarRef" :src="LOCAL_ASSETS.meAvatar" alt="Profile Photo" class="me-avatar" id="meAvatar">
                  </div>
                  <div class="me-info-box">
                    <p class="me-last-update">LAST UPDATED · <span id="meLastUpdate">{{ lastUpdate }}</span></p>
                    <h2 class="me-name">HUANG WEI LONG</h2>
                    <p class="me-title">DREAMER &amp; IDEALIST</p>
                    <p class="me-description">Chasing dreams</p>
                  </div>
                </div>

                <div class="me-social-box">
                  <a href="#" class="social-item" title="WeChat: X15021373202" @click.prevent="copyWeChat">
                    <svg xmlns="http://www.w3.org/2000/svg" stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 16 16">
                      <path d="M2.678 11.894a1 1 0 0 1 .287.801 11 11 0 0 1-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 0 1 .71-.074A8 8 0 0 0 8 14c3.996 0 7-2.807 7-6s-3.004-6-7-6-7 2.808-7 6c0 1.468.617 2.83 1.678 3.894m-.493 3.905a22 22 0 0 1-.713.129c-.2.032-.352-.176-.273-.362a10 10 0 0 0 .244-.637l.003-.01c.248-.72.45-1.548.524-2.319C.743 11.37 0 9.76 0 8c0-3.866 3.582-7 8-7s8 3.134 8 7-3.582 7-8 7a9 9 0 0 1-2.347-.306c-.52.263-1.639.742-3.468 1.105"/>
                    </svg>
                  </a>
                  <a href="https://github.com/HuangWeiLong-dot" target="_blank" class="social-item" title="GitHub">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.026A9.578 9.578 0 0112 6.844c.85.004 1.705.114 2.504.336 1.909-1.295 2.747-1.026 2.747-1.026.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.482A10.02 10.02 0 0022 12.017C22 6.484 17.522 2 12 2z" clip-rule="evenodd"/>
                    </svg>
                  </a>
                  <a href="https://x.com/HuangWeiLong525" target="_blank" class="social-item" title="X (Twitter)">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
                    </svg>
                  </a>
                  <a href="mailto:3571676852@qq.com" class="social-item" title="Email">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                      <polyline points="22,6 12,13 2,6"/>
                    </svg>
                  </a>
                  <a href="#" class="social-item" id="kookSocialBtn" title="Kook Community" @click.prevent="kookOpen = true">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.486 2 2 6.486 2 12c0 1.8.478 3.487 1.31 4.953L2 22l5.047-1.31A9.96 9.96 0 0012 22c5.514 0 10-4.486 10-10S17.514 2 12 2zm0 18a8 8 0 01-4.072-1.116l-.292-.175-3.008.783.783-3.008-.175-.292A8 8 0 1112 20zm4.4-5.4c-.243-.121-1.434-.708-1.654-.787-.221-.08-.382-.121-.543.121-.161.243-.625.787-.767.95-.141.161-.282.181-.524.06-.243-.121-1.024-.377-1.95-1.204-.721-.643-1.208-1.437-1.349-1.679-.141-.243-.015-.374.106-.495.109-.109.243-.282.364-.423.121-.141.161-.243.243-.404.080-.161.040-.302-.020-.423-.060-.121-.543-1.31-.744-1.793-.196-.470-.395-.406-.543-.413l-.464-.008c-.161 0-.423.060-.645.302-.222.243-.847.828-.847 2.018 0 1.19.868 2.341.989 2.502.121.161 1.706 2.604 4.135 3.65.578.249 1.029.398 1.379.509.579.184 1.104.158 1.52.096.464-.069 1.434-.585 1.635-1.15.201-.565.201-1.05.141-1.15-.060-.099-.221-.16-.464-.281z"/>
                    </svg>
                  </a>
                </div>

                <button class="me-game-btn" id="gameBtn" @click="gameOpen = true">
                  <span>GAME</span><span class="me-game-btn__arrow">↗</span>
                </button>

                <blockquote class="me-quote">
                  <div class="quote-text" id="quoteText">{{ quote }}</div>
                  <div class="quote-author">— Live In Passion</div>
                </blockquote>
              </div>

              <div class="me-hero__space" aria-hidden="true" />
            </div>

            <div class="me-tiles">
              <div class="me-section-box me-movie-box" id="favouriteMovie" @click="movieOpen = true">
                <span>FAVOURITE MOVIE</span>
              </div>
              <div class="me-section-box me-album-box" id="favouriteAlbum" @click="albumOpen = true">
                <span>FAVOURITE ALBUM</span>
              </div>
              <div class="me-section-box me-more-box" id="moreSection" @click="router.push('/gallery')">
                <div class="me-more-bg" id="moreSectionBg" ref="moreRef" />
                <span>MORE</span>
              </div>
              <div class="me-section-box me-gallery-box" id="meGalleryBtn" @click="router.push('/me/gallery')">
                <div class="me-more-bg" id="meGalleryCover" ref="coverRef" />
                <span>GALLERY</span>
              </div>
            </div>

            <div class="me-snake">
              <div class="snake-title">GITHUB ACTIVITY</div>
              <!-- GIF 画布四周有白边（右侧/底部尤其明显），用固定比例裁掉 -->
              <div class="snake-crop">
                <img
                  src="https://raw.githubusercontent.com/HuangWeiLong-dot/liveinpassion/output/github-contribution-grid-snake.gif"
                  alt="GitHub Contribution Snake"
                  class="github-snake"
                >
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧人物：四张照片定时随机交叉淡入 -->
        <div class="me-subject" aria-hidden="true">
          <img
            v-for="(src, i) in portraitLayers"
            :key="`p${i}`"
            class="me-subject__img"
            :class="{ 'is-on': portraitFront === i }"
            :src="src"
            alt=""
            decoding="async"
            draggable="false"
          >
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
/* ── 舞台：背景是一张重度模糊、去色的照片 ─────────────────────────────── */
.me-stage {
  --frame-paper: #f4f4f4;
  --frame-ink: #0b0b0b;
  --mx: 0;
  --my: 0;
  position: relative;
  /* 整个构图（画框 + 右侧人物）缩放到视口里；ME 画框居中，页面不滚动。 */
  height: 100vh;
  min-height: 100vh;
  box-sizing: border-box;
  padding: calc(88px + 24px) 24px 24px;
  overflow: hidden;
  isolation: isolate;
}

/* 暗色主题下画框跟着变暗：纸边、边框、标签条都不再是白的 */
.me-stage.is-dark {
  --frame-paper: #141414;
  --frame-ink: #f2f2f2;
}

.me-stage__bg {
  position: absolute;
  inset: -8%;
  background-position: center;
  background-size: cover;
  filter: blur(48px) grayscale(1) brightness(0.55) contrast(1.1);
  transform: scale(1.08);
  z-index: -2;
  transition: filter 0.45s ease, opacity 0.45s ease;
}

.me-stage.is-dark .me-stage__bg {
  filter: blur(48px) grayscale(1) brightness(0.48) contrast(1.14);
}

/* 浅色主题下背景必须也是亮的：页头/导航用的是深色字，压在暗底上会读不出来。 */
.me-stage:not(.is-dark) .me-stage__bg {
  filter: blur(48px) grayscale(1) brightness(1.16) contrast(0.92);
  opacity: 0.85;
}

/* 背景上再压一层暗角，画框和人物才浮得出来 */
.me-stage__veil {
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    radial-gradient(ellipse 62% 58% at 50% 38%, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.38) 72%, rgba(0, 0, 0, 0.62) 100%),
    linear-gradient(to bottom, rgba(0, 0, 0, 0.35), rgba(0, 0, 0, 0.12) 34%, rgba(0, 0, 0, 0.5));
}

.me-stage:not(.is-dark) .me-stage__veil {
  background:
    radial-gradient(ellipse 62% 58% at 50% 38%, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.26) 72%, rgba(255, 255, 255, 0.5) 100%),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0.18) 34%, rgba(255, 255, 255, 0.42));
}

/* JS 量完构图后写入宽高 + scale；绝对定位 + translate 把它钉在视口内容区中心。
   不能用 grid/flex 居中：构图（1798px 宽）比舞台大，grid 会把行撑大，
   缩放后的视觉中心就偏了。 */
.me-fit {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  will-change: transform;
}

.me-rig {
  position: absolute;
  left: 0;
  top: 0;
  width: min(1240px, calc(100vw - 48px));
  perspective: 1600px;
}

/* ── 画框：纸边 + 顶部标签条（纸色随主题走） ─────────────────────────── */
.me-frame {
  position: relative;
  z-index: 1;
  padding: 10px;
  background: var(--frame-paper);
  border: 1px solid var(--frame-ink);
  box-shadow: 0 46px 120px rgba(0, 0, 0, 0.55);
  /* 静止时保持平直：人物底边才能和 body 底边精确对齐；鼠标进入后再摆 */
  transform:
    rotateY(calc(var(--mx) * -1.15deg))
    rotateX(calc(var(--my) * 0.75deg));
  transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

.me-frame__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 6px 0 0;
  background: var(--frame-paper);
  color: var(--frame-ink);
  overflow: hidden;
}

.me-frame__tabs {
  display: flex;
  align-items: stretch;
  height: 100%;
}

.me-frame__tab {
  display: inline-flex;
  align-items: center;
  height: 100%;
  padding: 0 30px;
  border: 0;
  background: transparent;
  color: var(--frame-ink);
  font-family: 'Oswald', sans-serif;
  font-size: 0.58rem;
  font-weight: 600;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  cursor: pointer;
}

.me-frame__tab.is-active {
  background: var(--frame-ink);
  color: var(--frame-paper);
}

.me-frame__tab:not(.is-active):hover {
  background: rgba(127, 127, 127, 0.16);
}

.me-frame__body {
  background: var(--bg);
  border: 1px solid var(--border-color);
  padding: 32px 36px 26px;
}

/* ── 上半：文案在左，人物在右（右侧留空，人物是绝对定位的） ───────────── */
.me-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(280px, 0.95fr);
  gap: 28px;
  min-height: 470px;
}

.me-hero__copy {
  position: relative;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.me-eyebrow {
  margin: 0 0 12px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.58rem;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.me-virtue {
  margin: 0;
  font-family: 'Oswald', sans-serif;
  font-size: clamp(3.6rem, 7vw, 6.4rem);
  font-weight: 700;
  line-height: 0.9;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-primary);
}

.me-virtue-sub {
  margin: 10px 0 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.6rem;
  letter-spacing: 0.42em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

/* 身份卡 */
.me-identity {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 28px;
  padding-top: 18px;
  border-top: 1px solid var(--border-color);
  width: 100%;
  max-width: 500px;
}

.me-avatar-wrapper {
  width: 76px;
  height: 76px;
  flex: 0 0 76px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  background: var(--bg);
}

.me-avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  filter: grayscale(1) contrast(1.05);
}

.me-info-box {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.me-last-update {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.5rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-secondary);
  opacity: 0.6;
}

.me-name {
  margin: 0;
  font-family: 'Oswald', sans-serif;
  font-size: 1.55rem;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-primary);
}

.me-title {
  margin: 0;
  font-family: 'Oswald', sans-serif;
  font-size: 0.58rem;
  font-weight: 500;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.me-description {
  margin: 7px 0 0;
  font-family: var(--font-sans);
  font-size: 0.75rem;
  letter-spacing: 0.02em;
  color: var(--text-secondary);
  opacity: 0.85;
}

/* 社交 */
.me-social-box {
  display: flex;
  gap: 0;
  margin-top: 20px;
  border-top: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
}

.social-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  color: var(--text-secondary);
  text-decoration: none;
  transition: background 0.2s ease, color 0.2s ease;
}

.social-item:hover {
  background: var(--text-primary);
  color: var(--bg);
}

.social-item svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

/* GAME */
.me-game-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 500px;
  margin-top: 18px;
  padding: 13px 16px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  font-family: 'Oswald', sans-serif;
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
}

.me-game-btn:hover {
  background: var(--text-primary);
  border-color: var(--text-primary);
  color: var(--bg);
}

.me-game-btn__arrow {
  font-size: 0.9rem;
  letter-spacing: 0;
}

/* 引用 */
.me-quote {
  margin: 18px 0 0;
  padding: 0 0 0 18px;
  border-left: 1px solid var(--border-color);
  max-width: 500px;
}

.quote-text {
  font-family: var(--font-sans);
  font-size: 0.82rem;
  font-style: italic;
  line-height: 1.75;
  letter-spacing: 0.02em;
  color: var(--text-secondary);
}

.quote-author {
  margin-top: 10px;
  font-family: 'Oswald', sans-serif;
  font-size: 0.56rem;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-secondary);
  opacity: 0.6;
}

/* ── 人物 ─────────────────────────────────────────────────────────────── */
/* 只在画框右侧显示；DOM 在画框之后，所以框线裁不到。 */
.me-subject {
  position: absolute;
  /* 高度在 fitComposition 里按 .me-frame__body 计算：
     底边贴 body 底边，顶部让出一点；下面的 top/bottom 只是兜底。 */
  top: 12%;
  bottom: 0;
  height: auto;
  right: -20%;
  width: auto;
  aspect-ratio: 790 / 1317;
  z-index: 4;
  pointer-events: none;
  transform: translate(calc(var(--mx) * 13px), calc(var(--my) * 9px));
  transition: transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
  isolation: isolate;
}

.me-subject__img {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  /* 四张抠图都统一成 790×1317 的透明画布，头顶和底边都对齐 */
  object-fit: contain;
  /* 只在最底部轻轻化开一点，和背景稍微融合 */
  -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 93%, rgba(0, 0, 0, 0.55) 98%, transparent 100%);
  mask-image: linear-gradient(to bottom, #000 0%, #000 93%, rgba(0, 0, 0, 0.55) 98%, transparent 100%);
  filter: contrast(1.02) saturate(1.02);
  opacity: 0;
  transition: opacity 0.8s ease;
}

.me-subject__img.is-on {
  opacity: 1;
}


/* ── 底部四格：电影 / 专辑 / MORE / GALLERY ───────────────────────────── */
.me-tiles {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 22px;
  border-top: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
}

.me-tiles .me-section-box {
  position: relative;
  min-height: 150px;
  border: 0;
  border-right: 1px solid var(--border-color);
  padding: 0;
  overflow: hidden;
}

.me-tiles .me-section-box:last-child {
  border-right: 0;
}

.me-tiles .me-section-box span {
  position: relative;
  z-index: 2;
  font-family: 'Oswald', sans-serif;
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-secondary);
  transition: color 0.2s ease;
}

.me-tiles .me-movie-box span,
.me-tiles .me-album-box span,
.me-tiles .me-more-box span,
.me-tiles .me-gallery-box span {
  color: #fff;
}

/* 电影 / 专辑：压暗 + 灰度，和整页的黑白语言一致（hover 时回一点颜色） */
.me-tiles .me-movie-box::after,
.me-tiles .me-album-box::after {
  filter: grayscale(0.85) contrast(1.05);
  transition: transform 0.5s ease, filter 0.4s ease;
}

.me-tiles .me-movie-box:hover::after,
.me-tiles .me-album-box:hover::after {
  filter: grayscale(0.3) contrast(1.05);
}

.me-tiles .me-more-bg {
  filter: grayscale(0.7);
}

.me-tiles .me-more-box:hover .me-more-bg,
.me-tiles .me-gallery-box:hover .me-more-bg {
  transform: scale(1.06);
  filter: grayscale(0.3);
}

/* ── GITHUB SNAKE ─────────────────────────────────────────────────────── */
.me-snake {
  margin-top: 20px;
  border: 1px solid var(--border-color);
  background: var(--bg);
  overflow: hidden;
}

.snake-title {
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-color);
  font-family: 'Oswald', sans-serif;
  font-size: 0.56rem;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

/* GIF 是 880×206，有效内容只占 x 16–862 / y 16–142；
   按这个有效区域裁切，白色右边和底部不再露出来。 */
.snake-crop {
  position: relative;
  aspect-ratio: 845 / 125;
  overflow: hidden;
  background: #fff;
}

.github-snake {
  position: absolute;
  left: -1.89%;
  top: -12.78%;
  width: 104.02%;
  max-width: none;
  height: auto;
  display: block;
}

/* ── 窄屏 ─────────────────────────────────────────────────────────────── */
@media (max-width: 1024px) {
  /* 这一档开始有固定底部 MobileDock：底部留出它的高度 */
  .me-stage {
    padding: calc(83px + 16px) 16px calc(72px + 16px);
  }

  .me-rig {
    width: calc(100vw - 32px);
  }
}

@media (max-width: 900px) {
  .me-stage {
    padding: calc(83px + 16px) 16px calc(72px + 16px);
  }

  .me-frame__body {
    padding: 32px 24px 24px;
  }

  .me-hero {
    grid-template-columns: 1fr;
    min-height: 0;
    gap: 0;
  }

  .me-hero__space {
    display: none;
  }

}

@media (max-width: 620px) {
  .me-stage {
    padding: calc(83px + 12px) 12px calc(68px + 12px);
  }

  .me-rig {
    width: calc(100vw - 24px);
  }

  .me-frame {
    padding: 7px;
  }

  .me-frame__bar {
    height: 38px;
  }

  .me-frame__tab {
    padding: 0 18px;
    font-size: 0.5rem;
  }

  .me-frame__body {
    padding: 26px 18px 20px;
  }

  .me-virtue {
    font-size: clamp(2.4rem, 12.5vw, 3.4rem);
  }

  .me-virtue-sub {
    letter-spacing: 0.3em;
  }

  .me-eyebrow {
    margin-bottom: 12px;
  }

  .me-identity {
    margin-top: 30px;
    padding-top: 20px;
    gap: 14px;
  }

  .me-avatar-wrapper {
    width: 62px;
    height: 62px;
    flex-basis: 62px;
  }

  .me-name {
    font-size: 1.2rem;
  }

  .me-tiles {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .me-tiles .me-section-box {
    min-height: 128px;
    border-bottom: 1px solid var(--border-color);
  }

  .me-tiles .me-section-box:nth-child(2n) {
    border-right: 0;
  }

  .me-tiles .me-section-box:nth-child(n + 3) {
    border-bottom: 0;
  }
}
</style>
