<script setup>
// LIFE 归档页：全量原始数据（不脱敏，只由上游遮盖凭证参数）。
//
// 一个组件按路由参数 kind 切换六种视图：
//   journal / notes / tasks / qa / events / weekly
//
// 索引来自 /api/life/raw/index（R2 里的 key 列表），内容按天通过
// /api/life/raw/:kind/:id 取。日记由 Worker 用 marked 渲染成 HTML；
// 其余 kind 返回解析后的 JSON。事件一天约 1000 条，默认只渲染前 120 条，
// 其余用 LOAD MORE 追加，避免一次挂几千个 DOM 节点。
import { computed, onActivated, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

const CMS_BASE =
  import.meta.env.VITE_CMS_BASE || 'https://cms.liveinpassion.me';

const KINDS = [
  { kind: 'journal', label: 'JOURNAL', blurb: 'Full daily entries' },
  { kind: 'notes', label: 'NOTES', blurb: 'Quick notes and recaps' },
  { kind: 'tasks', label: 'TASKS', blurb: 'Done and open' },
  { kind: 'qa', label: 'Q & A', blurb: 'Questions answered' },
  { kind: 'events', label: 'EVENTS', blurb: 'Raw event stream' },
  { kind: 'blocks', label: 'BLOCKS', blurb: 'Classified time blocks' },
  { kind: 'weekly', label: 'REVIEWS', blurb: 'Weekly summaries' },
  { kind: 'vault', label: 'VAULT', blurb: 'Master tasks, reviews and AI sessions' },
];
const KIND_MAP = Object.fromEntries(KINDS.map((k) => [k.kind, k]));
const EVENT_PAGE = 120;

const route = useRoute();

const kind = computed(() => {
  const k = String(route.params.kind || 'journal');
  return KIND_MAP[k] ? k : 'journal';
});
const kindMeta = computed(() => KIND_MAP[kind.value]);

const index = ref(null);
const data = ref(null);
const day = ref('');
const indexLoading = ref(true);
const loading = ref(true);
const error = ref(false);
const domainFilter = ref('all');
const visibleEvents = ref(EVENT_PAGE);

let requestSeq = 0;
let firstActivation = true;

function vaultRank(id) {
  if (id === 'tasks-master') return 0;
  if (id.startsWith('review-') && id !== 'review-cost-ledger') return 1;
  if (id === 'review-cost-ledger') return 2;
  if (id.startsWith('ai-session-')) return 3;
  return 9;
}

function vaultLabel(id) {
  if (!id) return '—';
  if (id === 'tasks-master') return 'MASTER TASKS';
  if (id === 'review-cost-ledger') return 'COST LEDGER';
  if (id.startsWith('review-')) return `REVIEW · ${id.slice(7).replace(/-/g, ' ').toUpperCase()}`;
  if (id.startsWith('ai-session-')) return `AI SESSION · ${id.slice(11)}`;
  return id.toUpperCase().replace(/-/g, ' ');
}

function dayLabel(id) {
  return kind.value === 'vault' ? vaultLabel(id) : id;
}

const days = computed(() => {
  const items = index.value?.kinds?.[kind.value] || [];
  if (kind.value !== 'vault') return items;
  return [...items].sort((a, b) => vaultRank(a.id) - vaultRank(b.id) || b.id.localeCompare(a.id));
});
const totalByKind = computed(() => index.value?.kinds || {});
const latest = computed(() => days.value[0]?.id || '—');

const notes = computed(() => (
  kind.value === 'notes' && Array.isArray(data.value?.data) ? data.value.data : []
));

const taskItems = computed(() => (
  kind.value === 'tasks' && Array.isArray(data.value?.data) ? data.value.data : []
));

const qaPairs = computed(() => {
  if (kind.value !== 'qa') return [];
  const qa = data.value?.data?.qa;
  return Array.isArray(qa) ? qa : [];
});

const events = computed(() => (
  kind.value === 'events' && Array.isArray(data.value?.data) ? data.value.data : []
));

const blocks = computed(() => (
  kind.value === 'blocks' && Array.isArray(data.value?.data) ? data.value.data : []
));

const domains = computed(() => [...new Set(events.value.map((e) => e.domain))].sort());
const filteredEvents = computed(() => (
  domainFilter.value === 'all'
    ? events.value
    : events.value.filter((e) => e.domain === domainFilter.value)
));
const visibleEventRows = computed(() => filteredEvents.value.slice(0, visibleEvents.value));

const weeklyData = computed(() => (
  kind.value === 'weekly' && data.value?.data && typeof data.value.data === 'object'
    ? data.value.data
    : null
));
const weeklyFacts = computed(() => (
  Array.isArray(weeklyData.value?.facts) ? weeklyData.value.facts : []
));

const itemCount = computed(() => {
  if (kind.value === 'journal' || kind.value === 'vault') return data.value?.html ? 1 : 0;
  if (kind.value === 'notes') return notes.value.length;
  if (kind.value === 'tasks') return taskItems.value.length;
  if (kind.value === 'qa') return qaPairs.value.length;
  if (kind.value === 'events') return events.value.length;
  if (kind.value === 'blocks') return blocks.value.length;
  if (kind.value === 'weekly') return weeklyFacts.value.length;
  return 0;
});

function fmtTs(ts) {
  if (!ts) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(ts));
  } catch {
    return ts;
  }
}

