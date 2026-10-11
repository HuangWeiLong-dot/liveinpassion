// 边缘滑出：左下角作者区 / 右下那一竖列悬浮按钮，平时收到屏幕外，
// 指针靠到那个角上才滑进来。
//
// 为什么要 JS，而不是一条纯 CSS 的 :hover —— 控件藏在屏幕外之后，
// 屏幕上就没有任何东西可以 hover 了，得先留一块"热区"。热区拿真元素去做的话，
// 那一条上的点击会被它吃掉（右下角那块正好压在页面内容上），
// 所以这里改成监听指针、往 <html> 上挂类，滑出的位移留在 styles/main.css。
//
// 热区只用坐标算，不去问控件 :hover。一开始写的是"贴边召唤 + 停在控件上保持"，
// 但那有个竞态：指针往左走、控件从右边滑过来，两者是迎面走的 —— 指针走得快时
// 会先越过控件当前的位置，那一刻 :hover 还不成立、贴边也不成立，热区就误判成
// "走开了"，控件当场缩回去。几何热区把控件自己的地盘也算进去，没有这一下。
//
// 触屏不参与：`(hover: hover)` 不成立时连 `is-edge-hover` 都不加，控件保持常显 ——
// 否则手机上它们永远藏在屏幕外，既看不到也点不到。
import { onBeforeUnmount, onMounted } from 'vue';

// 离左右边缘多近算"在找它"。这个数由控件自己占的宽度定：
// 桌面端最靠里的是主题按钮那列（right 32 + 宽 56 = 88px），留一点余量取 100。
// 800 / 480 两个断点下控件和边距都更小，同一个数照样盖得住。
const CORNER = 100;

// 只在底边这一带生效。最高的控件是背景开关（bottom 168 + 56 = 224），
// 往上留点余量；不封顶的话指针随便划到右边缘都会惊动它们。
const BAND = 280;

export function useEdgeReveal() {
  const root = document.documentElement;
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)');

  let frame = 0;
  // -1 表示指针不在窗口里（还没动过，或者刚移出去）
  let x = -1;
  let y = -1;
  // 这次访问里有没有真的摸过屏幕（下面 sync / onTouchStart 用）
  let sawTouch = false;

  function apply() {
    frame = 0;
    const nearBottom = y >= window.innerHeight - BAND;
    root.classList.toggle('is-edge-left', nearBottom && x <= CORNER);
    root.classList.toggle('is-edge-right', nearBottom && x >= window.innerWidth - CORNER);
  }

  // 一帧里可能来好几个 mousemove，合并成一个 rAF
  function schedule() {
    if (!frame) frame = requestAnimationFrame(apply);
  }

  function onMove(event) {
    x = event.clientX;
    y = event.clientY;
    schedule();
  }

  // 指针离开窗口后 mousemove 就不再来了，得自己把状态收回去
  function onLeave() {
    x = -1;
    y = -1;
    schedule();
  }

  function sync() {
    // 触摸屏笔记本这类混合设备：指针媒体查询看的是"主指针"，笔记本上它是 fine，
    // 于是控件一开始就收起来了；可用户真拿手指去点屏幕时又够不到它们。
    // 所以这次访问只要出现过真实触摸，就整趟不再收（触摸之后浏览器还会补一串
    // 合成的 mousemove，靠它判断"又用回鼠标了"会被那一串骗到，索性不判断）。
    // 合成事件不会触发 touchstart 之外的东西，所以这里只认 touchstart。
    root.classList.toggle('is-edge-hover', canHover.matches && !sawTouch);
    if (!canHover.matches || sawTouch) {
      root.classList.remove('is-edge-left', 'is-edge-right');
      return;
    }
    apply();
  }

  function onTouchStart() {
    sawTouch = true;
    sync();
  }

  // 同步执行一次，不能等到 onMounted：这个类必须在控件第一次绘制之前就挂上，
  // 否则它们会先在正常位置露一下再滑出去 —— 那会儿正好是开场遮罩揭开的时刻。
  // （挂的是 <html> 上的类，元素这会儿还没渲染，所以不会有过渡跑起来。）
  sync();

  onMounted(() => {
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeave);
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    canHover.addEventListener('change', sync);
  });

  onBeforeUnmount(() => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseleave', onLeave);
    document.removeEventListener('touchstart', onTouchStart);
    canHover.removeEventListener('change', sync);
    if (frame) cancelAnimationFrame(frame);
  });
}
