<script setup>
// PROJECTION —— 影片《The Projection》(黑白 / 1'18" / 只有呼吸声) 的放映页。
//
// 这一页不是普通内容页，它是一张会动的电影海报：
//   · 标题字形沿用片子自己的 title card（Oswald 700 + 宽字距），不是另起一套；
//   · 标题卡只有三样东西：黑底、高噪点颗粒、居中的片名。唯一的动态光效是
//     "镜头扫到太阳"——一团白光带横向拉丝从画面上方掠过，亮一下就灭。没有别的
//     粒子、划痕、飘来飘去的光斑，也不放台词和说明文字；
//   · 标题的光晕按 2 秒一拍呼吸，和片子里的呼吸是同一个频率（30 次/分）。
//
// 进片后给 <html> 挂 projection-immersive：站点的头部、左下角的 Ava 塔、音乐
// 播放器全部让开，只剩画面和一条会自动隐去的控制条。站点音乐在进片瞬间暂停 ——
// 这部片的配乐就是呼吸，不能和歌叠在一起。
//
// 片源在 R2：img.liveinpassion.me/films/the-projection.mp4（134 MB，带 Range，
// 可以自由拖动）。海报底图用片尾云隙光的同一帧，压暗、模糊后当光晕用。

import { computed, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue';
import { useMusicPlayer } from '../composables/useMusicPlayer.js';

const FILM_SRC = 'https://img.liveinpassion.me/films/the-projection.mp4';

// 片名按字母拆开：进场时一道光从左扫到右，字母一个一个被照出来。
// 每个字母带自己的序号 --i，CSS 用它错开动画。
let letterIndex = 0;
const titleWords = 'THE PROJECTION'.split(' ').map((word) =>
  Array.from(word).map((ch) => ({ ch, i: letterIndex++ }))
);

const { isPlaying: musicPlaying, togglePlay: toggleMusic } = useMusicPlayer();

// poster：标题卡；playing：正片
const state = ref('poster');
const buffering = ref(false);
const isFullscreen = ref(false);
// videoEl.paused 不是响应式的，播放/暂停图标得跟着事件自己维护
const isPaused = ref(true);
// 音量：0–1。收音机调频式横向刻度尺，左右拖拽
const volume = ref(0.8);
const volumeText = computed(() => (volume.value === 0 ? 'MUTE' : `VOL ${Math.round(volume.value * 100)}`));
// 进度条
const currentTime = ref(0);
const duration = ref(77.5);
const progress = computed(() => (duration.value ? (currentTime.value / duration.value) * 100 : 0));

const stageEl = ref(null);
const screenEl = ref(null);
const videoEl = ref(null);
const grainEl = ref(null);

const reducedMotion = typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── 声音 ─────────────────────────────────────────────────────────────────
// 片子本身混得很轻（全片平均约 −39 dB、峰值 −14 dB），在笔记本/手机扬声器上
// 几乎听不见。这里用 Web Audio 补约 +12 dB；音量旋钮调的是这个增益，不是
// video.volume。Web Audio 建不起来时退回原生音量。
const AUDIO_GAIN = 4;
let audioCtx = null;
let audioGain = null;

function ensureAudioGraph() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return;
  }
  const el = videoEl.value;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!el || !Ctx) return;
  try {
    audioCtx = new Ctx();
    const source = audioCtx.createMediaElementSource(el);
    audioGain = audioCtx.createGain();
    audioGain.gain.value = volume.value * AUDIO_GAIN;
    source.connect(audioGain).connect(audioCtx.destination);
    // 一旦接进 Web Audio，音量就交给 gain 节点，元素本身保持满音量、不静音
    el.volume = 1;
    el.muted = false;
  } catch {
    audioCtx = null;
    audioGain = null;
  }
}

// ── 音量旋钮 ─────────────────────────────────────────────────────────────
function setVolume(value) {
  const v = Math.max(0, Math.min(1, value));
  volume.value = v;
  const el = videoEl.value;
  if (audioGain) {
    audioGain.gain.value = v * AUDIO_GAIN;
    if (el) {
      el.volume = 1;
      el.muted = false;
    }
  } else if (el) {
    el.volume = v;
    el.muted = v === 0;
  }
}

function onVolumeInput(event) {
  setVolume(Number(event.target.value) / 100);
}

// 收音机调频尺：刻度上指针跟手。点哪跳到哪，按住左右拖。
// 用 pointer capture 收尾，pointerup / pointercancel 都处理 —— 漏一次就会留下
// window 上的 pointermove，之后鼠标一动音量自己乱跳。
const tunerEl = ref(null);
let tunerDragging = false;

