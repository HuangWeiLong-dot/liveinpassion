<script setup>
// 博客「世界」视图 —— 参考 oumahi.art 的作品浏览方式：
//   · 封面沿一条虚拟圆柱排成一圈（CSS 3D：perspective + rotateY/translateZ，无 WebGL）
//   · 鼠标/触摸左右拖拽转动这圈世界，松手带一点惯性，空闲时极慢自转
//   · 点任意一件：世界压暗，展开一张大图 + 右侧信息栏（眉标 / 计数 / 标题 / 摘要 / 元信息）
//   · 展开层里 ← → 切换上下件，CLOSE 或 ESC 退出
//   · 底部一条编号胶片条（FILE 001…），点一下直接定位并展开
//
// 为什么不用 three/WebGL：这一页需要的是"能拖、能点、能聚焦"的封面墙。
// 43 张封面各是一个原生 <figure>/<img>，hover、键盘焦点、懒加载都由浏览器负责；
// 环的姿态只是父层的一次 rotateY，逐帧只写一个 transform，代价比 WebGL 小得多。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { scrollHorizontallyOnWheel } from '../composables/useWheelScroll.js';
import { attachCardTilt, playGlitchReveal } from '../composables/useCardFx.js';

const props = defineProps({
  posts: { type: Array, default: () => [] },
  // 页面是否处于激活状态（keep-alive 离开时暂停逐帧循环）
  active: { type: Boolean, default: true },
});
const emit = defineEmits(['open']);

// ── 环的几何 ────────────────────────────────────────────────────────────
// 每件的角度 = 360 / 件数；半径固定 1500px，配合 13.5vw 的卡片宽度，
// 相邻两件在弧上的间距刚好是一张卡片的宽度（环上的"缝"靠几何自己合上）。
const RADIUS = 1500;
const DRIFT = 0.02; // 空闲时每帧转的角度（约 1.2°/s）：慢到只是"活着"，不抢注意力
const N = computed(() => props.posts.length);
const STEP = computed(() => (N.value ? 360 / N.value : 0));

// 逐帧缓动都按「时间」而不是「帧」算：60Hz 下与原来的逐帧系数等价，
// 120Hz / 144Hz 上不会跑得比 60Hz 快一倍（原来 rot += Δ * 0.12 正是这个问题）。
const FRAME_REF = 16.6667;
const SNAP = 0.12;     // 目标角度的逼近系数（60Hz 基准）
const VEL_DECAY = 0.94; // 松手惯性的衰减系数（60Hz 基准）
const IDLE_STEP = 32;   // 空闲自转的更新间隔（ms）：约 30fps，省一半合成开销

const sceneRef = ref(null);
const worldRef = ref(null);
const stripRef = ref(null);
const mediaRef = ref(null);

// 世界当前的转角（度）。刻意不做成 ref：逐帧只写一个 style，不走 Vue 的响应式。
let rot = 0;
let vel = 0;
let desired = null;
let raf = 0;
let lastT = 0;
let lastPaint = 0;   // 空闲自转上一次写样式的时刻
let appliedRot = NaN; // 上一次写进 DOM 的角度：值没变就不再碰 transform
let dragging = false;
let dragX = 0;
let dragRot = 0;
let moved = 0;
let detachTilt = null;

const front = ref(0);
const expanded = ref(null);

const current = computed(() => (
  expanded.value == null ? null : props.posts[expanded.value] || null
));

// 编号统一三位：FILE 001。参考站也是这一套。
function padNo(i) {
  return String(i + 1).padStart(3, '0');
}

function pieceStyle(i) {
  return { transform: `rotateY(${i * STEP.value}deg) translateZ(${RADIUS}px)` };
}

// 封面 / 展开层大图解码完成：来一次抖色故障揭示，
// 接上"环上的小图 → 展开的大图"那一下（和 GALLERY 窗户同一种加载语言）
function onMediaLoad(e) {
  playGlitchReveal(e.target, e.target.closest('.bw-piece__frame, .bw-expand__media'));
}

function apply() {
  const world = worldRef.value;
  if (!world) return;
  // 角度没变就不写：展开层停住时原来每帧都写一次 transform，
  // 后面那层 backdrop-filter / filter 的模糊会跟着逐帧重算，读字时肉眼可见地掉帧。
  const v = Math.round(rot * 1000) / 1000;
  if (v === appliedRot) return;
  appliedRot = v;
  // 只转 Y 轴，不再给世界加 rotateX 的俯仰：一旦俯仰，环上的封面会被
  // 透视推到环心上下（前排下沉、后排上浮），和钉在环心的 LIVEINPASSION
  // 就不在同一条横带上了，字只能在卡片边缘切出几条缝来。
  world.style.transform = `rotateY(${-v}deg)`;
}

