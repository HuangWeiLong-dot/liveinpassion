// 个人生命数据（LifeLogging）接口
//
//   POST /api/life/ingest  本地流水线带 Bearer token 写入每日快照
//   GET  /api/life         前台运行时读取近 N 天（公开只读）
//
// 隐私边界：这里只接受/返回**聚合数字**。Worker 侧做字段白名单校验，
// 即使上游脚本改坏，坐标、轨迹、窗口标题、URL、应用包名也进不了 D1。
// 校验失败只回报字段名与日期，不回显提交的值（避免把敏感内容写进日志）。
import { Hono } from 'hono';
import { checkPassword } from '../lib/auth.js';

export const lifeRoutes = new Hono();

const MAX_BODY_BYTES = 256 * 1024;
const MAX_DAY_BYTES = 32 * 1024;
const MAX_DAYS_PER_REQUEST = 90;
const MAX_DAYS_QUERY = 90;
const DEFAULT_DAYS = 30;
const BATCH_SIZE = 40;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORY_RE = /^[A-Za-z][A-Za-z ]{0,23}$/;
// Android 包名形状。上游脚本会把包名映射成显示名；这里再挡一次，
// 防止改坏脚本后 com.tencent.mm 之类直接出现在公网页面上。
const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const COST_SOURCES = new Set(['platform', 'claude-estimate', 'ledger']);

const DAY_KEYS = new Set([
  'v', 'day', 'categories', 'trackedHours', 'topApps',
  'health', 'location', 'phone', 'ai',
]);
const HEALTH_KEYS = new Set([
  'steps', 'hrAvg', 'hrMin', 'runs', 'runKm', 'runMinutes', 'runPaceS', 'vo2max',
]);
const LOCATION_KEYS = new Set([
  'city', 'districts', 'movingMinutes', 'inferredMinutes', 'transitMinutes',
  'stayMinutes', 'spanKm', 'points',
]);
const PHONE_KEYS = new Set([
  'unlocks', 'screenOn', 'screenOff', 'screenMinutes', 'appSwitches', 'topApps',
]);
const AI_KEYS = new Set([
  'cost', 'costSource', 'dailyCost', 'spend', 'estimatedCost',
  'calls', 'callsSource', 'models', 'projects',
]);

// ---------- 校验小工具 ----------

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function onlyKeys(obj, allowed) {
  return Object.keys(obj).every((k) => allowed.has(k));
}

