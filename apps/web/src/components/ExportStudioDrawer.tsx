import React, { useMemo, useRef, useState } from 'react';
import { Camera, Check, Copy, Download, FileCode2, Film, Image as ImageIcon, Square, X } from 'lucide-react';
import type { AnySimulationPlugin } from '@physforge/simulations/registry';
import type { ParamRecord, Viewport } from '@physforge/sim-sdk';
import {
  copyDiagramPngToClipboard,
  createCanvasWebmRecorder,
  renderDiagramToPngBlob,
  renderDiagramToSvg,
  renderDiagramToTikz,
  renderStrobeCompositePng,
  resolvePluginDiagramIR,
  type CanvasRecorderController
} from '@physforge/export-studio';

interface ExportStudioDrawerProps {
  readonly plugin: AnySimulationPlugin;
  readonly params: ParamRecord;
  readonly activeLayers: readonly string[];
  readonly simCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  readonly getSnapshotStates: () => readonly { t: number; state: unknown }[];
  readonly onClose: () => void;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const ExportStudioDrawer: React.FC<ExportStudioDrawerProps> = ({
  plugin,
  params,
  activeLayers,
  simCanvasRef,
  getSnapshotStates,
  onClose
}) => {
  const snapshots = useMemo(() => getSnapshotStates(), [getSnapshotStates]);
  const latestState = useMemo(() => {
    if (snapshots.length > 0) return snapshots[snapshots.length - 1]!.state;
    return plugin.engine.createInitialState(params);
  }, [plugin, params, snapshots]);

  const diagramIr = useMemo(
    () => resolvePluginDiagramIR(plugin, latestState, params),
    [plugin, latestState, params]
  );

  const svgOutput = useMemo(() => renderDiagramToSvg(diagramIr, { monochrome: true }), [diagramIr]);
  const tikzOutput = useMemo(() => renderDiagramToTikz(diagramIr), [diagramIr]);

  const [activeTab, setActiveTab] = useState<'svg' | 'tikz' | 'media'>('svg');
  const [statusText, setStatusText] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<CanvasRecorderController | null>(null);

  const handleDownloadSvg = () => {
    downloadBlob(
      new Blob([svgOutput], { type: 'image/svg+xml;charset=utf-8' }),
      `${plugin.meta.id}-diagram.svg`
    );
    setStatusText(`已导出黑白试卷矢量 SVG（${(svgOutput.length / 1024).toFixed(1)} KB）`);
  };

  const handleDownloadPng = async (scale: 2 | 4 | 6) => {
    const blob = await renderDiagramToPngBlob(diagramIr, scale);
    downloadBlob(blob, `${plugin.meta.id}-${scale * 100}dpi.png`);
    setStatusText(`已导出 ${scale * 100} DPI 高清白色试卷 PNG（${(blob.size / 1024).toFixed(1)} KB）`);
  };

  const handleCopyPng = async () => {
    const copied = await copyDiagramPngToClipboard(diagramIr, 4);
    setStatusText(copied ? '已将 4x 高清黑白试卷图复制至系统剪贴板！' : '当前浏览器禁止剪贴板写入，请改用下载按钮。');
  };

  const handleDownloadTikz = () => {
    downloadBlob(new Blob([tikzOutput], { type: 'text/plain;charset=utf-8' }), `${plugin.meta.id}.tex`);
    setStatusText('已导出 LaTeX TikZ 源代码文件。');
  };

  const handleCopyTikz = async () => {
    await navigator.clipboard?.writeText(tikzOutput);
    setStatusText('已复制 TikZ 代码至剪贴板！');
  };

  const handleExportPresetJson = () => {
    const presetDoc = {
      schemaVersion: '2.0',
      modelId: plugin.meta.id,
      title: plugin.meta.title,
      params,
      visibleLayers: activeLayers
    };
    downloadBlob(
      new Blob([JSON.stringify(presetDoc, null, 2)], { type: 'application/json;charset=utf-8' }),
      `${plugin.meta.id}-preset.json`
    );
    setStatusText('已导出教学场景 JSON（可用于 singlefile-exporter --preset-file）。');
  };

  const handleStrobeComposite = async () => {
    const frames = snapshots.length > 0 ? snapshots : [{ t: 0, state: latestState }];
    const sampled =
      frames.length <= 12
        ? frames
        : Array.from({ length: 12 }, (_, idx) => frames[Math.floor((idx * (frames.length - 1)) / 11)]!);
    const layerSet = new Set(activeLayers);
    const vp: Viewport = { width: 960, height: 560, dpr: 1, scale: 1, offsetX: 0, offsetY: 0 };
    const blob = await renderStrobeCompositePng(
      vp.width,
      vp.height,
      sampled,
      (ctx, frame) => {
        plugin.renderCanvas(ctx, frame.state, params, vp, layerSet);
      },
      '#ffffff'
    );
    downloadBlob(blob, `${plugin.meta.id}-strobe.png`);
    setStatusText(`已合成 ${sampled.length} 帧频闪长图 PNG（${(blob.size / 1024).toFixed(1)} KB）`);
  };

  const handleToggleRecord = async () => {
    if (!recording) {
      const canvas = simCanvasRef.current;
      if (!canvas) {
        setStatusText('当前处于非 2D Canvas 视图，请切换回 2D 主画布后录制。');
        return;
      }
      try {
        const rec = createCanvasWebmRecorder(canvas, 60);
        recorderRef.current = rec;
        rec.start();
        setRecording(true);
        setStatusText(`正在 60fps 录制画布动画 (${rec.mimeType})...`);
      } catch (err) {
        setStatusText(err instanceof Error ? err.message : String(err));
      }
    } else {
      const rec = recorderRef.current;
      recorderRef.current = null;
      setRecording(false);
      if (rec) {
        const blob = await rec.stop();
        downloadBlob(blob, `${plugin.meta.id}-recording.webm`);
        setStatusText(`WebM 动画录制已完成（${(blob.size / 1024).toFixed(1)} KB）`);
      }
    }
  };

  return (
    <div
      data-testid="export-studio-drawer"
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-4"
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
            <ImageIcon className="w-5 h-5 text-amber-400" />
            <span>试卷配图与多模态导出工坊（Export Studio）</span>
          </div>
          <button
            type="button"
            data-testid="btn-close-export-studio"
            onClick={onClose}
            className="p-1.5 rounded-lg border cursor-pointer"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b" style={{ borderColor: 'var(--pf-border)' }}>
          <button
            type="button"
            data-testid="tab-export-svg"
            onClick={() => setActiveTab('svg')}
            className={`px-3 py-1.5 rounded-xl text-sm font-semibold border cursor-pointer ${
              activeTab === 'svg' ? 'bg-amber-400 text-slate-950 border-amber-300' : ''
            }`}
            style={activeTab === 'svg' ? undefined : { borderColor: 'var(--pf-border)' }}
          >
            黑白试卷 SVG / 600DPI PNG
          </button>
          <button
            type="button"
            data-testid="tab-export-tikz"
            onClick={() => setActiveTab('tikz')}
            className={`px-3 py-1.5 rounded-xl text-sm font-semibold border cursor-pointer ${
              activeTab === 'tikz' ? 'bg-amber-400 text-slate-950 border-amber-300' : ''
            }`}
            style={activeTab === 'tikz' ? undefined : { borderColor: 'var(--pf-border)' }}
          >
            LaTeX TikZ 代码
          </button>
          <button
            type="button"
            data-testid="tab-export-media"
            onClick={() => setActiveTab('media')}
            className={`px-3 py-1.5 rounded-xl text-sm font-semibold border cursor-pointer ${
              activeTab === 'media' ? 'bg-amber-400 text-slate-950 border-amber-300' : ''
            }`}
            style={activeTab === 'media' ? undefined : { borderColor: 'var(--pf-border)' }}
          >
            WebM 录屏 / 频闪长图 / 切片 JSON
          </button>
          {statusText && (
            <span className="ml-auto text-xs font-semibold text-emerald-400 inline-flex items-center gap-1">
              <Check className="w-3.5 h-3.5" />
              {statusText}
            </span>
          )}
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {activeTab === 'svg' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="btn-download-svg"
                  onClick={handleDownloadSvg}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500 text-slate-950 font-bold text-sm cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>下载黑白矢量 SVG</span>
                </button>
                <button
                  type="button"
                  data-testid="btn-download-png-600"
                  onClick={() => void handleDownloadPng(6)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
                  style={{ borderColor: 'var(--pf-border)' }}
                >
                  <ImageIcon className="w-4 h-4" />
                  <span>下载 600 DPI PNG</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopyPng()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
                  style={{ borderColor: 'var(--pf-border)' }}
                >
                  <Copy className="w-4 h-4" />
                  <span>复制 PNG 到 Word 剪贴板</span>
                </button>
              </div>
              <div
                data-testid="svg-preview-box"
                className="rounded-xl border bg-white p-3 flex items-center justify-center overflow-auto"
                dangerouslySetInnerHTML={{ __html: svgOutput }}
              />
            </div>
          )}

          {activeTab === 'tikz' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="btn-copy-tikz"
                  onClick={() => void handleCopyTikz()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500 text-slate-950 font-bold text-sm cursor-pointer"
                >
                  <Copy className="w-4 h-4" />
                  <span>复制 TikZ 源码</span>
                </button>
                <button
                  type="button"
                  data-testid="btn-download-tikz"
                  onClick={handleDownloadTikz}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
                  style={{ borderColor: 'var(--pf-border)' }}
                >
                  <FileCode2 className="w-4 h-4" />
                  <span>下载 .tex 文件</span>
                </button>
              </div>
              <pre
                data-testid="tikz-code-preview"
                className="rounded-xl border p-3 font-mono text-xs overflow-auto max-h-96"
                style={{
                  borderColor: 'var(--pf-border)',
                  backgroundColor: 'var(--pf-surface-elevated)'
                }}
              >
                {tikzOutput}
              </pre>
            </div>
          )}

          {activeTab === 'media' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: 'var(--pf-border)' }}>
                <div className="font-bold text-sm flex items-center gap-1.5">
                  <Film className="w-4 h-4 text-rose-400" />
                  <span>60fps WebM 动画录屏</span>
                </div>
                <p className="text-xs" style={{ color: 'var(--pf-text-muted)' }}>
                  直接录制当前高 DPR 仿真画布输出透明无水印 WebM 视频，适合嵌入 PPT 公开课。
                </p>
                <button
                  type="button"
                  data-testid="btn-toggle-webm-record"
                  onClick={() => void handleToggleRecord()}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-sm cursor-pointer ${
                    recording ? 'bg-rose-500 text-white' : 'bg-sky-500 text-slate-950'
                  }`}
                >
                  {recording ? <Square className="w-4 h-4" /> : <Film className="w-4 h-4" />}
                  <span>{recording ? '停止并下载 WebM' : '开始录制 WebM'}</span>
                </button>
              </div>

              <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: 'var(--pf-border)' }}>
                <div className="font-bold text-sm flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-emerald-400" />
                  <span>多帧频闪合成长图 & 切片预设 JSON</span>
                </div>
                <p className="text-xs" style={{ color: 'var(--pf-text-muted)' }}>
                  将已运行的多帧快照渐隐叠加生成白底频闪长图（当前已捕获 {snapshots.length} 帧），或导出切片预设文件。
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="btn-strobe-composite"
                    onClick={() => void handleStrobeComposite()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-400 text-slate-950 font-bold text-sm cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>生成频闪长图 PNG</span>
                  </button>
                  <button
                    type="button"
                    data-testid="btn-export-preset-json"
                    onClick={handleExportPresetJson}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
                    style={{ borderColor: 'var(--pf-border)' }}
                  >
                    <Download className="w-4 h-4" />
                    <span>导出切片预设 JSON</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
