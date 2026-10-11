<script setup>
// 全局方块光标：跟着指针走的那个 10px 方块。
//
// 原来这块长在 HeroConcept.vue 里，只作用于首页首屏。现在归到这里、由 App.vue
// 挂在 <router-view> 之外 —— 整站（首页、博客、好友、ME、灯箱、以及盖在最上面的
// 品牌遮罩和转场层）都是同一个方块。
//
// ⚠ 两件事必须成对，否则会出现"系统光标压掉了、方块却没画出来"的空档：
//   ① html.is-block-cursor —— 把系统光标压掉（规则在 styles/main.css，
//      因为要 `html ... *` 全局选择器，放不进 scoped）；
//   ② 那个类**只在方块真的可见时**才挂 —— 见下面 onMove / hide 的注释。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useTheme } from '../composables/useTheme.js';
import { blockCursorHot, clearBlockCursorHot, readBlockCursorHot } from '../composables/useBlockCursor.js';

// 跟着主题走。useTheme 里那个 ref 是模块级的，所以 Z 键 / 主题按钮切换时
// 这里会自动跟着变，不需要另接一条监听。
const { isDark } = useTheme();

const el = ref(null);
const visible = ref(false);
const autoHot = ref(false);
const finePointer = ref(false);
const reducedMotion = ref(false);

let mql = null;
let motionMql = null;
let raf = 0;
let x = 0;
let y = 0;
let hit = null; // 这一帧指针下面那个元素（用来判"压没压在可交互物上"）

/** 指针现在压在什么上面 → 方块该不该放大。
 *
 *  前四条是通用可交互元素；后面这一串是**旧站样式表里标了 cursor: pointer 的
 *  那些块**——它们是 article / div 拼出来的卡片、相册格、灯箱控件，没有语义标签，
 *  只能点名（名单来自 styles/main.css 与各组件 scoped 样式里的 cursor: pointer）。
 *
 *  ⚠ 拖拽面故意不在名单里：`.jb-carousel`（博客轨道）、`.progress-track`（进度条）、
 *    `.volume-slider`（音量）在旧站标的是 grab/pointer，但那儿要的是"抓"，不是"点"，
 *    方块跟着放大反而在说"按我"。
 *  ⚠ 也不收 [tabindex]：博客轨道自己就是 tabindex="0" 的焦点容器，收进来的话
 *    整页的背景都算"可交互"，方块会一直处于放大态。 */
const HOT = [
  'a[href]', 'button', 'summary', '[role="button"]', '[role="link"]',
  '.gallery-item', '.gallery-featured-large', '.blog-card', '.friend-card',
  '.timeline-photo-item', '.back-link', '.scroll-arrow',
  '.me-gallery-item', '.me-section-box', '.me-game-btn', '.me-gallery-month-btn',
  '.steam-profile-btn',
  '.lightbox-nav', '.lightbox-close-area', '.me-photo-lightbox-close',
  '.bd-closezone', '.modal-close', '.jb-card', '.playlist-item',
  '.dock-btn', '.dock-item', '.brand__enter', '.wall-toggle', '.menu-toggle',
  '.theme-toggle', '.music-toggle-btn', '.author-avatar',
  '.player-btn', '.player-play-btn', '.stats-retry',
].join(',');

function setHtmlClass(on) {
  document.documentElement.classList.toggle('is-block-cursor', on);
}

function flush() {
  raf = 0;
  const node = el.value;
  if (node) node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  // 命中判定放在这一帧里做一次，不是每个 pointermove 都做：
  // 一帧里可能来好几个 move，而 closest() 要走一遍整条祖先链。
  autoHot.value = !!(hit && hit.closest && hit.closest(HOT));
  // 别人举的旗（首页人格卡 / 主体）也在这时候复核一遍：
  // 元素被摘出文档、指针挪开了，都在这条路上回收。
  readBlockCursorHot();
}

function onMove(event) {
  if (!finePointer.value) return;
  x = event.clientX;
  y = event.clientY;
  hit = event.target;
  if (!visible.value) {
    visible.value = true;
    // 到这一刻才压系统光标。反过来的话，从页面加载到第一次挪鼠标之间
    // （首屏那几秒尤其明显）就是一个光标都没有的状态。
    setHtmlClass(true);
  }
  if (!raf) raf = requestAnimationFrame(flush);
}

/** 指针离开文档 / 窗口失焦。系统光标还回去 —— 那时候指针已经不在页面上了，
 *  方块停在上一次的位置不动才是错的（切出去再切回来会看见它留在原地）。 */
