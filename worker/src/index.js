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
