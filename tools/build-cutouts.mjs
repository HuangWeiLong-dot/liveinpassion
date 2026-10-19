// 处理 me/cutouts/ 下的人物抠图，产物仍写回原文件，并顺带生成
// 「只保留蓝色衣服」的叠加层 <name>_selective.webp。
//
//   node tools/build-cutouts.mjs
//
// 两件事：
//   1. 白边：抠图是从白底上抠下来的，边缘残留一圈发白的像素。
//      这里对半透明像素按白底反解（un-premultiply against white），
//      再把轮廓最外 3px 压暗，白边就不会在黑底上亮成一条线。
//   2. 保留衣服颜色：ME 页的卡片刻意做成「黑白只留外套蓝」。
//      按 B - max(R,G) 做蓝色键控，单独存一层透明底彩色图；页面里把它
//      叠在灰度图上面，滚动时只调它的 opacity —— 不在运行时跑滤镜，
//      滚动期间没有逐帧重算的成本。
//
// 原图先备份到 example/me/cutouts_raw/（example/ 整个目录 gitignore）。
// 这个脚本**不是幂等的**：重复跑会把已经压暗的边缘再压一遍，所以备份存在时不覆盖。
//
// 依赖 Pillow（和其它 tools/*.mjs 里的图片脚本一致）。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cutoutDir = path.join(repoRoot, 'me', 'cutouts');
const backupDir = path.join(repoRoot, 'example', 'me', 'cutouts_raw');

if (!fs.existsSync(cutoutDir)) {
  console.error(`找不到 ${cutoutDir}`);
  process.exit(1);
}

const files = fs
  .readdirSync(cutoutDir)
  .filter((f) => f.endsWith('.webp') && !f.endsWith('_selective.webp'))
  .sort()
  .map((f) => path.join(cutoutDir, f));

if (!files.length) {
  console.error('me/cutouts/ 里没有 .webp');
  process.exit(1);
}

// 备份目录只在需要时创建；已存在的备份不覆盖（保护真正的原始文件）
fs.mkdirSync(backupDir, { recursive: true });

const script = `
import sys, json, os, shutil
from PIL import Image, ImageFilter

files, backup_dir, out_dir = json.loads(sys.argv[1]), sys.argv[2], sys.argv[3]

def clamp(v, lo, hi):
    return lo if v < lo else (hi if v > hi else v)

made = []
for f in files:
    name = os.path.basename(f)
    stem, _ = os.path.splitext(name)
    backup = os.path.join(backup_dir, name)
    # 幂等：已经有备份说明这张主图已经处理过（白边压暗会叠加），只重算叠加层
    already_clean = os.path.exists(backup)
    if not already_clean:
        shutil.copy2(f, backup)

    im = Image.open(f).convert('RGBA')
    w, h = im.size
    data = list(im.getdata())

    if not already_clean:
        # 轮廓最外三像素的 alpha 与完整 alpha 的差 = 边缘带
        alpha = im.getchannel('A')
        eroded = alpha
        for _ in range(3):
            eroded = eroded.filter(ImageFilter.MinFilter(3))
        er = list(eroded.getdata())

        out = []
        for (r, g, b, a), edge in zip(data, er):
            if a < 8:
                out.append((0, 0, 0, 0))
                continue
            # 半透明像素按白底反解，去掉白色残留
            if a < 255:
                af = a / 255.0
                r = int(clamp((r - (1 - af) * 255) / af, 0, 255))
                g = int(clamp((g - (1 - af) * 255) / af, 0, 255))
                b = int(clamp((b - (1 - af) * 255) / af, 0, 255))
            # 最外一圈压暗：白边在黑底上不再发光
            band = a - edge
            if band > 0:
                k = 1 - 0.72 * (band / 255.0)
                r, g, b = int(r * k), int(g * k), int(b * k)
            out.append((r, g, b, a))

        clean = Image.new('RGBA', (w, h))
        clean.putdata(out)
        clean.save(f, 'WEBP', quality=90, method=6)
        data = out

    # 只保留衣服颜色的叠加层：
    #   蓝外套：B - max(R,G) 在 30~120；皮肤为负、白 T 恤接近 0
    #   红外套：R - max(G,B) 同理，阈值更窄一点
    red = '_red_' in name.lower()
    sel = []
    for (r, g, b, a) in data:
        if a < 8:
            sel.append((0, 0, 0, 0))
            continue
        if red:
            d = r - max(g, b)
            k = clamp((d - 8) / 22.0, 0.0, 1.0)
        else:
            d = b - max(r, g)
            k = clamp((d - 10) / 30.0, 0.0, 1.0)
        k = k * k * (3 - 2 * k)
        if k <= 0.002:
            sel.append((0, 0, 0, 0))
        else:
            sel.append((r, g, b, int(a * k)))
    selective = Image.new('RGBA', (w, h))
    selective.putdata(sel)
    selective_path = os.path.join(out_dir, stem + '_selective.webp')
    selective.save(selective_path, 'WEBP', quality=88, method=6)

    made.append((name, os.path.getsize(f), os.path.getsize(selective_path), already_clean))

print(json.dumps({'made': made, 'backup': backup_dir}))
`;

const out = execFileSync(
  'python',
  ['-c', script, JSON.stringify(files), backupDir.replace(/\\/g, '/'), cutoutDir.replace(/\\/g, '/')],
  { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
);

const result = JSON.parse(out.trim().split('\n').pop());
for (const [name, cleanSize, selSize, alreadyClean] of result.made) {
  console.log(
    `${name.padEnd(30)} ${alreadyClean ? 'kept ' : 'clean'} ${(cleanSize / 1024).toFixed(0)}KB  selective ${(selSize / 1024).toFixed(0)}KB`
  );
}
console.log(`\n原图备份：${path.relative(repoRoot, result.backup).replace(/\\/g, '/')}`);
