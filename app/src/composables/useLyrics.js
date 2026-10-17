// 歌词：从 LRCLIB 拉同步歌词（LRC），解析成带时间轴的行，并跟随播放位置
// 推进 activeIndex / progress，给播放器的滚动高亮 + 卡拉 OK 填充提供数据。
//
// 仓库里不存歌词正文（版权），本地覆盖见 data/lyrics.js。
// 服务失败 / 没有同步歌词时返回空数组，播放器把歌词区整块收起，不影响听歌。
import { ref, watch } from 'vue';
import { localLyrics } from '../data/lyrics.js';

const SEARCH_URL = 'https://lrclib.net/api/search';
const REQUEST_TIMEOUT = 8000;
const EMPTY = Object.freeze([]);

// src -> 已解析的行。只缓存有结果的成功请求：服务繁忙（LRCLIB 偶尔 503）时
// 下次打开播放器还能重试，不会被一个空结果永久钉死。
const cache = new Map();
const pending = new Map();

// [mm:ss.xx]第一行 → [{ time: 12.3, text: '第一行' }]
// 支持一行多个时间戳；元数据标签（[ar:…] / [ti:…]）自然被过滤掉。
export function parseLrc(text) {
  if (!text) return EMPTY;
  const byTime = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{2}(?:[.:]\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    const content = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (!content) continue;
    for (const m of stamps) {
      const time = Number(m[1]) * 60 + Number(m[2].replace(':', '.'));
      if (!byTime.has(time)) byTime.set(time, content);
    }
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, text]) => ({ time, text }));
}

async function requestLyrics(track) {
  // 播放列表里的歌手字段可能是 "A, B"，LRCLIB 的匹配用主歌手更稳
  const primaryArtist = (track.artist || '').split(',')[0].trim();
  const params = new URLSearchParams({
    track_name: track.title || '',
    artist_name: primaryArtist,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const res = await fetch(`${SEARCH_URL}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return EMPTY;
    const results = await res.json();
    if (!Array.isArray(results)) return EMPTY;
    const synced = results.find((r) => typeof r.syncedLyrics === 'string' && r.syncedLyrics.trim());
    return synced ? parseLrc(synced.syncedLyrics) : EMPTY;
  } catch {
    return EMPTY;
  } finally {
    clearTimeout(timer);
  }
}

async function loadLyrics(track) {
  if (!track) return EMPTY;
  if (localLyrics[track.src]) return parseLrc(localLyrics[track.src]);
  if (cache.has(track.src)) return cache.get(track.src);
  if (pending.has(track.src)) return pending.get(track.src);

  const job = requestLyrics(track).then((lines) => {
    pending.delete(track.src);
    if (lines.length) cache.set(track.src, lines);
    return lines;
  });
  pending.set(track.src, job);
  return job;
}

export function useLyrics({ currentTrack, playerVisible, isPlaying, visualsVisible, getCurrentTime }) {
  const lines = ref(EMPTY);
  const activeIndex = ref(-1); // -1 = 还没唱到第一行
  const progress = ref(0); // 当前行的演唱进度 0–1，用于卡拉 OK 填充

  let raf = 0;
  let loadToken = 0;
  let loadedSrc = null;

  function update(time) {
    const list = lines.value;
    if (!list.length) return;

    let index = -1;
    for (let i = 0; i < list.length; i++) {
      if (time >= list[i].time) index = i;
      else break;
    }

    if (index !== activeIndex.value) activeIndex.value = index;

    if (index < 0) {
      if (progress.value !== 0) progress.value = 0;
      return;
    }
    const start = list[index].time;
    const end = index + 1 < list.length ? list[index + 1].time : start + 5;
    const span = Math.max(0.25, end - start);
    const next = Math.min(1, Math.max(0, (time - start) / span));
    // 每帧都写会白白触发渲染，攒到 0.5% 再更新
    if (Math.abs(next - progress.value) >= 0.005) progress.value = next;
  }

  // 有歌词就逐帧对齐（暂停时拖进度条也要跟得上；一次 rAF 只做一次线性扫描，
  // 开销可以忽略）。没有歌词时立刻停掉，不空转。
  function tick() {
    raf = 0;
    update(getCurrentTime());
    if (lines.value.length) raf = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  watch(
    [currentTrack, isPlaying, playerVisible, visualsVisible],
    async ([track, playing, visible, shown]) => {
      // 舞台显示着、并且歌曲在放或播放器打开时才去拉歌词；其余情况不打扰服务。
      if (!track || !shown || (!playing && !visible)) return;
      // 同一首歌已经加载过（或正在加载）就不重复请求；切歌才重来。
      if (track.src === loadedSrc) return;
      loadedSrc = track.src;
      const token = ++loadToken;

      lines.value = EMPTY;
      activeIndex.value = -1;
      progress.value = 0;
      stopLoop();

      const loaded = await loadLyrics(track);
      if (token !== loadToken) return; // 等待期间已经切到别的歌
      if (!loaded.length) {
        // 这首没有同步歌词（或服务暂时不可用）：不要把它记成"已加载"，
        // 下次打开播放器还能重试。
        loadedSrc = null;
        return;
      }
      lines.value = loaded;
      update(getCurrentTime());
      startLoop();
    },
    { immediate: true }
  );

  // 底部舞台整块收起（关掉了开关，或既没在放歌、播放器也没打开）时停掉
  // 逐帧对齐，等它重新出现再接着跑。
  watch([isPlaying, playerVisible, visualsVisible], ([playing, visible, shown]) => {
    if (!shown || (!playing && !visible)) stopLoop();
    else if (lines.value.length) startLoop();
  });

  function dispose() {
    loadToken++;
    stopLoop();
  }

  return { lines, activeIndex, progress, dispose };
}
