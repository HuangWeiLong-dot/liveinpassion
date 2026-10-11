<script setup>
// 博客列表 —— 重做成 https://tlb.betteroff.studio/ 主页那种「全屏横向 lookback 轮播」：
//   · 版心是一整条可拖拽/横滚的竖幅图卡轨道（占满视口，无页面纵向滚动）
//   · 顶部一枚超大字号字标（就是板块名 blogs 本身）压在卡片上方
//   · 卡片编号常显于图上方、标题悬停时从图下方滑出（旧站的 label 交互）
//   · 底部一条 hairline 进度条 + 等宽字计数器
//
// 几点局部实现上的取舍（不是偷懒，都是有原因的）：
//   1. 不用 mix-blend-difference。旧站那张白字压在照片上是漂亮的，但一旦卡片滑开、
//      底下只剩白背景，字就整片消失。这里改成正文色 + 逐行揭幕，任何情况下都读得到。
//   2. 图片仍然走 loadImage（data-src 压缩图）；这里额外把 loadOnVisible 换成
//      以轨道为 root 的 IntersectionObserver —— 全局那个 observeGalleryItems 是单例，
//      会 disconnect 掉别的页面的观察器，横向轨道也不能靠它（它只 observe .gallery-item）。
//   3. 图片加载前先垫一块由 slug 推出的低饱和色（旧站 media__bg 的做法），
//      所以不会出现 21 个灰骨架同时杵着。
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { blogPosts } from '../data/blogPosts.js';
import { gsap } from 'gsap';
import { loadImage } from '../composables/useImageLoader.js';
import { skipNextPageTransition } from '../composables/usePageTransition.js';
import { rememberCoverHandoff, consumeReturningFromDetail } from '../composables/useCoverHandoff.js';
// 胶片那层：FILM / focalOf / poseAt / cssMatrix 是**纯数学**（不带 three，静态引入零成本），
// 只有 createFilmStrip 里头才动态 import three（见那个文件的头注释）。
import {
  FILM, focalOf, poseAt, cssMatrix, ringRadius, createFilmStrip,
} from '../composables/useFilmStrip.js';
import AppFooter from '../components/AppFooter.vue';

const route = useRoute();
const router = useRouter();

const scroller = ref(null);
const filmCanvas = ref(null);
const activeIndex = ref(0);
const progress = ref(0);
const dragging = ref(false);
const opening = ref(false);

const total = computed(() => blogPosts.length);

// ── 无限循环 ────────────────────────────────────────────────────────────
// 轨道里把这一套卡片**铺 3 份**，滚动位置始终圈在中间那一份里（见 wrapLoop）。
// 三份内容逐像素相同（同一份 flex 布局、同样的间距），所以"整体平移一个周期"
// 等于画面原地不动 —— 这就是接缝看不见的原因，也让"无限滚"不需要任何取巧动画。
const LOOP_COPIES = 3;
// 底部时间线的刻度标签：每 6 篇一个，标签用这一篇的真实日期（"OCT 10"）。
// 数据里 cardDate 形如 "OCTOBER 10, 2026 · 11:55 PM"，取前两段就够。
// 当前这一篇的发布日期（时间线上那个"随时间读出的读数"）。直接取数据里的 cardDate，
// 形如 "OCTOBER 10, 2026 · 11:55 PM" → 缩成 "OCT 10, 2026"。
const activeDate = computed(() => {
  const raw = String(blogPosts[activeIndex.value]?.cardDate || '');
  const m = raw.match(/^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),\s*(\d{4})/);
  return m ? `${m[1].toUpperCase()} ${m[2]}, ${m[3]}` : '';
});

const tlMarks = computed(() => {
  const out = [];
  for (let i = 0; i < blogPosts.length; i += 6) {
    const m = String(blogPosts[i].cardDate || '').match(/^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2})/);
    out.push({ i, label: m ? `${m[1].toUpperCase()} ${m[2]}` : '' });
  }
  return out;
});
const loopCards = computed(() => {
  const out = [];
  for (let c = 0; c < LOOP_COPIES; c += 1) {
    blogPosts.forEach((post, i) => out.push({ post, i, key: `${c}-${post.slug ?? i}` }));
  }
  return out;
});
const current = computed(() => blogPosts[activeIndex.value] || null);

// 序号补零：卡片上是 01–21，计数器和进度条上也是同一套。
function pad(n) {
  return String(n + 1).padStart(2, '0');
}

// "OCTOBER 10, 2026 · 11:55 PM" → "OCT 10, 2026"。取不到就返回空串，模板里 v-if 兜住。
function monthOf(dateStr) {
  const m = String(dateStr || '').match(/^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),\s*(\d{4})/);
  return m ? `${m[1].toUpperCase()} ${m[2]}, ${m[3]}` : '';
}

// 占位色：同一篇永远是同一个颜色（构建期不需要网络、也不会闪）。
// 12 个低饱和色是照旧站 media__bg 的观感挑的。
const FALLBACK_COLORS = [
  '#c8cdd2', '#d8cfc6', '#c3ccd9', '#cfd3c8', '#d6c9cd', '#c9cdd6',
  '#d2cdc4', '#c6cfcf', '#d9d0d6', '#cbcfc9', '#cfd0d8', '#d4cbc4',
];
function toneOf(slug) {
  let h = 0;
  for (let i = 0; i < slug.length; i += 1) h = (h * 31 + slug.charCodeAt(i)) % 100003;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}

function coverStyle(post) {
  // 只留占位色，而且是**走 CSS 变量**、不是直接写 background：
  // 写死 background 是行内样式，会盖住"图片就位后把底色撤掉"那条规则
  //（见 .jb-media.has-image 的注释：hover 时那条浅灰缝就是它露出来的）。
  return { '--ph': toneOf(post.slug) };
}

// ── 点卡片 → 详情覆盖层 ────────────────────────────────────────────────────
// 这一段**不再用 View Transitions 的共享元素形变**（`blog-cover-<slug>` 那套）。
// 之前"卡顿 + 位置对不上"的根源就在这里：浏览器的共享元素快照活在**视口坐标系**里，
// 而同一时刻根快照又在做整页竖直滑动 —— 两个坐标系各动各的，封面那一格
// 在过渡中段必然和它该在的位置错开一拍，而且形变每帧都要重绘那块大图。
//
// 现在改成：列表把"被点那张卡片里封面那一格的屏幕矩形"记进 sessionStorage，
// 详情覆盖层挂载后用 **GSAP** 从那个矩形 FLIP 到封面栏里的最终位置
// （见 BlogDetailView.vue）。只有一个坐标系、一条时间线，位置天然对得上，
// 也没有快照重绘那笔开销。
// ⚠ 函数名不能叫 open：Vue 模板里 `@click="open(post)"` 对**元素**上未知的标识符
// 会回退成全局解析（编译结果就是 window.open(...)），而 window.open 恰好存在 ——
// 于是点击只是调了一次"开新窗口"，页面永远不跳，控制台也不报错。
// 这类"名字撞全局"的坑同样适用于 name / status / close / focus / top / self / print。
// 点下去之后"周围元素渐隐"的那一拍：跳转要等这段时间，否则列表会被立刻摘走、卡片来不及淡。
// ⚠ 这个数要和 BlogDetailView 里那条 `html.bd-taking-cover ... { transition: opacity ... }`
//   的时长**对齐**（现在两边都是 0.4s）：CSS 那边负责"淡"，这里负责"等它淡完再换页"。
//   只调一边的话，要么淡到一半列表就被摘走（剩下的半程没了、元素啪一下消失），
//   要么等完了还愣着不动。
const TAKEOVER_MS = 420;
// 胶片那层淡出的时长，必须和上面那条 CSS transition 是同一个数
// （CSS 管 DOM 卡片、这里管 canvas 画的封面，两边差一拍就看得出来）。
const TAKEOVER_FADE = 0.4;

function openPost(post, el = null) {
  if (opening.value || !post) return;
  opening.value = true;
  // 过渡的第一拍：**除这张卡片之外全部渐隐**（header、字标、页脚条、悬浮件，
  // 以及轨道上其余卡片）。视觉规则写在 BlogDetailView 的 scoped :global 里 ——
  // 那边才是这条过渡的归属；这里只负责在点击的这一刻把类挂上。
  document.documentElement.classList.add('bd-taking-cover');
  // ⚠ 元素必须是**被点的那个**：无限循环把每篇文章铺了三份，只用下标去找会拿到
  //   另一份（可能在屏幕外），起点矩形就错了。
  const i = blogPosts.indexOf(post);
  const clicked = el
    || cards.find((c) => Number(c.dataset.postIndex) === i)   // 探针调用时退回第一份
    || null;
  // 被点的那张**不参与渐隐**：它要一直亮着，等详情页那张封面从同一个矩形接手
  // （见 BlogDetailView 的 .jb-card:not(.is-flying)）。
  clicked?.classList.add('is-flying');
  // 胶片那层照同一条规矩来：除被点这张之外，canvas 上的封面也一起淡掉。
  // （它在 DOM 之外，CSS 那条规则管不到它，所以要单独补这一下。）
  filmFlying = clicked ? cards.indexOf(clicked) : null;
  if (film && !reduceMotion) {
    gsap.to(film.op, { v: 0, duration: TAKEOVER_FADE, ease: 'power1', overwrite: true });
  }

  // 相邻那两格也一起带过去：详情页左列是三格（上一篇/当前/下一篇），
  // 两侧的封面也从列表里各自那一格飞过去（stagger 0.035）。同样按 DOM 相邻取。
  // ⚠ 这段放在函数里、等跳转前**再跑一次**：TAKEOVER_MS 里轨道可能还在惯性滑动，
  //   起点矩形要以"跳转那一刻"的位置为准，否则封面会从旧位置起飞。
  const recordHandoff = () => {
    const di = clicked ? cards.indexOf(clicked) : -1;
    const neighbors = di >= 0
      ? [di - 1, di + 1]
        .filter((k) => k >= 0 && k < cards.length)
        .map((k) => ({
          slug: blogPosts[Number(cards[k].dataset.postIndex) || 0]?.slug,
          rect: cards[k].querySelector('.jb-media')?.getBoundingClientRect(),
        }))
        .filter((n) => n.slug)
      : [];
    // 这一页的底色也带走一份（详情页在交接这段时间要顶着同一个底色）。
    // ⚠ 现场读 .jb-stage 的计算值，别把 #0b0b0c 抄到 JS 里：那一档颜色归
    //   scoped 样式里的 --jb-bg 管，抄一份出来迟早会和主题/改色对不上。
    const stage = document.querySelector('.jb-stage');
    rememberCoverHandoff(post.slug, clicked, {
      index: i,
      listLeft: scroller.value?.scrollLeft ?? 0,
      neighbors,
      stageBg: stage ? getComputedStyle(stage).backgroundColor : null,
    });
  };
  recordHandoff();

  // 跳转等这一拍演完（TAKEOVER_MS）。不留这段时间的话路由立刻换页，keep-alive
  // 把列表整个摘出文档 —— 卡片是"啪"一下没的，根本没有渐隐可言。
  // 详情覆盖层自己负责动画；这一跳不需要路由转场，否则两套动画会打架。
  clearTimeout(holdTimer);
  holdTimer = window.setTimeout(() => {
    recordHandoff(); // 重新记一次（见上）
    skipNextPageTransition();
    router
      .push({ name: 'blog-detail', params: { slug: post.slug } })
      .catch(() => {})
      .finally(() => { opening.value = false; });
  }, TAKEOVER_MS);
}

// 触屏那一路的点击（以及卡片上的 Enter/空格）走模板绑定。
// cardNavLock 为真说明这一轮交互已经被 PointerEvent 处理过，别再跳一次。
function onCardActivate(post, e) {
  if (cardNavLock) return; // 这一轮交互已经由 PointerEvent 处理过了
  openPost(post, e?.currentTarget || null);
}

