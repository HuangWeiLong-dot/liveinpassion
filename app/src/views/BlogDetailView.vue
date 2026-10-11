<script setup>
// 博客详情：**左正文 / 右封面**。点列表里的一张卡 → 封面从那一格飞到右侧并完整铺开，
// 左侧的正文随后逐渐显现；退出时封面缩回列表里那一格。
//
// 版面与参照关系：
//   · 位置交接（封面从哪一格来）沿用列表那边交过来的矩形（composables/useCoverHandoff）。
//   · 时序语言照 tlb.betteroff.studio 实测的那三个常量（那套是运行时逆向出来的，
//     别凭手感改）：snappy 1s 主位移 / expo 1.15s 入场揭示 / power1 0.35s 交叉淡。
//   · ⚠ 它那种"左列三格、两侧半裁的卡片当翻篇控件"**已经按需求撤掉了** ——
//     详情页不再有可见的翻篇控件，只保留键盘 ←/→ 与触摸横滑。
//
// ── 为什么封面用 GSAP 手写 FLIP，而不是浏览器的共享元素 ──────────────────
// 起点在**另一个视图**里（列表那一格，元素早就没了），只能把起点矩形用
// sessionStorage 交接过来，然后 translate + scale 补间过去（不是补间
// width/height/left/top —— 后者每帧都要重排）。
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { blogPosts, blogBySlug } from '../data/blogPosts.js';
import { loadImage } from '../composables/useImageLoader.js';
import { readCoverHandoff, markReturningFromDetail } from '../composables/useCoverHandoff.js';
import { skipNextPageTransition } from '../composables/usePageTransition.js';

gsap.registerPlugin(CustomEase);

// snappy：参考站自定义的 CustomEase，path 直接抄过来（x=0.11 时已走完约 48%，很陡）
const EASE_MAIN = CustomEase.create(
  'bdSnappy',
  'M0,0 C0.094,0.026 0.124,0.127 0.157,0.29 0.197,0.486 0.254,0.8 0.348,0.884 0.42,0.949 0.374,1 1,1'
);
const T_MAIN = 0.9;    // 封面"飞过去/缩回去"的行程
const T_FADE = 0.35;   // 交叉淡（换篇）
// 左侧面板整体淡入 / 淡出。用户要求"渐隐渐入看得见"，这两档比原来放宽了：
// 入场 0.4 → 0.55（和底色那一趟同拍，见 toPageBg）、退场 0.7 → 0.8（仍短于 T_MAIN
// 那一趟飞行，面板先淡干净、封面才落地）。
const T_PANEL = 0.55;
const T_PANEL_OUT = 0.8;
// 封面那段主位移用**参考站那条 snappy**：起步就快、后面收得干净。
// （之前写的是 power2.inOut —— 起步很慢，读起来就是"顿一下才动"，是"生硬"的主要来源之一。
//   用户要的就是参考站那种"一口气滑过去"的手感。）
const EASE_TRAVEL = EASE_MAIN;
// ⚠ 这几拍全部**叠在飞行途中**发生，中间不留空：
//   封面上路 0 → 面板 0.16s 开始淡入 → 0.34s 开始打字 → 幕 0.4s 撤
//   各拍之间留空、或等封面停稳再出场，都会读成"一顿、然后又一顿"。
const PANEL_AT = 0.16;
const TYPE_AT = 0.34;
const CURTAIN_AT = 0.4;

const route = useRoute();
const router = useRouter();

const panelRef = ref(null);
const scrollRef = ref(null);
const bodyRef = ref(null);
const infoRef = ref(null);
const titleRef = ref(null);
const outRef = ref(null);
const coverWrapRef = ref(null);

// 现查而不是 ref：封面元素在换篇时会被 :key 重建（见 loadFeatured 的注释）
const coverMediaEl = () => coverWrapRef.value?.querySelector('.bd-media') || null;
const coverInnerEl = () => coverWrapRef.value?.querySelector('.bd-media__inner') || null;

// 封面盒子的比例 = 图自身的比例（盒子的高度是 aspect-ratio 撑的）。
// 解码前先给个 4/5 兜底，免得盒子塌成 0。
const ratio = ref('4 / 5');

const post = computed(() => blogBySlug[route.params.slug] || null);
const index = computed(() => blogPosts.findIndex((p) => p.slug === route.params.slug));
const prevPost = computed(() => (index.value > 0 ? blogPosts[index.value - 1] : null));
const nextPost = computed(() => (
  index.value >= 0 && index.value < blogPosts.length - 1 ? blogPosts[index.value + 1] : null
));

let handoff = null;
let timeline = null;
let leaving = false;
let touchStartPt = null;
// ⚠ keep-alive 组件**首次挂载时 onMounted 与 onActivated 会各触发一次**，
// 不设防的话 scheduleEnter 会跑两遍、入场动画就播两遍（图片加载失败时两遍的时序
// 还会错开，表现成"正文先出来、alt 飞过去、再触发一次动画"）。
let enterArmed = false;
let enterFallback = 0; // 题图解码兜底（见 scheduleEnter）：退场时要掐掉
const switching = ref(false);
const outgoing = ref(null);   // { post, scrollTop } —— 换篇期间旧正文的替身（两段才能真的交叉淡）

const reducedMotion = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── 窄屏：封面收进左侧抽屉 ──────────────────────────────────────────────
// 断点和移动版外壳（MobileDock）一致。窄屏上进详情**先给完整的正文**，
// 封面挪到左边缘那条抽屉里，点把手 / 往右拖才拉出来。
// 桌面那套"左正文右封面 + 封面从列表飞过来"一行不动 —— 这里只走窄屏这一支。
const narrowMql = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(max-width: 1024px)')
  : null;
const isNarrow = ref(narrowMql ? narrowMql.matches : false);
function syncNarrow(e) {
  isNarrow.value = e.matches;
}

const detailRef = ref(null);      // 挂 --cover-open 的那一层
const drawerRef = ref(null);      // .bd-right：窄屏下它就是抽屉本体
const open = ref(false);          // 抽屉是不是开着（0/1 那档由 CSS 给）
// 拖动中：直接写 --cover-open（0~1 的连续值），松手再交回 CSS 的 0/1。
// 用一个变量同时驱动抽屉和把手（把手要跟着抽屉的右沿走），中途不会有先后差。
let drag = null;
let suppressClick = false;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function writeShift(v) {
  detailRef.value?.style.setProperty('--cover-open', String(v));
}

function setOpen(next) {
  open.value = next;
  // 交回 CSS：类是 0/1 的唯一来源，行内那个连续值只在拖动期间存在
  detailRef.value?.style.removeProperty('--cover-open');
}

function toggleCover() {
  setOpen(!open.value);
}

// 把手上按下去：记起点，之后的位移换算成 --cover-open
function onDragDown(e) {
  if (!isNarrow.value) return;
  const w = drawerRef.value?.offsetWidth || 1;
  drag = { x0: e.clientX, v0: open.value ? 1 : 0, w, t0: performance.now(), moved: false, dir: 1 };
  detailRef.value?.classList.add('is-cover-dragging');
  e.currentTarget.setPointerCapture?.(e.pointerId);
}

// 抽屉上按下去：只能往左拖（收回去），dir = -1
function onDrawerDown(e) {
  if (!isNarrow.value || !open.value) return;
  const w = drawerRef.value?.offsetWidth || 1;
  drag = { x0: e.clientX, v0: 1, w, t0: performance.now(), moved: false, dir: -1 };
  detailRef.value?.classList.add('is-cover-dragging');
  e.currentTarget.setPointerCapture?.(e.pointerId);
}

function onDragMove(e) {
  if (!drag) return;
  const dx = (e.clientX - drag.x0) * drag.dir;
  if (Math.abs(dx) > 6) drag.moved = true;
  if (drag.dir < 0 && dx > 0) { writeShift(1); return; }  // 关着的时候往右拖不动
  writeShift(clamp01(drag.v0 + dx / drag.w));
}

