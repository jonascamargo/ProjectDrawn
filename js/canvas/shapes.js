// Primitivas de desenho compartilhadas pelas camadas do canvas.

export function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

// Formatos de pino definidos pelo tema: circle, square, arrow, diamond.
export function drawPin(ctx, shape, x, y, size, color, filled) {
  const s = size / 2;
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
