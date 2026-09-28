// 页面访问追踪（匿名、无 Cookie）。
// sid 存 localStorage，每次路由切换后上报 { sid, path } 到 Worker /api/track。
// 上报失败静默忽略，绝不影响页面正常使用。

const CMS_BASE =
  import.meta.env.VITE_CMS_BASE || 'https://cms.liveinpassion.me';
const SID_KEY = 'lip_sid';

let currentPath = null;

function getSid() {
  try {
    return localStorage.getItem(SID_KEY) || '';
  } catch {
    return '';
  }
}

function saveSid(sid) {
  try {
    localStorage.setItem(SID_KEY, sid);
  } catch {
    /* localStorage 不可用时忽略，仅当次会话无法 UV 去重 */
  }
}

function track(path) {
  if (!path || path === currentPath) return;
  currentPath = path;

  const payload = JSON.stringify({ sid: getSid(), path });

  try {
    // keepalive：页面卸载/快速切换时请求也能发出去
    fetch(`${CMS_BASE}/api/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.sid) saveSid(data.sid);
      })
      .catch(() => {});
  } catch {
    /* 埋点失败不影响任何功能 */
  }
}

// 安装到 router：首次进入 + 后续每次路由切换都上报
export function installTracker(router) {
  router.afterEach((to) => track(to.fullPath || to.path));
  // 首次加载若 router 已就绪，afterEach 也会触发；保险起见直接上报一次
  track(router.currentRoute.value.fullPath || router.currentRoute.value.path);
}
