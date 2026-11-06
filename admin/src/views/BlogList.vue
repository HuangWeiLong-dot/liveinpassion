<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { blogApi } from '../api.js';

const router = useRouter();
const posts = ref([]);
const loading = ref(true);
const error = ref('');

const publishedCount = computed(() => posts.value.filter((p) => p.status === 'published').length);
const coverBase = 'https://img.liveinpassion.me/';

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

function coverUrl(post) {
  // 列表只取压缩版封面；没有压缩版就留空，避免把原图拉进列表
  return post.coverKey ? coverBase + post.coverKey : '';
}

// D1 里的时间是不带时区的 UTC 字符串，按前台规则换算成北京时间再显示
function formatDate(ts) {
  if (!ts) return '—';
  const raw = String(ts);
  const iso = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : raw.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 10);
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${bj.getUTCFullYear()}.${pad(bj.getUTCMonth() + 1)}.${pad(bj.getUTCDate())}`;
}

function padIndex(i) {
  return String(i + 1).padStart(2, '0');
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <div class="eyebrow">Content Desk — 01 / Posts</div>
        <h1>Blog Posts</h1>
      </div>
      <div class="page-head__side">
        <div class="meta-line">
          {{ posts.length }} Posts <i>·</i> {{ publishedCount }} Published
        </div>
        <button class="btn btn-primary" @click="router.push('/blogs/new')">+ New Post</button>
      </div>
    </div>

    <div v-if="loading" class="loading-text">Loading ———</div>

    <div v-else-if="error" class="error-box">{{ error }}</div>

    <div v-else-if="posts.length" class="post-list">
      <article v-for="(p, i) in posts" :key="p.id" class="post-row">
        <span class="post-row__index">{{ padIndex(i) }}</span>

        <RouterLink :to="`/blogs/${p.id}`" class="post-row__cover" tabindex="-1" aria-hidden="true">
          <img v-if="coverUrl(p)" :src="coverUrl(p)" alt="" loading="lazy" decoding="async">
          <span v-else class="post-row__noimg">NO<br>COVER</span>
        </RouterLink>

        <div class="post-row__body">
          <RouterLink :to="`/blogs/${p.id}`" class="post-row__title">
            {{ p.cardTitle || p.title }}
          </RouterLink>
          <p class="post-row__sub">{{ p.title }}</p>
          <div class="post-row__meta">
            <span>{{ p.slug }}</span>
            <i />
            <span>{{ formatDate(p.publishedAt || p.createdAt) }}</span>
            <i />
            <span>{{ p.readTimeMin || 1 }} min read</span>
            <template v-if="p.category && p.category !== 'UNFILED'">
              <i />
              <span class="post-row__cat">{{ p.category }}</span>
            </template>
            <template v-if="p.rating && p.rating.grade">
              <i />
              <span class="post-row__rate">
                <strong>{{ p.rating.grade }}</strong>
                <span v-if="p.rating.score">· {{ Number(p.rating.score).toFixed(1) }}</span>
              </span>
            </template>
            <span :class="['post-row__status', p.status === 'published' ? 'is-published' : 'is-draft']">
              {{ p.status === 'published' ? 'Published' : 'Draft' }}
            </span>
          </div>
        </div>

        <div class="post-row__actions">
          <button class="btn btn-sm btn-secondary" @click="toggleStatus(p)">
            {{ p.status === 'published' ? 'Unpublish' : 'Publish' }}
          </button>
          <button class="btn btn-sm btn-danger" @click="removePost(p)">Delete</button>
        </div>
      </article>
    </div>

    <div v-else class="empty">
      <span class="empty-en">No Posts Yet</span>
      <span class="empty-cn">Create your first post with the button above</span>
    </div>
  </div>
</template>

<style scoped>
.meta-line i {
  display: inline-block;
  width: 3px;
  height: 3px;
  margin: 0 2px;
  background: currentColor;
  opacity: 0.5;
  vertical-align: middle;
}

.post-list { border-top: 1px solid var(--text-primary); }

.post-row {
  display: grid;
  grid-template-columns: 44px 96px minmax(0, 1fr) auto;
  align-items: center;
  gap: 20px;
  padding: 18px 12px;
  border-bottom: 1px solid var(--border);
  transition: background-color 0.18s ease, color 0.18s ease;
}
.post-row:hover { background: var(--text-primary); color: var(--bg); }

.post-row__index {
  font-family: var(--font-mono);
  font-size: 0.56rem;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
}
.post-row:hover .post-row__index { color: var(--bg); opacity: 0.6; }

.post-row__cover {
  position: relative;
  display: block;
  width: 96px;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  text-decoration: none;
}
.post-row:hover .post-row__cover { border-color: var(--bg); }
.post-row__cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s cubic-bezier(0.19, 1, 0.22, 1);
}
.post-row:hover .post-row__cover img { transform: scale(1.05); }

.post-row__noimg {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-size: 0.44rem;
  line-height: 1.5;
  letter-spacing: 0.14em;
  text-align: center;
  color: var(--text-secondary);
}

.post-row__body { min-width: 0; }

.post-row__title {
  display: block;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.3rem;
  line-height: 1.1;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: inherit;
  text-decoration: none;
}
.post-row:hover .post-row__title { color: var(--bg); }

.post-row__sub {
  margin-top: 4px;
  font-size: 0.76rem;
  line-height: 1.5;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.post-row:hover .post-row__sub { color: var(--bg); opacity: 0.62; }

.post-row__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 9px;
  font-family: var(--font-mono);
  font-size: 0.54rem;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}
.post-row__meta i {
  display: inline-block;
  width: 3px;
  height: 3px;
  background: currentColor;
  opacity: 0.45;
}
.post-row:hover .post-row__meta { color: var(--bg); }

.post-row__status {
  padding: 2px 7px;
  border: 1px solid currentColor;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 1;
}
.post-row__status.is-published {
  background: var(--text-primary);
  border-color: var(--text-primary);
  color: var(--bg);
}
.post-row__status.is-draft { border-style: dashed; }
.post-row:hover .post-row__status.is-published {
  background: var(--bg);
  border-color: var(--bg);
  color: var(--text-primary);
}

.post-row__actions {
  display: flex;
  gap: 8px;
  white-space: nowrap;
}
.post-row:hover .btn { border-color: var(--bg); color: var(--bg); }
.post-row:hover .btn:hover { background: var(--bg); color: var(--text-primary); }
.post-row:hover .btn-danger:hover { background: var(--danger); border-color: var(--danger); color: #fff; }

@media (max-width: 768px) {
  .post-row {
    grid-template-columns: 24px 64px minmax(0, 1fr);
    gap: 12px;
    padding: 14px 4px;
  }
  .post-row__cover { width: 64px; }
  .post-row__title { font-size: 1rem; letter-spacing: 0.05em; }
  .post-row__sub { display: none; }
  .post-row__meta { margin-top: 7px; gap: 6px; }
  .post-row__actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
    padding-top: 2px;
  }
}

.post-row__cat,
.post-row__rate {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 3px 7px;
  border-radius: 2px;
}
.post-row__cat {
  border: 1px solid rgba(255,255,255,0.14);
  opacity: 0.75;
}
.post-row__rate strong {
  font-weight: 700;
  color: var(--accent, #eaeaea);
}
</style>
