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

// Explicitly saved configuration survives drawer remounts, not page reloads.
// Never write credentials to browser storage, URLs, Vault, or logs.
let sessionConfig: ByokConfig | null = null;
let sessionOnlineEnabled = false;

export const AiCopilotDrawer: React.FC<AiCopilotDrawerProps> = ({ onApplyScene, onClose }) => {
  const [prompt, setPrompt] = useState<string>(SAMPLE_PROMPTS[0]);
  const [useByok, setUseByok] = useState(() => sessionOnlineEnabled && sessionConfig !== null);
  const [baseUrl, setBaseUrl] = useState(() => sessionConfig?.baseUrl ?? BYOK_PROVIDERS[0].baseUrl);
  const [apiKey, setApiKey] = useState(() => sessionConfig?.apiKey ?? '');
  const [modelName, setModelName] = useState(() => sessionConfig?.model ?? BYOK_PROVIDERS[0].model);
  const [saved, setSaved] = useState(() => sessionConfig !== null);
  const [models, setModels] = useState<string[]>([]);
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => () => activeRequest.current?.abort(), []);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RefineLoopResult | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('');

  const [probing, setProbing] = useState(false);
  const [probeMsg, setProbeMsg] = useState('');

  const invalidateResult = () => { setResult(null); setStatusMsg(''); };
  const clearKey = () => {
    sessionConfig = null;
    sessionOnlineEnabled = false;
    setSaved(false);
    setApiKey('');
    setModels([]);
    setProbeMsg('');
    invalidateResult();
  };
  const config = { baseUrl, apiKey, model: modelName };
  const handleSave = () => {
    try {
      validateByokConfig(config);
      sessionConfig = { baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: modelName.trim() };
      sessionOnlineEnabled = true;
      setSaved(true);
      setProbeMsg('配置已保存至本页面内存；刷新或关闭网页后清除。');
    } catch (error) {
      setProbeMsg(describeByokError(error));
    }
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
                disabled={running || probing}
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
            disabled={running || probing}
            onChange={(e) => { setPrompt(e.target.value); invalidateResult(); }}
            rows={3}
            className="w-full rounded-xl border p-3 text-sm"
            style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
            placeholder="输入物理题干、实验描述或自定义 ODE 公式..."
          />
        </div>

        <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--pf-border)' }}>
          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
            <input data-testid="byok-enabled" type="checkbox" checked={useByok} disabled={running || probing} onChange={(e) => { setUseByok(e.target.checked); sessionOnlineEnabled = e.target.checked; setProbeMsg(''); invalidateResult(); }} />
            <span>启用可选 BYOK 外部大模型 API（Generate-then-Refine 3 轮自修正；默认离线规则引擎）</span>
          </label>
          {!useByok && saved && <div className="flex items-center justify-between gap-2 text-xs opacity-80"><span>在线模式已关闭；本页内存仍保留已保存的密钥。</span><button type="button" data-testid="btn-clear-offline-byok" onClick={clearKey} disabled={running || probing} className="rounded-lg border px-2 py-1" style={{ borderColor: 'var(--pf-border)' }}>清除密钥</button></div>}
          {useByok && (
            <div className="grid grid-cols-1 gap-2 pt-1 text-xs">
              <div className="flex flex-wrap gap-1.5">
                {BYOK_PROVIDERS.map((provider) => (
                  <button
                    key={provider.name}
                    type="button"
                    disabled={running || probing}
                    onClick={() => {
                      if (baseUrl.trim().replace(/\/+$/, '') !== provider.baseUrl) clearKey();
                      setSaved(false);
                      sessionConfig = null;
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
              <div className="opacity-80">仅使用信任的 API 地址。Key 由当前网页直接发送给该地址，不能防御恶意脚本或浏览器扩展；不建议在公共设备使用。更改地址将清除旧 Key。</div>
              <input
                data-testid="byok-base-url"
                aria-label="API Base URL"
                value={baseUrl}
                disabled={running || probing}
                onChange={(e) => { setBaseUrl(e.target.value); clearKey(); }}
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
                disabled={running || probing}
                onChange={(e) => { setApiKey(e.target.value); setProbeMsg(''); setModels([]); setSaved(false); sessionConfig = null; invalidateResult(); }}
                placeholder="API Key（仅内存，随请求发送至所填服务商）"
                className="rounded-lg border px-2.5 py-1.5"
                style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
              />
              <input
                data-testid="byok-model"
                aria-label="模型名称"
                value={modelName}
                disabled={running || probing}
                onChange={(e) => { setModelName(e.target.value); setProbeMsg(''); setSaved(false); sessionConfig = null; invalidateResult(); }}
                placeholder="Model name"
                className="rounded-lg border px-2.5 py-1.5"
                style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
              />

              <div className="flex flex-wrap gap-1.5">
                {baseUrl.trim().replace(/\/+$/, '') === BYOK_PROVIDERS[0].baseUrl && ['deepseek-flash', 'deepseek-v4-pro'].map(id => (
                  <button key={id} type="button" disabled={running || probing}
                    onClick={() => { setModelName(id); setSaved(false); sessionConfig = null; setProbeMsg(''); invalidateResult(); }}
                    className="rounded-lg border px-2 py-1" style={{ borderColor: 'var(--pf-border)' }}>{id}</button>
                ))}
              </div>
              {models.length > 0 && (
                <select data-testid="byok-model-list" aria-label="服务商模型目录" value={models.includes(modelName) ? modelName : ''}
                  disabled={running || probing}
                  onChange={e => { if (e.target.value) { setModelName(e.target.value); setSaved(false); sessionConfig = null; setProbeMsg(''); invalidateResult(); } }}
                  className="rounded-lg border px-2.5 py-1.5" style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}>
                  <option value="">从服务商目录选择模型</option>
                  {models.map(id => <option key={id} value={id}>{id}</option>)}
                </select>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" data-testid="btn-save-byok" disabled={running || probing || !apiKey.trim()}
                  onClick={handleSave} className="rounded-lg border px-2.5 py-1.5 disabled:opacity-50" style={{ borderColor: 'var(--pf-border)' }}>
                  {saved ? '本页面已保存' : '保存至本页面内存'}
                </button>
                <button type="button" data-testid="btn-clear-byok" disabled={running || probing}
                  onClick={clearKey} className="rounded-lg border px-2.5 py-1.5 disabled:opacity-50" style={{ borderColor: 'var(--pf-border)' }}>清除密钥</button>
              </div>
              <div className="opacity-80">保存仅在本次页面有效，刷新后需重新输入。测试模型目录不代表模型能生成；运行建模将发送题干及模型 Schema，最多 3 次付费请求。</div>
              <button
                type="button"
                data-testid="btn-test-byok-connection"
                disabled={running || probing || !baseUrl.trim() || !apiKey.trim()}
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
          disabled={running || probing || !prompt.trim() || (useByok && (!apiKey.trim() || !baseUrl.trim() || !modelName.trim()))}
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
          <div className="rounded-xl border p-3 space-y-2 text-xs" style={{ borderColor: 'var(--pf-border)' }}>
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
