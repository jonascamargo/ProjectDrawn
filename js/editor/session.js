import { bus } from '../core/events.js';
import { Project } from '../core/project.js';
import { t } from '../i18n/i18n.js';
import { loadProfile } from '../lang/profileLoader.js';
import { migrateProjectData, StorageError } from '../storage/migrations.js';
import { syncRecord } from '../storage/projectStore.js';
import { contentHash, parseFileText, serializeProject } from '../storage/importExport.js';
import { fileLastModified, filePermission, readHandle, writeHandle } from '../storage/fileLink.js';
import { linkRecordToFile, uniqueProjectName, unlinkRecord, viewOf } from '../storage/projectService.js';
import { settings } from '../core/settings.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';

const SAVE_DELAY = 1000;
const CAMERA_SAVE_DELAY = 1500;
const SNAPSHOT_INTERVAL = 5 * 60 * 1000;
const THUMBNAIL_INTERVAL = 30 * 1000;

// Projeto aberto no editor: carregar, autosave, arquivo vinculado, conflitos e versões.
//
// saveState: 'saved' | 'savedLocal' (arquivo vinculado pendente) | 'pending' | 'saving' | 'error'
// linkState: 'none' | 'connected' | 'disconnected'
export class ProjectSession {
  #saveTimer = 0;
  #cameraTimer = 0;
  #saving = null;
  #dirty = false;
  #fileTimer = 0;
  #lastFileWrite = 0;
  #lastThumbnail = 0;
  #channel = null;
  #tabId = Math.random().toString(36).slice(2);

