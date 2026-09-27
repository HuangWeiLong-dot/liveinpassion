// R2 封装层：原图与压缩图双结构
// key 约定：
//   新文件: {type}/{yyyyMM}/{hash前8位}.{ext}，压缩图放 {type}/{yyyyMM}/_compressed/{hash前8位}.{ext}
//   旧文件保持原名不动

const CDN_BASE = 'https://img.liveinpassion.me';

// 计算内容 hash 前 8 位用于生成不可变文件名
async function contentHash(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < 4; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

// 校验图片魔术字节
function detectImageType(uint8) {
  if (uint8.length < 12) return null;
  // JPEG: FF D8 FF
  if (uint8[0] === 0xff && uint8[1] === 0xd8 && uint8[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (uint8[0] === 0x89 && uint8[1] === 0x50 && uint8[2] === 0x4e && uint8[3] === 0x47) return 'image/png';
  // WebP: RIFF .... WEBP
  if (
    uint8[0] === 0x52 && uint8[1] === 0x49 && uint8[2] === 0x46 && uint8[3] === 0x46 &&
    uint8[8] === 0x57 && uint8[9] === 0x45 && uint8[10] === 0x42 && uint8[11] === 0x50
  ) return 'image/webp';
  return null;
}

const EXT_MAP = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_SIZE = 20 * 1024 * 1024; // 20MB

/**
 * 上传图片到 R2
 * @param {R2Bucket} bucket
 * @param {ArrayBuffer} data - 图片二进制
 * @param {string} type - 类型前缀（blog / album / me 等）
 * @param {string} variant - 'original' | 'compressed'
 * @returns {{ key: string, url: string }}
 */
export async function uploadImage(bucket, data, type, variant = 'original') {
  const uint8 = new Uint8Array(data);
  const mimeType = detectImageType(uint8);
  if (!mimeType) throw new Error('Unsupported image type (only jpg/png/webp)');
  if (data.byteLength > MAX_SIZE) throw new Error(`Image too large (max ${MAX_SIZE / 1024 / 1024}MB)`);

  const hash = await contentHash(data);
  const ext = EXT_MAP[mimeType];
  const now = new Date();
  const yyyyMM = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

  let key;
  if (variant === 'compressed') {
    key = `${type}/${yyyyMM}/_compressed/${hash}.${ext}`;
  } else {
    key = `${type}/${yyyyMM}/${hash}.${ext}`;
  }

  // 检查是否已存在（内容 hash 命名，存在即跳过）
  const existing = await bucket.head(key);
  if (!existing) {
    await bucket.put(key, data, {
      httpMetadata: {
        contentType: mimeType,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
  }

  return { key, url: `${CDN_BASE}/${key}` };
}

/**
 * 列出指定前缀下的所有 R2 对象（自动分页）
 */
export async function listAll(bucket, prefix) {
  const results = [];
  let cursor = undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    results.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return results;
}

export { CDN_BASE, detectImageType, MAX_SIZE };
