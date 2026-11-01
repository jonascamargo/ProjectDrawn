import { t } from '../../i18n/i18n.js';

// Registro de ações do canvas. Cada ação é um módulo com:
//   id       — identificador único ("item.toggle")
//   area     — área onde atua ('canvas' | 'folder' | 'file' | 'graph' | …), lista de áreas ou '*' (todas)
//   priority — ordem de consulta (maior primeiro; padrão 0)
// e um ou mais gatilhos, cada um com when(ctx) opcional e run(ctx):
//   press    — botão esquerdo pressionado; run pode devolver uma sessão de arraste
//              { move(ctx), up(ctx), cancel(ctx), modifiers(event) }
//   dblclick — duplo clique
//   wheel    — roda do mouse
//   hover    — mouse parado sobre a área; run devolve o cursor (texto) ou true para parar
//   drop     — soltar algo vindo de fora do canvas; accepts(dataTransfer) diz se aceita
//   itemDrop — item do canvas solto dentro de outra área (ctx.target = área de destino)
//   key      — atalho de teclado (keys: ['Ctrl+C', 'Delete']); ignora a área
//   menu     — entrada do menu de contexto: { group, order, label, shortcut, danger,
//              disabled(ctx), checked(ctx) }, ou items(ctx) para várias entradas;
//              open(ctx) abre outra coisa no lugar do menu (condição em openWhen, ou when);
//              prepare(ctx) é chamado antes de montar o menu.
// Um run que devolve false deixa a próxima ação tentar (teclado, roda, soltar).
const actions = [];
let ordered = null;

export const MENU_GROUPS = ['main', 'create', 'import', 'clipboard', 'view', 'danger'];

export function registerActions(list) {
  for (const action of list) {
    if (actions.some((a) => a.id === action.id)) throw new Error(`Ação duplicada: ${action.id}`);
    actions.push(action);
  }
  ordered = null;
}

function matchesArea(action, area) {
  const areas = Array.isArray(action.area) ? action.area : [action.area ?? '*'];
  return areas.includes('*') || areas.includes(area);
}

// Gatilhos de um tipo para a área, na ordem de prioridade (empate = ordem de registro).
export function triggers(kind, area = '*') {
  ordered ??= actions.map((a, i) => ({ a, i })).sort((x, y) => (y.a.priority ?? 0) - (x.a.priority ?? 0) || x.i - y.i).map((x) => x.a);
  const out = [];
  for (const action of ordered) {
    const trigger = action[kind];
    if (!trigger || (kind !== 'key' && !matchesArea(action, area))) continue;
    out.push({ action, trigger });
  }
  return out;
}

// Primeiro gatilho cuja condição vale.
export function firstTrigger(kind, area, ctx) {
  return triggers(kind, area).find(({ trigger }) => !trigger.when || trigger.when(ctx)) ?? null;
}

// Roda os gatilhos em ordem até um tratar (run diferente de false).
export function runFirst(kind, area, ctx) {
  for (const { trigger } of triggers(kind, area)) {
    if (trigger.when && !trigger.when(ctx)) continue;
    const result = trigger.run(ctx);
    if (result !== false) return { handled: true, result };
  }
  return { handled: false };
}

// ---------- teclado ----------

const parsed = new Map();
function parseKey(spec) {
  if (!parsed.has(spec)) {
    const parts = spec.split('+');
    const key = parts.pop().toLowerCase();
    parsed.set(spec, { key, ctrl: parts.includes('Ctrl') });
  }
  return parsed.get(spec);
}

export function keyMatches(trigger, event) {
  const key = (event.key ?? '').toLowerCase();
  const ctrl = event.ctrlKey || event.metaKey;
  return trigger.keys.some((spec) => {
    const k = parseKey(spec);
    return k.key === key && k.ctrl === ctrl;
  });
}

// ---------- menu de contexto ----------

// Monta as entradas do menu da área (grupos separados por linha). Devolve null quando
// uma ação abriu um menu próprio.
export function buildMenu(area, ctx) {
  const list = triggers('menu', area);
  for (const { trigger } of list) trigger.prepare?.(ctx);
  for (const { trigger } of list) {
    const cond = trigger.openWhen ?? trigger.when;
    if (trigger.open && (!cond || cond(ctx))) {
      trigger.open(ctx);
      return null;
    }
  }
  const rows = [];
  for (const { trigger } of list) {
    if (!trigger.run && !trigger.items) continue;
    if (trigger.when && !trigger.when(ctx)) continue;
    const group = trigger.group ?? 'main';
    const entries = trigger.items ? trigger.items(ctx) : [entryOf(trigger, ctx)];
    entries.forEach((entry, i) => rows.push({ group, order: (trigger.order ?? 0) + i / 1000, entry }));
  }
  const rank = (g) => (MENU_GROUPS.includes(g) ? MENU_GROUPS.indexOf(g) : MENU_GROUPS.length);
  rows.sort((a, b) => rank(a.group) - rank(b.group) || a.order - b.order);
  const out = [];
  let last = null;
  for (const row of rows) {
    if (last !== null && row.group !== last) out.push('separator');
    out.push(row.entry);
    last = row.group;
  }
  return out;
}

function entryOf(trigger, ctx) {
  return {
    label: typeof trigger.label === 'function' ? trigger.label(ctx) : t(trigger.label),
    shortcut: trigger.shortcut,
    danger: trigger.danger,
    disabled: trigger.disabled?.(ctx) ?? false,
    checked: trigger.checked?.(ctx) ?? false,
    action: () => trigger.run(ctx),
  };
}
