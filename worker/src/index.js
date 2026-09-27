import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { postsRoutes } from './routes/posts.js';
import { albumsRoutes } from './routes/albums.js';
import { uploadsRoutes } from './routes/uploads.js';
import { publicRoutes } from './routes/public.js';

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

// 路由：admin 写操作在 /api/admin/*，public 只读在 /api/*
app.route('/api/admin/posts', postsRoutes);
app.route('/api/admin/albums', albumsRoutes);
app.route('/api/admin/uploads', uploadsRoutes);
app.route('/api', publicRoutes);

// 临时诊断端点：逐步执行 Access JWT 验证，定位失败环节（验证完成后删除）
function b64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return atob((str + pad).replace(/-/g, '+').replace(/_/g, '/'));
}

app.get('/api/admin/auth-debug', async (c) => {
  const steps = [];
  const token = c.req.header('Cf-Access-Jwt-Assertion');
  if (!token) {
    return c.json({ failed_at: 'edge-header', note: 'Edge did not inject Cf-Access-Jwt-Assertion', steps });
  }
  steps.push('jwt-header-present');

  const parts = token.split('.');
  if (parts.length !== 3) {
    return c.json({ failed_at: 'jwt-format', parts: parts.length, steps });
  }
  steps.push(`jwt-format-ok lens=${parts[0].length}/${parts[1].length}/${parts[2].length}`);

  try {
    const payload = JSON.parse(b64url(parts[1]));
    steps.push(`payload-decoded aud=${payload.aud} exp=${payload.exp} email=${payload.email}`);
    if (payload.exp * 1000 < Date.now()) {
      return c.json({ failed_at: 'jwt-expired', exp: payload.exp, now: Date.now(), steps });
    }
    steps.push('not-expired');
  } catch (e) { return c.json({ failed_at: 'payload-decode', error: String(e), steps }); }

  let certs;
  try {
    const res = await fetch(`https://${c.env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
    steps.push(`certs-fetch status=${res.status}`);
    if (!res.ok) return c.json({ failed_at: 'certs-fetch', status: res.status, steps });
    certs = await res.json();
    steps.push(`certs-parsed count=${certs.keys?.length}`);
  } catch (e) { return c.json({ failed_at: 'certs-fetch-throw', error: String(e), teamDomain: c.env.ACCESS_TEAM_DOMAIN, steps }); }

  let header;
  try {
    header = JSON.parse(b64url(parts[0]));
    steps.push(`header-decoded kid=${header.kid} alg=${header.alg}`);
  } catch (e) { return c.json({ failed_at: 'header-decode', error: String(e), steps }); }

  const key = certs.keys.find((k) => k.kid === header.kid);
  if (!key) {
    return c.json({
      failed_at: 'kid-match',
      tokenKid: header.kid,
      certKids: certs.keys.map((k) => k.kid),
      steps,
    });
  }
  steps.push('kid-matched');

  try {
    const cryptoKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    steps.push('import-key-ok');
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const sigBytes = b64url(parts[2]);
    const signature = new Uint8Array(Array.from(sigBytes).map((ch) => ch.charCodeAt(0)));
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, data);
    steps.push(`verify-result=${valid}`);
    return c.json({ result: valid ? 'ALL-OK' : 'signature-invalid', steps });
  } catch (e) {
    return c.json({ failed_at: 'crypto', error: String(e), steps });
  }
});

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
