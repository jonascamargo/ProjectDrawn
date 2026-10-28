// Primitivas de desenho compartilhadas pelas camadas do canvas.

export function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

// Desfoca o que já foi desenhado atrás de um retângulo arredondado (efeito vidro).
// Chamar antes de preencher o fundo da área. `px` é o raio do desfoque em pixels de tela.
export function blurBehind(ctx, x, y, w, h, r, px) {
  if (!px) return;
  const m = ctx.getTransform();
  const canvas = ctx.canvas;
  const pad = px * 2;
  const x0 = Math.max(0, Math.floor(Math.min(m.a * x + m.e, m.a * (x + w) + m.e) - pad));
  const y0 = Math.max(0, Math.floor(Math.min(m.d * y + m.f, m.d * (y + h) + m.f) - pad));
  const x1 = Math.min(canvas.width, Math.ceil(Math.max(m.a * x + m.e, m.a * (x + w) + m.e) + pad));
  const y1 = Math.min(canvas.height, Math.ceil(Math.max(m.d * y + m.f, m.d * (y + h) + m.f) + pad));
  if (x1 <= x0 || y1 <= y0) return;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = `blur(${px * (window.devicePixelRatio || 1)}px)`;
  ctx.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

// Ícone de redimensionar: três riscos diagonais no canto inferior direito (x, y = canto).
export function drawResizeGrip(ctx, x, y, color, zoom) {
  const step = 4;
  ctx.beginPath();
  for (let i = 1; i <= 3; i++) {
    ctx.moveTo(x - 3 - i * step, y - 3);
    ctx.lineTo(x - 3, y - 3 - i * step);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, 1.2 / zoom);
  ctx.stroke();
}

// Formatos de pino definidos pelo tema: circle, square, arrow, diamond, grid (Array), braces (Dictionary).
export function drawPin(ctx, shape, x, y, size, color, filled) {
  const s = size / 2;
  if (shape === 'grid') {
    // Grade 3x3: pino de Array.
    const cell = size / 3;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const cx = x - s + c * cell;
        const cy = y - s + r * cell;
        if (filled) ctx.fillRect(cx + 0.5, cy + 0.5, cell - 1, cell - 1);
        else ctx.strokeRect(cx + 0.5, cy + 0.5, cell - 1, cell - 1);
      }
    }
    return;
  }
  if (shape === 'braces') {
    // Chaves { }: pino de Dictionary.
    ctx.strokeStyle = color;
    ctx.lineWidth = filled ? 2 : 1.5;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.2, y - s);
    ctx.quadraticCurveTo(x - s, y - s, x - s * 0.6, y);
    ctx.quadraticCurveTo(x - s, y + s, x - s * 0.2, y + s);
    ctx.moveTo(x + s * 0.2, y - s);
    ctx.quadraticCurveTo(x + s, y - s, x + s * 0.6, y);
    ctx.quadraticCurveTo(x + s, y + s, x + s * 0.2, y + s);
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  switch (shape) {
    case 'square':
      ctx.rect(x - s, y - s, size, size);
      break;
    case 'diamond':
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s, y);
      ctx.closePath();
      break;
    case 'arrow':
      ctx.moveTo(x - s, y - s);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x - s, y + s);
      ctx.closePath();
      break;
    default:
      ctx.arc(x, y, s, 0, Math.PI * 2);
  }
  if (filled) {
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// Corta o texto com reticências para caber em maxWidth (usa a fonte atual do ctx).
export function fitText(ctx, text, maxWidth) {
  if (maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + '…' : '';
}
