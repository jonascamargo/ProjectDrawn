// Todo texto visível passa por t(). Chaves aninhadas com ponto: t('history.undo').
let dictionary = {};
let currentLocale = 'pt-BR';

export async function loadLocale(locale = 'pt-BR') {
  const response = await fetch(`i18n/${locale}.json`);
  if (!response.ok) throw new Error(`i18n: ${locale} (${response.status})`);
  dictionary = await response.json();
  currentLocale = locale;
}

export function locale() {
  return currentLocale;
}

export function t(key, params) {
  const value = key.split('.').reduce((node, part) => node?.[part], dictionary);
  if (typeof value !== 'string') return key;
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

// Aplica traduções a elementos com data-i18n (texto) e data-i18n-title (tooltip).
export function translateDom(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
}
