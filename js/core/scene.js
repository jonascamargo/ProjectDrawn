import { createNode, pinAt } from './node.js';

// Elementos do canvas (nós). Cada elemento pertence a um escopo
// (por enquanto só 'root'; na etapa 2 as áreas viram escopos).
export const ROOT = 'root';

export class Scene {
  // layout(node): calcula tamanho e posição dos pinos (quem sabe medir texto é o desenho).
  constructor({ layout = () => {} } = {}) {
    this.elements = [];
    this.nextId = 1;
    this.layout = layout;
  }

  addNode(def, { x, y, scope = ROOT }) {
    const node = createNode(def, { id: this.nextId++, x, y, scope });
    this.layout(node);
    this.elements.push(node);
    return node;
  }

  byId(id) {
    return this.elements.find((el) => el.id === id);
  }

  remove(ids) {
    const gone = new Set(ids);
    this.elements = this.elements.filter((el) => !gone.has(el.id));
  }

  inScope(scope) {
    return this.elements.filter((el) => el.scope === scope);
  }

  // Elemento mais acima no ponto (o último desenhado ganha).
  hitTest(p) {
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      if (p.x >= el.x && p.x <= el.x + el.w && p.y >= el.y && p.y <= el.y + el.h) return el;
    }
    return null;
  }

  // Pino perto do ponto, no nó mais acima: { node, pin } ou null.
  pinAt(p, radius) {
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const pin = pinAt(this.elements[i], p, radius);
      if (pin) return { node: this.elements[i], pin };
    }
    return null;
  }

  // Escopo do ponto: onde uma seleção por retângulo começa.
  scopeAt() {
    return ROOT;
  }

  bounds(elements = this.elements) {
    if (!elements.length) return null;
    const x = Math.min(...elements.map((el) => el.x));
    const y = Math.min(...elements.map((el) => el.y));
    const right = Math.max(...elements.map((el) => el.x + el.w));
    const bottom = Math.max(...elements.map((el) => el.y + el.h));
    return { x, y, w: right - x, h: bottom - y };
  }
}
