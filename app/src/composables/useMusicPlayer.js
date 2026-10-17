// 音乐播放器。逐项对应旧 initMusicPlayer()（index.html L7934-L8184）。
//
// 状态放模块作用域（旧版是 initMusicPlayer 的闭包，生命周期等于整个页面）：
// 这样即使组件因任何原因被重新挂载，播放状态、曲目、静音状态都不会被重置。
//
// 与旧版**有意**的两处不同（站点负责人定的，别当回归改回去）：
//   1. 起始曲目固定为第一首（Almost Nothing）。旧版是 Math.floor(Math.random() * length)
//      随机抽一首 —— 但进站的音乐是"开场的一部分"，每次刷新换一首就不成编排了。
//   2. 起播就出声。旧版初始 audio.muted = true 且 isMuted = true，所谓自动播放其实是
//      "静音在放"，要用户自己点音量键才听得到；现在初始化即不静音。
//
// 另外：首屏那个 ENTER 按钮的点击**就是**这里的"首次交互"（document 上的 click 监听会
// 收到它冒泡上来的事件），所以点 ENTER 即起播是有意为之，不是谁漏了 stopPropagation。
import { ref, computed } from 'vue';
import { playlist } from '../data/playlist.js';

// 播放列表沿用旧版的相对地址（`music/...`）：只有页面停在 `/` 时才对。
// 新版是 History 路由，直达或刷新 `/blogs`、`/me/gallery` 这类深链接时，
// 相对地址会被解析成 `/blogs/music/...` —— GitHub Pages 返回 404 的 HTML，
// audio 报 MEDIA_ELEMENT_ERROR: Format error，点 ENTER 也起不来。
// BASE_URL 是 Vite 的部署基路径（本站为 `/`），拼成绝对地址后与当前路由无关。
const ASSET_BASE = import.meta.env.BASE_URL || '/';

function resolveTrackSrc(src) {
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src) || src.startsWith('/')) return src;
  return ASSET_BASE + src;
}

const currentTrackIndex = ref(0);
const isPlaying = ref(false);
const isMuted = ref(false); // 初始即不静音 —— 跟 init() 里的取值一致（见文件头第 2 条）
const playerVisible = ref(false);
const playlistVisible = ref(false);
const progressPercent = ref(0);
const progressTimeText = ref('0:00');
// 拖拽进度条期间为 true：此时进度条完全由指针位置驱动，
// timeupdate 不能再往回写，否则拖到一半就被当前播放位置"拽回去"。
const isScrubbing = ref(false);

let audioEl = null;
let interactionBound = false;

// ── 频谱分析 ────────────────────────────────────────────────────────────────
// <audio> → MediaElementSource → Analyser → destination。必须在用户交互里创建
// AudioContext（自动播放策略），所以惰性等到第一次 playTrack 再搭图。
// 所有曲目都是同源地址（/music/…），Analyser 不会被 CORS 污染。
let audioCtx = null;
let analyser = null;
let freqData = null;
let audioGraphReady = false;

