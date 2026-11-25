import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import uPlot from 'uplot';
import { Play, Pause, RotateCcw, StepForward, Eye, EyeOff, SunMoon, Sparkles, Maximize2, Minimize2 } from 'lucide-react';
import targetPlugin from '@physforge/target-plugin';
import type { KinematicsChaseState,KinematicsChaseParams } from '../../../simulations/mech-kinematics-chase/engine.js';
type ChaseSlicePlugin=typeof import('../../../simulations/mech-kinematics-chase/plugin.js').mechKinematicsChasePlugin;
import type { BlockConveyorState,BlockConveyorParams } from '../../../simulations/mech-block-conveyor/engine.js';
type ContactSlicePlugin=typeof import('../../../simulations/mech-block-conveyor/plugin.js').mechBlockConveyorPlugin;
import {
  resolvePluginParams,
  resolveInitialCameraTransform,
  worldToScreen,
  type FormulaDisplayItem,
  type InvariantReport,
  type ParamRecord,
  type PhysicsEvent,
  type SimulationPluginV2,
  type Viewport
} from '@physforge/sim-sdk';

interface SnapshotFrame {
  t: number;
  state: unknown;
  observables: Record<string, number>;
}

const FIXED_DT = 1 / 240;
const SNAPSHOT_INTERVAL = 1 / 60;
const MAX_SNAPSHOTS = 2400;
// Capability detection avoids embedding an unrelated model ID into every
// isolated singlefile bundle (the exporter explicitly rejects those IDs).
const circuitSlice=targetPlugin.paramSchema.some(f=>f.key==='topology'&&f.kind==='select'&&f.options.some(o=>o.value==='divider-lamp'));
const opticalSlice=targetPlugin.paramSchema.some(f=>f.key==='sceneMode'&&f.kind==='select'&&f.options.some(o=>o.value==='thin-lens-imaging'));
const mechanicsSlice=targetPlugin.paramSchema.some(f=>f.key==='scenario'&&f.kind==='select'&&f.options.some(o=>o.value==='atwood-constrained'));
const odeSlice=Boolean(targetPlugin.getTelemetryChannels);
const chaseSlice=targetPlugin.paramSchema.some(f=>f.key==='vA0')&&targetPlugin.paramSchema.some(f=>f.key==='xB0')&&targetPlugin.paramSchema.some(f=>f.key==='reactionTime');
const equilibriumSlice=targetPlugin.paramSchema.some(f=>f.key==='baseAngleDeg')&&targetPlugin.paramSchema.some(f=>f.key==='sweepAngleDeg')&&targetPlugin.paramSchema.some(f=>f.key==='autoSweep');
const constrainedSlice=targetPlugin.paramSchema.some(f=>f.key==='secondarySpeedRatio')&&targetPlugin.paramSchema.some(f=>f.key==='driveSpeed')&&targetPlugin.paramSchema.some(f=>f.key==='heightOrLength');
const projectileSlice=targetPlugin.paramSchema.some(f=>f.key==='troughRadius')&&targetPlugin.paramSchema.some(f=>f.key==='inclineDeg')&&targetPlugin.paramSchema.some(f=>f.key==='launchAngleDeg')&&targetPlugin.paramSchema.some(f=>f.key==='dragCoeff');
const contactSlice=targetPlugin.paramSchema.some(f=>f.key==='carrierLengthM')&&targetPlugin.paramSchema.some(f=>f.key==='muBlockCarrier');
const measuredScope=circuitSlice||mechanicsSlice||odeSlice||chaseSlice||equilibriumSlice||constrainedSlice||projectileSlice||contactSlice;
const MECHANICS_FIELDS:Record<string,string[]>={
  'elastic-collision':['scenario','gravity','massRatio','restitution','friction'],
  'incline-slide':['scenario','gravity','massRatio','restitution','friction','inclineDeg'],
  'newtons-cradle':['scenario','gravity','restitution','friction'],
  'spring-oscillator':['scenario','gravity','springK'],
  'atwood-constrained':['scenario','gravity','massRatio']
};
const MECHANICS_CHANNELS:Record<string,string[]>={
  'elastic-collision':['totalMomentumX','kineticEnergy','primaryVx'],
  'incline-slide':['kineticEnergy','primaryVx','totalMomentumX'],
  'newtons-cradle':['totalMomentumX','kineticEnergy','primaryVx'],
  'spring-oscillator':['kineticEnergy','springPotentialEnergy','primaryVx'],
  'atwood-constrained':['primaryVy','secondaryVy','constraintTensionN']
};
const OPTICAL_FIELDS:Record<string,string[]>={
  'tir-interface':['sceneMode','incidentAngleDeg','n1','n2','animateSweep'],
  'parallel-slab':['sceneMode','incidentAngleDeg','n1','slabThickness','animateSweep'],
  'prism-dispersion':['sceneMode','incidentAngleDeg','n1','prismApexDeg','animateSweep'],
  'optical-fiber':['sceneMode','incidentAngleDeg','n1','n2','fiberHalfWidth','animateSweep'],
  'double-slit':['sceneMode','wavelengthNm','slitSeparationMm','screenDistanceM'],
  'thin-lens-imaging':['sceneMode','focalLengthM','objectDistanceM']
};
const CIRCUIT_FIELDS:Record<string,string[]>={
  'divider-lamp':['emf','sliderR','internalR','topology'],
  'closed-power':['emf','sliderR','internalR','topology'],
  'series-parallel-dynamic':['emf','sliderR','internalR','r1','r2','topology'],
  'rc-transient':['emf','r1','capacitance','internalR','switchClosed','topology'],
  'rc-bridge-charge':['emf','sliderR','internalR','r1','r2','capacitance','topology'],
  'nonlinear-lamp-diode':['emf','sliderR','internalR','switchClosed','topology']
};
const CIRCUIT_CHANNELS:Record<string,string[]>={
  'divider-lamp':['totalCurrent','lampCurrent','lampVoltage','outputPower'],
  'closed-power':['totalCurrent','outputPower','terminalVoltage'],
  'series-parallel-dynamic':['branchCurrent1','branchCurrent2','totalCurrent','terminalVoltage','outputPower'],
  'rc-transient':['capVoltage','capCurrent'],
  'rc-bridge-charge':['capVoltage','capCurrent','totalCurrent','branchCurrent1','branchCurrent2'],
  'nonlinear-lamp-diode':['totalCurrent','terminalVoltage','outputPower']
};
function channelsFor(params:ParamRecord){
  if(targetPlugin.getTelemetryChannels)return targetPlugin.getTelemetryChannels(params);
  const keys=circuitSlice?CIRCUIT_CHANNELS[String(params.topology)]:mechanicsSlice?MECHANICS_CHANNELS[String(params.scenario)]:undefined;
  return keys?keys.flatMap(key=>targetPlugin.telemetryChannels.filter(c=>c.key===key)):targetPlugin.telemetryChannels;
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
    if (Math.abs(prev.t - targetT) < Math.abs(cand.t - targetT)) return prev;
  }
  return cand;
}

