<script setup>
import { RouterLink, RouterView } from 'vue-router';

const year = new Date().getFullYear();
</script>

<template>
  <div class="admin-layout">
    <nav class="admin-nav">
      <RouterLink to="/" class="brand" aria-label="回到博客管理">
        <span class="brand-mark">LIVE IN PASSION</span>
        <span class="brand-sub">CONTENT DESK</span>
      </RouterLink>
      <div class="nav-links">
        <RouterLink to="/" class="nav-item">Posts <span class="nav-en">01</span></RouterLink>
        <RouterLink to="/albums" class="nav-item">Albums <span class="nav-en">02</span></RouterLink>
        <a href="https://liveinpassion.me" target="_blank" rel="noopener" class="nav-item nav-item--ghost">Site <span class="nav-en">↗</span></a>
      </div>
    </nav>
    <main class="admin-main">
      <RouterView />
    </main>
    <footer>
      <p>© {{ year }} LIVE IN PASSION. Be Brave. Be Genuine. Be Humble. And don't be a dick.</p>
    </footer>
  </div>
</template>

<style>
/* ============ 设计基调：印务车间 ============
   与前台 liveinpassion.me 同源：
   Oswald 大写宽字距标签 + Poppins 300 细体正文
   1px 发丝线框 / 悬停黑底反色 / 零圆角 */

* { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #FAFAFA;
  --bg-secondary: #F3F4F6;
  --text-primary: #1A1A1A;
  --text-secondary: #6B7280;
  --border: #E5E7EB;
  --accent: #3B82F6;
  --danger: #C62828;
  --font-display: 'Oswald', 'Poppins', sans-serif;
  --font-body: 'Poppins', sans-serif;
}

body {
  font-family: var(--font-body);
  background: var(--bg);
  color: var(--text-primary);
  font-weight: 300;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
}

::selection { background: var(--text-primary); color: var(--bg); }

/* ---------- 布局 ---------- */
.admin-layout { min-height: 100vh; display: flex; flex-direction: column; }

.admin-nav {
  display: flex; justify-content: space-between; align-items: center;
  padding: 0 32px; height: 64px;
  background: var(--bg); border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 10;
}

.brand { display: flex; flex-direction: column; text-decoration: none; line-height: 1.2; }
.brand-mark {
  font-family: var(--font-display); font-weight: 700; font-size: 0.95rem;
  letter-spacing: 0.2em; color: var(--text-primary);
}
.brand-sub {
  font-family: var(--font-display); font-weight: 500; font-size: 0.55rem;
  letter-spacing: 0.3em; color: var(--text-secondary); margin-top: 2px;
}

.nav-links { display: flex; }
.nav-item {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 64px; padding: 0 24px;
  text-decoration: none; border-bottom: 1px solid transparent; margin-bottom: -1px;
  transition: all 0.2s ease;
}
.nav-item .nav-en {
  font-family: var(--font-display); font-weight: 500; font-size: 0.55rem;
  letter-spacing: 0.25em; color: var(--text-secondary);
  transition: color 0.2s ease;
}
.nav-item { font-family: var(--font-display); font-weight: 600; font-size: 0.85rem; letter-spacing: 0.15em; text-transform: uppercase; color: var(--text-secondary); }
.nav-item:hover { background: var(--text-primary); color: var(--bg); }
.nav-item:hover .nav-en { color: var(--bg); opacity: 0.6; }
.nav-item.router-link-exact-active { color: var(--text-primary); border-bottom-color: var(--text-primary); }
.nav-item.router-link-exact-active .nav-en { color: var(--text-primary); opacity: 0.55; }
.nav-item--ghost { border-left: 1px solid var(--border); }

.admin-main { flex: 1; padding: 40px 32px; max-width: 1100px; width: 100%; margin: 0 auto; }

/* ---------- 页脚：与前台同款 ---------- */
footer {
  padding: 48px 64px;
  text-align: center;
  border-top: 1px solid var(--border);
}
footer p {
  font-size: 0.875rem;
  color: var(--text-secondary);
  font-weight: 300;
  letter-spacing: 0.02em;
  line-height: 1.7;
}

/* ---------- 页头 ---------- */
.page-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 28px; gap: 16px; }
.page-head .eyebrow {
  font-family: var(--font-display); font-weight: 500; font-size: 0.6rem;
  letter-spacing: 0.3em; text-transform: uppercase; color: var(--text-secondary);
  margin-bottom: 6px;
}
.page-head h1 {
  font-family: var(--font-display); font-weight: 700; font-size: 1.5rem;
  letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-primary); line-height: 1.2;
}

/* ---------- 面板（原 card） ---------- */
.panel {
  background: var(--bg); border: 1px solid var(--border);
  padding: 24px;
}

