<script setup>
// ME 页：一台方角复古 CRT 电视机，屏幕里三个频道（ME / GALLERY / FRIENDS）。
// 原来的「EXPLORE 无限回廊」（30 张照片在 3D 隧道里飞、滚动推进整页）已整体移除：
// 这一页现在只有电视一屏，不再有纵向叙事、滚动锁和自动推进。
// 屏幕里保留雪花花屏 + 横向撕裂的换台故障；画面之上叠 RGB 荧光栅格与色散。
import { onActivated, onBeforeUnmount, onDeactivated, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useVirtue } from '../composables/useVirtue.js';
import { meQuotes } from '../data/quotes.js';
import { blogPosts } from '../data/blogPosts.js';
import SteamGameModal from '../components/SteamGameModal.vue';
import MeModals from '../components/MeModals.vue';

const router = useRouter();
const { virtue } = useVirtue();

const reduceMotion = () => (
  window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

// 电视里的三个频道：首屏只放 ME，下面的频道按钮负责切换
const CHANNELS = [
  { id: 'me', label: 'ME' },
  { id: 'gallery', label: 'GALLERY' },
  { id: 'friends', label: 'FRIENDS' },
];
const activeChannel = ref(0);
const switching = ref(false);
// 换台雪花用的画布（模板里的 <canvas ref="noiseRef">）
const noiseRef = ref(null);

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

// ── 生命周期 ────────────────────────────────────────────────────────────
// 换台时还没播完的雪花 / 定时器：离开这一页就收掉
onDeactivated(cancelChannelSwitch);
onBeforeUnmount(cancelChannelSwitch);

// 每次回到这一页换一句引言（原来的行为，和回廊无关）
onActivated(() => {
  quote.value = meQuotes[Math.floor(Math.random() * meQuotes.length)];
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
  <main class="page active me-intro-page">
    <!-- ── 一台电视里的三个频道：ME / GALLERY / FRIENDS ─────────────────── -->
    <section class="me-tv-stage" aria-label="ME, Gallery and Friends">
      <div class="me-tv">
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
          <!-- CRT 光学层：RGB 荧光栅格（含屏幕中间那团磷光辉光）+ 玻璃暗角 -->
          <span class="me-tv__rgb" aria-hidden="true" />
          <span class="me-tv__vignette" aria-hidden="true" />
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
  position: relative;
  background: var(--bg);
  color: var(--text-primary);
  overflow: visible;
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
  /* 只留内凹的高光/阴影和一条 4px 的硬投影。
     原来那条 `0 28px 60px rgba(0, 0, 0, 0.5)` 的 60px 模糊投影在深色底上
     会读成一圈"圆角背景"糊在电视后面 —— 机身是直角的，投影也不该是圆的。 */
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.26),
    inset 0 -5px 10px rgba(0, 0, 0, 0.4),
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
  /* 屏幕里所有文字带一点红/蓝分离：CRT 三枪对不齐的那点色散 */
  text-shadow: 0.5px 0 rgba(255, 70, 70, 0.3), -0.5px 0 rgba(70, 130, 255, 0.3);
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

/* ── CRT 光学层 ────────────────────────────────────────────────────────
   竖条是红/绿/蓝三枪的次像素荧光栅格（3px 一组）；中间那团径向光是
   "屏幕正中亮着"的磷光辉光。文字上的红蓝分离（色散）见
   .me-tv__screen-inner / .me-channel__word 的 text-shadow。 */
.me-tv__rgb {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  background-image:
    radial-gradient(
      62% 58% at 50% 50%,
      rgba(244, 240, 232, 0.09),
      transparent 72%
    ),
    repeating-linear-gradient(
      90deg,
      rgba(255, 46, 46, 0.085) 0 1px,
      rgba(46, 255, 122, 0.07) 1px 2px,
      rgba(46, 96, 255, 0.085) 2px 3px
    );
  background-size: 100% 100%, 3px 100%;
  mix-blend-mode: screen;
  opacity: 0.85;
}

/* 玻璃暗角：四角压暗、中心留亮，撑出老 CRT 的凸面感 */
.me-tv__vignette {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  background: radial-gradient(
    118% 96% at 50% 50%,
    transparent 56%,
    rgba(0, 0, 0, 0.2) 78%,
    rgba(0, 0, 0, 0.52) 100%
  );
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
  /* 扁平化：没有描边、没有渐变、没有高光/投影，只有一块纯色底 + 反色 hover */
  border: 0;
  border-radius: 0;
  background: color-mix(in srgb, #000 12%, var(--tv-plastic));
  color: color-mix(in srgb, var(--text-primary) 62%, var(--tv-plastic));
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 7.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.me-tv__key:hover {
  background: var(--text-primary);
  color: var(--bg);
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
  /* CRT 色散：红/蓝两条 0.9px 的错位影子 + 一点磷光辉光 */
  text-shadow:
    0.9px 0 rgba(255, 70, 70, 0.5),
    -0.9px 0 rgba(70, 130, 255, 0.5),
    0 0 26px rgba(244, 240, 232, 0.12);
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

/* CTA 是真正的链接按钮：扁平化后只剩一块纯色底，hover 反色 */
.me-channel__cta {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 0.55rem;
  margin: 0.7rem 0 0;
  padding: 0.5rem 0.8rem;
  border: 0;
  border-radius: 0;
  background: rgba(244, 240, 232, 0.14);
  color: var(--tv-paper);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  text-decoration: none;
  transition: background 0.2s ease, color 0.2s ease;
}

.me-channel__cta:hover {
  background: var(--tv-paper);
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
  /* 扁平化：不描边；静息透明，hover 一层薄底，选中整块反色 */
  border: 0;
  border-radius: 0;
  background: transparent;
  color: rgba(244, 240, 232, 0.6);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 7.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.me-tv__tab b {
  font-weight: 700;
}

.me-tv__tab:hover {
  background: rgba(244, 240, 232, 0.1);
  color: var(--tv-paper);
}

.me-tv__tab.is-active {
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
  /* 手机 / 平板：电视按屏幕比例铺开 */
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

  .me-channel__cta,
  .me-tv__key,
  .me-tv__tab {
    transition: none;
  }
}

</style>
