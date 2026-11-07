<script setup>
// 首页右侧展示的编辑页。
//
//   · LATEST ECHO / LATEST PHOTO 是自动的，不在这里选（Worker 按发布时间算）。
//   · AUTHOR'S SELECTED 是手动清单：从 Echo / Photography / Film 三类里挑，
//     上下箭头调顺序，每类还各有一个"最多显示几条"的上限。
//   · 选了但超出上限的条目会保留在清单里，只是首页不显示 —— 调整上限即可恢复。
import { computed, onMounted, ref } from 'vue';
import { showcaseApi } from '../api.js';
import AdminIcon from '../components/AdminIcon.vue';

const KINDS = [
  { id: 'echo', label: 'Echo' },
  { id: 'photography', label: 'Photography' },
  { id: 'film', label: 'Film' },
];

const loading = ref(true);
const saving = ref(false);
const error = ref('');
const notice = ref('');
const dirty = ref(false);

const limits = ref({ echo: 4, photography: 3, film: 2 });
const items = ref([]); // [{ kind, refId }] 顺序即展示顺序
const options = ref({ echo: [], photography: [], film: [] });

const optionMap = computed(() => {
  const map = new Map();
  for (const kind of Object.keys(options.value)) {
    for (const option of options.value[kind] || []) {
      map.set(`${kind}:${option.refId}`, option);
    }
  }
  return map;
});

function optionFor(kind, refId) {
  return optionMap.value.get(`${kind}:${refId}`) || null;
}

function isSelected(kind, refId) {
  return items.value.some((item) => item.kind === kind && item.refId === refId);
}

function countOf(kind) {
  return items.value.filter((item) => item.kind === kind).length;
}

function visibleCount(kind) {
  return Math.min(countOf(kind), Number(limits.value[kind]) || 0);
}

/** 这一条按当前顺序是否落在该类的显示上限之内 */
function isVisibleItem(item, index) {
  const positionInKind = items.value
    .slice(0, index)
    .filter((x) => x.kind === item.kind)
    .length;
  return positionInKind < (Number(limits.value[item.kind]) || 0);
}

function toggle(kind, option) {
  if (!option || option.status === 'draft') return;
  const index = items.value.findIndex(
    (item) => item.kind === kind && item.refId === option.refId
  );
  if (index >= 0) items.value.splice(index, 1);
  else items.value.push({ kind, refId: option.refId });
  dirty.value = true;
  notice.value = '';
}

function move(index, delta) {
  const next = index + delta;
  if (next < 0 || next >= items.value.length) return;
  const [item] = items.value.splice(index, 1);
  items.value.splice(next, 0, item);
  dirty.value = true;
  notice.value = '';
}

function remove(index) {
  items.value.splice(index, 1);
  dirty.value = true;
  notice.value = '';
}

