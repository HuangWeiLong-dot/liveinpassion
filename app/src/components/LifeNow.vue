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
// watch as vueWatch：组件里已经有一个名为 watch 的 computed（手表数据）
import {
  computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref,
  watch as vueWatch,
} from 'vue';
import LifeIcon from './LifeIcon.vue';

const emit = defineEmits(['snapshot']);

const CMS_BASE = import.meta.env.VITE_CMS_BASE || 'https://cms.liveinpassion.me';
// 手机 App 播放中每 10 秒推一次位置；这里 5 秒拉一次，切歌/暂停基本即时可见
const POLL_MS = 5000;
// 歌词高亮靠本地时钟推进，2 秒一刷足够跟得上
const TICK_MS = 2000;

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

// 「正在播放」只认 30 分钟内的最后一条 music；更早的是「今天最后放的一首」
const musicLive = computed(() => {
  const d = parseDate(phone.value?.music?.at);
  return !!d && nowMs.value - d.getTime() < 30 * 60 * 1000;
});

// 手机 App 会单独给 artist/title；Tasker 只有「Artist - Title」一行，拆开展示。
const track = computed(() => {
  const m = phone.value?.music || {};
  if (m.artist) return { artist: m.artist, title: m.title || '' };
  const raw = m.raw || m.title || '';
  const i = raw.indexOf(' - ');
  return i > 0
    ? { artist: raw.slice(0, i).trim(), title: raw.slice(i + 3).trim() }
    : { artist: '', title: raw };
});

const networkLabel = computed(() => {
  const mode = phone.value?.network?.mode;
  return mode ? String(mode).toUpperCase() : '—';
});

const networkIcon = computed(() => (phone.value?.network?.mode === 'wifi' ? 'wifi' : 'signal'));

// ── 歌词 ──────────────────────────────────────────────────────
// LRC 形如 [00:19.16] 歌词；只保留有文字的带时间戳行。
const lyricLines = computed(() => {
  const raw = phone.value?.music?.lyrics;
  if (!raw) return [];
  return String(raw)
    .split('\n')
    .map((line) => {
      const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
      if (!m) return null;
      const text = m[3].trim();
      return text ? { t: Number(m[1]) * 60 + Number(m[2]), text } : null;
    })
    .filter(Boolean);
});

// 当前位置 = 最近一次打点的位置 + 之后流逝的时间（只在播放时累加）
const lyricTime = computed(() => {
  const m = phone.value?.music;
  if (!m) return 0;
  const anchor = parseDate(m.positionAt || m.at);
  const basePos = Number(m.position || 0);
  if (!anchor) return basePos;
  const elapsed = Math.max(0, (nowMs.value - anchor.getTime()) / 1000);
  // playing 为 null = 没有位置心跳（旧版 App），退回按「30 分钟内」当成在播
  const playing = m.playing == null ? musicLive.value : m.playing;
  return basePos + (playing ? elapsed : 0);
});

const lyricIndex = computed(() => {
  const lines = lyricLines.value;
  if (!lines.length) return -1;
  const t = lyricTime.value;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t <= t + 0.2) idx = i;
    else break;
  }
  return idx;
});

// 音乐软件那种聚焦：当前行最亮最大，上下行按距离淡出
function lyricStyle(i) {
  const idx = lyricIndex.value;
  if (idx < 0) return { opacity: 0.5 };
  const d = Math.abs(i - idx);
  const opacity = d === 0 ? 1 : d === 1 ? 0.42 : d === 2 ? 0.22 : 0.1;
  return {
    opacity,
    transform: `scale(${d === 0 ? 1.06 : 0.95})`,
    transformOrigin: 'center center',
  };
}

const lyricBox = ref(null);
const lyricOffset = ref(0);

async function scrollToCurrentLine() {
  await nextTick();
  const box = lyricBox.value;
  const i = lyricIndex.value;
  if (!box) return;
  if (i < 0) {
    lyricOffset.value = 0;
    return;
  }
  const list = box.querySelector('.life-now-lyric-list');
  const line = list?.children[i];
  if (!line) return;
  // 用 transform 位移而不是 scrollTop：scrollTop 会被 0 夹住，
  // 前几行永远贴顶；位移没有这个限制，焦点行始终在容器正中。
  lyricOffset.value = box.clientHeight / 2 - (line.offsetTop + line.clientHeight / 2);
}

