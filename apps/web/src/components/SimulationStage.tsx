import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import { ChevronDown, ChevronUp, Crosshair, MoveDiagonal2, RotateCcw, Ruler } from 'lucide-react';
import type { AnySimulationPlugin } from '@physforge/simulations/registry';
import type { ClassroomTheme, TelemetrySummary } from '../store/useClassroomStore.js';
import { isSimulationPluginV3, resolvePluginParams } from '@physforge/sim-sdk';
import type {
  StoryDeck,
  StoryRunner,
  ControlHandle,
  ParamRecord,
  ParamValue,
  PhysicsEvent,
  SimulationPluginV2,
  Viewport
} from '@physforge/sim-sdk';
import {
  DEFAULT_CAMERA_TRANSFORM,
  clampZoomScale,
  getPixelsPerMeter,
  panViewport,
  resolveInitialCameraTransform,
  screenToWorld,
  worldToScreen,
  zoomViewportAtCursor,
  type CameraTransform
} from '../stage/ViewportController.js';
import { RulerToolboxOverlay, type MeasureToolKind } from '../stage/RulerToolboxOverlay.js';
import { AutoFbdBadge, renderAutoFbdToCanvas } from '../stage/AutoFbdOverlay.js';
import { cameraToStoryView, flatStoryView, interpolateStoryView, spatialStoryView, storyCameraDuration,
  storyViewToCamera, validStoryView2D, validStoryView3D, type StorySpatialCommand, type StoryView2D } from '../presentation/storyCamera.js';

const LazyThreeStage = React.lazy(() =>
  import('../stage/ThreeStage.js').then((m) => ({ default: m.ThreeStage }))
);

function getDefaultScopeChannels(
  modelId: string,
  params: ParamRecord,
  channels: ReadonlyArray<{ key: string }>
): [string, string] {
  const singleRodE04 = modelId === 'em-induction-double-rod' && params.rodMode === 'single';
  const defaultA = singleRodE04
    ? channels.find((channel) => channel.key === 'current')?.key
    : channels[0]?.key;
  const defaultB = singleRodE04
    ? channels.find((channel) => channel.key === 'v1')?.key
    : channels[1]?.key ?? defaultA;
  return [defaultA ?? channels[0]?.key ?? '', defaultB ?? defaultA ?? channels[1]?.key ?? ''];
}

interface SnapshotFrame {
  t: number;
  state: unknown;
  observables: Record<string, number>;
}

export interface RecordedTelemetryFrame {
  t: number;
  state?: unknown;
  observables: Record<string, number>;
}

export interface StoryNavigation {
  next: () => boolean;
  prev: () => boolean;
  goTo: (index: number) => boolean;
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
  oscilloscopeCollapsed: boolean;
  presentationMode: boolean;
  resetViewNonce: number;
  resetNonce: number;
  stepOnceNonce: number;
  scrubTime: number | null;
  canvasRefExternal?: React.RefObject<HTMLCanvasElement | null>;
  onResetView: () => void;
  onToggleOscilloscope: () => void;
  onToggleMeasureTool: (tool: Exclude<MeasureToolKind, 'none'>) => void;
  onUpdateParamsBatch: (patch: Record<string, ParamValue>, label?: string) => void;
  onRegisterSnapshotsGetter?: (getter: () => readonly RecordedTelemetryFrame[]) => void;
  onScrubTime: (t: number | null) => void;
  onTogglePoeMask: () => void;
  onTelemetryUpdate: (summary: TelemetrySummary) => void;
  storyDeck?: StoryDeck;
  storyNavigationRef?: React.RefObject<StoryNavigation | null>;
  onStoryParams?: (modelId: string, params: ParamRecord) => void;
  onStoryBeat?: (index: number) => void;
  onStoryFreeze?: (badge: string) => void;
  onStoryPlaying?: (playing: boolean) => void;
  onStoryFbd?: (enabled: boolean) => void;
  onStoryFrame?: (frame: string) => void;
  onStoryView3d?: (enabled: boolean) => void;
  onMorphProgress?: (progress: number) => void;
  onWebGLFallback?: () => void;
}

const FIXED_DT = 1 / 240; // 240 Hz 物理固定步长
const SNAPSHOT_INTERVAL = 1 / 60;
const MAX_SNAPSHOTS = 2400;

interface PinchGesture {
  initialDistance: number;
  startX: number;
  startY: number;
  camera: CameraTransform;
}

const dotPatternCache = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();

function getDotPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const cached = dotPatternCache.get(ctx);
  if (cached) return cached;
  const tile = document.createElement('canvas');
  tile.width = 24;
  tile.height = 24;
  const tileContext = tile.getContext('2d');
  if (!tileContext) return null;
  tileContext.fillStyle = 'rgba(148, 163, 184, 0.14)';
  tileContext.beginPath();
  tileContext.arc(1, 1, 0.8, 0, Math.PI * 2);
  tileContext.fill();
  const pattern = ctx.createPattern(tile, 'repeat');
  if (pattern) dotPatternCache.set(ctx, pattern);
  return pattern;
}

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
  oscilloscopeCollapsed,
  presentationMode,
  resetViewNonce,
  resetNonce,
  stepOnceNonce,
  scrubTime,
  canvasRefExternal,
  onResetView,
  onToggleOscilloscope,
  onToggleMeasureTool,
  onUpdateParamsBatch,
  onRegisterSnapshotsGetter,
  onScrubTime,
  onTogglePoeMask,
  onTelemetryUpdate,
  storyDeck, storyNavigationRef, onStoryParams, onStoryBeat, onStoryFreeze, onStoryPlaying, onStoryFbd, onStoryFrame,
  onStoryView3d, onMorphProgress, onWebGLFallback
}) => {
  const internalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = canvasRefExternal ?? internalCanvasRef;
  const stageBoxRef = useRef<HTMLDivElement | null>(null);
  const spatial = isSimulationPluginV3(plugin) ? plugin.spatial3D : undefined;
  const [heldThreeId, setHeldThreeId] = useState<string | null>(() => view3dEnabled ? plugin.meta.id : null);
  const showThree = view3dEnabled || Boolean(presentationMode && spatial && heldThreeId === plugin.meta.id);
  const showThreeRef = useRef(showThree);
  showThreeRef.current = showThree;
  const storySpatialCommandRef = useRef<StorySpatialCommand | null>(null);
  const storyCameraTweenRef = useRef<{ from: StoryView2D; to: StoryView2D; start: number; duration: number } | null>(null);
  const storyCameraUiAtRef = useRef(-Infinity);
  const threeLayers = useMemo(() => new Set(activeLayers), [activeLayers]);
  const previouslyShowThreeRef = useRef(showThree);
  const initialFlatViewportRef = useRef<Viewport | undefined>(undefined);
  const enterFromCanvas = showThree && !previouslyShowThreeRef.current && Boolean(presentationMode && spatial);
  useEffect(() => {
    previouslyShowThreeRef.current = showThree;
    if (view3dEnabled) setHeldThreeId(plugin.meta.id);
    else if (!presentationMode || !spatial) setHeldThreeId(null);
    if (!showThree) onMorphProgress?.(1);
    else if (!spatial) onMorphProgress?.(0);
  }, [showThree, view3dEnabled, plugin.meta.id, presentationMode, spatial]);
  const uplotWrapRef = useRef<HTMLDivElement | null>(null);
  const uplotInstanceRef = useRef<uPlot | null>(null);
  const lastPlotSyncMsRef = useRef(0);

  const channels = plugin.telemetryChannels;
  const [channelA, setChannelA] = useState<string>(() => getDefaultScopeChannels(plugin.meta.id, params, channels)[0]);
  const [channelB, setChannelB] = useState<string>(() => getDefaultScopeChannels(plugin.meta.id, params, channels)[1]);

  // 当模型切换时同步默认示波器双通道
  useEffect(() => {
    const [defaultA, defaultB] = getDefaultScopeChannels(plugin.meta.id, params, plugin.telemetryChannels);
    setChannelA(defaultA);
    setChannelB(defaultB);
  }, [plugin.meta.id, params.rodMode]);

  // 全部高频物理数据放入 ref，杜绝每帧触发 React 重渲染
  const simStateRef = useRef<unknown>(null);
  const initialStateRef = useRef<unknown>(null);
  const eventsRef = useRef<PhysicsEvent[]>([]);
  const snapshotsRef = useRef<SnapshotFrame[]>([]);
  const lastSnapshotTRef = useRef<number>(-1);
  const simulationTimeRef = useRef(0);
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

  if (enterFromCanvas) initialFlatViewportRef.current = { ...viewportRef.current };
  else if (!showThree) initialFlatViewportRef.current = undefined;

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
  const baseScaleRef = useRef<number>(1);
  const userTransformedViewRef = useRef<boolean>(false);
  const applyDefaultCameraView = (width: number, height: number) => {
    const v2 = latestRef.current.plugin as SimulationPluginV2<ParamRecord, unknown>;
    const initialCamera = resolveInitialCameraTransform(v2, latestRef.current.params, width, height);
    baseScaleRef.current = Math.max(1e-6, initialCamera.scale);
    userTransformedViewRef.current = false;
    cameraRef.current = initialCamera;
    viewportRef.current = {
      ...viewportRef.current,
      scale: initialCamera.scale,
      offsetX: initialCamera.offsetX,
      offsetY: initialCamera.offsetY
    };
    setZoomPercent(100);
    setOverlayViewport(viewportRef.current);
  };
  const applyStoryCamera2D = (view: StoryView2D, now: number, forceUi = false) => {
    const next = storyViewToCamera(view, viewportRef.current, baseScaleRef.current);
    cameraRef.current = next;
    viewportRef.current = { ...viewportRef.current, ...next };
    userTransformedViewRef.current = true;
    if (forceUi || now - storyCameraUiAtRef.current >= 1000 / 15) {
      storyCameraUiAtRef.current = now;
      setZoomPercent(Math.round(100 * next.scale / Math.max(1e-6, baseScaleRef.current)));
      setOverlayViewport(viewportRef.current);
    }
  };
  const advanceStoryCamera2D = (now: number): boolean => {
    const tween = storyCameraTweenRef.current;
    if (!tween) return false;
    const progress = tween.duration === 0 ? 1 : (now - tween.start) / tween.duration;
    const finished = progress >= 1;
    applyStoryCamera2D(finished ? tween.to : interpolateStoryView(tween.from, tween.to, progress), now, finished);
    if (finished) storyCameraTweenRef.current = null;
    return true;
  };
  const completeFlatMorph = (aligned: Viewport) => {
    const transform = { scale: aligned.scale, offsetX: aligned.offsetX, offsetY: aligned.offsetY };
    cameraRef.current = transform;
    viewportRef.current = aligned;
    userTransformedViewRef.current = true;
    setZoomPercent(Math.round(100 * aligned.scale / Math.max(1e-6, baseScaleRef.current)));
    setOverlayViewport(aligned);
    setHeldThreeId(null);
  };
  const dragModeRef = useRef<
    | { kind: 'pan'; lastX: number; lastY: number }
    | { kind: 'handle'; handle: ControlHandle }
    | null
  >(null);
  const hoveredHandleIdRef = useRef<string | null>(null);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchGestureRef = useRef<PinchGesture | null>(null);

  const storyRunnerRef = useRef<StoryRunner | null>(null);
  const storyParamsRef = useRef<ParamRecord | null>(null);
  const storyOwnerRef = useRef<StoryDeck | undefined>(undefined);
  const requestedStoryDeckRef = useRef(storyDeck);
  requestedStoryDeckRef.current = storyDeck;
  const lastPropsParamsRef = useRef(params);
  const publishedStoryParamsRef = useRef<ParamRecord | null>(null);
  const storyDirtyRef = useRef(false);
  const storyLastSyncRef = useRef(-Infinity);
  const storyCallbacksRef = useRef({ onStoryParams, onStoryBeat, onStoryFreeze, onStoryPlaying, onStoryFbd, onStoryFrame, onStoryView3d });
  storyCallbacksRef.current = { onStoryParams, onStoryBeat, onStoryFreeze, onStoryPlaying, onStoryFbd, onStoryFrame, onStoryView3d };
  if (params !== lastPropsParamsRef.current) {
    lastPropsParamsRef.current = params;
    if (storyParamsRef.current && params !== publishedStoryParamsRef.current) {
      storyParamsRef.current = params;
      storyDirtyRef.current = false;
      storyRunnerRef.current?.cancelTween();
    }
  }
  const imperativeParams = storyDeck && storyOwnerRef.current === storyDeck ? storyParamsRef.current ?? params : params;

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
    oscilloscopeCollapsed,
    presentationMode,
    channelA,
    channelB,
    onUpdateParamsBatch,
    onScrubTime,
    onTelemetryUpdate
  });
  latestRef.current = {
    plugin,
    params: imperativeParams,
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
    oscilloscopeCollapsed,
    presentationMode,
    channelA,
    channelB,
    onUpdateParamsBatch,
    onScrubTime,
    onTelemetryUpdate
  };

  useEffect(() => {
    onRegisterSnapshotsGetter?.(() =>
      snapshotsRef.current.map((s) => ({ t: s.t, state: s.state, observables: s.observables }))
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
    ctx.fillStyle = currentTheme === 'projector' ? '#ffffff' : '#0b0f17';
    ctx.fillRect(0, 0, baseVp.width, baseVp.height);
    if (currentTheme === 'chalkboard') {
      const dotPattern = getDotPattern(ctx);
      if (dotPattern) {
        ctx.fillStyle = dotPattern;
        ctx.fillRect(0, 0, baseVp.width, baseVp.height);
      }
    }

    const frame =
      scrub !== null
        ? findClosestSnapshot(snapshotsRef.current, scrub)
        : snapshotsRef.current[snapshotsRef.current.length - 1] ?? null;
    const drawState = storyRunnerRef.current && scrub === null ? simStateRef.current : frame ? frame.state : simStateRef.current;
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
            const point = worldToScreen(sxVal, syVal, vp);
            ctx.arc(point.x, point.y, 3.6, 0, Math.PI * 2);
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
          const hovered = h.id === hoveredHandleIdRef.current;
          const showHandle = h.showWhenIdle !== false || hovered;
          if (showHandle && hovered) {
            ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
            ctx.shadowColor = h.color ?? '#38bdf8';
            ctx.shadowBlur = 18;
            ctx.beginPath();
            ctx.arc(sPos.x, sPos.y, 15, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
          }
          if (showHandle && h.origin) {
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
          if (showHandle) {
            ctx.fillStyle = h.color ?? '#38bdf8';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(sPos.x, sPos.y, hovered ? 9 : 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.font = hovered ? 'bold 12px sans-serif' : 'bold 11px sans-serif';
          }
          if (showHandle && hovered) {
            const labelWidth = ctx.measureText(h.label).width + 14;
            const labelX = Math.max(6, Math.min(vp.width - labelWidth - 6, sPos.x + 14));
            const labelY = Math.max(18, Math.min(vp.height - 8, sPos.y - 16));
            ctx.fillStyle = 'rgba(11, 15, 23, 0.9)';
            ctx.beginPath();
            ctx.roundRect(labelX, labelY - 13, labelWidth, 22, 6);
            ctx.fill();
            ctx.fillStyle = h.color ?? '#7dd3fc';
            ctx.textBaseline = 'middle';
            ctx.fillText(h.label, labelX + 7, labelY - 2);
            ctx.textBaseline = 'alphabetic';
          } else if (showHandle) {
            ctx.fillText(h.label, sPos.x + 10, sPos.y + 4);
          }
        }
        ctx.restore();
      }

      // 若锁定在运动随动参考系，标注无遮挡角标提示
      if (latestRef.current.activeFrameId !== 'ground') {
        const text = `随动参考系锁定: (${frameOrigin.x.toFixed(2)}, ${frameOrigin.y.toFixed(2)}) m`;
        const hasAutoFbdBadge = !latestRef.current.presentationMode && latestRef.current.autoFbdEnabled && !latestRef.current.poeMasked && fbdCountRef.current > 0;
        const badgeY = latestRef.current.presentationMode ? vp.height - 20 : (hasAutoFbdBadge ? 56 : 24);
        ctx.save();
        ctx.font = 'bold 12px monospace';
        const textWidth = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(11, 15, 23, 0.84)';
        ctx.beginPath();
        ctx.roundRect(12, badgeY - 14, textWidth + 14, 22, 6);
        ctx.fill();
        ctx.fillStyle = 'rgba(56, 189, 248, 0.95)';
        ctx.fillText(text, 19, badgeY + 1);
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

  const syncUPlotData = (force = false) => {
    const plot = uplotInstanceRef.current;
    if (!plot || latestRef.current.oscilloscopeCollapsed) return;
    const now = performance.now();
    if (!force && now - lastPlotSyncMsRef.current < 50) return;
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
    lastPlotSyncMsRef.current = now;
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
        : storyRunnerRef.current && simStateRef.current !== null
          ? { t: simulationTimeRef.current, state: simStateRef.current, observables: p.engine.computeObservables(simStateRef.current, pm) }
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

  // 初始化 / 重置引擎状态（分镜复位复用同一入口）。
  const resetEngine = () => {
    const { plugin: p, params: pm } = latestRef.current;
    const init = p.engine.createInitialState(pm);
    const obs0 = p.engine.computeObservables(init, pm);
    simStateRef.current = init;
    initialStateRef.current = init;
    eventsRef.current = [];
    snapshotsRef.current = [{ t: 0, state: init, observables: obs0 }];
    lastSnapshotTRef.current = 0;
    simulationTimeRef.current = 0;
    accumulatorRef.current = 0;
    lastFrameMsRef.current = null;

    renderFrameToCanvas();
    syncUPlotData(true);
    emitTelemetrySummary(true);
  };
  useEffect(() => { resetEngine(); }, [plugin.meta.id, resetNonce]);

  const flushStoryParams = (modelId: string, nowMs: number, force = false) => {
    if (!storyDirtyRef.current || !storyParamsRef.current) return;
    if (!force && nowMs - storyLastSyncRef.current < 1000 / 15) return;
    const current = storyParamsRef.current;
    publishedStoryParamsRef.current = current;
    storyCallbacksRef.current.onStoryParams?.(modelId, current);
    storyDirtyRef.current = false;
    storyLastSyncRef.current = nowMs;
  };

  useEffect(() => {
    if (!storyDeck || storyDeck.modelId !== plugin.meta.id) return;
    let disposed = false;
    storyOwnerRef.current = storyDeck;
    storyParamsRef.current = latestRef.current.params;
    storyLastSyncRef.current = -Infinity;
    const navigate = (action: (runner: StoryRunner, now: number) => boolean) => {
      const runner = storyRunnerRef.current;
      if (!runner || disposed) return false;
      const now = performance.now();
      const changed = action(runner, now);
      if (changed) {
        flushStoryParams(storyDeck.modelId, now, true);
        renderFrameToCanvas();
        emitTelemetrySummary(true);
      }
      return changed;
    };
    void import('../presentation/StoryStageHud.js').then(({ createStoryRunner }) => {
      if (disposed) return;
      const runner = createStoryRunner(storyDeck, {
        getCurrentParams: () => latestRef.current.params,
        applyParamsImperative: (patch) => {
          const { plugin: p, params: pm } = latestRef.current;
          if (p.meta.id !== storyDeck.modelId) return;
          const merged: ParamRecord = { ...pm };
          for (const [key, value] of Object.entries(patch)) {
            if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') merged[key] = value;
          }
          const resolved = resolvePluginParams(p.paramSchema, merged);
          storyParamsRef.current = resolved;
          latestRef.current.params = resolved;
          latestRef.current.scrubTime = null;
          storyDirtyRef.current = true;
        },
        controlSimulation: (action) => {
          const playing = action === 'play' || action === 'reset-play';
          latestRef.current.isPlaying = playing;
          latestRef.current.scrubTime = null;
          storyCallbacksRef.current.onStoryPlaying?.(playing);
          if (action === 'reset-play' || action === 'reset-pause') resetEngine();
        },
        applyCameraKeyframe: (camera) => {
          const now = performance.now();
          advanceStoryCamera2D(now);
          storyCameraTweenRef.current = null;
          storySpatialCommandRef.current = null;
          const currentPlugin = latestRef.current.plugin;
          const spec = isSimulationPluginV3(currentPlugin) ? currentPlugin.spatial3D : undefined;
          const duration = storyCameraDuration(camera.durationMs);
          let view = camera.view2D && validStoryView2D(camera.view2D) ? camera.view2D : undefined;
          const spatialView = camera.view3D && validStoryView3D(camera.view3D) ? camera.view3D : undefined;
          if (spec && spatialView) {
            if (spatialView.morphT < 1 || showThreeRef.current) {
              storySpatialCommandRef.current = { modelId: currentPlugin.meta.id, view: spatialView, durationMs: duration };
              storyCallbacksRef.current.onStoryView3d?.(spatialView.morphT < 1);
              return;
            }
            view = flatStoryView(spatialView, spec, viewportRef.current, baseScaleRef.current);
          }
          if (!view) return;
          if (spec && showThreeRef.current) {
            const box = stageBoxRef.current?.getBoundingClientRect();
            const vp = box ? { ...viewportRef.current, width: Math.max(320, box.width), height: Math.max(240, box.height) } : viewportRef.current;
            storySpatialCommandRef.current = { modelId: currentPlugin.meta.id,
              view: spatialStoryView(view, spec, vp, baseScaleRef.current), durationMs: duration };
            storyCallbacksRef.current.onStoryView3d?.(false);
            return;
          }
          storyCallbacksRef.current.onStoryView3d?.(false);
          storyCameraTweenRef.current = { from: cameraToStoryView(cameraRef.current, viewportRef.current, baseScaleRef.current),
            to: view, start: now, duration };
          advanceStoryCamera2D(now);
        },
        applyLayerOverrides: (overrides) => {
          if (overrides.showFbd !== undefined) {
            latestRef.current.autoFbdEnabled = overrides.showFbd;
            storyCallbacksRef.current.onStoryFbd?.(overrides.showFbd);
          }
          if (overrides.referenceFrameId !== undefined) {
            latestRef.current.activeFrameId = overrides.referenceFrameId;
            storyCallbacksRef.current.onStoryFrame?.(overrides.referenceFrameId);
          }
        },
        onBeatChanged: (index) => storyCallbacksRef.current.onStoryBeat?.(index),
        onAutoFreezeTriggered: (badge) => storyCallbacksRef.current.onStoryFreeze?.(badge)
      });
      storyRunnerRef.current = runner;
      if (storyNavigationRef) storyNavigationRef.current = {
        next: () => navigate((r, now) => r.next(now)),
        prev: () => navigate((r, now) => r.prev(now)),
        goTo: (index) => navigate((r, now) => r.goTo(index, now))
      };
      navigate((r, now) => r.next(now));
    }).catch(() => {
      if (!disposed) storyCallbacksRef.current.onStoryFreeze?.('分镜模块加载失败，请重新进入分镜模式');
    });
    return () => {
      disposed = true;
      if (latestRef.current.plugin.meta.id === storyDeck.modelId) flushStoryParams(storyDeck.modelId, performance.now(), true);
      storyRunnerRef.current = null;
      storyCameraTweenRef.current = null;
      storySpatialCommandRef.current = null;
      storyOwnerRef.current = undefined;
      storyParamsRef.current = null;
      storyDirtyRef.current = false;
      if (storyNavigationRef) storyNavigationRef.current = null;
    };
  }, [storyDeck, plugin.meta.id, storyNavigationRef]);

  useEffect(() => {
    if (isPlaying) {
      lastFrameMsRef.current = null;
      emitTelemetrySummary(true);
    }
  }, [isPlaying]);

  // 单步精准步进 (16.67 ms = 4 * FIXED_DT)
  useEffect(() => {
    if (stepOnceNonce === 0) return;
    let cur = simStateRef.current;
    if (cur === null) return;

    let stepT = simulationTimeRef.current;
    for (let i = 0; i < 4; i++) {
      const res = plugin.engine.step(cur, params, FIXED_DT);
      cur = res.nextState;
      stepT += FIXED_DT;
      if (res.events.length > 0) {
        eventsRef.current = [...eventsRef.current, ...res.events];
      }
    }
    simulationTimeRef.current = stepT;
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

  // 模型切换、预设切换和手动复位统一回到插件声明的初始取景
  useEffect(() => {
    storyCameraTweenRef.current = null;
    storySpatialCommandRef.current = null;
    applyDefaultCameraView(viewportRef.current.width, viewportRef.current.height);
    renderFrameToCanvas();
  }, [plugin.meta.id, resetViewNonce]);

  // 鼠标滚轮以指针为锚点缩放 (0.1x ~ 20x)
  useEffect(() => {
    const box = stageBoxRef.current;
    if (!box) return;
    const handleWheel = (e: WheelEvent) => {
      if (!canvasRef.current) return; // OrbitControls owns the wheel in 3D.
      storyCameraTweenRef.current = null;
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
      userTransformedViewRef.current = true;
      cameraRef.current = next;
      viewportRef.current = {
        ...viewportRef.current,
        scale: next.scale,
        offsetX: next.offsetX,
        offsetY: next.offsetY
      };
      setZoomPercent(Math.round((next.scale / Math.max(1e-6, baseScaleRef.current)) * 100));
      setOverlayViewport(viewportRef.current);
      renderFrameToCanvas();
    };
    box.addEventListener('wheel', handleWheel, { passive: false });
    return () => box.removeEventListener('wheel', handleWheel);
  }, []);

  // 响应通道切换更新示波器曲线
  useEffect(() => {
    syncUPlotData(true);
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
      if (!userTransformedViewRef.current) {
        applyDefaultCameraView(width, height);
      }
      setOverlayViewport(viewportRef.current);
      renderFrameToCanvas();
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(box);
    return () => ro.disconnect();
  }, [showThree]);

  // 主 60fps requestAnimationFrame 固定物理步长循环
  useEffect(() => {
    let rafId = 0;

    const loop = (nowMs: number) => {
      rafId = requestAnimationFrame(loop);
      if (advanceStoryCamera2D(nowMs)) renderFrameToCanvas();
      const runner = requestedStoryDeckRef.current === storyOwnerRef.current &&
        storyOwnerRef.current?.modelId === latestRef.current.plugin.meta.id ? storyRunnerRef.current : null;
      if (runner) {
        const current = latestRef.current;
        // The tween may reset the physical state; sample only after applying its new params.
        runner.tick(nowMs);
        if (runner.hasArmedFreeze && simStateRef.current !== null &&
            runner.checkAutoFreeze(current.plugin.engine.computeObservables(simStateRef.current, current.params))) {
          accumulatorRef.current = 0;
          renderFrameToCanvas();
          emitTelemetrySummary(true);
        }
        if (storyDirtyRef.current) {
          if (!latestRef.current.isPlaying) renderFrameToCanvas();
          emitTelemetrySummary(false);
          flushStoryParams(current.plugin.meta.id, nowMs);
        }
      }
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
      accumulatorRef.current = Math.min(
        accumulatorRef.current + rawDtSec * speed,
        FIXED_DT * 16
      );

      let stepped = false;
      let freezeHit = false;
      let cur = simStateRef.current;
      let simT = simulationTimeRef.current;

      while (accumulatorRef.current >= FIXED_DT && cur !== null) {
        const res = p.engine.step(cur, pm, FIXED_DT);
        cur = res.nextState;
        simT += FIXED_DT;
        accumulatorRef.current -= FIXED_DT;
        stepped = true;

        if (res.events.length > 0) {
          eventsRef.current = [...eventsRef.current, ...res.events];
        }

        // Detect at each actual 240 Hz physics sample, never only at the next browser frame.
        const armedObs = runner?.hasArmedFreeze ? p.engine.computeObservables(cur, pm) : undefined;
        freezeHit = armedObs !== undefined && runner !== null && runner.checkAutoFreeze(armedObs);
        if (freezeHit || simT - lastSnapshotTRef.current >= SNAPSHOT_INTERVAL) {
          const obs = armedObs ?? p.engine.computeObservables(cur, pm);
          snapshotsRef.current.push({ t: simT, state: cur, observables: obs });
          if (snapshotsRef.current.length > MAX_SNAPSHOTS) {
            snapshotsRef.current.shift();
          }
          lastSnapshotTRef.current = simT;
        }
        if (freezeHit) {
          accumulatorRef.current = 0;
          lastFrameMsRef.current = null;
          break;
        }
      }

      if (stepped && cur !== null) {
        simulationTimeRef.current = simT;
        simStateRef.current = cur;
        renderFrameToCanvas();
        syncUPlotData(freezeHit);
        emitTelemetrySummary(freezeHit);
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
    if (!wrap || oscilloscopeCollapsed || presentationMode) return;

    const width = Math.max(300, wrap.clientWidth);
    const height = 84;
    const textColor = theme === 'projector' ? '#0f172a' : '#cbd5e1';
    const gridColor = theme === 'projector' ? 'rgba(15, 23, 42, 0.12)' : 'rgba(148, 163, 184, 0.16)';

    const opts: uPlot.Options = {
      width,
      height,
      cursor: {
        drag: { x: false, y: false },
        points: { size: 7 }
      },
      legend: { show: false },
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
          width: 2.2,
          fill: (plot) => {
            const gradient = plot.ctx.createLinearGradient(0, plot.bbox.top, 0, plot.bbox.top + plot.bbox.height);
            gradient.addColorStop(0, 'rgba(56, 189, 248, 0.30)');
            gradient.addColorStop(1, 'rgba(56, 189, 248, 0.01)');
            return gradient;
          }
        },
        {
          label: specB ? `${specB.label} (${specB.unit})` : '通道 B',
          stroke: specB?.color ?? '#f472b6',
          width: 2.0,
          dash: channelA === channelB ? [4, 4] : undefined,
          fill: (plot) => {
            const gradient = plot.ctx.createLinearGradient(0, plot.bbox.top, 0, plot.bbox.top + plot.bbox.height);
            gradient.addColorStop(0, 'rgba(251, 146, 60, 0.22)');
            gradient.addColorStop(1, 'rgba(251, 146, 60, 0.01)');
            return gradient;
          }
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
        height: 84
      });
    });
    ro.observe(wrap);

    return () => {
      ro.disconnect();
      plot.destroy();
      uplotInstanceRef.current = null;
    };
  }, [plugin.meta.id, channelA, channelB, theme, oscilloscopeCollapsed, presentationMode]);

  return (
    <div className="relative flex flex-1 min-h-0">
      {/* 主 Canvas 画布容器 */}
      <div
        ref={stageBoxRef}
        data-testid="stage-canvas-box"
        className="absolute inset-0 min-h-0 rounded-xl overflow-hidden border"
        style={{
          borderColor: 'var(--pf-border)',
          backgroundColor: 'var(--pf-canvas-bg)'
        }}
      >
        {showThree ? (
          <Suspense
            fallback={
              <div className="w-full h-full flex items-center justify-center text-sky-300 text-sm">
                正在按需加载 Vanilla Three.js 3D 舞台...
              </div>
            }
          >
            <LazyThreeStage
              key={plugin.meta.id}
              plugin={plugin as SimulationPluginV2<ParamRecord, unknown>}
              simState={simStateRef.current}
              simStateRef={simStateRef}
              params={params}
              getFrameParams={() => latestRef.current.params}
              storyCameraCommandRef={storySpatialCommandRef}
              activeLayers={threeLayers}
              presentationMode={presentationMode}
              morphTarget={view3dEnabled ? 0 : 1}
              initialFlatViewport={initialFlatViewportRef.current}
              onMorphProgress={onMorphProgress}
              onMorphFlat={completeFlatMorph}
              onWebGLFallback={() => { setHeldThreeId(null); onWebGLFallback?.(); }}
            />
          </Suspense>
        ) : (
          <canvas
            ref={canvasRef}
            data-testid="simulation-canvas"
            className="block h-full w-full touch-none cursor-grab active:cursor-grabbing"
            onDoubleClick={onResetView}
            onPointerDown={(e) => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              storyCameraTweenRef.current = null;
              const rect = canvas.getBoundingClientRect();
              const sx = e.clientX - rect.left;
              const sy = e.clientY - rect.top;
              if (e.pointerType === 'touch') {
                activePointersRef.current.set(e.pointerId, { x: sx, y: sy });
                canvas.setPointerCapture?.(e.pointerId);
                if (activePointersRef.current.size === 2) {
                  const [first, second] = [...activePointersRef.current.values()];
                  if (!first || !second) return;
                  const startX = (first.x + second.x) * 0.5;
                  const startY = (first.y + second.y) * 0.5;
                  pinchGestureRef.current = {
                    initialDistance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
                    startX,
                    startY,
                    camera: { ...cameraRef.current }
                  };
                  dragModeRef.current = null;
                  hoveredHandleIdRef.current = null;
                  canvas.style.cursor = 'grabbing';
                  return;
                }
              }
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
                    hoveredHandleIdRef.current = h.id;
                    canvas.style.cursor = 'grabbing';
                    return;
                  }
                }
              }
              canvas.setPointerCapture?.(e.pointerId);
              dragModeRef.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
              canvas.style.cursor = 'grabbing';
            }}
            onPointerMove={(e) => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              const rect = canvas.getBoundingClientRect();
              const sx = e.clientX - rect.left;
              const sy = e.clientY - rect.top;
              if (e.pointerType === 'touch' && activePointersRef.current.has(e.pointerId)) {
                activePointersRef.current.set(e.pointerId, { x: sx, y: sy });
              }

              const pinch = pinchGestureRef.current;
              if (pinch && activePointersRef.current.size >= 2) {
                const [first, second] = [...activePointersRef.current.values()];
                if (!first || !second) return;
                const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
                const centerX = (first.x + second.x) * 0.5;
                const centerY = (first.y + second.y) * 0.5;
                const zoomed = zoomViewportAtCursor(
                  pinch.camera,
                  pinch.startX,
                  pinch.startY,
                  viewportRef.current.width,
                  viewportRef.current.height,
                  distance / pinch.initialDistance
                );
                const next = {
                  ...zoomed,
                  offsetX: zoomed.offsetX + centerX - pinch.startX,
                  offsetY: zoomed.offsetY + centerY - pinch.startY
                };
                userTransformedViewRef.current = true;
                cameraRef.current = next;
                viewportRef.current = { ...viewportRef.current, ...next };
                setZoomPercent(Math.round((next.scale / Math.max(1e-6, baseScaleRef.current)) * 100));
                setOverlayViewport(viewportRef.current);
                renderFrameToCanvas();
                return;
              }

              const mode = dragModeRef.current;
              if (!mode) {
                if (e.pointerType === 'touch') return;
                const v2 = plugin as SimulationPluginV2<ParamRecord, unknown>;
                const state = simStateRef.current;
                const { effectiveVp } = computeEffectiveViewport(viewportRef.current, state);
                let nearestId: string | null = null;
                if (state !== null && v2.getControlHandles) {
                  nearestId = v2.getControlHandles(state, params)
                    .find((handle) => {
                      const handleScreen = worldToScreen(handle.position.x, handle.position.y, effectiveVp);
                      return Math.hypot(handleScreen.x - sx, handleScreen.y - sy) <= 14;
                    })?.id ?? null;
                }
                if (nearestId !== hoveredHandleIdRef.current) {
                  hoveredHandleIdRef.current = nearestId;
                  renderFrameToCanvas();
                }
                canvas.style.cursor = nearestId ? 'pointer' : 'grab';
                return;
              }
              if (mode.kind === 'handle') {
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
                userTransformedViewRef.current = true;
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
            onPointerUp={(e) => {
              activePointersRef.current.delete(e.pointerId);
              if (activePointersRef.current.size < 2) pinchGestureRef.current = null;
              dragModeRef.current = null;
              if (e.pointerType === 'touch') hoveredHandleIdRef.current = null;
              const canvas = canvasRef.current;
              if (canvas) canvas.style.cursor = hoveredHandleIdRef.current ? 'pointer' : 'grab';
            }}
            onPointerCancel={(e) => {
              activePointersRef.current.clear();
              pinchGestureRef.current = null;
              dragModeRef.current = null;
              hoveredHandleIdRef.current = null;
              const canvas = canvasRef.current;
              if (canvas) canvas.style.cursor = 'grab';
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === 'touch' || dragModeRef.current) return;
              if (hoveredHandleIdRef.current) {
                hoveredHandleIdRef.current = null;
                renderFrameToCanvas();
              }
              const canvas = canvasRef.current;
              if (canvas) canvas.style.cursor = 'grab';
            }}
          />
        )}

        {/* V2 实测工具箱叠加层（虚拟直尺 / 0.1° 量角器 / 三点圆规） */}
        <RulerToolboxOverlay
          activeTool={measureTool}
          viewport={overlayViewport}
          frameOrigin={computeEffectiveViewport(overlayViewport, simStateRef.current).frameOrigin}
        />

        {!presentationMode && <AutoFbdBadge active={autoFbdEnabled && !poeMasked} count={fbdCount} />}

        {!presentationMode && (
          <>
            <div className="absolute bottom-3 left-3 z-10 flex flex-col items-start gap-1.5">
              {(plugin.meta.id === 'builder-circuit-mna' || plugin.meta.id === 'circuit-dc-capacitor-mna') && (
                <div data-testid="b2-potential-scale" className="pf-floating-glass flex items-center gap-2.5 rounded-xl border border-white/10 px-3 py-1.5 font-mono text-[10px] text-slate-300 shadow-xl">
                  <span>0V / {Number(params.emf ?? 12).toFixed(0)}V</span>
                  <span className="h-1.5 w-20 rounded-full bg-gradient-to-r from-sky-400 via-amber-300 to-rose-400" />
                </div>
              )}
              <div className="pf-floating-glass flex items-center gap-1 rounded-2xl border border-white/10 p-1.5 shadow-xl">
              {(plugin.meta.id === 'builder-circuit-mna' || plugin.meta.id === 'circuit-dc-capacitor-mna') && (
                <div data-testid="b2-component-toolbar" className="mr-1 flex items-center gap-0.5 border-r border-white/10 pr-1">
                  {[
                    { topology: 'closed-power', label: 'R', title: '闭合电路', testId: 'b2-topology-closed-power' },
                    { topology: 'rc-transient', label: 'C', title: 'RC 暂态', testId: 'b2-topology-rc-transient' },
                    { topology: 'divider-lamp', label: '灯', title: '分压测小灯泡', testId: 'b2-topology-divider-lamp' },
                    { topology: 'rc-bridge-charge', label: '桥', title: '含容电桥', testId: 'b2-topology-rc-bridge-charge' }
                  ].map((tool) => (
                    <button
                      key={tool.topology}
                      type="button"
                      data-testid={tool.testId}
                      aria-label={tool.title}
                      title={tool.title}
                      aria-pressed={params.topology === tool.topology}
                      onClick={() => onUpdateParamsBatch({ topology: tool.topology }, `切换电路：${tool.title}`)}
                      className={`grid h-9 min-w-9 place-items-center rounded-lg border px-2 text-[11px] font-semibold transition cursor-pointer ${params.topology === tool.topology ? 'border-sky-400/70 bg-sky-400/15 text-sky-200' : 'border-transparent text-slate-300 hover:bg-white/10'}`}
                    >
                      {tool.label}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                data-testid="btn-tool-ruler"
                aria-label="直尺"
                title="虚拟直尺"
                onClick={() => onToggleMeasureTool('ruler')}
                className={`pf-touch-target grid place-items-center rounded-xl border px-2 transition ${measureTool === 'ruler' ? 'border-sky-400 bg-sky-400/20 text-sky-200' : 'border-transparent text-slate-300 hover:bg-white/10'}`}
              >
                <Ruler className="h-4 w-4" />
              </button>
              <button
                type="button"
                data-testid="btn-tool-protractor"
                aria-label="量角器"
                title="0.1° 量角器"
                onClick={() => onToggleMeasureTool('protractor')}
                className={`pf-touch-target grid place-items-center rounded-xl border px-2 transition ${measureTool === 'protractor' ? 'border-amber-400 bg-amber-400/20 text-amber-200' : 'border-transparent text-slate-300 hover:bg-white/10'}`}
              >
                <MoveDiagonal2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                data-testid="btn-reset-view"
                aria-label="居中复位"
                title="居中复位视口"
                onClick={onResetView}
                className="pf-touch-target grid place-items-center rounded-xl border border-transparent px-2 text-slate-300 transition hover:bg-white/10 hover:text-sky-200"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <span data-testid="viewport-zoom-badge" className="pr-1 font-mono text-[11px] text-slate-400">
                {zoomPercent}%
              </span>
            </div>
            </div>

            <button
              type="button"
              data-testid="btn-toggle-oscilloscope"
              onClick={onToggleOscilloscope}
              className="pf-floating-glass absolute bottom-3 right-3 z-10 grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-slate-900/70 text-slate-200 shadow-xl backdrop-blur-xl transition hover:text-sky-200"
              aria-label={oscilloscopeCollapsed ? '展开示波器' : '收起示波器'}
              title={oscilloscopeCollapsed ? '展开示波器' : '收起示波器'}
            >
              {oscilloscopeCollapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </>
        )}

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

      {!presentationMode && !oscilloscopeCollapsed && (
        <div data-testid="floating-scope-dock" className="pf-floating-glass pf-compact-scope absolute bottom-3 left-1/2 z-10 w-[min(410px,calc(100%-24px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 px-3 pt-2 shadow-2xl">
          <div className="mb-1 flex h-7 items-center justify-between gap-2 text-xs">
            <span className="shrink-0 font-semibold text-sky-200">示波器</span>
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                data-testid="scope-channel-a"
                aria-label="切换示波器通道 A"
                title={`${specA?.label ?? '通道 A'} · 点击切换`}
                onClick={() => {
                  const index = channels.findIndex((channel) => channel.key === channelA);
                  setChannelA(channels[(index + 1) % Math.max(1, channels.length)]?.key ?? channelA);
                }}
                className="max-w-32 truncate rounded-full border border-sky-300/30 bg-sky-400/15 px-2.5 py-1 text-[10px] font-semibold text-sky-200 hover:bg-sky-400/25 cursor-pointer"
              >
                {channelA === 'v1' ? 'v-t' : channelA === 'current' ? 'I-t' : `${specA?.label ?? 'A'}-t`}
              </button>
              <button
                type="button"
                data-testid="scope-channel-b"
                aria-label="切换示波器通道 B"
                title={`${specB?.label ?? '通道 B'} · 点击切换`}
                onClick={() => {
                  const index = channels.findIndex((channel) => channel.key === channelB);
                  setChannelB(channels[(index + 1) % Math.max(1, channels.length)]?.key ?? channelB);
                }}
                className="max-w-32 truncate rounded-full border border-amber-300/30 bg-amber-400/15 px-2.5 py-1 text-[10px] font-semibold text-amber-200 hover:bg-amber-400/25 cursor-pointer"
              >
                {channelB === 'v1' ? 'v-t' : channelB === 'current' ? 'I-t' : `${specB?.label ?? 'B'}-t`}
              </button>
            </div>
            {scrubTime !== null && (
              <button type="button" onClick={() => onScrubTime(null)} className="truncate text-[11px] text-amber-300">
                回放 {scrubTime.toFixed(2)}s · 回到最新
              </button>
            )}
            <button
              type="button"
              onClick={onToggleOscilloscope}
              aria-label="收起示波器"
              title="收起示波器"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-300 hover:bg-white/10"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
          <div className="relative h-[76px] overflow-hidden">
            <div ref={uplotWrapRef} data-testid="uplot-container" className="w-full" />
            {poeMasked && (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-slate-950/85 text-xs font-semibold text-amber-300">
                示波器曲线已在 POE 预测阶段遮蔽
              </div>
            )}
          </div>
        </div>
      )}
      {!presentationMode && oscilloscopeCollapsed && (
        <button
          type="button"
          data-testid="btn-expand-oscilloscope"
          onClick={onToggleOscilloscope}
          className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-slate-900/75 px-4 py-2 text-xs font-medium text-slate-200 shadow-xl backdrop-blur-xl transition hover:text-sky-200"
        >
          <Crosshair className="h-3.5 w-3.5" /> 展开示波器
        </button>
      )}
    </div>
  );
};
