// Delete protection for the CMS.
//
// Every destructive action in the admin first opens one shared dialog and waits
// for a Promise<boolean>. The dialog asks for the author's birthday
// (2007-05-25) as the password. This is an accidental-deletion guard, not an
// authentication boundary — the Worker API still requires the admin session.
import { reactive } from 'vue';

export const deleteGuardState = reactive({
  open: false,
  target: '',
  value: '',
  error: '',
});

let pending = null;

function isCorrect(value) {
  const t = String(value || '').trim().toLowerCase();
  if (!t) return false;
  // May 25, 2007 / 25 May 2007
  if (/may/.test(t) && /25/.test(t) && /2007/.test(t)) return true;
  // 2007-05-25 / 2007-5-25 / 2007/05/25 / 2007.05.25
  const ymd = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymd && ymd[1] === '2007' && Number(ymd[2]) === 5 && Number(ymd[3]) === 25) return true;
  // 05/25/2007 / 25/05/2007
  const mdy = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (mdy && mdy[3] === '2007'
    && ((Number(mdy[1]) === 5 && Number(mdy[2]) === 25)
      || (Number(mdy[1]) === 25 && Number(mdy[2]) === 5))) return true;
  // 20070525 / 05252007 / 25052007 / 2007525
  const digits = t.replace(/\D+/g, '');
  return ['20070525', '05252007', '25052007', '2007525'].includes(digits);
}

export function askDeleteGuard(target = '') {
  // A second request replaces the first one; the old action must not proceed.
  if (pending) {
    const previous = pending;
    pending = null;
    previous(false);
  }
  deleteGuardState.open = true;
  deleteGuardState.target = String(target || '');
  deleteGuardState.value = '';
  deleteGuardState.error = '';
  return new Promise((resolve) => {
    pending = resolve;
  });
}

export function submitDeleteGuard() {
  if (!isCorrect(deleteGuardState.value)) {
    deleteGuardState.error = 'Incorrect password. Nothing was deleted.';
    return;
  }
  closeGuard(true);
}

export function cancelDeleteGuard() {
  closeGuard(false);
}

function closeGuard(result) {
  const resolve = pending;
  pending = null;
  deleteGuardState.open = false;
  deleteGuardState.value = '';
  deleteGuardState.error = '';
  resolve?.(result);
}
