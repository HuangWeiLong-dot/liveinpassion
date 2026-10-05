<script setup>
import { ref, reactive, h, defineComponent, onMounted, onUnmounted, computed } from 'vue';
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

// Title / Slug 是否已被手动编辑过；手动改过的不再自动填充
const titleDirty = ref(false);
const slugDirty = ref(false);

const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'on', 'in', 'at', 'to', 'by', 'of', 'with', 'vs', 'via']);

function toTitleCase(s) {
  const words = s.toLowerCase().split(/\s+/);
  return words
    .map((w, i) => {
      if (!w) return w;
      if (i !== 0 && i !== words.length - 1 && SMALL_WORDS.has(w)) return w;
      return w[0].toUpperCase() + w.slice(1);
    })
    .join(' ');
}

function toSlug(s) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Card Title 变化时自动填充 Title / Slug（仅空字段或未手动编辑时）
function onCardTitleInput() {
  const raw = form.value.cardTitle.trim();
  if (!raw) return;
  if (!titleDirty.value) form.value.title = toTitleCase(raw);
  if (!slugDirty.value) form.value.slug = toSlug(raw);
}

// 正文图片暂存：blobUrl -> File。保存时才真正上传 R2
const pendingImages = reactive(new Map());
const imgProgress = ref('');

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
      // 已有内容不参与自动填充
      if (data.title) titleDirty.value = true;
      if (data.slug) slugDirty.value = true;
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
    // 清理已从正文中删除的暂存图片
    for (const [blobUrl] of [...pendingImages.entries()]) {
      if (!form.value.contentMd.includes(blobUrl)) {
        URL.revokeObjectURL(blobUrl);
        pendingImages.delete(blobUrl);
      }
    }

    // 保存前将暂存图片上传 R2，并把 blob URL 替换为 CDN 地址
    const entries = [...pendingImages.entries()];
    let i = 0;
    for (const [blobUrl, file] of entries) {
      imgProgress.value = `Uploading image ${i + 1}/${entries.length}…`;
      const compressed = await compressImage(file);
      const result = await uploadApi.upload(file, compressed, 'blog');
      // 正文插入压缩版（1920px，正文栏宽下足够清晰），原图只留 R2 存档；
      // 压缩失败时回退原图
      const url = result.compressed?.url || result.original.url;
      form.value.contentMd = form.value.contentMd.split(blobUrl).join(url);
      pendingImages.delete(blobUrl);
      URL.revokeObjectURL(blobUrl);
      i++;
    }
    imgProgress.value = '';

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
    imgProgress.value = '';
  } finally {
    saving.value = false;
  }
}

// Markdown 编辑器图片：编辑阶段只在浏览器本地生成 blob URL，不触碰 R2
// md-editor-v3 约定：onUploadImg(files, callBack)，完成后必须调用 callBack(urls)
function onEditorUploadImg(files, callBack) {
  const urls = files.map((file) => {
    const blobUrl = URL.createObjectURL(file);
    pendingImages.set(blobUrl, file);
    return blobUrl;
  });
  callBack(urls);
}

// 离开页面时释放未上传的 blob URL
onUnmounted(() => {
  for (const blobUrl of pendingImages.keys()) {
    URL.revokeObjectURL(blobUrl);
  }
  pendingImages.clear();
});

// 编辑器内 Ctrl+S / 工具栏保存按钮：存为草稿
function onEditorSave() {
  save();
}

// ===== 照片排版（masonry / justified / collage / bento / text+photo）=====
const layoutModal = ref(false);
const layoutType = ref('masonry');
const layoutSide = ref('left');
const layoutRatio = ref('50');
const layoutCaption = ref('');
const layoutPicked = ref([]); // [{ blobUrl }]

const layoutOptions = [
  { id: 'masonry', label: 'Masonry', hint: 'Pinterest-style columns' },
  { id: 'justified', label: 'Justified', hint: 'Aligned edges, equal-height rows' },
  { id: 'collage', label: 'Collage', hint: 'Asymmetric tiled mix' },
  { id: 'bento', label: 'Bento Box', hint: 'Rounded tiles, one feature tile' },
  { id: 'media', label: 'Text + Photo', hint: 'Photo beside your words' },
];

// 错落方块图标，暗示多图排版
const PHOTO_LAYOUT_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="3" y="3" width="8" height="11" rx="1.5"/><rect x="13" y="3" width="8" height="6" rx="1.5"/>' +
  '<rect x="13" y="11" width="8" height="10" rx="1.5"/><rect x="3" y="16" width="8" height="5" rx="1.5"/></svg>';

