// 方块光标（components/BlockCursor.vue）的共享状态。
//
// 光标本体是全局的、只有一份，但"指针这会儿压在一个可交互物上"这件事有两个来源：
//   ① 自动判定 —— 全局组件按选择器认（链接、按钮、卡片的类名…），覆盖整站；
//   ② 手动举旗 —— 有些东西没有可认的语义（首页那个主体就是一张铺满的 <div>），
//      只能由它自己的 pointerenter/leave 来举手。这里就是那条旗。
//
// 两条**各记各的**，由组件取或。不要合成一个变量：全局那条每帧都在写，
// 一旦共用，指针还压在主体上、只是从人格卡旁边划过时，就有一帧会被自动判定
// 写回 false —— 方块在那一下会缩回去。
import { ref } from 'vue';

/** 有人举着旗吗。**必须是 ref**：光标的类名是模板绑上去的，
 *  光清掉内部那个 Set、不推一次状态，界面会一直停在放大态（踩过）。 */
export const blockCursorHot = ref(false);

// ⚠ 旗子上记的是**元素本身**，不是布尔。踩过的坑：
//   指针停在人格卡上时点了它 → 换页 → 那张卡连同整个首页被 keep-alive 摘出文档，
//   而**元素被移除时浏览器不会补一次 pointerleave** —— 于是 leave 那条永远不会到，
//   旗一直举着，方块从那一刻起在**每一页**都停在放大态（实测：换到 /me 之后
//   指针底下是 .me-name 也照样是放大的）。
//   所以这里由组件每帧自检（readBlockCursorHot）：元素不在文档里、或者指针已经
//   不在它身上了（:hover 是浏览器自己维护的，元素一摘掉就为 false），就自动回收。
//   另外 HeroConcept 在 onDeactivated 里会主动 clear 一次，换页那一刻就收干净。
const claimants = new Set();

/** 复核一遍：把失效的旗收掉，把结果写进 ref。返回当前值。 */
function sync() {
  let hot = false;
  for (const el of claimants) {
    if (!el.isConnected) {
      claimants.delete(el); // 已经不在文档里了（换页、列表重渲…）
      continue;
    }
    if (el.matches(':hover')) hot = true;
    else claimants.delete(el); // 指针已经挪开了，leave 没到也没关系
  }
  blockCursorHot.value = hot;
  return hot;
}

/** 举旗 / 放旗。el 必须是那个 DOM 元素（pointerenter 的 event.currentTarget）。
 *
 *  举的时候**不复核**：pointerenter 那一刻浏览器的 hover 链刚更新，
 *  但没必要在这里赌它 —— 直接置上，下一帧 sync() 自己会把这笔账算清。 */
export function setBlockCursorHot(el, on) {
  if (!el || typeof el.matches !== 'function') return;
  if (on) {
    claimants.add(el);
    blockCursorHot.value = true;
  } else {
    claimants.delete(el);
    sync();
  }
}

/** 全部放下（换页、指针离开文档、窗口失焦时用）。立刻推状态，别等下一帧。 */
export function clearBlockCursorHot() {
  claimants.clear();
  blockCursorHot.value = false;
}

/** 每帧问一次（顺手回收失效的旗）。 */
export function readBlockCursorHot() {
  return sync();
}
