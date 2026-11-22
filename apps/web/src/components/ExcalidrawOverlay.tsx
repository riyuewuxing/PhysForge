import React, { useState } from 'react';
import { Excalidraw, exportToCanvas } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ClassroomTheme } from '../store/useClassroomStore.js';

interface ExcalidrawOverlayProps {
  modelId: string;
  theme: ClassroomTheme;
  simCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onClose: () => void;
}

export const ExcalidrawOverlay: React.FC<ExcalidrawOverlayProps> = ({
  modelId,
  theme,
  simCanvasRef,
  onClose
}) => {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [exportStatus, setExportStatus] = useState<string>('');

  const handleExportMergedPng = async () => {
    const simCanvas = simCanvasRef.current;
    if (!simCanvas || !api) return;

    const merged = document.createElement('canvas');
    merged.width = simCanvas.width;
    merged.height = simCanvas.height;
    const mctx = merged.getContext('2d');
    if (!mctx) return;

    mctx.drawImage(simCanvas, 0, 0);

    const elements = api.getSceneElements();
    if (elements.length > 0) {
      const annoCanvas = await exportToCanvas({
        elements,
        appState: {
          ...api.getAppState(),
          exportBackground: false,
          viewBackgroundColor: 'transparent'
        },
        files: api.getFiles(),
        getDimensions: () => ({
          width: simCanvas.width,
          height: simCanvas.height,
          scale: 1
        })
      });
      mctx.drawImage(annoCanvas, 0, 0, simCanvas.width, simCanvas.height);
    }

    const dataUrl = merged.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `physforge-${modelId}-annotated.png`;
    link.href = dataUrl;
    link.click();
    setExportStatus(`已合成导出 (${merged.width}x${merged.height})`);
  };

  return (
    <div
      data-testid="excalidraw-overlay"
      className="pf-excalidraw-transparent absolute inset-0 z-30 flex flex-col"
    >
      {/* 批注层顶部控制条 */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-900/90 border-b border-amber-400/40 text-slate-100">
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
          <span>透明课堂板书批注层（离线资源）</span>
          {exportStatus && (
            <span data-testid="png-export-status" className="text-emerald-400 text-xs">
              {exportStatus}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => api?.resetScene()}
            className="pf-touch-target px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm cursor-pointer"
          >
            清空板书
          </button>
          <button
            type="button"
            data-testid="export-annotated-png"
            onClick={() => void handleExportMergedPng()}
            className="pf-touch-target px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 text-sm cursor-pointer"
          >
            合成导出 PNG
          </button>
          <button
            type="button"
            onClick={onClose}
            className="pf-touch-target px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 font-bold hover:bg-amber-300 text-sm cursor-pointer"
          >
            退出板书
          </button>
        </div>
      </div>

      {/* 透明 Excalidraw 覆盖区 */}
      <div className="flex-1 min-h-0 relative">
        <Excalidraw
          excalidrawAPI={(exApi) => setApi(exApi)}
          theme={theme === 'chalkboard' ? 'dark' : 'light'}
          langCode="zh-CN"
          initialData={{
            appState: {
              viewBackgroundColor: 'transparent',
              currentItemStrokeColor: '#fbbf24',
              currentItemStrokeWidth: 2
            }
          }}
        />
      </div>
    </div>
  );
};
