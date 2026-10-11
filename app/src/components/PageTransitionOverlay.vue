<script setup>
// 转场覆盖层：一块铺满整屏的板子 + 屏幕正中一行板块名。整条流程由**一条 GSAP
// 时间线**串起来，时长常量全部从 composables/usePageTransition.js 读。
//
//   ① 板子从随机一侧划进来（GSAP 的 x/y 位移），盖满整屏
//   ② 停住，正中那行字逐字亮（GSAP 的 stagger）
//   ③ 等新页面的 DOM 真的挂上（composable 的 waitForSwap）
//   ④ 板子往**另一个随机方向**滑走，露出新页面
//
// ── 这是一块**普通 DOM**，不是 View Transitions ────────────────────────
// 用 VT 的时候，板子永远压不过伪元素树（top layer），"划进来盖住旧页面"这件事
// 根本做不干净；而且 startViewTransition 每跳一次都要抓一张整页位图，
// 首页那种有 WebGL 画布 + 几十张图的页面，抓那一张就是点击后那一下卡顿。
// 现在：板子自己动，"盖住的是旧页面"靠路由守卫把导航推迟到板子盖满之后。
//
// ⚠ 这一层必须挂在 <body> 直下、z-index 压过一切（头部、灯箱、品牌遮罩都在它下面）。
// ⚠ 常规知识一条：**不要给这一层的祖先加 transform / filter**，那会造出新的
//   包含块，position: fixed 就不再相对视口定位了。它在 App.vue 里是挂在最外层的。
//
// ⚠ 底色与字的颜色都必须跟着主题走（var(--bg) / var(--text-primary)）：
//   站内深色主题的 --bg 是 #1A1A1A、浅色是 #FAFAFA。写死 #000 的话，
//   浅色主题下盖上去是"白 → 黑"的暴力翻转，深色下也比页面更黑一层。
//
// ⚠ 每个字各是一个 <span>：逐字亮必须靠**每个字一个 stagger**，
//   而文字层面没有"按字符做延迟"这种能力（letter-spacing 也没法只染其中几个字）。
//   拆字之后间距改成 flex gap —— 不能再靠 letter-spacing，否则每个 span 都各自
//   多出一份字距，整行会被撑开。
import { nextTick, ref, watch } from 'vue';
import gsap from 'gsap';
import {
  GLYPH_MS,
  HOLD_MS,
  IN_MS,
  isArmedRun,
  labelTiming,
  OUT_MS,
  swapVersion,
  transitionIn,
  transitionLabel,
  transitionOut,
  transitionRunId,
  waitForSwap,
} from '../composables/usePageTransition.js';

// 四个方向 → 单位向量。位移按**视口**的 112% 算（多出 12% 是为了板子整个出去，
// 不留一条边；纵向同理用 vh）。读时实时取 innerWidth/innerHeight，
// 旋转屏幕、改窗口大小都不用额外处理。
const DIRV = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
const offsetOf = (dir) => {
  const [x, y] = DIRV[dir] || DIRV.left;
  return { x: x * window.innerWidth * 1.12, y: y * window.innerHeight * 1.12 };
};

const panelRef = ref(null);
const textRef = ref(null);
// 有没有在演。false 时整层不渲染 —— 平时它完全不在 DOM 里：
// 既不挡灯箱 / 播放器 / 头部，也不参与命中测试。
const active = ref(false);

let tl = null;
let swapAtStart = 0;
let cancelled = 0;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** 这一次的 runId 还是不是当前那次（连点导航时前一次就此收摊） */
const current = (runId) => transitionRunId.value === runId && cancelled !== runId;

async function play(runId) {
  await nextTick();
  const el = panelRef.value;
  if (!el) return;

  swapAtStart = swapVersion.value;
  const glyphs = textRef.value ? Array.from(textRef.value.children) : [];
  const { step } = labelTiming(transitionLabel.value);
  const from = offsetOf(transitionIn.value);
  const to = offsetOf(transitionOut.value);

  // ── 一条时间线：划进来 → 停住 → 逐字亮 ──────────────────────────────
  // 板子的起点在屏幕外，第一帧就得在那儿（见下面 <style> 里的 .transition-panel
  // 基础 transform）；GSAP 的 set 只是把这个起点显式钉死，免得解析出别的值。
  if (tl) tl.kill();
  tl = gsap.timeline();
  tl.set(el, { x: from.x, y: from.y, opacity: 1 })
    .set(glyphs, { yPercent: 40 })
    .to(el, { x: 0, y: 0, duration: IN_MS / 1000, ease: 'power3.out' })
    // 缓动读起来要跟板子是一套：板子 ease-out 落定，字也是 ease-out 亮起来，
    // 最后一笔落下时正好接上退场。
    .to(glyphs, {
      opacity: 1,
      yPercent: 0,
      duration: GLYPH_MS / 1000,
      stagger: step / 1000,
      ease: 'power2.out',
    }, '>');

  await tl.then();
  if (!current(runId)) return;

  // ── 等新页面挂好再滑走（导航是在"字写完"那一刻才放行的）─────────────
  await waitForSwap(swapAtStart);
  if (!current(runId)) return;
  await wait(HOLD_MS);
  if (!current(runId)) return;

  // ── 滑走 ────────────────────────────────────────────────────────────
  // 缓动**不取 ease-in**：起步慢接在"停住"后面就是第二个停顿，整条流程读起来
  // 是三段。现在起步就有速度、中段最匀、收尾才减速，接在字后面是"接着走"。
  await gsap.to(el, { x: to.x, y: to.y, duration: OUT_MS / 1000, ease: 'power2.in' }).then();
  if (!current(runId)) return;

  active.value = false;
}

