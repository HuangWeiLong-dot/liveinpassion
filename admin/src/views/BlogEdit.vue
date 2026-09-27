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
    alert(status === 'published' ? '已发布，Pages 将在 1-2 分钟内更新' : '已保存为草稿');
    router.push('/');
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

// Markdown 编辑器图片上传：调用上传接口并插入
async function onEditorUploadImg(files) {
  const urls = [];
  for (const file of files) {
    const compressed = await compressImage(file);
    const result = await uploadApi.upload(file, compressed, 'blog');
    urls.push(result.original.url);
  }
  return urls;
}
</script>

<template>
  <div>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
      <h1 style="font-size:24px;">{{ isNew ? '新建文章' : '编辑文章' }}</h1>
      <button class="btn btn-secondary" @click="router.push('/')">返回</button>
    </div>

    <div v-if="error" class="card" style="color:#ff3b30; margin-bottom:16px;">{{ error }}</div>

    <div class="card" style="margin-bottom:16px;">
      <div style="display:grid; gap:16px;">
        <div>
          <label style="display:block; font-size:13px; color:#6e6e73; margin-bottom:6px;">卡片标题（大写）</label>
          <input v-model="form.cardTitle" placeholder="IN THE MIDDLE OF THE WORLD" />
        </div>
        <div>
          <label style="display:block; font-size:13px; color:#6e6e73; margin-bottom:6px;">详情标题</label>
          <input v-model="form.title" placeholder="In the Middle of the World" />
        </div>
        <div>
          <label style="display:block; font-size:13px; color:#6e6e73; margin-bottom:6px;">Slug（URL，仅小写字母数字连字符）</label>
          <input v-model="form.slug" placeholder="in-the-middle-of-the-world" />
        </div>
        <div>
          <label style="display:block; font-size:13px; color:#6e6e73; margin-bottom:6px;">封面图</label>
          <div style="display:flex; gap:16px; align-items:center;">
            <input type="file" accept="image/*" @change="onCoverUpload" :disabled="uploading" />
            <span v-if="uploading" style="color:#6e6e73; font-size:13px;">上传中...</span>
          </div>
          <div v-if="coverPreview" style="margin-top:12px;">
            <img :src="coverPreview" style="max-width:240px; border-radius:8px;" />
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <MdEditor
        v-model="form.contentMd"
        :upload-img="onEditorUploadImg"
        preview
        :toolbars="['bold', 'underline', 'italic', '-', 'title', 'strikeThrough', 'quote', 'unorderedList', 'orderedList', '-', 'link', 'image', 'code', 'codeBlock', '-', 'revoke', 'next', 'save', '=', 'pageFullscreen']"
        style="height:60vh;"
      />
    </div>

    <div style="display:flex; gap:12px;">
      <button class="btn btn-secondary" :disabled="saving" @click="save()">存草稿</button>
      <button class="btn btn-primary" :disabled="saving" @click="save('published')">发布</button>
    </div>
  </div>
</template>