function onDragUp(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  detailRef.value?.classList.remove('is-cover-dragging');
  if (!d.moved) {
    // 没动过 = 点了一下把手：切换开合（click 会被 suppressClick 吃掉）
    suppressClick = true;
    setOpen(!open.value);
    return;
  }
  const dx = (e.clientX - d.x0) * d.dir;
  const vel = dx / Math.max(1, performance.now() - d.t0);  // px/ms
  const v = clamp01(d.v0 + dx / d.w);
  // 拖过 40% 或者甩得够快就按拖的方向定
  setOpen(vel > 0.5 ? true : vel < -0.5 ? false : v > 0.4);
}

function onHandleClick() {
  // 拖动结束后的那一次 click 要丢掉，否则刚拖开又被切成关
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  toggleCover();
}

// ── 图片 ────────────────────────────────────────────────────────────────
// 封面**只用压缩图**（data-src），不拉原图。
//
// 之前这里是"先压缩图、再静默升级成原图"（沿用旧版详情页"这张才是原图"的设定）。
// 那条路在真实网络下很糟：列表卡片从来只拉压缩图，原图（fullSrc）是**另一个 URL**，
// 详情一打开就得冷启动下载一张原图 —— 24 篇里有 9 篇是 PNG，原图动辄十几 MB，
// 表现就是"封面半天出不来"，而同一张图的卡片在列表里是早就缓存好的、秒出。
//
// 而新版面里封面最宽也就右列那点宽度（1440 视口下 478px，即使 4K 宽屏也就 ~1460px），
// 压缩图是 1920px 宽 —— 超采样 3～4 倍，换成原图在屏幕上**看不出区别**，
// 纯粹是多花几十倍字节。所以这里就停在压缩图上（也就是列表缓存里那张，基本是瞬时的）。
// 真要用原图：把 :data-full-src 改成 loadImage 的取值来源即可（img 上两个属性都还在）。
// 比例要和"当前这一篇的图"绑定，而且要跟着**每一次 load** 走：
//   · 换篇时 <img> 是按 :key 重建的，旧元素的 load 还可能晚到，所以每次都要
//     先确认"这仍然是当前这篇的图"，否则它会把上一张的比例写进新一篇
//     （实测到过：盒子按上一张 664×1000 的比例撑，图却是 794×1000）。
// 监听只挂一次、且不加 once：同一张图后面还可能因为别的 src 变更再 load。
function syncRatio(img) {
  const want = post.value?.image?.src;
  if (!img || !want) return;
  const apply = () => {
    if (!img.isConnected || img.dataset.src !== want) return;
    if (img.naturalWidth && img.naturalHeight) {
      ratio.value = `${img.naturalWidth} / ${img.naturalHeight}`;
    }
  };
  if (img.dataset.bdRatioBound !== '1') {
    img.dataset.bdRatioBound = '1';
    img.addEventListener('load', apply);
  }
  apply();
}

function loadFeatured() {
  const img = coverMediaEl()?.querySelector('img');
  if (!img) return;
  syncRatio(img);
  // 封面加载失败时，别让 alt 文字（以及 loadImage 塞进来的 "Loading Failed"）
  // 跟着一起飞过去：把图藏掉、把那段提示清掉，盒子留空就行 ——
  // 飞行本身照常发生，出场顺序（卡先过去、字再落）也就不会乱。
  // ⚠ 清理要放到下一帧：loadImage 的 onerror 是在我这条之后才注册的，
  // 同一轮事件里先清、后加，等于没清。
  img.addEventListener('error', () => {
    img.style.display = 'none';
    requestAnimationFrame(() => {
      coverMediaEl()?.querySelectorAll('.load-error-msg').forEach((n) => n.remove());
    });
  }, { once: true });
  loadImage(img);
}

// ── 终点尺寸 ────────────────────────────────────────────────────────────
// 媒体盒是 `width: 100%; aspect-ratio: <图的比例>; max-height: 100%`，所以解码完
// 之后直接量这个盒子就是终点 —— 不用旧版那套"按 naturalWidth 反算可用区域"的数学，
// 而且更准：盒子的比例本来就是图的比例。
function coverBox() {
  const el = coverMediaEl();
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

// 等题图解码的那几帧里，先把封面摆到**起点**（列表里那一格）并**直接显示**：
//   · 按 CSS 的最终位置摆着会先在终点闪一帧；
//   · 摆成透明的话用户看到的是"卡片先没了、再淡出来"—— 那正是这次要消掉的渐隐。
// 摆在起点、亮着，读起来才是"卡片一直在那儿，只是后来飞走了"。
function stageCover() {
  const inner = coverInnerEl();
  if (!inner) return;
  const from = handoff?.rect || coverBox();
  if (!from) return;
  inner.classList.add('is-measuring');
  gsap.set(inner, {
    position: 'fixed', left: 0, top: 0, right: 'auto', bottom: 'auto', margin: 0,
    transformOrigin: '0 0', width: from.width, height: from.height,
    x: from.left, y: from.top, opacity: 1,
  });
  const img = inner.querySelector('img');
  if (img) gsap.set(img, { width: from.width, height: from.height, maxWidth: 'none', maxHeight: 'none' });
}

// ── 底层底色：交接这段时间别让整屏亮/暗一档 ──────────────────────────────
// 列表页的底色比站点默认更深（BlogsView 里的 --jb-bg：暗色 #0b0b0c / 亮色 #fafafa），
// 而这一页的底色是站点的 --bg（暗色 #1A1A1A / 亮色 #FAFAFA）。覆盖层本身透明，
// 所以换页那一帧整屏会**亮一档（进）/ 暗一档（回）** —— 暗色主题下很明显。
// 做法：覆盖层自己顶着"列表那一页的底色"起步（第一帧就得是它），再平滑走到本页底色；
// 退出时反向走回去，走完正好和列表同色，切回去那一帧就看不出底色变过。
// 亮色主题下这两档本来就相同，等于什么都没做。
//
// ⚠ 颜色**现场读**：起点来自 BlogsView 交接过来的 .jb-stage 计算值，
//   终点取 .bd-panel 的计算值（它就是 var(--bg)）—— 都不把色值抄进 JS。
function pageBg() {
  const panel = panelRef.value;
  if (!panel) return null;
  const c = getComputedStyle(panel).backgroundColor;
  return c && c !== 'rgba(0, 0, 0, 0)' ? c : null;
}

let stageBgTween = null;

/** 第一帧就把覆盖层按到"列表那一页的底色"上（没有交接数据 = 直接开链接，保持透明）。 */
function pinStageBg() {
  stageBgTween?.kill();
  stageBgTween = null;
  if (!detailRef.value) return;
  if (handoff?.stageBg) gsap.set(detailRef.value, { backgroundColor: handoff.stageBg });
  else gsap.set(detailRef.value, { clearProps: 'backgroundColor' });
}

/** 走到本页自己的底色（入场）。`at` 与面板淡入同拍。 */
function toPageBg(duration, at = 0) {
  const to = pageBg();
  if (!handoff?.stageBg || !detailRef.value || !to) return;
  stageBgTween?.kill();
  stageBgTween = gsap.to(detailRef.value, {
    backgroundColor: to,
    duration: reducedMotion ? 0 : duration,
    delay: reducedMotion ? 0 : at,
    ease: 'power1',
  });
}

/** 走回列表那一页的底色（退场）：走完这一趟，覆盖层和列表同色。 */
function toStageBg(duration) {
  const from = handoff?.stageBg;
  if (!from || !detailRef.value) return;
  stageBgTween?.kill();
  stageBgTween = gsap.to(detailRef.value, {
    backgroundColor: from, duration: reducedMotion ? 0 : duration, ease: 'power1',
  });
}

// ── 打字机 ──────────────────────────────────────────────────────────────
// 左侧的文字逐个"敲"出来，带一个跟着走的光标。
//
// 为什么是"把字符包成 span、再逐个点亮"，而不是逐帧改 textContent：
// 后者每加一个字，这一行后面的字都要往右挪 —— 打到行尾时整段都在抖。
// 包成 span 之后，**版面从第一帧就是最终状态**，被"敲"出来的只是可见性，
// 一个像素都不会动。
//
// 顺带解决了"文字出现两次"：之前是"面板整体淡入"和"每行再各淡一次"两套叠着演，
// 读起来就是同一段文字亮了两次。现在只有一套 —— 容器亮一次（0.25s），
// 字一个个敲出来，图跟着它所在的块出现。
const TW_MIN = 70;      // 字符/秒（下限：短文也别慢悠悠）
const TW_MAX = 260;     // 上限：长文快打成一片，别让人等
const TW_TARGET = 3.2;  // 目标总时长（秒），据此反推速度
const caretRef = ref(null);
const typing = ref(false);
let typeTimer = 0;
let typeSafety = 0;
let infoSafety = 0; // 入场没跑到打字那一步时的兜底（见 scheduleEnter）

function stopTyping() {
  if (typeTimer) {
    clearInterval(typeTimer);
    typeTimer = 0;
  }
  typing.value = false;
}

// 把 root 里的文本节点按字符拆成一堆 span（空白照原样留成文本节点，不占节奏）
function wrapTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue && n.nodeValue.trim()
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  const chars = [];
  nodes.forEach((node) => {
    const frag = document.createDocumentFragment();
    for (const ch of String(node.nodeValue)) {
      if (/\s/.test(ch)) {
        frag.appendChild(document.createTextNode(ch));
        continue;
      }
      const span = document.createElement('span');
      span.className = 'tw-ch';
      span.textContent = ch;
      frag.appendChild(span);
      chars.push(span);
    }
    node.parentNode.replaceChild(frag, node);
  });
  return chars;
}

