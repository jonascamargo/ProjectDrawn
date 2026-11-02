// Menu de contexto simples (ex.: clique direito num pino): lista de ações, em HTML por cima do canvas.
// Fecha ao escolher, com Esc ou com clique fora.
export class ContextMenu {
  constructor(parent) {
    this.el = document.createElement('ul');
    this.el.className = 'context-menu';
    this.el.hidden = true;
    parent.append(this.el);
    document.addEventListener('pointerdown', (e) => {
      if (!this.el.hidden && !this.el.contains(e.target)) this.close();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (!this.el.hidden && e.key === 'Escape') this.close();
    });
  }

  // items: [{ label, run }]
  open(screen, items) {
    this.el.replaceChildren(...items.map((item) => {
      const li = document.createElement('li');
      li.textContent = item.label;
      li.addEventListener('pointerdown', (e) => {
        e.preventDefault?.();
        this.close();
        item.run();
      });
      return li;
    }));
    this.el.hidden = false;
    this.el.style.left = `${Math.min(screen.x, window.innerWidth - this.el.offsetWidth - 8)}px`;
    this.el.style.top = `${Math.min(screen.y, window.innerHeight - this.el.offsetHeight - 8)}px`;
  }

  close() {
    this.el.hidden = true;
  }
}
