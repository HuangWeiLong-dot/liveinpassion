<script setup>
// LIFE 页顶部的「现在在干嘛」。
//
// 数据来自 GET /api/life/now（LifeLogging 的 run_live.ps1 每 2 分钟整份覆写）：
//   · 位置：Dawarich 的最后一个 visit / transport（含坐标）
//   · 实时问答：中继里最新的一条 live Q&A（问题 + 我的回答）
//   · 电脑：push_desktop.py 推到中继的当前窗口快照
//   · 手机：最后一条应用切换 / 解锁
//   · 手表：Gadgetbridge 汇总（可能滞后，看 synced 字段）
//
// 这个组件自己轮询，不依赖 LIFE 的 /api/life；60 秒的页面轮询和它是两条线。
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue';

const emit = defineEmits(['snapshot']);

const CMS_BASE = import.meta.env.VITE_CMS_BASE || 'https://cms.liveinpassion.me';
const POLL_MS = 30000;
const TICK_MS = 5000;

const snap = ref(null);
const loading = ref(true);
const offline = ref(false);
const error = ref(false);
const nowMs = ref(Date.now());

let pollTimer = null;
let tickTimer = null;
let active = false;
let abortCtl = null;
let started = false;

const loc = computed(() => snap.value?.location || null);
const desk = computed(() => snap.value?.desktop || null);
const phone = computed(() => snap.value?.phone || null);
const watch = computed(() => snap.value?.watch || null);
const qa = computed(() => snap.value?.qa || null);

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function age(value) {
  const d = parseDate(value);
  if (!d) return '—';
  const sec = Math.max(0, (nowMs.value - d.getTime()) / 1000);
  if (sec < 45) return 'JUST NOW';
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))}M AGO`;
  if (sec < 86400) return `${Math.round(sec / 3600)}H AGO`;
  return `${Math.round(sec / 86400)}D AGO`;
}

function hhmm(value) {
  const d = parseDate(value);
  if (!d) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(day) {
  if (!day) return '—';
  const [y, m, d] = day.split('-');
  return `${d}.${m}.${y}`;
}

function num(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

function minutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n < 60) return `${Math.round(n)} MIN`;
  return `${(n / 60).toFixed(1)} H`;
}

const updatedAgo = computed(() => age(snap.value?.ts_utc));
const locAge = computed(() => age(loc.value?.lastSeen));
const qaAge = computed(() => age(qa.value?.ts));
const deskAge = computed(() => age(desk.value?.lastSeen));
const phoneAge = computed(() => age(phone.value?.lastSeen));
const watchAge = computed(() => age(watch.value?.pushedAt));

const mapUrl = computed(() => {
  const l = loc.value;
  if (!l || l.lat == null || l.lon == null) return '';
  return `https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lon}#map=16/${l.lat}/${l.lon}`;
});

const qaOld = computed(() => {
  const d = parseDate(qa.value?.ts);
  return !!d && (nowMs.value - d.getTime()) > 2 * 3600 * 1000;
});

async function load() {
  if (!active) return;
  if (abortCtl) abortCtl.abort();
  abortCtl = new AbortController();
  try {
    const res = await fetch(`${CMS_BASE}/api/life/now`, {
      cache: 'no-store',
      signal: abortCtl.signal,
    });
    if (res.status === 404) {
      offline.value = true;
      error.value = false;
      snap.value = null;
      emit('snapshot', null);
      return;
    }
    if (!res.ok) throw new Error(`now ${res.status}`);
    snap.value = await res.json();
    offline.value = false;
    error.value = false;
    emit('snapshot', snap.value);
  } catch (err) {
    if (err?.name === 'AbortError') return;
    error.value = true;
  } finally {
    loading.value = false;
  }
}

function start() {
  if (active) return;
  active = true;
  load();
  pollTimer = setInterval(load, POLL_MS);
  tickTimer = setInterval(() => { nowMs.value = Date.now(); }, TICK_MS);
}

function stop() {
  active = false;
  clearInterval(pollTimer);
  clearInterval(tickTimer);
  pollTimer = null;
  tickTimer = null;
  if (abortCtl) abortCtl.abort();
  abortCtl = null;
}

function onVisibility() {
  if (document.hidden) stop();
  else if (started) start();
}

onMounted(() => {
  started = true;
  start();
  document.addEventListener('visibilitychange', onVisibility);
});

onActivated(() => {
  if (started) start();
});

onDeactivated(stop);

