<script setup>
// 首页概念入口。
//
// 画面：Individuation 作为主体居中；四个人格化作粒子流，从主体身上散发出去、
// 在三维空间里环绕它。悬停某一条 → 粒子收拢、聚成那张照片；点击 → 共享元素过渡进博客。
//
// 其他博客的封面完全不进这套粒子系统 —— 它们是 Hero **背后的一层 3D 球体底纹**
//（参照 oumahi.art 首页）：封面像一张张相片切在球面上、朝外，球外套一层经纬线框；
// 整颗球缓慢自转，空白处可以按住拖动并带惯性。它只是底纹：去色、压暗、
// 不承载点击，开场走完之后才一张张淡进来（见 revealCoverSphere）。
// 拖拽松手 / 滚轮停下后，整颗球会在「球体」和「十二面体」之间换形一次 ——
// 每张卡飞到十二面体的顶点上，线框交叉淡换成 30 条棱（见 morphSphereShape）。
//
// 指针划过页面时还会拖一条单色、朝尾部渐隐的折线（参照同一站的鼠标拖迹，
// 见 composables/useCursorTrail.js）。它和方块光标共用墨色，只在首页存在。
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
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import gsap from 'gsap';
import { blogBySlug, blogPosts } from '../data/blogPosts.js';
import { navigateWithViewTransition } from '../composables/useViewTransition.js';
import { rememberCoverHandoff } from '../composables/useCoverHandoff.js';
import { createRippleEffect } from '../composables/useRippleEffect.js';
import { createCursorTrail } from '../composables/useCursorTrail.js';
import { useTheme } from '../composables/useTheme.js';
import { useBrandOverlay } from '../composables/useBrandOverlay.js';
import { useWallPref } from '../composables/useWallPref.js';
// 方块光标已经提到全局（components/BlockCursor.vue，挂在 App.vue）。
// 这里只留"指针压在人像 / 人格卡上时让它放大"这一件事 —— 那两处没有可认的
// 语义标签（主体就是一张铺满的 <div>），自动判定认不出来，得自己举手。
import { clearBlockCursorHot, setBlockCursorHot } from '../composables/useBlockCursor.js';
import {
  CARD_HALF,
  NEAR,
  RING_R,
  TILT,
  createPersonaScene,
} from '../composables/usePersonaScene.js';

const { isDark } = useTheme();

// 背景球开不开：状态提到 composables/useWallPref.js 里了。
// 手机上这个开关收进了汉堡菜单（AppHeader），那边要读同一个 ref。
const { wallHidden } = useWallPref();

// 关掉再打开时要把球的自转循环重新点起来（没 WebGL 时循环会停在隐藏那一刻）。
watch(wallHidden, (hidden) => {
  if (hidden) endSphereDrag();
  else ensureTicking(true);
});
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
    src: '/me/personas/romanticist.jpg',
  },
  {
    id: 'idealist',
    label: 'Idealist',
    slug: 'idealist-fragment-ii',
    src: '/me/personas/idealist.jpg',
  },
  {
    id: 'advocate',
    label: 'Advocate',
    slug: 'advocate-fragment-iii',
    src: '/me/personas/advocate.jpg',
  },
  {
    id: 'observer',
    label: 'Observer',
    slug: 'observer-fragment-iv',
    src: '/me/personas/observer.jpg',
  },
];

// ── 背景：封面 3D 球 ─────────────────────────────────────────────────────
// 参照 oumahi.art 首页：
//   · 每张封面是一个小长方体卡片，按 lat/lon 切在球面上、正面朝外；
//   · 卡片的数量/尺寸/深度有一点点确定性的随机，球看起来才不是"点阵"；
//   · 球外面套一层经纬线框（lat 圈 + lon 子午线，每段用一根 1px 的 div 表示）；
//   · 整颗球缓慢自转；指针在空白处按住拖动会改角度，松手后带惯性。
//
// 28 张封面循环铺满 56 个节点：同图会在球上出现两次，但 fibonacci 分布
// 会把它们放到球的两侧，不会挨在一起。src 用 CMS 的压缩封面（这层压得很淡）。
const SPHERE_COVERS = (() => {
  const personaSlugs = new Set(PERSONAS.map((p) => p.slug));
  return blogPosts
    .filter((p) => !personaSlugs.has(p.slug) && p.image?.src)
    .map((p) => ({ slug: p.slug, src: p.image.src }))
    .slice(0, 28);
})();

const SPHERE_NODE_COUNT = 56; // 56 个节点 + 210 根线，铺满一屏
const SPHERE_TILES = SPHERE_COVERS.length
  ? Array.from({ length: SPHERE_NODE_COUNT }, (_, i) => SPHERE_COVERS[i % SPHERE_COVERS.length])
  : [];

const SPHERE_RADIUS_RATIO = 0.34; // 球半径 = hero 短边 × 该比例
const SPHERE_DRAG_DEG = 0.22;    // 拖拽 1px 转多少度
const SPHERE_WHEEL_DEG = 0.18;   // 滚轮 1px 转多少度
const SPHERE_AUTO_Y = 1.6;       // 自转：度 / 秒
const SPHERE_AUTO_Z = 0.45;
const SPHERE_FRICTION = 0.945;   // 松手后的惯性衰减（按 60fps 归一）
const SPHERE_MAX_TILT = 70;      // 上下最多转多少度
const SHAPE_MORPH_MS = 900;      // 拖拽松手后 球体 ↔ 十二面体 的变形时长

const ORBIT_PERIOD = 60; // 公转一圈多少秒

// 主体：个体化。悬停时水波纹 + 鼠标处粒子重组；点它把散出去的四条收回来（不跳转）。
const SUBJECT = {
  src: '/me/individuation.jpg',
  alt: 'Portrait of Huang Wei Long — the individuation series',
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
const sphereEl = ref(null);
const sphereWorldEl = ref(null);
const sphereWireGroup = ref(null);
const dodecaWireGroup = ref(null);
const sphereOn = ref(false);
const sphereGrabbing = ref(false);
const sphereNodes = ref([]);
const sphereWires = ref([]);
const dodecaWires = ref([]);
const sphereState = { radius: 0, rotX: -10, rotY: 0, rotZ: 0, velX: 0, velY: 0 };
let sphereShape = 'sphere'; // 当前排布：'sphere' | 'dodeca'
let sphereMorphing = false;
let sphereNodeEls = [];
const stageEl = ref(null);
const orbitEl = ref(null);
const sceneCanvas = ref(null);
const subjectEl = ref(null);
const rippleCanvas = ref(null);
const grainCanvas = ref(null);
const trailCanvas = ref(null);
let cursorTrail = null;

const groups = ref([]);
const assembledSet = ref({});
const forcedAssembled = ref(null);
let subjectParticles = null;

// ── 指针形态 ────────────────────────────────────────────────────────────
// 方块光标本体和"跟着指针走"都已经在全局那一份里（components/BlockCursor.vue），
// 这里只留一个 finePointer：下面一大批交互（涟漪、拖拽、hover 才生效的那些）
// 仍然只对精确指针开放。
const finePointer = ref(false);
const reducedMotion = ref(false);
const isCompact = ref(false);
// 主题切换时的淡出态。必须是 Vue 状态而不是手动加类 ——
// 这个元素上挂着 :class 绑定，重渲染时 Vue 会把手动加的类冲掉。
const themeShifting = ref(false);

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

// ── 背景球：几何 ─────────────────────────────────────────────────────────
// 坐标约定和参考站一致：
//   节点 transform = rotateY(lon) rotateX(-lat) translateZ(radius)
//   —— 卡片切在球面上、法线朝外，整颗球由父级的 rotateX/Y/Z 一起带着转。
//   线框端点用 latLonToXYZ()（y 取负），和节点的朝向对齐。
function sphereSeeded(i, k) {
  const s = Math.sin(i * k) * 43758.5453;
  return s - Math.floor(s);
}

/** 均匀铺在球面上的第 i 个点（fibonacci sphere 的 lat/lon）。 */
function fibonacciLatLon(i, n) {
  if (n <= 1) return { lat: 0, lon: 0 };
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (i / (n - 1)) * 2;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = golden * i;
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, y))),
    lon: Math.atan2(Math.cos(theta) * ring, Math.sin(theta) * ring),
  };
}

