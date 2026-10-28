// Breadcrumbs: caminho do item em foco. Cada segmento enquadra a área ao clicar
// e serve como alvo de soltura ao arrastar itens no canvas.
export class Breadcrumbs {
  constructor(element, { onNavigate }) {
    this.element = element;
    this.onNavigate = onNavigate;
    element.addEventListener('click', (event) => {
      const crumb = event.target.closest('.breadcrumbs__item');
      if (crumb) this.onNavigate(crumb.dataset.id || null);
    });
  }

  // segments: [{ id (null = raiz), label, container }]
  render(segments) {
    this.element.replaceChildren();
    segments.forEach((segment, index) => {
      if (index > 0) {
        const sep = document.createElement('span');
        sep.className = 'breadcrumbs__separator';
        sep.textContent = '›';
        this.element.appendChild(sep);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'breadcrumbs__item';
      btn.dataset.id = segment.id ?? '';
      btn.dataset.container = segment.container ? '1' : '';
      btn.textContent = segment.label;
      if (index === segments.length - 1) btn.classList.add('breadcrumbs__item--current');
      this.element.appendChild(btn);
    });
  }

  // Retorna o alvo de soltura sob o ponteiro: { id } (id null = raiz) ou null.
  dropTargetAt(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY)?.closest?.('.breadcrumbs__item');
    if (!el || !this.element.contains(el) || !el.dataset.container) return null;
    return { id: el.dataset.id || null, element: el };
  }

  highlight(id) {
    for (const el of this.element.querySelectorAll('.breadcrumbs__item')) {
      el.classList.toggle('breadcrumbs__item--drop', id !== undefined && (el.dataset.id || null) === id);
    }
  }
}
