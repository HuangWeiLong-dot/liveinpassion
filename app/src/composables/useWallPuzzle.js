// 窗户墙的「华容道」移动。
//
// 墙上大部分是窗户和普通空窗格（.win--empty），另外从空槽里挑了几个
// **完全不可见的洞**（.win-gap：没有窗框、没有占位符、什么都不画）。
// 只有这些洞算「空位」：一次一格，相邻的窗滑进洞里，洞移动到它原来的格子
// —— 和 15-puzzle 一样。普通空窗格只是墙的底色，和照片窗一样会被推着走。
//
// 位置用 CSS translate（--wall-tx/--wall-ty）记录，DOM 不重建。
// 每次移动前都从元素的**视觉位置**反推「哪个格子被谁占着」，
// 所以连续切换筛选/月份也不会把洞算到错误的地方。
import gsap from 'gsap';

const GAP_CLASS = 'win-gap';
const MOVE_MS = 340;
// 同一个墙上的移动排队执行：连点筛选时，后一轮从上一轮的终点继续算。
const queues = new WeakMap();
// 重置（窗口尺寸变了）时递增，让排队/进行中的轮次自己退出。
const generations = new WeakMap();

function readTranslate(el) {
  return {
    x: Number.parseFloat(el.style.getPropertyValue('--wall-tx')) || 0,
    y: Number.parseFloat(el.style.getPropertyValue('--wall-ty')) || 0,
  };
}

function writeTranslate(el, x, y) {
  el.style.setProperty('--wall-tx', `${x}px`);
  el.style.setProperty('--wall-ty', `${y}px`);
}

function gridColumns(root) {
  const tracks = getComputedStyle(root).gridTemplateColumns;
  return Math.max(1, tracks.split(' ').filter(Boolean).length);
}

/** 按视觉位置找格子：平移量总是「整格 + 间距」，容差 1.5px 足够。 */
function slotAt(cells, left, top) {
  for (const [slot, cell] of cells) {
    if (Math.abs(cell.left - left) < 1.5 && Math.abs(cell.top - top) < 1.5) return slot;
  }
  return null;
}

/**
 * 量出两套坐标：
 *   cells —— 每个槽位的**基准格子**（键是 DOM 顺序，量的是 offsetLeft/Top，
 *            不受 translate / hover 的 transform 影响）
 *   tiles —— 当前每个窗口**视觉上**占着的槽位（键是格子，值是元素）
 * 两者的差就是「窗户被华容道挪到了哪里」。
 */
function measure(root) {
  const els = [...root.querySelectorAll('[data-slot]')];
  if (!els.length) return null;
  const parent = els[0].offsetParent;
  const parentRect = parent ? parent.getBoundingClientRect() : root.getBoundingClientRect();
  const ox = parentRect.left;
  const oy = parentRect.top;

  const cells = new Map();
  for (const el of els) {
    const slot = Number(el.dataset.slot);
    const t = readTranslate(el);
    cells.set(slot, {
      left: ox + el.offsetLeft,
      top: oy + el.offsetTop,
      width: el.offsetWidth,
      height: el.offsetHeight,
      tx: t.x,
      ty: t.y,
    });
  }

  // 只有 .win-gap 是洞；照片窗和普通空窗格（.win--empty）都算可以滑的窗。
  const tiles = new Map();
  for (const el of els) {
    if (el.classList.contains(GAP_CLASS)) continue;
    const slot = Number(el.dataset.slot);
    const cell = cells.get(slot);
    if (!cell) continue;
    const visualSlot = slotAt(cells, cell.left + cell.tx, cell.top + cell.ty);
    if (visualSlot != null) tiles.set(visualSlot, el);
  }

  const cols = gridColumns(root);
  const gaps = [];
  for (const slot of cells.keys()) if (!tiles.has(slot)) gaps.push(slot);
  return { cells, tiles, gaps, cols };
}

function neighbors(slot, cols, cells) {
  const out = [];
  if (slot % cols !== 0) out.push(slot - 1);
  if ((slot + 1) % cols !== 0) out.push(slot + 1);
  if (cells.has(slot - cols)) out.push(slot - cols);
  if (cells.has(slot + cols)) out.push(slot + cols);
  return out;
}

/** 把窗口滑到目标格子；translate 的过渡交给 CSS。 */
function moveTile(el, toSlot, cells) {
  const domSlot = Number(el.dataset.slot);
  const fromCell = cells.get(domSlot);
  const toCell = cells.get(toSlot);
  if (!fromCell || !toCell) return Promise.resolve();
  writeTranslate(el, toCell.left - fromCell.left, toCell.top - fromCell.top);
  return new Promise((resolve) => setTimeout(resolve, MOVE_MS));
}

function shuffleArray(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 从空格出发做 rounds 轮相邻滑动。
 * 每一轮里，每个空格都挑一个还没被别的空格选走的相邻窗口放进去；
 * 一轮里的移动互不影响，可以同时滑。
 * @param {HTMLElement} root 墙
 * @param {number} rounds 轮数（每轮每个空格走一格）
 */
async function runShuffle(root, rounds) {
  const generation = generations.get(root) || 0;
  for (let r = 0; r < rounds; r += 1) {
    if ((generations.get(root) || 0) !== generation) return;
    const state = measure(root);
    if (!state || !state.gaps.length) return;
    const { cells, tiles, cols } = state;
    const usedTiles = new Set();
    const moves = [];

    for (const gap of shuffleArray(state.gaps)) {
      const movable = neighbors(gap, cols, cells).filter(
        (slot) => tiles.has(slot) && !usedTiles.has(slot)
      );
      if (!movable.length) continue;
      // 优先推照片窗：空窗格推来推去几乎看不见，华容道就没了动势。
      const photos = movable.filter((slot) =>
        tiles.get(slot).classList.contains('win--filled')
      );
      const pool = photos.length ? photos : movable;
      const from = pool[Math.floor(Math.random() * pool.length)];
      usedTiles.add(from);
      moves.push({ el: tiles.get(from), to: gap });
    }

    if (!moves.length) return;
    await Promise.all(moves.map(({ el, to }) => moveTile(el, to, cells)));
  }
}

export function shuffleWall(root, rounds = 2) {
  if (!root) return Promise.resolve();
  const prev = queues.get(root) || Promise.resolve();
  const next = prev.then(() => runShuffle(root, rounds)).catch(() => {});
  queues.set(root, next);
  return next;
}

/**
 * 窗口尺寸变化后把所有的位移清掉，让每扇窗回到自己的槽位。
 * 位移是按 px 算的，换了列数之后旧位移不再落在格子上；
 * 与其带着错位继续滑，不如原地重排。
 */
export function resetWall(root) {
  if (!root) return;
  generations.set(root, (generations.get(root) || 0) + 1);
  for (const el of root.querySelectorAll('[data-slot]')) {
    if (el.style.getPropertyValue('--wall-tx')) el.style.removeProperty('--wall-tx');
    if (el.style.getPropertyValue('--wall-ty')) el.style.removeProperty('--wall-ty');
  }
}
