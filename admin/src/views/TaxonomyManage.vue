<script setup>
// 分类 / 标签总览。
//
// 只统计、只修改**已发布**文章：草稿不在这里出现，也不会被这里的重命名 /
// 合并 / 删除波及。三个操作：
//   · Rename —— 把某个分类 / 标签在全部已发布文章里改成新名字；
//   · Merge  —— 改名到另一个已存在的名字，两边计数合并；
//   · Delete —— 分类退回 UNFILED，标签从每篇文章里移除。
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { taxonomyApi } from '../api.js';
import { askDeleteGuard } from '../composables/useDeleteGuard.js';

const loading = ref(true);
const error = ref('');
const notice = ref('');
const busy = ref('');

const stats = reactive({ posts: 0, categories: [], tags: [] });

const editing = reactive({ kind: '', name: '', value: '' });
const renameInput = ref(null);
// ref 在 v-for 里会变成数组，用函数 ref 只留当前展开的那一个输入框
function setRenameInput(el) {
  if (el) renameInput.value = el;
}

const totalPublished = computed(() => stats.posts);

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 24);
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await taxonomyApi.get();
    stats.posts = data.posts || 0;
    stats.categories = Array.isArray(data.categories) ? data.categories : [];
    stats.tags = Array.isArray(data.tags) ? data.tags : [];
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function run(key, fn, message) {
  busy.value = key;
  error.value = '';
  notice.value = '';
  try {
    const result = await fn();
    await load();
    const affected = Number(result?.affected) || 0;
    notice.value = affected
      ? message(affected)
      : 'No published post matched — nothing changed.';
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = '';
    cancelEdit();
  }
}

function confirmMerge(kind, from, to) {
  const label = kind === 'category' ? 'category' : 'tag';
  return window.confirm(
    `Merge ${label} “${from}” into “${to}”?\n\nEvery published post using “${from}” will be updated.`
  );
}

function categoryMergeTargets(name) {
  const names = stats.categories.map((item) => item.name).filter((n) => n !== name);
  if (name !== 'UNFILED' && !names.includes('UNFILED')) names.push('UNFILED');
  return names.sort();
}

function tagMergeTargets(name) {
  return stats.tags.map((item) => item.name).filter((n) => n !== name);
}

function startEdit(kind, name) {
  editing.kind = kind;
  editing.name = name;
  editing.value = name;
  error.value = '';
  notice.value = '';
  nextTick(() => renameInput.value?.focus());
}

function cancelEdit() {
  editing.kind = '';
  editing.name = '';
  editing.value = '';
}

async function submitEdit() {
  const kind = editing.kind;
  const from = editing.name;
  const to = normalizeName(editing.value);
  if (!to) {
    error.value = 'Name cannot be empty.';
    return;
  }
  if (to === from) {
    cancelEdit();
    return;
  }

  const exists = kind === 'category'
    ? stats.categories.some((item) => item.name === to && item.name !== from)
    : stats.tags.some((item) => item.name === to && item.name !== from);
  if (exists && !confirmMerge(kind, from, to)) return;

  const key = `${kind}:${from}`;
  const message = (count) => `Renamed ${kind} “${from}” to “${to}” on ${count} published post${count === 1 ? '' : 's'}.`;
  if (kind === 'category') {
    await run(key, () => taxonomyApi.renameCategory(from, to), message);
  } else {
    await run(key, () => taxonomyApi.renameTag(from, to), message);
  }
}

async function onMerge(kind, from, event) {
  const target = event.target.value;
  event.target.value = '';
  if (!target || target === from) return;
  if (!confirmMerge(kind, from, target)) return;

  const key = `${kind}:${from}`;
  const message = (count) => `Merged ${kind} “${from}” into “${target}” on ${count} published post${count === 1 ? '' : 's'}.`;
  if (kind === 'category') {
    await run(key, () => taxonomyApi.renameCategory(from, target), message);
  } else {
    await run(key, () => taxonomyApi.renameTag(from, target), message);
  }
}

async function removeCategory(name) {
  const ok = await askDeleteGuard(`category “${name}” (its posts move to UNFILED)`);
  if (!ok) return;
  await run(
    `category:${name}`,
    () => taxonomyApi.deleteCategory(name),
    (count) => `Moved ${count} published post${count === 1 ? '' : 's'} from “${name}” to UNFILED.`
  );
}

