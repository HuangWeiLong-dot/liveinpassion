<script setup>
// 导航。布局与动效参照 dianedesclaux.com 的 Header 逆向结果，视觉语言沿用本站：
//   · 顶部居中、max-content 宽的悬浮条（内边距 4px / 项高 30px / 直角）；
//   · 半透明纸面 + backdrop blur（参考站是 glass bg-chrome/25 + blur 8px）；
//   · 条内项目在站点就绪后按 300ms + i*70ms 错峰淡入。
//
// 条里只放「字标 / 当前板块 / 三个点」，**不放板块入口**。三个点打开的是
// FilterPanel 的窗帘面板 —— 750ms 的 clip-path 从中间竖向缝隙向两侧展开
// （expo.inOut），面板是实心纸面；所有板块与工具都收进这层，不写编号、不画分割线。
// 窄屏用汉堡，同样打开这层窗帘。
//
// ⚠ 居中不能用 transform（translateX(-50%)）：#header 里挂着 position: fixed 的
// 窗帘面板，祖先一旦有 transform，fixed 就会被关进头部这个几百像素的盒子里。
// 用 left/right:0 + margin-inline:auto 居中。
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
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
const { switchTheme, uiReady } = useBrandOverlay();
const { wallHidden } = useWallPref();
const avatar = LOCAL_ASSETS.authorAvatar;

const isHome = computed(() => route.path === '/');

// 路由 → 当前板块。子页面归到所属板块，详情页也保持父级高亮。
const activeKey = computed(() => {
  const p = route.path;
  if (p === '/') return 'home';
  if (p.startsWith('/echoes')) return 'echoes';
  if (p.startsWith('/projection')) return 'film';
  if (p.startsWith('/photography') || p.startsWith('/gallery')) return 'photo';
  if (p.startsWith('/life')) return 'life';
  if (p.startsWith('/me')) return 'me';
  return '';
});

const navItems = computed(() => [
  { key: 'echoes', label: 'ECHOES', to: '/echoes' },
  { key: 'film', label: 'FILM', to: '/projection' },
  { key: 'photo', label: 'PHOTO', to: '/photography' },
  { key: 'life', label: 'LIFE', to: '/life' },
  { key: 'me', label: virtue.value, to: '/me' },
]);

// 窗帘里的入口：HOME 在最前，其余是各板块。
const curtainItems = computed(() => [
  { key: 'home', label: 'HOME', to: '/' },
  ...navItems.value,
]);

// 条里跟在字标后面的当前板块（首页不显示，字标本身就是当前页）。
const currentLabel = computed(
  () => navItems.value.find((item) => item.key === activeKey.value)?.label || '',
);

// ── 窗帘面板（参考站 FilterPanel）────────────────────────────────────────
// 打开：挂载面板 → 下一帧加 .is-open，clip-path 从中间展开。
// 关闭：摘掉 .is-open，等 750ms 的收回动画演完再卸载。
const CURTAIN_MS = 750;
const curtainOpen = ref(false);
const curtainMounted = ref(false);
let curtainTimer = null;

function openCurtain() {
  if (curtainOpen.value) return;
  clearTimeout(curtainTimer);
  curtainMounted.value = true;
  nextTick(() => requestAnimationFrame(() => { curtainOpen.value = true; }));
}

function closeCurtain() {
  if (!curtainMounted.value || !curtainOpen.value) return;
  curtainOpen.value = false;
  document.documentElement.classList.remove('nav-curtain-open');
  clearTimeout(curtainTimer);
  curtainTimer = setTimeout(() => { curtainMounted.value = false; }, CURTAIN_MS);
}

function toggleCurtain() {
  curtainOpen.value ? closeCurtain() : openCurtain();
}

watch(curtainOpen, (open) => {
  document.documentElement.classList.toggle('nav-curtain-open', open);
});

// 汉堡里的动作统一收起面板：按完应该直接看到结果。
function navAction(action) {
  closeCurtain();
  action();
}

function toggleWall() {
  wallHidden.value = !wallHidden.value;
}

