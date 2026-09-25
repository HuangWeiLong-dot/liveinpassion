<script setup>
// 头部。对应旧 index.html L4824-L4846 的标记与 navigateTo() 里的三处副作用：
//   - 非首页加 .centered
//   - 返回按钮：首页隐藏，其它页面 display:flex
//   - 导航时收起移动端菜单（nav 的 .active）
// 另有全局的滚动监听：scrollY > 50 时给 header 加 .scrolled（旧版 15ms 防抖）
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useVirtue } from '../composables/useVirtue.js';

const route = useRoute();
const router = useRouter();
const { virtue } = useVirtue();

const navOpen = ref(false);
const scrolled = ref(false);

const isHome = computed(() => route.path === '/');

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
      <router-link to="/me" id="meNavLink">{{ virtue }}</router-link>
    </nav>
    <button class="menu-toggle" id="menuToggle" aria-label="Toggle menu" @click="navOpen = !navOpen">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    </button>
  </header>
</template>