async function removeTag(name) {
  const ok = await askDeleteGuard(`tag “${name}” from every published post`);
  if (!ok) return;
  await run(
    `tag:${name}`,
    () => taxonomyApi.deleteTag(name),
    (count) => `Removed tag “${name}” from ${count} published post${count === 1 ? '' : 's'}.`
  );
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <div class="eyebrow">Content Desk — 05 / Taxonomy</div>
        <h1>Tags &amp; Categories</h1>
      </div>
      <div class="page-head__side">
        <div class="meta-line">
          {{ totalPublished }} Published <i>·</i>
          {{ stats.categories.length }} Categories <i>·</i>
          {{ stats.tags.length }} Tags
        </div>
      </div>
    </div>

    <div v-if="error" class="error-box">{{ error }}</div>
    <div v-if="notice" class="notice-line">{{ notice }}</div>

    <div v-if="loading" class="loading-text">Loading ———</div>

    <div v-else-if="!totalPublished" class="empty">
      <span class="empty-en">No Published Posts</span>
      <span class="empty-cn">This page only manages published posts. Publish one first.</span>
    </div>

    <div v-else class="tx-layout">
      <!-- 分类 -->
      <section class="panel tx-panel">
        <div class="tx-panel__head">
          <span class="field-label">Categories</span>
          <span class="tx-panel__count">{{ stats.categories.length }}</span>
        </div>
        <p class="tx-help">
          Rename a category everywhere, merge it into another, or move its posts back to UNFILED.
        </p>

        <ol v-if="stats.categories.length" class="tx-list">
          <li
            v-for="(item, i) in stats.categories"
            :key="item.name"
            class="tx-row"
            :class="{ 'is-busy': busy === `category:${item.name}` }"
          >
            <span class="tx-row__index">{{ String(i + 1).padStart(2, '0') }}</span>

            <div class="tx-row__body">
              <form
                v-if="editing.kind === 'category' && editing.name === item.name"
                class="tx-rename"
                @submit.prevent="submitEdit"
              >
                <input
                  :ref="setRenameInput"
                  v-model="editing.value"
                  class="tx-rename__input"
                  maxlength="24"
                  aria-label="New category name"
                  @keydown.esc.prevent="cancelEdit"
                >
                <button type="submit" class="btn btn-sm btn-primary" :disabled="busy === `category:${item.name}`">Save</button>
                <button type="button" class="btn btn-sm btn-secondary" @click="cancelEdit">Cancel</button>
              </form>

              <template v-else>
                <span class="tx-row__name">{{ item.name }}</span>
                <span class="tx-row__count">{{ item.count }} {{ item.count === 1 ? 'post' : 'posts' }}</span>
              </template>
            </div>

            <div
              v-if="!(editing.kind === 'category' && editing.name === item.name)"
              class="tx-row__actions"
            >
              <button
                type="button"
                class="btn btn-sm btn-secondary"
                :disabled="!!busy"
                @click="startEdit('category', item.name)"
              >Rename</button>

              <select
                class="tx-merge"
                :disabled="!!busy || categoryMergeTargets(item.name).length === 0"
                aria-label="Merge category into another"
                @change="onMerge('category', item.name, $event)"
              >
                <option value="">Merge →</option>
                <option v-for="target in categoryMergeTargets(item.name)" :key="target" :value="target">{{ target }}</option>
              </select>

              <button
                v-if="item.name !== 'UNFILED'"
                type="button"
                class="btn btn-sm btn-danger"
                :disabled="!!busy"
                @click="removeCategory(item.name)"
              >→ UNFILED</button>
            </div>
          </li>
        </ol>

        <p v-else class="tx-none">No categories yet.</p>
      </section>

      <!-- 标签 -->
      <section class="panel tx-panel">
        <div class="tx-panel__head">
          <span class="field-label">Tags</span>
          <span class="tx-panel__count">{{ stats.tags.length }}</span>
        </div>
        <p class="tx-help">
          Rename a tag everywhere, merge it into another, or remove it from every published post.
        </p>

        <ol v-if="stats.tags.length" class="tx-list">
          <li
            v-for="(item, i) in stats.tags"
            :key="item.name"
            class="tx-row"
            :class="{ 'is-busy': busy === `tag:${item.name}` }"
          >
            <span class="tx-row__index">{{ String(i + 1).padStart(2, '0') }}</span>

            <div class="tx-row__body">
              <form
                v-if="editing.kind === 'tag' && editing.name === item.name"
                class="tx-rename"
                @submit.prevent="submitEdit"
              >
                <input
                  :ref="setRenameInput"
                  v-model="editing.value"
                  class="tx-rename__input"
                  maxlength="24"
                  aria-label="New tag name"
                  @keydown.esc.prevent="cancelEdit"
                >
                <button type="submit" class="btn btn-sm btn-primary" :disabled="busy === `tag:${item.name}`">Save</button>
                <button type="button" class="btn btn-sm btn-secondary" @click="cancelEdit">Cancel</button>
              </form>

              <template v-else>
                <span class="tx-row__name">{{ item.name }}</span>
                <span class="tx-row__count">{{ item.count }} {{ item.count === 1 ? 'post' : 'posts' }}</span>
              </template>
            </div>

            <div
              v-if="!(editing.kind === 'tag' && editing.name === item.name)"
              class="tx-row__actions"
            >
              <button
                type="button"
                class="btn btn-sm btn-secondary"
                :disabled="!!busy"
                @click="startEdit('tag', item.name)"
              >Rename</button>

              <select
                class="tx-merge"
                :disabled="!!busy || tagMergeTargets(item.name).length === 0"
                aria-label="Merge tag into another"
                @change="onMerge('tag', item.name, $event)"
              >
                <option value="">Merge →</option>
                <option v-for="target in tagMergeTargets(item.name)" :key="target" :value="target">{{ target }}</option>
              </select>

              <button
                type="button"
                class="btn btn-sm btn-danger"
                :disabled="!!busy"
                @click="removeTag(item.name)"
              >Delete</button>
            </div>
          </li>
        </ol>

        <p v-else class="tx-none">No tags yet.</p>
      </section>
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

.notice-line {
  margin-bottom: 22px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--text-primary);
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.03em;
  color: var(--text-secondary);
}