function goBack() {
  // 旧版是自建的 pageHistory 栈；改用浏览器历史，没有应用内历史时回首页。
  if (window.history.state && window.history.state.back) router.back();
  else router.push('/');
}

function onKeydown(event) {
  if (event.key === 'Escape' && curtainOpen.value) closeCurtain();
}

watch(() => route.fullPath, () => {
  closeCurtain();
});

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
  clearTimeout(curtainTimer);
  document.documentElement.classList.remove('nav-curtain-open');
});
</script>

<template>
  <header
    id="header"
    :class="{ 'is-ready': uiReady }"
    :inert="!uiReady"
  >
    <nav class="nav-pill" aria-label="Main navigation">
      <button
        v-if="!isHome"
        id="backLink"
        class="back-link nav-back"
        type="button"
        aria-label="Back"
        @click="goBack"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      <router-link
        to="/"
        class="logo nav-item nav-item--brand"
        data-nav-key="home"
        :class="{ 'is-active': activeKey === 'home' }"
        :style="{ '--i': 0 }"
      >LIVEINPASSION</router-link>

      <!-- 当前板块：条里不放入口，只用一行字 + 小方点告诉你在哪 -->
      <span v-if="currentLabel" class="nav-current">{{ currentLabel }}</span>

      <!-- 参考站的三个点：打开后错峰变成横向减号。所有板块入口都在它打开的窗帘里。 -->
      <button
        class="nav-dots"
        :class="{ 'is-open': curtainOpen }"
        type="button"
        aria-label="打开导航菜单"
        aria-controls="navCurtain"
        :aria-expanded="String(curtainOpen)"
        :style="{ '--i': 2 }"
        @click="toggleCurtain"
      >
        <svg class="nav-dots__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle v-for="(cy, i) in [5.625, 12, 18.375]" :key="`v${i}`" cx="12" :cy="cy" r="1.125" fill="currentColor" class="nav-dots__v" :style="{ '--i': i }" />
          <circle v-for="(cx, i) in [5.625, 12, 18.375]" :key="`h${i}`" :cx="cx" cy="12" r="1.125" fill="currentColor" class="nav-dots__h" :style="{ '--i': i }" />
        </svg>
      </button>

      <!-- 窄屏沿用汉堡（X 变形），同样打开这层窗帘 -->
      <button
        class="menu-toggle"
        :class="{ 'is-open': curtainOpen }"
        type="button"
        aria-label="打开导航菜单"
        aria-controls="navCurtain"
        :aria-expanded="String(curtainOpen)"
        @click="toggleCurtain"
      >
        <span class="menu-toggle__lines" aria-hidden="true"><span /><span /></span>
      </button>
    </nav>

    <div
      v-if="curtainMounted"
      id="navCurtain"
      class="nav-curtain"
      :class="{ 'is-open': curtainOpen }"
      role="dialog"
      aria-label="导航与工具"
      @click.self="closeCurtain"
    >
      <div class="nav-curtain__panel">
        <div class="nav-curtain__inner">
          <p class="nav-curtain__eyebrow">MENU</p>

          <nav class="nav-curtain__links" aria-label="Sections">
            <router-link
              v-for="(item, i) in curtainItems"
              :key="item.key"
              :to="item.to"
              class="nav-curtain__link"
              :class="{ 'is-active': activeKey === item.key }"
              :style="{ '--i': i }"
              @click="closeCurtain"
            >
              <span class="nav-curtain__label">{{ item.label }}</span>
            </router-link>
          </nav>

          <div class="nav-curtain__tools">
            <img class="nav-curtain__avatar" :src="avatar" alt="Author Avatar">
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
            <button v-if="isHome" class="nav-tool" type="button" aria-label="切换背景封面" :aria-pressed="String(!wallHidden)" :class="{ 'is-off': wallHidden }" @click="navAction(toggleWall)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7.5" height="7.5" rx="1" />
                <rect x="13.5" y="3" width="7.5" height="7.5" rx="1" />
                <rect x="3" y="13.5" width="7.5" height="7.5" rx="1" />
                <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </header>
</template>