// 离屏幕正中最近的那一件（负数角度也归到 0..N-1）
function updateFront() {
  const n = N.value;
  if (!n || !STEP.value) return;
  const i = Math.round(rot / STEP.value);
  const k = ((i % n) + n) % n;
  if (k !== front.value) front.value = k;
}

// 把第 i 件转到正中：目标取"离当前转角最近的同相位角"，避免多转一整圈。
function faceIndex(i) {
  const step = STEP.value || 360;
  const want = i * step;
  const k = Math.round((rot - want) / 360);
  desired = want + k * 360;
}

function openPiece(i) {
  if (moved > 6) return; // 刚才是拖拽，不当作点击
  expanded.value = i;
  vel = 0;
  desired = null;
  faceIndex(i);
  startLoop(); // 展开层停稳后循环会自己停，这里确保它醒着把镜头转到这一件
  nextTick(() => {
    stripRef.value
      ?.querySelector('.bw-thumb.is-active')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  });
}

function closeExpanded() {
  if (expanded.value == null) return;
  expanded.value = null;
  startLoop(); // 展开时循环已停：收起后恢复空闲自转
}

function stepPiece(delta) {
  const n = N.value;
  if (!n) return;
  const base = expanded.value == null ? front.value : expanded.value;
  const i = ((base + delta) % n + n) % n;
  expanded.value = i;
  faceIndex(i);
  startLoop();
}

// 展开层里那张大图的摘要：正文是 CMS 给的 HTML，这里只取纯文本前 220 字。
function excerptOf(post) {
  if (!post) return '';
  if (post.__excerpt) return post.__excerpt;
  const div = document.createElement('div');
  div.innerHTML = post.body || '';
  const text = (div.textContent || '').replace(/\s+/g, ' ').trim();
  return text.length > 220 ? `${text.slice(0, 220).trim()} …` : text;
}
const excerpt = computed(() => excerptOf(current.value));

function readEntry() {
  if (!current.value) return;
  emit('open', current.value, mediaRef.value);
}

// ── 逐帧循环 ────────────────────────────────────────────────────────────
// 缓动全部按 dt 折算，60Hz 上与原来的系数一致，高刷屏上不会"跑得更快"。
function tick(dt) {
  const k = 1 - (1 - SNAP) ** (dt / FRAME_REF);
  const decay = VEL_DECAY ** (dt / FRAME_REF);
  if (dragging) {
    // 拖拽期间 rot 由指针位置直接写，这里只负责把「最靠前的一件」更新出来
    updateFront();
    return;
  }
  if (desired != null) {
    rot += (desired - rot) * k;
    if (Math.abs(desired - rot) < 0.05) {
      rot = desired;
      desired = null;
    }
  } else if (vel > 0.01 || vel < -0.01) {
    rot += vel * (dt / FRAME_REF);
    vel *= decay;
    if (Math.abs(vel) < 0.02) vel = 0;
  } else if (!expanded.value) {
    // 展开看信息时停转：文字在读，背景不该还在动
    rot += DRIFT * (dt / FRAME_REF);
  }
  updateFront();
}

function frame(t) {
  const dt = lastT ? Math.min(t - lastT, 50) : FRAME_REF;
  lastT = t;
  tick(dt);

  // 空闲自转：视觉速度不变，但每 ~30ms 才写一次样式，省下一半的合成开销
  if (!dragging && desired == null && vel === 0 && !expanded.value) {
    if (t - lastPaint >= IDLE_STEP) {
      lastPaint = t;
      apply();
    }
    raf = requestAnimationFrame(frame);
    return;
  }

  apply();

  // 展开层停稳之后不再需要逐帧循环（读字时那是一整屏模糊背景，
  // 每帧写 transform 会让那层 filter 反复重算）；关掉展开层时再唤醒。
  if (expanded.value != null && !dragging && desired == null && vel === 0) {
    raf = 0;
    return;
  }
  raf = requestAnimationFrame(frame);
}

function startLoop() {
  if (raf) return;
  lastT = 0;
  lastPaint = 0;
  raf = requestAnimationFrame(frame);
}

