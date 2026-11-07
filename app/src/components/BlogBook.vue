<script setup>
// 多页正文的阅读器：一页纸 + 翻页动画 + 前后按钮 + 键盘 / 滚轮 / 拖动。
//
// 结构上只有两层纸：leaf（当前页，负责转动）和 under（下一页/上一页，垫在下面）。
// 向前翻：leaf 绕左边缘转 -104°，露出 under；到 90° 后 backface 隐藏，纸就"翻过去了"。
// 向后翻：把上一页放回 leaf、从 -104° 转回 0°，等于把那张纸翻回来盖住当前页。
// 鼠标在右边缘的窄条上按住左拖，也能实时把纸拉起来；松手过 30% 就完成翻页。
//
// 分页分两层：
//   ① CMS 的 <div class="page-break"> 是**语义页**（诗节 / 章节），由父组件切好传进来；
//   ② 这里按纸的**实际可用高度**再切一次 —— 窗口矮的时候一页语义页装不下，
//      以前会在一张看不见滚动条的纸里被裁掉（1280×720 实测最长那页少了 257px）。
//      切点只落在 <br> 行和块级元素之间，每一张纸都完整可读。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { gsap } from 'gsap';

const props = defineProps({
  pages: { type: Array, default: () => [] },
});

const paperRef = ref(null);
const leafRef = ref(null);
const measureRef = ref(null);

const index = ref(0);
// 真正渲染的页：[{ html, lh }] —— html 是这一页的正文，lh 是按纸高算出来的行高倍数
// （0 = 用样式表默认值）。props.pages 只是语义页，见 repaginate。
const displayPages = ref([]);
const leafHtml = ref('');
const leafLh = ref(0);
// 纸上印的页码：往前翻时 leaf 装的是上一页，页码不能直接读 index
const leafNo = ref(1);
const underHtml = ref('');
const underLh = ref(0);
const turning = ref(false);

const total = computed(() => displayPages.value.length);
const hasPrev = computed(() => index.value > 0);
const hasNext = computed(() => index.value < total.value - 1);

const MAX_TURN = 180;
const reduced = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let timeline = null;
let drag = null;
let suppressClick = false;
let repaginateTimer = 0;
let resizeObserver = null;
let wheelAcc = 0;
let wheelLockUntil = 0;
// 连按方向键/快速滑动时，只记一步待翻方向：动画结束立刻接上，
// 不会像之前那样把第二次输入直接吞掉。
let queuedDir = 0;
const dragging = ref(false);
// 静止时用一张完整的平面纸盖住 3 段纸带（避免接缝）；
// 一开始翻/拖就切到纸带，弯折结束后再盖回来。
const flatOn = ref(true);

// 3 段纸带：每段宽 1/3，段与段之间沿左边缘铰接。
// 每铰接一次加一点 rotateY，叠起来就是一条弯折的纸；--curl 是单个铰链的角度。
const SEGMENTS = 3;
const MAX_CURL = 16; // 单个铰链最大弯折（度）；3 段合计最多 32°
// 三段宽度必须落在整数像素上：1/3 的分数宽会在段与段之间留出 1px 的缝，
// 正文被裁出一道口子。先按整张纸宽分配，再把切片按同样的像素偏移错位。
const pageWidth = ref(0);
const segWidths = ref([0, 0, 0]);

function setTurnVars(bend) {
  const paper = paperRef.value;
  if (!paper) return;
  const deg = MAX_CURL * bend;
  paper.style.setProperty('--curl', `${deg.toFixed(2)}deg`);
  paper.style.setProperty('--curl-n', bend.toFixed(3));
  paper.style.setProperty('--flip', bend.toFixed(3));
}

// p: 0 → 1（下一页：纸从平放转到 -104°；上一页：从 -104° 落回 0）
// bend = sin(πp)：两头平、中间弯得最多，像纸被手指顶起来。
function applyTurn(p, dir, tilt = 0) {
  const t = Math.max(0, Math.min(1, p));
  const angle = dir > 0 ? -MAX_TURN * t : -MAX_TURN * (1 - t);
  const bend = Math.sin(Math.PI * t);
  if (leafRef.value) gsap.set(leafRef.value, { rotateY: angle, rotateZ: tilt });
  setTurnVars(bend);
}

