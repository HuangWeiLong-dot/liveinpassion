// LIFE 页「我现在在干嘛」的实时快照。
//
//   POST /api/life/now   本地 run_live.ps1 带 Bearer token 写入（整份覆写）
//   GET  /api/life/now   公开读取；没推过时 404
//
// 和 /api/life 的边界不同：聚合接口刻意不含坐标，而这里**故意**包含当前坐标、
// 窗口标题和实时问答原文 —— 这是用户要的「我现在在干嘛」。正因为如此：
//   · 单独一个 R2 key（life/now.json），不混进按天归档；
//   · 只接受白名单顶层字段，且限制 64 KiB；
//   · GET 是 no-store，永远读最新一份，不做边缘缓存。
import { Hono } from 'hono';
import { lifeAuth } from './life.js';

export const lifeNowRoutes = new Hono();

const KEY = 'life/now.json';
const MAX_BYTES = 64 * 1024;
const TOP_KEYS = new Set(['v', 'ts_utc', 'location', 'desktop', 'phone', 'watch', 'qa']);
const SECTIONS = ['location', 'desktop', 'phone', 'watch', 'qa'];

lifeNowRoutes.post('/life/now', async (c) => {
  const denied = await lifeAuth(c);
  if (denied) return denied;

  const declared = Number(c.req.header('Content-Length') || 0);
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return c.json({ error: 'payload too large' }, 413);
  }
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).length > MAX_BYTES) {
    return c.json({ error: 'payload too large' }, 413);
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'invalid body' }, 400);
  }
  if (body.v !== 1 || typeof body.ts_utc !== 'string') {
    return c.json({ error: 'invalid version/timestamp' }, 400);
  }
  if (Object.keys(body).some((k) => !TOP_KEYS.has(k))) {
    return c.json({ error: 'unknown field' }, 400);
  }
  for (const key of SECTIONS) {
    const value = body[key];
    if (value == null) continue;
    if (typeof value !== 'object' || Array.isArray(value)) {
      return c.json({ error: `invalid ${key}` }, 400);
    }
  }

  try {
    await c.env.IMG_BUCKET.put(KEY, raw, {
      httpMetadata: {
        contentType: 'application/json; charset=utf-8',
        cacheControl: 'no-store',
      },
    });
  } catch (err) {
    console.error('life now ingest failed:', err?.message || err);
    return c.json({ error: 'store unavailable' }, 503);
  }

  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true });
});

lifeNowRoutes.get('/life/now', async (c) => {
  c.header('Cache-Control', 'no-store');
  try {
    const obj = await c.env.IMG_BUCKET.get(KEY);
    if (!obj) return c.json({ error: 'no snapshot yet' }, 404);
    const text = await obj.text();
    return c.body(text, 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
  } catch (err) {
    console.error('life now read failed:', err?.message || err);
    return c.json({ error: 'store unavailable' }, 503);
  }
});
