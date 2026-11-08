// API 客户端：admin 接口走 /api/admin/*
const BASE = '';

// 会话失效（密码登录 cookie 过期/缺失）→ 回到本域登录页，登录后跳回当前页
function redirectToLogin() {
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (res.status === 401 || res.status === 403) {
    redirectToLogin();
    throw new Error('Session expired. Redirecting to sign in…');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// 博客
export const blogApi = {
  list: () => request('/api/admin/posts'),
  get: (id) => request(`/api/admin/posts/${id}`),
  create: (data) => request('/api/admin/posts', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/api/admin/posts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setStatus: (id, status) => request(`/api/admin/posts/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  remove: (id) => request(`/api/admin/posts/${id}`, { method: 'DELETE' }),
};

// 相册
export const albumApi = {
  list: () => request('/api/admin/albums'),
  create: (data) => request('/api/admin/albums', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/api/admin/albums/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id) => request(`/api/admin/albums/${id}`, { method: 'DELETE' }),
  photos: (id) => request(`/api/admin/albums/${id}/photos`),
  addPhotos: (id, photos) => request(`/api/admin/albums/${id}/photos`, { method: 'POST', body: JSON.stringify({ photos }) }),
  removePhoto: (photoId) => request(`/api/admin/albums/photos/${photoId}`, { method: 'DELETE' }),
  reorder: (id, orders) => request(`/api/admin/albums/${id}/photos/reorder`, { method: 'PUT', body: JSON.stringify({ orders }) }),
};

// 首页展示（LATEST ECHO / LATEST PHOTO / AUTHOR'S SELECTED）
export const showcaseApi = {
  get: () => request('/api/admin/showcase'),
  save: (data) => request('/api/admin/showcase', { method: 'PUT', body: JSON.stringify(data) }),
};

// 影片库（只管理元数据，视频/封面是 R2 key）
export const filmApi = {
  list: () => request('/api/admin/films'),
  create: (data) => request('/api/admin/films', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/api/admin/films/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id) => request(`/api/admin/films/${id}`, { method: 'DELETE' }),
};

// 分类 / 标签总览（只作用于已发布文章）
export const taxonomyApi = {
  get: () => request('/api/admin/taxonomy'),
  renameCategory: (from, to) => request('/api/admin/taxonomy/category', { method: 'PUT', body: JSON.stringify({ from, to }) }),
  deleteCategory: (name) => request('/api/admin/taxonomy/category', { method: 'DELETE', body: JSON.stringify({ name }) }),
  renameTag: (from, to) => request('/api/admin/taxonomy/tag', { method: 'PUT', body: JSON.stringify({ from, to }) }),
  deleteTag: (name) => request('/api/admin/taxonomy/tag', { method: 'DELETE', body: JSON.stringify({ name }) }),
  bulkUpdate: (payload) => request('/api/admin/taxonomy/posts', { method: 'PUT', body: JSON.stringify(payload) }),
};

// 上传
export const uploadApi = {
  upload: async (file, compressedFile, type) => {
    const form = new FormData();
    form.append('file', file);
    if (compressedFile) form.append('compressed', compressedFile);
    form.append('type', type);
    const res = await fetch(`${BASE}/api/admin/uploads`, { method: 'POST', body: form });
    if (res.status === 401 || res.status === 403) {
      redirectToLogin();
      throw new Error('Session expired. Redirecting to sign in…');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },
};
