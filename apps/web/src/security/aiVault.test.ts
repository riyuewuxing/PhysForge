import { describe, expect, it } from 'vitest';
import { decryptAiVault, encryptAiVault, generateVaultPassword, normalizeVaultProfiles, parseVaultEnvelope } from './aiVault.js';

const password = 'fixture-only-vault-password-2026';
const profiles = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'fixture-key-ds-not-real' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'fixture-key-openai-not-real' }
];
describe('portable AI credential vault', () => {
  it('round-trips multiple profiles and never emits plaintext credentials or password', async () => {
    const raw = await encryptAiVault(profiles, password);
    expect(raw).not.toContain(password);
    for (const p of profiles) expect(raw).not.toContain(p.apiKey);
    expect(await decryptAiVault(raw, password)).toEqual(profiles);
    const second = await encryptAiVault(profiles, password);
    expect(parseVaultEnvelope(raw).salt).not.toBe(parseVaultEnvelope(second).salt);
    expect(parseVaultEnvelope(raw).iv).not.toBe(parseVaultEnvelope(second).iv);
  });
  it('rejects wrong password and authenticated ciphertext tampering', async () => {
    const raw = await encryptAiVault(profiles, password);
    await expect(decryptAiVault(raw, 'wrong-password-fixture-only')).rejects.toThrow('解锁失败');
    const e = parseVaultEnvelope(raw);
    e.ciphertext = (e.ciphertext.startsWith('A') ? 'B' : 'A') + e.ciphertext.slice(1);
    await expect(decryptAiVault(JSON.stringify(e), password)).rejects.toThrow('解锁失败');
  });
  it('rejects insecure endpoints, plaintext extra fields and unbounded KDF inputs', async () => {
    expect(() => normalizeVaultProfiles([{ ...profiles[0], baseUrl: 'http://example.test' }])).toThrow();
    expect(() => normalizeVaultProfiles([{ ...profiles[0], baseUrl: 'https://user:pass@example.test' }])).toThrow();
    await expect(encryptAiVault(profiles, 'short')).rejects.toThrow();
    const e = parseVaultEnvelope(await encryptAiVault(profiles, password));
    expect(() => parseVaultEnvelope(JSON.stringify({ ...e, iterations: 1000000000 }))).toThrow();
    expect(() => parseVaultEnvelope(JSON.stringify({ ...e, plaintext: profiles }))).toThrow();
    expect(generateVaultPassword()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});