function setVolumeFromX(clientX) {
  const el = tunerEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (!rect.width) return;
  // 量化到 1%：贴边点的时候能准确落到 0 / 1，读数才会显示 MUTE
  setVolume(Math.round(((clientX - rect.left) / rect.width) * 100) / 100);
}

function onTunerDown(event) {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  tunerDragging = true;
  tunerEl.value?.setPointerCapture?.(event.pointerId);
  setVolumeFromX(event.clientX);
  window.addEventListener('pointermove', onTunerMove);
  window.addEventListener('pointerup', endTunerDrag);
  window.addEventListener('pointercancel', endTunerDrag);
}

function onTunerMove(event) {
  if (!tunerDragging) return;
  setVolumeFromX(event.clientX);
}

function endTunerDrag() {
  tunerDragging = false;
  window.removeEventListener('pointermove', onTunerMove);
  window.removeEventListener('pointerup', endTunerDrag);
  window.removeEventListener('pointercancel', endTunerDrag);
}

// ── 复古进度条：点 / 拖都能定位 ───────────────────────────────────────────
function onSeekInput(event) {
  const v = videoEl.value;
  if (!v) return;
  const t = Number(event.target.value);
  if (Number.isFinite(t)) {
    v.currentTime = t;
    currentTime.value = t;
  }
}

function onLoadedMetadata() {
  const v = videoEl.value;
  if (v && Number.isFinite(v.duration)) duration.value = v.duration;
}

function onTimeUpdate() {
  const v = videoEl.value;
  if (v) currentTime.value = v.currentTime;
}

// ── 胶片颗粒 ──────────────────────────────────────────────────────────────
// 8 张 128×128 的噪点贴图轮播（约 12 fps）。比逐帧画 canvas 便宜得多，
// 而且 image-rendering: pixelated 放大之后正好是粗颗粒。
let grainFrames = [];
let grainTimer = null;
let grainIndex = 0;

function buildGrain() {
  if (grainFrames.length) return;
  for (let f = 0; f < 8; f += 1) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = (Math.random() * 150) | 0;
    }
    ctx.putImageData(img, 0, 0);
    grainFrames.push(`url(${c.toDataURL()})`);
  }
}

function tickGrain() {
  if (!grainEl.value || !grainFrames.length) return;
  grainIndex = (grainIndex + 1) % grainFrames.length;
  grainEl.value.style.backgroundImage = grainFrames[grainIndex];
}

// ── 跟着鼠标的光晕 ───────────────────────────────────────────────────────
// 指针位置写进 --gx / --gy；甩动速度写进 --g-o（亮度）。
// 只有还在追、或者亮度还在衰减时才继续跑 rAF，停下就彻底停。
let pointerRaf = 0;
let pointerInside = false;
let targetX = 0;
let targetY = 0;
let curX = 0;
let curY = 0;
let lastX = 0;
let lastY = 0;
let glowSpeed = 0;
let glowOpacity = 0;
// 进场那道光扫完之前，鼠标光晕先不出现，别和字母入场抢
let glowUnlocked = false;
let glowUnlockTimer = null;

function startGlow() {
  if (!pointerRaf) pointerRaf = requestAnimationFrame(stepGlow);
}

function onPointerMove(event) {
  if (event.pointerType === 'touch' || state.value !== 'poster') return;
  const el = stageEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  targetX = event.clientX - rect.left;
  targetY = event.clientY - rect.top;
  if (!pointerInside) {
    // 第一次进入不要从页面中心飞过去，直接落在指针上
    pointerInside = true;
    curX = targetX;
    curY = targetY;
    lastX = curX;
    lastY = curY;
  }
  startGlow();
}

function onPointerLeave() {
  pointerInside = false;
  startGlow();
}

function stepGlow() {
  const el = stageEl.value;
  if (!el) {
    pointerRaf = 0;
    return;
  }
  const dx = targetX - curX;
  const dy = targetY - curY;
  curX += dx * 0.16;
  curY += dy * 0.16;

  const moved = Math.hypot(curX - lastX, curY - lastY);
  lastX = curX;
  lastY = curY;
  // 甩得越快越亮，松手之后自己衰减回去 —— 那一下"扫到阳光"的闪光
  glowSpeed = glowSpeed * 0.88 + Math.min(1, moved / 26) * 0.12;

  const targetOpacity = pointerInside && glowUnlocked
    ? 0.26 + Math.min(1, glowSpeed) * 0.62
    : 0;
  glowOpacity += (targetOpacity - glowOpacity) * 0.14;

  el.style.setProperty('--gx', `${curX.toFixed(1)}px`);
  el.style.setProperty('--gy', `${curY.toFixed(1)}px`);
  el.style.setProperty('--g-o', glowOpacity.toFixed(3));

  const settle = Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3
    && Math.abs(targetOpacity - glowOpacity) < 0.004 && glowSpeed < 0.01;
  pointerRaf = settle ? 0 : requestAnimationFrame(stepGlow);
}

