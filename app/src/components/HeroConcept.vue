<script setup>
// 首页概念入口。
//
// 画面：Individuation 作为主体居中；四个人格化作粒子流，从主体身上散发出去、
// 在三维空间里环绕它。悬停某一条 → 粒子收拢、聚成那张照片；点击 → 共享元素过渡进博客。
//
// 最新 8 篇其他博客则完全不进这套粒子系统 —— 它们是 Hero **背后的一层拼贴底纹**：
// 去色、模糊、极淡，散在背景上，开场走完之后由 GSAP 一张一张淡进来
//（见 revealBlogWall）。不承载悬停、不承载点击。
//
// 三维是怎么落的：
//   - 人格的粒子场整个交给 Three.js（composables/usePersonaScene.js）。
//     每个粒子的位置在**顶点着色器**里算 —— CPU 每帧只改十几个 uniform。
//     之前是 2D 画布上每帧 JS 循环画 5000 多个点，实测那一项就吃掉大半个帧预算。
//   - DOM 的 .persona 保留成**隐形命中区 + 标签**，
//     位置和缩放每帧由同一个投影公式算出来。所以悬停、拖动全都不用重写。
//     ⚠ 它**不再**挂 view-transition-name —— 理由见下面"样式绑定"那段。
//   - 投影公式只有一份：相机在 (0,0,NEAR) 看向 -Z，屏幕偏移 = 世界坐标 ×
//     focal / (NEAR - z)。组件用 project() 摆 DOM，着色器里是同一套。
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import gsap from 'gsap';
import { blogBySlug, blogPosts } from '../data/blogPosts.js';
import { navigateWithViewTransition } from '../composables/useViewTransition.js';
import { rememberCoverHandoff } from '../composables/useCoverHandoff.js';
import { createRippleEffect } from '../composables/useRippleEffect.js';
import { useTheme } from '../composables/useTheme.js';
import { useBrandOverlay } from '../composables/useBrandOverlay.js';
import { useWallPref } from '../composables/useWallPref.js';
import {
  CARD_HALF,
  NEAR,
  RING_R,
  TILT,
  createPersonaScene,
} from '../composables/usePersonaScene.js';

const { isDark } = useTheme();

// 背景拼贴开不开：状态提到 composables/useWallPref.js 里了。
// 手机上这个开关也收进了汉堡菜单（MobileDock），那边要读同一个 ref。
const { wallHidden } = useWallPref();
// 品牌遮罩揭开之后，那个 LIVEINPASSION 由这里接着显示成 Hero 的一层背景字
const { entered: brandEntered, wordmarkOn } = useBrandOverlay();

// ── 升起那 1.25 秒里，不让"这一页"长出滚动条 ─────────────────────────────
// Hero 的入场是 `transform: translateY(100%) → 0`（见 .hero-concept 的 --rise），
// 而带 transform 的后代会把**祖先滚动容器**的滚动区撑大一屏。首页那一页正是
// `overflow-y: auto` 的滚动容器（main.css 的 .page），所以：
//   遮罩揭开 → body 的 no-scroll 撤掉 → 这一页立刻可滚、且高出一屏
//   → 右边冒出滚动条；等升起结束（transform 归零）滚动区缩回去，它才消失。
// 实测确认过：给 Hero 强加一个 translateY，文档高度不变（900），涨的是 .page 的滚动区。
// 解法：升起的这段时间把这一页的纵向改成 clip（裁剪、不产生滚动条），升完还原。
// ⚠ 只在这一页上临时改，不能动 .page 的通用规则 —— 别的页面（ME / 相册）
//   就靠这条 auto 滚动。
const RISE_MS = 1250; // 与 .hero-concept 的 transform 过渡时长一致
let riseClipTimer = 0;

function toggleRiseClip(on) {
  const page = heroEl.value?.closest('.page');
  if (!page) return;
  page.style.overflowY = on ? 'clip' : '';
}

watch(brandEntered, (v) => {
  if (!v) return;
  clearTimeout(riseClipTimer);
  toggleRiseClip(true);
  // 兜底：过渡被跳过（reduce-motion）时不会有 transitionend，用定时器收尾
  riseClipTimer = setTimeout(() => toggleRiseClip(false), RISE_MS + 120);
});

// ── 配置表：四个入口全在这里改 ──────────────────────────────────────────
// slug 对应 CMS 里那四篇以人格命名的 fragment 文章（在后台就是按人格分的）：
//   ROMANTICIST - FRAGMENT I / IDEALIST - FRAGMENT II
//   ADVOCATE - FRAGMENT III / OBSERVER - FRAGMENT IV
// 之前错填成了"最新四篇"，所以点哪张都跳不到对应那篇。
//
// src 指向 me/personas/N.jpg —— 由 tools/build-personas.mjs 从 example/ 那四张
// 效果图压出来（720×960，42~59KB；原图是 11~25MB 的 PNG，不能直接上线）。
//
// ⚠ 哪张效果图对应哪个人格，是照画面里的衣服/背景特征对的（四张都是同一个人
//   同一角度，只能靠衣服和背景认）：
//     2.jpg 绗缝上衣            → Idealist
//     3.jpg 左上角斜向亮带      → Observer
//     1.jpg 带扣门襟的连帽衫    → Romantics
//     4.jpg 排除剩下的          → Advocate
//   3 和 4 把握一般。要是对错了，只改这里的 src，别处都不用动。
const PERSONAS = [
  {
    id: 'romantics',
    label: 'Romantics',
    slug: 'romanticist-fragment-i',
    src: '/me/personas/1.jpg',
  },
  {
    id: 'idealist',
    label: 'Idealist',
    slug: 'idealist-fragment-ii',
    src: '/me/personas/2.jpg',
  },
  {
    id: 'advocate',
    label: 'Advocate',
    slug: 'advocate-fragment-iii',
    src: '/me/personas/4.jpg',
  },
  {
    id: 'observer',
    label: 'Observer',
    slug: 'observer-fragment-iv',
    src: '/me/personas/3.jpg',
  },
];

// ── 背景拼贴：其他博客 ──────────────────────────────────────────────────
// CMS 里最新的 8 篇**非人格**文章（人格那四篇已经是环上那四格了）。
//
// 位置写死成一张表，不随机：背景是构图的一部分，每次刷新都换个摆法会让
// 主体和人格的位置看起来忽紧忽松。数组顺序 = 淡入的先后。
// x/y 是左上角在 hero 里的百分比，w 是宽度（占 hero 宽的百分比），r 是旋转角度。
// 摆法刻意避开中间那块 —— 主体在 x 30~70% / y 20~80%，压上去会糊成一片。
const WALL = [
  { x: 2, y: 9, w: 13, r: -6 },
  { x: 12, y: 61, w: 11, r: 4 },
  { x: 23, y: 5, w: 10, r: 7 },
  { x: 31, y: 75, w: 12, r: -3 },
  { x: 57, y: 4, w: 11, r: 5 },
  { x: 68, y: 71, w: 13, r: -7 },
  { x: 82, y: 12, w: 12, r: 3 },
  { x: 86, y: 57, w: 10, r: -4 },
];

const PERSONA_SLUGS = new Set(PERSONAS.map((p) => p.slug));

// src 用**压缩图**：这层被模糊 + 去色 + 压到两成不透明度，原图那点细节看不出来，
// 白白多花十几倍字节。
const BLOG_WALL = blogPosts
  .filter((p) => !PERSONA_SLUGS.has(p.slug) && p.image?.src)
  .slice(0, WALL.length)
  .map((p, i) => ({ slug: p.slug, src: p.image.src, ...WALL[i] }));

const ORBIT_PERIOD = 60; // 公转一圈多少秒

// 主体：个体化。悬停时水波纹 + 鼠标处粒子重组；点它把散出去的四条收回来（不跳转）。
const SUBJECT = {
  src: '/me/hero_compressed/Individuation.jpg',
  alt: 'Individuation',
};

// 四个人格绕主体公转的那条环。
const rings = {
  persona: {
    r: RING_R,
    count: PERSONAS.length,
    phase: -Math.PI / 2,
    speed: (Math.PI * 2) / ORBIT_PERIOD,
    angle: 0,
  },
};

// ── 粒子采样 ────────────────────────────────────────────────────────────
const SAMPLE_W = 56;          // 人格降采样网格宽度
const SUBJECT_SAMPLE_W = 74;  // 主体的
const CARD_ASPECT = 3 / 4;    // 卡片（.persona）的宽高比，采样按它裁图
const MIN_LUMA = 26;          // 低于此亮度的采样点丢弃（背景不生成粒子）
const GRAY_LEVELS = 12;       // 灰阶量化级数
const ASSEMBLE_MS = 620;      // 重组时长
const ASSEMBLED_AT = 0.62;
// 主体"先实后散"：人像从点 ENTER 起就在（Hero 浮上来时已经能看到），
// 开场走完再停这么久才开始化开，化开用 SUBJECT_DISSOLVE_S。
const SUBJECT_SOLID_HOLD = 0.5;
const SUBJECT_DISSOLVE_S = 1.6;    // 进度超过这里算"已成图"，开始淡入真实照片
const SPREAD = 0.45;          // 每个粒子的起飞延迟跨度
const DRAG_SLOP = 6;          // 超过这么多像素才算拖动，否则当成点击
const IDLE_INTERVAL = 1000 / 24; // 静止飘动的帧间隔

// 主体粒子和四条流的互相影响（只作用在主体的粒子层上）
const LINK = { reach: 0.62, pull: 7, push: 34 };
// 主体粒子层与背景融合的边缘丢弃：椭圆取景已经负责大关系，这里只让最外圈稀一点
const EDGE = { fade: 0.18 };
// 主体粒子层
const GRAIN = {
  restAlpha: 0.94,
  falloff: 1.15,
  wander: 2.2,
  focusRadius: 0.2,
};
// 旗帜波纹
const FLAG = { amp: 11, k: 3.4, speed: 2.0 };

// 开场
const INTRO_MS = 2400;
const INTRO_SPIN_AT = 0.55; // 展开到多少就放开公转（太晚会有一段"到位但不动"的死停）

const router = useRouter();
const heroEl = ref(null);
const wallEl = ref(null);
const stageEl = ref(null);
const orbitEl = ref(null);
const sceneCanvas = ref(null);
const subjectEl = ref(null);
const rippleCanvas = ref(null);
const grainCanvas = ref(null);

