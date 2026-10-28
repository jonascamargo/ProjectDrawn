import { bus } from '../core/events.js';

// O tema (JSON) é a fonte única de aparência:
// - tokens  → variáveis CSS (--grupo-nome) para a interface HTML
// - canvas, pinTypes, wires, nodeTemplates → lidos pelo renderizador do canvas

let current = null;

// Tema escolhido nas configurações do app: 'system' segue o claro/escuro do sistema.
export function themeIdFor(setting) {
  if (setting && setting !== 'system') return setting;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'default';
}

export async function themeIndex() {
  try {
    const response = await fetch('themes/index.json');
    return response.ok ? await response.json() : [{ id: 'default', name: 'default' }];
  } catch {
    return [{ id: 'default', name: 'default' }];
  }
}

export async function loadTheme(id = 'default') {
  const response = await fetch(`themes/${id}/theme.json`);
  if (!response.ok) throw new Error(`theme: ${id} (${response.status})`);
  applyTheme(await response.json());
  return current;
}

export function applyTheme(theme) {
  const style = document.documentElement.style;
  if (current) {
    for (const name of Object.keys(flattenTokens(current.tokens))) style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(flattenTokens(theme.tokens))) style.setProperty(name, value);
  current = theme;
  document.body.classList.add('theme-ready');
  bus.emit('theme:changed', theme);
}

export function theme() {
  return current;
}

function flattenTokens(tokens = {}, prefix = '-') {
  const out = {};
  for (const [key, value] of Object.entries(tokens)) {
    const name = `${prefix}-${key}`;
    if (value && typeof value === 'object') Object.assign(out, flattenTokens(value, name));
    else out[name] = String(value);
  }
  return out;
}
