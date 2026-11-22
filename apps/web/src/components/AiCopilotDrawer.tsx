import React, { useState } from 'react';
import { Bot, CheckCircle2, Play, Sparkles, X } from 'lucide-react';
import type { ParamRecord } from '@physforge/sim-sdk';
import {
  auditSceneHeadless,
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

export const AiCopilotDrawer: React.FC<AiCopilotDrawerProps> = ({ onApplyScene, onClose }) => {
  const [prompt, setPrompt] = useState<string>(SAMPLE_PROMPTS[0]);
  const [useByok, setUseByok] = useState(false);
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('gpt-4o-mini');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RefineLoopResult | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('');

  const handleRun = async () => {
    setRunning(true);
    setStatusMsg('');
    try {
      const route = routePhysicsProblemPrompt(prompt);
      if (useByok && apiKey.trim()) {
        const res = await runGenerateThenRefine(
          (round, feedback) => requestByokSceneCandidate({ baseUrl, apiKey, model: modelName }, prompt, feedback),
          { maxRounds: 3, steps: 30, dt: 0.02 }
        );
        setResult(res);
        setStatusMsg(res.accepted ? `BYOK 第 ${res.attempts} 轮通过无头守恒审计` : `BYOK 3 轮后仍未通过校验`);
      } else {
        const synth = await synthesizeSceneFromPrompt(prompt);
        const audit = await auditSceneHeadless(synth.scene, { steps: 30, dt: 0.02 });
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
      setStatusMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
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
        style={{ backgroundColor: 'var(--pf-surface)', borderColor: 'var(--pf-border)', color: 'var(--pf-text)' }}
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
                onClick={() => setPrompt(sp)}
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
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="w-full rounded-xl border p-3 text-sm"
            style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
            placeholder="输入物理题干、实验描述或自定义 ODE 公式..."
          />
        </div>

        <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--pf-border)' }}>
          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
            <input type="checkbox" checked={useByok} onChange={(e) => setUseByok(e.target.checked)} />
            <span>启用可选 BYOK 外部大模型 API（Generate-then-Refine 3 轮自修正；默认离线规则引擎）</span>
          </label>
          {useByok && (
            <div className="grid grid-cols-1 gap-2 pt-1 text-xs">
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="OpenAI Compatible Base URL"
                className="rounded-lg border px-2.5 py-1.5"
                style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
              />
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="API Key (仅内存使用，不落盘上传)"
                className="rounded-lg border px-2.5 py-1.5"
                style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
              />
              <input
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="Model name"
                className="rounded-lg border px-2.5 py-1.5"
                style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
              />
            </div>
          )}
        </div>

        <button
          type="button"
          data-testid="btn-run-ai-copilot"
          disabled={running || !prompt.trim()}
          onClick={handleRun}
          className="pf-touch-target inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-sm bg-sky-500 text-slate-950 cursor-pointer disabled:opacity-50"
        >
          <Sparkles className="w-4 h-4" />
          <span>{running ? '正在无头物理验算与自修正...' : '三层路由生成 SceneDSL + 无头守恒审计'}</span>
        </button>

        {statusMsg && (
          <div className="text-xs px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--pf-border)' }}>
            {statusMsg}
          </div>
        )}

        {result?.finalScene && (
          <div className="rounded-xl border p-3 space-y-2 text-xs" style={{ borderColor: 'var(--pf-border)' }}>
            <div className="flex items-center justify-between">
              <span className="font-bold flex items-center gap-1 text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                模型: {result.finalScene.modelId}
              </span>
              <button
                type="button"
                data-testid="btn-apply-ai-scene"
                onClick={() => {
                  onApplyScene(
                    result.finalScene!.modelId,
                    result.finalScene!.presetId,
                    result.finalScene!.params as ParamRecord
                  );
                  onClose();
                }}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-500 text-slate-950 font-semibold cursor-pointer"
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
