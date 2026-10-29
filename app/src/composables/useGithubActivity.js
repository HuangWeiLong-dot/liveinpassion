/**
 * GitHub 公开动态：贡献日历 → 年初至今的格子图，事件流 → 明细与仓库排行。
 *
 * 两个数据源，都是未鉴权的：
 *  - 贡献日历 `github-contributions-api.jogruber.de/v4/<user>?y=<year>`：
 *    GitHub 自己的格子图数据（每天的 count + 0–4 级），一次给满一整年。
 *    api.github.com 的公开事件只回溯 90 天，画不出「从年初开始」的图，所以日历单独取。
 *  - 公开事件 `api.github.com/users/<user>/events/public`：
 *    COMMITS / PR / ISSUE 的明细、仓库排行。只有最近 90 天，界面上要标明。
 *
 * 所以：
 *  - localStorage 缓存 10 分钟，跨路由 / 刷新都先吃缓存；
 *  - 事件最多翻 3 页（300 条，GitHub 公开事件的上限）；
 *  - 事件被限流（403/429）时退避 15 分钟，期间只显示缓存；日历接口不受影响。
 *  - 日历接口拿不到就退回「最近 12 周」的旧画法，而不是显示一整年的空白。
 *
 * 模块级单例：LIFE 的 FEED 与 DASHBOARD 两个视图共用同一份数据，
 * 切视图不会重新请求。
 */
import { ref } from 'vue';

export const GITHUB_USER = 'HuangWeiLong-dot';

const API = 'https://api.github.com';
const CAL_API = 'https://github-contributions-api.jogruber.de/v4';
// v4：数据形状变了（年度日历 / monthly / recent），旧缓存不能直接读
const CACHE_KEY = 'githubActivity:v4';
const TTL = 10 * 60 * 1000;
const BACKOFF = 15 * 60 * 1000;
// 日历接口拿不到时的兜底宽度（12 列 × 7 行 ≈ 公开事件能覆盖的 90 天）
export const WEEKS = 12;
const MAX_PAGES = 3;
const DAY = 86400000;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

// 事件流右边的「最近动态」：只留类型，不展开 payload
const TYPE_LABEL = {
  PushEvent: 'COMMIT',
  PullRequestEvent: 'PULL REQ',
  PullRequestReviewEvent: 'REVIEW',
  IssuesEvent: 'ISSUE',
  IssueCommentEvent: 'COMMENT',
  WatchEvent: 'STAR',
  ForkEvent: 'FORK',
  CreateEvent: 'CREATE',
  DeleteEvent: 'DELETE',
  ReleaseEvent: 'RELEASE',
  PublicEvent: 'PUBLIC',
};

function dayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!raw || typeof raw.at !== 'number' || !raw.data) return null;
    // 旧形状的缓存（少了新字段）直接丢掉：组件按新字段渲染，缺一个就会整页崩
    const d = raw.data;
    if (!Array.isArray(d.cells) || !d.cells.length || !d.totals || !Array.isArray(d.monthly)) return null;
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
 * 把日历 + 事件归一成「格子 / 合计 / 仓库」三块。
 *
 * 格子的列是周（周一对齐）：
 *  - 有日历数据：从 1 月 1 日所在那一周开始，一直到本周；1 月 1 日之前的
 *    半列标 outside（不画、不参与统计），本周里今天之后的是 future。
 *  - 没有日历数据：退回最近 12 周。
 * windowDays 是真正有数据的那些天（今年 1 月 1 日 → 今天），header 上写实际天数。
 */
