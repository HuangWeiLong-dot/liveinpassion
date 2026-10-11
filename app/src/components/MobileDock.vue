<script setup>
// ≤768px：把左下角的作者区、右下角的主题/音乐按钮收进一个汉堡里。
//
// ⚠ 为什么不把它们"搬进"这个组件的 DOM 里：App.vue 那批悬浮件的首屏淡入是按
//   **直接子元素**点名的（`.shell > .theme-toggle`、`.shell > .author-section` …），
//   换掉 DOM 位置那条淡入就失效了。所以这里不动结构 —— 只在手机上把原件隐藏，
//   用**同一批动作**（switchTheme / togglePlayer）重做一组按钮放进汉堡。
//   这样也不会出现"汉堡里的按钮和原按钮行为不一致"。
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { LOCAL_ASSETS } from '../data/assets.js';
import { useMusicPlayer } from '../composables/useMusicPlayer.js';
import { useBrandOverlay } from '../composables/useBrandOverlay.js';
import { useWallPref } from '../composables/useWallPref.js';

const open = ref(false);
const { playerVisible, togglePlayer } = useMusicPlayer();
const { switchTheme } = useBrandOverlay();
const { wallHidden } = useWallPref();
const avatar = LOCAL_ASSETS.authorAvatar;

// 开着的时候按 Esc 收起
function onKey(e) {
  if (e.key === 'Escape') open.value = false;
}
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="dock" :class="{ 'is-open': open }">
    <div class="dock-panel">
      <img class="dock-avatar" :src="avatar" alt="Author Avatar" width="44" height="44">
      <a class="dock-item" href="https://x.com/HuangWeiLong525" target="_blank" rel="noopener noreferrer">X</a>
      <a class="dock-item" href="https://github.com/HuangWeiLong-dot" target="_blank" rel="noopener noreferrer">GitHub</a>
      <button class="dock-item" type="button" @click="switchTheme()">Theme</button>
      <button class="dock-item" type="button" :class="{ 'is-active': playerVisible }" @click="togglePlayer()">Music</button>
      <button class="dock-item" type="button" :class="{ 'is-active': !wallHidden }" @click="wallHidden = !wallHidden">Wall</button>
    </div>
    <!-- 底部那条"空格键"：直角、横跨整个宽度。
         图标刻意不用汉堡那三条杠 —— 右上角的导航按钮就是汉堡，两个长得一样会分不清。
         这里用横向三点（more），展开时整条反色，状态一眼可辨。 -->
    <button
      class="dock-btn"
      type="button"
      :aria-expanded="open"
      aria-label="Menu"
      @click="open = !open"
    >
      <span class="dock-dot"></span><span class="dock-dot"></span><span class="dock-dot"></span>
    </button>
  </div>
</template>

<style scoped>
/* 宽屏：整个组件不渲染 —— 它只是手机上的另一个入口，桌面那套悬浮件照旧。 */
.dock {
  display: none;
}

@media (max-width: 1024px) {
  /* 断点跟站点自己的移动布局对齐（明细页也是 1024）：再往上就是桌面那套悬浮件。 */
  /* 原件让位：它们能做的事已经在汉堡里了。
     左下角那个作者区一并收进去（头像 + 两个社交链接都在面板里）。
     ⚠ wall-toggle 必须 !important：它的样式在 HeroConcept 的 **scoped** 里
     （`.wall-toggle[data-v-…]` 两个类），权重比这里的一个类高 —— 不写 !important
     它是唯一一个留在屏幕上的（实测：其余三个都让位了，就它还在）。 */
  :global(html .theme-toggle),
  :global(html .music-toggle-btn),
  :global(html .author-section) {
    display: none;
  }

  :global(html .wall-toggle) {
    display: none !important;
  }

  /* 整条横跨底部（左右各留 16px），上沿就是面板展开的位置。
     ⚠ 这里和下面的按钮都是直角：用户明确不要圆角。 */
  .dock {
    position: fixed;
    left: 16px;
    right: 16px;
    bottom: 16px;
    z-index: 1001;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  /* 展开的面板：平时只占位不可见，点一下才出来（不用 display: none，
     那样就没有过渡了）。和按钮同宽、同样直角。 */
  .dock-panel {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 0;
    background: color-mix(in srgb, var(--bg) 94%, transparent);
    backdrop-filter: blur(10px);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.16);
    opacity: 0;
    visibility: hidden;
    transform: translateY(6px);
    transition: opacity 0.22s ease, transform 0.22s ease, visibility 0.22s ease;
  }

  .dock.is-open .dock-panel {
    opacity: 1;
    visibility: visible;
    transform: none;
  }

  /* 直角方框，和面板、按钮一致（这只原本是唯一一个圆的） */
  .dock-avatar {
    width: 44px;
    height: 44px;
    margin: 4px auto 8px;
    border-radius: 0;
    object-fit: cover;
    display: block;
  }

  /* 每一项都按触屏最小点按尺寸给（44px），别做成小字按钮 */
  .dock-item {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 44px;
    padding: 0 14px;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--text-primary);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.7rem;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    text-decoration: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .dock-item:hover,
  .dock-item:active,
  .dock-item.is-active {
    background: color-mix(in srgb, var(--text-primary) 10%, transparent);
  }

  /* 底部那条"空格键"：横跨整个宽度、直角。
     展开时整条反色（底色换成页面底、字与图标换成正文色），状态一眼可辨。 */
  .dock-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    height: 52px;
    border: 1px solid var(--text-primary);
    border-radius: 0;
    background: var(--text-primary);
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease;
    -webkit-tap-highlight-color: transparent;
  }

  .dock-dot {
    display: block;
    width: 5px;
    height: 5px;
    background: var(--bg);
    transition: background-color 0.2s ease;
  }

  .dock.is-open .dock-btn {
    background: var(--bg);
  }

  .dock.is-open .dock-dot {
    background: var(--text-primary);
  }
}
</style>
