// 鉴权中间件：双模式
//   1) Cloudflare Access JWT（Cf-Access-Jwt-Assertion 头）——边缘还挂着 Access 策略时使用
//   2) 自有会话 Cookie（cms_session，HMAC-SHA256 签名）——边缘 Access 关闭后使用
// 这样部署新 Worker 后可以先验证再关 Access，桌面端不中断。
// 本地开发（ACCESS_AUD 与 CMS_PASSWORD 都未配置）时放行所有 admin 请求。

const CERTS_CACHE_TTL = 60 * 60 * 1000; // 1 小时
let certsCache = null;
let certsCacheTime = 0;

const SESSION_COOKIE = 'cms_session';
const SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 天
const SIGNING_NAMESPACE = 'cms-session-v1';

function base64UrlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const base64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  return atob(base64);
}

function base64UrlEncode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function utf8(str) {
  return new TextEncoder().encode(str);
}

export { base64UrlDecode, SESSION_COOKIE, SESSION_TTL_SEC };

function bytesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------- Cloudflare Access JWT ----------

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

// ---------- 自有会话 Cookie ----------

// HMAC 密钥由 CMS_PASSWORD 派生；密码轮换会使旧会话失效（重新登录即可）
let signingKeyCache = null;
let signingKeySecret = null;
async function getSigningKey(secret) {
  if (signingKeyCache && signingKeySecret === secret) return signingKeyCache;
  const digest = await crypto.subtle.digest('SHA-256', utf8(`${SIGNING_NAMESPACE}:${secret}`));
  const key = await crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  signingKeyCache = key;
  signingKeySecret = secret;
  return key;
}

function parseCookies(c) {
  const header = c.req.header('Cookie') || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export async function createSessionCookie(c, secret) {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(utf8(JSON.stringify({ iat: now, exp: now + SESSION_TTL_SEC })));
  const key = await getSigningKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(payload)));
  return `${payload}.${base64UrlEncode(sig)}`;
}

export function buildSessionSetCookie(value) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}`;
}

export function buildClearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function verifySessionCookie(c, secret) {
  if (!secret) return null;
  const raw = parseCookies(c)[SESSION_COOKIE];
  if (!raw || raw.indexOf('.') === -1) return null;
  const [payloadB64, sigB64] = raw.split('.');
  if (!payloadB64 || !sigB64) return null;

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    return null;
  }
  if (!payload || !payload.exp || payload.exp * 1000 < Date.now()) return null;

  const key = await getSigningKey(secret);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(payloadB64)));
  let given;
  try {
    given = new Uint8Array(Array.from(base64UrlDecode(sigB64)).map((ch) => ch.charCodeAt(0)));
  } catch {
    return null;
  }
  return bytesEqual(expected, given) ? payload : null;
}

// 密码校验：哈希后定长比较，避免时序侧信道
export async function checkPassword(secret, input) {
  if (!secret || typeof input !== 'string' || !input) return false;
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(secret)));
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(input)));
  return bytesEqual(a, b);
}

// 返回当前登录主体；未登录返回 null
export async function getAuthUser(c) {
  const audience = c.env.ACCESS_AUD;
  const secret = c.env.CMS_PASSWORD;

  // 本地开发：两个都没配 → 放行
  if (!audience && !secret) return { email: 'dev@local', name: 'Local Dev' };

  // 1) Access JWT（边缘策略仍开启时，CF 会注入这个头）
  const accessToken = c.req.header('Cf-Access-Jwt-Assertion');
  if (audience && accessToken && c.env.ACCESS_TEAM_DOMAIN) {
    try {
      const payload = await verifyAccessJwt(accessToken, audience, c.env.ACCESS_TEAM_DOMAIN);
      if (payload) return { email: payload.email, name: payload.name };
    } catch (err) {
      console.error('Access JWT verification failed:', err);
    }
  }

  // 2) 自有会话 Cookie
  const session = await verifySessionCookie(c, secret);
  if (session) return { email: 'admin', name: 'Admin' };

  return null;
}

export async function requireAccessAuth(c, next) {
  const user = await getAuthUser(c);
  if (!user) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  c.set('user', user);
  return next();
}