// 自定义工具栏组件：编辑器克隆 defToolbars 项时会注入 insert(generate)，
// 点击时暂存它，插入排版块时在光标处插入
let doInsert = null;
const PhotoLayoutTrigger = defineComponent({
  name: 'PhotoLayoutTrigger',
  props: {
    insert: { type: Function, default: undefined },
  },
  setup(props) {
    return () =>
      h(
        'div',
        {
          class: 'md-editor-toolbar-item',
          title: 'Photo Layout',
          onClick: () => {
            doInsert = props.insert;
            layoutModal.value = true;
          },
        },
        [h('span', { class: 'md-photo-layout-btn', innerHTML: PHOTO_LAYOUT_SVG })]
      );
  },
});
const photoLayoutToolbar = h(PhotoLayoutTrigger);

// 选择多张照片：仍是本地暂存（保存时才上传），与普通插图共用 pendingImages
function onLayoutFiles(e) {
  for (const file of Array.from(e.target.files || [])) {
    const blobUrl = URL.createObjectURL(file);
    pendingImages.set(blobUrl, file);
    layoutPicked.value.push({ blobUrl });
  }
  e.target.value = '';
}

function releaseIfUnused(blobUrl) {
  if (!form.value.contentMd.includes(blobUrl)) {
    pendingImages.delete(blobUrl);
    URL.revokeObjectURL(blobUrl);
  }
}

function removeLayoutFile(index) {
  const [item] = layoutPicked.value.splice(index, 1);
  releaseIfUnused(item.blobUrl);
}

function resetLayoutForm() {
  layoutType.value = 'masonry';
  layoutSide.value = 'left';
  layoutRatio.value = '50';
  layoutCaption.value = '';
}

function closeLayoutModal() {
  layoutModal.value = false;
  appendTarget.value = null;
  for (const item of layoutPicked.value) {
    releaseIfUnused(item.blobUrl);
  }
  layoutPicked.value = [];
  resetLayoutForm();
}