onBeforeUnmount(() => {
  stop();
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
  <section class="life-now" aria-label="What I am doing now">
    <div class="life-now-head">
      <span class="life-now-kicker">
        <i class="life-now-dot" aria-hidden="true"></i>
        WHAT I'M DOING NOW
      </span>
      <span class="life-now-updated">
        {{ loading ? 'CONNECTING…'
          : offline ? 'WAITING FOR THE FIRST LIVE SNAPSHOT'
          : error ? 'LIVE FEED OFFLINE'
          : `UPDATED ${updatedAgo}` }}
      </span>
    </div>

    <div class="life-now-grid">
      <article class="life-now-card life-now-location">
        <div class="life-now-label">
          <span>01</span> LOCATION
          <span
            v-if="loc?.mode"
            class="life-now-flag"
            :class="{ 'is-on': loc.mode !== 'stationary' }"
          >{{ loc.mode === 'stationary' ? 'STAYING' : 'MOVING' }}</span>
        </div>
        <template v-if="loc">
          <strong class="life-now-place">
            {{ loc.district || loc.city || '—' }}
            <em v-if="loc.area && loc.area !== loc.district">· {{ loc.area }}</em>
          </strong>
          <a
            v-if="loc.lat != null && loc.lon != null"
            class="life-now-coords"
            :href="mapUrl"
            target="_blank"
            rel="noopener"
          >{{ Number(loc.lat).toFixed(5) }}, {{ Number(loc.lon).toFixed(5) }}</a>
          <span v-else class="life-now-coords is-muted">NO COORDINATES</span>
          <div class="life-now-meta">
            <span v-if="loc.stayMinutes">{{ minutes(loc.stayMinutes) }}</span>
            <span>SEEN {{ hhmm(loc.lastSeen) }} · {{ locAge }}</span>
            <span v-if="loc.stale">NOT TODAY</span>
          </div>
        </template>
        <span v-else class="life-now-empty">NO LOCATION DATA</span>
      </article>

      <article class="life-now-card life-now-qa">
        <div class="life-now-label">
          <span>02</span> LIVE Q&amp;A
          <span v-if="qaOld" class="life-now-flag">LAST ANSWER</span>
        </div>
        <template v-if="qa">
          <strong class="life-now-answer">{{ qa.answer || '—' }}</strong>
          <p v-if="qa.question" class="life-now-question">{{ qa.question }}</p>
          <div class="life-now-meta">
            <span>{{ hhmm(qa.ts) }} · {{ qaAge }}</span>
            <span v-if="qa.kind">{{ String(qa.kind).toUpperCase() }}</span>
          </div>
        </template>
        <span v-else class="life-now-empty">NO LIVE ANSWER YET</span>
      </article>

      <article class="life-now-card">
        <div class="life-now-label">
          <span>03</span> DESKTOP
          <span v-if="desk?.running" class="life-now-flag is-on">RUNNING</span>
          <span v-else-if="desk?.afk" class="life-now-flag">AFK</span>
          <span v-else-if="desk" class="life-now-flag">IDLE</span>
        </div>
        <template v-if="desk">
          <template v-if="desk.running">
            <strong class="life-now-app">{{ desk.app || '—' }}</strong>
            <p v-if="desk.title" class="life-now-title">{{ desk.title }}</p>
            <div class="life-now-meta">
              <span v-if="desk.category">{{ String(desk.category).toUpperCase() }}</span>
              <span v-if="desk.since">SINCE {{ desk.since }}</span>
              <span>{{ deskAge }}</span>
            </div>
          </template>
          <template v-else>
            <strong class="life-now-app is-idle">IDLE</strong>
            <div class="life-now-meta">
              <span>{{ desk.app ? `LAST · ${desk.app}` : 'NO RECENT WINDOW' }}</span>
              <span>SEEN {{ hhmm(desk.lastSeen) }} · {{ deskAge }}</span>
            </div>
          </template>
        </template>
        <span v-else class="life-now-empty">NO DESKTOP SNAPSHOT</span>
      </article>

      <article class="life-now-card">
        <div class="life-now-label">
          <span>04</span> PHONE
          <span v-if="phone?.screenOn === true" class="life-now-flag is-on">SCREEN ON</span>
          <span v-else-if="phone?.screenOn === false" class="life-now-flag">SCREEN OFF</span>
          <span v-else-if="phone" class="life-now-flag">SCREEN —</span>
        </div>
        <template v-if="phone">
          <strong class="life-now-app">{{ phone.app || '—' }}</strong>
          <div class="life-now-meta">
            <span>{{ num(phone.unlocks) }} UNLOCKS TODAY</span>
            <span>SEEN {{ hhmm(phone.lastSeen) }} · {{ phoneAge }}</span>
          </div>
        </template>
        <span v-else class="life-now-empty">NO PHONE DATA</span>
      </article>

      <article class="life-now-card">
        <div class="life-now-label">
          <span>05</span> WATCH
          <span v-if="watch && !watch.synced" class="life-now-flag">NOT TODAY</span>
        </div>
        <template v-if="watch">
          <strong class="life-now-app">
            {{ num(watch.steps) }}<em>steps</em>
          </strong>
          <div class="life-now-meta">
            <span v-if="watch.hrAvg != null">HR {{ num(watch.hrAvg, 1) }} BPM</span>
            <span v-if="watch.day">{{ dayLabel(watch.day) }}</span>
            <span v-if="watch.pushedAt">UPDATED {{ hhmm(watch.pushedAt) }} · {{ watchAge }}</span>
            <span v-else-if="watch.synced">SYNCED</span>
            <span v-else>LAST SYNC · {{ watchAge }}</span>
          </div>
        </template>
        <span v-else class="life-now-empty">NO WATCH DATA</span>
      </article>
    </div>
  </section>
</template>

<style scoped>
.life-now {
  margin-top: 30px;
  border: 1px solid var(--border);
  background: var(--bg);
}

.life-now-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 20px;
  padding: 17px 24px;
  border-bottom: 1px solid var(--border);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.56rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.life-now-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-primary);
}