// ── 右侧封面：跟着鼠标倾斜（3D 卡片）────────────────────────────────────
// 用 GSAP 的 quickTo 直接写 rotationX / rotationY：它自己管补间与合成，比手写
// rAF 插值省事，而且和 FLIP 那段用的是同一套 transform 机制，不会互相打架。
//
// ⚠ 只在"封面已经就位"的时段开着：入场/退场那两段，封面的内层是 position: fixed
//   （视口坐标系，靠这个才不被 .bd-media 的 overflow 裁掉）。而**父元素一旦有
//   transform，就会成为 fixed 后代的包含块** —— 倾斜的角度会让飞行中的封面
//   重新被裁、位置也偏。所以起飞前先 disableTilt()，落定后再 enableTilt()。
const TILT_MAX_Y = 9; // 左右倾角（deg）
const TILT_MAX_X = 6; // 上下倾角（deg）
let tiltEl = null;
let tiltX = null;
let tiltY = null;
let tiltReady = false;

function disableTilt() {
  tiltReady = false;
  if (tiltEl) gsap.set(tiltEl, { clearProps: 'transform' });
  tiltEl = null;
  tiltX = null;
  tiltY = null;
}

function enableTilt() {
  tiltReady = true;
}

function onTiltMove(e) {
  if (!tiltReady || reducedMotion || e.pointerType === 'touch') return;
  const media = coverMediaEl();
  if (!media) return;
  if (media !== tiltEl) {
    tiltEl = media;
    gsap.set(media, { transformPerspective: 1000, transformOrigin: '50% 50%' });
    tiltX = gsap.quickTo(media, 'rotationX', { duration: 0.5, ease: 'power2.out' });
    tiltY = gsap.quickTo(media, 'rotationY', { duration: 0.5, ease: 'power2.out' });
  }
  const r = media.getBoundingClientRect();
  if (!r.width || !r.height) return;
  // 相对卡片中心归一化；超出卡片范围也继续加角度，但夹到 1.5 倍封顶
  const nx = Math.max(-1.5, Math.min(1.5, ((e.clientX - r.left) / r.width - 0.5) * 2));
  const ny = Math.max(-1.5, Math.min(1.5, ((e.clientY - r.top) / r.height - 0.5) * 2));
  tiltY(nx * TILT_MAX_Y);
  tiltX(-ny * TILT_MAX_X);
}

function onTiltLeave() {
  tiltX?.(0);
  tiltY?.(0);
}

// 光标：贴着"刚敲出来的那个字"的右上角。用 fixed + 视口坐标，字滚出面板就藏起来。
function moveCaret(el) {
  const caret = caretRef.value;
  if (!caret || !el) return;
  const r = el.getBoundingClientRect();
  const panel = panelRef.value?.getBoundingClientRect();
  if (!panel || r.bottom < panel.top || r.top > panel.bottom) {
    caret.style.visibility = 'hidden';
    return;
  }
  caret.style.visibility = '';
  caret.style.height = `${Math.round(r.height)}px`;
  caret.style.transform = `translate3d(${Math.round(r.right)}px, ${Math.round(r.top)}px, 0)`;
}