function ensureAudioGraph() {
  if (!audioEl) return null;
  if (audioGraphReady) {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return analyser;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try {
    audioCtx = new Ctx();
    const source = audioCtx.createMediaElementSource(audioEl);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256; // 128 个频段，够画一条柱状频谱
    analyser.smoothingTimeConstant = 0.82;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    source.connect(analyser);
    // 必须接回 destination：接上 source 之后音频只会进分析器，不连出去就没有声音。
    analyser.connect(audioCtx.destination);
    audioGraphReady = true;
  } catch {
    // 浏览器不支持 / 创建失败时保持原生播放路径，不影响听歌
    audioCtx = null;
    analyser = null;
    freqData = null;
    audioGraphReady = false;
    return null;
  }
  return analyser;
}

// 每次调用都把新的频域数据写进同一个 Uint8Array（0–255）。
function getFrequencyData() {
  if (!analyser || !freqData) return null;
  analyser.getByteFrequencyData(freqData);
  return freqData;
}

// 歌词逐帧对齐要用「此刻播到哪」，不能等 timeupdate（它只有 ~4Hz）。
function getCurrentTime() {
  return audioEl ? audioEl.currentTime : 0;
}

const currentTrack = computed(() => playlist[currentTrackIndex.value]);

function updatePlaylistUI() {
  // 旧版是命令式地逐个设置 .active 与播放指示器；新版由模板绑定完成（见 MusicPlayer.vue）
}

// 对应旧 updateProgress()
function onTimeUpdate() {
  if (!audioEl || !audioEl.duration || isScrubbing.value) return;
  progressPercent.value = (audioEl.currentTime / audioEl.duration) * 100;
  const minutes = Math.floor(audioEl.currentTime / 60);
  const seconds = Math.floor(audioEl.currentTime % 60);
  progressTimeText.value = `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function loadTrack() {
  const track = currentTrack.value;
  if (!track || !audioEl) return;
  audioEl.src = resolveTrackSrc(track.src);
}

// isPlaying 只在 play() **兑现之后**才置上，不能同步置。
// 置早了就会给出一个自相矛盾的状态：音频没在放，按钮却已经是"暂停"（自动播放被策略
// 拒掉时就是这个组合）；反过来漏置则更糟 —— 进度条在走、按钮还显示"播放"，用户要点
// 两下才停得下来（旧版的自动起播正是这样，因为 tryAutoPlay 只调 play()）。
function playTrack() {
  if (!audioEl) return;
  // 第一次播放（通常就是首屏 ENTER 那一下）时在用户手势里搭好分析图
  ensureAudioGraph();
  audioEl.play().then(
    () => { isPlaying.value = true; },
    () => { /* 被自动播放策略或加载失败挡住：保持暂停态，等用户按播放键 */ }
  );
}

function pauseTrack() {
  if (!audioEl) return;
  audioEl.pause();
  isPlaying.value = false;
}

function prevTrack() {
  currentTrackIndex.value = (currentTrackIndex.value - 1 + playlist.length) % playlist.length;
  loadTrack();
  if (isPlaying.value) playTrack();
}

function nextTrack() {
  currentTrackIndex.value = (currentTrackIndex.value + 1) % playlist.length;
  loadTrack();
  if (isPlaying.value) playTrack();
}

function selectTrack(index) {
  currentTrackIndex.value = index;
  loadTrack();
  playTrack();
}

function togglePlay() {
  if (isPlaying.value) pauseTrack();
  else playTrack();
}

function togglePlayer() {
  playerVisible.value = !playerVisible.value;
  // 旧版：播放器显示时自动打开播放列表，隐藏时一并收起
  if (playerVisible.value) {
    playlistVisible.value = true;
  } else {
    playlistVisible.value = false;
  }
}

function togglePlaylist() {
  playlistVisible.value = !playlistVisible.value;
}

function toggleMute() {
  isMuted.value = !isMuted.value;
  if (audioEl) audioEl.muted = isMuted.value;
}

function updateVolume(value) {
  if (!audioEl) return;
  audioEl.volume = value;
  // 旧版行为：拖到 0 视为静音；从静音状态调整音量则解除静音
  if (value === 0) {
    if (!isMuted.value) toggleMute();
  } else if (isMuted.value) {
    toggleMute();
  }
}

function clampPercent(percent) {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(1, Math.max(0, percent));
}

function seek(percent) {
  if (!audioEl || !audioEl.duration) return;
  audioEl.currentTime = clampPercent(percent) * audioEl.duration;
}

// 只把进度条和时间文本画到指针位置，不动音频。拖拽期间用它给出即时反馈。
function previewProgress(percent) {
  const p = clampPercent(percent);
  progressPercent.value = p * 100;
  if (audioEl && audioEl.duration) {
    const t = p * audioEl.duration;
    progressTimeText.value = `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
  }
}

// 拖拽三件套。按下就立即跳（单击等同于按下即释放），移动时音频同步跟随，
// 这样松手前后听到的和看到的是同一个位置；isScrubbing 期间屏蔽 timeupdate，
// 避免进度条被"当前播放位置"往回拽。
function beginScrub(percent) {
  isScrubbing.value = true;
  previewProgress(percent);
  seek(percent);
}

function scrubTo(percent) {
  if (!isScrubbing.value) return;
  previewProgress(percent);
  seek(percent);
}

function endScrub(percent) {
  if (!isScrubbing.value) return;
  previewProgress(percent);
  seek(percent);
  isScrubbing.value = false;
}

// 首次用户交互后开始播放一次（自动播放策略的绕行方案）。
// 走 playTrack 而不是自己 play()，播放状态才会跟着一起置上。
function tryAutoPlay() {
  if (!audioEl) return;
  playTrack();
  document.removeEventListener('click', tryAutoPlay);
  document.removeEventListener('touchstart', tryAutoPlay);
  document.removeEventListener('keydown', tryAutoPlay);
  interactionBound = false;
}

export function useMusicPlayer() {
  function init(el) {
    audioEl = el;
    if (!audioEl) return;
    // 顺序沿用旧的：先选曲并 loadTrack，再设音量，最后设静音。
    // 两处取值换掉了（见文件头）：固定第一首、且不静音。
    currentTrackIndex.value = 0;
    loadTrack();
    audioEl.volume = 0.3;
    audioEl.muted = false;
    isMuted.value = false;
    updatePlaylistUI();

    if (!interactionBound) {
      interactionBound = true;
      document.addEventListener('click', tryAutoPlay);
      document.addEventListener('touchstart', tryAutoPlay);
      document.addEventListener('keydown', tryAutoPlay);
    }
  }

  function dispose() {
    document.removeEventListener('click', tryAutoPlay);
    document.removeEventListener('touchstart', tryAutoPlay);
    document.removeEventListener('keydown', tryAutoPlay);
    interactionBound = false;
    audioEl = null;
  }

  return {
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
    seek,
    isScrubbing,
    beginScrub,
    scrubTo,
    endScrub,
    getFrequencyData,
    getCurrentTime,
  };
}
