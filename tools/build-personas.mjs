// 把 example/ 里那四张烤好的效果图（11~25MB PNG）压成能上线的图，
// 并拼一张对照表，方便确认哪张对应哪个人格。
//
//   node tools/build-personas.mjs
//
// 产物：
//   me/personas/1.jpg ~ 4.jpg   720x960 q82，按哈希文件名排序（顺序稳定，
//                               对应关系写在 HeroConcept.vue 的 PERSONAS 配置里）
//   控制台提示的对照图路径       源图（上排） vs 效果图（下排）
//
// example/ 不在 vite 的静态目录白名单里（只有 icons/avatar/me/logo/music），
// 所以必须落到 me/ 下面才会被 dev server 和构建复制。放 me/personas/。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exampleDir = path.join(repoRoot, 'example');
const meDir = path.join(repoRoot, 'me');
const outDir = path.join(meDir, 'personas');
const sheetPath = path.join(repoRoot, '.hero-shots', 'persona-sheet.png');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.dirname(sheetPath), { recursive: true });

const examples = fs.readdirSync(exampleDir).filter((f) => f.endsWith('.png')).sort();
const sources = ['Advocate.jpg', 'idealist.jpg', 'Observer.jpg', 'Romanticist.jpg'];

if (examples.length !== 4) {
  console.error(`预期 4 张 example，实际 ${examples.length}`);
  process.exit(1);
}

const script = `
import sys, json
from PIL import Image, ImageDraw
Image.MAX_IMAGE_PIXELS = None

examples, sources, out_dir, sheet = json.loads(sys.argv[1]), json.loads(sys.argv[2]), sys.argv[3], sys.argv[4]

CELL_W, CELL_H = 300, 400
LABEL_H = 22
COLS, ROWS = 4, 2

sheet_img = Image.new('RGB', (CELL_W * COLS, (CELL_H + LABEL_H) * ROWS), (18, 18, 18))
draw = ImageDraw.Draw(sheet_img)

def cell(im, x, y, text):
    im = im.convert('RGB').resize((CELL_W, CELL_H), Image.LANCZOS)
    sheet_img.paste(im, (x, y))
    draw.rectangle([x, y + CELL_H, x + CELL_W, y + CELL_H + LABEL_H], fill=(24, 24, 24))
    draw.text((x + 6, y + CELL_H + 6), text, fill=(235, 235, 235))

# 上排：me/ 里的干净源图（按人格名）
for i, name in enumerate(sources):
    im = Image.open(sys.argv[5] + '/' + name)
    cell(im, i * CELL_W, 0, 'SRC  ' + name.replace('.jpg', ''))

# 下排：example/ 里烤好的效果图（按哈希排序 = 输出文件 1..4 的顺序）
made = []
for i, p in enumerate(examples):
    im = Image.open(p)
    cell(im, i * CELL_W, CELL_H + LABEL_H, 'EX  #' + str(i + 1) + '  ' + p.split('\\\\')[-1][:8])
    out = out_dir + '/' + str(i + 1) + '.jpg'
    im.convert('RGB').resize((720, 960), Image.LANCZOS).save(out, 'JPEG', quality=82, optimize=True)
    made.append(out)

sheet_img.save(sheet)
print(json.dumps({'sheet': sheet, 'made': made}))
`;

const out = execFileSync(
  'python',
  ['-c', script, JSON.stringify(examples.map((f) => path.join(exampleDir, f))), JSON.stringify(sources), outDir.replace(/\\/g, '/'), sheetPath.replace(/\\/g, '/'), meDir.replace(/\\/g, '/')],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
);

const result = JSON.parse(out);
for (const f of result.made) {
  console.log(`${path.relative(repoRoot, f).replace(/\\/g, '/')}  ${(fs.statSync(f).size / 1024).toFixed(0)}KB`);
}
console.log(`\n对照图：${result.sheet}`);