function animateTurn(from, to, dir, duration, ease, done) {
  if (!leafRef.value || reduced) {
    applyTurn(to, dir);
    done?.();
    return;
  }
  const state = { p: from };
  timeline = gsap.timeline({
    onComplete: () => {
      applyTurn(to, dir);
      done?.();
    },
  });
  timeline.to(state, {
    p: to,
    duration,
    ease,
    onUpdate: () => applyTurn(state.p, dir),
  });
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function resetLeaf() {
  if (leafRef.value) gsap.set(leafRef.value, { rotateY: 0, rotateZ: 0 });
  setTurnVars(0);
}

function resetScroll() {
  nextTick(() => {
    const sc = leafRef.value?.querySelector('.bd-book__content');
    if (sc) sc.scrollTop = 0;
  });
}

function kill() {
  timeline?.kill();
  timeline = null;
  removeDragListeners();
  if (drag) releaseCapture(drag.id);
  drag = null;
  dragging.value = false;
  flatOn.value = true;
  setTurnVars(0);
}

function pageAt(i) {
  return displayPages.value[i] || { html: '', lh: 0 };
}

// 当前页 / 垫在下面的那页：html 和行高必须一起换，否则会拿上一页的行距渲染新页。
function setLeaf(page, no = index.value + 1) {
  leafHtml.value = page?.html || '';
  leafLh.value = page?.lh || 0;
  leafNo.value = no;
}

function computeSegWidths() {
  const W = paperRef.value?.clientWidth || 0;
  pageWidth.value = W;
  if (!W) {
    segWidths.value = [0, 0, 0];
    return;
  }
  const w0 = Math.floor(W / SEGMENTS);
  const w1 = Math.floor((W - w0) / (SEGMENTS - 1));
  segWidths.value = [w0, w1, W - w0 - w1];
}

// 每一段里放的是**完整一页**，只把它的第 i 段露出来：
// left = -前面几段宽度之和，width = 全页宽。用像素值，避免分数宽造成接缝。
function sliceStyle(i) {
  const w = segWidths.value;
  const offset = i === 0 ? 0 : i === 1 ? w[0] : w[0] + w[1];
  return {
    left: pageWidth.value ? `${-offset}px` : `${-i * 100}%`,
    width: pageWidth.value ? `${pageWidth.value}px` : `${SEGMENTS * 100}%`,
    lineHeight: leafLh.value || undefined,
  };
}

function segStyle(i) {
  return segWidths.value[i] ? { width: `${segWidths.value[i]}px` } : {};
}
function setUnder(page) {
  underHtml.value = page?.html || '';
  underLh.value = page?.lh || 0;
}
function clearUnder() {
  underHtml.value = '';
  underLh.value = 0;
}

function runQueue() {
  if (!queuedDir) return;
  const d = queuedDir;
  queuedDir = 0;
  requestAnimationFrame(() => turn(d));
}

function finishForward() {
  index.value = Math.min(total.value - 1, index.value + 1);
  setLeaf(pageAt(index.value));
  clearUnder();
  resetLeaf();
  resetScroll();
  turning.value = false;
  flatOn.value = true;
  timeline = null;
  runQueue();
}

function finishBackward() {
  index.value = Math.max(0, index.value - 1);
  setLeaf(pageAt(index.value));
  clearUnder();
  resetLeaf();
  resetScroll();
  turning.value = false;
  flatOn.value = true;
  timeline = null;
  runQueue();
}

function turnForward() {
  if (!hasNext.value) return;
  turning.value = true;
  flatOn.value = false;
  setUnder(pageAt(index.value + 1));
  if (!leafRef.value || reduced) {
    finishForward();
    return;
  }
  applyTurn(0, 1, 0);
  animateTurn(0, 1, 1, 1.05, 'power3.out', finishForward);
}

function turnBackward() {
  if (!hasPrev.value) return;
  turning.value = true;
  flatOn.value = false;
  // 上一页放在 leaf 上，当前页垫在下面；纸从 -104° 落回来
  setUnder(pageAt(index.value));
  setLeaf(pageAt(index.value - 1), index.value);
  if (!leafRef.value || reduced) {
    finishBackward();
    return;
  }
  applyTurn(0, -1, 0);
  animateTurn(0, 1, -1, 1.05, 'power3.out', finishBackward);
}

// 返回 true = 这次输入被翻页吃掉了（包括"正在翻，先吞掉"），
// 返回 false = 到头了，交给父组件决定要不要换上一篇 / 下一篇。
function turn(dir) {
  if (drag) return true;
  if (turning.value) {
    // 连按第二次：记下来，这一页翻完立刻接上（只排一步，避免连按冲过头）
    queuedDir = dir;
    return true;
  }
  if (dir > 0) {
    if (!hasNext.value) return false;
    turnForward();
    return true;
  }
  if (!hasPrev.value) return false;
  turnBackward();
  return true;
}

// HOME / END：直接落位，不演连翻。
function jumpTo(target) {
  if (turning.value) return true;
  const i = Math.max(0, Math.min(total.value - 1, target));
  if (i === index.value) return false;
  index.value = i;
  setLeaf(pageAt(i));
  clearUnder();
  resetLeaf();
  resetScroll();
  return true;
}

function isTextTarget(t) {
  if (!t || t.nodeType !== 1) return false;
  if (t.isContentEditable) return true;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '');
}

// 键盘由父组件那个 document 级监听转进来：书页模式下 ← / → 翻页，
// 到头才退回上一/下一篇。Space 只在焦点不在按钮/链接上时接管，
// 否则会和按钮自己的 click 叠加成一次翻两页。
function handleKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (isTextTarget(e.target)) return false;
  if (e.key === ' ' && e.target?.closest?.('button, a, [role="button"]')) return false;
  switch (e.key) {
    case 'ArrowRight':
    case 'PageDown':
      return turn(1);
    case 'ArrowLeft':
    case 'PageUp':
      return turn(-1);
    case ' ':
      return turn(e.shiftKey ? -1 : 1);
    case 'Home':
      return jumpTo(0);
    case 'End':
      return jumpTo(total.value - 1);
    default:
      return false;
  }
}

// ---- 滚轮：先滚纸内（只有图片页会真的滚），滚到底再翻页 ----
function onWheel(e) {
  if (e.ctrlKey) return;
  if (drag) { e.preventDefault(); return; }
  // Firefox 的 deltaMode 是"行"；统一折算成像素，阈值对两家都成立
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
  // 触控板的横向两指滑动也翻页
  const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  const delta = raw * unit;
  const sc = leafRef.value?.querySelector('.bd-book__content');
  if (sc && sc.scrollHeight - sc.clientHeight > 1) {
    const down = delta > 0;
    const atEnd = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1;
    const atStart = sc.scrollTop <= 0;
    if ((down && !atEnd) || (!down && !atStart)) {
      wheelAcc = 0;
      return; // 让纸内滚动自己走完
    }
  }
  e.preventDefault();
  if (turning.value) return;
  const now = Date.now();
  if (now < wheelLockUntil) {
    wheelAcc = 0;
    return;
  }
  wheelAcc += delta;
  if (Math.abs(wheelAcc) < 36) return; // 触控板的小抖动
  const dir = wheelAcc > 0 ? 1 : -1;
  wheelAcc = 0;
  if (turn(dir)) wheelLockUntil = now + 1200;
}

