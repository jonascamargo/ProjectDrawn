// Formas dos pinos, com cantos arredondados. Cada forma monta o caminho centrado em (x, y)
// cabendo num quadrado de lado size; o tema escolhe a forma de cada tipo de fio.
export const shapes = {
  circle(ctx, x, y, size) {
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
  },
  square(ctx, x, y, size) {
    ctx.beginPath();
    ctx.roundRect(x - size / 2, y - size / 2, size, size, size * 0.28);
  },
  // Quadrado arredondado girado 45°, com a diagonal do tamanho da forma.
  diamond(ctx, x, y, size) {
    const side = size / Math.SQRT2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.roundRect(-side / 2, -side / 2, side, side, side * 0.3);
    ctx.restore();
  },
  // Apontando para a direita; os cantos arredondam pela junção redonda do contorno.
  triangle(ctx, x, y, size) {
    const r = size / 2;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.75, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x - r * 0.75, y + r);
    ctx.closePath();
  },
};

// Desenha a forma no tamanho total size (o contorno fica por dentro); filled preenche (pino com fio).
export function drawShape(ctx, name, x, y, size, { color, fill, lineWidth, filled = false }) {
  (shapes[name] ?? shapes.circle)(ctx, x, y, Math.max(1, size - lineWidth));
  ctx.fillStyle = filled ? color : fill;
  ctx.fill();
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.stroke();
}
