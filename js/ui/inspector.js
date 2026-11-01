import { t } from '../core/i18n.js';

// Inspetor: painel à esquerda com as propriedades do que está selecionado.
//   Nó: os campos da definição (texto, tipo, checkbox). Fio: origem, destino e tipo (só leitura).
// Nomes (rótulos dos campos) vêm em inglês da linguagem; textos de ajuda vêm do idioma.
export class Inspector {
  // onChange(): algo foi editado (o canvas redesenha e o projeto é salvo).
  constructor(parent, { scene, selection, language, onChange = () => {} }) {
    this.scene = scene;
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

  // Redesenha só se a seleção ou o conteúdo selecionado mudou (e não enquanto digita num campo).
  refresh() {
    const signature = this.currentSignature();
    if (signature === this.signature) return;
    if (this.el.contains(document.activeElement) && document.activeElement?.type === 'text') return;
    this.signature = signature;
    this.render();
  }

  currentSignature() {
    const ids = [...this.selection.ids];
    const items = ids.map((id) => {
      const node = this.scene.byId(id);
      if (node) return { id, title: node.title, values: node.values };
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
    if (!node.fields.length) return [...parts, this.help(t('inspector.noFields'))];
    const inferred = new Map(node.fields.filter((f) => f.infer && node.values[f.id]).map((f) => [f.infer.field, f.infer]));
    for (const field of node.fields) {
      parts.push(this.row(field.label, this.control(node, field, inferred.has(field.id))));
      if (field.infer && node.values[field.id]) parts.push(this.help(t('inspector.inferHelp', { pin: field.infer.from })));
    }
    return parts;
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