// ── 图片：只加载轨道可视范围内（含预留）的卡片 ─────────────────────────────
// ── 旧路径那批压缩图质量没保证 ──────────────────────────────────────────
// 实测：blog_photos/blog_photos_compressed/ 里 2368×1280 只给了 26KB（每像素
// 0.009 字节），糊得很明显；而它的原图 152KB，清楚得多。
// 规则：**只治旧路径那批**，且**原图尺寸不大**（宽 ≤ 2400）时才悄悄换成原图 ——
// 解码完再换 src，中间压缩图一直在，不会闪。
// 宽超过这个数的不动：那一批里 5782×4869 / 4895×6528 的原图是 27.9MB / 6MB，
// 换过去只会把"卡顿"换回来；这两张的根源是素材本身没导出好，只能重新导出。
const LEGACY_MAX_W = 2400;

function maybeUpgradeLegacy(img) {
  if (!img?.src || img.dataset.bdUpgraded === '1') return;
  const full = img.dataset.fullSrc;
  const src = img.dataset.src || '';
  if (!full || !src.includes('blog_photos_compressed')) return;
  if (!img.naturalWidth || img.naturalWidth > LEGACY_MAX_W) return;
  // 这张图的跨域加载被拒过（见 loadCoverImage）：img 上还挂着 crossOrigin，
  // 换 src 会再走一次 CORS 加载、必挂 —— 那就等于把一张好好的压缩图换成破图。
  // 就地停手，继续用现在这张。
  if (img.dataset.noTex === '1') return;
  img.dataset.bdUpgraded = '1';
  const probe = new Image();
  probe.decoding = 'async';
  probe.onload = () => {
    if (img.isConnected) img.src = full;
  };
  probe.onerror = () => { /* 原图挂了就继续用压缩图 */ };
  probe.src = full;
}

let lazyObserver = null;
let releaseObserver = null;
const loadedSet = new Set();

// ── 卡片图的加载：带 crossOrigin 那一版 ──────────────────────────────────
// 为什么不能直接 loadImage：跨域的图能显示，但**画进 canvas 会污染它**，
// 而污染过的 canvas 上传到 WebGL 会直接抛 SecurityError —— 胶片那层就拿不到贴图，
// 只能画占位色（实测：贴图 11 张全黑，控制台一路 texSubImage2D 报错）。
// 所以卡片图按 CORS 模式加载：canvas 干净，DOM 和 WebGL **共用同一次下载**。
//
// ⚠ CDN 只放行线上域名（`Vary: Origin`，实测 https://liveinpassion.me 放行、
//   http://localhost:5173 不放行）。本地 dev 上这一版会加载失败 —— 所以挂了
//   一次重试：去掉 crossOrigin 用普通方式再加载一遍。那一路页面完全正常，
//   只是胶片那层停在占位色（这正是"拿不到贴图就优雅退化"那条路）。
function loadCoverImage(img) {
  if (img.dataset.corsTried === '1') {
    loadImage(img); // 重试那一遍
    return;
  }
  img.dataset.corsTried = '1';
  img.crossOrigin = 'anonymous';
  const onError = () => {
    img.removeEventListener('error', onError);
    // loadImage 那一轮已经挂过它自己的 onerror：会藏掉图、插一条 "Loading Failed"。
    // 重试之前把这些痕迹清掉，否则图回来了、那条提示还杵在那儿。
    img.style.display = '';
    img.parentElement?.querySelectorAll('.load-error-msg').forEach((n) => n.remove());
    img.removeAttribute('crossorigin');
    // ⚠ 记一笔：这一张的像素是"污染"的（跨域且没走 CORS）。
    //   胶片那层必须**完全不碰它** —— 拿污染过的 canvas 去 texSubImage2D 会每帧抛
    //   SecurityError（实测就是这么刷屏的）；这一张就老老实实留在占位色上。
    img.dataset.noTex = '1';
    loadImage(img);
  };
  img.addEventListener('error', onError, { once: true });
  loadImage(img);
}

function observeCovers() {
  const root = scroller.value;
  if (!root || !('IntersectionObserver' in window)) {
    // 没有 IO（极老浏览器/测试环境）就退回一次全量，至少不会白屏
    root?.querySelectorAll('img[data-src]').forEach((img) => loadCoverImage(img));
    return;
  }
  lazyObserver?.disconnect();
  lazyObserver = new IntersectionObserver(
    (entries) => {
      const queue = [];
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const img = entry.target.querySelector('img[data-src]');
        if (img && !loadedSet.has(img)) {
          loadedSet.add(img);
          queue.push(img);
        }
        lazyObserver.unobserve(entry.target); // 一次就够，别反复触发
      });
      loadInBatches(queue);
    },
    { root, rootMargin: '0px 120% 0px 120%' } // 左右各预留一屏，滑到就有图
  );
  root.querySelectorAll('.jb-card').forEach((card) => lazyObserver.observe(card));

  // ── 释放远处卡片的解码位图（治"滑到 20/22 那几篇极卡"）──────────────────
  // 旧博客那批"压缩图"有的高达 5782×4869 / 4895×6528 —— 解一次就是 110–128MB
  // 的位图。三份铺开之后，同一篇文章的另一份还远在屏幕外，位图却一直驻留；
  // 滑过那几篇时浏览器开始换入换出，帧就崩了。
  // 做法：离开视野够远（±3 屏）就把 src 撤掉、把 .loaded / .has-image 复位 ——
  // 位图随之释放；回头再滑过来时加载观察器会重新加载（HTTP 缓存命中，
  // 只是再解一次，不会重新下载）。
  releaseObserver?.disconnect();
  releaseObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) return;
        const img = entry.target.querySelector('img');
        if (!img || !img.classList.contains('loaded')) return;
        img.removeAttribute('src');
        img.classList.remove('loaded');
        img.classList.add('blur-placeholder');
        img.dataset.loading = 'false';
        loadedSet.delete(img);
        const parent = img.parentElement;
        if (parent) parent.classList.remove('has-image', 'wide', 'tall');
        lazyObserver?.observe(entry.target); // 让加载观察器重新盯着它
      });
    },
    { root, rootMargin: '0px 300% 0px 300%' } // 比加载那一圈宽得多，别刚放手就又拉回来
  );
  root.querySelectorAll('.jb-card').forEach((card) => releaseObserver.observe(card));
}

// 每批 2 张、批与批之间再隔一拍。
// ⚠ 站内其它画廊是"每帧 4 张"，这里刻意更保守：旧博客那批有的单张就是
// 5782×4869（一解上百毫秒），4 张挤在一帧里会直接拉出长帧。
function loadInBatches(list) {
  let cursor = 0;
  (function next() {
    list.slice(cursor, cursor + 2).forEach((img) => loadCoverImage(img));
    cursor += 2;
    if (cursor < list.length) setTimeout(() => requestAnimationFrame(next), 40);
  })();
}

// ── 平滑滚动 + 卡片微倾 ────────────────────────────────────────────────────
// 一条 rAF 主循环负责三件事，全都跟 scrollLeft 有关，分开写会重复读布局：
//   a) 惯性：滚轮/甩出去只改 target，真实 scrollLeft 每帧追一部分
//      （拖拽期间不走这条路 —— 那一段由指针 1:1 直接驱动，见 onPointerMove）
//   b) 微倾：卡片按"离视口中心多远"绕 Y 轴转 ±MAX_TILT，同时轻微后退
//      —— 边缘的卡片斜着退开，视觉上就成了一个弧面（旧站 carousel 的透视感）
//   c) 读数：进度条 / 计数器（只在这些值真变了时才改 ref，避免每帧触发渲染）
//
// ⚠ 逼近系数必须按**时间**算，不能按帧：
//   一开始写的是每帧 scrollLeft += diff * 0.115，在 60Hz 上没问题，一上 120Hz
//   追赶速度直接翻倍（每帧都追一次），144Hz 就更"急" —— 同一份代码在不同刷新率
//   的机器上是三种手感，高刷屏上还会显得顿。
//   改成 rate = 1 - (1 - TOUCH)^(dt/16.67)：60Hz 下与原来逐帧等价，
//   其它刷新率自动折算。
const TOUCH = 0.115;     // 60Hz 下每帧逼近目标的比例（基准确认值）：滚轮 / 键盘
// 甩出去（拖拽松手）单独松一档：同样的松手速度，滑行距离从 8.7 倍提到 13 倍左右。
// 惯性要"大"，靠的不是松手瞬间加一脚油门（那会让轨道一顿再窜），而是**衰减得更慢** ——
// 滑行距离 = v / 这个系数，系数小一点，同样的甩劲就多滑出半张卡。
// 代价是尾巴更长：一次快甩大约 1.3～1.5s 收尾（原来 ~0.9s）。
const FLING_TOUCH = 0.075;
let approach = TOUCH;    // 当前这一段用的逼近系数（每次 setTarget 覆盖）
const FRAME_REF = 16.6667;
const MAX_STEP = 50;     // dt 上限（ms）：切标签页回来时别一下跳过去
const EPS = 0.4;         // 小于这个差距（px）就直接贴上去，收尾不拖泥带水
// ── 胶片感：轨道的空间模型（用户定的方向）─────────────────────────────
// 想要的效果：**中间那张正面朝你、最近**；越往两边越绕 Y 轴转开、越往后退、
// 越小 —— 整条轨道读起来像一条绕过片门的胶片；而且**滚动时整条带子跟着扭**，
// 停下来自己回正。
//
// ⚠ 为什么不是给轨道一个共享透视（把 perspective 挂在 .jb-track 上、卡片用
//   preserve-3d）：共享透视的灭点是**那个元素自己的中心**，而轨道是铺了三份的
//   无限循环、它的中心并不跟着屏幕中心走 —— 一滚起来"最近的那张"就滑到一边去。
//   现在每张卡各自 `perspective(...)`：灭点就是这张卡自己的中心，几何完全跟着
//   scrollLeft 走，无限循环也不会跑偏。
const PERSP = 1100;       // 自透视距离（px）：越小透视越猛
const FILM_YAW = 26;      // 屏幕两边卡片的绕 Y 倾角（deg）；中间那张是 0 = 正面朝前
const FILM_DEPTH = 240;   // 屏幕两边往后退多少（px）；自透视会顺手把它缩小
const FILM_SCALE = 0.93;  // 再补一档显式缩小（只靠 Z 的话近处衰减不够、边缘不够"远"）
const FILM_TWIST = 4;     // 绕 X 的**反向**旋转（左倾 / 右倾）：胶片那种轻微的螺旋
// |t| = 1 落在**屏幕边缘**上（原来是 0.75，也就是 3/4 半屏就到顶了 —— 那样
// 屏幕最外侧会是一大片角度完全相同的卡片，一眼看出来是"贴上去的"）。
const TILT_RANGE = 1.0;
const TILT_CLAMP = 1.35;  // 屏幕外的卡片最多算到 1.35 倍，别把远端算出荒唐的角度

// ── 随滚动扭曲（"胶片转起来"那一层）─────────────────────────────────────
// 每帧量一次轨道的滚动速度，平滑之后按比例叠到上面的姿态上（整条带子朝运动方向
// 倾一点、俯仰一点、再撑大一点），速度归零就自己回正。
// 幅度那几个数在 useFilmStrip 的 FILM 里（wFull / wYaw / wPitch / wStretch），
// 和 WebGL 那边共用一份；这里只留平滑系数。
const WARP_FOLLOW = 0.22;  // 速度平滑系数（60Hz 每帧逼近比例）

