import React, { useEffect, useRef, useState } from 'react';
import { Bot, CheckCircle2, Play, Sparkles, X } from 'lucide-react';
import type { ParamRecord } from '@physforge/sim-sdk';
import {
  auditSceneHeadless,
  describeByokError,
  listByokModels,
  validateByokConfig,
  type ByokConfig,
  requestByokSceneCandidate,
  routePhysicsProblemPrompt,
  runGenerateThenRefine,
  synthesizeSceneFromPrompt,
  type RefineLoopResult
} from '@physforge/ai-copilot';

import {
  clearByokSettings, readByokSettings, saveByokSettings, setStoredByokEnabled,
  subscribeByokSettings, type ByokSettings, type StoredByokSettings
} from '../store/byokSettings.js';

interface AiCopilotDrawerProps {
  onApplyScene: (modelId: string, presetId: string | undefined, params: ParamRecord) => void;
  onClose: () => void;
}

const SAMPLE_PROMPTS = [
  '带电粒子射入有界圆形匀强磁场发生磁聚焦',
  '一束紫光照射钠阴极发生光电效应求遏止电压',
  '512格一维高斯波包量子势垒隧穿现象',
  '水平实心球滑滚转换与保龄球倒旋回滚'
] as const;

const BYOK_PROVIDERS = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V4-Flash' },
  { name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-4-hydrogen' }
] as const;


