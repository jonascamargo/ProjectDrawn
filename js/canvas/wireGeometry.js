// Geometria de fios como polilinha (usada para desenhar e para clique).
// route: 'bezier' | 'orthogonal' | 'straight' (definido no tema por tipo de fio)

const BEZIER_SEGMENTS = 32;
const ORTHO_GAP = 20;

export function wirePoints(a, b, route = 'bezier') {
  if (route === 'straight') return [a, b];

  if (route === 'orthogonal') {
    if (b.x >= a.x + ORTHO_GAP * 2) {
      const mx = (a.x + b.x) / 2;
      return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
    }
    const my = (a.y + b.y) / 2;
    return [
      a,
      { x: a.x + ORTHO_GAP, y: a.y },
      { x: a.x + ORTHO_GAP, y: my },
      { x: b.x - ORTHO_GAP, y: my },
      { x: b.x - ORTHO_GAP, y: b.y },
      b,
    ];
  }

  const dx = Math.max(50, Math.abs(b.x - a.x) * 0.5);
  const c1 = { x: a.x + dx, y: a.y };
  const c2 = { x: b.x - dx, y: b.y };
  const points = [];
  for (let i = 0; i <= BEZIER_SEGMENTS; i++) {
    const t = i / BEZIER_SEGMENTS;
    const u = 1 - t;
    points.push({
      x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
    });
  }
  return points;
}

export function distanceToPolyline(p, points) {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) best = Math.min(best, distanceToSegment(p, points[i - 1], points[i]));
  return best;
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Ponto na fração `at` (0..1) do comprimento da polilinha.
export function pointAlong(points, at = 0.5) {
  const lengths = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    lengths.push(l);
    total += l;
  }
  let target = total * at;
  for (let i = 1; i < points.length; i++) {
    const l = lengths[i - 1];
    if (target <= l || i === points.length - 1) {
      const t = l ? Math.min(1, target / l) : 0;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      };
    }
    target -= l;
  }
  return points[0];
}
