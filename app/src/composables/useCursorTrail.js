// 鼠标拖迹（参照 oumahi.art 首页的 nav-cursor-canvas）。
//
// 画法：
//   · 指针位置不是硬跟，而是每帧朝目标缓动 35%，拖迹本身因此带一点"甩"；
//   · 沿这条缓动后的路径，每走 6px 记一个点，整条折线最多保留 1500px；
//   · 每条线段按它在路径上的位置渐隐（头 50% 不透明度 → 尾 0）；
//   · 只画自由曲线。早先照参考站做了个"直角折线"模式（隔 30px 记点、中间补横竖拐点，
//     每 9 秒切一次），拐角太生硬，已去掉。
//
// 只负责画：canvas 是 fixed、pointer-events:none，z-index 由调用方控制。
// 启用/停用由外面（首页的精确指针判定 + reduced-motion）来叫，
// 这里不做媒体查询，免得两套判定打架。
export function createCursorTrail(canvas, { getInk = () => '0, 0, 0', length = 1500, width = 2.5 } = {}) {
  const DPR_CAP = 2;
  const EASE = 0.35;
  const GAP = 6;

  const ctx = canvas?.getContext('2d') || null;

  let dpr = 1;
  let w = 0;
  let h = 0;
  let points = [];
  let lastRecorded = null;
  let targetX = -1;
  let targetY = -1;
  let followX = -1;
  let followY = -1;
  let hasPointer = false;
  let raf = 0;
  let started = false;

  function resize() {
    if (!canvas || !ctx) return;
    dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 旧点是按旧视口记的，缩放窗口后继续连会拉出一条大斜线
    points = [];
    lastRecorded = null;
  }

  /** 沿当前缓动位置记一个点。 */
  function recordPoint() {
    if (!lastRecorded) {
      lastRecorded = { x: followX, y: followY };
      points.push({ x: followX, y: followY });
      return;
    }
    const dx = followX - lastRecorded.x;
    const dy = followY - lastRecorded.y;
    const dist = Math.hypot(dx, dy);
    if (dist < GAP) return;

    points.push({ x: followX, y: followY });
    lastRecorded = { x: followX, y: followY };

    // 超长就从尾部砍掉整段（保留长度是从末端往前数的）
    let total = 0;
    for (let i = points.length - 1; i > 0; i--) {
      const a = points[i];
      const b = points[i - 1];
      total += Math.hypot(a.x - b.x, a.y - b.y);
      if (total > length) {
        points = points.slice(i);
        break;
      }
    }
  }

  function drawTrail() {
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (!hasPointer || points.length < 2) return;

    const ink = getInk();
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let cumulative = 0;
    for (let i = points.length - 1; i > 0; i--) {
      const a = points[i];
      const b = points[i - 1];
      const segLen = Math.hypot(a.x - b.x, a.y - b.y);
      const startFrac = cumulative / length;
      cumulative += segLen;
      const endFrac = Math.min(cumulative / length, 1);
      const alpha = (1 - (startFrac + endFrac) / 2) * 0.5;
      if (alpha <= 0) continue;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = `rgba(${ink}, ${alpha.toFixed(3)})`;
      ctx.stroke();

      if (cumulative > length) break;
    }
  }

  function schedule() {
    if (!started || raf) return;
    raf = requestAnimationFrame(frame);
  }

  function frame() {
    raf = 0;
    if (!started) return;

    let moving = false;
    if (hasPointer) {
      const dx = targetX - followX;
      const dy = targetY - followY;
      moving = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
      followX += dx * EASE;
      followY += dy * EASE;
      recordPoint();
    }
    drawTrail();
    // 追到位就停帧：画面已经静止，继续空转只会白烧 CPU
    if (moving) schedule();
  }

  function onMove(event) {
    if (!started) return;
    if (!hasPointer) {
      // 从窗口外进来：起点直接落在指针上，不要从 (-1,-1) 拉一条斜线
      followX = event.clientX;
      followY = event.clientY;
      points = [];
      lastRecorded = null;
      hasPointer = true;
    }
    targetX = event.clientX;
    targetY = event.clientY;
    schedule();
  }

  function onLeave() {
    hasPointer = false;
    points = [];
    lastRecorded = null;
    if (ctx) ctx.clearRect(0, 0, w, h);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function onEnter(event) {
    if (!started) return;
    followX = event.clientX;
    followY = event.clientY;
    targetX = event.clientX;
    targetY = event.clientY;
    points = [];
    lastRecorded = null;
    hasPointer = true;
  }

  function onVisibility() {
    if (document.hidden) onLeave();
  }

  function redraw() {
    drawTrail();
  }

  function start() {
    if (!canvas || !ctx || started) return;
    started = true;
    resize();
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('pointerenter', onEnter);
    window.addEventListener('blur', onLeave);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
  }

  function stop() {
    if (!started) return;
    started = false;
    onLeave();
    window.removeEventListener('pointermove', onMove);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('pointerenter', onEnter);
    window.removeEventListener('blur', onLeave);
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibility);
  }

  return { start, stop, redraw, resize };
}
