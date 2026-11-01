// Texto de comentário em bloco e regra de "dentro do comentário".

// Quebra o texto em linhas que cabem na largura (respeita as quebras digitadas).
export function wrapLines(ctx, text, width) {
  const out = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (!line || ctx.measureText(test).width <= width) line = test;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

let measure = null;

// Altura do bloco de texto (0 sem texto).
export function textBlockHeight(text, width, font, lineHeight) {
  if (!String(text ?? '').trim()) return 0;
  measure ??= document.createElement('canvas').getContext('2d');
  measure.font = font;
  return wrapLines(measure, text, width).length * lineHeight + 8;
}

// Fração da área de `inner` que está dentro de `outer` (0–1).
export function overlap(inner, outer) {
  const w = Math.min(inner.x + inner.w, outer.x + outer.w) - Math.max(inner.x, outer.x);
  const h = Math.min(inner.y + inner.h, outer.y + outer.h) - Math.max(inner.y, outer.y);
  const area = inner.w * inner.h;
  return w > 0 && h > 0 && area > 0 ? (w * h) / area : 0;
}

// Faz parte do comentário: mais de 60% da área dentro da caixa.
export const inComment = (rect, box) => overlap(rect, box) > 0.6;

export const CANVAS_COMMENT_LINE = 16;

// Ajeita o conteúdo de um comentário: quem encosta na área do texto (ou em quem já desceu)
// desce só o necessário. members: [{ rect: {x,y,w,h} local, move(novoY) }]. Retorna o novo
// fundo (para a caixa continuar envolvendo tudo).
export function settleUnderText(box, textBottom, members, gap = 8) {
  const hits = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const obstacles = [{ x: box.x, y: box.y, w: box.w, h: textBottom - box.y }];
  let bottom = box.y + box.h;
  for (const m of [...members].sort((a, b) => a.rect.y - b.rect.y)) {
    const r = { ...m.rect };
    for (let guard = 0; guard < 200; guard++) {
      const hit = obstacles.find((o) => hits(o, r));
      if (!hit) break;
      r.y = hit.y + hit.h + gap;
    }
    if (r.y !== m.rect.y) {
      m.move(r.y);
      obstacles.push(r);
    }
    bottom = Math.max(bottom, r.y + r.h + 16);
  }
  return bottom;
}
