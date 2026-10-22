// LIFE 地图用到的坐标数据。
//
// /api/life 的日汇总只有城市/区级时长，没有坐标；轨迹在地图上要真实位置，
// 所以这里从**已经公开的** raw events 文档里取 location domain：
//   track_path     当天抽样的轨迹点（500 个 [lat, lon]）
//   visit          停留点（lat/lon + 分钟数 + “Yingpu, Qingpu, Shanghai”）
//   transport      每段交通（公里数 + walking/cycling/driving）
//   tracked_points 当天中心点与跨度
//
// 一天 events 约 100–250 KB，其他 domain（808 条手机事件）解析后马上丢弃。
// 只在 PLACES 面板接近视口时先拉一批，之后由「LOAD MORE」按需追加；
// 模块内缓存 5 分钟，归档页也有同样的 5 分钟口径，刷新时两边一起过期。
//
// 这里不做任何网络之外的副作用：投影与聚合都是纯函数，便于单独验证。

// 每次加载多少天。不是总上限 —— 「LOAD MORE」会继续往后取，直到窗口内的
// raw events 用完。
export const MAP_BATCH_DAYS = 7;

const TTL = 5 * 60 * 1000;
const trackCache = new Map(); // day -> { at, track }

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/** 从 /api/life/raw/events/:day 的文档里只留下能画图的部分。 */
export function parseLocationEvents(doc) {
  const events = Array.isArray(doc?.data) ? doc.data : [];
  const track = {
    day: String(doc?.id || ''),
    path: [],
    watchPaths: [],
    visits: [],
    transports: [],
    center: null,
    spanKm: null,
    points: 0,
    minutes: 0,
    km: 0,
    watchMinutes: 0,
    watchKm: 0,
  };

  for (const e of events) {
    if (!e) continue;
    // 手表 GPX 路线：domain=fitness / metric=watch_track，meta.path 和
    // Dawarich 的 track_path 同形。它是虚线，和手机的实线轨迹区分。
    if (e.domain === 'fitness' && e.metric === 'watch_track') {
      const meta = e.meta || {};
      const path = Array.isArray(meta.path)
        ? meta.path
          .filter((p) => Array.isArray(p) && n(p[0]) != null && n(p[1]) != null)
          .map((p) => [n(p[0]), n(p[1])])
        : [];
      if (path.length) {
        const km = n(meta.distance_km);
        const minutes = n(e.value_num);
        track.watchPaths.push({
          path,
          km,
          minutes,
          start: meta.start_utc || e.ts_utc || '',
          end: meta.end_utc || '',
        });
        track.watchKm += km || 0;
        track.watchMinutes += minutes || 0;
      }
      continue;
    }
    if (e.domain !== 'location') continue;
    const meta = e.meta || {};

    if (e.metric === 'track_path' && Array.isArray(meta.path)) {
      track.path = meta.path
        .filter((p) => Array.isArray(p) && n(p[0]) != null && n(p[1]) != null)
        .map((p) => [n(p[0]), n(p[1])]);
      continue;
    }

    if (e.metric === 'tracked_points') {
      const lat = n(meta.lat_center);
      const lon = n(meta.lon_center);
      track.center = lat != null && lon != null ? [lat, lon] : null;
      track.spanKm = n(meta.span_km);
      track.points = Math.round(n(e.value_num) || track.path.length);
      continue;
    }

    if (e.metric === 'visit') {
      const lat = n(meta.lat);
      const lon = n(meta.lon);
      if (lat == null || lon == null) continue;
      track.visits.push({
        name: String(e.value_text || ''),
        lat,
        lon,
        minutes: Math.max(0, n(e.value_num) || 0),
      });
      continue;
    }

    if (e.metric === 'transport') {
      // ⚠️ Dawarich 的 mode_timeline 每段只有**分钟数**（value_num），没有距离；
      //    distance 只挂在整条 track 上。旧版兜底事件才会在 meta 里带
      //    distance_km。所以这里以分钟为准，km 只作为可选补充。
      const minutes = n(e.value_num);
      if (minutes == null || minutes <= 0) continue;
      track.transports.push({
        mode: String(e.value_text || 'other').toLowerCase(),
        minutes,
        km: n(meta.distance_km),
      });
    }
  }

  track.minutes = track.transports.reduce((a, x) => a + x.minutes, 0);
  track.km = track.transports.reduce((a, x) => a + (x.km || 0), 0);
  if (!track.points) track.points = track.path.length;
  return track;
}

export async function fetchLifeTrack(day, base, signal) {
  const hit = trackCache.get(day);
  if (hit && Date.now() - hit.at < TTL) return hit.track;

  const res = await fetch(`${base}/api/life/raw/events/${encodeURIComponent(day)}`, {
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new Error(`events ${res.status}`);
  const doc = await res.json();
  const track = parseLocationEvents(doc);
  if (!track.day) track.day = day;
  trackCache.set(day, { at: Date.now(), track });
  return track;
}

/**
 * 并发拉取多天；单天失败不拖垮整张地图（地图降级为剩余天）。
 * 返回顺序与 days 一致，空轨迹天被丢弃。
 */
export async function loadLifeTracks(days, { base, signal, concurrency = 3 } = {}) {
  const out = new Array(days.length);
  let next = 0;

  async function worker() {
    while (next < days.length) {
      const i = next;
      next += 1;
      try {
        out[i] = await fetchLifeTrack(days[i], base, signal);
      } catch (err) {
        if (signal?.aborted) throw err;
        out[i] = null;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, days.length) },
    () => worker(),
  );
  await Promise.all(workers);

  return out.filter(
    (t) => t && (t.path.length || t.visits.length || (t.watchPaths || []).length),
  );
}

// ---------- 投影 ----------

const PAD = 52;
const MIN_SPAN = 0.012; // 只有家附近时也别把地图放大到一栋楼

function simplify(points, minPx) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i];
    const last = out[out.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= minPx) out.push(p);
  }
  if (out.length === 1) out.push(points[points.length - 1]);
  return out;
}