function stopLoop() {
  cancelAnimationFrame(raf);
  raf = 0;
  lastT = 0;
  lastPaint = 0;
  appliedRot = NaN; // 下一轮重新写一次，别因为"值没变"而跳过
}

// ── 拖拽 ────────────────────────────────────────────────────────────────
// 监听挂在 window 上而不是用 setPointerCapture：捕获会把指针事件改派给场景，
// 封面上的 click 就会被一起吞掉（"拖着能转、点着不开"）。
function onPointerDown(e) {
  if (expanded.value) return;
  if (e.button != null && e.button !== 0) return;
  dragging = true;
  moved = 0;
  dragX = e.clientX;
  dragRot = rot;
  vel = 0;
  desired = null;
  startLoop(); // 拖拽要靠帧循环把 rot 写进样式（不再每个 pointermove 写一次）
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}

function onPointerMove(e) {
  if (!dragging) return;
  const dx = e.clientX - dragX;
  moved = Math.max(moved, Math.abs(dx));
  rot = dragRot - dx * 0.28;
  vel = -dx * 0.1; // 松手那一刻的速度，帧循环里按时间衰减
}

function onPointerUp() {
  if (!dragging) return;
  dragging = false;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);
  // 拖拽结束后短暂保留 moved，让紧跟着的 click 被 openPiece 拦掉
  window.setTimeout(() => { moved = 0; }, 0);
}

function onWheel(e) {
  if (expanded.value) return;
  // 竖滚也当作转动世界：这页没有纵向滚动，滚轮不该是空操作
  const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? 300 : 1;
  rot += raw * unit * 0.12;
  vel = 0;
  desired = null;
  e.preventDefault();
  // 写样式交给帧循环：滚轮事件一帧里可能来好几个，逐事件写 transform 是白费
}

// ── 键盘 ────────────────────────────────────────────────────────────────
function onKeydown(e) {
  if (!expanded.value) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeExpanded();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    stepPiece(-1);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    stepPiece(1);
  }
}

function onVisibility() {
  if (document.hidden) stopLoop();
  else if (props.active) startLoop();
}

watch(() => props.active, (v) => {
  if (v && !document.hidden) startLoop();
  else stopLoop();
});

watch(() => props.posts.length, () => {
  rot = 0;
  vel = 0;
  desired = null;
  front.value = 0;
  expanded.value = null;
  apply();
});

onMounted(() => {
  apply();
  updateFront();
  if (props.active) startLoop();
  window.addEventListener('keydown', onKeydown);
  document.addEventListener('visibilitychange', onVisibility);
  detachTilt = attachCardTilt(worldRef.value, { card: '.bw-piece', maxX: 4, maxY: 8 });
});

onBeforeUnmount(() => {
  stopLoop();
  window.removeEventListener('keydown', onKeydown);
  document.removeEventListener('visibilitychange', onVisibility);
  detachTilt?.();
});
</script>

