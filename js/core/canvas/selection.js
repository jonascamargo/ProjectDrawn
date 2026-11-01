// Seleção: por clique e por retângulo, sempre dentro de um escopo (área onde começou).

export function rectFromPoints(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

// Como no CAD: da esquerda para a direita pega o que fica inteiro dentro; ao contrário, o que toca.
export function boxMode(start, end) {
  return end.x >= start.x ? 'inside' : 'touch';
}

export function contains(rect, el) {
  return el.x >= rect.x && el.y >= rect.y && el.x + el.w <= rect.x + rect.w && el.y + el.h <= rect.y + rect.h;
}

export function intersects(rect, el) {
  return el.x <= rect.x + rect.w && el.x + el.w >= rect.x && el.y <= rect.y + rect.h && el.y + el.h >= rect.y;
}

// Ids dos elementos do escopo pegos pelo retângulo de start até end.
export function pickInBox(elements, start, end, scope) {
  const rect = rectFromPoints(start, end);
  const test = boxMode(start, end) === 'inside' ? contains : intersects;
  return elements.filter((el) => el.scope === scope && test(rect, el)).map((el) => el.id);
}

export class Selection {
  constructor() {
    this.ids = new Set();
  }

  has(id) {
    return this.ids.has(id);
  }

  set(ids) {
    this.ids = new Set(ids);
  }

  toggle(id) {
    if (this.ids.has(id)) this.ids.delete(id);
    else this.ids.add(id);
  }

  clear() {
    this.ids.clear();
  }

  get size() {
    return this.ids.size;
  }
}
