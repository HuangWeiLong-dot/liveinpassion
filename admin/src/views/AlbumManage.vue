<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { albumApi, uploadApi } from '../api.js';
import { compressImage } from '../utils/imageCompress.js';
import { startPressDrag } from '../utils/pressDrag.js';
import AdminIcon from '../components/AdminIcon.vue';

const albums = ref([]);
const activeAlbumId = ref(null);
const photos = ref([]);
const loading = ref(false);
const error = ref('');

// 新建相册
const showNewAlbum = ref(false);
const newAlbum = ref({ r2Prefix: '', name: '', kind: 'friend', person: '' });

// photography 相册：人名既是 /photography/:person 的路由段，也是 R2 子目录。
// 填人名时自动把 R2 Prefix 拼成 photography/<人名>，用户仍可手动改。
function personSlug(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

watch(
  () => [newAlbum.value.kind, newAlbum.value.person],
  ([kind, person]) => {
    if (kind !== 'photography') return;
    const slug = personSlug(person);
    if (slug) newAlbum.value.r2Prefix = `photography/${slug}`;
  }
);

// 上传前缀：photography 相册把照片写进 photography/<人名>/<yyyyMM>/，
// 和相册的 r2Prefix 对齐；其它相册沿用原来的 album / me。
function uploadType(album) {
  if (!album) return 'album';
  if (album.kind === 'me') return 'me';
  if (album.kind === 'photography') {
    const person = album.person || String(album.r2Prefix || '').replace(/^photography\//, '');
    return person ? `photography/${person}` : 'album';
  }
  return 'album';
}

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
    // Worker 返回的是 D1 原始列（r2_prefix），统一成前端用的驼峰字段
    albums.value = data.albums.map((a) => ({
      ...a,
      r2Prefix: a.r2Prefix ?? a.r2_prefix ?? '',
    }));
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

function selectAlbum(album) {
  if (album.id === activeAlbumId.value) return;
  activeAlbumId.value = album.id;
  loadPhotos();
}

async function createAlbum() {
  try {
    const payload = { ...newAlbum.value };
    if (payload.kind === 'photography') {
      if (!payload.person.trim()) { alert('Person is required for photography albums'); return; }
      if (!payload.r2Prefix.trim()) payload.r2Prefix = `photography/${personSlug(payload.person)}`;
      if (!payload.name.trim()) payload.name = payload.person.trim();
    }
    const res = await albumApi.create(payload);
    newAlbum.value = { r2Prefix: '', name: '', kind: 'friend', person: '' };
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
      const result = await uploadApi.upload(file, compressed, uploadType(album));
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

// 拖拽排序：见 utils/pressDrag.js —— 鼠标按下即拖，触摸长按 300ms 起拖。
// 落地前只高亮目标、不重排列表：拖动中重排 DOM 会让 Pointer Events 的隐式捕获失效，
// 手指还没松指针就不再上报了。
const dragIndex = ref(null);
const dragOverIndex = ref(null);

function onCellPointerDown(idx, e) {
  if (dragIndex.value !== null) return;
  if (e.pointerType === 'mouse') e.preventDefault(); // 挡掉选中与原生图片拖拽
  startPressDrag(e, {
    onEngage: () => {
      dragIndex.value = idx;
      dragOverIndex.value = idx;
    },
    onMove: (x, y) => {
      const cell = document.elementFromPoint(x, y)?.closest?.('.photo-cell');
      const i = cell ? Number(cell.dataset.idx) : NaN;
      if (!Number.isNaN(i)) dragOverIndex.value = i;
    },
    onDrop: () => {
      const from = dragIndex.value;
      const to = dragOverIndex.value;
      dragIndex.value = null;
      dragOverIndex.value = null;
      if (from === null || to === null || from === to) return;
      const list = [...photos.value];
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      photos.value = list;
      // 保存排序
      const orders = list.map((p, i) => ({ id: p.id, sortOrder: i }));
      albumApi.reorder(activeAlbumId.value, orders).catch((err) => alert(`Failed to save order: ${err.message}`));
    },
    onCancel: () => {
      dragIndex.value = null;
      dragOverIndex.value = null;
    },
  });
}

function padIndex(i) {
  return String(i + 1).padStart(2, '0');
}

onMounted(loadAlbums);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <div class="eyebrow">Content Desk — 02 / Albums</div>
        <h1>Albums</h1>
      </div>
      <div class="page-head__side">
        <div class="meta-line">{{ albums.length }} Albums</div>
        <button class="btn btn-primary" @click="showNewAlbum = !showNewAlbum">
          {{ showNewAlbum ? 'Close Form' : '+ New Album' }}
        </button>
      </div>
    </div>

    <div v-if="error" class="error-box">{{ error }}</div>

    <div v-if="showNewAlbum" class="panel new-album-panel">
      <div class="new-album-grid">
        <div>
          <label class="field-label">01 / R2 Prefix</label>
          <input v-model="newAlbum.r2Prefix" placeholder="LiJiaZu" />
        </div>
        <div>
          <label class="field-label">02 / Name</label>
          <input v-model="newAlbum.name" placeholder="Li Jiazu" />
        </div>
        <div>
          <label class="field-label">03 / Kind</label>
          <select v-model="newAlbum.kind">
            <option value="friend">Friend</option>
            <option value="group">Group</option>
            <option value="me">Me</option>
            <option value="photography">Photography</option>
          </select>
        </div>
        <div v-if="newAlbum.kind === 'photography'">
          <label class="field-label">04 / Person</label>
          <input v-model="newAlbum.person" placeholder="Han Yong" />
        </div>
        <div class="new-album-actions">
          <button class="btn btn-primary" @click="createAlbum">Create</button>
        </div>
      </div>
    </div>

    <div class="album-layout">
      <!-- 相册索引 -->
      <aside class="album-index">
        <div class="album-index__head">Index <span>{{ albums.length }}</span></div>
        <button
          v-for="(a, i) in albums" :key="a.id"
          class="album-item"
          :class="{ 'is-active': a.id === activeAlbumId }"
          @click="selectAlbum(a)"
        >
          <span class="album-item__no">{{ padIndex(i) }}</span>
          <span class="album-item__body">
            <span class="album-item__name">{{ a.name }}</span>
            <span class="album-item__meta">{{ a.r2Prefix }} · {{ a.kind }}</span>
          </span>
        </button>
        <div v-if="!albums.length" class="album-index__empty">No albums yet</div>
      </aside>

      <!-- 照片区 -->
      <section class="album-content">
        <div v-if="activeAlbum" class="album-toolbar">
          <div class="album-title">
            <span class="album-title-name">{{ activeAlbum.name }}</span>
            <span class="album-title-count">{{ photos.length }} Photos</span>
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
          <span class="empty-cn">Pick an album from the index</span>
        </div>

        <div v-else-if="photos.length === 0" class="empty">
          <span class="empty-en">No Photos Yet</span>
          <span class="empty-cn">Click "Upload Photos" to add (batch supported)</span>
        </div>

        <div v-else class="photo-grid" @contextmenu.prevent>
          <div v-for="(p, idx) in photos" :key="p.id"
               class="photo-cell"
               :class="{ 'is-dragging': dragIndex === idx, 'is-drop-target': dragIndex !== null && dragOverIndex === idx && dragIndex !== idx }"
               :data-idx="idx"
               @pointerdown="onCellPointerDown(idx, $event)">
            <img :src="p.compressedUrl || p.originalUrl" :alt="p.fileName" draggable="false"
                 loading="lazy" decoding="async" fetchpriority="low" />
            <span class="photo-index">{{ padIndex(idx) }}</span>
            <button class="photo-remove" title="Remove from album" aria-label="Remove from album" @click="removePhoto(p)"><AdminIcon name="x" :size="12" /></button>
          </div>
        </div>

        <div v-if="photos.length" class="drag-hint">
          Drag to reorder (long-press on touch) — order is saved automatically
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.new-album-panel { margin-bottom: 24px; }
.new-album-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
  gap: 18px;
  align-items: end;
}
.new-album-actions { padding-bottom: 1px; }
@media (max-width: 768px) {
  .new-album-grid { grid-template-columns: 1fr; }
}

.album-layout { display: flex; gap: 28px; align-items: flex-start; }

/* 相册索引：像前台画廊的筛选列表，当前项整条反色 */
.album-index {
  width: 250px;
  flex-shrink: 0;
  border-top: 1px solid var(--text-primary);
}
.album-index__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 0.55rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-secondary);
}
.album-index__empty {
  padding: 14px 4px;
  font-family: var(--font-mono);
  font-size: 0.58rem;
  color: var(--text-secondary);
}
.album-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  padding: 12px 10px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  transition: background-color 0.16s ease, color 0.16s ease;
}
.album-item:hover { background: var(--text-primary); color: var(--bg); }
.album-item.is-active { background: var(--text-primary); color: var(--bg); }
.album-item__no {
  font-family: var(--font-mono);
  font-size: 0.52rem;
  letter-spacing: 0.08em;
  opacity: 0.55;
  flex-shrink: 0;
}
.album-item__body { min-width: 0; }
.album-item__name {
  display: block;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 0.95rem;
  line-height: 1.15;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.album-item__meta {
  display: block;
  margin-top: 3px;
  font-family: var(--font-mono);
  font-size: 0.5rem;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}
.album-item.is-active .album-item__meta,
.album-item:hover .album-item__meta { color: var(--bg); opacity: 0.8; }

.album-content { flex: 1; min-width: 0; }

.album-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 14px;
  flex-wrap: wrap;
  padding-bottom: 16px;
  margin-bottom: 18px;
  border-bottom: 1px solid var(--border);
}
.album-title { display: flex; align-items: baseline; gap: 12px; }
.album-title-name {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 1.35rem;
  line-height: 1;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-primary);
}
.album-title-count {
  font-family: var(--font-mono);
  font-size: 0.54rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-secondary);
}
.album-toolbar-actions { display: flex; gap: 10px; }
.album-toolbar-actions input { display: none; }
.is-uploading { opacity: 0.6; cursor: wait; }

