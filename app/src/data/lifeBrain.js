// 3D「规则神经元」的纯数据层。
//
// 这里**不 import three**：骨架、节点、连线都只是数组，组件负责把它们喂给
// BufferGeometry；验收脚本也能直接在 Node 里调用这些函数做结构断言。
//
// 两种形态共用同一套数据映射（全部来自 /api/life 已公开的日聚合，不碰 raw 坐标/日记）：
//   · 8 个分类 = 8 条主树突，分类节点长在主干的分叉点（hub）上
//   · 每天一颗节点，按序号挂在所属分类的末梢（twig）上
//   · 每条主树突固定分出 5 条等角末梢，这个分叉不随数据变
//   · 日期节点用自己的时间色（DAY_COLOR），不跟随分类色
// 形态是确定性计算的（固定 seed 只用于节点微抖），每次刷新形状一致，截图可逐帧比对。

// 8 个分类的顺序必须与 LifeView.vue 的 CATEGORY_ORDER / main.css 的 .is-color
// 保持一致：数组下标就是 cat-N 的 N。
// 日期节点是“时间”这一类公共节点，颜色必须独立于 8 个分类：
// 暗色主题用暖金，亮色主题用深铜金（亮底上要有对比）。分类节点仍然用各自的色。
export const DAY_COLOR = {
  dark: '#E8C15A',
  light: '#A47C1E',
};

export const BRAIN_COLOR = {
  Work: '#3B82F6',
  Study: '#8B5CF6',
  Life: '#10B981',
  Transport: '#F59E0B',
  Leisure: '#EF4444',
  Health: '#14B8A6',
  Social: '#EC4899',
  Other: '#9CA3AF',
};

// 8 个分类的顺序必须与 LifeView.vue 的 CATEGORY_ORDER / main.css 的 .is-color
// 保持一致：数组下标就是 cat-N 的 N。
export const BRAIN_CATEGORY_ORDER = [
  'Work', 'Study', 'Life', 'Transport', 'Leisure', 'Health', 'Social', 'Other',
];

// 两种可切换的神经元形态：
//   radial    放射状 —— 8 条主干等角分布，像海胆 / 星形神经元
//   pyramidal 锥体   —— 4 条顶树突 + 4 条基树突 + 垂直轴突，教科书形状
export const NEURON_MORPHS = ['radial', 'pyramidal'];

const TAU = Math.PI * 2;

// 固定 seed 的 PRNG（mulberry32）。不要换成 Math.random：
// 形状会每次刷新都变，验收截图和逐格比对就失去意义。
export function createRng(seed = 20261018) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function unit([x, y, z]) {
  const n = Math.hypot(x, y, z) || 1;
  return [x / n, y / n, z / n];
}

function addScaled(a, b, s) {
  return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
}

function mixPoint(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// 给一个方向配正交切向量，用来把末梢均匀摊在主干周围
function tangentBasis(n) {
  const helper = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const t1 = unit([
    n[1] * helper[2] - n[2] * helper[1],
    n[2] * helper[0] - n[0] * helper[2],
    n[0] * helper[1] - n[1] * helper[0],
  ]);
  const t2 = [
    n[1] * t1[2] - n[2] * t1[1],
    n[2] * t1[0] - n[0] * t1[2],
    n[0] * t1[1] - n[1] * t1[0],
  ];
  return [t1, t2];
}

/**
 * 从 hub 出发的 count 条末梢，等角均匀张开，每条都是三段折线。
 * 这是“规则”的来源：枝条数量、角度、长度都不随数据变。
 */
export function buildTwigs(hub, dir, { count = 5, length = 0.54 } = {}) {
  const d = unit(dir);
  const [t1, t2] = tangentBasis(d);
  const twigs = [];
  for (let j = 0; j < count; j += 1) {
    const th = (j / count) * TAU + 0.35;
    const spread = addScaled(addScaled(d, t1, Math.cos(th) * 0.52), t2, Math.sin(th) * 0.52);
    const dt = unit(spread);
    twigs.push([
      hub.slice(),
      addScaled(hub, dt, length * 0.46),
      addScaled(hub, dt, length),
    ]);
  }
  return twigs;
}

const SOMA = {
  radial: [0, 0, 0],
  pyramidal: [0, -0.12, 0],
};

// 放射状：8 条主干每 45° 一条，高低交替，分类节点在主干末端。
function radialAnchors() {
  return BRAIN_CATEGORY_ORDER.map((cat, i) => {
    const az = i * (TAU / 8) + Math.PI / 8;
    const el = i % 2 === 0 ? 0.30 : -0.26;
    const d = unit([
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az),
    ]);
    const hub = d.map((v) => v * 0.84);
    return {
      cat,
      side: hub[0] >= 0 ? 1 : -1,
      role: 'radial',
      p: hub,
      trunk: [d.map((v) => v * 0.16), d.map((v) => v * 0.50), hub],
      twigs: buildTwigs(hub, d, { count: 5, length: 0.62 }),
    };
  });
}

