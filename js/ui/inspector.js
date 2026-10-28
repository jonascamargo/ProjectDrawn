import { bus } from '../core/events.js';
import { t } from '../i18n/i18n.js';
import { findPin, functionEntry, nodePins, readGraph, resolveFile, scopeParams, variableDeclarations } from '../core/graph.js';
import { SYMBOL_DRAG_TYPE } from './projectOutline.js';
import { uid } from '../core/ids.js';
import { createTableEditor } from './tableEditor.js';
import { formatNodeCode } from '../core/codeFormat.js';
import { currentCatalogs, currentProfile, fileTypeOf } from '../lang/profileLoader.js';
import { getDef } from '../lang/nodeRegistry.js';
import { formatDefault } from '../canvas/graphLayout.js';

// Painel de propriedades (direita): campos do nó selecionado, variável referenciada,
// valores padrão dos pinos, nomes de pinos dinâmicos e o código equivalente.
export class Inspector {
  #frame = 0;

  constructor(root, editor) {
    this.root = root;
    this.editor = editor;
    root.classList.add('inspector');
    const schedule = () => {
      if (!this.#frame) this.#frame = requestAnimationFrame(() => this.render());
    };
    bus.on('selection:changed', () => {
      this.force = true;
      schedule();
    });
    bus.on('project:changed', schedule);
  }

  // Redesenha já (ex.: ao abrir a aba).
  refresh() {
    this.force = true;
    this.render();
  }

  render() {
    this.#frame = 0;
    if (this.root.hidden) return;
    // Não redesenha enquanto o usuário digita aqui (perderia o foco).
    if (!this.force && this.root.contains(document.activeElement) && document.activeElement !== document.body) return;
    this.force = false;

    const editor = this.editor;
    const gc = editor.graph;
    this.root.replaceChildren();
    if (!editor.project) return;

    const node = gc.selectedNode();
    if (node) return this.#renderNode(gc.fileId, node);
    if (gc.nodes.size > 1) return this.root.append(el('p', 'side-panel__hint', t('inspector.multiple', { count: gc.nodes.size })));
    if (gc.wire) return this.#renderWire(gc.fileId, gc.wire);
    if (editor.selection.size === 1) return this.#renderItem(editor.project.get([...editor.selection][0]));
    this.root.append(el('p', 'side-panel__hint', t('inspector.empty')));
  }

  // Fio selecionado: etiqueta (texto, ícone, cor, mudança de tipo A → B).
  #renderWire(fileId, wireId) {
    const gc = this.editor.graph;
    const graph = readGraph(this.editor.project.get(fileId));
    const wire = graph.wires.find((w) => w.id === wireId);
    if (!wire) return;
    const box = el('div', 'inspector__body');
    box.append(el('h3', 'inspector__name', t('inspector.wireTitle')));
    box.append(el('p', 'side-panel__hint', t('inspector.wire')));
    if (!wire.label) {
      const add = el('button', 'btn btn--default', t('graph.menu.addLabel'));
      add.type = 'button';
      add.addEventListener('click', () => gc.setWireLabel(fileId, wireId, { text: t('graph.label.default'), at: 0.5 }));
      box.append(add);
      this.root.append(box);
      return;
    }
    const label = wire.label;
    const save = (patch) => gc.setWireLabel(fileId, wireId, { ...label, ...patch });
    box.append(el('h4', 'inspector__section', t('inspector.label')));

    const text = el('input', 'field__input');
    text.value = label.text ?? '';
    text.addEventListener('change', () => save({ text: text.value }));
    box.append(field(t('inspector.labelText'), text));

    const icon = el('input', 'field__input');
    icon.value = label.icon ?? '';
    icon.maxLength = 4;
    icon.placeholder = '⚠ ★ ⏱';
    icon.addEventListener('change', () => save({ icon: icon.value.trim() || undefined }));
    box.append(field(t('inspector.labelIcon'), icon));

    const colorRow = el('div', 'inspector__inline');
    const color = el('input', 'field__input');
    color.type = 'color';
    color.value = label.color || '#2b303b';
    color.addEventListener('change', () => save({ color: color.value }));
    const clear = el('button', 'btn btn--default', t('inspector.labelColorClear'));
    clear.type = 'button';
    clear.addEventListener('click', () => save({ color: undefined }));
    colorRow.append(color, clear);
    box.append(field(t('inspector.labelColor'), colorRow));

    // Mudança de tipo (manual): marca no fio que o valor muda de A para B.
    box.append(el('h4', 'inspector__section', t('inspector.typeChange')));
    const from = typeSelect(label.typeChange?.from ?? '', this.editor.project, { empty: true });
    const to = typeSelect(label.typeChange?.to ?? '', this.editor.project, { empty: true });
    const saveChange = () => save({ typeChange: from.value || to.value ? { from: from.value, to: to.value } : undefined });
    from.addEventListener('change', saveChange);
    to.addEventListener('change', saveChange);
    box.append(field(t('inspector.typeFrom'), from), field(t('inspector.typeTo'), to));

    const remove = el('button', 'btn btn--danger', t('graph.menu.removeLabel'));
    remove.type = 'button';
    remove.addEventListener('click', () => gc.setWireLabel(fileId, wireId, null));
    box.append(el('p', 'side-panel__hint', t('inspector.labelHint')), remove);
    this.root.append(box);
  }

