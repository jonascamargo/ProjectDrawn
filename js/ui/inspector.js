import { t } from '../core/i18n.js';
import { partsOf, shownPins } from '../core/node.js';
import { coerceValue, editorOf } from '../core/values.js';
import { TypePicker } from './typePicker.js';

// Acima desse número de tipos, o campo de tipo vira o seletor com busca (em vez do select).
const PICKER_MIN = 20;
// Largura do painel (arrastando o puxador): limites e onde fica guardada neste navegador.
const WIDTH = { min: 220, max: 640, key: 'projectdrawn.panelWidth' };

// Inspetor: painel à esquerda com as propriedades do que está selecionado.
//   Nó: os campos da definição (texto, tipo, checkbox, cor, lista de parâmetros) e o valor de cada
//   entrada de dados (campo pelo tipo; com fio, a origem e o botão de desconectar). Fio: origem,
//   destino e tipo (só leitura).
// Nomes (rótulos dos campos) vêm em inglês da linguagem; textos de ajuda vêm do idioma.
export class Inspector {
  // onChange(): algo foi editado (o canvas redesenha e o projeto é salvo).
  // onDragParam(fn, param): começou a arrastar um parâmetro da função (quem soltar cria o nó dele).
  // defaultColor: cor mostrada no campo de cor sem valor (a padrão do tema).
  constructor(parent, { scene, selection, defaultColor = '#8f8f8f', onChange = () => {}, onDragParam = () => {} }) {
    this.scene = scene;
    this.defaultColor = defaultColor;
    this.selection = selection;
    this.onChange = onChange;
    this.onDragParam = onDragParam;
    this.signature = null;
    this.freeNames = new Set(); // arquivos com o nome livre (Other): a extensão vai digitada junto

    // O painel tem abas: Inspector e as que forem adicionadas (addTab), ex.: métodos nativos.
    this.el = document.createElement('aside');
    this.el.className = 'inspector';
    this.tabs = document.createElement('div');
    this.tabs.className = 'panel-tabs';
    this.body = document.createElement('div');
    this.body.className = 'inspector__body';
    this.el.append(this.tabs, this.body);
    this.pages = [];
    this.addTab('Inspector', this.body);
    this.typePicker = new TypePicker(this.el);
    // Puxador na borda direita (logo depois do painel): arrastar muda a largura.
    this.handle = document.createElement('div');
    this.handle.className = 'panel-resize';
    this.handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.handle.setPointerCapture?.(e.pointerId);
      this.resizing = { x: e.clientX, width: this.width() };
      document.body.classList.toggle('resizing-panel', true);
    });
    this.handle.addEventListener('pointermove', (e) => {
      if (this.resizing) this.setWidth(this.resizing.width + e.clientX - this.resizing.x);
    });
    this.handle.addEventListener('pointerup', () => {
      if (!this.resizing) return;
      this.resizing = null;
      document.body.classList.toggle('resizing-panel', false);
      try {
        localStorage.setItem(WIDTH.key, String(this.width()));
      } catch {
        // sem armazenamento: a largura vale só até recarregar
      }
    });
    parent.prepend(this.handle);
    parent.prepend(this.el);
    let saved = null;
    try {
      saved = Number(localStorage.getItem(WIDTH.key));
    } catch {
      // sem armazenamento: largura do tema
    }
    if (saved) this.setWidth(saved);
  }

  // Largura atual do painel (a variável --ui-panelWidth, que o CSS e a lista de atalhos usam).
  width() {
    return Number.parseFloat(document.documentElement.style.getPropertyValue('--ui-panelWidth')) || this.el.offsetWidth;
  }

  setWidth(px) {
    const w = Math.round(Math.min(WIDTH.max, Math.max(WIDTH.min, px)));
    document.documentElement.style.setProperty('--ui-panelWidth', `${w}px`);
  }

  // Nova aba no painel, com o conteúdo `page`.
  addTab(label, page) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-tabs__tab';
    button.textContent = label;
    button.addEventListener('click', () => this.selectTab(page));
    this.tabs.append(button);
    this.pages.push({ button, page });
    if (page !== this.body) this.el.append(page);
    this.selectTab(this.pages[0].page);
  }

  selectTab(page) {
    for (const p of this.pages) {
      p.page.hidden = p.page !== page;
      p.button.classList.toggle('active', p.page === page);
    }
  }

  toggle() {
    this.el.hidden = !this.el.hidden;
  }

  // Redesenha só se a seleção ou o conteúdo selecionado mudou, e não enquanto um campo está em uso
  // (digitando texto, ou com o seletor de cor aberto): trocar o campo fecharia o seletor.
  refresh() {
    const signature = this.currentSignature();
    if (signature === this.signature) return;
    if (this.el.contains(document.activeElement) && ['text', 'color', 'number'].includes(document.activeElement?.type)) return;
    this.signature = signature;
    this.render();
  }

  currentSignature() {
    const ids = [...this.selection.ids];
    const items = ids.map((id) => {
      const node = this.scene.byId(id);
      if (node) {
        const wires = this.scene.wiresOf(node).map((w) => w.id);
        const split = [...node.inputs, ...node.outputs].filter((p) => p.split).map((p) => p.id);
        return { id, title: node.title, values: node.values, inputs: node.inputValues, wires, split, broken: node.broken, out: node.outOfReach, foreign: this.scene.isForeign(node), ref: node.ref, scope: node.scope };
      }
      const wire = this.scene.wireById(id);
      return wire ? { id, wire: true } : { id };
    });
    return JSON.stringify(items);
  }

  render() {
    const ids = [...this.selection.ids];
    if (ids.length === 0) return this.show(this.help(t('inspector.empty')));
    if (ids.length > 1) return this.show(this.help(t('inspector.many', { n: ids.length })));
    const node = this.scene.byId(ids[0]);
    if (node) return this.show(...this.nodeSection(node));
    const wire = this.scene.wireById(ids[0]);
    if (wire) return this.show(...this.wireSection(wire));
    return this.show(this.help(t('inspector.empty')));
  }

  show(...children) {
    this.body.replaceChildren(...children);
  }

  help(text) {
    const p = document.createElement('p');
    p.className = 'inspector__help';
    p.textContent = text;
    return p;
  }

  heading(main, sub) {
    const h = document.createElement('div');
    h.className = 'inspector__heading';
    const b = document.createElement('strong');
    b.textContent = main;
    const small = document.createElement('small');
    small.textContent = sub;
    h.append(b, small);
    return h;
  }

  // stacked: rótulo acima do campo (campos compostos, que precisam da largura toda).
  row(label, control, stacked = false) {
    const row = document.createElement('label');
    row.className = stacked ? 'inspector__row inspector__row--stacked' : 'inspector__row';
    const span = document.createElement('span');
    span.textContent = label;
    row.append(span, control);
    return row;
  }

  nodeSection(node) {
    const parts = [this.heading(node.title, node.type)];
    if (this.scene.isForeign(node)) {
      const script = this.scene.scriptOf(node);
      parts.push(this.warning(t('inspector.foreign', { lang: this.scene.languages.of(node).name, file: script.title })));
    }
    const self = node.inputs.find((p) => p.self);
    if (self && this.scene.selfMissing(node)) parts.push(this.warning(t('inspector.selfMissing', { cls: self.type })));
    else if (self && !this.scene.isConnected(node, self)) parts.push(this.help(t('inspector.self', { cls: self.type })));
    const native = this.scene.nativeOf(node);
    if (native) parts.push(this.help(t('inspector.native', { lang: this.scene.languages.of(node).name })));
    if (this.scene.isClass(node) && this.scene.missingSuperclass(node)) parts.push(this.warning(t('inspector.superclassGone')));
    if (node.ref != null) return [...parts, ...this.referenceSection(node), ...this.inputSection(node)];
    const inputs = this.inputSection(node);
    if (!node.fields.length && !inputs.length) return [...parts, this.help(t('inspector.noFields'))];
    const inferred = new Map(node.fields.filter((f) => f.infer && node.values[f.id]).map((f) => [f.infer.field, f.infer]));
    for (const field of node.fields) {
      if (field.input === 'params') {
        parts.push(...this.paramsSection(node, field, !!native));
        continue;
      }
      const locked = inferred.has(field.id) || (!!native && ['name', 'returns'].includes(field.id));
      parts.push(this.row(field.label, this.control(node, field, locked), field.input === 'filename'));
      if (field.infer && node.values[field.id]) parts.push(this.help(t('inspector.inferHelp', { pin: field.infer.from })));
    }
    return [...parts, ...this.inheritedSection(node), ...inputs];
  }

  // Classe com pai: os membros herdados (variáveis com o tipo, funções), só para ver; no menu da
  // classe eles aparecem em Inherited.
  inheritedSection(node) {
    if (!this.scene.isClass(node)) return [];
    const members = this.scene.inherited(node.id);
    if (!this.scene.superclasses(node).length) return [];
    const lines = members.map((m) => {
      const p = document.createElement('p');
      p.className = 'inspector__member';
      const type = m.outputs.find((o) => o.id === m.references.pin)?.type;
      p.textContent = m.concept === 'function' ? `${m.title}()` : `${m.title}: ${type ?? 'any'}`;
      p.title = this.scene.byId(m.scope).title;
      return p;
    });
    return [this.section('Inherited'), ...(lines.length ? lines : [this.help(t('inspector.noInherited'))]), this.help(t('inspector.inheritedHelp'))];
  }

  // Parâmetros da função, em ordem: alça de arrastar, nome, tipo, subir, descer, remover; e adicionar.
  // Arrastar a alça (⠿) para dentro da função cria o nó do parâmetro. native (método nativo): os
  // parâmetros dele ficam travados (só a alça); os extras vêm depois, cada um com valor padrão.
  paramsSection(node, field, native = false) {
    const current = () => node.values[field.id] ?? [];
    const params = current();
    const types = this.scene.languages.of(node).types ?? {};
    const set = (next, redraw = true) => {
      this.scene.setField(node, field.id, next);
      this.onChange();
      if (redraw) {
        this.signature = null;
        this.refresh();
      }
    };
    const change = (id, patch) => current().map((p) => (p.id === id ? { ...p, ...patch } : p));
    const button = (text, title, onClick, disabled = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'inspector__icon-button';
      b.textContent = text;
      b.title = title;
      b.disabled = disabled;
      b.addEventListener('click', onClick);
      return b;
    };
    const rows = params.map((p, i) => {
      const row = document.createElement('div');
      row.className = 'inspector__param';
      const handle = document.createElement('span');
      handle.className = 'inspector__drag';
      handle.textContent = '⠿';
      handle.title = t('inspector.dragParam');
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.onDragParam(node, p);
      });
      const name = document.createElement('input');
      name.type = 'text';
      name.value = p.name;
      name.disabled = !!p.native;
      name.addEventListener('input', () => set(change(p.id, { name: name.value }), false));
      const type = this.typeControl(node, p.type, { disabled: !!p.native, onPick: (id) => set(change(p.id, { type: id })) });
      row.append(handle, name, type);
      if (p.native) return row;
      const move = (to) => {
        const next = [...current()];
        next.splice(to, 0, ...next.splice(i, 1));
        set(next);
      };
      row.append(
        button('↑', 'Up', () => move(i - 1), i === 0 || !!params[i - 1].native),
        button('↓', 'Down', () => move(i + 1), i === params.length - 1),
        button('×', 'Remove', () => set(current().filter((q) => q.id !== p.id))),
      );
      if (native) row.append(this.defaultInput(types[p.type], p, (value) => set(change(p.id, { default: value }), false)));
      return row;
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'inspector__button';
    add.textContent = '+ Add';
    add.addEventListener('click', () => {
      const list = current();
      const id = `p${Math.max(0, ...list.map((p) => Number(p.id.slice(1)) || 0)) + 1}`;
      set([...list, { id, name: `arg${list.length}`, type: Object.keys(types)[0] ?? null }]);
    });
    return [this.section(field.label), ...rows, add];
  }

  // Valor padrão de um parâmetro extra, no editor do tipo dele (int, float, bool, vetor, texto).
  // Tipo sem editor (ex.: any): o padrão é null.
  defaultInput(type, param, onChange) {
    const wrap = document.createElement('span');
    wrap.className = 'inspector__param-default';
    const label = document.createElement('span');
    label.textContent = 'default';
    const editor = this.valueEditor(type, param.default, (raw) => onChange(coerceValue(type, raw)));
    if (editor) {
      wrap.append(label, editor);
    } else {
      const none = document.createElement('span');
      none.className = 'inspector__value';
      none.textContent = 'null';
      wrap.append(label, none);
    }
    return wrap;
  }

  // Entradas de dados com valor (o tipo tem editor): o campo do tipo, ou, com fio, de onde vem.
  inputSection(node) {
    const pins = shownPins(node, 'in').filter((p) => p.kind === 'data' && editorOf(this.scene.typeDef(node, p)));
    const parts = [];
    if (pins.length) {
      const stacked = (pin) => editorOf(this.scene.typeDef(node, pin)) === 'vector';
      parts.push(this.section('Inputs'), ...pins.map((pin) => this.row(pin.label || pin.id, this.inputControl(node, pin), stacked(pin))));
    }
    return [...parts, ...this.splitSection(node)];
  }

  section(text) {
    const title = document.createElement('div');
    title.className = 'inspector__section';
    title.textContent = text;
    return title;
  }

  // Pinos com componentes (ex.: Vector3): abrir (um pino por componente) ou fechar de volta.
  splitSection(node) {
    const pins = [...node.inputs, ...node.outputs].filter((p) => p.split || this.scene.canSplit(node, p));
    if (!pins.length) return [];
    return [this.section('Pins'), ...pins.map((pin) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inspector__button';
      button.textContent = pin.split ? `Recombine (${partsOf(node, pin).length})` : 'Split';
      button.addEventListener('click', () => {
        if (pin.split) this.scene.recombinePin(node, pin);
        else this.scene.splitPin(node, pin);
        this.onChange();
        this.signature = null;
        this.refresh();
      });
      return this.row(`${pin.direction === 'in' ? 'in' : 'out'} ${pin.label || pin.id}`, button);
    })];
  }

  inputControl(node, pin) {
    const from = this.scene.incoming(node, pin);
    if (from) {
      // Valor vem de outro nó: ícone de fio, a origem e o botão de desconectar.
      const wrap = document.createElement('span');
      wrap.className = 'inspector__source';
      const icon = document.createElement('span');
      icon.className = 'inspector__wire-icon';
      icon.textContent = '⟵';
      const origin = document.createElement('span');
      origin.className = 'inspector__value';
      origin.textContent = `${from.node.reroute ? 'reroute' : from.node.title}.${from.pin.label || from.pin.id}`;
      origin.title = origin.textContent;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inspector__disconnect';
      button.title = 'Disconnect';
      button.append(document.createElement('span')); // ícone (pin-disconect.svg, pelo CSS)
      button.addEventListener('click', () => {
        this.scene.disconnect([from.wire.id]);
        this.onChange();
        this.signature = null;
        this.refresh();
      });
      wrap.append(icon, origin, button);
      return wrap;
    }
    const type = this.scene.typeDef(node, pin);
    return this.valueEditor(type, this.scene.inputValue(node, pin), (raw) => {
      this.scene.setInputValue(node, pin.id, raw);
      this.onChange();
    });
  }

  // Campo de um valor pelo editor do tipo: int (só inteiros), float, bool (checkbox), vetor (um
  // número por componente) ou texto. set(raw) recebe o digitado (vetor: a lista). Sem editor: null.
  valueEditor(type, value, set) {
    const number = (initial, step, onInput) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = step;
      input.value = String(initial);
      input.addEventListener('input', () => onInput(input.value));
      // Ao sair do campo, mostra o valor como ficou (ex.: 2.7 num int vira 2).
      input.addEventListener('change', () => {
        this.signature = null;
        this.render();
      });
      return input;
    };
    switch (editorOf(type)) {
      case 'int':
        return number(value, '1', set);
      case 'float':
        return number(value, 'any', set);
      case 'bool': {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!value;
        input.addEventListener('change', () => set(input.checked));
        return input;
      }
      case 'vector': {
        const wrap = document.createElement('span');
        wrap.className = 'inspector__vector';
        const parts = type.components.map((name, i) => {
          const label = document.createElement('label');
          const span = document.createElement('span');
          span.textContent = name;
          const step = type.componentType === 'int' ? '1' : 'any';
          const input = number(value[i], step, () => set(parts.map((p) => p.input.value)));
          label.append(span, input);
          return { label, input };
        });
        wrap.append(...parts.map((p) => p.label));
        return wrap;
      }
      case 'text': {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = value ?? '';
        input.addEventListener('input', () => set(input.value));
        return input;
      }
      default:
        return null;
    }
  }

  // Referência: de onde vem; quebrada ou fora do alcance, o aviso e a lista para religar.
  referenceSection(node) {
    const target = this.scene.byId(node.ref);
    const param = node.concept === 'parameter';
    if (target && !node.broken && !node.outOfReach) {
      if (param) return [this.help(t('inspector.parameter', { param: node.title, name: target.title }))];
      return [this.help(t(node.concept === 'call' ? 'inspector.call' : 'inspector.reference', { name: target.title }))];
    }
    let warning = target ? t('inspector.outOfReach', { name: target.title }) : t('inspector.broken');
    if (param && target) warning = t(node.broken ? 'inspector.paramGone' : 'inspector.paramOut', { name: target.title });
    const parts = [this.warning(warning)];
    if (param) return parts;
    const candidates = this.scene.relinkCandidates(node);
    if (!candidates.length) return [...parts, this.help(t('inspector.relinkNone'))];
    const select = document.createElement('select');
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '—';
    select.append(empty, ...candidates.map((c) => {
      const option = document.createElement('option');
      option.value = String(c.id);
      option.textContent = c.title;
      return option;
    }));
    select.addEventListener('change', () => {
      const chosen = candidates.find((c) => String(c.id) === select.value);
      if (!chosen) return;
      this.scene.relink(node, chosen);
      this.onChange();
    });
    return [...parts, this.row(t('inspector.relink'), select)];
  }

  warning(text) {
    const p = this.help(text);
    p.className = 'inspector__help inspector__help--warning';
    return p;
  }

  // Campo editável. Texto atualiza enquanto digita; tipo e checkbox redesenham o inspetor.
  control(node, field, locked) {
    const set = (value) => {
      this.scene.setField(node, field.id, value);
      this.onChange();
    };
    if (field.input === 'checkbox') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!node.values[field.id];
      input.addEventListener('change', () => set(input.checked));
      return input;
    }
    if (field.input === 'color') {
      // Cor própria; o botão volta para a padrão (sem valor).
      const wrap = document.createElement('span');
      wrap.className = 'inspector__color';
      const input = document.createElement('input');
      input.type = 'color';
      input.value = node.values[field.id] || this.defaultColor;
      input.addEventListener('input', () => set(input.value));
      // Seletor fechado: agora pode redesenhar (atualiza o botão Default).
      input.addEventListener('change', () => {
        this.signature = this.currentSignature();
        this.render();
      });
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.textContent = 'Default';
      reset.disabled = !node.values[field.id];
      reset.addEventListener('click', () => set(null));
      wrap.append(input, reset);
      return wrap;
    }
    if (field.input === 'type') {
      return this.typeControl(node, node.values[field.id], {
        none: field.none,
        disabled: locked,
        onPick: (id) => {
          set(id);
          this.signature = null;
          this.refresh();
        },
      });
    }
    if (field.input === 'filename') return this.fileNameControl(node, field, set);
    if (field.input === 'class') return this.classControl(node, field, set);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = node.values[field.id] ?? '';
    input.disabled = locked;
    input.addEventListener('input', () => set(input.value));
    return input;
  }

  // Nome de arquivo: o nome num campo e a extensão num select (as que as linguagens cuidam). Com
  // Other, o nome é livre e a extensão vai digitada junto.
  fileNameControl(node, field, set) {
    const exts = [...new Set(this.scene.languages.list.flatMap((l) => Object.keys(l.extensions ?? {})))];
    const name = String(node.values[field.id] ?? '');
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : null;
    const free = this.freeNames.has(node.id) || !exts.includes(ext);
    const wrap = document.createElement('span');
    wrap.className = 'inspector__filename';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = free ? name : name.slice(0, dot);
    const select = document.createElement('select');
    for (const [value, label] of [...exts.map((e) => [e, `.${e}`]), ['', 'Other']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.append(option);
    }
    select.value = free ? '' : ext;
    input.addEventListener('input', () => set(free ? input.value : `${input.value}.${select.value}`));
    select.addEventListener('change', () => {
      if (select.value) {
        this.freeNames.delete(node.id);
        const stem = free && input.value.includes('.') ? input.value.slice(0, input.value.lastIndexOf('.')) : input.value;
        set(`${stem}.${select.value}`);
      } else {
        this.freeNames.add(node.id);
      }
      this.signature = null;
      this.render();
    });
    wrap.append(input, select);
    return wrap;
  }

  // Classe pai: as do projeto (mesma linguagem, sem ela mesma e as filhas dela; guardadas pelo id) e
  // as classes da linguagem (ex.: Node, guardadas pelo nome); — = nenhuma. Lista longa: com busca.
  classControl(node, field, set) {
    const lang = this.scene.languages.get(this.scene.classLang(node));
    const options = {};
    for (const c of this.scene.superclassCandidates(node)) options[String(c.id)] = { label: this.scene.classLabel(c), group: 'Project classes' };
    for (const [id, type] of Object.entries(lang.types ?? {})) if ('inherits' in type) options[id] = { label: type.label ?? id, group: type.group };
    const value = node.values[field.id];
    const key = value == null || !(String(value) in options) ? null : String(value);
    const pick = (id) => {
      set(id == null ? null : /^\d+$/.test(id) ? Number(id) : id);
      this.signature = null;
      this.render();
    };
    if (Object.keys(options).length > PICKER_MIN) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inspector__type';
      button.textContent = key == null ? '—' : options[key].label;
      button.addEventListener('click', () => this.typePicker.open(button, { types: options, value: key, none: '—', onPick: pick }));
      return button;
    }
    const select = document.createElement('select');
    for (const [id, label] of [['', '—'], ...Object.entries(options).map(([id, o]) => [id, o.label])]) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = label;
      select.append(option);
    }
    select.value = key ?? '';
    select.addEventListener('change', () => pick(select.value || null));
    return select;
  }

  // Campo de tipo, com os tipos da linguagem do nó: select para listas curtas; com muitos tipos (ex.:
  // GDScript), um botão que abre o seletor com busca. none (ex.: 'void'): opção "sem tipo" (null).
  typeControl(node, value, { none = null, disabled = false, onPick }) {
    const types = this.scene.typesFor(node);
    const entries = Object.entries(types);
    if (entries.length > PICKER_MIN) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inspector__type';
      button.textContent = value == null ? none ?? '—' : types[value]?.label ?? value;
      button.disabled = disabled;
      button.addEventListener('click', () => this.typePicker.open(button, { types, value, none, onPick }));
      return button;
    }
    const select = document.createElement('select');
    for (const [id, label] of [...(none ? [['', none]] : []), ...entries.map(([id, type]) => [id, type.label ?? id])]) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = label;
      select.append(option);
    }
    select.value = value ?? '';
    select.disabled = disabled;
    select.addEventListener('change', () => onPick(select.value || null));
    return select;
  }

  wireSection(wire) {
    const { from, to } = this.scene.ends(wire);
    const end = (e) => `${e.node.reroute ? 'reroute' : e.node.title}.${e.pin.label || e.pin.id}`;
    const value = (text) => {
      const span = document.createElement('span');
      span.className = 'inspector__value';
      span.textContent = text;
      return span;
    };
    const rows = [
      this.row('From', value(end(from))),
      this.row('To', value(end(to))),
      this.row('Kind', value(from.pin.kind)),
    ];
    if (from.pin.type) rows.push(this.row('Type', value(from.pin.type)));
    return [this.heading('Wire', `#${wire.id}`), ...rows];
  }
}
