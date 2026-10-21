<script setup>
// LIFE 页的 3D 神经网络（Obsidian 图 / 量子纠缠风格）。
//
// 视觉：8 个分类枢纽 + 每天一颗节点，节点之间是发光细线；相似日之间连“纠缠”
// 长弧，脉冲成对出现（一颗从 A 跑向 B，另一颗从 B 跑向 A）。
// 数据映射见 data/lifeBrain.js。这里只管 three 场景、镜头和交互。
//
// 镜头模型：相机始终围绕一个 target 做球面轨道（不是转模型）。
//   · 点节点 → target 平移到节点、距离拉近，1.5s 缓动，形成“推镜”
//   · 再点另一个节点 → 从当前位置继续推到新节点（点对点切换）
//   · 点空白 / RESET → 回到全局镜头
//   · 全屏里滚轮缩放；普通面板里不抢页面滚动
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { useTheme } from '../composables/useTheme.js';
import { setBlockCursorHot } from '../composables/useBlockCursor.js';
import {
  BRAIN_COLOR,
  DAY_COLOR,
  buildBrainCloud,
  buildBrainGraph,
  buildBrainModel,
} from '../data/lifeBrain.js';

const props = defineProps({
  rows: { type: Array, default: () => [] },
  colorMode: { type: Boolean, default: false },
  reduced: { type: Boolean, default: false },
});

const emit = defineEmits(['select-day']);

const { isDark } = useTheme();

const hostRef = ref(null);
const canvasRef = ref(null);
const labelsRef = ref(null);
const pointerRef = ref(null);
const tooltipRef = ref(null);
const pointerVisible = ref(false);
// idle | loading | ready | unsupported | error | empty
const status = ref('idle');
const auto = ref(!props.reduced);
const expanded = ref(false);
const hover = ref(null); // node id
const selected = ref(null); // node id
const grabbing = ref(false);
const camMoving = ref(false);
const counts = ref({ nodes: 0, edges: 0 });

// 图数据同时供模板（标签/图例）和 three 场景使用
const graphNodes = ref([]);
const graphEdges = ref([]);

const model = computed(() => buildBrainModel(props.rows));
const nodeById = computed(() => new Map(graphNodes.value.map((n) => [n.id, n])));

const hoverNode = computed(() => (hover.value ? nodeById.value.get(hover.value) : null));
const selectedNode = computed(() => (selected.value ? nodeById.value.get(selected.value) : null));
const activeNode = computed(() => hoverNode.value || selectedNode.value || null);

function infoFor(n) {
  if (!n) return null;
  if (n.kind === 'category') {
    const c = model.value.categories.find((x) => x.name === n.cat);
    if (!c) return null;
    return { ...c, kind: 'category', index: n.index };
  }
  const d = model.value.days[n.index];
  if (!d) return null;
  return {
    ...d,
    kind: 'day',
    index: n.index,
    label: n.label,
    dominantHours: d.dominant ? d.categories[d.dominant] : 0,
  };
}

// 画面上的高亮跟鼠标（悬停优先）；左上角读数跟**选中**，
// 悬停别的节点时不会再把你刚选的那一项从读数里顶掉。
const hoverInfo = computed(() => infoFor(hoverNode.value));
const selectedInfo = computed(() => infoFor(selectedNode.value));
const activeInfo = computed(() => hoverInfo.value || selectedInfo.value);
const readoutInfo = computed(() => selectedInfo.value || hoverInfo.value);
const readoutMode = computed(() => (
  selectedNode.value ? 'SELECTED' : hoverNode.value ? 'HOVER' : ''
));
// 鼠标底下的节点和已选中的不是同一个时，才在光标旁弹提示
const cursorInfo = computed(() => (
  hoverNode.value && hoverNode.value !== selectedNode.value ? hoverInfo.value : null
));

const summary = computed(() => {
  const active = model.value.categories.filter((c) => c.hours > 0).length;
  return {
    totalHours: model.value.totalHours,
    active,
    days: model.value.days.length,
    daysWithData: model.value.daysWithData,
  };
});

