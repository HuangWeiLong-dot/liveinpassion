<script setup>
// 音乐播放器 + 悬浮开关 + 遮罩（旧 index.html L5476-L5478、L5512、L5515-L5573 的标记，
// 逻辑见 useMusicPlayer.js）。三块放在同一个组件里，因为它们由同一套显隐状态驱动。
// 这个组件挂在 App.vue 上、没有 v-if，所以路由切换时 audio 元素不会被重建（播放不中断）。
import { onMounted, onUnmounted, ref } from 'vue';
import { useMusicPlayer } from '../composables/useMusicPlayer.js';
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
  seek,
} = useMusicPlayer();

const audioRef = ref(null);
const progressTrackRef = ref(null);

onMounted(() => init(audioRef.value));
onUnmounted(dispose);

function onProgressClick(e) {
  const rect = progressTrackRef.value.getBoundingClientRect();
  seek((e.clientX - rect.left) / rect.width);
}
</script>

<template>
  <button class="music-toggle-btn" id="musicToggleBtn" :class="{ active: playerVisible }" aria-label="Toggle music player" tabindex="-1" @click="togglePlayer">
    <img :src="ICONS.notes" alt="Music">
  </button>

  <div class="player-overlay" id="playerOverlay" :class="{ visible: playerVisible }" @click="togglePlayer"></div>

  <div class="music-player" id="musicPlayer" :class="{ visible: playerVisible }">
    <audio id="audioPlayer" ref="audioRef" preload="auto" @timeupdate="onTimeUpdate" @ended="nextTrack"></audio>

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
        <div class="progress-track" id="progressTrack" ref="progressTrackRef" @click="onProgressClick">
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
</template>
