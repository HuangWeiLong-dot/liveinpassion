<script setup>
// 多页正文的阅读器：一张纸 + 快速的横向换页 + 前后按钮 + 键盘 / 滚轮 / 拖动。
//
// 视觉上让步给全站的黑白编辑风：
//   · 纸就是 var(--bg) 这一层，靠 1px 边框、书脊、纸叠和很淡的投影区分；
//   · 不做 3D 卷页、不做弯折、不做 180° 物理翻转 —— 左右两页像两张卡一样
//     在阅读框里横向滑过，0.28s 结束；
//   · 拖动时纸跟手横移，松手过阈值就完成，否则回弹。
//
// 分页分两层：
//   ① CMS 的 <div class="page-break"> 是**语义页**（诗节 / 章节），由父组件切好传进来；
//   ② 这里按阅读框的**实际可用高度**再切一次 —— 窗口矮的时候一页语义页装不下，
//      以前会在一张看不见滚动条的纸里被裁掉（1280×720 实测最长那页少了 257px）。
//      切点只落在 <br> 行和块级元素之间，每一张纸都完整可读。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { gsap } from 'gsap';

const props = defineProps({
  pages: { type: Array, default: () => [] },
});

const paperRef = ref(null);
const leafRef = ref(null);
const underRef = ref(null);
const measureRef = ref(null);

const index = ref(0);
// 真正渲染的页：[{ html, lh }] —— html 是这一页的正文，lh 是按纸高算出来的行高倍数
// （0 = 用样式表默认值）。props.pages 只是语义页，见 repaginate。
const displayPages = ref([]);
const leafHtml = ref('');
const leafLh = ref(0);
const underHtml = ref('');
const underLh = ref(0);
const turning = ref(false);

const total = computed(() => displayPages.value.length);
const hasPrev = computed(() => index.value > 0);
const hasNext = computed(() => index.value < total.value - 1);

const reduced = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// UI 换页速度：一眼就翻过去，不演物理纸。
const SLIDE_MS = 0.28;
const DRAG_SLOP = 7;
const DRAG_SPAN = 0.7;   // 横向拖过 70% 框宽 = 一整页
const DRAG_COMMIT = 0.2; // 松手过 20% 完成，否则回弹

let timeline = null;
let drag = null;
let suppressClick = false;
let repaginateTimer = 0;
let resizeObserver = null;
let wheelAcc = 0;
let wheelLockUntil = 0;
// 连按方向键/快速滑动时，只记一步待翻方向：动画结束立刻接上。
let queuedDir = 0;
const dragging = ref(false);

function pad(n) {
  return String(n).padStart(2, '0');
}

function pageAt(i) {
  return displayPages.value[i] || { html: '', lh: 0 };
}

function setLeaf(page) {
  leafHtml.value = page?.html || '';
  leafLh.value = page?.lh || 0;
}

function setUnder(page) {
  underHtml.value = page?.html || '';
  underLh.value = page?.lh || 0;
}

function clearUnder() {
  underHtml.value = '';
  underLh.value = 0;
}

// p = 0：当前页；p = 1：下一页已经完整落进来（或上一页已经完整翻回来）。
// 两张纸并排横向滑动，阅读框负责裁切。
function applySlide(p, dir) {
  const t = Math.max(0, Math.min(1, p));
  const leaf = leafRef.value;
  const under = underRef.value;
  if (!leaf || !under) return;
  if (dir > 0) {
    gsap.set(leaf, { xPercent: -t * 100 });
    gsap.set(under, { xPercent: (1 - t) * 100 });
  } else {
    gsap.set(leaf, { xPercent: -(1 - t) * 100 });
    gsap.set(under, { xPercent: t * 100 });
  }
}

function animateSlide(from, to, dir, duration, ease, done) {
  if (!leafRef.value || !underRef.value || reduced) {
    applySlide(to, dir);
    done?.();
    return;
  }
  const state = { p: from };
  timeline = gsap.timeline({
    onComplete: () => {
      applySlide(to, dir);
      done?.();
    },
  });
  timeline.to(state, {
    p: to,
    duration,
    ease,
    onUpdate: () => applySlide(state.p, dir),
  });
}

function resetSheets() {
  if (leafRef.value) gsap.set(leafRef.value, { xPercent: 0 });
  if (underRef.value) gsap.set(underRef.value, { xPercent: 0 });
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
  resetSheets();
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
  resetSheets();
  resetScroll();
  turning.value = false;
  timeline = null;
  runQueue();
}