// ---- 整页拖拽翻页（鼠标 / 触摸 / 笔）------------------------------------
// 按住纸往左拖 = 下一页；往右拖 = 上一页。纸跟着指针转，横向拖到纸宽 78%
// 就是 180°，松手过 30% 完成，否则回弹。纵向移动只给一点点倾斜（rotateZ），
// 让纸看起来是被手指/鼠标"抬起来"的，而不是贴着屏幕转。
const DRAG_SLOP = 7;
const DRAG_SPAN = 0.78;
// 松手完成阈值：约纸宽的 14%（623px 的纸 ≈ 87px）。
// 触摸上 100px 左右的短滑也该翻页；再低就容易被误触。
const DRAG_COMMIT = 0.18;

function removeDragListeners() {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerCancel);
}

function releaseCapture(id) {
  if (typeof id !== 'number') return; // 触摸拖拽没有 pointer capture
  try { paperRef.value?.releasePointerCapture(id); } catch { /* 已经释放 */ }
}

function startDrag(x, y, id) {
  if (turning.value || drag) return false;
  if (!hasPrev.value && !hasNext.value) return false;
  drag = { id, startX: x, startY: y, dir: 0, moved: 0, p: 0 };
  dragging.value = true;
  return true;
}

function beginForwardDrag() {
  flatOn.value = false;
  setUnder(pageAt(index.value + 1));
  applyTurn(0, 1, 0);
}

function beginBackwardDrag() {
  flatOn.value = false;
  // 上一页先在纸的背面待命（-104° 时 backface 不可见，画面不会闪）
  setUnder(pageAt(index.value));
  setLeaf(pageAt(index.value - 1), index.value);
  applyTurn(0, -1, 0);
}

// 返回 true = 这次移动已经进入拖拽（调用方可以 preventDefault）
function applyDrag(x, y) {
  if (!drag) return false;
  const dx = x - drag.startX;
  const dy = y - drag.startY;
  drag.moved = Math.max(drag.moved, Math.abs(dx), Math.abs(dy));

  if (!drag.dir) {
    if (Math.abs(dx) < DRAG_SLOP || Math.abs(dx) < Math.abs(dy)) return false;
    if (dx < 0 && hasNext.value) {
      drag.dir = 1;
      beginForwardDrag();
    } else if (dx > 0 && hasPrev.value) {
      drag.dir = -1;
      beginBackwardDrag();
    } else {
      return false;
    }
  }

  const w = paperRef.value?.clientWidth || 1;
  const p = drag.dir > 0
    ? Math.max(0, Math.min(1, -dx / (w * DRAG_SPAN)))
    : Math.max(0, Math.min(1, dx / (w * DRAG_SPAN)));
  drag.p = p;
  // 纵向拖动给纸一点点倾斜（最多 ±2.2°），像捏住纸角抬起来
  const tilt = Math.max(-2.2, Math.min(2.2, dy * 0.012));
  applyTurn(p, drag.dir, tilt);
  return true;
}

function swallowNextClick() {
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
}

function endDrag() {
  const d = drag;
  drag = null;
  dragging.value = false;
  removeDragListeners();
  if (d) releaseCapture(d.id);
  return d;
}

// 松手 / 取消：同一套收尾。取消时也按当前进度决定 —— 触摸流里常常只有
// touchend 没有 pointerup（浏览器抢手势时给的是 pointercancel），强行弹回反而坏手感。
function finishDrag() {
  const d = endDrag();
  if (!d || !d.dir) return; // 只是点了一下：交给 click（左右两侧翻页）
  swallowNextClick();
  const complete = d.p >= DRAG_COMMIT;
  turning.value = true;

  if (d.dir > 0) {
    // 下一页
    if (complete) {
      animateTurn(d.p, 1, 1, 0.5, 'power2.out', finishForward);
    } else {
      animateTurn(d.p, 0, 1, 0.26, 'power2.out', () => {
        clearUnder();
        resetLeaf();
        turning.value = false;
        flatOn.value = true;
        timeline = null;
        runQueue();
      });
    }
    return;
  }

  // 上一页
  if (complete) {
    animateTurn(d.p, 1, -1, 0.5, 'power2.out', finishBackward);
  } else {
    animateTurn(d.p, 0, -1, 0.26, 'power2.out', () => {
      clearUnder();
      setLeaf(pageAt(index.value)); // 把刚才放到纸背的上一页换回当前页
      resetLeaf();
      turning.value = false;
      flatOn.value = true;
      timeline = null;
      runQueue();
    });
  }
}

// ---- 鼠标 / 笔：pointer 事件 ----
function onPointerDown(e) {
  if (e.pointerType === 'touch') return; // 触摸统一走下面的 touch 事件
  if (e.button !== undefined && e.button !== 0) return; // 只接主键
  if (e.target?.closest?.('a, button')) return; // 链接/按钮保持原行为
  if (!startDrag(e.clientX, e.clientY, e.pointerId)) return;
  try { paperRef.value?.setPointerCapture(e.pointerId); } catch { /* 某些环境不支持 */ }
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
}

function onPointerMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  if (applyDrag(e.clientX, e.clientY)) e.preventDefault();
}