function fmtClock(ts) {
  if (!ts) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ts));
  } catch {
    return ts;
  }
}

function safeUrl(url) {
  return /^https?:\/\//i.test(url || '') ? url : null;
}

function eventValue(e) {
  if (e.value_text && e.value_num != null) return `${e.value_text} · ${e.value_num}`;
  if (e.value_text) return e.value_text;
  if (e.value_num != null) return String(e.value_num);
  return '—';
}

function prettyMeta(meta) {
  try {
    return JSON.stringify(meta, null, 2);
  } catch {
    return '';
  }
}

function factText(f) {
  return typeof f === 'string' ? f : JSON.stringify(f);
}

function countDomain(domain) {
  return events.value.filter((e) => e.domain === domain).length;
}

function setDomain(domain) {
  domainFilter.value = domain;
  visibleEvents.value = EVENT_PAGE;
}

async function loadIndex() {
  indexLoading.value = true;
  try {
    const res = await fetch(`${CMS_BASE}/api/life/raw/index`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`index ${res.status}`);
    index.value = await res.json();
    error.value = false;
  } catch {
    error.value = true;
  } finally {
    indexLoading.value = false;
  }

  const ids = days.value.map((d) => d.id);
  if (!ids.includes(day.value)) day.value = ids[0] || '';
  if (day.value) {
    await loadDoc();
  } else {
    loading.value = false;
    data.value = null;
  }
}

