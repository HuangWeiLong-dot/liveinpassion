// Markdown 静态检查：纯文本分析，不依赖编辑器实例，可以直接在 Node 里跑。
// 编辑器在输入停下 400ms 后对 form.contentMd 跑一遍，结果列在 Lint 面板里。
//
// 语法规则只覆盖这套站点真正会写到的结构：围栏代码、标题、链接/图片、HTML 块、表格、分页符。
// 拼写分两层：这里查常见错拼与重复词；其余错字交给浏览器原生拼写检查
//（编辑器里的红下划线，见 BlogEdit.vue 中 codeMirrorExtensions 放开 spellcheck 的那段）。

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const PAGE_BREAK_SPLIT_RE = /<div[^>]*class="[^"]*page-break[^"]*"[^>]*>\s*<\/div>/i;
const PAGE_BREAK_STRIP_RE = /<div[^>]*class="[^"]*page-break[^"]*"[^>]*>\s*<\/div>/gi;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const BLOCK_TAGS = new Set(['div', 'figure', 'figcaption', 'section', 'table', 'ul', 'ol', 'details']);
// 这些重复词在英文里是正常写法，不报
const REPEAT_ALLOW = new Set(['that', 'had', 'is', 'no', 'very', 'so', 'long', 'well', 'now', 'then']);

// 常见错拼 → 正确写法。只收真正写错的词，避免把短诗里少见但正确的词标出来。
const MISSPELLINGS = {
  accomodate: 'accommodate',
  acheive: 'achieve',
  accross: 'across',
  adress: 'address',
  agressive: 'aggressive',
  apparant: 'apparent',
  arguement: 'argument',
  athelete: 'athlete',
  basicly: 'basically',
  becuase: 'because',
  beggining: 'beginning',
  belive: 'believe',
  benifit: 'benefit',
  calender: 'calendar',
  catagory: 'category',
  cemetary: 'cemetery',
  changable: 'changeable',
  colleage: 'college',
  comming: 'coming',
  commited: 'committed',
  completly: 'completely',
  concious: 'conscious',
  definately: 'definitely',
  desparate: 'desperate',
  diffrent: 'different',
  dissapoint: 'disappoint',
  embarass: 'embarrass',
  enviroment: 'environment',
  existance: 'existence',
  experiance: 'experience',
  familar: 'familiar',
  feild: 'field',
  finaly: 'finally',
  foriegn: 'foreign',
  freind: 'friend',
  futher: 'further',
  goverment: 'government',
  grammer: 'grammar',
  happend: 'happened',
  hieght: 'height',
  immediatly: 'immediately',
  independant: 'independent',
  interupt: 'interrupt',
  knowlege: 'knowledge',
  langauge: 'language',
  lenght: 'length',
  liesure: 'leisure',
  maintenence: 'maintenance',
  millenium: 'millennium',
  neccessary: 'necessary',
  necesary: 'necessary',
  noticable: 'noticeable',
  occassion: 'occasion',
  occured: 'occurred',
  oppurtunity: 'opportunity',
  paralell: 'parallel',
  particualr: 'particular',
  peice: 'piece',
  perhapse: 'perhaps',
  posession: 'possession',
  preceed: 'proceed',
  prefered: 'preferred',
  priviledge: 'privilege',
  probaly: 'probably',
  proffesional: 'professional',
  promiss: 'promise',
  publically: 'publicly',
  quater: 'quarter',
  realy: 'really',
  recieved: 'received',
  reciept: 'receipt',
  recomend: 'recommend',
  refered: 'referred',
  relevent: 'relevant',
  religous: 'religious',
  remeber: 'remember',
  rythme: 'rhythm',
  sacrafice: 'sacrifice',
  seperate: 'separate',
  sieze: 'seize',
  similiar: 'similar',
  sincerly: 'sincerely',
  speach: 'speech',
  strenght: 'strength',
  succesful: 'successful',
  supercede: 'supersede',
  suprise: 'surprise',
  tempreture: 'temperature',
  thier: 'their',
  threshhold: 'threshold',
  tommorow: 'tomorrow',
  truely: 'truly',
  unfortunatly: 'unfortunately',
  untill: 'until',
  usuallly: 'usually',
  vacume: 'vacuum',
  vehical: 'vehicle',
  wierd: 'weird',
  writting: 'writing',
  yatch: 'yacht',
  teh: 'the',
  adn: 'and',
  taht: 'that',
  wiht: 'with',
  waht: 'what',
};

const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

function issue(rule, severity, line, col, length, message) {
  return { rule, severity, line, col, length, message };
}

// 把行内不该参与拼写/文字检查的片段（行内代码、图片整段、链接地址、HTML 标签、裸 URL）
// 替换成等长空格，列号仍然对得上原文；链接文字保留，方便查出链接里的错字。
function maskLine(line) {
  return line
    .replace(/`[^`]*`/g, (m) => ' '.repeat(m.length))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, (m) => ' '.repeat(m.length))
    .replace(/\[([^\]]*)\]\([^)]*\)/g, (m, label) => `${' '.repeat(m.length - label.length)}${label}`)
    .replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length))
    .replace(/<\/?[a-zA-Z][^>]*>/g, (m) => ' '.repeat(m.length))
    .replace(/https?:\/\/\S+/g, (m) => ' '.repeat(m.length));
}

function cellCount(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').length;
}

export function lintMarkdown(source) {
  const text = String(source ?? '');
  const lines = text.split('\n');
  const issues = [];

  // ---- 围栏代码块：先标出每一行是否在围栏里，围栏内部不参与后文所有规则 ----
  const inFence = new Array(lines.length).fill(false);
  const openings = [];
  let fence = null;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(FENCE_RE);
    if (fence) {
      if (m && m[1][0] === fence.char && m[1].length >= fence.len && !m[2].trim()) {
        fence.closed = true;
        fence = null;
      } else {
        inFence[i] = true;
      }
      continue;
    }
    if (m) {
      fence = { char: m[1][0], len: m[1].length, lang: m[2].trim(), line: i + 1, closed: false };
      openings.push(fence);
      inFence[i] = true;
    }
  }
  for (const f of openings) {
    const lineText = lines[f.line - 1];
    if (!f.closed) {
      issues.push(issue('fence-unclosed', 'error', f.line, 0, lineText.length,
        'Code fence is never closed — the rest of the post renders as code'));
    } else if (!f.lang) {
      issues.push(issue('fence-lang', 'info', f.line, 0, lineText.length,
        'Code block has no language tag'));
    }
  }

  // ---- 逐行：标题、链接/图片、加粗、分页符 ----
  let lastHeading = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (inFence[i]) continue;
    const line = lines[i];
    const ln = i + 1;

    const heading = line.match(/^(#{1,6})(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const rest = heading[2];
      if (!rest.trim()) {
        issues.push(issue('heading-empty', 'warn', ln, 0, line.length, 'Empty heading'));
      } else if (!/^[ \t]/.test(rest)) {
        issues.push(issue('heading-space', 'error', ln, level, rest.length,
          'Missing space after # — this line will not render as a heading'));
      } else {
        if (lastHeading && level > lastHeading + 1) {
          issues.push(issue('heading-jump', 'info', ln, 0, line.length,
            `Heading level jumps from h${lastHeading} to h${level}`));
        }
        lastHeading = level;
      }
    }

    if (line.includes('[') || line.includes(']')) {
      const openLink = line.match(/!?\[[^\]]*\]\([^)]*$/);
      if (openLink) {
        issues.push(issue('link-unclosed', 'error', ln, openLink.index, line.length - openLink.index,
          'Link or image is missing its closing ")"'));
      }
      const opens = (line.match(/(?<!\\)\[/g) || []).length;
      const closes = (line.match(/(?<!\\)\]/g) || []).length;
      if (opens !== closes) {
        issues.push(issue('bracket-unbalanced', 'warn', ln, 0, line.length,
          `Unbalanced square brackets (${opens} × [ vs ${closes} × ])`));
      }
      for (const m of line.matchAll(/!\[([^\]]*)\]\(([^)]*)\)/g)) {
        if (!m[1].trim()) {
          issues.push(issue('image-alt', 'warn', ln, m.index, m[0].length, 'Image has no alt text'));
        }
        if (!m[2].trim()) {
          issues.push(issue('image-empty-src', 'error', ln, m.index, m[0].length, 'Image has no source'));
        }
      }
      for (const m of line.matchAll(/(?<!!)\[([^\]]*)\]\(([^)]*)\)/g)) {
        if (!m[1].trim()) {
          issues.push(issue('link-empty-text', 'warn', ln, m.index, m[0].length, 'Link has no text'));
        }
        if (!m[2].trim()) {
          issues.push(issue('link-empty-href', 'error', ln, m.index, m[0].length, 'Link has no address'));
        }
      }
    }

    const masked = maskLine(line);
    if ((masked.match(/\*\*/g) || []).length % 2 === 1) {
      issues.push(issue('emphasis-unclosed', 'warn', ln, Math.max(0, masked.indexOf('**')), 2,
        'Unbalanced ** bold marker'));
    }

    if (PAGE_BREAK_SPLIT_RE.test(line) && line.replace(PAGE_BREAK_STRIP_RE, '').trim()) {
      issues.push(issue('pagebreak-inline', 'warn', ln, 0, line.length,
        'Page break must sit on its own line'));
    }
  }

  // ---- HTML 块：站点正文里用 <div>/<figure> 承担排版，开闭必须成对，否则会吞掉后文 ----
  const stack = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (inFence[i]) continue;
    for (const m of lines[i].matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
      const tag = m[2].toLowerCase();
      if (!BLOCK_TAGS.has(tag)) continue;
      if (m[1]) {
        let at = -1;
        for (let k = stack.length - 1; k >= 0; k -= 1) {
          if (stack[k].tag === tag) { at = k; break; }
        }
        if (at === -1) {
          issues.push(issue('html-orphan-close', 'warn', i + 1, m.index, m[0].length,
            `</${tag}> closes a tag that was never opened`));
        } else {
          stack.length = at;
        }
      } else if (!/\/\s*>$/.test(m[0])) {
        stack.push({ tag, line: i + 1 });
      }
    }
  }
  for (const open of stack) {
    issues.push(issue('html-unclosed', 'error', open.line, 0, lines[open.line - 1].length,
      `<${open.tag}> is never closed`));
  }

  // ---- 表格：分隔行决定列数，其余行的竖线数量必须一致 ----
  for (let i = 1; i < lines.length; i += 1) {
    if (inFence[i] || !TABLE_SEP_RE.test(lines[i])) continue;
    const cols = cellCount(lines[i]);
    let start = i - 1;
    while (start >= 0 && !inFence[start] && lines[start].includes('|') && lines[start].trim()) start -= 1;
    start += 1;
    let end = i + 1;
    while (end < lines.length && !inFence[end] && lines[end].includes('|') && lines[end].trim()) end += 1;
    end -= 1;
    for (let k = start; k <= end; k += 1) {
      if (k === i) continue;
      const c = cellCount(lines[k]);
      if (c !== cols) {
        issues.push(issue('table-columns', 'warn', k + 1, 0, lines[k].length,
          `Table row has ${c} column${c === 1 ? '' : 's'}, header has ${cols}`));
      }
    }
    i = end;
  }

  // ---- 文字：重复词 + 常见错拼 ----
  let words = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (inFence[i]) continue;
    const plain = maskLine(lines[i]);
    const ln = i + 1;

    for (const m of plain.matchAll(/\b([A-Za-z][A-Za-z'’-]{1,})\b[ \t]+\1\b/gi)) {
      if (REPEAT_ALLOW.has(m[1].toLowerCase())) continue;
      issues.push(issue('repeated-word', 'warn', ln, m.index, m[0].length, `Repeated word "${m[1]}"`));
    }

    for (const m of plain.matchAll(/[A-Za-z][A-Za-z'’-]*/g)) {
      words += 1;
      const raw = m[0];
      const lower = raw.toLowerCase().replace(/’/g, "'");
      let fix = MISSPELLINGS[lower];
      if (!fix && lower.endsWith('s')) {
        const base = MISSPELLINGS[lower.slice(0, -1)];
        if (base) fix = `${base}s`;
      }
      if (!fix) continue;
      if (/^[A-Z]/.test(raw)) fix = fix.charAt(0).toUpperCase() + fix.slice(1);
      issues.push(issue('misspelling', 'warn', ln, m.index, raw.length, `"${raw}" → "${fix}"?`));
    }
  }

  issues.sort((a, b) => a.line - b.line || a.col - b.col || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const pageParts = text.split(PAGE_BREAK_STRIP_RE).map((s) => s.trim()).filter(Boolean);
  return {
    issues,
    stats: {
      words,
      pages: Math.max(1, pageParts.length),
      readTime: Math.max(1, Math.round(words / 200)),
    },
  };
}
