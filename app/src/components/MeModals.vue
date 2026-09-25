<script setup>
// ME 页的三个弹窗（旧 index.html L5291-L5320 的电影/专辑、L5352-L5360 的 Kook）。
// 打开方式：FAVOURITE MOVIE / FAVOURITE ALBUM 磁贴、社交栏里的 Kook 图标。
// 关闭方式：点击遮罩（与旧版一致，电影/专辑弹窗没有关闭按钮），Kook 另有 × 按钮。
//
// 用 v-show 不用 v-if：Kook 弹窗里是第三方 iframe，v-if 会在每次开关时重建并重新请求。
import { watch } from 'vue';
import { LOCAL_ASSETS } from '../data/assets.js';

const props = defineProps({
  movie: { type: Boolean, default: false },
  album: { type: Boolean, default: false },
  kook: { type: Boolean, default: false },
});
const emit = defineEmits(['close-movie', 'close-album', 'close-kook']);

// 旧版在每个弹窗开关时直接改 body 的 overflow；这里统一处理，关掉最后一个时恢复
watch(
  () => [props.movie, props.album, props.kook].some(Boolean),
  (anyOpen) => {
    document.body.style.overflow = anyOpen ? 'hidden' : '';
  }
);
</script>

<template>
  <!-- 电影详情弹窗 -->
  <div class="modal-overlay" id="movieModal" :class="{ active: movie }" @click.self="emit('close-movie')">
    <div class="movie-modal-content">
      <div class="movie-poster-container">
        <img :src="LOCAL_ASSETS.moviePoster" alt="Dead Poets Society" class="movie-poster">
      </div>
      <div class="movie-info">
        <h3 class="movie-title">DEAD POETS SOCIETY</h3>
        <p class="movie-year">1989</p>
        <p class="movie-director">Director: Peter Weir</p>
        <p class="movie-genre">Drama</p>
        <p class="movie-description">A group of boys at Welton Academy discover the transformative power of poetry through their enigmatic English teacher.</p>
      </div>
    </div>
  </div>

  <!-- 专辑详情弹窗 -->
  <div class="modal-overlay" id="albumModal" :class="{ active: album }" @click.self="emit('close-album')">
    <div class="movie-modal-content">
      <div class="movie-poster-container">
        <img :src="LOCAL_ASSETS.albumArt" alt="OK Computer" class="movie-poster">
      </div>
      <div class="movie-info">
        <h3 class="movie-title">OK COMPUTER</h3>
        <p class="movie-year">1997</p>
        <p class="movie-director">Artist: Radiohead</p>
        <p class="movie-genre">Alternative Rock / Art Rock</p>
        <p class="movie-description">OK Computer is the third studio album by the English rock band Radiohead, released on 16 June 1997 by Parlophone. It was recorded in Oxfordshire and Bath between 1996 and early 1997, and produced by the band with Nigel Godrich.</p>
      </div>
    </div>
  </div>

  <!-- KOOK 弹窗 -->
  <div class="modal-overlay" id="kookModal" :class="{ active: kook }" @click.self="emit('close-kook')">
    <div class="modal-content kook-modal-content">
      <span class="modal-close" id="kookModalClose" @click="emit('close-kook')">&times;</span>
      <h3 class="kook-modal-title">Kook Community</h3>
      <div class="kook-widget-wrapper">
        <iframe src="https://kookapp.cn/widget?id=3503044378289750&theme=light" width="350" height="500" allowtransparency="true" frameborder="0"></iframe>
      </div>
    </div>
  </div>
</template>