// ===== 块身份与序列化 =====
function newGid() {
  return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function galleryClass(type, n) {
  if (type === 'collage') return `gallery-collage gallery-collage--${Math.min(n, 6)}`;
  if (type === 'bento') return `gallery-bento gallery-bento--${Math.min(n, 6)}`;
  return `gallery-${type}`;
}

function buildGalleryBlock(type, urls, caption, gid) {
  const gidAttr = gid ? ` data-gid="${gid}"` : '';
  const imgs = urls.map((u) => `<img src="${u}" alt="">`).join('\n');
  const cap = caption ? `\n<figcaption class="gallery-caption">${caption}</figcaption>` : '';
  return `\n<figure class="gallery ${galleryClass(type, urls.length)}"${gidAttr}>\n${imgs}${cap}\n</figure>\n`;
}

function buildMediaBlock(url, gid) {
  const gidAttr = gid ? ` data-gid="${gid}"` : '';
  return (
    `\n<div class="media-text media-text--left media-text--50"${gidAttr}>\n` +
    `<figure class="media-text__media"><img src="${url}" alt=""></figure>\n` +
    '<div class="media-text__body"><p>Write your text here…</p></div>\n</div>\n'
  );
}

function typeOfGallery(fig) {
  if (fig.classList.contains('gallery-masonry')) return 'masonry';
  if (fig.classList.contains('gallery-justified')) return 'justified';
  if (fig.classList.contains('gallery-collage')) return 'collage';
  if (fig.classList.contains('gallery-bento')) return 'bento';
  return 'masonry';
}

function photosOf(node) {
  return [...node.querySelectorAll('img')].map((im) => ({ src: im.getAttribute('src'), alt: im.alt || '' }));
}

function captionOf(fig) {
  return fig.querySelector('figcaption.gallery-caption')?.textContent.trim() || '';
}

// 按 data-gid 在 markdown 中定位块并替换；老块无 gid 时走插入序号兜底
const GALLERY_BLOCK_RE = /<figure class="gallery[\s\S]*?<\/figure>\n?/g;
const MEDIA_BLOCK_RE = /<div class="media-text[\s\S]*?<\/div>\s*<\/div>\n?/g;

function gidRegex(gid) {
  return new RegExp(
    `\\n?(?:<figure[^>]*data-gid="${gid}"[\\s\\S]*?<\\/figure>` +
      `|<div[^>]*data-gid="${gid}"[\\s\\S]*?<\\/div>\\s*<\\/div>)\\n?`
  );
}

function replaceBlock(md, gid, newBlock) {
  const re = gidRegex(gid);
  if (re.test(md)) return md.replace(re, () => newBlock);
  const fb = ordinalFallback.get(gid);
  if (fb) {
    const m = [...md.matchAll(fb.re)][fb.index];
    if (m) return md.slice(0, m.index) + newBlock + md.slice(m.index + m[0].length);
  }
  return md + newBlock;
}

function removeBlock(md, gid) {
  const re = gidRegex(gid);
  if (re.test(md)) return md.replace(re, '\n');
  const fb = ordinalFallback.get(gid);
  if (fb) {
    const m = [...md.matchAll(fb.re)][fb.index];
    if (m) return md.slice(0, m.index) + '\n' + md.slice(m.index + m[0].length);
  }
  return md;
}

// 弹窗也可用于"往已有块追加照片"
const appendTarget = ref(null);

function insertLayout() {
  if (!layoutPicked.value.length) return;
  const urls = layoutPicked.value.map((f) => f.blobUrl);
  let block;
  if (appendTarget.value) {
    const node = blockNodes.get(appendTarget.value);
    const existing = node ? photosOf(node).map((p) => p.src) : [];
    // 单图 media 块追加照片时自动转为 masonry
    const type = node?.classList.contains('gallery') ? typeOfGallery(node) : 'masonry';
    block = buildGalleryBlock(type, [...existing, ...urls], node ? captionOf(node) : '', appendTarget.value);
    form.value.contentMd = replaceBlock(form.value.contentMd, appendTarget.value, block);
  } else if (layoutType.value === 'media') {
    block = buildMediaBlock(urls[0], newGid());
    if (doInsert) {
      doInsert(() => ({ targetValue: block }));
    } else {
      form.value.contentMd += block;
    }
  } else {
    block = buildGalleryBlock(layoutType.value, urls, layoutCaption.value.trim(), newGid());
    if (doInsert) {
      doInsert(() => ({ targetValue: block }));
    } else {
      form.value.contentMd += block;
    }
  }
  layoutModal.value = false;
  appendTarget.value = null;
  layoutPicked.value = [];
  resetLayoutForm();
}

// 弹窗内已选缩略图也可拖拽排序
let thumbDrag = null;
function onThumbDragStart(idx, e) {
  thumbDrag = idx;
  e.dataTransfer.effectAllowed = 'move';
}
function onThumbDragOver(e) {
  if (thumbDrag !== null) e.dataTransfer.dropEffect = 'move';
}
function onThumbDrop(idx) {
  if (thumbDrag === null || thumbDrag === idx) return;
  const arr = layoutPicked.value;
  const [moved] = arr.splice(thumbDrag, 1);
  arr.splice(idx, 0, moved);
  thumbDrag = idx;
}

// ===== 预览区直接拖拽编辑（仅 admin；前台无此逻辑）=====
let previewEl = null;
let previewObs = null;
let removeFly = null;
const blockNodes = new Map(); // gid -> 预览中的 figure/div
const ordinalFallback = new Map(); // gid -> { re, index }，兼容老块
let dragState = null;

const EDITBAR_BUTTONS = [
  { cmd: 'masonry', label: 'M', title: 'Switch to Masonry' },
  { cmd: 'justified', label: 'J', title: 'Switch to Justified' },
  { cmd: 'collage', label: 'C', title: 'Switch to Collage' },
  { cmd: 'bento', label: 'B', title: 'Switch to Bento' },
  { cmd: 'media', label: 'T', title: 'Switch to Text + Photo' },
  { cmd: 'add', label: '+', title: 'Add photos into this block' },
  { cmd: 'delete', label: '×', title: 'Delete this block' },
];

function buildEditbar() {
  const bar = document.createElement('div');
  bar.className = 'gallery-editbar';
  for (const b of EDITBAR_BUTTONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gallery-editbtn';
    btn.dataset.cmd = b.cmd;
    btn.title = b.title;
    btn.textContent = b.label;
    bar.appendChild(btn);
  }
  return bar;
}

function ensureGid(node, kind) {
  if (node.dataset.gid) return node.dataset.gid;
  const gid = newGid();
  node.dataset.gid = gid;
  const total =
    kind === 'gallery'
      ? previewEl.querySelectorAll('figure.gallery').length
      : previewEl.querySelectorAll('.media-text').length;
  ordinalFallback.set(gid, { re: kind === 'gallery' ? GALLERY_BLOCK_RE : MEDIA_BLOCK_RE, index: total - 1 });
  return gid;
}

let enhanceQueued = false;
function scheduleEnhance() {
  if (enhanceQueued) return;
  enhanceQueued = true;
  requestAnimationFrame(() => {
    enhanceQueued = false;
    enhanceBlocks();
  });
}

function enhanceBlocks() {
  if (!previewEl) return;
  previewEl.querySelectorAll('figure.gallery').forEach((fig) => {
    if (fig.dataset.enhanced) return;
    fig.dataset.enhanced = '1';
    fig.classList.add('block-editable');
    const gid = ensureGid(fig, 'gallery');
    blockNodes.set(gid, fig);
    fig.querySelectorAll('img').forEach((im) => { im.draggable = true; });
    fig.appendChild(buildEditbar());
  });
  previewEl.querySelectorAll('.media-text').forEach((el) => {
    if (el.dataset.enhanced) return;
    el.dataset.enhanced = '1';
    el.classList.add('block-editable');
    const gid = ensureGid(el, 'media');
    blockNodes.set(gid, el);
    el.appendChild(buildEditbar());
  });
}

// ---- 拖拽重排 / 跨块移动 ----
function onDragStart(e) {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const fig = img.closest('figure.gallery');
  if (!fig || !previewEl.contains(fig)) return;
  dragState = { fromGid: fig.dataset.gid, src: img.getAttribute('src'), img };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragState.src);
  img.classList.add('is-dragging');
}