function isNum(v, min, max) {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

function isOptNum(v, min, max) {
  return v === null || isNum(v, min, max);
}

function isName(v, max = 64) {
  return typeof v === 'string'
    && v.length >= 1
    && v.length <= max
    && !/[\u0000-\u001f\u007f]/.test(v);
}

// [[name, value], ...]
function isPairs(v, maxLen, maxValue) {
  return Array.isArray(v)
    && v.length <= maxLen
    && v.every((p) => Array.isArray(p)
      && p.length === 2
      && isName(p[0])
      && isNum(p[1], 0, maxValue));
}

// 应用名列表：形状同 isPairs，但不允许包名。
function isAppPairs(v, maxLen, maxValue) {
  return isPairs(v, maxLen, maxValue) && v.every((p) => !PACKAGE_RE.test(p[0]));
}

function isRealDate(day) {
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

// 返回出错的字段名；null 表示通过。
function validateDay(d) {
  if (!isObj(d)) return 'day';
  if (!onlyKeys(d, DAY_KEYS)) return 'unknown field';
  if (d.v !== 1) return 'v';
  if (typeof d.day !== 'string' || !DAY_RE.test(d.day) || !isRealDate(d.day)) return 'day';

  // 电脑使用：没有桌面数据时允许 null（当天只有手机/健康数据）
  if (d.categories !== null) {
    if (!isObj(d.categories) || Object.keys(d.categories).length > 24) return 'categories';
    for (const [k, v] of Object.entries(d.categories)) {
      if (!CATEGORY_RE.test(k) || !isNum(v, 0, 24)) return `categories.${k}`;
    }
  }
  if (!isOptNum(d.trackedHours, 0, 24.5)) return 'trackedHours';
  if (d.topApps !== null && !isAppPairs(d.topApps, 20, 24)) return 'topApps';

  if (d.health !== null) {
    const h = d.health;
    if (!isObj(h) || !onlyKeys(h, HEALTH_KEYS)) return 'health';
    if (!isOptNum(h.steps, 0, 200000)) return 'health.steps';
    if (!isOptNum(h.hrAvg, 0, 300)) return 'health.hrAvg';
    if (!isOptNum(h.hrMin, 0, 300)) return 'health.hrMin';
    if (!isOptNum(h.runs, 0, 50)) return 'health.runs';
    if (!isOptNum(h.runKm, 0, 1000)) return 'health.runKm';
    if (!isOptNum(h.runMinutes, 0, 1440)) return 'health.runMinutes';
    if (!isOptNum(h.runPaceS, 0, 3600)) return 'health.runPaceS';
    if (!isOptNum(h.vo2max, 0, 100)) return 'health.vo2max';
  }

  if (d.location !== null) {
    const l = d.location;
    if (!isObj(l) || !onlyKeys(l, LOCATION_KEYS)) return 'location';
    if (l.city !== null && !isName(l.city, 64)) return 'location.city';
    if (l.districts !== null && !isPairs(l.districts, 64, 24)) return 'location.districts';
    if (!isOptNum(l.movingMinutes, 0, 1440)) return 'location.movingMinutes';
    if (!isOptNum(l.inferredMinutes, 0, 1440)) return 'location.inferredMinutes';
    if (!isOptNum(l.transitMinutes, 0, 1440)) return 'location.transitMinutes';
    if (!isOptNum(l.stayMinutes, 0, 1440)) return 'location.stayMinutes';
    if (!isOptNum(l.spanKm, 0, 5000)) return 'location.spanKm';
    if (!isOptNum(l.points, 0, 10000000)) return 'location.points';
  }

  if (d.phone !== null) {
    const p = d.phone;
    if (!isObj(p) || !onlyKeys(p, PHONE_KEYS)) return 'phone';
    if (!isOptNum(p.unlocks, 0, 1000000)) return 'phone.unlocks';
    if (!isOptNum(p.screenOn, 0, 1000000)) return 'phone.screenOn';
    if (!isOptNum(p.screenOff, 0, 1000000)) return 'phone.screenOff';
    if (!isOptNum(p.screenMinutes, 0, 1440)) return 'phone.screenMinutes';
    if (!isOptNum(p.appSwitches, 0, 1000000)) return 'phone.appSwitches';
    if (p.topApps !== null && !isAppPairs(p.topApps, 20, 1440)) return 'phone.topApps';
  }

  if (d.ai !== null) {
    const a = d.ai;
    if (!isObj(a) || !onlyKeys(a, AI_KEYS)) return 'ai';
    if (!isOptNum(a.cost, 0, 1000000)) return 'ai.cost';
    if (a.costSource !== null && !COST_SOURCES.has(a.costSource)) return 'ai.costSource';
    if (!isOptNum(a.dailyCost, 0, 1000000)) return 'ai.dailyCost';
    if (!isOptNum(a.spend, 0, 1000000)) return 'ai.spend';
    if (!isOptNum(a.estimatedCost, 0, 1000000)) return 'ai.estimatedCost';
    if (!isOptNum(a.calls, 0, 100000000)) return 'ai.calls';
    if (a.callsSource !== null && !COST_SOURCES.has(a.callsSource)) return 'ai.callsSource';
    if (a.models !== null && !isPairs(a.models, 20, 1000000)) return 'ai.models';
    if (a.projects !== null && !isPairs(a.projects, 20, 1000000)) return 'ai.projects';
  }

  return null;
}

// 共享的写入鉴权：Bearer token 与 LIFE_INGEST_TOKEN 做常量时间比较。
// 原始数据接口也用它，避免两套逻辑漂移。
export async function lifeAuth(c) {
  const secret = c.env.LIFE_INGEST_TOKEN;
  if (!secret) return c.json({ error: 'life ingest not configured' }, 503);

  const header = (c.req.header('Authorization') || '').trim();
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match || !(await checkPassword(secret, match[1]))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return null;
}

// ---------- POST /api/life/ingest ----------

lifeRoutes.post('/life/ingest', async (c) => {
  const denied = await lifeAuth(c);
  if (denied) return denied;

  const declared = Number(c.req.header('Content-Length') || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return c.json({ error: 'payload too large' }, 413);
  }

  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return c.json({ error: 'payload too large' }, 413);
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }

  if (!isObj(body) || body.v !== 1 || !Array.isArray(body.days)) {
    return c.json({ error: 'invalid body' }, 400);
  }
  if (body.days.length < 1 || body.days.length > MAX_DAYS_PER_REQUEST) {
    return c.json({ error: 'invalid days length' }, 400);
  }

  const seen = new Set();
  for (const d of body.days) {
    const field = validateDay(d);
    if (field) {
      return c.json({ error: 'invalid day', day: isObj(d) ? d.day : null, field }, 400);
    }
    if (seen.has(d.day)) {
      return c.json({ error: 'duplicate day', day: d.day }, 400);
    }
    seen.add(d.day);
    if (new TextEncoder().encode(JSON.stringify(d)).length > MAX_DAY_BYTES) {
      return c.json({ error: 'day payload too large', day: d.day }, 413);
    }
  }

  const stmts = body.days.map((d) => c.env.DB.prepare(
    `INSERT INTO life_days (day, payload, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(day) DO UPDATE SET
       payload = excluded.payload,
       updated_at = excluded.updated_at`,
  ).bind(d.day, JSON.stringify(d)));

  try {
    for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
      await c.env.DB.batch(stmts.slice(i, i + BATCH_SIZE));
    }
  } catch (err) {
    console.error('life ingest failed:', err?.message || err);
    return c.json({ error: 'store unavailable' }, 503);
  }

  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, accepted: body.days.length });
});