<template>
  <div class="bw-stage" :class="{ 'is-expanded': current }">
    <!-- 世界：一圈封面 + 中间一枚很淡的记号 -->
    <div
      class="bw-scene"
      ref="sceneRef"
      @pointerdown="onPointerDown"
      @wheel="onWheel"
    >
      <!-- 背景字：和首屏 Hero 那层 LIVEINPASSION 同一个字号/字距/浓度，
           不是招牌，是世界后面的一层底纹（放在环前面，才真的在"后面"）。 -->
      <div class="bw-wordmark" aria-hidden="true" data-word="LIVEINPASSION">LIVEINPASSION</div>

      <div class="bw-world" ref="worldRef">
        <figure
          v-for="(post, i) in posts"
          :key="post.slug"
          class="bw-piece"
          :class="{ 'is-front': i === front }"
          :style="pieceStyle(i)"
          @click="openPiece(i)"
        >
          <span class="bw-piece__frame">
            <img
              class="bw-piece__img"
              :src="post.image.src"
              :alt="post.title"
              loading="lazy"
              decoding="async"
              crossorigin="anonymous"
              draggable="false"
              @load="onMediaLoad"
            >
            <!-- 悬停时从底部滑出的标题条（参考站的 .tag） -->
            <span class="bw-piece__tag">{{ post.cardTitle }}</span>
            <span class="bw-piece__no">FILE {{ padNo(i) }}</span>
          </span>
        </figure>
      </div>
    </div>

    <!-- 这页的身份、条数与操作提示：全部排在右上角 VIEW 按钮的正下方，
         右对齐成一列，跟着那枚按钮一起成为"世界视图的说明栏" -->
    <div class="bw-head">
      <span class="bw-eyebrow">BLOGS — WORLD VIEW</span>
      <span class="bw-eyebrow bw-head__count">{{ padNo(N - 1) }} ENTRIES</span>
      <span class="bw-head__hint">DRAG · SCROLL · CLICK A PIECE</span>
    </div>

    <!-- 小屏：环在窄屏上挤成一团，改成一条纵向索引 -->
    <ul class="bw-mobile">
      <li v-for="(post, i) in posts" :key="post.slug">
        <button class="bw-mobile__row" type="button" @click="openPiece(i)">
          <span class="bw-mobile__no">{{ padNo(i) }}</span>
          <img :src="post.image.src" alt="" loading="lazy" decoding="async">
          <span class="bw-mobile__title">{{ post.cardTitle }}</span>
          <span class="bw-mobile__read">{{ post.readTime }}</span>
        </button>
      </li>
    </ul>

    <!-- 底部编号胶片条：快速定位到某一件 -->
    <div class="bw-strip" role="list" aria-label="Blog entries">
      <div class="bw-strip__row" ref="stripRef" @wheel="scrollHorizontallyOnWheel">
        <button
          v-for="(post, i) in posts"
          :key="post.slug"
          class="bw-thumb"
          :class="{ 'is-active': i === (current ? expanded : front) }"
          type="button"
          role="listitem"
          :aria-label="`FILE ${padNo(i)} — ${post.cardTitle}`"
          @click="openPiece(i)"
        >
          <img :src="post.image.src" alt="" loading="lazy" decoding="async" draggable="false">
          <span class="bw-thumb__no">{{ padNo(i) }}</span>
        </button>
      </div>
    </div>

    <!-- 展开层：大图 + 右侧信息栏（参考站的 expand 视图） -->
    <Transition name="bw-expand">
      <div v-if="current" class="bw-expand" @click.self="closeExpanded">
        <button class="bw-expand__close" type="button" @click="closeExpanded">CLOSE</button>
        <button
          class="bw-expand__nav is-prev"
          type="button"
          aria-label="Previous entry"
          @click="stepPiece(-1)"
        >‹</button>
        <button
          class="bw-expand__nav is-next"
          type="button"
          aria-label="Next entry"
          @click="stepPiece(1)"
        >›</button>

        <div class="bw-expand__grid">
          <figure class="bw-expand__media" ref="mediaRef">
            <img
              :src="current.image.src"
              :alt="current.title"
              decoding="async"
              crossorigin="anonymous"
              @load="onMediaLoad"
            >
            <figcaption class="bw-expand__file">
              <span>FILE {{ padNo(expanded) }}</span>
              <span>{{ current.readTime }}</span>
            </figcaption>
          </figure>

          <div class="bw-expand__text">
            <div class="bw-expand__eyebrow">
              <span class="bw-eyebrow">ENTRY — CLASS B</span>
              <span class="bw-eyebrow">{{ padNo(expanded) }} / {{ padNo(N - 1) }}</span>
            </div>
            <h2 class="bw-expand__title">{{ current.cardTitle }}</h2>
            <p class="bw-expand__para">{{ excerpt }}</p>

            <div class="bw-expand__meta">
              <span class="bw-expand__rule" aria-hidden="true"></span>
              <div class="bw-expand__row"><span>DATE</span><span>{{ current.date }}</span></div>
              <div class="bw-expand__row"><span>READ</span><span>{{ current.readTime }}</span></div>
              <div class="bw-expand__row"><span>TYPE</span><span>WRITTEN NOTE</span></div>
              <button class="bw-expand__read" type="button" @click="readEntry">
                READ ENTRY <span aria-hidden="true">→</span>
              </button>
              <button class="bw-expand__orbit" type="button" @click="closeExpanded">
                KEEP ORBITING
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* ── 舞台 ────────────────────────────────────────────────────────────── */
.bw-stage {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: var(--jb-bg, #0b0b0c);
  color: var(--jb-fg, #f2f2f2);
  font-family: 'Poppins', sans-serif;
  overflow: hidden;
  /* 顶部让开站点 header，底部留给胶片条 */
  padding: 76px 0 118px;
  box-sizing: border-box;
  /* 环上单件封面的尺寸：竖直构图（1.34 比例）。半径 1500px 时相邻两件
     在弧上正好隔开一张卡片的宽度，不会互相插进去。 */
  --bw-card-w: clamp(140px, 13.5vw, 210px);
  --bw-card-h: calc(var(--bw-card-w) * 1.34);
  /* 环心那条「字带」：所有封面的竖直中线都落在环心高度上，所以用一段
     以卡片中线为准的横向渐变，就能在屏幕上对齐成一条横带 —— 这条带里
     封面只让开一部分（留 58% 的照片本身），环心的 LIVEINPASSION 从这层
     半透里透出来：是"叠在一起"，不是把照片挖空。 */
  --bw-glass: linear-gradient(
    to bottom,
    #000 0%,
    #000 calc(50% - 96px),
    rgba(0, 0, 0, 0.58) calc(50% - 44px),
    rgba(0, 0, 0, 0.58) calc(50% + 44px),
    #000 calc(50% + 96px),
    #000 100%
  );
  --bw-card-bg: color-mix(in srgb, var(--jb-fg, #f2f2f2) 6%, var(--jb-bg, #0b0b0c));
}

/* ── 世界 ────────────────────────────────────────────────────────────── */
.bw-scene {
  position: absolute;
  inset: 0;
  perspective: 5200px;
  perspective-origin: 50% 50%;
  cursor: grab;
  touch-action: none;
  transition: filter 0.4s ease, opacity 0.4s ease;
  /* 背景字要和环上的封面共用一套 3D 空间（才能真的被前/后半圈挡住）；
     裁切交给 .bw-stage，这里一旦 overflow:hidden 就会把子层压成平面。 */
  transform-style: preserve-3d;
  overflow: visible;
}
.bw-scene:active {
  cursor: grabbing;
}
.bw-world {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
  transform-style: preserve-3d;
  will-change: transform;
}
.bw-piece {
  position: absolute;
  /* 卡片以环的中心为原点向外排（宽度的一半往左推，保证正中时对齐圆心） */
  left: calc(var(--bw-card-w) / -2);
  top: calc(var(--bw-card-h) / -2);
  width: var(--bw-card-w);
  height: var(--bw-card-h);
  margin: 0;
  transform-style: preserve-3d;
  backface-visibility: hidden;
  cursor: pointer;
}
.bw-piece__frame {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  /* 底色在字带里让开：照片本身已经按 58% 的不透明度叠在字上，
     底板再压一层就等于两层纱，字会被糊没；未加载时这里就是空的。 */
  background: linear-gradient(
    to bottom,
    var(--bw-card-bg) 0%,
    var(--bw-card-bg) calc(50% - 96px),
    transparent calc(50% - 44px),
    transparent calc(50% + 44px),
    var(--bw-card-bg) calc(50% + 96px),
    var(--bw-card-bg) 100%
  );
  border: 1px solid var(--jb-line, #26262a);
  /* 指针跟随的轻微倾斜：变量由 composables/useCardFx.js 写在 .bw-piece 上。
     父级 .bw-piece 本身带着环的 3D transform，这里只动里面的框。 */
  transform: rotateX(var(--fx-tilt-x, 0deg)) rotateY(var(--fx-tilt-y, 0deg));
  transition: border-color 0.25s ease, transform 0.3s ease;
}
.bw-piece__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  /* 参考站：静息时略去色、压暗，只有被指到的那一张才"亮"起来 */
  filter: grayscale(35%) contrast(1.05) brightness(0.9);
  /* 照片也在同一条字带上让开，否则封面虽然有了缝，图还是糊死在字前 */
  -webkit-mask-image: var(--bw-glass);
  mask-image: var(--bw-glass);
  transition: filter 0.35s ease, transform 0.5s cubic-bezier(0.19, 1, 0.22, 1);
}
/* 参考站的「描边」：8px 黑白交替的 marching-ants 虚线。
   平时完全透明，只压在正在聚焦（is-front）或被悬停的那一张上。 */
.bw-piece__frame::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background-image:
    linear-gradient(90deg, #000 50%, #fff 50%),
    linear-gradient(90deg, #000 50%, #fff 50%),
    linear-gradient(0deg, #000 50%, #fff 50%),
    linear-gradient(0deg, #000 50%, #fff 50%);
  background-repeat: repeat-x, repeat-x, repeat-y, repeat-y;
  background-size: 8px 1px, 8px 1px, 1px 8px, 1px 8px;
  background-position: 0 0, 0 100%, 0 0, 100% 0;
  /* 走到哪一帧由下面那两条（悬停 / 正面）决定 —— 动画只在这两张上跑，
     没被指到的封面不占任何逐帧重绘。 */
  opacity: 0;
  transition: opacity 0.2s ease;
}
@keyframes bw-ants {
  to {
    background-position: 8px 0, -8px 100%, 0 -8px, 100% 8px;
  }
}
.bw-piece__no {
  position: absolute;
  left: 10px;
  bottom: 8px;
  z-index: 3;
  font-family: 'Space Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.08em;
  color: #f2f2f2;
  mix-blend-mode: difference;
  transition: opacity 0.2s ease;
}
/* 悬停时底边升起一条渐变标题条，和参考站的 .tag 一样 */
.bw-piece__tag {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 3;
  padding: 18px 10px 8px;
  font-family: 'Space Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #f2f2f2;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.88), rgba(0, 0, 0, 0));
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.25s ease, transform 0.25s ease;
  pointer-events: none;
}
.bw-piece:hover .bw-piece__frame,
.bw-piece.is-front .bw-piece__frame {
  border-color: var(--jb-fg, #f2f2f2);
}
.bw-piece:hover .bw-piece__frame::after,
.bw-piece.is-front .bw-piece__frame::after {
  opacity: 1;
  animation: bw-ants 0.4s linear infinite;
}
.bw-piece:hover .bw-piece__img {
  filter: grayscale(0%) contrast(1.05) brightness(1);
  transform: scale(1.06);
}
.bw-piece.is-front .bw-piece__img {
  filter: grayscale(0%) contrast(1.05) brightness(1);
}
.bw-piece:hover .bw-piece__no {
  opacity: 0;
}
.bw-piece:hover .bw-piece__tag {
  opacity: 1;
  transform: translateY(0);
}

/* 背景字：和首屏 Hero 的 .hero-wordmark 完全同一套字号/字距/字重。
   位置钉在环的正中，并往屏幕深处推 1050px —— 前半圈封面在它前面、
   后半圈在它后面，转动时就有真正的遮挡层次，而不是一层贴死的字幕。 */
.bw-wordmark {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%) translateZ(-1050px);
  transform-style: preserve-3d;
  pointer-events: none;
  font-family: 'Oswald', sans-serif;
  font-weight: 700;
  font-size: min(10.5vw, 11rem);
  letter-spacing: 0.1em;
  white-space: nowrap;
  text-transform: uppercase;
  color: var(--jb-fg, #f2f2f2);
  /* 浓度跟主题走（BlogsView 里 --jb-wordmark 亮 0.16 / 暗 0.1），
     和首屏 Hero 那层字标同一档 */
  opacity: var(--jb-wordmark, 0.16);
}

/* 另两层淡影压在同一条 3D 轴上（一层更深、一层稍近），
   让字本身也有前后厚度；它们跟着环一起被前/后封面遮挡。 */
.bw-wordmark::before,
.bw-wordmark::after {
  content: attr(data-word);
  position: absolute;
  left: 50%;
  top: 50%;
  transform-style: preserve-3d;
  font: inherit;
  letter-spacing: inherit;
  white-space: nowrap;
  text-transform: inherit;
  pointer-events: none;
}
.bw-wordmark::before {
  transform: translate(-50%, -50%) translateZ(-260px);
  opacity: 0.45;
}
.bw-wordmark::after {
  transform: translate(-50%, -50%) translateZ(120px);
  opacity: 0.3;
}

/* ── 顶部信息 ────────────────────────────────────────────────────────── */
.bw-head {
  position: absolute;
  /* 落在右上角 VIEW 按钮（top:92 / 高约 34px）的正下方，
     右边缘与按钮对齐，三行说明右对齐成一列 */
  top: 140px;
  right: 64px;
  display: grid;
  justify-items: end;
  gap: 6px;
  text-align: right;
  pointer-events: none;
}
.bw-eyebrow {
  font-family: 'Space Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--jb-dim, #8a8a8f);
  white-space: nowrap;
}
.bw-head__count {
  color: var(--jb-faint, #4a4a4f);
}
.bw-head__hint {
  font-family: 'Space Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--jb-faint, #4a4a4f);
}

/* ── 底部胶片条 ──────────────────────────────────────────────────────── */
.bw-strip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 118px;
  border-top: 1px solid var(--jb-line, #26262a);
  background: var(--jb-bg, #0b0b0c);
  display: flex;
  align-items: center;
}
.bw-strip__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 56px;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.bw-strip__row::-webkit-scrollbar {
  display: none;
}
.bw-thumb {
  position: relative;
  flex: 0 0 auto;
  width: 62px;
  height: 82px;
  padding: 0;
  border: 1px solid var(--jb-line, #26262a);
  background: transparent;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.25s ease, transform 0.25s ease;
}
.bw-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  filter: brightness(0.55);
  transition: filter 0.25s ease;
}
.bw-thumb__no {
  position: absolute;
  left: 4px;
  bottom: 2px;
  font-family: 'Space Mono', ui-monospace, monospace;
  font-size: 8px;
  color: #f2f2f2;
  mix-blend-mode: difference;
}
.bw-thumb:hover,
.bw-thumb.is-active {
  border-color: var(--jb-fg, #f2f2f2);
  transform: translateY(-2px);
}
.bw-thumb:hover img,
.bw-thumb.is-active img {
  filter: brightness(1);
}

/* ── 展开层 ──────────────────────────────────────────────────────────── */
.bw-expand {
  position: absolute;
  inset: 0;
  z-index: 2;
  background: color-mix(in srgb, var(--jb-bg, #0b0b0c) 92%, transparent);
  backdrop-filter: blur(6px);
  display: flex;
  /* 居中交给 __grid 的 margin:auto（而不是 align-items:center）：
     内容比视口高时，auto 外边距会退化成 0，顶部不会被裁掉，
     多出来的部分整层滚动 —— 右栏自己那条内部滚动条也就没了。 */
  padding: 92px 64px 118px;
  box-sizing: border-box;
  overflow-y: auto;
}
.bw-stage.is-expanded .bw-scene {
  filter: brightness(0.45) blur(2px);
}
.bw-stage.is-expanded .bw-strip,
.bw-stage.is-expanded .bw-head {
  opacity: 0.3;
}
.bw-expand__close {
  position: absolute;
  top: 92px;
  right: 64px;
  z-index: 3;
  padding: 8px 14px;
  border: 1px solid var(--jb-line, #26262a);
  background: transparent;
  color: var(--jb-fg, #f2f2f2);
  font-family: 'Space Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  cursor: pointer;
  transition: border-color 0.25s ease, color 0.25s ease;
}
.bw-expand__close:hover {
  border-color: var(--jb-fg, #f2f2f2);
}
.bw-expand__nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 3;
  width: 44px;
  height: 44px;
  border: 1px solid var(--jb-line, #26262a);
  border-radius: 0;
  background: transparent;
  color: var(--jb-fg, #f2f2f2);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: border-color 0.25s ease;
}
.bw-expand__nav:hover {
  border-color: var(--jb-fg, #f2f2f2);
}
.bw-expand__nav.is-prev {
  left: 20px;
}
.bw-expand__nav.is-next {
  right: 20px;
}

.bw-expand__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
  gap: clamp(28px, 4vw, 72px);
  align-items: center;
  width: min(1360px, 100%);
  margin: auto;
}
/* 大图不再装进固定高度的框里：框跟着图走，图按自己的比例铺开。
   之前是 height:72vh + object-fit:contain，竖幅图左右、横幅图上下都会留出
   两条黑边。现在不设边框、不设底色、不设圆角，图就是图本身。 */
.bw-expand__media {
  position: relative;
  margin: 0;
  width: fit-content;
  max-width: 100%;
  justify-self: center;
  border: 0;
  border-radius: 0;
  background: none;
  overflow: visible;
}
.bw-expand__media img {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  /* 72vh 之外再扣掉展开层自己的上下留白（92 + 118），
     这样图永远装得进这一屏，整层就不会因为图太高而多出一条滚动条 */
  max-height: min(72vh, 760px, calc(100vh - 210px));
  object-fit: unset;
}
.bw-expand__file {
  position: absolute;
  left: 12px;
  bottom: 10px;
  display: flex;
  gap: 14px;
  font-family: 'Space Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: #f2f2f2;
  mix-blend-mode: difference;
}

/* 右栏不再是一块固定高度的滚动区：高度跟着内容走，
   不会在详情下方冒出第二条滚动条。 */
.bw-expand__text {
  min-width: 0;
}
.bw-expand__eyebrow {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--jb-line, #26262a);
}
.bw-expand__title {
  margin: 20px 0 0;
  font-size: clamp(30px, 3.4vw, 52px);
  line-height: 0.98;
  letter-spacing: -0.01em;
  font-weight: 600;
  text-transform: uppercase;
}
.bw-expand__para {
  margin: 18px 0 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--jb-dim, #8a8a8f);
}
.bw-expand__meta {
  margin-top: 26px;
  display: grid;
  gap: 10px;
}
.bw-expand__rule {
  display: block;
  height: 1px;
  background: var(--jb-line, #26262a);
  margin-bottom: 6px;
}
.bw-expand__row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  font-family: 'Space Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--jb-fg, #f2f2f2);
}
.bw-expand__row span:first-child {
  color: var(--jb-faint, #4a4a4f);
}
.bw-expand__read {
  margin-top: 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border: 1px solid var(--jb-fg, #f2f2f2);
  background: var(--jb-fg, #f2f2f2);
  color: var(--jb-bg, #0b0b0c);
  font-family: 'Space Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.12em;
  cursor: pointer;
  transition: background-color 0.25s ease, color 0.25s ease;
}
.bw-expand__read:hover {
  background: transparent;
  color: var(--jb-fg, #f2f2f2);
}
.bw-expand__orbit {
  justify-self: start;
  padding: 0;
  border: 0;
  background: none;
  color: var(--jb-dim, #8a8a8f);
  font-family: 'Space Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  cursor: pointer;
}
.bw-expand__orbit:hover {
  color: var(--jb-fg, #f2f2f2);
}

/* 展开/收起：整层淡入 + 内容轻微上移 */
.bw-expand-enter-active,
.bw-expand-leave-active {
  transition: opacity 0.32s ease;
}
.bw-expand-enter-active .bw-expand__grid,
.bw-expand-leave-active .bw-expand__grid {
  transition: transform 0.42s cubic-bezier(0.19, 1, 0.22, 1);
}
.bw-expand-enter-from,
.bw-expand-leave-to {
  opacity: 0;
}
.bw-expand-enter-from .bw-expand__grid,
.bw-expand-leave-to .bw-expand__grid {
  transform: translateY(14px);
}

/* ── 小屏索引 ────────────────────────────────────────────────────────── */
.bw-mobile {
  display: none;
  position: absolute;
  inset: 76px 0 0;
  margin: 0;
  padding: 0 20px 24px;
  list-style: none;
  overflow-y: auto;
}
.bw-mobile__row {
  display: grid;
  grid-template-columns: 42px 64px 1fr auto;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 0;
  border: 0;
  border-bottom: 1px solid var(--jb-line, #26262a);
  background: none;
  color: var(--jb-fg, #f2f2f2);
  text-align: left;
  cursor: pointer;
}
.bw-mobile__row img {
  width: 64px;
  height: 44px;
  object-fit: cover;
  display: block;
}
.bw-mobile__no,
.bw-mobile__read {
  font-family: 'Space Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--jb-dim, #8a8a8f);
}
.bw-mobile__title {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

@media (max-width: 900px) {
  .bw-stage {
    padding-bottom: 0;
  }
  .bw-scene,
  .bw-strip {
    display: none;
  }
  /* 小屏同样收在 VIEW 按钮下方（按钮在 78 / 高约 28），三行右对齐成一列 */
  .bw-head {
    top: 118px;
    right: 20px;
    gap: 4px;
  }
  .bw-head__hint {
    font-size: 8px;
    letter-spacing: 0.1em;
  }
  .bw-mobile {
    display: block;
  }
  .bw-expand {
    padding: 84px 20px 20px;
    align-items: flex-start;
    overflow-y: auto;
  }
  .bw-expand__close {
    top: 82px;
    right: 20px;
  }
  .bw-expand__nav {
    display: none;
  }
  .bw-expand__grid {
    grid-template-columns: 1fr;
    gap: 24px;
  }
  .bw-expand__media img {
    max-height: 46vh;
  }
}

@media (prefers-reduced-motion: reduce) {
  .bw-piece__frame,
  .bw-thumb {
    transition: none;
  }
  /* 虚线描边不再"走动"，只保留静态的边框 */
  .bw-piece:hover .bw-piece__frame::after,
  .bw-piece.is-front .bw-piece__frame::after {
    animation: none;
  }
}
</style>