export const AiCopilotDrawer: React.FC<AiCopilotDrawerProps> = ({ onApplyScene, onClose }) => {
  const [prompt, setPrompt] = useState<string>(SAMPLE_PROMPTS[0]);
  const [useByok, setUseByok] = useState(false);
  const [baseUrl, setBaseUrl] = useState<string>(BYOK_PROVIDERS[0].baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState<string>(BYOK_PROVIDERS[0].model);
  const [stored, setStored] = useState<StoredByokSettings | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [storageMsg, setStorageMsg] = useState('');
  const revisionRef = useRef<string | null | undefined>(undefined);
  const saved = stored !== null && stored.config.baseUrl === baseUrl.trim()
    && stored.config.apiKey === apiKey.trim() && stored.config.model === modelName.trim();
  const [models, setModels] = useState<string[]>([]);
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => () => activeRequest.current?.abort(), []);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RefineLoopResult | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ block: 'nearest' });
  }, [result]);

  const [probing, setProbing] = useState(false);
  const [probeMsg, setProbeMsg] = useState('');

  const busy = running || probing || loadingSettings || savingSettings;
  const invalidateResult = () => { setResult(null); setStatusMsg(''); };
  const clearDraftKey = () => {
    setApiKey('');
    setModels([]);
    setProbeMsg('');
    invalidateResult();
  };

  useEffect(() => {
    let disposed = false;
    let seq = 0;
    async function restore() {
      const current = ++seq;
      try {
        const next = await readByokSettings();
        if (disposed || current !== seq || revisionRef.current === (next?.revision ?? null)) return;
        revisionRef.current = next?.revision ?? null;
        activeRequest.current?.abort();
        setRunning(false); setProbing(false);
        setStored(next);
        setUseByok(next?.enabled ?? false);
        setBaseUrl(next?.config.baseUrl ?? BYOK_PROVIDERS[0].baseUrl);
        setApiKey(next?.config.apiKey ?? '');
        setModelName(next?.config.model ?? BYOK_PROVIDERS[0].model);
        setModels([]); setProbeMsg(''); setResult(null); setStatusMsg('');
        setStorageMsg(next ? '已恢复本站保存的配置。' : '');
      } catch {
        if (!disposed && current === seq) setStorageMsg('无法读取浏览器安全存储；可临时使用，长期保存未确认。');
      } finally {
        if (!disposed && current === seq) setLoadingSettings(false);
      }
    }
    void restore();
    const unsubscribe = subscribeByokSettings(() => { void restore(); });
    return () => { disposed = true; unsubscribe(); };
  }, []);

  const config: ByokConfig = { baseUrl, apiKey, model: modelName };
  const persist = async (settings: ByokSettings) => {
    setSavingSettings(true);
    try {
      const next = await saveByokSettings(settings);
      revisionRef.current = next.revision;
      setStored(next);
      setUseByok(next.enabled);
      setBaseUrl(next.config.baseUrl);
      setApiKey(next.config.apiKey);
      setModelName(next.config.model);
      setStorageMsg('已长期保存至本站浏览器，刷新、重开、同源标签页可恢复。');
      return true;
    } catch {
      setStorageMsg('长期保存失败：请检查浏览器存储权限。未确认写入，不会显示已保存。');
      return false;
    } finally { setSavingSettings(false); }
  };
  const handleSave = async () => {
    try { validateByokConfig(config); }
    catch (error) { setStorageMsg(describeByokError(error)); return; }
    await persist({ config, enabled: true });
  };
  const handleMode = async (enabled: boolean) => {
    setProbeMsg(''); invalidateResult();
    if (!stored) { setUseByok(enabled); return; }
    setSavingSettings(true);
    try {
      const next = await setStoredByokEnabled(enabled);
      revisionRef.current = next?.revision ?? null;
      setStored(next);
      setUseByok(next?.enabled ?? false);
      if (!next) { clearDraftKey(); setStorageMsg('已在另一标签页清除配置。'); }
      else if (next.config.apiKey !== stored.config.apiKey || next.config.baseUrl !== stored.config.baseUrl || next.config.model !== stored.config.model) {
        setBaseUrl(next.config.baseUrl); setApiKey(next.config.apiKey); setModelName(next.config.model);
      }
    } catch { setStorageMsg('未能保存在线模式设置；请重试。'); }
    finally { setSavingSettings(false); }
  };
  const clearKey = async () => {
    setSavingSettings(true);
    try {
      await clearByokSettings();
      revisionRef.current = null;
      setStored(null); setUseByok(false); clearDraftKey();
      setBaseUrl(BYOK_PROVIDERS[0].baseUrl); setModelName(BYOK_PROVIDERS[0].model);
      setStorageMsg('本站浏览器保存的密钥已清除。');
    } catch { setStorageMsg('清除失败：请重试或清除该站点的浏览器数据。'); }
    finally { setSavingSettings(false); }
  };
  const handleProbe = async () => {
    const controller = new AbortController();
    activeRequest.current = controller;
    setProbing(true);
    setProbeMsg('');
    setModels([]);
    try {
      const ids = await listByokModels(config, 10_000, fetch, controller.signal);
      if (controller.signal.aborted) return;
      setModels(ids);
      setProbeMsg(ids.includes(modelName.trim())
        ? '模型目录可访问，所选模型在目录中；尚未验证生成能力。'
        : '模型目录可访问；所选名称未列出，请选择目录模型或确认服务商别名。');
    } catch (error) {
      if (!controller.signal.aborted) setProbeMsg(describeByokError(error));
    } finally {
      if (!controller.signal.aborted) setProbing(false);
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  };

  const handleRun = async () => {
    const controller = new AbortController();
    activeRequest.current = controller;
    setRunning(true);
    setResult(null);
    setStatusMsg('');
    try {
      const route = routePhysicsProblemPrompt(prompt);
      if (useByok) {
        validateByokConfig(config);
        const res = await runGenerateThenRefine(
          (_round, feedback) => requestByokSceneCandidate(config, prompt, feedback, controller.signal),
          { maxRounds: 3, steps: 30, dt: 0.02 }
        );
        if (controller.signal.aborted) return;
        setResult(res);
        setStatusMsg(res.accepted ? `BYOK 第 ${res.attempts} 轮通过短程物理审计（不保证题意完全正确）` : `BYOK ${res.attempts} 轮后仍未通过校验`);
      } else {
        const synth = await synthesizeSceneFromPrompt(prompt);
        const audit = await auditSceneHeadless(synth.scene, { steps: 30, dt: 0.02 });
        if (controller.signal.aborted) return;
        setResult({
          accepted: audit.passed,
          attempts: 1,
          finalScene: audit.scene,
          lastAudit: audit,
          history: [{ round: 1, errors: audit.errors }]
        });
        setStatusMsg(`本地三层路由 → ${route.matchedRule}，无头物理内核审计 ${audit.passed ? '通过' : '未通过'}`);
      }
    } catch (err) {
      if (!controller.signal.aborted) setStatusMsg(describeByokError(err));
    } finally {
      if (!controller.signal.aborted) setRunning(false);
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  };

  return (
    <div
      data-testid="ai-copilot-drawer"
      className="fixed inset-0 z-50 flex items-center justify-end bg-slate-950/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl h-full border-l p-5 flex flex-col gap-4 overflow-y-auto"
        style={{ backgroundColor: 'var(--pf-bg)', borderColor: 'var(--pf-border)', color: 'var(--pf-text)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'var(--pf-border)' }}>
          <div className="flex items-center gap-2 font-bold text-base">
            <Bot className="w-5 h-5 text-sky-400" />
            <span>AI 逆向建模与物理防幻觉审计台</span>
          </div>
          <button
            type="button"
            data-testid="btn-close-ai-copilot"
            onClick={onClose}
            className="p-1.5 rounded-lg border cursor-pointer"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold opacity-80">快捷物理题干样例：</div>
          <div className="flex flex-wrap gap-1.5">
            {SAMPLE_PROMPTS.map((sp) => (
              <button
                key={sp}
                type="button"
                disabled={busy}
                onClick={() => { setPrompt(sp); invalidateResult(); }}
                className="text-xs px-2.5 py-1 rounded-lg border cursor-pointer hover:opacity-90"
                style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
              >
                {sp}
              </button>
            ))}
          </div>
          <textarea
            data-testid="ai-prompt-input"
            value={prompt}
            disabled={busy}
            onChange={(e) => { setPrompt(e.target.value); invalidateResult(); }}
            rows={3}
            className="w-full rounded-xl border p-3 text-sm"
            style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
            placeholder="输入物理题干、实验描述或自定义 ODE 公式..."
          />
        </div>

        <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--pf-border)' }}>
          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
            <input data-testid="byok-enabled" type="checkbox" checked={useByok} disabled={busy} onChange={(e) => { void handleMode(e.target.checked); }} />
            <span>启用可选 BYOK 外部大模型 API（Generate-then-Refine 3 轮自修正；默认离线规则引擎）</span>
          </label>
          {!useByok && stored && <div className="flex items-center justify-between gap-2 text-xs opacity-80"><span>在线模式已关闭；本站浏览器仍保留已保存配置。</span><button type="button" data-testid="btn-clear-offline-byok" onClick={clearKey} disabled={busy} className="rounded-lg border px-2 py-1" style={{ borderColor: 'var(--pf-border)' }}>清除密钥</button></div>}
          {loadingSettings && <div className="text-xs opacity-80">正在读取本站配置…</div>}
          {storageMsg && <div role="status" data-testid="byok-storage-status" className="text-xs">{storageMsg}</div>}
          {useByok && (
            <div className="grid grid-cols-1 gap-2 pt-1 text-xs">
              <div className="flex flex-wrap gap-1.5">
                {BYOK_PROVIDERS.map((provider) => (
                  <button
                    key={provider.name}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (baseUrl.trim().replace(/\/+$/, '') !== provider.baseUrl) clearDraftKey();
                      invalidateResult();
                      setBaseUrl(provider.baseUrl);
                      setModelName(provider.model);
                      setProbeMsg('');
                    }}
                    className="rounded-lg border px-2 py-1 disabled:opacity-50"
                    style={{ borderColor: 'var(--pf-border)' }}
                  >
                    {provider.name}
                  </button>
                ))}
              </div>
              <div className="opacity-80">仅使用信任的 API 地址。更改地址会清空当前输入框，旧配置不自动发送到新地址。长期保存不能防御恶意同源脚本或浏览器扩展，请仅在自己的可信设备使用。</div>
              <input
                data-testid="byok-base-url"
                aria-label="API Base URL"
                value={baseUrl}
                disabled={busy}
                onChange={(e) => { setBaseUrl(e.target.value); clearDraftKey(); }}
                placeholder="OpenAI Compatible Base URL"
                className="rounded-lg border px-2.5 py-1.5"
                style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
              />
              <input
                data-testid="byok-api-key"
                aria-label="API Key"
                autoComplete="off"
                type="password"
                value={apiKey}
                disabled={busy}
                onChange={(e) => { setApiKey(e.target.value); setProbeMsg(''); setModels([]); invalidateResult(); }}
                placeholder="API Key（随请求发送至所填服务商）"
                className="rounded-lg border px-2.5 py-1.5"
                style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
              />
              <input
                data-testid="byok-model"
                aria-label="模型名称"
                value={modelName}
                disabled={busy}
                onChange={(e) => { setModelName(e.target.value); setProbeMsg(''); invalidateResult(); }}
                placeholder="Model name"
                className="rounded-lg border px-2.5 py-1.5"
                style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
              />

              <div className="flex flex-wrap gap-1.5">
                {baseUrl.trim().replace(/\/+$/, '') === BYOK_PROVIDERS[0].baseUrl && ['deepseek-flash', 'deepseek-v4-pro'].map(id => (
                  <button key={id} type="button" disabled={busy}
                    onClick={() => { setModelName(id); setProbeMsg(''); invalidateResult(); }}
                    className="rounded-lg border px-2 py-1" style={{ borderColor: 'var(--pf-border)' }}>{id}</button>
                ))}
              </div>
              {models.length > 0 && (
                <select data-testid="byok-model-list" aria-label="服务商模型目录" value={models.includes(modelName) ? modelName : ''}
                  disabled={busy}
                  onChange={e => { if (e.target.value) { setModelName(e.target.value); setProbeMsg(''); invalidateResult(); } }}
                  className="rounded-lg border px-2.5 py-1.5" style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}>
                  <option value="">从服务商目录选择模型</option>
                  {models.map(id => <option key={id} value={id}>{id}</option>)}
                </select>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" data-testid="btn-save-byok" disabled={busy || !apiKey.trim()}
                  onClick={handleSave} className="rounded-lg border px-2.5 py-1.5 disabled:opacity-50" style={{ borderColor: 'var(--pf-border)' }}>
                  {saved ? '已长期保存（本站浏览器）' : '长期保存（本站浏览器）'}
                </button>
                <button type="button" data-testid="btn-clear-byok" disabled={busy}
                  onClick={clearKey} className="rounded-lg border px-2.5 py-1.5 disabled:opacity-50" style={{ borderColor: 'var(--pf-border)' }}>清除密钥</button>
              </div>
              <div className="opacity-80">保存后同一浏览器的本站页面共享配置；密钥经 Web Crypto 加密写入 IndexedDB，不写入 URL、localStorage、教学资产或日志。清除站点数据会删除配置。运行建模最多 3 次付费请求。</div>
              <button
                type="button"
                data-testid="btn-test-byok-connection"
                disabled={busy || !baseUrl.trim() || !apiKey.trim()}
                onClick={handleProbe}
                className="rounded-lg border px-2.5 py-1.5 disabled:opacity-50"
                style={{ borderColor: 'var(--pf-border)' }}
              >
                {probing ? '正在测试连通性...' : '测试连通性'}
              </button>
              {probeMsg && <div role="status" data-testid="byok-probe-status">{probeMsg}</div>}
            </div>
          )}
        </div>

        <button
          type="button"
          data-testid="btn-run-ai-copilot"
          disabled={busy || !prompt.trim() || (useByok && (!apiKey.trim() || !baseUrl.trim() || !modelName.trim()))}
          onClick={handleRun}
          className="pf-touch-target inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-sm bg-sky-500 text-slate-950 cursor-pointer disabled:opacity-50"
        >
          <Sparkles className="w-4 h-4" />
          <span>{running ? '正在无头物理验算与自修正...' : useByok ? '在线生成 + 物理审计（消耗 API 额度）' : '离线生成 SceneDSL + 物理审计'}</span>
        </button>

        {useByok && !apiKey.trim() && <div className="text-xs opacity-80">请输入 API Key，或取消在线模式使用离线建模。</div>}
        {statusMsg && (
          <div data-testid="byok-run-status" role="status" className="text-xs px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--pf-border)' }}>
            {statusMsg}
          </div>
        )}

        {result && !result.accepted && <ul className="text-xs list-disc pl-5">
          {result.lastAudit.errors.map((error, i) => <li key={i}>{error}</li>)}
        </ul>}
        {result?.finalScene && (
          <div ref={resultRef} data-testid="byok-result-card" className="rounded-xl border p-3 space-y-2 text-xs" style={{ borderColor: 'var(--pf-border)' }}>
            <div className="flex items-center justify-between">
              <span className={`font-bold flex items-center gap-1 ${result.accepted ? 'text-emerald-400' : 'text-amber-400'}`}>
                {result.accepted && <CheckCircle2 className="w-4 h-4" />}
                模型: {result.finalScene.modelId}
              </span>
              <button
                type="button"
                data-testid="btn-apply-ai-scene"
                disabled={!result.accepted || running || probing}
                onClick={() => {
                  if (!result.accepted || !result.finalScene) return;
                  onApplyScene(
                    result.finalScene!.modelId,
                    result.finalScene!.presetId,
                    result.finalScene!.params as ParamRecord
                  );
                  onClose();
                }}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-500 text-slate-950 font-semibold cursor-pointer disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" />
                <span>一键载入工作台</span>
              </button>
            </div>
            <pre className="p-2 rounded-lg overflow-x-auto max-h-48 bg-slate-950/50">
              {JSON.stringify(result.finalScene, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

export default AiCopilotDrawer;