// ---------- GET /api/life?days=N ----------

lifeRoutes.get('/life', async (c) => {
  const rawDays = c.req.query('days');
  const parsed = rawDays === undefined ? Number.NaN : Number(rawDays);
  const limit = Number.isFinite(parsed)
    ? Math.min(MAX_DAYS_QUERY, Math.max(1, Math.floor(parsed)))
    : DEFAULT_DAYS;

  let rows = [];
  try {
    const res = await c.env.DB.prepare(
      'SELECT day, payload, updated_at FROM life_days ORDER BY day DESC LIMIT ?',
    ).bind(limit).all();
    rows = res.results || [];
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('no such table')) {
      return c.json({ error: 'life store not initialised' }, 503);
    }
    console.error('life read failed:', msg);
    return c.json({ error: 'store unavailable' }, 500);
  }

  const days = [];
  let skipped = 0;
  let updatedAt = null;

  for (const row of rows) {
    if (row.updated_at && (!updatedAt || row.updated_at > updatedAt)) {
      updatedAt = row.updated_at;
    }
    let payload;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      skipped += 1;
      continue;
    }
    if (!isObj(payload) || payload.day !== row.day) {
      skipped += 1;
      continue;
    }
    days.push(payload);
  }
  days.reverse();

  c.header('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
  return c.json({
    v: 1,
    days,
    count: days.length,
    skipped,
    range: days.length
      ? { from: days[0].day, to: days[days.length - 1].day }
      : null,
    generatedAt: new Date().toISOString(),
    updatedAt,
  });
});