// ── 进片 / 退片 ───────────────────────────────────────────────────────────
// 片子在屏幕里播，页面本身不换版式：电视机、头部、四周都不动。
function startFilm(event) {
  // document 上有站点音乐的"首次交互自动起播"监听。这里的点击不该顺手把歌起播，
  // 所以先把事件拦住，再显式把正在放的音乐停下来。
  event?.stopPropagation();
  const v = videoEl.value;
  if (!v) return;
  state.value = 'playing';
  if (musicPlaying.value) toggleMusic();
  // AudioContext 必须在用户手势里创建；play() 也同步调用（不放进 nextTick），
  // 免得某些浏览器把这次手势判过期，直接静音起播。
  ensureAudioGraph();
  v.currentTime = 0;
  currentTime.value = 0;
  if (!audioGain) {
    v.volume = volume.value;
    v.muted = volume.value === 0;
  }
  v.play().catch(() => { buffering.value = false; });
}

// 停止：回到标题卡，不退出这一页
function backToPoster(event) {
  event?.stopPropagation();
  const v = videoEl.value;
  if (v) v.pause();
  state.value = 'poster';
}

function togglePlay(event) {
  event?.stopPropagation();
  const v = videoEl.value;
  if (!v) return;
  if (state.value === 'poster') {
    startFilm(event);
    return;
  }
  if (v.paused) v.play().catch(() => {});
  else v.pause();
}

function toggleFullscreen(event) {
  event?.stopPropagation();
  // 全屏的是屏幕本身（不是整台电视）：片子应该铺满显示器
  const el = screenEl.value;
  if (!el) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else el.requestFullscreen?.().catch(() => {});
}

function onFullscreenChange() {
  isFullscreen.value = Boolean(document.fullscreenElement);
}

function onEnded() {
  state.value = 'poster';
}

// ── 键盘 ──────────────────────────────────────────────────────────────────
function onKeydown(event) {
  if (state.value !== 'playing') return;
  const t = event.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (event.key === ' ' || event.key === 'k' || event.key === 'Enter') {
    event.preventDefault();
    togglePlay();
  } else if (event.key === 'Escape') {
    backToPoster();
  } else if (event.key === 'm') {
    toggleMute();
  } else if (event.key === 'f') {
    toggleFullscreen();
  }
}

// ── 生命周期 ──────────────────────────────────────────────────────────────
onMounted(() => {
  document.documentElement.classList.add('projection-page');
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  // 进站时点 ENTER 已经把站点音乐起播了。这一页的配乐只有呼吸，先把歌停掉。
  if (musicPlaying.value) toggleMusic();

  stageEl.value?.addEventListener('pointermove', onPointerMove, { passive: true });
  stageEl.value?.addEventListener('pointerleave', onPointerLeave, { passive: true });
  glowUnlockTimer = setTimeout(() => {
    glowUnlocked = true;
    if (pointerInside) startGlow();
  }, 2600);

  if (!reducedMotion) {
    buildGrain();
    tickGrain();
    grainTimer = setInterval(tickGrain, 80);
  }
});

// keep-alive 失活：正片必须停，否则离开这一页还能听见呼吸；回来重新停在标题卡。
onDeactivated(() => {
  const v = videoEl.value;
  if (v) v.pause();
  state.value = 'poster';
  endTunerDrag();
  audioCtx?.suspend?.().catch(() => {});
  cancelAnimationFrame(pointerRaf);
  pointerRaf = 0;
});

onBeforeUnmount(() => {
  document.documentElement.classList.remove('projection-page');
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  stageEl.value?.removeEventListener('pointermove', onPointerMove);
  stageEl.value?.removeEventListener('pointerleave', onPointerLeave);
  cancelAnimationFrame(pointerRaf);
  clearTimeout(glowUnlockTimer);
  clearInterval(grainTimer);
  endTunerDrag();
  audioCtx?.close?.().catch(() => {});
  audioCtx = null;
  audioGain = null;
  const v = videoEl.value;
  if (v) v.pause();
});
</script>