function onLimitInput() {
  dirty.value = true;
  notice.value = '';
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await showcaseApi.get();
    limits.value = { ...limits.value, ...(data.limits || {}) };
    items.value = Array.isArray(data.items) ? data.items.slice() : [];
    options.value = {
      echo: data.options?.echo || [],
      photography: data.options?.photography || [],
      film: data.options?.film || [],
    };
    dirty.value = false;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  error.value = '';
  notice.value = '';
  try {
    await showcaseApi.save({
      limits: {
        echo: Number(limits.value.echo) || 0,
        photography: Number(limits.value.photography) || 0,
        film: Number(limits.value.film) || 0,
      },
      items: items.value.map((item) => ({ kind: item.kind, refId: item.refId })),
    });
    dirty.value = false;
    notice.value = 'Saved — the site will rebuild automatically.';
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <div class="eyebrow">Content Desk — 03 / Home Showcase</div>
        <h1>Home Showcase</h1>
      </div>
      <div class="page-head__side">
        <div class="meta-line">
          {{ items.length }} Selected <i>·</i> 3 Types
        </div>
        <button class="btn btn-primary" :disabled="saving || !dirty" @click="save">
          {{ saving ? 'Saving…' : 'Save Showcase' }}
        </button>
      </div>
    </div>

    <div v-if="error" class="error-box">{{ error }}</div>
    <div v-if="notice" class="notice-line">{{ notice }}</div>

    <div v-if="loading" class="loading-text">Loading ———</div>

    <template v-else>
      <!-- 每类上限 -->
      <section class="panel limits">
        <div class="limits__head">
          <span class="field-label">Display limits</span>
          <span class="field-hint">
            LATEST ECHO / LATEST PHOTO are automatic and not counted here.
          </span>
        </div>
        <div class="limits__grid">
          <label v-for="kind in KINDS" :key="kind.id" class="limit-field">
            <span class="field-label">{{ kind.label }}</span>
            <input
              v-model.number="limits[kind.id]"
              type="number"
              min="0"
              max="12"
              step="1"
              @input="onLimitInput"
            >
            <span class="field-hint">
              Selected {{ countOf(kind.id) }} · showing {{ visibleCount(kind.id) }}
            </span>
          </label>
        </div>
      </section>

      <div class="sc-layout">
        <!-- 已选清单 -->
        <section class="panel sc-selected">
          <div class="sc-selected__head">
            <span class="field-label">Author's Selected — order</span>
          </div>

          <ol v-if="items.length" class="sc-rows">
            <li v-for="(item, index) in items" :key="`${item.kind}:${item.refId}`" class="sc-row">
              <span class="sc-row__index">{{ String(index + 1).padStart(2, '0') }}</span>

              <span class="sc-row__thumb">
                <img
                  v-if="optionFor(item.kind, item.refId)?.image"
                  :src="optionFor(item.kind, item.refId).image"
                  alt=""
                  loading="lazy"
                >
                <span v-else class="sc-row__noimg">—</span>
              </span>

              <span class="sc-row__body">
                <span class="sc-row__kind">{{ item.kind }}</span>
                <strong class="sc-row__title">
                  {{ optionFor(item.kind, item.refId)?.title || 'Unavailable (deleted or unpublished)' }}
                </strong>
                <span class="sc-row__meta">
                  {{ optionFor(item.kind, item.refId)?.meta || `#${item.refId}` }}
                  <span v-if="!isVisibleItem(item, index)" class="sc-row__hidden">· hidden by limit</span>
                </span>
              </span>

              <span class="sc-row__actions">
                <button class="btn btn-sm btn-secondary" :disabled="index === 0" @click="move(index, -1)" aria-label="Move up">↑</button>
                <button class="btn btn-sm btn-secondary" :disabled="index === items.length - 1" @click="move(index, 1)" aria-label="Move down">↓</button>
                <button class="btn btn-sm btn-danger" @click="remove(index)" aria-label="Remove"><AdminIcon name="x" :size="12" /></button>
              </span>
            </li>
          </ol>

          <div v-else class="empty">
            <span class="empty-en">Nothing selected</span>
            <span class="empty-cn">Choose an item from the three categories on the right to add it.</span>
          </div>
        </section>

        <!-- 可选项 -->
        <section class="sc-options">
          <div v-for="kind in KINDS" :key="kind.id" class="panel sc-kind">
            <div class="sc-kind__head">
              <span class="field-label">{{ kind.label }}</span>
              <span class="sc-kind__count">
                {{ visibleCount(kind.id) }} / {{ countOf(kind.id) }}
              </span>
            </div>

            <ul v-if="options[kind.id]?.length" class="sc-option-list">
              <li
                v-for="option in options[kind.id]"
                :key="option.refId"
                class="sc-option"
                :class="{
                  'is-selected': isSelected(kind.id, option.refId),
                  'is-disabled': option.status === 'draft',
                }"
              >
                <span class="sc-option__thumb">
                  <img v-if="option.image" :src="option.image" alt="" loading="lazy">
                  <span v-else class="sc-row__noimg">—</span>
                </span>
                <span class="sc-option__body">
                  <strong>{{ option.title }}</strong>
                  <span>{{ option.meta }}</span>
                </span>
                <span v-if="option.status === 'draft'" class="tag tag-draft">Draft</span>
                <button
                  v-else
                  class="btn btn-sm"
                  :class="isSelected(kind.id, option.refId) ? 'btn-primary' : 'btn-secondary'"
                  @click="toggle(kind.id, option)"
                >
                  <AdminIcon :name="isSelected(kind.id, option.refId) ? 'check' : 'plus'" :size="12" />
                </button>
              </li>
            </ul>

            <div v-else class="empty empty--small">
              <span class="empty-en">No {{ kind.label }}</span>
              <span class="empty-cn">No selectable items in this category yet.</span>
            </div>
          </div>
        </section>
      </div>
    </template>
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
  color: var(--text-primary);
}

.limits {
  margin-bottom: 22px;
}

.limits__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px 20px;
  margin-bottom: 16px;
}

.limits__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.limit-field {
  display: block;
}

.limit-field input {
  display: block;
  max-width: 120px;
}

.sc-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 22px;
  align-items: start;
}

.sc-selected {
  position: sticky;
  top: calc(var(--nav-h, 64px) + 20px);
}

.sc-rows {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
}

.sc-row {
  display: grid;
  grid-template-columns: 26px 56px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}

.sc-row:last-child {
  border-bottom: 0;
}

.sc-row__index {
  font-family: var(--font-mono);
  font-size: 0.52rem;
  color: var(--text-secondary);
}

.sc-row__thumb {
  width: 56px;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  display: block;
}

.sc-row__thumb img,
.sc-option__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.sc-row__noimg {
  display: grid;
  place-items: center;
  height: 100%;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 0.6rem;
}

.sc-row__body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sc-row__kind {
  font-family: var(--font-mono);
  font-size: 0.48rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.sc-row__title {
  font-family: var(--font-display);
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sc-row__meta {
  font-family: var(--font-mono);
  font-size: 0.5rem;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.sc-row__hidden {
  color: var(--danger);
}

.sc-row__actions {
  display: inline-flex;
  gap: 4px;
}

.sc-row__actions .btn {
  min-width: 30px;
  padding: 0 8px;
}

.sc-options {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.sc-kind__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.sc-kind__count {
  font-family: var(--font-mono);
  font-size: 0.55rem;
  color: var(--text-secondary);
}

.sc-option-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 360px;
  overflow-y: auto;
}

.sc-option {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--border);
}

.sc-option:last-child {
  border-bottom: 0;
}

.sc-option.is-selected {
  background: color-mix(in srgb, var(--text-primary) 6%, transparent);
}

.sc-option.is-disabled {
  opacity: 0.45;
}

.sc-option__thumb {
  width: 44px;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  display: block;
}

.sc-option__body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.sc-option__body strong {
  font-family: var(--font-display);
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sc-option__body span {
  font-family: var(--font-mono);
  font-size: 0.48rem;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.sc-option .btn {
  min-width: 34px;
  padding: 0 9px;
}

.empty--small {
  padding: 22px 12px;
}

@media (max-width: 980px) {
  .sc-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .sc-selected {
    position: static;
  }

  .limits__grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .limits__grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .sc-row {
    grid-template-columns: 20px 46px minmax(0, 1fr);
  }

  .sc-row__thumb {
    width: 46px;
  }

  .sc-row__actions {
    grid-column: 2 / -1;
    justify-content: flex-end;
  }
}
</style>