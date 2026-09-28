import { Hono } from 'hono';

// 访问统计路由（全部公开，无鉴权）：
//   POST /api/track  页面访问埋点（前台路由切换时由浏览器上报）
//   GET  /api/stats  统计页数据（总量、今日、近 30 天、按月、热门页面、在线人数）
//
// 隐私：不记录 IP、不种 Cookie；UV 用浏览器 localStorage 里的随机 ID 去重。

export const statsRoutes = new Hono();

// 按 Asia/Shanghai 时区取 'YYYY-MM-DD'
function shanghaiDay(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

// 路径归一：好友详情页 /friends/xxx 合并统计，防止基数膨胀
function normalizePath(p) {
  if (!p || typeof p !== 'string') return '/';
  const clean = p.split('?')[0].split('#')[0].slice(0, 200);
  if (/^\/friends\/[^/]+/.test(clean)) return '/friends/:id';
  return clean || '/';
}

// ---------- POST /api/track ----------
statsRoutes.post('/track', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  let sid = typeof body.sid === 'string' ? body.sid.slice(0, 64) : '';
  const path = normalizePath(body.path);
  const day = shanghaiDay();
  const now = new Date().toISOString();

  const isNewSession = !sid;
  if (isNewSession) sid = crypto.randomUUID();

  const stmts = [];

  if (isNewSession) {
    stmts.push(
      c.env.DB.prepare(
        'INSERT INTO visit_sessions (sid, first_seen, last_seen) VALUES (?, ?, ?)'
      ).bind(sid, now, now)
    );
  } else {
    stmts.push(
      c.env.DB.prepare(
        'UPDATE visit_sessions SET last_seen = ? WHERE sid = ?'
      ).bind(now, sid)
    );
  }

  // 会话当日去重：插入成功（changes=1）说明是该会话今天第一次访问。
  // 必须在 batch 之前单独执行以拿到 changes，batch 里不再重复插入。
  const sessionDayRes = await c.env.DB.prepare(
    'INSERT OR IGNORE INTO visit_session_days (sid, day) VALUES (?, ?)'
  )
    .bind(sid, day)
    .run();
  const uvDelta = sessionDayRes.meta.changes > 0 ? 1 : 0;

  // 每日汇总：新行 pv=1, uv=uvDelta；已存在则 pv+1, uv 加 uvDelta
  stmts.push(
    c.env.DB.prepare(
      `INSERT INTO visit_days (day, pv, uv) VALUES (?, 1, ?)
       ON CONFLICT(day) DO UPDATE SET pv = pv + 1, uv = uv + excluded.uv`
    ).bind(day, uvDelta)
  );

  // 每日每路径计数
  stmts.push(
    c.env.DB.prepare(
      `INSERT INTO visit_daily_paths (day, path, count) VALUES (?, ?, 1)
       ON CONFLICT(day, path) DO UPDATE SET count = count + 1`
    ).bind(day, path)
  );

  await c.env.DB.batch(stmts);
  return c.json({ ok: true, sid });
});

// ---------- GET /api/stats ----------
statsRoutes.get('/stats', async (c) => {
  const db = c.env.DB;
  const today = shanghaiDay();
  const yesterday = shanghaiDay(new Date(Date.now() - 86400000));
  const onlineCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const [
    totals,
    todayRow,
    yesterdayRow,
    daily,
    monthly,
    topPaths,
    online,
    firstDayRow,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT COALESCE(SUM(pv), 0) AS total_pv,
                (SELECT COUNT(DISTINCT sid) FROM visit_session_days) AS total_uv
         FROM visit_days`
      )
      .first(),
    db.prepare('SELECT pv, uv FROM visit_days WHERE day = ?').bind(today).first(),
    db.prepare('SELECT pv, uv FROM visit_days WHERE day = ?').bind(yesterday).first(),
    db.prepare(
      'SELECT day, pv, uv FROM visit_days ORDER BY day DESC LIMIT 30'
    ).all(),
    db.prepare(
      `SELECT substr(day, 1, 7) AS month, SUM(pv) AS pv, SUM(uv) AS uv
       FROM visit_days GROUP BY month ORDER BY month DESC LIMIT 12`
    ).all(),
    db.prepare(
      `SELECT path, SUM(count) AS views FROM visit_daily_paths
       GROUP BY path ORDER BY views DESC LIMIT 10`
    ).all(),
    db.prepare(
      'SELECT COUNT(*) AS n FROM visit_sessions WHERE last_seen > ?'
    )
      .bind(onlineCutoff)
      .first(),
    db.prepare('SELECT MIN(day) AS day FROM visit_days').first(),
  ]);

  return c.json({
    timezone: 'Asia/Shanghai (UTC+8)',
    since: firstDayRow?.day ?? null,
    totals: {
      pageViews: totals.total_pv,
      visitors: totals.total_uv,
    },
    today: {
      day: today,
      pageViews: todayRow?.pv ?? 0,
      visitors: todayRow?.uv ?? 0,
      yesterdayPv: yesterdayRow?.pv ?? 0,
      yesterdayUv: yesterdayRow?.uv ?? 0,
    },
    onlineNow: online.n,
    daily: daily.results.reverse(),
    monthly: monthly.results,
    topPaths: topPaths.results,
    generatedAt: new Date().toISOString(),
  });
});