<template>
  <main ref="stageEl" class="proj" :class="{ 'is-playing': state === 'playing' }">
    <!-- 复古电视机：这一页唯一的实体，片子只在屏幕里播 -->
    <div class="proj__tv">
      <!-- 机身上沿：品牌 / 片名 / 信号灯 -->
      <div class="proj__bezel">
        <span class="proj__brand">
          <i class="proj__led" aria-hidden="true" />
          LIVEINPASSION
        </span>
        <span class="proj__bezel-note">THE PROJECTION</span>
        <span class="proj__signal">
          <i aria-hidden="true" />
          CH 01
        </span>
      </div>

      <!-- 屏幕：标题卡和正片都在这里 -->
      <div ref="screenEl" class="proj__screen">
        <section v-show="state === 'poster'" class="proj__poster">
          <div class="proj__center">
            <h1 class="proj__title" aria-label="THE PROJECTION">
              <span v-for="(word, wi) in titleWords" :key="wi" class="proj__word">
                <span
                  v-for="letter in word"
                  :key="letter.ch + letter.i"
                  class="proj__char"
                  :style="{ '--i': letter.i }"
                  aria-hidden="true"
                >{{ letter.ch }}</span>
              </span>
              <span class="proj__sweep" aria-hidden="true" />
            </h1>
          </div>
        </section>

        <video
          v-show="state === 'playing'"
          ref="videoEl"
          class="proj__video"
          :src="FILM_SRC"
          preload="metadata"
          playsinline
          crossorigin="anonymous"
          @loadedmetadata="onLoadedMetadata"
          @timeupdate="onTimeUpdate"
          @waiting="buffering = true"
          @playing="buffering = false; isPaused = false"
          @play="isPaused = false"
          @pause="isPaused = true"
          @ended="onEnded"
          @click="togglePlay"
        />

        <div v-if="state === 'playing' && buffering" class="proj__buffer">BUFFERING</div>

        <!-- CRT 光学层：扫描线 / 玻璃反光 / 滚动亮带 / 玻璃暗角 / 雪花 -->
        <span class="proj__scanlines" aria-hidden="true" />
        <span class="proj__glare" aria-hidden="true" />
        <span class="proj__rollbar" aria-hidden="true" />
        <span class="proj__vignette" aria-hidden="true" />
        <canvas ref="grainEl" class="proj__grain" aria-hidden="true" />
      </div>

      <!-- 机身下沿：3D 实体按键 + 音量旋钮。屏幕只负责显示，控制全在这里。 -->
      <div class="proj__deck">
        <button type="button" class="tv-key" disabled aria-label="上一集">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h2v14H7zM19 5v14l-9-7z" /></svg>
        </button>

        <button type="button" class="tv-key tv-key--main" :aria-label="isPaused ? '播放' : '暂停'" @click="togglePlay">
          <svg v-if="isPaused" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l12 7-12 7V5z" /></svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
        </button>

        <button type="button" class="tv-key" disabled aria-label="下一集">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5h2v14h-2zM5 5v14l9-7z" /></svg>
        </button>

        <!-- 复古进度条：两边按键中间的那一段 -->
        <input
          class="proj__track"
          type="range"
          min="0"
          :max="duration"
          step="0.05"
          :value="currentTime"
          :style="{ '--p': progress + '%' }"
          aria-label="播放进度"
          @input="onSeekInput"
        />

        <button type="button" class="tv-key" aria-label="停止，回到标题卡" @click="backToPoster">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1" /></svg>
        </button>

        <button type="button" class="tv-key" :aria-label="isFullscreen ? '退出全屏' : '全屏'" @click="toggleFullscreen">
          <svg v-if="isFullscreen" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v6H3v2h8V3H9zm6 18v-6h6v-2h-8v8h2z" /></svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9V3h6v2H5v4H3zm18 0h-2V5h-4V3h6v6zM3 15h2v4h4v2H3v-6zm18 0v6h-6v-2h4v-4h2z" /></svg>
        </button>

        <!-- 音量：收音机调频式的横向刻度尺，点哪跳到哪、按住左右拖；
             也能 Tab 聚焦后按方向键 -->
        <span class="proj__vol" aria-hidden="true">{{ volumeText }}</span>
        <div ref="tunerEl" class="proj__tuner" @pointerdown="onTunerDown">
          <span class="proj__tuner-scale" aria-hidden="true">
            <i class="proj__tuner-needle" :style="{ left: `${volume * 100}%` }" />
          </span>
          <input
            class="proj__tuner-input"
            type="range"
            min="0"
            max="100"
            step="1"
            :value="Math.round(volume * 100)"
            aria-label="音量"
            @input="onVolumeInput"
          />
        </div>
      </div>
    </div>

    <!-- 跟着鼠标走的那团光：像把镜头对准太阳，指针到哪，光晕和横向拉丝就到哪 -->
    <div class="proj__sun" aria-hidden="true" />
  </main>
