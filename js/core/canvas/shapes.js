// Formas dos pinos. Cada forma desenha em (x, y) com tamanho size; o tema escolhe a forma de cada tipo de fio.
export const shapes = {
  circle(ctx, x, y, size) {
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
  },
  square(ctx, x, y, size) {
    ctx.beginPath();
    ctx.rect(x - size / 2, y - size / 2, size, size);
  },
  diamond(ctx, x, y, size) {
    const r = size / 2 + 1;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
  },
  triangle(ctx, x, y, size) {
    const r = size / 2 + 1;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.8, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x - r * 0.8, y + r);
    ctx.closePath();
  },
};

// Desenha o contorno da forma; filled preenche (na 1c: pino com fio ligado).
export function drawShape(ctx, name, x, y, size, { color, fill, lineWidth, filled = false }) {
  (shapes[name] ?? shapes.circle)(ctx, x, y, size);
  ctx.fillStyle = filled ? color : fill;
  ctx.fill();
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  ctx.stroke();
}