// immediate：首屏歌词一到就滚到当前行，否则列表停在最上面，
// 看起来像「焦点错了」——其实是焦点行在可视区之外。
vueWatch([lyricIndex, lyricLines], scrollToCurrentLine, { immediate: true });

function mmss(value) {
  const s = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

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
          <span>01</span><LifeIcon name="location" /> LOCATION
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
          <span>02</span><LifeIcon name="qa" /> LIVE Q&amp;A
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
          <span>03</span><LifeIcon name="desktop" /> DESKTOP
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
          <span>04</span><LifeIcon name="watch" /> WATCH
          <span v-if="watch && !watch.synced" class="life-now-flag">NOT TODAY</span>
        </div>
        <template v-if="watch">
          <div class="life-now-steps">
            <svg class="life-now-steps-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8.5 20.5c-1.4 0-2.4-.9-2.4-2.3 0-1.9.9-3.3 1.4-5.2.5-1.9.5-3.8.5-5.7 0-1.6.9-2.8 2.4-2.8s2.4 1.1 2.4 2.8c0 1.9-.5 3.8-1 5.7-.5 1.9-1.4 3.3-1.4 5.2 0 1.4-1 2.3-2.4 2.3Z" />
              <path d="M15.8 18.8c1.2.2 2-.5 2.2-1.7.3-1.7-.4-3.1-.7-4.9-.3-1.8-.2-3.6 0-5.4.2-1.5-.4-2.7-1.7-2.9-1.3-.2-2.2.8-2.4 2.3-.2 1.8-.1 3.6.1 5.4.3 1.8 1 3.2 1 4.9.1 1.3.5 2.1 1.5 2.3Z" />
            </svg>
            <strong class="life-now-app">
              {{ num(watch.steps) }}<em>steps</em>
            </strong>
          </div>
          <div v-if="watch.hrAvg != null" class="life-now-heart">
            <svg class="life-now-heart-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 20.2 4.9 13.1a4.7 4.7 0 0 1 6.6-6.6l.5.5.5-.5a4.7 4.7 0 0 1 6.6 6.6Z" />
            </svg>
            <strong>{{ num(watch.hrAvg, 0) }}</strong><em>BPM</em>
            <span v-if="watch.hrMin != null">MIN {{ num(watch.hrMin) }}</span>
          </div>
          <div class="life-now-meta">
            <span v-if="watch.day">{{ dayLabel(watch.day) }}</span>
            <span v-if="watch.pushedAt">UPDATED {{ hhmm(watch.pushedAt) }} · {{ watchAge }}</span>
            <span v-else-if="watch.synced">SYNCED</span>
            <span v-else>LAST SYNC · {{ watchAge }}</span>
          </div>
        </template>
        <span v-else class="life-now-empty">NO WATCH DATA</span>
      </article>

      <article class="life-now-card is-full life-now-phone">
        <div class="life-now-label">
          <span>05</span><LifeIcon name="phone" /> PHONE
          <span v-if="phone?.screenOn === true" class="life-now-flag is-on">SCREEN ON</span>
          <span v-else-if="phone?.screenOn === false" class="life-now-flag">SCREEN OFF</span>
          <span v-else-if="phone" class="life-now-flag">SCREEN —</span>
        </div>
        <template v-if="phone">
          <div class="life-now-stats">
            <div
              class="life-now-stat is-battery"
              :class="{ 'is-charging': phone.battery && phone.battery.charging }"
            >
              <!-- 整个格子就是电池：水从左往右涨，右端是滚动的竖浪 -->
              <div
                class="life-battery-water"
                :style="{ width: (phone.battery ? Math.round(phone.battery.level) : 0) + '%' }"
                aria-hidden="true"
              >
                <span class="life-battery-body"></span>
                <svg class="life-battery-edge" viewBox="0 0 12 120" preserveAspectRatio="none">
                  <path d="M0 0 L0 120 L8 120 Q 12 105 8 90 T 8 60 T 8 30 T 8 0 Z" />
                </svg>
              </div>

              <b>{{ phone.battery ? Math.round(phone.battery.level) : '—' }}<small>%</small></b>
              <em>{{ phone.battery ? (phone.battery.charging ? 'CHARGING' : 'ON BATTERY') : 'NO BATTERY DATA' }}</em>
            </div>
            <div class="life-now-stat is-network">
              <span class="life-now-stat-icon"><LifeIcon :name="networkIcon" :size="16" /></span>
              <b>{{ networkLabel }}</b>
              <em>NETWORK</em>
            </div>
            <div class="life-now-stat is-notifications">
              <span class="life-now-stat-icon"><LifeIcon name="bell" :size="16" /></span>
              <b>{{ num(phone.notifications) }}</b>
              <em>NOTIFICATIONS TODAY</em>
            </div>
            <div class="life-now-stat is-unlocks">
              <span class="life-now-stat-icon"><LifeIcon name="screen" :size="16" /></span>
              <b>{{ num(phone.unlocks) }}</b>
              <em>UNLOCKS TODAY</em>
            </div>
          </div>

          <div v-if="phone.notificationsTop && phone.notificationsTop.length" class="life-now-toplist">
            <span v-for="[app, n] in phone.notificationsTop" :key="app">
              {{ app }} <b>{{ n }}</b>
            </span>
          </div>

          <div class="life-now-meta">
            <span v-if="phone.app">USING {{ phone.app }}</span>
            <span>SEEN {{ hhmm(phone.lastSeen) }} · {{ phoneAge }}</span>
          </div>
        </template>
        <span v-else class="life-now-empty">NO PHONE DATA</span>
      </article>

      <article class="life-now-card is-full life-now-music">
        <div class="life-now-label">
          <span>06</span><LifeIcon name="music" /> NOW PLAYING
          <span
            v-if="phone?.music && phone.music.title"
            class="life-now-flag"
            :class="{ 'is-on': musicLive }"
          >{{ musicLive ? 'PLAYING' : 'LAST TRACK' }}</span>
        </div>
        <template v-if="phone?.music && phone.music.title">
          <div class="life-now-music-body">
            <div class="life-now-track-row">
              <img
                v-if="phone.music.cover"
                class="life-now-cover"
                :src="`data:image/jpeg;base64,${phone.music.cover}`"
                alt=""
              />
              <div class="life-now-track-body">
                <strong class="life-now-track">{{ track.artist || track.title }}</strong>
                <p v-if="track.artist" class="life-now-track-title">{{ track.title }}</p>
                <p v-if="phone.music.album" class="life-now-track-album">{{ phone.music.album }}</p>
                <div class="life-now-meta">
                  <span v-if="phone.music.duration">{{ mmss(phone.music.duration) }}</span>
                  <span v-if="phone.music.plays">{{ phone.music.plays }} PLAYS TODAY</span>
                  <span v-if="phone.music.at">{{ hhmm(phone.music.at) }} · {{ age(phone.music.at) }}</span>
                  <span v-else>LAST TRACK TODAY</span>
                </div>
              </div>
            </div>

            <div v-if="lyricLines.length" ref="lyricBox" class="life-now-lyrics">
              <ul
                class="life-now-lyric-list"
                :style="{ transform: `translateY(${lyricOffset}px)` }"
              >
                <li
                  v-for="(line, i) in lyricLines"
                  :key="i"
                  :class="{ 'is-current': i === lyricIndex }"
                  :style="lyricStyle(i)"
                >{{ line.text }}</li>
              </ul>
            </div>
          </div>
        </template>
        <span v-else class="life-now-empty">NOTHING PLAYING</span>
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
  /* 一行四块：位置 / 问答 / 桌面 / 手表；手机和正在播放各自占满整行 */
  display: grid;
  grid-template-columns: 1.25fr 1.55fr 1fr 1fr;
}

