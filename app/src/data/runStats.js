// 一次跑步的派生统计：分段配速、爬升/下降、坡度、心率区间。
//
// 输入都是 watch 文档里的 `meta.samples`（并行数组，见 LifeLogging 的
// scripts/track_samples.py）：
//
//   t    秒（相对开始）        hr   心率 BPM（只有 FIT 有）
//   v    速度 m/s             alt  海拔 m
//   d    累计距离 m           temp 温度 °C
//
// 这里全部是纯函数，不碰网络、不读 DOM —— 好让它们能被单独验证。

/** 累计距离。设备给了 `d` 就用设备的；没有就按速度积分（GPX 走这条）。 */
export function distanceSeries(samples) {
  const t = samples?.t;
  if (!Array.isArray(t) || t.length < 2) return null;
  if (Array.isArray(samples.d) && samples.d.some((x) => x != null)) {
    return samples.d.map((x) => (x == null ? null : x));
  }
  const v = samples.v;
  if (!Array.isArray(v)) return null;
  const out = [0];
  for (let i = 1; i < t.length; i += 1) {
    const dt = t[i] - t[i - 1];
    const speed = v[i] ?? v[i - 1];
    out.push(out[i - 1] + (speed == null || dt <= 0 ? 0 : speed * dt));
  }
  return out;
}

/** 滑动平均，顺手把 null 透传。海拔是气压计的读数，不抹一下坡度全是毛刺。 */
function smooth(values, radius = 2) {
  if (!Array.isArray(values)) return null;
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = i - radius; k <= i + radius; k += 1) {
      const v = values[k];
      if (v == null) continue;
      sum += v;
      n += 1;
    }
    return n ? sum / n : null;
  });
}

/**
 * 按距离切段。短跑切成 100 m，稍长的 500 m，正经跑步 1 km ——
 * 固定 1 km 的话，0.4 km 的一次跑会一段都切不出来。
 */
export function runSplits(samples, maxHr = null) {
  const t = samples?.t;
  const d = distanceSeries(samples);
  if (!Array.isArray(t) || !d || d.length < 2) return { unitKm: 0, splits: [] };
  const total = d[d.length - 1] || 0;
  if (total < 50) return { unitKm: 0, splits: [] };

  const unitKm = total <= 1000 ? 0.1 : total <= 3000 ? 0.5 : 1;
  const unitM = unitKm * 1000;
  const hr = Array.isArray(samples.hr) ? samples.hr : null;
  const alt = Array.isArray(samples.alt) ? smooth(samples.alt, 2) : null;

  const out = [];
  let i = 1;
  let startD = 0;
  let startT = 0;
  let startHr = hr ? hr[0] : null;
  let startAlt = alt ? alt[0] : null;

  while (startD + unitM <= total + 1e-6) {
    const target = startD + unitM;
    while (i < d.length && (d[i] ?? 0) < target) i += 1;
    if (i >= d.length) break;
    const d0 = d[i - 1] ?? 0;
    const d1 = d[i] ?? d0;
    const t0 = t[i - 1] ?? 0;
    const t1 = t[i] ?? t0;
    const frac = d1 > d0 ? (target - d0) / (d1 - d0) : 1;
    const endT = t0 + (t1 - t0) * frac;
    const endHr = hr ? (hr[i] ?? hr[i - 1]) : null;
    const endAlt = alt ? (alt[i] ?? alt[i - 1]) : null;

    out.push({
      index: out.length + 1,
      meters: unitM,
      seconds: Math.max(0, endT - startT),
      paceS: Math.max(0, endT - startT) / unitKm,
      avgHr: average([startHr, endHr]),
      grade: startAlt != null && endAlt != null && unitM > 0
        ? ((endAlt - startAlt) / unitM) * 100
        : null,
      partial: false,
    });

    startD = target;
    startT = endT;
    startHr = endHr;
    startAlt = endAlt;
  }

  // 最后一段不满一格，也列出来（标 partial），否则总距离会凭空少一截
  const rest = total - startD;
  if (rest > Math.max(30, unitM * 0.25)) {
    const endT = t[t.length - 1] ?? startT;
    const endAlt = alt ? alt[alt.length - 1] : null;
    out.push({
      index: out.length + 1,
      meters: rest,
      seconds: Math.max(0, endT - startT),
      paceS: rest > 0 ? Math.max(0, endT - startT) / (rest / 1000) : 0,
      avgHr: average([startHr, hr ? hr[hr.length - 1] : null]),
      grade: startAlt != null && endAlt != null ? ((endAlt - startAlt) / rest) * 100 : null,
      partial: true,
    });
  }

  return { unitKm, splits: out };
}

