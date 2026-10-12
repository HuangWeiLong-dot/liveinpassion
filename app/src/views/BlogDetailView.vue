<script setup>
// 博客详情：**左正文 / 右封面**。点列表里的一张卡 → 封面从那一格飞到右侧并完整铺开，
// 左侧的正文随后逐渐显现；退出时封面缩回列表里那一格。
// ⚠ 窄屏（≤1024px）走的不是这一套：没有两列、也没有飞行 —— 封面铺成**整屏背景**，
//   正文压在上面（固定压暗 + 浅色字），左边缘那颗键只切背景开/关。见样式里"窄屏"那一段。
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
import { useLightbox } from '../composables/useLightbox.js';
import { readCoverHandoff, markReturningFromDetail, setCoverCurtain } from '../composables/useCoverHandoff.js';
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
// ── 退场那一条**和入场不是同一档**（这是有意的，别"统一"掉）──────────────
// 入场用 snappy 是对的：起步就快，之后几乎不动的收尾正好和"左侧正文在淡入、
// 在打字"撞在一起，有东西陪着那半秒。退场没有这层陪衬 —— 面板到 0.8s 已经淡干净，
// 同一档缓动剩下的收尾就是**纯静止**。实测逐帧：封面约 0.6s 就停在卡片那一格，
// 一直停到 0.97s 列表回来，中间 400ms 是一张一动不动的照片配全黑背景
//（帧 6/7/8 三张几乎逐像素相同），读起来就是"卡住了"。
// 所以回来这一路换成两头都有起停的 power2.inOut：整段都在走，
// 落到卡片那一格的那一刻正好走完，既不提前落地干等，也不会在终点前抢一拍。
const EASE_RETURN = 'power2.inOut';
const T_MAIN_OUT = 0.8; // 与 T_PANEL_OUT 同长（见 close 里的注释）
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

// ── 墙角视图 ────────────────────────────────────────────────────────────
// 列表里卡片右下角那颗按钮会带 `?view=corner` 过来：同一份内容、同一个组件，
// 只是把"正文 / 封面"两块绕着中间那条共用的竖边折起来 —— 整个画面因此是 3D 的，
// 像站在墙角里。夹角可自定（见下面的控件），180° 就是原来的平铺。
const CORNER_KEY = 'lip:corner-angle';
// 房间整体缩放 / 俯视角度（同样是可调的，控件在下面那条栏里）
const ROOM_ZOOM_KEY = 'lip:corner-zoom';
const ROOM_PITCH_KEY = 'lip:corner-pitch';
// 视角上下：把整个"墙组"在垂直方向挪一挪（等于把机位抬高/放低）。
// 单位是**房间高度的百分比**，所以窗口一变也跟着等比走。
const ROOM_SHIFT_KEY = 'lip:corner-shift';
// 封面视图里"标题"的位置（水平用 vw、垂直用 vh，窗口变了也跟着走）
const CV_X_KEY = 'lip:cover-title-x';
const CV_Y_KEY = 'lip:cover-title-y';
// 封面视图里标题用的字形。站内只加载了这三套（都是设计里已经在用的），
// 所以"切换字体"就切这三套，不引新字体、不动首屏字节。
const CV_FONT_KEY = 'lip:cover-title-font';
const CV_FONTS = [
  { id: 'oswald', label: 'OSWALD', css: "'Oswald', sans-serif", spacing: '0.02em', transform: 'uppercase' },
  { id: 'poppins', label: 'POPPINS', css: "'Poppins', sans-serif", spacing: '-0.01em', transform: 'none' },
  { id: 'mono', label: 'MONO', css: "'JetBrains Mono', ui-monospace, monospace", spacing: '0.02em', transform: 'none' },
];
// ⚠ 窄屏（响应式设备）上这两种模式**不生效**：它们整套版面（3D 夹角 / 放大封面 +
//   错位标题）是为宽屏做的，手机上封面本来就是左侧抽屉那一套。所以直接叠一个
//   `!isNarrow` —— 带 ?view=... 直接打开也只按普通详情渲染。
const isCorner = computed(() => route.query.view === 'corner' && !isNarrow.value);
// 「封面视图」：只把封面放大到屏幕中间、标题错位压在它斜上方（见下面那段样式）。
// 和墙角是并列的两种模式，靠同一个 query 切换。
const isCoverView = computed(() => route.query.view === 'cover' && !isNarrow.value);
const anyView = computed(() => isCorner.value || isCoverView.value);
function goView(v) {
  router.replace({ name: 'blog-detail', params: route.params, query: v ? { view: v } : {} });
}
const cornerAngle = ref(153); // 默认每堵墙折起 13.5°（用户要的 13~14 那一档）
const roomZoom = ref(0.78);   // 整个房间的缩放：调小 → 两堵墙都进画面，看到全貌
const roomPitch = ref(7);     // 俯视角度（deg）：越大越像从上方看进一个房间
const roomShift = ref(0);     // 视角上下（%）：正 = 画面整体下移（机位抬高）
const cvTitleX = ref(6);      // 封面视图：标题的水平位置（vw）
const cvTitleY = ref(15);     // 封面视图：标题的垂直位置（vh）
const cvFont = ref('oswald'); // 封面视图：标题字形（见 CV_FONTS）
const cvFontCss = computed(() => (CV_FONTS.find((f) => f.id === cvFont.value) || CV_FONTS[0]));
if (typeof window !== 'undefined') {
  try {
    const l = window.localStorage;
    // ⚠ 必须先判"键在不在"：`Number(null)` 是 0，而 0 正好落在俯仰的合法区间里 ——
    //   首次进来会把默认的 7° 直接冲成 0°（实测就是这么变成"俯视 0°"的）。
    const read = (k, min, max, into) => {
      const raw = l.getItem(k);
      if (raw === null) return;
      const v = Number(raw);
      if (Number.isFinite(v) && v >= min && v <= max) into(v);
    };
    read(CORNER_KEY, 60, 180, (v) => { cornerAngle.value = v; });
    read(ROOM_ZOOM_KEY, 0.4, 1.2, (v) => { roomZoom.value = v; });
    read(ROOM_PITCH_KEY, 0, 24, (v) => { roomPitch.value = v; });
    read(ROOM_SHIFT_KEY, -40, 40, (v) => { roomShift.value = v; });
    read(CV_X_KEY, -10, 70, (v) => { cvTitleX.value = v; });
    read(CV_Y_KEY, 2, 80, (v) => { cvTitleY.value = v; });
    try {
      const f = l.getItem(CV_FONT_KEY);
      if (f && CV_FONTS.some((x) => x.id === f)) cvFont.value = f;
    } catch { /* 隐私模式 */ }
  } catch { /* 隐私模式 */ }
}
// 三个数一起存：只存其中一个的话，下次进来另外两个会退回默认值（看起来就是"设置没生效"）
watch([cornerAngle, roomZoom, roomPitch, roomShift, cvTitleX, cvTitleY, cvFont], ([a, z, p, s2, tx, ty, ft]) => {
  try {
    const l = window.localStorage;
    l.setItem(CORNER_KEY, String(a));
    l.setItem(ROOM_ZOOM_KEY, String(z));
    l.setItem(ROOM_PITCH_KEY, String(p));
    l.setItem(ROOM_SHIFT_KEY, String(s2));
    l.setItem(CV_X_KEY, String(tx));
    l.setItem(CV_Y_KEY, String(ty));
    l.setItem(CV_FONT_KEY, String(ft));
  } catch { /* 同上 */ }
});
// 摊平 = 回到普通详情（replace，别往历史里堆）
function exitCorner() {
  router.replace({ name: 'blog-detail', params: route.params });
}