.life-now-card.is-full {
  grid-column: 1 / -1;
  border-top: 1px solid var(--border);
  border-right: 0;
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

/* 状态 chips：电量 / 网络 / 通知条数，和 SCREEN ON 一样是「状态」而不是正文 */
.life-now-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.life-now-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.46rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}

.life-now-chip.is-on {
  border-color: var(--text-primary);
  color: var(--text-primary);
}

/* 手机整块：四个状态瓦片，用 1px 缝隙画分隔线 */
.life-now-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  margin-top: 14px;
  border: 1px solid var(--border);
  background: var(--border);
}

.life-now-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  background: var(--bg);
}

.life-now-stat-icon {
  color: var(--text-secondary);
}

/* 动效做在格子里，不动图标 */

.life-now-stat.is-network,
.life-now-stat.is-notifications,
.life-now-stat.is-unlocks {
  position: relative;
  overflow: hidden;
}

.life-now-stat.is-network > b,
.life-now-stat.is-network > em,
.life-now-stat.is-notifications > b,
.life-now-stat.is-notifications > em,
.life-now-stat.is-unlocks > b,
.life-now-stat.is-unlocks > em {
  position: relative;
  z-index: 1;
}

/* 网络：一道很淡的光横向扫过，像数据在流动 */
.life-now-stat.is-network::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, var(--text-primary), transparent);
  opacity: 0.06;
  transform: translateX(-100%);
  animation: life-sweep 4.5s ease-in-out infinite;
}

