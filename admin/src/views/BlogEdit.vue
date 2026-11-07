<script setup>
import { ref, reactive, h, defineComponent, onMounted, onUnmounted, computed, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { MdEditor, config } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';
import { blogApi, uploadApi } from '../api.js';
import { compressImage } from '../utils/imageCompress.js';
import { startPressDrag } from '../utils/pressDrag.js';
import { isDark } from '../theme.js';

// 编辑器预览内置 js-xss 过滤，默认会：
//   1) 剥离非白名单协议（blob: 不在其列）→ 编辑期暂存图片无法显示
//   2) 剥离 figure/figcaption/div/section/span 的 class → 排版样式失效
// 这里扩展白名单并放行 blob: 图片地址（保存时它们会被替换成 https CDN 地址）。
// 配置放在编辑器路由内，列表 / 相册页不会加载 md-editor。
config({
  markdownItPlugins(plugins) {
    const xssPlugin = plugins.find((p) => p.type === 'xss');
    if (xssPlugin) {
      xssPlugin.options = {
        // 函数式配置：接收 xss 库，返回 FilterXSS 选项
        xss: (xssLib) => {
          const whiteList = xssLib.getDefaultWhiteList();
          // 编辑器内置扩展（MdWhiteList）：图片 class、任务列表、嵌入视频
          whiteList.img = [...new Set([...(whiteList.img || []), 'class'])];
          whiteList.input = ['class', 'disabled', 'type', 'checked'];
          whiteList.iframe = [
            'class', 'width', 'height', 'src', 'title',
            'border', 'frameborder', 'framespacing', 'allow', 'allowfullscreen',
          ];
          // 照片排版容器允许 class，data-gid 用于拖拽回写时定位块
          whiteList.figure = ['class', 'data-gid'];
          whiteList.figcaption = ['class'];
          whiteList.div = ['class', 'data-gid'];
          whiteList.section = ['class'];
          whiteList.span = ['class'];
          return {
            whiteList,
            safeAttrValue(tag, name, value, cssFilter) {
              if (name === 'src' && /^\s*blob:/i.test(value)) return value.trim();
              return xssLib.safeAttrValue(tag, name, value, cssFilter);
            },
          };
        },
      };
    }
    return plugins;
  },
});

const route = useRoute();
const router = useRouter();
const isNew = computed(() => !route.params.id);

// 粗指针 = 没有 hover 的触摸设备。这个判断决定三件事：
//   1) 排版块工具条是 hover 才现身还是常显（CSS 侧用 @media (hover: none) 同一条件）
//   2) 单图删除钮靠 mouseover 还是靠点按唤出
//   3) 手机上编辑器要不要默认收起预览（分栏后输入区只剩 155px 宽）
const coarsePointer = window.matchMedia('(hover: none)');
const narrowScreen = window.matchMedia('(max-width: 768px)');
const isNarrow = ref(narrowScreen.matches);

const form = ref({
  slug: '',
  cardTitle: '',
  title: '',
  contentMd: '',
  coverKey: '',
  coverFullKey: '',
  category: 'UNFILED',
  tags: [],
  tagDraft: '',
});
const TAG_LIMIT = 12;
const TAG_MAX_LEN = 24;
const CATEGORY_MAX_LEN = 24;
const categorySuggestions = ref([]);
const saving = ref(false);
const uploading = ref(false);
const error = ref('');
const coverPreview = ref('');
const editorRef = ref(null);

// 分页：正文里的一行 <div class="page-break"></div> 就是页与页的分隔。
// 前台会按它把 content_html 切成书页；这里负责插入标记、跳到某一页。
const PAGE_BREAK_INSERT = '\n\n<div class="page-break"></div>\n\n';
const PAGE_BREAK_RE = /<div[^>]*class="[^"]*page-break[^"]*"[^>]*>\s*<\/div>/gi;

function splitMdPages(md) {
  const text = md || '';
  const all = [];
  const re = new RegExp(PAGE_BREAK_RE.source, 'gi');
  let start = 0;
  for (const m of text.matchAll(re)) {
    all.push({ start, end: m.index, text: text.slice(start, m.index) });
    start = m.index + m[0].length;
  }
  all.push({ start, end: text.length, text: text.slice(start) });
  // 编辑侧保留空页：刚插入分页符时页码要立刻变成 2/2，光标也确实在第二页。
  // 前台切页时会过滤空页（见 BlogDetailView 的 splitHtmlPages）。
  return all;
}

const mdPageInfo = computed(() => splitMdPages(form.value.contentMd));
const mdPageCount = computed(() => mdPageInfo.value.length);
const pageIndex = ref(0);

watch(mdPageCount, (n) => {
  if (pageIndex.value > n - 1) pageIndex.value = Math.max(0, n - 1);
});

function padPage(n) {
  return String(n).padStart(2, '0');
}

function editorView() {
  return editorRef.value?.getEditorView?.() || null;
}

// 页首偏移：跳过标记后面的空行，光标落在正文第一行
function pageOffset(i) {
  const info = mdPageInfo.value[i];
  const md = form.value.contentMd || '';
  if (!info) return 0;
  let off = info.start;
  while (off < info.end && /\s/.test(md[off])) off += 1;
  return off;
}

function jumpToPage(i) {
  const total = mdPageCount.value;
  const idx = Math.max(0, Math.min(total - 1, i));
  pageIndex.value = idx;
  const view = editorView();
  if (!view) return;
  view.dispatch({ selection: { anchor: pageOffset(idx) }, scrollIntoView: true });
  view.focus();
}

function insertPageBreak() {
  const view = editorView();
  if (!view) {
    form.value.contentMd += PAGE_BREAK_INSERT;
    pageIndex.value = mdPageCount.value - 1;
    return;
  }
  view.dispatch(view.state.replaceSelection(PAGE_BREAK_INSERT));
  view.focus();
  // 插入后按新的文档内容算光标落在第几页，不能等 computed 追上来
  const text = view.state.doc.toString();
  const infos = splitMdPages(text);
  const head = view.state.selection.main.head;
  let idx = 0;
  infos.forEach((info, i) => { if (head >= info.start) idx = i; });
  pageIndex.value = Math.max(0, Math.min(infos.length - 1, idx));
  nextTick(() => view.dispatch({ scrollIntoView: true }));
}

// 编辑器扩展按内容按需加载：照片博客里通常没有代码/公式/流程图，
// 不写这些内容时就不要从 unpkg 拉 highlight.js / katex / mermaid
const hasCodeBlock = computed(() => /```/.test(form.value.contentMd));
const hasMath = computed(() => /\$\$|\\\(|\\\[|\$[^$\n]+\$/.test(form.value.contentMd));
const hasMermaid = computed(() => /```mermaid/.test(form.value.contentMd));

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

// ── Category / Tags 表单助手 ─────────────────────────────────
function normalizeCategoryInput(value) {
  const v = String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
  return (v || 'UNFILED').slice(0, CATEGORY_MAX_LEN);
}

function applyCategory(value) {
  form.value.category = value;
}

function addTag() {
  const raw = String(form.value.tagDraft || '').trim();
  if (!raw) return;
  const parts = raw.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const tag = part.replace(/\s+/g, ' ').toUpperCase().slice(0, TAG_MAX_LEN);
    if (!tag) continue;
    if (form.value.tags.includes(tag)) continue;
    if (form.value.tags.length >= TAG_LIMIT) break;
    form.value.tags.push(tag);
  }
  form.value.tagDraft = '';
}

