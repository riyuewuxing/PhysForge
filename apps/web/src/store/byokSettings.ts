import { validateByokConfig, type ByokConfig } from '@physforge/ai-copilot';

export interface ByokSettings {
  config: ByokConfig;
  enabled: boolean;
}

export interface StoredByokSettings extends ByokSettings {
  revision: string;
}

const DB_NAME = 'physforge-ai-settings-v1';
const STORE = 'settings';
const SLOT = 'active';
const CHANNEL = 'physforge-ai-settings-v1-change';
const AAD = new TextEncoder().encode('PhysForge:BYOK:device:v1');

interface EncryptedRecord {
  version: 1;
  key: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
  enabled: boolean;
  revision: string;
}

export function normalizeByokConfig(value: unknown): ByokConfig {
  if (!value || typeof value !== 'object') throw new Error('Invalid configuration');
  const record = value as Record<string, unknown>;
  if (typeof record.baseUrl !== 'string' || typeof record.apiKey !== 'string' || typeof record.model !== 'string') {
    throw new Error('Invalid configuration');
  }
  const config = {
    baseUrl: record.baseUrl.trim(),
    apiKey: record.apiKey.trim(),
    model: record.model.trim()
  };
  validateByokConfig(config);
  return config;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !globalThis.crypto?.subtle) {
      reject(new Error('Browser secure storage unavailable')); return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Browser storage unavailable'));
    request.onblocked = () => reject(new Error('Browser storage blocked'));
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, done: (value: T) => void) => void
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(new Error('Browser storage transaction failed'));
      try { run(tx.objectStore(STORE), result => { value = result; }); }
      catch { tx.abort(); reject(new Error('Browser storage transaction failed')); }
    });
  } finally { db.close(); }
}

function announce(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage('changed'); // No credential or configuration in messages.
    channel.close();
  } catch { /* Focus re-read remains available. */ }
}

export function subscribeByokSettings(onChange: () => void): () => void {
  let channel: BroadcastChannel | undefined;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = () => onChange();
    }
  } catch { /* Some browsers block cross-tab channels. */ }
  window.addEventListener('focus', onChange);
  return () => { channel?.close(); window.removeEventListener('focus', onChange); };
}

export async function readByokSettings(): Promise<StoredByokSettings | null> {
  const record = await transaction<EncryptedRecord | undefined>('readonly', (store, done) => {
    const request = store.get(SLOT);
    request.onsuccess = () => done(request.result as EncryptedRecord | undefined);
  });
  if (!record) return null;
  if (record.version !== 1 || typeof record.enabled !== 'boolean' || typeof record.revision !== 'string') {
    throw new Error('Invalid stored configuration');
  }
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv, additionalData: AAD }, record.key, record.ciphertext);
  const config = normalizeByokConfig(JSON.parse(new TextDecoder().decode(plain)) as unknown);
  return { config, enabled: record.enabled, revision: record.revision };
}

/**
 * Explicit long-term device save. Non-extractable key and ciphertext live in
 * IndexedDB, not localStorage or the teaching asset Vault. This protects against
 * casual plaintext disclosure, NOT malicious same-origin scripts/extensions.
 */
export async function saveByokSettings(settings: ByokSettings): Promise<StoredByokSettings> {
  const config = normalizeByokConfig(settings.config);
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, new TextEncoder().encode(JSON.stringify(config)));
  const revision = crypto.randomUUID();
  const record: EncryptedRecord = { version: 1, key, iv, ciphertext, enabled: settings.enabled, revision };
  await transaction<void>('readwrite', (store, done) => {
    store.put(record, SLOT);
    done(undefined);
  });
  announce();
  return { config, enabled: settings.enabled, revision };
}

/** Update only mode, not the key or endpoint from a stale tab/draft. */
export async function setStoredByokEnabled(enabled: boolean): Promise<StoredByokSettings | null> {
  await transaction<void>('readwrite', (store, done) => {
    const request = store.get(SLOT);
    request.onsuccess = () => {
      const record = request.result as EncryptedRecord | undefined;
      if (record?.version === 1) store.put({ ...record, enabled, revision: crypto.randomUUID() }, SLOT);
      done(undefined);
    };
  });
  announce();
  return readByokSettings();
}

export async function clearByokSettings(): Promise<void> {
  await transaction<void>('readwrite', (store, done) => {
    store.delete(SLOT);
    done(undefined);
  });
  announce();
}
