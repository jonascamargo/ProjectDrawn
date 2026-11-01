import { SCHEMA_VERSION } from '../core/project.js';
import { uid } from '../core/ids.js';

// Erros de armazenamento com código; a interface traduz por t(`storage.errors.<code>`).
export class StorageError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

// MIGRATIONS[n] converte dados do schema n para n + 1.
const MIGRATIONS = {
  // 1 → 2: caixinhas @export/@onready da variável viram nós de anotação ligados ao "valor".
  1: (data) => {
    for (const item of data.items) {
      const graph = item.graph;
      if (!graph?.nodes) continue;
      for (const decl of [...graph.nodes]) {
        const f = decl.fields ?? {};
        if (decl.type !== 'var.member' || (!f.export && !f.onready)) continue;
        const types = [f.export && 'anno.export', f.onready && 'anno.onready'].filter(Boolean);
        const notes = types.map((type, i) => ({ id: uid('nd'), type, scopeId: decl.scopeId ?? null, x: decl.x - 230 * (types.length - i), y: decl.y, fields: {}, defaults: {} }));
        graph.nodes.push(...notes);
        // O valor (fio ou digitado) passa a entrar na primeira anotação.
        for (const w of graph.wires) if (w.to.node === decl.id && w.to.pin === 'value') w.to = { node: notes[0].id, pin: 'value' };
        if (decl.defaults?.value !== undefined) {
          notes[0].defaults.value = decl.defaults.value;
          delete decl.defaults.value;
        }
        notes.forEach((note, i) => {
          const to = notes[i + 1] ?? decl;
          graph.wires.push({ id: uid('wr'), kind: 'data', from: { node: note.id, pin: 'out' }, to: { node: to.id, pin: 'value' } });
        });
        delete f.export;
        delete f.onready;
      }
    }
    return data;
  },
};

export function migrateProjectData(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.items) || !data.id) {
    throw new StorageError('invalidProject');
  }
  let version = data.schemaVersion ?? 1;
  if (version > SCHEMA_VERSION) throw new StorageError('newerVersion');
  let migrated = data;
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new StorageError('missingMigration', String(version));
    migrated = step(migrated);
    version += 1;
    migrated.schemaVersion = version;
  }
  return migrated;
}