.tx-layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
  align-items: start;
}

.tx-panel { padding: 0; }

.tx-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--text-primary);
}
.tx-panel__head .field-label { margin-bottom: 0; }
.tx-panel__count {
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.14em;
  color: var(--text-secondary);
}

.tx-help {
  margin: 0;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 0.54rem;
  line-height: 1.65;
  letter-spacing: 0.02em;
  color: var(--text-secondary);
  opacity: 0.85;
}

.tx-list { list-style: none; }

.tx-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  transition: background-color 0.16s ease;
}
.tx-row:last-child { border-bottom: 0; }
.tx-row:hover { background: var(--bg-secondary); }
.tx-row.is-busy { opacity: 0.55; pointer-events: none; }

.tx-row__index {
  font-family: var(--font-mono);
  font-size: 0.52rem;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
  opacity: 0.7;
}

.tx-row__body { min-width: 0; }

.tx-row__name {
  display: block;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1rem;
  line-height: 1.25;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  overflow-wrap: anywhere;
}

.tx-row__count {
  display: block;
  margin-top: 2px;
  font-family: var(--font-mono);
  font-size: 0.52rem;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.tx-row__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}
.tx-row__actions .btn { min-height: 28px; padding: 0 10px; font-size: 0.5rem; letter-spacing: 0.12em; }

.tx-merge {
  width: auto;
  min-width: 94px;
  min-height: 28px;
  padding: 0 8px;
  font-family: var(--font-mono);
  font-size: 0.52rem;
  letter-spacing: 0.04em;
  background: transparent;
  border-color: var(--border);
  color: var(--text-secondary);
}
.tx-merge:focus { border-color: var(--text-primary); color: var(--text-primary); }

.tx-rename {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.tx-rename__input {
  flex: 1 1 140px;
  min-width: 0;
  min-height: 30px;
  padding: 2px 8px;
  font-family: var(--font-display);
  font-size: 0.9rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.tx-rename .btn { min-height: 30px; }

.tx-none {
  padding: 28px 20px;
  font-family: var(--font-mono);
  font-size: 0.56rem;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
}

@media (max-width: 1024px) {
  .tx-layout { grid-template-columns: minmax(0, 1fr); }
}

@media (max-width: 768px) {
  .tx-row {
    grid-template-columns: 22px minmax(0, 1fr);
    gap: 8px 10px;
    padding: 12px 14px;
  }
  .tx-row__actions {
    grid-column: 2;
    justify-content: flex-start;
  }
  .tx-panel__head, .tx-help { padding-left: 14px; padding-right: 14px; }
}

@media (hover: none) {
  .tx-row__actions .btn,
  .tx-merge,
  .tx-rename .btn,
  .tx-rename__input { min-height: 44px; }
  .tx-merge { font-size: 16px; }
  .tx-rename__input { font-size: 16px; }
}
</style>