function onPointerUp(e) {
  // 触摸偶尔只有 pointerup、没有 touchend：把 pointerup 也当收尾信号
  if (drag?.id === 'touch' && e.pointerType === 'touch') { finishDrag(); return; }
  if (!drag || e.pointerId !== drag.id) return;
  finishDrag();
}

function onPointerCancel(e) {
  if (drag?.id === 'touch' && e.pointerType === 'touch') { finishDrag(); return; }
  if (!drag || e.pointerId !== drag.id) return;
  finishDrag();
}

// ---- 触摸：直接走 touch 事件 ----
// 有些浏览器/环境在触摸拖拽时只给 touchend，不给 pointerup（给 pointercancel），
// 所以触摸不依赖 pointer 流；纸跟手的感觉完全一样。
function onTouchStart(e) {
  if (e.touches.length !== 1) return;
  if (e.target?.closest?.('a, button')) return;
  const t = e.touches[0];
  if (!startDrag(t.clientX, t.clientY, 'touch')) return;
  // 收尾的兜底：有的环境只派 pointerup 不派 touchend
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
}

function onTouchMove(e) {
  if (!drag || drag.id !== 'touch') return;
  const t = e.touches[0];
  if (!t) return;
  if (applyDrag(t.clientX, t.clientY)) e.preventDefault();
}

function onTouchEnd() {
  if (!drag || drag.id !== 'touch') return;
  finishDrag();
}

function onTouchCancel() {
  if (!drag || drag.id !== 'touch') return;
  finishDrag();
}

// 点击纸页左右两侧（外侧 10%）：右边下一页、左边上一页。
// 命中链接/按钮、正在选字时不翻，避免抢走正文里的交互。
function onPaperClick(e) {
  if (suppressClick) { suppressClick = false; return; }
  if (e.target?.closest?.('a, button')) return;
  if (window.getSelection?.()?.toString()) return;
  const r = paperRef.value?.getBoundingClientRect();
  if (!r || !r.width) return;
  const x = (e.clientX - r.left) / r.width;
  if (x < 0.1) turn(-1);
  else if (x > 0.9) turn(1);
}

// ---- 按可用高度重新分页 ---------------------------------------------------
// 只切溢出页；图片/视频页不切（高度要等资源加载，硬切会把图拆散）。
const MEDIA_RE = /<(img|picture|video|iframe)\b/i;
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'FIGURE', 'PRE', 'HR',
  'SECTION', 'ARTICLE',
]);

function measureCtx() {
  const paper = paperRef.value;
  const mirror = measureRef.value;
  if (!paper || !mirror) return null;
  // 纸边是 inset 阴影，不占布局；三段纸带和 mirror 都按整整一张纸的宽高来排
  const width = paper.clientWidth;
  const maxH = paper.clientHeight;
  if (width <= 0 || maxH <= 0) return null;
  mirror.style.width = `${width}px`;
  return { mirror, maxH };
}

// 基础行高就是样式表里的 1.92；撑满时上限 24 倍（再大就成了一张纸上一行字）。
const BASE_LH = 1.92;
const MAX_LH = 24;
// 只有"内容不到纸高 72%"才算"很少"，才把行距撑开；接近满页的保持正常行距。
const FILL_RATIO = 0.72;

function heightOf(nodes, mirror) {
  // 分页判断永远用基础行高，别被上一次"撑满"留下的行高污染
  mirror.style.lineHeight = '';
  const frag = document.createDocumentFragment();
  for (const n of nodes) frag.appendChild(n.cloneNode(true));
  mirror.replaceChildren(frag);
  return mirror.scrollHeight;
}

// 内容很少时：二分找最大的行高倍数，让这一页的**行距**正好撑到纸的上下边。
// 返回 0 = 内容够多，用样式表的默认行高。
function fillLineHeight(html, ctx) {
  const { mirror, maxH } = ctx;
  mirror.style.lineHeight = '';
  mirror.innerHTML = html;
  const natural = mirror.scrollHeight;
  if (!natural || natural >= maxH * FILL_RATIO) return 0;

  let lo = BASE_LH;
  let hi = MAX_LH;
  for (let i = 0; i < 10; i += 1) {
    const mid = (lo + hi) / 2;
    mirror.style.lineHeight = String(mid);
    // 刚好等于纸高就行；再多 1px 会溢出，safe center 会改成贴顶（白丢一次居中）
    if (mirror.scrollHeight <= maxH) lo = mid;
    else hi = mid;
  }
  mirror.style.lineHeight = '';
  return lo > BASE_LH + 0.04 ? Number(lo.toFixed(2)) : 0;
}

function serialize(nodes) {
  const wrap = document.createElement('div');
  for (const n of nodes) wrap.appendChild(n.cloneNode(true));
  return wrap.innerHTML.trim();
}

// 把 <p> 按 <br> 拆成一行一行；只有"直接子节点里有 <br> 且没有块级子元素"才拆。
// 中间的空行保留（诗句的段间距），末尾那个由最后一个 <br> 带出来的空行去掉。
function splitByBr(el) {
  if (!el || el.nodeType !== 1) return null;
  const kids = Array.from(el.childNodes);
  if (!kids.some((n) => n.nodeType === 1 && n.tagName === 'BR')) return null;
  if (kids.some((n) => n.nodeType === 1 && BLOCK_TAGS.has(n.tagName))) return null;

  const lines = [];
  let line = [];
  for (const n of kids) {
    if (n.nodeType === 1 && n.tagName === 'BR') {
      lines.push(line);
      line = [];
    } else {
      line.push(n);
    }
  }
  lines.push(line);
  if (lines.length > 1 && lines[lines.length - 1].every((n) => !n.textContent.trim())) lines.pop();

  return lines.map((nodes) => {
    const clone = el.cloneNode(false);
    // 这些是**同一段诗的行**，不是新段落：行与行之间不能吃到段落外边距，
    // 否则拆完每一行都像隔了一个空行（实测：一页 6 行，行距被撑到 55px）。
    clone.classList.add('book-line');
    if (!nodes.length) {
      clone.appendChild(document.createElement('br'));
      return clone;
    }
    for (const n of nodes) clone.appendChild(n.cloneNode(true));
    return clone;
  });
}

