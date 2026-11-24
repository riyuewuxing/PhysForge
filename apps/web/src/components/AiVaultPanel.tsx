import React, { useEffect, useRef, useState } from 'react';
import { decryptAiVault, VAULT_MAX_BYTES, type AiVaultProfile } from '../security/aiVault.js';
import {
  forgetEncryptedAiVault, getEncryptedAiVault, getUnlockedAiProfiles, lockAiVault,
  rememberEncryptedAiVault, setUnlockedAiProfiles
} from '../security/aiVaultSession.js';

interface Props {
  busy: boolean;
  onActivate: (profile: AiVaultProfile) => void;
  onLock: () => void;
  onBusy: (busy: boolean) => void;
  lockRevision: number;
}

export function AiVaultPanel({ busy, onActivate, onLock, onBusy, lockRevision }: Props) {
  const [raw, setRaw] = useState(getEncryptedAiVault);
  const [profiles, setProfiles] = useState(getUnlockedAiProfiles);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const alive = useRef(true);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; request.current?.abort(); };
  }, []);
  useEffect(() => {
    setProfiles(getUnlockedAiProfiles());
    setPassword('');
  }, [lockRevision]);
  const start = () => { setWorking(true); onBusy(true); setMessage(''); };
  const finish = () => { if (alive.current) { setWorking(false); onBusy(false); } };
  const blocked = busy || working;
  const importRaw = (text: string) => {
    const retained = rememberEncryptedAiVault(text);
    onLock();
    setRaw(getEncryptedAiVault());
    setProfiles([]);
    setPassword('');
    setMessage(retained ? '密文已导入并缓存；请解锁。' : '密文已导入，但浏览器缓存不可用；刷新后需重新导入。');
  };
  const importFile = async (file: File | undefined) => {
    if (!file || file.size > VAULT_MAX_BYTES) { setMessage('请选择不超过 128 KiB 的加密文件。'); return; }
    start();
    try {
      const text = await file.text();
      if (alive.current) importRaw(text);
    } catch { if (alive.current) setMessage('导入失败：不是受支持的加密保险库。'); }
    finally { finish(); }
  };
  const loadCloud = async () => {
    start();
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const url = new URL('ai-vault.enc.json', new URL(import.meta.env.BASE_URL, window.location.origin));
      if (url.origin !== window.location.origin) throw new Error('Invalid origin');
      const response = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal, referrerPolicy: 'no-referrer' });
      if (!response.ok || !response.body) throw new Error('Unavailable');
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let size = 0, text = '';
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > VAULT_MAX_BYTES) throw new Error('Oversized');
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { await reader.cancel().catch(() => {}); }
      if (alive.current) importRaw(text);
    } catch { if (alive.current) setMessage('本站尚无可读取的云端密文，或网络不可用；可直接导入本地密文。'); }
    finally { clearTimeout(timeout); request.current = null; finish(); }
  };
  const unlock = async () => {
    if (!raw || !password) return;
    start();
    try {
      const value = await decryptAiVault(raw, password);
      if (!alive.current || !value[0]) return;
      setUnlockedAiProfiles(value);
      setProfiles(value);
      onActivate(value[0]);
      setMessage('已在当前页面解锁。不会自动发起付费请求。');
    } catch { if (alive.current) setMessage('解锁失败：密码错误、文件损坏或格式不受支持。'); }
    finally { if (alive.current) setPassword(''); finish(); }
  };
  const lock = () => {
    lockAiVault(); onLock(); setProfiles([]); setPassword(''); setMessage('已锁定，解密配置已从页面状态移除。');
  };
  const forget = () => {
    const removed = forgetEncryptedAiVault();
    onLock(); setProfiles([]); setRaw(null); setPassword('');
    setMessage(removed ? '已删除本浏览器的密文缓存。' : '缓存删除未确认，请清理站点数据。');
  };
  const buttonStyle = { borderColor: 'var(--pf-border)' };
  const buttonClass = 'rounded-lg border px-2 py-1 disabled:opacity-50';
  return (
    <details data-testid="ai-vault-panel" className="rounded-xl border p-3 text-xs" style={buttonStyle}>
      <summary className="cursor-pointer font-semibold">AI 密钥保险库 {profiles.length > 0 ? '· 已解锁' : raw ? '· 已缓存密文 / 待解锁' : '· 未配置'}</summary>
      <div className="space-y-2 pt-2">
        <p className="opacity-80">正式密钥请在离线工具中加密。仅缓存密文，刷新或新标签页需输入主密码。开发测试密钥与正式保险库完全独立。</p>
        <div className="flex flex-wrap gap-2">
          <a data-testid="vault-tool-link" href={import.meta.env.BASE_URL + 'ai-vault.html'} download="physforge-ai-vault.html" className={buttonClass} style={buttonStyle}>下载离线加密工具</a>
          <button type="button" data-testid="vault-load-cloud" onClick={() => { void loadCloud(); }} disabled={blocked} className={buttonClass} style={buttonStyle}>读取本站云端密文</button>
        </div>
        <label className="block">导入加密配置文件
          <input data-testid="vault-file" type="file" accept=".json,application/json" disabled={blocked} className="mt-1 block w-full text-xs"
            onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void importFile(file); }}/>
        </label>
        {raw && profiles.length === 0 && <div className="flex flex-wrap items-center gap-2">
          <input data-testid="vault-password" type="password" aria-label="保险库主密码" autoComplete="off" maxLength={1024} placeholder="保险库主密码"
            value={password} disabled={blocked} onChange={e => setPassword(e.target.value)} className="min-w-0 flex-1 rounded-lg border px-2 py-1.5" style={{ ...buttonStyle, background: 'var(--pf-surface-elevated)' }}/>
          <button type="button" data-testid="vault-unlock" disabled={blocked || !password} className={buttonClass} style={buttonStyle} onClick={() => { void unlock(); }}>解锁</button>
        </div>}
        {profiles.length > 0 && <div className="flex flex-wrap gap-2">
          {profiles.map((profile, i) => <button type="button" key={i} data-testid={'vault-profile-' + i} disabled={blocked} className={buttonClass} style={buttonStyle}
            onClick={() => { onActivate(profile); setMessage('已切换到所选服务商配置。'); }}>{profile.name} · {profile.model}</button>)}
          <button type="button" data-testid="vault-lock" onClick={lock} disabled={blocked} className={buttonClass} style={buttonStyle}>锁定保险库</button>
        </div>}
        {raw && <button type="button" data-testid="vault-forget" onClick={forget} disabled={blocked} className={buttonClass} style={buttonStyle}>删除本机密文缓存</button>}
        {message && <p role="status" data-testid="vault-status">{message}</p>}
        <p className="opacity-70">不要在公共设备解锁。网页运行时与浏览器扩展仍可能读取已解密数据；本站云端密文功能不上传文件、不读取 GitHub 私库。</p>
      </div>
    </details>
  );
}
