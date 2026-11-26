import React, { useMemo, useRef, useState } from 'react';
import { Activity, FileSpreadsheet, Play, SlidersHorizontal, X } from 'lucide-react';
import {
  PhaseXYPlotter,
  computeFftSpectrum,
  fitDampedHarmonic,
  fitExponential,
  fitLinear,
  fitPolynomial,
  parsePhysicsCsv,
  runParameterSweep,
  type CurveFitResult,
  type ParameterSweepResult,
  type PhaseXYPoint
} from '@physforge/analysis-lab';
import type { AnySimulationPlugin } from '@physforge/simulations/registry';
import type { ParamRecord } from '@physforge/sim-sdk';
import type { SweepWorkerRequest, SweepWorkerResponse } from '../workers/sweep.worker.js';

export interface RecordedTelemetryFrame {
  readonly t: number;
  readonly observables: Readonly<Record<string, number>>;
}

interface AnalysisLabDrawerProps {
  readonly plugin: AnySimulationPlugin;
  readonly params: ParamRecord;
  readonly frames: readonly RecordedTelemetryFrame[];
  readonly theme: 'chalkboard' | 'projector';
  readonly onScrubTime: (t: number | null) => void;
  readonly onClose: () => void;
}

type LabTab = 'phase' | 'csv' | 'fft' | 'sweep';
type FitKind = 'linear' | 'polynomial' | 'exponential' | 'damped-harmonic';

const SAMPLE_PHYPHOX_DAMPED = [
  'Time (s);Velocity x (m/s)',
  ...Array.from({ length: 80 }, (_, idx) => {
    const t = idx * 0.05;
    const v = 2.4 * Math.exp(-0.18 * t) * Math.cos(3.8 * t + 0.25);
    return `${t.toFixed(3).replace('.', ',')};${v.toFixed(4).replace('.', ',')}`;
  })
].join('\n');

