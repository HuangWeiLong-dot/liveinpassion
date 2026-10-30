// 竖向滚轮在横向排布的元素上滚成横向移动（底部胶卷条用）。
// 触控板的横滑本来就是 deltaX，鼠标滚轮给的是 deltaY，两种都收。
// 元素到边之后不再拦事件，免得页面明明还能上下滚却被一条底栏吃掉滚轮。
export function scrollHorizontallyOnWheel(event) {
  const row = event.currentTarget;
  if (!row) return;
  const max = row.scrollWidth - row.clientWidth;
  if (max <= 0) return;

  const deltaX = event.deltaX;
  const deltaY = event.deltaY;
  const raw = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  // deltaMode: 0 像素 / 1 行 / 2 页
  const unit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? row.clientWidth : 1;
  const delta = raw * unit;

  const atStart = row.scrollLeft <= 0 && delta < 0;
  const atEnd = row.scrollLeft >= max - 1 && delta > 0;
  if (atStart || atEnd) return;

  event.preventDefault();
  row.scrollLeft += delta;
}