function clearHint() {
  previewEl?.querySelectorAll('.drop-hint').forEach((n) => n.classList.remove('drop-hint'));
}

function onDragOver(e) {
  if (!dragState) return;
  const fig = e.target.closest?.('figure.gallery');
  if (!fig || !previewEl.contains(fig)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const imgs = [...fig.querySelectorAll('img')];
  const target = imgs.find((im) => im === e.target || im.contains(e.target));
  clearHint();
  dragState.toGid = fig.dataset.gid;
  dragState.targetSrc = null;
  dragState.after = false;
  if (target && target !== dragState.img) {
    target.classList.add('drop-hint');
    dragState.targetSrc = target.getAttribute('src');
    const r = target.getBoundingClientRect();
    dragState.after = e.clientX - r.left > r.width / 2 || e.clientY - r.top > r.height / 2;
  }
}

function onDrop(e) {
  if (!dragState) return;
  const fig = e.target.closest?.('figure.gallery');
  if (fig && previewEl.contains(fig)) {
    e.preventDefault();
    e.stopPropagation();
    commitMove(fig);
  }
  endDrag();
}

function endDrag() {
  clearHint();
  previewEl?.querySelectorAll('.is-dragging').forEach((n) => n.classList.remove('is-dragging'));
  dragState = null;
}

function commitMove(toNode) {
  const fromGid = dragState.fromGid;
  const toGid = toNode.dataset.gid;
  const fromNode = blockNodes.get(fromGid);
  if (!fromNode) return;
  const fromPhotos = photosOf(fromNode).map((p) => p.src);
  const toPhotos = fromGid === toGid ? fromPhotos : photosOf(toNode).map((p) => p.src);
  const moved = dragState.src;
  const fi = fromPhotos.indexOf(moved);
  if (fi >= 0) fromPhotos.splice(fi, 1);
  if (dragState.targetSrc) {
    const ti = toPhotos.indexOf(dragState.targetSrc);
    toPhotos.splice(dragState.after && ti >= 0 ? ti + 1 : Math.max(ti, 0), 0, moved);
  } else {
    toPhotos.push(moved);
  }
  let md = form.value.contentMd;
  if (!fromPhotos.length) {
    md = removeBlock(md, fromGid);
  } else {
    md = replaceBlock(md, fromGid, buildGalleryBlock(typeOfGallery(fromNode), fromPhotos, captionOf(fromNode), fromGid));
  }
  if (fromGid !== toGid) {
    md = replaceBlock(md, toGid, buildGalleryBlock(typeOfGallery(toNode), toPhotos, captionOf(toNode), toGid));
  }
  form.value.contentMd = md;
}

// ---- 悬浮工具条：切换布局 / 追加 / 删除 ----
function onBarClick(e) {
  const btn = e.target.closest?.('.gallery-editbtn');
  if (!btn) return;
  const node = btn.closest('figure.gallery, .media-text');
  if (!node || !previewEl.contains(node)) return;
  const gid = node.dataset.gid;
  const cmd = btn.dataset.cmd;
  if (cmd === 'delete') {
    if (!window.confirm('Remove this layout block?')) return;
    const srcs = photosOf(node).map((p) => p.src);
    form.value.contentMd = removeBlock(form.value.contentMd, gid);
    for (const s of srcs) releaseIfUnused(s);
    return;
  }
  if (cmd === 'add') {
    appendTarget.value = gid;
    layoutModal.value = true;
    return;
  }
  switchLayout(node, cmd, gid);
}

function switchLayout(node, target, gid) {
  const isGallery = node.classList.contains('gallery');
  const photos = photosOf(node);
  if (!photos.length) return;
  if (target === 'media') {
    if (!isGallery) return;
    form.value.contentMd = replaceBlock(form.value.contentMd, gid, buildMediaBlock(photos[0].src, gid));
    return;
  }
  if (isGallery) {
    if (typeOfGallery(node) === target) return;
    form.value.contentMd = replaceBlock(
      form.value.contentMd,
      gid,
      buildGalleryBlock(target, photos.map((p) => p.src), captionOf(node), gid)
    );
  } else {
    // media → gallery：块内文字提取为块后段落保留
    const bodyText = node.querySelector('.media-text__body')?.textContent.trim() || '';
    let block = buildGalleryBlock(target, photos.map((p) => p.src), '', gid);
    if (bodyText && bodyText !== 'Write your text here…') block += `\n<p>${bodyText}</p>\n`;
    form.value.contentMd = replaceBlock(form.value.contentMd, gid, block);
  }
}

// ---- 悬停图片右上角的删除小圆钮（position:fixed，避免成为 grid 项）----
let flySrc = null;
let flyGid = null;
let flyHideTimer = null;

function positionFly(img) {
  const r = img.getBoundingClientRect();
  removeFly.style.top = `${r.top + 6}px`;
  removeFly.style.left = `${r.right - 28}px`;
  removeFly.hidden = false;
}

function onPreviewMouseOver(e) {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const fig = img.closest('figure.gallery');
  if (!fig || !previewEl.contains(fig)) return;
  if (flyHideTimer) { clearTimeout(flyHideTimer); flyHideTimer = null; }
  flySrc = img.getAttribute('src');
  flyGid = fig.dataset.gid;
  positionFly(img);
}

function scheduleHideFly() {
  if (flyHideTimer) clearTimeout(flyHideTimer);
  flyHideTimer = setTimeout(() => { if (removeFly) removeFly.hidden = true; }, 220);
}

function onPreviewMouseOut(e) {
  if (e.target instanceof HTMLImageElement) scheduleHideFly();
}

function onFlyClick() {
  if (!flyGid) return;
  const node = blockNodes.get(flyGid);
  if (!node) return;
  const photos = photosOf(node).map((p) => p.src).filter((s) => s !== flySrc);
  let md = form.value.contentMd;
  md = photos.length
    ? replaceBlock(md, flyGid, buildGalleryBlock(typeOfGallery(node), photos, captionOf(node), flyGid))
    : removeBlock(md, flyGid);
  form.value.contentMd = md;
  releaseIfUnused(flySrc);
  removeFly.hidden = true;
}

function hideFly() {
  if (removeFly && !removeFly.hidden) removeFly.hidden = true;
}

function initPreviewEditing() {
  previewEl = document.querySelector('.md-editor-preview');
  if (!previewEl) {
    setTimeout(initPreviewEditing, 200);
    return;
  }
  removeFly = document.createElement('button');
  removeFly.type = 'button';
  removeFly.className = 'gallery-img-remove';
  removeFly.textContent = '×';
  removeFly.hidden = true;
  removeFly.addEventListener('click', onFlyClick);
  removeFly.addEventListener('mouseenter', () => { if (flyHideTimer) clearTimeout(flyHideTimer); });
  removeFly.addEventListener('mouseleave', scheduleHideFly);
  document.body.appendChild(removeFly);

  previewEl.addEventListener('dragstart', onDragStart);
  previewEl.addEventListener('dragover', onDragOver);
  previewEl.addEventListener('drop', onDrop);
  previewEl.addEventListener('dragend', endDrag);
  previewEl.addEventListener('click', onBarClick);
  previewEl.addEventListener('mouseover', onPreviewMouseOver);
  previewEl.addEventListener('mouseout', onPreviewMouseOut);
  window.addEventListener('scroll', hideFly, true);
  window.addEventListener('resize', hideFly);

  previewObs = new MutationObserver(scheduleEnhance);
  previewObs.observe(previewEl, { childList: true, subtree: true });
  enhanceBlocks();
}

onMounted(initPreviewEditing);

onUnmounted(() => {
  previewObs?.disconnect();
  if (previewEl) {
    previewEl.removeEventListener('dragstart', onDragStart);
    previewEl.removeEventListener('dragover', onDragOver);
    previewEl.removeEventListener('drop', onDrop);
    previewEl.removeEventListener('dragend', endDrag);
    previewEl.removeEventListener('click', onBarClick);
    previewEl.removeEventListener('mouseover', onPreviewMouseOver);
    previewEl.removeEventListener('mouseout', onPreviewMouseOut);
  }
  window.removeEventListener('scroll', hideFly, true);
  window.removeEventListener('resize', hideFly);
  removeFly?.remove();
});
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
          <input v-model="form.cardTitle" placeholder="IN THE MIDDLE OF THE WORLD" @input="onCardTitleInput" />
          <div class="field-hint">Shown on the blog list card, usually uppercase · auto-fills Title & Slug</div>
        </div>
        <div>
          <label class="field-label">Title</label>
          <input v-model="form.title" placeholder="In the Middle of the World" @input="titleDirty = true" />
          <div class="field-hint">Full title shown on the post page</div>
        </div>
        <div>
          <label class="field-label">Slug</label>
          <input v-model="form.slug" placeholder="in-the-middle-of-the-world" @input="slugDirty = true" />
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
          <template v-if="imgProgress">{{ imgProgress }}</template>
          <template v-else-if="pendingImages.size">{{ pendingImages.size }} image(s) pending · upload on save</template>
          <template v-else>Ctrl+S save draft · paste / drop image to insert</template>
        </span>
      </div>
      <MdEditor
        v-model="form.contentMd"
        :on-upload-img="onEditorUploadImg"
        :on-save="onEditorSave"
        :def-toolbars="[photoLayoutToolbar]"
        language="en-US"
        preview
        :show-code-row-number="true"
        :auto-detect-code="true"
        :table-shape="[6, 4]"
        placeholder="Start writing in Markdown…"
        :toolbars="[
          'bold', 'underline', 'italic', 'strikeThrough', 'sub', 'sup', '-',
          'title', 'quote', 'unorderedList', 'orderedList', 'task', '-',
          'codeRow', 'code', 'link', 'image', 0, 'table', 'mermaid', 'katex', '-',
          'revoke', 'next', '-',
          'save', 'prettier', '=',
          'preview', 'previewOnly', 'htmlPreview', 'catalog', 'pageFullscreen', 'fullscreen',
        ]"
        style="height:60vh;"
      />
    </div>

    <div class="action-bar">
      <button class="btn btn-secondary" :disabled="saving" @click="save()">Save Draft</button>
      <button class="btn btn-primary" :disabled="saving" @click="save('published')">Publish</button>
    </div>

    <!-- 照片排版弹窗 -->
    <div v-if="layoutModal" class="layout-overlay" @click.self="closeLayoutModal">
      <div class="layout-dialog">
        <div class="layout-dialog-head">
          <span>Photo Layout</span>
          <button class="layout-x" @click="closeLayoutModal">×</button>
        </div>

        <div class="layout-section">
          <div class="field-label">1 · Choose photos</div>
          <label class="btn btn-secondary layout-pick-btn">
            Select Photos
            <input type="file" accept="image/*" multiple hidden @change="onLayoutFiles" />
          </label>
          <div v-if="layoutPicked.length" class="layout-thumbs">
            <div
              v-for="(item, idx) in layoutPicked"
              :key="item.blobUrl"
              class="layout-thumb"
              draggable="true"
              @dragstart="onThumbDragStart(idx, $event)"
              @dragover="onThumbDragOver($event)"
              @drop.prevent="onThumbDrop(idx)"
            >
              <img :src="item.blobUrl" alt="">
              <button class="layout-thumb-x" @click="removeLayoutFile(idx)">×</button>
            </div>
          </div>
          <div class="field-hint">Photos stay on this device until you save the post.</div>
        </div>

        <div class="layout-section">
          <div class="field-label">2 · Pick a layout</div>
          <div class="layout-types">
            <button
              v-for="opt in layoutOptions"
              :key="opt.id"
              class="layout-type"
              :class="{ active: layoutType === opt.id }"
              @click="layoutType = opt.id"
            >
              <span class="layout-type-label">{{ opt.label }}</span>
              <span class="layout-type-hint">{{ opt.hint }}</span>
            </button>
          </div>
        </div>

        <div v-if="layoutType === 'media'" class="layout-section">
          <div class="field-label">3 · Photo side</div>
          <div class="seg">
            <button :class="{ active: layoutSide === 'left' }" @click="layoutSide = 'left'">Photo left</button>
            <button :class="{ active: layoutSide === 'right' }" @click="layoutSide = 'right'">Photo right</button>
          </div>
          <div class="field-label" style="margin-top: 14px;">Photo width</div>
          <div class="seg">
            <button :class="{ active: layoutRatio === '40' }" @click="layoutRatio = '40'">40%</button>
            <button :class="{ active: layoutRatio === '50' }" @click="layoutRatio = '50'">50%</button>
            <button :class="{ active: layoutRatio === '60' }" @click="layoutRatio = '60'">60%</button>
          </div>
          <div class="field-hint">Only the first photo is used. Replace the placeholder text inside the inserted block.</div>
        </div>

        <div v-else class="layout-section">
          <div class="field-label">3 · Caption <span class="field-hint">(optional)</span></div>
          <input v-model="layoutCaption" placeholder="A quiet afternoon…" />
        </div>

        <div class="layout-foot">
          <button class="btn btn-secondary" @click="closeLayoutModal">Cancel</button>
          <button class="btn btn-primary" :disabled="!layoutPicked.length" @click="insertLayout">
            Insert Layout
          </button>
        </div>
      </div>
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

