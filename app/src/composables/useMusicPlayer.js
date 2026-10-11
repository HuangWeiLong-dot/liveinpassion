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

const currentTrackIndex = ref(0);
const isPlaying = ref(false);
const isMuted = ref(false); // 初始即不静音 —— 跟 init() 里的取值一致（见文件头第 2 条）
const playerVisible = ref(false);
const playlistVisible = ref(false);
const progressPercent = ref(0);
const progressTimeText = ref('0:00');

let audioEl = null;
let interactionBound = false;

const currentTrack = computed(() => playlist[currentTrackIndex.value]);

function updatePlaylistUI() {
  // 旧版是命令式地逐个设置 .active 与播放指示器；新版由模板绑定完成（见 MusicPlayer.vue）
}

// 对应旧 updateProgress()
function onTimeUpdate() {
  if (!audioEl || !audioEl.duration) return;
  progressPercent.value = (audioEl.currentTime / audioEl.duration) * 100;
  const minutes = Math.floor(audioEl.currentTime / 60);
  const seconds = Math.floor(audioEl.currentTime % 60);
  progressTimeText.value = `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function loadTrack() {
  const track = currentTrack.value;
  if (!track || !audioEl) return;
  audioEl.src = track.src;
}

// isPlaying 只在 play() **兑现之后**才置上，不能同步置。
// 置早了就会给出一个自相矛盾的状态：音频没在放，按钮却已经是"暂停"（自动播放被策略
// 拒掉时就是这个组合）；反过来漏置则更糟 —— 进度条在走、按钮还显示"播放"，用户要点
// 两下才停得下来（旧版的自动起播正是这样，因为 tryAutoPlay 只调 play()）。
function playTrack() {
  if (!audioEl) return;
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

function seek(percent) {
  if (!audioEl || !audioEl.duration) return;
  audioEl.currentTime = percent * audioEl.duration;
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
  };
}
