// 首页展示：后台编辑接口 + 前台构建期只读接口
//
// 前台不直接调这套（会多一次运行时请求）：构建脚本把 /api/showcase 写进
// app/src/data/content/showcase.json，CMS 保存后照旧触发 repository_dispatch 重建。
import { Hono } from 'hono';
import { requireAccessAuth } from '../lib/auth.js';
import { triggerRebuild } from '../lib/github.js';
import {
  KINDS,
  buildShowcase,
  listShowcaseOptions,
  normalizeItems,
  normalizeLimits,
} from '../lib/showcase.js';

const admin = new Hono();

// 后台读取：当前 limits + 已选条目（原始顺序）+ 可选项
admin.get('/', requireAccessAuth, async (c) => {
  const db = c.env.DB;
  const [resolved, rowResult, options] = await Promise.all([
    buildShowcase(db),
    db.prepare(
      `SELECT kind, ref_id FROM showcase_items ORDER BY sort_order ASC, id ASC`
    ).all(),
    listShowcaseOptions(db),
  ]);

  return c.json({
    limits: resolved.limits,
    items: rowResult.results.map((row) => ({
      kind: row.kind,
      refId: Number(row.ref_id),
    })),
    options,
  });
});

// 整份覆盖保存（items + 三类显示上限）
admin.put('/', requireAccessAuth, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();
  const limits = normalizeLimits(body.limits);
  const items = normalizeItems(body.items);

  const statements = [db.prepare('DELETE FROM showcase_items')];
  items.forEach((item, index) => {
    statements.push(
      db.prepare(
        `INSERT INTO showcase_items (kind, ref_id, sort_order) VALUES (?, ?, ?)`
      ).bind(item.kind, item.refId, index)
    );
  });
  for (const kind of KINDS) {
    statements.push(
      db.prepare(
        `INSERT INTO showcase_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`
      ).bind(`${kind}_limit`, String(limits[kind]))
    );
  }

  // D1 的 batch 在同一个事务里执行：不会出现"删完了但没写进去"的半截状态
  await db.batch(statements);
  c.executionCtx.waitUntil(triggerRebuild(c.env, 'home showcase updated').catch(() => {}));

  return c.json({ ok: true, limits, count: items.length });
});

const publicApp = new Hono();

// 构建期只读
publicApp.get('/showcase', async (c) => {
  const data = await buildShowcase(c.env.DB);
  return c.json(data);
});

export { admin as showcaseAdminRoutes, publicApp as showcasePublicRoutes };