let rafId = 0;
let target = 0;      // 期望的 scrollLeft
let driving = false; // false = 完全跟随（用户手指/触屏/键盘在动），true = 由本循环匀速逼近
let lastLeft = -1;
let lastReported = -1;
let lastNow = 0;
// 主循环上一帧写下的 scrollLeft。用来识别"外部把轨道挪走了"（见 frame 里的判断）。
let lastWrote = -1;
let cards = [];
let cycleWidth = 0; // 一份卡片的宽度（无限循环的平移量），由 readCards 量出
// 速度采样（给"随滚动扭曲"用）：上一帧的 scrollLeft / 时间、平滑后的速度、
// 以及波形相位（跟着走过的距离累积，停下就定住）。
let sampleLeft = -1;
let sampleAt = 0;
let warp = 0;      // px/帧；正 = scrollLeft 在变大（轨道往左走）
let warpPhase = 0;
// 量卡片几何时的 scrollLeft（那些视口坐标是那一刻的，之后按差值换算）
let readScroll = 0;
// "有张图刚加载完，需要重画一帧"（胶片那层的贴图是在渲染时按需建的）
let filmDirty = false;
// 胶片那层（three 拉下来了才非 null）。null = 退回"DOM 图片 + 只有几何在 3D"。
let film = null;
let filmAlive = false;   // 组件还活着吗（异步 import 回来时可能已经卸载了）
let filmFlying = null;   // 被点的那张卡的 key：交接期间它不跟着淡
const filmOn = ref(false);

// ── 鼠标跟随倾斜（叠在"按滚动位置"的微倾上）─────────────────────────────
// 每张卡按"指针相对它自己中心的位置"补一点 rotateX / rotateY：指针在卡片左边，
// 卡片就朝左边转过来（左缘往前），读起来是卡片在看着鼠标。
// ⚠ 只平滑**指针**这一对值（全局一份），不给 72 张卡各存一份缓动 —— 指针本来就是
//   连续移动的，平滑指针已经足够顺，而且每帧只多两次乘加。
const MOUSE_TILT_Y = 9;    // 左右最大额外倾角（deg）
const MOUSE_TILT_X = 6;    // 上下最大额外倾角（deg）
const MOUSE_FOLLOW = 0.18; // 指针平滑系数（60Hz 每帧逼近比例）
let ptrTX = -1;            // 指针目标位置（视口坐标）
let ptrTY = -1;
let ptrOn = false;         // 指针是否在轨道上：离开时目标回到中心 → 倾角归零
let ptrX = 0;              // 平滑后的位置
let ptrY = 0;

function trackPointer(e) {
  if (e.pointerType === 'touch' || reduceMotion) return;
  ptrTX = e.clientX;
  ptrTY = e.clientY;
  ptrOn = true;
}

function onTrackLeave() {
  ptrOn = false;
}
// 只在挂载时读一次：这页开着的时候用户基本不会去改系统设置，
// 每帧 matchMedia 是白花的开销。
let reduceMotion = false;
// 卡片的 offsetLeft / offsetWidth / 中心点在布局不变时是常量。**必须缓存**：
// 每帧读 24 次 offsetLeft 会强制 24 次布局查询，加上每帧写 transform，
// 就是"读-写-读"交错，滚动时能直接看出掉帧。
let metrics = [];

function readCards() {
  cards = Array.from(scroller.value?.querySelectorAll('.jb-card') || []);
  // ⚠ 量**视口**矩形之前先把卡片上的行内变换摘掉：那些几何是"布局值"，
  //   带着上一次投影去量，量到的是投影结果，下一帧再拿它当布局用 ——
  //   自己把自己越推越远。摘掉之后这一帧是平的，下一帧主循环会把姿态重新写回去。
  cards.forEach((c) => {
    c.style.transform = '';
    delete c.dataset.filmMatrix;
  });
  const baseScroll = scroller.value?.scrollLeft || 0;
  readScroll = baseScroll;
  metrics = cards.map((card) => {
    const w = card.offsetWidth;
    const left = card.offsetLeft;
    const media = card.querySelector('.jb-media');
    const cr = card.getBoundingClientRect();
    const mr = media ? media.getBoundingClientRect() : cr;
    const img = card.querySelector('img');
    return {
      el: card,
      w,
      center: left + w / 2,
      left,
      // 这张卡对应哪一篇（三份里同一篇文章的 pi 相同）—— 计数器、进度条都用它
      pi: Number(card.dataset.postIndex) || 0,
      tilted: false,
      // ── 胶片姿态要的几个量（全是**布局**测量，之后只有横向滚动会改 x）──
      // 媒体盒中心的视口坐标：x 每帧按"相对量的时候滚了多少"换算，
      // y 是常量（这一页不纵向滚）。
      mediaViewCx: mr.left + mr.width / 2,
      mediaViewCy: mr.top + mr.height / 2,
      // 支点（媒体盒中心）相对卡片左上角：transform-origin 用它，和滚动无关
      mediaOx: Math.round(mr.left - cr.left + mr.width / 2),
      mediaOy: Math.round(mr.top - cr.top + mr.height / 2),
      mediaW: media ? media.offsetWidth : w,
      mediaH: media ? media.offsetHeight : 0,
      img,
      // 占位色：和卡片上那个 --ph 同一套（同一篇永远是同一个色，加载期不闪）
      tone: toneOf(blogPosts[Number(card.dataset.postIndex) || 0]?.slug || ''),
      hover: false,
    };
  });
  // 一份的宽度 = 第 n 张卡与第 0 张卡的距离（n = 文章数）。无限循环的平移量就是它，
  // **必须量准**：平移量差一个像素，接缝就看得见。
  cycleWidth = metrics.length > blogPosts.length
    ? metrics[blogPosts.length].left - metrics[0].left
    : 0;
  // 旧路径那批压缩图的画质兜底（见 maybeUpgradeLegacy）。每次 load 都看一眼：
  // 观察器放掉远处的图、回头再加载时，这条路还要再走一遍。
  cards.forEach((card) => {
    const img = card.querySelector('img');
    if (img && img.dataset.bdLegacyBound !== '1') {
      img.dataset.bdLegacyBound = '1';
      img.addEventListener('load', () => maybeUpgradeLegacy(img));
      // 图加载完要**喊一帧**：胶片那层是在主循环里按需建贴图的，而图是懒加载、
      // 往往等主循环静止之后才到 —— 不叫醒它，卡片就一直停在占位色块上，
      // 直到用户滚一下才补上（实测就是这个：一开始 textures: 0）。
      img.addEventListener('load', () => {
        filmDirty = true;
        startLoop();
      });
    }
    // 悬停：CSS 那条 :hover 只管 DOM，胶片那层要知道"这一张被指着"
    // （它负责把封面放大一点）。挂事件而不是每帧 matches(':hover') ——
    // 后者每帧都要读一遍样式，正是这份文件一路在躲的那种读-写交错。
    if (card.dataset.bdHoverBound !== '1') {
      card.dataset.bdHoverBound = '1';
      card.addEventListener('pointerenter', () => setHover(card, true));
      card.addEventListener('pointerleave', () => setHover(card, false));
      card.addEventListener('focus', () => setHover(card, true));
      card.addEventListener('blur', () => setHover(card, false));
    }
  });
  lastLeft = -1; // 布局变了，下一帧重新算
}

function setHover(card, on) {
  const m = metrics.find((x) => x.el === card);
  if (m) m.hover = on;
}

// ── 无限循环：把位置圈回中间那一份 ──────────────────────────────────────
// 越出 [0.5C, 1.5C) 就整体平移一个周期。target / lastWrote 要跟着一起平移，
// 否则下一帧的"外部把轨道挪走了"那条判据会当场把惯性掐掉。
// 返回平移量（没平移就是 0）：上面那条判据要它，滚动速度那一路也要它 ——
// 一次回卷是 9830px 的跳变，不减掉的话就成了"一帧甩了 9830px"，
// 整条轨道会当场扭到极限。
function wrapLoop(root) {
  if (!cycleWidth) return 0;
  const left = root.scrollLeft;
  let d = 0;
  if (left >= cycleWidth * 1.5) d = -cycleWidth;
  else if (left < cycleWidth * 0.5) d = cycleWidth;
  if (!d) return 0;
  root.scrollLeft = left + d;
  target += d;
  lastWrote += d;
  return d;
}

// @param {number} [rate] 这一段用哪个逼近系数：滚轮/键盘走 TOUCH，甩出去走 FLING_TOUCH。
//   逼近系数越小 = 每帧只走一小步 = 同样的松手速度滑得更远（但尾巴也更长）。
//   ⚠ 必须和"算滑行距离"用的是同一个数，否则松手瞬间的速度会跳（见 onPointerUp）。
function setTarget(next, rate = TOUCH) {
  const root = scroller.value;
  if (!root) return;
  const max = Math.max(0, root.scrollWidth - root.clientWidth);
  target = Math.max(0, Math.min(max, next));
  approach = rate;
  driving = true;
}