function latLonToXYZ(lat, lon, r) {
  return [
    Math.cos(lat) * Math.sin(lon) * r,
    -Math.sin(lat) * r,
    Math.cos(lat) * Math.cos(lon) * r,
  ];
}

// ── 第二种排布：十二面体 ────────────────────────────────────────────────
// 参考站拖拽松手后会让整颗球在「球体」和「十二面体」之间变形：
// 每个节点从球面上的位置飞到一个十二面体顶点，20 个顶点循环坐 56 张卡，
// 所以会看到卡片成簇地聚到 20 个角上。顶点/棱只算一次。
const DODECA_PHI = (1 + Math.sqrt(5)) / 2;
const DODECA_IPHI = 1 / DODECA_PHI;
let dodecaGeo = null;

function dodecaGeometry() {
  if (dodecaGeo) return dodecaGeo;

  // 标准正十二面体顶点：8 个立方体角 + 3 组各 4 个黄金比例点
  const verts = [];
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      for (const c of [-1, 1]) verts.push([a, b, c]);
    }
  }
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      verts.push([0, a * DODECA_IPHI, b * DODECA_PHI]);
      verts.push([a * DODECA_IPHI, b * DODECA_PHI, 0]);
      verts.push([b * DODECA_PHI, 0, a * DODECA_IPHI]);
    }
  }

  const dirs = verts.map(([x, y, z]) => {
    const len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len];
  });
  const latlon = dirs.map(([x, y, z]) => ({ lat: Math.asin(y), lon: Math.atan2(x, z) }));

  // 顶点间最短距离的就是棱；正十二面体正好 30 条
  let minD = Infinity;
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      const d = Math.hypot(
        dirs[i][0] - dirs[j][0],
        dirs[i][1] - dirs[j][1],
        dirs[i][2] - dirs[j][2]
      );
      if (d < minD) minD = d;
    }
  }
  const tol = minD * 1.01;
  const edges = [];
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      const d = Math.hypot(
        dirs[i][0] - dirs[j][0],
        dirs[i][1] - dirs[j][1],
        dirs[i][2] - dirs[j][2]
      );
      if (d <= tol) edges.push([i, j]);
    }
  }

  dodecaGeo = { latlon, edges };
  return dodecaGeo;
}

/** 一段线的 width + transform（从 a 拉到 b，世界坐标）。 */
function wireAt(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.001) return { len: 0, tf: '' };
  const yaw = Math.atan2(dx, dz);
  const pitch = Math.atan2(-dy, Math.hypot(dx, dz));
  return {
    len,
    tf: `translate3d(${a[0]}px, ${a[1]}px, ${a[2]}px) rotateY(${yaw}rad) rotateX(${pitch}rad)`,
  };
}

/** 经纬线框：lat 圈按 ARC_STEPS 段折线，lon 子午线从一极到另一极。 */
function buildSphereWires(radius) {
  const n = SPHERE_TILES.length || SPHERE_NODE_COUNT;
  const latRings = Math.max(4, Math.round(Math.sqrt(n * 0.55)));
  const lonMeridians = Math.max(6, Math.round(Math.sqrt(n * 1.8)));
  const ARC_STEPS = 3;
  const wires = [];

  for (let r = 1; r < latRings; r++) {
    const lat = Math.PI / 2 - (r / latRings) * Math.PI;
    for (let c = 0; c < lonMeridians; c++) {
      const lon0 = (c / lonMeridians) * Math.PI * 2 - Math.PI;
      for (let s = 0; s < ARC_STEPS; s++) {
        const lonA = lon0 + (s / ARC_STEPS) * ((Math.PI * 2) / lonMeridians);
        const lonB = lon0 + ((s + 1) / ARC_STEPS) * ((Math.PI * 2) / lonMeridians);
        wires.push(wireAt(latLonToXYZ(lat, lonA, radius), latLonToXYZ(lat, lonB, radius)));
      }
    }
  }

  for (let c = 0; c < lonMeridians; c++) {
    const lon = (c / lonMeridians) * Math.PI * 2 - Math.PI;
    for (let r = 0; r < latRings; r++) {
      const latA = Math.PI / 2 - (r / latRings) * Math.PI;
      const latB = Math.PI / 2 - ((r + 1) / latRings) * Math.PI;
      wires.push(wireAt(latLonToXYZ(latA, lon, radius), latLonToXYZ(latB, lon, radius)));
    }
  }
  return wires;
}

/** 十二面体的 30 条棱（和球体线框同一套 wireAt 坐标）。 */
function buildDodecaWires(radius) {
  const geo = dodecaGeometry();
  return geo.edges.map(([i, j]) =>
    wireAt(
      latLonToXYZ(geo.latlon[i].lat, geo.latlon[i].lon, radius),
      latLonToXYZ(geo.latlon[j].lat, geo.latlon[j].lon, radius)
    )
  );
}

/** 按当前半径给一个节点算宽高（面积不变地适配图片比例）和 3D 位置。 */
function sizeSphereNode(node) {
  const size = sphereState.radius * node.sr;
  const aspect = node.aspect || 1;
  const w = Math.max(24, Math.round(Math.sqrt(size * size * aspect)));
  const h = Math.max(24, Math.round(Math.sqrt((size * size) / aspect)));
  node.w = w;
  node.h = h;
  node.ml = -w / 2;
  node.mt = -h / 2;
  node.tf =
    `rotateY(${node.lon}rad) rotateX(${-node.lat}rad) ` +
    `translateZ(${sphereState.radius * node.depth}px)`;
}

function buildSphereModel() {
  if (sphereNodes.value.length || !SPHERE_TILES.length) return;
  const geo = dodecaGeometry();
  sphereNodes.value = SPHERE_TILES.map((_, i) => {
    const { lat, lon } = fibonacciLatLon(i, SPHERE_TILES.length);
    // 同一张卡在两种排布里的目标位置；变形时在 sLat/sLon ↔ dLat/dLon 间插值
    const d = geo.latlon[i % geo.latlon.length];
    return {
      sLat: lat,
      sLon: lon,
      dLat: d.lat,
      dLon: d.lon,
      lat,
      lon,
      // 大小/远近各一点点确定性随机：纯等大的球会像点阵，不像相片簇
      sr: 0.31 + sphereSeeded(i, 12.9898) * 0.1,
      depth: 0.88 + sphereSeeded(i, 78.233) * 0.22,
      aspect: 1,
      w: 0,
      h: 0,
      ml: 0,
      mt: 0,
      tf: '',
    };
  });
}

