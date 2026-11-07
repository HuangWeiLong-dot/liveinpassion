<script setup>
// 首页右侧的悬浮展示：LATEST ECHO / LATEST PHOTO / AUTHOR'S SELECTED。
//
// 数据是构建期快照（data/showcase.js），不在这里发请求。
// 三组内容：
//   · 最新 Echo：最新一篇已发布文章（Worker 里算好）
//   · 最新摄影：最新一张摄影照片所属的相册
//   · Selected：后台手动挑的条目，按保存顺序排，按每类 limit 截断（也在 Worker 里算好）
//
// 交互与动画：
//   · 桌面端固定在右侧。收起时面板宽度/高度收成右边缘一枚竖标签，
//     不是瞬间换 DOM —— 内容淡出、面板收窄、标签随后淡入；展开走反方向。
//   · 手机上底部横条始终在；INDEX 从底部升起一张抽屉（transform + 背景遮罩），
//     CLOSE / 点遮罩 / Esc 滑回去。抽屉 Teleport 到 body —— 面板自己有 transform，
//     fixed 子元素会被关进面板里。
//   · 收起状态记在 localStorage，刷新后保持（手机上不参与，横条一直在）。
//
// ⚠ 层级：面板 90、遮罩 94、抽屉 95 —— 都低于固定头部（100），
//   高于 Hero 的舞台。转场板子（90000）和方块光标（100000）仍然盖在上面。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useBrandOverlay } from '../composables/useBrandOverlay.js';
import { hasShowcase, showcaseData } from '../data/showcase.js';

const { entered } = useBrandOverlay();
const route = useRoute();

const collapsed = ref(false);
const open = ref(false);

try {
  collapsed.value = localStorage.getItem('homeShowcaseCollapsed') === '1';
} catch {
  // 隐私模式下 localStorage 可能不可用：当作默认展开
}

function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  if (collapsed.value) open.value = false;
  try {
    localStorage.setItem('homeShowcaseCollapsed', collapsed.value ? '1' : '0');
  } catch {}
}

function toggleOpen() {
  open.value = !open.value;
}

function closeSheet() {
  open.value = false;
}

// 抽屉打开后按 Esc 收起；点卡片跳走时也收起，否则 keep-alive 回到首页还是开着的
function onKeydown(event) {
  if (event.key === 'Escape' && open.value) open.value = false;
}

watch(
  () => route.fullPath,
  () => {
    open.value = false;
  }
);

onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));

const groups = computed(() => {
  if (!hasShowcase()) return [];
  return [
    {
      key: 'echo',
      label: 'LATEST ECHO',
      items: showcaseData.latestEcho ? [showcaseData.latestEcho] : [],
    },
    {
      key: 'photo',
      label: 'LATEST PHOTO',
      items: showcaseData.latestPhotography ? [showcaseData.latestPhotography] : [],
    },
    {
      key: 'selected',
      label: 'SELECTED',
      items: showcaseData.selected,
    },
  ].filter((group) => group.items.length);
});

const total = computed(() =>
  groups.value.reduce((sum, group) => sum + group.items.length, 0)
);

const totalLabel = computed(() => String(total.value).padStart(2, '0'));

function cardKey(group, item) {
  return `${group.key}:${item.refId}:${item.href}`;
}
</script>

