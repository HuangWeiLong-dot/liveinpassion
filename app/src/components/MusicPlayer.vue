<script setup>
// 音乐播放器 + 悬浮开关 + 遮罩 + 底部「正在播放」舞台（频谱 / 歌词）
//（旧 index.html L5476-L5478、L5512、L5515-L5573 的标记，逻辑见 useMusicPlayer.js）。
// 这几块放在同一个组件里，因为它们由同一套显隐状态驱动。
// 这个组件挂在 App.vue 上、没有 v-if，所以路由切换时 audio 元素不会被重建（播放不中断）。
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useMusicPlayer } from '../composables/useMusicPlayer.js';
import { useLyrics } from '../composables/useLyrics.js';
import { useBrandOverlay } from '../composables/useBrandOverlay.js';
import { useTheme } from '../composables/useTheme.js';
import { ICONS } from '../data/assets.js';

const {
  playlist,
  currentTrack,
  currentTrackIndex,
  isPlaying,
  isMuted,
  playerVisible,
  playlistVisible,
  progressPercent,
  progressTimeText,
  onTimeUpdate,
  init,
  dispose,
  selectTrack,
  togglePlay,
  togglePlayer,
  togglePlaylist,
  toggleMute,
  updateVolume,
  prevTrack,
  nextTrack,
  isScrubbing,
  beginScrub,
  scrubTo,
  endScrub,
  getFrequencyData,
  getCurrentTime,
} = useMusicPlayer();

const { isDark } = useTheme();
// 首屏编排：主人格/主体落定、其余 UI 开始浮出的那个信号（useBrandOverlay 的
// 第 5 步）。底部舞台排在它之后才进场。
const { uiReady: brandUiReady } = useBrandOverlay();

// 底部「正在播放」舞台（频谱 + 歌词）显不显示。选择记在 localStorage，
// 刷新后保持；默认显示。
const VISUALS_KEY = 'musicVisuals';
const visualsVisible = ref(true);
try {
  if (localStorage.getItem(VISUALS_KEY) === '0') visualsVisible.value = false;
} catch { /* 隐私模式下读不了就按默认显示 */ }

function toggleVisuals() {
  visualsVisible.value = !visualsVisible.value;
  try {
    localStorage.setItem(VISUALS_KEY, visualsVisible.value ? '1' : '0');
  } catch { /* 写不了就只在本次会话生效 */ }
}

const {
  lines: lyricsLines,
  activeIndex: lyricsActiveIndex,
  progress: lyricProgress,
  dispose: disposeLyrics,
} = useLyrics({ currentTrack, playerVisible, isPlaying, visualsVisible, getCurrentTime });

const audioRef = ref(null);
const progressTrackRef = ref(null);
const spectrumRef = ref(null);

onMounted(() => {
  init(audioRef.value);
  syncSpectrumColors();
  drawIdleSpectrum();
});
onUnmounted(() => {
  stopSpectrum();
  resizeObserver?.disconnect();
  resizeObserver = null;
  lyricsResizeObserver?.disconnect();
  lyricsResizeObserver = null;
  disposeLyrics();
  dispose();
});

// ── 频谱可视化 ──────────────────────────────────────────────────────────────
// 柱状图，画在底部「正在播放」舞台的最下面。数据来自 useMusicPlayer 里的
// AnalyserNode；暂停时停掉 rAF，只留一条静止基线，不白烧 CPU。
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

let spectrumCtx = null;
let spectrumRaf = 0;
let spectrumColor = '#fff';
let spectrumBaseline = '#333';
let resizeObserver = null;

function syncSpectrumColors() {
  const cs = getComputedStyle(document.documentElement);
  spectrumColor = cs.getPropertyValue('--text-primary').trim() || (isDark.value ? '#FAFAFA' : '#1A1A1A');
  spectrumBaseline = cs.getPropertyValue('--border').trim() || (isDark.value ? '#333333' : '#E5E7EB');
}

function spectrumMetrics() {
  const canvas = spectrumRef.value;
  if (!canvas) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // 用 clientWidth/Height 而不是 getBoundingClientRect：后者会把祖先的
  // transform 缩放算进去，画布会被建小一圈。
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  // 不要缓存 context：底部这块是 v-if 的，关掉播放器再打开会换一个新 canvas，
  // 缓存下来的旧 context 画到已经脱离文档的元素上，屏幕上会一片空白。
  spectrumCtx = canvas.getContext('2d');
  if (!spectrumCtx) return null;
  return { dpr, width, height, padX: 16 * dpr, padY: 10 * dpr };
}