/** 按 hero 尺寸重算球半径、每个节点的位置和整张经纬网。 */
function layoutSphere() {
  const hero = heroEl.value;
  if (!hero || !SPHERE_TILES.length) return;
  const w = hero.clientWidth;
  const h = hero.clientHeight;
  if (!w || !h) return;
  sphereState.radius = Math.min(520, Math.max(150, Math.min(w, h) * SPHERE_RADIUS_RATIO));
  buildSphereModel();
  for (const node of sphereNodes.value) sizeSphereNode(node);
  sphereWires.value = buildSphereWires(sphereState.radius);
  dodecaWires.value = buildDodecaWires(sphereState.radius);
  applySphereSpin();
  applyWireShape();
}

/** 两种线框只显示当前排布的那一组（变形中由 morph 逐帧改写透明度）。 */
function applyWireShape() {
  if (sphereWireGroup.value) {
    sphereWireGroup.value.style.opacity = sphereShape === 'sphere' ? '1' : '0';
  }
  if (dodecaWireGroup.value) {
    dodecaWireGroup.value.style.opacity = sphereShape === 'dodeca' ? '1' : '0';
  }
}

function applySphereSpin() {
  const el = sphereWorldEl.value;
  if (!el) return;
  el.style.transform =
    `rotateX(${sphereState.rotX.toFixed(2)}deg) ` +
    `rotateY(${sphereState.rotY.toFixed(2)}deg) ` +
    `rotateZ(${sphereState.rotZ.toFixed(2)}deg)`;
}

/** 每帧推进自转与惯性；返回是否还需要继续跑。 */
function tickSphere(now) {
  if (!sphereOn.value || !sphereWorldEl.value) return false;
  const dt = Math.min(64, now - (sphereLastT || now));
  sphereLastT = now;

  if (sphereDrag.active) {
    // 拖动时角度由 pointermove 直接写，这里只保持画面同步
    applySphereSpin();
    return true;
  }

  if (reducedMotion.value || wallHidden.value) {
    applySphereSpin();
    return false;
  }

  const f = dt / 16.667;
  sphereState.rotY += SPHERE_AUTO_Y * (dt / 1000) + sphereState.velY * f;
  sphereState.rotZ += SPHERE_AUTO_Z * (dt / 1000);
  sphereState.rotX = Math.max(
    -SPHERE_MAX_TILT,
    Math.min(SPHERE_MAX_TILT, sphereState.rotX + sphereState.velX * f)
  );
  const decay = Math.pow(SPHERE_FRICTION, f);
  sphereState.velX *= decay;
  sphereState.velY *= decay;
  if (Math.abs(sphereState.velX) < 0.002) sphereState.velX = 0;
  if (Math.abs(sphereState.velY) < 0.002) sphereState.velY = 0;
  applySphereSpin();
  return true;
}

// ── 背景球：球体 ↔ 十二面体 变形 ──────────────────────────────────────
// 参考站最抓眼的那一下：拖拽松手后整颗球换形，每张卡都飞到新位置。
// 56 个节点每帧直接写 style.transform，**不走 Vue 的响应式重渲染** ——
// 60fps × 56 个节点的补间要是每次都触发 patch，主线程会明显掉帧。
// 只在补间结束时把终值写回响应式数据，下一次 resize/重渲染才不会弹回旧位置。
let wheelMorphTimer = 0;
let sphereWheelTravel = 0;

function cacheSphereNodeEls() {
  if (sphereNodeEls.length) return sphereNodeEls;
  sphereNodeEls = [...(sphereEl.value?.querySelectorAll('.hero-sphere__node') || [])];
  return sphereNodeEls;
}

function cancelWheelMorph() {
  if (wheelMorphTimer) clearTimeout(wheelMorphTimer);
  wheelMorphTimer = 0;
  sphereWheelTravel = 0;
}

function toggleSphereShape() {
  if (sphereMorphing || reducedMotion.value) return;
  morphSphereShape(sphereShape === 'sphere' ? 'dodeca' : 'sphere');
}

function morphSphereShape(target) {
  if (sphereMorphing || target === sphereShape) return;
  const nodes = sphereNodes.value;
  const els = cacheSphereNodeEls();
  if (!nodes.length || els.length !== nodes.length) return;

  cancelWheelMorph();
  sphereMorphing = true;
  const radius = sphereState.radius;
  const starts = nodes.map((n) => ({ lat: n.lat, lon: n.lon }));
  const ends = nodes.map((n) => (
    target === 'dodeca'
      ? { lat: n.dLat, lon: n.dLon }
      : { lat: n.sLat, lon: n.sLon }
  ));
  // 经度取较短的那条弧，不然有些卡会绕大半圈才到新位置
  const deltas = ends.map((end, i) => {
    let d = end.lon - starts[i].lon;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  });

  const state = { t: 0 };
  gsap.to(state, {
    t: 1,
    duration: SHAPE_MORPH_MS / 1000,
    ease: 'power2.inOut',
    onUpdate: () => {
      const e = state.t;
      for (let i = 0; i < nodes.length; i++) {
        const a = starts[i];
        const b = ends[i];
        const lat = a.lat + (b.lat - a.lat) * e;
        const lon = a.lon + deltas[i] * e;
        const n = nodes[i];
        els[i].style.transform =
          `rotateY(${lon.toFixed(4)}rad) rotateX(${(-lat).toFixed(4)}rad) ` +
          `translateZ(${(radius * n.depth).toFixed(2)}px)`;
      }
      if (sphereWireGroup.value) {
        sphereWireGroup.value.style.opacity = (1 - e).toFixed(3);
      }
      if (dodecaWireGroup.value) {
        dodecaWireGroup.value.style.opacity = e.toFixed(3);
      }
    },
    onComplete: () => {
      for (let i = 0; i < nodes.length; i++) {
        nodes[i].lat = ends[i].lat;
        nodes[i].lon = ends[i].lon;
        sizeSphereNode(nodes[i]);
      }
      sphereShape = target;
      sphereMorphing = false;
      applyWireShape();
    },
  });
}


// ── 背景球：拖拽 ────────────────────────────────────────────────────────
// 球是底纹，只有**空白处**能起手：卡片自己 pointer-events:none，主体和人格
// 在更高的层，所以 pointerdown 只会在没有别的东西接的时候落到球上。
// 触屏不接拖拽（那是纵向滚动手势的地盘），只保留自转。
const sphereDrag = { active: false, lastX: 0, lastY: 0, stepY: 0, stepX: 0, startX: 0, startY: 0, moved: false };

// 球现在画在主体**上面**（z-index 5.5），但自己 pointer-events:none：
// 指针事件穿透到下面的主体 / 人格；空白处由 Hero 根节点接住来拖球。
// 从主体、人格、链接上起手时不拖 —— 那些是点击/跳转。
function onHeroPointerDown(event) {
  if (event.target?.closest?.('.hero-subject, .persona, a, button, input, textarea, select')) return;
  onSphereDown(event);
}

