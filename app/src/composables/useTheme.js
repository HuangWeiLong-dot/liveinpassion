// 主题状态。真正的首帧应用在 index.html 的 <head> 内联脚本里完成（避免闪白），
// 这里只负责读写同一个 localStorage 键，并让组件从 <html> 上读当前状态——
// 单一事实来源是 documentElement 的 class，不是这个 ref，也不是 localStorage。
import { ref } from 'vue';

const THEME_KEY = 'themeState';

const isDark = ref(typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));

export function useTheme() {
  function toggle() {
    isDark.value = !isDark.value;
    document.documentElement.classList.toggle('dark', isDark.value);
    try {
      // 与旧版保持完全相同的存储格式
      localStorage.setItem(THEME_KEY, JSON.stringify({ isDark: isDark.value }));
    } catch (e) {
      // 隐私模式下 localStorage 会抛错；旧版没有兜底，这里不让它中断交互
    }
  }

  return { isDark, toggle };
}
