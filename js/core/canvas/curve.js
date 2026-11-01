// Curva do fio: sai na horizontal da saída (a) e chega na horizontal na entrada (b).
// da / db: para que lado o fio sai de cada ponta (+1 direita, -1 esquerda). Normal: saída
// para a direita, entrada pela esquerda; um reroute virado inverte os dois.
const SAMPLES = 24;

export function controlPoints(a, b, da = 1, db = -1) {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return [a, { x: a.x + dx * da, y: a.y }, { x: b.x + dx * db, y: b.y }, b];
}

export function pointAt([p0, p1, p2, p3], t) {
  const u = 1 - t;
  const x = u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x;
  const y = u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y;
  return { x, y };
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Menor distância do ponto até a curva (aproximada por segmentos).
export function distanceToCurve(p, a, b, da = 1, db = -1) {
  const pts = controlPoints(a, b, da, db);
  let best = Infinity;
  let prev = a;
  for (let i = 1; i <= SAMPLES; i++) {
    const next = pointAt(pts, i / SAMPLES);
    best = Math.min(best, distanceToSegment(p, prev, next));
    prev = next;
  }
  return best;
}
