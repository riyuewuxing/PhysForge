import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import type { AnySimulationPlugin } from '@physforge/simulations/registry';
import type { ClassroomTheme, TelemetrySummary } from '../store/useClassroomStore.js';
import type {
  ControlHandle,
  ParamRecord,
  ParamValue,
  PhysicsEvent,
  SimulationPluginV2,
  Viewport
} from '@physforge/sim-sdk';
import {
  DEFAULT_CAMERA_TRANSFORM,
  getPixelsPerMeter,
  panViewport,
  screenToWorld,
  worldToScreen,
  zoomViewportAtCursor,
  type CameraTransform
} from '../stage/ViewportController.js';
import { RulerToolboxOverlay, type MeasureToolKind } from '../stage/RulerToolboxOverlay.js';
import { AutoFbdBadge, renderAutoFbdToCanvas } from '../stage/AutoFbdOverlay.js';

const LazyThreeStage = React.lazy(() =>
  import('../stage/ThreeStage.js').then((m) => ({ default: m.ThreeStage }))
);

interface SnapshotFrame {
  t: number;
  state: unknown;
  observables: Record<string, number>;
}

export interface RecordedTelemetryFrame {
  t: number;
  observables: Record<string, number>;
}

interface SimulationStageProps {
  plugin: AnySimulationPlugin;
  params: ParamRecord;
  activeLayers: readonly string[];
  isPlaying: boolean;
  playbackSpeed: number;
  strobeEnabled: boolean;
  poeMasked: boolean;
  theme: ClassroomTheme;
  measureTool: MeasureToolKind;
  autoFbdEnabled: boolean;
  fbdComponentsEnabled: boolean;
  activeFrameId: string;
  view3dEnabled: boolean;
  resetViewNonce: number;
  resetNonce: number;
  stepOnceNonce: number;
  scrubTime: number | null;
  canvasRefExternal?: React.RefObject<HTMLCanvasElement | null>;
  onResetView: () => void;
  onUpdateParamsBatch: (patch: Record<string, ParamValue>, label?: string) => void;
  onRegisterSnapshotsGetter?: (getter: () => readonly RecordedTelemetryFrame[]) => void;
  onScrubTime: (t: number | null) => void;
  onTogglePoeMask: () => void;
  onTelemetryUpdate: (summary: TelemetrySummary) => void;
}

const FIXED_DT = 1 / 240; // 240 Hz 物理固定步长
const SNAPSHOT_INTERVAL = 1 / 60;
const MAX_SNAPSHOTS = 2400;

function findClosestSnapshot(snapshots: readonly SnapshotFrame[], targetT: number): SnapshotFrame | null {
  if (snapshots.length === 0) return null;
  let lo = 0;
  let hi = snapshots.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (snapshots[mid]!.t < targetT) lo = mid + 1;
    else hi = mid;
  }
  const cand = snapshots[lo]!;
  if (lo > 0) {
    const prev = snapshots[lo - 1]!;
    if (Math.abs(prev.t - targetT) < Math.abs(cand.t - targetT)) {
      return prev;
    }
  }
  return cand;
}

