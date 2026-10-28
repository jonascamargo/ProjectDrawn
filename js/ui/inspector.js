import { bus } from '../core/events.js';
import { t } from '../i18n/i18n.js';
import { findPin, functionEntry, nodePins, readGraph, resolveFile, scopeParams, variableDeclarations } from '../core/graph.js';
import { SYMBOL_DRAG_TYPE } from './projectOutline.js';
import { fileLinks } from '../core/fileLinks.js';
import { openCodeView } from './codeView.js';
import { openCodeImport } from './codeImport.js';
import { inputActions } from './projectSettings.js';
import { uid } from '../core/ids.js';
import { createTableEditor } from './tableEditor.js';
import { formatNodeCode } from '../core/codeFormat.js';
import { currentCatalogs, currentProfile, fileTypeOf } from '../lang/profileLoader.js';
import { classChain, getDef } from '../lang/nodeRegistry.js';
import { formatDefault, scopeTitle } from '../canvas/graphLayout.js';

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

  // Nó de cena: script associado e propriedades da classe (agrupadas pela herança) para expor como pinos.
  #renderSceneNode(box, fileId, node) {
    const gc = this.editor.graph;
    const project = this.editor.project;
    const rootLabel = currentProfile()?.rootLabel ?? '';
    const scripts = [...project.items.values()].filter((item) => gc.isScript(item)).sort((a, b) => project.path(a.id).localeCompare(project.path(b.id)));
    const select = el('select', 'field__input');
    select.append(option('', t('inspector.noScript')));
    for (const item of scripts) select.append(option(item.id, project.path(item.id, rootLabel)));
    select.value = node.fields?.script ?? '';
    select.addEventListener('change', () => gc.setNodeScript(fileId, node.id, select.value));
    box.append(field(t('inspector.script'), select));
    if (node.fields?.instance) {
      const instance = project.get(node.fields.instance);
      box.append(row(t('inspector.instanceOf'), instance ? project.path(instance.id, rootLabel) : t('inspector.missingFile')));
      if (instance) {
        const openScene = el('button', 'btn', t('inspector.openScene'));
        openScene.type = 'button';
        openScene.addEventListener('click', () => this.editor.navigateTo(instance.id));
        box.append(openScene);
      }
    }
    if (node.fields?.script && project.get(node.fields.script)) {
      const open = el('button', 'btn', t('inspector.openScript'));
      open.type = 'button';
      open.addEventListener('click', () => this.editor.navigateTo(node.fields.script));
      box.append(open);
    }

    box.append(el('h4', 'inspector__section', t('inspector.classProperties')));
    box.append(el('p', 'side-panel__hint', t('inspector.classPropertiesHint')));
    const filter = el('input', 'field__input');
    filter.type = 'search';
    filter.placeholder = t('inspector.filterProperties');
    const list = el('div', 'inspector__props');
    box.append(filter, list);
    const exposed = new Set(node.props ?? []);
    const toggle = (name, on) => gc.updateNode(fileId, node.id, (n) => {
      const props = new Set(n.props ?? []);
      if (on) props.add(name);
      else props.delete(name);
      n.props = [...props];
    }, t('graph.history.exposeProperty'));
    const chain = classChain(node.fields?.class || 'Node');
    const render = () => {
      const q = filter.value.trim().toLowerCase();
      list.replaceChildren();
      for (const link of chain) {
        const props = link.properties.filter((p) => !q || p.name.toLowerCase().includes(q));
        if (!props.length) continue;
        const group = el('details', 'inspector__props-group');
        group.open = Boolean(q) || link === chain[0] || props.some((p) => exposed.has(p.name));
        group.append(el('summary', 'outline__summary', `${link.name} (${props.length})`));
        for (const p of props) {
          const label = el('label', 'inspector__prop');
          const box = el('input');
          box.type = 'checkbox';
          box.checked = exposed.has(p.name);
          box.addEventListener('change', () => toggle(p.name, box.checked));
          label.append(box, el('span', null, p.name), el('span', 'outline__sub', p.type ?? 'Variant'));
          group.append(label);
        }
        list.append(group);
      }
      if (!list.children.length) list.append(el('p', 'side-panel__hint', chain.every((c) => !c.properties.length) ? t('inspector.noCatalogProperties') : t('launcher.noResults')));
    };
    filter.addEventListener('input', render);
    // Sem catálogo não há o que filtrar: fica só o aviso.
    filter.hidden = chain.every((c) => !c.properties.length);
    render();

    // Sinais da classe: marcados viram saídas para conectar à entrada "script" de um nó.
    const signals = chain.flatMap((link) => (link.signals ?? []).map((sig) => ({ ...sig, owner: link.name })));
    if (signals.length) {
      box.append(el('h4', 'inspector__section', t('inspector.classSignals')));
      box.append(el('p', 'side-panel__hint', t('inspector.classSignalsHint')));
      const shown = new Set(node.signals ?? []);
      const sigList = el('div', 'inspector__props');
      for (const sig of signals) {
        const label = el('label', 'inspector__prop');
        const check = el('input');
        check.type = 'checkbox';
        check.checked = shown.has(sig.name);
        check.addEventListener('change', () => gc.updateNode(fileId, node.id, (n) => {
          const set = new Set(n.signals ?? []);
          if (check.checked) set.add(sig.name);
          else set.delete(sig.name);
          n.signals = [...set];
        }, t('graph.history.exposeSignal')));
        const args = (sig.args ?? []).map((a) => a.name).join(', ');
        label.append(check, el('span', null, `${sig.name}(${args})`), el('span', 'outline__sub', sig.owner));
        sigList.append(label);
      }
      box.append(sigList);
    }

    // Propriedade à mão (sem catálogo, ou propriedade @export do script do nó).
    const known = new Set(chain.flatMap((c) => c.properties.map((p) => p.name)));
    const custom = (node.props ?? []).filter((name) => !known.has(name));
    box.append(el('h4', 'inspector__section', t('inspector.customProperties')));
    for (const name of custom) {
      const line = el('div', 'inspector__inline');
      line.append(el('span', 'inspector__value', `${name}: ${node.propTypes?.[name] ?? 'Variant'}`));
      const remove = el('button', 'btn', '×');
      remove.type = 'button';
      remove.title = t('inspector.removeProperty');
      remove.addEventListener('click', () => gc.updateNode(fileId, node.id, (n) => {
        n.props = (n.props ?? []).filter((p) => p !== name);
        if (n.propTypes) delete n.propTypes[name];
      }, t('graph.history.exposeProperty')));
      line.append(remove);
      box.append(line);
    }
    const addRow = el('div', 'inspector__inline');
    const nameInput = el('input', 'field__input');
    nameInput.placeholder = t('inspector.propertyName');
    nameInput.spellcheck = false;
    const typeInput = typeSelect('Variant', project);
    const add = el('button', 'btn', '+');
    add.type = 'button';
    add.title = t('inspector.addProperty');
    add.addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;
      gc.updateNode(fileId, node.id, (n) => {
        n.props = [...new Set([...(n.props ?? []), name])];
        if (!known.has(name)) n.propTypes = { ...n.propTypes, [name]: typeInput.value };
      }, t('graph.history.exposeProperty'));
    });
    addRow.append(nameInput, typeInput, add);
    box.append(addRow);
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

  // Referência de script: qual .gd e qual método dele recebe os sinais ligados ao nó.
  #renderScriptRef(box, fileId, node) {
    const gc = this.editor.graph;
    const project = this.editor.project;
    const rootLabel = currentProfile()?.rootLabel ?? '';
    const scripts = [...project.items.values()].filter((item) => gc.isScript(item)).sort((a, b) => project.path(a.id).localeCompare(project.path(b.id)));
    const scriptSelect = el('select', 'field__input');
    scriptSelect.append(option('', t('inspector.noScript')));
    for (const item of scripts) scriptSelect.append(option(item.id, project.path(item.id, rootLabel)));
    scriptSelect.value = node.fields?.script ?? '';
    scriptSelect.addEventListener('change', () => gc.updateNode(fileId, node.id, (n) => {
      n.fields = { ...n.fields, script: scriptSelect.value };
    }, t('graph.history.nodeScript')));
    box.append(field(t('inspector.script'), scriptSelect));

    // Métodos = funções próprias e eventos do script escolhido.
    const script = project.get(node.fields?.script);
    const scriptGraph = script ? readGraph(script) : null;
    const methods = scriptGraph ? [...new Set(scriptGraph.scopes.map((sc) => scopeTitle(scriptGraph, sc).replace(/^func\s+/, '').replace(/\(.*$/, '')).filter((m) => m && m !== '?'))] : [];
    const method = node.fields?.method ?? '';
    const methodSelect = el('select', 'field__input');
    methodSelect.append(option('', methods.length ? '—' : t('inspector.noMethods')));
    for (const m of methods) methodSelect.append(option(m, `${m}()`));
    if (method && !methods.includes(method)) methodSelect.append(option(method, `${method}()`));
    methodSelect.value = method;
    methodSelect.addEventListener('change', () => gc.updateNode(fileId, node.id, (n) => {
      n.fields = { ...n.fields, method: methodSelect.value };
    }, t('graph.history.signalMethod')));
    box.append(field(t('inspector.signalMethod'), methodSelect));
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
    if (this.editor.graph.isScript(item)) {
      const view = el('button', 'btn', t('export.viewCode'));
      view.type = 'button';
      view.addEventListener('click', () => openCodeView(this.editor, item.id));
      const load = el('button', 'btn', t('import.menu'));
      load.type = 'button';
      load.addEventListener('click', () => openCodeImport(this.editor, item.id));
      box.append(view, load);
    }
    if (item.kind === 'file') this.#renderLinks(box, item);
    this.root.append(box);
  }

  // Ligações com outros arquivos (calculadas dos nós de referência). Passar o mouse mostra a
  // linha no canvas; a caixa fixa a linha até desmarcar; duplo clique leva até a outra ponta.
  #renderLinks(box, item) {
    const editor = this.editor;
    const project = editor.project;
    const rootLabel = currentProfile()?.rootLabel ?? '';
    const { uses, usedBy } = fileLinks(project, item.id);
    editor.setLinkHover(null);
    box.append(el('h4', 'inspector__section', t('links.title')));
    if (!uses.length && !usedBy.length) {
      box.append(el('p', 'side-panel__hint', t('links.none')));
      return;
    }
    box.append(el('p', 'side-panel__hint', t('links.hint')));
    const group = (title, links, otherEnd) => {
      if (!links.length) return;
      box.append(el('div', 'inspector__links-title', title));
      for (const link of links) {
        const end = otherEnd(link);
        const line = el('label', 'inspector__link');
        const check = el('input');
        check.type = 'checkbox';
        check.checked = editor.linkPinned.has(link.key);
        check.title = t('links.pin');
        check.addEventListener('change', () => editor.setLinkPinned(link, check.checked));
        const text = el('span', 'inspector__link-text');
        const what = [t(`links.kind.${link.kind}`), link.name, link.detail].filter(Boolean).join(' · ');
        text.append(el('span', null, what), el('span', 'outline__sub', project.path(end.fileId, rootLabel)));
        line.append(check, text);
        line.addEventListener('mouseenter', () => editor.setLinkHover(link));
        line.addEventListener('mouseleave', () => editor.setLinkHover(null));
        line.addEventListener('dblclick', (event) => {
          event.preventDefault();
          if (end.nodeId || end.scopeId) editor.revealGraph(end.fileId, { nodeId: end.nodeId, scopeId: end.scopeId });
          else editor.navigateTo(end.fileId);
        });
        box.append(line);
      }
    };
    group(t('links.uses'), uses, (link) => link.to);
    group(t('links.usedBy'), usedBy, (link) => link.from);
    if (editor.linkPinned.size) {
      const clear = el('button', 'btn', t('links.clearPinned', { count: editor.linkPinned.size }));
      clear.type = 'button';
      clear.addEventListener('click', () => {
        for (const link of [...editor.linkPinned.values()]) editor.setLinkPinned(link, false);
        this.refresh();
      });
      box.append(clear);
    }
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
    if (def.external) {
      const source = this.editor.project.get(node.fields?.file);
      box.append(row(t('inspector.externalScript'), source ? this.editor.project.path(source.id, currentProfile()?.rootLabel ?? '') : t('inspector.missingFile')));
    }
    if (def.filePath) box.append(row(t('inspector.linkedFile'), resolveFile(node.fields?.ref)?.path ?? t('inspector.missingFile')));
    const update = (mutate, label) => gc.updateNode(fileId, node.id, mutate, label);

    // Referência: variável (ler/definir), função (chamar) ou sinal (emitir).
    const choices = referenceChoices(graph, node, def, this.editor.project);
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
      if (f.id === 'ref' || (def.external && f.id === 'file') || ((def.sceneNode || def.scriptRef) && f.id === 'script') || (def.scriptRef && f.id === 'method')) continue;
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

    if (def.sceneNode) this.#renderSceneNode(box, fileId, node);
    if (def.scriptRef) this.#renderScriptRef(box, fileId, node);

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
function referenceChoices(graph, node, def, project) {
  if (def.inputAction) {
    return { label: t('inspector.inputAction'), options: inputActions(project).map((a) => ({ value: a.id, label: a.name })) };
  }
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
