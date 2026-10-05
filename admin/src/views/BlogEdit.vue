<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { MdEditor } from 'md-editor-v3';
import { blogApi, uploadApi } from '../api.js';
import { compressImage } from '../utils/imageCompress.js';

const route = useRoute();
const router = useRouter();
const isNew = computed(() => !route.params.id);

const form = ref({
  slug: '',
  cardTitle: '',
  title: '',
  contentMd: '',
  coverKey: '',
  coverFullKey: '',
});
const saving = ref(false);
const uploading = ref(false);
const imgUploading = ref(false);
const error = ref('');
const coverPreview = ref('');

onMounted(async () => {
  if (!isNew.value) {
    try {
      const data = await blogApi.get(route.params.id);
      form.value.slug = data.slug;
      form.value.cardTitle = data.cardTitle;
      form.value.title = data.title;
      form.value.contentMd = data.contentMd || '';
      form.value.coverKey = data.coverKey || '';
      form.value.coverFullKey = data.coverFullKey || '';
      if (data.coverFullKey) {
        coverPreview.value = `https://img.liveinpassion.me/${data.coverFullKey}`;
      }
    } catch (e) {
      error.value = e.message;
    }
  }
});

async function onCoverUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  uploading.value = true;
  error.value = '';
  try {
    const compressed = await compressImage(file);
    const result = await uploadApi.upload(file, compressed, 'blog');
    form.value.coverKey = result.compressed ? result.compressed.key : result.original.key;
    form.value.coverFullKey = result.original.key;
    coverPreview.value = result.original.url;
  } catch (e) {
    error.value = e.message;
  } finally {
    uploading.value = false;
  }
}

async function save(status) {
  if (imgUploading.value) {
    error.value = 'Image is still uploading, please wait.';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const payload = {
      slug: form.value.slug,
      cardTitle: form.value.cardTitle,
      title: form.value.title,
      contentMd: form.value.contentMd,
      coverKey: form.value.coverKey,
      coverFullKey: form.value.coverFullKey,
    };
    let id;
    if (isNew.value) {
      const res = await blogApi.create(payload);
      id = res.id;
    } else {
      await blogApi.update(route.params.id, payload);
      id = route.params.id;
    }
    if (status) {
      await blogApi.setStatus(id, status);
    }
    alert(status === 'published' ? 'Published. Pages will rebuild in 1-2 minutes.' : 'Saved as draft.');
    router.push('/');
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

// Markdown 编辑器图片上传：调用上传接口，通过回调把图片 URL 插入光标处
// md-editor-v3 约定：onUploadImg(files, callBack)，完成后必须调用 callBack(urls)
async function onEditorUploadImg(files, callBack) {
  const urls = [];
  imgUploading.value = true;
  try {
    for (const file of files) {
      const compressed = await compressImage(file);
      const result = await uploadApi.upload(file, compressed, 'blog');
      // 正文插入压缩版（1920px，正文栏宽下足够清晰），原图只留 R2 存档；
      // 压缩失败时回退原图
      urls.push(result.compressed?.url || result.original.url);
    }
    callBack(urls);
  } catch (e) {
    error.value = e.message;
  } finally {
    imgUploading.value = false;
  }
}

// 编辑器内 Ctrl+S / 工具栏保存按钮：存为草稿
function onEditorSave() {
  save();
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <div class="eyebrow">{{ isNew ? 'Content Management — Writing' : 'Content Management — Editing' }}</div>
        <h1>{{ isNew ? 'New Post' : 'Edit Post' }}</h1>
      </div>
      <button class="btn btn-secondary" @click="router.push('/')">← Back</button>
    </div>

    <div v-if="error" class="error-box">{{ error }}</div>

    <div class="panel" style="margin-bottom:20px;">
      <div class="form-grid">
        <div>
          <label class="field-label">Card Title</label>
          <input v-model="form.cardTitle" placeholder="IN THE MIDDLE OF THE WORLD" />
          <div class="field-hint">Shown on the blog list card, usually uppercase</div>
        </div>
        <div>
          <label class="field-label">Title</label>
          <input v-model="form.title" placeholder="In the Middle of the World" />
          <div class="field-hint">Full title shown on the post page</div>
        </div>
        <div>
          <label class="field-label">Slug</label>
          <input v-model="form.slug" placeholder="in-the-middle-of-the-world" />
          <div class="field-hint">URL path, lowercase letters, numbers and hyphens only</div>
        </div>
        <div>
          <label class="field-label">Cover</label>
          <div class="cover-row">
            <label class="btn btn-secondary cover-btn" :class="{ 'is-uploading': uploading }">
              {{ uploading ? 'Uploading ———' : 'Select Image' }}
              <input type="file" accept="image/*" hidden @change="onCoverUpload" :disabled="uploading" />
            </label>
            <div v-if="coverPreview" class="cover-preview">
              <img :src="coverPreview" alt="cover preview" />
            </div>
            <span v-if="!coverPreview && !uploading" class="field-hint">Not set, a default cover will be shown</span>
          </div>
        </div>
      </div>
    </div>

    <div class="panel" style="padding:0; margin-bottom:20px; overflow:hidden;">
      <div class="editor-head">
        <span>Markdown Editor</span>
        <span class="editor-tip">
          <template v-if="imgUploading">Uploading image…</template>
          <template v-else>Ctrl+S save draft · paste / drop image to upload</template>
        </span>
      </div>
      <MdEditor
        v-model="form.contentMd"
        :on-upload-img="onEditorUploadImg"
        :on-save="onEditorSave"
        language="en-US"
        preview
        :show-code-row-number="true"
        :auto-detect-code="true"
        :table-shape="[6, 4]"
        placeholder="Start writing in Markdown…"
        :toolbars="[
          'bold', 'underline', 'italic', 'strikeThrough', 'sub', 'sup', '-',
          'title', 'quote', 'unorderedList', 'orderedList', 'task', '-',
          'codeRow', 'code', 'link', 'image', 'table', 'mermaid', 'katex', '-',
          'revoke', 'next', '-',
          'save', 'prettier', '=',
          'preview', 'previewOnly', 'htmlPreview', 'catalog', 'pageFullscreen', 'fullscreen',
        ]"
        style="height:60vh;"
      />
    </div>

    <div class="action-bar">
      <button class="btn btn-secondary" :disabled="saving || imgUploading" @click="save()">Save Draft</button>
      <button class="btn btn-primary" :disabled="saving || imgUploading" @click="save('published')">Publish</button>
    </div>
  </div>
</template>

<style scoped>
.form-grid { display: grid; gap: 20px; }
.cover-row { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
.cover-btn { position: relative; overflow: hidden; }
.cover-btn input { display: none; }
.cover-preview {
  width: 128px; height: 80px; border: 1px solid var(--border); overflow: hidden;
}
.cover-preview img { width: 100%; height: 100%; object-fit: cover; display: block; filter: invert(var(--invert, 0)); }
.editor-head {
  padding: 10px 16px; border-bottom: 1px solid var(--border);
  font-family: var(--font-display); font-weight: 500; font-size: 0.6rem;
  letter-spacing: 0.25em; text-transform: uppercase; color: var(--text-secondary);
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
}
.editor-tip { text-transform: none; letter-spacing: 0.05em; font-size: 0.7rem; }
.action-bar { display: flex; gap: 12px; justify-content: flex-end; }
</style>
