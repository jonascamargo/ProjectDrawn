// Registros de projeto sobre um adaptador de armazenamento.
//
// Registro: {
//   id, name, description, languageProfile, itemCount,
//   createdAt, updatedAt, deletedAt (lixeira), lastExportedAt, lastSnapshotAt,
//   camera, data (Project.toJSON()),
//   link: null | { fileName, lastModified, syncedAt }   (arquivo vinculado no disco)
// }

const MAX_SNAPSHOTS = 10;

export function recordFromData(data, extra = {}) {
  const now = Date.now();
  return {
    id: data.id,
    name: data.name,
    description: data.description ?? '',
    languageProfile: data.languageProfile,
    itemCount: data.items.length,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    lastExportedAt: null,
    lastSnapshotAt: 0,
    camera: null,
    data,
    link: null,
    ...extra,
  };
}

// Mantém os campos de resumo do registro em sincronia com os dados.
export function syncRecord(record, data) {
  record.data = data;
  record.name = data.name;
  record.description = data.description ?? '';
  record.languageProfile = data.languageProfile;
  record.itemCount = data.items.length;
  return record;
}

export class ProjectStore {
  constructor(adapter) {
    this.adapter = adapter;
  }

  list() {
    return this.adapter.getAll('projects');
  }

  get(id) {
    return this.adapter.get('projects', id);
  }

  save(record) {
    return this.adapter.put('projects', record);
  }

  async remove(id) {
    for (const snapshot of await this.snapshots(id)) await this.adapter.delete('snapshots', snapshot.key);
    await this.adapter.delete('thumbnails', id);
    await this.adapter.delete('handles', id);
    await this.adapter.delete('projects', id);
  }

  thumbnail(id) {
    return this.adapter.get('thumbnails', id);
  }

  setThumbnail(id, dataUrl) {
    return this.adapter.put('thumbnails', dataUrl, id);
  }

  handle(id) {
    return this.adapter.get('handles', id);
  }

  setHandle(id, handle) {
    return this.adapter.put('handles', handle, id);
  }

  deleteHandle(id) {
    return this.adapter.delete('handles', id);
  }

  async snapshots(id) {
    const list = await this.adapter.getAllByIndex('snapshots', 'projectId', id);
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  // reason: código traduzido na interface (open, periodic, beforeRestore)
  async addSnapshot(id, data, reason) {
    await this.adapter.put('snapshots', { projectId: id, createdAt: Date.now(), reason, data: structuredClone(data) });
    const list = await this.snapshots(id);
    for (const old of list.slice(MAX_SNAPSHOTS)) await this.adapter.delete('snapshots', old.key);
  }
}