</template>

<style scoped>
/* 这一页永远是黑的，跟站点主题无关。整页只放一台电视。 */
.proj {
  position: relative;
  height: 100dvh;
  min-height: 560px;
  overflow: hidden;
  background: #050505;
  color: #e9e4da;
  isolation: isolate;
  display: grid;
  place-items: center;
  /* 上边留给固定的站点头部，别让电视顶到 LOGO 上 */
  padding: clamp(76px, 9vh, 104px) clamp(12px, 3vw, 44px) clamp(18px, 3.2vh, 44px);
}

/* ── 复古电视机（沿用 ME 页那一台的机身语言） ─────────────────────────── */
.proj__tv {
  position: relative;
  z-index: 2;
  width: min(1180px, 94vw, calc((100svh - 250px) * 1.5));
  padding: clamp(10px, 1.1vw, 16px);
  background: linear-gradient(180deg, #3b3c3e 0%, #26282a 38%, #161718 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.22),
    inset 0 -5px 10px rgba(0, 0, 0, 0.5),
    0 4px 0 rgba(0, 0, 0, 0.45),
    0 34px 90px rgba(0, 0, 0, 0.7);
}

/* 机身上沿：品牌 / 片名 / 信号灯 */
.proj__bezel {
  display: flex;
  align-items: center;
  gap: clamp(8px, 1.2vw, 16px);
  padding: 0 clamp(6px, 1vw, 12px) clamp(8px, 1.1vh, 12px);
  font-family: 'JetBrains Mono', monospace;
  font-size: 8px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(233, 228, 218, 0.42);
  white-space: nowrap;
}

.proj__brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: rgba(233, 228, 218, 0.78);
}

.proj__led {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f4f0e8;
  box-shadow: 0 0 10px rgba(244, 240, 232, 0.55);
}

.proj__bezel-note {
  margin-left: auto;
  letter-spacing: 0.3em;
  color: rgba(233, 228, 218, 0.5);
}

.proj__signal {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.proj__signal i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  animation: led-blink 1.8s steps(2, start) infinite;
}

@keyframes led-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* 屏幕：方角玻璃 + 内阴影，和 ME 页同一套 */
.proj__screen {
  position: relative;
  aspect-ratio: 3 / 2;
  overflow: hidden;
  container-type: inline-size;
  background: #050607;
  color: #f4f0e8;
  box-shadow:
    inset 0 0 0 2px #101112,
    inset 0 0 0 6px #1b1c1d,
    inset 0 0 70px rgba(0, 0, 0, 0.85),
    0 0 0 1px rgba(0, 0, 0, 0.6);
}

/* ── 光 ───────────────────────────────────────────────────────────────── */
.proj__vignette {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  /* 玻璃暗角：四角压暗、中心留亮，撑出凸面 CRT 的弧度 */
  background: radial-gradient(118% 96% at 50% 50%, transparent 56%, rgba(0, 0, 0, 0.24) 78%, rgba(0, 0, 0, 0.56) 100%);
}

/* 扫描线 */
.proj__scanlines {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  background: repeating-linear-gradient(to bottom, rgba(0, 0, 0, 0.42) 0 1px, transparent 1px 3px);
  opacity: 0.45;
}

/* 玻璃反光 */
.proj__glare {
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  background:
    radial-gradient(120% 80% at 18% 0%, rgba(255, 255, 255, 0.14), transparent 46%),
    linear-gradient(115deg, rgba(255, 255, 255, 0.07) 0%, transparent 30%);
  opacity: 0.55;
}

/* 老电视那条慢慢往下滚的亮带 */
.proj__rollbar {
  position: absolute;
  z-index: 3;
  top: -22%;
  right: -10%;
  left: -10%;
  height: 22%;
  pointer-events: none;
  background: linear-gradient(to bottom, transparent, rgba(244, 240, 232, 0.05), transparent);
  animation: crt-roll 9s linear infinite;
}

@keyframes crt-roll {
  0% { transform: translateY(0); }
  100% { transform: translateY(560%); }
}

/* 镜头里的太阳：位置由 useGlow 每帧写进 --gx / --gy，亮度写进 --g-o。
   指针甩得越快越亮，停下就落回一层很轻的底光 —— 就是"镜头扫到阳光"的那下闪烁。 */
