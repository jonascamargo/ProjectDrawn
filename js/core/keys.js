// Leitura dos atalhos (js/config/shortcuts.js) contra eventos de teclado e mouse.
const BUTTONS = { left: 0, middle: 1, right: 2 };

export function buttonCode(name) {
  return BUTTONS[name];
}

export function modifierHeld(name, e) {
  if (name === 'Ctrl') return !!(e.ctrlKey || e.metaKey);
  if (name === 'Shift') return !!e.shiftKey;
  if (name === 'Alt') return !!e.altKey;
  return false;
}

// A tecla do evento, sem olhar modificadores ('Space' casa com e.code, 'F' com e.key ou com o código
// KeyF, que não muda com Alt: no Mac, Alt+H dá outro caractere em e.key).
export function isKey(key, e) {
  return e.code === key || (key.length === 1 && e.code === `Key${key.toUpperCase()}`) || e.key?.toLowerCase() === key.toLowerCase();
}

export function parseCombo(combo) {
  const parts = combo.split('+');
  const key = parts.pop();
  return { key, ctrl: parts.includes('Ctrl'), shift: parts.includes('Shift'), alt: parts.includes('Alt') };
}

export function matchCombo(combo, e) {
  const c = parseCombo(combo);
  return isKey(c.key, e) && c.ctrl === modifierHeld('Ctrl', e) && c.shift === !!e.shiftKey && c.alt === !!e.altKey;
}

// Nome da ação de teclado que o evento dispara, ou null.
export function keyAction(keys, e) {
  return Object.keys(keys).find((action) => keys[action].combos.some((combo) => matchCombo(combo, e))) ?? null;
}
