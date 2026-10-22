// 3D「机械神经网络大脑」的纯数据层。
//
// 这里**不 import three**：点云、连线、日期环都只是数组，组件负责把它们喂给
// BufferGeometry；验收脚本也能直接在 Node 里调用这些函数做结构断言。
//
// 数据映射（全部来自 /api/life 已公开的日聚合，不碰 raw 坐标/日记）：
//   · 皮层节点按 8 个功能区分布，区的亮度 = 该分类在窗口内的时长占比
//   · 突触 = 同区近邻 + 跨区桥接；桥接数量固定，不随数据变
//   · 日期环 = 窗口内每天一颗珠子（缺日更小更暗），珠子大小 = 当日追踪时长
// 几何是确定性随机的（固定 seed），所以每次刷新形状一致，截图可逐帧比对。

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

// dir 是单位球上的方向；deformSurface 会把它压成脑壳上的点。
// side 用来防止左半球的点被分到右半球锚点。
const REGION_SEEDS = [
  { cat: 'Work', side: -1, dir: [-0.70, 0.46, 0.55] },
  { cat: 'Study', side: -1, dir: [-0.80, 0.04, -0.32] },
  { cat: 'Life', side: 1, dir: [0.70, 0.46, 0.55] },
  { cat: 'Transport', side: -1, dir: [-0.55, -0.34, 0.12] },
  { cat: 'Leisure', side: 1, dir: [0.80, 0.04, -0.32] },
  { cat: 'Health', side: 1, dir: [0.55, -0.34, 0.12] },
  { cat: 'Social', side: 1, dir: [0.62, -0.02, -0.86] },
  { cat: 'Other', side: -1, dir: [-0.62, -0.02, -0.86] },
];

export const BRAIN_CATEGORY_ORDER = REGION_SEEDS.map((r) => r.cat);

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

// 脑壳：左右半球 + 纵向裂沟 + 几条脑回起伏 + 压平的底面。
// 只依赖方向，不随机 —— 锚点、节点、连线共用同一个表面。
export function deformSurface([x, y, z]) {
  const s = x >= 0 ? 1 : -1;
  const ax = Math.abs(x);
  const front = Math.max(0, z);
  const phi = Math.atan2(z, x);
  // 三组频率叠出脑回；只看正面时也必须能看出起伏，所以振幅给得比真实比例大
  const ridge = 1
    + 0.050 * Math.sin(5.5 * phi + 2.8 * y)
    + 0.032 * Math.sin(9 * y - 3.2 * phi)
    + 0.018 * Math.cos(13 * y + 4 * phi);

  // 纵裂：上半部分再宽一点，正面才有一个清楚的“左右两半”
  const fissure = 0.085 + 0.030 * Math.max(0, y);
  let px = s * (fissure + ax * 1.02) * (1 - 0.17 * front) * ridge;
  let py = y * 0.78 * ridge;
  let pz = z * 1.18 * ridge;

  // 颞叶：下半部两侧向外鼓，侧面剪影才不是一颗蛋
  const temporal = Math.max(0, -y) * Math.max(0, 1 - Math.abs(z) * 0.55);
  px *= 1 + 0.07 * temporal;

  // 顶面稍平，底面压平
  if (py > 0.55) py = 0.55 + (py - 0.55) * 0.72;
  if (py < -0.44) py = -0.44 + (py + 0.44) * 0.42;
  return [px, py, pz];
}

function fibonacciSphere(count) {
  const out = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = ga * i;
    out.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return out;
}

/**
 * 皮层点云 + 8 个功能区锚点。
 * @param {{ count?: number, seed?: number }} opts
 */
