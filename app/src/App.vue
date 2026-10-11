<script setup>
// 全局外壳。这里的每个组件对应旧版"所有页面之外"的那部分 DOM：
// 头部、加载遮罩、灯箱、音乐播放器、主题按钮、作者区。
//
// 两个关键点：
//  1. <keep-alive> —— 旧版所有页面的 DOM 常驻、只切 .active，所以首页随机布局、
//     好友随机头像、ME 相册的月份缓存、"只创建一次"的三个 iframe 才能保持稳定。
//     不用 keep-alive 这些行为都会变。
//  2. 视图不按 fullPath 做 key —— 旧版 /friends/a → /friends/b 是复用同一个容器重填，
//     视图内部用 watch(route.params) 复现。
import AppHeader from './components/AppHeader.vue';
import BrandOverlay from './components/BrandOverlay.vue';
import PageTransitionOverlay from './components/PageTransitionOverlay.vue';
import AuthorSection from './components/AuthorSection.vue';
import ThemeToggle from './components/ThemeToggle.vue';
import MusicPlayer from './components/MusicPlayer.vue';
import Lightbox from './components/Lightbox.vue';
import MobileDock from './components/MobileDock.vue';
import BlockCursor from './components/BlockCursor.vue';
import { useBrandOverlay } from './composables/useBrandOverlay.js';
import { useEdgeReveal } from './composables/useEdgeReveal.js';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

// 品牌遮罩揭开之后：主体和四个人格先出来（它们在 Hero 里），
// 头部 / 两个悬浮按钮 / 播放器 / 作者区这批晚一步 —— 先把注意力留给画面。
const {
  uiReady,
  switchTheme,
  // 首屏那个 ENTER 也要吃键盘（见下面的 onKeydown）：
  // 按钮本身不自动聚焦，只靠它自己的 @click / @keyup.enter 的话，
  // 进来第一屏按 Enter 是没有任何反应的。
  visible: brandVisible,
  phase: brandPhase,
  enter: brandEnter,
} = useBrandOverlay();

// ── 边缘滑出：作者区 / 右侧那排悬浮按钮，平时收在屏幕外 ────────────────────
// 指针靠到左下或右下才滑出来。判定在 composables/useEdgeReveal.js，
// 滑出的位移在 styles/main.css（`.is-edge-hover` 那一段）。
useEdgeReveal();

// ── X 键：把页面上所有图标/按钮收起来 ────────────────────────────────────
// 截图、或者单纯想安静看画面时用。再按一次恢复。
// 用 html 上的一个类而不是逐组件透传：那些控件分散在 shell 和各个页面里
//（头部、主题、播放器、作者区、首页那个背景开关），一条全局规则最省事。
// 哪些元素算"图标/按钮"写在 styles/main.css 里（.is-chrome-hidden 那段）。
const chromeHidden = ref(false);

// 同一批键盘快捷键都走这一个入口：
//   X —— 收起页面上所有图标/按钮（左下角头像、主题按钮在内，见 main.css 那张名单）
//   Z —— 切换主题。X 把主题按钮藏起来之后，这是唯一的切法，所以两个键是一对。
//       走的是和按钮完全同一条路径（switchTheme，屏幕被品牌遮罩盖住之后才换色），
//       不是另写一套。
//   Enter —— 首屏那个 ENTER 按钮。走的就是按钮点下去的那条路径（useBrandOverlay
//       的 enter），不是另写一套时序。只在遮罩还盖着、且停在 idle 时接 ——
//       进站之后 Enter 要留给页面里正常的元素（链接、按钮）。
function onKeydown(event) {
  // 组合键别抢（Cmd/Ctrl+X 是剪切），输入框里打字也别抢
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const t = event.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const k = event.key.toLowerCase();

  // 首屏：Enter = 点 ENTER。整个遮罩盖着期间（含开场动画那几秒）都把 Enter
  // 扣下来，只有停在 idle 时才真的进去 —— 底下那些链接是看不见但**仍可聚焦**的，
  // 不拦住的话 Tab 到某个链接再按 Enter 会一边开场一边跳页。
  // preventDefault 顺带把按钮在聚焦态下的合成 click 也吃掉（我们这里已经自己
  // 调了 enter()，不 preventDefault 就是同一次按键走两遍，靠 enter() 内部
  // phase 的守卫兜住而已）。
  if (k === 'enter' && brandVisible.value) {
    event.preventDefault();
    if (brandPhase.value === 'idle') brandEnter();
    return;
  }

  if (k === 'x') {
    chromeHidden.value = !chromeHidden.value;
  } else if (k === 'z') {
    switchTheme();
  }
}