function startTyping() {
  stopTyping();
  const title = titleRef.value;
  const body = bodyRef.value;
  const info = infoRef.value;
  if (!title || !body || !info) return;

  info.classList.add('is-typing'); // 正文各块先整块藏着，打到它才放出来（图不会抢跑）
  const stream = [...wrapTextNodes(title), ...wrapTextNodes(body)];
  if (!stream.length) {
    info.classList.remove('is-typing');
    return;
  }
  // 每一块的第一个字符在流里的位置 —— 打到那儿就把整块（含图）放出来
  const blocks = [...body.children]
    .map((el) => ({ el, at: stream.indexOf(el.querySelector('.tw-ch')) }))
    .filter((b) => b.at >= 0)
    .sort((a, b) => a.at - b.at);

  const revealAll = () => {
    stream.forEach((c) => c.classList.add('is-on'));
    blocks.forEach((b) => b.el.classList.add('is-on'));
    info.classList.remove('is-typing');
  };

  if (reducedMotion) {
    revealAll();
    gsap.set(info, { opacity: 1 });
    return;
  }

  const rate = Math.min(TW_MAX, Math.max(TW_MIN, stream.length / TW_TARGET));
  let i = 0;
  let bi = 0;
  typing.value = true;
  // 容器只亮这一次（0.25s）—— 之前"整块淡入 + 逐行淡入"两套叠着演，就是"闪两次"的来源
  gsap.fromTo(info, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power1', overwrite: true });
  typeTimer = window.setInterval(() => {
    const step = Math.max(1, Math.round(rate / 60));
    for (let k = 0; k < step && i < stream.length; k += 1, i += 1) stream[i].classList.add('is-on');
    while (bi < blocks.length && blocks[bi].at <= i) {
      blocks[bi].el.classList.add('is-on');
      bi += 1;
    }
    moveCaret(stream[Math.min(i, stream.length) - 1]);
    if (i >= stream.length) {
      revealAll();
      stopTyping();
    }
  }, 16);

  // 兜底：万一这套没跑起来（异常 / 被打断），2.5s 后把文字全放出来，别留一页空白
  clearTimeout(typeSafety);
  typeSafety = window.setTimeout(() => {
    if (!typing.value) {
      revealAll();
      gsap.set(info, { opacity: 1 });
    }
  }, 2500);
}

// ── 进入 ────────────────────────────────────────────────────────────────
// 封面：起点 = 列表里那一格的屏幕矩形，终点 = 右列那个媒体盒；translate + scale、
// origin 左上。左侧正文则是**逐渐显现**：整块淡入 + 标题逐词 + 正文逐段。
function playEnter() {
  const inner = coverInnerEl();
  const panel = panelRef.value;
  if (!inner || !panel) return;

  // 窄屏：封面在左侧抽屉里（屏幕外），没有"飞到右列"这回事。
  // 按用户定的顺序 —— 先把正文给全，封面在抽屉里待命，由手势去拉。
  if (isNarrow.value) {
    timeline?.kill();
    disableTilt();
    toPageBg(T_PANEL, 0); // 窄屏没有飞行，底色跟着面板一起立刻走完（见 pageBg 那段注释）
    gsap.set(inner, { opacity: 1 });
    gsap.set(panel, { opacity: 1 });
    document.documentElement.classList.remove('bd-taking-cover');
    document.querySelector('.jb-card.is-flying')?.classList.remove('is-flying');
    startTyping();
    return;
  }

  timeline?.kill();
  disableTilt(); // 起飞前先把倾斜摘掉（见 disableTilt 的注释：transform 会把 fixed 内层拉回来）
  // 底色和面板淡入同拍（面板一到位，左右两半就都是本页底色了）
  toPageBg(T_PANEL, PANEL_AT);
  const box = coverBox();
  const from = handoff?.rect || box;
  if (!from) {
    // 量不到任何尺寸（理论上到不了）：不做 FLIP，但**不能就这么 return** ——
    // 封面的 CSS 初值是 opacity: 0，直接返回会让它一直看不见。
    gsap.set(inner, { opacity: 1 });
    gsap.set(panel, { opacity: 1 });
    startTyping();
    return;
  }
  const dest = box || from; // 量不到终点就原地不动，别让补间拿到 null
  const img = inner.querySelector('img');

  inner.classList.remove('is-measuring');
  inner.classList.add('is-flipping');
  // ⚠ 整段**不做淡入淡出**（opacity 一直是 1）：要的就是"这张图一直在，
  // 只是从这一格长到那一格"。见文件头对过渡的描述。
  gsap.set(inner, {
    position: 'fixed', left: 0, top: 0, right: 'auto', bottom: 'auto', margin: 0,
    transformOrigin: '0 0', width: from.width, height: from.height,
    x: from.left, y: from.top, opacity: 1,
  });
  if (img) gsap.set(img, { width: from.width, height: from.height, maxWidth: 'none', maxHeight: 'none' });

  timeline = gsap.timeline({ defaults: { ease: EASE_MAIN } });

  // 封面：尺寸 + 位置一起补间。收尾必须清行内样式并摘掉 .is-flipping，
  // 否则容器会永远停在"起点那张卡片的尺寸"上（框比例不对 = "渲染比例和原图不一致"）。
  timeline.to(inner, {
    width: dest.width, height: dest.height, x: dest.left, y: dest.top,
    duration: reducedMotion ? 0 : T_MAIN,
    ease: EASE_TRAVEL, // 这一段要缓入缓出（见 EASE_TRAVEL 的注释）
    onComplete: () => {
      inner.classList.remove('is-flipping');
      gsap.set(inner, { clearProps: 'position,left,top,right,bottom,margin,width,height,transform' });
      if (img) gsap.set(img, { clearProps: 'width,height,maxWidth,maxHeight' });
      inner.dataset.settled = '1'; // 自动化断言用：封面已就位
      enableTilt(); // 落定之后才允许跟着鼠标倾斜
    },
  }, 0);
  if (img) {
    timeline.to(img, {
      width: dest.width, height: dest.height, duration: reducedMotion ? 0 : T_MAIN, ease: EASE_TRAVEL,
    }, 0);
  }

  // 左侧面板：**和封面的飞行叠着走**（不停下来等）；文字不在这里出场 ——
  // 面板亮到差不多的时候才开始打字（见 TYPE_AT），这样"字是敲出来的"这件事
  // 不会被面板的淡入盖住（两套叠着演就是之前那种"闪两次"）。
  const at = (s) => (reducedMotion ? 0 : s);
  timeline.to(panel, { opacity: 1, duration: reducedMotion ? 0 : T_PANEL, ease: 'power1' }, at(PANEL_AT));
  timeline.add(() => startTyping(), at(TYPE_AT));
  // 幕在封面落定前就撤：header / 悬浮件淡回来这一点也算进同一口气里，
  // 否则封面停稳之后画面还会"再变一次"，又是一拍。
  timeline.add(() => {
    document.documentElement.classList.remove('bd-taking-cover');
    document.querySelector('.jb-card.is-flying')?.classList.remove('is-flying');
  }, at(CURTAIN_AT));
}

// ── 换篇（只有键盘 ←/→ 与触摸横滑；页面上没有可见的翻篇控件）─────────────
// 面板**不动**：旧正文整块淡出、新的从 0.35s 起淡入（两段同时存在才叫交叉淡）；
// 封面交叉淡一下换成新图。
async function go(dir) {
  if (switching.value) return;
  const target = blogPosts[index.value + dir];
  if (!target) return;
  switching.value = true;

  const live = infoRef.value;
  const inner = coverInnerEl();
  if (live && !reducedMotion) {
    outgoing.value = { post: post.value, scrollTop: scrollRef.value?.scrollTop || 0 };
    await nextTick();
    if (outRef.value) gsap.to(outRef.value, { opacity: 0, duration: T_FADE, ease: 'power1' });
    gsap.set(live, { opacity: 0 }); // 新正文先藏着：旧的那段（.bd-out）淡完，新的再敲出来
    stopTyping();
  }
  if (inner && !reducedMotion) gsap.to(inner, { opacity: 0, duration: T_FADE * 0.5, ease: 'power1' });

  // ⚠ 必须 await：不 await 的话下面这个 nextTick 等到的还是**旧**的标题词节点 ——
  // 动画演在旧节点上，随后 Vue 换掉它们，新词就静止不动。
  // 用 replace 不是 push：翻篇是"在同一个面板里换内容"，不该往历史里堆一摞文章。
  // 还要跳过站点的通用转场（黑场滑块），详情页这条路由自己就是一套转场。
  skipNextPageTransition();
  await router.replace({ name: 'blog-detail', params: { slug: target.slug } });
  await nextTick();
  scrollRef.value?.scrollTo({ top: 0, behavior: 'instant' });
  loadFeatured();

  if (inner) {
    gsap.set(inner, { clearProps: 'position,left,top,right,bottom,margin,width,height,transform' });
    if (reducedMotion) gsap.set(inner, { opacity: 1 });
    else gsap.fromTo(inner, { opacity: 0 }, { opacity: 1, duration: T_FADE, ease: 'power1', delay: T_FADE * 0.5 });
  }
  // 新正文等旧的淡得差不多了再开始敲（startTyping 自己会把容器亮起来）
  window.setTimeout(() => startTyping(), reducedMotion ? 0 : T_FADE * 1000);

  window.setTimeout(() => {
    outgoing.value = null;
    switching.value = false;
  }, reducedMotion ? 0 : (T_FADE + T_FADE) * 1000);
}

// ── 退出 ────────────────────────────────────────────────────────────────
// 正文淡出、封面缩回列表里那一格 —— 起点终点与进入互为反向，所以位置天然对得上。
function close() {
  if (leaving) return;
  leaving = true;
  clearTimeout(enterFallback); // 别让"等解码"那条兜底在退场半路再补一遍入场（见 start）
  // 窄屏：抽屉是屏幕外的一层，没有"缩回列表那一格"这回事。
  // 只把正文淡掉再走，别的不动。
  if (isNarrow.value) {
    setOpen(false);
    stopTyping();
    // 窄屏这一支没有飞行，0.25s 读起来就是硬切；和宽屏那一趟（0.8s）不比，
    // 但至少拉到"看得见是淡出去的"这一档。
    const NARROW_OUT = 0.45;
    toStageBg(NARROW_OUT);
    gsap.to(panelRef.value, {
      opacity: 0,
      duration: reducedMotion ? 0 : NARROW_OUT,
      ease: 'power1',
      onComplete: () => {
        skipNextPageTransition();
        markReturningFromDetail();
        if (window.history.state && window.history.state.back) router.back();
        else router.push('/blogs');
      },
    });
    return;
  }
  const inner = coverInnerEl();
  const panel = panelRef.value;
  const back = handoff?.rect;

  const finish = () => {
    // 退出这条路由也不走通用转场：封面缩回去、正文淡掉，露出来的直接是列表。
    // 列表那边：周围元素**渐入**（不是啪一下出现）。这个类只是给列表一个信号，
    // 具体规则和"什么时候摘掉"都在 BlogsView 里。
    // ⚠ 只淡元素、不淡整页底 —— 上一版淡的是 .jb-stage（连底色），背后是纯黑，
    //   看起来就是"屏幕黑一下"，比不做还难看。
    skipNextPageTransition();
    markReturningFromDetail();
    if (window.history.state && window.history.state.back) router.back();
    else router.push('/blogs');
  };

  if (!inner || !panel || reducedMotion || !back) {
    toStageBg(0);
    finish();
    return;
  }

  timeline?.kill();
  disableTilt(); // 缩回去这段内层也是 fixed，同样不能让父级带 transform
  toStageBg(T_PANEL_OUT); // 底色跟着一起退回列表那一档（与面板淡出同拍）
  // 缩回去这一段也走"飞行中 cover"那套（见 .is-flipping img 的样式注释）
  inner.classList.add('is-flipping');
  inner.classList.remove('is-measuring');
  // ⚠ **必须先把内层摆成 position: fixed**，起点是**封面此刻在屏幕上的矩形**，
  // 不能沿用"媒体盒里的 absolute inset: 0 + 相对位移"：内层一旦往左下飞就出了媒体盒，
  // 而 .bd-media 是 overflow: hidden —— 表现就是飞到屏幕中间被**裁掉一半**。
  // 进场那段本来就是 fixed（视口坐标系），两段用同一套坐标，位置天然对得上。
  //
  // ⚠ 起点量的是**内层自己**，不是 .bd-media 那个盒子。入场还没飞完就按 Esc 时
  //   （实测最常见的路径），内层是 fixed 停在半路，而 .bd-media 在右列终点上 ——
  //   拿盒子当起点，照片会先瞬移到右列、再飞回卡片（实测横跳 426px）。
  //   入场已经落定时，内层的矩形本来就等于媒体盒的矩形，两种情形一条式子通吃。
  const cur = inner.getBoundingClientRect();
  if (cur.width && cur.height) {
    gsap.set(inner, {
      position: 'fixed', left: 0, top: 0, right: 'auto', bottom: 'auto', margin: 0,
      transformOrigin: '0 0', width: cur.width, height: cur.height,
      x: cur.left, y: cur.top, opacity: 1,
    });
  }
  // 内层里那张图的行内尺寸要清掉：入场那条时间线给 img 也写过 width/height，
  // 半路被打断时它还停在"半路那个尺寸"上，而返回这条时间线只补间内层 ——
  // 不清的话图会以旧尺寸溢出正在缩小的盒子。清掉就回到 CSS 的 100%，
  // 跟着盒子一起缩（.is-flipping 已经把它切成 object-fit: cover）。
  const flyImg = inner.querySelector('img');
  if (flyImg) gsap.set(flyImg, { clearProps: 'width,height,maxWidth,maxHeight' });
  timeline = gsap.timeline({
    onComplete: () => {
      // ⚠ 这里**不能**清行内样式、也不能摘 .is-flipping：
      //   清掉的话内层立刻回到 CSS 的 inset: 0（= 右列那个终点盒子），而路由要到
      //   下一拍才切走 —— 中间那几帧照片会从卡片**瞬移**回右上角（实测约 5 帧，
      //   明暗两种主题都看得见）；摘掉 .is-flipping 还会把 object-fit 从 cover
      //   换回 contain，图在落点那一格里当场缩小一圈。
      //   所以就让封面**停在落点**，等 keep-alive 把这一页收走（那时看不见了），
      //   清理放到 onDeactivated 里做。
      finish();
    },
    defaults: { ease: EASE_MAIN },
  });
  // 面板淡出拉长到和封面飞行同拍（T_PANEL_OUT = 0.8s，而不是 0.35s）：淡得太快的话，
  // 剩下的半程里左半边是空的，屏幕会有一段时间"什么都没有"。也不再慢过 T_MAIN ——
  // 面板得在封面落地之前淡干净，否则那一格会留下半透明的一块。
  timeline.to(panel, { opacity: 0, duration: T_PANEL_OUT, ease: 'power1' }, 0);
  timeline.to(inner, {
    x: back.left,
    y: back.top,
    width: back.width,
    height: back.height,
    duration: T_MAIN,
    ease: EASE_TRAVEL, // 和进入同一档缓动：回来这一路是"逐渐退回"，两头都有起停
  }, 0);
  // ⚠ 这里**不淡出封面**：整段就是"这张图一直在，从右边逐渐退回初始那一格"。
  // 淡出会让它在中途消失 —— 用户明确不要这个。
}

// ── 键盘 / 触摸 ─────────────────────────────────────────────────────────
function onKeydown(e) {
  if (e.key === 'Escape') {
    // 抽屉开着时 Esc 先收抽屉，再按一次才离开这一篇
    if (isNarrow.value && open.value) setOpen(false);
    else close();
  } else if (e.key === 'ArrowLeft') go(-1);
  else if (e.key === 'ArrowRight') go(1);
}

function onTouchStart(e) {
  // 从把手上起手的是"拉抽屉"，不是"翻篇"：记个 null 让下面那一拍直接跳过
  if (isNarrow.value && e.target.closest?.('.bd-handle')) {
    touchStartPt = null;
    return;
  }
  // 抽屉开着的时候横滑是在跟抽屉较劲，别顺手把篇翻了
  if (isNarrow.value && open.value) {
    touchStartPt = null;
    return;
  }
  touchStartPt = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}

function onTouchEnd(e) {
  if (!touchStartPt) return;
  const dx = e.changedTouches[0].clientX - touchStartPt.x;
  const dy = e.changedTouches[0].clientY - touchStartPt.y;
  touchStartPt = null;
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
  go(dx < 0 ? 1 : -1);
}

// ── 生命周期 ────────────────────────────────────────────────────────────
// 开动画要满足两个条件，缺一个位置就会错：
//   ① 覆盖层已经过布局（否则 getBoundingClientRect 是 0，FLIP 会飞到左上角）。
//   ② 题图已解码 —— 终点尺寸是量那个盒子得到的，而盒子的比例来自图。
function scheduleEnter() {
  if (enterArmed) return; // 首挂载会来两次（见 enterArmed 的注释）
  enterArmed = true;
  // ⚠ 这里**同步**把交接矩形读出来、并把封面摆到"卡片那一格"（可见）。
  //   这一页挂上来时列表已经被 keep-alive 从文档里摘走了，而封面在 CSS 里是
  //   opacity: 0 —— 要是等下面那两个 rAF 才摆，中间那 2–3 帧整屏是空的，
  //   就是点卡片时那一下"闪烁"。
  //   这么做是安全的：交接矩形是**视口坐标**，不依赖本页布局，所以不必等下一帧；
  //   而终点（媒体盒）要等解码后才量得准，那一部分仍然留在 playEnter 里。
  handoff = readCoverHandoff(route.params.slug);
  pinStageBg(); // 覆盖层的第一帧底色 = 列表那一页的底色（理由见 pageBg 那段）
  // 窄屏不摆"起点那一格"：封面在左侧抽屉里，不参与入场（见 playEnter 的窄屏分支）
  if (!isNarrow.value) stageCover();
  // 正文先藏起来：出场顺序是"卡先过去、字再落"。放在这里而不是 playEnter 里，
  // 是为了兜住"题图没加载出来、playEnter 提前 return"那种情况 —— 否则会变成
  // 正文先出现、封面再飞过去（实测出现过）。
  gsap.set(panelRef.value, { opacity: 0 });
  gsap.set(infoRef.value, { opacity: 0 }); // 文字要等打字开始才亮（CSS 里也写了初值）
  // 兜底：入场要是被打断（立刻返回 / 换篇），别让正文永远停在透明
  clearTimeout(infoSafety);
  infoSafety = window.setTimeout(() => {
    if (!typing.value) gsap.set(infoRef.value, { opacity: 1 });
  }, 3000);
  let played = false;
  const start = () => {
    if (played) return;
    played = true;
    // ⚠ 这一页可能在"题图还没解码"的等待里就被 Esc/返回键放弃掉了（下面挂着 load 监听
    //   和一条 1.5s 兜底定时器）。那时再补一遍入场，会把正在往回飞的封面重新摆回起点、
    //   把退场时间线掐掉 —— 用户按了返回，照片却掉头飞回右列。
    if (leaving) return;
    handoff = readCoverHandoff(route.params.slug);
    playEnter();
  };
  // 窄屏不走"等题图解码再 FLIP"那一套：封面在抽屉里、根本不参与入场，
  // 再等它解码就是把正文白白拖住（CDN 慢的时候要等一两秒才见到字）。
  // 这里等两帧让覆盖层完成布局就够了。
  if (isNarrow.value) {
    requestAnimationFrame(() => requestAnimationFrame(start));
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(async () => {
    const img = coverMediaEl()?.querySelector('img');
    if (img && img.naturalWidth) {
      // 比例要先落进 CSS（盒子的高度是 aspect-ratio 撑的），再量终点
      syncRatio(img);
      await nextTick();
      start();
      return;
    }
    stageCover(); // 还没解码：先摆到终点位置（透明），解码完再 FLIP
    if (img) {
      img.addEventListener('load', async () => {
        syncRatio(img);
        await nextTick();
        start();
      }, { once: true });
      img.addEventListener('error', start, { once: true });
      clearTimeout(enterFallback);
      enterFallback = setTimeout(start, 1500); // 兜底：CDN 很慢时别让动画永远不开始
      return;
    }
    start();
  }));
}

// 站点 header 是 fixed 的。详情页里正文会从它下面滚过去 —— header 默认是**透明**的
// （只有 .scrolled 那档才有底），于是两层字会直接叠在一起。
// 给 <html> 挂个类，让 header 在这条路上变成实心（样式见本文件里的 :global 规则）。
function solidifyHeader(on) {
  document.documentElement.classList.toggle('blog-detail-open', on);
}

// 抽屉拉开时把底部那条"空格键"Dock 收起来：它是固定的全宽白条，压在封面下沿很难看，
// 而且这一刻用户要的是看封面，不是翻菜单。
watch(open, (v) => {
  document.documentElement.classList.toggle('bd-cover-open', v && isNarrow.value);
});

// 从窄屏转宽屏（或反过来）时把抽屉收干净：转宽之后这套抽屉根本不存在，
// 留着 open=true 会让下次回到窄屏时"一进来封面就开着"。
watch(isNarrow, (v) => {
  if (!v) setOpen(false);
});

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
  document.documentElement.style.overflow = 'hidden'; // 覆盖层是 fixed 的：底下的列表页不该跟着滚
  narrowMql?.addEventListener('change', syncNarrow);
  syncNarrow(narrowMql || { matches: false });
  solidifyHeader(true);
  loadFeatured();
  scheduleEnter();
});

