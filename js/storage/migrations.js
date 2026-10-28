import { SCHEMA_VERSION } from '../core/project.js';

// Erros de armazenamento com código; a interface traduz por t(`storage.errors.<code>`).
export class StorageError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

// MIGRATIONS[n] converte dados do schema n para n + 1.
const MIGRATIONS = {};

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