function hide() {
  visible.value = false;
  autoHot.value = false;
  clearBlockCursorHot(); // 顺手把别人举的旗放下，否则会留一个放大的定格
  setHtmlClass(false);
}

function syncPointer(event) {
  finePointer.value = event.matches;
  if (!event.matches) hide(); // 触屏 / 无 hover：整个关掉，别去压系统光标
}

function syncMotion(event) {
  reducedMotion.value = event.matches;
}

// 换页时把这轮判定清掉。两条都要清：
//   ① 手动那条（首页人格卡 / 主体）—— 卡片连同整页被摘出文档，pointerleave 不会到；
//   ② 自动那条 —— 它是「上一页指针底下是谁」的快照，指针不动的话会一直挂着，
//      而底下早就换了一页了（实测：点完卡片换到详情页，方块还是放大态）。
// 清零之后指针一动就按新页面重算；不清的话会停在上一次的判定上。
const route = useRoute();
watch(() => route.fullPath, () => {
  autoHot.value = false;
  clearBlockCursorHot();
});

onMounted(() => {
  mql = window.matchMedia('(hover: hover) and (pointer: fine)');
  finePointer.value = mql.matches;
  mql.addEventListener('change', syncPointer);

  motionMql = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion.value = motionMql.matches;
  motionMql.addEventListener('change', syncMotion);

  // passive：这一条绝对不拦事件的默认行为
  document.addEventListener('pointermove', onMove, { passive: true });
  // pointerleave 不冒泡，得挂在真正收到它的那个元素上（html）
  document.documentElement.addEventListener('pointerleave', hide);
  window.addEventListener('blur', hide);
});

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf);
  mql?.removeEventListener('change', syncPointer);
  motionMql?.removeEventListener('change', syncMotion);
  document.removeEventListener('pointermove', onMove);
  document.documentElement.removeEventListener('pointerleave', hide);
  window.removeEventListener('blur', hide);
  setHtmlClass(false);
  clearBlockCursorHot();
});
</script>

<template>
  <!-- 挂到 body 直下：任何带 transform/filter 的祖先都会把 position: fixed 的
       包含块换成它自己，translate3d(clientX, clientY) 就不再是视口坐标。
       首页 Hero 上踩过这个坑（滚到页脚时方块和指针差 116px），而转场层那一下
       整页是放大着走的 —— 留在这里才稳。 -->
  <Teleport to="body">
    <div
      ref="el"
      class="block-cursor"
      :class="{
        'is-visible': visible,
        'is-active': blockCursorHot || autoHot,
        'is-dark': isDark,
        'is-still': reducedMotion,
      }"
      aria-hidden="true"
    >
      <span class="block-cursor__dot" />
    </div>
  </Teleport>
</template>

<style scoped>
.block-cursor {
  position: fixed;
  top: 0;
  left: 0;
  /* 压在一切之上：转场板子是 90000，品牌遮罩 9999。方块要是被它们盖住，
     而系统光标又被 is-block-cursor 压掉了，那几秒就是"屏幕上没有光标"。 */
  z-index: 100000;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.25s ease;
  will-change: transform;
  /* 底色变量必须**自带**，不能像别的规则那样从别处继承 —— 这个元素被 Teleport
     到 body 了，不是任何页面的后代。 */
  --block-cursor-ink: #000000; /* 亮色模式：纯黑方块 */
}

.block-cursor.is-dark {
  --block-cursor-ink: #ffffff; /* 暗色模式：纯白方块 */
}

.block-cursor.is-visible {
  opacity: 1;
}

.block-cursor__dot {
  display: block;
  width: 10px;
  height: 10px;
  /* 颜色跟着主题走：亮色纯黑、暗色纯白。
     早先用的是 difference 混合想自动取反，但结果受底色影响（浅灰底上会变成
     近黑的灰、而不是黑），明暗两个主题下都不干脆，还不如直接给死。 */
  background: var(--block-cursor-ink);
  transform: translate(-50%, -50%) scale(1);
  transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}

.block-cursor.is-active .block-cursor__dot {
  transform: translate(-50%, -50%) scale(1.5);
}

/* 关掉动效：方块照旧跟着指针走（那是 1:1 跟手，本来就不是动画），
   只是不再"淡进来 / 长出来"。 */
.block-cursor.is-still,
.block-cursor.is-still .block-cursor__dot {
  transition: none;
}

/* 触屏（没有 hover 的指针）下整个不显示。JS 那边也不会给 html 挂
   is-block-cursor，所以这里只是双保险。 */
@media (hover: none) {
  .block-cursor {
    display: none;
  }
}
</style>