function splitPageToFit(html, ctx) {
  const { mirror, maxH } = ctx;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const nodes = Array.from(tpl.content.childNodes);
  // 先按节点数组分页，最后再统一序列化 —— 中间要做一次"孤行回填"（见下）
  const out = [];
  let cur = [];

  const flush = () => {
    if (cur.length && serialize(cur)) out.push(cur);
    cur = [];
  };
  const tryAdd = (node) => {
    cur.push(node);
    if (heightOf(cur, mirror) <= maxH + 1) return true;
    cur.pop();
    return false;
  };

  for (const node of nodes) {
    // 纯空白文本节点跟着当前页走，不单独成页
    if (node.nodeType === 3 && !node.textContent.trim()) {
      cur.push(node);
      continue;
    }
    if (tryAdd(node)) continue;
    flush();
    if (heightOf([node], mirror) <= maxH + 1) {
      cur.push(node);
      continue;
    }
    const lines = splitByBr(node);
    if (!lines) {
      // 一整个块就超高（超长段/图/表）：让它独占一页，纸内滚动兜底
      cur.push(node);
      flush();
      continue;
    }
    for (const line of lines) {
      if (tryAdd(line)) continue;
      flush();
      cur.push(line);
      if (heightOf(cur, mirror) > maxH + 1) flush();
    }
  }
  flush();

  // 孤行回填：诗页最怕最后一页只剩一行（草稿排版里叫 widows）。
  // 只在"整页都是拆出来的行"时做，且只从上一页末尾往前搬，顺序不变；
  // 搬完还放得下就继续，直到最后一页至少 3 行或前一页只剩 3 行。
  if (out.length > 1) {
    const isLine = (n) => n.nodeType === 1 && n.classList?.contains('book-line');
    const lineish = (arr) => arr.every(isLine);
    const last = out[out.length - 1];
    const prev = out[out.length - 2];
    if (lineish(last) && lineish(prev) && last.length < 3) {
      while (last.length < 3 && prev.length > 3) {
        const candidate = [prev[prev.length - 1], ...last];
        if (heightOf(candidate, mirror) > maxH + 1) break;
        last.unshift(prev.pop());
      }
    }
  }

  return out.length ? out.map(serialize) : [html];
}

function buildDisplayPages() {
  const ctx = measureCtx();
  const fallback = props.pages.map((html) => ({ html, lh: 0 }));
  if (!ctx) return fallback;
  const out = [];
  for (const html of props.pages) {
    ctx.mirror.style.lineHeight = '';
    ctx.mirror.innerHTML = html;
    if (ctx.mirror.scrollHeight <= ctx.maxH + 1) {
      out.push(html);
      continue;
    }
    if (MEDIA_RE.test(html)) {
      out.push(html);
      continue;
    }
    out.push(...splitPageToFit(html, ctx));
  }
  const pages = out.length ? out : props.pages;
  // 每页单独算行高：短页撑满纸，长页保持默认行距
  return pages.map((html) => ({ html, lh: fillLineHeight(html, ctx) }));
}

// reset=true：换篇/首挂载，回第 0 页。
// reset=false：改窗口大小，按阅读进度比例落到新页（页数会变），别把人弹回开头。
function repaginate({ reset = false } = {}) {
  if (!props.pages.length || !paperRef.value || !measureRef.value) return;
  computeSegWidths();
  const next = buildDisplayPages();
  if (!next.length) return;
  const oldTotal = total.value;
  const oldIndex = index.value;
  kill();
  queuedDir = 0;
  turning.value = false;
  displayPages.value = next;
  if (reset) {
    index.value = 0;
  } else {
    const ratio = oldTotal > 1 ? oldIndex / (oldTotal - 1) : 0;
    index.value = Math.min(next.length - 1, Math.round(ratio * (next.length - 1)));
  }
  setLeaf(pageAt(index.value));
  clearUnder();
  nextTick(resetLeaf);
  resetScroll();
}

function scheduleRepaginate() {
  clearTimeout(repaginateTimer);
  repaginateTimer = setTimeout(() => repaginate(), 120);
}

// ---- 换篇：页数组变了一律回到第 0 页 ----
watch(() => props.pages, (pages) => {
  kill();
  queuedDir = 0;
  index.value = 0;
  displayPages.value = pages.map((html) => ({ html, lh: 0 }));
  setLeaf(pageAt(0));
  clearUnder();
  turning.value = false;
  nextTick(() => {
    resetLeaf();
    resetScroll();
    repaginate({ reset: true });
  });
}, { immediate: true });

function pageState() {
  return { index: index.value, total: total.value };
}

defineExpose({
  turn,
  jumpTo,
  handleKey,
  pageState,
  repaginate: () => repaginate(),
});

onMounted(() => {
  resetLeaf();
  computeSegWidths();
  const paper = paperRef.value;
  paper?.addEventListener('wheel', onWheel, { passive: false });
  if (paper && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(scheduleRepaginate);
    resizeObserver.observe(paper);
  }
  // 字体到位之后行高才是最终值，量出来的分页才准
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    document.fonts.ready.then(() => repaginate()).catch(() => {});
  }
  nextTick(() => repaginate({ reset: true }));
});