<template>
  <aside
    v-if="total"
    class="home-showcase"
    :class="{
      'is-ready': entered,
      'is-collapsed': collapsed,
    }"
    aria-label="Curated showcase"
  >
    <div
      class="hs-content"
      :inert="collapsed || undefined"
      :aria-hidden="collapsed ? 'true' : undefined"
    >
      <!-- ⚠ 必须是 div，不能是 <header>：main.css 有一条全站
           `header { position: fixed; top: 0; z-index: 100 }`，写 header 会被钉在
           面板顶部（祖先有 transform，fixed 相对面板而不是视口），正文随之叠上来。 -->
      <div class="hs-head">
        <span class="hs-kicker">CURATED / {{ totalLabel }}</span>
        <span class="hs-actions">
          <button
            class="hs-btn hs-btn--index"
            type="button"
            :aria-expanded="open"
            @click="toggleOpen"
          >{{ open ? 'CLOSE' : 'INDEX' }}</button>
          <button
            class="hs-btn hs-btn--collapse"
            type="button"
            aria-label="Collapse showcase"
            @click="toggleCollapsed"
          >–</button>
        </span>
      </div>

      <div class="hs-body">
        <section v-for="group in groups" :key="group.key" class="hs-group">
          <h2 class="hs-group__title">
            <span>{{ group.label }}</span>
            <span class="hs-group__count">{{ String(group.items.length).padStart(2, '0') }}</span>
          </h2>

          <ul class="hs-list">
            <li v-for="item in group.items" :key="cardKey(group, item)">
              <router-link :to="item.href" class="hs-card">
                <span class="hs-card__media">
                  <img
                    v-if="item.image"
                    :src="item.image"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable="false"
                  >
                  <span v-else class="hs-card__noimg">NO IMAGE</span>
                </span>
                <span class="hs-card__text">
                  <span class="hs-card__meta">{{ item.meta }}</span>
                  <span class="hs-card__title">{{ item.title }}</span>
                </span>
              </router-link>
            </li>
          </ul>
        </section>
      </div>
    </div>

    <!-- 收起态：与内容叠在同一块面板里，靠透明度交叉淡入淡出 -->
    <button
      class="hs-tab"
      type="button"
      aria-label="Expand curated showcase"
      :inert="!collapsed || undefined"
      :aria-hidden="collapsed ? undefined : 'true'"
      @click="toggleCollapsed"
    >
      <span class="hs-tab__label">CURATED</span>
      <span class="hs-tab__mark">+</span>
    </button>
  </aside>

  <!-- 手机展开的抽屉。⚠ Teleport 到 body：面板自己有 transform，
       直接放进去的话 position:fixed 会以面板为包含块。 -->
  <Teleport to="body">
    <div
      class="hs-backdrop"
      :class="{ 'is-open': open }"
      aria-hidden="true"
      @click="closeSheet"
    ></div>

    <section
      class="hs-sheet"
      :class="{ 'is-open': open }"
      :inert="!open || undefined"
      :aria-hidden="open ? undefined : 'true'"
      aria-label="Curated showcase"
    >
      <div class="hs-sheet__inner">
        <div class="hs-sheet__head">
          <span class="hs-kicker">CURATED / {{ totalLabel }}</span>
          <button class="hs-btn" type="button" @click="closeSheet">CLOSE</button>
        </div>

        <div class="hs-sheet__body">
          <section v-for="group in groups" :key="group.key" class="hs-group">
            <h2 class="hs-group__title">
              <span>{{ group.label }}</span>
              <span class="hs-group__count">{{ String(group.items.length).padStart(2, '0') }}</span>
            </h2>

            <ul class="hs-list">
              <li v-for="item in group.items" :key="cardKey(group, item)">
                <router-link :to="item.href" class="hs-card" @click="closeSheet">
                  <span class="hs-card__media">
                    <img
                      v-if="item.image"
                      :src="item.image"
                      alt=""
                      loading="lazy"
                      decoding="async"
                      draggable="false"
                    >
                    <span v-else class="hs-card__noimg">NO IMAGE</span>
                  </span>
                  <span class="hs-card__text">
                    <span class="hs-card__meta">{{ item.meta }}</span>
                    <span class="hs-card__title">{{ item.title }}</span>
                  </span>
                </router-link>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.home-showcase {
  position: fixed;
  top: 50%;
  right: clamp(14px, 2.4vw, 34px);
  z-index: 90;
  width: clamp(264px, 20vw, 318px);
  max-height: min(72vh, 760px);
  display: flex;
  flex-direction: column;
  /* 收起动画靠裁切 + 宽高过渡：内容先淡出，面板再收窄 */
  overflow: hidden;
  /* 半透明底板 + 背景模糊：压在 Hero 的粒子和照片上也读得清，
     同时不把右侧画面完全切断 */
  background: color-mix(in srgb, var(--bg) 84%, transparent);
  -webkit-backdrop-filter: blur(16px) saturate(115%);
  backdrop-filter: blur(16px) saturate(115%);
  border: 1px solid color-mix(in srgb, var(--text-primary) 22%, transparent);
  color: var(--text-primary);
  /* 没揭开品牌遮罩前不出现 */
  opacity: 0;
  transform: translate(14px, -50%);
  transition:
    opacity 0.5s ease,
    transform 0.5s cubic-bezier(0.22, 0.61, 0.36, 1),
    width 0.42s cubic-bezier(0.22, 0.61, 0.36, 1),
    max-height 0.42s cubic-bezier(0.22, 0.61, 0.36, 1),
    background-color 0.3s ease,
    border-color 0.3s ease;
}

.home-showcase.is-ready {
  opacity: 1;
  transform: translate(0, -50%);
}