// flush: 'sync' —— watcher 必须**当场**跑：runId 是在路由守卫里加的，
// 那一刻 DOM 里还是旧页面，板子越早挂上去越好。
watch(transitionRunId, (runId) => {
  if (!runId) return;
  if (!isArmedRun(runId)) {
    // 取消信号（首页磁贴那条自己会演）：把板子收掉，别开演。
    // 分不清的话，取消信号会当场开演一场没有对手的转场。
    cancelled = runId;
    active.value = false;
    if (tl) tl.kill();
    return;
  }
  active.value = true;
  // play() 里每个 await 都有兜底（tl.then / waitForSwap 自带超时），不会永久挂起；
  // 这里再兜一层，免得将来有人往里加一句会抛的东西，把导航变成 unhandled rejection。
  play(runId).catch(() => {});
}, { flush: 'sync' });
</script>

<template>
  <div
    v-if="active"
    ref="panelRef"
    class="transition-panel"
    aria-hidden="true"
  >
    <div ref="textRef" class="transition-panel__text">
      <span
        v-for="(ch, i) in transitionLabel"
        :key="i"
        class="transition-panel__glyph"
        :class="{ 'is-space': ch === ' ' }"
      >{{ ch }}</span>
    </div>
  </div>
</template>

<style scoped>
/* 这一层是纯普通 DOM，所以可以用 scoped —— 用 View Transitions 的时候不行
   （::view-transition-* 挂在根上，scoped 会往选择器上加 [data-v-xxx]，一条都匹配不上）。 */
.transition-panel {
  position: fixed;
  /* 比视口四边各多 6px。这不是"防止分数像素露缝"那么讲究 —— 是**必须留够**：
     板子的位移是 GSAP 每帧写上去的，最后落地那一两帧可能还差 1~2px，
     只多 1px 的话刚好被吃掉，屏幕边上就真的露出一条亮线（实测过）。
     多留几像素没有任何副作用：居中那行字挂在 inset:0 的内层上，
     跟着板子一起居中，而板子四边是对称外扩的，中心点不变。 */
  inset: -6px;
  /* 压过一切：品牌遮罩 9999、灯箱 10000、主题按钮 10001。
     它不是"页面的一部分"，而是盖在整站（含所有悬浮件）之上的一层。 */
  z-index: 90000;
  /* ⚠ 必须关掉指针事件。开着的话，转场期间这层会吃掉所有点击和 hover；
     关掉之后连 :hover 都不会落在它身上 —— 也就顺手防住了一个坑：
     在动画元素上触发 hover 会**取消**该元素的 CSS 动画（规范行为）。 */
  pointer-events: none;
  background: var(--bg);
  /* ⚠ 基础态停在**屏幕外**：GSAP 第一帧才把真正的起点写上去，
     在那之前哪怕被画了一帧，也必须是看不见的（停在屏幕外 = 看不见）。
     方向由 GSAP 的 set 覆盖，这里的 -112vw 只是个"别露出来"的兜底。 */
  transform: translate3d(-112vw, 0, 0);
  opacity: 1;
  /* 整个流程都在动，直接让它独占一个合成层，主线程忙也不影响位移 */
  will-change: transform;
  backface-visibility: hidden;
}

/* 屏幕正中那行字 */
.transition-panel__text {
  position: absolute;
  inset: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  /* 间距走 flex gap，不能靠 letter-spacing：拆字之后每个 span 都会各自多出
     一份字距，整行会被撑开。 */
  gap: 0 0.06em;
  padding: 6vw;
  box-sizing: border-box;
  /* 与 var(--bg) 成对：深色底配浅字、浅色底配深字，跟着主题翻转。
     写死 #fff 的话浅色主题下就是"白底白字"，整行字看不见。 */
  color: var(--text-primary);
  font-family: 'Oswald', sans-serif;
  font-weight: 700;
  /* 长标题（"THE FIRE AND THE TRAP"）在窄屏上要能落到两行 ——
     clamp 按视口缩放，flex-wrap 负责折行，两者缺一不可 */
  font-size: clamp(1.35rem, 6.2vw, 4.6rem);
  letter-spacing: 0.06em;
  line-height: 1.14;
  text-align: center;
  user-select: none;
}

/* 每个字各是一个 span —— 逐字亮的 stagger 只能按元素给。
   ⚠ 基础 opacity 写 0：GSAP 那条时间线的第一个 tick 要等下一帧才跑，
   不写的话会先闪一帧整行字。 */
.transition-panel__glyph {
  display: inline-block;
  white-space: pre;
  opacity: 0;
  /* ⚠ 这里**故意不写** will-change：一行板块名拆出来二三十个 span，
     写上去就是二三十个独立合成层，显存和合成开销比省下来的还多。 */
}

/* ⚠ 空格必须单独处理。拆字之后它就是 `white-space: pre` 的一个 inline-block，
   而"只含空白"的 inline-block 在 flex 里宽度是 **0** ——
   "GROUP PHOTOS" 会渲染成 "GROUPPHOTOS"。
   （flex 本来就会吃掉子项之间的空白文本节点，所以这里连兜底都没有。）
   办法是让空格自己撑出一份宽度：宽度写死，不能靠内容。 */
.transition-panel__glyph.is-space {
  width: 0.42em;
}

/* 减少动态效果：JS 那边已经整段跳过了（守卫里直接 return true），
   这里再兜一层 —— 万一有别的路径把它插进 DOM，也不许动。 */
@media (prefers-reduced-motion: reduce) {
  .transition-panel {
    transition: none !important;
    animation: none !important;
  }
}
</style>