onBeforeUnmount(() => {
  kill();
  clearTimeout(repaginateTimer);
  resizeObserver?.disconnect();
  resizeObserver = null;
  paperRef.value?.removeEventListener('wheel', onWheel);
  if (leafRef.value) gsap.killTweensOf(leafRef.value);
});
</script>

<template>
  <div class="bd-book">
    <div
      ref="paperRef"
      class="bd-book__paper"
      :class="{ 'is-dragging': dragging }"
      @click="onPaperClick"
      @pointerdown="onPointerDown"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchCancel"
    >
      <!-- 书脊 + 纸叠：让这一页看起来是压在一本有厚度的书上，而不是一张浮在空中的卡片 -->
      <div class="bd-book__stack" aria-hidden="true">
        <i class="bd-book__spine"></i>
      </div>

      <!-- 量页高用的影子层：宽度 = 纸宽，样式和正文完全一致，藏在屏幕外 -->
      <div
        ref="measureRef"
        class="bd-book__content blog-detail-content bd-book__measure"
        aria-hidden="true"
      ></div>

      <div class="bd-book__under" aria-hidden="true">
        <div
          class="bd-book__content blog-detail-content"
          :style="underLh ? { lineHeight: underLh } : null"
          v-html="underHtml"
        ></div>
        <!-- 翻起来的纸投在下一页上的影子：跟 --flip 联动 -->
        <div class="bd-book__cast" aria-hidden="true"></div>
      </div>

      <div ref="leafRef" class="bd-book__leaf">
        <!-- 平放时的投影；纸一弯就淡出，交给下一页上的投影 -->
        <div class="bd-book__leaf-shadow" aria-hidden="true"></div>

        <!-- 3 段纸带：每段 1/3 宽，段与段之间铰接；--curl 在每个铰链上叠加 -->
        <div class="bd-book__seg bd-book__seg--0" aria-hidden="true" inert :style="segStyle(0)">
          <div class="bd-book__face bd-book__face--front">
            <div class="bd-book__clip">
              <div
                class="bd-book__content blog-detail-content bd-book__slice"
                :style="sliceStyle(0)"
                v-html="leafHtml"
              ></div>
            </div>
          </div>
          <div class="bd-book__face bd-book__face--back" aria-hidden="true"></div>

          <div class="bd-book__seg bd-book__seg--1" :style="segStyle(1)">
            <div class="bd-book__face bd-book__face--front">
              <div class="bd-book__clip">
                <div
                  class="bd-book__content blog-detail-content bd-book__slice"
                  :style="sliceStyle(1)"
                  v-html="leafHtml"
                ></div>
              </div>
            </div>
            <div class="bd-book__face bd-book__face--back" aria-hidden="true"></div>

            <div class="bd-book__seg bd-book__seg--2" :style="segStyle(2)">
              <div class="bd-book__face bd-book__face--front">
                <div class="bd-book__clip">
                  <div
                    class="bd-book__content blog-detail-content bd-book__slice"
                    :style="sliceStyle(2)"
                    v-html="leafHtml"
                  ></div>
                </div>
                <!-- 页码印在纸的最后一截上，跟着纸一起转 -->
                <div class="bd-book__stamp" aria-hidden="true">{{ pad(leafNo) }} <i>/</i> {{ pad(total) }}</div>
              </div>
              <div class="bd-book__face bd-book__face--back" aria-hidden="true"></div>
            </div>
          </div>
        </div>

        <!-- 静止时盖在纸带上的一整张平面纸：接缝只在弯折时才是折痕 -->
        <div v-show="flatOn" class="bd-book__flat">
          <div
            class="bd-book__content blog-detail-content"
            :style="leafLh ? { lineHeight: leafLh } : null"
            v-html="leafHtml"
          ></div>
          <div class="bd-book__stamp" aria-hidden="true">{{ pad(leafNo) }} <i>/</i> {{ pad(total) }}</div>
        </div>
      </div>
    </div>

    <div class="bd-book__bar">
      <button
        type="button"
        class="bd-book__btn"
        :disabled="!hasPrev"
        @click="turn(-1)"
      >← Prev</button>
      <div class="bd-book__mid">
        <div class="bd-book__progress" aria-hidden="true">
          <i :style="{ width: total ? ((index + 1) / total * 100) + '%' : '0%' }"></i>
        </div>
      </div>
      <button
        type="button"
        class="bd-book__btn"
        :disabled="!hasNext"
        @click="turn(1)"
      >Next →</button>
    </div>
  </div>
</template>