// 不接管时（触屏惯性、键盘 scrollBy、浏览器自己滚）让 target 一直咬住真实值，
// 否则用户滑完手，target 还停在旧位置，下一帧会被"平滑"地拽回去。
function syncTarget() {
  const root = scroller.value;
  if (root) target = root.scrollLeft;
}

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const root = scroller.value;
  if (!root) return;

  // 指针平滑：每帧都要走 —— 不滚动的时候鼠标也在动（下面的"静止帧直接 return"
  // 只该省掉滚动相关的重算，不能把鼠标倾斜一起省掉）。
  // 指针离开轨道就把目标拉回屏幕中心，倾角自然归零。
  const ptrDt = lastNow ? Math.min(MAX_STEP, now - lastNow) : FRAME_REF;
  const ptrRate = 1 - (1 - MOUSE_FOLLOW) ** (ptrDt / FRAME_REF);
  const gx = ptrOn ? ptrTX : root.clientWidth / 2;
  const gy = ptrOn ? ptrTY : root.clientHeight / 2;
  const ptrMoving = Math.abs(gx - ptrX) > 0.4 || Math.abs(gy - ptrY) > 0.4;
  ptrX += (gx - ptrX) * ptrRate;
  ptrY += (gy - ptrY) * ptrRate;

  if (driving) {
    // 别人把轨道挪走了：键盘的 scrollBy(smooth)、浏览器自己的滚动、
    // 或者测试里的 scrollTo。判据是"真实值偏离我们上一帧写下的值" ——
    // 主循环自己是唯一写 scrollLeft 的人，所以偏了就是外部动的。
    // 不认这件事的后果：外部滚动会被惯性拽回旧目标，
    // 表现成"用键盘翻了一页，它自己又滑回去"。
    if (!reduceMotion && lastWrote >= 0 && Math.abs(root.scrollLeft - lastWrote) > 1.5) {
      target = root.scrollLeft;
    }
    const gap = target - root.scrollLeft;
    if (Math.abs(gap) < EPS) {
      root.scrollLeft = target;
      driving = false;
      approach = TOUCH; // 这一段收尾了，把系数放回基准
    } else if (reduceMotion) {
      // 用户要求减少动态效果：不做惯性，直接就位
      root.scrollLeft = target;
      driving = false;
      approach = TOUCH;
    } else {
      const dt = lastNow ? Math.min(MAX_STEP, now - lastNow) : FRAME_REF;
      const rate = 1 - (1 - approach) ** (dt / FRAME_REF);
      root.scrollLeft += gap * rate;
    }
    lastWrote = root.scrollLeft;
  } else {
    target = root.scrollLeft;
    lastWrote = root.scrollLeft;
  }
  // ⚠ 必须在下面的"静止帧直接 return"**之前**更新：漏掉的话，静止那几秒里
  // lastNow 一直停在旧值，重新滚动时第一帧的 dt 会大得离谱（被 MAX_STEP 夹住），
  // 于是每次从静止启动都会看到"第一下窜一下"。
  lastNow = now;

  // 无限循环：位置越出中间那一份就整体平移一个周期（内容逐像素相同，看不出接缝）
  const wrapped = wrapLoop(root);

  // ── 滚动速度 → 胶片那层"随滚动扭曲"的幅度 ──────────────────────────────
  // 每帧都算，而且必须在下面"静止帧直接 return"**之前**：停下之后 warp 还要
  // 自己衰减回 0（带子回正），那一小段同样得逐帧重算。
  // ⚠ 减掉回卷量：一次回卷是整整一份轨道宽（9830px）的跳变，不减掉就成了
  //   "一帧甩了 9830px"，整条轨道会当场扭到极限。
  // 采样用的是时间不是帧：和上面那条惯性一个道理，120Hz 上不能翻倍。
  const sdt = sampleAt ? Math.min(MAX_STEP, now - sampleAt) : FRAME_REF;
  const vRaw = sampleLeft < 0 ? 0 : (root.scrollLeft - wrapped - sampleLeft);
  sampleLeft = root.scrollLeft;
  sampleAt = now;
  warp += (Math.max(-120, Math.min(120, vRaw)) - warp) * (1 - (1 - WARP_FOLLOW) ** (sdt / FRAME_REF));
  warpPhase += warp * 0.03; // 波形的相位跟着走过的距离走：停下就定住

  const left = root.scrollLeft;
  // 静止、指针不动、**而且没有别的东西在动**才收工：
  //   · 速度还没衰减完（带子正在回正）
  //   · 胶片那层的不透明度还在补间（交接的淡入淡出，GSAP 在推它）
  // 漏掉这两个判据，停下之后的那一小段就没人重画了（带子卡在歪着的那一帧）。
  const warpMoving = Math.abs(warp) > 0.05;
  const opMoving = !!film && gsap.isTweening(film.op);
  if (left === lastLeft && !ptrMoving && !warpMoving && !opMoving && !filmDirty) return;
  lastLeft = left;
  filmDirty = false; // 这一帧会重画，欠的那一帧就还上了
  // 顺手把位置记在模块变量里：**离开这一页时读不到它了**（keep-alive 先把 DOM
  // 摘出文档，那一刻 scrollLeft 读回来是 0），只能趁每帧还在的时候记着。
  // 返回时靠它恢复 —— 也正是封面飞回去要落的那一格（见 activate / deactivate）。
  savedScroll = left;

  // ── 胶片姿态 ────────────────────────────────────────────────────────────
  // 以轨道中线为基准：**中间那张正面朝前、最近**，越靠边越绕 Y 转开、越往后退、
  // 越小；再叠一层随滚动速度的扭曲（停下自己回正）。
  //
  // poseAt / cssMatrix 都是 useFilmStrip 里的**纯函数**（不带 three）：
  // 同一份姿态既写 DOM 的 matrix3d，也喂给 WebGL 那层画封面 —— 两边同一个投影，
  // 图和字不会各算一套。也因此 WebGL 拉不下来时，这套 3D 排布照样在。
  //
  // 处理窗口 = **整整一圈**（一份轨道 = 一圈）：这是"能看见圆柱后面"的前提 ——
  // 背面那一圈卡片也要拿到圆柱姿态，否则它们只会平躺在屏幕外，看不到。
  // 一圈 24 张，逐帧写 24 个 matrix3d 是可以接受的（写 transform 不触发布局，
  // 而且值没变就不写）；真正贵的是贴图，那部分只给正面弧内的一小撮（见下）。
  // ⚠ 投影要按**视口**算，不是按轨道：相机是按 canvas（铺满视口）建的，
  //   两边用不同的高度就会得到两个不同的焦距 D —— 图和字会各缩各的。
  const view = { w: window.innerWidth, h: window.innerHeight };
  const D = focalOf(view.h);
  const R = ringRadius(cycleWidth); // 一圈的半径：一份轨道铺在圆柱上刚好绕一圈
  const lo = left - cycleWidth / 2;
  const hi = left + cycleWidth / 2;
  const wnorm = reduceMotion ? 0 : Math.max(-1, Math.min(1, warp / FILM.wFull));
  const items = film ? [] : null;
  for (let i = 0; i < metrics.length; i += 1) {
    const m = metrics[i];
    if (m.center < lo || m.center > hi) {
      if (m.tilted) {
        m.el.style.transform = '';
        delete m.el.dataset.filmMatrix;
        m.tilted = false;
      }
      continue;
    }
    // 媒体盒中心的**视口**坐标：量的时候记了基准，之后只有横向滚动会改它
    const cx = m.mediaViewCx - (left - readScroll);
    const cy = m.mediaViewCy;
    const theta = (cx - view.w / 2) / R; // 圆柱上转过的角度（正 = 往右）
    const front = Math.abs(theta) < FILM.frontArc;
    const pose = poseAt(cx, cy, view, wnorm, R);
    // 鼠标跟随那一份并进姿态里（不再另写一套 transform）：
    // 指针在卡片左边 → 卡片朝左转过来（读起来像卡片在看鼠标）。
    const relX = Math.max(-1, Math.min(1, (ptrX - cx) / (m.w * 0.85)));
    // 纵向用 0.85 而不是 0.42：0.42 太窄，指针一离开中线就顶到上限，倾角变成
    // "全有或全无"；放宽到接近整屏高度才有连续的梯度。
    const relY = Math.max(-1, Math.min(1, (ptrY - view.h / 2) / (view.h * 0.85)));
    pose.yaw += -relX * MOUSE_TILT_Y * (Math.PI / 180);
    pose.pitch += relY * MOUSE_TILT_X * (Math.PI / 180);

    // ① DOM：整张卡片（含标题编号）用同一个投影写死。
    //    ⚠ 支点取**媒体盒中心**（WebGL 那块平面也绕它转，两边必须同一个支点，
    //      否则一转身图和字就劈叉），所以不能沿用 CSS 里的 50% 50%。
    //    只在真的变了才写：写一次 transform 要走一遍样式重算 + 合成器改层，
    //    连续量四舍五入之后很多相邻帧是同一个值，白写的那几帧就是滚动里的毛刺。
    const origin = `${m.mediaOx}px ${m.mediaOy}px`;
    if (m.el.style.transformOrigin !== origin) m.el.style.transformOrigin = origin;
    const next = cssMatrix(pose, D);
    if (m.el.dataset.filmMatrix !== next) {
      m.el.style.transform = next;
      m.el.dataset.filmMatrix = next;
    }
    m.tilted = true;

    // ② **整圈**都交给 WebGL 画（它自己有深度排序），DOM 里那张 <img> 一律藏着。
    //    ⚠ 别想省事把背面那圈留给 DOM 的 <img>：DOM 卡片在 canvas **上面**
    //      （canvas 是 z-index 1、轨道是 2），那样背面会反过来压在正面之上 ——
    //      实测就是"前/后颠倒"。
    //    文字标签是另一回事：它们是 DOM，不吃 canvas 的深度排序，所以在
    //    **背面那一圈**上要藏掉（is-back），否则背面卡片的编号/日期会从正面卡片里透出来。
    //    类的切换只在真的变了才写（classList.toggle 会无条件重写属性 = 一次样式重算）。
    const back = !front;
    if (m.isBack !== back) {
      m.isBack = back;
      m.el.classList.toggle('is-back', back);
    }
    if (items) {
      items.push({
        key: i,
        pose,
        media: { width: m.mediaW, height: m.mediaH },
        img: m.img,
        tone: m.tone,
        hover: m.hover,
      });
    }
  }
  if (film) film.render(items, { phase: warpPhase, flyingKey: filmFlying });

  // ── 读数 ──
  let best = 0;
  if (metrics.length) {
    let bestDist = Infinity;
    for (let i = 0; i < metrics.length; i += 1) {
      const dist = Math.abs(metrics[i].left - left);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    if (best !== lastReported) {
      lastReported = best;
      // 循环里同一篇有三份（三个下标），对外一律报**原始序号**
      activeIndex.value = metrics[best].pi;
    }
    // 进度条：循环之后"整条轨道滚了百分之几"没有意义了（轨道里有三份），
    // 改成"在一份里的位置"（相位）。
    // ⚠ 别写成"卡号 + 卡内进度"：卡内那一项会被夹到 0..1，于是**还没走到这张卡的那半格**
    //   里进度条是停住的 —— 那就是"到了一定程度自己吸附一下"的来源。
    //   相位是连续量，每帧都跟着走；它归零那一刻正好落在回卷点上（内容逐像素相同，
    //   所以看起来只是进度条自己从头开始，画面并没有跳）。
    // 基准取"一份的起点"（left = cycleWidth 时相位为 0）：那一刻正是第 01 篇贴在
    // 左边缘，所以播放头从一开始就落在第一根刻度上，往后每走一篇前进一格。
    // 相位从 1 跳回 0 那一刻，恰好是"从最后一篇绕回第一篇"—— 时间线回绕和内容回绕
    // 是同一个语义，看起来是进度条自己重新开始，而不是画面跳了一下。
    if (cycleWidth) {
      const phase = ((((left - cycleWidth) % cycleWidth) + cycleWidth) % cycleWidth) / cycleWidth;
      if (Math.abs(phase - progress.value) > 0.0005) progress.value = phase;
    }
  }
}

function startLoop() {
  if (!rafId) rafId = requestAnimationFrame(frame);
}

function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  lastNow = 0;   // 下次 startLoop 时第一帧用基准 dt，不拿旧的 now 去算
  lastWrote = -1; // 重新开始时不要拿上一轮的写入值去判断"外部动了"
}

// 滚动事件本身不用做任何事（主循环每帧都在读）——
// 只有键盘 scrollBy 这类"不经过我们"的滚动需要把 target 拉回来。
function onScroll() {
  if (!driving) syncTarget();
}

// ── 拖拽（鼠标/触控笔）+ 点击判定 ───────────────────────────────────────────
// ⚠ 这一整块为什么不用模板上的 @click：
//   拖拽要给轨道 setPointerCapture，而**指针捕获会把后续的 click 重新定向到捕获元素上**
//   ——pointerdown 明明落在卡片里，pointerup 之后派发的 click 的 target 却是
//   .jb-carousel 本身，卡片上的 @click 永远收不到。表现就是"卡片点不动"。
//   （实测：捕获监听里打出来的 click.target 一路都是 jb-carousel，卡片名都看不到。）
//   所以点击在这里自己判定：按下和抬起落在同一张卡片、且位移没超阈值，就算点击。
//   触屏不设捕获（交给浏览器原生惯性滚动），所以触屏的点击仍然由模板 @click 处理。
let drag = null;
let lastMoved = false;   // 上一次按下→抬起期间有没有真的拖动过（给 click 用）
let cardNavLock = false; // 这一轮交互已经由 PointerEvent 处理过导航了，别再重复一次

// 速度采样：只留最近 V_WINDOW 毫秒里的 (时间, 指针 x) 几个点，松手时用窗口**两端**
// 的位移算速度 —— 和 Android/iOS 的 velocity tracker 同一个路子。
// 为什么不能拿「本次位移 ÷ 本次间隔」：单个 pointermove 的 dt 可能只有 1–2ms，
// 手抖一下就能算出上千 px/秒的假速度。原来那版更糟 —— 分子用的是**从按下算起的
// 累计位移**、分母却是最后一段的间隔，等于把整段拖拽的距离摊到一帧上：实测慢拖
// 400px 松手会得出 −266 px/帧（还没算上 `target + vx * 7` 那个反着的符号），
// 轨道于是被"甩"回起点 —— 那就是拖完回弹的来源。
const V_WINDOW = 110;  // 采样窗口（ms）
const V_IDLE = 90;     // 松手前指针已静止超过这么久 → 视为没有速度
const V_MIN = 0.8;     // 低于这个速度（px/帧）不算甩动，就地停住
const V_MAX = 90;      // 速度上限（px/帧）：一次抖动的极端值不该甩出好几屏
let samples = [];
let lastFling = null; // 联调探针用（见文件末尾的 window.__jb）

function onPointerDown(e) {
  if (e.pointerType === 'touch') return;
  const root = scroller.value;
  if (!root) return;
  syncTarget();
  cardNavLock = false; // 新一轮交互开始
  drag = {
    x: e.clientX,
    y: e.clientY,
    // 按下那一刻的**真实位置**（不是 target：上一段惯性可能还没追完）。
    // 拖拽期间轨道就从这个位置跟着指针走，抓下去不会先跳一下。
    at: root.scrollLeft,
    moved: false,
    // 按下时命中的那张卡片。抬起时用它判定"这是点了一下"。
    card: e.target?.closest?.('.jb-card') || null,
    lastX: e.clientX,
    lastT: performance.now(),
  };
  samples = [{ t: drag.lastT, x: e.clientX }];
  lastMoved = false;
  try {
    root.setPointerCapture(e.pointerId);
  } catch {
    /* 某些环境不支持捕获，拖拽仍能工作 */
  }
  dragging.value = true;
}