export const AnalysisLabDrawer: React.FC<AnalysisLabDrawerProps> = ({
  plugin,
  params,
  frames,
  theme,
  onScrubTime,
  onClose
}) => {
  const [tab, setTab] = useState<LabTab>('phase');
  const channels = plugin.getTelemetryChannels?.(params) ?? plugin.telemetryChannels;
  const [phaseXKey, setPhaseXKey] = useState<string>(channels[0]?.key ?? 't');
  const [phaseYKey, setPhaseYKey] = useState<string>(channels[1]?.key ?? channels[0]?.key ?? 't');
  const [showLoopArea, setShowLoopArea] = useState(false);

  // CSV & Curve Fitting state
  const [csvText, setCsvText] = useState(SAMPLE_PHYPHOX_DAMPED);
  const [csvXCol, setCsvXCol] = useState<string>('');
  const [csvYCol, setCsvYCol] = useState<string>('');
  const [fitKind, setFitKind] = useState<FitKind>('damped-harmonic');

  // FFT state
  const [fftChannel, setFftChannel] = useState<string>(channels[0]?.key ?? '');
  const [fftWindow, setFftWindow] = useState<'hann' | 'rectangular'>('hann');

  // Parameter sweep state
  const numericParams = useMemo(
    () => (plugin.getParamFields?.(params) ?? plugin.paramSchema).filter((f) => f.kind === 'number'),
    [plugin, params]
  );
  const [sweepParamKey, setSweepParamKey] = useState<string>(numericParams[0]?.key ?? '');
  const [sweepSteps, setSweepSteps] = useState<number>(8);
  const [sweepSimSteps, setSweepSimSteps] = useState<number>(180);
  const [sweepResult, setSweepResult] = useState<ParameterSweepResult | null>(null);
  const [sweepBusy, setSweepBusy] = useState(false);
  const [sweepError, setSweepError] = useState<string | null>(null);
  const sweepReqIdRef = useRef(0);

  const phasePoints: PhaseXYPoint[] = useMemo(
    () =>
      frames.flatMap((f) => {
        const x=phaseXKey==='t'?f.t:f.observables[phaseXKey];
        const y=phaseYKey==='t'?f.t:f.observables[phaseYKey];
        return typeof x==='number'&&typeof y==='number'&&Number.isFinite(x)&&Number.isFinite(y)?[{t:f.t,x,y}]:[];
      }),
    [frames, phaseXKey, phaseYKey]
  );

  const parsedCsv = useMemo(() => {
    try {
      return { ok: true as const, data: parsePhysicsCsv(csvText) };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  }, [csvText]);

  const effectiveCsvX =
    parsedCsv.ok && parsedCsv.data.headers.includes(csvXCol)
      ? csvXCol
      : parsedCsv.ok
        ? (parsedCsv.data.headers[0] ?? '')
        : '';
  const effectiveCsvY =
    parsedCsv.ok && parsedCsv.data.headers.includes(csvYCol)
      ? csvYCol
      : parsedCsv.ok
        ? (parsedCsv.data.headers[1] ?? parsedCsv.data.headers[0] ?? '')
        : '';

  const csvFit: { ok: true; result: CurveFitResult; xs: number[]; ys: number[] } | { ok: false; error: string } =
    useMemo(() => {
      if (!parsedCsv.ok) return { ok: false, error: parsedCsv.error };
      if (!effectiveCsvX || !effectiveCsvY) return { ok: false, error: '请选择有效 X/Y 列' };
      const xs: number[] = [];
      const ys: number[] = [];
      for (const row of parsedCsv.data.rows) {
        const xv = row[effectiveCsvX];
        const yv = row[effectiveCsvY];
        if (typeof xv === 'number' && typeof yv === 'number') {
          xs.push(xv);
          ys.push(yv);
        }
      }
      try {
        let res: CurveFitResult;
        if (fitKind === 'linear') res = fitLinear(xs, ys);
        else if (fitKind === 'polynomial') res = fitPolynomial(xs, ys, 2);
        else if (fitKind === 'exponential') res = fitExponential(xs, ys);
        else res = fitDampedHarmonic(xs, ys);
        return { ok: true, result: res, xs, ys };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }, [parsedCsv, effectiveCsvX, effectiveCsvY, fitKind]);

  const fftSpectrum = useMemo(() => {
    if (frames.length < 8 || !fftChannel) return null;
    const samples = frames.map((f) => f.observables[fftChannel]);
    if(!samples.every((v):v is number=>typeof v==='number'&&Number.isFinite(v)))return null;
    const dt =
      frames.length > 1
        ? Math.max(1e-4, (frames[frames.length - 1]!.t - frames[0]!.t) / (frames.length - 1))
        : 1 / 60;
    return computeFftSpectrum(samples, dt, { window: fftWindow, removeDc: true, topPeaks: 3 });
  }, [frames, fftChannel, fftWindow]);

  const handleRunSweep = () => {
    const field = numericParams.find((f) => f.key === sweepParamKey);
    if (!field || field.kind !== 'number') return;

    const count = Math.max(3, Math.min(25, sweepSteps));
    const values = Array.from(
      { length: count },
      (_, i) => field.min + ((field.max - field.min) * i) / (count - 1)
    );
    const spec = {
      paramKey: field.key,
      values,
      baseParams: params,
      steps: sweepSimSteps,
      dt: 1 / 120
    };

    setSweepBusy(true);
    setSweepError(null);
    const requestId = ++sweepReqIdRef.current;

    if (typeof Worker !== 'undefined') {
      const worker = new Worker(new URL('../workers/sweep.worker.ts', import.meta.url), {
        type: 'module'
      });
      worker.onmessage = (ev: MessageEvent<SweepWorkerResponse>) => {
        if (ev.data.requestId !== requestId) return;
        setSweepBusy(false);
        if (ev.data.ok && ev.data.result) {
          setSweepResult(ev.data.result);
        } else {
          setSweepError(ev.data.error ?? 'Worker sweep failed');
        }
        worker.terminate();
      };
      worker.onerror = () => {
        worker.terminate();
        const fallback = runParameterSweep(plugin, spec);
        setSweepResult(fallback);
        setSweepBusy(false);
      };
      const req: SweepWorkerRequest = { requestId, modelId: plugin.meta.id, spec };
      worker.postMessage(req);
    } else {
      const result = runParameterSweep(plugin, spec);
      setSweepResult(result);
      setSweepBusy(false);
    }
  };

  return (
    <div
      data-testid="analysis-lab-drawer"
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
    >
      <div
        className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden"
        style={{
          borderColor: 'var(--pf-border)',
          backgroundColor: 'var(--pf-surface)',
          color: 'var(--pf-text)'
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--pf-border)' }}>
          <div className="flex items-center gap-2 font-bold text-base">
            <Activity className="w-5 h-5 text-sky-400" />
            <span>PhysForge 数据分析实验室（Analysis Lab）</span>
          </div>
          <button
            type="button"
            data-testid="btn-close-analysis-lab"
            onClick={onClose}
            className="p-1.5 rounded-lg border cursor-pointer"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b" style={{ borderColor: 'var(--pf-border)' }}>
          {(
            [
              { id: 'phase', label: 'X-Y 相图与环路面积' },
              { id: 'csv', label: 'Phyphox / Tracker CSV 拟合' },
              { id: 'fft', label: 'Radix-2 FFT 频谱分析' },
              { id: 'sweep', label: 'Web Worker 多参数扫描' }
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              data-testid={`tab-lab-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-xl text-sm font-semibold border cursor-pointer ${
                tab === t.id ? 'bg-sky-500 text-slate-950 border-sky-400' : ''
              }`}
              style={tab === t.id ? undefined : { borderColor: 'var(--pf-border)' }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {tab === 'phase' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-1.5">
                  <span>X 轴:</span>
                  <select
                    value={phaseXKey}
                    onChange={(e) => setPhaseXKey(e.target.value)}
                    className="rounded border px-2 py-1"
                    style={{ backgroundColor: 'var(--pf-surface-elevated)', borderColor: 'var(--pf-border)' }}
                  >
                    <option value="t">时间 t (s)</option>
                    {channels.map((ch) => (
                      <option key={ch.key} value={ch.key}>
                        {ch.label} ({ch.unit})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5">
                  <span>Y 轴:</span>
                  <select
                    value={phaseYKey}
                    onChange={(e) => setPhaseYKey(e.target.value)}
                    className="rounded border px-2 py-1"
                    style={{ backgroundColor: 'var(--pf-surface-elevated)', borderColor: 'var(--pf-border)' }}
                  >
                    {channels.map((ch) => (
                      <option key={ch.key} value={ch.key}>
                        {ch.label} ({ch.unit})
                      </option>
                    ))}
                    <option value="t">时间 t (s)</option>
                  </select>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showLoopArea}
                    onChange={(e) => setShowLoopArea(e.target.checked)}
                  />
                  <span>计算 Green 定理闭合面积 ∮y dx</span>
                </label>
              </div>
              <PhaseXYPlotter
                points={phasePoints}
                xLabel={phaseXKey==='t'?'t (s)':`${channels.find(c=>c.key===phaseXKey)?.label??phaseXKey} (${channels.find(c=>c.key===phaseXKey)?.unit??'—'})`}
                yLabel={phaseYKey==='t'?'t (s)':`${channels.find(c=>c.key===phaseYKey)?.label??phaseYKey} (${channels.find(c=>c.key===phaseYKey)?.unit??'—'})`}
                title={`实时相图轨迹（共 ${phasePoints.length} 采样点，时间蓝→紫红渐变）`}
                showLoopArea={showLoopArea}
                darkTheme={theme === 'chalkboard'}
                width={760}
                height={320}
                onHoverIndex={(idx) => {
                  const point=idx===null?undefined:phasePoints[idx];
                  if(point?.t!==undefined)onScrubTime(point.t);
                }}
              />
            </div>
          )}

          {tab === 'csv' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <span>
                    识别方言:{' '}
                    <code className="px-1.5 py-0.5 rounded bg-slate-800 text-emerald-300">
                      {parsedCsv.ok ? parsedCsv.data.detectedDialect : '格式错误'}
                    </code>
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <label className="px-3 py-1 rounded-lg border cursor-pointer text-xs" style={{ borderColor: 'var(--pf-border)' }}>
                    导入 CSV 文件
                    <input
                      type="file"
                      accept=".csv,.txt,.tsv"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) setCsvText(await file.text());
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setCsvText(SAMPLE_PHYPHOX_DAMPED)}
                    className="px-3 py-1 rounded-lg border text-xs cursor-pointer"
                    style={{ borderColor: 'var(--pf-border)' }}
                  >
                    载入 Phyphox 阻尼振子样本
                  </button>
                </div>
              </div>

              <textarea
                data-testid="csv-input-textarea"
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                rows={4}
                className="w-full rounded-xl border p-2.5 font-mono text-xs"
                style={{
                  borderColor: 'var(--pf-border)',
                  backgroundColor: 'var(--pf-surface-elevated)'
                }}
              />

              {parsedCsv.ok && (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-1">
                    <span>X 列:</span>
                    <select
                      value={effectiveCsvX}
                      onChange={(e) => setCsvXCol(e.target.value)}
                      className="rounded border px-2 py-1"
                      style={{ backgroundColor: 'var(--pf-surface-elevated)', borderColor: 'var(--pf-border)' }}
                    >
                      {parsedCsv.data.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1">
                    <span>Y 列:</span>
                    <select
                      value={effectiveCsvY}
                      onChange={(e) => setCsvYCol(e.target.value)}
                      className="rounded border px-2 py-1"
                      style={{ backgroundColor: 'var(--pf-surface-elevated)', borderColor: 'var(--pf-border)' }}
                    >
                      {parsedCsv.data.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1">
                    <span>拟合模型:</span>
                    <select
                      data-testid="select-fit-kind"
                      value={fitKind}
                      onChange={(e) => setFitKind(e.target.value as FitKind)}
                      className="rounded border px-2 py-1"
                      style={{ backgroundColor: 'var(--pf-surface-elevated)', borderColor: 'var(--pf-border)' }}
                    >
                      <option value="linear">线性拟合 y = kx + b</option>
                      <option value="polynomial">二次多项式拟合</option>
                      <option value="exponential">指数回归 A e^(kx) + C</option>
                      <option value="damped-harmonic">阻尼谐振子 LM 拟合</option>
                    </select>
                  </label>
                </div>
              )}

              {csvFit.ok ? (
                <div className="space-y-2">
                  <div className="rounded-xl border p-2.5 text-xs font-mono space-y-1" style={{ borderColor: 'var(--pf-border)' }}>
                    <div>
                      R² = <span className="text-emerald-400 font-bold">{csvFit.result.rSquared.toFixed(6)}</span> · RMSE ={' '}
                      {csvFit.result.rmse.toExponential(3)}
                    </div>
                    <div className="text-sky-300">{csvFit.result.formulaLatex}</div>
                  </div>
                  <PhaseXYPlotter
                    points={csvFit.xs.map((x, i) => ({ x, y: csvFit.ys[i]! }))}
                    fittedCurve={csvFit.xs.map((x) => ({ x, y: csvFit.result.evaluate(x) }))}
                    xLabel={effectiveCsvX}
                    yLabel={effectiveCsvY}
                    fittedLabel={`实测曲线 vs LM 拟合 (R²=${csvFit.result.rSquared.toFixed(4)})`}
                    darkTheme={theme === 'chalkboard'}
                    width={760}
                    height={250}
                  />
                </div>
              ) : (
                <div className="text-rose-400 text-sm">{csvFit.error}</div>
              )}
            </div>
          )}

          {tab === 'fft' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-1.5">
                  <span>信号通道:</span>
                  <select
                    value={fftChannel}
                    onChange={(e) => setFftChannel(e.target.value)}
                    className="rounded border px-2 py-1"
                    style={{ backgroundColor: 'var(--pf-surface-elevated)', borderColor: 'var(--pf-border)' }}
                  >
                    {channels.map((ch) => (
                      <option key={ch.key} value={ch.key}>
                        {ch.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5">
                  <span>窗函数:</span>
                  <select
                    value={fftWindow}
                    onChange={(e) => setFftWindow(e.target.value as 'hann' | 'rectangular')}
                    className="rounded border px-2 py-1"
                    style={{ backgroundColor: 'var(--pf-surface-elevated)', borderColor: 'var(--pf-border)' }}
                  >
                    <option value="hann">Hann 窗</option>
                    <option value="rectangular">矩形窗</option>
                  </select>
                </label>
              </div>
              {fftSpectrum ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2 text-xs font-mono">
                    {fftSpectrum.peaks.map((pk, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-1 rounded-lg border border-sky-400/50 bg-sky-500/10 text-sky-300"
                      >
                        峰值 #{idx + 1}: {pk.frequency.toFixed(3)} Hz (|A|={pk.magnitude.toFixed(3)})
                      </span>
                    ))}
                  </div>
                  <PhaseXYPlotter
                    points={fftSpectrum.frequencies.slice(0, Math.min(128, fftSpectrum.frequencies.length)).map((f, i) => ({
                      x: f,
                      y: fftSpectrum.magnitudes[i] ?? 0
                    }))}
                    xLabel="Frequency (Hz)"
                    yLabel="Amplitude"
                    title={`单边幅值频谱 (${fftSpectrum.binCount}-point Radix-2 FFT)`}
                    darkTheme={theme === 'chalkboard'}
                    width={760}
                    height={260}
                  />
                </div>
              ) : (
                <div className="text-sm text-amber-300">
                  请先点击“运行”累计至少 8 帧有效采样；所选通道若缺值，不以零补齐进行 FFT。
                </div>
              )}
            </div>
          )}

          {tab === 'sweep' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <SlidersHorizontal className="w-4 h-4 text-sky-400" />
                <label className="flex items-center gap-1">
                  <span>扫描参数:</span>
                  <select
                    value={sweepParamKey}
                    onChange={(e) => setSweepParamKey(e.target.value)}
                    className="rounded border px-2 py-1"
                    style={{ backgroundColor: 'var(--pf-surface-elevated)', borderColor: 'var(--pf-border)' }}
                  >
                    {numericParams.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label} ({f.min} ~ {f.max})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  <span>采样点数:</span>
                  <input
                    type="number"
                    min={3}
                    max={25}
                    value={sweepSteps}
                    onChange={(e) => setSweepSteps(Number(e.target.value))}
                    className="w-16 rounded border px-2 py-1"
                    style={{ backgroundColor: 'var(--pf-surface-elevated)', borderColor: 'var(--pf-border)' }}
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span>演化步数:</span>
                  <input
                    type="number"
                    min={30}
                    max={1200}
                    value={sweepSimSteps}
                    onChange={(e) => setSweepSimSteps(Number(e.target.value))}
                    className="w-20 rounded border px-2 py-1"
                    style={{ backgroundColor: 'var(--pf-surface-elevated)', borderColor: 'var(--pf-border)' }}
                  />
                </label>
                <button
                  type="button"
                  onClick={handleRunSweep}
                  disabled={sweepBusy}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-sky-500 text-slate-950 font-bold cursor-pointer disabled:opacity-50"
                >
                  <Play className="w-4 h-4" />
                  <span>{sweepBusy ? 'Worker 计算中...' : '后台执行参数扫描'}</span>
                </button>
              </div>
              {sweepError && <div className="text-rose-400 text-sm">{sweepError}</div>}
              {sweepResult && (
                <div className="space-y-2">
                  <div className="text-xs text-emerald-300 font-mono">
                    扫描完成：{sweepResult.points.length} 组参数并行求值耗时 {sweepResult.durationMs.toFixed(1)} ms
                  </div>
                  <div className="max-h-60 overflow-auto rounded-xl border text-xs font-mono" style={{ borderColor: 'var(--pf-border)' }}>
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b bg-slate-900/50" style={{ borderColor: 'var(--pf-border)' }}>
                          <th className="p-2">{sweepResult.paramKey}</th>
                          <th className="p-2">事件数</th>
                          <th className="p-2">末态观测摘要</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sweepResult.points.map((pt, i) => (
                          <tr key={i} className="border-b" style={{ borderColor: 'var(--pf-border)' }}>
                            <td className="p-2 font-bold">{pt.paramValue.toFixed(3)}</td>
                            <td className="p-2">{pt.eventCount}</td>
                            <td className="p-2 truncate max-w-md">
                              {Object.entries(pt.finalObservables)
                                .slice(0, 4)
                                .map(([k, v]) => `${k}=${v.toFixed(3)}`)
                                .join(' · ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
