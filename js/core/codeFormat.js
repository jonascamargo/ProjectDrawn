import { expressionNames, externalMember, findPin, functionEntry, nodePins, resolveAction, resolveFile, scopeParams } from './graph.js';
import { getDef } from '../lang/nodeRegistry.js';

// Monta o código equivalente de um nó a partir do modelo `code` da definição.
// {campo} → valor do campo · {pino} → valor padrão ou nó conectado · {args}/{params}/{items}/{pairs}/{annotations}
// {target} sem fio vale `self`, que fica implícito (`{target}.metodo()` → `metodo()`).

// Valor de saída de instruções que declaram um nome (var local, variável do for).
const STATEMENT_VALUES = {
  'var.local': (node) => node.fields?.name,
  'flow.for_range': (node) => node.fields?.var,
  'flow.for_each': (node) => node.fields?.var,
};
const MAX_DEPTH = 16;

// Nó sem pinos de fluxo = expressão pura (operador, função nativa, leitura…).
export function isPureDef(def) {
  return Boolean(def) && ![...(def.inputs ?? []), ...(def.outputs ?? [])].some((p) => p.kind === 'flow');
}

const COMPARISONS = new Set(['op.eq', 'op.neq', 'op.lt', 'op.lte', 'op.gt', 'op.gte', 'op.in', 'op.not']);
const LOGICAL = new Set(['op.and', 'op.or', 'op.not']);

// Parênteses só quando a expressão vira operando de outro operador: (a + b) * 2.
// Argumentos, condições e atribuições não precisam; comparação dentro de and/or também não.
function needsParens(consumer, source) {
  if (!consumer.type.startsWith('op.')) return false;
  if (LOGICAL.has(consumer.type) && COMPARISONS.has(source.type)) return false;
  return true;
}