.proj__sun {
  position: absolute;
  left: 0;
  top: 0;
  width: 74vmax;
  height: 74vmax;
  margin: -37vmax 0 0 -37vmax;
  z-index: 6;
  pointer-events: none;
  background: radial-gradient(circle,
    rgba(255, 255, 255, 0.92) 0%,
    rgba(255, 255, 255, 0.38) 6%,
    rgba(255, 255, 255, 0.1) 18%,
    rgba(255, 255, 255, 0.03) 34%,
    transparent 55%);
  filter: blur(6px);
  mix-blend-mode: screen;
  opacity: var(--g-o, 0);
  transform: translate3d(var(--gx, 50vw), var(--gy, 50vh), 0);
  will-change: transform, opacity;
}

/* 横向拉丝：始终穿过光心 */
.proj__sun::after {
  content: '';
  position: absolute;
  left: -160%;
  right: -160%;
  top: 50%;
  height: 2px;
  margin-top: -1px;
  background: linear-gradient(90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.4) 42%,
    rgba(255, 255, 255, 0.8) 50%,
    rgba(255, 255, 255, 0.4) 58%,
    transparent 100%);
  filter: blur(2px);
}

.proj__grain {
  position: absolute;
  inset: 0;
  z-index: 5;
  width: 100%;
  height: 100%;
  pointer-events: none;
  background-size: 180px 180px;
  background-repeat: repeat;
  mix-blend-mode: screen;
  /* 高噪点：这是整页唯一的"材质"，别调低 */
  opacity: 0.2;
  image-rendering: pixelated;
  transition: opacity 1s ease;
}

/* ── 标题卡 ───────────────────────────────────────────────────────────── */
.proj__poster {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  padding: 0 4cqw;
  text-align: center;
  animation: poster-in 1.6s ease both;
}

/* 片名必须落在屏幕正中；PLAY 悬在它下面，不参与居中 */
.proj__center {
  position: relative;
  display: grid;
  place-items: center;
}

@keyframes poster-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.proj__title {
  position: relative;
  isolation: isolate;
  margin: 0;
  font-family: 'Oswald', sans-serif;
  font-weight: 700;
  /* 字号跟着屏幕宽度走（cqw），电视多大，字就多大。
     7cqw 是量出来的上限：再大一行字就会超出屏幕内容盒，标题不再居中。 */
  font-size: clamp(1.35rem, 7cqw, 4.4rem);
  line-height: 1;
  letter-spacing: 0.12em;
  text-indent: 0.12em;
  text-transform: uppercase;
  color: #f4efe6;
  white-space: nowrap;
  text-shadow:
    0 0 18px rgba(255, 255, 255, 0.12),
    0 0 60px rgba(255, 255, 255, 0.06);
  animation: weave 1.35s steps(1, end) infinite;
}

.proj__word {
  display: inline-block;
  white-space: nowrap;
}

.proj__word + .proj__word { margin-left: 0.32em; }

/* 每个字母自己淡入：先是一团糊开的光，再落成笔画 */
.proj__char {
  display: inline-block;
  opacity: 0;
  animation: char-in 1.1s ease forwards;
  animation-delay: calc(0.45s + var(--i) * 0.105s);
}

@keyframes char-in {
  0% { opacity: 0; filter: blur(12px); }
  60% { opacity: 1; filter: blur(2.5px); }
  100% { opacity: 1; filter: blur(0); }
}

/* 进场时从左到右扫过片名的那道光，扫完就消失 */
.proj__sweep {
  position: absolute;
  top: -14%;
  bottom: -14%;
  left: 0;
  width: 22%;
  z-index: 2;
  pointer-events: none;
  background: linear-gradient(90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.5) 45%,
    rgba(255, 255, 255, 0.85) 50%,
    rgba(255, 255, 255, 0.5) 55%,
    transparent 100%);
  filter: blur(9px);
  mix-blend-mode: screen;
  opacity: 0;
  animation: sweep 1.9s 0.35s cubic-bezier(0.4, 0, 0.25, 1) both;
}

@keyframes sweep {
  0% { transform: translateX(-40%); opacity: 0; }
  12% { opacity: 0.9; }
  82% { opacity: 0.7; }
  100% { transform: translateX(480%); opacity: 0; }
}

@keyframes weave {
  0%, 100% { transform: translate3d(0, 0, 0); }
  17% { transform: translate3d(-0.55px, 0.4px, 0); }
  34% { transform: translate3d(0.35px, -0.5px, 0); }
  51% { transform: translate3d(-0.3px, -0.25px, 0); }
  68% { transform: translate3d(0.55px, 0.25px, 0); }
  85% { transform: translate3d(-0.4px, 0.5px, 0); }
}

