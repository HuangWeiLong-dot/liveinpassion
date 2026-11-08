// 品牌遮罩 / 页面转场共用的一组问题。
//
// 首次进站之后（或刷新过场、页面转场）会随机抽一句显示，连续两次不重复。
// 抽到的下标存在 localStorage；这里只负责文案，不关心显示位置。
export const BRAND_QUESTIONS = [
  'WHO ARE YOU?',
  'WHERE DO YOU BELONG?',
  'WHERE ARE YOU?',
  'WHO DO YOU LOVE?',
  'WHAT KIND OF LOVE DO YOU NEED?',
  'WHAT DO YOU WANT TO DO?',
  'WHAT DO YOU WANT?',
  'WHAT IS LOVE?',
  'WHAT IS BELONGING?',
  'WHAT IS BEING SEEN?',
  'WHAT IS BEING WANTED?',
];

const LAST_KEY = 'lip:last-question';

/** 随机抽一句；连续两次不重复 */
export function pickBrandQuestion() {
  let last = -1;
  try {
    last = Number(localStorage.getItem(LAST_KEY));
  } catch { /* ignore */ }
  let i = Math.floor(Math.random() * BRAND_QUESTIONS.length);
  if (BRAND_QUESTIONS.length > 1 && i === last) {
    i = (i + 1) % BRAND_QUESTIONS.length;
  }
  try {
    localStorage.setItem(LAST_KEY, String(i));
  } catch { /* ignore */ }
  return BRAND_QUESTIONS[i];
}