watch(chromeHidden, (v) => {
  document.documentElement.classList.toggle('is-chrome-hidden', v);
});

onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <!-- 这一层只负责那群固定定位的悬浮件的淡入，包一层是为了不碰它们各自的 transition -->
  <div class="shell" :class="{ 'is-ready': uiReady }">
    <AppHeader />
    <ThemeToggle />
    <AuthorSection />
    <MusicPlayer />
  </div>

  <!-- 首屏进入用的品牌遮罩（旧的 AppLoader 已被它取代） -->
  <BrandOverlay />

  <router-view v-slot="{ Component }">
    <keep-alive>
      <component :is="Component" />
    </keep-alive>
  </router-view>

  <Lightbox />

  <!-- 方块光标。原来是首页 Hero 自己的东西（只在那一个 section 里跟着走），
       现在提到这里、全站一份：它自己 Teleport 到 body，并且压在所有层之上
       （含品牌遮罩和转场板子）。 -->
  <BlockCursor />

  <!-- 手机上把左下作者区 + 右下按钮收进一个汉堡（宽屏下它整个不渲染） -->
  <MobileDock />
  <!-- 通用转场：一块板子从随机一侧划进来 + 正中那行板块名。
       它必须挂在**这里**（body 直下、z-index 9 万）：要盖住整站所有的悬浮件
       （头部、灯箱、播放器、品牌遮罩），同时也得落在**没有 transform 的祖先**下 ——
       被 transform 的祖先会把 position: fixed 的包含块换成它自己。
       时序在 composables/usePageTransition.js，动效由组件自己用 GSAP 演
       （见 components/PageTransitionOverlay.vue，不再走 View Transitions）。 -->
  <PageTransitionOverlay />
</template>

<style scoped>
/* 逐个浮出来，不是整块硬切。
   注意只用 opacity：这几个都是固定定位的悬浮件，给它们（或这一层）加
   transform/filter 会造出新的包含块，它们会集体跑位。

   ⚠ 必须**逐个点名**，不能用 `> *`：
   MusicPlayer 会渲染三个根元素（按钮、点击遮罩、居中的播放弹窗），
   通配会把本该隐藏的弹窗也强制成 opacity:1 —— 于是首屏一进来就有一个
   播放器浮在屏幕正中间。 */
.shell > #header,
.shell > .theme-toggle,
.shell > .author-section,
/* ⚠ MusicPlayer 是**多根**组件（按钮 + 点击遮罩 + 播放弹窗三个根），
   Vue 不会把父级的 scope id 加到多根组件的根上 —— 所以 `.shell > .music-toggle-btn`
   编译出来的带 [data-v] 版本一条都匹配不到，音乐按钮从第一帧就是亮的。
   :deep() 把它编译成后代选择器、不带 scope 属性，才管得住它。
   （头部 / 主题 / 作者区都是单根组件，本来就能匹配，写在这儿只为一致。） */
.shell > :deep(.music-toggle-btn) {
  opacity: 0;
  transition: opacity 0.6s ease;
}

/* 会被"边缘滑出"推来推去的这三个，除了淡入还要给 translate 一条自己的 transition。
   上面那条 `transition: opacity ...` 只管 opacity，不补这一条的话滑出/滑回是硬切。
   （写在这条后面、选择器权重相同，所以由它覆盖。） */
.shell > .theme-toggle,
.shell > .author-section,
.shell > :deep(.music-toggle-btn) {
  transition: opacity 0.6s ease, translate 0.42s cubic-bezier(0.4, 0, 0.2, 1);
}

.shell.is-ready > #header,
.shell.is-ready > .theme-toggle,
.shell.is-ready > .author-section,
.shell.is-ready > :deep(.music-toggle-btn) {
  opacity: 1;
}

/* 依次错开：头部 → 主题按钮 → 作者头像 → 播放器按钮。
   两个值是给上面那两条属性的：错峰只错淡入，滑出要立刻响应
   —— 鼠标蹭到边缘还得等 0.3 秒才出来，那就不像话了。 */
.shell.is-ready > .theme-toggle {
  transition-delay: 0.1s, 0s;
}

.shell.is-ready > .author-section {
  transition-delay: 0.2s, 0s;
}

.shell.is-ready > :deep(.music-toggle-btn) {
  transition-delay: 0.3s, 0s;
}
</style>
