import { bus } from './events.js';

// Configurações gerais do aplicativo (por navegador/dispositivo).
const STORAGE_KEY = 'projectdrawn.settings';
const LEGACY_STORAGE_KEY = 'codedrawn.settings';

const DEFAULTS = {
  trashRetentionDays: 30,
  fileSyncMinutes: 5,
  // Desfoque (px de tela) do que fica atrás de pastas, scripts e sub-áreas; 0 = desligado.
  areaBlur: 6,
};

let values = { ...DEFAULTS };

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY) ?? '{}');
    values = { ...DEFAULTS, ...saved };
  } catch {
    values = { ...DEFAULTS };
  }
  return values;
}

export function settings() {
  return values;
}

export function updateSettings(patch) {
  values = { ...values, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch {
    // Sem armazenamento local: vale só para esta sessão.
  }
  bus.emit('settings:changed', values);
}
