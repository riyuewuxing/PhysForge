/**
 * Versioned portable AI credential envelope. Browser and offline HTML use
 * this exact implementation. No network or browser storage in the core.
 */
export interface AiVaultProfile {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}
export interface AiVaultEnvelope {
  version: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: 600000;
  cipher: 'AES-256-GCM';
  salt: string;
  iv: string;
  ciphertext: string;
}
export const VAULT_MAX_BYTES = 128 * 1024;
const ITERATIONS = 600000;
const encoder = new TextEncoder();
const aad = encoder.encode('PhysForge:AI-Vault:v1:PBKDF2-SHA256:600000:AES-256-GCM');
function invalid(): never { throw new Error('无效的保险库格式或参数。'); }
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function exactKeys(record: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(record).length !== keys.length || !keys.every(key => Object.hasOwn(record, key))) invalid();
}
function field(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return invalid();
  return value.trim();
}
export function normalizeVaultProfiles(value: unknown): AiVaultProfile[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return invalid();
  return value.map(item => {
    const rec = object(item);
    exactKeys(rec, ['name', 'baseUrl', 'model', 'apiKey']);
    const profile = { name: field(rec.name, 80), baseUrl: field(rec.baseUrl, 2048),
      model: field(rec.model, 200), apiKey: field(rec.apiKey, 4096) };
    let url: URL;
    try { url = new URL(profile.baseUrl); } catch { return invalid(); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
        url.username || url.password || url.search || url.hash ||
        /\/(?:chat\/completions|models)\/?$/i.test(url.pathname)) return invalid();
    if ([profile.name, profile.baseUrl, profile.model].some(s => s.includes(profile.apiKey))) return invalid();
    return profile;
  });
}
function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return btoa(out);
}
function fromBase64(value: unknown, max: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return invalid();
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (bytes.length > max || toBase64(bytes) !== value) return invalid();
  return bytes;
}
export function parseVaultEnvelope(raw: string): AiVaultEnvelope {
  if (encoder.encode(raw).byteLength > VAULT_MAX_BYTES) return invalid();
  const r = object(JSON.parse(raw) as unknown);
  exactKeys(r, ['version', 'kdf', 'iterations', 'cipher', 'salt', 'iv', 'ciphertext']);
  if (r.version !== 1 || r.kdf !== 'PBKDF2-SHA256' || r.iterations !== ITERATIONS || r.cipher !== 'AES-256-GCM') return invalid();
  const salt = fromBase64(r.salt, 16);
  const iv = fromBase64(r.iv, 12);
  const ct = fromBase64(r.ciphertext, 96 * 1024);
  if (salt.length !== 16 || iv.length !== 12 || ct.length < 16) return invalid();
  return { version: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, cipher: 'AES-256-GCM',
    salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(ct) };
}
function checkPassword(password: string): void {
  if (password.length < 16 || password.length > 1024) throw new Error('保险库密码至少 16 个字符，建议使用随机恢复密码。');
}
async function derive(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  checkPassword(password);
  if (!globalThis.crypto?.subtle) throw new Error('当前环境不支持 Web Crypto，请使用可信浏览器或 HTTPS。');
  const material = encoder.encode(password);
  try {
    const key = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
      key, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { material.fill(0); }
}
export function generateVaultPassword(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(24))).replace(/\+/g, '-').replace(/\//g, '_');
}
export async function encryptAiVault(profiles: unknown, password: string): Promise<string> {
  const normalized = normalizeVaultProfiles(profiles);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(password, salt);
  const plain = encoder.encode(JSON.stringify(normalized));
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, plain);
    const raw = JSON.stringify({ version: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, cipher: 'AES-256-GCM',
      salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) });
    return JSON.stringify(parseVaultEnvelope(raw), null, 2);
  } finally { plain.fill(0); }
}
export async function decryptAiVault(raw: string, password: string): Promise<AiVaultProfile[]> {
  try {
    const e = parseVaultEnvelope(raw);
    const key = await derive(password, fromBase64(e.salt, 16));
    const plain = new Uint8Array(await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: fromBase64(e.iv, 12), additionalData: aad, tagLength: 128
    }, key, fromBase64(e.ciphertext, 96 * 1024)));
    try { return normalizeVaultProfiles(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)) as unknown); }
    finally { plain.fill(0); }
  } catch { throw new Error('解锁失败：密码错误、文件损坏或格式不受支持。'); }
}