/* ---------- 展开的内容 ---------- */
.hs-content {
  display: flex;
  flex-direction: column;
  min-height: 0;
  transition: opacity 0.26s ease, transform 0.34s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.home-showcase.is-collapsed {
  width: 46px;
  max-height: 128px;
}

.home-showcase.is-collapsed .hs-content {
  opacity: 0;
  transform: translateX(18px);
  pointer-events: none;
  transition: opacity 0.16s ease, transform 0.16s ease;
}

/* ---------- 头部 ---------- */
.hs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--text-primary) 18%, transparent);
  flex-shrink: 0;
}

.hs-kicker {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.52rem;
  letter-spacing: 0.2em;
  color: var(--text-secondary);
  white-space: nowrap;
}

.hs-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.hs-btn {
  border: 1px solid color-mix(in srgb, var(--text-primary) 26%, transparent);
  background: transparent;
  color: var(--text-primary);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.5rem;
  letter-spacing: 0.16em;
  line-height: 1;
  padding: 6px 8px;
  cursor: pointer;
  transition: background-color 0.16s ease, color 0.16s ease;
}

.hs-btn:hover {
  background: var(--text-primary);
  color: var(--bg);
}

.hs-btn--index {
  display: none;
}

/* ---------- 列表 ---------- */
.hs-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px 14px 12px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--text-primary) 30%, transparent) transparent;
}

.hs-body::-webkit-scrollbar {
  width: 4px;
}

.hs-body::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--text-primary) 28%, transparent);
}

.hs-group {
  /* main.css 有一条全站 `section { width: 100% }`：不覆盖的话手机上每一组
     都会占满整条横向滚动区，一组只露出一张图。 */
  width: auto;
  padding-top: 12px;
}

.hs-group + .hs-group {
  margin-top: 4px;
}

.hs-group__title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.52rem;
  font-weight: 500;
  letter-spacing: 0.22em;
  color: var(--text-primary);
  padding-bottom: 6px;
  margin-bottom: 2px;
  border-bottom: 1px solid color-mix(in srgb, var(--text-primary) 60%, transparent);
}

.hs-group__count {
  color: var(--text-secondary);
  letter-spacing: 0.12em;
}

.hs-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.hs-card {
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr);
  align-items: center;
  gap: 11px;
  padding: 8px 6px 8px 0;
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 55%, transparent);
  transition: background-color 0.16s ease, padding-left 0.16s ease;
}

.hs-list li:last-child .hs-card {
  border-bottom: 0;
}

.hs-card:hover {
  background: color-mix(in srgb, var(--text-primary) 6%, transparent);
  padding-left: 6px;
}

.hs-card__media {
  display: block;
  width: 62px;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  background: var(--background-secondary);
  border: 1px solid color-mix(in srgb, var(--text-primary) 14%, transparent);
}

.hs-card__media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  filter: grayscale(1) contrast(1.02);
  transition: filter 0.25s ease, transform 0.35s ease;
}

/* 悬停才恢复颜色 —— 整块展示默认是黑白索引，指到哪一条哪一条亮起来 */
.hs-card:hover .hs-card__media img {
  filter: grayscale(0) contrast(1);
  transform: scale(1.04);
}

.hs-card__noimg {
  display: grid;
  place-items: center;
  height: 100%;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.42rem;
  letter-spacing: 0.14em;
  color: var(--text-secondary);
}