// keep-alive 复用时 onMounted 不会重跑，但每次进来都要重播一遍进入动画
onActivated(() => {
  leaving = false;
  solidifyHeader(true);
  gsap.set(panelRef.value, { clearProps: 'opacity' });
  scheduleEnter();
});

onDeactivated(() => {
  solidifyHeader(false);
  setOpen(false);   // 下次进来从"正文优先"的状态开始（用户定的顺序）
  disableTilt();
  stopTyping();
  clearTimeout(typeSafety);
  clearTimeout(infoSafety);
  clearTimeout(enterFallback);
  // 退场那条时间线**故意把封面留在落点**（理由见 close 的注释），收尾挪到这里：
  // keep-alive 已经把这棵 DOM 移出文档，怎么复位都看不见。
  const inner = coverInnerEl();
  if (inner) {
    inner.classList.remove('is-flipping', 'is-measuring');
    gsap.set(inner, { clearProps: 'position,left,top,right,bottom,margin,width,height,transform' });
    const img = inner.querySelector('img');
    if (img) gsap.set(img, { clearProps: 'width,height,maxWidth,maxHeight' });
  }
  // 覆盖层的行内底色也还回去：下一次可能是"直接开链接"进来的，那时该用站点默认底色
  stageBgTween?.kill();
  stageBgTween = null;
  if (detailRef.value) gsap.set(detailRef.value, { clearProps: 'backgroundColor' });
  // ⚠ 必须复位：这个 guard 只负责"首挂载时 onMounted 与 onActivated 各来一次"，
  // 留着不放的话**第二次进详情就再也不会播入场动画**（面板的 CSS 初值是 opacity: 0，
  // 于是整页只剩一个看不见的封面）。实测踩过。
  enterArmed = false;
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  narrowMql?.removeEventListener('change', syncNarrow);
  document.documentElement.style.overflow = '';
  solidifyHeader(false);
  timeline?.kill();
  stageBgTween?.kill();
  stopTyping();
  clearTimeout(typeSafety);
  clearTimeout(infoSafety);
  clearTimeout(enterFallback);
});