<style scoped>
.bd-book {
  /* 纸张颜色由主题变量给（main.css 的 --book-*）：
     亮色是比 #FAFAFA 面板更白的暖纸，暗色是暖黑纸；这里不再自己写死。 */
  --paper: var(--book-paper);
  --paper-deep: var(--book-paper-deep);
  --paper-line: var(--book-paper-line);
  --paper-edge: var(--book-paper-edge);
  --paper-grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E");
  /* --flip：翻页抬起量 0..1；--curl：单个铰链的弯折角度；--curl-n：同一数值的 0..1 */
  --flip: 0;
  --curl: 0deg;
  --curl-n: 0;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 书的舞台：**不裁切**。纸翻起来可以伸出这个框，落在书脊和页面之外；
   透视挂在舞台上，纸转起来才有真实的近大远小。 */
.bd-book__paper {
  position: relative;
  flex: 1;
  min-height: 0;
  perspective: 1400px;
  perspective-origin: 42% 50%;
  overflow: visible;
  cursor: grab;
  /* 纸页拖拽由 pointer 全程接管；交给浏览器做 pan-y 会中途 pointercancel */
  touch-action: none;
}
.bd-book__paper.is-dragging { cursor: grabbing; }

/* ── 书脊 + 纸叠 ─────────────────────────────────────────────────────── */
.bd-book__stack {
  position: absolute;
  inset: 5px -6px -6px 9px;
  z-index: 0;
  border: 1px solid var(--paper-line);
  background-color: var(--paper-deep);
  background-image: var(--paper-grain);
  background-size: 140px 140px;
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.22);
  pointer-events: none;
}
/* 右侧 / 底部的书口：一层层纸边 */
.bd-book__stack::before,
.bd-book__stack::after {
  content: '';
  position: absolute;
  opacity: 0.65;
}
.bd-book__stack::before {
  top: 0;
  right: -1px;
  bottom: 0;
  width: 7px;
  background: repeating-linear-gradient(
    to bottom,
    var(--paper-edge) 0 1px,
    transparent 1px 3px
  );
}
.bd-book__stack::after {
  left: 0;
  right: 0;
  bottom: -1px;
  height: 7px;
  background: repeating-linear-gradient(
    to right,
    var(--paper-edge) 0 1px,
    transparent 1px 3px
  );
}
.bd-book__spine {
  position: absolute;
  left: -18px;
  top: -8px;
  bottom: -8px;
  width: 18px;
  border: 1px solid var(--paper-line);
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--bg) 70%, #000 30%),
    color-mix(in srgb, var(--bg) 88%, #000 12%) 42%,
    color-mix(in srgb, var(--bg) 74%, #000 26%)
  );
  box-shadow:
    inset 1px 0 0 rgba(255, 255, 255, 0.07),
    0 8px 18px rgba(0, 0, 0, 0.18);
}

/* ── 下面那张纸（平放）──────────────────────────────────────────────── */
.bd-book__under {
  position: absolute;
  inset: 0;
  z-index: 1;
  background-color: var(--paper);
  background-image: var(--paper-grain);
  background-size: 140px 140px;
  /* 纸边用 inset 阴影，不占布局：这样三段的正文宽度和整页完全一致 */
  box-shadow:
    inset 1px 0 0 var(--paper-line),
    inset -1px 0 0 var(--paper-line),
    inset 0 1px 0 var(--paper-line),
    inset 0 -1px 0 var(--paper-line);
}

/* ── 当前页：3 段纸带 ────────────────────────────────────────────────── */
/* 外层只负责整体绕书脊转；纸面、边框、弯折都在 seg/face 上 */
.bd-book__leaf {
  position: absolute;
  inset: 0;
  z-index: 4;
  transform-origin: left center;
  transform-style: preserve-3d;
  will-change: transform;
}

/* 平放时的投影；一开始弯折就淡出，改由下一页上的投影表达深度 */
.bd-book__leaf-shadow {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: calc(1 - var(--curl-n));
  box-shadow:
    0 calc(2px + var(--flip) * 16px) calc(10px + var(--flip) * 44px)
      rgba(0, 0, 0, calc(0.16 + var(--flip) * 0.34)),
    0 1px 2px rgba(0, 0, 0, 0.18);
}

/* 静止时的整张平面纸：盖住三段纸带的接缝；开始翻页时由 JS 收起 */
.bd-book__flat {
  position: absolute;
  inset: 0;
  z-index: 5;
  background-color: var(--paper);
  background-image: var(--paper-grain);
  background-size: 140px 140px;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  pointer-events: none;
  box-shadow:
    inset 1px 0 0 var(--paper-line),
    inset -1px 0 0 var(--paper-line),
    inset 0 1px 0 var(--paper-line),
    inset 0 -1px 0 var(--paper-line);
}
.bd-book__flat :deep(a) { pointer-events: auto; }
.bd-book__flat::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 18px;
  z-index: 2;
  pointer-events: none;
  background: linear-gradient(90deg, rgba(0, 0, 0, 0.12), transparent);
}

/* 每段 = 1/3 页宽；第 2、3 段沿左边缘铰接，叠加 --curl 就是一条弯折的纸 */
.bd-book__seg {
  position: absolute;
  top: 0;
  height: 100%;
  width: 100%; /* 第 2/3 段各自占满上一段（= 1/3 页宽） */
  z-index: 1;
  transform-style: preserve-3d;
}
.bd-book__leaf > .bd-book__seg--0 {
  width: calc(100% / 3);
}
.bd-book__seg--1,
.bd-book__seg--2 {
  left: 100%;
  transform-origin: left center;
  transform: rotateY(var(--curl, 0deg));
}