  #renderItem(item) {
    if (!item) return;
    const box = el('div', 'inspector__body');
    box.append(el('h3', 'inspector__name', item.name));
    const kind = item.kind === 'folder' ? t('inspector.folder') : fileTypeOf(item.name).label || t('inspector.file');
    box.append(row(t('inspector.kind'), kind));
    box.append(row(t('inspector.path'), this.editor.project.path(item.id, currentProfile()?.rootLabel ?? '')));
    if (item.description) box.append(row(t('items.description'), item.description));
    if (item.tags?.length) box.append(row(t('items.tags'), item.tags.join(', ')));
    const graph = readGraph(item);
    if (graph.nodes.length) box.append(row(t('inspector.nodes'), String(graph.nodes.length)));
    const btn = el('button', 'btn btn--default', t('items.properties'));
    btn.type = 'button';
    btn.addEventListener('click', () => this.editor.editProperties(item.id));
    box.append(btn);
    this.root.append(box);
  }

  #renderNode(fileId, node) {
    const gc = this.editor.graph;
    const graph = readGraph(this.editor.project.get(fileId));
    const def = getDef(node.type);
    const box = el('div', 'inspector__body');
    box.append(el('h3', 'inspector__name', def?.title ?? node.type));
    box.append(el('p', 'side-panel__hint', `${def?.category ?? ''} · ${node.type}`));
    if (!def) {
      box.append(el('p', 'inspector__error', t('inspector.unknownNode')));
      this.root.append(box);
      return;
    }
    const description = def.description ?? (node.type.startsWith('cat.') && def.subtitle ? t('inspector.catalogDescription', { owner: def.subtitle }) : '');
    if (description) box.append(el('p', 'inspector__description', description));
    if (def.filePath) box.append(row(t('inspector.linkedFile'), resolveFile(node.fields?.ref)?.path ?? t('inspector.missingFile')));
    const update = (mutate, label) => gc.updateNode(fileId, node.id, mutate, label);

    // Referência: variável (ler/definir), função (chamar) ou sinal (emitir).
    const choices = referenceChoices(graph, node, def);
    if (choices) {
      const select = el('select', 'field__input');
      select.append(option('', t('inspector.noReference')));
      for (const c of choices.options) select.append(option(c.value, c.label));
      select.value = node.fields?.ref ?? '';
      select.addEventListener('change', () => update((n) => {
        n.fields = { ...n.fields, ref: select.value || null };
      }, t('graph.history.edit')));
      box.append(field(choices.label, select));
    }

    // Campos da definição.
    for (const f of def.fields ?? []) {
      if (f.id === 'ref') continue;
      const value = node.fields?.[f.id];
      const input = fieldInput(f, value, this.editor.project);
      input.addEventListener('change', () => {
        const next = f.type === 'bool' ? input.checked : f.type === 'number' ? (input.value === '' ? undefined : Number(input.value)) : input.value;
        update((n) => {
          n.fields = { ...n.fields, [f.id]: next };
        }, t('graph.history.edit'));
      });
      box.append(field(f.label ?? f.id, input));
    }

    // Parâmetros (função própria, sinal): nome, tipo, padrão e remover.
    if (def.params) {
      box.append(el('h4', 'inspector__section', t('inspector.params')));
      const rows = structuredClone(node.params ?? []);
      const commit = () => update((n) => {
        n.params = structuredClone(rows);
      }, t('graph.history.params'));
      box.append(createTableEditor({
        rows,
        onChange: commit,
        addLabel: t('inspector.addParam'),
        newRow: () => ({ id: uid('p'), name: `param${rows.length + 1}`, type: 'Variant' }),
        columns: [
          { key: 'name', label: t('libraries.col.name') },
          { key: 'type', label: t('libraries.col.type'), type: 'select', options: typeGroups(this.editor.project, { withVoid: false }) },
          { key: 'default', label: t('libraries.col.default'), type: 'json' },
        ],
      }));
    }

    // Parâmetros da função/evento (próprios ou nativos, ex.: delta): arrastar cria "ler parâmetro".
    if (def.template === 'event' && node.scopeId) {
      const params = scopeParams(graph, node.scopeId);
      if (params.length) {
        box.append(el('h4', 'inspector__section', t('inspector.useParams')));
        const list = el('div', 'inspector__chips');
        for (const p of params) {
          const chip = el('span', 'inspector__chip', `${p.name}: ${p.type}`);
          chip.draggable = true;
          chip.title = t('inspector.useParamsHint');
          chip.addEventListener('dragstart', (event) => {
            event.dataTransfer.setData(SYMBOL_DRAG_TYPE, JSON.stringify({ fileId, kind: 'param', scopeId: node.scopeId, id: p.id }));
            event.dataTransfer.effectAllowed = 'copy';
          });
          list.append(chip);
        }
        box.append(list, el('p', 'side-panel__hint', t('inspector.useParamsHint')));
      }
    }

    // Valores padrão das entradas de dados sem fio.
    const pins = nodePins(node, def, graph);
    const connected = new Set(graph.wires.filter((w) => w.to.node === node.id).map((w) => w.to.pin));
    const free = pins.inputs.filter((p) => p.kind === 'data' && !connected.has(p.id));
    if (free.length) {
      box.append(el('h4', 'inspector__section', t('inspector.defaults')));
      for (const pin of free) {
        const input = el('input', 'field__input');
        input.value = formatDefault(node.defaults?.[pin.id] ?? pin.default);
        input.placeholder = pin.type;
        input.addEventListener('change', () => update((n) => {
          n.defaults = { ...n.defaults };
          const text = input.value.trim();
          if (!text) delete n.defaults[pin.id];
          else n.defaults[pin.id] = pin.type === 'int' || pin.type === 'float' ? Number(text) : text;
        }, t('graph.history.default')));
        box.append(field(`${pin.label || pin.id}: ${pin.type}`, input));
      }
    }

    // Nomes dos pinos dinâmicos de saída (ex.: parâmetros, casos do match).
    if (def.dynamicOutputs?.editableLabel) {
      const dynamic = pins.outputs.filter((p) => p.dynamic);
      if (dynamic.length) box.append(el('h4', 'inspector__section', t('inspector.pinNames')));
      for (const pin of dynamic) {
        const input = el('input', 'field__input');
        input.value = node.pinLabels?.[pin.id] ?? findPin(node, pin.id, 'out')?.label ?? '';
        input.addEventListener('change', () => update((n) => {
          n.pinLabels = { ...n.pinLabels, [pin.id]: input.value };
        }, t('graph.history.edit')));
        box.append(field(pin.id, input));
      }
    }

    const code = formatNodeCode(graph, node);
    if (code) {
      box.append(el('h4', 'inspector__section', t('inspector.code')));
      box.append(el('pre', 'inspector__code', code));
    }
    this.root.append(box);
  }
}