function onSphereDown(event) {
  if (!finePointer.value || reducedMotion.value || wallHidden.value) return;
  if (event.button !== 0) return;
  // 拖背景时不要顺带把字选中 / 触发原生拖拽
  event.preventDefault();
  // 手一按下去就把还没落地的滚轮换形取消，免得拖到一半整颗球自己变一次
  cancelWheelMorph();
  sphereDrag.active = true;
  sphereDrag.lastX = event.clientX;
  sphereDrag.lastY = event.clientY;
  sphereDrag.startX = event.clientX;
  sphereDrag.startY = event.clientY;
  sphereDrag.stepX = 0;
  sphereDrag.stepY = 0;
  sphereDrag.moved = false;
  // 抓住球就把残余惯性清掉，和参考站一样
  sphereState.velX = 0;
  sphereState.velY = 0;
  sphereGrabbing.value = true;
  window.addEventListener('pointermove', onSphereMove, { passive: true });
  window.addEventListener('pointerup', onSphereUp);
  window.addEventListener('pointercancel', onSphereCancel);
  ensureTicking(true);
}

function onSphereMove(event) {
  if (!sphereDrag.active) return;
  const dx = event.clientX - sphereDrag.lastX;
  const dy = event.clientY - sphereDrag.lastY;
  sphereDrag.lastX = event.clientX;
  sphereDrag.lastY = event.clientY;
  if (!sphereDrag.moved &&
      Math.hypot(event.clientX - sphereDrag.startX, event.clientY - sphereDrag.startY) > 6) {
    sphereDrag.moved = true;
  }
  const stepY = dx * SPHERE_DRAG_DEG;
  const stepX = -dy * SPHERE_DRAG_DEG;
  sphereState.rotY += stepY;
  sphereState.rotX = Math.max(
    -SPHERE_MAX_TILT,
    Math.min(SPHERE_MAX_TILT, sphereState.rotX + stepX)
  );
  // 滑动速度的平滑估计，松手时接成惯性
  sphereDrag.stepY = sphereDrag.stepY * 0.7 + stepY * 0.3;
  sphereDrag.stepX = sphereDrag.stepX * 0.7 + stepX * 0.3;
  applySphereSpin();
}

function onSphereUp() {
  finishSphereDrag(true);
}

/** pointercancel 只收尾，不换形 —— 手势被系统打断时不该触发一次变形。 */
function onSphereCancel() {
  finishSphereDrag(false);
}

function finishSphereDrag(allowMorph) {
  window.removeEventListener('pointermove', onSphereMove);
  window.removeEventListener('pointerup', onSphereUp);
  window.removeEventListener('pointercancel', onSphereCancel);
  if (!sphereDrag.active) return;
  const moved = sphereDrag.moved;
  sphereDrag.active = false;
  sphereDrag.moved = false;
  sphereState.velY = Math.max(-5, Math.min(5, sphereDrag.stepY));
  sphereState.velX = Math.max(-5, Math.min(5, sphereDrag.stepX));
  sphereGrabbing.value = false;
  ensureTicking(true);
  // 拖拽松手 → 换形（点一下不换，不然误触也会整颗球变）
  if (allowMorph && moved) toggleSphereShape();
}

function endSphereDrag() {
  cancelWheelMorph();
  finishSphereDrag(false);
}

// ── 背景球：滚轮 ────────────────────────────────────────────────────────
// 指针落在**球体范围内**时，滚轮只转球、不滚页面 —— 这样卡片位移是看得见的，
// 不会和页脚抽屉一起被滚上去。指针移到球外的空白处，滚轮照常滚页面。
// 每格滚轮先归一到像素（有的浏览器报"行"而不是像素），再限幅，
// 免得触控板一划就把球甩出半圈；Ctrl + 滚轮留给浏览器缩放，不抢。
function onSphereWheel(event) {
  if (!finePointer.value || reducedMotion.value || wallHidden.value || !sphereOn.value) return;
  if (event.ctrlKey) return;
  const raw = event.deltaY;
  if (!raw) return;

  const hero = heroEl.value;
  if (!hero) return;
  const r = hero.getBoundingClientRect();
  const dx = event.clientX - (r.left + r.width / 2);
  const dy = event.clientY - (r.top + r.height / 2);
  // 只接球体本体的半径：透视放大的外圈（还有两侧的空白）留给页面滚动，
  // 想去看页脚时把指针挪出球就能正常滚。
  if (Math.hypot(dx, dy) > sphereState.radius * 1.05) return;

  if (event.cancelable) event.preventDefault();

  const px = raw * (event.deltaMode === 1 ? 30 : event.deltaMode === 2 ? 300 : 1);
  const deg = Math.max(-40, Math.min(40, px * SPHERE_WHEEL_DEG));
  sphereState.rotY += deg;
  // 给一点尾部惯性：滚轮停下后球还会自己再滑一小段，和拖拽松手一个手感
  sphereState.velY = Math.max(-5, Math.min(5, sphereState.velY + deg * 0.03));
  applySphereSpin();
  ensureTicking(true);

  // 滚轮停在球上之后换一次形：这就是"滚动一下，卡片位置明显切换"的那一下。
  // 650ms 没有新的滚轮事件才算一段；一小格触控板抖动（<12°）不换。
  sphereWheelTravel += Math.abs(deg);
  if (wheelMorphTimer) clearTimeout(wheelMorphTimer);
  wheelMorphTimer = window.setTimeout(() => {
    wheelMorphTimer = 0;
    const travel = sphereWheelTravel;
    sphereWheelTravel = 0;
    if (travel >= 12 && !sphereMorphing && !wallHidden.value && !reducedMotion.value) {
      toggleSphereShape();
    }
  }, 650);
}

let sphereLastT = 0;


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
let introFallbackTimer = 0;

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
  // force：不在开场期间被 IO 的旧判断挡住（否则 intro 会永远停在 0）
  ensureTicking(true);
}

// 开场循环万一没跑起来（极慢的机器 / IO 还认为 Hero 在视口外），
// 这个兜底在 INTRO_MS 之后再检查一次：直接把开场落到终态，
// 后面 caption / 球体 / 主体化开都跟着 intro=1 走。不能因为一次循环没起来
// 就让整颗球永远停在透明态。
function armIntroFallback() {
  clearTimeout(introFallbackTimer);
  introFallbackTimer = window.setTimeout(() => {
    if (intro.value < 0 || intro.value >= 1) return;
    intro.value = 1;
    introEased = 1;
    spinOn = true;
    applyIntro();
    ensureTicking(true);
  }, INTRO_MS + 600);
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
  clearTimeout(introFallbackTimer);
  introFallbackTimer = 0;
  captionOn.value = true;
  // 开场落定，背景球才露面；封面从点 ENTER 那一刻就在取了（见 loadCoverSphere）。
  revealCoverSphere();
  // 开场落定 → 停一拍就把主体的人像化开成粒子
  scheduleSubjectDissolve();
});

// ── 动画驱动 ────────────────────────────────────────────────────────────
let masterRaf = 0;
const heroVisible = ref(true);
const groupEls = [];

function paused() {
  return document.hidden || !heroVisible.value;
}

/**
 * 点起主循环。
 * force = true 时顺便把 heroVisible 置真：开场/指针交互这些时刻，页面一定是可见的，
 * 但 IntersectionObserver 可能还停在"Hero 在视口下方"的旧判断上（实测会让开场
 * 卡在 intro<1、整颗球永远停在透明态）。置真之后 IO 会在真正滚出视口时再改回来。
 */