function onPointerMove(e) {
  trackPointer(e); // 鼠标跟随倾斜：和拖拽无关，先记下来（触屏会自己跳过）
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) > 6) drag.moved = true;
  if (!drag.moved) return;

  const now = performance.now();
  drag.lastX = e.clientX;
  drag.lastT = now;
  samples.push({ t: now, x: e.clientX });
  while (samples.length > 2 && now - samples[0].t > V_WINDOW) samples.shift();

  const root = scroller.value;
  if (!root) return;
  // 跟手：拖拽期间轨道 **1:1** 咬住指针，不走主循环的插值。
  // 原来是 setTarget() 交给主循环去"追"，一路上轨道都落后指针几十像素，
  // 松手后那段追赶看着就是回弹；而且抓下去本该立刻掐掉上一段惯性，这里一并做到。
  driving = false;
  root.scrollLeft = drag.at - dx; // 拖出两头时由浏览器夹住 → 天然的"到边就停"
  target = root.scrollLeft;
  lastWrote = root.scrollLeft;
}

function onPointerUp() {
  const current = drag;
  drag = null;
  if (!current) return;
  const root = scroller.value;
  dragging.value = false;
  lastMoved = current.moved;

  // 抬起点在不在按下那张卡片里 —— 用**几何**判断，不看 e.target。
  // （指针捕获会把 pointerup 也重定向到轨道上，e.target 这时候是 .jb-carousel，
  //   拿它比卡片永远不相等，点击就整条丢掉了。）
  // 坐标取最后一次 pointermove 记下的位置：pointercancel 的 clientX 不可靠，
  // 而"指针最后停在哪"本来就更贴近点击语义。
  const inCard = (() => {
    if (!current.card || current.moved) return false;
    const r = current.card.getBoundingClientRect();
    return (
      current.lastX >= r.left - 4 && current.lastX <= r.right + 4
      && current.y >= r.top - 4 && current.y <= r.bottom + 4
    );
  })();

  if (inCard) {
    const idx = metrics.findIndex((m) => m.el === current.card);
    if (idx >= 0) {
      cardNavLock = true; // 这一轮已经处理过，模板那路的 click 别再跳一次
      // ⚠ 用 metrics[idx].pi（原始序号）：idx 是**三份铺开之后**的 DOM 下标
      openPost(blogPosts[metrics[idx].pi], current.card);
    }
    return;
  }
  if (!current.moved || !root) return; // 抬起点已经不在卡片上：既不是点击，也不是拖拽

  // ── 甩出去（惯性）────────────────────────────────────────────────────
  // 速度取采样窗口两端的平均。指针停住一会儿之后再松手（V_IDLE）当作没有速度，
  // 否则"拖到位 → 停一下 → 松手"也会照着一个早就过期的速度继续滑。
  const now = performance.now();
  const first = samples[0];
  const last = samples[samples.length - 1];
  let v = 0;
  if (now - current.lastT <= V_IDLE && first && last && last.t > first.t) {
    // 指针左移（坐标变小）= 轨道前进（scrollLeft 变大），所以取负号。
    v = -((last.x - first.x) / (last.t - first.t)) * FRAME_REF;
  }
  v = Math.max(-V_MAX, Math.min(V_MAX, v));
  lastFling = {
    v, span: first && last ? Math.round(last.t - first.t) : 0, n: samples.length, idle: Math.round(now - current.lastT),
  };
  if (Math.abs(v) < V_MIN) return; // 太慢：就地停住，不甩

  // 滑行距离 = v / FLING_TOUCH。主循环每帧只逼近 gap 的 FLING_TOUCH 倍，取这个 gap
  // 正好让松手后的**第一帧走出 v** —— 松手瞬间的速度与拖拽末速严格接上，不会有
  // "先顿一下再窜出去"。后面逐帧按同一个系数衰减成惯性，收尾交给 EPS 那一档贴齐。
  // 想调惯性的手感，只动 FLING_TOUCH 一个数就够了（小 = 滑得更远）。
  const max = Math.max(0, root.scrollWidth - root.clientWidth);
  setTarget(Math.min(max, Math.max(0, root.scrollLeft + v / FLING_TOUCH)), FLING_TOUCH);
}

// 点击（捕获路径）。为什么不能用模板上的 @click：
//   拖拽要给轨道 setPointerCapture，而**指针捕获会把后续的 click 重新定向到捕获元素**
//   ——pointerdown 的 target 明明是卡片里的 img，pointerup 之后派发的 click 的 target
//   却是 .jb-carousel 本身，卡片上的 @click 永远收不到（实测点击 = "点不动"）。
//   而且 click 是在 pointerup **之后**才派发的，就算把 @click 挪到 scroller 上也不可靠：
//   那一刻 dragging 已经变回 false、Vue 也已经重渲染过，处理函数可能都不是注册时的那个了。
//   所以点击判定一律走 PointerEvent（同步、可控）：
//     · moved 没过阈值 → 算点击
//     · 用**按下时**记下的卡片，且抬起点仍在同一张卡片上
// 触屏的 pointerdown 直接 return（不设捕获），所以触屏的点击仍然由模板 @click 处理。
function onClickCapture(e) {
  if (e.pointerType === 'touch') return;
  if (lastMoved || cardNavLock) return;
  const card = e.target?.closest?.('.jb-card');
  if (!card) return;
  const idx = metrics.findIndex((m) => m.el === card);
  if (idx >= 0) openPost(blogPosts[metrics[idx].pi], card);
}

// 滚轮/触控板纵向滚动 → 横向（轨道里常见的做法，否则滚轮完全没反应）
// 这里必须是"累加到 target"而不是"从当前 scrollLeft 加"：平滑还没追上时
// 连续几次滚轮都从同一个 scrollLeft 起算的话，滚得越多反而越不跟手。
function onWheel(e) {
  const root = scroller.value;
  if (!root) return;
  const dy = e.deltaY || e.deltaX;
  if (!dy) return;
  if (!driving) syncTarget();
  const before = target;
  setTarget(target + dy);
  if (target !== before) e.preventDefault();
}

// 键盘：← → 翻一张；Enter / 空格 打开聚焦的那张卡片（卡片是可聚焦的 article，
// 浏览器不会替它触发 click，所以这里补上，别让键盘用户走不完流程）。
// 键盘滚动走原生 scrollBy(smooth)，不塞进上面那条惯性里：浏览器自己的平滑滚动
// 在中途被打断（用户接着滚轮）时行为更稳；主循环那边靠 onScroll 把 target 咬回来。
function keydownCard(e) {
  const card = e.target?.closest?.('.jb-card');
  if (!card) return null;
  const idx = metrics.findIndex((m) => m.el === card);
  if (idx < 0) return null;
  return blogPosts[metrics[idx].pi] || null; // 同样按原始序号取
}

function onKeydown(e) {
  const root = scroller.value;
  if (!root) return;

  if (e.key === 'Enter' || e.key === ' ') {
    const post = keydownCard(e);
    if (post) {
      e.preventDefault();
      openPost(post, e.target?.closest?.('.jb-card') || null);
      return;
    }
  }

  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const step = metrics.length > 1 ? metrics[1].left - metrics[0].left : metrics[0]?.w || 0;
  root.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * step, behavior: 'smooth' });
}

// ── 版心高度：字标 / 轨道 / 页脚条三段都是固定像素，字符串行盒却随字体走。
//    量一次真实高度写进 --jb-rail，只用它给轨道留位（写死会在中文字体回退时错位）。
const wmRef = ref(null);

function measure() {
  const h = wmRef.value?.offsetHeight || 170;
  document.documentElement.style.setProperty('--jb-rail', `${h + 66}px`);
}

let resizeTimer = null;
let holdTimer = null; // 点卡片后"等周围元素渐隐完"的那一拍（见 openPost）
let returnFadeTimer = null; // 从详情返回时，收尾 .is-flying 标记（见 activate）
let savedScroll = 0; // 离开这一页时轨道的位置（见 deactivate / activate）
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    measure();
    // 卡片宽度是 vw 的：窗口一改，媒体盒的宽高就变了，胶片那层摆 mesh 用的是
    // 量好的那份尺寸，必须跟着重量（readCards 顺带把行内变换摘掉再量，见那里）。
    readCards();
    film?.resize();
    syncTarget();
  }, 120);
}

function activate() {
  document.documentElement.classList.add('blogs-lookback');
  // 兜底：详情那条过渡会挂 .bd-taking-cover（除卡片外全部隐去），正常由详情在卡片
  // 落地时摘掉；但用户可能**飞行途中就用返回键退出**，那一步不会执行 —— 不在这里
  // 补一刀的话，回到列表会是一片空白。
  document.documentElement.classList.remove('bd-taking-cover', 'blog-detail-open');
  clearTimeout(holdTimer);
  // 从详情返回这一趟：周围元素渐入（规则见上面的 html.bd-return-fade 那组）。
  //
  // 判据是详情在退出时置的**内存标记**；触发点见下面的 route watcher ——
  // 不能放在 activate() 里：onActivated 触发的那一刻 keep-alive 还没把列表重新
  // 插回文档，querySelector 一律返回 null（实测就漏在这儿），而且实测那次返回
  // onActivated 根本没来。route watcher 是 flush: 'pre'（DOM 更新之前），
  // 类会赶在元素重新进文档之前挂上，动画正好在插回时开播。
  document.documentElement.style.overflow = 'hidden'; // 这一页只横滚
  reduceMotion = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  bindClickCapture();
  measure();
  readCards();
  // ── 位置 ────────────────────────────────────────────────────────────────
  // ⚠ 不能靠"读回来看看是不是 0"判断首次进入：keep-alive 把轨道摘出文档再挂回来时，
  //   **浏览器会把 scrollLeft 丢掉**（实测：滚到第 8 篇 = 12700，返回后变成 0），
  //   而 0 正好和首次进入撞车 —— 于是每次返回都被当成"刚进来"甩回第 01 篇。
  //   所以位置由我们自己记（deactivate 时存），回来照原样恢复。
  if (cycleWidth && scroller.value) {
    scroller.value.scrollLeft = savedScroll > 0 ? savedScroll : cycleWidth;
    wrapLoop(scroller.value); // 圈回中间那一份（内容逐像素相同，看不出接缝）
  }
  syncTarget();
  if (film) {
    film.op.v = 1; // 交接那一趟淡完就复位（正常退出时已经是 1，这里是兜底）
    film.resize();
  }
  // 指针的平滑值先落在屏幕中心（= 没有额外倾角）：不然头几帧会按"指针在左上角"
  // 算出一个假倾角，然后自己转回来 —— 进场时能看到卡片无端歪一下。
  ptrX = scroller.value ? scroller.value.clientWidth / 2 : 0;
  ptrY = scroller.value ? scroller.value.clientHeight / 2 : 0;
  ptrOn = false;
  startLoop();
}

// 点击走捕获阶段的 PointerEvent 判定（原因见 onClickCapture 的注释）。
// 用原生监听而不是 @click.capture：模板那层会把原生事件包装一遍，
// 而且 Vue 在重渲染时换掉的正是模板绑定，这里要的是一条不会被动摇的路径。
function bindClickCapture() {
  const root = scroller.value;
  if (!root) return;
  root.removeEventListener('click', onClickCapture, true); // 防重复绑定
  root.addEventListener('click', onClickCapture, true);
}

function unbindClickCapture() {
  scroller.value?.removeEventListener('click', onClickCapture, true);
}

