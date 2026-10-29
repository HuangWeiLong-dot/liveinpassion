/**
 * GitHub 公开动态：事件流 → 贡献格子图 + 仓库排行。
 *
 * 只用未鉴权的公共接口（CORS 放开，限 60 次/小时/IP），所以：
 *  - localStorage 缓存 10 分钟，跨路由 / 刷新都先吃缓存；
 *  - 一次性翻满 3 页（300 条，GitHub 公开事件的上限），再往前也拿不到；
 *  - 被限流（403/429）时退避 15 分钟，期间只显示缓存，不再打接口。
 *
 * 模块级单例：LIFE 的 FEED 与 DASHBOARD 两个视图共用同一份数据，
 * 切视图不会重新请求。
 */
import { ref } from 'vue';

export const GITHUB_USER = 'HuangWeiLong-dot';

const API = 'https://api.github.com';
const CACHE_KEY = 'githubActivity:v2';
const TTL = 10 * 60 * 1000;
const BACKOFF = 15 * 60 * 1000;
// 12 列 × 7 行 = 84 格，正好是公开事件接口能覆盖的区间（约 90 天）
export const WEEKS = 12;
const MAX_PAGES = 3;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function dayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!raw || typeof raw.at !== 'number' || !raw.data) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
  } catch {}
}

function backoffUntil() {
  try {
    return Number(localStorage.getItem(CACHE_KEY + ':backoff') || 0) || 0;
  } catch {
    return 0;
  }
}

function setBackoff(until) {
  try {
    localStorage.setItem(CACHE_KEY + ':backoff', String(until));
  } catch {}
}

/**
 * 把原始事件归一成「格子 / 合计 / 仓库」三块。
 *
 * 格子按周对齐：最后一列的周一所在那一周是本周，往前 12 列。
 * 本周之内今天之后的格子是 future（不画、不计），所以窗口是 77–84 天，
 * 具体多少天由今天星期几决定 —— header 上写实际天数，不写死 84。
 */
export function summarize(events, weeks = WEEKS) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 本周一
  const dow = (today.getDay() + 6) % 7; // 周一 = 0
  const monday = new Date(today);
  monday.setDate(today.getDate() - dow);
  // 12 周里第一周的周一
  const start = new Date(monday);
  start.setDate(monday.getDate() - (weeks - 1) * 7);

  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    date.setHours(0, 0, 0, 0);
    cells.push({
      day: dayKey(date),
      date,
      week: Math.floor(i / 7),
      weekday: i % 7,
      future: date > today,
      isToday: date.getTime() === today.getTime(),
      events: 0,
      pushes: 0,
      commits: 0,
      prs: 0,
      issues: 0,
      other: 0,
      level: 0,
    });
  }

  const byDay = new Map(cells.filter((c) => !c.future).map((c) => [c.day, c]));
  const shas = new Set();
  const repos = new Map();

  for (const ev of events || []) {
    const when = new Date(ev.created_at);
    if (Number.isNaN(when.getTime())) continue;
    const cell = byDay.get(dayKey(when));
    if (!cell) continue;

    const type = ev.type || '';
    const repoName = ev.repo?.name || '';
    cell.events += 1;

    let kind = 'other';
    if (type === 'PushEvent') {
      kind = 'commits';
      cell.pushes += 1;
      // commits 可能因为合并提交为空，仍算一次提交
      const commits = Array.isArray(ev.payload?.commits) ? ev.payload.commits : [];
      let added = 0;
      if (commits.length) {
        for (const c of commits) {
          if (c.sha && shas.has(c.sha)) continue;
          if (c.sha) shas.add(c.sha);
          added += 1;
        }
      } else {
        added = 1;
      }
      cell.commits += added;
    } else if (type === 'PullRequestEvent') {
      kind = 'prs';
      cell.prs += 1;
    } else if (type === 'IssuesEvent') {
      kind = 'issues';
      cell.issues += 1;
    } else {
      cell.other += 1;
    }

    if (repoName) {
      const entry = repos.get(repoName) || { name: repoName, url: `https://github.com/${repoName}`, events: 0, commits: 0 };
      entry.events += 1;
      if (kind === 'commits') entry.commits += 1;
      repos.set(repoName, entry);
    }
  }

  const past = cells.filter((c) => !c.future);
  const max = Math.max(1, ...past.map((c) => c.events));

  // 0 级 = 没有公开事件；其余按当天事件量分四档
  for (const c of past) {
    if (!c.events) continue;
    const ratio = c.events / max;
    c.level = ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
  }

  const totals = past.reduce(
    (acc, c) => {
      acc.events += c.events;
      acc.commits += c.commits;
      acc.pushes += c.pushes;
      acc.prs += c.prs;
      acc.issues += c.issues;
      acc.other += c.other;
      if (c.events) acc.activeDays += 1;
      return acc;
    },
    { events: 0, commits: 0, pushes: 0, prs: 0, issues: 0, other: 0, activeDays: 0, windowDays: past.length },
  );

  // 当前连续天数：今天没活动不算断，从昨天起算（和 GitHub 的口径一致）
  let streak = 0;
  let cursor = past.length - 1;
  if (cursor >= 0 && past[cursor].events === 0) cursor -= 1;
  while (cursor >= 0 && past[cursor].events > 0) {
    streak += 1;
    cursor -= 1;
  }

  let longest = 0;
  let run = 0;
  for (const c of past) {
    if (c.events > 0) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }

  // 月份刻度：只在那周一进入新月份时打一个
  const months = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const d = new Date(start);
    d.setDate(start.getDate() + w * 7);
    if (d.getMonth() !== lastMonth) {
      months.push({ index: w, label: MONTHS[d.getMonth()] });
      lastMonth = d.getMonth();
    }
  }

  const repoList = [...repos.values()].sort((a, b) => b.events - a.events || b.commits - a.commits);

  return {
    user: GITHUB_USER,
    weeks,
    cells,
    months,
    totals: { ...totals, streak, longest, repos: repoList.length },
    repos: repoList.slice(0, 6),
    lastEventAt: events?.[0]?.created_at || null,
    fetchedAt: Date.now(),
  };
}

