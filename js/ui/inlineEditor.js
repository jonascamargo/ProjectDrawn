// Campo de texto HTML posicionado sobre o canvas (ex.: valor padrão de um pino).
// Resolve com o texto digitado (Enter/perder foco) ou null (Esc).
let current = null;

export function openInlineEditor({ container, rect, value = '', placeholder = '' }) {
  current?.cancel();
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.className = 'inline-editor';
    input.value = value;
    input.placeholder = placeholder;
    input.spellcheck = false;
    Object.assign(input.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${Math.max(80, rect.w)}px`,
      height: `${Math.max(22, rect.h)}px`,
    });
    container.append(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      input.remove();
      current = null;
      resolve(result);
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') finish(input.value);
      else if (event.key === 'Escape') finish(null);
    });
    input.addEventListener('blur', () => finish(input.value));
    current = { cancel: () => finish(null) };
  });
}

export function isInlineEditorOpen() {
  return current !== null;
}
