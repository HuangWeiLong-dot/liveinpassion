// 自建登录页 HTML：零外部依赖（不加载任何第三方域名的字体/脚本/样式），
// 纯 <form> 提交即可完成登录，保证夸克/UC/百度等老内核浏览器也能用。
// 配色跟随 CMS 的 cms-theme（默认深色），与站点同一套黑白语法。

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

export function renderLoginPage({ error = '', next = '/admin/' } = {}) {
  // next 只允许站内相对路径，杜绝开放重定向
  const safeNext = /^\/[a-zA-Z0-9\-_./?=&%]*$/.test(next) && !next.startsWith('//') ? next : '/admin/';
  const msg =
    error === 'locked'
      ? 'Too many failed attempts. Try again in 10 minutes.'
      : error === '1'
        ? 'Incorrect password. Please try again.'
        : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="color-scheme" content="dark light">
<title>Log In · LIVE IN PASSION CMS</title>
<script>
  (function () {
    try {
      var saved = localStorage.getItem('cms-theme');
      document.documentElement.classList.toggle('light', saved === 'light');
    } catch (e) {}
  })();
</script>
<style>
  :root {
    --bg: #1A1A1A;
    --bg-secondary: #2D2D2D;
    --fg: #FAFAFA;
    --muted: #888888;
    --line: #333333;
    --danger: #E06C6C;
    color-scheme: dark;
  }
  :root.light {
    --bg: #FAFAFA;
    --bg-secondary: #F3F4F6;
    --fg: #1A1A1A;
    --muted: #6B7280;
    --line: #E5E7EB;
    --danger: #C62828;
    color-scheme: light;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    background: var(--bg); color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
                 "Hiragino Sans GB", "Microsoft YaHei", Roboto, sans-serif;
    font-weight: 300; line-height: 1.7;
    display: flex; align-items: center; justify-content: center;
    padding: 24px 16px; -webkit-font-smoothing: antialiased;
  }
  .login-card {
    width: 100%; max-width: 420px;
    border: 1px solid var(--line);
    background: var(--bg);
    padding: 36px 28px 26px;
  }
  .brand-mark {
    display: block;
    font-family: "Arial Narrow", "Helvetica Neue", Arial, sans-serif;
    font-weight: 700; font-size: 1.7rem; line-height: 1;
    letter-spacing: 0.08em; text-transform: uppercase;
  }
  .brand-sub {
    display: block; margin-top: 6px;
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 0.55rem; letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--muted);
  }
  .rule { height: 1px; background: var(--fg); margin: 22px 0 26px; }
  .kicker {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 0.52rem; letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--muted); margin-bottom: 14px;
  }
  .field-label {
    display: block;
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 0.56rem; font-weight: 500; letter-spacing: 0.18em;
    text-transform: uppercase; color: var(--muted); margin-bottom: 8px;
  }
  input[type="password"] {
    width: 100%; padding: 12px; min-height: 46px;
    border: 1px solid var(--line); border-radius: 0;
    font-size: 16px; color: var(--fg); background: var(--bg-secondary);
    font-family: inherit; font-weight: 300;
  }
  input[type="password"]:focus { outline: none; border-color: var(--fg); background: var(--bg); }
  .btn {
    width: 100%; margin-top: 18px; padding: 13px 20px; min-height: 48px;
    background: var(--fg); color: var(--bg); border: 1px solid var(--fg); border-radius: 0;
    font-family: "Arial Narrow", "Helvetica Neue", Arial, sans-serif;
    font-weight: 700; font-size: 0.68rem; letter-spacing: 0.22em;
    text-transform: uppercase; cursor: pointer;
    transition: background-color 0.18s ease, color 0.18s ease;
  }
  .btn:hover, .btn:active { background: transparent; color: var(--fg); }
  .msg {
    margin-top: 16px; padding-left: 10px; border-left: 2px solid var(--danger);
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 0.6rem; letter-spacing: 0.02em; color: var(--danger);
  }
  .foot {
    margin-top: 26px; padding-top: 14px; border-top: 1px solid var(--line);
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 0.5rem; letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--muted); text-align: center;
  }
</style>
</head>
<body>
  <form class="login-card" method="POST" action="/api/login" autocomplete="site">
    <span class="brand-mark">LIVEINPASSION</span>
    <span class="brand-sub">Content Desk — CMS</span>
    <div class="rule"></div>
    <div class="kicker">Secure Access / 01</div>
    <label class="field-label" for="pw">Password</label>
    <input id="pw" type="password" name="password" autocomplete="current-password"
           required autofocus aria-label="Password">
    <input type="hidden" name="next" value="${esc(safeNext)}">
    <button class="btn" type="submit">Enter Desk →</button>
    ${msg ? `<div class="msg">${esc(msg)}</div>` : ''}
    <div class="foot">© ${new Date().getFullYear()} LIVE IN PASSION · Authorized Use Only</div>
  </form>
</body>
</html>`;
}
