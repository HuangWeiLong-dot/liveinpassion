// 自建登录页 HTML：零外部依赖（不加载任何第三方域名的字体/脚本/样式），
// 纯 <form> 提交即可完成登录，保证夸克/UC/百度等老内核浏览器也能用。

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
      ? '失败次数太多，请 10 分钟后再试。'
      : error === '1'
        ? '密码错误，请重试。'
        : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>登录 · LIVE IN PASSION CMS</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    background: #FAFAFA; color: #1A1A1A;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
                 "Hiragino Sans GB", "Microsoft YaHei", Roboto, sans-serif;
    font-weight: 300; line-height: 1.7;
    display: flex; align-items: center; justify-content: center;
    padding: 24px 16px; -webkit-font-smoothing: antialiased;
  }
  .login-card { width: 100%; max-width: 380px; border: 1px solid #E5E7EB; background: #fff; padding: 32px 24px; }
  .brand-mark {
    font-family: "Arial Narrow", Arial, sans-serif; font-weight: 700;
    font-size: 1rem; letter-spacing: 0.18em; text-transform: uppercase;
  }
  .brand-sub {
    font-family: "Arial Narrow", Arial, sans-serif; font-weight: 500;
    font-size: 0.62rem; letter-spacing: 0.3em; color: #6B7280;
    text-transform: uppercase; margin-top: 4px;
  }
  .rule { height: 1px; background: #1A1A1A; margin: 20px 0 24px; }
  .field-label {
    display: block; font-family: "Arial Narrow", Arial, sans-serif;
    font-size: 0.68rem; font-weight: 700; letter-spacing: 0.22em;
    text-transform: uppercase; color: #6B7280; margin-bottom: 8px;
  }
  input[type="password"] {
    width: 100%; padding: 13px 12px; border: 1px solid #E5E7EB;
    font-size: 16px; color: #1A1A1A; background: #FAFAFA;
    font-family: inherit; font-weight: 300; border-radius: 0;
  }
  input[type="password"]:focus { outline: none; border-color: #1A1A1A; background: #fff; }
  .btn {
    width: 100%; margin-top: 20px; padding: 14px 20px; min-height: 48px;
    background: #1A1A1A; color: #FAFAFA; border: 1px solid #1A1A1A;
    font-family: "Arial Narrow", Arial, sans-serif; font-weight: 700;
    font-size: 0.72rem; letter-spacing: 0.24em; text-transform: uppercase;
    cursor: pointer;
  }
  .btn:active { background: transparent; color: #1A1A1A; }
  .msg { margin-top: 16px; font-size: 0.8rem; color: #C62828; letter-spacing: 0.02em; }
  .foot { margin-top: 28px; font-size: 0.7rem; color: #9CA3AF; text-align: center; letter-spacing: 0.04em; }
</style>
</head>
<body>
  <form class="login-card" method="POST" action="/api/login" autocomplete="site">
    <div class="brand-mark">Live In Passion</div>
    <div class="brand-sub">Content Desk</div>
    <div class="rule"></div>
    <label class="field-label" for="pw">Password</label>
    <input id="pw" type="password" name="password" autocomplete="current-password"
           required autofocus aria-label="密码">
    <input type="hidden" name="next" value="${esc(safeNext)}">
    <button class="btn" type="submit">登 录</button>
    ${msg ? `<div class="msg">${esc(msg)}</div>` : ''}
    <div class="foot">© ${new Date().getFullYear()} LIVE IN PASSION</div>
  </form>
</body>
</html>`;
}