const groups = ref([]);
const assembledSet = ref({});
const forcedAssembled = ref(null);
let subjectParticles = null;

// ── 方块光标 ────────────────────────────────────────────────────────────
const cursorEl = ref(null);
const cursorVisible = ref(false);
const cursorActive = ref(false);
const finePointer = ref(false);
const reducedMotion = ref(false);
const isCompact = ref(false);
// 主题切换时的淡出态。必须是 Vue 状态而不是手动加类 ——
// 这个元素上挂着 :class 绑定，重渲染时 Vue 会把手动加的类冲掉。
const themeShifting = ref(false);
let rafCursor = 0;
let cursorX = 0;
let cursorY = 0;

function flushCursor() {
  rafCursor = 0;
  if (cursorEl.value) cursorEl.value.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0)`;
}
function onPointerMove(event) {
  if (!finePointer.value) return;
  cursorX = event.clientX;
  cursorY = event.clientY;
  if (!cursorVisible.value) cursorVisible.value = true;
  if (!rafCursor) rafCursor = requestAnimationFrame(flushCursor);
}
function onPointerLeave() {
  cursorVisible.value = false;
  cursorActive.value = false;
}

// ── 采样图片 ────────────────────────────────────────────────────────────
// gx/gy 是 0..1 的图内坐标；u 是"沿流的位置"；seed 决定起飞延迟和抖动相位。
//
// aspect 给的是**卡片元素**的宽高比（CARD_ASPECT）。图片比例和它不一致时先按
// `object-fit: cover` 裁再采 —— 不裁的话粒子摊成图片自己的比例，而卡片里那张
// 照片是裁过显示的，悬停成图的那一下形状会明显跳一下。人格图和主体图本来
// 就是 3:4，所以这里对它们是无操作；博客封面比例什么样都有，必须裁。
// source 是 <img>（人格那四张、主体那张）。取尺寸时留一个 canvas 的兜底，
// 只是因为 canvas 没有 naturalWidth —— 采样函数本身对两者都成立。
function sourceSize(source) {
  return {
    w: source.naturalWidth || source.width,
    h: source.naturalHeight || source.height,
  };
}

function sampleParticles(img, sampleW, aspect = null) {
  const sw = sampleW;
  const { w: iw, h: ih } = sourceSize(img);
  const ar = aspect || (iw / ih);
  const sh = Math.max(1, Math.round(sw / ar));
  let sx = 0;
  let sy = 0;
  let cw = iw;
  let ch = ih;
  if (aspect) {
    if (iw / ih > aspect) {
      cw = ih * aspect;       // 图更宽 → 裁两边
      sx = (iw - cw) / 2;
    } else {
      ch = iw / aspect;       // 图更高 → 裁上下
      sy = (ih - ch) / 2;
    }
  }

  const off = document.createElement('canvas');
  off.width = sw;
  off.height = sh;
  const ctx = off.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, sx, sy, cw, ch, 0, 0, sw, sh);
  let data;
  try {
    data = ctx.getImageData(0, 0, sw, sh).data;
  } catch {
    // 跨域的图会把画布"污染"掉，getImageData 直接抛 SecurityError。
    // 宁可这一格没有粒子，也不能让异常顺着 sampleParticles 把整条管线带崩
    //（外圈的封面走 loadImage 的 crossOrigin 分支，正常情况下不会走到这里）。
    return [];
  }

  const items = [];
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      if (data[i + 3] < 128) continue;
      const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (luma < MIN_LUMA) continue;
      items.push({
        gx: sw > 1 ? x / (sw - 1) : 0,
        gy: sh > 1 ? y / (sh - 1) : 0,
        v: luma / 255,
        level: Math.min(GRAY_LEVELS - 1, Math.floor((luma / 255) * GRAY_LEVELS)),
        // 每个粒子随机乘一下，飘动幅度才不整齐
        drift: 0.5 + Math.random() * GRAIN.falloff,
        seed: Math.random(),
        // 大部分粒子归末端的人形，其余铺满整条流
        u: Math.random() < 0.62 ? 0.86 + Math.random() * 0.14 : Math.random() * 0.86,
      });
    }
  }
  return items;
}

// 按灰阶排序并记录区间。绘制时每段合成一条 Path2D 一次 fill，
// 10 次 fill 顶掉几千次 fillRect —— 实测快 5 倍，这是稳 60fps 的关键。
function buildBuckets(items) {
  items.sort((a, b) => a.level - b.level);
  const buckets = [];
  for (let i = 0; i < items.length;) {
    let j = i;
    while (j < items.length && items[j].level === items[i].level) j++;
    buckets.push({
      gray: Math.round((items[i].level / (GRAY_LEVELS - 1)) * 255),
      start: i,
      end: j,
    });
    i = j;
  }
  return buckets;
}

const easeOut = (t) => t * t * t * (t * (t * 6 - 15) + 10); // smootherstep

// ── 三维场景 ────────────────────────────────────────────────────────────
let scene3d = null;
// 必须是 ref：首帧渲染时场景还没建好，如果这是普通变量，imageVisible 会返回 true
// 把四张照片以 opacity:1 写死，而之后没有任何重渲染去纠正它 —— 粒子场永远被照片盖住。
const sceneOk = ref(false);
let spinOn = false;     // 展开到位后才开始累加
let lastSceneT = 0;
let focalPx = 1000;
// 环在屏幕上被**横向**压扁的比例（1 = 正圆）。焦距是按 hero 的**高度**算的，
// 竖屏手机上高度远大于宽度，正圆会宽出屏幕一倍多 —— 最左/最右那两格连同标签
// 被视口切掉（实测 iPhone 上只剩 "RVER"、"IDEALI"）。这里只压 x 轴：
// 卡片是永远正对相机的平面，压扁轨道不会让它变形；卡片的尺寸、主体的尺寸、
// 上下留白全部保持原样。由 relayout() 按可用宽度算出来。
let ringSquashX = 1;
// 环最外侧那张卡片离屏幕边留的余量（CSS 像素）
const RING_EDGE = 12;

// 每一格此刻在世界里的位置（被拖走的用落点，其余按它所属的环算）
const world = [];

/** 环上第 slot 个槽位的世界坐标。 */
function groupWorldAt(ring, slot) {
  const th = (Math.PI * 2 * slot) / Math.max(1, ring.count) + ring.phase + ring.angle;
  const r = ring.r * introEased;
  const lx = r * Math.cos(th) * ringSquashX;
  const ly = r * Math.sin(th);
  // 环面绕 X 轴倾斜：上方往后退、下方往前靠，四格会周期性在远近之间轮转
  return { x: lx, y: ly * Math.cos(TILT), z: ly * Math.sin(TILT) };
}

function groupWorld(i) {
  const g = groups.value[i];
  if (!g) return { x: 0, y: 0, z: 0 };
  if (g.placed) return { x: g.placed.x, y: g.placed.y, z: 0 };
  return groupWorldAt(rings.persona, i);
}

function buildSceneParticles(images) {
  const local = [];
  const color = [];
  const uu = [];
  const seed = [];
  const group = [];
  images.forEach((img, gi) => {
    if (!img) return;
    for (const p of sampleParticles(img, SAMPLE_W, CARD_ASPECT)) {
      // 世界 y 向上，采样 gy 向下 —— 取负
      local.push((p.gx - 0.5) * 2 * CARD_HALF.x, (0.5 - p.gy) * 2 * CARD_HALF.y, 0);
      color.push(p.v, p.v, p.v);
      uu.push(p.u);
      seed.push(p.seed);
      group.push(gi);
    }
  });
  return {
    local: Float32Array.from(local),
    color: Float32Array.from(color),
    u: Float32Array.from(uu),
    seed: Float32Array.from(seed),
    group: Float32Array.from(group),
  };
}

// 每帧：推进公转 → 算四个世界位置 → 更新 uniform → 摆 DOM → 渲染
function updateScene(now) {
  if (!scene3d) return;
  const stage = stageEl.value;
  if (!stage) return;
  const sb = stage.getBoundingClientRect();
  const dt = Math.min(64, now - (lastSceneT || now));
  lastSceneT = now;

  if (spinOn) rings.persona.angle += (dt / 1000) * rings.persona.speed;

  // 主体在场景里的中心与半尺寸（世界单位）。主体是 DOM，位置现读。
  const su = readSubject();
  if (su) {
    scene3d.uniforms.uSubject.value.set(subjectBox.sx / focalPx, -subjectBox.sy / focalPx);
    scene3d.uniforms.uSubjectHalf.value.set(
      subjectBox.hw / focalPx,
      subjectBox.hh / focalPx
    );
  }

  const groupPos = scene3d.uniforms.uGroupPos.value;
  for (let i = 0; i < groups.value.length; i++) {
    const w = groupWorld(i);
    world[i] = w;
    groupPos[i].set(w.x, w.y, w.z);
  }
  scene3d.uniforms.uTime.value = now / 1000;
  scene3d.render();

  // DOM：用同一个投影摆位。transform 落在合成层，不触发布局。
  for (let i = 0; i < groups.value.length; i++) {
    const g = groups.value[i];
    if (!g?.el) continue;
    const w = world[i];
    const pr = scene3d.project(w.x, w.y, w.z);
    g.el.style.transform =
      `translate(-50%, -50%) translate(${pr.x}px, ${pr.y}px) scale(${pr.scale.toFixed(4)})`;
  }
}

// ── 主体：位置（画布坐标 + 舞台坐标）、水波纹、粒子层 ────────────────────
const subjectBox = { cx: 0, cy: 0, hw: 0, hh: 0, sx: 0, sy: 0 };

function readSubject() {
  const el = subjectEl.value;
  const stage = stageEl.value;
  if (!el || !stage) return false;
  const r = el.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  subjectBox.cx = r.left + r.width / 2 - (s.left + s.width / 2);
  subjectBox.cy = r.top + r.height / 2 - (s.top + s.height / 2);
  subjectBox.sx = subjectBox.cx;
  subjectBox.sy = subjectBox.cy;
  subjectBox.hw = r.width / 2;
  subjectBox.hh = r.height / 2;
  return true;
}

function layoutGrain() {
  const canvas = grainCanvas.value;
  if (!canvas || !subjectParticles) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  subjectParticles.ctx = canvas.getContext('2d');
  subjectParticles.dpr = dpr;
  subjectParticles.w = w;
  subjectParticles.h = h;
}

// 主体的粒子层：散着的时候飘，鼠标附近锁到准确位置并变实；叠一层旗帜波纹。
function drawGrain(now, packed) {
  const sp = subjectParticles;
  if (!sp || !sp.ctx) return;
  const ctx = sp.ctx;
  const dpr = sp.dpr;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, sp.w, sp.h);

  const inv = isDark.value ? 0 : 255;
  const radius = sp.w * GRAIN.focusRadius;
  const t0 = now * 0.0006;
  const fs = now * 0.001 * FLAG.speed;

  ctx.globalAlpha = GRAIN.restAlpha;
  const size = 1.85;

  // 四条流末端在这块画布坐标系里的位置 —— 主体的粒子要对它们起反应
  const gbox = grainCanvas.value?.getBoundingClientRect();
  const heads = [];
  if (gbox) {
    for (const el of groupEls) {
      const r = el.getBoundingClientRect();
      heads.push({ x: r.left - gbox.left + r.width / 2, y: r.top - gbox.top + r.height / 2 });
    }
  }
  const reach = sp.w * LINK.reach;
  const halfDiag = Math.hypot(sp.w / 2, sp.h / 2) || 1;

  // 先判断有没有流靠得够近，值不值得让主体粒子参与互动
  let linkActive = false;
  let pushActive = false;
  for (const h of heads) {
    const d = Math.hypot(h.x - sp.w / 2, h.y - sp.h / 2);
    if (d < halfDiag + reach) linkActive = true;
    if (d < reach) pushActive = true;
  }

  // 按灰阶分段（12 段），每段合成一条 Path2D 再一次 fill —— 实测比逐粒子
  // fillRect 快 5 倍，这是能不能稳在 60fps 的关键。
  const buckets = sp.buckets;
  for (const b of buckets) {
    const v = Math.abs(inv - b.gray);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    const path = new Path2D();
    for (let i = b.start; i < b.end; i++) {
      const p = sp.items[i];
      const tx = p.gx * sp.w;
      const ty = p.gy * sp.h;

      // 椭圆取景之外的粒子直接丢掉（和 .hero-subject 的 mask 呼应）
      const edgeDist = Math.min(p.gx, 1 - p.gx, p.gy, 1 - p.gy);
      const k = Math.min(1, edgeDist / EDGE.fade);
      if (p.seed > k * k * (3 - 2 * k)) continue;

      let focus = 0;
      if (packed) {
        const d = Math.hypot(tx - packed.x, ty - packed.y);
        focus = 1 - Math.min(1, d / radius);
        focus = focus * focus * (3 - 2 * focus);
      }

      // 旗帜波纹：位移由中心向外增强；重组区把它压掉
      const nx = (p.gx - 0.5) * 2;
      const ny = (p.gy - 0.5) * 2;
      const rr = Math.min(1, Math.hypot(nx, ny) / Math.SQRT2);
      const amp = rr * rr * FLAG.amp * (1 - focus * 0.85);
      const flagX = (Math.sin(nx * FLAG.k + fs * 2.1) * 0.6 + Math.sin(ny * 2.4 - fs * 1.5) * 0.4) * amp;
      const flagY = Math.cos(nx * 2.2 + ny * 1.3 + fs * 1.7) * amp;

      // 与四条流的互相影响
      let linkX = 0;
      let linkY = 0;
      if (linkActive) {
        const edge = Math.min(1, Math.hypot(tx - sp.w / 2, ty - sp.h / 2) / halfDiag);
        const e = Math.max(0, edge - 0.35) / 0.65;
        if (e > 0 || pushActive) {
          let bestD = Infinity;
          let bestI = 0;
          for (let h = 0; h < heads.length; h++) {
            const ddx = heads[h].x - tx;
            const ddy = heads[h].y - ty;
            const dd = ddx * ddx + ddy * ddy;
            if (dd < bestD) { bestD = dd; bestI = h; }
          }
          const hd = heads[bestI];
          const dist = Math.sqrt(bestD) || 1;
          const ux = (hd.x - tx) / dist;
          const uy = (hd.y - ty) / dist;
          linkX = ux * LINK.pull * e;
          linkY = uy * LINK.pull * e;
          if (dist < reach) {
            const f = (1 - dist / reach) ** 2 * LINK.push;
            linkX -= ux * f;
            linkY -= uy * f;
          }
        }
      }

      const w = (1 - focus) * GRAIN.wander * p.drift;
      const px = tx + flagX + linkX + Math.sin(t0 + p.seed * 61) * w;
      const py = ty + flagY + linkY + Math.cos(t0 * 1.27 + p.seed * 43) * w;
      path.rect(px, py, size, size);
    }
    ctx.fill(path);
  }
  ctx.globalAlpha = 1;
}

// ── 开场 ────────────────────────────────────────────────────────────────
const intro = ref(-1);
let introEased = 1;
let introT0 = 0;

function startIntro() {
  if (intro.value >= 0) return;
  if (reducedMotion.value) {
    intro.value = 1;
    introEased = 1;
    spinOn = true;
    applyIntro();
    return;
  }
  intro.value = 0;
  introEased = 0;
  introT0 = 0;
  applyIntro();
  ensureTicking();
}

function applyIntro() {
  if (scene3d) scene3d.uniforms.uIntro.value = introEased;
}

// ── 背景字下面那行小字 ──────────────────────────────────────────────────
// 首屏动画（遮罩揭开 → 主体展开 INTRO_MS）整个走完，才在 LIVEINPASSION 下面
// 逐字打出 INDIVIDUATION。
// 挂的是**开场进度**这个信号而不是"遮罩揭开"：遮罩揭开时字刚落回中间、
// 四条人格还在从主体身上往外长，那会儿打字会和画面抢注意力。
const CAPTION_LETTERS = [...'INDIVIDUATION'];
const captionOn = ref(false);

watch(intro, (v) => {
  // 关了动效时开场是瞬时到位的（startIntro 里直接把 intro 置 1），这里同样接得住
  if (v < 1) return;
  captionOn.value = true;
  // 开场走完才去取背景那 8 张封面（首屏请求要紧，见 revealBlogWall）
  revealBlogWall();
  // 开场落定 → 停一拍就把主体的人像化开成粒子
  scheduleSubjectDissolve();
});

// ── 动画驱动 ────────────────────────────────────────────────────────────
let masterRaf = 0;
const heroVisible = ref(true);
const heroBox = { left: 0, top: 0 };
const groupEls = [];

function paused() {
  return document.hidden || !heroVisible.value;
}

function ensureTicking() {
  if (!masterRaf && !paused()) masterRaf = requestAnimationFrame(tick);
}

function tick(now) {
  masterRaf = 0;
  let again = false;

  // 开场：每帧推一点 uIntro，展开到位后放开公转
  if (intro.value >= 0 && intro.value < 1) {
    if (!introT0) introT0 = now;
    const t = Math.min(1, (now - introT0) / INTRO_MS);
    intro.value = t;
    introEased = easeOut(t);
    if (introEased >= INTRO_SPIN_AT) spinOn = true;
    applyIntro();
    again = true;
  }

  // 各组的成图进度
  let busy = intro.value >= 0 && intro.value < 1;
  for (const g of groups.value) {
    if (g.progress !== g.target) {
      const dt = Math.min(64, now - (g.last || now));
      g.last = now;
      const step = dt / ASSEMBLE_MS;
      g.progress = g.target > g.progress
        ? Math.min(g.target, g.progress + step)
        : Math.max(g.target, g.progress - step);
      const done = g.progress >= ASSEMBLED_AT;
      if (done !== !!assembledSet.value[g.config.id]) assembledSet.value[g.config.id] = done;
      busy = true;
    }
  }

  if (scene3d) {
    for (let i = 0; i < groups.value.length; i++) {
      scene3d.uniforms.uProgress.value[i] = groups.value[i].progress;
    }
  }

  // 场景每帧都要更新：公转一直在走，DOM 的位置也就一直在动
  if (scene3d) {
    updateScene(now);
    again = true;
  }

  // 主体的粒子层：重组/开场时满帧，静止时降到 24fps
  if (subjectParticles?.ctx) {
    if (busy || now - lastIdleDraw >= IDLE_INTERVAL) {
      lastIdleDraw = now;
      drawGrain(now, grainMouse);
    }
  }

  if (again && !paused()) masterRaf = requestAnimationFrame(tick);
}

let lastIdleDraw = 0;
let grainMouse = null;

function setTarget(g, value) {
  if (g.target === value) return;
  g.target = value;
  ensureTicking();
}

// ── 交互 ────────────────────────────────────────────────────────────────
function onTileEnter(g) {
  if (!finePointer.value) return;
  cursorActive.value = true;
  setTarget(g, 1);
  preloadCover(g.config);
}

function onTileLeave(g) {
  if (!finePointer.value) return;
  if (drag.id === g.config.id) return; // 拖拽中别散开
  cursorActive.value = false;
  setTarget(g, 0);
}

const preloaded = new Set();
function preloadCover(config) {
  if (preloaded.has(config.slug)) return;
  preloaded.add(config.slug);
  const post = blogBySlug[config.slug];
  const url = post?.image?.fullSrc || post?.image?.src;
  if (!url) return;
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
}

// ── 图 ──────────────────────────────────────────────────────────────────
// 只取一张图；失败也算结果（resolve(null)）—— 少一张图不该让整个 Hero 停住。
function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ── 背景拼贴的揭示 ──────────────────────────────────────────────────────
// 那 8 张封面**不进首屏请求**：首屏已经有 5 张图（4 个人格 + 主体），再叠 8 张
// CDN 封面会把首屏请求数翻一倍多，而它们只是背景底纹，晚几秒完全不影响观看。
// 等开场动画走完（intro 到 1）再去取，取到一张就用 GSAP 淡进来一张。
//
// 为什么一张一张而不是一起显：一次全出来的话，整块背景"啪"地闪一下，
// 会和开场那一下抢注意力。错开之后它是一层慢慢长出来的底纹。
// 错开量写成"序号 × 固定步长"而不是"谁先加载完谁先亮"—— 后者在快网络下
// 会挤成一团、在慢网络下又会变成乱序。
let wallRevealed = false;

function revealBlogWall() {
  if (wallRevealed) return;
  wallRevealed = true;
  const els = [...(wallEl.value?.querySelectorAll('img') || [])];
  if (!els.length) return;

  els.forEach((el, i) => {
    const entry = BLOG_WALL[i];
    if (!entry) return;
    // 直接挂到真元素上、听它自己的 load：省掉"先用 Image 预热再赋值"的第二次请求
    el.addEventListener('load', () => {
      if (reducedMotion.value) {
        gsap.set(el, { autoAlpha: 1 });
        return;
      }
      // ⚠ 只动 autoAlpha（opacity + visibility），**不碰 transform**。
      // 这一格的位置/尺寸/角度全是 Vue 的 :style 绑定写的（left/top/width/--r），
      // 而 GSAP 的 clearProps: 'all' 会把行内样式**整条**抹掉 —— 包括那几个绑定，
      // 于是图失去宽度和定位，退回原始尺寸铺在静态位置上：就是"闪烁 + 放大"。
      // 只写 opacity/visibility 的话两边互不干涉，也不需要 clearProps。
      // 浓度（--wall-opacity）挂在容器上，所以这里淡到 1 就对了，收尾没有跳变。
      gsap.fromTo(
        el,
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 1.15, delay: i * 0.22, ease: 'power2.out' }
      );
    }, { once: true });
    el.src = entry.src;
  });
}

async function onTileClick(event, config) {
  if (suppressClick) {
    suppressClick = false;
    event.preventDefault();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault();
  if (!blogBySlug[config.slug]) return;
  forcedAssembled.value = config.id;
  await nextTick();
  // 把"从哪一格点进来的"交给详情页：详情页的封面会用 GSAP 从这块矩形 FLIP 过去。
  // （详情页原来是靠 view-transition-name 的共享元素形变接的；那套已经换成
  //   GSAP + 这条 sessionStorage 交接，所以这里必须补上，否则从首页进来封面没有起点。）
  rememberCoverHandoff(config.slug, event.currentTarget);
  await navigateWithViewTransition(router, { name: 'blog-detail', params: { slug: config.slug } });
  forcedAssembled.value = null;
}

// ── 拖动 ────────────────────────────────────────────────────────────────
// 落点存**世界坐标**：DOM 位置和粒子位置都要用它，存屏幕坐标的话两者会脱节。
let suppressClick = false;
const drag = { id: null, active: false, sx: 0, sy: 0, drop: { x: 0, y: 0 } };

function onDragMove(event) {
  if (drag.id == null) return;
  if (!drag.active) {
    if (Math.hypot(event.clientX - drag.sx, event.clientY - drag.sy) < DRAG_SLOP) return;
    drag.active = true;
    const g = groups.value.find((x) => x.config.id === drag.id);
    if (g) setTarget(g, 1);
  }
  const s = stageEl.value?.getBoundingClientRect();
  if (!s) return;
  const sx = event.clientX - (s.left + s.width / 2);
  const sy = event.clientY - (s.top + s.height / 2);
  // 世界坐标 = 屏幕偏移 ÷ (焦距 ÷ NEAR)。分母是 focal/NEAR 而不是 focal ——
  // z=0 处一个世界单位才是 focal/NEAR 像素。漏掉 NEAR 会让落点整体偏出一个 NEAR 倍。
  drag.drop = { x: (sx * NEAR) / focalPx, y: (-sy * NEAR) / focalPx };
  // 必须**实时**写进 placed：groupWorld 只有看到 placed 才会用落点，
  // 否则拖动过程中它一直返回环上的位置 —— 指针在动、人格不动。
  const g = groups.value.find((x) => x.config.id === drag.id);
  if (g) g.placed = { x: drag.drop.x, y: drag.drop.y };
}

function onDragEnd() {
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragEnd);
  if (!drag.id) return;
  if (drag.active) {
    const g = groups.value.find((x) => x.config.id === drag.id);
    if (g) {
      // 落点离它在环上的位置很近就吸回去 —— 否则拖出去就再也放不回来了
      // 和**按下那一刻**的位置比，而不是和松手时刻的环位置比。
      // 环在这 1 秒里自己会转出 ~90px，朝落点方向挪一截的话，
      // 一个正常的拖拽也会被误判成放回原处而吸附掉（实测 dist 0.0756 < 阈值 0.09）。
      const near = drag.home
        && Math.hypot(drag.drop.x - drag.home.x, drag.drop.y - drag.home.y) < 0.06;
      g.placed = near ? null : { x: drag.drop.x, y: drag.drop.y };
    }
    suppressClick = true;
  }
  drag.id = null;
  drag.active = false;
  ensureTicking();
}

function onTileDown(event, g) {
  if (!finePointer.value || event.button !== 0) return;
  suppressClick = false;
  drag.id = g.config.id;
  drag.active = false;
  drag.sx = event.clientX;
  drag.sy = event.clientY;
  // 记住它此刻在哪 —— 松手时用来判断是不是放回原处。
  // 取的是**环上**的位置（不看 placed），和"按下那一刻"对齐。
  // 记住它此刻在环上的位置 —— 松手时用来判断是不是放回原处
  const idx = groups.value.indexOf(g);
  drag.home = idx >= 0 ? { ...groupWorldAt(rings.persona, idx) } : null;
  g.placed = null; // 重新抓住它
  try {
    event.currentTarget.setPointerCapture?.(event.pointerId);
  } catch {
    // 捕获失败也不影响：window 上还挂着监听
  }
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragEnd);
}

// ── 主体：水波纹 + 粒子层 ───────────────────────────────────────────────
const subjectHovered = ref(false);
let ripple = null;
let rippleGone = false;

// 涟漪画布的"背景"必须和 hero 的实际背景完全一致，否则那块画布会比背景
// 亮一点点、露出一个矩形。
//
// 读的是 CSS 变量 --hero-bg，**不是 getComputedStyle().backgroundColor**：
// 背景色现在是带过渡的（0.4s），而这个函数在主题切换后 230ms 就被调用，
// 读计算值会拿到黑到白之间约 57% 处的一片中灰 —— 淡出那 230ms 把它遮住了，
// 但淡回来之后画布就带着这个错颜色一直留着（"背景颜色不协调"就是这么来的）。
// 自定义属性不参与过渡，拿到的永远是目标值。
function syncRippleBackground() {
  if (!ripple || !heroEl.value) return;
  const raw = getComputedStyle(heroEl.value).getPropertyValue('--hero-bg').trim();
  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  let lum;
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  } else {
    lum = isDark.value ? 0 : 0.98;
  }
  ripple.setBackground(lum);
}

async function setupRipple() {
  if (!finePointer.value || reducedMotion.value || !rippleCanvas.value) return;
  const canvas = rippleCanvas.value;
  let instance = null;
  try {
    instance = await createRippleEffect(canvas, SUBJECT.src);
  } catch {
    return;
  }
  if (rippleGone || !instance) return;
  ripple = instance;
  syncRippleBackground();
  ripple.setHover(subjectHovered.value);
  // 涟漪层（"完整人像"那一层）就绪了才能演"先实后散"。
  // 遮罩早就揭开过了的话（涟漪加载慢），这里会立刻把人像亮起来。
  if (brandEntered.value) showSubjectSolid();
}

// ── 主体：先完整人像，再粒子化 ──────────────────────────────────────────
// 静止时这一格本来**只有粒子**（涟漪层的 uRestSolid = 0，把人像整个让掉了）。
// 但一上来就是一堆粒子，看不出"这是个人"，所以改成两步：
//   ① 点 ENTER 的那一刻 —— Hero 正从下方浮上来 —— 人像就已经是模糊的完整人像；
//   ② 开场动画走完、停一拍，再化开成粒子。
// ①挂在"遮罩揭开"上而不是"开场走完"上：浮上来的过程中看到的就该是人，不是粒子。
//
// 化开是**同一个值的连续下降**：uRestSolid 从 1 到 0（涟漪层里的人像淡向背景色），
// 同时把这层越化越糊、让上面的粒子层同步淡进来。三个一起走才像"散成粒子"，
// 只做交叉淡入会像两张图在换。
// GSAP 只用来推这一个标量，画面上的效果全在 applySubjectSolid 里。
let subjectSolidShown = false;
let subjectDissolving = false;
const subjectSolid = { v: 0 };

function applySubjectSolid() {
  const el = subjectEl.value;
  const v = subjectSolid.v;
  ripple?.setRestSolid(v);
  if (!el) return;
  el.classList.toggle('is-solid', v > 0.002);
  // 一开始就糊（是"模糊后的完整人像"），化开的过程中继续糊下去。
  // ⚠ v 归零时必须把模糊**收干净**：这一层的 filter 在悬停时也是生效的
  //（悬停画的就是同一张照片），留着 14px 的话以后每次悬停主体都是糊的。
  // 那一下跳变看不见 —— v 到 0.01 时这层画出来的已经是纯背景色了。
  const blur = v > 0.01 ? 4 + 9 * (1 - v) : 0;
  el.style.setProperty('--subject-blur', `${blur.toFixed(2)}px`);
  // 人像让位的同时粒子长出来
  el.style.setProperty('--subject-grain', (1 - v).toFixed(3));
}

/** ① 让人像亮起来。涟漪层没就绪就没法画（那一层才是"人像"本身），等它就绪了再来一次。 */
function showSubjectSolid() {
  // 关了动效就没有"先看一会儿人像"这回事，直接停在粒子态
  if (subjectSolidShown || reducedMotion.value || !ripple) return;
  subjectSolidShown = true;
  subjectSolid.v = 1;
  applySubjectSolid();
  // 涟漪层姗姗来迟（比开场还晚）的话别再等开场了，直接排化开
  if (intro.value >= 1) scheduleSubjectDissolve();
}

/** ② 开场落定之后再化开。 */
function scheduleSubjectDissolve() {
  if (subjectDissolving || !subjectSolidShown) return;
  subjectDissolving = true;
  gsap.to(subjectSolid, {
    v: 0,
    duration: SUBJECT_DISSOLVE_S,
    delay: SUBJECT_SOLID_HOLD,
    ease: 'power2.inOut',
    onUpdate: applySubjectSolid,
    onComplete: applySubjectSolid,
  });
}

function subjectPoint(event) {
  const r = subjectEl.value?.getBoundingClientRect();
  if (!r || !r.width || !r.height) return null;
  return {
    u: (event.clientX - r.left) / r.width,
    v: (event.clientY - r.top) / r.height,
  };
}

function onSubjectEnter(event) {
  if (!finePointer.value) return;
  cursorActive.value = true;
  subjectHovered.value = true;
  ripple?.setHover(true);
  onSubjectMove(event);
}

function onSubjectLeave() {
  if (!finePointer.value) return;
  cursorActive.value = false;
  subjectHovered.value = false;
  ripple?.setHover(false);
  grainMouse = null;
  ensureTicking();
}

// 主体点击是**两拍**的切换：第一拍把内圈四条人格收拢成图（把散出去的自己收回），
// 再点一下人格散回粒子态、同时把外圈那 8 篇博客推上台面收拢成封面。
// 也就是在"个体化"和"作品"两个构图之间来回 —— 两圈永远只有一圈成图，
// 一起亮着的话就没有"接棒"的意思了，12 张同时收拢也会让这一下变得很长。
//
// 当前在哪一拍记在这个变量里，而不是从各组的 progress 反推：人格可能刚被悬停或
// （触屏）滚进视口就已经在收拢态了，按 progress 猜会把那几张误判成"已收拢过"。
// false = 还没点过：首屏那四条是粒子态，第一下要先把它们收回来。
let subjectGathered = false;

async function onSubjectClick(event) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  if (reducedMotion.value) return; // 关了动效就没有粒子态可回，也没有收拢这回事

  if (!groups.value.length) return;
  // 第一拍把散出去的四条收回来（它们本来就是从主体身上散开的），
  // 再点一下放开，之后在两态之间来回。
  const to = subjectGathered ? 0 : 1;
  subjectGathered = !subjectGathered;

  let last = 0;
  for (const g of groups.value) {
    if (g.placed) continue; // 被拖到别处落位的是用户亲手摆的，不参与
    // 四条错开一点时间（各自随机），收拢才像"先后归位"而不是整体闪一下
    const delay = Math.random() * 200;
    last = Math.max(last, delay);
    setTimeout(() => setTarget(g, to), delay);
  }
  // 重组 620ms + 照片淡入 350ms，再多留一点才看得清四条都成图了
  await new Promise((r) => setTimeout(r, last + ASSEMBLE_MS + 480));
}

function onSubjectMove(event) {
  if (!finePointer.value) return;
  const pt = subjectPoint(event);
  if (!pt) return;
  // v 必须翻过来：DOM 的 y 向下，three 的 UV 原点在左下、v 向上
  ripple?.setPointer(pt.u, 1 - pt.v);
  if (subjectParticles?.w) {
    grainMouse = { x: pt.u * subjectParticles.w, y: pt.v * subjectParticles.h };
    ensureTicking();
  }
}

// ── 样式绑定 ────────────────────────────────────────────────────────────
// ⚠ 这里**不再**给 .persona 挂 view-transition-name（原来挂的是
// `blog-cover-<slug>`）。两个原因，都是实测出来的：
//
//  1. 它已经没有下家了。真正接住"磁贴 → 详情封面"的是 GSAP FLIP
//     （见 composables/useCoverHandoff.js 顶部那段：共享元素那套就是因为
//     "两个坐标系各动各的"被换掉的），详情页根本没有同名的元素，
//     所以浏览器只会生成"只有旧图、没有新图"的半截 group。
//  2. 代价却一直在付。view-transition-name 只要挂着，**任何**把首页当作新状态的
//     转场都会把四张磁贴抓进伪元素树 —— 伪元素树在 top layer，z-index 压不过它，
//     于是黑场滑块盖住的整段时间里，四个人格连同标签浮在黑场上面；
//     走 cover 那条路时更糟：`.blog-cover` 那条规则让旧快照 `opacity: 1` 冻在原地，
//     四行人格标签会一直压在博客详情的正文上，直到 0.72s 后整棵伪元素树被撤掉。
//
// 现在磁贴就是磁贴：老老实实待在文档里，由黑场（或 root 快照）统一带着走。

function imageVisible(g) {
  if (reducedMotion.value || !sceneOk.value) return true;
  if (forcedAssembled.value === g.config.id) return true;
  return !!assembledSet.value[g.config.id];
}

// ── 生命周期 ────────────────────────────────────────────────────────────
let mql = null;
let compactMql = null;
let io = null;
let heroIo = null;
let resizeTimer = 0;

function onVisibility() {
  if (!document.hidden) ensureTicking();
}

function syncPointerMode(event) {
  finePointer.value = event.matches;
  if (!event.matches) cursorVisible.value = false;
}

function syncCompact(event) {
  if (isCompact.value === event.matches) return;
  isCompact.value = event.matches;
  requestAnimationFrame(() => requestAnimationFrame(relayout));
}

function relayout() {
  const canvas = sceneCanvas.value;
  const stage = stageEl.value;
  if (!canvas || !stage) return;
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  // 画布盖住整个 hero，粒子和被拖走的格子才不会在舞台外被裁掉
  canvas.style.width = `${heroEl.value.clientWidth}px`;
  canvas.style.height = `${heroEl.value.clientHeight}px`;
  scene3d?.resize(heroEl.value.clientWidth, heroEl.value.clientHeight, dpr);
  focalPx = scene3d?.uniforms.uFocalPx.value || 1000;
  // 卡片的基准宽度 = 世界尺寸 × (焦距 ÷ NEAR)。
  // 注意是 focal/NEAR 而不是 focal —— z=0 处一个世界单位才是 focal/NEAR 像素，
  // 用 focal 会整整大出 NEAR 倍（第一版就大了 1.5 倍，四张卡片差点糊在一起）。
  // 透视带来的缩放由每帧的 transform 负责。
  stage.style.setProperty('--card-w', `${(CARD_HALF.x * 2 * focalPx) / NEAR}px`);
  // 环的水平半宽（最外侧那张卡片的中心到舞台中心）+ 卡片的半宽，必须塞得进 hero 的宽度。
  // 预算按 hero 算而不是舞台：画布盖的是 hero，格子本来就可以被拖到舞台之外。
  // 留 RING_EDGE 的边距，免得卡片边缘正好贴着屏幕边。
  const perPx = focalPx / NEAR;
  const halfCard = CARD_HALF.x * perPx;
  const halfRing = RING_R * perPx;
  const halfAvail = (heroEl.value?.clientWidth || w) / 2 - RING_EDGE;
  // 0.4 的下限是兜底：真到那一步说明屏幕比设计的窄太多，宁可压扁也不要卡片糊在一起。
  ringSquashX = halfRing > 0 ? Math.min(1, Math.max(0.4, (halfAvail - halfCard) / halfRing)) : 1;
  layoutGrain();
  if (scene3d) updateScene(performance.now());
}

function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(relayout, 160);
}

onMounted(async () => {
  mql = window.matchMedia('(hover: hover) and (pointer: fine)');
  syncPointerMode(mql);
  mql.addEventListener('change', syncPointerMode);
  reducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  compactMql = window.matchMedia('(max-width: 768px)');
  isCompact.value = compactMql.matches;
  compactMql.addEventListener('change', syncCompact);

  // 首屏只等这 5 张（4 个人格 + 主体）。背景那 8 张封面走 revealBlogWall，
  // 开场动画之后才去取。
  const [personaImgs, subjectImg] = await Promise.all([
    Promise.all(PERSONAS.map((p) => loadImage(p.src))),
    loadImage(SUBJECT.src),
  ]);

  groups.value = PERSONAS.map((config) => ({
    config,
    el: null,
    progress: 0,
    target: 0,
    last: 0,
    placed: null,
  }));

  // 先建数据、等 Vue 把 v-for 的格子挂进 DOM，再取元素回填。
  // 反过来的话 querySelectorAll 拿到的是空数组。
  // 按 data-tile-id 认领而不是按下标 —— 下标对不上 DOM 顺序是静默错位。
  await nextTick();
  groupEls.length = 0;
  const elById = new Map();
  heroEl.value?.querySelectorAll('.persona').forEach((el) => elById.set(el.dataset.tileId, el));
  groups.value.forEach((g) => {
    g.el = elById.get(g.config.id) || null;
    if (g.el) groupEls.push(g.el);
  });

  if (subjectImg) {
    const items = sampleParticles(subjectImg, SUBJECT_SAMPLE_W);
    subjectParticles = { items, buckets: buildBuckets(items), ctx: null, dpr: 1, w: 0, h: 0 };
  }

  // 三维场景。拿不到 WebGL 就退回 DOM 那张图（sceneOk = false 时 imageVisible 恒为真）
  scene3d = await createPersonaScene(sceneCanvas.value);
  sceneOk.value = !!scene3d;
  if (scene3d) {
    scene3d.setParticles(buildSceneParticles(personaImgs));
    // 开局就按当前主题设一次：watch 只在**变化**时触发，
    // 首屏本身就是浅色主题的话，四条人格会一直不反色 —— 就是颜色错乱的成因。
    scene3d.uniforms.uInvert.value = isDark.value ? 0 : 1;
    relayout();
    scene3d.setFade(1);
    applyIntro();
  } else {
    heroEl.value?.classList.add('no-scene');
  }

  layoutGrain();

  if (reducedMotion.value) {
    for (const g of groups.value) {
      g.progress = 1;
      g.target = 1;
      assembledSet.value[g.config.id] = true;
    }
    subjectParticles = null;
  }

  if (!reducedMotion.value) ensureTicking();

  setupRipple();

  // 触屏没有 hover：滚到哪一条就把它重组好。只进不出，免得上下动一下就反复收散。
  if (!finePointer.value && !reducedMotion.value) {
    io = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          if (!record.isIntersecting) continue;
          const g = groups.value.find((x) => x.config.id === record.target.dataset.tileId);
          if (g) setTarget(g, 1);
        }
      },
      { rootMargin: '-20% 0px -26% 0px' }
    );
    heroEl.value?.querySelectorAll('.persona').forEach((el) => io.observe(el));
  }

  if ('IntersectionObserver' in window) {
    heroIo = new IntersectionObserver(
      (records) => {
        for (const r of records) heroVisible.value = r.isIntersecting;
        if (heroVisible.value) ensureTicking();
      },
      { threshold: 0 }
    );
    if (heroEl.value) heroIo.observe(heroEl.value);
  }
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onResize);

  if (brandEntered.value) startIntro();
});

// 品牌遮罩揭开之后才开始展开（遮罩盖着的时候放动画等于白放）。
// 已经展开过（比如从博客返回首页）就直接是终态，startIntro 内部有只跑一次的守卫。
watch(brandEntered, (v) => {
  if (!v) return;
  startIntro();
  // 人像跟着 Hero 一起从下方浮上来，而且**上来的时候就已经是模糊的** ——
  // 所以亮人像挂在"遮罩揭开"这一刻，不是挂在"开场走完"。
  showSubjectSolid();
});

// 主题一换：浅色下粒子要反过来（uInvert），水波纹那层也要改淡出方向。
// 颜色不能硬切 —— 先把粒子层淡掉、换完色再淡回来，背景色本身由 CSS 过渡。
watch(isDark, async (dark) => {
  if (!reducedMotion.value) {
    themeShifting.value = true;
    await new Promise((r) => setTimeout(r, 230));
  }
  if (scene3d) scene3d.uniforms.uInvert.value = dark ? 0 : 1;
  syncRippleBackground();
  layoutGrain();
  if (grainCanvas.value) drawGrain(performance.now(), grainMouse);
  if (scene3d) updateScene(performance.now());
  // 下一帧再淡回来，保证换完色的那一帧已经画出来了
  requestAnimationFrame(() => { themeShifting.value = false; });
});

onActivated(() => {
  forcedAssembled.value = null;
});

onBeforeUnmount(() => {
  if (rafCursor) cancelAnimationFrame(rafCursor);
  if (masterRaf) cancelAnimationFrame(masterRaf);
  masterRaf = 0;
  clearTimeout(resizeTimer);
  clearTimeout(riseClipTimer);
  toggleRiseClip(false); // 别把 clip 留在这一页上（keep-alive 复用时它还在）
  rippleGone = true;
  ripple?.dispose();
  ripple = null;
  scene3d?.dispose();
  scene3d = null;
  io?.disconnect();
  heroIo?.disconnect();
  document.removeEventListener('visibilitychange', onVisibility);
  mql?.removeEventListener('change', syncPointerMode);
  compactMql?.removeEventListener('change', syncCompact);
  window.removeEventListener('resize', onResize);
});
</script>

<template>
  <section
    ref="heroEl"
    class="hero-concept"
    :class="{
      'is-fine': finePointer,
      'is-dark': isDark,
      'is-theme-shift': themeShifting,
      'is-risen': brandEntered,
    }"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
  >
    <!-- 背景拼贴的开关。和主题按钮、播放器同一条竖列（fixed 右下角往上数第三格），
         所以它跟着别的悬浮控件一起被 X 键收起来（见 styles/main.css 的名单）。 -->
    <Teleport to="body">
    <button
      class="wall-toggle"
      :class="{ 'is-off': wallHidden, 'is-on': brandEntered }"
      :aria-pressed="String(!wallHidden)"
      aria-label="切换背景封面"
      tabindex="-1"
      @click="wallHidden = !wallHidden"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7.5" height="7.5" rx="1" />
        <rect x="13.5" y="3" width="7.5" height="7.5" rx="1" />
        <rect x="3" y="13.5" width="7.5" height="7.5" rx="1" />
        <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1" />
      </svg>
    </button>
    </Teleport>

    <!-- 背景拼贴：最新 8 篇其他博客的封面。去色、模糊、极淡，只是底纹 ——
         不承载悬停也不承载点击（pointer-events: none），一切都浮在它上面。
         这里**不写 src**：首屏一个请求都不该为它花，等开场走完由 revealBlogWall
         一张一张挂上并淡进来。 -->
    <div ref="wallEl" class="hero-wall" :class="{ 'is-off': wallHidden }" aria-hidden="true">
      <img
        v-for="b in BLOG_WALL"
        :key="b.slug"
        class="hero-wall__img"
        :style="{ left: b.x + '%', top: b.y + '%', width: b.w + '%', '--r': b.r + 'deg' }"
        alt=""
        decoding="async"
        draggable="false"
      >
    </div>

    <!-- Hero 的背景字：品牌遮罩揭开之后淡入，接住那一个 LIVEINPASSION。
         下面那行 INDIVIDUATION 等首屏动画走完再逐字打出来。 -->
    <div class="hero-wordmark" aria-hidden="true">
      <div class="hero-wordmark__line">
        <span class="hero-wordmark__ink" :class="{ 'is-on': wordmarkOn }">LIVEINPASSION</span>
        <span class="hero-caption" :class="{ 'is-on': captionOn }">
          <span
            v-for="(ch, i) in CAPTION_LETTERS"
            :key="i"
            class="hero-caption__ch"
            :style="{ '--i': i }"
          >{{ ch }}</span>
        </span>
      </div>
    </div>

    <div class="hero-concept__noise" aria-hidden="true" />

    <!-- 四条流的粒子在 Three.js 三维场景里（透视、前后远近）。
         画布挂在 hero 上而不是舞台上 —— 人格可以被拖到舞台之外，
         只有整个 hero 那么大才不会把粒子裁掉。 -->
    <canvas ref="sceneCanvas" class="hero-dust" aria-hidden="true" />

    <div ref="stageEl" class="hero-concept__stage">
      <!-- 主体：个体化。水波纹 + 粒子层；点它收回四条人格，再点散人格亮外圈博客，不跳转 -->
      <div
        ref="subjectEl"
        class="hero-subject"
        @click="onSubjectClick"
        @pointerenter="onSubjectEnter"
        @pointerleave="onSubjectLeave"
        @pointermove="onSubjectMove"
      >
        <!-- img 是底图，也是 WebGL 不可用时的全部内容 -->
        <img class="hero-subject__photo" :src="SUBJECT.src" :alt="SUBJECT.alt" decoding="async" draggable="false">
        <canvas ref="rippleCanvas" class="hero-subject__ripple" aria-hidden="true" />
        <canvas ref="grainCanvas" class="hero-subject__grain" aria-hidden="true" />
      </div>

      <!-- 四个人格：隐形的命中区 + 标签 + 成图用的照片（也是共享元素过渡的取景来源）。
           位置和缩放每帧由三维投影算出来写到 transform 上；视觉本体是场景里的粒子。 -->
      <div ref="orbitEl" class="orbit">
        <div v-for="g in groups" :key="g.config.id" class="orbit__slot">
          <router-link
            :to="{ name: 'blog-detail', params: { slug: g.config.slug } }"
            custom
            v-slot="{ href }"
          >
            <a
              class="persona"
              :href="href"
              :data-tile-id="g.config.id"
              :aria-label="g.config.label"
              @click="onTileClick($event, g.config)"
              @pointerdown="onTileDown($event, g)"
              @pointerenter="onTileEnter(g)"
              @pointerleave="onTileLeave(g)"
            >
              <img
                class="persona__photo"
                :style="{ opacity: imageVisible(g) ? 1 : 0 }"
                :src="g.config.src"
                :alt="g.config.label"
                decoding="async"
                draggable="false"
              >
              <span class="persona__label">{{ g.config.label }}</span>
            </a>
          </router-link>
        </div>
      </div>
    </div>

    <!-- 方块光标。**必须 Teleport 到 body**，不能留在 Hero 里 ——
         .hero-concept 上有 transform（首屏 translateY(100%)，落定后也是
         translateY(0)），被 transform 的祖先会把内部 position:fixed 的包含块
         改成它自己。于是这个"跟指针走"的方块实际跟的是**Hero**：页面一滚，
         Hero 上移，方块就跟着上移，而指针钉在视口里不动 —— 两者越差越远
         （实测滚到页脚差 116px），而系统光标又被 cursor:none 压掉了，
         用户看到的就是"指针和实际位置对不上"。
         挂到 body 上，包含块回到初始包含块，translate3d(clientX, clientY)
         才是真正的视口坐标。（和 .wall-toggle 同一条理由，见下。）
         底色变量不再靠 .hero-concept 继承，改由这里的 is-dark 自带。 -->
    <Teleport to="body">
      <div
        ref="cursorEl"
        class="hero-cursor"
        :class="{ 'is-visible': cursorVisible, 'is-active': cursorActive, 'is-dark': isDark }"
        aria-hidden="true"
      >
        <span class="hero-cursor__dot" />
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
/* 主题适配：浅色主题白底黑尘，深色主题黑底白尘。
   默认写浅色那套，深色用 .is-dark 覆盖。
   粒子的黑白在 drawDust/drawGrain 里按 isDark 反过来，这里只管 DOM 那部分。

   为什么用 .is-dark 而不是 :global(html.dark)：
   Vue 的 :global() 会把**整条**选择器变成全局，`:global(html.dark) .hero-concept`
   编译出来只剩 `html.dark{...}`，`.hero-concept` 被丢掉。那样变量是挂在 html 上
   靠继承往下传的，而 .hero-concept 自己也声明了同名变量 —— 元素自身的声明胜过
   继承值，深色那套永远不生效。绑一个由 isDark 驱动的类就没有这个问题。 */
.hero-concept {
  --hero-bg: #fafafa;
  /* 次级字（人格标签、正下方那行小字）在亮色下要更实一点：
     50% 的黑压在浅底 + 照片拼贴上，10–11px 的小字几乎读不出来 */
  --hero-fg: rgba(0, 0, 0, 0.68);
  --hero-fg-strong: rgba(0, 0, 0, 0.95);
  /* 背景主字（LIVEINPASSION）的浓度：它是底纹，但 7.5% 的黑在 #fafafa 上
     只剩 #ececec，等于没有。亮色给到 0.16 才立得住，暗色保持原来的 7.5%。 */
  --wordmark-opacity: 0.16;
  --hero-noise-opacity: 0.05;
  --hero-cursor: #000000; /* 亮色模式：纯黑方块 */
  /* 背景拼贴的浓度。照片是去色的，压在白底上比压在黑底上更容易"化掉"，
     所以亮色这一档从 0.17 提到 0.22（暗色仍是 0.26）。 */
  --wall-opacity: 0.22;
  /* 羽化遮罩：只把四条边揉软，不留一圈矩形硬边。
     用两个线性渐变取交集，而不是径向渐变 —— 径向从 62% 就开始衰减，
     整张照片会被削成一大团椭圆（浅色底上尤其像一坨黑斑），
     而这里要的是"照片边缘是糊的"，中间必须原样保留。 */
  /* 只有人格照片这一处用羽化遮罩了（主体的照片层已经取消，边缘交给粒子的 EDGE 淡出） */
  --hero-feather-soft-x: linear-gradient(to right, transparent 0, #000 6%, #000 94%, transparent 100%);
  --hero-feather-soft-y: linear-gradient(to bottom, transparent 0, #000 6%, #000 94%, transparent 100%);

  position: relative;
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: 104px 4vw 56px;
  background: var(--hero-bg);
  /* 一开始整块停在视口下方，品牌遮罩揭开时升上来（见 BrandOverlay.vue 的时序）。
     位移不改布局，所以页脚的位置不受影响，只是被这块挡在后面。 */
  --rise: 100%;
  transform: translateY(var(--rise));
  /* 升起来的时候，它上方会露出页面背景（--bg 是 #1A1A1A），而 Hero 自己是纯黑，
     于是有一条可见的接缝。向上补一块同色的外延盖住它。
     注意 box-shadow 不受自身 overflow 裁剪，所以这招有效。 */
  box-shadow: 0 -100vh 0 0 var(--hero-bg);
  /* 背景色跟着主题走的时候要过渡，不能硬切 */
  transition: background-color 0.4s ease, transform 1.25s cubic-bezier(0.22, 1, 0.36, 1);
  color: var(--hero-fg-strong);
  overflow: hidden;
  isolation: isolate;
}

.hero-concept.is-risen {
  --rise: 0%;
}

.hero-concept.is-dark {
  --hero-bg: #000000;
  --hero-fg: rgba(255, 255, 255, 0.52);
  --hero-fg-strong: rgba(255, 255, 255, 0.95);
  --wordmark-opacity: 0.075;
  --hero-noise-opacity: 0.042;
  --hero-cursor: #ffffff; /* 暗色模式：纯白方块 */
  --wall-opacity: 0.26;
}

/* 系统光标要彻底压掉。只写 .hero-concept 是不够的 ——
   UA 样式表给 <a> 的 cursor:pointer 比父级的 cursor:none 更具体，
   压在图上会冒出手型光标。所以连后代一起写。 */
.hero-concept.is-fine,
.hero-concept.is-fine a,
.hero-concept.is-fine a * {
  cursor: none;
}

.hero-concept__noise {
  position: absolute;
  inset: 0;
  z-index: 90;
  pointer-events: none;
  opacity: var(--hero-noise-opacity);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 160px 160px;
}

/* 舞台锁 16:10，宽度由可用高度反推 —— 百分比坐标才会等比缩放 */
.hero-concept__stage {
  position: relative;
  width: min(100%, calc((100vh - 260px) * 1.6));
  aspect-ratio: 16 / 10;
}

/* ── 背景拼贴的开关 ────────────────────────────────────────────────────── */
/* 和 .theme-toggle / .music-toggle-btn 同一条竖列：主题在 bottom 32、播放器在
   104，这个排第三格（176）。是 fixed 的，所以只在 Hero 挂着的时候存在 ——
   离开首页它跟着组件一起消失，不用另外判断路由。 */
.wall-toggle {
  /* 悬浮在网页上，和主题按钮 / 播放器同一条竖列的第三格（右 32 / 下 168）。
     ⚠ 它必须**挂在 body 上**（模板里 Teleport 出去了），不能留在 Hero 里：
     .hero-concept 上有 transform（哪怕值是 translateY(0)），而被 transform 的
     祖先会把内部 position:fixed 的包含块改成它自己 —— 那样这个按钮就变成
     "跟着 Hero 定位"，永远浮不到网页上，滚起来也跟着 Hero 走。 */
  position: fixed;
  bottom: 168px;
  right: 32px;
  /* 和头部那批一起出来：它在 body 上，不在 .shell 的错峰名单里，所以自己排时间。
     不排的话首屏遮罩一揭开它就杵在那儿了 —— 那会儿 Hero 还在往上浮。 */
  opacity: 0;
  /* translate 那一条是"边缘滑出"用的（见 styles/main.css 的 .is-edge-hover）：
     它被 Teleport 到 body 上，不在 .shell 的错峰名单里，过渡只能自己写。
     默认 0s 延迟 —— 蹭到屏幕右边要立刻出来，不能跟着淡入一起等。 */
  transition: opacity 0.6s ease 0.35s, translate 0.42s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s ease, transform 0.3s ease, box-shadow 0.3s ease;
  width: 56px;
  height: 56px;
  border-radius: 0; /* 直角：站内按钮统一去圆角 */
  border: 0;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 999;
  background: var(--text-primary);
  color: var(--bg);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  outline: none;
  -webkit-tap-highlight-color: transparent;
}

.wall-toggle.is-on {
  opacity: 1;
}

.wall-toggle:hover {
  transform: scale(1.1);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
}

.wall-toggle svg {
  width: 22px;
  height: 22px;
}

/* 关掉的时候按钮自己变"空心"一点，一眼能看出现在的状态。
   !important 是为了压过上面 .is-on 的 1（两个类同时存在） */
.wall-toggle.is-off {
  opacity: 0.45 !important;
}

/* 断点跟着 main.css 里那两个（800 / 480）：悬浮按钮在窄屏上会缩到 48 / 44 并往下挪，
   这一格不跟着走的话会飘到别的按钮身上。 */
@media (max-width: 800px) {
  .wall-toggle {
    bottom: 140px;
    right: 16px;
    width: 48px;
    height: 48px;
  }

  .wall-toggle svg {
    width: 20px;
    height: 20px;
  }
}

@media (max-width: 480px) {
  .wall-toggle {
    bottom: 128px;
    right: 12px;
    width: 44px;
    height: 44px;
  }

  .wall-toggle svg {
    width: 18px;
    height: 18px;
  }
}

/* ── 背景字 ────────────────────────────────────────────────────────────── */
/* 首屏遮罩揭开时，中间那个 LIVEINPASSION 由这里接着显示 —— 视觉上是同一个字，
   只是变成了 Hero 的一层底纹。 */
.hero-wordmark {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  font-family: 'Oswald', sans-serif;
  font-weight: 700;
  /* 字号字距必须和首屏那行字（BrandOverlay 的 .brand__solid）**完全一致** ——
     粒子就是在这两者之间原地散开再聚拢，对不上的话交接会跳。 */
  font-size: min(9.5vw, 10rem);
  letter-spacing: 0.1em;
  white-space: nowrap;
  color: var(--hero-fg-strong);
  /* ⚠ 这一层**不能**有 opacity / transform / z-index —— 三个都会造出堆叠上下文，
     里面那行小字就升不到主体之上了。淡入淡出因此挪到了里层的 __text 上。 */
}

/* 一行字的盒子：小字以它当定位基准，所以它得是定位元素。
   ⚠ 浓度只能给里层的 __ink。给这一层的话会**整个乘到小字上**
   （父级 opacity 是不透明度，不是颜色）——小字就只剩几个百分点，等于没打。 */
.hero-wordmark__line {
  position: relative;
  /* 压过 .hero-subject（5）。主体那层静止时是一块**不透明**的背景色椭圆
     （useRippleEffect 的 uRestSolid = 0 时它整个铺底色），压在它下面的话
     大字中间会缺一整块（"LIVEIN□ASSION"），小字更是整行看不见。
     字只有 7.5% 浓度，浮到粒子之上几乎看不出来，但整行是连续的。 */
  z-index: 6;
}

.hero-wordmark__ink {
  opacity: 0;
  transition: opacity 0.5s ease;
}

.hero-wordmark__ink.is-on {
  opacity: var(--wordmark-opacity, 0.075);
}

/* ── 背景字下面那行 ────────────────────────────────────────────────────── */
/* LIVEINPASSION 正下方，INDIVIDUATION 逐字打出来（每字一个 span，靠 --i 错开）。
   它和上面那行同处一个层（__line 的 z-index），一起压在主体之上 —— 见那边的注释。 */
.hero-caption {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  padding-top: 0.85rem;
  font-family: 'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
  font-weight: 400;
  font-size: 11px;
  letter-spacing: 0.42em;
  text-transform: uppercase;
  white-space: nowrap;
  color: var(--hero-fg);
}

/* 单个字：先摆在下方、透明，进到位才实。最后一个字后面那段字距不算进宽度，
   否则整行会往左偏半个字距（字距本来是按 0.42em 给的，看得见）。 */
.hero-caption__ch {
  opacity: 0;
  transform: translateY(0.4em);
}

.hero-caption__ch:last-child {
  margin-right: -0.42em;
}

.hero-caption.is-on .hero-caption__ch {
  animation: hero-caption-in 0.42s cubic-bezier(0.22, 1, 0.36, 1) both;
  /* 0.4s 的起手留白：首屏动画刚落定，马上打会显得急 */
  animation-delay: calc(0.4s + var(--i, 0) * 70ms);
}

@keyframes hero-caption-in {
  from {
    opacity: 0;
    transform: translateY(0.4em);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* 关了动效就别逐字了：一次到位 */
@media (prefers-reduced-motion: reduce) {
  .hero-caption.is-on .hero-caption__ch {
    animation: none;
    opacity: 1;
    transform: none;
  }
}

/* ── 共享粒子画布 ──────────────────────────────────────────────────────── */
.hero-dust {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
  /* 主题切换时先淡掉、换完色再淡回来（见 watch(isDark)） */
  transition: opacity 0.22s ease;
}

.hero-concept.is-theme-shift .hero-dust,
.hero-concept.is-theme-shift .hero-subject__grain {
  opacity: 0;
}

/* ── 主体 ──────────────────────────────────────────────────────────────── */
/* 尺寸是配合公转环算的：主体占 26% 宽（约 55.5% 高），上下各留出约 22% 高，
   环上的图（9% 宽 ≈ 19% 高）转到正上/正下时才不会压到主体身上。
   三个数是一组（ORBIT.rx / ORBIT.ry / 这里的 width），单独改一个就会打架。
   z-index 高于 .orbit 和 .hero-dust —— 万一蹭到，让它们从主体后面过去。 */
.hero-subject {
  position: absolute;
  left: 37%;
  top: 22.2%;
  width: 26%;
  aspect-ratio: 3 / 4;
  display: block;
  z-index: 5;
  /* 原来这里是 <a href>，指针样式由链接给。现在只保留点击收拢的手感，不跳转。 */
  cursor: pointer;
  /* 椭圆取景：这张是照片，矩形边和背景接不上，显得生硬。
     用一个照着人脸的椭圆把它框住 —— 脸大致在画面 x 20~80% / y 24~72%，
     加上肩部到 y≈95%，所以椭圆取中心、半径各 46%（x 6~94%、y 6~94%）刚好容下。
     衰减带留得很宽（不透明核心只到 50% 半径），边界才是渐隐的而不是一圈边缘。 */
  mask-image: radial-gradient(ellipse 46% 46% at 50% 50%, #000 50%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 46% 46% at 50% 50%, #000 50%, transparent 100%);
  /* 这里**不能放 filter**。
     涟漪画布静止时整片填的是背景色（uBg）；容器上只要有 contrast/brightness，
     那个填充就会被推离背景色 —— 浅色下 #fafafa 被 brightness(1.06) 顶成纯白 255，
     背景是 250，差 2%。平时看不出来，但椭圆遮罩会把这块填充裁成一个椭圆，
     在一大片平色上就是一块明显的椭圆（切换主题时粒子淡出，它就先露出来了）。
     人像图本来就是黑白的，grayscale 是空转；contrast/brightness 那 8% 不值得换这个。 */
  /* 闲置时在风里飘。关键帧刻意做得不规则 —— 单一正弦摆起来是机械的，
     几个不均匀的节点加长周期才像被风推着。 */
  animation: subject-wind 17s ease-in-out infinite;
  /* 开场"先完整人像、再粒子化"用的两个量，由 JS 逐帧写（见 applySubjectSolid）。
     初值就是粒子态的终值：揭示没跑成也不会留下半拆开的样子。 */
  --subject-blur: 0px;
  --subject-grain: 1;
}

@keyframes subject-wind {
  0% {
    transform: translate3d(0, 0, 0) rotate(0deg);
  }

  13% {
    transform: translate3d(-3px, -5px, 0) rotate(-0.7deg);
  }

  27% {
    transform: translate3d(2px, -8px, 0) rotate(-0.3deg);
  }

  41% {
    transform: translate3d(5px, -2px, 0) rotate(0.8deg);
  }

  54% {
    transform: translate3d(3px, 4px, 0) rotate(0.5deg);
  }

  68% {
    transform: translate3d(-2px, 6px, 0) rotate(-0.4deg);
  }

  82% {
    transform: translate3d(-5px, 2px, 0) rotate(-0.8deg);
  }

  91% {
    transform: translate3d(-2px, -3px, 0) rotate(-0.3deg);
  }

  100% {
    transform: translate3d(0, 0, 0) rotate(0deg);
  }
}

.hero-subject__photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  /* 触屏上没有涟漪层（setupRipple 只在精确指针下建），人像就是这张照片本身，
     所以模糊也得给它一份，否则那种设备上"先人像后粒子"会跳过模糊那一步。
     桌面上这张被涟漪层完全盖住，这份 filter 看不见，只多一点点光栅化开销。 */
  filter: blur(var(--subject-blur));
}

/* 涟漪画布正好盖在底图上。贴图就绪前先藏着，避免闪一下黑 */
.hero-subject__ripple {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  opacity: 0;
  transition: opacity 0.35s ease;
  pointer-events: none;
  /* "完整人像"那一阶段靠它糊：这层静止时本来就是一张不透明的照片（uRestSolid），
     糊它等于糊人像本身，而那块填充色和背景一样、糊了也看不出来。 */
  filter: blur(var(--subject-blur));
}

.hero-subject__ripple.is-ready {
  opacity: 1;
}

/* 粒子层压在照片上面。人像那一阶段它要让位（否则粒子直接糊在人像上，
   "完整人像"就看不完整了）—— 不透明度由 --subject-grain 控制。 */
.hero-subject__grain {
  opacity: var(--subject-grain);
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
}

/* ── 公转环 ────────────────────────────────────────────────────────────── */
/* 定位全部交给 JS：每帧按三维投影把 transform 写到 .persona 上（合成层，不触发布局）。
   这里不再有 CSS 旋转动画 —— 公转是 JS 累加角度、经投影体现出来的。 */
.orbit {
  position: absolute;
  inset: 0;
  z-index: 1;
}

/* 槽位退化成舞台中心的一个零点，具体位置由 .persona 自己的 transform 决定 */
.orbit__slot {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
}

.orbit__slot.is-dragging {
  z-index: 8; /* 拖出来的那一格压在其它格和粒子上 */
}

/* ── 人格格 ────────────────────────────────────────────────────────────── */
/* 这里没有 canvas —— 粒子在共享画布上。这一格只负责：命中区、标签、
   以及成图后淡入的那张照片（它同时是共享元素过渡的快照来源）。 */
.persona {
  position: absolute;
  left: 0;
  top: 0;
  /* 基准宽度由 JS 按焦距算好写在 --card-w 上；透视带来的缩放走每帧的 transform */
  width: var(--card-w, 160px);
  aspect-ratio: 3 / 4;
  display: block;
  text-decoration: none;
  color: inherit;
  /* 每帧由 JS 重写（含公转和远近缩放）；给个初值免得首帧闪在原点 */
  transform: translate(-50%, -50%);
  will-change: transform;
}

.persona__photo {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  /* 不加 filter：人格图本来就是黑白的，grayscale 是空转；
     而带 filter 的元素在旋转容器里每帧都要重新光栅化。 */
  transition: opacity 0.35s ease;
  pointer-events: none;
  /* 比主体轻一档：人格图只在悬停时成图，边缘太硬会在浅色底上突兀地切一刀 */
  mask-image: var(--hero-feather-soft-x), var(--hero-feather-soft-y);
  mask-composite: intersect;
  -webkit-mask-image: var(--hero-feather-soft-x), var(--hero-feather-soft-y);
  -webkit-mask-composite: source-in;
}

.persona__label {
  position: absolute;
  top: calc(100% + 12px);
  left: 0;
  font-family: 'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  white-space: nowrap;
  color: var(--hero-fg);
  transition: color 0.35s ease;
}

.persona:hover .persona__label {
  color: var(--hero-fg-strong);
}

/* ── 背景拼贴（其他博客的封面）─────────────────────────────────────────
   一层散在背景上的封面墙：清晰、去色、压到两三成。它压在星尘画布下面
   （z-index 同为 0，靠 DOM 顺序 —— 这一块排在 canvas 前面）。
   四边的渐隐遮罩是必须的：8 张图铺到边上的话，hero 四条边会露出硬边。
   这是一层纯底纹：不吃鼠标事件（主体和人格都在它上面，但它自己不该拦任何东西）。

   浓度挂在这一层：每一张淡到 1 就行，8 张一起乘上这个数才是一眼看到的浓度，
   主题切换时也只改这一个变量、8 张一起过渡。 */
/* 关掉之后整层淡出并让开事件。不做 display:none —— 那会把 8 张图重新变成
   "没加载过"的状态，再打开时又要重来一遍；这里只是看不见。 */
.hero-wall.is-off {
  opacity: 0 !important;
  pointer-events: none;
}

.hero-wall {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  opacity: var(--wall-opacity);
  transition: opacity 0.4s ease;
  mask-image: radial-gradient(ellipse 72% 72% at 50% 50%, #000 40%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 72% 72% at 50% 50%, #000 40%, transparent 100%);
}

.hero-wall__img {
  position: absolute;
  aspect-ratio: 3 / 4;
  height: auto;
  object-fit: cover;
  display: block;
  /* GSAP 从 0 淡到 1（见 revealBlogWall）；浓度由 .hero-wall 那一层压 */
  opacity: 0;
  visibility: hidden;
  transform: rotate(var(--r, 0deg));
  /* 清晰，但去色 —— 整站是黑白语言，底纹带上颜色就会跳出来 */
  filter: grayscale(1);

}



/* ── 方块光标 ──────────────────────────────────────────────────────────── */
.hero-cursor {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 120;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.25s ease;
  will-change: transform;
  /* 底色变量必须**自带**，不能像别的规则那样从 .hero-concept 继承 ——
     这个元素被 Teleport 到 body 了，已经不是 Hero 的后代。 */
  --hero-cursor: #000000; /* 亮色模式：纯黑方块 */
}

.hero-cursor.is-dark {
  --hero-cursor: #ffffff; /* 暗色模式：纯白方块 */
}

.hero-cursor.is-visible {
  opacity: 1;
}

.hero-cursor__dot {
  display: block;
  width: 10px;
  height: 10px;
  /* 颜色跟着主题走：亮色模式纯黑、暗色模式纯白。
     早先用的是 difference 混合想自动取反，但结果受底色影响（浅灰底上会变成
     近黑的灰、而不是黑），明暗两个主题下都不干脆，还不如直接给死。 */
  background: var(--hero-cursor);
  transform: translate(-50%, -50%) scale(1);
  transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}

.hero-cursor.is-active .hero-cursor__dot {
  transform: translate(-50%, -50%) scale(1.5);
}

/* ── 移动端 ────────────────────────────────────────────────────────────── */
@media (max-width: 768px) {
  .hero-concept {
    /* 竖向居中而不是顶头排：手机上舞台本来就矮，贴着 header 往下排的话
       整块构图会挤在上半屏，下半屏全是空的。 */
    display: grid;
    align-content: center;
    justify-items: center;
    /* 必须撑满视口。原来写的是 min-height: auto —— hero 于是按内容高（约 614）
       收口，底下露出一整条页面背景（--bg 和 --hero-bg 不是同一个色），
       在深色主题下就是屏幕下方那道可见的横向色差带。
       svh 是给移动端地址栏写的：vh 在地址栏收起时会多算一截，导致页面能滚。 */
    min-height: 100vh;
    min-height: 100svh;
    /* 上：header 88px + 呼吸位。下：底部那条"空格键"Dock 占掉 68px，
       留 88 免得构图钻到它下面去。 */
    padding: 104px 20px 88px;
    overflow: visible;
  }

  /* 小屏改成竖构图：舞台保持固定比例，整圈等比缩到一屏里。
     之前是"主体通栏 + 2×2 网格"，但那套和三维投影是两套坐标系 ——
     DOM 位置由投影算，网格由 CSS 算，两者对不上。统一走投影这一套。
     4/5 的竖比例让焦距不至于太小（卡片宽度直接由焦距决定）。 */
  .hero-concept__stage {
    width: 100%;
    aspect-ratio: 4 / 5;
  }

  /* 主体不再单独覆盖：桌面那套"居中 26%"在竖构图的舞台上同样成立。
     公转在小屏上停掉（JS 里判断 isCompact）：目标本来就小，还在动会很难点。 */

  /* 背景字小了一档，下面那行也跟着收一点，不然会比字还抢眼 */
  .hero-caption {
    padding-top: 0.7rem;
    font-size: 10px;
  }
}

@media (hover: none) {
  .hero-cursor {
    display: none;
  }
}
</style>
