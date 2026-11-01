import { t } from './i18n.js';
import { kindsConnect, wireKindLabel } from './wireKinds.js';

// Regras de ligação entre pinos. A e B são { node, pin }, em qualquer ordem.
// language.canAssign(tipoSaída, tipoEntrada) decide os tipos de dado (padrão: o mesmo tipo).
// Resposta: { ok: true, from, to } (from = lado da saída) ou { ok: false, reason } (reason no idioma de ajuda).
export function canConnect(a, b, language = {}) {
  if (a.node === b.node) return { ok: false, reason: t('wire.sameNode') };
  if (a.pin.direction === b.pin.direction) {
    return { ok: false, reason: t(a.pin.direction === 'in' ? 'wire.inToIn' : 'wire.outToOut') };
  }
  const [from, to] = a.pin.direction === 'out' ? [a, b] : [b, a];
  if (!kindsConnect(from.pin.kind, to.pin.kind)) {
    return { ok: false, reason: t('wire.kindMismatch', { from: wireKindLabel(from.pin.kind), to: wireKindLabel(to.pin.kind) }) };
  }
  const outType = from.pin.type;
  const inType = to.pin.type;
  if (outType && inType) {
    const assign = language.canAssign ?? ((x, y) => x === y);
    if (!assign(outType, inType)) {
      const label = (t) => language.types?.[t]?.label ?? t;
      return { ok: false, reason: t('wire.typeMismatch', { to: label(inType), from: label(outType) }) };
    }
  }
  return { ok: true, from, to };
}

// Primeiro pino do nó que liga com a origem ({ node, pin }), ou null.
export function firstCompatiblePin(node, origin, language) {
  return [...node.inputs, ...node.outputs].find((pin) => canConnect(origin, { node, pin }, language).ok) ?? null;
}

// Definição de um reroute no fio de `from` para `to`: a entrada copia o pino de destino e a
// saída copia o pino de origem, então o que passava pelo fio continua passando.
export function rerouteDef(fromPin, toPin) {
  return {
    id: 'reroute',
    title: '',
    reroute: true,
    inputs: [{ id: 'in', kind: toPin.kind, type: toPin.type }],
    outputs: [{ id: 'out', kind: fromPin.kind, type: fromPin.type }],
  };
}