function removeTag(tag) {
  form.value.tags = form.value.tags.filter((t) => t !== tag);
}

function onTagKeydown(e) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addTag();
  } else if (e.key === 'Backspace' && !form.value.tagDraft && form.value.tags.length) {
    removeTag(form.value.tags[form.value.tags.length - 1]);
  }
}

function loadCategorySuggestions() {
  blogApi.list()
    .then((data) => {
      const seen = new Set();
      for (const p of data.posts || []) {
        const c = normalizeCategoryInput(p.category);
        if (c !== 'UNFILED') seen.add(c);
      }
      categorySuggestions.value = [...seen].sort();
    })
    .catch(() => { /* suggestions are optional */ });
}

// 正文图片暂存：blobUrl -> File。保存时才真正上传 R2
const pendingImages = reactive(new Map());
const imgProgress = ref('');

// 手机上默认只显示编辑区，预览交给工具栏的预览按钮切；旋屏/改窗宽时跟上
function syncNarrow(e) { isNarrow.value = e.matches; }
onMounted(() => narrowScreen.addEventListener('change', syncNarrow));
onUnmounted(() => narrowScreen.removeEventListener('change', syncNarrow));
onMounted(loadCategorySuggestions);

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
      form.value.category = normalizeCategoryInput(data.category);
      form.value.tags = Array.isArray(data.tags)
        ? [...new Set(
            data.tags
              .map((t) => String(t || '').trim().toUpperCase().slice(0, TAG_MAX_LEN))
              .filter(Boolean)
          )].slice(0, TAG_LIMIT)
        : [];
      form.value.tagDraft = '';
      // 已有内容不参与自动填充
      if (data.title) titleDirty.value = true;
      if (data.slug) slugDirty.value = true;
      if (data.coverFullKey || data.coverKey) {
        // 优先用压缩版做预览；旧文章只有原图时才退回原图（只此一处）
        coverPreview.value = `https://img.liveinpassion.me/${data.coverKey || data.coverFullKey}`;
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
    coverPreview.value = result.compressed ? result.compressed.url : result.original.url;
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

    // 还没按 Enter 的 tag 也要算进去；已加进 form.tags 的保持不动
    addTag();
    const tagsArr = form.value.tags.slice(0, TAG_LIMIT);

    const payload = {
      slug: form.value.slug,
      cardTitle: form.value.cardTitle,
      title: form.value.title,
      contentMd: form.value.contentMd,
      coverKey: form.value.coverKey,
      coverFullKey: form.value.coverFullKey,
      category: normalizeCategoryInput(form.value.category),
      tags: tagsArr,
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

// 分页：工具栏上的一页纸图标，点一下在光标处插入 page-break 分隔块。
// 不需要 insert(generate)：CodeMirror 的 view 已经通过 MdEditor 暴露出来。
const PAGE_BREAK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="5" y="3" width="14" height="18" rx="1.5"/>' +
  '<path d="M8 8h8M8 16h5"/>' +
  '<path d="M3 12h18" stroke-dasharray="2 2" opacity=".7"/></svg>';

const PageBreakTrigger = defineComponent({
  name: 'PageBreakTrigger',
  setup() {
    return () =>
      h(
        'div',
        {
          class: 'md-editor-toolbar-item',
          title: 'Insert Page Break',
          onClick: insertPageBreak,
        },
        [h('span', { class: 'md-page-break-btn', innerHTML: PAGE_BREAK_SVG })]
      );
  },
});
const pageBreakToolbar = h(PageBreakTrigger);

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

// 弹窗内已选缩略图也可拖拽排序（同样走 pointer，触屏长按起拖）
const thumbDragIdx = ref(null);
const thumbDragOver = ref(null);
function onThumbPointerDown(idx, e) {
  if (e.pointerType === 'mouse') e.preventDefault();
  startPressDrag(e, {
    onEngage: () => {
      thumbDragIdx.value = idx;
      thumbDragOver.value = idx;
    },
    onMove: (x, y) => {
      const thumb = document.elementFromPoint(x, y)?.closest?.('.layout-thumb');
      const over = thumb ? Number(thumb.dataset.idx) : NaN;
      if (!Number.isNaN(over)) thumbDragOver.value = over;
    },
    onDrop: () => {
      const from = thumbDragIdx.value;
      const to = thumbDragOver.value;
      thumbDragIdx.value = null;
      thumbDragOver.value = null;
      if (from === null || to === null || from === to) return;
      const arr = layoutPicked.value;
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
    },
    onCancel: () => {
      thumbDragIdx.value = null;
      thumbDragOver.value = null;
    },
  });
}

// ===== 预览区直接拖拽编辑（仅 admin；前台无此逻辑）=====
let editorRoot = null;
let previewEl = null;
let previewObs = null;
let removeFly = null;
const blockNodes = new Map(); // gid -> 预览中的 figure/div
const ordinalFallback = new Map(); // gid -> { re, index }，兼容老块
let dragState = null;

// 预览是 md-editor 按需挂载的（手机默认收起），监听挂在稳定的 .md-editor 根上，
// 预览出现/换新时只刷新引用，不再靠 200ms 轮询。
function refreshPreviewEl() {
  previewEl = editorRoot?.querySelector('.md-editor-preview') || null;
  return previewEl;
}

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

// 预览整块 innerHTML 会在每次排版刷新时重建。观察器只在预览区真的变化时触发，
// 这里同步把工具条补回去：不经过下一帧，避免重建瞬间出现"工具条短暂消失"的窗口。
function scheduleEnhance() {
  enhanceBlocks();
}

function enhanceBlocks() {
  if (!previewEl) return;
  previewEl.querySelectorAll('figure.gallery').forEach((fig) => {
    if (fig.dataset.enhanced) return;
    fig.dataset.enhanced = '1';
    fig.classList.add('block-editable');
    const gid = ensureGid(fig, 'gallery');
    blockNodes.set(gid, fig);
    // 排序走 pointer 事件，关掉浏览器自带的图片拖拽，免得两条拖拽打架
    fig.querySelectorAll('img').forEach((im) => { im.draggable = false; });
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
// 走 pointer 事件：HTML5 拖放（draggable + dragstart/dragover/drop）在触屏上根本不触发，
// 手机上拖不动任何一张图。鼠标按下即拖、触摸长按起拖的差异封在 pressDrag 里。
function onPreviewPointerDown(e) {
  if (!refreshPreviewEl()) return;
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const fig = img.closest('figure.gallery');
  if (!fig || !previewEl.contains(fig)) return;
  e.preventDefault(); // 挡掉选中与原生图片拖拽
  dragState = { fromGid: fig.dataset.gid, src: img.getAttribute('src'), img, toGid: null, targetSrc: null, after: false };
  if (coarsePointer.matches) hideFly(); // 触摸下拖拽与"点图唤出删除钮"别同时进行
  startPressDrag(e, {
    onEngage: () => { dragState?.img.classList.add('is-dragging'); },
    onMove: (x, y) => updateDropTarget(x, y),
    onDrop: () => {
      const to = dragState?.toGid ? blockNodes.get(dragState.toGid) : null;
      if (to) commitMove(to);
      endDrag();
    },
    onCancel: endDrag,
  });
}

function clearHint() {
  refreshPreviewEl()?.querySelectorAll('.drop-hint').forEach((n) => n.classList.remove('drop-hint'));
}

function updateDropTarget(x, y) {
  if (!dragState || !refreshPreviewEl()) return;
  const el = document.elementFromPoint(x, y);
  const fig = el?.closest?.('figure.gallery');
  if (!fig || !previewEl.contains(fig)) return;
  clearHint();
  dragState.toGid = fig.dataset.gid;
  dragState.targetSrc = null;
  dragState.after = false;
  const target = [...fig.querySelectorAll('img')].find((im) => im === el || im.contains(el));
  if (target && target !== dragState.img) {
    target.classList.add('drop-hint');
    dragState.targetSrc = target.getAttribute('src');
    const r = target.getBoundingClientRect();
    dragState.after = x - r.left > r.width / 2 || y - r.top > r.height / 2;
  }
}

function endDrag() {
  clearHint();
  refreshPreviewEl()?.querySelectorAll('.is-dragging').forEach((n) => n.classList.remove('is-dragging'));
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
  if (!refreshPreviewEl()) return;
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
  removeFly.hidden = false; // 先显示再量：触屏下按钮更宽，偏移要按实际宽度算
  removeFly.style.top = `${r.top + 6}px`;
  removeFly.style.left = `${r.right - removeFly.offsetWidth - 6}px`;
}

function onPreviewMouseOver(e) {
  if (!refreshPreviewEl()) return;
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const fig = img.closest('figure.gallery');
  if (!fig || !previewEl.contains(fig)) return;
  if (flyHideTimer) { clearTimeout(flyHideTimer); flyHideTimer = null; }
  flySrc = img.getAttribute('src');
  flyGid = fig.dataset.gid;
  positionFly(img);
}

// 触屏没有 hover，mouseover 唤不出删除钮 —— 点一下图，把删除钮定到那张图上。
//
// 这一步必须在**捕获阶段**拦住：md-editor 预览给每张图挂了 medium-zoom，
// 点击会弹一个盖满全屏的放大遮罩，正好压住删除钮（实测 elementFromPoint 命中的就是
// .medium-zoom-overlay）。捕获监听挂在 previewEl 上，先于 img 自身的监听执行，
// stopPropagation() 后图片的 click 就不会再到达 medium-zoom。
// 代价是触摸下点排版块里的图不再放大 —— 编辑台上"选中这张图"比放大更有用，
// 桌面端不受影响（hover 出删除钮，点击仍然放大）。
function onPreviewClickCapture(e) {
  if (!coarsePointer.matches) return;
  if (!refreshPreviewEl()) return;
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const fig = img.closest('figure.gallery');
  if (!fig || !previewEl.contains(fig)) return;
  e.stopPropagation();
  flySrc = img.getAttribute('src');
  flyGid = fig.dataset.gid;
  positionFly(img);
}

// 点空白处收起删除钮
function onPreviewClick(e) {
  if (!coarsePointer.matches) return;
  const img = e.target;
  const fig = img instanceof HTMLImageElement ? img.closest('figure.gallery') : null;
  if (!fig || !previewEl?.contains(fig)) hideFly();
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
  editorRoot = document.querySelector('.md-editor');
  if (!editorRoot) {
    // 编辑器组件还没挂载完，再等一小拍
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

  // 监听挂在稳定的 .md-editor 根上：手机切出预览、或预览被库重建时都不会丢
  editorRoot.addEventListener('pointerdown', onPreviewPointerDown);
  editorRoot.addEventListener('click', onPreviewClickCapture, true);
  editorRoot.addEventListener('click', onBarClick);
  editorRoot.addEventListener('click', onPreviewClick);
  editorRoot.addEventListener('mouseover', onPreviewMouseOver);
  editorRoot.addEventListener('mouseout', onPreviewMouseOut);
  window.addEventListener('scroll', hideFly, true);
  window.addEventListener('resize', hideFly);

  previewObs = new MutationObserver((mutations) => {
    const prev = previewEl;
    refreshPreviewEl();
    if (!previewEl) return;
    // 输入框打字会改 CodeMirror 的 DOM，那些 mutation 与预览无关，直接忽略
    const previewTouched = previewEl !== prev
      || mutations.some((m) => m.target === previewEl || previewEl.contains(m.target));
    if (previewTouched) scheduleEnhance();
  });
  previewObs.observe(editorRoot, { childList: true, subtree: true });

  refreshPreviewEl();
  enhanceBlocks();
}

onMounted(initPreviewEditing);

onUnmounted(() => {
  previewObs?.disconnect();
  previewObs = null;
  if (flyHideTimer) clearTimeout(flyHideTimer);
  if (editorRoot) {
    editorRoot.removeEventListener('pointerdown', onPreviewPointerDown);
    editorRoot.removeEventListener('click', onPreviewClickCapture, true);
    editorRoot.removeEventListener('click', onBarClick);
    editorRoot.removeEventListener('click', onPreviewClick);
    editorRoot.removeEventListener('mouseover', onPreviewMouseOver);
    editorRoot.removeEventListener('mouseout', onPreviewMouseOut);
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
        <div class="eyebrow">{{ isNew ? 'Content Desk — 03 / Writing' : 'Content Desk — 03 / Editing' }}</div>
        <h1>{{ isNew ? 'New Post' : 'Edit Post' }}</h1>
      </div>
      <div class="page-head__side">
        <div class="meta-line">{{ isNew ? 'Unsaved Draft' : `Post #${route.params.id}` }}</div>
        <button class="btn btn-secondary" @click="router.push('/')">← Back to Posts</button>
      </div>
    </div>

    <div v-if="error" class="error-box">{{ error }}</div>

    <div class="panel meta-panel">
      <div class="form-grid">
        <div class="field field--wide">
          <label class="field-label">01 / Card Title</label>
          <input v-model="form.cardTitle" placeholder="IN THE MIDDLE OF THE WORLD" @input="onCardTitleInput" />
          <div class="field-hint">Shown on the blog list card, usually uppercase · auto-fills Title & Slug</div>
        </div>
        <div class="field">
          <label class="field-label">02 / Title</label>
          <input v-model="form.title" placeholder="In the Middle of the World" @input="titleDirty = true" />
          <div class="field-hint">Full title shown on the post page</div>
        </div>
        <div class="field">
          <label class="field-label">03 / Slug</label>
          <input v-model="form.slug" placeholder="in-the-middle-of-the-world" @input="slugDirty = true" />
          <div class="field-hint">URL path, lowercase letters, numbers and hyphens only</div>
        </div>
        <div class="field cover-field">
          <label class="field-label">04 / Cover</label>
          <div class="cover-row">
            <div class="cover-preview" :class="{ 'is-empty': !coverPreview }">
              <img v-if="coverPreview" :src="coverPreview" alt="cover preview" />
              <span v-else class="cover-empty">No cover selected</span>
            </div>
            <div class="cover-actions">
              <label class="btn btn-secondary cover-btn" :class="{ 'is-uploading': uploading }">
                {{ uploading ? 'Uploading ———' : 'Select Image' }}
                <input type="file" accept="image/*" hidden @change="onCoverUpload" :disabled="uploading" />
              </label>
              <p class="field-hint">Without a cover, the default site image is used.</p>
            </div>
          </div>
        </div>

        <div class="field tags-field">
          <label class="field-label">05 / Tags</label>
          <input
            v-model="form.tagDraft"
            class="tag-input"
            maxlength="80"
            placeholder="TYPE A TAG, PRESS ENTER"
            @keydown="onTagKeydown"
            @blur="addTag"
          />
          <div v-if="form.tags.length" class="tag-chips">
            <button
              v-for="tag in form.tags"
              :key="tag"
              type="button"
              class="tag-chip"
              :aria-label="`Remove tag ${tag}`"
              @click="removeTag(tag)"
            >
              {{ tag }} <span class="tag-chip__x">×</span>
            </button>
          </div>
          <div class="field-hint">Enter or comma adds a tag · click to remove · up to 12</div>
        </div>

        <div class="field field--wide">
          <label class="field-label">06 / Category</label>
          <input
            v-model="form.category"
            class="category-input"
            maxlength="24"
            placeholder="TYPE OR PICK A CATEGORY"
            @blur="form.category = normalizeCategoryInput(form.category)"
            @keydown.enter.prevent="form.category = normalizeCategoryInput(form.category)"
          />
          <div v-if="categorySuggestions.length" class="suggest-row">
            <button
              v-for="c in categorySuggestions"
              :key="c"
              type="button"
              class="suggest-chip"
              :class="{ active: form.category === c }"
              @click="applyCategory(c)"
            >{{ c }}</button>
          </div>
          <div class="field-hint">Free text · chips are categories already used · empty becomes UNFILED</div>
        </div>
      </div>

    </div>

    <div class="editor-panel">
      <div class="editor-head">
        <span>Markdown — Editor</span>
        <span class="editor-tip">
          <template v-if="imgProgress">{{ imgProgress }}</template>
          <template v-else-if="pendingImages.size">{{ pendingImages.size }} image(s) pending · upload on save</template>
          <template v-else>
            <span class="tip-fine">Ctrl+S save draft · paste / drop image to insert</span>
            <span class="tip-coarse">Tap the save icon to draft · tap a photo to edit it</span>
          </template>
        </span>
      </div>
      <MdEditor
        ref="editorRef"
        v-model="form.contentMd"
        :on-upload-img="onEditorUploadImg"
        :on-save="onEditorSave"
        :def-toolbars="[photoLayoutToolbar, pageBreakToolbar]"
        language="en-US"
        :theme="isDark ? 'dark' : 'light'"
        :preview="!isNarrow"
        :no-highlight="!hasCodeBlock"
        :no-katex="!hasMath"
        :no-mermaid="!hasMermaid"
        :show-code-row-number="true"
        :auto-detect-code="true"
        :table-shape="[6, 4]"
        placeholder="Start writing in Markdown…"
        :toolbars="[
          'bold', 'underline', 'italic', 'strikeThrough', 'sub', 'sup', '-',
          'title', 'quote', 'unorderedList', 'orderedList', 'task', '-',
          'codeRow', 'code', 'link', 'image', 0, 1, 'table', 'mermaid', 'katex', '-',
          'revoke', 'next', '-',
          'save', 'prettier', '=',
          'preview', 'previewOnly', 'htmlPreview', 'catalog', 'pageFullscreen', 'fullscreen',
        ]"
        style="height:62vh;min-height:420px;"
      />
    </div>

    <div class="action-bar">
      <div class="action-bar__pages">
        <button
          type="button"
          class="page-nav"
          aria-label="Previous page"
          :disabled="pageIndex <= 0"
          @click="jumpToPage(pageIndex - 1)"
        >←</button>
        <span class="page-count">{{ padPage(pageIndex + 1) }} / {{ padPage(mdPageCount) }}</span>
        <button
          type="button"
          class="page-nav"
          aria-label="Next page"
          :disabled="pageIndex >= mdPageCount - 1"
          @click="jumpToPage(pageIndex + 1)"
        >→</button>
        <button type="button" class="btn btn-sm btn-secondary page-insert" @click="insertPageBreak">
          + Page Break
        </button>
      </div>
      <span class="action-bar__hint">Ctrl+S saves a draft</span>
      <div class="action-bar__btns">
        <button class="btn btn-secondary" :disabled="saving" @click="save()">Save Draft</button>
        <button class="btn btn-primary" :disabled="saving" @click="save('published')">Publish</button>
      </div>
    </div>

    <!-- 照片排版弹窗 -->
    <div v-if="layoutModal" class="layout-overlay" @click.self="closeLayoutModal">
      <div class="layout-dialog">
        <div class="layout-dialog-head">
          <span>Photo Layout</span>
          <button class="layout-x" @click="closeLayoutModal">×</button>
        </div>

        <div class="layout-section">
          <div class="field-label">01 / Choose photos</div>
          <label class="btn btn-secondary layout-pick-btn">
            Select Photos
            <input type="file" accept="image/*" multiple hidden @change="onLayoutFiles" />
          </label>
          <div v-if="layoutPicked.length" class="layout-thumbs">
            <div
              v-for="(item, idx) in layoutPicked"
              :key="item.blobUrl"
              class="layout-thumb"
              :class="{ 'is-dragging': thumbDragIdx === idx, 'is-drop-target': thumbDragIdx !== null && thumbDragOver === idx && thumbDragIdx !== idx }"
              :data-idx="idx"
              @pointerdown="onThumbPointerDown(idx, $event)"
            >
              <img :src="item.blobUrl" alt="" draggable="false">
              <button class="layout-thumb-x" aria-label="Remove photo" @click="removeLayoutFile(idx)">×</button>
            </div>
          </div>
          <div class="field-hint">Photos stay on this device until you save the post.</div>
        </div>

        <div class="layout-section">
          <div class="field-label">02 / Pick a layout</div>
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
          <div class="field-label">03 / Photo side</div>
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
          <div class="field-label">03 / Caption <span class="field-hint">(optional)</span></div>
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
.meta-panel { margin-bottom: 24px; }
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px 26px;
}
.field--wide { grid-column: 1 / -1; }

.cover-row { display: flex; align-items: flex-start; gap: 20px; flex-wrap: wrap; }
.cover-preview {
  width: 180px;
  aspect-ratio: 4 / 3;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
}
.cover-preview img { display: block; width: 100%; height: 100%; object-fit: cover; }
.cover-empty {
  font-family: var(--font-mono);
  font-size: 0.48rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-secondary);
  text-align: center;
  padding: 0 12px;
}
.cover-actions { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
.cover-btn { position: relative; overflow: hidden; }
.cover-btn input { display: none; }
.is-uploading { opacity: 0.6; cursor: wait; }

/* 标签：方形、细边框、mono 大写；点击整块即移除 */
.tags-field { min-width: 0; }
.tag-input, .category-input { text-transform: uppercase; }
.tag-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 26px;
  padding: 0 7px 0 8px;
  border: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 0.54rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.16s ease, color 0.16s ease, border-color 0.16s ease;
}
.tag-chip:hover { background: var(--text-primary); border-color: var(--text-primary); color: var(--bg); }
.tag-chip__x { font-size: 0.66rem; line-height: 1; opacity: 0.6; }
.tag-chip:hover .tag-chip__x { opacity: 1; }

/* 已用过的分类：方形建议签，点一下填进上面的输入框 */
.suggest-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.suggest-chip {
  min-height: 26px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 0.52rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.16s ease, color 0.16s ease, border-color 0.16s ease;
}
.suggest-chip:hover { border-color: var(--text-primary); color: var(--text-primary); }
.suggest-chip.active { background: var(--text-primary); border-color: var(--text-primary); color: var(--bg); }

@media (hover: none) {
  .tag-chip, .suggest-chip { min-height: 44px; padding: 0 12px; }
}

.editor-panel {
  border: 1px solid var(--border);
  margin-bottom: 24px;
  overflow: hidden;
}
.editor-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 0.56rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-secondary);
}
.editor-tip {
  font-family: var(--font-mono);
  font-weight: 400;
  font-size: 0.55rem;
  letter-spacing: 0.03em;
  text-transform: none;
  color: var(--text-secondary);
}

.action-bar {
  position: sticky;
  bottom: 0;
  z-index: 10;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 14px 0;
  border-top: 1px solid var(--border);
  background: var(--bg);
}
.action-bar__hint {
  font-family: var(--font-mono);
  font-size: 0.54rem;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
}
.action-bar__btns { display: flex; gap: 12px; }

/* 分页导航：和站点按钮同一套直角/反色语言 */
.action-bar__pages {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.page-nav {
  width: 28px;
  height: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}
.page-nav:hover:not(:disabled) { background: var(--text-primary); border-color: var(--text-primary); color: var(--bg); }
.page-nav:disabled { opacity: 0.35; cursor: not-allowed; }
.page-count {
  min-width: 62px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 0.56rem;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.page-insert { white-space: nowrap; }

/* 触屏上没有 Ctrl+S，"paste / drop" 也不成立，换成触摸版的提示 */
.tip-coarse { display: none; }
@media (hover: none) {
  .tip-fine { display: none; }
  .tip-coarse { display: inline; }
}

@media (max-width: 900px) {
  .meta-panel { padding: 20px; }
  .form-grid { gap: 18px 22px; }
  .cover-preview { width: 150px; }
}

@media (max-width: 700px) {
  .form-grid { grid-template-columns: 1fr; gap: 20px; }
  .field--wide { grid-column: auto; }
  .action-bar { flex-wrap: wrap; row-gap: 10px; }
  .action-bar__hint { display: none; }
  .action-bar__pages { width: 100%; }
  .action-bar__btns { width: 100%; }
  .action-bar__btns .btn { flex: 1; }
  .cover-preview { width: 100%; max-width: 260px; }
}

@media (hover: none) {
  .page-nav { width: 44px; height: 44px; }
}

/* 排版弹窗 */
.layout-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0, 0, 0, 0.6);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.layout-dialog {
  background: var(--bg); border: 1px solid var(--border); width: 640px; max-width: 100%;
  /* dvh：手机浏览器收起地址栏后 vh 仍按最大视口算，弹窗底部会被推出屏幕 */
  max-height: 86vh; max-height: 86dvh; overflow-y: auto;
}
.layout-dialog-head {
  position: sticky; top: 0; z-index: 1;
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 20px; border-bottom: 1px solid var(--border); background: var(--bg);
  font-family: var(--font-mono); font-weight: 500; font-size: 0.6rem;
  letter-spacing: 0.2em; text-transform: uppercase;
}
.layout-x, .layout-thumb-x {
  border: none; background: transparent; cursor: pointer; line-height: 1; color: var(--text-secondary);
}
.layout-x { font-size: 1.4rem; }
.layout-section { padding: 18px 20px; border-bottom: 1px solid var(--border); }
.layout-pick-btn { display: inline-flex; margin: 8px 0 12px; }
.layout-thumbs {
  display: grid; grid-template-columns: repeat(auto-fill, 84px); gap: 8px; margin-bottom: 10px;
}
.layout-thumb {
  position: relative; width: 84px; height: 84px; cursor: grab;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
}
.layout-thumb:active { cursor: grabbing; }
.layout-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.layout-thumb.is-dragging { opacity: 0.5; }
.layout-thumb.is-drop-target { outline: 2px solid var(--text-primary); outline-offset: -2px; }
.layout-thumb-x {
  position: absolute; top: 0; right: 0; width: 20px; height: 20px;
  background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 0.9rem;
}
@media (hover: none) {
  .layout-thumb-x {
    width: 44px; height: 44px; font-size: 1.15rem;
    background: rgba(0, 0, 0, 0.45); border-radius: 0 0 0 44px;
  }
  .layout-x { width: 44px; height: 44px; }
  /* 分段控件（照片左右 / 宽度）在手机上也要点得中 */
  .seg button { min-height: 44px; padding: 10px 16px; font-size: 0.85rem; }
}
.layout-types { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin-top: 10px; }
.layout-type {
  text-align: left; padding: 10px 12px; border: 1px solid var(--border); background: transparent; cursor: pointer;
  display: flex; flex-direction: column; gap: 4px;
  transition: border-color 0.18s ease, background-color 0.18s ease, color 0.18s ease;
}
.layout-type:hover { border-color: var(--text-primary); }
.layout-type.active { border-color: var(--text-primary); background: var(--text-primary); color: var(--bg); }
.layout-type-label {
  font-family: var(--font-display);
  font-size: 0.86rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.layout-type-hint { font-family: var(--font-mono); font-size: 0.52rem; opacity: 0.7; }
.seg { display: inline-flex; border: 1px solid var(--border); margin-top: 8px; }
.seg button {
  border: none; background: transparent; padding: 7px 14px; cursor: pointer;
  font-family: var(--font-mono); font-size: 0.56rem; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--text-secondary);
}
.seg button + button { border-left: 1px solid var(--border); }
.seg button.active { background: var(--text-primary); color: var(--bg); }
.layout-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px; }
</style>

<!-- 编辑器工具栏自定义图标 + 预览区内的排版样式（非 scoped；scoped 样式无法作用到 h() 创建的元素）
     与 app/src/styles/main.css 中的 .blog-detail-content 排版规则保持一致 -->
<style>
.md-editor-toolbar-wrapper .md-photo-layout-btn,
.md-editor-toolbar-wrapper .md-page-break-btn {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px;
}
.md-editor-toolbar-wrapper .md-photo-layout-btn svg,
.md-editor-toolbar-wrapper .md-page-break-btn svg { width: 20px; height: 20px; display: block; }

/* 编辑预览里的分页线：和前台书页的分隔同一套语言（发丝线 + 小号 mono 标签） */
.md-editor-preview .page-break {
  display: block;
  position: relative;
  height: 1px;
  margin: 34px 0;
  background: var(--border);
}
.md-editor-preview .page-break::after {
  content: 'PAGE BREAK';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  padding: 0 10px;
  background: var(--md-bk-color, var(--bg));
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.18em;
  color: var(--text-secondary);
  white-space: nowrap;
}

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
/* 长按拖拽时别弹出系统的图片菜单/选词 */
.md-editor-preview figure.gallery.block-editable img {
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
}
.gallery-editbar {
  position: absolute; top: 6px; right: 6px; z-index: 6;
  display: flex; gap: 2px; padding: 2px;
  background: rgba(0, 0, 0, 0.68); border-radius: 0;
  opacity: 0; transition: opacity 0.15s ease;
}
.block-editable:hover > .gallery-editbar { opacity: 1; }
.gallery-editbtn {
  width: 22px; height: 22px; padding: 0; border: none; border-radius: 0;
  background: transparent; color: #fff; cursor: pointer;
  font-family: var(--font-mono);
  font-size: 0.66rem; line-height: 22px; text-align: center;
}
.gallery-editbtn:hover { background: rgba(255, 255, 255, 0.25); }
.gallery-editbtn[data-cmd='delete']:hover { background: #c0392b; }
.gallery-img-remove {
  position: fixed; z-index: 1500; width: 22px; height: 22px; padding: 0;
  border: none; border-radius: 0; background: rgba(0, 0, 0, 0.72); color: #fff;
  font-family: var(--font-mono); font-size: 0.9rem; line-height: 1; cursor: pointer;
}

/* ============ 触屏（hover: none） ============
   这里的控件原先全靠 :hover 现身：排版块工具条 opacity 0 → hover 1；
   单图删除钮靠 mouseover 定位。触屏没有 hover，等于整块功能不存在。
   触摸下改成常显 + 移到块底部当一条操作带，按钮放大到可点尺寸。*/
@media (hover: none) {
  .gallery-editbar {
    opacity: 1;
    top: auto; bottom: 0; left: 0; right: 0;
    justify-content: center; flex-wrap: wrap; gap: 4px;
    padding: 4px; border-radius: 0;
  }
  .gallery-editbtn { width: 44px; height: 44px; font-size: 0.9rem; line-height: 44px; }
  .gallery-editbtn[data-cmd='delete'] { background: rgba(192, 57, 43, 0.75); }
  .gallery-img-remove { width: 44px; height: 44px; font-size: 1.3rem; }
}

/* md-editor-v3 预览自带 `figure { display: inline-flex }`（收缩到内容宽度）。
   不加显式 display 的话，排版块在编辑器里会被压成一条 —— masonry 实测只剩 33px 宽，
   columns 也被 inline-flex 吃掉。所以每种排版块都写全 display，
   选择器一并写成 figure.gallery.xxx，压过库里的 .md-editor-preview figure。 */
.md-editor-preview figure.gallery { display: block; }
.md-editor-preview figure.gallery.gallery-masonry { columns: 2; column-gap: 12px; }
.md-editor-preview .gallery-masonry img { margin-bottom: 12px; break-inside: avoid; }

.md-editor-preview figure.gallery.gallery-justified { display: flex; flex-wrap: wrap; gap: 8px; }
.md-editor-preview .gallery-justified img { height: 190px; flex-grow: 1; min-width: 0; }
.md-editor-preview .gallery-justified::after { content: ''; flex-grow: 999; height: 0; }

.md-editor-preview figure.gallery.gallery-collage { display: grid; gap: 8px; }
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

.md-editor-preview figure.gallery.gallery-bento { display: grid; gap: 10px; grid-auto-flow: dense; }
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
/* 同上：单图媒体块里的 <figure> 也会被库规则压成 inline-flex */
.md-editor-preview figure.media-text__media { display: block; margin: 0; }
.md-editor-preview .media-text__media img { display: block; width: 100%; }
.md-editor-preview .media-text__body p:last-child { margin-bottom: 0; }

</style>