const state = {
  data: ref(null),
  at: ref(0),
  loading: ref(false),
  error: ref(''),
  inflight: null,
  hydrated: false,
};

async function fetchPages(signal) {
  const events = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(
      `${API}/users/${GITHUB_USER}/events/public?per_page=100&page=${page}`,
      { signal, headers: { Accept: 'application/vnd.github+json' } },
    );
    if (res.status === 403 || res.status === 429) {
      const err = new Error(`rate limited (${res.status})`);
      err.rateLimited = true;
      throw err;
    }
    if (!res.ok) throw new Error(`github ${res.status}`);
    const batch = await res.json();
    if (!Array.isArray(batch) || !batch.length) break;
    events.push(...batch);
    if (batch.length < 100) break;
  }
  return events;
}

export function useGithubActivity() {
  if (!state.hydrated) {
    state.hydrated = true;
    const cache = readCache();
    if (cache) {
      state.data.value = cache.data;
      state.at.value = cache.at;
    }
  }

  function isStale() {
    return !state.at.value || Date.now() - state.at.value > TTL;
  }

  async function load(force = false) {
    if (state.inflight) return state.inflight;
    if (!force && !isStale()) return state.data.value;
    if (!force && Date.now() < backoffUntil()) {
      if (!state.data.value) state.error.value = 'RATE LIMITED';
      return state.data.value;
    }

    state.loading.value = true;
    state.error.value = '';
    state.inflight = (async () => {
      try {
        const events = await fetchPages();
        const data = summarize(events);
        state.data.value = data;
        state.at.value = Date.now();
        writeCache(data);
        return data;
      } catch (err) {
        // 有缓存就继续用旧的，界面上标 STALE；没有才显示失败
        state.error.value = err?.message || 'UNAVAILABLE';
        if (err?.rateLimited) setBackoff(Date.now() + BACKOFF);
        return state.data.value;
      } finally {
        state.loading.value = false;
        state.inflight = null;
      }
    })();
    return state.inflight;
  }

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    at: state.at,
    isStale,
    load,
  };
}