watch(() => route.params.slug, async () => {
  handoff = readCoverHandoff(route.params.slug) || handoff;
  await nextTick();
});

// 题图换了就重新加载 —— 这条**不能省**：详情是 keep-alive 的，从列表再点**另一篇**
// 时组件不会重新挂载，而 <img> 是按 :key 重建的，新建出来那个是空的、没人给它赋 src。
// 漏掉它的表现就是"第二次进来只看得见 alt"（实测踩过）。
watch(
  () => post.value?.image?.src,
  async () => {
    await nextTick();
    loadFeatured();
  },
  { immediate: true }
);

// 联调探针：tools/blog-shots.mjs 用它绕开输入层直接翻篇 / 关闭
if (typeof window !== 'undefined') {
  window.__bd = {
    go,
    close,
    // 窄屏抽屉：自动化断言用（tools/blog-shots.mjs 那一路）
    cover: () => ({ open: open.value, narrow: isNarrow.value }),
    setCover: setOpen,
    state: () => ({
      route: route.params.slug,
      prev: prevPost.value?.slug || null,
      next: nextPost.value?.slug || null,
      switching: switching.value,
      leaving,
    }),
  };
}
</script>

<template>
  <main class="page active blog-detail-page">
    <section
      v-if="post"
      ref="detailRef"
      class="blog-detail"
      :class="{ 'is-cover-open': open }"
      @touchstart.passive="onTouchStart"
      @touchend.passive="onTouchEnd"
      @pointermove="onTiltMove"
      @pointerleave="onTiltLeave"
    >
      <!-- ── 左：正文面板（换篇时它整块交叉淡，位置不动）────────────────── -->
      <div ref="panelRef" class="bd-panel">
        <div ref="scrollRef" class="bd-panel-inner">
          <div ref="infoRef" class="bd-info">
            <!-- 没有 Close 按钮（已按需求删掉）：退出的路是 —— 点封面以外的空白、Esc、
                 浏览器返回。阅读时长并进日期那一行，不再单独占一条。 -->
            <div class="blog-meta">
              <span class="blog-date">{{ post.date }}</span>
              <span class="bd-tag">{{ post.readTime }}</span>
            </div>
            <!-- 标题与正文都由 startTyping() 逐字敲出来（不要在模板里拆字：
                 换篇时 v-html 会把正文整个换掉，拆字必须在那之后做） -->
            <h1 ref="titleRef" class="blog-detail-title">{{ post.title }}</h1>
            <div ref="bodyRef" class="blog-detail-content" v-html="post.body"></div>
          </div>
        </div>

        <!-- 打字机光标：fixed 定位，位置由 moveCaret() 每帧写；打完自己收起来 -->
        <span ref="caretRef" class="tw-caret" :class="{ 'is-on': typing }" aria-hidden="true"></span>

        <!-- 旧正文的替身：和新的那段重叠 0.35s，两段一起才叫交叉淡 -->
        <div v-if="outgoing" ref="outRef" class="bd-out" aria-hidden="true">
          <div class="bd-out-inner" :style="{ transform: `translate3d(0, ${-outgoing.scrollTop}px, 0)` }">
            <div class="blog-meta"><span class="blog-date">{{ outgoing.post.date }}</span></div>
            <h1 class="blog-detail-title">{{ outgoing.post.title }}</h1>
            <div class="blog-detail-content" v-html="outgoing.post.body"></div>
          </div>
        </div>
      </div>

      <!-- ── 右：封面。点列表里那张卡，它就从那一格飞到这里、完整铺开。 ────
           封面以外的空白是"点一下返回列表"的热区（之前那个跟随鼠标的 Close 标签
           已按需求去掉：退出的路是"点空白 / Esc / 浏览器返回"）。 -->
      <!-- 窄屏：正文之上先压一层暗幕，点它收抽屉（桌面隐藏） -->
      <div
        class="bd-scrim"
        :class="{ 'is-on': open }"
        aria-hidden="true"
        @click="setOpen(false)"
      />

      <div ref="drawerRef" class="bd-right" @pointerdown="onDrawerDown">
        <div class="bd-closezone" @click="isNarrow ? setOpen(false) : close()"></div>

        <div ref="coverWrapRef" class="bd-cover">
          <figure class="bd-media" :style="{ '--ratio': ratio }">
            <!-- 这里**不放 skeleton-loader**：封面就是列表里那张已经解码好的图
                 （同一个 URL、缓存命中，实测第一帧就 ready），骨架屏纯属多余；
                 而且全局那条 .skeleton-loader 自带的 ::after 流光，只把底色改透明
                 是盖不掉的 —— 会看到一层一直在扫的光。 -->
            <div class="bd-media__inner">
              <!-- :key=slug：换篇时把 <img> 整个换掉（沿用旧版的做法），
                   否则 loadImage 会因为 .loaded 的守卫直接跳过新图 -->
              <img
                :key="post.slug"
                :data-src="post.image.src"
                :data-full-src="post.image.fullSrc"
                :alt="post.title"
                draggable="false"
                decoding="async"
              >
            </div>
          </figure>
        </div>
      </div>

      <!-- 窄屏：左边缘常显的把手。点一下开合，往右拖跟着走 ——
           拉开之后它自己骑在抽屉的右沿上，再往左拖就是收回。
           图标是相机取景框（Tabler 那一路的细线），和站点别处的图标同一门语言。 -->
      <button
        class="bd-handle"
        type="button"
        aria-label="封面"
        :aria-expanded="open"
        @click="onHandleClick"
        @pointerdown="onDragDown"
        @pointermove="onDragMove"
        @pointerup="onDragUp"
        @pointercancel="onDragUp"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="9" cy="10.5" r="1.6" />
          <path d="M4 17.5 9.5 12l4 4 3-2.5 3.5 3" />
        </svg>
      </button>
    </section>

    <section v-else class="blog-detail blog-detail--missing">
      <h1 class="blog-detail-title">POST NOT FOUND</h1>
      <div class="blog-detail-content">
        <p>没有这篇：{{ route.params.slug }}</p>
        <p><router-link to="/blogs">← 回到 BLOGS</router-link></p>
      </div>
    </section>
  </main>
