// Campos de formulário no padrão visual do app. Usados por modais e painéis.
// Definição: { name, label, type, value, required, options, placeholder, min, max, step, hint }
// Tipos: text, textarea, number, select, checkbox, color

export function createField(def) {
  const wrapper = document.createElement('label');
  wrapper.className = `field field--${def.type ?? 'text'}`;

  const label = document.createElement('span');
  label.className = 'field__label';
  label.textContent = def.label ?? def.name;

  const input = createInput(def);
  input.classList.add('field__input');
  input.name = def.name;
  if (def.required) input.required = true;

  if (def.type === 'checkbox') {
    wrapper.append(input, label);
  } else {
    wrapper.append(label, input);
  }

  if (def.hint) {
    const hint = document.createElement('span');
    hint.className = 'field__hint';
    hint.textContent = def.hint;
    wrapper.appendChild(hint);
  }

  const error = document.createElement('span');
  error.className = 'field__error';
  wrapper.appendChild(error);

  return { element: wrapper, input, error, def };
}

function createInput(def) {
  switch (def.type) {
    case 'textarea': {
      const el = document.createElement('textarea');
      el.value = def.value ?? '';
      el.rows = def.rows ?? 4;
      if (def.placeholder) el.placeholder = def.placeholder;
      return el;
    }
    case 'select': {
      const el = document.createElement('select');
      for (const option of def.options ?? []) {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label ?? option.value;
        el.appendChild(opt);
      }
      if (def.value !== undefined) el.value = def.value;
      return el;
    }
    case 'checkbox': {
      const el = document.createElement('input');
      el.type = 'checkbox';
      el.checked = Boolean(def.value);
      return el;
    }
    default: {
      const el = document.createElement('input');
      el.type = def.type ?? 'text';
      el.value = def.value ?? '';
      for (const attr of ['placeholder', 'min', 'max', 'step']) {
        if (def[attr] !== undefined) el[attr] = def[attr];
      }
      el.autocomplete = 'off';
      el.spellcheck = false;
      return el;
    }
  }
}

export function readField(field) {
  const { input, def } = field;
  if (def.type === 'checkbox') return input.checked;
  if (def.type === 'number') return input.value === '' ? null : Number(input.value);
  return input.value;
}

export function setFieldError(field, message) {
  field.error.textContent = message ?? '';
  field.element.classList.toggle('field--invalid', Boolean(message));
}
