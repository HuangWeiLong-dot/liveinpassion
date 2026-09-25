<script setup>
// ME 页（旧 index.html L5155-L5364）。对应关系：
//   页面标题/副标题 ← 随机美德（useVirtue，与导航栏那个词必须是同一个）
//   LAST UPDATED   ← 最新一篇博客的卡片日期（旧版是去读 DOM 里第一张卡片，现在直接取数据）
//   引用            ← 每次进入本页换一条（旧版 refreshMeQuote 在守卫之前）
//   头像/封面/背景   ← startMeTiles（5s / 20s+7s / 20s+14s）
//   GAME 弹窗       ← SteamGameModal（每次打开都重新请求）
//   电影/专辑/Kook  ← MeModals
import { onActivated, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useVirtue } from '../composables/useVirtue.js';
import { startMeTiles } from '../composables/useMeTiles.js';
import { meQuotes } from '../data/quotes.js';
import { blogPosts } from '../data/blogPosts.js';
import { LOCAL_ASSETS } from '../data/assets.js';
import SteamGameModal from '../components/SteamGameModal.vue';
import MeModals from '../components/MeModals.vue';
import AppFooter from '../components/AppFooter.vue';

const router = useRouter();
const { virtue } = useVirtue();

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
});

const avatarRef = ref(null);
const coverRef = ref(null);
const moreRef = ref(null);
onMounted(() => startMeTiles({ avatar: avatarRef.value, cover: coverRef.value, more: moreRef.value }));

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
    <section class="me-section">
      <h1 class="page-title" id="mePageTitle">{{ virtue }}</h1>
      <p class="page-description" id="mePageDescription">BE {{ virtue }}</p>

      <div class="me-container">
        <div class="me-left">
          <!-- 个人信息卡片 -->
          <div class="me-profile-card">
            <div class="me-avatar-wrapper">
              <!-- 头像由 useMeTiles 周期性换图，只挂静态 class -->
              <img ref="avatarRef" :src="LOCAL_ASSETS.meAvatar" alt="Profile Photo" class="me-avatar" id="meAvatar">
            </div>
            <div class="me-info-box">
              <p class="me-last-update">LAST UPDATED · <span id="meLastUpdate">{{ lastUpdate }}</span></p>
              <div class="me-info-top">
                <h2 class="me-name">HUANG WEI LONG</h2>
                <p class="me-title">DREAMER &amp; IDEALIST</p>
              </div>
              <div class="me-description-box">
                <p class="me-description">Chasing dreams</p>
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
                    <path d="M12 2C6.486 2 2 6.486 2 12c0 1.8.478 3.487 1.31 4.953L2 22l5.047-1.31A9.96 9.96 0 0012 22c5.514 0 10-4.486 10-10S17.514 2 12 2zm0 18a8 8 0 01-4.072-1.116l-.292-.175-3.008.783.783-3.008-.175-.292A8 8 0 1112 20zm4.4-5.4c-.243-.121-1.434-.708-1.654-.787-.221-.08-.382-.121-.543.121-.161.243-.625.787-.767.95-.141.161-.282.181-.524.060-.243-.121-1.024-.377-1.95-1.204-.721-.643-1.208-1.437-1.349-1.679-.141-.243-.015-.374.106-.495.109-.109.243-.282.364-.423.121-.141.161-.243.243-.404.080-.161.040-.302-.020-.423-.060-.121-.543-1.31-.744-1.793-.196-.470-.395-.406-.543-.413l-.464-.008c-.161 0-.423.060-.645.302-.222.243-.847.828-.847 2.018 0 1.19.868 2.341.989 2.502.121.161 1.706 2.604 4.135 3.65.578.249 1.029.398 1.379.509.579.184 1.104.158 1.52.096.464-.069 1.434-.585 1.635-1.15.201-.565.201-1.05.141-1.15-.060-.099-.221-.16-.464-.281z"/>
                  </svg>
                </a>
              </div>
            </div>
          </div>

          <!-- GAME按钮 -->
          <div class="me-game-section">
            <button class="me-game-btn" id="gameBtn" @click="gameOpen = true">GAME</button>
          </div>

          <!-- 引用区域 -->
          <div class="me-quote-section">
            <div class="quote-text" id="quoteText">{{ quote }}</div>
            <div class="quote-author">— Live In Passion</div>
          </div>

          <!-- GITHUB SNAKE -->
          <div class="me-github-snake">
            <div class="snake-title">GITHUB ACTIVITY</div>
            <img
              src="https://raw.githubusercontent.com/HuangWeiLong-dot/liveinpassion/output/github-contribution-grid-snake.gif"
              alt="GitHub Contribution Snake"
              class="github-snake"
            >
          </div>
        </div>

        <div class="me-right">
          <!-- FAVOURITE MOVIE -->
          <div class="me-section-box me-movie-box" id="favouriteMovie" @click="movieOpen = true">
            <span>FAVOURITE MOVIE</span>
          </div>

          <!-- FAVOURITE ALBUM -->
          <div class="me-section-box me-album-box" id="favouriteAlbum" @click="albumOpen = true">
            <span>FAVOURITE ALBUM</span>
          </div>

          <!-- MORE：进独立的 GALLERY 页 -->
          <div class="me-section-box me-more-box" id="moreSection" @click="router.push('/gallery')">
            <div class="me-more-bg" id="moreSectionBg" ref="moreRef"></div>
            <span>MORE</span>
          </div>
          <!-- GALLERY：进 ME 相册页 -->
          <div class="me-section-box me-gallery-box" id="meGalleryBtn" @click="router.push('/me/gallery')">
            <div class="me-more-bg" id="meGalleryCover" ref="coverRef"></div>
            <span>GALLERY</span>
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

    <AppFooter />
  </main>
</template>
