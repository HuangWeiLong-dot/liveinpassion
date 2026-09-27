<script setup>
import { ref, onMounted, computed } from 'vue';
import { albumApi, uploadApi } from '../api.js';
import { compressImage } from '../utils/imageCompress.js';

const albums = ref([]);
const activeAlbumId = ref(null);
const photos = ref([]);
const loading = ref(false);
const error = ref('');

// 新建相册
const showNewAlbum = ref(false);
const newAlbum = ref({ r2Prefix: '', name: '', kind: 'friend' });

// 批量上传
const uploading = ref(false);
const uploadProgress = ref(0);
const uploadTotal = ref(0);
const uploadSuccess = ref(0);
const uploadFailed = ref([]);

const activeAlbum = computed(() => albums.value.find((a) => a.id === activeAlbumId.value));

async function loadAlbums() {
  try {
    const data = await albumApi.list();
    albums.value = data.albums;
    if (albums.value.length && !activeAlbumId.value) {
      activeAlbumId.value = albums.value[0].id;
      await loadPhotos();
    }
  } catch (e) {
    error.value = e.message;
  }
}

async function loadPhotos() {
  if (!activeAlbumId.value) return;
  loading.value = true;
  try {
    const data = await albumApi.photos(activeAlbumId.value);
    photos.value = data.photos;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function createAlbum() {
  try {
    const res = await albumApi.create(newAlbum.value);
    newAlbum.value = { r2Prefix: '', name: '', kind: 'friend' };
    showNewAlbum.value = false;
    await loadAlbums();
    activeAlbumId.value = res.id;
    await loadPhotos();
  } catch (e) {
    alert(e.message);
  }
}

async function deleteAlbum() {
  if (!confirm(`Delete album "${activeAlbum.value.name}"? Photo records will be removed (R2 files are kept).`)) return;
  try {
    await albumApi.remove(activeAlbumId.value);
    activeAlbumId.value = null;
    photos.value = [];
    await loadAlbums();
  } catch (e) {
    alert(e.message);
  }
}

async function onFileSelect(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  const album = activeAlbum.value;
  if (!album) { alert('Select or create an album first'); return; }

  uploading.value = true;
  uploadProgress.value = 0;
  uploadTotal.value = files.length;
  uploadSuccess.value = 0;
  uploadFailed.value = [];

  const photoRecords = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const compressed = await compressImage(file);
      const result = await uploadApi.upload(file, compressed, album.kind === 'me' ? 'me' : 'album');
      photoRecords.push({
        fileName: file.name,
        originalKey: result.original.key,
        compressedKey: result.compressed ? result.compressed.key : null,
        sortOrder: photos.value.length + photoRecords.length,
      });
      uploadSuccess.value++;
    } catch (err) {
      uploadFailed.value.push({ name: file.name, error: err.message });
    }
    uploadProgress.value = i + 1;
  }

  if (photoRecords.length) {
    try {
      await albumApi.addPhotos(activeAlbumId.value, photoRecords);
    } catch (e) {
      alert(`Failed to write photo records: ${e.message}`);
    }
  }

  uploading.value = false;
  await loadPhotos();
  e.target.value = '';
}

async function removePhoto(photo) {
  if (!confirm(`Remove "${photo.fileName}" from this album? (R2 files are kept)`)) return;
  try {
    await albumApi.removePhoto(photo.id);
    await loadPhotos();
  } catch (e) {
    alert(e.message);
  }
}

// 拖拽排序
const dragIndex = ref(null);
function onDragStart(idx) { dragIndex.value = idx; }
function onDrop(targetIdx) {
  if (dragIndex.value === null || dragIndex.value === targetIdx) return;
  const list = [...photos.value];
  const [moved] = list.splice(dragIndex.value, 1);
  list.splice(targetIdx, 0, moved);
  photos.value = list;
  // 保存排序
  const orders = list.map((p, idx) => ({ id: p.id, sortOrder: idx }));
  albumApi.reorder(activeAlbumId.value, orders).catch((e) => alert(`Failed to save order: ${e.message}`));
  dragIndex.value = null;
}

