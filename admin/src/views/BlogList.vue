<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { blogApi } from '../api.js';

const router = useRouter();
const posts = ref([]);
const loading = ref(true);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await blogApi.list();
    posts.value = data.posts;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function removePost(post) {
  if (!confirm(`Delete "${post.title}"? This cannot be undone.`)) return;
  try {
    await blogApi.remove(post.id);
    await load();
  } catch (e) {
    alert(e.message);
  }
}

async function toggleStatus(post) {
  const newStatus = post.status === 'published' ? 'draft' : 'published';
  try {
    await blogApi.setStatus(post.id, newStatus);
    post.status = newStatus;
  } catch (e) {
    alert(e.message);
  }
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <div class="eyebrow">Content Management — 01</div>
        <h1>Blog Posts</h1>
      </div>
      <button class="btn btn-primary" @click="router.push('/blogs/new')">+ New Post</button>
    </div>

    <div v-if="loading" class="loading-text">Loading ———</div>

    <div v-else-if="error" class="error-box">{{ error }}</div>

    <div v-else class="panel">
      <div v-if="posts.length" class="table-scroll">
        <table class="table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Slug</th>
            <th>Status</th>
            <th>Date</th>
            <th>Read</th>
            <th style="text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in posts" :key="p.id">
            <td>
              <a href="#" class="link" @click.prevent="router.push(`/blogs/${p.id}`)">{{ p.title }}</a>
            </td>
            <td class="cell-slug">{{ p.slug }}</td>
            <td>
              <span :class="['tag', p.status === 'published' ? 'tag-published' : 'tag-draft']">
                {{ p.status === 'published' ? 'Published' : 'Draft' }}
              </span>
            </td>
            <td class="cell-muted">{{ formatDate(p.publishedAt || p.createdAt) }}</td>
            <td class="cell-muted">{{ p.readTimeMin }} min</td>
            <td style="text-align:right; white-space:nowrap;">
              <button class="btn btn-sm btn-secondary" style="margin-right:8px;" @click="toggleStatus(p)">
                {{ p.status === 'published' ? 'Unpublish' : 'Publish' }}
              </button>
              <button class="btn btn-sm btn-danger" @click="removePost(p)">Delete</button>
            </td>
          </tr>
        </tbody>
        </table>
      </div>

      <div v-else class="empty">
        <span class="empty-en">No Posts Yet</span>
        <span class="empty-cn">Create your first post with the button above</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cell-slug { color: var(--text-secondary); font-family: ui-monospace, 'Courier New', monospace; font-size: 0.72rem; letter-spacing: 0.02em; }
.cell-muted { color: var(--text-secondary); font-size: 0.72rem; letter-spacing: 0.05em; }
.table-scroll { overflow-x: auto; margin: 0 -4px; padding: 0 4px; }
.table { min-width: 640px; }
@media (max-width: 768px) {
  .empty { padding: 32px 16px; }
}
</style>
