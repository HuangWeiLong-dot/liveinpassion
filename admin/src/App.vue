<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import AdminFooter from './components/AdminFooter.vue';
import { isDark, toggleTheme } from './theme.js';
import AdminIcon from './components/AdminIcon.vue';
import DeleteGuardModal from './components/DeleteGuardModal.vue';

const route = useRoute();

// 前台头部滚动后才落一条发丝线；这里用 rAF 节流，滚动本身不做别的活
const scrolled = ref(false);
let ticking = false;

function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    scrolled.value = window.scrollY > 4;
    ticking = false;
  });
}

// 手机导航：窄屏下不再把六个入口挤成一条横向滚动条，
// 改成右上角的菜单按钮 + 一张下拉面板。桌面端按钮隐藏，布局不变。
const menuOpen = ref(false);
// 菜单只在 ≤1024px 生效；从窄屏拉回桌面时顺手收起，免得回来时还开着。
const compactScreen = window.matchMedia('(max-width: 1024px)');
function onCompactChange(e) {
  if (!e.matches) closeMenu();
}
function closeMenu() {
  menuOpen.value = false;
}
function toggleMenu() {
  menuOpen.value = !menuOpen.value;
}
function onDocumentClick(e) {
  if (!menuOpen.value) return;
  if (e.target.closest?.('.admin-nav')) return;
  closeMenu();
}
function onKeydown(e) {
  if (e.key === 'Escape') closeMenu();
}
watch(() => route.fullPath, closeMenu);

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeydown);
  compactScreen.addEventListener('change', onCompactChange);
  onScroll();
});
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll);
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onKeydown);
  compactScreen.removeEventListener('change', onCompactChange);
});
</script>

<template>
  <div class="admin-layout">
    <header class="admin-nav" :class="{ 'is-scrolled': scrolled }">
      <RouterLink to="/" class="brand" aria-label="LIVEINPASSION Content Desk">
        <span class="brand-mark">LIVEINPASSION</span>
        <span class="brand-sub">CONTENT DESK — CMS</span>
      </RouterLink>

      <button
        type="button"
        class="nav-menu-toggle"
        :class="{ 'is-open': menuOpen }"
        :aria-expanded="menuOpen"
        aria-controls="admin-nav-links"
        aria-label="Menu"
        @click="toggleMenu"
      >
        <span class="nav-menu-toggle__bar" aria-hidden="true"></span>
        <span class="nav-menu-toggle__bar" aria-hidden="true"></span>
        <span class="nav-menu-toggle__bar" aria-hidden="true"></span>
      </button>

      <nav id="admin-nav-links" class="nav-links" :class="{ 'is-open': menuOpen }">
        <RouterLink to="/" class="nav-item" @click="closeMenu">Posts <span class="nav-en">01</span></RouterLink>
        <RouterLink to="/albums" class="nav-item" @click="closeMenu">Albums <span class="nav-en">02</span></RouterLink>
        <RouterLink to="/showcase" class="nav-item" @click="closeMenu">Showcase <span class="nav-en">03</span></RouterLink>
        <RouterLink to="/films" class="nav-item" @click="closeMenu">Films <span class="nav-en">04</span></RouterLink>
        <RouterLink to="/taxonomy" class="nav-item" @click="closeMenu">Taxonomy <span class="nav-en">05</span></RouterLink>
        <a href="https://liveinpassion.me" target="_blank" rel="noopener" class="nav-item nav-item--ghost" @click="closeMenu">
          Site <span class="nav-en">↗</span>
        </a>

        <button
          type="button"
          class="theme-toggle"
          :aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
          @click="toggleTheme"
        >
          <svg v-if="isDark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        </button>

        <form method="POST" action="/api/logout" class="nav-logout-form">
          <button type="submit" class="nav-item nav-item--logout">Logout <span class="nav-en"><AdminIcon name="logout" :size="12" /></span></button>
        </form>
      </nav>
      <div v-if="menuOpen" class="nav-backdrop" aria-hidden="true" @click="closeMenu"></div>
    </header>

    <main class="admin-main">
      <div class="admin-main__inner">
        <RouterView />
      </div>
    </main>

    <AdminFooter />
  </div>
  <DeleteGuardModal />
</template>