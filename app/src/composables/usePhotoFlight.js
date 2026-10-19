// 照片详情的"窗口飞行"过渡（参照 wndws.space）。
//
// 打开：点击的窗口照片从它在墙上的矩形飞到灯箱大图的矩形；
// 关闭：再从大图飞回原来那一格。飞行本体是一个 fixed 的临时 img，
// 灯箱自己的图在飞行期间先藏起来，落位后再淡入。
import gsap from 'gsap';

export function rectOf(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** 灯箱大图的落点：在 90vw × 90vh 里按照片比例居中。 */
export function photoTargetRect(aspect, maxW = 0.9, maxH = 0.9) {
  const a = aspect > 0 ? aspect : 1;
  const W = window.innerWidth * maxW;
  const H = window.innerHeight * maxH;
  let w = W;
  let h = w / a;
  if (h > H) {
    h = H;
    w = h * a;
  }
  return {
    left: (window.innerWidth - w) / 2,
    top: (window.innerHeight - h) / 2,
    width: w,
    height: h,
  };
}

/**
 * @param {{ left:number, top:number, width:number, height:number }} from
 * @param {{ left:number, top:number, width:number, height:number }} to
 * @param {string} src
 * @param {{ duration?:number, ease?:string, onDone?:()=>void }} opts
 */
export function flyPhoto({
  from,
  to,
  src,
  duration = 0.68,
  ease = 'power3.inOut',
  fromGray = false,
  toGray = false,
  onDone,
}) {
  if (!from || !to) {
    onDone?.();
    return;
  }

  const box = document.createElement('div');
  box.className = 'photo-flight';
  Object.assign(box.style, {
    position: 'fixed',
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    overflow: 'hidden',
    // 灯箱 1002 / ME 灯箱 10000；光标 100000、转场板 90000
    zIndex: '20000',
    pointerEvents: 'none',
    background: '#0a0a0a',
    boxShadow: '0 0 0 1px rgba(128, 128, 128, 0.35)',
  });

  const img = document.createElement('img');
  img.src = src || '';
  img.alt = '';
  Object.assign(img.style, {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  });
  box.appendChild(img);
  document.body.appendChild(box);

  // 窗户是灰的、灯箱是彩色的：飞行过程里顺带做一次渐变，别硬切
  if (fromGray || toGray) {
    const tone = { g: fromGray ? 1 : 0 };
    img.style.filter = `grayscale(${tone.g})`;
    gsap.to(tone, {
      g: toGray ? 1 : 0,
      duration,
      ease,
      onUpdate() { img.style.filter = `grayscale(${tone.g})`; },
    });
  }

  const state = { ...from };
  gsap.to(state, {
    left: to.left,
    top: to.top,
    width: to.width,
    height: to.height,
    duration,
    ease,
    onUpdate() {
      box.style.left = `${state.left}px`;
      box.style.top = `${state.top}px`;
      box.style.width = `${state.width}px`;
      box.style.height = `${state.height}px`;
    },
    onComplete() {
      // 先让目标图在克隆还没撤掉时切到可见，再移除克隆 ——
      // 反过来会有一帧"克隆没了、目标图还在 0 透明度"的空白，看起来就是闪一下。
      onDone?.();
      box.remove();
    },
  });
}
