// 背景拼贴（首页那层散着的封面墙）开不开。
//
// 原来是 HeroConcept 里的一个局部 ref。手机上要把这个开关也收进汉堡菜单，
// 而汉堡在另一个组件里 —— 所以提到 composable 里做一个模块级单例：
// 两边读到的必须是同一个 ref，否则汉堡里按一下、首页那层不会跟着变。
//
// 记在 localStorage 里：这是"我不想看到它"的偏好，每次刷新都自己回来会很烦。
// 键名跟主题那个 themeState 一个风格。
import { ref, watch } from 'vue';

const WALL_KEY = 'wallHidden';
const wallHidden = ref(false);

try {
  wallHidden.value = localStorage.getItem(WALL_KEY) === '1';
} catch {
  // 隐私模式下 localStorage 会抛，忽略：那就是不记忆，不影响功能
}

watch(wallHidden, (v) => {
  try {
    localStorage.setItem(WALL_KEY, v ? '1' : '0');
  } catch {}
});

/** @returns {{ wallHidden: import('vue').Ref<boolean> }} */
export function useWallPref() {
  return { wallHidden };
}
