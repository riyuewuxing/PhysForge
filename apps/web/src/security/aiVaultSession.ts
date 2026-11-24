import type { ByokConfig } from '@physforge/ai-copilot';
import { parseVaultEnvelope, type AiVaultProfile } from './aiVault.js';

// The only persisted value is a validated authenticated-encryption envelope.
// No master password, plaintext key, or GitHub credentials are persisted here.
const CACHE = 'physforge:ai-vault:encrypted:v1';
let encrypted: string | null = null;
let memoryOnly = false;
let revision = 0;
const CACHE_EVENT = 'physforge:ai-vault-cache-changed';
let profiles: AiVaultProfile[] = [];
let activeConfig: ByokConfig | null = null;
let enabled = false;

export function getActiveAiConfig(): ByokConfig | null { return activeConfig; }
export function setActiveAiConfig(config: ByokConfig | null): void { activeConfig = config; }
export function isAiOnlineEnabled(): boolean { return enabled; }
export function setAiOnlineEnabled(value: boolean): void { enabled = value; }
export function getUnlockedAiProfiles(): readonly AiVaultProfile[] { return profiles; }
export function setUnlockedAiProfiles(value: AiVaultProfile[]): void { profiles = value; }
export function getAiVaultRevision(): number { return revision; }
export function lockAiVault(): void {
  revision++;
  profiles = [];
  activeConfig = null;
  enabled = false;
}
export function getEncryptedAiVault(): string | null {
  try {
    const raw = localStorage.getItem(CACHE);
    if (!memoryOnly) encrypted = raw ? JSON.stringify(parseVaultEnvelope(raw)) : null;
  } catch { if (!memoryOnly) encrypted = null; }
  return encrypted;
}
export function rememberEncryptedAiVault(raw: string): boolean {
  encrypted = JSON.stringify(parseVaultEnvelope(raw));
  lockAiVault();
  try { localStorage.setItem(CACHE, encrypted); memoryOnly = false; return true; }
  catch { memoryOnly = true; return false; }
}
export function forgetEncryptedAiVault(): boolean {
  encrypted = null;
  memoryOnly = false;
  lockAiVault();
  try { localStorage.removeItem(CACHE); return true; }
  catch { return false; }
}

/** New/removed ciphertext in another tab invalidates old decrypted state, even
 * when the AI drawer is closed. Unlock passwords and keys are never broadcast. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key !== CACHE && event.key !== null) return;
    memoryOnly = false;
    encrypted = null;
    lockAiVault();
    getEncryptedAiVault();
    window.dispatchEvent(new Event(CACHE_EVENT));
  });
}
export function subscribeAiVaultCache(onChange: () => void): () => void {
  window.addEventListener(CACHE_EVENT, onChange);
  return () => window.removeEventListener(CACHE_EVENT, onChange);
}