/* 排版弹窗 */
.layout-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.layout-dialog {
  background: var(--bg); border: 1px solid var(--border); width: 640px; max-width: 100%;
  max-height: 86vh; overflow-y: auto;
}
.layout-dialog-head {
  position: sticky; top: 0; z-index: 1;
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 20px; border-bottom: 1px solid var(--border); background: var(--bg);
  font-family: var(--font-display); font-size: 0.7rem; letter-spacing: 0.25em; text-transform: uppercase;
}
.layout-x, .layout-thumb-x {
  border: none; background: transparent; cursor: pointer; line-height: 1; color: var(--text-secondary);
}
.layout-x { font-size: 1.4rem; }
.layout-section { padding: 18px 20px; border-bottom: 1px solid var(--border); }
.layout-pick-btn { display: inline-block; margin: 8px 0 12px; }
.layout-thumbs {
  display: grid; grid-template-columns: repeat(auto-fill, 84px); gap: 8px; margin-bottom: 10px;
}
.layout-thumb { position: relative; width: 84px; height: 84px; cursor: grab; }
.layout-thumb:active { cursor: grabbing; }
.layout-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.layout-thumb-x {
  position: absolute; top: 2px; right: 2px; width: 20px; height: 20px;
  background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 0.9rem;
}
.layout-types { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin-top: 10px; }
.layout-type {
  text-align: left; padding: 10px 12px; border: 1px solid var(--border); background: transparent; cursor: pointer;
  display: flex; flex-direction: column; gap: 4px;
}
.layout-type.active { border-color: var(--text-primary); background: var(--text-primary); color: var(--bg); }
.layout-type-label { font-size: 0.85rem; font-weight: 600; }
.layout-type-hint { font-size: 0.7rem; opacity: 0.7; }
.seg { display: inline-flex; border: 1px solid var(--border); margin-top: 8px; }
.seg button { border: none; background: transparent; padding: 7px 14px; cursor: pointer; font-size: 0.8rem; color: var(--text-secondary); }
.seg button + button { border-left: 1px solid var(--border); }
.seg button.active { background: var(--text-primary); color: var(--bg); }
.layout-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px; }
</style>

