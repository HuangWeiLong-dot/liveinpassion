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
  if (!confirm(`确定删除相册「${activeAlbum.value.name}」？照片记录会一并删除（R2 文件保留）`)) return;
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
  if (!album) { alert('请先选择或创建相册'); return; }

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
      alert(`照片记录写入失败：${e.message}`);
    }
  }

  uploading.value = false;
  await loadPhotos();
  e.target.value = '';
}

async function removePhoto(photo) {
  if (!confirm(`从相册移除「${photo.fileName}」？（R2 文件保留）`)) return;
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
  albumApi.reorder(activeAlbumId.value, orders).catch((e) => alert(e.message));
  dragIndex.value = null;
}

onMounted(loadAlbums);
</script>

<template>
  <div>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
      <h1 style="font-size:28px;">相册管理</h1>
      <button class="btn btn-primary" @click="showNewAlbum = !showNewAlbum">+ 新建相册</button>
    </div>

    <div v-if="showNewAlbum" class="card" style="margin-bottom:16px;">
      <div style="display:grid; grid-template-columns: 1fr 1fr 1fr auto; gap:12px; align-items:end;">
        <div>
          <label style="display:block; font-size:13px; color:#6e6e73; margin-bottom:6px;">R2 前缀</label>
          <input v-model="newAlbum.r2Prefix" placeholder="LiJiaZu" />
        </div>
        <div>
          <label style="display:block; font-size:13px; color:#6e6e73; margin-bottom:6px;">名称</label>
          <input v-model="newAlbum.name" placeholder="Li Jiazu" />
        </div>
        <div>
          <label style="display:block; font-size:13px; color:#6e6e73; margin-bottom:6px;">类型</label>
          <select v-model="newAlbum.kind" style="padding:8px; border-radius:8px; width:100%;">
            <option value="friend">朋友</option>
            <option value="group">合影</option>
            <option value="me">Me</option>
          </select>
        </div>
        <button class="btn btn-primary" @click="createAlbum">创建</button>
      </div>
    </div>

    <div style="display:flex; gap:24px;">
      <!-- 相册列表 -->
      <div class="card" style="width:240px; flex-shrink:0; align-self:flex-start;">
        <div v-for="a in albums" :key="a.id"
             @click="activeAlbumId = a.id; loadPhotos();"
             :style="{ padding:'12px', borderRadius:'8px', cursor:'pointer', marginBottom:'4px', background: a.id === activeAlbumId ? '#f0f7ff' : 'transparent' }">
          <div style="font-weight:500;">{{ a.name }}</div>
          <div style="font-size:12px; color:#6e6e73;">{{ a.r2Prefix }} · {{ a.kind }}</div>
        </div>
      </div>

      <!-- 照片网格 -->
      <div class="card" style="flex:1;">
        <div v-if="activeAlbum" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <h2 style="font-size:18px;">{{ activeAlbum.name }}（{{ photos.length }} 张）</h2>
          <div style="display:flex; gap:12px; align-items:center;">
            <label class="btn btn-primary" style="cursor:pointer;">
              上传照片
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden @change="onFileSelect" :disabled="uploading" />
            </label>
            <button class="btn btn-danger" @click="deleteAlbum">删除相册</button>
          </div>
        </div>

        <div v-if="uploading" style="margin-bottom:16px; padding:12px; background:#f5f5f7; border-radius:8px;">
          <div>上传中 {{ uploadProgress }}/{{ uploadTotal }}（成功 {{ uploadSuccess }}，失败 {{ uploadFailed.length }}）</div>
          <div v-for="f in uploadFailed" :key="f.name" style="font-size:12px; color:#ff3b30;">{{ f.name }}: {{ f.error }}</div>
        </div>

        <div v-if="loading" style="color:#6e6e73;">加载中...</div>
        <div v-else-if="!activeAlbum" style="color:#6e6e73; padding:32px; text-align:center;">请选择左侧相册</div>
        <div v-else-if="photos.length === 0" style="color:#6e6e73; padding:32px; text-align:center;">暂无照片，点击「上传照片」添加</div>
        <div v-else style="display:grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap:12px;">
          <div v-for="(p, idx) in photos" :key="p.id"
               draggable="true"
               @dragstart="onDragStart(idx)"
               @dragover.prevent
               @drop="onDrop(idx)"
               style="position:relative; border-radius:8px; overflow:hidden; aspect-ratio:1; cursor:grab;">
            <img :src="p.compressedUrl || p.originalUrl" style="width:100%; height:100%; object-fit:cover;" />
            <button @click="removePhoto(p)"
                    style="position:absolute; top:4px; right:4px; width:24px; height:24px; border-radius:50%; border:none; background:rgba(0,0,0,0.6); color:#fff; cursor:pointer; font-size:14px; display:flex; align-items:center; justify-content:center;">×</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
