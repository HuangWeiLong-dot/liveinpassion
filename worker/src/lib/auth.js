// Cloudflare Access JWT 鉴权中间件
// 验证 Cf-Access-Jwt-Assertion header，校验签名与 audience。
// 本地开发（ACCESS_AUD 未设置）时放行所有 admin 请求。

const CERTS_CACHE_TTL = 60 * 60 * 1000; // 1 小时
let certsCache = null;
let certsCacheTime = 0;

function base64UrlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const base64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  return atob(base64);
}

export { base64UrlDecode };

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
}

async function fetchAccessCerts(teamDomain) {
  const now = Date.now();
  if (certsCache && now - certsCacheTime < CERTS_CACHE_TTL) {
    return certsCache;
  }
  // 兼容两种配置：完整域名（xxx.cloudflareaccess.com）或纯团队名（xxx）
  const host = teamDomain.endsWith('.cloudflareaccess.com')
    ? teamDomain
    : `${teamDomain}.cloudflareaccess.com`;
  const url = `https://${host}/cdn-cgi/access/certs`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch Access certs: ${res.status}`);
  const data = await res.json();
  certsCache = data;
  certsCacheTime = now;
  return data;
}

async function verifyAccessJwt(token, audience, teamDomain) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  // 过期检查
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  // audience 检查
  if (audience && payload.aud !== audience && !(Array.isArray(payload.aud) && payload.aud.includes(audience))) {
    return null;
  }

  const certs = await fetchAccessCerts(teamDomain);
  const header = JSON.parse(base64UrlDecode(parts[0]));
  const kid = header.kid;
  const key = certs.keys.find((k) => k.kid === kid);
  if (!key) return null;

  // 构造公钥
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    key,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = new Uint8Array(
    Array.from(base64UrlDecode(parts[2])).map((c) => c.charCodeAt(0))
  );

  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, data);
  return valid ? payload : null;
}

export async function requireAccessAuth(c, next) {
  // 本地开发：未配置 ACCESS_AUD 时放行
  const audience = c.env.ACCESS_AUD;
  if (!audience) {
    c.set('user', { email: 'dev@local', name: 'Local Dev' });
    return next();
  }

  const token = c.req.header('Cf-Access-Jwt-Assertion');
  if (!token) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const teamDomain = c.env.ACCESS_TEAM_DOMAIN;
  if (!teamDomain) {
    return c.json({ error: 'Access misconfigured' }, 500);
  }

  try {
    const payload = await verifyAccessJwt(token, audience, teamDomain);
    if (!payload) {
      return c.json({ error: 'Invalid or expired token' }, 403);
    }
    c.set('user', { email: payload.email, name: payload.name });
    return next();
  } catch (err) {
    console.error('Access JWT verification failed:', err);
    return c.json({ error: 'Authentication failed' }, 500);
  }
}
