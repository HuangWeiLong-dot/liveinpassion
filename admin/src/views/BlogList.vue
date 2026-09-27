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
  if (!confirm(`确定删除「${post.title}」？`)) return;
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

onMounted(load);
</script>

<template>
  <div>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
      <h1 style="font-size:28px;">博客管理</h1>
      <button class="btn btn-primary" @click="router.push('/blogs/new')">+ 新建文章</button>
    </div>

    <div v-if="loading" style="color:#6e6e73;">加载中...</div>
    <div v-else-if="error" class="card" style="color:#ff3b30;">{{ error }}</div>
    <div v-else class="card">
      <table style="width:100%; border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid #e5e5e7; text-align:left;">
            <th style="padding:12px 8px;">标题</th>
            <th style="padding:12px 8px;">Slug</th>
            <th style="padding:12px 8px;">状态</th>
            <th style="padding:12px 8px;">阅读时长</th>
            <th style="padding:12px 8px;">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in posts" :key="p.id" style="border-bottom:1px solid #f0f0f2;">
            <td style="padding:12px 8px;">
              <a href="#" @click.prevent="router.push(`/blogs/${p.id}`)" style="color:#0071e3; text-decoration:none; font-weight:500;">{{ p.title }}</a>
            </td>
            <td style="padding:12px 8px; color:#6e6e73; font-family:monospace; font-size:13px;">{{ p.slug }}</td>
            <td style="padding:12px 8px;">
              <span :class="['tag', p.status === 'published' ? 'tag-published' : 'tag-draft']">{{ p.status === 'published' ? '已发布' : '草稿' }}</span>
            </td>
            <td style="padding:12px 8px; color:#6e6e73;">{{ p.readTimeMin }} min</td>
            <td style="padding:12px 8px;">
              <button class="btn btn-secondary" style="margin-right:8px;" @click="toggleStatus(p)">
                {{ p.status === 'published' ? '撤回' : '发布' }}
              </button>
              <button class="btn btn-danger" @click="removePost(p)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="posts.length === 0" style="padding:32px; text-align:center; color:#6e6e73;">暂无文章</div>
    </div>
  </div>
</template>