const reducedMotion = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── 窄屏：封面就是整屏背景 ──────────────────────────────────────────────
// 断点和移动版外壳（MobileDock）一致。窄屏上进详情**直接给完整正文**，
// 封面铺成固定不滚的整屏背景（上面一层固定暗幕、正文切浅色字，见样式里那段），
// 左边缘那颗键只负责"背景开/关"（用户定的：背景常驻 + 一个开关）。
// 桌面那套"左正文右封面 + 封面从列表飞过来"一行不动 —— 这里只走窄屏这一支。
const narrowMql = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(max-width: 1024px)')
  : null;
const isNarrow = ref(narrowMql ? narrowMql.matches : false);
function syncNarrow(e) {
  isNarrow.value = e.matches;
}

const detailRef = ref(null);      // 挂 .is-bg-off 的那一层
// 封面背景开着没有。**只有窄屏读它** —— 宽屏那份样式里没有任何 .is-bg-off 规则。
// 初值开；每次重新进详情也回到开（见 onActivated / onDeactivated）：
// 进一篇就是"看到照片"，要安静读书自己点一下那颗键。
const bgOn = ref(true);
function toggleBg() {
  bgOn.value = !bgOn.value;
}

// 窄屏那颗"看完整封面"：开**站内灯箱**（App.vue 里那个全局 Lightbox，z-index 1000
// 压在详情覆盖层之上）—— 全屏、完整不裁剪、点空白 / Esc 关，和站内看别的照片同一套。
// ⚠ 送进去的是**压缩图**（就是背景那一张，缓存命中、基本瞬开），不是 fullSrc 原图：
//   压缩图 1920px 宽，在任何手机屏上都是超采样；而原图有几篇是十几 MB 的 PNG ——
//   为"看一眼完整封面"去冷启动下十几 MB 不值当（详情页当初从原图退回压缩图也是这个理由）。
//   真要原图：把 fullSrc 一起带上即可（灯箱优先取 fullSrc）。
const { open: openLightbox, isOpen: lightboxOpen } = useLightbox();
function openFullCover() {
  const src = post.value?.image?.src;
  if (src) openLightbox([{ src }], 0);
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
  const cs = getComputedStyle(panel);
  const c = cs.backgroundColor;
  if (c && c !== 'rgba(0, 0, 0, 0)') return c;
  // 窄屏这一支：面板是**透明**的（封面照片铺在它下面），底色不在面板上、
  // 而在 --bg 这个令牌上（.blog-detail 自己吃它）。不兜这一下的话
  // toPageBg 会永远拿不到终点色 —— 覆盖层就一直停在列表那一页的底色上。
  const token = cs.getPropertyValue('--bg').trim();
  return token || null;
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

  // 墙角模式：**不做 FLIP**。那两块各自带着 rotateY，父级有 transform 之后
  // position: fixed 的飞行内层会改以它当包含块（这份文件开头就记过这个坑），
  // 封面会飞得又偏又扁。这里直接把结果摆上去，进场交给面板自己的淡入。
  if (isCorner.value || isCoverView.value) {
    timeline?.kill();
    disableTilt();
    // 把 FLIP 那套行内样式彻底还回去（万一有残留），封面就老老实实待在封面格里
    inner.classList.remove('is-measuring', 'is-flipping');
    gsap.set(inner, {
      clearProps: 'position,left,top,right,bottom,margin,width,height,transform', opacity: 1,
    });
    const covImg = inner.querySelector('img');
    if (covImg) gsap.set(covImg, { clearProps: 'width,height,maxWidth,maxHeight' });
    gsap.set(inner, { opacity: 1 });
    gsap.set(panel, { opacity: 1 });
    setCoverCurtain(false);
    document.querySelector('.jb-card.is-flying')?.classList.remove('is-flying');
    startTyping();
    return;
  }

  // 窄屏：封面在左侧抽屉里（屏幕外），没有"飞到右列"这回事。
  // 按用户定的顺序 —— 先把正文给全，封面在抽屉里待命，由手势去拉。
  if (isNarrow.value) {
    timeline?.kill();
    disableTilt();
    toPageBg(T_PANEL, 0); // 窄屏没有飞行，底色跟着面板一起立刻走完（见 pageBg 那段注释）
    gsap.set(inner, { opacity: 1 });
    gsap.set(panel, { opacity: 1 });
    setCoverCurtain(false);
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
    setCoverCurtain(false);
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
  // 退场这一趟也把 site chrome 淡掉（header / 主题键 / 作者区 / 播放器键）。
  //
  // 为什么需要：列表那边回来时会把整页**从 0 淡入**（BlogsView 的 RETURN_FADE，
  // 名单里就有 header）。而退场飞行途中 header 一直亮着 —— 于是换页那一帧它
  // 从 1 **啪一下归零**、再花 1 秒淡回来，实测是这一段里最明显的一下"闪"。
  // 起飞时先把它淡到 0（时长同 TAKEOVER，见 App.vue 那条权重说明），
  // 换页那一刻它本来就是 0，淡入就接得上了。
  // 另外顺带盖住了 header 本身的样式切换：详情页那条实心底（blog-detail-open）
  // 会在 activate() 里被摘掉，背着淡入的话那一档底色是硬切的。
  // 清除交给 BlogsView.activate()（它本来就会摘这个类）。
  //
  // ⚠ "减少动态效果"下**不挂**：那时没有飞行，挂上去只会让 header 先淡没、
  //   换页后再淡回来 —— 白白多闪一下。回列表那条淡入本来也是跳过的。
  if (!reducedMotion) setCoverCurtain(true);
  // 窄屏：封面是整屏背景，没有"缩回列表那一格"这回事。
  // 只把正文淡掉再走，别的不动。
  if (isNarrow.value) {
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
  // 剩下的半程里左半边是空的，屏幕会有一段时间"什么都没有"。
  // 两者同长（T_MAIN_OUT = T_PANEL_OUT = 0.8s）：面板淡干净与封面落地同时发生，
  // 谁也不会在后面留下半透明的一块、或让落点那一格空等。
  timeline.to(panel, { opacity: 0, duration: T_PANEL_OUT, ease: 'power1' }, 0);
  timeline.to(inner, {
    x: back.left,
    y: back.top,
    width: back.width,
    height: back.height,
    duration: T_MAIN_OUT,
    ease: EASE_RETURN,
  }, 0);
  // ⚠ 这里**不淡出封面**：整段就是"这张图一直在，从右边逐渐退回初始那一格"。
  // 淡出会让它在中途消失 —— 用户明确不要这个。
}

// ── 键盘 / 触摸 ─────────────────────────────────────────────────────────
function onKeydown(e) {
  // ⚠ 灯箱开着时键盘整个归它管（Esc 关灯箱、←/→ 翻图）：这里不挡的话，按一下 Esc
  //   会**一边关灯箱、一边把这一篇也退掉**（两处 keydown 都挂在 document 上，
  //   谁也拦不住谁）；←/→ 更糟 —— 灯箱盖着，背后的文章却在偷偷翻篇。
  if (lightboxOpen.value) return;
  if (e.key === 'Escape') {
    // 窄屏上不再有"先收抽屉"这一拍（封面就是背景，没有可收的东西）——
    // Esc 一个动作：离开这一篇。
    close();
  } else if (e.key === 'ArrowLeft') go(-1);
  else if (e.key === 'ArrowRight') go(1);
}

function onTouchStart(e) {
  // 从左边缘那一列小键上起手的是"切背景 / 看完整封面"，不是"翻篇"：
  // 记个 null 让下面那一拍直接跳过（整列一起判，省得加一颗键就得回来补一条）。
  if (isNarrow.value && e.target.closest?.('.bd-keys')) {
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
  // 窄屏不摆"起点那一格"：封面在左侧抽屉里，不参与入场（见 playEnter 的窄屏分支）。
  // 墙角模式同理不摆 —— 它不做 FLIP，而"起点那一格"会把内层钉成 position: fixed，
  // 在带 rotateY 的父级里连包含块都变了，封面会整块跑到面板外面（那一面全黑）。
  if (!isNarrow.value && !isCorner.value) stageCover();
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

// ⚠ 原来这里有一条"抽屉拉开时收起底部 Dock"的 watch（往 <html> 挂 bd-cover-open）。
//   封面改成整屏背景之后**没有这一条了**：背景什么时候都在，底部那条 Dock 也就不该
//   跟着谁隐身 —— 那只会变成"菜单莫名消失"。那个类全文只有这一页用过，
//   所以两处引用（这里 + 样式里那条 .dock 规则）删掉就干净了，别处不用找。

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
  bgOn.value = true;  // 每次进来都是"看到照片"那一档；要安静读书自己点那颗键
  gsap.set(panelRef.value, { clearProps: 'opacity' });
  scheduleEnter();
});

onDeactivated(() => {
  solidifyHeader(false);
  bgOn.value = true;  // 同上：留给下一次进来的是默认那一档，不是上次点过的状态
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
    // 窄屏封面背景：自动化断言用（tools/blog-shots.mjs 那一路）
    bg: () => ({ on: bgOn.value, narrow: isNarrow.value }),
    setBg: (v) => { bgOn.value = !!v; },
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
      :class="{ 'is-bg-off': !bgOn, 'is-corner': isCorner, 'is-coverview': isCoverView }"
      :style="{
        '--corner': `${cornerAngle}deg`,
        '--room-zoom': `${roomZoom}`,
        '--room-pitch': `${roomPitch}deg`,
        '--room-shift': `${roomShift}%`,
        '--cv-title-x': `${cvTitleX}vw`,
        '--cv-title-y': `${cvTitleY}vh`,
        '--cv-font': cvFontCss.css,
        '--cv-font-spacing': cvFontCss.spacing,
        '--cv-font-transform': cvFontCss.transform,
      }"
      @touchstart.passive="onTouchStart"
      @touchend.passive="onTouchEnd"
      @pointermove="onTiltMove"
      @pointerleave="onTiltLeave"
    >
      <!-- 墙角视图的控件：夹角 + 摊平。只在墙角模式下出现，压在最下面一行。 -->
      <div v-if="anyView" class="bd-corner-ctl">
        <button
          class="bd-corner-flat"
          type="button"
          :disabled="!isCorner"
          @click="goView('cover')"
        >COVER</button>

        <!-- 封面视图：这里是"标题位置"的两根；墙角那四根（夹角/缩放/上下/俯仰）只在墙角模式下有意义 -->
        <template v-if="isCoverView">
          <span class="bd-corner-lbl">TEXT X</span>
          <input
            v-model.number="cvTitleX"
            class="bd-corner-range is-cv"
            type="range"
            min="-10"
            max="70"
            step="0.5"
            aria-label="标题水平位置"
          >
          <span class="bd-corner-val">{{ cvTitleX }}vw</span>
          <span class="bd-corner-lbl">TEXT Y</span>
          <input
            v-model.number="cvTitleY"
            class="bd-corner-range is-cv"
            type="range"
            min="2"
            max="80"
            step="0.5"
            aria-label="标题垂直位置"
          >
          <span class="bd-corner-val">{{ cvTitleY }}vh</span>

          <!-- 字形：站内已加载的三套，点一下就换（直角、hairline，和别的控件同一套语言） -->
          <span class="bd-corner-lbl">FONT</span>
          <span class="bd-fonts">
            <button
              v-for="f in CV_FONTS"
              :key="f.id"
              class="bd-font"
              type="button"
              :class="{ 'is-on': cvFont === f.id }"
              :style="{ fontFamily: f.css }"
              @click="cvFont = f.id"
            >{{ f.label }}</button>
          </span>
        </template>

        <template v-if="!isCoverView">
        <span class="bd-corner-lbl">CORNER</span>
        <input
          v-model.number="cornerAngle"
          class="bd-corner-range"
          type="range"
          min="60"
          max="180"
          step="1"
          aria-label="夹角"
        >
        <span class="bd-corner-val">{{ cornerAngle }}°</span>

        <span class="bd-corner-lbl">ROOM</span>
        <input
          v-model.number="roomZoom"
          class="bd-corner-range is-room"
          type="range"
          min="0.4"
          max="1.2"
          step="0.01"
          aria-label="整体缩放"
        >
        <span class="bd-corner-val">{{ Math.round(roomZoom * 100) }}%</span>

        <span class="bd-corner-lbl">SHIFT</span>
        <input
          v-model.number="roomShift"
          class="bd-corner-range is-shift"
          type="range"
          min="-40"
          max="40"
          step="1"
          aria-label="视角上下"
        >
        <span class="bd-corner-val">{{ roomShift }}%</span>

        <span class="bd-corner-lbl">PITCH</span>
        <input
          v-model.number="roomPitch"
          class="bd-corner-range is-pitch"
          type="range"
          min="0"
          max="24"
          step="1"
          aria-label="俯视角度"
        >
        <span class="bd-corner-val">{{ roomPitch }}°</span>
        </template>

        <button class="bd-corner-flat" type="button" @click="goView(null)">FLAT</button>
      </div>

      <!-- 墙组：房间（.blog-detail）铺满视口、不动；**缩放与俯仰作用在这一层**，
           所以调小的是"里面的两堵墙"，房间那个空间本身一直是满的。
           平铺模式下它就是一层普通容器（网格布局挂在它身上，和原来一模一样）。 -->
      <div class="bd-room">
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
           已按需求去掉：退出的路是"点空白 / Esc / 浏览器返回"）。
           ⚠ 窄屏上这一块**换身份**：同一份 DOM 铺成整屏背景（见样式里那一段），
             那个"点空白返回"的热区在窄屏是 display: none（整屏都是背景，没有"空白"）。 -->
      <!-- 窄屏：压在封面背景之上、正文之下的那层压暗幕（它就是"可读性"，
           固定强度、纯装饰，不吃点击）。桌面隐藏。 -->
      <div
        class="bd-scrim"
        :class="{ 'is-on': bgOn }"
        aria-hidden="true"
      />

      <div class="bd-right">
        <!-- 封面以外的空白是"点一下返回列表"的热区。⚠ 窄屏上它是死的：
             整屏都是背景（正文面板压在上面、不透），这里由样式直接 display: none。 -->
        <div class="bd-closezone" @click="close()"></div>

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

      <!-- 窄屏：左边缘那一列小键（宽屏整列隐藏）。
           上面那颗 = 封面背景开/关；下面那颗 = 把完整封面开进站内灯箱。
           两枚装在同一个容器里，**整列竖着居中** —— 各自 fixed 定位的话，
           以后再加一颗就得重算一遍 translateY（这里踩过）。位置/尺寸/材质
           沿用原来那颗抽屉把手：正文左侧那 46px 内边距就是给这一列让位的。 -->
      <div class="bd-keys">
        <button
          class="bd-handle"
          type="button"
          aria-label="封面背景"
          :aria-pressed="bgOn"
          @click="toggleBg"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
            <path d="M3.5 3.5h8.5v17H3.5z" fill="currentColor" stroke="none" />
          </svg>
        </button>

        <!-- 完整封面：背景那张是 cover 裁切过的，想看整张（灯箱里完整不裁剪）点这颗 -->
        <button
          class="bd-full"
          type="button"
          aria-label="查看完整封面"
          @click="openFullCover"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M16 4h4v4" />
            <path d="M14 10l6-6" />
            <path d="M8 20H4v-4" />
            <path d="M4 20l6-6" />
            <path d="M16 20h4v-4" />
            <path d="M14 14l6 6" />
            <path d="M8 4H4v4" />
            <path d="M4 4l6 6" />
          </svg>
        </button>
      </div>
      </div><!-- /.bd-room -->
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
   点击那一刻 BlogsView 给 <html> 与 .shell 各挂一份 .bd-taking-cover
   （setCoverCurtain，见 useCoverHandoff），卡片落地后由 playEnter 的收尾摘掉；
   退场那一趟由 close() 再挂一次（见那里的注释）。
   列表本身在详情挂上来的时候就被 keep-alive 从文档里摘走了（所以背后不会看到它），
   这里管的是**列表自己那几个块** —— 飞行途中只该看见那张正在变大的照片。
   ⚠ 站点 header / 主题键 / 作者区 / 播放器键**不在这里**：它们挂在 .shell 下，
   会被 App.vue 的 `.shell.is-ready > …`（1,3,0）以权重压掉 —— 那几条写在下面
   一样是死规则。真正生效的那份在 App.vue，别搬回来。 */
:global(html.bd-taking-cover .jb-wordmark),
:global(html.bd-taking-cover .jb-rail),
:global(html.bd-taking-cover .jb-end),
:global(html.bd-taking-cover .music-player),
/* 轨道上"其余那些卡片"一起淡出。被点的那张带 .is-flying，不在这条规则里 ——
   它要一直亮着，等详情页那张封面从同一个矩形接手，否则中间会空一帧。
   ⚠ 时长要和 BlogsView 里那一拍的等待（TAKEOVER_MS = 240ms）对齐：路由会在
   那一拍结束时换页、列表随之被摘出文档，淡出必须在这之前演完。
   （站点 header 那几件的淡出在 App.vue —— 它们被那边的 .shell.is-ready 规则
     以权重压住，写在这里一样输，见那里的注释。） */
:global(html.bd-taking-cover .jb-card:not(.is-flying)) {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.24s ease;
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

/* ⚠ 这里原来有一条 `html.bd-cover-open .dock { opacity: 0 }`（拉开封面抽屉时把底部
   那条 Dock 收起来）。封面改成整屏常驻背景之后**没有这个状态了** —— 背景一直都在，
   Dock 没有任何理由跟着隐身。那个类全文只有这一页挂过，所以随 JS 一起删干净了。 */

/* ══ 覆盖层 ══════════════════════════════════════════════════════════════
   ⚠ 覆盖层整体**不设背景**：动画开始时列表要能透出来（封面就是从那里长过来的）。
   ⚠ main.css 里有一条全局的 .blog-detail（140px 内边距 / max-width 900px），
   这里用 scoped 的同名规则（属性选择器提权）盖掉。 */
.blog-detail {
  /* 站点 header 是 fixed 的（实测高 88px，见 main.css 的 header 规则）。
     两级内容都要从它下面开始，否则会和 HOME BLOGS STATS 叠在一起
     （header 是透明的，两层字会直接糊住）。 */
  --bd-top: 88px;
  /* 正文两侧的呼吸位，以及**版心**（.bd-info 的 max-width）。
     ⚠ 版心刻意保持 46rem − 两侧呼吸位 = 624px：这是改之前实测的行宽，
     这次只挪位置、不改行长（要调行宽就改这一个数，别去动 .bd-info 的算式）。 */
  --bd-gutter: 56px;
  --bd-measure: calc(46rem - var(--bd-gutter) * 2);
  position: fixed;
  inset: 0;
  z-index: 60; /* 头部是 100，面板从它下面滑过 */
  display: block;
  padding: 0;
  max-width: none;
  margin: 0;
  background: transparent;
}

/* ══ 墙角视图 ══════════════════════════════════════════════════════════
   同一份内容换个摆法：正文与封面各绕**中间那条共用的竖边**折起来，
   夹角由 --corner 控制（180° = 原来的平铺，越小越"墙"）。
   ⚠ 方向：两块都朝**远处**折 —— 共用那条边离观众最近、两侧往外退开，
     就是"站在房间里看墙角"（凹）。反过来折是站在墙角**外面**看（凸），那不是要的效果。
   · transform-origin 必须取那条共用的边（正文取右缘、封面取左缘），两块才拼得上、不留缝；
   · 折起来之后整个画面就是 3D 的（perspective 挂在容器上）；
   · ⚠ 生效期间父级有 transform —— 所以这一模式下不做封面的 FLIP（见 playEnter）。
   夹角的可调范围 60°～180°，默认 120°。 */
.blog-detail.is-corner {
  /* 「房间」：底色跟着主题走 —— 暗色是黑、亮色是白，空间里只剩那两块墙。
     （不是新颜色，就是站点的 --bg，所以主题一换它跟着换。） */
  background: var(--bg);
  perspective: 1900px;
  perspective-origin: 50% 44%;
  /* 两堵墙折起来之后会越过视口边界，一是顶出屏幕、二是撑出滚动条 —— 直接裁掉。
     ⚠ 房间本身**不缩放**：它是那个"空间"，铺满视口一直不动。 */
  overflow: hidden;
  /* 当前夹角就是滑杆给的那个（不再叠鼠标偏移） */
  --corner-now: var(--corner, 153deg);
}

/* 封面那一列/它的盒子也不许出现滚动条（有些环境里"列比图宽"会把内容撑出滚动条）。
   ⚠ 宁可裁掉也不要滚动条：这一列是展示用的，不是滚动区。 */
.blog-detail.is-corner .bd-right,
.blog-detail.is-corner .bd-cover {
  scrollbar-width: none;
  -ms-overflow-style: none;
  overflow: hidden;
}

.blog-detail.is-corner .bd-right::-webkit-scrollbar,
.blog-detail.is-corner .bd-cover::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

/* 右侧封面那一列（以及它里面的盒子）**任何模式下都不许有滚动条**：
   它是展示用的，不是滚动区；一旦被撑出滚动溢出，那条滚动条会直接压在封面上。
   宁可裁掉，也不要它。 */
.bd-right,
.bd-cover {
  scrollbar-width: none;
  -ms-overflow-style: none;
  overflow: hidden;
}

.bd-right::-webkit-scrollbar,
.bd-cover::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

/* 墙角模式下**不许有滚动条**：正文那一列自己滚，滚动条藏起来（和普通详情同一套），
   另外整个房间 overflow: hidden（上面），所以页面上不会冒出任何一条。
   （`html`/`body` 的 overflow 在进入详情时就锁成 hidden 了，这里是双保险。） */
.blog-detail.is-corner .bd-panel-inner {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.blog-detail.is-corner .bd-panel-inner::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

/* 缩放 / 俯视都作用在**墙组**上：调小看到的是"里面的两块墙变小了"，
   房间那个空间本身不变。preserve-3d 是为了让两堵墙各自的 rotateY
   仍然在房间的透视里（否则会被这一层压平、看起来就不立体了）。 */
.blog-detail.is-corner .bd-room {
  transform-origin: 50% 50%;
  transform-style: preserve-3d;
  /* 顺序：先把机位挪到位（上下 + 左右），再俯仰、再缩放。
     ⚠ 左右那一档不是凑数：两堵墙**布局上**是居中的，但"可见内容"并不居中 ——
     正文那列内容填满（左侧只留 56px 内边距），封面那列里图比列窄、两侧还有余量，
     于是实测左边距 60px、右边距 175px（差近三倍），看着就是"右边空一大块"。
     默认 4% ≈ 把差值的一半补回来，两边各落到 ~117px。 */
  transform: translate(var(--room-shift-x, 3%), var(--room-shift, 0%))
             rotateX(var(--room-pitch, 7deg)) scale(var(--room-zoom, 0.78));

  /* ── 两块墙各自按**内容**高低，不再硬撑满高 ──────────────────────────
     正文短的时候，撑满高就是一大片留白；封面那一侧同理（列很高、图只占中间一段）。
     做法：墙组高度 auto（上限 100%），网格行按内容、两块垂直居中；
     正文太长时由 max-height 封顶，滚动交给面板内部（和普通详情一样）。 */
  /* ── 两堵墙的**宽度也按内容来** ──────────────────────────────────────
   正文有它自己的版心（约 41em），而网格给这一列的是视口的 59% —— 比版心宽出一百多
   像素，右侧就空着一条。墙角模式下改成"列宽 = 版心 + 这一列自己的内边距"，
   封面那一列同理收一档，于是墙角是两块贴着内容的板，空间留在房间四周（那是故意的）。 */
.blog-detail.is-corner .bd-room {
  /* 两列都按内容：正文是"收缩到最多 46rem"，封面是"恰好包住图" */
  grid-template-columns: fit-content(46rem) max-content;
  justify-content: center;
}

/* ⚠ 宽度必须把**这一列自己的内边距**算进去：`.bd-panel-inner` 是 `… 56px …`，
   正文版心约 737px —— 只写 46rem(736px) 的话内容比墙还宽，两侧会被裁掉
   （实测：面板 725 / 内容 733，左右都被切，看起来就是"文字跑到屏幕外、左右不持平"）。
   53rem ≈ 版心 737 + 左右各 56。 */
.blog-detail.is-corner .bd-panel {
  width: var(--corner-text-w, 53rem);
}

.blog-detail.is-corner .bd-right {
  /* 列宽**由内容决定**（见下面的 .bd-media）：这样封面四周不会留出"列比图宽"的空档 */
  width: max-content;
  max-width: var(--corner-cover-w, 34rem);
}

/* ⚠ 封面在墙角模式下改成**按高度定尺寸**：`height` 给定、宽高比反推宽度。
   原来写的是"宽度吃满这一列 + 高度上限"，图一被上限压住，宽度就收窄，
   列里剩下的那一圈就成了右侧那块空白（顺带还会撑出滚动条）。 */
.blog-detail.is-corner .bd-media {
  height: min(66vh, 30rem);
  width: auto;
  max-height: 100%;
}

.blog-detail.is-corner .bd-media__inner img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* ⚠ 高度必须**确定**（100%），不能写 auto：子级的 `max-height: 100%` 是相对
     父级高度算的，父级 auto 时那个百分比直接失效 —— 正文会长到几千像素被房间裁掉
     （实测 3671px），反而看不全。这里给满高 + align-items:center，
     两块墙各自按内容高度、在房间里垂直居中；太长的那块由 max-height 封顶、内部滚动。 */
  height: 100%;
  align-items: center;
}

.blog-detail.is-corner .bd-panel,
.blog-detail.is-corner .bd-right {
  height: auto;
  max-height: 100%;
}

/* ⚠ inner 才是滚动容器，而这堵墙的高度是"按内容"的（auto）——
   百分比上限对着 auto 父级会**直接失效**（基类那句 height:100% 也一起失效），
   结果就是 inner 长到内容那么高、被面板裁掉且滚不动（实测面板 896 / inner 3671）。
   所以这里给它一个**确定**的上限：视口高 − 面板的上下内边距（--bd-top + 96）＝
   这堵墙真正能用的高度。短正文还是按内容（不封顶就不会有留白感）。 */
.blog-detail.is-corner .bd-panel-inner {
  max-height: calc(100vh - var(--bd-top, 88px) - 96px);
}

/* ⚠ 墙角模式下**不做**"正文块收缩 + 居中"：那一堵墙的宽度是刻意定死的 53rem
   （= 正文版心 + 两侧各 56，见上），正文就该去吃满它。套上 .bd-info 那套之后，
   文字会缩回 --bd-measure(624)、墙却还是 53rem —— 墙里两侧空出一条，
   而且上面那段算式注释就全对不上了。 */
.blog-detail.is-corner .bd-info,
.blog-detail.is-corner .bd-out-inner {
  width: auto;
  max-width: none;
  margin-inline: 0;
}

/* 封面列不再占满高：高度由图片自己的比例定（图的宽度仍吃满这一列） */
.blog-detail.is-corner .bd-cover {
  height: auto;
  max-height: 100%;
}

/* 角度只由滑杆改：给一点阻尼，拖滑杆时两堵墙是"转过去"而不是跳过去 */
.blog-detail.is-corner .bd-panel,
.blog-detail.is-corner .bd-right {
  transition: transform 0.18s ease-out;
}

.blog-detail.is-corner .bd-panel {
  transform-origin: 100% 50%;
  transform: rotateY(calc((180deg - var(--corner-now)) / 2));
}

.blog-detail.is-corner .bd-right {
  transform-origin: 0% 50%;
  transform: rotateY(calc((180deg - var(--corner-now)) / -2));
}

/* ══ 封面视图 ══════════════════════════════════════════════════════════
   只留封面：放大到屏幕中间（高度占八成视口，宽度按图自身的比例），
   标题**错位**压在它的斜上方（不是正中）—— 标题偏左、封面略偏右下，
   再给封面一点倾角与投影，读起来就是"照片浮在标题前面"，立体感来自这个错位。
   ⚠ 倾角同样是父级 transform：这一模式下不做 FLIP（见 playEnter 里的判断）。 */
.blog-detail.is-coverview {
  display: block;
  background: var(--bg);
  overflow: hidden;
  perspective: 2000px;
}

.blog-detail.is-coverview .bd-right {
  position: absolute;
  inset: 0;
  width: auto;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 封面整体往右下让一点，和标题错开 */
.blog-detail.is-coverview .bd-cover {
  width: auto;
  height: auto;
  max-height: none;
  transform: translate(4%, 3%);
}

.blog-detail.is-coverview .bd-media {
  height: 82vh;
  width: auto;
  max-width: 78vw;
  max-height: none;
  /* 一点倾角 + 投影：照片"立"起来一点，和标题形成前后关系 */
  transform: rotateY(-7deg) rotateX(2.5deg);
  transform-origin: 50% 50%;
  box-shadow: 0 4rem 6rem color-mix(in srgb, var(--jb-shadow, #000) 45%, transparent);
  border-radius: 2px;
}

/* 标题层：只留标题，压在封面斜上方 */
.blog-detail.is-coverview .bd-panel {
  position: absolute;
  inset: auto;
  /* 位置由下面那两根滑杆驱动（见控件条） */
  left: var(--cv-title-x, 6vw);
  top: var(--cv-title-y, 15vh);
  z-index: 2;
  width: auto;
  height: auto;
  background: none;
  border: 0;
  pointer-events: none;
}

.blog-detail.is-coverview .bd-panel-inner {
  height: auto;
  max-height: none;
  padding: 0;
  overflow: visible;
}

/* 封面视图里这一层只剩标题，位置由滑杆给（left/top），所以同样不做收缩 + 居中 ——
   不然标题会被 --bd-measure 那 624px 卡一刀，和滑杆的定位搅在一起。 */
.blog-detail.is-coverview .bd-info,
.blog-detail.is-coverview .bd-out-inner {
  width: auto;
  max-width: none;
  margin-inline: 0;
}

/* 标题以外的正文/日期先收掉（这一模式只讲"标题 + 封面"） */
.blog-detail.is-coverview .bd-panel .blog-meta,
.blog-detail.is-coverview .bd-panel .blog-detail-content {
  display: none;
}

.blog-detail.is-coverview .blog-detail-title {
  font-family: var(--cv-font, 'Oswald', sans-serif);
  letter-spacing: var(--cv-font-spacing, 0.02em);
  text-transform: var(--cv-font-transform, uppercase);
  font-size: clamp(2.2rem, 4.6vw, 4.6rem);
  line-height: 1.05;
  max-width: 46vw;
}

/* 字形切换：三个小方钮，当前那个反白 */
.bd-fonts {
  display: inline-flex;
  gap: 0.35rem;
}

.bd-font {
  padding: 0.18rem 0.5rem;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.6rem;
  font-weight: 500;
  letter-spacing: 0.12em;
  cursor: pointer;
  transition: color 0.25s ease, border-color 0.25s ease, background 0.25s ease;
}

.bd-font:hover {
  color: var(--text-primary);
  border-color: var(--text-secondary);
}

.bd-font.is-on {
  background: var(--text-primary);
  border-color: var(--text-primary);
  color: var(--bg);
}

/* ── 墙角视图的控件：一条极简的滑杆 + 摊平 ────────────────────────────── */
/* 打字机光标是 position: fixed 的：墙角模式下父级带 transform，它会跑到奇怪的
   位置（实测在封面那一侧冒出一个小方块）。这一模式下直接不显示 —— 字还在照常敲。 */
.blog-detail.is-corner .tw-caret {
  display: none;
}

.bd-corner-ctl {
  position: fixed;
  left: 50%;
  bottom: 1.4rem;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 0.9rem;
  padding: 0.5rem 0.9rem;
  /* 直角 + 一条 hairline：和站内其余 mono 小标签同一套语言 */
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg) 86%, transparent);
  backdrop-filter: blur(8px);
  transform: translateX(-50%);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.62rem;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

/* 标签里的空格不许折行："TEXT X" 被挤成两行就难看了（它们没有各自的样式，
   全靠从控件条继承，所以这条得单独写） */
.bd-corner-lbl,
.bd-corner-val {
  white-space: nowrap;
}

.bd-corner-range {
  width: 6.5rem;
  accent-color: var(--text-primary);
}

.bd-corner-range.is-room {
  width: 4.5rem;
}

.bd-corner-range.is-pitch {
  width: 3.5rem;
}

.bd-corner-range.is-shift {
  width: 4rem;
}

.bd-corner-range.is-cv {
  width: 5rem;
}

.bd-corner-ctl .bd-corner-lbl + .bd-corner-val {
  min-width: 2.9rem;
}

/* 窄屏：这一排会太长，让它能换行 */
@media (max-width: 900px) {
  .bd-corner-ctl {
    flex-wrap: wrap;
    justify-content: center;
    max-width: min(92vw, 30rem);
  }
}

.bd-corner-val {
  min-width: 2.6rem;
  text-align: right;
  color: var(--text-primary);
}

.bd-corner-flat {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-secondary);
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
}

.bd-corner-flat:hover {
  color: var(--text-primary);
}

/* 墙组：平铺模式下它就是原来的那个网格；墙角模式下它是被缩放/俯仰的那一层。
   ⚠ 左右这一道内收边距是**两种模式共用**的：正文与封面都从这里往里收，
   于是"内容距左边缘"和"内容距右边缘"天然相等（这是用户要的"左右持平"）。 */
.bd-room {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding-inline: var(--bd-side, 3vw);
  display: grid;
  /* 左列 = **max(46rem, 一半)**：宽屏上"正文那一堵墙"就是屏幕左半边（分割线正落在
     中线），1440 及以下退回 46rem。
     ⚠ 从 `fit-content(46rem)` 改过来的（用户要求"正文在左侧区域里居中"）：
     原来那一列**跟着内容收缩** —— 短诗（硬换行）会把面板收到只有最长那一行宽、
     整块贴死在屏幕左缘，右边空一大片。（当初用 fit-content 是为了不让短内容背后
     空出一大片，但它只把空白甩到了面板右侧、把文字顶到屏幕最左边。）
     现在定宽 + 内容自己在列内居中，见 .bd-info。 */
  grid-template-columns: minmax(46rem, 1fr) minmax(0, 1fr);
  align-items: stretch;
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
  padding: var(--bd-top) var(--bd-gutter) 96px;
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
  padding: 0 var(--bd-gutter);
  background: var(--bg);
}

/* ⚠ 收敛 + 居中的那三条必须和 .bd-info 一模一样：这两段是**重叠 0.35s 的交叉淡**，
   差一个像素都会看到旧文字"横跳"一下再消失。 */
.bd-out-inner {
  padding-top: calc(var(--bd-top) + 26px); /* 和面板里正文起始位置对齐 */
  width: fit-content;
  max-width: var(--bd-measure);
  margin-inline: auto;
  will-change: transform;
}

/* ══ 打字机 ══════════════════════════════════════════════════════════════
   正文容器**从第一帧就是透明的**：打字要等面板亮到差不多才开始（TYPE_AT ≈ 0.78s），
   而"包字符"这件事也在 startTyping 里做 —— 不在这儿先藏起来的话，那 0.78 秒里
   整篇文字是原样完整显示着的，然后才突然变成逐字敲（用户看到的"先完整显示一秒"）。
   ⚠ 和 .bd-panel 一样是"初值"，之后由 GSAP 写行内 opacity 接管。 */
.bd-info {
  opacity: 0;
  /* ── 正文块在左列里水平居中 ────────────────────────────────────────────
     `width: fit-content` 是这里的关键：块按**自身最宽那一行**收缩，再靠 auto
     外边距在中线左右对称 —— 短诗（硬换行）因此不再贴屏幕左缘，而是左右留白相等；
     长散文的 max-content 远超版心，照旧停在 --bd-measure（一行都不会变长）。
     只写 `max-width` 而不收缩块宽的话，诗句仍然左对齐在块里、右侧一片空白，
     看起来一点没居中（试过）。 */
  width: fit-content;
  max-width: var(--bd-measure);
  margin-inline: auto;
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
/* 窄屏那套"封面背景 + 左边缘那一列小键"在宽屏根本不存在（宽屏走的是右列封面 +
   从列表那一格飞过来，封面本来就是完整显示的），所以这里先整体关掉，
   样式全在下面的窄屏块里。 */
.bd-scrim,
.bd-keys {
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

/* ══ 窄屏：正文压在**封面背景**上 ════════════════════════════════════════
   和宽屏那套"左正文 / 右封面 + 封面从列表飞过来"是两条独立的路：
   窄屏先给完整正文，封面铺成**固定不滚的整屏背景**，上面压一层固定强度的暗幕、
   正文切成浅色字（用户定的"固定压暗 + 浅色字"），左边缘那颗键只负责"背景开/关"。
   JS 那边按同一个断点走 isNarrow 分支（playEnter / close / stageCover）。
   ⚠ 这套是**替换**掉原来的"左侧抽屉 + 边缘把手（点/拖拉出来）"那一套的：
     凡是还写着 --cover-open / --cover-w / is-cover-open / is-cover-dragging 的地方
     都已经跟着删干净了，别只把某一条改回去 —— 那套的驱动量已经不存在了。 */
@media (max-width: 1024px) {
  .blog-detail {
    --bd-top: 0px;
    /* 背景照片上的压暗层强度。**固定值、不跟主题走** —— 因为这一档的字色也
       一起钉成浅色（见下）。要调"照片看得清 / 字看得清"的档位就改这一个数。 */
    --bd-photo-scrim: rgba(0, 0, 0, 0.55);
    display: block; /* 不再分"封面上 / 正文下"两行 */
    /* 这一页自己的底色：背景照片关掉（.is-bg-off）时露出来的就是它 */
    background: var(--bg);
  }

  /* ── 压在照片上读正文：字色**固定浅色**（不管主题）──────────────────────
     ⚠ 两条都得写：变量管的是显式写 var(--text-*) 的那些（日期、正文、引用线、
       打字光标），color 管的是**继承**来的那些 —— 标题自己没有 color 规则，
       直接继承 body，只改变量的话它在亮色主题下还是深色，压在照片上就是一团糊。 */
  .blog-detail:not(.is-bg-off) .bd-panel {
    --text-primary: #fff;
    --text-secondary: rgba(255, 255, 255, 0.76);
    color: var(--text-primary);
  }

  /* 正文这一层铺满整屏，而且**透明**：照片在它底下（关掉背景时露出的才是 --bg） */
  .bd-panel {
    position: absolute;
    inset: 0;
    z-index: 3;
    border-right: 0;
    background: transparent;
  }

  /* 顶部要让开站点 header（fixed，88px），底部要让开那条"空格键"Dock（68px）——
     正文是这一个滚动容器里的内容，Dock 直接压在它上面。
     左边额外让出 46px：左边缘那一列小键是 fixed、竖着居中，正文按 24px 排的话
     中间那几行会被它压住字头。46 = 键 28 + 18 的间隙。 */
  .bd-panel-inner {
    padding: 104px 24px 96px 46px;
  }

  .bd-out {
    /* 左内边距和上面 .bd-panel-inner 对齐，交叉淡的时候两段字才在同一条线上。
       底色必须透明：宽屏那份给的是 var(--bg)，压在照片上就是"整屏忽然黑一下"。 */
    padding: 0 24px 0 46px;
    background: transparent;
  }

  .bd-out-inner {
    padding-top: 130px; /* 和上面正文的起始位置对齐 */
  }

  /* 窄屏不吃"收缩 + 居中"那一套：这一档没有左右两列，正文就该吃满可用宽度
     （套上版心 624 会让散文/图片块在平板上反而变窄）。 */
  .bd-info,
  .bd-out-inner {
    width: auto;
    max-width: none;
    margin-inline: 0;
  }

  /* ── 封面 = 整屏背景（固定不滚）────────────────────────────────────────
     固定而不是随内容滚：长文滚到中段时照片还在后面；随滚的话"背景"只在开头
     那一屏看得到。object-fit: cover 铺满、裁掉多余部分（不再是"完整显示封面"）。
     关掉背景整层淡出（露出来的就是上面那个 --bg），而不是 display: none ——
     淡出读起来才是"背景关掉了"，硬切会闪一下。 */
  .bd-right {
    position: fixed;
    inset: 0;
    width: auto;
    z-index: 1;
    padding: 0;
    border: 0;
    background: #000; /* 图还没解码出来那几帧是黑的，不是站点底色 */
    box-shadow: none;
    transform: none;
    pointer-events: none; /* 背景只是背景：不参与点击（正文那一层在它上面） */
    transition: opacity 0.3s ease;
  }

  .blog-detail.is-bg-off .bd-right {
    opacity: 0;
  }

  /* 整屏都是背景，"点封面以外的空白返回列表"这个热区在窄屏没有意义 */
  .bd-closezone {
    display: none;
  }

  .bd-cover {
    width: 100%;
    height: 100%;
  }

  .bd-media {
    width: 100%;
    height: 100%;
    aspect-ratio: auto;
    max-height: none;
  }

  .bd-media__inner img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* 窄屏上封面是**可见**的（宽屏那套由 GSAP 逐帧写 opacity，初值是 0） */
  .bd-media__inner {
    opacity: 1;
  }

  /* ── 暗幕：照片之上、正文之下。固定强度、纯装饰（不吃点击）───────────── */
  .bd-scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 2;
    background: var(--bd-photo-scrim);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: opacity 0.3s ease, visibility 0.3s ease;
  }

  .bd-scrim.is-on {
    opacity: 1;
    visibility: visible;
  }

  /* ── 左边缘那一列小键（上：背景开/关；下：看完整封面）──────────────────
     整列竖着居中，定位挂在**容器**上、不挂在按钮上 —— 每颗各自 fixed 的话，
     加一颗就得重算一次 translateY。
     位置/宽度/毛玻璃沿用原来那颗抽屉把手（正文左侧留的 46px 就是给这一列让位的）。
     压在照片上时改成浅色 hairline + 深玻璃：亮色主题下用主题色的话，
     它会在照片上变成一条看不见的白线。 */
  .bd-keys {
    display: flex;
    flex-direction: column;
    gap: 8px;
    position: fixed;
    left: 0;
    top: 50%;
    z-index: 9;
    transform: translateY(-50%);
  }

  /* 两颗键共用这一套外观（只有高度不同）；48px 高也是触摸下点得中的下限 */
  .bd-keys button {
    width: 28px;
    height: 48px;
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
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
  }

  .blog-detail:not(.is-bg-off) .bd-keys button {
    color: #fff;
    border-color: rgba(255, 255, 255, 0.3);
    background: rgba(0, 0, 0, 0.3);
  }

  .bd-keys svg {
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
