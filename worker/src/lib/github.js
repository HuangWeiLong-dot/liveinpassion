// GitHub repository_dispatch 触发 Pages 重建
// 在文章发布/删除、相册变更后调用，带简单防抖（模块级变量，单用户场景足够）

const DEBOUNCE_MS = 30000; // 30 秒防抖
let lastTriggerTime = 0;

export async function triggerRebuild(env, reason) {
  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPO; // e.g. "owner/repo"
  const eventType = env.GITHUB_EVENT_TYPE || 'cms-content-changed';

  if (!token || !repo) {
    console.warn('GitHub trigger skipped: GITHUB_TOKEN or GITHUB_REPO not configured');
    return { ok: false, skipped: true, reason: 'not_configured' };
  }

  // 防抖：30 秒内不重复触发
  const now = Date.now();
  if (now - lastTriggerTime < DEBOUNCE_MS) {
    return { ok: true, debounced: true };
  }
  lastTriggerTime = now;

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'liveinpassion-cms-worker',
      },
      body: JSON.stringify({
        event_type: eventType,
        client_payload: { reason, timestamp: new Date().toISOString() },
      }),
    });

    if (res.ok) {
      return { ok: true };
    }
    const err = await res.text();
    console.error(`GitHub dispatch failed: ${res.status} ${err}`);
    return { ok: false, status: res.status, error: err };
  } catch (err) {
    console.error('GitHub dispatch error:', err);
    return { ok: false, error: String(err) };
  }
}
