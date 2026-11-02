import { t } from '../core/i18n.js';
import { partsOf, shownPins } from '../core/node.js';
import { editorOf } from '../core/values.js';

// Inspetor: painel à esquerda com as propriedades do que está selecionado.
//   Nó: os campos da definição (texto, tipo, checkbox, cor) e o valor de cada entrada de dados (campo
//   pelo tipo; com fio, a origem e o botão de desconectar). Fio: origem, destino e tipo (só leitura).
// Nomes (rótulos dos campos) vêm em inglês da linguagem; textos de ajuda vêm do idioma.
export class Inspector {
  // onChange(): algo foi editado (o canvas redesenha e o projeto é salvo).
  // defaultColor: cor mostrada no campo de cor sem valor (a padrão do tema).
  constructor(parent, { scene, selection, language, defaultColor = '#8f8f8f', onChange = () => {} }) {
    this.scene = scene;
    this.defaultColor = defaultColor;
    this.selection = selection;
    this.language = language;
    this.onChange = onChange;
    this.signature = null;

    this.el = document.createElement('aside');
    this.el.className = 'inspector';
    const title = document.createElement('h2');
    title.textContent = 'Inspector';
    this.body = document.createElement('div');
    this.body.className = 'inspector__body';
    this.el.append(title, this.body);
    parent.prepend(this.el);
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
        return { id, title: node.title, values: node.values, inputs: node.inputValues, wires, split, broken: node.broken, out: node.outOfReach, ref: node.ref, scope: node.scope };
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

  row(label, control) {
    const row = document.createElement('label');
    row.className = 'inspector__row';
    const span = document.createElement('span');
    span.textContent = label;
    row.append(span, control);
    return row;
  }

  nodeSection(node) {
    const parts = [this.heading(node.title, node.type)];
    if (node.ref != null) return [...parts, ...this.referenceSection(node), ...this.inputSection(node)];
    const inputs = this.inputSection(node);
    if (!node.fields.length && !inputs.length) return [...parts, this.help(t('inspector.noFields'))];
    const inferred = new Map(node.fields.filter((f) => f.infer && node.values[f.id]).map((f) => [f.infer.field, f.infer]));
    for (const field of node.fields) {
      parts.push(this.row(field.label, this.control(node, field, inferred.has(field.id))));
      if (field.infer && node.values[field.id]) parts.push(this.help(t('inspector.inferHelp', { pin: field.infer.from })));
    }
    return [...parts, ...inputs];
  }

  // Entradas de dados com valor (o tipo tem editor): o campo do tipo, ou, com fio, de onde vem.
  inputSection(node) {
    const pins = shownPins(node, 'in').filter((p) => p.kind === 'data' && editorOf(this.scene.typeDef(p)));
    const parts = [];
    if (pins.length) {
      parts.push(this.section('Inputs'), ...pins.map((pin) => this.row(pin.label || pin.id, this.inputControl(node, pin))));
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
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Disconnect';
      button.addEventListener('click', () => {
        this.scene.disconnect([from.wire.id]);
        this.onChange();
        this.signature = null;
        this.refresh();
      });
      wrap.append(icon, origin, button);
      return wrap;
    }
    const type = this.scene.typeDef(pin);
    const value = this.scene.inputValue(node, pin);
    const set = (raw) => {
      this.scene.setInputValue(node, pin.id, raw);
      this.onChange();
    };
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
          const input = number(value[i], 'any', () => set(parts.map((p) => p.input.value)));
          label.append(span, input);
          return { label, input };
        });
        wrap.append(...parts.map((p) => p.label));
        return wrap;
      }
      default: {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = value ?? '';
        input.addEventListener('input', () => set(input.value));
        return input;
      }
    }
  }

  // Referência: de onde vem; quebrada ou fora do alcance, o aviso e a lista para religar.
  referenceSection(node) {
    const target = this.scene.byId(node.ref);
    if (target && !node.outOfReach) return [this.help(t('inspector.reference', { name: target.title }))];
    const parts = [this.warning(target ? t('inspector.outOfReach', { name: target.title }) : t('inspector.broken'))];
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
      const select = document.createElement('select');
      for (const [id, type] of Object.entries(this.language.types ?? {})) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = type.label ?? id;
        select.append(option);
      }
      select.value = node.values[field.id];
      select.disabled = locked;
      select.addEventListener('change', () => set(select.value));
      return select;
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.value = node.values[field.id] ?? '';
    input.addEventListener('input', () => set(input.value));
    return input;
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
