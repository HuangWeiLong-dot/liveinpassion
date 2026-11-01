<script setup>
// 头部。对应旧 index.html L4824-L4846 的标记与 navigateTo() 里的三处副作用：
//   - 非首页加 .centered
//   - 返回按钮：首页隐藏，其它页面 display:flex
//   - 导航时收起移动端菜单（nav 的 .active）
// 另有全局的滚动监听：scrollY > 50 时给 header 加 .scrolled（旧版 15ms 防抖）
//
// 桌面端那批悬浮控件（作者头像 / 社交 / 主题 / 音乐 / 背景开关）在左下角
// 的 AuthorSection 里；≤1024px 它们统一收进这个汉堡。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ICONS, LOCAL_ASSETS } from '../data/assets.js';
import { useVirtue } from '../composables/useVirtue.js';
import { useMusicPlayer } from '../composables/useMusicPlayer.js';
import { useBrandOverlay } from '../composables/useBrandOverlay.js';
import { useWallPref } from '../composables/useWallPref.js';

const route = useRoute();
const router = useRouter();
const { virtue } = useVirtue();
const { playerVisible, togglePlayer } = useMusicPlayer();
const { switchTheme } = useBrandOverlay();
const { wallHidden } = useWallPref();
const avatar = LOCAL_ASSETS.authorAvatar;

const navOpen = ref(false);
const scrolled = ref(false);

const isHome = computed(() => route.path === '/');

// 汉堡里的动作统一收起菜单：按完应该直接看到结果，而不是还压着一层导航。
function navAction(action) {
  navOpen.value = false;
  action();
}

function toggleWall() {
  wallHidden.value = !wallHidden.value;
}

function goBack() {
  // 旧版是自建的 pageHistory 栈；改用浏览器历史，没有应用内历史时回首页。
  // （这是本次迁移唯一刻意不保持 bug 兼容的地方：旧版浏览器后退反而会往栈里压记录）
  if (window.history.state && window.history.state.back) router.back();
  else router.push('/');
}

let scrollTimer = null;
function onScroll() {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    scrolled.value = window.scrollY > 50;
  }, 15);
}

onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }));
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll);
  clearTimeout(scrollTimer);
});

// 导航后收起菜单（旧版在 navigateTo 里做）
watch(() => route.fullPath, () => {
  navOpen.value = false;
});
</script>

<template>
  <header id="header" :class="{ centered: !isHome, scrolled }">
    <div class="header-left">
      <span class="back-link" id="backLink" :style="{ display: isHome ? 'none' : 'flex' }" @click="goBack">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back
      </span>
      <router-link to="/" class="logo">LIVEINPASSION</router-link>
    </div>

    <nav :class="{ active: navOpen }">
      <router-link to="/">HOME</router-link>
      <router-link to="/blogs">BLOGS</router-link>
      <router-link to="/life">LIFE</router-link>
      <router-link to="/me" id="meNavLink">{{ virtue }}</router-link>

      <!-- ≤1024px：原来底部那条"空格键"里的全部控件，统一收进汉堡。 -->
      <div class="nav-tools">
        <img class="nav-tools__avatar" :src="avatar" alt="Author Avatar">
        <a class="nav-tool" href="https://x.com/HuangWeiLong525" aria-label="Twitter/X" target="_blank" rel="noopener noreferrer">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"></path>
          </svg>
        </a>
        <a class="nav-tool" href="https://github.com/HuangWeiLong-dot" aria-label="GitHub" target="_blank" rel="noopener noreferrer">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
          </svg>
        </a>
        <button class="nav-tool" type="button" aria-label="Toggle theme" @click="navAction(switchTheme)">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
          </svg>
        </button>
        <button class="nav-tool" type="button" aria-label="Toggle music player" :class="{ 'is-active': playerVisible }" @click="navAction(togglePlayer)">
          <img :src="ICONS.notes" alt="Music">
        </button>
        <button class="nav-tool" type="button" aria-label="切换背景封面" :aria-pressed="String(!wallHidden)" :class="{ 'is-off': wallHidden }" @click="navAction(toggleWall)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7.5" height="7.5" rx="1" />
            <rect x="13.5" y="3" width="7.5" height="7.5" rx="1" />
            <rect x="3" y="13.5" width="7.5" height="7.5" rx="1" />
            <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1" />
          </svg>
        </button>
      </div>
    </nav>

    <button class="menu-toggle" id="menuToggle" aria-label="Toggle menu" :aria-expanded="String(navOpen)" @click="navOpen = !navOpen">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    </button>
  </header>
</template>
