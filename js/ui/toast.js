// Notificações não bloqueantes. Substituem alert/console para o usuário.
const DEFAULT_DURATION = { info: 3000, success: 2500, warning: 4500, error: 6000 };

let root = null;

export function initToasts(element) {
  root = element;
}

export function toast(message, { type = 'info', duration } = {}) {
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  el.addEventListener('click', () => dismiss(el));
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast--visible'));

  const time = duration ?? DEFAULT_DURATION[type] ?? DEFAULT_DURATION.info;
  if (time > 0) setTimeout(() => dismiss(el), time);
  return () => dismiss(el);
}

function dismiss(el) {
  if (!el.isConnected || el.classList.contains('toast--leaving')) return;
  el.classList.add('toast--leaving');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 400);
}

toast.info = (message, options) => toast(message, { ...options, type: 'info' });
toast.success = (message, options) => toast(message, { ...options, type: 'success' });
toast.warning = (message, options) => toast(message, { ...options, type: 'warning' });
toast.error = (message, options) => toast(message, { ...options, type: 'error' });