</template>

<style scoped>
/* ── "点下去之后，除这张卡片之外全部隐去" ──────────────────────────────────
   点击那一刻 BlogsView 给 <html> 挂上 .bd-taking-cover，卡片落地后由 playEnter
   的收尾摘掉。列表本身在详情挂上来的时候就被 keep-alive 从文档里摘走了
   （所以背后不会看到它），这里要处理的是**站点 header 和那几个悬浮件** ——
   飞行途中只该看见那张正在变大的照片。 */
:global(html.bd-taking-cover header),
:global(html.bd-taking-cover .jb-wordmark),
:global(html.bd-taking-cover .jb-rail),
:global(html.bd-taking-cover .jb-end),
:global(html.bd-taking-cover .music-toggle-btn),
:global(html.bd-taking-cover .music-player),
:global(html.bd-taking-cover .theme-toggle),
/* 轨道上"其余那些卡片"一起淡出。被点的那张带 .is-flying，不在这条规则里 ——
   它要一直亮着，等详情页那张封面从同一个矩形接手，否则中间会空一帧。
   ⚠ 时长要和 BlogsView 里那一拍的等待（TAKEOVER_MS = 420ms）对齐：路由会在
   那一拍结束时换页、列表随之被摘出文档，淡出必须在这之前演完。 */
:global(html.bd-taking-cover .jb-card:not(.is-flying)) {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.4s ease;
}

/* 详情页里站点 header 要变成实心：正文从它下面滚过去，而 header 默认是透明的
   （只有 .scrolled 那一档有底），两层字会直接叠在一起。
   配色沿用 main.css 里 header.scrolled 的那一套（0.9 + 毛玻璃），保持同一门语言。 */
:global(html.blog-detail-open header),
:global(html.blog-detail-open header.scrolled) {
  background-color: rgba(250, 250, 250, 0.9);
  backdrop-filter: blur(10px);
}

:global(html.dark.blog-detail-open header),
:global(html.dark.blog-detail-open header.scrolled) {
  background-color: rgba(26, 26, 26, 0.9);
}

/* 窄屏拉开封面抽屉时，把底部那条全宽的白条（MobileDock 的"空格键"）收起来：
   它压住封面下沿很难看，而且这一刻要看的是封面，不是菜单。
   z-index 1001 比抽屉还高，不藏的话它会浮在封面上。 */
:global(html.bd-cover-open .dock) {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.24s ease;
}

/* ══ 覆盖层 ══════════════════════════════════════════════════════════════
   ⚠ 覆盖层整体**不设背景**：动画开始时列表要能透出来（封面就是从那里长过来的）。
   ⚠ main.css 里有一条全局的 .blog-detail（140px 内边距 / max-width 900px），
   这里用 scoped 的同名规则（属性选择器提权）盖掉。 */
.blog-detail {
  /* 站点 header 是 fixed 的（实测高 88px，见 main.css 的 header 规则）。
     两级内容都要从它下面开始，否则会和 HOME BLOGS STATS 叠在一起
     （header 是透明的，两层字会直接糊住）。 */
  --bd-top: 88px;
  position: fixed;
  inset: 0;
  z-index: 60; /* 头部是 100，面板从它下面滑过 */
  display: grid;
  grid-template-columns: minmax(0, 59fr) minmax(0, 41fr);
  align-items: stretch;
  padding: 0;
  max-width: none;
  margin: 0;
  background: transparent;
}

/* ── 左：正文面板 ───────────────────────────────────────────────────── */
.bd-panel {
  position: relative;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  background: var(--bg);
  border-right: 1px solid var(--border);
  /* ⚠ 初值就是透明：出场顺序是"卡先过去、字再落"，而 scheduleEnter 要等两帧才跑 ——
     不写在 CSS 里的话，那两帧里正文会按默认值先亮一下（实测到过，
     看起来就是"点下去正文比封面先出来"）。GSAP 在后面把它补到 1。 */
  opacity: 0;
}

.bd-panel-inner {
  height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--bd-top) 56px 96px;
  /* 滚动条藏掉：这一页是"整屏覆盖层"，右边的滚动条一露出来就破了整个版面 */
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.bd-panel-inner::-webkit-scrollbar {
  display: none;
}

.bd-tag {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.66rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

/* ── 标题：逐词揭幕 ─────────────────────────────────────────────────────
   每个词外面套一层 overflow: clip 的盒子，内层从下方滑上来。
   词间距用 gap 补回 inline-block 吃掉的空格。 */
/* 标题：普通一级标题。字是 startTyping() 逐个敲出来的，模板里不拆字。 */
.blog-detail-title {
  display: block;
  margin-top: 0;
}

/* ── 换篇时旧正文的替身 ─────────────────────────────────────────────── */
.bd-out {
  position: absolute;
  inset: 0;
  z-index: 3;
  overflow: hidden;
  pointer-events: none;
  padding: 0 56px;
  background: var(--bg);
}

.bd-out-inner {
  padding-top: calc(var(--bd-top) + 26px); /* 和面板里正文起始位置对齐 */
  will-change: transform;
}

/* ══ 打字机 ══════════════════════════════════════════════════════════════
   正文容器**从第一帧就是透明的**：打字要等面板亮到差不多才开始（TYPE_AT ≈ 0.78s），
   而"包字符"这件事也在 startTyping 里做 —— 不在这儿先藏起来的话，那 0.78 秒里
   整篇文字是原样完整显示着的，然后才突然变成逐字敲（用户看到的"先完整显示一秒"）。
   ⚠ 和 .bd-panel 一样是"初值"，之后由 GSAP 写行内 opacity 接管。 */
.bd-info {
  opacity: 0;
}

/* 被"敲"出来的字符：版面一开始就是最终状态，只有可见性在变（见 startTyping）。

   ⚠ 这几条**必须走 :deep()**：正文是 v-html 出来的、字符 span 是 JS 现插的，
   两者都没有 Vue 的 scoped 属性 —— 写成普通的 `.tw-ch` / `> *.is-on`，
   scoped 编译器会给它们加上 `[data-v-xxx]`，于是整条规则匹配不到任何人：
   表现就是"块一直是 opacity: 0"（实测：正文从头到尾不出现，直到打完才被兜底放出来）。 */
:deep(.tw-ch) {
  opacity: 0;
}

:deep(.tw-ch.is-on) {
  opacity: 1;
}

/* 正文里的块（段落、图文块）整块先藏着，敲到它才放出来 ——
   否则缝在正文里的图会抢在文字前面出现。 */
.bd-info.is-typing :deep(.blog-detail-content > *) {
  opacity: 0;
}

.bd-info.is-typing :deep(.blog-detail-content > *.is-on) {
  opacity: 1;
}

/* 光标：贴着刚敲出来的那个字。位置每帧由 moveCaret() 写（fixed + 视口坐标）。 */
.tw-caret {
  position: fixed;
  top: 0;
  left: 0;
  width: 2px;
  background: var(--text-primary);
  pointer-events: none;
  visibility: hidden;
  z-index: 5;
  animation: tw-blink 0.9s steps(1, end) infinite;
}

.tw-caret.is-on {
  visibility: visible;
}

@keyframes tw-blink {
  0%,
  49% {
    opacity: 1;
  }
  50%,
  100% {
    opacity: 0;
  }
}

/* ── 右：封面 ───────────────────────────────────────────────────────── */
/* 窄屏那套"左侧抽屉 + 边缘把手"在宽屏根本不存在（宽屏走的是右列封面 +
   从列表那一格飞过来），所以这里先整体关掉，样式全在下面的窄屏块里。 */
.bd-scrim,
.bd-handle {
  display: none;
}

.bd-right {
  position: relative;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--bd-top) 56px 56px;
}