// 锥体：顶树突从主干分叉成冠（4 条），基树突向下摊开（4 条）。
// 坐标写死而不是算出来 —— 这样镜头取景、标签位置在数据变化时保持稳定。
function pyramidalAnchors() {
  const defs = [
    { cat: 'Work', hub: [-0.52, 0.74, 0.16], dir: [-0.62, 0.62, 0.30] },
    { cat: 'Study', hub: [0.52, 0.74, 0.16], dir: [0.62, 0.62, 0.30] },
    { cat: 'Life', hub: [-0.30, 0.92, -0.30], dir: [-0.30, 0.68, -0.60] },
    { cat: 'Transport', hub: [0.30, 0.92, -0.30], dir: [0.30, 0.68, -0.60] },
    { cat: 'Leisure', hub: [-0.66, -0.40, 0.22], dir: [-0.86, -0.32, 0.28] },
    { cat: 'Health', hub: [0.66, -0.40, 0.22], dir: [0.86, -0.32, 0.28] },
    { cat: 'Social', hub: [-0.50, -0.56, -0.30], dir: [-0.62, -0.48, -0.52] },
    { cat: 'Other', hub: [0.50, -0.56, -0.30], dir: [0.62, -0.48, -0.52] },
  ];
  const topKnot = [0, 0.36, 0];
  const bottomKnot = [0, -0.24, 0];
  return defs.map((def, i) => {
    const apical = i < 4;
    const start = (apical ? topKnot : bottomKnot).slice();
    const hub = def.hub.slice();
    const mid = mixPoint(start, hub, 0.55);
    mid[1] += apical ? 0.06 : -0.05;
    return {
      cat: def.cat,
      side: hub[0] >= 0 ? 1 : -1,
      role: apical ? 'apical' : 'basal',
      p: hub,
      trunk: [start, mid, hub],
      twigs: buildTwigs(hub, def.dir, { count: 5, length: 0.55 }),
    };
  });
}

/**
 * 规则神经元骨架：胞体 + 8 条主树突（含末梢）+ 轴突。
 * 组件用它画线框 / 树突小刺 / 髓鞘，数据层用它给日期节点定位。
 * @param {'radial'|'pyramidal'} morph
 */
export function buildNeuronScaffold(morph = 'radial') {
  const mode = NEURON_MORPHS.includes(morph) ? morph : 'radial';
  const soma = SOMA[mode].slice();
  const anchors = mode === 'radial' ? radialAnchors() : pyramidalAnchors();
  const branches = [];

  if (mode === 'pyramidal') {
    // 顶树突的主干：胞体 → 分叉点
    branches.push({ role: 'trunk', cat: null, points: [soma.slice(), [0, 0.36, 0]] });
  }
  anchors.forEach((a) => {
    branches.push({ role: 'trunk', cat: a.cat, points: a.trunk });
    a.twigs.forEach((points) => branches.push({ role: 'twig', cat: a.cat, points }));
  });

  const axon = mode === 'pyramidal'
    // 轴突垂直穿过日期环，末端再分两支
    ? [[0, -0.26, 0], [0, -0.66, 0], [0, -1.06, 0.02], [0, -1.38, 0]]
    : [[0, -0.14, 0], [0, -0.52, 0], [0, -0.92, 0]];

  if (mode === 'pyramidal') {
    const tip = axon[axon.length - 1];
    branches.push({ role: 'axon', cat: null, points: [tip.slice(), [-0.16, -1.55, 0.02]] });
    branches.push({ role: 'axon', cat: null, points: [tip.slice(), [0.16, -1.55, 0.02]] });
  }

  return { morph: mode, soma, anchors, branches, axon };
}