<!-- 编辑器工具栏自定义图标 + 预览区内的排版样式（非 scoped；scoped 样式无法作用到 h() 创建的元素）
     与 app/src/styles/main.css 中的 .blog-detail-content 排版规则保持一致 -->
<style>
.md-editor-toolbar-wrapper .md-photo-layout-btn {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px;
}
.md-editor-toolbar-wrapper .md-photo-layout-btn svg { width: 20px; height: 20px; display: block; }

.md-editor-preview .gallery { margin: 32px 0; }
.md-editor-preview .gallery img { display: block; width: 100%; height: 100%; object-fit: cover; }
.md-editor-preview .gallery-caption { font-size: 0.85rem; opacity: 0.7; text-align: center; margin-top: 10px; }

/* 预览区直接拖拽（仅 admin）*/
.md-editor-preview .block-editable { position: relative; }
.md-editor-preview .gallery-editable img,
.md-editor-preview figure.gallery.block-editable img { cursor: grab; }
.md-editor-preview figure.gallery.block-editable img.is-dragging { opacity: 0.3; cursor: grabbing; }
.md-editor-preview figure.gallery.block-editable img.drop-hint {
  outline: 2px solid var(--text-primary); outline-offset: -3px;
}
.gallery-editbar {
  position: absolute; top: 6px; right: 6px; z-index: 6;
  display: flex; gap: 2px; padding: 2px;
  background: rgba(0, 0, 0, 0.6); border-radius: 6px;
  opacity: 0; transition: opacity 0.15s ease;
}
.block-editable:hover > .gallery-editbar { opacity: 1; }
.gallery-editbtn {
  width: 22px; height: 22px; padding: 0; border: none; border-radius: 4px;
  background: transparent; color: #fff; cursor: pointer;
  font-size: 0.7rem; line-height: 22px; text-align: center;
}
.gallery-editbtn:hover { background: rgba(255, 255, 255, 0.25); }
.gallery-editbtn[data-cmd='delete']:hover { background: #c0392b; }
.gallery-img-remove {
  position: fixed; z-index: 1500; width: 22px; height: 22px; padding: 0;
  border: none; border-radius: 50%; background: rgba(0, 0, 0, 0.7); color: #fff;
  font-size: 0.9rem; line-height: 1; cursor: pointer;
}

.md-editor-preview .gallery-masonry { columns: 2; column-gap: 12px; }
.md-editor-preview .gallery-masonry img { margin-bottom: 12px; break-inside: avoid; }

.md-editor-preview .gallery-justified { display: flex; flex-wrap: wrap; gap: 8px; }
.md-editor-preview .gallery-justified img { height: 190px; flex-grow: 1; min-width: 0; }
.md-editor-preview .gallery-justified::after { content: ''; flex-grow: 999; height: 0; }

.md-editor-preview .gallery-collage { display: grid; gap: 8px; }
.md-editor-preview .gallery-collage--2 { grid-template-columns: 2fr 1fr; }
.md-editor-preview .gallery-collage--2 img { min-height: 240px; }
.md-editor-preview .gallery-collage--3 { grid-template-columns: repeat(3, 1fr); grid-auto-rows: 170px; }
.md-editor-preview .gallery-collage--3 img:nth-child(1) { grid-column: span 2; }
.md-editor-preview .gallery-collage--3 img:nth-child(2) { grid-row: span 2; }
.md-editor-preview .gallery-collage--3 img:nth-child(3) { grid-column: 1 / span 2; grid-row: 2; }
.md-editor-preview .gallery-collage--4 { grid-template-columns: repeat(4, 1fr); grid-auto-rows: 170px; }
.md-editor-preview .gallery-collage--4 img:nth-child(1) { grid-column: span 2; grid-row: span 2; }
.md-editor-preview .gallery-collage--4 img:nth-child(4) { grid-column: span 2; }
.md-editor-preview .gallery-collage--5 { grid-template-columns: repeat(6, 1fr); grid-auto-rows: 150px; }
.md-editor-preview .gallery-collage--5 img:nth-child(1) { grid-column: span 4; }
.md-editor-preview .gallery-collage--5 img:nth-child(2) { grid-column: span 2; grid-row: span 2; }
.md-editor-preview .gallery-collage--5 img:nth-child(3) { grid-column: span 2; }
.md-editor-preview .gallery-collage--5 img:nth-child(4) { grid-column: span 2; }
.md-editor-preview .gallery-collage--5 img:nth-child(5) { grid-column: 1 / -1; }
.md-editor-preview .gallery-collage--6 { grid-template-columns: repeat(6, 1fr); grid-auto-rows: 150px; }
.md-editor-preview .gallery-collage--6 img:nth-child(1) { grid-column: span 2; grid-row: span 2; }
.md-editor-preview .gallery-collage--6 img:nth-child(6) { grid-column: 3 / -1; }

.md-editor-preview .gallery-bento { display: grid; gap: 10px; grid-auto-flow: dense; }
.md-editor-preview .gallery-bento img { border-radius: 12px; }
.md-editor-preview .gallery-bento--2 { grid-template-columns: 2fr 1fr; grid-auto-rows: 230px; }
.md-editor-preview .gallery-bento--3 { grid-template-columns: repeat(4, 1fr); grid-auto-rows: 160px; }
.md-editor-preview .gallery-bento--3 img:nth-child(1) { grid-column: span 2; grid-row: span 2; }
.md-editor-preview .gallery-bento--3 img:nth-child(2) { grid-column: span 2; }
.md-editor-preview .gallery-bento--3 img:nth-child(3) { grid-column: span 2; }
.md-editor-preview .gallery-bento--4 { grid-template-columns: repeat(4, 1fr); grid-auto-rows: 160px; }
.md-editor-preview .gallery-bento--4 img:nth-child(1) { grid-column: span 2; grid-row: span 2; }
.md-editor-preview .gallery-bento--4 img:nth-child(4) { grid-column: span 2; }
.md-editor-preview .gallery-bento--5 { grid-template-columns: repeat(4, 1fr); grid-auto-rows: 150px; }
.md-editor-preview .gallery-bento--5 img:nth-child(1) { grid-column: 1 / -1; height: 280px; }
.md-editor-preview .gallery-bento--6 { grid-template-columns: repeat(4, 1fr); grid-auto-rows: 150px; }
.md-editor-preview .gallery-bento--6 img:nth-child(1) { grid-column: span 2; grid-row: span 2; }
.md-editor-preview .gallery-bento--6 img:nth-child(6) { grid-column: 1 / -1; }

.md-editor-preview .media-text {
  display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: center; margin: 32px 0;
}
.md-editor-preview .media-text--40 { grid-template-columns: 2fr 3fr; }
.md-editor-preview .media-text--60 { grid-template-columns: 3fr 2fr; }
.md-editor-preview .media-text--right .media-text__media { order: 2; }
.md-editor-preview .media-text__media { margin: 0; }
.md-editor-preview .media-text__media img { display: block; width: 100%; border-radius: 12px; }
.md-editor-preview .media-text__body p:last-child { margin-bottom: 0; }
</style>