onMounted(loadAlbums);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <div class="eyebrow">Content Management — 02</div>
        <h1>Albums</h1>
      </div>
      <button class="btn btn-primary" @click="showNewAlbum = !showNewAlbum">
        {{ showNewAlbum ? 'Hide Form' : '+ New Album' }}
      </button>
    </div>

    <div v-if="error" class="error-box">{{ error }}</div>

    <div v-if="showNewAlbum" class="panel" style="margin-bottom:20px;">
      <div class="new-album-grid">
        <div>
          <label class="field-label">R2 Prefix</label>
          <input v-model="newAlbum.r2Prefix" placeholder="LiJiaZu" />
        </div>
        <div>
          <label class="field-label">Name</label>
          <input v-model="newAlbum.name" placeholder="Li Jiazu" />
        </div>
        <div>
          <label class="field-label">Kind</label>
          <select v-model="newAlbum.kind">
            <option value="friend">Friend</option>
            <option value="group">Group</option>
            <option value="me">Me</option>
          </select>
        </div>
        <div class="new-album-actions">
          <button class="btn btn-primary" @click="createAlbum">Create</button>
        </div>
      </div>
    </div>

    <div class="album-layout">
      <!-- 相册列表 -->
      <aside class="panel album-list">
        <div class="album-list-head">Albums</div>
        <button
          v-for="a in albums" :key="a.id"
          class="album-item"
          :class="{ 'is-active': a.id === activeAlbumId }"
          @click="activeAlbumId = a.id; loadPhotos();"
        >
          <span class="album-item-name">{{ a.name }}</span>
          <span class="album-item-meta">{{ a.r2Prefix }} · {{ a.kind }}</span>
        </button>
        <div v-if="!albums.length" class="field-hint" style="padding:12px 16px;">No albums yet</div>
      </aside>

      <!-- 照片区 -->
      <section class="panel album-content">
        <div v-if="activeAlbum" class="album-toolbar">
          <div class="album-title">
            <span class="album-title-name">{{ activeAlbum.name }}</span>
            <span class="album-title-count">{{ photos.length }} PHOTOS</span>
          </div>
          <div class="album-toolbar-actions">
            <label class="btn btn-primary" :class="{ 'is-uploading': uploading }">
              {{ uploading ? `Uploading ${uploadProgress}/${uploadTotal}` : 'Upload Photos' }}
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden @change="onFileSelect" :disabled="uploading" />
            </label>
            <button class="btn btn-danger" @click="deleteAlbum">Delete Album</button>
          </div>
        </div>

        <div v-if="uploading" class="upload-status">
          <div class="upload-status-row">
            <span class="field-label" style="margin-bottom:0;">Uploading ——— {{ uploadProgress }} / {{ uploadTotal }}</span>
            <span class="upload-status-nums">OK {{ uploadSuccess }} · Failed {{ uploadFailed.length }}</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: uploadTotal ? (uploadProgress / uploadTotal * 100) + '%' : '0' }"></div>
          </div>
          <div v-for="f in uploadFailed" :key="f.name" class="upload-fail">{{ f.name }} — {{ f.error }}</div>
        </div>

        <div v-if="loading" class="loading-text">Loading ———</div>

        <div v-else-if="!activeAlbum" class="empty">
          <span class="empty-en">Select An Album</span>
          <span class="empty-cn">Pick an album from the left panel</span>
        </div>

        <div v-else-if="photos.length === 0" class="empty">
          <span class="empty-en">No Photos Yet</span>
          <span class="empty-cn">Click "Upload Photos" to add (batch supported)</span>
        </div>

        <div v-else class="photo-grid">
          <div v-for="(p, idx) in photos" :key="p.id"
               class="photo-cell"
               draggable="true"
               @dragstart="onDragStart(idx)"
               @dragover.prevent
               @drop="onDrop(idx)">
            <img :src="p.compressedUrl || p.originalUrl" :alt="p.fileName" draggable="false" />
            <span class="photo-index">{{ String(idx + 1).padStart(2, '0') }}</span>
            <button class="photo-remove" title="Remove from album" @click="removePhoto(p)">×</button>
          </div>
        </div>

        <div v-if="photos.length" class="drag-hint">Drag photos to reorder — order is saved automatically</div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.new-album-grid {
  display: grid; grid-template-columns: 1fr 1fr 1fr auto;
  gap: 16px; align-items: end;
}
.new-album-actions { padding-bottom: 1px; }
@media (max-width: 768px) {
  .new-album-grid { grid-template-columns: 1fr; }
}