export function buildBrainCloud({ count = 680, seed = 20261018 } = {}) {
  const rng = createRng(seed);
  const positions = [];
  const regions = [];

  const anchors = REGION_SEEDS.map((seedDef) => {
    const p = deformSurface(unit(seedDef.dir));
    return {
      cat: seedDef.cat,
      side: seedDef.side,
      p,
      // 稍往里收一点：射线更容易先打到近侧的锚点
      probe: [p[0] * 0.94, p[1] * 0.94, p[2] * 0.94],
    };
  });

  function regionFor(p) {
    const side = p[0] >= 0 ? 1 : -1;
    let best = 'Other';
    let bestD = Infinity;
    for (const a of anchors) {
      if (a.side !== side && Math.abs(p[0]) > 0.06) continue;
      const d = (p[0] - a.p[0]) ** 2
        + (p[1] - a.p[1]) ** 2
        + (p[2] - a.p[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = a.cat;
      }
    }
    return best;
  }

  const cortex = Math.max(120, Math.round(count * 0.84));
  const cerebellum = Math.max(24, Math.round(count * 0.1));
  const stem = Math.max(12, count - cortex - cerebellum);

  fibonacciSphere(cortex).forEach((dir) => {
    const p = deformSurface(dir);
    // 壳厚：同一方向上的点略有内外偏移，读起来才有体积
    const j = 0.965 + rng() * 0.07;
    const q = [p[0] * j, p[1] * j, p[2] * j];
    positions.push(q);
    regions.push(regionFor(q));
  });

  // 小脑：后下方的另一个椭球，只取下半部分
  for (let i = 0; i < cerebellum; i += 1) {
    let ux; let uy; let uz; let r2;
    do {
      ux = rng() * 2 - 1;
      uy = rng() * 2 - 1;
      uz = rng() * 2 - 1;
      r2 = ux * ux + uy * uy + uz * uz;
    } while (r2 > 1 || r2 < 0.04 || uy > 0.45 || uz > 0.4);

    const fold = 1 + 0.045 * Math.sin(ux * 18) * Math.cos(uz * 14);
    positions.push([
      ux * 0.46 * fold,
      -0.36 + uy * 0.27 * fold,
      -0.62 + uz * 0.36 * fold,
    ]);
    regions.push('Other');
  }

  // 脑干：从底面往下的一小段锥体，机械感主要靠它和日期环咬合
  for (let i = 0; i < stem; i += 1) {
    const t = i / Math.max(1, stem - 1);
    const a = rng() * TAU;
    const rad = (0.12 - t * 0.055) * (0.55 + rng() * 0.45);
    positions.push([
      Math.cos(a) * rad,
      -0.38 - t * 0.62,
      -0.30 + Math.sin(a) * rad,
    ]);
    regions.push('Other');
  }

  return { positions, regions, anchors };
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
  const categories = REGION_SEEDS.map((seed) => {
    const hours = totals[seed.cat];
    return {
      name: seed.cat,
      color: BRAIN_COLOR[seed.cat],
      hours,
      share: totalHours ? hours / totalHours : 0,
      activeDays: activeDays[seed.cat],
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

/**
 * Obsidian 风格的 3D 图：8 个分类枢纽 + 每天一个节点。
 *
 * 三种连线：
 *   flow     当天 → 时长最多的两个分类（每天最多 2 条）
 *   link     分类 ↔ 分类（按同一天共同出现的次数取前 12 条），形成思维导图的骨架
 *   entangle 两个“相似日”之间的长弧（同主分类、追踪时长最接近），量子纠缠那种跨远端的连线
 *
 * 节点位置是确定性的（固定 seed + 松弛），所以同一份数据每次进页面形状一致。
 */
export function buildBrainGraph(rows = [], cloud) {
  const model = buildBrainModel(rows);
  const anchors = new Map(cloud.anchors.map((a) => [a.cat, a]));
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
      position: [a.p[0] * 1.02, a.p[1] * 1.02, a.p[2] * 1.02],
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

  model.days.forEach((d) => {
    const primary = clusterOf(d);
    countByCat[primary] = (countByCat[primary] || 0) + 1;
  });

  model.days.forEach((d, i) => {
    const primary = clusterOf(d);
    const k = rankByCat[primary] || 0;
    rankByCat[primary] = k + 1;

    let pos;
    if (d.missing) {
      // 缺日：沿脑壳后侧放一圈暗点，不和数据节点抢位置
      const ang = (i / Math.max(1, model.days.length)) * TAU + 0.6;
      pos = [
        Math.cos(ang) * 1.18,
        -0.12 + rng() * 0.3,
        Math.sin(ang) * 0.92 - 0.15,
      ];
    } else {
      const a = anchors.get(primary);
      const secondary = BRAIN_CATEGORY_ORDER
        .filter((c) => c !== primary)
        .map((c) => [c, d.categories[c] || 0])
        .sort((x, y) => y[1] - x[1])[0];
      const b = secondary && secondary[1] > 0.05 ? anchors.get(secondary[0]) : a;

      // 以主分类的锚点为圆心，在它的切平面上散开
      const n = unit(a.p);
      let t1 = unit([-n[2], 0, n[0]]);
      if (t1[0] === 0 && t1[1] === 0 && t1[2] === 0) t1 = [1, 0, 0];
      const t2 = unit([
        n[1] * t1[2] - n[2] * t1[1],
        n[2] * t1[0] - n[0] * t1[2],
        n[0] * t1[1] - n[1] * t1[0],
      ]);

      const cnt = countByCat[primary] || 1;
      const spread = cnt > 1 ? 0.46 : 0.18;
      const rad = 0.14 + spread * Math.sqrt((k + 0.5) / cnt) * (0.72 + 0.5 * rng());
      const ang = k * 2.399963 + (rng() - 0.5) * 0.6;
      const normalJitter = (rng() * 2 - 1) * 0.09;

      // 0.82 把点从脑壳表面推进去一点；副分类只拉一点点
      pos = [
        a.p[0] * 0.82 + b.p[0] * 0.08
          + t1[0] * Math.cos(ang) * rad + t2[0] * Math.sin(ang) * rad + n[0] * normalJitter,
        a.p[1] * 0.82 + b.p[1] * 0.08
          + t1[1] * Math.cos(ang) * rad + t2[1] * Math.sin(ang) * rad + n[1] * normalJitter,
        a.p[2] * 0.82 + b.p[2] * 0.08
          + t1[2] * Math.cos(ang) * rad + t2[2] * Math.sin(ang) * rad + n[2] * normalJitter,
      ];
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

  // 日期节点互相松弛一下，避免同一天主分类下的几颗叠在一起
  const MIN_D = 0.17;
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
  // 约束在脑壳里，别被松弛推到外面
  dayNodes.forEach((n) => {
    const r = Math.hypot(n.position[0], n.position[1], n.position[2]);
    if (r > 1.52) {
      n.position = n.position.map((v) => (v / r) * 1.52);
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

  // 整体放大一点：日期簇和 8 个枢纽占满脑壳内部，不要缩在中间
  const spread = 1.14;
  nodes.forEach((n) => {
    n.position = n.position.map((v) => v * spread);
  });

  return { model, nodes, edges, dayNodes };
}