.bd-closezone {
  position: absolute;
  inset: 0;
  cursor: pointer;
}

.bd-cover {
  position: relative;
  z-index: 1; /* 压在热区之上：封面本身不关闭 */
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none; /* 点封面不该被热区吃掉，也不该穿透到列表 */
}

/* 媒体盒：宽度占满，高度由 aspect-ratio（= 图的比例）撑出来，两头都被 max-height
   兜住；图自身 object-fit: contain —— **宁可留白也不裁剪**，右侧展示的就是完整封面。 */
.bd-media {
  position: relative;
  width: 100%;
  aspect-ratio: var(--ratio, 4 / 5);
  max-height: 100%;
  overflow: hidden; /* 补间期间按起点那一格的尺寸裁切，读起来才是"同一张图在长大" */
  pointer-events: auto;
}

.bd-media__inner {
  position: absolute;
  inset: 0;
  /* 先透明：GSAP 接管之前它若按 CSS 的最终位置摆着，会先在终点闪一帧。
     注意这只是"接管的瞬间之前"的状态，不是渐显 —— 上一帧是 0、下一帧就是 1，
     中间没有补间（见 stageCover / playEnter 里的 gsap.set）。 */
  opacity: 0;
}

.bd-media__inner img {
  display: block;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

/* 飞进/缩回的**途中**改成 cover：
   容器的比例是从"列表里那一格"（定宽定高的裁切框）渐变到"照片自己的比例"的，
   飞行途中若用 contain，会看到照片缩在框里两侧留一条白 —— 不丝滑。
   用 cover 则整段都是"照片在长"，而且收尾那一刻容器的比例正好等于图的比例，
   cover 与 contain 完全等价 —— 所以摘掉这个类是看不出来的一帧。
   （参考站也是这个路子：源和目标都是 media-fill。） */
.bd-media__inner.is-flipping img,
.bd-media__inner.is-measuring img {
  object-fit: cover;
}

/* 测量态：按终点尺寸钉住但完全透明（见 stageCover） */
.bd-media__inner.is-measuring {
  position: fixed;
  left: 0;
  top: 0;
  right: auto;
  bottom: auto;
  margin: 0;
  transform-origin: 0 0;
}

/* ── 窄屏：封面在上、正文在下（阅读顺序不变，两级各自占满宽度）─────────── */
/* ══ 窄屏：正文占满屏，封面收进左侧抽屉 ══════════════════════════════════
   和宽屏那套"左正文 / 右封面 + 封面从列表飞过来"是两条独立的路：
   窄屏先给完整的正文，封面在左边缘那条抽屉里，靠把手点/拖拉出来。
   JS 那边按同一个断点走 isNarrow 分支（playEnter / close / stageCover）。
   --cover-open 是这条抽屉的唯一驱动量：0 = 收起、1 = 拉开，拖动时写连续值。
   抽屉和把手都读它，中途不会有先后差。 */
@media (max-width: 1024px) {
  .blog-detail {
    --bd-top: 0px;
    --cover-w: min(86vw, 420px);
    --cover-open: 0;
    display: block; /* 不再分"封面上 / 正文下"两行 */
  }

  .blog-detail.is-cover-open {
    --cover-open: 1;
  }

  /* 正文这一层铺满整屏 */
  .bd-panel {
    position: absolute;
    inset: 0;
    border-right: 0;
  }

  /* 顶部要让开站点 header（fixed，88px），底部要让开那条"空格键"Dock（68px）——
     正文是这一个滚动容器里的内容，Dock 直接压在它上面。
     左边额外让出 46px：那条把手是 fixed 的、竖着居中，正文按 24px 排的话
     中间那几行会被它压住字头。46 = 把手 28 + 18 的间隙。 */
  .bd-panel-inner {
    padding: 104px 24px 96px 46px;
  }

  .bd-out {
    /* 左内边距和上面 .bd-panel-inner 对齐，交叉淡的时候两段字才在同一条线上 */
    padding: 0 24px 0 46px;
  }

  .bd-out-inner {
    padding-top: 130px; /* 和上面正文的起始位置对齐 */
  }

  /* ── 抽屉本体：就是宽屏那个 .bd-right，只是换个位置和尺寸 ─────────── */
  .bd-right {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    width: var(--cover-w);
    z-index: 8;
    /* 顶部让开 header：抽屉是滑到 header **下面**去的（header z-index 100），
       不留这一段的话封面会被压在标题栏后面。 */
    padding: 88px 20px 84px;
    background: var(--bg);
    border-right: 1px solid var(--border);
    box-shadow: 12px 0 44px rgba(0, 0, 0, 0.28);
    transform: translateX(calc(-100% + var(--cover-open) * 100%));
    transition: transform 0.42s cubic-bezier(0.22, 1, 0.36, 1);
    will-change: transform;
  }

  /* 拖动中：位置直接跟手指，别再有补间 */
  .blog-detail.is-cover-dragging .bd-right,
  .blog-detail.is-cover-dragging .bd-handle {
    transition: none;
  }

  /* 窄屏上封面是**可见**的（宽屏那套由 GSAP 逐帧写 opacity，初值是 0） */
  .bd-media__inner {
    opacity: 1;
  }

  /* ── 暗幕：压在正文之上、抽屉之下，点它收抽屉 ───────────────────────── */
  .bd-scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 7;
    background: rgba(0, 0, 0, 0.42);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: opacity 0.3s ease, visibility 0.3s ease;
  }

  .bd-scrim.is-on {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
  }

  /* ── 把手：左边缘那一条，点一下开合、往右拖跟着走 ─────────────────────
     毛玻璃：底子只给六成，剩下靠 backdrop-filter 糊 —— 底下的正文会透成一片
     模糊的墨色，而不是被一块实心色块盖住。
     正文那边留了 46px 的左内边距（见上），所以收起状态下它其实不压字；
     拉开之后它整个让到抽屉的**右沿之外**（位移 = 抽屉宽度），也不会压在封面上。 */
  .bd-handle {
    position: fixed;
    left: 0;
    top: 50%;
    z-index: 9;
    width: 28px;
    height: 96px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--border);
    border-left: 0;
    border-radius: 0;
    background: color-mix(in srgb, var(--bg) 58%, transparent);
    backdrop-filter: blur(14px) saturate(1.1);
    color: var(--text-primary);
    cursor: grab;
    /* 拖它的时候别让浏览器当成页面滚动 */
    touch-action: none;
    -webkit-tap-highlight-color: transparent;
    /* 拉开之后整条让到抽屉右沿外面 —— 停在抽屜里侧会盖住封面，
       骑在边线上又切一半，都不好看。 */
    transform: translateY(-50%) translateX(calc(var(--cover-open) * var(--cover-w)));
    transition: transform 0.42s cubic-bezier(0.22, 1, 0.36, 1), background 0.2s ease;
  }

  .bd-handle:active {
    cursor: grabbing;
  }

  .bd-handle svg {
    width: 17px;
    height: 17px;
  }
}

.blog-detail--missing {
  position: relative;
  inset: auto;
  display: block;
  padding: 140px 64px;
  max-width: 900px;
  margin: 0 auto;
  background: var(--bg);
}

@media (prefers-reduced-motion: reduce) {
  /* 减少动态效果下不敲字（startTyping 里直接全放出来），光标也不该闪 */
  .tw-caret {
    animation: none;
  }
}
</style>