/**
 * 把 LifeView 的 rows（含 day / payload / missing）折成大脑要用的聚合。
 * 无数据时也返回完整结构，只是所有 weight = 0。
 */
export function buildBrainModel(rows = []) {
  const totals = Object.fromEntries(BRAIN_CATEGORY_ORDER.map((c) => [c, 0]));
  const activeDays = Object.fromEntries(BRAIN_CATEGORY_ORDER.map((c) => [c, 0]));
  const days = [];

  for (const row of rows.slice(-30)) {
    const p = row?.payload || null;
    // 新 payload 带 dimensions（桌面 + 手表 + GPS + 手机的七维）；
    // 旧 payload 退回桌面 categories，保证历史数据仍能画。
    const dims = p?.dimensions || p?.categories;
    const categories = {};
    let sum = 0;

    for (const cat of BRAIN_CATEGORY_ORDER) {
      const v = Number(dims?.[cat]);
      const hours = Number.isFinite(v) && v > 0 ? v : 0;
      categories[cat] = hours;
      sum += hours;
      totals[cat] += hours;
      if (hours > 0.05) activeDays[cat] += 1;
    }

    const tracked = Number(p?.trackedHours);
    const trackedHours = row?.missing || !p
      ? 0
      : (p?.dimensions
        ? sum
        : (Number.isFinite(tracked) && tracked > 0 ? tracked : sum));

    let dominant = null;
    let best = 0;
    for (const cat of BRAIN_CATEGORY_ORDER) {
      if (categories[cat] > best) {
        best = categories[cat];
        dominant = cat;
      }
    }

    days.push({
      day: row?.day || '',
      missing: !!(row?.missing || !p),
      trackedHours,
      total: sum,
      categories,
      dominant,
      steps: Number.isFinite(p?.health?.steps) ? p.health.steps : null,
      unlocks: Number.isFinite(p?.phone?.unlocks) ? p.phone.unlocks : null,
    });
  }

  const totalHours = BRAIN_CATEGORY_ORDER.reduce((a, cat) => a + totals[cat], 0);
  const categories = BRAIN_CATEGORY_ORDER.map((name) => {
    const hours = totals[name];
    return {
      name,
      color: BRAIN_COLOR[name],
      hours,
      share: totalHours ? hours / totalHours : 0,
      activeDays: activeDays[name],
    };
  });
  const maxShare = Math.max(...categories.map((c) => c.share), 0);
  categories.forEach((c) => {
    c.weight = maxShare ? c.share / maxShare : 0;
  });

  return {
    categories,
    days,
    totalHours,
    maxShare,
    daysWithData: days.filter((d) => !d.missing).length,
  };
}

