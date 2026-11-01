// Grade de pontos e encaixe.
export function snap(value, step) {
  return Math.round(value / step) * step;
}

// Passo visível da grade: com zoom baixo os pontos ficariam colados, então o passo cresce.
export function visibleStep(step, zoom, { majorEvery = 5, minPx = 8 } = {}) {
  let visible = step;
  while (visible * zoom < minPx) visible *= majorEvery;
  return visible;
}

export function drawGrid(ctx, camera, width, height, style) {
  const step = visibleStep(style.step, camera.zoom, style);
  const major = step * style.majorEvery;
  const size = style.dotSize;
  const start = camera.toWorld(0, 0);
  const end = camera.toWorld(width, height);
  for (let wx = Math.floor(start.x / step) * step; wx <= end.x; wx += step) {
    for (let wy = Math.floor(start.y / step) * step; wy <= end.y; wy += step) {
      const isMajor = Math.abs(wx % major) < 1e-6 && Math.abs(wy % major) < 1e-6;
      const p = camera.toScreen(wx, wy);
      ctx.fillStyle = isMajor ? style.majorDot : style.dot;
      ctx.fillRect(Math.round(p.x) - size / 2, Math.round(p.y) - size / 2, size, size);
    }
  }
}