function ensureTicking(force = false) {
  if (force) heroVisible.value = true;
  if (!masterRaf && !document.hidden && (force || heroVisible.value)) {
    masterRaf = requestAnimationFrame(tick);
  }
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

  // 背景球：自转和拖拽惯性。它不依赖 WebGL 场景，所以单独判一次 ——
  // 拿不到 WebGL 时首页也要有这颗球。
  if (tickSphere(now)) again = true;

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
function onTileEnter(g, event) {
  if (!finePointer.value) return;
  // 全局方块光标：压在人上就放大。举旗要带上**这个元素**（event.currentTarget）——
  // 换页时整张卡被摘出文档、pointerleave 不会到，靠元素自检才收得回来。
  setBlockCursorHot(event?.currentTarget, true);
  setTarget(g, 1);
  preloadCover(g.config);
}

function onTileLeave(g, event) {
  if (!finePointer.value) return;
  if (drag.id === g.config.id) return; // 拖拽中别散开
  setBlockCursorHot(event?.currentTarget, false);
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

// ── 背景球的取图与揭示 ──────────────────────────────────────────────────
// 那 28 张封面**不进首屏请求**：首屏已经有 5 张图（4 个人格 + 主体），再叠 28 张
// CDN 封面会把首屏请求数翻几倍，而它们只是背景底纹，晚几秒完全不影响观看。
//
// 取图挂在"遮罩揭开"（点 ENTER）这一刻，但**显示**要等开场动画走完 ——
// 中间这 2.4 秒正好给 28 张封面预热，开场落定时球多半已经是满的，
// 而不是先亮出一颗空线框球再慢慢长照片。
// 取到一张就用 GSAP 淡进来一张（容器这时还是透明的，看不到这个淡入）。
//
// 为什么一张一张而不是一起显：一次全出来的话，整颗球"啪"地闪一下，
// 会和开场那一下抢注意力。错开量写成"序号 × 固定步长"而不是"谁先加载完谁先亮"
// —— 后者在快网络下会挤成一团、在慢网络下又会变成乱序。
let sphereLoaded = false;

/** 图片自己的比例到了之后，把这张卡片按原比例重排（面积不变）。 */
function fitSphereNode(index, img) {
  const node = sphereNodes.value[index];
  if (!node || !img.naturalWidth || !img.naturalHeight) return;
  const aspect = img.naturalWidth / img.naturalHeight;
  if (Math.abs(aspect - node.aspect) < 0.005) return;
  node.aspect = aspect;
  sizeSphereNode(node);
}

/** 一张封面到了可见态：先按原图比例重排卡片，再淡入（或直接点亮）。 */
function showCoverImage(index, el, animate) {
  fitSphereNode(index, el);
  if (!animate || reducedMotion.value) {
    // 回到首页时直接用这个分支：图早就在缓存里，不必再演一遍慢淡入
    gsap.set(el, { autoAlpha: 1 });
    return;
  }
  // ⚠ 只动 autoAlpha（opacity + visibility），**不碰 transform**。
  // 这张图的尺寸/位置全是 Vue 的 :style 绑定和父级的 3D transform 写的，
  // 而 GSAP 的 clearProps: 'all' 会把行内样式**整条**抹掉。
  // 只写 opacity/visibility 的话两边互不干涉，也不需要 clearProps。
  const delay = Math.min(1.1, (index % 10) * 0.025 + Math.floor(index / 10) * 0.05);
  gsap.fromTo(
    el,
    { autoAlpha: 0 },
    { autoAlpha: 1, duration: 0.9, delay, ease: 'power2.out' }
  );
}

/** 把第 i 张封面接到节点上；重复调用是安全的。 */
function bindCoverImage(nodeEl, i, animate) {
  const entry = SPHERE_TILES[i];
  const el = nodeEl?.querySelector('.hero-sphere__img');
  if (!entry || !el) return;

  // 直接挂到真元素上、听它自己的 load：省掉"先用 Image 预热再赋值"的第二次请求
  if (!el.dataset.coverBound) {
    el.dataset.coverBound = '1';
    el.addEventListener('load', () => showCoverImage(i, el, animate), { once: true });
  }
  if (!el.getAttribute('src')) {
    el.src = entry.src;
  } else if (el.complete && el.naturalWidth) {
    // 组件回到前台时最常见：src 还在、图也解完了，但可见性可能被保留成隐藏 / 节点被重渲过
    showCoverImage(i, el, false);
  }
}

async function loadCoverSphere() {
  if (sphereLoaded) return;
  sphereLoaded = true;
  if (!SPHERE_TILES.length) return;
  // 等 Vue 把 56 个节点挂进 DOM 再取元素 —— 关掉动效时 intro 是同步置 1 的，
  // 对应的 watcher 可能跑在渲染之前，直接 querySelectorAll 会拿到空数组。
  await nextTick();
  const nodeEls = cacheSphereNodeEls();
  nodeEls.forEach((nodeEl, i) => bindCoverImage(nodeEl, i, true));
}

/**
 * 从别的页面回到首页时重新校验一遍：
 *   · 节点元素可能被 keep-alive 重插时重渲过 → 缓存清空重取；
 *   · 每张封面如果丢了 src / 被设成 hidden → 补 src、直接点亮。
 * 这一步和开场/循环无关，是"回来就能看到照片"的最后一道保险。
 */
function restoreCoverSphere() {
  if (!sphereLoaded || !SPHERE_TILES.length) return;
  sphereNodeEls = [];
  const nodeEls = cacheSphereNodeEls();
  nodeEls.forEach((nodeEl, i) => bindCoverImage(nodeEl, i, false));
}

/** 开场落定，球体这一层才淡进来（图已经预热过了）。 */
function revealCoverSphere() {
  if (!SPHERE_TILES.length) return;
  sphereOn.value = true;
  ensureTicking(true);
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
  await navigateWithViewTransition(router, { name: 'echo-detail', params: { slug: config.slug } });
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
  // 人像本身也要跟着走。
  // 桌面上"人像让位"是涟漪层干的 —— 它静止时整片铺背景色，把人像盖住，
  // 所以这行在桌面上看不出区别（人像本来就被盖着）。
  // 但触屏上**没有涟漪层**（setupRipple 只在精确指针下建），人像是这张 <img> 自己，
  // 不给它写 opacity 的话 v 归零之后它还留在那儿 —— 那份椭圆遮罩会把它裁成
  // 一个永远消不掉的人像椭圆（"主人格的椭圆不能够消失"就是这么来的）。
  el.style.setProperty('--subject-photo', v.toFixed(3));
}

/** ① 让人像亮起来。涟漪层没就绪就没法画（那一层才是"人像"本身），等它就绪了再来一次。 */
function showSubjectSolid() {
  // 关了动效就没有"先看一会儿人像"这回事，直接停在粒子态
  // ⚠ 这里**不能**再要求 `ripple` 存在：触屏上根本没有涟漪层，加了这条就等于
  //   "先人像、再化开"在触屏上整段跳过 —— 人像一直亮着、永远不散成粒子。
  //   涟漪只管它自己那层的实感（下面那行是可选的），人像/粒子/模糊三件都由
  //   applySubjectSolid 按同一个 v 驱动，没有涟漪照样成立。
  if (subjectSolidShown || reducedMotion.value) return;
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
  setBlockCursorHot(event?.currentTarget, true);
  subjectHovered.value = true;
  ripple?.setHover(true);
  onSubjectMove(event);
}

function onSubjectLeave(event) {
  if (!finePointer.value) return;
  setBlockCursorHot(event?.currentTarget, false);
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
  // 换成精确指针就开拖迹；换成触屏就收干净，别在手机上压一层 canvas。
  if (event.matches) {
    if (!reducedMotion.value) cursorTrail?.start();
  } else {
    cursorTrail?.stop();
    clearBlockCursorHot();
    endSphereDrag();
  }
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
  // 背景球的半径和所有卡片/线框都按 hero 的当前尺寸重算。
  layoutSphere();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  // 画布盖住整个 hero，粒子和被拖走的人格才不会在舞台外被裁掉
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

  // 鼠标拖迹：和方块光标同一套墨色（亮色黑、暗色白），只在这一页、精确指针下开。
  cursorTrail = createCursorTrail(trailCanvas.value, {
    getInk: () => (isDark.value ? '255, 255, 255' : '0, 0, 0'),
  });
  if (finePointer.value && !reducedMotion.value) cursorTrail.start();

  // 首屏只等这 5 张（4 个人格 + 主体）。背景球那 28 张封面走 revealCoverSphere，
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
    // 没有 WebGL 也要摆背景球（它完全不依赖场景）
    layoutSphere();
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

  if (brandEntered.value) {
    startIntro();
    loadCoverSphere();
    armIntroFallback();
  }
});

// 品牌遮罩揭开之后才开始展开（遮罩盖着的时候放动画等于白放）。
// 已经展开过（比如从博客返回首页）就直接是终态，startIntro 内部有只跑一次的守卫。
watch(brandEntered, (v) => {
  if (!v) return;
  startIntro();
  // 点 ENTER 的这一刻就开始取背景球的封面：接下来 2.4 秒的开场正好给它们预热。
  loadCoverSphere();
  armIntroFallback();
  // 人像跟着 Hero 一起从下方浮上来，而且**上来的时候就已经是模糊的** ——
  // 所以亮人像挂在"遮罩揭开"这一刻，不是挂在"开场走完"。
  showSubjectSolid();
});

// 主题一换：浅色下粒子要反过来（uInvert）。
// 颜色不能硬切 —— 先把粒子层淡掉、换完色再淡回来，背景色本身由 CSS 过渡。
watch(isDark, async (dark) => {
  if (!reducedMotion.value) {
    themeShifting.value = true;
    await new Promise((r) => setTimeout(r, 230));
  }
  if (scene3d) scene3d.uniforms.uInvert.value = dark ? 0 : 1;
  layoutGrain();
  if (grainCanvas.value) drawGrain(performance.now(), grainMouse);
  if (scene3d) updateScene(performance.now());
  // 拖迹已经画在 canvas 上了，换主题要把这笔墨色重刷一遍
  cursorTrail?.redraw();
  // 下一帧再淡回来，保证换完色的那一帧已经画出来了
  requestAnimationFrame(() => { themeShifting.value = false; });
});

onActivated(() => {
  forcedAssembled.value = null;
  // 从别的页面回到首页：拖迹的 canvas 是挂在 body 上的，离开时已经 stop 了，
  // 这里按当前指针模式重新接上。
  if (finePointer.value && !reducedMotion.value) cursorTrail?.start();

  // 回首页统一从顶部看：别的页面可能把 window 滚到很深的位置，
  // 回家时球体就落在视口外了。
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

  // 极端状态下补开场 / 补揭示：开场没开始（intro<0）或已经完成但球层没亮。
  if (brandEntered.value && intro.value < 0) startIntro();
  if (intro.value >= 1 && !sphereOn.value) revealCoverSphere();

  // 从别的页面回到首页：这一页是 keep-alive 的，离开时节点被摘出文档 ——
  // 那期间 IntersectionObserver 会把 heroVisible 置成 false、渲染循环停掉，
  // 回来时也不能假定它一定又收到了 isIntersecting=true（实测过不动的情况），
  // 于是画面就停在离开那一刻的一帧上 —— "回来之后粒子是错的"。
  // 这里显式地重新对一次：重跑 relayout 让画布尺寸/焦距按当前布局对齐，
  // 再把可见性和循环重新点起来。
  // 等两帧：keep-alive 把节点插回文档之后布局才算完，量早了全是 0。
  requestAnimationFrame(() => requestAnimationFrame(() => {
    relayout();
    heroVisible.value = true;
    // 每张封面重新校验 src / 可见性（防 keep-alive 重插时节点被重渲）
    if (sphereLoaded) restoreCoverSphere();
    else if (brandEntered.value) loadCoverSphere();
    ensureTicking(true);
  }));
  // 顺带兜住另一种"回来看见椭圆"的情况：人像还没化开就离开首页的话，
  // 化开那一步从没排上（它挂在"开场走完"上），v 会一直停在 1 ——
  // 也就是一张模糊的完整人像糊在那儿，粒子反而不见了。这里补排一次。
  if (subjectSolidShown && !subjectDissolving) scheduleSubjectDissolve();
});

// 离开首页。keep-alive 只是把首页摘出文档、不卸载 —— 而**元素被摘走时浏览器
// 不会补一次 pointerleave**，所以压在某个人格卡上时点了它，那杆旗会一直举着，
// 方块从那一刻起在**每一页**都停在放大态（实测）。这里当场放下。
// （全局组件每帧也会自检一遍兜底，见 composables/useBlockCursor.js。）
onDeactivated(() => {
  clearBlockCursorHot();
  // 拖迹只在首页画：离开时把 canvas 清空、监听摘掉，别在别的页面留一条线。
  cursorTrail?.stop();
  // 离开首页时把还没松手的球体拖拽收掉：keep-alive 摘走元素时不会补
  // pointerup，window 上的监听会一直挂着、把回页后的第一次滑动当成拖拽。
  endSphereDrag();
});

onBeforeUnmount(() => {
  if (masterRaf) cancelAnimationFrame(masterRaf);
  masterRaf = 0;
  clearTimeout(resizeTimer);
  clearTimeout(riseClipTimer);
  clearTimeout(introFallbackTimer);
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
  cursorTrail?.stop();
  cursorTrail = null;
  endSphereDrag();
});
</script>

<template>
  <section
    ref="heroEl"
    class="hero-concept"
    :class="{
      'is-dark': isDark,
      'is-theme-shift': themeShifting,
      'is-risen': brandEntered,
    }"
    @wheel="onSphereWheel"
    @pointerdown="onHeroPointerDown"
  >
  <!-- 鼠标拖迹：一条跟着指针、朝尾部渐隐的折线（参照 oumahi.art 首页）。
         和方块光标一样 Teleport 到 body —— 留在 Hero 里的话，Hero 的 transform
         会把 fixed 的包含块换成它自己，canvas 就不会稳稳盖住视口。
         画由 composables/useCursorTrail.js 负责；这一页离开时会 stop 并清空。 -->
    <Teleport to="body">
      <canvas ref="trailCanvas" class="hero-cursor-trail" aria-hidden="true" />
    </Teleport>

    <!-- 背景：封面 3D 球（参照 oumahi.art 首页）。
         28 张博客封面循环铺到 56 个节点上，每张卡片切在球面上、正面朝外；
         球外套一层经纬线框。整颗球缓慢自转，空白处按住拖拽可转、松手带惯性。
         它只是底纹 —— 不承载点击、不承载悬停，所以卡片 pointer-events:none。
         这里**不写 src**：首屏一个请求都不该为它花，等开场走完由 revealCoverSphere
         一批挂上并淡进来。 -->
    <div
      ref="sphereEl"
      class="hero-sphere"
      :class="{ 'is-on': sphereOn, 'is-off': wallHidden, 'is-grabbing': sphereGrabbing }"
      aria-hidden="true"
    >
      <div class="hero-sphere__viewport">
        <div ref="sphereWorldEl" class="hero-sphere__world">
          <div ref="sphereWireGroup" class="hero-sphere__wiregroup">
            <div
              v-for="(wire, i) in sphereWires"
              :key="`sw${i}`"
              class="hero-sphere__wire"
              :style="{ width: wire.len + 'px', transform: wire.tf }"
            />
          </div>
          <div ref="dodecaWireGroup" class="hero-sphere__wiregroup hero-sphere__wiregroup--dodeca">
            <div
              v-for="(wire, i) in dodecaWires"
              :key="`dw${i}`"
              class="hero-sphere__wire"
              :style="{ width: wire.len + 'px', transform: wire.tf }"
            />
          </div>
          <div
            v-for="(node, i) in sphereNodes"
            :key="`n${i}`"
            class="hero-sphere__node"
            :style="{
              width: node.w + 'px',
              height: node.h + 'px',
              marginLeft: node.ml + 'px',
              marginTop: node.mt + 'px',
              transform: node.tf,
            }"
          >
            <img class="hero-sphere__img" alt="" decoding="async" draggable="false">
          </div>
        </div>
      </div>
    </div>

    <!-- 背景氛围层：暗角 + 极淡的水平扫描线（参照 oumahi.art 的 .atmosphere）。
         只压球体，不压主体和人格 —— 主体在 z5、人格在 z1，这一层在 z0。 -->
    <div class="hero-atmosphere" aria-hidden="true" />

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
        <!-- img 是底图，也是 WebGL 不可用时的全部内容。
             首屏 LCP 图：eager + high，并给出 intrinsic 尺寸避免解码后回流。 -->
        <img
          class="hero-subject__photo"
          :src="SUBJECT.src"
          :alt="SUBJECT.alt"
          width="960"
          height="1280"
          loading="eager"
          fetchpriority="high"
          decoding="async"
          draggable="false"
        >
        <canvas ref="rippleCanvas" class="hero-subject__ripple" aria-hidden="true" />
        <canvas ref="grainCanvas" class="hero-subject__grain" aria-hidden="true" />
      </div>

      <!-- 四个人格：隐形的命中区 + 标签 + 成图用的照片（也是共享元素过渡的取景来源）。
           位置和缩放每帧由三维投影算出来写到 transform 上；视觉本体是场景里的粒子。 -->
      <div ref="orbitEl" class="orbit">
        <div v-for="g in groups" :key="g.config.id" class="orbit__slot">
          <router-link
            :to="{ name: 'echo-detail', params: { slug: g.config.slug } }"
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
              @pointerenter="onTileEnter(g, $event)"
              @pointerleave="onTileLeave(g, $event)"
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
     50% 的黑压在浅底 + 封面球上，10–11px 的小字几乎读不出来 */
  --hero-fg: rgba(0, 0, 0, 0.68);
  --hero-fg-strong: rgba(0, 0, 0, 0.95);
  /* 背景主字（LIVEINPASSION）的浓度：它是底纹，但 7.5% 的黑在 #fafafa 上
     只剩 #ececec，等于没有。亮色给到 0.16 才立得住，暗色保持原来的 7.5%。 */
  --wordmark-opacity: 0.16;
  --hero-noise-opacity: 0.05;
  /* 背景球的浓度。整颗球先合成、再整体乘这个不透明度 —— 卡片相互重叠时
     不会越叠越亮（参考站那种实体球才压得住主体，也不会变成一团糊影）。
     照片是去色的，压在白底上比压在黑底上更容易"化掉"，所以亮色给到 0.38
     （暗色 0.42，球在近黑底上要更实一点才看得出来）。 */
  --sphere-card-opacity: 0.38;
  --sphere-wire: rgba(0, 0, 0, 0.2);
  --sphere-frame: rgba(0, 0, 0, 0.16);
  --sphere-card-bg: rgba(255, 255, 255, 0.28);
  /* 亮色底上的封面要再压暗一点才立得住（白底 + 低不透明度很容易化掉） */
  --sphere-img-filter: grayscale(1) contrast(1.05) brightness(0.82);
  /* 球外的氛围：亮色是"纸边发白"的暗角，暗色是参考站那种黑场暗角 */
  --hero-vignette: rgba(250, 250, 250, 0.72);
  --hero-scanline: rgba(0, 0, 0, 0.01);
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
  --sphere-card-opacity: 0.42;
  --sphere-wire: rgba(255, 255, 255, 0.32);
  --sphere-frame: rgba(255, 255, 255, 0.2);
  --sphere-card-bg: rgba(0, 0, 0, 0.42);
  --sphere-img-filter: grayscale(1) contrast(1.05);
  --hero-vignette: rgba(0, 0, 0, 0.62);
  --hero-scanline: rgba(255, 255, 255, 0.022);
}