const hoverAttr = computed(() => hover.value || 'none');
const selectedAttr = computed(() => selected.value || 'none');

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function fullDay(day) {
  if (!day) return '—';
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${DAY_NAMES[date.getUTCDay()]} ${String(d).padStart(2, '0')} ${MONTH_NAMES[m - 1]} ${y}`;
}

// ── three 运行时 ────────────────────────────────────────────────────────

let THREE = null;
let renderer = null;
let scene = null;
let camera = null;
let assembly = null;
let graphGroup = null;
let rigGroup = null;
let coreGroup = null;
let dust = null;
let edgeLines = null;
let pulseSprites = [];
let gyroA = null;
let gyroB = null;
let ambient = null;
let keyLight = null;
let rimLight = null;
let glowTex = null;
let selectionRing = null;

const metalMats = [];
const inkMats = [];
const nodeViews = new Map(); // id -> { node, sprite, core, proxy, baseScale, baseCoreScale, isCat }

let cloud = null;
let graph = null;
let edgeData = [];
let adjacency = new Map();
let pulsePairs = [];
let pulsePool = [];
let pulseRng = null;

const BASE_Z = 5.35;
const FOV = 42;
const MAX_DPR = 1.75;
const PULSES = 44; // 对数
const START_YAW = 0.3;
const START_PITCH = 0.18;
const RAIL_R = 2.06;
const RAIL_Y = -0.42;
const RAIL_TILT = -0.95;

let raf = 0;
let loopOn = false;
let active = true;
let visible = false;
let ready = false;
let dirty = true;
let lastFrame = 0;
let lastInteract = 0;
let lastCamAttr = '';
let lastCamWrite = 0;
let lastRebuildAt = 0;
let zoomUntil = 0;
let hoverDirty = false;
let pointerX = null;
let pointerY = null;
let currentHover = '';
let pointerInside = false;
let signature = '';
const labelSizes = new Map();

// 相机：绕 target 的球面轨道
let camTarget = null;
let camYaw = START_YAW;
let camPitch = START_PITCH;
let camDist = BASE_Z;
let baseDist = BASE_Z;
let camTween = null;
let velYaw = 0;
let velPitch = 0;
let drag = null;

let io = null;
let ro = null;
let nativeFs = false;

const raycaster = { obj: null };
const ndc = { x: 0, y: 0 };
const labelV = { v: null };

// ── 调色板 ──────────────────────────────────────────────────────────────

function palette() {
  const dark = isDark.value;
  return {
    dark,
    bg: dark ? '#1A1A1A' : '#FAFAFA',
    ink: dark ? '#F2F2F2' : '#151515',
    dim: dark ? '#7A7A7A' : '#9A9A9A',
    metal: dark ? '#6A6A6A' : '#9A9A9A',
  };
}

function catColor(name) {
  return new THREE.Color(BRAIN_COLOR[name] || BRAIN_COLOR.Other);
}

function dayColor(lit = 1) {
  return new THREE.Color(isDark.value ? DAY_COLOR.dark : DAY_COLOR.light)
    .multiplyScalar(lit);
}

// 日期节点永远用自己的时间色；分类节点才用分类色。
function nodeColor(node, lit = 1) {
  if (!props.colorMode) return new THREE.Color(palette().ink).multiplyScalar(lit);
  return node.kind === 'day' ? dayColor(lit) : catColor(node.cat).multiplyScalar(lit);
}

// 边的颜色跟着“它连接的东西”走：
//   日→分类：分类色；分类↔分类：两色混合；日↔日（纠缠）：时间色。
function edgeColor(e) {
  if (!props.colorMode) return new THREE.Color(palette().ink);
  if (e.kind === 'entangle') return dayColor();
  if (e.kind === 'flow') {
    return catColor(e.aKind === 'category' ? e.aCat : e.bCat);
  }
  return catColor(e.aCat).lerp(catColor(e.bCat), 0.5);
}

// ── 构建 ────────────────────────────────────────────────────────────────

function makeGlowTexture() {
  const size = 192;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.12, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.17)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.03)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildScene() {
  cloud = buildBrainCloud({ count: 680, seed: 20261018 });
  graph = buildBrainGraph(props.rows, cloud);
  graphNodes.value = graph.nodes;
  graphEdges.value = graph.edges;
  counts.value = { nodes: graph.nodes.length, edges: graph.edges.length };

  adjacency = new Map();
  graph.nodes.forEach((n) => adjacency.set(n.id, new Set()));
  graph.edges.forEach((e) => {
    adjacency.get(e.a)?.add(e.b);
    adjacency.get(e.b)?.add(e.a);
  });

  assembly = new THREE.Group();
  graphGroup = new THREE.Group();
  rigGroup = new THREE.Group();
  assembly.add(graphGroup, rigGroup);
  scene.add(assembly);

  buildDust();
  buildEdges();
  buildNodes();
  // 矢量圆环：放大到全屏也不会像贴图那样糊
  selectionRing = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1, 96, 1, 0.4, Math.PI * 1.72),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette().ink),
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  selectionRing.visible = false;
  graphGroup.add(selectionRing);
  buildRig();
  buildCore();
  buildPulses();
  paintAll();
  lastRebuildAt = performance.now();
  dirty = true;
}

function buildDust() {
  // 脑壳只剩一层很暗的尘埃，负责剪影，不再抢节点的注意力
  const pts = cloud.positions.filter((_, i) => i % 2 === 0);
  const pos = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => pos.set(p, i * 3));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dust = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      map: glowTex,
      size: 0.04,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      color: new THREE.Color(palette().dim),
      sizeAttenuation: true,
      blending: isDark.value ? THREE.AdditiveBlending : THREE.NormalBlending,
    }),
  );
  graphGroup.add(dust);
}

function metalMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(palette().metal),
    metalness: 0.55,
    roughness: 0.34,
  });
  metalMats.push(mat);
  return mat;
}

function inkLineMaterial(opacity) {
  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(palette().ink),
    transparent: true,
    opacity,
  });
  inkMats.push(mat);
  return mat;
}

function curveBetween(a, b, kind, seed) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  const outward = mid.clone();
  if (outward.lengthSq() < 0.0001) outward.set(0, 1, 0);
  outward.normalize();

  // 纠缠弧绕开中心，像两颗粒子之间拉出的一条长线
  if (kind === 'entangle') {
    const side = new THREE.Vector3(-(vb.z - va.z), 0, vb.x - va.x);
    if (side.lengthSq() < 0.0001) side.set(0, 1, 0);
    side.normalize().multiplyScalar((seed % 2 ? 1 : -1) * 0.24);
    mid.add(side);
    mid.add(outward.multiplyScalar(0.3));
  } else if (kind === 'link') {
    mid.add(outward.multiplyScalar(0.18));
  } else {
    mid.add(outward.multiplyScalar(0.04));
  }
  const curve = new THREE.QuadraticBezierCurve3(va, mid, vb);
  return curve.getPoints(kind === 'entangle' ? 22 : 12);
}

function buildEdges() {
  let verts = 0;
  const paths = graph.edges.map((e, i) => {
    const a = graph.nodes.find((n) => n.id === e.a);
    const b = graph.nodes.find((n) => n.id === e.b);
    const points = curveBetween(a.position, b.position, e.kind, i);
    verts += (points.length - 1) * 2;
    return { ...e, aNode: a, bNode: b, points };
  });

  const pos = new Float32Array(verts * 3);
  const col = new Float32Array(verts * 3);
  edgeData = [];
  let cursor = 0;
  for (const e of paths) {
    const start = cursor;
    for (let i = 0; i < e.points.length - 1; i += 1) {
      const p = e.points[i];
      const q = e.points[i + 1];
      pos.set([p.x, p.y, p.z, q.x, q.y, q.z], cursor * 3);
      cursor += 2;
    }
    edgeData.push({
      a: e.a,
      b: e.b,
      kind: e.kind,
      weight: e.weight,
      start,
      count: cursor - start,
      points: e.points,
      aCat: e.aNode.cat,
      bCat: e.bNode.cat,
      aKind: e.aNode.kind,
      bKind: e.bNode.kind,
    });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  edgeLines = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    }),
  );
  graphGroup.add(edgeLines);
}

function buildNodes() {
  const geo = new THREE.SphereGeometry(1, 10, 8);
  // 日期节点用八面体（小菱形）：即使黑白模式下没有颜色，也能和分类枢纽区分开
  const dayGeo = new THREE.OctahedronGeometry(1, 0);
  const proxyGeo = new THREE.SphereGeometry(1, 8, 6);
  const proxyMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    colorWrite: false,
  });

  graph.nodes.forEach((node) => {
    const isCat = node.kind === 'category';
    const baseScale = isCat ? 0.2 : (node.missing ? 0.055 : 0.06 + 0.045 * node.weight);
    const baseCoreScale = isCat ? 0.055 : (node.missing ? 0.014 : 0.02 + 0.012 * node.weight);

    const spriteMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: nodeColor(node),
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: isDark.value ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(...node.position);
    sprite.scale.setScalar(baseScale);

    const coreMat = new THREE.MeshBasicMaterial({
      color: nodeColor(node),
      transparent: true,
      opacity: 0.95,
    });
    const core = new THREE.Mesh(isCat ? geo : dayGeo, coreMat);
    core.position.set(...node.position);
    core.scale.setScalar(baseCoreScale);

    const proxy = new THREE.Mesh(proxyGeo, proxyMat);
    proxy.position.set(...node.position);
    proxy.scale.setScalar(isCat ? 0.17 : 0.11);
    proxy.userData = { nodeId: node.id };

    graphGroup.add(sprite, core, proxy);
    nodeViews.set(node.id, { node, sprite, core, proxy, baseScale, baseCoreScale, isCat });
  });
}

function buildRig() {
  const railGroup = new THREE.Group();
  railGroup.rotation.x = RAIL_TILT;
  rigGroup.add(railGroup);

  // 日期轨道保留成机械外框，日期本体已经变成图节点
  const rail = new THREE.Mesh(new THREE.TorusGeometry(RAIL_R, 0.004, 4, 220), metalMaterial());
  rail.rotation.x = Math.PI / 2;
  rail.position.y = RAIL_Y;
  railGroup.add(rail);

  const tickGeo = new THREE.BoxGeometry(0.006, 0.07, 0.006);
  const ticks = new THREE.InstancedMesh(tickGeo, metalMaterial(), 72);
  const d = new THREE.Object3D();
  for (let i = 0; i < 72; i += 1) {
    const a = (i / 72) * Math.PI * 2;
    d.position.set(Math.cos(a) * RAIL_R, RAIL_Y, Math.sin(a) * RAIL_R);
    d.rotation.set(0, -a, 0);
    d.scale.set(1, i % 6 === 0 ? 1.9 : 0.9, 1);
    d.updateMatrix();
    ticks.setMatrixAt(i, d.matrix);
  }
  ticks.instanceMatrix.needsUpdate = true;
  railGroup.add(ticks);

  gyroA = new THREE.Group();
  gyroA.rotation.x = 0.5;
  gyroA.rotation.z = 0.12;
  gyroA.add(new THREE.Mesh(new THREE.TorusGeometry(1.86, 0.006, 5, 220), metalMaterial()));
  const gTicks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.085, 0.012), metalMaterial(), 24);
  const d2 = new THREE.Object3D();
  for (let i = 0; i < 24; i += 1) {
    const a = (i / 24) * Math.PI * 2;
    d2.position.set(Math.cos(a) * 1.86, Math.sin(a) * 1.86, 0);
    d2.rotation.set(0, 0, a);
    d2.updateMatrix();
    gTicks.setMatrixAt(i, d2.matrix);
  }
  gTicks.instanceMatrix.needsUpdate = true;
  gyroA.add(gTicks);
  rigGroup.add(gyroA);

  gyroB = new THREE.Group();
  gyroB.rotation.x = -0.95;
  gyroB.rotation.z = -0.45;
  gyroB.add(new THREE.Mesh(new THREE.TorusGeometry(1.68, 0.005, 4, 200), metalMaterial()));
  rigGroup.add(gyroB);
}

function buildCore() {
  coreGroup = new THREE.Group();
  coreGroup.add(new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(0.12, 1)),
    inkLineMaterial(0.22),
  ));
  const dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(palette().ink) });
  inkMats.push(dotMat);
  coreGroup.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 0), dotMat));
  graphGroup.add(coreGroup);
}

function buildPulses() {
  pulseSprites = [];
  for (let i = 0; i < PULSES; i += 1) {
    for (let side = 0; side < 2; side += 1) {
      const mat = new THREE.SpriteMaterial({
        map: glowTex,
        color: new THREE.Color(palette().ink),
        transparent: true,
        opacity: side ? 0.7 : 0.95,
        depthWrite: false,
        blending: isDark.value ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const sp = new THREE.Sprite(mat);
      sp.scale.setScalar(0.045);
      graphGroup.add(sp);
      pulseSprites.push({ sprite: sp, pair: i, side });
    }
  }

  pulseRng = (() => {
    let a = 0x9e3779b9;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  rebuildPulsePool();
  seedPulses();
}

function edgeLit(edge, activeId) {
  if (!activeId) return edge.kind === 'entangle' ? 1 : edge.kind === 'link' ? 0.85 : 0.7;
  if (edge.a === activeId || edge.b === activeId) return edge.kind === 'entangle' ? 1.35 : 1.15;
  return 0.12;
}

function rebuildPulsePool() {
  const activeId = activeNode.value?.id || null;
  if (activeId) {
    pulsePool = edgeData
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.a === activeId || e.b === activeId || e.kind === 'entangle')
      .map(({ i }) => i);
  } else {
    pulsePool = edgeData.map((_, i) => i);
  }
  if (!pulsePool.length) pulsePool = edgeData.map((_, i) => i);
}

function pickEdge() {
  if (!pulsePool.length) return 0;
  return pulsePool[Math.floor(pulseRng() * pulsePool.length)];
}

function seedPulses() {
  pulsePairs = Array.from({ length: PULSES }, () => ({
    edge: pickEdge(),
    t: pulseRng(),
    speed: 0.14 + pulseRng() * 0.3,
  }));
  paintPulses();
}

function pointAt(points, t) {
  const n = points.length - 1;
  const x = Math.max(0, Math.min(0.9999, t)) * n;
  const i = Math.floor(x);
  const f = x - i;
  const a = points[i];
  const b = points[i + 1] || a;
  return [
    a.x + (b.x - a.x) * f,
    a.y + (b.y - a.y) * f,
    a.z + (b.z - a.z) * f,
  ];
}

function updatePulses(dt) {
  if (!pulseSprites.length) return;
  for (let i = 0; i < pulsePairs.length; i += 1) {
    const p = pulsePairs[i];
    p.t += dt * p.speed;
    if (p.t >= 1) {
      p.t -= 1;
      p.edge = pickEdge();
      paintPulsePair(i);
    }
    const edge = edgeData[p.edge];
    if (!edge) continue;
    const a = pointAt(edge.points, p.t);
    const b = pointAt(edge.points, 1 - p.t);
    const sa = pulseSprites[i * 2];
    const sb = pulseSprites[i * 2 + 1];
    if (sa) sa.sprite.position.set(a[0], a[1], a[2]);
    if (sb) sb.sprite.position.set(b[0], b[1], b[2]);
  }
}

// ── 上色 / 高亮 ─────────────────────────────────────────────────────────

function paintAll() {
  if (!nodeViews.size) return;
  paintEdges();
  paintNodes();
  paintDust();
  paintPulses();
  paintRig();
  dirty = true;
}

function paintEdges() {
  if (!edgeLines) return;
  const p = palette();
  const bg = new THREE.Color(p.bg);
  const ink = new THREE.Color(p.ink);
  const color = edgeLines.geometry.getAttribute('color');
  const activeId = activeNode.value?.id || null;
  const neighbors = activeId ? adjacency.get(activeId) : null;

  edgeData.forEach((e) => {
    const lit = edgeLit(e, activeId);
    let c;
    if (props.colorMode) {
      c = bg.clone().lerp(edgeColor(e), Math.min(1, 0.14 + 0.55 * lit * (0.5 + e.weight * 0.5)));
    } else {
      const base = e.kind === 'entangle' ? 0.44 : e.kind === 'link' ? 0.3 : 0.17;
      c = bg.clone().lerp(ink, Math.min(0.94, base * (0.5 + e.weight * 0.5) * lit + 0.03));
    }
    const connected = e.a === activeId || e.b === activeId;
    const near = connected || (neighbors && (neighbors.has(e.a) || neighbors.has(e.b)));
    if (activeId && !near) c.lerp(bg, 0.58);
    for (let i = 0; i < e.count; i += 1) {
      color.setXYZ(e.start + i, c.r, c.g, c.b);
    }
  });
  color.needsUpdate = true;
}

function paintNodes() {
  const activeId = activeNode.value?.id || null;
  const neighbors = activeId ? adjacency.get(activeId) : null;

  nodeViews.forEach((view) => {
    const { node, sprite, core } = view;
    const isActive = node.id === activeId;
    const isNeighbor = !!(neighbors && neighbors.has(node.id));
    const baseLit = node.kind === 'category'
      ? 1.25
      : (node.missing ? 0.45 : 0.62 + 0.55 * node.weight);
    const lit = !activeId
      ? baseLit
      : isActive ? Math.max(1.35, baseLit) : isNeighbor ? baseLit * 0.95 : baseLit * 0.3;

    sprite.material.color.copy(nodeColor(node, lit));
    core.material.color.copy(nodeColor(node, lit));
    const opacity = !activeId
      ? (node.missing ? 0.18 : (node.kind === 'category' ? 0.42 : 0.24))
      : isActive ? 0.85 : isNeighbor ? 0.42 : 0.09;
    sprite.material.opacity = opacity;
    core.material.opacity = Math.max(0.2, opacity);

    const scale = view.baseScale * (isActive ? 1.35 : isNeighbor ? 1.12 : 1);
    sprite.scale.setScalar(scale);
    core.scale.setScalar(view.baseCoreScale * (isActive ? 1.45 : isNeighbor ? 1.12 : 1));
  });
}

function paintDust() {
  if (!dust) return;
  const p = palette();
  dust.material.color.set(p.dim);
  dust.material.opacity = p.dark ? 0.7 : 0.4;
  dust.material.blending = p.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
  dust.material.needsUpdate = true;
}

function paintPulsePair(i) {
  const pair = pulsePairs[i];
  const edge = edgeData[pair?.edge];
  const a = pulseSprites[i * 2];
  const b = pulseSprites[i * 2 + 1];
  if (!a || !b) return;
  if (!edge) {
    a.sprite.visible = false;
    b.sprite.visible = false;
    return;
  }
  const c = edgeColor(edge);
  a.sprite.visible = true;
  b.sprite.visible = true;
  a.sprite.material.color.copy(c);
  b.sprite.material.color.copy(c).multiplyScalar(0.8);
}

function paintPulses() {
  for (let i = 0; i < pulsePairs.length; i += 1) paintPulsePair(i);
}

function paintRig() {
  const p = palette();
  const ink = new THREE.Color(p.ink);
  const metal = new THREE.Color(p.metal);
  metalMats.forEach((m) => m.color.copy(metal));
  inkMats.forEach((m) => m.color.copy(ink));
  pulseSprites.forEach(({ sprite }) => {
    sprite.material.blending = p.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    sprite.material.needsUpdate = true;
  });
  if (selectionRing) {
    const sel = selectedNode.value;
    selectionRing.material.color.copy(
      sel && props.colorMode ? nodeColor(sel, 1) : new THREE.Color(p.ink),
    );
  }
  nodeViews.forEach((view) => {
    view.sprite.material.blending = p.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    view.sprite.material.needsUpdate = true;
  });
  ambient.intensity = p.dark ? 0.9 : 1.4;
  keyLight.intensity = p.dark ? 2.4 : 2.1;
  rimLight.intensity = p.dark ? 1.5 : 0.9;
}

function onActiveChange() {
  rebuildPulsePool();
  // 焦点一换，把成对脉冲重新撒到相关连线上，响应更直接
  pulsePairs.forEach((p) => {
    p.edge = pickEdge();
    p.t = pulseRng();
  });
  paintEdges();
  paintNodes();
  paintPulses();
  dirty = true;
}

// ── 镜头 ────────────────────────────────────────────────────────────────

function overviewState() {
  return { target: [0, 0, 0], yaw: START_YAW, pitch: START_PITCH, dist: baseDist };
}

function tweenCamera(to, dur = 1500) {
  if (props.reduced) {
    camTarget.set(to.target[0], to.target[1], to.target[2]);
    camYaw = to.yaw ?? camYaw;
    camPitch = to.pitch ?? camPitch;
    camDist = to.dist ?? camDist;
    camTween = null;
    dirty = true;
    return;
  }
  camTween = {
    t0: performance.now(),
    dur,
    fromTarget: camTarget.clone(),
    toTarget: new THREE.Vector3(to.target[0], to.target[1], to.target[2]),
    fromYaw: camYaw,
    toYaw: to.yaw ?? camYaw,
    fromPitch: camPitch,
    toPitch: to.pitch ?? camPitch,
    fromDist: camDist,
    toDist: to.dist ?? camDist,
  };
  lastInteract = performance.now();
}

function easeInOut(k) {
  return k < 0.5 ? 4 * k * k * k : 1 - ((-2 * k + 2) ** 3) / 2;
}

function updateCamera(now, dt) {
  if (camTween) {
    const k = Math.min(1, (now - camTween.t0) / camTween.dur);
    const e = easeInOut(k);
    camTarget.lerpVectors(camTween.fromTarget, camTween.toTarget, e);
    camYaw = camTween.fromYaw + (camTween.toYaw - camTween.fromYaw) * e;
    camPitch = camTween.fromPitch + (camTween.toPitch - camTween.fromPitch) * e;
    camDist = camTween.fromDist + (camTween.toDist - camTween.fromDist) * e;
    if (k >= 1) camTween = null;
    dirty = true;
  } else if (auto.value && !selected.value && !drag && !hover.value && !pointerInside
    && now - lastInteract > 2400 && !props.reduced) {
    camYaw += dt * 0.075;
    dirty = true;
  }

  if (!drag && (Math.abs(velYaw) > 0.00008 || Math.abs(velPitch) > 0.00008)) {
    camYaw += velYaw;
    camPitch = Math.max(-0.75, Math.min(1.05, camPitch + velPitch));
    // 按时间衰减，不按帧：软件渲染 / 低帧率下惯性才不会拖很久
    const damp = 0.002 ** dt;
    velYaw *= damp;
    velPitch *= damp;
    dirty = true;
  }
}

function applyCamera() {
  if (!camera || !camTarget) return;
  const cp = Math.cos(camPitch);
  camera.position.set(
    camTarget.x + Math.sin(camYaw) * cp * camDist,
    camTarget.y + Math.sin(camPitch) * camDist,
    camTarget.z + Math.cos(camYaw) * cp * camDist,
  );
  camera.lookAt(camTarget);
  camera.updateMatrixWorld();
}

function selectNode(id) {
  selected.value = id;
  const node = id ? nodeById.value.get(id) : null;
  if (!node) {
    tweenCamera(overviewState(), props.reduced ? 0 : 1200);
  } else {
    tweenCamera({
      target: node.position,
      yaw: camYaw,
      pitch: Math.max(-0.35, Math.min(0.62, camPitch)),
      dist: node.kind === 'category' ? 2.7 : 1.9,
    }, props.reduced ? 0 : 1500);
  }
  lastInteract = performance.now();
  onActiveChange();
}

function clearHoverForButton() {
  if (!hover.value) return;
  hover.value = null;
  currentHover = '';
}

function nextDay() {
  const days = model.value.days;
  if (!days.length) return;
  clearHoverForButton();
  const isDay = selected.value?.startsWith('day:');
  const cur = isDay ? Number(selected.value.slice(4)) : days.length - 1;
  const next = isDay ? (cur + 1) % days.length : cur;
  selectNode(`day:${next}`);
}

function prevDay() {
  const days = model.value.days;
  if (!days.length) return;
  clearHoverForButton();
  const isDay = selected.value?.startsWith('day:');
  const cur = isDay ? Number(selected.value.slice(4)) : days.length - 1;
  const next = (cur - 1 + days.length) % days.length;
  selectNode(`day:${next}`);
}

async function openActiveDay() {
  const info = readoutInfo.value;
  if (!info || info.kind !== 'day' || info.missing) return;
  // 原生全屏下必须先退全屏，否则单日详情会被 top layer 盖住
  if (expanded.value) await exitExpanded();
  emit('select-day', info.day);
}

function resetView() {
  selected.value = null;
  hover.value = null;
  currentHover = '';
  tweenCamera(overviewState(), props.reduced ? 0 : 1200);
  lastInteract = performance.now();
  onActiveChange();
}

function stepZoom(dir) {
  camTween = null;
  zoomUntil = performance.now() + 200;
  camDist = Math.max(0.85, Math.min(9, camDist * (dir > 0 ? 0.86 : 1.16)));
  lastInteract = performance.now();
  dirty = true;
}

function toggleAuto() {
  if (props.reduced) return;
  auto.value = !auto.value;
  lastInteract = performance.now();
}

// ── 全屏 ────────────────────────────────────────────────────────────────

function lockScroll(on) {
  if (on) document.body.classList.add('no-scroll');
  else document.body.classList.remove('no-scroll');
}

async function toggleExpand() {
  if (expanded.value) {
    exitExpanded();
    return;
  }
  expanded.value = true;
  document.documentElement.classList.add('brain-expanded');
  lockScroll(true);
  await nextTick();
  resize();
  const el = hostRef.value;
  if (el?.requestFullscreen) {
    try {
      await el.requestFullscreen();
      nativeFs = !!document.fullscreenElement;
    } catch {
      nativeFs = false;
    }
  }
  resize();
  dirty = true;
}

function closeExpanded() {
  if (!expanded.value && !nativeFs) return;
  expanded.value = false;
  nativeFs = false;
  document.documentElement.classList.remove('brain-expanded');
  lockScroll(false);
  requestAnimationFrame(() => resize());
  dirty = true;
}

async function exitExpanded() {
  const wasNative = !!document.fullscreenElement;
  closeExpanded();
  if (wasNative) {
    try {
      await document.exitFullscreen();
    } catch {
      /* 已经退出 */
    }
  }
}

function exitNativeFs() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
}

function onFullscreenChange() {
  if (!document.fullscreenElement && expanded.value && nativeFs) {
    nativeFs = false;
    closeExpanded();
  }
}

function onWheel(e) {
  if (!expanded.value || !ready) return;
  e.preventDefault();
  stepZoom(e.deltaY < 0 ? 1 : -1);
}

// ── 循环 / 标签 ─────────────────────────────────────────────────────────

function startLoop() {
  if (!ready || loopOn || !active || !visible || document.hidden) return;
  loopOn = true;
  lastFrame = performance.now();
  raf = requestAnimationFrame(tick);
}

function stopLoop() {
  loopOn = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function tick(now) {
  raf = 0;
  if (!loopOn) return;
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;

  if (hoverDirty && !drag) evaluateHover();
  updateCamera(now, dt);
  applyCamera();

  const moving = !!drag || !!camTween
    || Math.abs(velYaw) > 0.0006 || Math.abs(velPitch) > 0.0006
    || now < zoomUntil;
  if (moving !== camMoving.value) camMoving.value = moving;

  if (!props.reduced) {
    if (gyroA) gyroA.rotation.y += dt * 0.045;
    if (gyroB) gyroB.rotation.y -= dt * 0.03;
    if (coreGroup) {
      coreGroup.rotation.y += dt * 0.2;
      coreGroup.rotation.x += dt * 0.05;
      coreGroup.children[1]?.scale.setScalar(1 + 0.16 * Math.sin(now / 430));
    }
    updatePulses(dt);
    dirty = true;
  }

  // 选中节点的呼吸 + 虚线选中环
  if (selectionRing) {
    const view = selected.value ? nodeViews.get(selected.value) : null;
    if (view) {
      selectionRing.visible = true;
      selectionRing.position.copy(view.sprite.position);
      // 圆环永远正对相机；半径用世界单位，放大时不会失真
      selectionRing.quaternion.copy(camera.quaternion);
      const beat = props.reduced ? 1 : 1 + 0.04 * Math.sin(now / 380);
      selectionRing.scale.setScalar((view.isCat ? 0.26 : 0.14) * beat);
      if (!props.reduced) {
        view.sprite.scale.setScalar(view.baseScale * (1.35 + 0.06 * Math.sin(now / 380)));
        view.core.scale.setScalar(view.baseCoreScale * (1.45 + 0.06 * Math.sin(now / 380)));
      }
    } else {
      selectionRing.visible = false;
    }
  }

  updateLabels();

  if (now - lastCamWrite > 120) {
    lastCamWrite = now;
    const camStr = [
      camTarget.x, camTarget.y, camTarget.z, camDist, camYaw, camPitch,
    ].map((v) => v.toFixed(2)).join(',');
    if (camStr !== lastCamAttr && hostRef.value) {
      lastCamAttr = camStr;
      hostRef.value.dataset.brainCam = camStr;
    }
  }

  if (dirty) {
    renderer.render(scene, camera);
    dirty = false;
  }
  if (loopOn) raf = requestAnimationFrame(tick);
}

function updateLabels() {
  const box = labelsRef.value;
  if (!box || !camera || !labelV.v) return;
  const w = hostRef.value?.clientWidth || 1;
  const h = hostRef.value?.clientHeight || 1;
  const active = activeNode.value;
  const activeId = active?.id || null;
  const selectedId = selected.value;
  const neighbors = activeId ? adjacency.get(activeId) : null;

  const items = [];
  for (const el of box.children) {
    const key = el.dataset.label;
    if (!key || key === 'day') continue;
    const node = nodeById.value.get(key);
    if (!node) continue;
    const p = labelV.v.set(...node.position).project(camera);
    const onScreen = p.z < 1 && p.z > -1;
    el.style.left = `${(p.x * 0.5 + 0.5) * w}px`;
    el.style.top = `${(-p.y * 0.5 + 0.5) * h}px`;
    // 固定偏移：不再按“从中心向外”的方向推，镜头一转标签就不会绕圈
    el.style.transform = 'translate(10px, -50%)';
    el.style.visibility = onScreen ? 'visible' : 'hidden';

    let opacity = 0.8;
    if (key === selectedId) opacity = 1;
    else if (activeId) {
      opacity = key === activeId ? 1 : neighbors?.has(key) ? 0.85 : 0.4;
    }
    el.style.opacity = String(opacity);

    let size = labelSizes.get(key);
    if (!size || !size.w) {
      size = { w: el.offsetWidth || 0, h: el.offsetHeight || 0 };
      if (size.w) labelSizes.set(key, size);
    }
    items.push({
      el,
      x: (p.x * 0.5 + 0.5) * w,
      y: (-p.y * 0.5 + 0.5) * h,
      w: size.w,
      h: size.h,
      onScreen,
      isActive: key === activeId,
      isSelected: key === selectedId,
      hours: node.value || 0,
    });
  }

  // 投影重叠时只保留一个（时长更大的），**不移动**另一个 ——
  // 之前把标签上下推开，镜头一动就会满屏跳。
  items.sort((a, b) => (
    (b.isSelected ? 2 : 0) + (b.isActive ? 1 : 0)
    - ((a.isSelected ? 2 : 0) + (a.isActive ? 1 : 0))
    || b.hours - a.hours
  ));
  const kept = [];
  for (const it of items) {
    if (!it.onScreen) continue;
    const left = it.x + 10;
    const top = it.y - it.h / 2;
    const clash = kept.some((p) => (
      left < p.x + 10 + p.w + 4
      && left + it.w + 4 > p.x + 10
      && top < p.y - p.h / 2 + p.h + 2
      && top + it.h + 2 > p.y - p.h / 2
    ));
    if (clash && !it.isActive && !it.isSelected) {
      it.el.style.opacity = '0';
    } else {
      kept.push(it);
    }
  }

  const readoutDay = selectedNode.value?.kind === 'day'
    ? selectedNode.value
    : (hoverNode.value?.kind === 'day' ? hoverNode.value : null);
  const dayEl = box.querySelector('[data-label="day"]');
  if (dayEl && readoutDay) {
    const p = labelV.v.set(...readoutDay.position).project(camera);
    dayEl.style.left = `${(p.x * 0.5 + 0.5) * w}px`;
    dayEl.style.top = `${(-p.y * 0.5 + 0.5) * h}px`;
    // 选中时把标签抬到矢量选中环的上方；环的屏幕半径跟相机距离走
    const ringPx = (0.14 / (2 * camDist * Math.tan((FOV * Math.PI) / 360))) * h;
    const lift = selected.value === readoutDay.id ? Math.max(30, ringPx + 16) : 30;
    dayEl.style.transform = `translate(-50%, calc(-50% - ${lift.toFixed(1)}px))`;
    dayEl.style.visibility = p.z < 1 ? 'visible' : 'hidden';
    dayEl.style.opacity = '1';
  }
}

// ── 交互 ────────────────────────────────────────────────────────────────

const pointerLocal = { x: 0, y: 0 };

function positionTooltip() {
  const el = tooltipRef.value;
  if (!el) return;
  const hostW = hostRef.value?.clientWidth || 0;
  const hostH = hostRef.value?.clientHeight || 0;
  const w = el.offsetWidth || 120;
  const h = el.offsetHeight || 24;
  let x = pointerLocal.x + 18;
  let y = pointerLocal.y + 18;
  if (x + w > hostW - 8) x = pointerLocal.x - w - 18;
  if (y + h > hostH - 8) y = pointerLocal.y - h - 18;
  el.style.left = `${Math.max(8, x)}px`;
  el.style.top = `${Math.max(8, y)}px`;
}

function updatePointerUI(e) {
  const rect = canvasRef.value?.getBoundingClientRect();
  if (!rect) return;
  pointerLocal.x = e.clientX - rect.left;
  pointerLocal.y = e.clientY - rect.top;
  if (pointerRef.value) {
    pointerRef.value.style.left = `${pointerLocal.x}px`;
    pointerRef.value.style.top = `${pointerLocal.y}px`;
  }
  positionTooltip();
}

function hitTest(clientX, clientY) {
  if (!ready || !canvasRef.value) return null;
  const rect = canvasRef.value.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return null;
  }
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.obj.setFromCamera(ndc, camera);
  scene.updateMatrixWorld(true);
  const proxies = [...nodeViews.values()].map((v) => v.proxy);
  const hits = raycaster.obj.intersectObjects(proxies, false);
  if (!hits.length) return null;
  return hits[0].object.userData.nodeId || null;
}

function evaluateHover() {
  hoverDirty = false;
  if (!ready || pointerX == null) return;
  const id = hitTest(pointerX, pointerY);
  if (canvasRef.value) setBlockCursorHot(canvasRef.value, !!id);
  const key = id || '';
  if (key === currentHover) return;
  currentHover = key;
  hover.value = id;
  onActiveChange();
  nextTick(positionTooltip);
}

function clearHover() {
  if (canvasRef.value) setBlockCursorHot(canvasRef.value, false);
  if (!hover.value && !currentHover) return;
  hover.value = null;
  currentHover = '';
  onActiveChange();
}

function onPointerDown(e) {
  if (!ready || (e.button != null && e.button > 0)) return;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
  velYaw = 0;
  velPitch = 0;
  camTween = null; // 用户开始拖拽就接管镜头
  pointerX = e.clientX;
  pointerY = e.clientY;
  updatePointerUI(e);
  lastInteract = performance.now();
  try {
    canvasRef.value.setPointerCapture(e.pointerId);
  } catch {
    /* 合成事件可能没有 capture */
  }
  grabbing.value = true;
}

function onPointerMove(e) {
  if (drag && drag.id === e.pointerId) {
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    camYaw -= dx * 0.006;
    camPitch = Math.max(-0.75, Math.min(1.05, camPitch + dy * 0.004));
    velYaw = -dx * 0.006 * 0.72;
    velPitch = dy * 0.004 * 0.72;
    updatePointerUI(e);
    lastInteract = performance.now();
    dirty = true;
    return;
  }
  pointerX = e.clientX;
  pointerY = e.clientY;
  updatePointerUI(e);
  hoverDirty = true;
  lastInteract = performance.now();
}

function onPointerUp(e) {
  if (!drag || drag.id !== e.pointerId) return;
  const wasClick = drag.moved < 8;
  drag = null;
  grabbing.value = false;
  try {
    canvasRef.value.releasePointerCapture(e.pointerId);
  } catch {
    /* 已释放 */
  }
  lastInteract = performance.now();
  if (wasClick) {
    selectNode(hitTest(e.clientX, e.clientY));
  }
}

function onPointerCancel() {
  drag = null;
  grabbing.value = false;
  pointerX = null;
  pointerY = null;
  clearHover();
}

function onPointerLeave() {
  pointerInside = false;
  pointerVisible.value = false;
  document.documentElement.classList.remove('brain-pointer');
  if (drag) return;
  pointerX = null;
  pointerY = null;
  clearHover();
}

function onPointerEnter(e) {
  pointerInside = true;
  pointerVisible.value = true;
  document.documentElement.classList.add('brain-pointer');
  lastInteract = performance.now();
  updatePointerUI(e);
}

async function onDblClick(e) {
  const id = hitTest(e.clientX, e.clientY);
  if (!id || !id.startsWith('day:')) return;
  const index = Number(id.slice(4));
  const day = model.value.days[index];
  if (day && !day.missing) {
    if (expanded.value) await exitExpanded();
    emit('select-day', day.day);
  }
}

function onKeyDown(e) {
  if (e.target !== hostRef.value) return;
  const step = 0.12;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    camYaw += e.key === 'ArrowLeft' ? -step : step;
    lastInteract = performance.now();
    dirty = true;
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    camPitch = Math.max(-0.75, Math.min(1.05, camPitch + (e.key === 'ArrowUp' ? -0.07 : 0.07)));
    lastInteract = performance.now();
    dirty = true;
  } else if (e.key === 'Enter') {
    const info = readoutInfo.value;
    if (info?.kind === 'day' && !info.missing) {
      e.preventDefault();
      openActiveDay();
    } else if (info?.kind === 'category') {
      e.preventDefault();
      nextDay();
    }
  } else if (e.key === 'Escape') {
    if (expanded.value) {
      e.preventDefault();
      exitExpanded();
    } else if (selected.value) {
      e.preventDefault();
      resetView();
    }
  }
}

function focusCategory(name) {
  if (!ready) return;
  clearHoverForButton();
  selectNode(`cat:${name}`);
}

function previewCategory(name) {
  if (!ready) return;
  hover.value = `cat:${name}`;
  currentHover = hover.value;
  onActiveChange();
}

function blurCategory() {
  if (hover.value?.startsWith('cat:')) clearHover();
}

function onVisibility() {
  if (document.hidden) stopLoop();
  else startLoop();
}

// ── 生命周期 ────────────────────────────────────────────────────────────

function init() {
  if (status.value === 'loading' || status.value === 'ready') return;
  if (!props.rows?.length) {
    status.value = 'empty';
    return;
  }
  status.value = 'loading';
  import('three').then((mod) => {
    THREE = mod;
    setupRenderer();
  }).catch(() => {
    status.value = 'error';
  });
}

function setupRenderer() {
  if (!canvasRef.value || !hostRef.value) return;
  const probe = document.createElement('canvas');
  let gl = null;
  try {
    gl = probe.getContext('webgl2') || probe.getContext('webgl');
  } catch {
    gl = null;
  }
  if (!gl) {
    status.value = 'unsupported';
    return;
  }
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.value,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
  } catch {
    status.value = 'unsupported';
    return;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 100);
  camTarget = new THREE.Vector3(0, 0, 0);
  labelV.v = new THREE.Vector3();
  raycaster.obj = new THREE.Raycaster();
  glowTex = makeGlowTexture();

  ambient = new THREE.AmbientLight(0xffffff, 1.2);
  keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
  keyLight.position.set(2.6, 3.4, 4.2);
  rimLight = new THREE.DirectionalLight(0xffffff, 1);
  rimLight.position.set(-3.2, -1.4, -2.6);
  scene.add(ambient, keyLight, rimLight);

  try {
    ready = true;
    buildScene();
    status.value = 'ready';
    resize();
    applyCamera();
    startLoop();
  } catch {
    ready = false;
    status.value = 'error';
    return;
  }

  canvasRef.value.addEventListener('webglcontextlost', onContextLost, false);
}

function onContextLost(e) {
  e.preventDefault();
  ready = false;
  stopLoop();
  status.value = 'error';
}

function resize() {
  if (!renderer || !hostRef.value || !camera) return;
  const w = hostRef.value.clientWidth;
  const h = hostRef.value.clientHeight;
  if (!w || !h) return;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const tan = Math.tan((FOV * Math.PI) / 360);
  // 宽屏按外框（日期环）取景；竖屏按图本身取景，否则为了装下外框会把图缩得很小
  const fitR = camera.aspect < 1.05 ? 1.8 : 2.35;
  baseDist = Math.max(BASE_Z, fitR / (tan * camera.aspect));
  if (!selected.value && !camTween) camDist = baseDist;
  applyCamera();
  dirty = true;
}

function rowsSignature(rows) {
  return rows.map((r) => {
    if (r.missing || !r.payload) return `${r.day}:x`;
    const cats = r.payload.categories || {};
    const total = Object.values(cats).reduce((a, b) => a + (Number(b) || 0), 0);
    return `${r.day}:${r.payload.trackedHours ?? '-'}:${total.toFixed(2)}`;
  }).join('|');
}

function observe() {
  if (typeof IntersectionObserver === 'undefined') {
    visible = true;
    init();
    return;
  }
  io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) {
      if (props.rows?.length) init();
      startLoop();
    } else {
      stopLoop();
    }
  }, { rootMargin: '320px 0px' });
  io.observe(hostRef.value);
}

function rebuild() {
  if (!ready || !graphGroup) return;
  const keepId = selected.value;
  const keepDist = camDist;
  const old = assembly;
  scene.remove(old);
  old.traverse((obj) => {
    obj.geometry?.dispose?.();
    if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
    else obj.material?.dispose?.();
  });
  metalMats.length = 0;
  inkMats.length = 0;
  nodeViews.clear();
  labelSizes.clear();
  edgeData = [];
  pulseSprites = [];
  selectionRing = null;
  assembly = null;
  graphGroup = null;
  rigGroup = null;
  coreGroup = null;
  selected.value = null;
  hover.value = null;
  currentHover = '';
  camTarget.set(0, 0, 0);
  buildScene();

  // 实时数据重建时不要把用户正在看的节点 / 镜头丢掉
  if (keepId && nodeById.value.has(keepId)) {
    const node = nodeById.value.get(keepId);
    selected.value = keepId;
    camTarget.set(node.position[0], node.position[1], node.position[2]);
    camDist = Math.min(Math.max(keepDist, 0.85), 9);
    applyCamera();
    onActiveChange();
  } else {
    camDist = baseDist;
  }
  dirty = true;
}

onMounted(() => {
  active = true;
  if (hostRef.value) {
    ro = new ResizeObserver(() => {
      if (ready) resize();
    });
    ro.observe(hostRef.value);
    hostRef.value.addEventListener('keydown', onKeyDown);
  }
  hostRef.value?.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('fullscreenchange', onFullscreenChange);

  signature = rowsSignature(props.rows);
  observe();
  if (!props.rows?.length) status.value = 'empty';
});

watch(isDark, () => {
  if (ready) paintAll();
});

watch(expanded, () => {
  labelSizes.clear();
});

watch(camMoving, (moving) => {
  if (!moving) nextTick(positionTooltip);
});

watch(() => props.colorMode, () => {
  if (ready) paintAll();
});

watch(() => props.rows, (rows) => {
  const next = rowsSignature(rows);
  if (!rows.length) {
    status.value = 'empty';
    return;
  }
  if (next === signature) return;
  signature = next;
  if (!ready) {
    if (visible || !io) init();
    return;
  }
  rebuild();
});

onActivated(() => {
  active = true;
  startLoop();
});

onDeactivated(() => {
  active = false;
  stopLoop();
  document.documentElement.classList.remove('brain-pointer');
  pointerVisible.value = false;
  if (canvasRef.value) setBlockCursorHot(canvasRef.value, false);
  closeExpanded();
  exitNativeFs();
  clearHover();
});

onBeforeUnmount(() => {
  active = false;
  stopLoop();
  document.documentElement.classList.remove('brain-pointer');
  closeExpanded();
  exitNativeFs();
  if (io) io.disconnect();
  if (ro) ro.disconnect();
  hostRef.value?.removeEventListener('wheel', onWheel);
  document.removeEventListener('visibilitychange', onVisibility);
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  hostRef.value?.removeEventListener('keydown', onKeyDown);
  canvasRef.value?.removeEventListener('webglcontextlost', onContextLost);
  if (renderer) {
    scene?.traverse((obj) => {
      obj.geometry?.dispose?.();
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material?.dispose?.();
    });
    glowTex?.dispose?.();
    renderer.dispose();
    renderer = null;
  }
});
</script>

<template>
  <div
    ref="hostRef"
    class="life-brain"
    :class="{
      'is-ready': status === 'ready',
      'is-grabbing': grabbing,
      'is-expanded': expanded,
      'is-cam-moving': camMoving,
      'is-pointer': pointerVisible,
    }"
    :style="{ '--life-day-color': colorMode
      ? (isDark ? DAY_COLOR.dark : DAY_COLOR.light)
      : 'var(--text-primary)' }"
    tabindex="0"
    role="group"
    aria-label="Interactive 3D life graph. Eight category hubs and one node per day. Click a node to fly the camera in, click another node to move between them, drag to orbit, arrow keys to rotate, Enter to open a focused day."
    :data-brain-status="status"
    :data-brain-hover="hoverAttr"
    :data-brain-selected="selectedAttr"
    :data-brain-auto="auto ? '1' : '0'"
    :data-brain-color="colorMode ? '1' : '0'"
    :data-brain-full="expanded ? '1' : '0'"
    :data-brain-days="model.days.length"
    :data-brain-nodes="counts.nodes"
    :data-brain-edges="counts.edges"
    data-brain-cam="0.00,0.00,0.00,5.35,0.30,0.18"
  >
    <canvas
      ref="canvasRef"
      class="life-brain-canvas"
      aria-hidden="true"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @pointerleave="onPointerLeave"
      @pointerenter="onPointerEnter"
      @dblclick="onDblClick"
    ></canvas>

    <div
      ref="pointerRef"
      class="life-brain-pointer"
      :class="{ 'is-on': !!hoverNode }"
      aria-hidden="true"
    ><i></i></div>

    <div
      v-show="cursorInfo && !camMoving"
      ref="tooltipRef"
      class="life-brain-cursor-tip"
      aria-hidden="true"
    >
      <i v-if="cursorInfo?.kind === 'day'" class="life-brain-tip-dot" aria-hidden="true"></i>
      <b>{{ cursorInfo?.kind === 'category' ? cursorInfo.name.toUpperCase() : cursorInfo?.label }}</b>
      <span>{{
        cursorInfo?.kind === 'category'
          ? `${cursorInfo.hours.toFixed(1)}h`
          : (cursorInfo?.missing ? 'NO DATA' : `${cursorInfo?.trackedHours?.toFixed(1)}h`)
      }}</span>
    </div>

    <div class="life-brain-top" aria-hidden="true">
      <span class="life-brain-kicker life-brain-title">NEURAL CORE</span>
      <span class="life-brain-meta life-brain-meta--wide">
        {{ counts.nodes }} NODES · {{ counts.edges }} LINKS · {{ model.days.length }}D
      </span>
      <span class="life-brain-meta life-brain-meta--narrow">
        {{ summary.totalHours.toFixed(1) }}H · {{ summary.daysWithData }}/{{ summary.days }}D
      </span>
    </div>

    <div class="life-brain-actions">
      <button
        type="button"
        class="life-brain-btn"
        :aria-pressed="auto"
        :disabled="reduced"
        :title="reduced ? 'Disabled by preferred-reduced-motion' : (auto ? 'Pause auto-orbit' : 'Resume auto-orbit')"
        @click="toggleAuto"
      >{{ auto ? 'AUTO' : 'MANUAL' }}</button>
      <button type="button" class="life-brain-btn" title="Select the next day" @click="nextDay">DAY ›</button>
      <button type="button" class="life-brain-btn" title="Reset the camera" @click="resetView">RESET</button>
      <template v-if="expanded">
        <button type="button" class="life-brain-btn life-brain-btn--icon" title="Zoom in" @click="stepZoom(1)">+</button>
        <button type="button" class="life-brain-btn life-brain-btn--icon" title="Zoom out" @click="stepZoom(-1)">−</button>
      </template>
      <button
        type="button"
        class="life-brain-btn"
        :aria-pressed="expanded"
        :title="expanded ? 'Exit fullscreen' : 'Fullscreen'"
        @click="toggleExpand"
      >{{ expanded ? 'EXIT' : 'FULL' }}</button>
    </div>

    <div ref="labelsRef" class="life-brain-labels" aria-hidden="true">
      <span
        v-for="c in model.categories"
        :key="c.name"
        class="life-brain-label"
        :data-label="`cat:${c.name}`"
        :class="{
          'is-active': activeInfo?.kind === 'category' && activeInfo.name === c.name,
          'is-selected': selectedInfo?.kind === 'category' && selectedInfo.name === c.name,
        }"
      >{{ c.name.toUpperCase() }}<i>{{ c.hours.toFixed(1) }}h</i></span>
      <span
        v-if="readoutInfo?.kind === 'day'"
        class="life-brain-label is-day"
        :class="{ 'is-selected': selectedInfo?.kind === 'day' }"
        data-label="day"
      >
        <i class="life-brain-day-dot" aria-hidden="true"></i>
        {{ readoutInfo.label }}<i>{{ readoutInfo.missing ? 'NO DATA' : `${readoutInfo.trackedHours.toFixed(1)}h` }}</i>
      </span>
    </div>

    <div class="life-brain-readout" :class="{ 'is-idle': !readoutInfo }" aria-live="polite">
      <template v-if="readoutInfo?.kind === 'category'">
        <span class="life-brain-kicker">
          {{ readoutMode ? readoutMode + ' · ' : '' }}REGION {{ String(readoutInfo.index + 1).padStart(2, '0') }} · {{ readoutInfo.name.toUpperCase() }}
        </span>
        <strong class="life-brain-value">
          {{ readoutInfo.hours.toFixed(1) }}<em>h</em>
        </strong>
        <span class="life-brain-note">
          {{ Math.round(readoutInfo.share * 100) }}% of tracked time · {{ readoutInfo.activeDays }} {{ readoutInfo.activeDays === 1 ? 'day' : 'days' }} active
        </span>
        <span class="life-brain-action">CLICK ANOTHER HUB TO FLY ACROSS</span>
      </template>

      <template v-else-if="readoutInfo?.kind === 'day'">
        <span class="life-brain-kicker">
          {{ readoutMode ? readoutMode + ' · ' : '' }}{{ fullDay(readoutInfo.day) }}
        </span>
        <template v-if="readoutInfo.missing">
          <strong class="life-brain-value is-empty">—</strong>
          <span class="life-brain-note">No data published for this day.</span>
        </template>
        <template v-else>
          <strong class="life-brain-value">
            {{ readoutInfo.trackedHours.toFixed(1) }}<em>h</em>
          </strong>
          <span class="life-brain-note">
            <template v-if="readoutInfo.dominant">
              dominant · {{ readoutInfo.dominant.toUpperCase() }} {{ readoutInfo.dominantHours.toFixed(1) }}h
            </template>
            <template v-else>no desktop categories</template>
          </span>
          <div class="life-brain-day-actions">
            <button type="button" class="life-brain-open-day" @click="openActiveDay">OPEN DAY →</button>
            <button type="button" class="life-brain-step" title="Previous day" @click="prevDay">‹</button>
            <button type="button" class="life-brain-step" title="Next day" @click="nextDay">›</button>
          </div>
        </template>
      </template>

      <template v-else>
        <span class="life-brain-kicker">{{ summary.daysWithData }}/{{ summary.days }} DAYS IN THE GRAPH</span>
        <strong class="life-brain-value">
          {{ summary.totalHours.toFixed(1) }}<em>h</em>
        </strong>
        <span class="life-brain-note">
          tracked across {{ summary.active }} active {{ summary.active === 1 ? 'region' : 'regions' }}
        </span>
        <span class="life-brain-action">CLICK A NODE TO FLY IN · DRAG TO ORBIT</span>
      </template>
    </div>

    <div class="life-brain-legend">
      <button
        v-for="c in model.categories"
        :key="c.name"
        type="button"
        class="life-brain-chip"
        :class="{
          'is-active': activeInfo?.kind === 'category' && activeInfo.name === c.name,
          'is-selected': selectedInfo?.kind === 'category' && selectedInfo.name === c.name,
          'is-empty': c.hours <= 0,
        }"
        @pointerenter="previewCategory(c.name)"
        @pointerleave="blurCategory"
        @focus="previewCategory(c.name)"
        @blur="blurCategory"
        @click="focusCategory(c.name)"
      >
        <i
          class="life-brain-chip-dot"
          :style="colorMode ? { background: c.color } : null"
          aria-hidden="true"
        ></i>
        <span>{{ c.name.toUpperCase() }}</span>
        <b>{{ c.hours.toFixed(1) }}h</b>
      </button>
      <span class="life-brain-day-key" title="Diamond nodes are days; they use the time colour">
        <i class="life-brain-day-key-dot" aria-hidden="true"></i>
        <span>DAYS</span>
        <b>{{ model.days.length }}</b>
      </span>
    </div>

    <p class="life-brain-hint" aria-hidden="true">
      {{ expanded
        ? 'CLICK A NODE TO PUSH IN · WHEEL / + − TO ZOOM · ESC TO EXIT'
        : 'CLICK A NODE TO PUSH IN · CLICK ANOTHER TO SWITCH · FULL TO ZOOM' }}
    </p>

    <div v-if="status === 'idle' || status === 'loading'" class="life-brain-poster">
      <span>WIRING NEURAL CORE…</span>
    </div>
    <div v-else-if="status === 'unsupported' || status === 'error'" class="life-brain-poster is-note">
      <b>3D VIEW UNAVAILABLE</b>
      <span>This browser did not provide a WebGL context. The daily charts below carry the same data.</span>
    </div>
    <div v-else-if="status === 'empty'" class="life-brain-poster is-note">
      <b>NO DAYS IN THE GRAPH</b>
      <span>The core lights up once the nightly pipeline publishes a day.</span>
    </div>
  </div>
</template>
