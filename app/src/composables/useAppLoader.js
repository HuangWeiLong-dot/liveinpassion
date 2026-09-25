// 首屏加载遮罩。迁移前的行为（DOMContentLoaded 里）：
//   - 2500ms 兜底隐藏
//   - window 的 load 事件也会隐藏（谁先到算谁）
//   - 隐藏时加 .hidden，等 transitionend 之后才移除 body 的 no-scroll
// 关键点：**只在首次加载出现一次**，路由切换不再显示。所以状态放模块作用域。
//
// 与旧版的一处**有意差异**：新站首屏很轻，实测 102ms 就会触发 load，
// 遮罩一闪而过像闪屏；旧站因为首屏重，实际显示约 1.5-2.5 秒。
// 因此加了一个 1000ms 下限：显示时长 = max(1000ms, min(load, 2500ms))。
import { ref } from 'vue';

const MIN_VISIBLE_MS = 1000;
const MAX_VISIBLE_MS = 2500;

const isHidden = ref(false);
let started = false;
let shownAt = 0;

export function useAppLoader() {
  function hide() {
    if (isHidden.value) return;
    isHidden.value = true;
    // 移除 no-scroll 交给 CSS 过渡结束；过渡事件不触发时（例如标签页不可见）也要兜底
    const body = document.body;
    const clear = () => body.classList.remove('no-scroll');
    body.addEventListener('transitionend', clear, { once: true });
    setTimeout(clear, 1200);
  }

  // 页面已经就绪，但不要早于下限隐藏
  function hideRespectingFloor() {
    const remaining = MIN_VISIBLE_MS - (performance.now() - shownAt);
    if (remaining > 0) setTimeout(hide, remaining);
    else hide();
  }

  function start() {
    if (started) return;
    started = true;
    shownAt = performance.now();
    // 开发环境/热更新/强缓存下，load 可能早于组件挂载就已经触发过了
    if (document.readyState === 'complete') {
      hideRespectingFloor();
      return;
    }
    setTimeout(hide, MAX_VISIBLE_MS);
    window.addEventListener('load', hideRespectingFloor, { once: true });
  }

  return { isHidden, start, hide };
}