@keyframes rise {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── 正片 ─────────────────────────────────────────────────────────────── */
.proj__video {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
  cursor: none;
}

.proj.is-playing .proj__grain { opacity: 0.08; }
/* 正片播放时不再叠阳光闪，画面就是片子本身 */
.proj.is-playing .proj__sun { opacity: 0 !important; animation: none; }

.proj__buffer {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 9;
  transform: translate(-50%, -50%);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.56rem;
  letter-spacing: 0.4em;
  text-indent: 0.4em;
  color: rgba(233, 228, 218, 0.5);
  animation: blink 1.6s ease-in-out infinite;
}

@keyframes blink {
  0%, 100% { opacity: 0.25; }
  50% { opacity: 0.8; }
}

/* ── 机身下沿：3D 实体按键 + 音量旋钮 ─────────────────────────────────── */
.proj__deck {
  display: flex;
  align-items: center;
  gap: clamp(7px, 1vw, 12px);
  padding: clamp(10px, 1.4vh, 15px) clamp(8px, 1.1vw, 14px) 2px;
}

/* 按键：纯色底 + 反色 hover，没有渐变、高光、投影 */
.tv-key {
  position: relative;
  flex: none;
  width: clamp(34px, 3.4vw, 46px);
  height: clamp(28px, 2.6vw, 36px);
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 0;
  color: rgba(233, 228, 218, 0.7);
  background: #121314;
  cursor: pointer;
  transition: background-color 0.18s ease, color 0.18s ease;
}

.tv-key svg {
  width: 46%;
  height: 46%;
  fill: currentColor;
}

.tv-key:hover:not(:disabled) {
  background: #f4f0e8;
  color: #050607;
}

.tv-key:active:not(:disabled) {
  background: #cfcabf;
  color: #050607;
}

.tv-key:disabled {
  opacity: 0.3;
  cursor: default;
}

.tv-key--main {
  width: clamp(44px, 4.4vw, 58px);
}

/* ── 复古进度条 ───────────────────────────────────────────────────────── */
/* 分段的白条：底轨是一格一格的暗段，走过的部分是点亮的白段 */
.proj__track {
  flex: 1;
  min-width: 50px;
  height: 22px;
  margin: 0 clamp(4px, 0.9vw, 10px);
  appearance: none;
  -webkit-appearance: none;
  background: none;
  cursor: pointer;
}

.proj__track::-webkit-slider-runnable-track {
  height: 8px;
  background:
    repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.62) 0 2px, transparent 2px 7px),
    linear-gradient(90deg,
      rgba(244, 240, 232, 0.92) var(--p, 0%),
      rgba(244, 240, 232, 0.14) var(--p, 0%));
  box-shadow: inset 0 0 0 1px rgba(244, 240, 232, 0.2);
}

.proj__track::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 5px;
  height: 16px;
  margin-top: -4px;
  border: 0;
  border-radius: 0;
  background: #f4f0e8;
}

.proj__track::-moz-range-track {
  height: 8px;
  background:
    repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.62) 0 2px, transparent 2px 7px),
    rgba(244, 240, 232, 0.14);
  box-shadow: inset 0 0 0 1px rgba(244, 240, 232, 0.2);
}

.proj__track::-moz-range-progress {
  height: 8px;
  background:
    repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.62) 0 2px, transparent 2px 7px),
    rgba(244, 240, 232, 0.92);
}

.proj__track::-moz-range-thumb {
  width: 5px;
  height: 16px;
  border: 0;
  border-radius: 0;
  background: #f4f0e8;
}

/* 音量读数：MUTE / VOL 80。
   宽度写死成最长那串（VOL 100）的宽度 —— MUTE 和 VOL 100 来回切时，
   读数和旁边的进度条都不能被挤动。 */
.proj__vol {
  flex: none;
  width: 9ch;
  overflow: hidden;
  white-space: nowrap;
  font-family: 'JetBrains Mono', monospace;
  font-size: clamp(7px, 0.58vw, 9px);
  letter-spacing: 0.12em;
  color: rgba(233, 228, 218, 0.5);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* 音量：收音机调频尺。凹进去的金属刻度槽 + 一排长短刻度 + 一根有厚度、会发光的针 */
.proj__tuner {
  position: relative;
  flex: none;
  width: clamp(96px, 11vw, 150px);
  height: clamp(28px, 2.6vw, 34px);
  margin-left: clamp(4px, 0.8vw, 10px);
  overflow: hidden;
  border-radius: 2px;
  cursor: ew-resize;
  touch-action: none;
  background:
    linear-gradient(180deg, #101214 0%, #050607 42%, #0c0d0f 100%);
  box-shadow:
    inset 0 2px 5px rgba(0, 0, 0, 0.95),
    inset 0 -1px 0 rgba(255, 255, 255, 0.07),
    0 1px 0 rgba(255, 255, 255, 0.1),
    0 2px 3px rgba(0, 0, 0, 0.65);
}

/* 玻璃面：斜着扫过的一道高光 + 四边的暗框 */
.proj__tuner::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 2px;
  pointer-events: none;
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.09) 0%, rgba(255, 255, 255, 0.02) 38%, transparent 55%);
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.85),
    inset 0 0 10px rgba(0, 0, 0, 0.55);
}

