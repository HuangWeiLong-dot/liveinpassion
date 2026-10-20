import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { postsRoutes } from './routes/posts.js';
import { albumsRoutes } from './routes/albums.js';
import { uploadsRoutes } from './routes/uploads.js';
import { publicRoutes } from './routes/public.js';
import { statsRoutes } from './routes/stats.js';
import { lifeRoutes } from './routes/life.js';
import {
  getAuthUser,
  checkPassword,
  createSessionCookie,
  buildSessionSetCookie,
  buildClearCookie,
} from './lib/auth.js';
import { renderLoginPage } from './lib/loginPage.js';

const app = new Hono();

// CORS：public API 允许前台域名匿名读取
app.use('/api/*', cors({
  origin: ['https://liveinpassion.me', 'http://localhost:5173'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600,
}));

// 健康检查
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------- 图片 ----------
// GET /img/<R2 里的 key>：从桶里读出来发给浏览器。
//
// 为什么要多这一层（而不是继续直接用 img.liveinpassion.me）：
//   前台要把封面画进 canvas 当 **WebGL 贴图**（BLOGS 轨道那条曲面），而跨域像素会
//   污染 canvas、上传显存时直接抛 SecurityError。CDN 会不会回 ACAO 不由我们控制
//   （实测时好时坏、浏览器侧还会把网络失败报成"没有 ACAO"），worker 自己发就没有
//   这个不确定性 —— 而且它同时把 admin 里的图片预览也统一到了一条路上。
//
// 缓存：先查边缘缓存（Cache API），miss 才回源 R2，再写回缓存。
// 桶里的对象名本身带内容 hash、且上传时就写了 immutable，所以这里可以放心长缓存。
app.get('/img/*', async (c) => {
  const raw = c.req.path.slice('/img/'.length);
  let key = '';
  try {
    key = decodeURIComponent(raw);
  } catch {
    return c.json({ error: 'Bad key' }, 400);
  }
  if (!key) return c.notFound();

  const cache = caches.default;
  const cacheKey = new Request(new URL(c.req.url).toString(), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const obj = await c.env.IMG_BUCKET.get(key);
  if (!obj) return c.notFound();

  const res = new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      // 前台要把它画进 canvas：必须显式放行
      'Access-Control-Allow-Origin': '*',
      ETag: obj.httpEtag,
    },
  });
  // 写缓存不挡这次响应（waitUntil）
  c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()).catch(() => {}));
  return res;
});

// ---------- 自建登录（不依赖 cloudflareaccess.com，国内移动网络可用） ----------

// 登录失败限流：同一 IP 10 分钟内最多 10 次（Worker isolate 级 best-effort）
const loginHits = new Map();
const LOGIN_WINDOW = 10 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;

function clientIp(c) {
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
}

function loginAllowed(ip) {
  const now = Date.now();
  let rec = loginHits.get(ip);
  if (!rec || now - rec.first > LOGIN_WINDOW) rec = { first: now, fails: 0 };
  loginHits.set(ip, rec);
  if (loginHits.size > 5000) {
    for (const [k, v] of loginHits) if (now - v.first > LOGIN_WINDOW) loginHits.delete(k);
  }
  return rec.fails < LOGIN_MAX_FAILS;
}

function loginFailed(ip) {
  const rec = loginHits.get(ip);
  if (rec) rec.fails += 1;
}

// 仅允许站内相对路径，防开放重定向
function safeNext(value) {
  if (typeof value !== 'string') return '/admin/';
  if (/^\/[a-zA-Z0-9\-_./?=&%]*$/.test(value) && !value.startsWith('//')) return value;
  return '/admin/';
}

app.get('/login', async (c) => {
  if (await getAuthUser(c)) {
    return c.redirect(safeNext(c.req.query('next')));
  }
  return c.html(renderLoginPage({ next: c.req.query('next') || '/admin/' }));
});

app.post('/api/login', async (c) => {
  const ip = clientIp(c);
  const fail = (code) => {
    loginFailed(ip);
    return c.redirect(`/login?error=${code}&next=${encodeURIComponent(c._loginNext || '/admin/')}`);
  };

  if (!loginAllowed(ip)) {
    return c.redirect('/login?error=locked');
  }

  let password = '';
  let next = '/admin/';
  const ct = c.req.header('Content-Type') || '';
  try {
    if (ct.includes('application/json')) {
      const body = await c.req.json();
      password = body.password;
      next = body.next;
    } else {
      const params = new URLSearchParams(await c.req.text());
      password = params.get('password') || '';
      next = params.get('next') || '/admin/';
    }
  } catch {
    return c.redirect('/login?error=1');
  }
  c._loginNext = safeNext(next);

  const secret = c.env.CMS_PASSWORD;
  if (!secret) {
    console.error('CMS_PASSWORD secret is not configured — login impossible');
    return fail(1);
  }
  if (!(await checkPassword(secret, password))) {
    return fail(1);
  }

  const cookieValue = await createSessionCookie(c, secret);
  return new Response(null, {
    status: 302,
    headers: {
      Location: c._loginNext,
      'Set-Cookie': buildSessionSetCookie(cookieValue),
      'Cache-Control': 'no-store',
    },
  });
});

app.post('/api/logout', async (c) => {
  return new Response(null, {
    status: 302,
    headers: { Location: '/login', 'Set-Cookie': buildClearCookie(), 'Cache-Control': 'no-store' },
  });
});

// HTML 守卫：未登录访问 /admin* 一律跳本域登录页（API 由各路由的 requireAccessAuth 返回 401）
app.on('GET', ['/admin', '/admin/*'], async (c, next) => {
  const user = await getAuthUser(c);
  if (!user) {
    const target = c.req.path;
    return c.redirect(`/login?next=${encodeURIComponent(target)}`);
  }
  c.set('user', user);
  return next();
});

// 路由：admin 写操作在 /api/admin/*，public 只读在 /api/*
app.route('/api/admin/posts', postsRoutes);
app.route('/api/admin/albums', albumsRoutes);
app.route('/api/admin/uploads', uploadsRoutes);
app.route('/api', statsRoutes);
app.route('/api', publicRoutes);
app.route('/api', lifeRoutes);

// 管理后台静态资源（Workers Assets）
// admin 构建时 base='/admin/'，产物在 admin-dist/ 下
async function serveAdmin(c) {
  const url = new URL(c.req.url);
  // 去掉 /admin 前缀，映射到 assets 根
  let path = url.pathname.replace(/^\/admin/, '') || '/';
  if (path === '') path = '/';
  const assetUrl = new URL(path, url.origin);
  const res = await c.env.ASSETS.fetch(assetUrl.toString());
  // SPA 回退：静态资源不存在时返回 index.html
  if (res.status === 404 && !path.includes('.')) {
    const indexUrl = new URL('/', url.origin);
    return c.env.ASSETS.fetch(indexUrl.toString());
  }
  return res;
}

app.get('/admin', serveAdmin);
app.get('/admin/*', serveAdmin);

export default app;
