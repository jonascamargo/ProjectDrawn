// Valores digitados nos pinos de entrada de dados, conforme o editor do tipo (vem da linguagem):
//   'int' (só inteiros), 'float' (número com ponto), 'bool', 'text', 'vector' (components: ['x', 'y', 'z']).
// Tipo sem editor (ex.: any) não tem valor.

export function editorOf(typeDef) {
  return typeDef?.editor ?? null;
}

export function defaultValue(typeDef) {
  switch (editorOf(typeDef)) {
    case 'int':
    case 'float':
      return 0;
    case 'bool':
      return false;
    case 'text':
      return '';
    case 'vector':
      return typeDef.components.map(() => 0);
    default:
      return null;
  }
}

// Converte o que foi digitado (ou um valor antigo de outro tipo) para o tipo; se não der, o padrão.
export function coerceValue(typeDef, raw) {
  const editor = editorOf(typeDef);
  const number = (v) => (typeof v === 'number' ? v : Number.parseFloat(String(v).replace(',', '.')));
  switch (editor) {
    case 'int': {
      const n = Math.trunc(number(raw));
      return Number.isFinite(n) ? n : 0;
    }
    case 'float': {
      const n = number(raw);
      return Number.isFinite(n) ? n : 0;
    }
    case 'bool':
      return raw === true || raw === 'true';
    case 'text':
      return raw == null ? '' : String(raw);
    case 'vector': {
      const list = Array.isArray(raw) ? raw : [];
      return typeDef.components.map((_, i) => {
        const n = number(list[i]);
        return Number.isFinite(n) ? n : 0;
      });
    }
    default:
      return null;
  }
}

// Texto do valor no nó: 5, 1.5 (float sempre com ponto: 2.0), true, "abc", (0, 1, 0).
export function formatValue(typeDef, value) {
  const v = coerceValue(typeDef, value ?? defaultValue(typeDef));
  const float = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
  switch (editorOf(typeDef)) {
    case 'int':
      return String(v);
    case 'float':
      return float(v);
    case 'bool':
      return String(v);
    case 'text':
      return `"${v}"`;
    case 'vector':
      return `(${v.map(float).join(', ')})`;
    default:
      return '';
  }
}