function deactivate() {
  // 位置平时就由主循环每帧记着（见 frame 里的 savedScroll）。这里再补一次，
  // 只在**读得到**的时候覆盖 —— 实测 keep-alive 调 onDeactivated 的那一刻，
  // 这棵 DOM 已经被移出文档了，scrollLeft 读回来是 0，照单全收就把位置抹平了。
  if (scroller.value?.scrollLeft) savedScroll = scroller.value.scrollLeft;
  document.documentElement.classList.remove('blogs-lookback');
  document.documentElement.style.overflow = '';
  // ⚠ 这里**不要**去摘 bd-return-fade：实测这一跳里 deactivate 也会跑，
  // 刚挂上的"渐入"类会被当场摘掉，动画根本没播（返回时周围元素直接以 1 出现）。
  // 类的清理交给那个定时器 —— 它是普通 setTimeout，即使组件被停用也照样到点执行。
}

// 从详情返回列表：周围元素渐入。
//
// 为什么用命令式 GSAP、而不是"给 <html> 挂个类让 CSS 播动画"：
//   这条路试过三种写法都不稳 —— onActivated 未必来、它来时列表 DOM 还没回文档、
//   而挂上的类又会被这一跳里的清理逻辑当场摘掉（实测：类挂上了、动画没播，
//   元素直接以 1 出现）。这里等一个 nextTick 拿到**真正回文档**的元素，
//   直接补间透明度：gsap.fromTo 会先把 0 写上去再补到 1，起始值在本次绘制之前
//   就位，不会先闪一帧。
// 被点的那张卡排除在外：封面正从它那一格飞回来，它得先亮着接手，否则是个洞。
const RETURN_FADE_SELECTOR = [
  '.jb-wordmark', '.jb-rail', '.jb-end', 'header',
  '.jb-card:not(.is-flying)', '.music-toggle-btn', '.theme-toggle',
  '.author-section', '.wall-toggle',
].join(', ');

// 退场那一趟的渐入时长（秒）。用户要"渐隐渐入看得见"：0.34 太像硬切 → 0.6 → 1.0。
// 被点那张卡（.is-flying）不在这条补间里，它是**立刻**亮着接手的，所以拉长这一段
// 不会让落点那一格变慢 —— 慢下来的只是"周围重新长出来"这一下。
const RETURN_FADE = 1.0;

watch(
  () => route.path,
  async (p) => {
    if (p !== '/blogs' || !consumeReturningFromDetail()) return;
    await nextTick(); // 等列表的 DOM 真的回到文档里，再去找元素
    const els = document.querySelectorAll(RETURN_FADE_SELECTOR);
    if (els.length && !reduceMotion) {
      gsap.fromTo(els, { opacity: 0 }, {
        opacity: 1, duration: RETURN_FADE, ease: 'power2.out', overwrite: true,
        onComplete: () => { gsap.set(els, { clearProps: 'opacity' }); },
      });
    }
    // 胶片那层的封面跟着一起淡回来：它不在 DOM 的渐入名单里（canvas 画的东西
    // 不吃 CSS 的 opacity），不补这一下就是"标签慢慢长出来、照片已经在了"。
    filmFlying = null;
    if (film && !reduceMotion) {
      gsap.fromTo(film.op, { v: 0 }, { v: 1, duration: RETURN_FADE, ease: 'power2.out' });
    } else if (film) {
      film.op.v = 1;
    }
    clearTimeout(returnFadeTimer);
    // 被点那张卡的标记等渐入演完再清（它给封面接手用）：清早了，落点那一格会在
    // 渐入半路被拉回 0（它也在 RETURN_FADE_SELECTOR 之外，靠的就是这个标记）。
    returnFadeTimer = window.setTimeout(() => {
      document.querySelectorAll('.jb-card.is-flying').forEach((c) => c.classList.remove('is-flying'));
    }, RETURN_FADE * 1000 + 150);
  }
);

onMounted(async () => {
  activate();
  window.addEventListener('resize', onResize);
  // 切到别的标签页时停掉主循环：留着只是白烧 CPU/电，
  // 回来时 onActivated 的路径会把 target 咬回真实 scrollLeft。
  document.addEventListener('visibilitychange', onVisibility);
  filmAlive = true;
  // 胶片层是**异步**起来的（three 走动态 import，不进首屏包）。
  // 拿不到就什么都不做：卡片退回普通的 <img>，3D 排布照旧（那部分是纯 CSS 数学）。
  createFilmStrip(filmCanvas.value).then((f) => {
    if (!f) return;
    if (!filmAlive) {
      f.dispose();
      return;
    }
    film = f;
    film.resize();
    filmOn.value = true; // 到这一刻才把 DOM 图片藏起来：没起来之前一切照旧
    startLoop();
  }).catch(() => { /* 起不来就当没有这一层 */ });
  await nextTick();
  // 等字体落地再量一次：Oswald 到位前字标是回退字体，行高不一样
  document.fonts?.ready?.then(() => {
    measure();
    readCards();
    syncTarget();
  });
  measure();
  readCards();
  observeCovers();
  syncTarget();
});

// keep-alive 复用时 onMounted 不会重跑：轨道重新挂进文档、宽度变了都得重来一遍
onActivated(async () => {
  activate();
  await nextTick();
  measure();
  readCards();
  syncTarget();
});

onDeactivated(() => {
  deactivate();
  unbindClickCapture();
  lazyObserver?.disconnect();
  releaseObserver?.disconnect();
  loadedSet.clear();
  stopLoop();
  metrics.forEach((m) => {
    if (m.tilted) m.el.style.transform = '';
  });
  metrics = [];
  cards = [];
});

onUnmounted(() => {
  filmAlive = false;
  film?.dispose();
  film = null;
  deactivate();
  unbindClickCapture();
  window.removeEventListener('resize', onResize);
  document.removeEventListener('visibilitychange', onVisibility);
  clearTimeout(resizeTimer);
  stopLoop();
});

// 联调探针：tools/blog-shots.mjs 用它直接调一次"点卡片"的动作。
// 合成鼠标事件会被各种前置状态（指针捕获、遮罩、拖拽标志）干扰，
// 排查"点不动"时需要一个能绕开输入层、只走业务逻辑的入口。
// 只暴露一个函数，不参与渲染，留着也不影响线上。
if (typeof window !== 'undefined') {
  window.__jb = {
    open: openPost,
    // 从卡片元素打开（探针用）
    openAt: (i) => openPost(blogPosts[i]),
    state: () => ({
      opening: opening.value,
      dragging: dragging.value,
      cards: metrics.length,
      cycleWidth,
      progress: progress.value,
      route: router.currentRoute.value.fullPath,
      historyLen: window.history.length,
      // 下一次松手算出来的甩动速度（px/帧）、采样窗口跨度与样本数 ——
      // 调"甩出去能滑多远"时用得上，不用猜。
      fling: lastFling,
      // 胶片那层：起没起来、几个 mesh / 几张贴图、交接时的透明度、当前速度。
      // 排"图和字对不齐""轨道不扭"这类问题时，先看这里。
      film: film ? {
        on: filmOn.value,
        op: Number(film.op.v.toFixed(3)),
        warp: Number(warp.toFixed(2)),
        ...film.stats(),
      } : null,
    }),
  };
}

function onVisibility() {
  if (document.hidden) stopLoop();
  else if (scroller.value) {
    syncTarget();
    startLoop();
  }
}
</script>

<template>
  <main class="page active blogs-lookback-page">
    <!-- 这一块是整页的固定版心：字标、横向轨道、页脚条三段。 -->
    <section class="jb-stage" :class="{ 'is-film': filmOn }">
      <!-- 胶片层：封面由这一张 canvas 画（能弯、能随滚动扭，CSS 做不到）。
           它在卡片**下面**（z-index 1）：卡片那一层还要负责标题编号、点击命中、
           键盘焦点，以及返回交接要量的那个矩形 —— 图像不在 DOM 上，别的都在。
           three 拉不下来时这层整个不出现，卡片退回普通的 <img>。 -->
      <canvas ref="filmCanvas" class="jb-film" aria-hidden="true"></canvas>

      <!-- 巨号字标 = 板块名本身（这页的标题读作 BLOGS，不是品牌名；品牌字标在 header 里）。
           下面一行是描述（条数取自数据）。两行错时揭幕（纯 CSS 动画，不占 JS）。
           用 h1：这一页本来就没有一级标题。 -->
      <header class="jb-wordmark" ref="wmRef">
        <h1 class="jb-wm-title"><span>BLOGS</span></h1>
        <p class="jb-wm-desc">Stories, notes and things I don't want to forget · {{ total }} entries</p>
      </header>

      <!-- 横向轨道。tabindex 让它能接键盘，卡片各自可聚焦。 -->
      <div
        class="jb-carousel"
        :class="{ 'is-dragging': dragging, 'is-opening': opening }"
        ref="scroller"
        tabindex="0"
        role="region"
        aria-label="Blog archive"
        @scroll.passive="onScroll"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerleave="onTrackLeave"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @wheel="onWheel"
        @keydown="onKeydown"
      >
        <div class="jb-track">
          <!-- 铺 3 份（见 LOOP_COPIES）：无限循环靠"整体平移一个周期"实现，
               三份内容逐像素相同，所以平移前后画面完全一致、接缝看不见。
               编号统一用**原始序号** card.i —— 同一篇文章的三份长得一模一样。 -->
          <article
            v-for="card in loopCards"
            :key="card.key"
            class="jb-card"
            :data-post-index="card.i"
            tabindex="0"
            @click="onCardActivate(card.post, $event)"
          >
            <div class="jb-card-top">
              <span class="jb-num">{{ pad(card.i) }}</span>
              <span class="jb-month">{{ monthOf(card.post.cardDate) }}</span>
            </div>

            <figure class="jb-media" :style="coverStyle(card.post)">
              <div class="skeleton-loader"></div>
              <!-- 轨道上**只加载压缩图**（loadImage 的取值顺序是 data-src → data-full-src，
                   有 data-src 就绝不会去碰原图）。data-full-src 留着，是给
                   maybeUpgradeLegacy 用：旧路径那批压缩图质量没保证，原图尺寸又不大时
                   才换成原图（规则见那段注释）。24 篇里有一半的原图是好几 MB 的 PNG，
                   轨道上同时铺原图会直接卡住滚动 —— 所以这条兜底必须卡得很窄。 -->
              <img
                :data-src="card.post.image.src"
                :data-full-src="card.post.image.fullSrc"
                :alt="card.post.title"
                class="blur-placeholder"
                draggable="false"
                decoding="async"
              >
            </figure>

            <div class="jb-card-bottom">
              <h3 class="jb-title">{{ card.post.cardTitle }}</h3>
              <span class="jb-read">
                {{ card.post.readTime }}
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 12h15M13 6l6 6-6 6" />
                </svg>
              </span>
            </div>
          </article>

          <!-- 轨道末端：把最后一篇也推到左边距上，并给一条视觉收束 -->
          <div class="jb-end" aria-hidden="true">
            <span class="jb-end-mark">//</span>
            <span class="jb-end-text">{{ total }} ENTRIES&nbsp;· 2026</span>
          </div>
        </div>
      </div>

      <!-- 页脚条：进度 + 当前篇 + 操作提示 -->
      <div class="jb-rail">
        <div class="jb-rail-row">
          <span class="jb-rail-now">
            <span class="jb-rail-idx">{{ pad(activeIndex) }}</span>
            <span class="jb-rail-sep">/ {{ String(total).padStart(2, '0') }}</span>
            <span v-if="current" class="jb-rail-title">{{ current.cardTitle }}</span>
            <!-- 时间线上的读数：这一篇的发布日期（取自数据里的 cardDate，逐篇跟着走） -->
            <span v-if="activeDate" class="jb-rail-date">{{ activeDate }}</span>
          </span>
          <span class="jb-rail-hint">DRAG&nbsp;· SCROLL&nbsp;· ←&nbsp;→</span>
        </div>
        <!-- 底部时间线：照参考站首页那条刻度尺做的 ——
             密集细刻度 + 一根更高的播放头 + 刻度下面按月/日对齐的标签。
             每篇一根主刻度，两根次刻度夹在中间（尺子的分度）；刻度整体用绝对定位摆
             （left = i/total），不写死 flex 两端对齐 —— 那样会和卡片槽位错开一格。
             "已走过"的那段用一层同样的刻度、靠 clip-path 裁出来：每帧只写一个属性，
             比给近百个节点逐个改 class 便宜得多。 -->
        <div class="jb-timeline">
          <div class="jb-ticks" aria-hidden="true">
            <template v-for="(p, i) in blogPosts" :key="`t${i}`">
              <span class="jb-tick is-major" :style="{ left: `${(i / total) * 100}%` }"></span>
              <span class="jb-tick" :style="{ left: `${((i + 0.34) / total) * 100}%` }"></span>
              <span class="jb-tick" :style="{ left: `${((i + 0.67) / total) * 100}%` }"></span>
            </template>
          </div>
          <div
            class="jb-ticks is-past"
            aria-hidden="true"
            :style="{ clipPath: `inset(0 ${Math.max(0, 100 - progress * 100).toFixed(2)}% 0 0)` }"
          >
            <template v-for="(p, i) in blogPosts" :key="`p${i}`">
              <span class="jb-tick is-major" :style="{ left: `${(i / total) * 100}%` }"></span>
              <span class="jb-tick" :style="{ left: `${((i + 0.34) / total) * 100}%` }"></span>
              <span class="jb-tick" :style="{ left: `${((i + 0.67) / total) * 100}%` }"></span>
            </template>
          </div>
          <span class="jb-playhead" :style="{ left: `${(progress * 100).toFixed(3)}%` }" aria-hidden="true"></span>
          <div class="jb-marks" aria-hidden="true">
            <span
              v-for="(m, k) in tlMarks"
              :key="`m${m.i}`"
              class="jb-mark"
              :class="{ 'is-first': k === 0 }"
              :style="{ left: `${(m.i / total) * 100}%` }"
            >{{ m.label }}</span>
          </div>
        </div>
        <AppFooter />
      </div>
    </section>
  </main>