/* ---------- 按钮：悬停黑底反色，零圆角 ---------- */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 10px 20px;
  background: transparent; border: 1px solid var(--text-primary); color: var(--text-primary);
  font-family: var(--font-display); font-weight: 600; font-size: 0.65rem;
  letter-spacing: 0.2em; text-transform: uppercase;
  cursor: pointer; text-decoration: none;
  transition: all 0.2s ease;
  user-select: none;
}
.btn:hover { background: var(--text-primary); color: var(--bg); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn:disabled:hover { background: transparent; color: var(--text-primary); }

.btn-primary { background: var(--text-primary); color: var(--bg); }
.btn-primary:hover { background: transparent; color: var(--text-primary); }
.btn-primary:disabled:hover { background: var(--text-primary); color: var(--bg); }

.btn-secondary { border-color: var(--border); color: var(--text-secondary); }
.btn-secondary:hover { border-color: var(--text-primary); background: var(--text-primary); color: var(--bg); }

.btn-danger { border-color: var(--danger); color: var(--danger); }
.btn-danger:hover { background: var(--danger); border-color: var(--danger); color: #fff; }

.btn-sm { padding: 6px 12px; font-size: 0.55rem; }

/* ---------- 表单 ---------- */
label { display: block; }
.field-label {
  font-family: var(--font-display); font-weight: 500; font-size: 0.6rem;
  letter-spacing: 0.25em; text-transform: uppercase; color: var(--text-secondary);
  margin-bottom: 8px;
}
.field-hint {
  font-size: 0.65rem; color: var(--text-secondary); opacity: 0.7; margin-top: 6px; letter-spacing: 0.02em;
}
input, textarea, select {
  padding: 10px 12px;
  border: 1px solid var(--border); border-radius: 0;
  background: var(--bg); color: var(--text-primary);
  font-family: var(--font-body); font-weight: 300; font-size: 0.85rem; line-height: 1.6;
  width: 100%;
  transition: border-color 0.2s ease;
}
input:focus, textarea:focus, select:focus { outline: none; border-color: var(--text-primary); }
input::placeholder, textarea::placeholder { color: var(--text-secondary); opacity: 0.5; font-weight: 300; }
select { cursor: pointer; }

/* ---------- 表格 ---------- */
.table { width: 100%; border-collapse: collapse; }
.table th {
  font-family: var(--font-display); font-weight: 500; font-size: 0.6rem;
  letter-spacing: 0.2em; text-transform: uppercase; color: var(--text-secondary);
  text-align: left; padding: 0 12px 12px;
  border-bottom: 1px solid var(--text-primary);
}
.table td { padding: 14px 12px; border-bottom: 1px solid var(--border); font-size: 0.8rem; vertical-align: middle; }
.table tr:last-child td { border-bottom: none; }
.table tbody tr { transition: background 0.15s ease; }
.table tbody tr:hover { background: var(--bg-secondary); }

/* ---------- 标签：发布=实心黑，草稿=虚线校样章 ---------- */
.tag {
  display: inline-block; padding: 3px 10px;
  font-family: var(--font-display); font-weight: 600; font-size: 0.55rem;
  letter-spacing: 0.2em; text-transform: uppercase;
  border: 1px solid transparent;
}
.tag-published { background: var(--text-primary); color: var(--bg); }
.tag-draft { border: 1px dashed var(--text-secondary); color: var(--text-secondary); background: transparent; }

/* ---------- 空状态 ---------- */
.empty {
  padding: 48px 24px; text-align: center; border: 1px dashed var(--border);
}
.empty .empty-en {
  font-family: var(--font-display); font-weight: 500; font-size: 0.6rem;
  letter-spacing: 0.3em; text-transform: uppercase; color: var(--text-secondary); opacity: 0.6;
  display: block; margin-bottom: 6px;
}
.empty .empty-cn { font-size: 0.75rem; color: var(--text-secondary); letter-spacing: 0.05em; }

/* ---------- 提示 ---------- */
.error-box {
  border: 1px solid var(--danger); color: var(--danger);
  padding: 12px 16px; margin-bottom: 20px; font-size: 0.75rem; letter-spacing: 0.02em;
}
.loading-text {
  font-family: var(--font-display); font-weight: 500; font-size: 0.6rem;
  letter-spacing: 0.3em; text-transform: uppercase; color: var(--text-secondary);
  padding: 24px 0;
}

/* ---------- 链接 ---------- */
.link { color: var(--text-primary); text-decoration: none; border-bottom: 1px solid var(--text-primary); transition: all 0.2s ease; }
.link:hover { background: var(--text-primary); color: var(--bg); }

/* ---------- md-editor-v3 直角化 ---------- */
.md-editor { border-radius: 0 !important; --md-bk-color: var(--bg); }
.md-editor-default { border: 1px solid var(--border) !important; }

/* 滚动条 */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--border); }
::-webkit-scrollbar-thumb:hover { background: var(--text-secondary); }

/* ============ 响应式 ============ */

/* 平板 ≤1024px */
@media (max-width: 1024px) {
  .admin-main { padding: 32px 24px; }
  footer { padding: 40px 32px; }
}

/* 手机 ≤768px */
@media (max-width: 768px) {
  .admin-nav {
    padding: 0 16px; height: 56px;
  }
  .brand-mark { font-size: 0.8rem; letter-spacing: 0.15em; }
  .brand-sub { font-size: 0.5rem; letter-spacing: 0.22em; }
  .nav-item { height: 56px; padding: 0 14px; font-size: 0.72rem; }
  .nav-en { display: none; }
  .nav-item--ghost { border-left: none; }

  .admin-main { padding: 24px 16px; }
  .page-head { flex-wrap: wrap; align-items: flex-start; flex-direction: column; gap: 16px; }
  .page-head h1 { font-size: 1.2rem; }

  .panel { padding: 16px; }
  footer { padding: 32px 20px; }
  footer p { font-size: 0.78rem; }
}

/* 小屏手机 ≤480px */
@media (max-width: 480px) {
  .admin-main { padding: 20px 12px; }
  .page-head h1 { font-size: 1.05rem; }
  .btn { padding: 9px 14px; }
  .action-bar { flex-wrap: wrap; }
  .action-bar .btn { flex: 1; }
}
</style>