  constructor({ store, editor, camera, renderer, history, canvas }) {
    this.store = store;
    this.editor = editor;
    this.camera = camera;
    this.renderer = renderer;
    this.history = history;
    this.canvas = canvas;

    this.record = null;
    this.project = null;
    this.handle = null;
    this.saveState = 'saved';
    this.linkState = 'none';

    bus.on('project:changed', () => this.project && this.scheduleSave());
    bus.on('camera:changed', () => this.project && this.#scheduleCameraSave());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });

    if ('BroadcastChannel' in window) {
      this.#channel = new BroadcastChannel('projectdrawn');
      this.#channel.addEventListener('message', (event) => this.#onChannelMessage(event.data));
    }
  }

  // ---------- abrir / fechar ----------

  async open(id) {
    const record = await this.store.get(id);
    if (!record || record.deletedAt) throw new StorageError('notFound');
    record.data = migrateProjectData(record.data);

    this.record = record;
    this.#dirty = false;
    this.#lastFileWrite = 0;
    this.handle = record.link ? await this.store.handle(id) : null;
    this.linkState = record.link ? (this.handle ? 'disconnected' : 'none') : 'none';
    if (record.link && !this.handle) record.link = null;

    if (this.handle) {
      if ((await filePermission(this.handle, { request: true })) === 'granted') {
        await this.#syncWithFile();
      } else {
        toast.warning(t('storage.reconnectToCheck', { file: record.link.fileName }), { duration: 8000 });
      }
    }

    await loadProfile(record.data.languageProfile).catch(() => toast.error(t('errors.profileLoad')));
    this.project = Project.fromJSON(record.data);
    this.history.clear();
    this.editor.setProject(this.project);
    if (record.camera) this.camera.load(record.camera);
    else {
      this.camera.load({ x: -60, y: -60, zoom: 1 });
    }
    this.renderer.invalidate();
    bus.emit('camera:changed', this.camera);

    if (Date.now() - (record.lastSnapshotAt ?? 0) > SNAPSHOT_INTERVAL) {
      await this.store.addSnapshot(record.id, record.data, 'open');
      record.lastSnapshotAt = Date.now();
      await this.store.save(record);
    }

    this.saveState = 'saved';
    this.#emit();
    this.#channel?.postMessage({ type: 'opened', id, tab: this.#tabId });
  }

  async close() {
    if (!this.project) return;
    await this.flush();
    if (this.#fileBehind()) await this.save({ force: true });
    await this.#captureThumbnail(true);
    clearTimeout(this.#cameraTimer);
    clearTimeout(this.#fileTimer);
    this.#fileTimer = 0;
    this.#dirty = false;
    this.record = null;
    this.project = null;
    this.handle = null;
    this.linkState = 'none';
    this.editor.setProject(null);
    this.history.clear();
    this.#emit();
  }

  // ---------- salvar ----------

  scheduleSave() {
    this.#dirty = true;
    this.saveState = 'pending';
    this.#emit();
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.save(), SAVE_DELAY);
  }

  async flush() {
    if (this.saveState === 'pending') await this.save();
    else if (this.#saving) await this.#saving;
  }

  // O navegador (IndexedDB) é salvo logo após cada alteração. O arquivo vinculado é
  // escrito no máximo a cada `fileSyncMinutes` (configuração do app), ou na hora com
  // force (Ctrl+S, ao fechar o projeto).
  save({ force = false } = {}) {
    clearTimeout(this.#saveTimer);
    if (!this.project) return Promise.resolve();
    // Encadeia para que dois salvamentos nunca escrevam ao mesmo tempo.
    const previous = this.#saving ?? Promise.resolve();
    const current = previous.then(() => this.#doSave(force));
    this.#saving = current.finally(() => {
      if (this.#saving === current) this.#saving = null;
    });
    return this.#saving;
  }

  #fileBehind() {
    return this.linkState === 'connected' && this.record.updatedAt > (this.record.link.syncedAt ?? 0);
  }

  async #doSave(force) {
    const record = this.record;
    if (!record || !this.project) return;
    this.saveState = 'saving';
    this.#emit();
    try {
      if (this.#dirty) {
        this.#dirty = false;
        syncRecord(record, this.project.toJSON());
        record.camera = this.camera.toJSON();
        record.updatedAt = Date.now();
        if (record.updatedAt - (record.lastSnapshotAt ?? 0) > SNAPSHOT_INTERVAL) {
          await this.store.addSnapshot(record.id, record.data, 'periodic');
          record.lastSnapshotAt = record.updatedAt;
        }
        await this.store.save(record);
      }

      this.saveState = 'saved';
      if (this.#fileBehind()) {
        const interval = settings().fileSyncMinutes * 60 * 1000;
        const elapsed = Date.now() - this.#lastFileWrite;
        if (force || elapsed >= interval) {
          clearTimeout(this.#fileTimer);
          this.#fileTimer = 0;
          await this.#writeFile();
          this.#lastFileWrite = Date.now();
        } else {
          this.saveState = 'savedLocal';
          if (!this.#fileTimer) {
            this.#fileTimer = setTimeout(() => {
              this.#fileTimer = 0;
              this.save({ force: true });
            }, interval - elapsed);
          }
        }
      }
      this.#captureThumbnail(false);
    } catch (error) {
      if (error?.name === 'NotAllowedError' && this.linkState === 'connected') {
        // Permissão do arquivo perdida: o local já foi salvo; pede reconexão.
        this.linkState = 'disconnected';
        this.saveState = 'saved';
        toast.warning(t('storage.fileDisconnected'));
      } else {
        this.saveState = 'error';
        toast.error(t('storage.saveFailed', { message: error.message }));
      }
    }
    this.#emit();
  }

  #scheduleCameraSave() {
    clearTimeout(this.#cameraTimer);
    this.#cameraTimer = setTimeout(async () => {
      if (!this.record) return;
      this.record.camera = this.camera.toJSON();
      await this.store.save(this.record).catch(() => {});
    }, CAMERA_SAVE_DELAY);
  }

  // ---------- arquivo vinculado ----------

