// Textos de ajuda por idioma. t('chave', { n: 2 }) troca {n} no texto; chave sem texto volta a própria chave.
import ptBR from '../i18n/pt-BR.js';

const locales = { 'pt-BR': ptBR };
let messages = ptBR;

export function registerLocale(id, dictionary) {
  locales[id] = dictionary;
}

export function setLocale(id) {
  if (!locales[id]) throw new Error(`Idioma desconhecido: ${id}`);
  messages = locales[id];
}

export function t(key, params = {}) {
  const text = messages[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name) => String(params[name] ?? m));
}