@keyframes life-sweep {
  0% { transform: translateX(-100%); }
  55%, 100% { transform: translateX(100%); }
}

/* 通知：三颗光点从底部浮起再消失 */
.life-now-stat.is-notifications::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: var(--text-primary);
  box-shadow: -16px 0 0 var(--text-primary), 16px 0 0 var(--text-primary);
  opacity: 0;
  animation: life-dots 5s linear infinite;
}

@keyframes life-dots {
  0% { transform: translateY(0); opacity: 0; }
  15% { opacity: 0.3; }
  75% { opacity: 0.12; }
  100% { transform: translateY(-80px); opacity: 0; }
}

/* 解锁：一条扫描线从上往下走 */
.life-now-stat.is-unlocks::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--text-primary);
  opacity: 0.16;
  top: -2px;
  animation: life-scan 6s linear infinite;
}

@keyframes life-scan {
  from { top: -2px; }
  to { top: 100%; }
}

.life-now-stat b {
  font-family: 'Oswald', sans-serif;
  font-size: 1.35rem;
  font-weight: 500;
  line-height: 1.1;
  color: var(--text-primary);
}

.life-now-stat em {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.44rem;
  font-style: normal;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

/* ── 电池液面 ─────────────────────────────────────────────── */
.life-now-stat.is-battery {
  position: relative;
  overflow: hidden;
  min-height: 104px;
}

/* 文字压在水面之上 */
.life-now-stat.is-battery > b,
.life-now-stat.is-battery > em {
  position: relative;
  z-index: 1;
}

.life-now-stat.is-battery b {
  font-family: 'Oswald', sans-serif;
  font-size: 1.5rem;
  font-weight: 500;
  line-height: 1;
  color: var(--text-primary);
}

.life-now-stat.is-battery b small {
  font-size: 0.55em;
  margin-left: 1px;
}

.life-now-stat.is-battery em {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.44rem;
  font-style: normal;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.life-battery-water {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  /* 颜色跟随主题：深色主题是白，浅色主题是黑 */
  opacity: 0.18;
  transition: width 1.1s cubic-bezier(0.22, 1, 0.36, 1);
  /* 不做整块上下浮动：会露出底边 2px 空白，看起来像裂开 */
}

/* 主体：宽度里预留最后 12px 给波浪 */
.life-battery-body {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  right: 12px;
  background: var(--text-primary);
}

/* 右边缘的竖浪：整条上下移动，看起来像水在流动 */
.life-battery-edge {
  position: absolute;
  right: 0;
  top: 0;
  width: 12px;
  height: 200%;
  animation: life-battery-flow 5s linear infinite;
}

.life-battery-edge path {
  fill: var(--text-primary);
}

.life-now-stat.is-charging .life-battery-edge {
  animation-duration: 2.4s;
}


.life-now-stat.is-charging .life-battery-water {
  animation: life-battery-glow 1.8s ease-in-out infinite;
}

@keyframes life-battery-flow {
  /* 方向反过来：波峰向下走 */
  from { transform: translateY(-50%); }
  to { transform: translateY(0); }
}

@keyframes life-battery-glow {
  0%, 100% { opacity: 0.18; }
  50% { opacity: 0.28; }
}

.life-now-toplist {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin-top: 12px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.5rem;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
}

.life-now-toplist b {
  font-weight: 500;
  color: var(--text-primary);
}

.life-now-music-body {
  display: flex;
  /* 歌词在右侧垂直居中，避免右下角一片空白 */
  align-items: center;
  gap: 28px;
}

.life-now-track-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-top: 12px;
  flex: none;
}

.life-now-lyrics {
  position: relative;
  flex: 1;
  min-width: 0;
  max-height: 180px;
  overflow: hidden;
  /* poem 排版：整块歌词居中 */
  text-align: center;
  /* 上下边缘渐隐，像音乐软件那样 */
  mask-image: linear-gradient(180deg, transparent 0, #000 18%, #000 82%, transparent 100%);
  -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 18%, #000 82%, transparent 100%);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.66rem;
  line-height: 2;
  color: var(--text-secondary);
}

/* 整条列表用 transform 上下移动：焦点行永远在容器正中 */
.life-now-lyric-list {
  list-style: none;
  margin: 0;
  padding: 0;
  transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

.life-now-lyric-list li {
  transition: opacity 0.45s ease, transform 0.45s ease, color 0.45s ease;
  transform-origin: center center;
  will-change: opacity, transform;
}

.life-now-lyric-list li.is-current {
  color: var(--text-primary);
  font-weight: 600;
  letter-spacing: 0.02em;
}

.life-now-cover {
  width: 132px;
  height: 132px;
  flex: none;
  object-fit: cover;
  border: 1px solid var(--border);
}

.life-now-track-body {
  min-width: 0;
}

.life-now-track {
  display: block;
  margin-top: 0;
  font-family: 'Oswald', sans-serif;
  font-size: 2.1rem;
  font-weight: 500;
  line-height: 1.15;
  overflow-wrap: anywhere;
}

.life-now-track-title {
  margin: 6px 0 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.life-now-track-album {
  margin: 4px 0 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.58rem;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.life-now-top {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: grid;
  gap: 6px;
  /* 应用多时不让卡片无限长：内部滚动，最长 190px */
  max-height: 190px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.life-now-top li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.56rem;
  letter-spacing: 0.06em;
}

.life-now-top li span {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.life-now-top li b {
  font-weight: 500;
  color: var(--text-primary);
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

.life-now-steps {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.life-now-steps .life-now-app {
  margin-top: 0;
}

.life-now-steps-icon {
  width: 19px;
  height: 19px;
  flex: 0 0 auto;
  fill: var(--text-primary);
  opacity: 0.9;
}

.life-now-heart {
  display: flex;
  align-items: baseline;
  gap: 7px;
  margin-top: 10px;
}

.life-now-heart-icon {
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
  align-self: center;
  fill: var(--text-primary);
}

.life-now-heart strong {
  font-family: 'Oswald', sans-serif;
  font-size: 1.2rem;
  font-weight: 500;
  line-height: 1;
  color: var(--text-primary);
}

.life-now-heart em {
  font-style: normal;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.44rem;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.life-now-heart span {
  margin-left: auto;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.44rem;
  letter-spacing: 0.06em;
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

  .life-now-card.is-full {
    grid-column: 1 / -1;
  }

  .life-now-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
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

  .life-now-card.is-full {
    grid-column: 1 / -1;
  }

  .life-now-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .life-now-cover {
    width: 96px;
    height: 96px;
  }

  .life-now-track {
    font-size: 1.6rem;
  }

  .life-now-music-body {
    flex-direction: column;
    gap: 0;
  }

  .life-now-lyrics {
    max-height: 120px;
    margin-top: 14px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .life-now-dot,
  .life-now-stat::after,
  .life-battery-edge,
  .life-battery-water,
  .life-now-lyric-list {
    animation: none;
    transition: none;
  }
}
</style>