  // O arquivo mudou fora do app desde a última sincronização?
  // Compara a data e, se ela mudou, o conteúdo (o Google Drive pode tocar a data sem mudar nada).
  async #fileChangedOutside() {
    const record = this.record;
    const lastModified = await fileLastModified(this.handle);
    if (lastModified === record.link.lastModified) return false;
    if (record.link.hash) {
      try {
        const [entry] = parseFileText((await readHandle(this.handle)).text);
        if (contentHash(entry.data) === record.link.hash) {
          record.link.lastModified = lastModified;
          return false;
        }
      } catch {
        // Arquivo ilegível conta como alterado.
      }
    }
    return true;
  }

  async #writeFile() {
    if (await this.#fileChangedOutside()) {
      const keep = await this.#askConflict();
      if (keep === 'file') {
        await this.#loadFromFile();
        return;
      }
    }
    await this.#writeLocalToFile();
  }

  // Ao conectar: compara o arquivo com a cópia local e decide quem prevalece.
  async #syncWithFile() {
    const record = this.record;
    this.linkState = 'connected';
    const fileChanged = await this.#fileChangedOutside();
    const localChanged = record.updatedAt > (record.link.syncedAt ?? 0);

    if (fileChanged && localChanged) {
      const keep = await this.#askConflict();
      if (keep === 'file') await this.#loadFromFile({ applyToEditor: false });
      else await this.#writeLocalToFile();
    } else if (fileChanged) {
      await this.#loadFromFile({ applyToEditor: false });
      toast.info(t('storage.fileChangedLoaded', { file: record.link.fileName }), { duration: 6000 });
    } else if (localChanged) {
      await this.#writeLocalToFile();
    }
  }

  async #writeLocalToFile() {
    const record = this.record;
    record.link.lastModified = await writeHandle(this.handle, serializeProject(record.data, viewOf(record)));
    record.link.syncedAt = record.updatedAt;
    record.link.hash = contentHash(record.data);
    this.#lastFileWrite = Date.now();
    await this.store.save(record);
  }

  async #loadFromFile({ applyToEditor = true } = {}) {
    const record = this.record;
    const { text, lastModified } = await readHandle(this.handle);
    const [entry] = parseFileText(text);
    const data = migrateProjectData(entry.data);
    await this.store.addSnapshot(record.id, record.data, 'beforeFileReload');
    const hash = contentHash(data);
    data.name = await uniqueProjectName(this.store, data.name || record.name, record.id);
    syncRecord(record, data);
    if (entry.view?.camera) record.camera = entry.view.camera;
    record.updatedAt = Date.now();
    record.link.lastModified = lastModified;
    record.link.syncedAt = record.updatedAt;
    record.link.hash = hash;
    await this.store.save(record);

    if (applyToEditor) {
      this.project = Project.fromJSON(record.data);
      this.history.clear();
      this.editor.setProject(this.project);
      toast.info(t('storage.reloadedFromFile'));
    }
  }

  async #askConflict() {
    const result = await openModal({
      title: t('storage.conflictTitle'),
      message: t('storage.conflictMessage', { file: this.record.link.fileName }),
      actions: [
        { id: 'local', label: t('storage.keepLocal'), variant: 'default' },
        { id: 'file', label: t('storage.keepFile'), variant: 'primary', submit: true },
      ],
    });
    return result?.action === 'local' ? 'local' : 'file';
  }

  // Precisa ser chamado a partir de um clique (o navegador exige gesto do usuário).
  async reconnect() {
    if (!this.handle) return;
    const state = await filePermission(this.handle, { request: true });
    if (state !== 'granted') {
      toast.warning(t('storage.permissionDenied'));
      return;
    }
    await this.flush();
    await this.#syncWithFile();
    // O arquivo pode ter trazido dados novos: recarrega o editor a partir do registro.
    if (JSON.stringify(this.project.toJSON()) !== JSON.stringify(this.record.data)) {
      this.project = Project.fromJSON(this.record.data);
      this.history.clear();
      this.editor.setProject(this.project);
    }
    toast.success(t('storage.reconnected', { file: this.record.link.fileName }));
    this.#emit();
  }

  async linkToFile() {
    await this.flush();
    const handle = await linkRecordToFile(this.store, this.record);
    if (!handle) return;
    this.handle = handle;
    this.linkState = 'connected';
    toast.success(t('storage.linked', { file: handle.name }));
    this.#emit();
  }

  async unlink() {
    await unlinkRecord(this.store, this.record);
    this.handle = null;
    this.linkState = 'none';
    toast.info(t('storage.unlinked'));
    this.#emit();
  }

  // ---------- miniatura ----------

  async #captureThumbnail(force) {
    if (!this.record || !this.canvas.width) return;
    if (!force && Date.now() - this.#lastThumbnail < THUMBNAIL_INTERVAL) return;
    this.#lastThumbnail = Date.now();
    const w = 320;
    const h = 180;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const source = this.canvas;
    const scale = Math.max(w / source.width, h / source.height);
    const sw = w / scale;
    const sh = h / scale;
    out.getContext('2d').drawImage(source, (source.width - sw) / 2, (source.height - sh) / 2, sw, sh, 0, 0, w, h);
    await this.store.setThumbnail(this.record.id, out.toDataURL('image/jpeg', 0.7)).catch(() => {});
  }

  // ---------- várias abas ----------

  #onChannelMessage(message) {
    if (!this.record || message?.id !== this.record.id || message.tab === this.#tabId) return;
    if (message.type === 'opened') {
      toast.warning(t('storage.openInOtherTab'), { duration: 8000 });
      this.#channel.postMessage({ type: 'already-open', id: this.record.id, tab: this.#tabId });
    } else if (message.type === 'already-open') {
      toast.warning(t('storage.openInOtherTab'), { duration: 8000 });
    }
  }

  #emit() {
    bus.emit('session:changed', this);
  }
}
