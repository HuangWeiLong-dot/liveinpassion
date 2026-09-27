<script setup>
import { RouterLink, RouterView } from 'vue-router';
</script>

<template>
  <div class="admin-layout">
    <nav class="admin-nav">
      <RouterLink to="/">博客</RouterLink>
      <RouterLink to="/albums">相册</RouterLink>
    </nav>
    <main class="admin-main">
      <RouterView />
    </main>
  </div>
</template>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f7; color: #1d1d1f; }
.admin-layout { min-height: 100vh; display: flex; flex-direction: column; }
.admin-nav { display: flex; gap: 24px; padding: 16px 32px; background: #fff; border-bottom: 1px solid #e5e5e7; position: sticky; top: 0; z-index: 10; }
.admin-nav a { text-decoration: none; color: #6e6e73; font-weight: 500; font-size: 15px; }
.admin-nav a.router-link-active { color: #0071e3; }
.admin-main { flex: 1; padding: 32px; max-width: 1100px; width: 100%; margin: 0 auto; }
.btn { padding: 8px 16px; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; font-weight: 500; }
.btn-primary { background: #0071e3; color: #fff; }
.btn-primary:hover { background: #0077ed; }
.btn-danger { background: #ff3b30; color: #fff; }
.btn-secondary { background: #e8e8ed; color: #1d1d1f; }
.btn-secondary:hover { background: #d8d8dd; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
input, textarea { padding: 8px 12px; border: 1px solid #d2d2d7; border-radius: 8px; font-size: 14px; font-family: inherit; width: 100%; }
input:focus, textarea:focus { outline: none; border-color: #0071e3; }
.card { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.tag { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 12px; font-weight: 500; }
.tag-draft { background: #ffebee; color: #c62828; }
.tag-published { background: #e8f5e9; color: #2e7d32; }
</style>