function drawIdleSpectrum() {
  const m = spectrumMetrics();
  if (!m) return;
  spectrumCtx.clearRect(0, 0, m.width, m.height);
  // 静止时留一条淡基线，避免这块看起来是空的
  const line = Math.max(1, Math.round(m.dpr));
  spectrumCtx.fillStyle = spectrumBaseline;
  spectrumCtx.fillRect(m.padX, m.height - m.padY - line, m.width - m.padX * 2, line);
}

function drawSpectrum() {
  spectrumRaf = 0;
  const m = spectrumMetrics();
  if (!m) return;
  spectrumCtx.clearRect(0, 0, m.width, m.height);

  const innerW = Math.max(1, m.width - m.padX * 2);
  const innerH = Math.max(1, m.height - m.padY * 2);
  const baselineY = m.height - m.padY;
  const barW = Math.max(2, Math.round(3 * m.dpr));
  const gap = Math.max(2, Math.round(2 * m.dpr));
  const count = Math.max(8, Math.floor((innerW + gap) / (barW + gap)));

  const line = Math.max(1, Math.round(m.dpr));
  spectrumCtx.fillStyle = spectrumBaseline;
  spectrumCtx.fillRect(m.padX, baselineY - line, innerW, line);

  const data = getFrequencyData();
  if (data) {
    // 音乐能量基本都在低频，后半段频段几乎一直是 0。只用前 72% 的 bin
    // 铺满整条，图形才不会挤在左边。
    const binCount = Math.max(1, Math.floor(data.length * 0.72));
    spectrumCtx.fillStyle = spectrumColor;
    for (let i = 0; i < count; i++) {
      // 对数分箱：低频不挤、高频不空
      const from = Math.floor(Math.pow(binCount, i / count));
      const to = Math.max(from + 1, Math.floor(Math.pow(binCount, (i + 1) / count)));
      let sum = 0;
      let n = 0;
      for (let b = from; b < to && b < binCount; b++) { sum += data[b]; n++; }
      const value = n ? sum / n / 255 : 0;
      const barH = Math.max(line, Math.pow(value, 1.4) * innerH);
      spectrumCtx.fillRect(m.padX + i * (barW + gap), baselineY - barH, barW, barH);
    }
  }

  // 暂停、整块收起或用户开启"减少动态效果"时不再排下一帧
  if (isPlaying.value && !reduceMotion?.matches) {
    spectrumRaf = requestAnimationFrame(drawSpectrum);
  }
}

function startSpectrum() {
  if (spectrumRaf) return;
  if (!isPlaying.value || reduceMotion?.matches) {
    drawIdleSpectrum();
    return;
  }
  spectrumRaf = requestAnimationFrame(drawSpectrum);
}

function stopSpectrum() {
  if (spectrumRaf) {
    cancelAnimationFrame(spectrumRaf);
    spectrumRaf = 0;
  }
  drawIdleSpectrum();
}

// 底部这块出现（在放歌 / 播放器展开，且没被开关关掉）就画。
watch([isPlaying, playerVisible, visualsVisible], ([playing, visible, shown]) => {
  if (shown && (playing || visible)) startSpectrum();
  else stopSpectrum();
});
watch(isDark, () => {
  syncSpectrumColors();
  if (!spectrumRaf) drawIdleSpectrum();
});

// 频谱画布跟着底部那块 v-if 出现/消失，挂载时还不存在：等 ref 真正拿到元素再观察。
watch(spectrumRef, (el) => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (!el || typeof ResizeObserver === 'undefined') return;
  resizeObserver = new ResizeObserver(() => {
    if (!spectrumRaf) drawIdleSpectrum();
  });
  resizeObserver.observe(el);
  // 画布刚被 v-if 插回文档：先画一帧，别空着等下一次状态变化
  startSpectrum();
});

// ── 歌词滚动 ────────────────────────────────────────────────────────────────
// 行高不固定（长句会换行），所以不按「行号 × 行高」算位移，而是拿当前行的
// offsetTop 把它挪到视口正中。activeIndex 变化或歌词换了一批时重新量一次。
const lyricsViewportRef = ref(null);
const lyricsTrackRef = ref(null);
const lyricLineEls = ref([]);
let lyricsResizeObserver = null;