.hs-card__text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.hs-card__meta {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.46rem;
  letter-spacing: 0.16em;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hs-card__title {
  font-family: 'Oswald', sans-serif;
  font-weight: 600;
  font-size: 0.72rem;
  line-height: 1.2;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ---------- 收起态：与内容叠在一起的竖标签 ---------- */
.hs-tab {
  position: absolute;
  inset: 0;
  display: flex;
  /* 竖排书写时 inline 轴是纵向：row 才会让 CURATED 和 + 上下排 */
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  padding: 14px 0;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  writing-mode: vertical-rl;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.52rem;
  letter-spacing: 0.3em;
  opacity: 0;
  transform: translateX(8px);
  pointer-events: none;
  transition: opacity 0.2s ease, transform 0.3s ease, background-color 0.16s ease, color 0.16s ease;
}

.home-showcase.is-collapsed .hs-tab {
  opacity: 1;
  transform: none;
  pointer-events: auto;
  transition-delay: 0.14s, 0.14s, 0s, 0s;
}

.hs-tab__mark {
  font-size: 0.8rem;
  letter-spacing: 0;
  margin-top: 4px;
}

.hs-tab:hover {
  background: var(--text-primary);
  color: var(--bg);
}

/* ---------- 手机抽屉（Teleport 到 body） ---------- */
.hs-backdrop,
.hs-sheet {
  display: none;
}

@media (max-width: 1024px) {
  .home-showcase {
    top: auto;
    left: 12px;
    right: 12px;
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    width: auto;
    max-height: 46vh;
    transform: translateY(14px);
    /* 手机上不压太多模糊，性能优先 */
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
  }

  .home-showcase.is-ready {
    transform: translateY(0);
  }

  /* 手机上不参与"收起"：横条一直在，展开交给抽屉 */
  .home-showcase.is-collapsed {
    width: auto;
    max-height: 46vh;
  }

  .home-showcase.is-collapsed .hs-content {
    opacity: 1;
    transform: none;
    pointer-events: auto;
  }

  .hs-tab,
  .hs-btn--collapse {
    display: none;
  }

  /* 横条态：只露一行缩略图，不展开文字 */
  .hs-body {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 8px 12px 10px;
    scroll-snap-type: x proximity;
  }

  .hs-group {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding-top: 0;
    flex-shrink: 0;
  }

  .hs-group + .hs-group {
    margin-top: 0;
  }

  /* 横条里不放分组标题：竖排字会溢出到头部 */
  .hs-group__title {
    display: none;
  }

  .hs-group__count {
    display: none;
  }

  .hs-list {
    display: flex;
    gap: 8px;
  }

  .hs-card {
    grid-template-columns: 1fr;
    width: 74px;
    padding: 0;
    border-bottom: 0;
    gap: 0;
    scroll-snap-align: start;
  }

  .hs-card:hover {
    padding-left: 0;
  }

  .hs-card__media {
    width: 74px;
    aspect-ratio: 1 / 1;
  }

  .hs-card__text {
    display: none;
  }

  .hs-btn--index {
    display: inline-block;
  }

  /* 抽屉：从底部升起 */
  .hs-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 94;
    background: color-mix(in srgb, #000 46%, transparent);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.38s ease;
  }

  .hs-backdrop.is-open {
    opacity: 1;
    pointer-events: auto;
  }

  .hs-sheet {
    display: block;
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 95;
    transform: translateY(calc(100% + 20px));
    transition: transform 0.46s cubic-bezier(0.22, 0.61, 0.36, 1);
    pointer-events: none;
    will-change: transform;
  }

  .hs-sheet.is-open {
    transform: translateY(0);
    pointer-events: auto;
  }

  .hs-sheet__inner {
    width: 100%;
    max-width: 640px;
    margin: 0 auto;
    max-height: min(78dvh, 760px);
    display: flex;
    flex-direction: column;
    background: color-mix(in srgb, var(--bg) 96%, transparent);
    -webkit-backdrop-filter: blur(18px);
    backdrop-filter: blur(18px);
    border-top: 1px solid color-mix(in srgb, var(--text-primary) 35%, transparent);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    box-shadow: 0 -18px 60px rgba(0, 0, 0, 0.35);
  }

  .hs-sheet__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid color-mix(in srgb, var(--text-primary) 18%, transparent);
    flex-shrink: 0;
  }

  .hs-sheet__body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 2px 16px 16px;
  }

  /* 抽屉里的卡片恢复完整排版（外面横条的 .hs-card 覆盖只作用于横条） */
  .hs-sheet .hs-group {
    display: block;
    padding-top: 12px;
  }

  .hs-sheet .hs-group__title {
    display: flex;
    font-size: 0.52rem;
    letter-spacing: 0.22em;
    padding-bottom: 6px;
    margin-bottom: 2px;
    border-bottom: 1px solid color-mix(in srgb, var(--text-primary) 60%, transparent);
    justify-content: space-between;
  }

  .hs-sheet .hs-group__count {
    display: inline;
  }

  .hs-sheet .hs-list {
    display: block;
  }

  .hs-sheet .hs-card {
    grid-template-columns: 62px minmax(0, 1fr);
    width: auto;
    padding: 8px 6px 8px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--border-color) 55%, transparent);
    gap: 11px;
  }

  .hs-sheet .hs-card__media {
    width: 62px;
    aspect-ratio: 4 / 3;
  }

  .hs-sheet .hs-card__text {
    display: flex;
  }
}

@media (prefers-reduced-motion: reduce) {
  .home-showcase,
  .hs-content,
  .hs-tab,
  .hs-backdrop,
  .hs-sheet {
    transition: none;
  }
}
</style>
