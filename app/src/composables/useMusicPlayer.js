// 音乐播放器。逐项对应旧 initMusicPlayer()（index.html L7934-L8184）。
//
// 状态放模块作用域（旧版是 initMusicPlayer 的闭包，生命周期等于整个页面）：
// 这样即使组件因任何原因被重新挂载，播放状态、曲目、静音状态都不会被重置。
//
// 注意一个旧版行为，这里**原样保留**：初始化时 audio.muted = true 且 isMuted = true，
// 首次交互触发的 tryAutoPlay() 只调用 play() 而不会解除静音——也就是说自动播放开始后
// 是"静音在播放"，要用户自己点音量键才会出声。这是旧版既有行为，迁移不做改变。
import { ref, computed } from 'vue';
import { playlist } from '../data/playlist.js';

const currentTrackIndex = ref(0);
const isPlaying = ref(false);
const isMuted = ref(true);
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

function playTrack() {
  if (!audioEl) return;
  audioEl.play().catch(() => {
    // 旧版对 play() 的拒绝同样不做处理
  });
  isPlaying.value = true;
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

// 首次用户交互后开始播放一次（自动播放策略的绕行方案）
function tryAutoPlay() {
  if (!audioEl) return;
  audioEl.play().catch(() => {});
  document.removeEventListener('click', tryAutoPlay);
  document.removeEventListener('touchstart', tryAutoPlay);
  document.removeEventListener('keydown', tryAutoPlay);
  interactionBound = false;
}

export function useMusicPlayer() {
  function init(el) {
    audioEl = el;
    if (!audioEl) return;
    // 旧的初始化顺序：先随机选曲并 loadTrack，再设音量，最后设静音
    currentTrackIndex.value = Math.floor(Math.random() * playlist.length);
    loadTrack();
    audioEl.volume = 0.3;
    audioEl.muted = true;
    isMuted.value = true;
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