function finishBackward() {
  index.value = Math.max(0, index.value - 1);
  setLeaf(pageAt(index.value));
  clearUnder();
  resetSheets();
  resetScroll();
  turning.value = false;
  timeline = null;
  runQueue();
}

function turnForward() {
  if (!hasNext.value) return;
  turning.value = true;
  setUnder(pageAt(index.value + 1));
  if (!leafRef.value || !underRef.value || reduced) {
    finishForward();
    return;
  }
  applySlide(0, 1);
  animateSlide(0, 1, 1, SLIDE_MS, 'power2.out', finishForward);
}

function turnBackward() {
  if (!hasPrev.value) return;
  turning.value = true;
  // 上一页先在左侧待命，当前页垫在框里
  setUnder(pageAt(index.value));
  setLeaf(pageAt(index.value - 1));
  if (!leafRef.value || !underRef.value || reduced) {
    finishBackward();
    return;
  }
  applySlide(0, -1);
  animateSlide(0, 1, -1, SLIDE_MS, 'power2.out', finishBackward);
}

// 返回 true = 这次输入被翻页吃掉了（包括"正在翻，先吞掉"），
// 返回 false = 到头了，交给父组件决定要不要换上一篇 / 下一篇。
function turn(dir) {
  if (drag) return true;
  if (turning.value) {
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

// HOME / END：直接落位，不演滑动。
function jumpTo(target) {
  if (turning.value) return true;
  const i = Math.max(0, Math.min(total.value - 1, target));
  if (i === index.value) return false;
  index.value = i;
  setLeaf(pageAt(i));
  clearUnder();
  resetSheets();
  resetScroll();
  return true;
}

function isTextTarget(t) {
  if (!t || t.nodeType !== 1) return false;
  if (t.isContentEditable) return true;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '');
}

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
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
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
  if (turn(dir)) wheelLockUntil = now + 420;
}

// ---- 横向拖拽换页（鼠标 / 触摸 / 笔）------------------------------------
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
  setUnder(pageAt(index.value + 1));
  applySlide(0, 1);
}

function beginBackwardDrag() {
  // 上一页在左侧待命，当前页留在框里
  setUnder(pageAt(index.value));
  setLeaf(pageAt(index.value - 1));
  applySlide(0, -1);
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
  applySlide(p, drag.dir);
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

// 松手 / 取消：触摸流里常常只有 touchend 没有 pointerup，统一在这里收尾。
function finishDrag() {
  const d = endDrag();
  if (!d || !d.dir) return; // 只是点了一下：交给 click（左右两侧翻页）
  swallowNextClick();
  const complete = d.p >= DRAG_COMMIT;
  turning.value = true;

  if (d.dir > 0) {
    if (complete) {
      animateSlide(d.p, 1, 1, 0.22, 'power2.out', finishForward);
    } else {
      animateSlide(d.p, 0, 1, 0.18, 'power2.out', () => {
        clearUnder();
        resetSheets();
        turning.value = false;
        timeline = null;
        runQueue();
      });
    }
    return;
  }

  if (complete) {
    animateSlide(d.p, 1, -1, 0.22, 'power2.out', finishBackward);
  } else {
    animateSlide(d.p, 0, -1, 0.18, 'power2.out', () => {
      clearUnder();
      setLeaf(pageAt(index.value)); // 把左侧待命的上一页换回当前页
      resetSheets();
      turning.value = false;
      timeline = null;
      runQueue();
    });
  }
}

// ---- 鼠标 / 笔：pointer 事件 ----
function onPointerDown(e) {
  if (e.pointerType === 'touch') return; // 触摸统一走下面的 touch 事件
  if (e.button !== undefined && e.button !== 0) return;
  if (e.target?.closest?.('a, button')) return;
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
function onTouchStart(e) {
  if (e.touches.length !== 1) return;
  if (e.target?.closest?.('a, button')) return;
  const t = e.touches[0];
  if (!startDrag(t.clientX, t.clientY, 'touch')) return;
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
  const width = paper.clientWidth;
  const maxH = paper.clientHeight;
  if (width <= 0 || maxH <= 0) return null;
  mirror.style.width = `${width}px`;
  return { mirror, maxH };
}

const BASE_LH = 1.92;
const MAX_LH = 24;
const FILL_RATIO = 0.72;

function heightOf(nodes, mirror) {
  mirror.style.lineHeight = '';
  const frag = document.createDocumentFragment();
  for (const n of nodes) frag.appendChild(n.cloneNode(true));
  mirror.replaceChildren(frag);
  return mirror.scrollHeight;
}

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

  // 孤行回填：最后一页只剩一行时，从上一页末尾搬几行过来。
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
  return pages.map((html) => ({ html, lh: fillLineHeight(html, ctx) }));
}

// reset=true：换篇/首挂载，回第 0 页。
// reset=false：改窗口大小，按阅读进度比例落到新页（页数会变），别把人弹回开头。
function repaginate({ reset = false } = {}) {
  if (!props.pages.length || !paperRef.value || !measureRef.value) return;
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
  nextTick(resetSheets);
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
    resetSheets();
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
  resetSheets();
  const paper = paperRef.value;
  paper?.addEventListener('wheel', onWheel, { passive: false });
  if (paper && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(scheduleRepaginate);
    resizeObserver.observe(paper);
  }
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
  if (underRef.value) gsap.killTweensOf(underRef.value);
});
</script>