/* ⚠ 这里原来有一条"系统光标压掉"的规则（.hero-concept.is-fine ... cursor:none），
   现在归全局：方块光标是全站的（components/BlockCursor.vue），压光标的类挂在
   <html> 上、规则在 styles/main.css 的 html.is-block-cursor 那一段。
   放这儿只会管住首页，而且 .hero-concept 一离开就失效。 */

.hero-concept__noise {
  position: absolute;
  inset: 0;
  z-index: 90;
  pointer-events: none;
  opacity: var(--hero-noise-opacity);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 160px 160px;
}

/* 舞台锁 16:10，宽度由可用高度反推 —— 百分比坐标才会等比缩放。
   ⚠ 舞台本身 pointer-events:none：它是一整块透明的定位盒子，默认会把
   球体那层挡住，于是"空白处拖球"只有舞台外的边条能用。
   主体和人格各自把指针事件重新打开（见下面的 .hero-subject / .persona）。 */
.hero-concept__stage {
  position: relative;
  width: min(100%, calc((100vh - 260px) * 1.6));
  aspect-ratio: 16 / 10;
  pointer-events: none;
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
  /* 同 .persona__label：那行小字也会压在球上 */
  text-shadow: 0 0 4px var(--hero-bg), 0 0 10px var(--hero-bg);
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
  /* 舞台是 pointer-events:none，这一层要自己打开（球体拖拽从别处穿透） */
  pointer-events: auto;
  /* 原来这里是 <a href>，指针样式由链接给。现在只保留点击收拢的手感，不跳转。 */
  cursor: pointer;
  /* 椭圆取景：这张是照片，矩形边和背景接不上，显得生硬。
     用一个照着人脸的椭圆把它框住 —— 脸大致在画面 x 20~80% / y 24~72%，
     加上肩部到 y≈95%，所以椭圆取中心、半径各 46%（x 6~94%、y 6~94%）刚好容下。
     衰减带留得很宽（不透明核心只到 50% 半径），边界才是渐隐的而不是一圈边缘。 */
  mask-image: radial-gradient(ellipse 46% 46% at 50% 50%, #000 50%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 46% 46% at 50% 50%, #000 50%, transparent 100%);
  /* 这里**不能放 filter**。
     contrast/brightness 会把涟漪画布里的照片和粒子层的灰度一起推离原值，
     浅色下尤其明显（人像会发灰/发白）。人像图本来就是黑白的，grayscale 是空转。 */
  /* 闲置时在风里飘。关键帧刻意做得不规则 —— 单一正弦摆起来是机械的，
     几个不均匀的节点加长周期才像被风推着。 */
  animation: subject-wind 17s ease-in-out infinite;
  /* 开场"先完整人像、再粒子化"用的两个量，由 JS 逐帧写（见 applySubjectSolid）。
     初值就是粒子态的终值：揭示没跑成也不会留下半拆开的样子。 */
  --subject-blur: 0px;
  --subject-grain: 1;
  /* 人像那一层的浓度。初值 1（不是粒子态的 0）：脚本没跑起来时这张照片就是全部内容，
     真要没人推它也该看得见。 */
  --subject-photo: 1;
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
  /* 由 applySubjectSolid 逐帧写（和 --subject-blur / --subject-grain 是同一个 v）。
     初值 1：脚本还没跑起来（或者 WebGL 整个不可用）时，这张照片就是全部内容。
     粒子化之后它归 0 —— 触屏上只有这一层照片，不归 0 的话那个椭圆遮罩会把
     它裁成一个消不掉的人像轮廓。 */
  opacity: var(--subject-photo, 1);
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

/* 静止且没有悬停：整层没有东西要画（见 useRippleEffect 的 syncIdle）。
   藏掉它，椭圆遮罩里那块背景色就不会被看见 —— 否则背景上有海报/粒子时，
   那块平色会被裁成一个明显的椭圆。 */
.hero-subject__ripple.is-idle {
  opacity: 0;
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
  /* 舞台是 pointer-events:none，卡片要自己打开（否则点不到、也拖不动） */
  pointer-events: auto;
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
  /* 人格标签压在封面球上：给一圈背景色阴影，明暗两种主题下都还读得出来 */
  text-shadow: 0 0 4px var(--hero-bg), 0 0 10px var(--hero-bg);
  transition: color 0.35s ease;
}

.persona:hover .persona__label {
  color: var(--hero-fg-strong);
}

/* ── 背景：封面球（其他博客的封面，参照 oumahi.art 首页）─────────────────
   球体是一层纯底纹：z0，排在星尘画布前面（画布同为 z0，DOM 在后所以盖住它）。
   卡片本身 pointer-events:none，只有最外层容器收 pointerdown —— 也就是只有
   "空白处"才能起手拖球（主体/人格在更高的层，轮不到球）。
   关了之后整层淡出并让开事件；不做 display:none —— 那会把图片重新变成
   "没加载过"的状态，再打开时又要重来一遍。 */
.hero-sphere {
  position: absolute;
  inset: 0;
  /* 3D 球包住主人格：球在主体（z5）上面、背景字（z6）下面。
     ⚠ z-index 只能是整数，5.5 会被整条丢弃（computed 回到 auto）。
     和背景字同为 6 时靠 DOM 顺序：球在字前面，所以字仍然在上面。
     视觉在上、事件在下 —— 球自己不接收指针，拖拽改由 Hero 根节点接。 */
  z-index: 6;
  opacity: 0;
  pointer-events: none;
  /* 触屏上纵向手势留给页面滚动，横向拖动也不接（onSphereDown 只认精确指针） */
  touch-action: pan-y;
  cursor: grab;
  transition: opacity 0.9s ease;
  /* 球边缘揉软。mask 挂在最外层，不碰里面那层 perspective ——
     mask/opacity 这类分组属性挂在 perspective 上会把 3D 压平。 */
  mask-image: radial-gradient(circle closest-side at 50% 50%, #000 60%, transparent 100%);
  -webkit-mask-image: radial-gradient(circle closest-side at 50% 50%, #000 60%, transparent 100%);
}

.hero-sphere.is-on {
  opacity: var(--sphere-card-opacity);
}

.hero-sphere.is-off {
  opacity: 0 !important;
  pointer-events: none;
}

.hero-sphere.is-grabbing {
  cursor: grabbing;
}

.hero-sphere__viewport {
  position: absolute;
  inset: 0;
  perspective: 1400px;
}

/* 世界的原点在 hero 中心；每条线的坐标、每张卡片的位置都以这里为准。 */
.hero-sphere__world {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 1px;
  height: 1px;
  transform-style: preserve-3d;
  will-change: transform;
}

/* 两种线框各装一组：球体（经纬网）和十二面体（30 条棱）。
   形变时只交叉淡入淡出两组，不逐帧重建 200 多根线。 */
.hero-sphere__wiregroup {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  transform-style: preserve-3d;
  pointer-events: none;
}

.hero-sphere__wiregroup--dodeca {
  opacity: 0;
}

/* 经纬线：一根 1px 的 div 从 a 拉到 b。变换是静态的，整颗球转的时候
   由父级 world 一起带着走，所以每帧只有一次 transform 写入。 */
.hero-sphere__wire {
  position: absolute;
  top: 0;
  left: 0;
  height: 1px;
  transform-origin: 0 50%;
  background: var(--sphere-wire);
  pointer-events: none;
}

/* 每张封面是切在球面上的一个平面，正面朝外。 */
.hero-sphere__node {
  position: absolute;
  top: 0;
  left: 0;
  overflow: hidden;
  background: var(--sphere-card-bg);
  box-shadow: inset 0 0 0 1px var(--sphere-frame);
  pointer-events: none;
  will-change: transform;
}

.hero-sphere__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  /* GSAP 从 0 淡到 1（见 revealCoverSphere）；浓度由 .hero-sphere__node 压 */
  opacity: 0;
  visibility: hidden;
  /* 清晰，但去色 —— 整站是黑白语言，底纹带上颜色就会跳出来 */
  filter: var(--sphere-img-filter);
  backface-visibility: visible;
}

/* ── 背景氛围：暗角 + 极淡的水平扫描线（参照 oumahi.art 的 .atmosphere）──
   z0 且排在球后面，所以只压球体这一层：主体（z5）和人格（z1）都在它上面。
   两个渐变合成一层，扫描线是 1px 亮/2px 暗的重复渐变，不是 300 个 div。 */
.hero-atmosphere {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse at center, transparent 38%, var(--hero-vignette) 100%),
    repeating-linear-gradient(
      to bottom,
      var(--hero-scanline) 0,
      var(--hero-scanline) 1px,
      transparent 1px,
      transparent 3px
    );
}


/* ── 鼠标拖迹 ────────────────────────────────────────────────────────── */
/* 挂在 body 上（Teleport）。z-index 900：压在页面内容之上，但在方块光标
   （100000）、品牌遮罩（9999）和转场层（90000）之下 —— 入场/换页时不会
   有一条线浮在最上面。 */
.hero-cursor-trail {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  z-index: 900;
  pointer-events: none;
}

@media (hover: none) {
  .hero-cursor-trail {
    display: none;
  }
}

/* ── 方块光标 ──────────────────────────────────────────────────────────── */
/* 已经整体搬到 components/BlockCursor.vue（含样式）。这里不再留一份 ——
   两边各写一套的话，改一边就会和另一边对不上。 */

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
</style>
