import type { ByokConfig } from '@physforge/ai-copilot';
import { parseVaultEnvelope, type AiVaultProfile } from './aiVault.js';

// The only persisted value is a validated authenticated-encryption envelope.
// No master password, plaintext key, or GitHub credentials are persisted here.
const CACHE = 'physforge:ai-vault:encrypted:v1';
let encrypted: string | null = null;
let profiles: AiVaultProfile[] = [];
let activeConfig: ByokConfig | null = null;
let enabled = false;

export function getActiveAiConfig(): ByokConfig | null { return activeConfig; }
export function setActiveAiConfig(config: ByokConfig | null): void { activeConfig = config; }
export function isAiOnlineEnabled(): boolean { return enabled; }
export function setAiOnlineEnabled(value: boolean): void { enabled = value; }
export function getUnlockedAiProfiles(): readonly AiVaultProfile[] { return profiles; }
export function setUnlockedAiProfiles(value: AiVaultProfile[]): void { profiles = value; }
export function lockAiVault(): void {
  profiles = [];
  activeConfig = null;
  enabled = false;
}
export function getEncryptedAiVault(): string | null {
  try {
    const raw = localStorage.getItem(CACHE);
    if (raw) encrypted = JSON.stringify(parseVaultEnvelope(raw));
  } catch { /* unavailable storage or invalid envelope; keep only valid memory value */ }
  return encrypted;
}
export function rememberEncryptedAiVault(raw: string): boolean {
  encrypted = JSON.stringify(parseVaultEnvelope(raw));
  lockAiVault();
  try { localStorage.setItem(CACHE, encrypted); return true; }
  catch { return false; }
}
export function forgetEncryptedAiVault(): boolean {
  encrypted = null;
  lockAiVault();
  try { localStorage.removeItem(CACHE); return true; }
  catch { return false; }
}