export function summarize(events, calendar = null, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const year = today.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const cal = calendar instanceof Map && calendar.size ? calendar : null;

  const thisWeek = mondayOf(today);
  let start;
  let weeks;
  if (cal) {
    start = mondayOf(jan1);
    weeks = Math.round((thisWeek - start) / DAY / 7) + 1;
  } else {
    weeks = WEEKS;
    start = new Date(thisWeek);
    start.setDate(start.getDate() - (weeks - 1) * 7);
  }

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
      outside: cal ? date < jan1 : false,
      future: date > today,
      isToday: date.getTime() === today.getTime(),
      count: 0,
      level: 0,
      events: 0,
      pushes: 0,
      commits: 0,
      prs: 0,
      issues: 0,
      other: 0,
    });
  }

  const live = cells.filter((c) => !c.outside && !c.future);
  const byDay = new Map(live.map((c) => [c.day, c]));
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

  if (cal) {
    // 日历是权威口径：count 是 GitHub 的贡献数，level 是 GitHub 自己分的档
    for (const c of live) {
      const entry = cal.get(c.day);
      c.count = entry ? entry.count : 0;
      c.level = entry ? entry.level : 0;
    }
  } else {
    // 兜底：只用事件量分四档（0 级 = 没有公开事件）
    const max = Math.max(1, ...live.map((c) => c.events));
    for (const c of live) {
      c.count = c.commits + c.prs + c.issues;
      if (!c.events) continue;
      const ratio = c.events / max;
      c.level = ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
    }
  }

  const isActive = (c) => c.count > 0 || c.events > 0;

  const totals = live.reduce(
    (acc, c) => {
      acc.contributions += c.count;
      acc.events += c.events;
      acc.commits += c.commits;
      acc.pushes += c.pushes;
      acc.prs += c.prs;
      acc.issues += c.issues;
      acc.other += c.other;
      if (isActive(c)) acc.activeDays += 1;
      return acc;
    },
    {
      contributions: 0,
      events: 0,
      commits: 0,
      pushes: 0,
      prs: 0,
      issues: 0,
      other: 0,
      activeDays: 0,
      windowDays: live.length,
    },
  );

  // 当前连续天数：今天没活动不算断，从昨天起算（和 GitHub 的口径一致）
  let streak = 0;
  let cursor = live.length - 1;
  if (cursor >= 0 && !isActive(live[cursor])) cursor -= 1;
  while (cursor >= 0 && isActive(live[cursor])) {
    streak += 1;
    cursor -= 1;
  }

  let longest = 0;
  let run = 0;
  for (const c of live) {
    if (isActive(c)) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }

  // 格子图下方那一排：月度柱 + 几个「一眼」数字。图为的就是别让下面空着
  const monthly = [];
  const monthAt = new Map();
  const weekdayTotals = [0, 0, 0, 0, 0, 0, 0];
  let busiest = null;
  for (const c of live) {
    const key = c.day.slice(0, 7);
    if (!monthAt.has(key)) {
      const entry = { key, label: MONTHS[Number(key.slice(5, 7)) - 1], count: 0 };
      monthAt.set(key, entry);
      monthly.push(entry);
    }
    monthAt.get(key).count += c.count;
    weekdayTotals[c.weekday] += c.count;
    if (c.count > 0 && (!busiest || c.count > busiest.count)) busiest = { day: c.day, count: c.count };
  }
  const weekdayMax = Math.max(...weekdayTotals);
  const weekdayTop = weekdayMax > 0
    ? { label: WEEKDAYS[weekdayTotals.indexOf(weekdayMax)], count: weekdayMax }
    : null;

  // 月份刻度：只在那周进入新月份时打一个；去年 12 月那半列不打
  const months = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const d = new Date(start);
    d.setDate(start.getDate() + w * 7);
    if (cal && d < jan1) continue;
    if (d.getMonth() !== lastMonth) {
      months.push({ index: w, label: MONTHS[d.getMonth()] });
      lastMonth = d.getMonth();
    }
  }

  const repoList = [...repos.values()].sort((a, b) => b.events - a.events || b.commits - a.commits);

  // 右侧「最近动态」：接口本来就是新的在前，保险起见再按时间排一次
  const recent = [...(events || [])]
    .filter((e) => e && e.created_at && !Number.isNaN(new Date(e.created_at).getTime()))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5)
    .map((e) => {
      const full = e.repo?.name || '';
      const repo = full.startsWith(`${GITHUB_USER}/`) ? full.slice(GITHUB_USER.length + 1) : full;
      return {
        id: e.id || `${e.created_at}-${full}`,
        type: TYPE_LABEL[e.type] || 'EVENT',
        repo,
        url: full ? `https://github.com/${full}` : `https://github.com/${GITHUB_USER}`,
        at: e.created_at,
      };
    });

  return {
    user: GITHUB_USER,
    year,
    weeks,
    cells,
    months,
    monthly,
    totals: {
      ...totals,
      streak,
      longest,
      repos: repoList.length,
      busiest,
      weekdayTop,
      avgPerActiveDay: totals.activeDays ? totals.contributions / totals.activeDays : 0,
    },
    repos: repoList.slice(0, 6),
    recent,
    source: cal ? 'calendar' : 'events',
    lastEventAt: events?.[0]?.created_at || null,
    fetchedAt: Date.now(),
  };
}

const state = {
  data: ref(null),
  at: ref(0),
  loading: ref(false),
  error: ref(''), // 两个源都失败：整块显示失败态
  warn: ref(''), // 只有一个源失败：数据照常画，脚注标一下
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

async function fetchCalendar(year, signal) {
  const res = await fetch(`${CAL_API}/${GITHUB_USER}?y=${year}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`calendar ${res.status}`);
  const json = await res.json();
  const map = new Map();
  for (const row of json?.contributions || []) {
    if (!row || typeof row.date !== 'string') continue;
    map.set(row.date, {
      count: Math.max(0, Number(row.count) || 0),
      level: Math.min(4, Math.max(0, Number(row.level) || 0)),
    });
  }
  return map;
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
    state.warn.value = '';
    state.inflight = (async () => {
      try {
        const year = new Date().getFullYear();
        // 两个源互不依赖：日历挂了还能用事件画最近 12 周，反之亦然
        const [evRes, calRes] = await Promise.allSettled([
          fetchPages(),
          fetchCalendar(year),
        ]);
        if (evRes.status === 'rejected' && evRes.reason?.rateLimited) {
          setBackoff(Date.now() + BACKOFF);
        }
        // 两个都失败才算真失败：这时别把缓存覆盖成空
        if (evRes.status === 'rejected' && calRes.status === 'rejected') {
          state.error.value = evRes.reason?.message || calRes.reason?.message || 'UNAVAILABLE';
          return state.data.value;
        }
        if (evRes.status === 'rejected') state.warn.value = 'EVENT DETAIL UNAVAILABLE';
        else if (calRes.status === 'rejected') state.warn.value = 'CALENDAR UNAVAILABLE · LAST 12 WEEKS';

        const events = evRes.status === 'fulfilled' ? evRes.value : [];
        const calendar = calRes.status === 'fulfilled' ? calRes.value : null;
        const data = summarize(events, calendar);
        state.data.value = data;
        state.at.value = Date.now();
        writeCache(data);
        return data;
      } catch (err) {
        state.error.value = err?.message || 'UNAVAILABLE';
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
    warn: state.warn,
    at: state.at,
    isStale,
    load,
  };
}