function average(values) {
  const nums = (values || []).filter((v) => v != null);
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** 累计爬升 / 下降。0.3 m 以下的气压抖动不算（否则平路也能爬出 100 m）。 */
export function elevationStats(samples) {
  const alt = smooth(samples?.alt, 3);
  if (!alt || alt.length < 2) return null;
  let up = 0;
  let down = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < alt.length; i += 1) {
    const v = alt[i];
    if (v == null) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    if (i === 0) continue;
    const prev = alt[i - 1];
    if (prev == null) continue;
    const delta = v - prev;
    if (delta > 0.3) up += delta;
    else if (delta < -0.3) down -= delta;
  }
  if (!Number.isFinite(lo)) return null;
  return { ascentM: Math.round(up), descentM: Math.round(down), lo, hi };
}

/**
 * 坡度（%）：每一点相对**前方 spanM 米**的高差。用固定距离窗口而不是固定点数，
 * 否则采样间隔一变，同一条路的坡度就跟着变。
 */
export function gradeSeries(samples, { spanM = 50 } = {}) {
  const alt = smooth(samples?.alt, 3);
  const d = distanceSeries(samples);
  if (!alt || !d || alt.length < 2) return null;
  const out = new Array(alt.length).fill(null);
  let j = 0;
  for (let i = 0; i < alt.length; i += 1) {
    const target = (d[i] ?? 0) - spanM;
    while (j + 1 < i && (d[j + 1] ?? 0) <= target) j += 1;
    const dRef = d[j];
    const aRef = alt[j];
    if (i <= j || aRef == null || alt[i] == null || dRef == null) continue;
    const dist = (d[i] ?? 0) - dRef;
    if (dist < 5) continue;
    out[i] = ((alt[i] - aRef) / dist) * 100;
  }
  return out.some((v) => v != null) ? out : null;
}

/** 心率区间（按本次最大心率切，不猜年龄）。 */
export function hrZones(samples, maxHr = null) {
  const t = samples?.t;
  const hr = samples?.hr;
  if (!Array.isArray(t) || !Array.isArray(hr) || t.length < 2) return null;
  const peak = Number(maxHr) || Math.max(...hr.filter((v) => v != null), 0);
  if (!peak) return null;

  const zones = [
    { label: 'Z1', from: 0, to: 0.6, seconds: 0 },
    { label: 'Z2', from: 0.6, to: 0.7, seconds: 0 },
    { label: 'Z3', from: 0.7, to: 0.8, seconds: 0 },
    { label: 'Z4', from: 0.8, to: 0.9, seconds: 0 },
    { label: 'Z5', from: 0.9, to: 1.01, seconds: 0 },
  ];

  for (let i = 1; i < t.length; i += 1) {
    const value = hr[i] ?? hr[i - 1];
    if (value == null) continue;
    const dt = Math.max(0, t[i] - t[i - 1]);
    const frac = value / peak;
    const zone = zones.find((z) => frac >= z.from && frac < z.to) || zones[zones.length - 1];
    zone.seconds += dt;
  }

  const total = zones.reduce((a, z) => a + z.seconds, 0);
  if (!total) return null;
  return zones.map((z) => ({ ...z, pct: (z.seconds / total) * 100, peak }));
}

/**
 * 一串值 → SVG 折线。缺测处断开，不连成假直线。
 * 纵轴用 lo/hi 拉伸；给了 `invert` 就反过来（配速是「越小越快」，图要倒着画）。
 */
export function linePath(values, tArr, { width = 240, height = 64, pad = 4, invert = false } = {}) {
  if (!Array.isArray(values) || !Array.isArray(tArr) || values.length < 2) return '';
  const nums = values.filter((v) => v != null);
  if (nums.length < 2) return '';
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const span = hi - lo || 1;
  const tMax = tArr[tArr.length - 1] || 1;
  let d = '';
  let pen = false;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v == null) { pen = false; continue; }
    const x = pad + ((tArr[i] || 0) / tMax) * (width - pad * 2);
    const ratio = (v - lo) / span;
    const y = invert
      ? pad + ratio * (height - pad * 2)
      : height - pad - ratio * (height - pad * 2);
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    pen = true;
  }
  return d;
}
