<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { RouterLink, RouterView } from 'vue-router';
import AdminFooter from './components/AdminFooter.vue';
import { isDark, toggleTheme } from './theme.js';

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

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
});
onUnmounted(() => window.removeEventListener('scroll', onScroll));
</script>

<template>
  <div class="admin-layout">
    <header class="admin-nav" :class="{ 'is-scrolled': scrolled }">
      <RouterLink to="/" class="brand" aria-label="LIVEINPASSION Content Desk">
        <span class="brand-mark">LIVEINPASSION</span>
        <span class="brand-sub">CONTENT DESK — CMS</span>
      </RouterLink>

      <nav class="nav-links">
        <RouterLink to="/" class="nav-item">Posts <span class="nav-en">01</span></RouterLink>
        <RouterLink to="/albums" class="nav-item">Albums <span class="nav-en">02</span></RouterLink>
        <RouterLink to="/showcase" class="nav-item">Showcase <span class="nav-en">03</span></RouterLink>
        <RouterLink to="/films" class="nav-item">Films <span class="nav-en">04</span></RouterLink>
        <a href="https://liveinpassion.me" target="_blank" rel="noopener" class="nav-item nav-item--ghost">
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
          <button type="submit" class="nav-item nav-item--logout">Logout <span class="nav-en">×</span></button>
        </form>
      </nav>
    </header>

    <main class="admin-main">
      <div class="admin-main__inner">
        <RouterView />
      </div>
    </main>

    <AdminFooter />
  </div>
</template>