function niceKm(raw) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const v = raw / pow;
  if (v < 1.5) return 1 * pow;
  if (v < 3.5) return 2 * pow;
  if (v < 7.5) return 5 * pow;
  return 10 * pow;
}

/**
 * 把多天轨迹与停留点压成一个 SVG 几何体。
 * 返回的坐标已经落在 width × height 的 viewBox 内。
 */
export function buildGeoMap(tracks, { width = 1000, height = 560 } = {}) {
  const list = (tracks || []).filter(Boolean);
  const coords = [];
  list.forEach((t) => {
    (t.path || []).forEach((p) => coords.push(p));
    (t.watchPaths || []).forEach((w) => (w.path || []).forEach((p) => coords.push(p)));
    (t.visits || []).forEach((v) => coords.push([v.lat, v.lon]));
  });
  if (!coords.length) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  coords.forEach(([lat, lon]) => {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  });

  const midLat = (minLat + maxLat) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);

  // 单点/一条街：把视窗撑到 MIN_SPAN，避免像素级抖动被放大成锯齿
  if ((maxLat - minLat) < MIN_SPAN) {
    const c = (minLat + maxLat) / 2;
    minLat = c - MIN_SPAN / 2;
    maxLat = c + MIN_SPAN / 2;
  }
  if ((maxLon - minLon) * kx < MIN_SPAN) {
    const c = (minLon + maxLon) / 2;
    const half = MIN_SPAN / kx / 2;
    minLon = c - half;
    maxLon = c + half;
  }

  const spanX = (maxLon - minLon) * kx;
  const spanY = maxLat - minLat;
  const scale = Math.min((width - PAD * 2) / spanX, (height - PAD * 2) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;

  const project = (lat, lon) => [
    offX + (lon - minLon) * kx * scale,
    offY + (maxLat - lat) * scale,
  ];

  // ---- 轨迹 ----
  const paths = list.map((t) => {
    const pts = simplify((t.path || []).map(([lat, lon]) => project(lat, lon)), 1.1);
    const d = pts.length
      ? `M${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' L')}`
      : '';
    return {
      day: t.day,
      d,
      minutes: t.minutes || 0,
      km: Math.round((t.km || 0) * 10) / 10,
      points: t.points || t.path.length,
      spanKm: t.spanKm,
      center: t.center,
    };
  }).filter((t) => t.d);

  // ---- 手表 GPX 路线（虚线，和手机实线区分） ----
  const watchPaths = [];
  list.forEach((t) => {
    (t.watchPaths || []).forEach((w, i) => {
      const pts = simplify((w.path || []).map(([lat, lon]) => project(lat, lon)), 1.1);
      if (!pts.length) return;
      watchPaths.push({
        day: t.day,
        d: `M${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' L')}`,
        km: w.km,
        minutes: w.minutes,
        start: w.start,
        end: w.end,
        index: i,
      });
    });
  });

  // ---- 停留点聚类（≈100 m 一格），跨天累加时长 ----
  const cells = new Map();
  list.forEach((t) => {
    (t.visits || []).forEach((v) => {
      const key = `${v.lat.toFixed(3)},${v.lon.toFixed(3)}`;
      const cell = cells.get(key) || {
        lat: 0, lon: 0, minutes: 0, count: 0, names: {},
      };
      cell.lat += v.lat;
      cell.lon += v.lon;
      cell.minutes += v.minutes;
      cell.count += 1;
      if (v.name) cell.names[v.name] = (cell.names[v.name] || 0) + 1;
      cells.set(key, cell);
    });
  });

  const visits = [...cells.values()].map((c) => {
    const [x, y] = project(c.lat / c.count, c.lon / c.count);
    const hours = c.minutes / 60;
    const name = Object.entries(c.names)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    return {
      x,
      y,
      hours,
      count: c.count,
      name,
      label: name.split(',')[0].trim(),
      r: Math.min(17, 3 + Math.sqrt(Math.max(hours, 0.1)) * 1.35),
    };
  }).sort((a, b) => b.hours - a.hours);

  // 只给最大的几个地点贴标签；互相太近就跳过，避免叠字
  const labels = [];
  visits.forEach((v) => {
    if (labels.length >= 3 || !v.label || v.hours < 0.4) return;
    if (labels.some((l) => Math.hypot(l.x - v.x, l.y - v.y) < 78)) return;
    const flip = v.x > width - 190;
    labels.push({
      x: v.x,
      y: v.y,
      text: v.label.toUpperCase(),
      anchor: flip ? 'end' : 'start',
      dx: flip ? -(v.r + 8) : v.r + 8,
    });
  });

  // ---- 比例尺 ----
  const kmPerPx = 111.32 / scale;
  const barKm = niceKm(kmPerPx * 128);
  const barPx = barKm / kmPerPx;

  // ---- 网格（5 等分，和图表网格同一语言） ----
  const gridX = [0.2, 0.4, 0.6, 0.8].map((p) => p * width);
  const gridY = [0.2, 0.4, 0.6, 0.8].map((p) => p * height);

  return {
    width,
    height,
    paths,
    watchPaths,
    visits,
    labels,
    gridX,
    gridY,
    scale: { km: barKm, px: barPx, x: PAD, y: height - PAD + 18 },
    center: project(midLat, (minLon + maxLon) / 2),
  };
}