</template>

<style scoped>
/* ── 页面底层：把 .page 的纵向滚动关掉，这一页只有横向轨道 ──────────────── */
.blogs-lookback-page {
  overflow: hidden;
}

/* ── 这一页自己的调色板（亮/暗两套）──────────────────────────────────────
   页面底色比站点默认的更深（近黑），所以不能直接用站点的 --bg；但也不能写死 ——
   站点有主题开关，写死之后切到亮色时这页还是黑的，和 header / 悬浮件对不上。
   做法：在 <html> 上定义一组**独立命名**的变量（--jb-*，不碰站点的 --bg 等，
   否则会顺着继承污染 header 和播放器），再在暗色主题下换一套取值。 */
:global(html.blogs-lookback) {
  --jb-bg: #fafafa;
  --jb-fg: #16161a;
  --jb-dim: #6b7280;
  --jb-line: #e5e7eb;
  --jb-faint: #b4b4ba;
  background: var(--jb-bg);
}
:global(html.dark.blogs-lookback) {
  --jb-bg: #0b0b0c;
  --jb-fg: #f2f2f2;
  --jb-dim: #8a8a8f;
  --jb-line: #26262a;
  --jb-faint: #4a4a4f;
}
:global(html.blogs-lookback body) {
  background: var(--jb-bg);
}
/* header 是 fixed 的：把这页的调色板映射到它的变量上，两者才同色 */
:global(html.blogs-lookback header) {
  --bg: var(--jb-bg);
  --text-primary: var(--jb-fg);
  --text-secondary: var(--jb-dim);
  --border: var(--jb-line);
  --border-color: var(--jb-line);
}
/* 滚到一半时 header 那条浅色磨砂底会把轨道切断 */
:global(html.blogs-lookback header.scrolled) {
  background-color: var(--jb-bg);
  backdrop-filter: none;
}

/* ── 版心 ────────────────────────────────────────────────────────────── */
.jb-stage {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--jb-bg);
  color: var(--jb-fg);
  /* 让 fixed 铺满时也吃站内的字体变量 */
  font-family: 'Poppins', sans-serif;
  /* 卡片间距：**几乎挨着**。整排卡片是贴在圆柱面上的（见 useFilmStrip 的 FILM.radius），
     横向间距是弧长、投影之后越往边上挤得越紧 —— 缝要靠几何合上，不是靠留白。
     留这一丝 4px 是给"边上两张的投影刚好咬合"留一点余量，别让标题压到邻居身上。 */
  --jb-gap: 0.25rem;
  --jb-side: 5vw;
  --jb-card-w: 36vw;
  /* 轨道上方给字标留的位置。实际值由 measure() 按字标真实高度写回（+66px），
     这里只是首帧还没量到时的兜底 —— 字标缩成一行后跟着调小。 */
  --jb-rail: 200px;
  --ease-out-expo: cubic-bezier(0.19, 1, 0.22, 1);
}

/* 极淡的颗粒：整块纯黑会显得很平（旧站是 noise.png 逐帧抖动，这里静态一层就够） */
.jb-stage::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  opacity: 0.06;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E");
}

/* ── 胶片层（封面由 WebGL 画在这里）──────────────────────────────────────
   z-index 1：压在页面底色之上、卡片（2）/ 颗粒（3）/ 页脚条（4）之下。
   ⚠ 用 fixed 而不是 absolute：舞台在窄屏那条 media query 里带 padding-bottom
     （给底部 Dock 让位），absolute 的 inset:0 会跟着缩进去一截。
     这条 fixed 的前提是**祖先里没有 transform / filter / will-change / contain**
     ——有的话它会变成包含块，这层就只铺满那个祖先了。
   ⚠ 没拿到 WebGL 时整层 display:none（.is-film 是创建成功之后才挂上去的）。 */
.jb-film {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.jb-stage.is-film .jb-film {
  display: block;
}

/* 封面交给 canvas 之后，DOM 里那张 <img> 只剩三个用途：懒加载的触发者、
   纹理的来源、以及 alt 文本。藏起来但**不能** display:none ——
   那样浏览器可能干脆不解码，纹理就没得做了（visibility 不影响加载）。 */
.jb-stage.is-film .jb-media {
  background: transparent;
}

.jb-stage.is-film .jb-media img {
  visibility: hidden;
}

/* 圆柱**背面那一圈**的卡片：封面由 WebGL 画（有深度排序，会被正面挡住/露出来），
   但**文字标签是 DOM**，不吃那套排序 —— 不藏的话，背面卡片的编号/日期会直接
   压在正面卡片上面。所以背面的标签一律不显示，转过正面（is-back 摘掉）再回来。 */
.jb-stage.is-film .jb-card.is-back .jb-card-top,
.jb-stage.is-film .jb-card.is-back .jb-card-bottom {
  visibility: hidden;
}

/* ── 字标 ────────────────────────────────────────────────────────────── */
.jb-wordmark {
  flex: 0 0 auto;
  position: relative;
  z-index: 1;
  /* 顶部留白 = 导航高度 + 呼吸位。**不要凭感觉写**：header 是 fixed 的，
     实测高 88.8px（24px 上下内边距 + 一行字，见 main.css 的 header 规则），
     导航文字的下沿在 64.8px。原来写的是 calc(72px + 0.4em) ≈ 78px，
     比导航盒还矮，标题几乎是贴着导航字起头的（实测只差 2.8px）。
     122 = 88.8 + 33 的呼吸位。 */
  padding: 122px var(--jb-side) 0;
  pointer-events: none;
  user-select: none;
  /* 宽屏：整页只有这一个词，居中（参考站那版就是居中巨号字标） */
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

/* 只剩一行，字号比原来三行时大一档，把体量补回来。
   ⚠ line-height 不能压到原来那种 0.84：这里靠 overflow: hidden 做揭幕遮罩，
     行盒比字面矮就会把字切掉（大写的 Oswald 也没有降部可切，但字体回退时就不一定了）。
     1.1 是留了余量的值，配下面那条"两行都不许被截断"的约束。 */
.jb-wm-title {
  /* 上下各留 0.08em 的遮罩余量，再用等量负外边距抵消，版面位置一动不动。
     为什么要留：遮罩就是 overflow: hidden 的盒子，盒子高 = 行盒高；
     而字体的 em 盒（ascent+descent ≈ 1.34em）比行盒高，墨迹虽然够得着，
     但换个回退字体/将来改成带降部的写法就会被切。留出这 0.08em 之后，
     任何正常字体的墨迹都在可见区里。 */
  padding: 0.08em 0;
  margin: -0.08em 0;
  overflow: hidden;
  font-family: 'Oswald', sans-serif;
  font-size: 8.4rem;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.005em;
  text-transform: uppercase;
}

/* ⚠ 这里必须 display: block，不能用 inline-block：
   行内块按**基线**对齐，父级行盒会在它下面再多留一段降部空间（h1 字号的 ~0.2em），
   于是 scrollHeight 比 clientHeight 大一截 —— 遮罩那一层就真的压着内容。
   大写 Oswald 的墨迹恰好躲得开，换成回退字体就不一定了。
   块级没有基线对齐这回事，盒子多高内容就多高，两头相等。
   也**不要 nowrap**：它已经是单个词，nowrap 只会带来"窄屏被横切"的风险。 */
.jb-wm-title > span {
  display: block;
  /* ⚠ 这里**不做入场动画**（用户明确要求）：字标就是静静地在那儿，
     不要上滑揭幕那一套 —— 它一动就会和封面飞过去的动作打架，读起来是"跳"。 */
}

/* ── 从详情返回：不加任何入场动画 ────────────────────────────────────────
   封面落点就是卡片那一格的矩形，列表直接接上就是无缝的（位置逐像素相同），
   所以返回这一趟**什么都不用演**：字标没有任何动画，整页也不淡入。
   ⚠ 曾经在这里加过一条 `.jb-stage` 的淡入 —— 它是从 opacity: 0 开始的，
     而它背后就是纯黑，"淡入"实际表现成"屏幕黑一下"（实测返回后会黑掉约 0.4s），
     比直接接上难看得多。别再加回来。 */

/* 描述行：mono + 大写 + 次级色，和站内其它小标签同一套字形。
   ⚠ 这一行**故意不挂遮罩**（没有 overflow: hidden、没有 white-space: nowrap）：
     它是"文字描述"，长一点就该自己换行撑高，而不是被裁掉一截。
   ⚠ 也**不做入场动画**（和字标一样）：它就静静地在那儿。 */
.jb-wm-desc {
  margin: 1.05rem 0 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.68rem;
  font-weight: 500;
  line-height: 1.7;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--jb-dim);
  text-indent: 0.2em; /* 居中对齐时抵消 tracking 在末字后留的那半个字 */
}

/* ── 轨道 ────────────────────────────────────────────────────────────── */
.jb-carousel {
  position: relative;
  z-index: 2;
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  cursor: grab;
  outline: none;
  scrollbar-width: none;
  -ms-overflow-style: none;
  /* 轨道高度 = 卡片高度 + 上下标签位（字标那行是固定像素，见 --jb-rail） */
  padding-top: var(--jb-rail);
}

.jb-carousel::-webkit-scrollbar {
  display: none;
}

.jb-carousel.is-dragging {
  cursor: grabbing;
}

/* 拖拽中禁止文本选中/图片拖影 */
.jb-carousel.is-dragging * {
  user-select: none;
}

/* 点开的那一下：被点的那张卡片的编号/标题轻轻退场，把注意力交给封面那一格。
   （封面上移 + 长高那一段是共享元素形变在做，见 open() 的注释 ——
   不要在这里另写一段 CSS 位移，那会让旧快照里出现正在过渡的元素，
   浏览器会直接跳过整次共享元素过渡。） */
.jb-carousel.is-opening .jb-card:hover .jb-card-top,
.jb-carousel.is-opening .jb-card:hover .jb-card-bottom,
.jb-carousel.is-opening .jb-card:focus .jb-card-top,
.jb-carousel.is-opening .jb-card:focus .jb-card-bottom {
  opacity: 0;
  transition: opacity 0.28s ease;
}

.jb-track {
  display: flex;
  align-items: flex-start;
  gap: var(--jb-gap);
  padding: 0 var(--jb-side) 0 var(--jb-side);
  height: 100%;
}

.jb-card {
  position: relative;
  flex: 0 0 auto;
  width: var(--jb-card-w);
  height: 100%;
  display: flex;
  flex-direction: column;
  cursor: pointer;
  outline: none;
  /* 微倾由 JS 每帧写 transform（见 frame()）。
     ⚠ 这里**故意不写 will-change: transform**：24 张卡片各自提升成合成层，
     滚动时显存和层管理开销比省下的重绘多得多，实测更卡。用 contain 收住每张卡的
     重绘范围就够，剩下的交给浏览器的合成器按需提升。 */
  transform-origin: 50% 50%;
  contain: layout paint;
}

/* 编号 + 月份：常显在图上方 */
.jb-card-top,
.jb-card-bottom {
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.jb-card-top {
  padding-bottom: 0.7rem;
}

.jb-card-bottom {
  padding-top: 0.7rem;
}

.jb-num,
.jb-month,
.jb-read,
.jb-end-text {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.66rem;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--jb-dim);
  transition: color 0.5s ease;
}

.jb-card:hover .jb-num {
  color: var(--jb-fg);
}

.jb-month {
  letter-spacing: 0.1em;
  white-space: nowrap;
}

/* 图：占住标签之间的全部余量，宽度由卡片宽决定 */
/* 占位底色走变量（值由 coverStyle 写在行内），加载完成由 .has-image 撤掉 */
.jb-media {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  margin: 0;
  overflow: hidden;
  background: var(--ph, color-mix(in srgb, var(--jb-fg) 7%, var(--jb-bg)));
  transform: scale(1); /* 给 hover 缩放留一层，避免和 has-image 的过渡打架 */
}

/* 图片就位之后把占位底色撤掉 —— 这就是那条"描边"的来源：
   卡片带 3D 微倾、hover 时图又因为 scale(1.035) 提升成独立合成层，边缘重采样
   会留出 1px 的缝，而缝里露出的正是这层浅灰底色（实测左边和底边各一条）。
   底色一去，缝里露的是页面黑底，看不见了。 */
.jb-media.has-image {
  background: transparent;
}

.jb-media img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 1.1s var(--ease-out-expo), opacity 0.6s ease;
}

