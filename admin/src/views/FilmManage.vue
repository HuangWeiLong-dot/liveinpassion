<script setup>
// 影片库。只管元数据：视频/封面已经在 R2 里，填 key 即可。
//
// path 是首页右侧展示卡片的跳转地址 —— 现有的《The Projection》指向 /projection。
// 以后加新片时，新片需要一个自己的页面（或外部链接），把地址填在这里。
import { onMounted, reactive, ref } from 'vue';
import { filmApi } from '../api.js';

const POSTER_BASE = 'https://cms.liveinpassion.me/img/';

const films = ref([]);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const notice = ref('');

const editingId = ref(null);
const showForm = ref(false);

const form = reactive({
  slug: '',
  title: '',
  subtitle: '',
  description: '',
  videoKey: '',
  posterKey: '',
  path: '/projection',
  status: 'draft',
  sortOrder: 0,
});

function resetForm() {
  editingId.value = null;
  Object.assign(form, {
    slug: '',
    title: '',
    subtitle: '',
    description: '',
    videoKey: '',
    posterKey: '',
    path: '/projection',
    status: 'draft',
    sortOrder: films.value.length,
  });
}

function startCreate() {
  resetForm();
  showForm.value = true;
}

function startEdit(film) {
  editingId.value = film.id;
  Object.assign(form, {
    slug: film.slug,
    title: film.title,
    subtitle: film.subtitle || '',
    description: film.description || '',
    videoKey: film.videoKey || '',
    posterKey: film.posterKey || '',
    path: film.path || '/projection',
    status: film.status,
    sortOrder: film.sortOrder || 0,
  });
  showForm.value = true;
}

