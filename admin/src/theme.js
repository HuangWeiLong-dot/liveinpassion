// CMS 主题：与前台一致，默认深色，记住上一次选择。
// 首帧的类由 index.html 的内联脚本提前写到 <html> 上，这里只负责读状态和切换。
import { ref } from 'vue';

const STORAGE_KEY = 'cms-theme';

export const isDark = ref(document.documentElement.classList.contains('dark'));

export function toggleTheme() {
  isDark.value = !isDark.value;
  document.documentElement.classList.toggle('dark', isDark.value);
  try {
    localStorage.setItem(STORAGE_KEY, isDark.value ? 'dark' : 'light');
  } catch {
    /* 隐私模式下忽略 */
  }
}