.jb-card:hover .jb-media img,
.jb-card:focus-visible .jb-media img {
  transform: scale(1.035);
}

/* 标题 + 阅读时长：默认沉在图下面，悬停/聚焦时滑出来（旧站 label 的做法） */
.jb-title,
.jb-read {
  margin: 0;
  opacity: 0;
  transition: opacity 0.55s ease, transform 0.75s var(--ease-out-expo);
}

.jb-title {
  font-family: 'Oswald', sans-serif;
  font-size: 0.98rem;
  font-weight: 500;
  line-height: 1.15;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--jb-fg);
  transform: translateY(-0.5rem);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.jb-read {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  white-space: nowrap;
  transform: translateY(-0.5rem);
}

.jb-read svg {
  width: 0.85rem;
  height: 0.85rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.jb-card:hover .jb-title,
.jb-card:hover .jb-read,
.jb-card:focus-visible .jb-title,
.jb-card:focus-visible .jb-read,
/* 触屏没有 hover：卡片获得焦点（点一下）时同样露出来 */
.jb-card:focus .jb-title,
.jb-card:focus .jb-read {
  opacity: 1;
  transform: translateY(0);
}

/* 骨架屏：底色由 coverStyle 的 background 承担，这里只留骨架本身 */
.jb-media .skeleton-loader {
  background: transparent;
}

/* 轨道末端 */
.jb-end {
  flex: 0 0 auto;
  width: 34vw;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}

.jb-end-mark {
  font-family: 'Oswald', sans-serif;
  font-size: 4rem;
  line-height: 1;
  color: var(--jb-line);
}

/* ── 页脚条 ──────────────────────────────────────────────────────────── */
.jb-rail {
  position: relative;
  z-index: 4;
  flex: 0 0 auto;
  padding: 0 var(--jb-side) 0;
}

.jb-rail-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  padding-bottom: 0.85rem;
}

.jb-rail-now {
  display: inline-flex;
  align-items: baseline;
  gap: 0.7rem;
  min-width: 0;
  /* ⚠ 这条**必须**写：容器不给 nowrap 的话，" / 24 " 那个分隔符在标题很长时
     会被压到比自身还窄 —— 它中间有个空格，于是 "/" 和 "24" 断成上下两行，
     整条页脚条被撑高一倍（实测 390 宽 + 长标题时行高从 20 变 37）。
     标题有 overflow: hidden，本来就会自己出省略号，不该让别的元素让位。 */
  white-space: nowrap;
}

/* 编号、分隔符、日期都**不参与压缩**：能做让步的只有标题。
   不写 flex: 0 0 auto 的话它们会跟着一起缩，然后就出现上面那种断行。 */
.jb-rail-idx,
.jb-rail-sep {
  flex: 0 0 auto;
}

.jb-rail-idx,
.jb-rail-sep,
.jb-rail-hint {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.66rem;
  font-weight: 500;
  letter-spacing: 0.16em;
}

.jb-rail-idx {
  color: var(--jb-fg);
}

.jb-rail-sep {
  color: var(--jb-dim);
}

.jb-rail-title {
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--jb-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* 唯一的可压缩项：min-width 显式归零，才真的缩得比内容窄、出得了省略号 */
  min-width: 0;
  flex: 0 1 auto;
}

.jb-rail-hint {
  color: var(--jb-faint);
  white-space: nowrap;
}

/* 当前篇的发布日期：和时间线刻度同一套字形、同一套大写 */
.jb-rail-date {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.66rem;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--jb-dim);
  white-space: nowrap;
  /* 同上：日期是"读数"，不该为了给长标题让位而缩 */
  flex: 0 0 auto;
}

/* ── 底部时间线（照参考站首页那条刻度尺）────────────────────────────────
   密集细刻度 + 更高的播放头 + 刻度下方的日期标签。 */
.jb-timeline {
  position: relative;
  height: 22px;
}

.jb-ticks {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 12px;
  height: 9px;
  pointer-events: none;
}

/* 刻度：贴着底部的一条细线。次刻度短、主刻度长一倍 —— 就是尺子的分度 */
.jb-tick {
  position: absolute;
  bottom: 0;
  width: 1px;
  height: 4px;
  background: color-mix(in srgb, var(--jb-fg) 22%, transparent);
}

.jb-tick.is-major {
  height: 9px;
  background: color-mix(in srgb, var(--jb-fg) 35%, transparent);
}

/* 已走过的那一层：整体提亮，播放头扫过时像"走过一段刻度尺" */
.jb-ticks.is-past .jb-tick {
  background: color-mix(in srgb, var(--jb-fg) 62%, transparent);
}

.jb-ticks.is-past .jb-tick.is-major {
  background: var(--jb-fg);
}

/* 播放头：一根比刻度高、更亮的线 */
.jb-playhead {
  position: absolute;
  bottom: 12px;
  width: 2px;
  height: 15px;
  margin-left: -1px;
  background: var(--jb-fg);
  will-change: left;
}

/* 刻度标签：贴着刻度线下方，居中在各自的刻度上；第一个左对齐，避免最左边溢出被裁 */
.jb-marks {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 11px;
  pointer-events: none;
}

.jb-mark {
  position: absolute;
  bottom: 0;
  transform: translateX(-50%);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.56rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--jb-dim);
  white-space: nowrap;
}

.jb-mark.is-first {
  transform: none;
}

/* 页脚：旧站那条版权在这儿压成一行小字，别和进度条抢 */
.jb-rail :deep(footer) {
  padding: 0.9rem 0 1rem;
  text-align: center;
}

.jb-rail :deep(footer p) {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.6rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--jb-faint);
}

/* ── ≤1024px：底部那条"空格键"Dock 是 fixed 的，永久占掉视口底下 68px ──── */
/* 舞台是 fixed + overflow:hidden 的（整页不滚动），不把它抬起来的话，
   时间轴刻度就**永远**压在 Dock 下面 —— 既看不见也点不到。
   这里只抬舞台，rail 跟着上移，卡片相应地矮一点。 */
@media (max-width: 1024px) {
  .jb-stage {
    padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px));
  }
}

/* ── 窄屏：轨道贴边、卡片变宽，字标降级到两行 ─────────────────────────── */
@media (max-width: 1100px) {
  .jb-stage {
    --jb-card-w: 34vw;
    --jb-gap: 1.5rem;
    --jb-side: 6vw;
    /* 轨道上方那道留白（桌面的 200px 是照着 900 高的视口给的）。矮屏 ——
       横屏平板 1024×768 这种 —— 200 加上 272 的字标就吃掉了 470/768，
       卡片被压成 348×113 的一条缝。按视口高给个上限，矮屏自动收紧，
       高屏（竖屏平板 1366）不受影响。 */
    --jb-rail: min(200px, 13vh);
  }
  .jb-wm-title {
    font-size: 6.6rem;
  }
  .jb-wm-desc {
    font-size: 0.62rem;
    letter-spacing: 0.16em;
  }
}

@media (max-width: 768px) {
  .jb-stage {
    --jb-card-w: 68vw;
    --jb-gap: 1.1rem;
    --jb-side: 7vw;
    /* 卡片的顶部留白。这里是"轨道上方给字标留的位置"，桌面要给编号+月份两行；
       窄屏两样都隐藏了（见下面 .jb-month / .jb-card-bottom），118px 那份留白
       白占着，既把卡片压矮又在字标和卡片之间留出一个大空档。 */
    --jb-rail: 56px;
  }
  .jb-wordmark {
    /* 窄屏 header 高 83px（20px 内边距 + 一行字），108 = 83 + 25 的呼吸位 */
    padding-top: 108px;
    /* 窄屏：字标左对齐（和下面轨道、页脚条同一条左边线） */
    align-items: flex-start;
    text-align: left;
  }
  .jb-wm-title {
    font-size: 3.9rem;
  }
  .jb-wm-desc {
    font-size: 0.56rem;
    letter-spacing: 0.12em;
    text-indent: 0; /* 窄屏左对齐，不需要补 tracking */
    line-height: 1.75;
  }
  /* 手机上标题交给详情页，卡片上只留编号（旧站也是窄屏隐藏 label） */
  .jb-card-bottom {
    display: none;
  }
  .jb-month {
    display: none;
  }
  .jb-rail-hint {
    display: none;
  }
  .jb-end {
    width: 60vw;
  }
}

/* ── 矮视口（横屏手机，≤560 高）─────────────────────────────────────────
   整页只有 300~400 高：字标（122 上边距 + 116 的巨号字）+ 页脚条 + 底部 Dock
   就把整屏吃光了 —— 实测 844×390 上轨道被挤成 0 高，页面上只剩一个 BLOGS 大字，
   一张卡片都看不到。这里把字标压成一行小号字、各种留白收到最小，
   先把卡片救回来（矮屏上卡片会偏扁，这是没办法的事：header 占 88、Dock 占 68）。 */
@media (max-height: 560px) {
  .jb-wordmark {
    padding-top: 92px;
  }

  .jb-wm-title {
    font-size: 2.4rem;
  }

  .jb-wm-desc {
    margin-top: 0.4rem;
    font-size: 0.5rem;
    letter-spacing: 0.12em;
  }

  .jb-stage {
    --jb-rail: 8px;
  }

  .jb-rail-row {
    padding-bottom: 0.45rem;
  }

  .jb-rail-hint {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  /* 字标/描述本来就没有入场动画了（见上面那两条注释），这里只剩封面与标签的过渡要关 */
  .jb-media img,
  .jb-title,
  .jb-read {
    transition: none;
  }
}
</style>