function cancelForm() {
  showForm.value = false;
  resetForm();
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await filmApi.list();
    films.value = data.films || [];
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function submit() {
  saving.value = true;
  error.value = '';
  notice.value = '';
  try {
    const payload = {
      slug: form.slug.trim(),
      title: form.title.trim(),
      subtitle: form.subtitle,
      description: form.description,
      videoKey: form.videoKey.trim(),
      posterKey: form.posterKey.trim(),
      path: form.path.trim(),
      status: form.status,
      sortOrder: Number(form.sortOrder) || 0,
    };
    if (editingId.value) await filmApi.update(editingId.value, payload);
    else await filmApi.create(payload);
    notice.value = editingId.value ? 'Film updated.' : 'Film created.';
    showForm.value = false;
    resetForm();
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function remove(film) {
  if (!confirm(`Delete "${film.title}"? This removes the record, not the R2 files.`)) return;
  try {
    await filmApi.remove(film.id);
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

function posterUrl(film) {
  return film.posterKey ? POSTER_BASE + film.posterKey : '';
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <div class="eyebrow">Content Desk — 04 / Films</div>
        <h1>Films</h1>
      </div>
      <div class="page-head__side">
        <div class="meta-line">{{ films.length }} Films</div>
        <button class="btn btn-primary" @click="startCreate">+ New Film</button>
      </div>
    </div>

    <div v-if="error" class="error-box">{{ error }}</div>
    <div v-if="notice" class="notice-line">{{ notice }}</div>

    <!-- 新建 / 编辑 -->
    <section v-if="showForm" class="panel film-form">
      <div class="film-form__head">
        <span class="field-label">{{ editingId ? 'Edit film' : 'New film' }}</span>
        <button class="btn btn-sm btn-secondary" @click="cancelForm">Cancel</button>
      </div>

      <div class="film-form__grid">
        <label>
          <span class="field-label">Slug</span>
          <input v-model="form.slug" placeholder="the-projection" />
          <span class="field-hint">Lowercase letters, numbers, hyphens</span>
        </label>

        <label>
          <span class="field-label">Title</span>
          <input v-model="form.title" placeholder="The Projection" />
        </label>

        <label>
          <span class="field-label">Subtitle</span>
          <input v-model="form.subtitle" placeholder="A short film" />
        </label>

        <label>
          <span class="field-label">Card link (path)</span>
          <input v-model="form.path" placeholder="/projection" />
          <span class="field-hint">Where the showcase card links to; an internal path or an https:// URL</span>
        </label>

        <label>
          <span class="field-label">Video key (R2)</span>
          <input v-model="form.videoKey" placeholder="films/the-projection.mp4" />
        </label>

        <label>
          <span class="field-label">Poster key (R2)</span>
          <input v-model="form.posterKey" placeholder="films/the-projection-poster.jpg" />
        </label>

        <label>
          <span class="field-label">Status</span>
          <select v-model="form.status">
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </label>

        <label>
          <span class="field-label">Sort order</span>
          <input v-model.number="form.sortOrder" type="number" step="1" />
        </label>
      </div>

      <label>
        <span class="field-label">Description</span>
        <textarea v-model="form.description" rows="3" placeholder="Black and white. 1'18&quot;. Breathing only."></textarea>
      </label>

      <div class="film-form__actions">
        <button class="btn btn-primary" :disabled="saving" @click="submit">
          {{ saving ? 'Saving…' : (editingId ? 'Save Film' : 'Create Film') }}
        </button>
      </div>
    </section>

    <div v-if="loading" class="loading-text">Loading ———</div>

    <div v-else-if="films.length" class="film-list">
      <article v-for="film in films" :key="film.id" class="film-row">
        <span class="film-row__poster">
          <img v-if="posterUrl(film)" :src="posterUrl(film)" alt="" loading="lazy">
          <span v-else class="film-row__noimg">NO<br>POSTER</span>
        </span>

        <div class="film-row__body">
          <div class="film-row__title">
            {{ film.title }}
            <span :class="['tag', film.status === 'published' ? 'tag-published' : 'tag-draft']">
              {{ film.status === 'published' ? 'Published' : 'Draft' }}
            </span>
          </div>
          <div class="film-row__meta">
            <span>{{ film.slug }}</span>
            <i />
            <span>{{ film.path }}</span>
            <i />
            <span>{{ film.videoKey }}</span>
          </div>
          <p v-if="film.description" class="film-row__desc">{{ film.description }}</p>
        </div>

        <div class="film-row__actions">
          <button class="btn btn-sm btn-secondary" @click="startEdit(film)">Edit</button>
          <button class="btn btn-sm btn-danger" @click="remove(film)">Delete</button>
        </div>
      </article>
    </div>

    <div v-else class="empty">
      <span class="empty-en">No films yet</span>
      <span class="empty-cn">Click New Film to add the first one.</span>
    </div>
  </div>
</template>

<style scoped>
.notice-line {
  border-left: 3px solid var(--text-primary);
  padding: 10px 14px;
  margin-bottom: 22px;
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.06em;
}

.film-form {
  margin-bottom: 22px;
}

.film-form__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.film-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 20px;
  margin-bottom: 16px;
}

.film-form__actions {
  margin-top: 18px;
  display: flex;
  justify-content: flex-end;
}

.film-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  border-top: 1px solid var(--text-primary);
}

.film-row {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr) auto;
  gap: 18px;
  align-items: center;
  padding: 18px 0;
  border-bottom: 1px solid var(--border);
}

.film-row__poster {
  width: 92px;
  aspect-ratio: 3 / 2;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  display: grid;
  place-items: center;
  overflow: hidden;
}

.film-row__poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.film-row__noimg {
  font-family: var(--font-mono);
  font-size: 0.5rem;
  letter-spacing: 0.1em;
  text-align: center;
  color: var(--text-secondary);
  line-height: 1.5;
}

.film-row__body {
  min-width: 0;
}

.film-row__title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-display);
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.film-row__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 0.52rem;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.film-row__meta i {
  width: 1px;
  height: 9px;
  background: var(--border);
}

.film-row__desc {
  margin: 8px 0 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.film-row__actions {
  display: flex;
  gap: 6px;
}

@media (max-width: 720px) {
  .film-form__grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .film-row {
    grid-template-columns: 72px minmax(0, 1fr);
    gap: 12px;
  }

  .film-row__poster {
    width: 72px;
  }

  .film-row__actions {
    grid-column: 2 / -1;
  }
}
</style>