function setLyricLineEl(el, index) {
  if (el) lyricLineEls.value[index] = el;
}

function centerActiveLyric() {
  const viewport = lyricsViewportRef.value;
  const track = lyricsTrackRef.value;
  const el = lyricLineEls.value[Math.max(0, lyricsActiveIndex.value)];
  if (!viewport || !track || !el) return;
  const offset = el.offsetTop - (viewport.clientHeight - el.offsetHeight) / 2;
  track.style.transform = `translateY(${-Math.max(0, offset)}px)`;
}

watch(lyricsLines, async () => {
  // 行元素会整批重建，先清掉旧引用再等 DOM 更新
  lyricLineEls.value = [];
  await nextTick();
  lyricsResizeObserver?.disconnect();
  lyricsResizeObserver = null;
  if (lyricsViewportRef.value && typeof ResizeObserver !== 'undefined') {
    lyricsResizeObserver = new ResizeObserver(centerActiveLyric);
    lyricsResizeObserver.observe(lyricsViewportRef.value);
  }
  centerActiveLyric();
});

watch(lyricsActiveIndex, async () => {
  await nextTick();
  centerActiveLyric();
});

// 进度条用 Pointer Events 做拖拽，不用 click：click 只在按下和松手落在同一个
// 元素上时才触发，往轨道外面一拖、松手时就没有 seek，进度条随即被 timeupdate
// 拉回原处 —— 也就是"拖动后重置"。pointer capture 能让轨道收全整段手势。
function percentAt(clientX) {
  const rect = progressTrackRef.value.getBoundingClientRect();
  if (!rect.width) return 0;
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

function onScrubStart(e) {
  // 鼠标只接左键；触控 / 手写笔的 button 是 0。多指时忽略后按下的那根。
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (isScrubbing.value) return;
  e.preventDefault();
  progressTrackRef.value.setPointerCapture?.(e.pointerId);
  beginScrub(percentAt(e.clientX));
}

function onScrubMove(e) {
  if (!isScrubbing.value) return;
  scrubTo(percentAt(e.clientX));
}

function onScrubEnd(e) {
  if (!isScrubbing.value) return;
  endScrub(percentAt(e.clientX));
  if (progressTrackRef.value.hasPointerCapture?.(e.pointerId)) {
    progressTrackRef.value.releasePointerCapture(e.pointerId);
  }
}
</script>

<template>
  <button class="music-toggle-btn" id="musicToggleBtn" :class="{ active: playerVisible }" aria-label="Toggle music player" tabindex="-1" @click="togglePlayer">
    <img :src="ICONS.notes" alt="Music">
  </button>

  <div class="player-overlay" id="playerOverlay" :class="{ visible: playerVisible }" @click="togglePlayer"></div>

  <div class="music-player" id="musicPlayer" :class="{ visible: playerVisible }">
    <!-- crossorigin 必须开：音频在 CDN（img.liveinpassion.me），频谱要把 <audio>
         接进 Web Audio 分析；不声明 CORS 的话，跨域媒体在 MediaElementSource 之后
         输出会被静音，分析器也只会拿到 0。R2 桶的 CORS 已放行本站与本地开发地址。 -->
    <audio id="audioPlayer" ref="audioRef" preload="auto" crossorigin="anonymous" @timeupdate="onTimeUpdate" @ended="nextTrack"></audio>

    <!-- 播放器控制栏 -->
    <div class="player-bar">
      <div class="player-left">
        <button class="player-btn" id="playerPrev" aria-label="Previous" @click="prevTrack">
          <img :src="ICONS.rewind" alt="Previous">
        </button>
        <button class="player-play-btn" id="playerPlay" aria-label="Play" @click="togglePlay">
          <img class="play-icon" :src="ICONS.play" alt="Play" :style="{ display: isPlaying ? 'none' : 'block' }">
          <img class="pause-icon" :src="ICONS.pause" alt="Pause" :style="{ display: isPlaying ? 'block' : 'none' }">
        </button>
        <button class="player-btn" id="playerNext" aria-label="Next" @click="nextTrack">
          <img :src="ICONS.forward" alt="Next">
        </button>
      </div>

      <div class="player-info">
        <div class="player-title" id="playerTitle">{{ currentTrack ? currentTrack.title : '' }}</div>
        <div class="player-artist" id="playerArtist">{{ currentTrack ? currentTrack.artist : '' }}</div>
      </div>

      <div class="player-progress">
        <div
          class="progress-track"
          id="progressTrack"
          ref="progressTrackRef"
          :class="{ 'is-scrubbing': isScrubbing }"
          @pointerdown="onScrubStart"
          @pointermove="onScrubMove"
          @pointerup="onScrubEnd"
          @pointercancel="onScrubEnd"
        >
          <div class="progress-fill" id="progressFill" :style="{ width: progressPercent + '%' }"></div>
        </div>
        <span class="progress-time" id="progressTime">{{ progressTimeText }}</span>
      </div>

      <div class="player-right">
        <button class="player-btn" id="playerVolume" aria-label="Toggle mute" @click="toggleMute">
          <svg class="volume-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" :style="{ display: isMuted ? 'none' : 'block' }">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          </svg>
          <svg class="volume-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" :style="{ display: isMuted ? 'block' : 'none' }">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <line x1="23" y1="9" x2="17" y2="15"></line>
            <line x1="17" y1="9" x2="23" y2="15"></line>
          </svg>
        </button>
        <input type="range" class="volume-slider" id="volumeSlider" min="0" max="1" step="0.01" :value="0.3" @input="updateVolume(parseFloat($event.target.value))">
        <button class="player-btn playlist-toggle" id="playlistToggle" :class="{ active: playlistVisible }" aria-label="Toggle playlist" @click="togglePlaylist">
          <img :src="ICONS.playlist" alt="Playlist">
        </button>
        <button
          class="player-btn visuals-toggle"
          id="visualsToggle"
          :class="{ 'is-off': !visualsVisible }"
          :aria-label="visualsVisible ? 'Hide spectrum and lyrics' : 'Show spectrum and lyrics'"
          :aria-pressed="visualsVisible"
          @click="toggleVisuals"
        >
          <img :src="ICONS.eye" alt="Visuals">
        </button>
      </div>
    </div>

    <!-- 播放列表 -->
    <div class="player-playlist" id="playerPlaylist" :class="{ visible: playlistVisible }">
      <div class="playlist-header">
        <span class="playlist-title">Playlist</span>
        <span class="playlist-count" id="playlistCount">{{ playlist.length }} songs</span>
      </div>
      <div class="playlist-items" id="playlistItems">
        <div
          v-for="(track, index) in playlist"
          :key="track.src"
          class="playlist-item"
          :class="{ active: index === currentTrackIndex }"
          :data-index="index"
          @click="selectTrack(index)"
        >
          <span class="playlist-item-number">{{ index + 1 }}</span>
          <div class="playlist-item-info">
            <div class="playlist-item-title">{{ track.title }}</div>
            <div class="playlist-item-artist">{{ track.artist }}</div>
          </div>
          <div class="playlist-item-playing" :style="{ display: isPlaying && index === currentTrackIndex ? 'flex' : 'none' }">
            <span class="wave"></span>
            <span class="wave"></span>
            <span class="wave"></span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 正在播放：屏幕底部中间，歌词逐行滚动 + 频谱，不垫底板。
       当前行居中放大、上下行被 mask 淡出；当前行从左到右做卡拉 OK 填充。
       拉不到同步歌词时只显示频谱。 -->
  <Transition name="stage-fade">
    <div v-if="visualsVisible && brandUiReady && (isPlaying || playerVisible)" class="now-playing">
      <div v-if="lyricsLines.length" ref="lyricsViewportRef" class="now-playing__lyrics" aria-live="off">
        <div ref="lyricsTrackRef" class="lyrics-track">
          <p
            v-for="(line, i) in lyricsLines"
            :key="i"
            :ref="(el) => setLyricLineEl(el, i)"
            class="lyrics-line"
            :class="{ 'is-active': i === lyricsActiveIndex, 'is-past': i < lyricsActiveIndex }"
            :style="i === lyricsActiveIndex ? { '--p': (lyricProgress * 100).toFixed(2) + '%' } : null"
          >{{ line.text }}</p>
        </div>
      </div>
      <canvas ref="spectrumRef" class="now-playing__spectrum" aria-hidden="true"></canvas>
    </div>
  </Transition>
</template>
