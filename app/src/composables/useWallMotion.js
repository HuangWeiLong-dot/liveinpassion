// 窗户墙的 GSAP 动效。
//
//   playWallIntro        —— 首次进入页面：窗格从上下左右四个方向滑进来，逐一浮现
//   staggerWallReveal    —— 滑到目标格之后，按目标位置错开淡入新内容
//   fadeWallImages       —— 切月份前先把旧照片淡出，避免一刀切
//
// 窗口之间的华容道滑动在 useWallPuzzle.js（靠真正的空格 .win-gap 算），
// 这里负责入场和内容切换的动效。
import gsap from 'gsap';

const DIRS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

function dirFor(i) {
  return DIRS[i % DIRS.length];
}

export function playWallIntro(root, { emptyOpacity = 0.45 } = {}) {
  if (!root) return;
  const wins = [...root.querySelectorAll('.win')];
  if (!wins.length) return;
  gsap.killTweensOf(wins);

  gsap.fromTo(
    wins,
    {
      opacity: 0,
      x: (i) => dirFor(i).x * 72,
      y: (i) => dirFor(i).y * 72,
      scale: 0.92,
    },
    {
      opacity: (i, el) => (el.classList.contains('is-muted') ? emptyOpacity : 1),
      x: 0,
      y: 0,
      scale: 1,
      duration: 0.68,
      ease: 'power3.out',
      stagger: { each: 0.018, from: 'start' },
      clearProps: 'transform',
      onComplete() {
        for (const el of wins) {
          el.style.opacity = el.classList.contains('is-muted') ? String(emptyOpacity) : '1';
        }
      },
    }
  );
}

// ── 内容切换的交接动画 ─────────────────────────────────────────────────
// 华容道滑完之后不能整面墙「啪」一下换掉：按每扇窗**落点**在墙上的位置
// 从左到右、从上到下排个序，让新内容依次淡入。
const REVEAL_STEP = 10; // 每扇窗之间的间隔（ms）

/**
 * 给即将显示内容的窗户排好淡入延迟。
 * 延迟会一直留在图片上：缩略图是异步加载的，哪张先到就哪张先淡入，
 * 但整体仍然按落点的行列顺序铺开。只延迟 opacity，hover 的滤镜不受影响。
 * @param {HTMLElement} root 墙
 * @param {(el: HTMLElement) => boolean} isVisible 切换后是否要显示
 */
export function staggerWallReveal(root, isVisible = () => true) {
  if (!root) return;
  const ordered = [...root.querySelectorAll('.win--filled')]
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

  ordered.forEach(({ el }, i) => {
    const img = el.querySelector('.win__img');
    if (!img) return;
    const delay = isVisible(el) ? i * REVEAL_STEP : 0;
    // .win__img 的 transition 是 opacity, filter —— 只给 opacity 加延迟
    img.style.transitionDelay = `${delay}ms, 0ms`;
  });
}

/** 换内容之前让旧照片淡出（默认 220ms），淡完再换。 */
export function fadeWallImages(root, duration = 220) {
  if (!root) return Promise.resolve();
  const imgs = [...root.querySelectorAll('.win__img')];
  for (const img of imgs) {
    // 只改 transition 的三个长属性：不能碰 transition-delay，
    // 那是 staggerWallReveal 给新内容排好的顺序。
    img.style.transitionProperty = 'opacity';
    img.style.transitionDuration = `${duration}ms`;
    img.style.transitionTimingFunction = 'ease';
    img.style.opacity = '0';
  }
  return new Promise((resolve) => setTimeout(resolve, duration));
}

/** 撤掉 fadeWallImages 写下的内联样式，让 class 重新决定显示。 */
export function restoreWallImages(root) {
  if (!root) return;
  for (const img of root.querySelectorAll('.win__img')) {
    img.style.transitionProperty = '';
    img.style.transitionDuration = '';
    img.style.transitionTimingFunction = '';
    img.style.opacity = '';
  }
}