export const SingleFileApp: React.FC = () => {
  const initialPreset = useMemo(() => {
    if (__INITIAL_PRESET_ID__) {
      const found = targetPlugin.presets.find((p) => p.id === __INITIAL_PRESET_ID__);
      if (found) return found;
    }
    if (__INITIAL_PRESET_DATA__?.presetId) {
      const found = targetPlugin.presets.find((p) => p.id === __INITIAL_PRESET_DATA__?.presetId);
      if (found) return found;
    }
    return targetPlugin.presets[0] ?? null;
  }, []);

  const [activePresetId, setActivePresetId] = useState<string | null>(
    __INITIAL_PRESET_DATA__?.presetId ?? initialPreset?.id ?? null
  );
  const [params, setParams] = useState<ParamRecord>(() =>
    resolvePluginParams(
      targetPlugin.paramSchema,
      __INITIAL_PRESET_DATA__?.params ?? initialPreset?.params
    )
  );
  const [activeLayers, setActiveLayers] = useState<string[]>(() =>
    __INITIAL_PRESET_DATA__?.visibleLayers?.length
      ? [...__INITIAL_PRESET_DATA__.visibleLayers]
      : initialPreset?.visibleLayers?.length
        ? [...initialPreset.visibleLayers]
        : targetPlugin.layers.filter((l) => l.defaultVisible).map((l) => l.id)
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [strobeEnabled, setStrobeEnabled] = useState(false);
  const [poeMasked, setPoeMasked] = useState(false);
  const [theme, setTheme] = useState<'chalkboard' | 'projector'>('chalkboard');
  const [bigScreen, setBigScreen] = useState(false);
  const [resetNonce, setResetNonce] = useState(0);
  const [stepOnceNonce, setStepOnceNonce] = useState(0);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [summary, setSummary] = useState<{
    t: number;
    observables: Record<string, number>;
    events: PhysicsEvent[];
    invariants: InvariantReport[];
    formulas: FormulaDisplayItem[];
  }>({ t: 0, observables: {}, events: [], invariants: [], formulas: [] });

  const channels = useMemo(()=>channelsFor(params),[params.topology,params.scenario,params.template]);
  const [channelA, setChannelA] = useState(channels[0]?.key ?? '');
  const [channelB, setChannelB] = useState(channels[1]?.key ?? channels[0]?.key ?? '');
  useEffect(()=>{if(measuredScope){setChannelA(channels[0]?.key??'');setChannelB(channels[1]?.key??channels[0]?.key??'');}},[channels]);

  const stageBoxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const uplotWrapRef = useRef<HTMLDivElement | null>(null);
  const circuitScopeEmptyRef = useRef<HTMLDivElement | null>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const syncingPlotRef = useRef(false);

  const simStateRef = useRef<unknown>(null);
  // Physics time belongs to the integrator, not the downsampled plot history.
  const simulationTimeRef = useRef(0);
  const initialStateRef = useRef<unknown>(null);
  const eventsRef = useRef<PhysicsEvent[]>([]);
  const snapshotsRef = useRef<SnapshotFrame[]>([]);
  const lastSnapTRef = useRef(0);
  const accRef = useRef(0);
  const lastFrameMsRef = useRef<number | null>(null);
  const lastUiMsRef = useRef(0);
  const viewportRef = useRef<Viewport>({
    width: 800,
    height: 460,
    dpr: 1,
    scale: 1,
    offsetX: 0,
    offsetY: 0
  });

  const latestRef = useRef({
    params,
    activeLayers,
    isPlaying,
    playbackSpeed,
    strobeEnabled,
    poeMasked,
    theme,
    scrubTime,
    channelA,
    channelB
  });
  latestRef.current = {
    params,
    activeLayers,
    isPlaying,
    playbackSpeed,
    strobeEnabled,
    poeMasked,
    theme,
    scrubTime,
    channelA,
    channelB
  };

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { params: pm, activeLayers: layers, strobeEnabled: strobe, poeMasked: masked, theme: th, scrubTime: scrub } =
      latestRef.current;
    const frame =
      scrub !== null
        ? findClosestSnapshot(snapshotsRef.current, scrub)
        : snapshotsRef.current[snapshotsRef.current.length - 1] ?? null;
    const drawState = frame ? frame.state : simStateRef.current;
    if(chaseSlice&&drawState!==null){
      const model=targetPlugin as unknown as ChaseSlicePlugin,v=viewportRef.current;
      const s=drawState as KinematicsChaseState,p=pm as KinematicsChaseParams,safe=model.chaseSafeRect(v.width,v.height);
      if(!model.chaseBoundsInViewport(s,p,v,safe)){
        const next=model.chaseFitViewport(s,p,v,safe);if(next)viewportRef.current=next;
      }
    }
    if(contactSlice&&drawState!==null){
      const model=targetPlugin as unknown as ContactSlicePlugin,v=viewportRef.current,s=drawState as BlockConveyorState,p=pm as BlockConveyorParams;
      const safe={left:26,right:v.width-26,top:28,bottom:v.height-28};
      if(!model.contactBoundsFit(s,p,v,safe)){const next=model.fitContactViewport(s,p,v,safe);if(next)viewportRef.current=next;}
    }
    const vp = viewportRef.current;
    ctx.save();
    ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
    ctx.fillStyle = th === 'projector' ? '#ffffff' : '#091220';
    ctx.fillRect(0, 0, vp.width, vp.height);

    if (drawState !== null) {
      const layerSet = new Set(layers);
      if (masked) {
        layerSet.delete('trajectory');
        layerSet.delete('larmorCircle');
        layerSet.delete('slopeGhost');
        layerSet.delete('vibrationGraph');
        layerSet.delete('eventPins');
      }
      targetPlugin.renderCanvas(ctx, drawState, pm, measuredScope||opticalSlice?{...vp,theme:th}:vp, layerSet);
      if(opticalSlice&&frame)canvas.dataset.b3Rendered=JSON.stringify({t:frame.t,mode:pm.sceneMode,...frame.observables});
      if(circuitSlice&&frame)canvas.dataset.b2Rendered=JSON.stringify({t:frame.t,topology:pm.topology,...frame.observables});
      if(chaseSlice&&frame){canvas.dataset.chaseRendered=JSON.stringify({t:frame.t,...frame.observables});canvas.dataset.chaseViewport=JSON.stringify({width:vp.width,height:vp.height,scale:vp.scale,offsetX:vp.offsetX,offsetY:vp.offsetY});}
      if(contactSlice&&frame){canvas.dataset.contactRendered=JSON.stringify({t:frame.t,mode:pm.systemMode,...frame.observables});canvas.dataset.contactViewport=JSON.stringify({width:vp.width,height:vp.height,scale:vp.scale,offsetX:vp.offsetX,offsetY:vp.offsetY});}
      if(equilibriumSlice&&frame){canvas.dataset.equilibriumRendered=JSON.stringify({t:frame.t,...frame.observables});canvas.dataset.equilibriumView=layerSet.has('angle-curve')?'angle-curve':layerSet.has('aux-circle')?'aux-circle':layerSet.has('triangle')?'triangle':'none';}
      if(projectileSlice&&frame)canvas.dataset.projectileRendered=JSON.stringify({t:frame.t,mode:pm.mode,...frame.observables});
      if(constrainedSlice&&frame)canvas.dataset.constrainedRendered=JSON.stringify({t:frame.t,mode:pm.mode,...frame.observables});
      if(odeSlice&&frame)canvas.dataset.odeRendered=JSON.stringify({t:frame.t,template:pm.template,...frame.observables});
      if(mechanicsSlice&&frame)canvas.dataset.b4Rendered=JSON.stringify({t:frame.t,scenario:pm.scenario,...frame.observables});

      if (strobe && !masked && snapshotsRef.current.length > 2) {
        const curT = frame ? frame.t : 0;
        let lastT = -1;
        for (const s of snapshotsRef.current) {
          if (s.t > curT) break;
          if (s.t - lastT < 0.08) continue;
          lastT = s.t;
          if (typeof s.observables.x === 'number' && typeof s.observables.y === 'number') {
            ctx.fillStyle = 'rgba(251, 191, 36, 0.72)';
            ctx.beginPath();
            const point = worldToScreen(s.observables.x, s.observables.y, vp);
            ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    ctx.restore();
  };

  const syncPlot = () => {
    const plot = uplotRef.current;
    if (!plot) return;
    const snaps = snapshotsRef.current;
    const { channelA: chA, channelB: chB } = latestRef.current;
    syncingPlotRef.current = true;
    try {
      plot.setData([
        snaps.map((s) => s.t),
        snaps.map((s) => (chA ? s.observables[chA] ?? (measuredScope?null:0) : (measuredScope?null:0))),
        snaps.map((s) => (chB ? s.observables[chB] ?? (measuredScope?null:0) : (measuredScope?null:0)))
      ]);
    } finally { syncingPlotRef.current = false; }
    if (measuredScope && uplotWrapRef.current) {
      uplotWrapRef.current.dataset.lastSampleT = String(snaps.at(-1)?.t ?? '');
      if(contactSlice)uplotWrapRef.current.dataset.sampleCount=String(snaps.length);
      const empty = snaps.length < 2;
      uplotWrapRef.current.style.visibility = empty ? 'hidden' : '';
      if (circuitScopeEmptyRef.current) circuitScopeEmptyRef.current.style.display = empty ? 'grid' : 'none';
    }
  };

  const emitSummary = (force = false) => {
    const now = performance.now();
    if (!force && now - lastUiMsRef.current < 90) return;
    lastUiMsRef.current = now;
    const snaps = snapshotsRef.current;
    const snap =
      latestRef.current.scrubTime !== null
        ? findClosestSnapshot(snaps, latestRef.current.scrubTime)
        : snaps[snaps.length - 1] ?? null;
    if (!snap || initialStateRef.current === null) return;
    setSummary({
      t: snap.t,
      observables: snap.observables,
      events: eventsRef.current,
      invariants: targetPlugin.engine.checkInvariants
        ? targetPlugin.engine.checkInvariants(snap.state, initialStateRef.current, latestRef.current.params)
        : [],
      formulas: targetPlugin.formatFormulas
        ? targetPlugin.formatFormulas(snap.state, latestRef.current.params)
        : []
    });
  };

  // Commit a discrete display transition before the browser paints; continuous
  // integration still uses rAF and the existing throttled React summaries.
  useLayoutEffect(() => {
    const camera = resolveInitialCameraTransform(
      targetPlugin as SimulationPluginV2<ParamRecord, unknown>,
      latestRef.current.params,
      viewportRef.current.width,
      viewportRef.current.height
    );
    viewportRef.current = { ...viewportRef.current, ...camera };
    if(simStateRef.current!==null)targetPlugin.engine.disposeState?.(simStateRef.current);
    const init = targetPlugin.engine.createInitialState(params);
    const obs0 = targetPlugin.engine.computeObservables(init, params);
    simStateRef.current = init;
    simulationTimeRef.current = 0;
    initialStateRef.current = init;
    eventsRef.current = [];
    snapshotsRef.current = [{ t: 0, state: init, observables: obs0 }];
    lastSnapTRef.current = 0;
    accRef.current = 0;
    lastFrameMsRef.current = null;
    drawCanvas();
    syncPlot();
    emitSummary(true);
  }, [resetNonce]);
  useEffect(()=>()=>{if(simStateRef.current!==null)targetPlugin.engine.disposeState?.(simStateRef.current);},[]);

  // Preserve the exact final integration sample on pause. A frame may have
  // advanced fewer than SNAPSHOT_INTERVAL seconds since the last plot sample.
  useLayoutEffect(() => {
    if (isPlaying) return;
    const state = simStateRef.current;
    const t = simulationTimeRef.current;
    if (state !== null && t > lastSnapTRef.current) {
      snapshotsRef.current.push({ t, state, observables: targetPlugin.engine.computeObservables(state, latestRef.current.params) });
      if (snapshotsRef.current.length > MAX_SNAPSHOTS) snapshotsRef.current.shift();
      lastSnapTRef.current = t;
    }
    drawCanvas();
    syncPlot();
    emitSummary(true);
  }, [isPlaying]);

  useLayoutEffect(() => {
    if (stepOnceNonce === 0) return;
    let cur = simStateRef.current;
    if (cur === null) return;
    let simT = simulationTimeRef.current;
    for (let i = 0; i < 4; i++) {
      const res = targetPlugin.engine.step(cur, params, FIXED_DT);
      cur = res.nextState;
      simT += res.advancedTime??FIXED_DT;
      if (res.events.length > 0) eventsRef.current = [...eventsRef.current, ...res.events];
      if(res.halt||res.advancedTime===0)break;
    }
    simStateRef.current = cur;
    simulationTimeRef.current = simT;
    const sample={t:simT,state:cur,observables:targetPlugin.engine.computeObservables(cur,params)};
    if(simT===lastSnapTRef.current)snapshotsRef.current[snapshotsRef.current.length-1]=sample;
    else snapshotsRef.current.push(sample);
    if (snapshotsRef.current.length > MAX_SNAPSHOTS) snapshotsRef.current.shift();
    lastSnapTRef.current = simT;
    drawCanvas();
    syncPlot();
    emitSummary(true);
  }, [stepOnceNonce]);

  useLayoutEffect(() => {
    drawCanvas();
    emitSummary(true);
  }, [activeLayers, strobeEnabled, poeMasked, theme, scrubTime]);

  useEffect(() => {
    syncPlot();
  }, [channelA, channelB]);

  useEffect(() => {
    const box = stageBoxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const updateSize = () => {
      const rect = box.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(300, Math.floor(rect.width));
      const height = Math.max(220, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      viewportRef.current = { ...viewportRef.current, width, height, dpr };
      const camera = resolveInitialCameraTransform(
        targetPlugin as SimulationPluginV2<ParamRecord, unknown>,
        latestRef.current.params,
        width,
        height
      );
      viewportRef.current = { ...viewportRef.current, ...camera };
      drawCanvas();
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let rafId = 0;
    const tick = (nowMs: number) => {
      rafId = requestAnimationFrame(tick);
      if (!latestRef.current.isPlaying) {
        lastFrameMsRef.current = null;
        return;
      }
      if (lastFrameMsRef.current === null) {
        lastFrameMsRef.current = nowMs;
        return;
      }
      const rawDt = Math.min((nowMs - lastFrameMsRef.current) / 1000, 0.05);
      lastFrameMsRef.current = nowMs;
      accRef.current += rawDt * latestRef.current.playbackSpeed;

      let stepped = false;
      let cur = simStateRef.current;
      let simT = simulationTimeRef.current;

      while (accRef.current >= FIXED_DT && cur !== null) {
        const res = targetPlugin.engine.step(cur, latestRef.current.params, FIXED_DT);
        cur = res.nextState;
        const advanced=res.advancedTime??FIXED_DT;
        simT += advanced;
        accRef.current -= FIXED_DT;
        stepped = true;
        if (res.events.length > 0) eventsRef.current = [...eventsRef.current, ...res.events];
        if (res.halt||simT - lastSnapTRef.current >= SNAPSHOT_INTERVAL) {
          const sample={t:simT,state:cur,observables:targetPlugin.engine.computeObservables(cur,latestRef.current.params)};
          if(simT===lastSnapTRef.current)snapshotsRef.current[snapshotsRef.current.length-1]=sample;
          else snapshotsRef.current.push(sample);
          if (snapshotsRef.current.length > MAX_SNAPSHOTS) snapshotsRef.current.shift();
          lastSnapTRef.current = simT;
        }
        if(res.halt){latestRef.current.isPlaying=false;setIsPlaying(false);}
        if(res.halt||advanced===0){accRef.current=0;lastFrameMsRef.current=null;break;}
      }

      if (stepped && cur !== null) {
        simStateRef.current = cur;
        simulationTimeRef.current = simT;
        drawCanvas();
        syncPlot();
        emitSummary(false);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    const wrap = uplotWrapRef.current;
    if (!wrap) return;
    const specA = channels.find((c) => c.key === channelA) ?? channels[0];
    const specB = channels.find((c) => c.key === channelB) ?? channels[1] ?? channels[0];
    const split=measuredScope&&specA?.unit!==specB?.unit;
    const contactPair=contactSlice&&((channelA==='vBlock'&&channelB==='vCarrier')||(channelA==='vCarrier'&&channelB==='vBlock'));
    const colors:Record<string,string>={'#38bdf8':'#0369a1','#fbbf24':'#92400e','#f472b6':'#9d174d','#4ade80':'#166534'};
    const paint=(c:string)=>measuredScope&&theme==='projector'?colors[c]??'#334155':c;
    wrap.dataset.scopeUnits=split?'separate':'shared';
    const textColor = theme === 'projector' ? '#0f172a' : '#cbd5e1';
    const gridColor = theme === 'projector' ? 'rgba(15,23,42,0.12)' : 'rgba(148,163,184,0.16)';

    const plot = new uPlot(
      {
        width: Math.max(280, wrap.clientWidth),
        height: 150,
        ...(measuredScope ? { scales: {
          x: { time: false, range: (_u: uPlot, min: number, max: number): [number, number] => {
            const lo = Number.isFinite(min) ? min : 0;
            return [lo, Math.max(lo + .1, Number.isFinite(max) ? max : lo)];
          }},
          y: { auto: true }, ...(split ? { y2: { auto: true } } : {})
        }} : {}),
        axes: [
          { stroke: textColor, grid: { stroke: gridColor }, ...(measuredScope ? {
            values: (_u: uPlot, splits: number[]) => splits.map(v => Number(v.toPrecision(4)) + 's')
          } : {}) },
          { stroke: measuredScope ? paint(specA?.color ?? '#38bdf8') : textColor, grid: { stroke: gridColor } },
          ...(split?[{scale:'y2',side:1 as const,stroke:paint(specB?.color??'#f472b6'),grid:{show:false}}]:[])
        ],
        series: [
          { label: equilibriumSlice?'演示时间 (s)':'t (s)' },
          { label: specA?.label ?? 'A', stroke: paint(specA?.color ?? '#38bdf8'), width: 2 },
          { label: specB?.label ?? 'B', stroke: paint(specB?.color ?? '#f472b6'), width: 2,...(split?{scale:'y2'}:{}) }
        ],
        hooks: {
          // uPlot commits scale changes during its draw; reading immediately
          // after setData may return the previous frame's range.
          draw: [(u) => { if (measuredScope) wrap.dataset.scopeMax = String(u.scales.x?.max ?? ''); if(contactPair){const model=targetPlugin as unknown as ContactSlicePlugin;wrap.dataset.sampledRelativeSlip=String(model.drawRelativeVelocityBand(u.ctx,u.data[0],u.data[1]!,u.data[2]!,t=>u.valToPos(t,'x',true),v=>u.valToPos(v,'y',true),u.bbox,theme==='projector'));}else delete wrap.dataset.sampledRelativeSlip; }],
          setCursor: [
            (u) => {
              const idx = u.cursor.idx;
              if (idx == null || latestRef.current.isPlaying || syncingPlotRef.current) return;
              const tv = u.data[0]?.[idx];
              if (typeof tv === 'number' && Number.isFinite(tv)) setScrubTime(tv);
            }
          ]
        }
      },
      [[0], [0], [0]],
      wrap
    );
    uplotRef.current = plot;
    syncPlot();
    const ro = new ResizeObserver(() => {
      if (uplotWrapRef.current) plot.setSize({ width: Math.max(280, uplotWrapRef.current.clientWidth), height: 150 });
    });
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      plot.destroy();
      uplotRef.current = null;
    };
  }, [channelA, channelB, theme,channels]);

  return (
    <div
      data-testid="singlefile-shell"
      data-model-id={targetPlugin.meta.id}
      className={`h-screen w-screen flex flex-col overflow-hidden ${bigScreen ? 'big-screen-mode' : ''}`}
      style={{ backgroundColor: 'var(--pf-bg)', color: 'var(--pf-text)' }}
    >
      <header
        className="shrink-0 border-b px-3 py-2 flex flex-wrap items-center justify-between gap-2"
        style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface)' }}
      >
        <div>
          <div className="font-bold text-base">{targetPlugin.meta.title}</div>
          <div className="text-xs" data-testid="sf-summary-clock" data-sample-time={summary.t} style={{ color: 'var(--pf-text-muted)' }}>
            离线课堂单文件切片 · {targetPlugin.meta.textbookRef} · t = {summary.t.toFixed(3)} s
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="sf-play-pause"
            onClick={() => {
              // Freeze the integrator immediately on a user pause, then commit
              // the final sample, canvas, plot and summary before the next paint.
              if(latestRef.current.isPlaying)latestRef.current.isPlaying=false;
              setIsPlaying((p) => !p);
              setScrubTime(null);
            }}
            className="pf-touch-target inline-flex items-center gap-1 px-3.5 py-1.5 rounded-xl bg-sky-500 text-slate-950 font-bold cursor-pointer"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            <span>{isPlaying ? '暂停' : '运行'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setIsPlaying(false);
              setStepOnceNonce((n) => n + 1);
            }}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <StepForward className="w-4 h-4" />
            <span>单步</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setIsPlaying(false);
              setScrubTime(null);
              setResetNonce((n) => n + 1);
            }}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <RotateCcw className="w-4 h-4" />
            <span>复位</span>
          </button>
          <select
            aria-label="播放倍速"
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
            className="pf-touch-target rounded-xl border px-2 py-1 text-sm"
            style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
          >
            {[0.1, 0.25, 0.5, 1, 2].map((sp) => (
              <option key={sp} value={sp}>
                {sp}x
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setStrobeEnabled((v) => !v)}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{ borderColor: strobeEnabled ? 'var(--pf-accent)' : 'var(--pf-border)' }}
          >
            <Sparkles className="w-4 h-4" />
            <span>频闪</span>
          </button>
          <button
            type="button"
            onClick={() => setPoeMasked((v) => !v)}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{ borderColor: poeMasked ? '#fbbf24' : 'var(--pf-border)' }}
          >
            {poeMasked ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            <span>POE 遮罩</span>
          </button>
          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'chalkboard' ? 'projector' : 'chalkboard'))}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{ borderColor: 'var(--pf-border)' }}
          >
            <SunMoon className="w-4 h-4" />
            <span>{theme === 'chalkboard' ? '黑板深蓝' : '投影白底'}</span>
          </button>
          <button
            type="button"
            onClick={() => setBigScreen((b) => !b)}
            className="pf-touch-target inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm cursor-pointer"
            style={{ borderColor: bigScreen ? 'var(--pf-accent)' : 'var(--pf-border)' }}
          >
            {bigScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            <span>大屏模式</span>
          </button>
        </div>
      </header>

      <main className="flex-1 flex min-h-0 overflow-hidden">
        <section className="flex-1 flex flex-col min-w-0 p-2.5 gap-2">
          <div
            ref={stageBoxRef}
            className="relative flex-1 min-h-[220px] rounded-xl overflow-hidden border"
            style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-canvas-bg)' }}
          >
            <canvas ref={canvasRef} data-testid="sf-canvas" className="block w-full h-full" />
            {poeMasked && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 p-6 text-center">
                <button
                  type="button"
                  onClick={() => setPoeMasked(false)}
                  className="pf-touch-target px-5 py-2.5 rounded-xl bg-amber-400 text-slate-950 font-bold cursor-pointer"
                >
                  POE 预测阶段 · 点击揭晓观察
                </button>
              </div>
            )}
          </div>
          <div
            className="rounded-xl border p-2 shrink-0"
            hidden={opticalSlice}
            style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface)' }}
          >
            <div className="flex items-center gap-2 text-xs mb-1">
              <select
                data-testid="sf-scope-channel-a"
                value={channelA}
                onChange={(e) => setChannelA(e.target.value)}
                className="rounded border px-2 py-1"
                style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
              >
                {channels.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}{measuredScope&&c.unit?' ('+c.unit+')':''}
                  </option>
                ))}
              </select>
              <select
                data-testid="sf-scope-channel-b"
                value={channelB}
                onChange={(e) => setChannelB(e.target.value)}
                className="rounded border px-2 py-1"
                style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
              >
                {channels.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}{measuredScope&&c.unit?' ('+c.unit+')':''}
                  </option>
                ))}
              </select>
            </div>
            <div className="relative">
              <div ref={uplotWrapRef} data-testid="sf-uplot" />
              {measuredScope && <div ref={circuitScopeEmptyRef} data-testid="sf-scope-empty" className="absolute inset-0 place-items-center text-xs" style={{display:'grid',color:'var(--pf-text-muted)'}}>运行或单步后显示真实采样曲线</div>}
            </div>
          </div>
        </section>

        <aside
          className="w-80 shrink-0 border-l p-3 overflow-y-auto space-y-3"
          style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface)' }}
        >
          {(equilibriumSlice||projectileSlice||contactSlice)&&<section className="space-y-1 text-xs" data-testid={contactSlice?'sf-contact-layers':equilibriumSlice?'sf-equilibrium-layers':'sf-projectile-layers'}><div className="font-semibold">图解视图（不复位）</div>{targetPlugin.layers.map(layer=><label key={layer.id} className="flex gap-2 items-center"><input type="checkbox" data-testid={'sf-layer-'+layer.id} checked={activeLayers.includes(layer.id)} onChange={()=>setActiveLayers(ls=>ls.includes(layer.id)?ls.filter(id=>id!==layer.id):[...ls,layer.id])}/>{layer.label}</label>)}</section>}
          <div className="text-xs font-bold" style={{color:"var(--pf-accent)"}}>课堂预设速切</div>
          <div className={equilibriumSlice?"grid grid-cols-2 gap-1.5":"space-y-1.5"}>
            {targetPlugin.presets.map((preset) => (
              <button
                key={preset.id}
                data-preset-id={preset.id}
                type="button"
                onClick={() => {
                  setActivePresetId(preset.id);
                  setParams(resolvePluginParams(targetPlugin.paramSchema, preset.params));
                  if (preset.visibleLayers?.length) setActiveLayers([...preset.visibleLayers]);
                  else if(equilibriumSlice)setActiveLayers(targetPlugin.layers.filter(l=>l.defaultVisible).map(l=>l.id));
                  setIsPlaying(false);
                  setScrubTime(null);
                  setResetNonce((n) => n + 1);
                }}
                className="pf-touch-target w-full text-left rounded-xl border p-2 text-xs cursor-pointer"
                style={{
                  borderColor: preset.id === activePresetId ? 'var(--pf-accent)' : 'var(--pf-border)',
                  backgroundColor: 'var(--pf-surface-elevated)'
                }}
              >
                <div className={equilibriumSlice?"font-semibold truncate":"font-semibold"} title={preset.name}>{equilibriumSlice?preset.name.split("：")[0]:preset.name}</div>
              </button>
            ))}
          </div>

          {equilibriumSlice&&<section data-testid="sf-equilibrium-readouts" className="space-y-1 text-xs rounded-xl border p-2" style={{borderColor:'var(--pf-border)'}}>{summary.observables.solutionDefined===0&&<div data-testid="sf-equilibrium-no-solution" className="font-semibold text-rose-500">当前构型无可靠有限平衡解</div>}{([['requestedInitialAngleDeg','初始请求角','°'],['initialAngleDeg','限幅后初始角','°'],['angleDeg','当前实际角','°'],['force1','F₁ 大小','N'],['force2','F₂ 大小','N'],['minPullForceN','理论拉力下界','N'],['ropeLengthM','实际绳长','m'],['rodAxialForceN','轴力 C（压正）','N'],['reactionXN','支承力 Rₓ','N'],['reactionYN','支承力 Rᵧ','N'],['supportMomentNm','固支力矩 M','N·m']] as const).filter(([key])=>key==='ropeLengthM'?params.mode==='hemisphere-suspension':key==='rodAxialForceN'?params.mode==='hinged-rod':['reactionXN','reactionYN','supportMomentNm'].includes(key)?params.mode==='fixed-rod':key==='minPullForceN'?params.mode!=='fixed-rod':true).map(([key,label,unit])=>{const v=summary.observables[key];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-equilibrium-'+key}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+unit:'—'}</span></div>;})}<div>准静态演示；无解处曲线留空。</div></section>}
          {chaseSlice&&<section data-testid="sf-chase-readouts" className="space-y-1 text-xs rounded-xl border p-2" style={{borderColor:'var(--pf-border)'}}>{([['deltaX','有向位置差','m'],['gap','实际间距','m'],['minGap','历史最小间距','m'],['firstCoVelocityTime','首次共速','s'],['firstMeetTime','首次相遇','s']] as const).map(([key,label,unit])=>{const v=summary.observables[key];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-chase-'+key}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+unit:'—'}</span></div>;})}<div>质点模型 · 不模拟碰撞。</div></section>}
          {contactSlice&&<section data-testid="sf-contact-readouts" data-sample-time={summary.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}>{([['xBlock','物块位置 x₁','m'],['xCarrier','带/板材料位移 x₂','m'],['relativeDisplacement','有向相对位移','m'],['relativeScratch','累计相对滑移路程','m'],['scratchSpanM','材料划痕覆盖跨度','m'],['frictionOnBlockN','有向摩擦力 f₁','N'],['groundFrictionN','地面对板摩擦力','N'],['kineticEnergy','系统动能 Eₖ','J'],['potentialEnergy','有向重力势能 Eₚ','J'],['frictionHeat','界面生热 Q₁','J'],['groundHeat','地面生热 Q₂','J'],['carrierWork','外力/电机功 W','J']] as const).filter(([key])=>!['groundHeat','groundFrictionN'].includes(key)||params.systemMode==='plank').map(([key,label,unit])=>{const v=summary.observables[key];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'sf-contact-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+unit:'—'}</span></div>;})}<div className="text-[10px]">速度双曲线间阴影为可见采样区间的相对滑移路程近似；累计读数由物理事件积分给出。</div>{summary.observables.terminal===1&&<div className="font-semibold text-rose-500">已到承载面端点 · 接触模型结束</div>}</section>}
          {summary.formulas.map((f) => (
            <div
              key={f.id}
              className="rounded-xl border p-2.5 text-xs space-y-1"
              style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
            >
              <div style={{ color: 'var(--pf-text-muted)' }}>{f.label}</div>
              {(equilibriumSlice||projectileSlice)&&f.substitutedLatex&&<div className="overflow-x-auto" dangerouslySetInnerHTML={{__html:katex.renderToString(f.latex,{throwOnError:false})}}/>}
              <div className="overflow-x-auto"
                dangerouslySetInnerHTML={{
                  __html: katex.renderToString(f.substitutedLatex ?? f.latex, { throwOnError: false })
                }}
              />
            </div>
          ))}


          <div className="text-xs font-bold text-sky-400">参数调节</div>
          {(targetPlugin.getParamFields?.(params)??targetPlugin.paramSchema).filter(field=>circuitSlice?(CIRCUIT_FIELDS[String(params.topology)]??[]).includes(field.key):opticalSlice?(OPTICAL_FIELDS[String(params.sceneMode)]??[]).includes(field.key):mechanicsSlice?(MECHANICS_FIELDS[String(params.scenario)]??[]).includes(field.key):true).map((field) => {
            const val = params[field.key] ?? field.defaultValue;
            if (field.kind === 'number') {
              return (
                <div key={field.key} className="text-xs space-y-0.5">
                  <div className="flex justify-between">
                    <span>{field.label}</span>
                    <span className="font-mono">
                      {val} {field.unit ?? ''}
                    </span>
                  </div>
                  <input
                    type="range"
                    data-testid={'sf-param-'+field.key}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={typeof val === 'number' ? val : field.defaultValue}
                    onChange={(e) => {
                      const next = resolvePluginParams(targetPlugin.paramSchema, {
                        ...params,
                        [field.key]: Number(e.target.value)
                      });
                      setActivePresetId(null);
                      setParams(next);
                      if(odeSlice||chaseSlice||equilibriumSlice||constrainedSlice||projectileSlice||contactSlice){setIsPlaying(false);setScrubTime(null);}
                      setResetNonce((n) => n + 1);
                    }}
                    className="w-full h-9"
                  />
                </div>
              );
            }
            if (field.kind === 'boolean') {
              return (
                <label key={field.key} className="flex items-center justify-between text-xs py-1">
                  <span>{field.label}</span>
                  <input
                    type="checkbox"
                    checked={typeof val === 'boolean' ? val : field.defaultValue}
                    onChange={(e) => {
                      setParams(
                        resolvePluginParams(targetPlugin.paramSchema, {
                          ...params,
                          [field.key]: e.target.checked
                        })
                      );
                      if(equilibriumSlice){setIsPlaying(false);setScrubTime(null);}
                      setResetNonce((n) => n + 1);
                    }}
                  />
                </label>
              );
            }
            if(field.customTextMaxLength!==undefined){const selected=typeof val==='string'?val:field.defaultValue;const apply=(value:string)=>{setActivePresetId(null);setParams(resolvePluginParams(targetPlugin.paramSchema,{...params,[field.key]:value}));setIsPlaying(false);setScrubTime(null);setResetNonce(n=>n+1);};return <div key={field.key} className="space-y-1 text-xs"><span>{field.label}</span><select aria-label="示例方程" value={field.options.some(o=>o.value===selected)?selected:''} onChange={e=>{if(e.target.value)apply(e.target.value);}} className="w-full rounded border px-2 py-1" style={{background:'var(--pf-surface-elevated)'}}><option value="">自定义表达式</option>{field.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select><form key={selected} onSubmit={e=>{e.preventDefault();apply(String(new FormData(e.currentTarget).get('expression')??''));}} className="space-y-1"><textarea data-testid="sf-ode-expression-input" aria-label="加速度表达式" name="expression" defaultValue={selected} rows={3} maxLength={field.customTextMaxLength} className="w-full rounded border p-2 font-mono" style={{background:'var(--pf-surface-elevated)'}}/><button type="submit" data-testid="sf-ode-expression-apply" className="w-full rounded border p-2">应用方程并复位</button></form><div>显式乘法 *；x,v,t,k,m,g,A,w,gamma；量纲由建模者指定。</div></div>;}
            return (
              <div key={field.key} className="text-xs space-y-1">
                <span>{field.label}</span>
                <select
                  value={typeof val === 'string' ? val : field.defaultValue}
                  onChange={(e) => {
                    setParams(
                      resolvePluginParams(targetPlugin.paramSchema, {
                        ...params,
                        [field.key]: e.target.value
                      })
                    );
                    if(odeSlice||chaseSlice||equilibriumSlice||constrainedSlice||projectileSlice||contactSlice){setIsPlaying(false);setScrubTime(null);}
                    setResetNonce((n) => n + 1);
                  }}
                  className="w-full rounded border px-2 py-1.5"
                  style={{ borderColor: 'var(--pf-border)', backgroundColor: 'var(--pf-surface-elevated)' }}
                >
                  {field.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </aside>
      </main>
    </div>
  );
};
