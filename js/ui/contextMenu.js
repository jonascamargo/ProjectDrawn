// Menu de contexto HTML. Entradas: { label, shortcut, action, disabled, danger, checked } ou 'separator'.
let current = null;

export function showContextMenu(clientX, clientY, entries) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');

  for (const entry of entries) {
    if (entry === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'context-menu__separator';
      menu.appendChild(sep);
      continue;
    }
    if (entry.header) {
      const header = document.createElement('div');
      header.className = 'context-menu__header';
      header.textContent = entry.header;
      menu.appendChild(header);
      continue;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'context-menu__item';
    btn.setAttribute('role', 'menuitem');
    if (entry.danger) btn.classList.add('context-menu__item--danger');
    if (entry.checked) btn.classList.add('context-menu__item--checked');
    btn.disabled = Boolean(entry.disabled);

    const label = document.createElement('span');
    label.className = 'context-menu__label';
    label.textContent = entry.label;
    btn.appendChild(label);
    if (entry.shortcut) {
      const shortcut = document.createElement('span');
      shortcut.className = 'context-menu__shortcut';
      shortcut.textContent = entry.shortcut;
      btn.appendChild(shortcut);
    }
    btn.addEventListener('click', () => {
      closeContextMenu();
      entry.action?.();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const x = Math.min(clientX, window.innerWidth - rect.width - 4);
  const y = Math.min(clientY, window.innerHeight - rect.height - 4);
  menu.style.left = `${Math.max(4, x)}px`;
  menu.style.top = `${Math.max(4, y)}px`;

  const onPointerDown = (event) => {
    if (!menu.contains(event.target)) closeContextMenu();
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeContextMenu();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(menu, event.key === 'ArrowDown' ? 1 : -1);
    }
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', closeContextMenu);
  });

  current = {
    menu,
    cleanup() {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', closeContextMenu);
    },
  };
  menu.querySelector('.context-menu__item:not(:disabled)')?.focus();
}

export function closeContextMenu() {
  if (!current) return;
  current.cleanup();
  current.menu.remove();
  current = null;
}

export function isContextMenuOpen() {
  return current !== null;
}

function moveFocus(menu, dir) {
  const items = [...menu.querySelectorAll('.context-menu__item:not(:disabled)')];
  const index = items.indexOf(document.activeElement);
  items[(index + dir + items.length) % items.length]?.focus();
}