/** 图上那颗日期节点显示的短日期。 */
export function shortDate(day) {
  if (!day) return '—';
  const [, m, d] = day.split('-').map(Number);
  if (!m || !d) return day;
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]}`;
}

// 折线上按弧长比例取点：日期节点就是沿末梢均匀挂上去的。
function polylinePoint(points, t) {
  const cumulative = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += Math.hypot(
      points[i + 1][0] - points[i][0],
      points[i + 1][1] - points[i][1],
      points[i + 1][2] - points[i][2],
    );
    cumulative.push(total);
  }
  if (!total) return points[0].slice();
  const target = Math.max(0, Math.min(1, t)) * total;
  let seg = 0;
  while (seg < cumulative.length - 1 && cumulative[seg] < target) seg += 1;
  const before = seg === 0 ? 0 : cumulative[seg - 1];
  const span = cumulative[seg] - before || 1;
  const f = Math.max(0, Math.min(1, (target - before) / span));
  return mixPoint(points[seg], points[seg + 1], f);
}

/**
 * 规则神经元图：8 条主树突的 hub + 每天一个节点。
 *
 * 三种连线：
 *   flow     当天 → 时长最多的两个分类（每天最多 2 条）
 *   link     分类 ↔ 分类（按同一天共同出现的次数取前 12 条），形成图的骨架
 *   entangle 两个“相似日”之间的长弧（同主分类、追踪时长最接近）
 *
 * 节点位置是确定性的（骨架固定 + 固定 seed 微抖），同一份数据每次进页面形状一致。
 */
export function buildBrainGraph(rows = [], scaffold) {
  const model = buildBrainModel(rows);
  const anchors = new Map(scaffold.anchors.map((a) => [a.cat, a]));
  const rng = createRng(0x51a7c0de);
  const nodes = [];

  model.categories.forEach((c, i) => {
    const a = anchors.get(c.name);
    nodes.push({
      id: `cat:${c.name}`,
      kind: 'category',
      index: i,
      cat: c.name,
      label: c.name,
      position: a.p.slice(),
      value: c.hours,
      weight: c.weight,
    });
  });

  const dayNodes = [];
  const rankByCat = {};
  const countByCat = {};
  const globalShare = Object.fromEntries(model.categories.map((c) => [c.name, c.share]));

  // 聚类不按「当天时长最多」分，否则 Work 常年占 55%，30 天会全挤在一个枢纽上。
  // 按「相对它自己的平均占比有多突出」分：普通的一天归 Work/Leisure，
  // 跑步那天归 Health，社交那天归 Social —— 8 个枢纽都能长出簇。
  function clusterOf(d) {
    if (!d.total) return d.dominant || 'Other';
    let best = d.dominant || 'Other';
    let bestScore = 0;
    for (const cat of BRAIN_CATEGORY_ORDER) {
      const h = d.categories[cat] || 0;
      const share = globalShare[cat] || 0;
      if (h <= 0.25 || share <= 0.001) continue;
      const score = (h / d.total) / share;
      if (score > bestScore) {
        bestScore = score;
        best = cat;
      }
    }
    return best;
  }

  // 缺日不上树，所以不占末梢上的槽位
  model.days.forEach((d) => {
    if (d.missing) return;
    const primary = clusterOf(d);
    countByCat[primary] = (countByCat[primary] || 0) + 1;
  });

  model.days.forEach((d, i) => {
    const primary = clusterOf(d);
    // 缺日不占槽位：真实日期的序号在末梢上连续排开
    let k = 0;
    if (!d.missing) {
      k = rankByCat[primary] || 0;
      rankByCat[primary] = k + 1;
    }

    let pos;
    if (d.missing) {
      // 缺日：挂在日期环外圈，不上树，也不和真实节点抢位置
      const ang = (i / Math.max(1, model.days.length)) * TAU + 0.6;
      pos = [
        Math.cos(ang) * 1.30,
        -0.22 + rng() * 0.22,
        Math.sin(ang) * 1.02 - 0.10,
      ];
    } else {
      const a = anchors.get(primary);
      const cnt = countByCat[primary] || 1;

      // 同一条末梢上按序号等距排开：同一根枝最多挂 ceil(cnt / twigs) 颗
      const twig = a.twigs[k % a.twigs.length];
      const slot = Math.floor(k / a.twigs.length);
      const slots = Math.max(1, Math.ceil(cnt / a.twigs.length));
      // 从 0.52 起挂：离 hub 留出 0.3+ 的空档，日期节点不会挡住枢纽的点击
      const t = 0.52 + 0.46 * ((slot + 0.5) / slots);
      pos = polylinePoint(twig, t);

      // 侧向只给很小的确定性偏移，节点读起来仍然「长在枝上」
      const tangent = unit([
        twig[2][0] - twig[0][0],
        twig[2][1] - twig[0][1],
        twig[2][2] - twig[0][2],
      ]);
      const [t1] = tangentBasis(tangent);
      pos = addScaled(pos, t1, (rng() - 0.5) * 0.05);
    }

    const node = {
      id: `day:${i}`,
      kind: 'day',
      index: i,
      cat: primary,
      label: shortDate(d.day),
      day: d.day,
      missing: d.missing,
      trackedHours: d.trackedHours,
      dominant: d.dominant,
      position: pos,
      value: d.trackedHours,
      weight: d.missing ? 0 : Math.min(1, d.trackedHours / 10),
    };
    nodes.push(node);
    dayNodes.push(node);
  });

  // 日期节点互相松弛一下，避免同一条末梢上相邻的几颗叠在一起
  const MIN_D = 0.11;
  for (let iter = 0; iter < 28; iter += 1) {
    for (let i = 0; i < dayNodes.length; i += 1) {
      for (let j = i + 1; j < dayNodes.length; j += 1) {
        const a = dayNodes[i].position;
        const b = dayNodes[j].position;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const dz = b[2] - a[2];
        const dist = Math.hypot(dx, dy, dz);
        if (dist > 0.0001 && dist < MIN_D) {
          const push = (MIN_D - dist) * 0.5;
          const nx = (dx / dist) * push;
          const ny = (dy / dist) * push;
          const nz = (dz / dist) * push;
          a[0] -= nx; a[1] -= ny; a[2] -= nz;
          b[0] += nx; b[1] += ny; b[2] += nz;
        }
      }
    }
  }
  // 约束在树突末梢的范围内，别被松弛推到外面
  dayNodes.forEach((n) => {
    const r = Math.hypot(n.position[0], n.position[1], n.position[2]);
    if (r > 1.75) {
      n.position = n.position.map((v) => (v / r) * 1.75);
    }
  });

  const edges = [];
  const seen = new Set();
  function addEdge(a, b, kind, weight) {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ a, b, kind, weight: Math.max(0.1, Math.min(1, weight)) });
  }

  // 每天接它时长最长的两个分类
  model.days.forEach((d, i) => {
    const total = d.total || 1;
    BRAIN_CATEGORY_ORDER
      .map((cat) => [cat, d.categories[cat] || 0])
      .filter(([, h]) => h > 0.05)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 2)
      .forEach(([cat, h]) => addEdge(`day:${i}`, `cat:${cat}`, 'flow', h / total));
  });

  // 分类之间的共现，取前 12 条
  const pairs = [];
  for (let i = 0; i < BRAIN_CATEGORY_ORDER.length; i += 1) {
    for (let j = i + 1; j < BRAIN_CATEGORY_ORDER.length; j += 1) {
      const a = BRAIN_CATEGORY_ORDER[i];
      const b = BRAIN_CATEGORY_ORDER[j];
      let co = 0;
      for (const d of model.days) {
        if ((d.categories[a] || 0) > 0.1 && (d.categories[b] || 0) > 0.1) co += 1;
      }
      if (co) pairs.push({ a, b, co });
    }
  }
  pairs
    .sort((x, y) => y.co - x.co)
    .slice(0, 12)
    .forEach((p) => addEdge(
      `cat:${p.a}`,
      `cat:${p.b}`,
      'link',
      p.co / Math.max(1, model.days.length),
    ));

  // 相似日之间的“纠缠”：同主分类 + 追踪时长最接近，配成不重复的对
  const used = new Set();
  const ordered = [...dayNodes].sort((a, b) => (b.trackedHours || 0) - (a.trackedHours || 0));
  ordered.forEach((n) => {
    if (used.has(n.id) || n.missing) return;
    let best = null;
    let bestScore = Infinity;
    for (const m of ordered) {
      if (m === n || used.has(m.id) || m.missing) continue;
      const score = Math.abs((m.trackedHours || 0) - (n.trackedHours || 0))
        + (m.dominant === n.dominant ? 0 : 2.2);
      if (score < bestScore) {
        bestScore = score;
        best = m;
      }
    }
    if (best && bestScore < 2.6) {
      used.add(n.id);
      used.add(best.id);
      addEdge(n.id, best.id, 'entangle', 1 - bestScore / 2.6);
    }
  });

  return { model, nodes, edges, dayNodes };
}