.upload-status {
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  padding: 14px 16px;
  margin-bottom: 20px;
}
.upload-status-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; }
.upload-status-nums {
  font-family: var(--font-mono);
  font-size: 0.54rem;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
}
.progress-track { height: 2px; background: var(--border); overflow: hidden; }
.progress-fill { height: 100%; background: var(--text-primary); transition: width 0.2s ease; }
.upload-fail {
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 0.56rem;
  letter-spacing: 0.02em;
  color: var(--danger);
}

/* 窗户墙：3:4 竖窗、1px 窗框、悬停才跑行军蚁 */
.photo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 10px;
}
.photo-cell {
  position: relative;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  cursor: grab;
  transition: border-color 0.25s ease, opacity 0.25s ease;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
.photo-cell:active { cursor: grabbing; }
.photo-cell:hover { border-color: var(--text-primary); }
.photo-cell img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.82;
  transition: transform 0.45s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.3s ease;
}
.photo-cell:hover img { transform: scale(1.05); opacity: 1; }
.photo-cell.is-dragging { opacity: 0.5; }
.photo-cell.is-drop-target { outline: 2px solid var(--text-primary); outline-offset: -2px; }

/* 行军蚁描边：只给指针下那一格挂动画，几十张照片不会一起跑 */
.photo-cell::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  opacity: 0;
  background-image:
    linear-gradient(90deg, #000 50%, #fff 50%),
    linear-gradient(90deg, #000 50%, #fff 50%),
    linear-gradient(0deg, #000 50%, #fff 50%),
    linear-gradient(0deg, #000 50%, #fff 50%);
  background-repeat: repeat-x, repeat-x, repeat-y, repeat-y;
  background-size: 8px 1px, 8px 1px, 1px 8px, 1px 8px;
  background-position: 0 0, 0 100%, 0 0, 100% 0;
  transition: opacity 0.2s ease;
}
.photo-cell:hover::after {
  opacity: 1;
  animation: photo-ants 0.45s linear infinite;
}
@keyframes photo-ants {
  to { background-position: 8px 0, -8px 100%, 0 -8px, 100% 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .photo-cell:hover::after { animation: none; }
}

.photo-index {
  position: absolute;
  left: 0;
  bottom: 0;
  z-index: 3;
  padding: 1px 6px;
  background: var(--bg);
  font-family: var(--font-mono);
  font-size: 0.48rem;
  line-height: 1.5;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
}
.photo-remove {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 3;
  width: 24px;
  height: 24px;
  border: none;
  background: var(--bg);
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: background-color 0.2s ease, color 0.2s ease, opacity 0.2s ease;
}
.photo-cell:hover .photo-remove { opacity: 1; }
.photo-remove:focus-visible { opacity: 1; }
.photo-remove:hover { background: var(--danger); color: var(--bg); }

/* 触屏：没有 hover，24px 隐形按钮既点不到也会误触 —— 常显并放大到可点尺寸 */
@media (hover: none) {
  .photo-remove {
    opacity: 1;
    width: 44px;
    height: 44px;
    font-size: 22px;
    background: rgba(0, 0, 0, 0.45);
    color: #fff;
    border-radius: 0 0 0 44px;
  }
  .photo-cell:hover img { transform: none; }
}

.drag-hint {
  margin-top: 16px;
  font-family: var(--font-mono);
  font-size: 0.55rem;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  opacity: 0.7;
}

/* 响应式 */
@media (max-width: 900px) {
  .album-layout { flex-direction: column; gap: 20px; }

  /* 相册索引 → 横向滚动条 */
  .album-index {
    width: 100%;
    display: flex;
    overflow-x: auto;
    border-top: 1px solid var(--text-primary);
    scrollbar-width: none;
  }
  .album-index::-webkit-scrollbar { display: none; }
  .album-index__head {
    flex-shrink: 0;
    padding: 12px 14px;
    border-bottom: none;
    border-right: 1px solid var(--border);
    white-space: nowrap;
  }
  .album-index__empty { padding: 12px 14px; }
  .album-item {
    flex-shrink: 0;
    width: auto;
    min-width: 150px;
    border-bottom: none;
    border-right: 1px solid var(--border);
    padding: 12px 14px;
  }

  .album-content { width: 100%; }
  .album-toolbar { flex-direction: column; align-items: flex-start; gap: 14px; }
  .photo-grid { grid-template-columns: repeat(auto-fill, minmax(102px, 1fr)); gap: 8px; }
  .empty { padding: 36px 16px; }
}
</style>