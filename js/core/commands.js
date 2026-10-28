import { bus } from './events.js';

// Toda mutação do projeto passa por um comando para permitir desfazer/refazer.
// Comando: { label, do(), undo(), mergeKey?, merge?(next) }
// - mergeKey: comandos consecutivos com a mesma chave (ex.: arrastar um nó) podem ser fundidos.
// - transaction(): agrupa vários comandos em um único passo do histórico.
export class CommandStack {
  #undo = [];
  #redo = [];
  #transaction = null;

  constructor({ limit = 200, mergeWindow = 800 } = {}) {
    this.limit = limit;
    this.mergeWindow = mergeWindow;
  }

  execute(command) {
    command.do();
    if (this.#transaction) {
      this.#transaction.push(command);
      return;
    }
    this.#push(command);
  }

  #push(command) {
    const now = Date.now();
    const last = this.#undo[this.#undo.length - 1];
    const canMerge =
      last &&
      command.mergeKey &&
      last.mergeKey === command.mergeKey &&
      now - last.time < this.mergeWindow &&
      typeof last.merge === 'function';

    if (canMerge && last.merge(command) !== false) {
      last.time = now;
    } else {
      command.time = now;
      this.#undo.push(command);
      if (this.#undo.length > this.limit) this.#undo.shift();
    }
    this.#redo.length = 0;
    this.#changed();
  }

  transaction(label, fn) {
    if (this.#transaction) return fn();
    const commands = [];
    this.#transaction = commands;
    try {
      fn();
    } catch (error) {
      for (let i = commands.length - 1; i >= 0; i--) commands[i].undo();
      throw error;
    } finally {
      this.#transaction = null;
    }
    if (commands.length) this.#push(composite(label, commands));
  }

  undo() {
    const command = this.#undo.pop();
    if (!command) return null;
    command.undo();
    this.#redo.push(command);
    this.#changed();
    return command;
  }

  redo() {
    const command = this.#redo.pop();
    if (!command) return null;
    command.do();
    this.#undo.push(command);
    this.#changed();
    return command;
  }

  get canUndo() {
    return this.#undo.length > 0;
  }

  get canRedo() {
    return this.#redo.length > 0;
  }

  get undoLabel() {
    return this.#undo[this.#undo.length - 1]?.label ?? '';
  }

  get redoLabel() {
    return this.#redo[this.#redo.length - 1]?.label ?? '';
  }

  clear() {
    this.#undo.length = 0;
    this.#redo.length = 0;
    this.#changed();
  }

  // Comando de "definir propriedade" reutilizável: setProperty(obj, 'name', 'novo', 'Renomear').
  static setProperty(target, key, value, label, mergeKey) {
    const previous = target[key];
    return {
      label,
      mergeKey,
      do: () => {
        target[key] = value;
      },
      undo: () => {
        target[key] = previous;
      },
      merge(next) {
        if (next.target !== target || next.key !== key) return false;
        value = next.value;
        this.do = () => {
          target[key] = value;
        };
      },
      target,
      key,
      value,
    };
  }

  #changed() {
    bus.emit('history:changed', this);
  }
}

function composite(label, commands) {
  return {
    label,
    do: () => commands.forEach((c) => c.do()),
    undo: () => [...commands].reverse().forEach((c) => c.undo()),
  };
}
