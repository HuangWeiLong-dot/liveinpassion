// 迁移前这段逻辑在 DOMContentLoaded 里：从 HUMBLE / GENUINE / BRAVE 里随机挑一个，
// 同时写进导航栏的 ME 链接、ME 页标题与副标题——**三处必须用同一个词**。
// 所以放在模块作用域：整个页面加载只挑一次，任何组件 import 到的都是同一个值。
import { ref } from 'vue';

const VIRTUES = ['HUMBLE', 'GENUINE', 'BRAVE'];

const virtue = ref(VIRTUES[Math.floor(Math.random() * VIRTUES.length)]);

export function useVirtue() {
  return { virtue };
}
