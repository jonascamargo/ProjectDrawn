// Barramento de eventos simples. Módulos se comunicam por aqui sem se importarem diretamente.
export class EventBus {
  #handlers = new Map();

  on(name, handler) {
    if (!this.#handlers.has(name)) this.#handlers.set(name, new Set());
    this.#handlers.get(name).add(handler);
    return () => this.off(name, handler);
  }

  once(name, handler) {
    const off = this.on(name, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off(name, handler) {
    this.#handlers.get(name)?.delete(handler);
  }

  emit(name, payload) {
    const handlers = this.#handlers.get(name);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try {
        handler(payload);
      } catch (error) {
        if (name !== 'error') this.emit('error', error);
      }
    }
  }
}

export const bus = new EventBus();
