import { t } from '../i18n/i18n.js';
import { createField, readField, setFieldError } from './form.js';

// Modais HTML com campos padronizados. Substituem alert/confirm/prompt.
// openModal resolve com { action, values } ou null quando cancelado.

let root = null;
const stack = [];

export function initModals(element) {
  root = element;
  document.addEventListener('keydown', onKeyDown, true);
}

export function openModal({ title, message, fields = [], actions, content, validate, width } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'modal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    if (width) dialog.style.width = width;

    const header = document.createElement('header');
    header.className = 'modal__header';
    const heading = document.createElement('h2');
    heading.className = 'modal__title';
    heading.textContent = title ?? '';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn--icon btn--ghost';
    closeBtn.title = t('modal.close');
    closeBtn.textContent = '×';
    header.append(heading, closeBtn);

    const form = document.createElement('form');
    form.className = 'modal__body';
    form.noValidate = true;

    if (message) {
      const p = document.createElement('p');
      p.className = 'modal__message';
      p.textContent = message;
      form.appendChild(p);
    }
    if (content) form.appendChild(content);

    const fieldRefs = fields.map(createField);
    for (const field of fieldRefs) form.appendChild(field.element);

    const footer = document.createElement('footer');
    footer.className = 'modal__footer';
    const actionDefs = actions ?? [
      { id: 'cancel', label: t('modal.cancel'), variant: 'ghost' },
      { id: 'ok', label: t('modal.ok'), variant: 'primary', submit: true },
    ];
    for (const action of actionDefs) {
      const btn = document.createElement('button');
      btn.type = action.submit ? 'submit' : 'button';
      btn.className = `btn btn--${action.variant ?? 'default'}`;
      btn.textContent = action.label;
      if (!action.submit) btn.addEventListener('click', () => finish(action.id, action.id !== 'cancel'));
      footer.appendChild(btn);
    }

    form.appendChild(footer);
    dialog.append(header, form);
    overlay.appendChild(dialog);

    const previousFocus = document.activeElement;
    const entry = { overlay, cancel: () => finish('cancel', false), submit: () => form.requestSubmit() };

    function collect() {
      return Object.fromEntries(fieldRefs.map((field) => [field.def.name, readField(field)]));
    }

    function check(values) {
      let ok = true;
      for (const field of fieldRefs) {
        const value = values[field.def.name];
        const missing = field.def.required && (value === '' || value === null);
        setFieldError(field, missing ? t('modal.required') : null);
        if (missing) ok = false;
      }
      const custom = validate?.(values) ?? {};
      for (const [name, msg] of Object.entries(custom)) {
        const field = fieldRefs.find((f) => f.def.name === name);
        if (field && msg) {
          setFieldError(field, msg);
          ok = false;
        }
      }
      return ok;
    }

    function finish(actionId, withValues) {
      const values = collect();
      if (withValues && !check(values)) return;
      stack.splice(stack.indexOf(entry), 1);
      overlay.remove();
      previousFocus?.focus?.();
      resolve(actionId === 'cancel' ? null : { action: actionId, values });
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const submitAction = actionDefs.find((a) => a.submit);
      finish(submitAction?.id ?? 'ok', true);
    });
    closeBtn.addEventListener('click', entry.cancel);
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) entry.cancel();
    });

    stack.push(entry);
    root.appendChild(overlay);
    const firstInput = form.querySelector('input, textarea, select') ?? footer.querySelector('.btn--primary');
    firstInput?.focus();
  });
}

export async function confirmDialog(message, { title, confirmLabel, danger = false } = {}) {
  const result = await openModal({
    title: title ?? t('modal.confirm'),
    message,
    actions: [
      { id: 'cancel', label: t('modal.cancel'), variant: 'ghost' },
      { id: 'ok', label: confirmLabel ?? t('modal.confirm'), variant: danger ? 'danger' : 'primary', submit: true },
    ],
  });
  return result !== null;
}

export async function promptDialog({ title, label, value = '', placeholder, required = true } = {}) {
  const result = await openModal({
    title,
    fields: [{ name: 'value', label, value, placeholder, required }],
  });
  return result ? result.values.value : null;
}

export function isModalOpen() {
  return stack.length > 0;
}

function onKeyDown(event) {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    top.cancel();
  }
}