async function loadDoc() {
  if (!day.value) {
    loading.value = false;
    data.value = null;
    return;
  }

  loading.value = true;
  error.value = false;
  const seq = ++requestSeq;

  try {
    const url = `${CMS_BASE}/api/life/raw/${kind.value}/${encodeURIComponent(day.value)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`doc ${res.status}`);
    const json = await res.json();
    if (seq !== requestSeq) return;
    data.value = json;
    domainFilter.value = 'all';
    visibleEvents.value = EVENT_PAGE;
  } catch {
    if (seq === requestSeq) {
      data.value = null;
      error.value = true;
    }
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}

function selectDay(id) {
  if (id === day.value) return;
  day.value = id;
  loadDoc();
}

watch(kind, async () => {
  data.value = null;
  const ids = days.value.map((d) => d.id);
  day.value = ids[0] || '';
  if (!index.value) {
    await loadIndex();
    return;
  }
  if (day.value) await loadDoc();
  else {
    loading.value = false;
    error.value = false;
  }
});

onMounted(loadIndex);

onActivated(() => {
  if (firstActivation) {
    firstActivation = false;
    return;
  }
  loadIndex();
});
</script>

<template>
  <main class="page active">
    <section class="stats-section life-archive-section">
      <div class="stats-hero life-archive-hero">
        <div class="stats-hero-kicker">
          <span class="stats-kicker stats-live">
            <i class="stats-live-dot" aria-hidden="true"></i>
            Raw life log
          </span>
          <span class="stats-kicker stats-kicker-rule" aria-hidden="true"></span>
          <span class="stats-kicker">Everything public</span>
        </div>

        <h1 class="stats-title life-archive-title" aria-label="ARCHIVE">ARCHIVE</h1>

        <div class="stats-hero-rule" aria-hidden="true"><span></span></div>

        <p class="stats-subtitle">{{ kindMeta.blurb }} — as it happened.</p>

        <div class="stats-hero-meta">
          <span>{{ kindMeta.label }}</span>
          <i aria-hidden="true"></i>
          <span>{{ days.length }} entries</span>
          <i aria-hidden="true"></i>
          <span>Latest {{ dayLabel(latest) }}</span>
        </div>
      </div>

      <nav class="life-archive-tabs" aria-label="Archive sections">
        <router-link
          v-for="t in KINDS"
          :key="t.kind"
          :to="`/life/archive/${t.kind}`"
          class="life-archive-tab"
          :class="{ 'is-active': t.kind === kind }"
        >
          {{ t.label }}
          <span class="life-archive-tab-count">{{ (totalByKind[t.kind] || []).length }}</span>
        </router-link>
      </nav>

      <div v-if="indexLoading" class="stats-loading life-archive-loading" aria-label="Loading archive">
        <span v-for="n in 3" :key="n"></span>
      </div>

      <div v-else-if="error" class="stats-empty">
        <p>The archive is temporarily unavailable.</p>
        <button class="stats-retry" @click="loadIndex">RETRY</button>
      </div>

      <template v-else>
        <div v-if="days.length" class="life-daybar" role="tablist" aria-label="Archive days">
          <button
            v-for="d in days"
            :key="d.id"
            class="life-day"
            :class="{ 'is-active': d.id === day }"
            role="tab"
            :aria-selected="d.id === day"
            @click="selectDay(d.id)"
          >
            {{ dayLabel(d.id) }}
          </button>
        </div>

        <div v-if="loading" class="stats-loading life-archive-loading">
          <span v-for="n in 3" :key="n"></span>
        </div>

        <div v-else-if="!day" class="stats-empty">
          <p>No entries in this section yet.</p>
        </div>

        <div v-else class="life-doc-panel">
          <div class="life-doc-head">
            <span class="life-doc-kind">{{ kindMeta.label }}</span>
            <span class="life-doc-day">{{ dayLabel(day) }}</span>
            <span class="life-doc-count">{{ itemCount }} {{ kind === 'journal' || kind === 'vault' ? 'ENTRY' : 'ITEMS' }}</span>
          </div>

          <!-- JOURNAL / VAULT（都是 Markdown 文档） -->
          <template v-if="kind === 'journal' || kind === 'vault'">
            <div v-if="data?.html" class="life-doc" v-html="data.html"></div>
            <p v-else class="stats-panel-empty">No journal for this day.</p>
            <details v-if="data?.raw" class="life-raw-details">
              <summary>RAW MARKDOWN</summary>
              <pre>{{ data.raw }}</pre>
            </details>
          </template>

          <!-- NOTES -->
          <template v-else-if="kind === 'notes'">
            <article v-for="(n, i) in notes" :key="i" class="life-note">
              <div class="life-note-meta">
                <span>{{ fmtTs(n.ts_utc) }}</span>
                <span>{{ n.source }}</span>
              </div>
              <p class="life-note-text">{{ n.text }}</p>
            </article>
            <p v-if="!notes.length" class="stats-panel-empty">No notes for this day.</p>
          </template>

          <!-- TASKS -->
          <template v-else-if="kind === 'tasks'">
            <ul v-if="taskItems.length" class="life-tasks">
              <li
                v-for="(t, i) in taskItems"
                :key="i"
                class="life-task"
                :class="{ 'is-done': t.done }"
              >
                <span class="life-task-box" aria-hidden="true">{{ t.done ? '✓' : '□' }}</span>
                <span class="life-task-text">{{ t.text }}</span>
              </li>
            </ul>
            <p v-else class="stats-panel-empty">No tasks for this day.</p>
          </template>

          <!-- Q & A -->
          <template v-else-if="kind === 'qa'">
            <article v-for="(q, i) in qaPairs" :key="q.id || i" class="life-qa">
              <div class="life-qa-meta">
                <span>{{ fmtTs(q.ts_utc) }}</span>
                <span>{{ q.source }}</span>
                <span>{{ q.kind }}</span>
              </div>
              <p class="life-qa-question">{{ q.text }}</p>
              <p class="life-qa-answer">
                <span class="life-qa-label">A</span>{{ q.answer || '—' }}
              </p>
              <p v-if="q.note" class="life-qa-note">
                <span class="life-qa-label">N</span>{{ q.note }}
              </p>
              <ul v-if="q.options?.length" class="life-qa-options">
                <li v-for="o in q.options" :key="o">{{ o }}</li>
              </ul>
            </article>
            <p v-if="!qaPairs.length" class="stats-panel-empty">No Q&amp;A for this day.</p>
          </template>

          <!-- EVENTS -->
          <template v-else-if="kind === 'events'">
            <div class="life-event-filters">
              <button
                class="life-filter"
                :class="{ 'is-active': domainFilter === 'all' }"
                @click="setDomain('all')"
              >
                ALL <b>{{ events.length }}</b>
              </button>
              <button
                v-for="d in domains"
                :key="d"
                class="life-filter"
                :class="{ 'is-active': domainFilter === d }"
                @click="setDomain(d)"
              >
                {{ d }} <b>{{ countDomain(d) }}</b>
              </button>
            </div>

            <div v-if="events.length" class="life-event-table">
              <div v-for="(e, i) in visibleEventRows" :key="i" class="life-event">
                <div class="life-event-main">
                  <span class="life-event-time">{{ fmtTs(e.ts_utc) }}</span>
                  <span class="life-event-domain">{{ e.domain }}</span>
                  <span class="life-event-metric">{{ e.metric }}</span>
                  <span class="life-event-value">{{ eventValue(e) }}</span>
                  <span class="life-event-source">{{ e.source }}</span>
                </div>
                <details v-if="e.meta && Object.keys(e.meta).length" class="life-event-meta">
                  <summary>META</summary>
                  <pre>{{ prettyMeta(e.meta) }}</pre>
                </details>
              </div>
            </div>
            <p v-else class="stats-panel-empty">No events for this day.</p>

            <button
              v-if="filteredEvents.length > visibleEvents"
              class="life-loadmore"
              @click="visibleEvents += 200"
            >
              LOAD MORE ({{ filteredEvents.length - visibleEvents }})
            </button>
          </template>

          <!-- BLOCKS -->
          <template v-else-if="kind === 'blocks'">
            <div v-if="blocks.length" class="life-blocks">
              <article
                v-for="(b, i) in blocks"
                :key="i"
                class="life-block"
                :class="{ 'is-blackhole': b.blackhole }"
              >
                <div class="life-block-main">
                  <span class="life-block-time">{{ fmtClock(b.start_utc) }}–{{ fmtClock(b.end_utc) }}</span>
                  <span class="life-block-hours">{{ Number(b.hours || 0).toFixed(2) }}h</span>
                  <span class="life-block-category">{{ b.category }}</span>
                  <span class="life-block-app">{{ b.app || '—' }}</span>
                </div>
                <p class="life-block-title">{{ b.title || '—' }}</p>
                <p v-if="b.url" class="life-block-url">
                  <a v-if="safeUrl(b.url)" :href="b.url" target="_blank" rel="noopener">{{ b.url }}</a>
                  <span v-else>{{ b.url }}</span>
                </p>
                <div class="life-block-meta">
                  <span>{{ b.confidence || '—' }}</span>
                  <span>{{ b.source }}</span>
                  <span v-if="b.blackhole">BLACKHOLE</span>
                </div>
              </article>
            </div>
            <p v-else class="stats-panel-empty">No blocks for this day.</p>
          </template>

          <!-- WEEKLY -->
          <template v-else-if="kind === 'weekly'">
            <div v-if="weeklyData" class="life-weekly">
              <p class="life-weekly-range">{{ weeklyData.from }} → {{ weeklyData.to }}</p>
              <pre v-if="weeklyData.prose" class="life-prose">{{ weeklyData.prose }}</pre>
              <ul v-if="weeklyFacts.length" class="life-weekly-facts">
                <li v-for="(f, i) in weeklyFacts" :key="i">{{ factText(f) }}</li>
              </ul>
            </div>
            <p v-else class="stats-panel-empty">No weekly review in this archive yet.</p>
          </template>
        </div>

        <p class="life-archive-disclaimer">
          <i aria-hidden="true"></i>
          Raw archive: coordinates, window titles, URLs, journals and notes are public.
          Credential-like URL query values are replaced with REDACTED.
        </p>
      </template>
    </section>
  </main>
</template>