.album-layout { display: flex; gap: 20px; align-items: flex-start; }
.album-list { width: 240px; flex-shrink: 0; padding: 0; }
.album-list-head {
  padding: 12px 16px; border-bottom: 1px solid var(--border);
  font-family: var(--font-display); font-weight: 500; font-size: 0.6rem;
  letter-spacing: 0.25em; text-transform: uppercase; color: var(--text-secondary);
}
.album-item {
  display: block; width: 100%; text-align: left;
  padding: 12px 16px; background: transparent; border: none; border-bottom: 1px solid var(--border);
  border-left: 2px solid transparent;
  cursor: pointer; transition: all 0.15s ease;
}
.album-item:last-of-type { border-bottom: none; }
.album-item:hover { background: var(--bg-secondary); }
.album-item.is-active { border-left-color: var(--text-primary); background: var(--bg-secondary); }
.album-item-name {
  display: block; font-family: var(--font-body); font-weight: 500;
  font-size: 0.78rem; color: var(--text-primary); letter-spacing: 0.03em;
}
.album-item.is-active .album-item-name { font-weight: 600; }
.album-item-meta {
  display: block; font-family: ui-monospace, 'Courier New', monospace;
  font-size: 0.62rem; color: var(--text-secondary); margin-top: 2px; letter-spacing: 0.02em;
}
.album-content { flex: 1; min-width: 0; }

.album-toolbar {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 20px; gap: 12px; flex-wrap: wrap;
}
.album-title { display: flex; align-items: baseline; gap: 10px; }
.album-title-name {
  font-family: var(--font-display); font-weight: 700; font-size: 1.1rem;
  letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-primary);
}
.album-title-count {
  font-family: var(--font-display); font-weight: 500; font-size: 0.6rem;
  letter-spacing: 0.2em; color: var(--text-secondary);
}
.album-toolbar-actions { display: flex; gap: 10px; }
.album-toolbar-actions input { display: none; }
.is-uploading { opacity: 0.6; cursor: wait; }

.upload-status {
  border: 1px solid var(--border); background: var(--bg-secondary);
  padding: 14px 16px; margin-bottom: 20px;
}
.upload-status-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.upload-status-nums { font-size: 0.65rem; color: var(--text-secondary); letter-spacing: 0.05em; }
.progress-track { height: 4px; background: var(--border); overflow: hidden; }
.progress-fill { height: 100%; background: var(--text-primary); transition: width 0.2s ease; }
.upload-fail { margin-top: 6px; font-size: 0.65rem; color: var(--danger); letter-spacing: 0.02em; }

.photo-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px;
}
.photo-cell {
  position: relative; aspect-ratio: 1; overflow: hidden;
  border: 1px solid var(--border); cursor: grab; background: var(--bg-secondary);
}
.photo-cell:active { cursor: grabbing; }
.photo-cell img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.3s ease; }
.photo-cell:hover img { transform: scale(1.04); }
.photo-index {
  position: absolute; left: 0; bottom: 0;
  padding: 1px 8px; background: var(--bg);
  font-family: var(--font-display); font-weight: 500; font-size: 0.55rem;
  letter-spacing: 0.15em; color: var(--text-secondary);
}
.photo-remove {
  position: absolute; top: 0; right: 0;
  width: 24px; height: 24px; border: none;
  background: var(--bg); color: var(--text-secondary);
  font-size: 14px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: all 0.2s ease;
}
.photo-cell:hover .photo-remove { opacity: 1; }
.photo-remove:hover { background: var(--danger); color: #fff; }

.drag-hint {
  margin-top: 16px; font-size: 0.62rem; color: var(--text-secondary);
  letter-spacing: 0.05em; opacity: 0.7;
}

/* 响应式 */
@media (max-width: 768px) {
  .album-layout { flex-direction: column; }

  /* 相册列表 → 横向滚动条 */
  .album-list {
    width: 100%; display: flex; overflow-x: auto; padding: 0;
    -webkit-overflow-scrolling: touch;
  }
  .album-list-head {
    display: flex; align-items: center; padding: 12px 16px;
    border-bottom: none; border-right: 1px solid var(--border); flex-shrink: 0;
    white-space: nowrap;
  }
  .album-item {
    border-bottom: none; border-right: 1px solid var(--border);
    border-left: none; border-top: 2px solid transparent;
    flex-shrink: 0; min-width: 140px;
  }
  .album-item.is-active { border-left: none; border-top-color: var(--text-primary); }

  .album-content { width: 100%; }
  .album-toolbar { flex-direction: column; align-items: flex-start; gap: 12px; }
  .photo-grid { grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
  .empty { padding: 32px 16px; }
}
</style>
