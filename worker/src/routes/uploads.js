// 文件上传路由
import { Hono } from 'hono';
import { requireAccessAuth } from '../lib/auth.js';
import { uploadImage, listAll } from '../lib/r2.js';

const app = new Hono();

// 列出 R2 指定前缀下的对象（供扫描脚本使用）
app.get('/list', requireAccessAuth, async (c) => {
  const bucket = c.env.IMG_BUCKET;
  const prefix = c.req.query('prefix') || '';
  const objects = await listAll(bucket, prefix);
  return c.json({
    objects: objects.map((o) => ({
      key: o.key,
      size: o.size,
      uploaded: o.uploaded,
    })),
  });
});

// 上传封面图或照片
// multipart/form-data: file (原图), compressed (压缩图，可选), type (blog/album/me)
app.post('/', requireAccessAuth, async (c) => {
  const bucket = c.env.IMG_BUCKET;
  const formData = await c.req.formData();

  const type = formData.get('type') || 'blog';
  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return c.json({ error: 'file is required' }, 400);
  }

  try {
    const data = await file.arrayBuffer();
    const result = await uploadImage(bucket, data, type, 'original');

    let compressedResult = null;
    const compressedFile = formData.get('compressed');
    if (compressedFile instanceof File) {
      const compData = await compressedFile.arrayBuffer();
      compressedResult = await uploadImage(bucket, compData, type, 'compressed');
    }

    return c.json({
      original: { key: result.key, url: result.url },
      compressed: compressedResult ? { key: compressedResult.key, url: compressedResult.url } : null,
    }, 201);
  } catch (err) {
    return c.json({ error: err.message }, 400);
  }
});

export const uploadsRoutes = app;