.life-now-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-primary);
  animation: life-now-pulse 1.5s steps(2, end) infinite;
}

.life-now-updated {
  color: var(--text-secondary);
}

.life-now-grid {
  display: grid;
  grid-template-columns: 1.25fr 1.55fr 1fr 1fr 1fr;
}

.life-now-card {
  min-width: 0;
  padding: 18px 20px 20px;
  border-right: 1px solid var(--border);
}

.life-now-card:last-child {
  border-right: 0;
}

.life-now-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.5rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.life-now-label span:first-child {
  opacity: 0.55;
}

.life-now-flag {
  margin-left: auto;
  padding: 2px 5px;
  border: 1px solid var(--border);
  color: var(--text-primary);
  font-size: 0.44rem;
  letter-spacing: 0.08em;
  white-space: nowrap;
}

.life-now-flag.is-on {
  border-color: var(--text-primary);
  background: var(--text-primary);
  color: var(--bg);
}

.life-now-place,
.life-now-answer,
.life-now-app {
  display: block;
  margin-top: 12px;
  font-family: 'Oswald', sans-serif;
  font-size: 1.24rem;
  font-weight: 500;
  line-height: 1.15;
  letter-spacing: 0.01em;
  color: var(--text-primary);
}

.life-now-place em {
  font-style: normal;
  font-weight: 300;
  color: var(--text-secondary);
  font-size: 0.72em;
}

.life-now-answer {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 1.08rem;
}

.life-now-app em {
  font-style: normal;
  margin-left: 5px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.42em;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.life-now-app.is-idle {
  color: var(--text-secondary);
}

.life-now-coords {
  display: inline-block;
  margin-top: 6px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.56rem;
  letter-spacing: 0.06em;
  color: var(--text-primary);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
}

.life-now-coords.is-muted {
  color: var(--text-secondary);
  text-decoration: none;
}

.life-now-title,
.life-now-question {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-top: 7px;
  font-size: 0.6rem;
  line-height: 1.55;
  color: var(--text-secondary);
}

.life-now-title {
  -webkit-line-clamp: 2;
}

.life-now-question {
  -webkit-line-clamp: 2;
  opacity: 0.82;
}

.life-now-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 11px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.48rem;
  letter-spacing: 0.08em;
  line-height: 1.6;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.life-now-empty {
  display: block;
  margin-top: 14px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.52rem;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
  opacity: 0.6;
}

@keyframes life-now-pulse {
  0%, 55% { opacity: 1; }
  56%, 100% { opacity: 0.18; }
}

@media (max-width: 1024px) {
  .life-now-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .life-now-card {
    border-bottom: 1px solid var(--border);
  }

  .life-now-card:nth-child(2n) {
    border-right: 0;
  }

  .life-now-card:last-child {
    border-bottom: 0;
  }

  .life-now-qa {
    border-right: 0;
  }
}

@media (max-width: 640px) {
  .life-now {
    margin-top: 22px;
  }

  .life-now-head {
    padding: 14px 16px;
  }

  .life-now-grid {
    grid-template-columns: 1fr;
  }

  .life-now-card {
    border-right: 0;
    border-bottom: 1px solid var(--border);
    padding: 16px;
  }

  .life-now-card:last-child {
    border-bottom: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .life-now-dot {
    animation: none;
  }
}
</style>