/* 每段的正反两面：正面放正文切片，背面是空白纸 */
.bd-book__face {
  position: absolute;
  inset: 0;
  background-color: var(--paper);
  background-image: var(--paper-grain);
  background-size: 140px 140px;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  box-shadow:
    inset 0 1px 0 var(--paper-line),
    inset 0 -1px 0 var(--paper-line),
    /* 1px 纸色叠在左边，盖住相邻两段之间的合成接缝（翻动时才看得见） */
    -1px 0 0 0 var(--paper);
}
.bd-book__face--front { z-index: 1; }
.bd-book__face--back {
  transform: rotateY(180deg) translateZ(1px);
  background-color: color-mix(in srgb, var(--paper) 97%, #000 3%);
}
/* 整页的左右外边只长在第一段的左边、第三段的右边 */
.bd-book__seg--0 .bd-book__face {
  box-shadow:
    inset 0 1px 0 var(--paper-line),
    inset 0 -1px 0 var(--paper-line),
    inset 1px 0 0 var(--paper-line),
    -1px 0 0 0 var(--paper);
}
.bd-book__seg--2 .bd-book__face {
  box-shadow:
    inset 0 1px 0 var(--paper-line),
    inset 0 -1px 0 var(--paper-line),
    inset -1px 0 0 var(--paper-line),
    -1px 0 0 0 var(--paper);
}

/* 书脊压暗：第一段的左缘（背面看会镜像到右边，正好还是书脊） */
.bd-book__seg--0 .bd-book__face::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 18px;
  z-index: 2;
  pointer-events: none;
  background: linear-gradient(90deg, rgba(0, 0, 0, 0.12), transparent);
}
/* 折痕：第 2、3 段的左缘；弯得越厉害越明显 */
.bd-book__seg--1 .bd-book__face--front::after,
.bd-book__seg--2 .bd-book__face--front::after {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 9px;
  z-index: 2;
  pointer-events: none;
  opacity: calc(var(--curl-n) * 0.9);
  /* 1px 高光 + 2px 暗线：窄的折痕，不会读成一条接缝 */
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.1) 0 1px,
    rgba(0, 0, 0, 0.2) 1px 3px,
    transparent 9px
  );
}

/* 每段只露出整页的那一条：里面的正文是完整的同一页 */
.bd-book__clip {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.bd-book__slice {
  top: 0;
  right: auto;
  bottom: auto;
  height: 100%;
  overflow: hidden;
}

/* 翻起来的纸投在下一页上的影子（跟着 --flip 浓淡） */
.bd-book__cast {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  opacity: calc(var(--flip) * 0.62);
  background: linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.86),
    rgba(0, 0, 0, 0.38) 32%,
    rgba(0, 0, 0, 0) 82%
  );
}

/* 正文：行高按"读诗"来（1.92），段落之间留一口气。
   高度随窗口收放；分页会按这个最终版式量，所以不会出现纸内偷偷裁字。 */
.bd-book__content {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: clamp(22px, 3.2vh, 34px) clamp(26px, 2.6vw, 36px) clamp(30px, 4.4vh, 48px);
  scrollbar-width: none;
  -ms-overflow-style: none;
  line-height: 1.92;
  /* 整页都是可拖拽的纸：关掉选字，拖拽时才不会变成拖选文本 */
  user-select: none;
  -webkit-user-select: none;
  /* 整页文字**水平居中**：诗句/正文都不靠左，短行落在纸的中线上。 */
  text-align: center;
  /* 整页文字在纸的**竖直方向居中**：只剩一行时也是落在纸的中间，
     而不是贴着上沿。内容超高时 safe center 会退回顶端（不会把第一行藏到纸外）。 */
  display: flex;
  flex-direction: column;
  justify-content: center;
  justify-content: safe center;
}
.bd-book__content::-webkit-scrollbar { display: none; }
/* 底下那张只是翻页途中露出来，不参与滚动 */
.bd-book__under .bd-book__content { overflow: hidden; }

.bd-book__content :deep(p) {
  margin-bottom: 1.15em;
  text-wrap: pretty;
}
/* 按 <br> 拆出来的"同一段诗的行"：只保留行高，不另起段落间距 */
.bd-book__content :deep(p.book-line) {
  margin-bottom: 0;
}
.bd-book__content :deep(> *:last-child) {
  margin-bottom: 0;
}
.bd-book__content :deep(.page-break) { display: none; }

/* 影子层：和正文同一套字体/内边距，只负责量高度（放在屏幕外，不参与可见布局） */
.bd-book__measure {
  position: absolute;
  inset: auto;
  left: -9999px;
  top: 0;
  height: auto;
  overflow: visible;
  box-sizing: border-box;
  visibility: hidden;
  pointer-events: none;
}

.bd-book__stamp {
  position: absolute;
  right: 14px;
  bottom: 10px;
  z-index: 6;
  font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
  font-size: 0.55rem;
  letter-spacing: 0.12em;
  color: var(--text-secondary);
  pointer-events: none;
  user-select: none;
}
.bd-book__stamp i { font-style: normal; opacity: 0.45; margin: 0 2px; }

.bd-book__bar {
  position: relative;
  z-index: 10; /* 翻起来的纸可以盖住标题，但别盖住 Prev/Next */
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 14px;
}

.bd-book__mid {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.bd-book__btn {
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid var(--text-primary);
  border-radius: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
  font-size: 0.58rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background-color 0.18s ease, color 0.18s ease, opacity 0.18s ease;
}
.bd-book__btn:hover:not(:disabled) { background: var(--text-primary); color: var(--bg); }
.bd-book__btn:disabled { opacity: 0.35; cursor: not-allowed; }

.bd-book__progress {
  position: relative;
  flex: 1;
  min-width: 40px;
  height: 1px;
  /* 亮色主题下 --border 太淡，整条进度轨几乎看不见；用文字色兑一点出来 */
  background: color-mix(in srgb, var(--text-primary) 18%, transparent);
}
.bd-book__progress i {
  position: absolute;
  left: 0;
  top: 0;
  height: 1px;
  background: var(--text-primary);
  transition: width 0.45s cubic-bezier(0.19, 1, 0.22, 1);
}

@media (hover: none) {
  .bd-book__btn { min-height: 44px; }
}

@media (prefers-reduced-motion: reduce) {
  .bd-book__progress i { transition: none; }
  .bd-book__leaf { will-change: auto; }
}
</style>