// Opções de referência conforme o tipo do nó (null se o nó não referencia nada).
function referenceChoices(graph, node, def) {
  if (node.type === 'var.get' || node.type === 'var.set') {
    return {
      label: t('inspector.variable'),
      options: variableDeclarations(graph, node.scopeId).map((d) => ({ value: d.id, label: `${d.fields?.name ?? '?'} (${getDef(d.type)?.title ?? d.type})` })),
    };
  }
  if (def.ref === 'param') {
    return {
      label: t('inspector.param'),
      options: scopeParams(graph, node.scopeId).map((p) => ({ value: p.id, label: `${p.name}: ${p.type}` })),
    };
  }
  if (def.ref === 'function') {
    return {
      label: t('inspector.function'),
      options: graph.scopes.filter((s) => s.kind === 'function').map((s) => ({ value: s.id, label: `${functionEntry(graph, s.id)?.fields?.name ?? '?'}()` })),
    };
  }
  if (def.ref === 'signal') {
    return {
      label: t('inspector.signal'),
      options: graph.nodes.filter((n) => n.type === 'signal.declare').map((n) => ({ value: n.id, label: n.fields?.name ?? '?' })),
    };
  }
  return null;
}

// Tipos para os seletores, agrupados: linguagem, classes do projeto (class_name) e catálogos.
// Retorna [{ group, options: [nome…] }] (formato de opções do tableEditor).
function typeGroups(project, { withVoid = true } = {}) {
  const language = (currentProfile()?.types ?? []).map((ty) => ty.id).filter((id) => withVoid || id !== 'void');
  const own = new Set();
  for (const item of project?.items.values() ?? []) {
    for (const n of readGraph(item).nodes) if (n.type === 'class.class_name' && n.fields?.name) own.add(n.fields.name);
  }
  const catalog = new Set(currentCatalogs().flatMap((c) => (c.classes ?? []).map((cls) => cls.name)));
  const groups = [{ group: t('inspector.types.language'), options: language }];
  if (own.size) groups.push({ group: t('inspector.types.project'), options: [...own].sort() });
  if (catalog.size) groups.push({ group: t('inspector.types.catalog'), options: [...catalog].sort() });
  return groups;
}