/* 刻度：每 2.5% 一条短线，每 10% 一条长线（用两层不同透明度的竖线叠出来） */
.proj__tuner-scale {
  position: absolute;
  inset: 5px 5px 5px 5px;
  background:
    repeating-linear-gradient(90deg, rgba(233, 228, 218, 0.55) 0 1px, transparent 1px 10%),
    repeating-linear-gradient(90deg, rgba(233, 228, 218, 0.22) 0 1px, transparent 1px 2.5%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, #000 22%, #000 100%);
  mask-image: linear-gradient(to bottom, transparent 0%, #000 22%, #000 100%);
}

/* 指针：一根有厚度、带投影的白条，顶端一个小三角帽 */
.proj__tuner-needle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 3px;
  margin-left: -1.5px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.55), #ffffff 45%, rgba(200, 200, 200, 0.85));
  box-shadow:
    0 0 9px rgba(255, 255, 255, 0.55),
    -1px 0 2px rgba(0, 0, 0, 0.9),
    1px 0 2px rgba(0, 0, 0, 0.9);
  transition: left 0.06s linear;
}

.proj__tuner-needle::after {
  content: '';
  position: absolute;
  left: 50%;
  top: -5px;
  translate: -50% 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 6px solid #ffffff;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.9));
}

.proj__tuner-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}

/* ── 让站点外壳让开 ───────────────────────────────────────────────────── */
/* 左下角的 Ava 塔和音乐播放器在这一页从头到尾都不出现：标题卡上那块歌词和频谱
   会压在海报正下方，进片之后更会直接盖在画面上。片子只有呼吸声，也不该有歌。 */
:global(html.projection-page .author-tower),
:global(html.projection-page .music-player),
:global(html.projection-page .now-playing),
:global(html.projection-page .player-overlay) {
  opacity: 0 !important;
  pointer-events: none !important;
  transition: opacity 0.6s ease;
}

/* 这一页永远是黑底：浅色主题下头部原本是深色字，会消失在黑色里 */
:global(html.projection-page #header),
:global(html.projection-page #header .logo),
:global(html.projection-page #header nav a),
:global(html.projection-page #header .menu-toggle),
:global(html.projection-page #header .back-link) {
  color: #e9e4da;
}

:global(html.projection-page #header nav a.router-link-active) {
  color: #fff;
}

/* ── 手机 ─────────────────────────────────────────────────────────────── */
@media (max-width: 700px) {
  .proj__poster { padding: 0 6cqw; }
  /* 屏幕只有三百多像素宽，标题按 cqw 缩，必要时折成两行 */
  .proj__title {
    max-width: 100%;
    white-space: normal;
    font-size: clamp(1.1rem, 9cqw, 2.6rem);
    letter-spacing: 0.1em;
    text-indent: 0.1em;
  }
  /* 屏幕窄，机身下沿的键也得跟着缩；主键保持 44px 的点击高度 */
  .proj__deck { gap: 4px; padding: 8px 6px 0; }
  .tv-key { width: 30px; height: 34px; }
  .tv-key--main { width: 40px; height: 44px; }
  .proj__tuner { width: 78px; height: 26px; margin-left: 2px; }
  .proj__vol { font-size: 6px; width: 8.4ch; letter-spacing: 0.08em; }
  .proj__buffer { font-size: 0.46rem; letter-spacing: 0.26em; }
  .proj__video { cursor: default; }
  .proj__bezel { font-size: 6px; letter-spacing: 0.12em; }
}

@media (prefers-reduced-motion: reduce) {
  .proj__poster,
  .proj__title,
  .proj__sun {
    animation: none !important;
  }
  /* 减少动态偏好下不闪，也不跟鼠标：字母直接全部在位 */
  .proj__sun { opacity: 0 !important; }
  .proj__char { animation: none !important; opacity: 1; filter: none; }
  .proj__sweep { display: none; }
}
</style>