// Expressão composta ganha parênteses ao entrar em outra (a + b) * 2.
function wrap(code) {
  if (/^[\w."'$-]+$/.test(code) || /^[\w.]+\(.*\)$/.test(code) || /^[[{].*[\]}]$/.test(code)) return code;
  return `(${code})`;
}

function sourceLabel(graph, wire, depth, consumer) {
  const node = graph.nodes.find((n) => n.id === wire.from.node);
  if (!node) return '?';
  const def = getDef(node.type);
  if (node.type === 'var.get' || node.type === 'param.get') return referenceName(graph, node) ?? '?';
  if (def?.template === 'literal') {
    const value = node.fields?.value;
    if (node.type === 'lit.string') return `"${value ?? ''}"`;
    if (node.type === 'lit.null') return 'null';
    if (value !== undefined) return String(value);
  }
  const pin = findPin(node, wire.from.pin, 'out', graph);
  if (STATEMENT_VALUES[node.type] && pin?.kind === 'data') return STATEMENT_VALUES[node.type](node) || '?';
  // Expressão pura: monta o código do nó de origem (recursivo, com limite contra ciclos).
  if (isPureDef(def) && def.code && depth < MAX_DEPTH) {
    const code = formatNodeCode(graph, node, depth + 1);
    return needsParens(consumer, node) ? wrap(code) : code;
  }
  return pin?.label || def?.title || '?';
}

function isConnected(graph, node, pin) {
  return graph.wires.some((w) => w.to.node === node.id && w.to.pin === pin.id);
}

function inputValue(graph, node, pin, depth = 0) {
  const wire = graph.wires.find((w) => w.to.node === node.id && w.to.pin === pin.id);
  if (wire) return sourceLabel(graph, wire, depth, node);
  const value = node.defaults?.[pin.id] ?? pin.default;
  if (value === undefined || value === null || value === '') return pin.label || pin.id;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

// Código do valor que chega num pino de entrada (fio ou valor padrão).
export function inputCode(graph, node, pinId) {
  const pin = findPin(node, pinId, 'in', graph);
  return pin ? inputValue(graph, node, pin) : '';
}

function paramText(param) {
  let text = param.name || '?';
  if (param.type && param.type !== 'Variant') text += `: ${param.type}`;
  if (param.default !== undefined && param.default !== '') text += ` = ${typeof param.default === 'string' ? param.default : JSON.stringify(param.default)}`;
  return text;
}

// Nome exibido de uma referência (variável, parâmetro, função ou sinal).
export function referenceName(graph, node) {
  const ref = node.fields?.ref;
  if (!ref) return null;
  const def = getDef(node.type);
  if (def?.ref === 'function') return functionEntry(graph, ref)?.fields?.name ?? null;
  if (def?.inputAction) return resolveAction(ref)?.name ?? null;
  if (def?.external) return externalMember(node.fields?.file, ref)?.name ?? null;
  if (def?.ref === 'param') return scopeParams(graph, node.scopeId).find((p) => p.id === ref)?.name ?? null;
  return graph.nodes.find((n) => n.id === ref)?.fields?.name ?? null;
}

export function formatNodeCode(graph, node, depth = 0) {
  const value = (pin) => inputValue(graph, node, pin, depth);
  const def = getDef(node.type);
  if (!def?.code) return '';
  const pins = nodePins(node, def, graph);
  const fields = node.fields ?? {};
  const dataInputs = pins.inputs.filter((p) => p.kind === 'data');
  const dynamicInputs = dataInputs.filter((p) => p.dynamic);
  const refName = referenceName(graph, node);

  let code = def.code;
  const target = dataInputs.find((p) => p.id === 'target');
  if (target && !isConnected(graph, node, target)) code = code.replace('{target}.', '');
  // Expressão: o texto, com os nomes ligados por fio trocados pelo valor de origem.
  if (def.expression) {
    let text = String(fields.expression ?? '');
    for (const name of expressionNames(text)) {
      const pin = dataInputs.find((p) => p.id === `x:${name}`);
      if (pin && isConnected(graph, node, pin)) text = text.replace(new RegExp(`(?<![.\\w])${name}(?!\\w)`, 'g'), value(pin));
    }
    return text;
  }
  // return sem valor (função void).
  if (def.returns && !dataInputs.length) code = code.replace(/\s*\{value\}/, '');

  const special = {
    args: () => dynamicInputs.map((p) => value(p)).join(', '),
    params: () => (node.params ?? []).map(paramText).join(', '),
    items: () => dynamicInputs.map((p) => value(p)).join(', '),
    pairs: () => {
      const keys = dynamicInputs.filter((p) => p.id.startsWith('key'));
      const values = dynamicInputs.filter((p) => p.id.startsWith('value'));
      return keys.map((k, i) => `${value(k)}: ${values[i] ? value(values[i]) : ''}`).join(', ');
    },
    annotations: () => `${fields.export ? '@export ' : ''}${fields.onready ? '@onready ' : ''}`,
    // Membro de outro script: Autoload.membro, Classe.CONST ou alvo.membro.
    access: () => {
      const member = externalMember(fields.file, fields.ref);
      if (!member) return '?';
      const target = dataInputs.find((p) => p.id === 'target');
      return `${member.prefix ?? (target ? value(target) : '?')}.${member.name}`;
    },
    // const (arquivo): só nesse nó; em outros, {path} é um pino comum (ex.: preload(path)).
    ...(def.filePath
      ? {
          path: () => {
            const path = resolveFile(fields.ref)?.path ?? '?';
            return fields.mode === 'path' ? `"${path}"` : `preload("${path}")`;
          },
        }
      : {}),
  };

  return code.replace(/\{([\w:.#]+)\}/g, (match, key) => {
    if (key === 'name' && refName) return refName;
    if (special[key]) return special[key]();
    if (key in fields) return String(fields[key] ?? '');
    const pin = dataInputs.find((p) => p.id === key);
    if (pin) return value(pin);
    return match;
  });
}