function typeSelect(value, project, { empty = false } = {}) {
  const select = el('select', 'field__input');
  const known = new Set();
  if (empty) select.append(option('', '—'));
  for (const g of typeGroups(project)) {
    const group = el('optgroup');
    group.label = g.group;
    for (const name of g.options) {
      group.append(option(name, name));
      known.add(name);
    }
    select.append(group);
  }
  if (value && !known.has(value)) select.append(option(value, value));
  select.value = value || (empty ? '' : 'Variant');
  return select;
}

function fieldInput(f, value, project) {
  let input;
  if (f.type === 'bool') {
    input = el('input');
    input.type = 'checkbox';
    input.checked = Boolean(value);
    return input;
  }
  if (f.type === 'select') {
    input = el('select', 'field__input');
    for (const o of f.options ?? []) input.append(option(typeof o === 'string' ? o : o.value, typeof o === 'string' ? o : o.label));
    input.value = value ?? '';
    return input;
  }
  if (f.type === 'color') {
    input = el('input', 'field__input');
    input.type = 'color';
    input.value = value || f.default || '#5a6270';
    return input;
  }
  if (f.type === 'code') {
    input = el('textarea', 'field__input');
    input.rows = 3;
    input.value = value ?? '';
    return input;
  }
  if (f.type === 'type') return typeSelect(value ?? f.default, project);
  input = el('input', 'field__input');
  input.type = f.type === 'number' ? 'number' : 'text';
  input.value = value ?? '';
  input.spellcheck = false;
  return input;
}

function field(label, input) {
  const wrap = el('label', 'field');
  wrap.append(el('span', 'field__label', label), input);
  return wrap;
}

function row(label, value) {
  const wrap = el('div', 'inspector__row');
  wrap.append(el('span', 'field__label', label), el('span', 'inspector__value', value));
  return wrap;
}

function option(value, label) {
  const o = el('option', null, label);
  o.value = value;
  return o;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
