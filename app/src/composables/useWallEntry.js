// 窗户墙的首屏入场（GALLERY / MY GALLERY 共用）。
//
// 参照 wndws.space：
//   1. 正中间先亮起一扇有照片的窗；
//   2. 周围的窗按离它的距离依次淡入；
//   3. 整面墙从放大态拉回 1:1，完成"从一扇窗到整面墙"。
//
// 这不是"首次加载"专属：两个页面都在 keep-alive 里，每次 onActivated
// 调 reset() → prime() → play()，所以每次点导航进来都会重播。
import gsap from 'gsap';

const reduceMotion = () => (
  window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

function entryOpacity(el) {
  if (el.classList.contains('win-gap')) return 0;
  if (el.classList.contains('win--empty')) return 0.45;
  return el.classList.contains('is-muted') ? 0.45 : 1;
}

function slotEls(wall) {
  return [...wall.querySelectorAll('[data-slot]')];
}

export function createWallEntry() {
  let primed = false;
  let done = false;
  let items = [];
  let maxDist = 1;

  function reset(wall) {
    if (wall) {
      gsap.killTweensOf(wall);
      gsap.set(wall, { clearProps: 'transform,transformOrigin' });
      for (const el of slotEls(wall)) {
        gsap.killTweensOf(el);
        el.style.opacity = '';
      }
      wall.closest('.win-page')?.classList.remove('is-entering');
    }
    primed = false;
    done = false;
    items = [];
    maxDist = 1;
  }

  /** 摆好"一扇窗在屏幕正中"的初始态；返回是否成功。 */
  function prime(wall) {
    if (primed || done || !wall) return false;
    if (reduceMotion()) { done = true; return false; }

    const children = slotEls(wall);
    if (!children.length) return false;

    const wr = wall.getBoundingClientRect();
    const wcx = wr.left + wr.width / 2;
    const wcy = wr.top + wr.height / 2;

    // 选离墙面中心最近的一扇有照片的窗；当前筛选下可见的优先，
    // 然后是已加载的，最后才比距离。
    let centerEl = null;
    let best = { active: false, loaded: false, d: Infinity };
    for (const el of children) {
      if (!el.classList.contains('win--filled')) continue;
      const r = el.getBoundingClientRect();
      const d = Math.hypot(r.left + r.width / 2 - wcx, r.top + r.height / 2 - wcy);
      const active = !el.classList.contains('is-muted');
      const loaded = !!el.querySelector('.win__img.is-loaded');
      const better = (active && !best.active)
        || (active === best.active && loaded && !best.loaded)
        || (active === best.active && loaded === best.loaded && d < best.d);
      if (better) {
        best = { active, loaded, d };
        centerEl = el;
      }
    }
    if (!centerEl) { done = true; return false; }

    const cr = centerEl.getBoundingClientRect();
    const cx = cr.left - wr.left + cr.width / 2;
    const cy = cr.top - wr.top + cr.height / 2;
    const originX = wr.left + cx;
    const originY = wr.top + cy;

    items = children
      .filter((el) => el !== centerEl)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          el,
          d: Math.hypot(
            r.left + r.width / 2 - originX,
            r.top + r.height / 2 - originY
          ),
        };
      });
    maxDist = Math.max(1, ...items.map((it) => it.d));

    // 一扇窗在屏幕上大约 300px 宽时开始
    const scale = Math.min(5, Math.max(2.8, 300 / Math.max(1, centerEl.offsetWidth)));
    // 用 clientWidth/clientHeight 而不是 innerWidth/innerHeight：
    // Windows 上滚动条占的宽度也算在 innerWidth 里，直接除以 2 会偏半个滚动条。
    const viewW = document.documentElement.clientWidth || window.innerWidth;
    const viewH = document.documentElement.clientHeight || window.innerHeight;
    const dx = viewW / 2 - originX;
    const dy = viewH / 2 - originY;

    gsap.set(wall, { transformOrigin: `${cx}px ${cy}px`, x: dx, y: dy, scale });
    for (const el of children) {
      el.style.opacity = el === centerEl ? String(entryOpacity(el)) : '0';
    }
    wall.closest('.win-page')?.classList.add('is-entering');
    primed = true;
    return true;
  }

  /** 周围窗户浮现 + 镜头拉回整面墙。 */
  function play(wall) {
    if (!primed || done || !wall) return;
    done = true;
    const children = slotEls(wall);

    for (const { el, d } of items) {
      gsap.to(el, {
        opacity: entryOpacity(el),
        duration: 0.45,
        delay: 0.05 + (d / maxDist) * 0.55,
        ease: 'power2.out',
      });
    }

    gsap.to(wall, {
      x: 0,
      y: 0,
      scale: 1,
      duration: 1.5,
      ease: 'power3.inOut',
      delay: 0.55,
      onComplete() {
        // 不要用 clearProps 把 transform 整条抹掉：清属性的那一帧会触发一次
        // 重新合成/重排，画面会"咯噔"一下。停在 identity 上，等下次入场 reset 再清。
        gsap.set(wall, { x: 0, y: 0, scale: 1 });
        for (const el of children) el.style.opacity = '';
        wall.closest('.win-page')?.classList.remove('is-entering');
      },
    });
  }

  return { prime, play, reset };
}
