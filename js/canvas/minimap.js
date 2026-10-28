import { bus } from '../core/events.js';
import { theme } from '../theme/themeLoader.js';
import { settings, updateSettings } from '../core/settings.js';
import { resolveColor } from './itemLayout.js';
import { isTyping } from './viewportController.js';

// Minimapa no canto inferior direito: miniatura das pastas, arquivos e sub-áreas, com o
// retângulo da vista atual. Clicar/arrastar nele move a câmera. Liga/desliga com M ou pelo
// botão da barra de status (configuração do app `minimap`).
const SIZE = { w: 220, h: 150 };
const MARGIN = 12;

export function minimapVisible() {
  return settings().minimap !== false;
}

export function toggleMinimap() {
  updateSettings({ minimap: !minimapVisible() });
}

export function createMinimap(editor, canvas, camera, renderer) {
  let frame = null; // { box, scale, ox, oy } do último desenho (para converter cliques)

  const toWorld = (sx, sy) => ({ x: (sx - frame.box.x - frame.ox) / frame.scale, y: (sy - frame.box.y - frame.oy) / frame.scale });
  const local = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const inside = (p) => frame && p.x >= frame.box.x && p.y >= frame.box.y && p.x <= frame.box.x + frame.box.w && p.y <= frame.box.y + frame.box.h;
  const moveTo = (p) => {
    const world = toWorld(p.x, p.y);
    camera.centerOn(world.x, world.y, renderer.width, renderer.height);
    renderer.invalidate();
    bus.emit('camera:changed', camera);
  };

  // Captura antes das ferramentas do canvas, para o clique no minimapa não virar seleção.
  let dragging = false;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !minimapVisible() || !inside(local(event))) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
    moveTo(local(event));
  }, { capture: true });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    event.stopImmediatePropagation();
    moveTo(local(event));
  }, { capture: true });
  canvas.addEventListener('pointerup', (event) => {
    if (!dragging) return;
    event.stopImmediatePropagation();
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }, { capture: true });
  window.addEventListener('keydown', (event) => {
    if (event.key?.toLowerCase() !== 'm' || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target) || !editor.project) return;
    toggleMinimap();
  });

  return {
    id: 'minimap',
    order: 30,
    space: 'screen',
    draw(ctx, view) {
      frame = null;
      const layout = editor.layout;
      const th = theme();
      if (!minimapVisible() || !layout || !th || !layout.order.length) return;
      const cfg = th.canvas.item;
      const box = { x: view.width - SIZE.w - MARGIN, y: view.height - SIZE.h - MARGIN, ...SIZE };

      // Limites: tudo o que está desenhado + a vista atual.
      const v = view.visible;
      let minX = v.x, minY = v.y, maxX = v.x + v.width, maxY = v.y + v.height;
      for (const id of layout.order) {
        const r = layout.entries.get(id).rect;
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.w);
        maxY = Math.max(maxY, r.y + r.h);
      }
      const pad = 6;
      const scale = Math.min((box.w - pad * 2) / (maxX - minX || 1), (box.h - pad * 2) / (maxY - minY || 1));
      const ox = pad - minX * scale + ((box.w - pad * 2) - (maxX - minX) * scale) / 2;
      const oy = pad - minY * scale + ((box.h - pad * 2) - (maxY - minY) * scale) / 2;
      frame = { box, scale, ox, oy };
      const map = (r) => ({ x: box.x + ox + r.x * scale, y: box.y + oy + r.y * scale, w: Math.max(1, r.w * scale), h: Math.max(1, r.h * scale) });

      ctx.fillStyle = cfg.background;
      ctx.globalAlpha = 0.92;
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = cfg.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);

      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.w, box.h);
      ctx.clip();
      for (const id of layout.order) {
        const entry = layout.entries.get(id);
        const r = map(entry.rect);
        const accent = resolveColor(th, entry.item.color);
        if (entry.expanded) {
          ctx.strokeStyle = accent ?? cfg.textMuted;
          ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
          for (const scope of entry.graph?.scopes.values() ?? []) {
            const s = map(scope.rect);
            ctx.strokeStyle = scope.color ?? cfg.border;
            ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w, s.h);
          }
        } else {
          ctx.fillStyle = accent ?? cfg.textMuted;
          ctx.fillRect(r.x, r.y, r.w, r.h);
        }
      }
      const vr = map({ x: v.x, y: v.y, w: v.width, h: v.height });
      ctx.strokeStyle = cfg.selected;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vr.x, vr.y, vr.w, vr.h);
      ctx.restore();
    },
  };
}
