import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { ParamRecord, SceneDSL } from '@physforge/sim-sdk';

export type VaultItemKind = 'preset' | 'scene' | 'csv' | 'note';

export interface VaultRecord {
  readonly id: string;
  readonly kind: VaultItemKind;
  readonly modelId: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly updatedAt: string;
  readonly source: 'builtin' | 'user';
  readonly payload: {
    readonly params?: ParamRecord;
    readonly scene?: SceneDSL;
    readonly csvText?: string;
    readonly notes?: string;
    readonly textbookRef?: string;
  };
}

export interface BuiltinPresetAsset {
  readonly id: string;
  readonly modelId: string;
  readonly title: string;
  readonly tags?: readonly string[];
  readonly textbookRef?: string;
  readonly params: ParamRecord;
  readonly notes?: string;
}

export interface DirectoryHandleLike {
  readonly name: string;
  getFileHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<{
    createWritable: () => Promise<{
      write: (data: string | Uint8Array) => Promise<void>;
      close: () => Promise<void>;
    }>;
    getFile: () => Promise<{ text: () => Promise<string> }>;
  }>;
  values?: () => AsyncIterable<{ kind: string; name: string }>;
}

const DB_NAME = 'physforge-workspace-vault-v2';
const STORE_NAME = 'records';
const DB_VERSION = 1;

function openVaultDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB vault.'));
  });
}

function normalizeRecord(raw: unknown): VaultRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj['id'] !== 'string' ||
    typeof obj['modelId'] !== 'string' ||
    typeof obj['title'] !== 'string' ||
    (obj['kind'] !== 'preset' &&
      obj['kind'] !== 'scene' &&
      obj['kind'] !== 'csv' &&
      obj['kind'] !== 'note')
  ) {
    return null;
  }
  return {
    id: obj['id'],
    kind: obj['kind'],
    modelId: obj['modelId'],
    title: obj['title'],
    tags: Array.isArray(obj['tags']) ? obj['tags'].filter((t): t is string => typeof t === 'string') : [],
    updatedAt: typeof obj['updatedAt'] === 'string' ? obj['updatedAt'] : new Date().toISOString(),
    source: obj['source'] === 'builtin' ? 'builtin' : 'user',
    payload:
      obj['payload'] && typeof obj['payload'] === 'object'
        ? (obj['payload'] as VaultRecord['payload'])
        : {}
  };
}

/**
 * PhysForge 本地教研资产库（IndexedDB 优先 + 内存兜底 + FileSystemAccess + fflate ZIP 导入导出）
 */
export class WorkspaceVaultStore {
  private memoryCache = new Map<string, VaultRecord>();

  async listAll(): Promise<VaultRecord[]> {
    const db = await openVaultDb().catch(() => null);
    if (!db) {
      return [...this.memoryCache.values()].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt)
      );
    }

    const records = await new Promise<VaultRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = (req.result as unknown[])
          .map(normalizeRecord)
          .filter((item): item is VaultRecord => item !== null);
        resolve(list);
      };
      req.onerror = () => reject(req.error ?? new Error('Failed to read IndexedDB vault.'));
    });

    this.memoryCache.clear();
    for (const r of records) {
      this.memoryCache.set(r.id, r);
    }
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async put(record: VaultRecord): Promise<void> {
    this.memoryCache.set(record.id, record);
    const db = await openVaultDb().catch(() => null);
    if (!db) return;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('Failed to write IndexedDB vault.'));
    });
  }

  async remove(id: string): Promise<void> {
    this.memoryCache.delete(id);
    const db = await openVaultDb().catch(() => null);
    if (!db) return;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('Failed to delete IndexedDB record.'));
    });
  }

  /**
   * 自动合入仓库内置 `content/presets/` 教研预设，不覆盖用户同名二次修改记录
   */
  async mergeBuiltinAssets(assets: readonly BuiltinPresetAsset[]): Promise<number> {
    const existing = await this.listAll();
    const existingMap = new Map(existing.map((r) => [r.id, r]));
    let importedCount = 0;

    for (const asset of assets) {
      const id = `builtin:${asset.modelId}:${asset.id}`;
      const prev = existingMap.get(id);
      if (prev && prev.source === 'user') {
        continue;
      }
      const rec: VaultRecord = {
        id,
        kind: 'preset',
        modelId: asset.modelId,
        title: asset.title,
        tags: asset.tags ?? [],
        updatedAt: prev?.updatedAt ?? '2026-11-22T00:00:00.000Z',
        source: 'builtin',
        payload: {
          params: asset.params,
          notes: asset.notes,
          textbookRef: asset.textbookRef
        }
      };
      await this.put(rec);
      importedCount += 1;
    }

    return importedCount;
  }

  /**
   * 利用 fflate 将资产库全部（或指定）条目打包为标准 ZIP 二进制压缩包
   */
  async exportZipBytes(filterIds?: ReadonlySet<string>): Promise<Uint8Array> {
    const all = await this.listAll();
    const selected = filterIds ? all.filter((r) => filterIds.has(r.id)) : all;

    const files: Record<string, Uint8Array> = {
      'manifest.json': strToU8(
        JSON.stringify(
          {
            schemaVersion: '2.0',
            exportedAt: new Date().toISOString(),
            recordCount: selected.length
          },
          null,
          2
        )
      )
    };

    for (const rec of selected) {
      const safeName = rec.id.replace(/[^a-zA-Z0-9._-]/g, '_');
      files[`records/${safeName}.json`] = strToU8(JSON.stringify(rec, null, 2));
    }

    return zipSync(files, { level: 6 });
  }

  /**
   * 解析 fflate ZIP 压缩包并合并恢复进入 Vault
   */
  async importZipBytes(zipBytes: Uint8Array): Promise<VaultRecord[]> {
    const extracted = unzipSync(zipBytes);
    const imported: VaultRecord[] = [];

    for (const [entryPath, content] of Object.entries(extracted)) {
      if (!entryPath.startsWith('records/') || !entryPath.endsWith('.json')) {
        continue;
      }
      const parsed: unknown = JSON.parse(strFromU8(content));
      const rec = normalizeRecord(parsed);
      if (!rec) continue;
      await this.put(rec);
      imported.push(rec);
    }

    return imported;
  }

  /**
   * 可选：将全库快照同步写入 FileSystemAccess API 本地教学目录
   */
  async syncToDirectoryHandle(dirHandle: DirectoryHandleLike): Promise<number> {
    const all = await this.listAll();
    const fileHandle = await dirHandle.getFileHandle('physforge-vault-snapshot.json', {
      create: true
    });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(all, null, 2));
    await writable.close();
    return all.length;
  }

  /**
   * 可选：从 FileSystemAccess API 本地教学目录读取并合入资产快照
   */
  async loadFromDirectoryHandle(dirHandle: DirectoryHandleLike): Promise<VaultRecord[]> {
    const fileHandle = await dirHandle.getFileHandle('physforge-vault-snapshot.json');
    const file = await fileHandle.getFile();
    const parsed: unknown = JSON.parse(await file.text());
    if (!Array.isArray(parsed)) return [];
    const imported: VaultRecord[] = [];
    for (const raw of parsed) {
      const rec = normalizeRecord(raw);
      if (!rec) continue;
      await this.put(rec);
      imported.push(rec);
    }
    return imported;
  }
}