<template>
  <div class="bd-book">
    <div class="bd-book__stage">
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
        <!-- 量页高用的影子层：宽度 = 阅读框宽度，样式和正文完全一致 -->
        <div
          ref="measureRef"
          class="bd-book__content blog-detail-content bd-book__measure"
          aria-hidden="true"
        ></div>

        <!-- 换页时从另一侧滑进来的那张纸 -->
        <div ref="underRef" class="bd-book__under" aria-hidden="true">
          <div
            class="bd-book__content blog-detail-content"
            :style="underLh ? { lineHeight: underLh } : null"
            v-html="underHtml"
          ></div>
        </div>

        <!-- 当前页 -->
        <div ref="leafRef" class="bd-book__leaf">
          <div
            class="bd-book__content blog-detail-content"
            :style="leafLh ? { lineHeight: leafLh } : null"
            v-html="leafHtml"
          ></div>
        </div>

        <!-- 页码是阅读器的 UI，不跟着纸滑 -->
        <div class="bd-book__stamp" aria-hidden="true">{{ pad(index + 1) }} <i>/</i> {{ pad(total) }}</div>
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
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 阅读框：裁切横向滑动的两张纸 */
.bd-book__stage {
  position: relative;
  flex: 1;
  min-height: 0;
}

/* 阅读框：极简到只剩一条 1px 边框，没有阴影、书脊、纸叠 */
.bd-book__paper {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--bg);
  cursor: grab;
  touch-action: none;
}
.bd-book__paper.is-dragging { cursor: grabbing; }

/* 两张纸并排横移；阅读框裁切。没有 3D、没有背面。 */
.bd-book__under,
.bd-book__leaf {
  position: absolute;
  inset: 0;
  background: var(--bg);
  will-change: transform;
}
.bd-book__under { z-index: 1; }
.bd-book__leaf { z-index: 2; }

/* 正文：行高按阅读版式，短页撑满；水平/垂直居中 */
.bd-book__content {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: clamp(22px, 3.2vh, 34px) clamp(26px, 2.6vw, 36px) clamp(30px, 4.4vh, 48px);
  scrollbar-width: none;
  -ms-overflow-style: none;
  line-height: 1.92;
  user-select: none;
  -webkit-user-select: none;
  text-align: center;
  display: flex;
  flex-direction: column;
  justify-content: center;
  justify-content: safe center;
}
.bd-book__content::-webkit-scrollbar { display: none; }
.bd-book__under .bd-book__content { overflow: hidden; }

.bd-book__content :deep(p) {
  margin-bottom: 1.15em;
  text-wrap: pretty;
}
.bd-book__content :deep(p.book-line) {
  margin-bottom: 0;
}
.bd-book__content :deep(> *:last-child) {
  margin-bottom: 0;
}
.bd-book__content :deep(.page-break) { display: none; }

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
  z-index: 5;
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
  z-index: 10;
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
  background: color-mix(in srgb, var(--text-primary) 18%, transparent);
}
.bd-book__progress i {
  position: absolute;
  left: 0;
  top: 0;
  height: 1px;
  background: var(--text-primary);
  transition: width 0.3s cubic-bezier(0.19, 1, 0.22, 1);
}

@media (hover: none) {
  .bd-book__btn { min-height: 44px; }
}

@media (prefers-reduced-motion: reduce) {
  .bd-book__progress i { transition: none; }
  .bd-book__under,
  .bd-book__leaf { will-change: auto; }
}
</style>