export const SimulationStage: React.FC<SimulationStageProps> = ({
  plugin,
  params,
  activeLayers,
  isPlaying,
  playbackSpeed,
  strobeEnabled,
  poeMasked,
  theme,
  measureTool,
  autoFbdEnabled,
  fbdComponentsEnabled,
  activeFrameId,
  view3dEnabled,
  resetViewNonce,
  resetNonce,
  stepOnceNonce,
  scrubTime,
  canvasRefExternal,
  onResetView,
  onUpdateParamsBatch,
  onRegisterSnapshotsGetter,
  onScrubTime,
  onTogglePoeMask,
  onTelemetryUpdate
}) => {
  const internalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = canvasRefExternal ?? internalCanvasRef;
  const stageBoxRef = useRef<HTMLDivElement | null>(null);
  const uplotWrapRef = useRef<HTMLDivElement | null>(null);
  const uplotInstanceRef = useRef<uPlot | null>(null);

  const channels = plugin.telemetryChannels;
  const [channelA, setChannelA] = useState<string>(channels[0]?.key ?? '');
  const [channelB, setChannelB] = useState<string>(channels[1]?.key ?? channels[0]?.key ?? '');

  // 当模型切换时同步默认示波器双通道
  useEffect(() => {
    setChannelA(plugin.telemetryChannels[0]?.key ?? '');
    setChannelB(plugin.telemetryChannels[1]?.key ?? plugin.telemetryChannels[0]?.key ?? '');
  }, [plugin.meta.id]);

  // 全部高频物理数据放入 ref，杜绝每帧触发 React 重渲染
  const simStateRef = useRef<unknown>(null);
  const initialStateRef = useRef<unknown>(null);
  const eventsRef = useRef<PhysicsEvent[]>([]);
  const snapshotsRef = useRef<SnapshotFrame[]>([]);
  const lastSnapshotTRef = useRef<number>(-1);
  const accumulatorRef = useRef<number>(0);
  const lastFrameMsRef = useRef<number | null>(null);
  const lastUiSyncMsRef = useRef<number>(0);
  const viewportRef = useRef<Viewport>({
    width: 800,
    height: 460,
    dpr: 1,
    scale: 1,
    offsetX: 0,
    offsetY: 0
  });

  const [zoomPercent, setZoomPercent] = useState<number>(100);
  const [fbdCount, setFbdCount] = useState<number>(0);
  const fbdCountRef = useRef<number>(0);
  const [overlayViewport, setOverlayViewport] = useState<Viewport>({
    width: 800,
    height: 460,
    dpr: 1,
    scale: 1,
    offsetX: 0,
    offsetY: 0
  });
  const cameraRef = useRef<CameraTransform>(DEFAULT_CAMERA_TRANSFORM);
  const dragModeRef = useRef<
    | { kind: 'pan'; lastX: number; lastY: number }
    | { kind: 'handle'; handle: ControlHandle }
    | null
  >(null);

  // 最新 props ref 供 rAF 与 uPlot hook 无闭包陈旧值访问
  const latestRef = useRef({
    plugin,
    params,
    activeLayers,
    isPlaying,
    playbackSpeed,
    strobeEnabled,
    poeMasked,
    theme,
    autoFbdEnabled,
    fbdComponentsEnabled,
    activeFrameId,
    scrubTime,
    channelA,
    channelB,
    onUpdateParamsBatch,
    onScrubTime,
    onTelemetryUpdate
  });
  latestRef.current = {
    plugin,
    params,
    activeLayers,
    isPlaying,
    playbackSpeed,
    strobeEnabled,
    poeMasked,
    theme,
    autoFbdEnabled,
    fbdComponentsEnabled,
    activeFrameId,
    scrubTime,
    channelA,
    channelB,
    onUpdateParamsBatch,
    onScrubTime,
    onTelemetryUpdate
  };

  useEffect(() => {
    onRegisterSnapshotsGetter?.(() =>
      snapshotsRef.current.map((s) => ({ t: s.t, observables: s.observables }))
    );
  }, [onRegisterSnapshotsGetter]);

  const computeEffectiveViewport = (baseVp: Viewport, drawState: unknown): {
    effectiveVp: Viewport;
    frameOrigin: { x: number; y: number };
  } => {
    const cam = cameraRef.current;
    const zoomedVp: Viewport = {
      ...baseVp,
      scale: cam.scale,
      offsetX: cam.offsetX,
      offsetY: cam.offsetY
    };
    const { plugin: p, params: pm, activeFrameId: frameId } = latestRef.current;
    const v2 = p as SimulationPluginV2<ParamRecord, unknown>;
    let frameOrigin = { x: 0, y: 0 };
    if (frameId !== 'ground' && drawState !== null && v2.referenceFrames) {
      const spec = v2.referenceFrames.find((f) => f.id === frameId);
      if (spec) {
        frameOrigin = spec.getOrigin(drawState, pm);
      }
    }
    const ppm = getPixelsPerMeter(zoomedVp);
    return {
      frameOrigin,
      effectiveVp: {
        ...zoomedVp,
        offsetX: zoomedVp.offsetX - frameOrigin.x * ppm,
        offsetY: zoomedVp.offsetY + frameOrigin.y * ppm
      }
    };
  };

  const renderFrameToCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const {
      plugin: p,
      params: pm,
      activeLayers: layersArr,
      strobeEnabled: strobe,
      poeMasked: masked,
      theme: currentTheme,
      autoFbdEnabled: showFbd,
      fbdComponentsEnabled: showFbdComp,
      scrubTime: scrub
    } = latestRef.current;

    const baseVp = viewportRef.current;
    ctx.save();
    ctx.setTransform(baseVp.dpr, 0, 0, baseVp.dpr, 0, 0);

    // 清空背景（高对比投影白底或黑板深蓝）
    ctx.fillStyle = currentTheme === 'projector' ? '#ffffff' : '#091220';
    ctx.fillRect(0, 0, baseVp.width, baseVp.height);

    const frame =
      scrub !== null
        ? findClosestSnapshot(snapshotsRef.current, scrub)
        : snapshotsRef.current[snapshotsRef.current.length - 1] ?? null;
    const drawState = frame ? frame.state : simStateRef.current;
    const { effectiveVp: vp, frameOrigin } = computeEffectiveViewport(baseVp, drawState);

    if (drawState !== null) {
      const layerSet = new Set(layersArr);
      // POE 遮罩启用时隐藏轨迹与动态圆包络等揭示答案图层
      if (masked) {
        layerSet.delete('trajectory');
        layerSet.delete('larmorCircle');
        layerSet.delete('slopeGhost');
        layerSet.delete('vibrationGraph');
        layerSet.delete('eventPins');
      }
      p.renderCanvas(ctx, drawState, pm, vp, layerSet);

      // 壳层统一 Strobe 频闪打点叠加
      if (strobe && !masked && snapshotsRef.current.length > 2) {
        const currentT = frame ? frame.t : 0;
        const pxPerMeter = getPixelsPerMeter(vp);
        const ox = vp.width * 0.45 + vp.offsetX;
        const oy = vp.height * 0.5 + vp.offsetY;
        let lastMarkT = -1;
        ctx.save();
        for (const snap of snapshotsRef.current) {
          if (snap.t > currentT) break;
          if (snap.t - lastMarkT < 0.08) continue;
          lastMarkT = snap.t;
          const sxVal = snap.observables.x;
          const syVal = snap.observables.y;
          if (typeof sxVal === 'number' && typeof syVal === 'number') {
            ctx.fillStyle = 'rgba(251, 191, 36, 0.72)';
            ctx.beginPath();
            ctx.arc(ox + sxVal * pxPerMeter, oy - syVal * pxPerMeter, 3.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      const v2 = p as SimulationPluginV2<ParamRecord, unknown>;
      // V2 Auto-FBD 受力矢量与正交分解叠绘
      if (showFbd && !masked && v2.getForceVectors) {
        const vectors = v2.getForceVectors(drawState, pm);
        renderAutoFbdToCanvas(ctx, {
          vectors,
          viewport: vp,
          frameOrigin: { x: 0, y: 0 },
          showComponents: showFbdComp
        });
        if (vectors.length !== fbdCountRef.current) {
          fbdCountRef.current = vectors.length;
          setFbdCount(vectors.length);
        }
      } else if (fbdCountRef.current !== 0) {
        fbdCountRef.current = 0;
        setFbdCount(0);
      }

      // V2 画布直操手柄渲染
      if (!masked && v2.getControlHandles) {
        const handles = v2.getControlHandles(drawState, pm);
        ctx.save();
        for (const h of handles) {
          const sPos = worldToScreen(h.position.x, h.position.y, vp);
          if (h.origin) {
            const sOrig = worldToScreen(h.origin.x, h.origin.y, vp);
            ctx.setLineDash([4, 3]);
            ctx.strokeStyle = h.color ?? '#38bdf8';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(sOrig.x, sOrig.y);
            ctx.lineTo(sPos.x, sPos.y);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          ctx.fillStyle = h.color ?? '#38bdf8';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sPos.x, sPos.y, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.font = 'bold 11px sans-serif';
          ctx.fillText(h.label, sPos.x + 10, sPos.y + 4);
        }
        ctx.restore();
      }

      // 若锁定在运动随动参考系，标注左下提示
      if (latestRef.current.activeFrameId !== 'ground') {
        ctx.save();
        ctx.fillStyle = 'rgba(56, 189, 248, 0.9)';
        ctx.font = 'bold 12px monospace';
        ctx.fillText(
          `随动参考系锁定: (${frameOrigin.x.toFixed(2)}, ${frameOrigin.y.toFixed(2)}) m`,
          14,
          vp.height - 14
        );
        ctx.restore();
      }
    }

    // 回放时间游标提示
    if (scrub !== null && frame) {
      ctx.save();
      ctx.fillStyle = 'rgba(251, 191, 36, 0.92)';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText(`时间轴回放 t = ${frame.t.toFixed(3)} s`, vp.width - 210, 28);
      ctx.restore();
    }

    ctx.restore();
  };

  const syncUPlotData = () => {
    const plot = uplotInstanceRef.current;
    if (!plot) return;
    const snaps = snapshotsRef.current;
    const { channelA: chA, channelB: chB } = latestRef.current;
    const ts: number[] = new Array(snaps.length);
    const seriesA: number[] = new Array(snaps.length);
    const seriesB: number[] = new Array(snaps.length);
    for (let i = 0; i < snaps.length; i++) {
      const s = snaps[i]!;
      ts[i] = s.t;
      seriesA[i] = chA ? (s.observables[chA] ?? 0) : 0;
      seriesB[i] = chB ? (s.observables[chB] ?? 0) : 0;
    }
    plot.setData([ts, seriesA, seriesB]);
  };

  const emitTelemetrySummary = (force = false) => {
    const now = performance.now();
    if (!force && now - lastUiSyncMsRef.current < 90) return;
    lastUiSyncMsRef.current = now;

    const { plugin: p, params: pm, scrubTime: scrub, onTelemetryUpdate: notify } = latestRef.current;
    const snaps = snapshotsRef.current;
    const activeSnap =
      scrub !== null
        ? findClosestSnapshot(snaps, scrub)
        : snaps[snaps.length - 1] ?? null;

    if (!activeSnap || initialStateRef.current === null) return;
    const invariants = p.engine.checkInvariants
      ? p.engine.checkInvariants(activeSnap.state, initialStateRef.current, pm)
      : [];
    const formulaItems = p.formatFormulas ? p.formatFormulas(activeSnap.state, pm) : [];

    notify({
      t: activeSnap.t,
      observables: activeSnap.observables,
      events: eventsRef.current,
      invariants,
      formulaItems
    });
  };

  // 初始化 / 重置引擎状态
  useEffect(() => {
    const init = plugin.engine.createInitialState(params);
    const obs0 = plugin.engine.computeObservables(init, params);
    simStateRef.current = init;
    initialStateRef.current = init;
    eventsRef.current = [];
    snapshotsRef.current = [{ t: 0, state: init, observables: obs0 }];
    lastSnapshotTRef.current = 0;
    accumulatorRef.current = 0;
    lastFrameMsRef.current = null;

    renderFrameToCanvas();
    syncUPlotData();
    emitTelemetrySummary(true);
  }, [plugin.meta.id, resetNonce]);

  // 单步精准步进 (16.67 ms = 4 * FIXED_DT)
  useEffect(() => {
    if (stepOnceNonce === 0) return;
    let cur = simStateRef.current;
    if (cur === null) return;

    const currentT = snapshotsRef.current[snapshotsRef.current.length - 1]?.t ?? 0;
    let stepT = currentT;
    for (let i = 0; i < 4; i++) {
      const res = plugin.engine.step(cur, params, FIXED_DT);
      cur = res.nextState;
      stepT += FIXED_DT;
      if (res.events.length > 0) {
        eventsRef.current = [...eventsRef.current, ...res.events];
      }
    }
    simStateRef.current = cur;
    const obs = plugin.engine.computeObservables(cur, params);
    snapshotsRef.current.push({ t: stepT, state: cur, observables: obs });
    if (snapshotsRef.current.length > MAX_SNAPSHOTS) {
      snapshotsRef.current.shift();
    }
    lastSnapshotTRef.current = stepT;

    renderFrameToCanvas();
    syncUPlotData();
    emitTelemetrySummary(true);
  }, [stepOnceNonce]);

  // 响应图层、主题、回放指针、FBD、参考系等非物理步进重绘
  useEffect(() => {
    renderFrameToCanvas();
    emitTelemetrySummary(true);
  }, [activeLayers, strobeEnabled, poeMasked, theme, scrubTime, autoFbdEnabled, fbdComponentsEnabled, activeFrameId]);

  // 响应视角复位
  useEffect(() => {
    if (resetViewNonce === 0) return;
    cameraRef.current = DEFAULT_CAMERA_TRANSFORM;
    viewportRef.current = {
      ...viewportRef.current,
      scale: 1,
      offsetX: 0,
      offsetY: 0
    };
    setZoomPercent(100);
    setOverlayViewport(viewportRef.current);
    renderFrameToCanvas();
  }, [resetViewNonce]);

  // 鼠标滚轮以指针为锚点缩放 (0.1x ~ 20x)
  useEffect(() => {
    const box = stageBoxRef.current;
    if (!box) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = box.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = zoomViewportAtCursor(
        cameraRef.current,
        cx,
        cy,
        viewportRef.current.width,
        viewportRef.current.height,
        factor
      );
      cameraRef.current = next;
      viewportRef.current = {
        ...viewportRef.current,
        scale: next.scale,
        offsetX: next.offsetX,
        offsetY: next.offsetY
      };
      setZoomPercent(Math.round(next.scale * 100));
      setOverlayViewport(viewportRef.current);
      renderFrameToCanvas();
    };
    box.addEventListener('wheel', handleWheel, { passive: false });
    return () => box.removeEventListener('wheel', handleWheel);
  }, []);

  // 响应通道切换更新示波器曲线
  useEffect(() => {
    syncUPlotData();
  }, [channelA, channelB]);

  // 监控 Canvas 容器尺寸变化 (High DPR)
  useEffect(() => {
    const box = stageBoxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;

    const updateSize = () => {
      const rect = box.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(320, Math.floor(rect.width));
      const height = Math.max(240, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      viewportRef.current = {
        ...viewportRef.current,
        width,
        height,
        dpr
      };
      setOverlayViewport(viewportRef.current);
      renderFrameToCanvas();
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // 主 60fps requestAnimationFrame 固定物理步长循环
  useEffect(() => {
    let rafId = 0;

    const loop = (nowMs: number) => {
      rafId = requestAnimationFrame(loop);
      const { isPlaying: playing, playbackSpeed: speed, plugin: p, params: pm } = latestRef.current;
      if (!playing) {
        lastFrameMsRef.current = null;
        return;
      }

      if (lastFrameMsRef.current === null) {
        lastFrameMsRef.current = nowMs;
        return;
      }

      const rawDtSec = Math.min((nowMs - lastFrameMsRef.current) / 1000, 0.05);
      lastFrameMsRef.current = nowMs;
      accumulatorRef.current += rawDtSec * speed;

      let stepped = false;
      let cur = simStateRef.current;
      let simT = snapshotsRef.current[snapshotsRef.current.length - 1]?.t ?? 0;

      while (accumulatorRef.current >= FIXED_DT && cur !== null) {
        const res = p.engine.step(cur, pm, FIXED_DT);
        cur = res.nextState;
        simT += FIXED_DT;
        accumulatorRef.current -= FIXED_DT;
        stepped = true;

        if (res.events.length > 0) {
          eventsRef.current = [...eventsRef.current, ...res.events];
        }

        if (simT - lastSnapshotTRef.current >= SNAPSHOT_INTERVAL) {
          const obs = p.engine.computeObservables(cur, pm);
          snapshotsRef.current.push({ t: simT, state: cur, observables: obs });
          if (snapshotsRef.current.length > MAX_SNAPSHOTS) {
            snapshotsRef.current.shift();
          }
          lastSnapshotTRef.current = simT;
        }
      }

      if (stepped && cur !== null) {
        simStateRef.current = cur;
        renderFrameToCanvas();
        syncUPlotData();
        emitTelemetrySummary(false);
      }
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // 初始化 uPlot 示波器实例（支持悬停/点击时间轴双向联动回放）
  const specA = useMemo(
    () => channels.find((c) => c.key === channelA) ?? channels[0],
    [channels, channelA]
  );
  const specB = useMemo(
    () => channels.find((c) => c.key === channelB) ?? channels[1] ?? channels[0],
    [channels, channelB]
  );

  useEffect(() => {
    const wrap = uplotWrapRef.current;
    if (!wrap) return;

    const width = Math.max(300, wrap.clientWidth);
    const height = 160;
    const textColor = theme === 'projector' ? '#0f172a' : '#cbd5e1';
    const gridColor = theme === 'projector' ? 'rgba(15, 23, 42, 0.12)' : 'rgba(148, 163, 184, 0.16)';

    const opts: uPlot.Options = {
      width,
      height,
      cursor: {
        drag: { x: false, y: false },
        points: { size: 7 }
      },
      legend: { show: true },
      scales: {
        x: { time: false },
        y: { auto: true }
      },
      axes: [
        {
          stroke: textColor,
          grid: { stroke: gridColor, width: 1 },
          values: (_u, splits) => splits.map((v) => `${v.toFixed(1)}s`)
        },
        {
          stroke: textColor,
          grid: { stroke: gridColor, width: 1 }
        }
      ],
      series: [
        { label: '时间 t (s)' },
        {
          label: specA ? `${specA.label} (${specA.unit})` : '通道 A',
          stroke: specA?.color ?? '#38bdf8',
          width: 2.2
        },
        {
          label: specB ? `${specB.label} (${specB.unit})` : '通道 B',
          stroke: specB?.color ?? '#f472b6',
          width: 2.0,
          dash: channelA === channelB ? [4, 4] : undefined
        }
      ],
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            if (idx === null || idx === undefined) return;
            if (latestRef.current.isPlaying) return;
            const tVal = u.data[0]?.[idx];
            if (typeof tVal === 'number' && Number.isFinite(tVal)) {
              latestRef.current.onScrubTime(tVal);
            }
          }
        ]
      }
    };

    const plot = new uPlot(opts, [[0], [0], [0]], wrap);
    uplotInstanceRef.current = plot;
    syncUPlotData();

    const ro = new ResizeObserver(() => {
      if (!uplotWrapRef.current) return;
      plot.setSize({
        width: Math.max(280, uplotWrapRef.current.clientWidth),
        height: 160
      });
    });
    ro.observe(wrap);

    return () => {
      ro.disconnect();
      plot.destroy();
      uplotInstanceRef.current = null;
    };
  }, [plugin.meta.id, channelA, channelB, theme]);

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      {/* 主 Canvas 画布容器 */}
      <div
        ref={stageBoxRef}
        data-testid="stage-canvas-box"
        className="relative flex-1 min-h-[260px] rounded-xl overflow-hidden border"
        style={{
          borderColor: 'var(--pf-border)',
          backgroundColor: 'var(--pf-canvas-bg)'
        }}
      >
        {view3dEnabled ? (
          <Suspense
            fallback={
              <div className="w-full h-full flex items-center justify-center text-sky-300 text-sm">
                正在按需加载 Vanilla Three.js 3D 舞台...
              </div>
            }
          >
            <LazyThreeStage
              plugin={plugin as SimulationPluginV2<ParamRecord, unknown>}
              simState={simStateRef.current}
              params={params}
              activeLayers={new Set(activeLayers)}
            />
          </Suspense>
        ) : (
          <canvas
            ref={canvasRef}
            data-testid="simulation-canvas"
            className="block w-full h-full touch-none cursor-grab active:cursor-grabbing"
            onPointerDown={(e) => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              const rect = canvas.getBoundingClientRect();
              const sx = e.clientX - rect.left;
              const sy = e.clientY - rect.top;
              const v2 = plugin as SimulationPluginV2<ParamRecord, unknown>;
              const state = simStateRef.current;
              const { effectiveVp } = computeEffectiveViewport(viewportRef.current, state);
              if (state !== null && v2.getControlHandles && e.button === 0) {
                const handles = v2.getControlHandles(state, params);
                for (const h of handles) {
                  const hs = worldToScreen(h.position.x, h.position.y, effectiveVp);
                  if (Math.hypot(hs.x - sx, hs.y - sy) <= 14) {
                    canvas.setPointerCapture?.(e.pointerId);
                    dragModeRef.current = { kind: 'handle', handle: h };
                    return;
                  }
                }
              }
              canvas.setPointerCapture?.(e.pointerId);
              dragModeRef.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
            }}
            onPointerMove={(e) => {
              const mode = dragModeRef.current;
              if (!mode) return;
              const canvas = canvasRef.current;
              if (!canvas) return;
              if (mode.kind === 'handle') {
                const rect = canvas.getBoundingClientRect();
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;
                const { effectiveVp } = computeEffectiveViewport(
                  viewportRef.current,
                  simStateRef.current
                );
                const world = screenToWorld(sx, sy, effectiveVp);
                onUpdateParamsBatch(mode.handle.onDrag(world), `拖拽手柄 ${mode.handle.label}`);
              } else {
                const dx = e.clientX - mode.lastX;
                const dy = e.clientY - mode.lastY;
                mode.lastX = e.clientX;
                mode.lastY = e.clientY;
                const next = panViewport(cameraRef.current, dx, dy);
                cameraRef.current = next;
                viewportRef.current = {
                  ...viewportRef.current,
                  offsetX: next.offsetX,
                  offsetY: next.offsetY
                };
                setOverlayViewport(viewportRef.current);
                renderFrameToCanvas();
              }
            }}
            onPointerUp={() => {
              dragModeRef.current = null;
            }}
            onPointerCancel={() => {
              dragModeRef.current = null;
            }}
          />
        )}

        {/* V2 实测工具箱叠加层（虚拟直尺 / 0.1° 量角器 / 三点圆规） */}
        <RulerToolboxOverlay
          activeTool={measureTool}
          viewport={overlayViewport}
          frameOrigin={computeEffectiveViewport(overlayViewport, simStateRef.current).frameOrigin}
        />

        <AutoFbdBadge active={autoFbdEnabled && !poeMasked} count={fbdCount} />

        {/* 右上角视口缩放 HUD */}
        <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5 rounded-lg bg-slate-900/80 border border-slate-700/70 px-2 py-1 text-xs font-mono text-slate-200">
          <span data-testid="viewport-zoom-badge">{zoomPercent}%</span>
          <button
            type="button"
            data-testid="btn-reset-view"
            onClick={onResetView}
            className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 cursor-pointer"
          >
            居中
          </button>
        </div>

        {/* POE 预测遮罩层 */}
        {poeMasked && (
          <div
            data-testid="poe-mask-overlay"
            className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/75 backdrop-blur-sm text-center p-6 z-10"
          >
            <div className="max-w-lg rounded-2xl border border-amber-400/50 bg-slate-900/95 p-6 shadow-2xl">
              <div className="text-amber-300 font-bold text-lg mb-2">
                POE 课堂预测遮罩已启用（Predict）
              </div>
              <p className="text-slate-200 text-sm leading-relaxed mb-4">
                轨迹预测、动态包络线与实时示波器曲线已隐藏。请引导学生先根据已知条件口头预测运动轨迹、临界状态与图像斜率变化，再点击下方按钮揭晓观察。
              </p>
              <button
                type="button"
                onClick={onTogglePoeMask}
                className="pf-touch-target px-5 py-2.5 rounded-xl bg-amber-400 text-slate-950 font-bold hover:bg-amber-300 transition cursor-pointer"
              >
                揭晓观察（Observe）
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 底部 uPlot 双通道双向时间轴示波器 */}
      <div
        className="rounded-xl border p-2.5 shrink-0"
        style={{
          borderColor: 'var(--pf-border)',
          backgroundColor: 'var(--pf-surface)'
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold" style={{ color: 'var(--pf-accent)' }}>
              实时示波器（暂停时悬停波形可双向回放）
            </span>
            <label className="flex items-center gap-1">
              <span style={{ color: 'var(--pf-text-muted)' }}>通道 A:</span>
              <select
                aria-label="示波器通道 A"
                value={channelA}
                onChange={(e) => setChannelA(e.target.value)}
                className="rounded border px-2 py-1 text-sm"
                style={{
                  borderColor: 'var(--pf-border)',
                  backgroundColor: 'var(--pf-surface-elevated)',
                  color: 'var(--pf-text)'
                }}
              >
                {channels.map((ch) => (
                  <option key={ch.key} value={ch.key}>
                    {ch.label} ({ch.unit})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              <span style={{ color: 'var(--pf-text-muted)' }}>通道 B:</span>
              <select
                aria-label="示波器通道 B"
                value={channelB}
                onChange={(e) => setChannelB(e.target.value)}
                className="rounded border px-2 py-1 text-sm"
                style={{
                  borderColor: 'var(--pf-border)',
                  backgroundColor: 'var(--pf-surface-elevated)',
                  color: 'var(--pf-text)'
                }}
              >
                {channels.map((ch) => (
                  <option key={ch.key} value={ch.key}>
                    {ch.label} ({ch.unit})
                  </option>
                ))}
              </select>
            </label>
          </div>
          {scrubTime !== null && (
            <button
              type="button"
              onClick={() => onScrubTime(null)}
              className="px-3 py-1 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-400/40 text-xs font-semibold cursor-pointer"
            >
              回放 t={scrubTime.toFixed(2)}s · 点击回到最新
            </button>
          )}
        </div>

        <div className="relative">
          <div ref={uplotWrapRef} data-testid="uplot-container" className="w-full" />
          {poeMasked && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/85 rounded-lg text-amber-300 font-semibold text-sm">
              示波器曲线已在 POE 预测阶段遮蔽
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
