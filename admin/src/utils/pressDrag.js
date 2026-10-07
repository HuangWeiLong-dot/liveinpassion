// 「按住拖动」手势：把鼠标拖拽和触摸长按拖拽收敛成一条路径。
//
// 起因：排序原先用 HTML5 拖放（draggable + dragstart/dragover/drop），触屏设备
// 完全不触发这些事件，手机上等于没有排序。pointer 事件两端都发，所以统一改用它。
//
// 差异只在"什么时候算开始拖"：
//   · 鼠标 —— 按下即拖（和一按就走的老手感一致）
//   · 触摸 —— 按住 300ms 才起拖；此前手指移开 10px 就放弃，把手势还给页面滚动
//
// 起拖后挂一个非被动的 touchmove 并 preventDefault()，否则拖到一半页面会跟着滚。
// 注意 touch-action 是手势开始时求值的，中途改没用，所以必须走这条 preventDefault。

const LONG_PRESS_MS = 300;
const MOVE_TOLERANCE = 10;

/**
 * @param {PointerEvent} event   pointerdown 事件
 * @param {object} handlers
 * @param {() => void}        handlers.onEngage        正式进入拖拽（此时加高亮、置状态）
 * @param {(x:number, y:number) => void} handlers.onMove 拖拽中，参数为指针坐标
 * @param {() => void}        handlers.onDrop          松手并落地
 * @param {() => void}        [handlers.onCancel]      手势被放弃（未起拖就移开/被系统打断）
 */
export function startPressDrag(event, { onEngage, onMove, onDrop, onCancel }) {
  const startX = event.clientX;
  const startY = event.clientY;
  let engaged = false;
  let timer = null;

  function cleanup() {
    if (timer) clearTimeout(timer);
    timer = null;
    document.removeEventListener('pointermove', handleMove);
    document.removeEventListener('pointerup', handleUp);
    document.removeEventListener('pointercancel', handleCancel);
    document.removeEventListener('touchmove', handleTouchMove);
  }

  function engage() {
    timer = null;
    engaged = true;
    onEngage();
  }

  function handleMove(e) {
    if (!engaged) {
      // 还没起拖就先挪开了：这是在滚动页面，不是要排序
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_TOLERANCE) abandon();
      return;
    }
    e.preventDefault();
    onMove(e.clientX, e.clientY);
  }

  function handleTouchMove(e) {
    if (engaged) e.preventDefault();
  }

  function handleUp() {
    const wasEngaged = engaged;
    cleanup();
    wasEngaged ? onDrop() : onCancel?.();
  }

  function abandon() {
    cleanup();
    onCancel?.();
  }
  function handleCancel() {
    abandon();
  }

  document.addEventListener('pointermove', handleMove);
  document.addEventListener('pointerup', handleUp);
  document.addEventListener('pointercancel', handleCancel);
  document.addEventListener('touchmove', handleTouchMove, { passive: false });

  if (event.pointerType === 'mouse') engage();
  else timer = setTimeout(engage, LONG_PRESS_MS);
}
