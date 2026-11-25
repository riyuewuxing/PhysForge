import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { getPixelsPerMeter, isSimulationPluginV3, type ParamRecord, type SimulationPluginV2, type ThreeSceneBridge, type Viewport } from '@physforge/sim-sdk';
import { DynamicTubeTrail } from './dynamicTubeTrail.js';
import { CameraMorphController, alignedCanvasViewport, liftPoint, projectCameraDirection, separateScreenLabelBoxes } from './cameraMorphController.js';
import type { StorySpatialCommand } from '../presentation/storyCamera.js';
import { brushedCopperMaterial, magneticFluxMaterial, dielectricGlassMaterial, coilCopperMaterial, coilFluxCoreMaterial, coilFluxHaloMaterial, createParticleGlow, applyFluxEndpointFade, createMagneticBackdrop } from './spatialMaterials.js';
import { fitFusionSpatialFrame,projectFusionFrame } from './fusionFraming.js';
import { createPlanarFlagshipScene,fitB1SpatialFrame,b1ProjectedBounds,b1ProjectionFits } from './planarFlagshipScenes.js';
import { b1FieldCaption,b1StateCaption,b1FrameBounds,b1SafeRect } from '../../../../simulations/em-bounded-magnetic-field/plugin.js';
import type { BoundedMagneticParams,BoundedMagneticState } from '../../../../simulations/em-bounded-magnetic-field/engine.js';
import { createRemainingFlagshipScene } from './remainingFlagshipScenes.js';
import { magnetic3dDisplayPoint, magnetic3dDefaultVisibleHeight } from '@physforge/simulations/em-3d-magnetic-fields';
import { fusionDisplayPoint,fusionDisplayGeometry,fusionGeometryKey,fusionVelocityVectors,fusionEventPoints,fusionStatus,fusionFramePoints,fusionSafeRect,fusionScreenFits } from '@physforge/simulations/stse-tokamak-magnetic-mirror';
import { orbitRenderSnapshot } from '@physforge/simulations/astro-orbital-mechanics';
import type { AstroOrbitalState,AstroOrbitalParams } from '../../../../simulations/astro-orbital-mechanics/engine.js';
import type { EmDevicesState } from '../../../../simulations/stse-em-devices-suite/engine.js';
import { flightReadout } from '../../../../simulations/stse-em-devices-suite/particleFlight.js';
import { cyclotronReadout } from '../../../../simulations/stse-em-devices-suite/cyclotronFlight.js';
import { isSensorDevice, sensorReadout, type EmDevicesParams } from '../../../../simulations/stse-em-devices-suite/engine.js';
import { getDeviceSchematic, deviceCueColor } from '../../../../simulations/stse-em-devices-suite/deviceGeometry.js';
import {
  buildMagneticConductorPaths,
  magneticFieldGeometrySignature,
  getMagneticDisplayFieldLines,
  type Magnetic3dParams,
  type Magnetic3dState
} from '@physforge/simulations/em-3d-magnetic-fields/engine';
import {
  computeMirrorLossConeDeg,
  fusionParallelVelocity,
  FUSION_TRAIL_CAP,
  TOKAMAK_MINOR_RADIUS_M,
  type TokamakMirrorParams,
  type TokamakMirrorState
} from '@physforge/simulations/stse-tokamak-magnetic-mirror/engine';

interface ThreeStageProps {
  readonly plugin: SimulationPluginV2<ParamRecord, unknown>;
  readonly simState: unknown;
  readonly simStateRef?: React.RefObject<unknown>;
  readonly getFrameState?: () => unknown;
  readonly params: ParamRecord;
  readonly getFrameParams?: () => ParamRecord;
  readonly storyCameraCommandRef?: React.RefObject<StorySpatialCommand | null>;
  readonly activeLayers: ReadonlySet<string>;
  readonly getFrameLayers?: () => ReadonlySet<string>;
  readonly presentationMode?: boolean;
  readonly morphTarget?: 0 | 1;
  readonly initialFlatViewport?: Viewport;
  readonly onMorphProgress?: (progress: number) => void;
  readonly onMorphFlat?: (viewport: Viewport,b1Automatic?:boolean) => void;
  readonly initialB1AutoFit?:boolean;
  readonly b1AutoFitAllowed?:boolean;
  readonly b1ResetViewNonce?:number;
  readonly b1ScopeCollapsed?:boolean;
  readonly onWebGLFallback?: () => void;
}

function disposeObjectResources(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (
      child instanceof THREE.Mesh ||
      child instanceof THREE.Line ||
      child instanceof THREE.LineSegments
    ) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
}

function disposeGroupChildren(group: THREE.Group): void {
  while (group.children.length > 0) {
    const child = group.children[0]!;
    group.remove(child);
    disposeObjectResources(child);
  }
}

function mapMagneticPoint(point: { x: number; y: number; z: number }): THREE.Vector3 {
  const p = magnetic3dDisplayPoint(point);
  return new THREE.Vector3(p.x, p.y, p.z);
}

const magneticAxisColors = [
  { name: 'X', color: '#fb7185', direction: { x: 1, y: 0, z: 0 } },
  { name: 'Y', color: '#4ade80', direction: { x: 0, y: 1, z: 0 } },
  { name: 'Z', color: '#38bdf8', direction: { x: 0, y: 0, z: 1 } }
] as const;

function updateMagneticAxisWidget(widget:SVGSVGElement,camera:THREE.Camera,directPhysicalAxes=false,fusionMode?:TokamakMirrorParams['mode']):void{
  const directions = magneticAxisColors.map(axis => projectCameraDirection(fusionMode?new THREE.Vector3(...Object.values(fusionDisplayPoint(axis.direction,fusionMode)) as [number,number,number]):directPhysicalAxes?new THREE.Vector3(axis.direction.x,axis.direction.y,axis.direction.z):mapMagneticPoint(axis.direction), camera));
  const orientation = directions.map(v => v.toArray().map(x => x.toFixed(3)).join(',')).join(';');
  if (widget.getAttribute('data-axis-orientation') === orientation) return;
  widget.setAttribute('data-axis-orientation', orientation);
  for (let i = 0; i < magneticAxisColors.length; i++) {
    const axis = magneticAxisColors[i]!, v = directions[i]!;
    const group = widget.querySelector<SVGGElement>(`[data-physical-axis="${axis.name}"]`);
    const line = group?.querySelector('line'), arrow = group?.querySelector('polygon'), label = group?.querySelector('text');
    if (!line || !arrow || !label) continue;
    const dx = v.x * 21, dy = -v.y * 21, length = Math.hypot(dx,dy);
    const x = 30 + dx, y = 30 + dy;
    if (length < 3.5) {
      line.setAttribute('visibility','hidden'); arrow.setAttribute('visibility','hidden');
      label.textContent = axis.name + (v.z > 0 ? '⊙' : '⊗');
      label.setAttribute('x','30'); label.setAttribute('y','39');
    } else {
      const ux = dx/length, uy = dy/length, bx = x-ux*5, by = y-uy*5;
      line.setAttribute('visibility','visible'); arrow.setAttribute('visibility','visible');
      line.setAttribute('x2',String(bx)); line.setAttribute('y2',String(by));
      arrow.setAttribute('points',`${x},${y} ${bx-uy*2.8},${by+ux*2.8} ${bx+uy*2.8},${by-ux*2.8}`);
      label.textContent = axis.name;
      label.setAttribute('x',String(30+ux*Math.min(26,length+6)));
      label.setAttribute('y',String(32+uy*Math.min(26,length+6)));
    }
  }
}

function updateVectorArrow(
  arrow: THREE.ArrowHelper,
  origin: THREE.Vector3,
  vector: THREE.Vector3,
  magnitude: number,
  lengthScale: number,
  minLength: number,
  maxLength: number
): number {
  if (!Number.isFinite(magnitude) || magnitude <= 1e-10) {
    arrow.visible = false;
    return 0;
  }

  arrow.visible = true;
  arrow.position.copy(origin);
  arrow.setDirection(vector.clone().multiplyScalar(1 / magnitude));
  const length = Math.max(minLength, Math.min(maxLength, magnitude * lengthScale));
  const headLength = Math.min(0.22, length * 0.32);
  arrow.setLength(length, headLength, Math.min(0.13, length * 0.2));
  const shaft = arrow.getObjectByName('magnetic-vector-shaft');
  if (shaft) {
    const stem = Math.max(0.001, length-headLength);
    shaft.scale.y = stem; shaft.position.y = stem/2;
  }
  return length;
}

/** Solid arrow shaft in the same local +Y direction as ArrowHelper's cone. */
function addMagneticVectorShaft(arrow: THREE.ArrowHelper, color: number): void {
  arrow.line.visible=false;
  const shaft=new THREE.Mesh(new THREE.CylinderGeometry(0.012,0.012,1,10),
    new THREE.MeshBasicMaterial({color,toneMapped:false}));
  shaft.name='magnetic-vector-shaft'; arrow.add(shaft);
  if (arrow.cone.material instanceof THREE.MeshBasicMaterial) arrow.cone.material.toneMapped=false;
}

class PerformanceGuard {
  private targetInterval = 1000 / 60;
  private slowFrames = 0;
  private recoveredFrames = 0;

  get interval(): number {
    return this.targetInterval;
  }

  observe(renderDurationMs: number): void {
    if (this.targetInterval > 1000 / 60) {
      this.recoveredFrames = renderDurationMs < 16 ? this.recoveredFrames + 1 : 0;
      if (this.recoveredFrames >= 45) {
        this.targetInterval = 1000 / 60;
        this.recoveredFrames = 0;
        this.slowFrames = 0;
      }
      return;
    }

    this.slowFrames = renderDurationMs > 24 ? this.slowFrames + 1 : 0;
    if (this.slowFrames >= 8) {
      this.targetInterval = 1000 / 30;
      this.slowFrames = 0;
      this.recoveredFrames = 0;
    }
  }

}

function createRadialGrid(magnetic = false): THREE.Group {
  const grid = new THREE.Group();
  const xLimit = 7;
  const nearZ = magnetic ? -5 : -2;
  const farZ = 8;
  for (let index = 0; index <= (magnetic ? 21 : 16); index++) {
    const z = nearZ + index * 0.625;
    const points = [
      new THREE.Vector3(-xLimit, -0.025, z),
      new THREE.Vector3(xLimit, -0.025, z)
    ];
    const material = new THREE.LineBasicMaterial({
      color: 0x64748b,
      transparent: true,
      opacity: (magnetic ? 0.055 : 0.035) + (magnetic ? 0.09 : 0.065) * Math.exp(-Math.abs(z) * 0.2)
    });
    grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
  }
  for (let index = -14; index <= 14; index++) {
    const x = index * 0.5;
    const points = [
      new THREE.Vector3(x, -0.025, nearZ),
      new THREE.Vector3(x, -0.025, farZ)
    ];
    const material = new THREE.LineBasicMaterial({
      color: 0x475569,
      transparent: true,
      opacity: magnetic ? 0.13 : 0.075
    });
    grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
  }
  return grid;
}

function createWorldLabel(text: string, color: string): CSS2DObject {
  const element = document.createElement('div');
  element.className = 'pf-3d-label';
  element.textContent = text;
  element.style.color = color;
  return new CSS2DObject(element);
}

/**
 * 纯 Vanilla Three.js + OrbitControls 命令式懒加载 3D 舞台，卸载时释放 WebGL 与 DOM 资源。
 */
export const ThreeStage: React.FC<ThreeStageProps> = ({
  plugin,
  simState,
  simStateRef,
  getFrameState,
  params,
  activeLayers,
  getFrameLayers,
  presentationMode = false,
  morphTarget = 0, initialFlatViewport, getFrameParams, storyCameraCommandRef, onMorphProgress, onMorphFlat, onWebGLFallback,
  initialB1AutoFit=true,b1AutoFitAllowed=true,b1ResetViewNonce=0,b1ScopeCollapsed=false
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bridgeRef = useRef<ThreeSceneBridge<ParamRecord, unknown> | null>(null);
  const latestStateRef = useRef(simState);
  const latestParamsRef = useRef(params);
  const latestLayersRef = useRef(activeLayers);
  const morphPropsRef = useRef({ morphTarget, onMorphProgress, onMorphFlat, onWebGLFallback });
  morphPropsRef.current = { morphTarget, onMorphProgress, onMorphFlat, onWebGLFallback };
  const initialViewportRef = useRef(initialFlatViewport);
  const b1PolicyRef=useRef({allowed:b1AutoFitAllowed,nonce:b1ResetViewNonce,presentation:presentationMode,scopeCollapsed:b1ScopeCollapsed});
  b1PolicyRef.current={allowed:b1AutoFitAllowed,nonce:b1ResetViewNonce,presentation:presentationMode,scopeCollapsed:b1ScopeCollapsed};
  latestStateRef.current = simState;
  latestParamsRef.current = params;
  latestLayersRef.current = activeLayers;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // A null result from the owner-checked getter is intentional; never fall back to a previous model.
    const readState = () => getFrameState ? getFrameState() : simStateRef ? simStateRef.current : latestStateRef.current;
    const readLayers = () => getFrameLayers?.() ?? latestLayersRef.current;
    if (plugin.mountThreeScene) {
      const bridge = plugin.mountThreeScene(container);
      bridgeRef.current = bridge;
      const state = readState();
      if (state !== null && state !== undefined) bridge.sync(state, getFrameParams?.() ?? params, readLayers());

      const ro = new ResizeObserver(() => {
        if (!containerRef.current) return;
        bridge.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
      });
      ro.observe(container);

      return () => {
        ro.disconnect();
        bridge.dispose();
        bridgeRef.current = null;
      };
    }

    const isMag3d = plugin.meta.id === 'em-3d-magnetic-fields';
    const isTokamak3d = plugin.meta.id === 'stse-tokamak-magnetic-mirror';
    const isBoundedStage=plugin.meta.id==='builder-composite-em-field';
    const isOrbitStage=plugin.meta.id==='astro-orbital-mechanics';
    const magneticAxisWidget = isMag3d||isBoundedStage||isTokamak3d ? container.querySelector<SVGSVGElement>('[data-magnetic-axis-widget]') : null;

    const width = Math.max(320, container.clientWidth);
    const height = Math.max(240, container.clientHeight);
    const scene = new THREE.Scene();
    const isDeviceStage=plugin.meta.id==='stse-em-devices-suite';
    const magneticBackdrop=isMag3d||isDeviceStage||isBoundedStage||isTokamak3d||isOrbitStage?createMagneticBackdrop():null;
    scene.background = magneticBackdrop ?? new THREE.Color('#0b0f17');
    // An abstract electromagnetic field has no atmospheric attenuation.
    // Keep B1's small physical symbols legible when fitting a long trajectory.
    scene.fog = isBoundedStage||isTokamak3d||isOrbitStage?null:new THREE.FogExp2('#0b0f17',0.085);

    const spatial = isSimulationPluginV3(plugin) ? plugin.spatial3D : undefined;
    const initialMagneticParams = isMag3d ? (getFrameParams?.() ?? params) as Magnetic3dParams : null;
    let framedMagneticGeometry = initialMagneticParams?.geometryType;
    const orbitParams=isOrbitStage?(getFrameParams?.()??params) as AstroOrbitalParams:null;
    const framedSpec = spatial && initialMagneticParams ? { ...spatial, defaultVisibleHeight: magnetic3dDefaultVisibleHeight(initialMagneticParams,width/height) } : spatial&&orbitParams?{...spatial,defaultVisibleHeight:orbitParams.mode==='hohmann-transfer'?Math.max(5.8,2*orbitParams.r2OverR1+1.2):orbitParams.mode==='binary-lagrange'?5.8:5.9}:spatial;
    const morph = framedSpec ? new CameraMorphController(framedSpec, width, height) : null;
    const camera = morph?.perspCamera ?? new THREE.PerspectiveCamera(48, width / height, 0.1, 200);
    if (!morph) {
      camera.position.set(isMag3d ? 2.2 : 3.4, isMag3d ? 1.9 : 2.5, isMag3d ? 2.8 : 4.4);
      camera.lookAt(0, 0, 0);
    }
    const initialViewport = initialViewportRef.current;
    const orbitTarget = new THREE.Vector3();
    if (morph && spatial && initialViewport) {
      const ppm = getPixelsPerMeter(initialViewport);
      orbitTarget.copy(liftPoint((initialViewport.width * 0.05 - initialViewport.offsetX) / ppm,
        initialViewport.offsetY / ppm, spatial.flattenPlane));
      morph.setFraming(orbitTarget, initialViewport.height / ppm);
      morph.startMorphTo(1, performance.now(), 0);
    }
    let lastMorphTarget: 0 | 1 = initialViewport && morph ? 1 : 0;
    let flatNotified = false;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      morphPropsRef.current.onWebGLFallback?.();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    container.appendChild(renderer.domElement);

    const cssRenderer = new CSS2DRenderer();
    cssRenderer.setSize(width, height);
    cssRenderer.domElement.style.position = 'absolute';
    cssRenderer.domElement.style.inset = '0';
    cssRenderer.domElement.style.overflow = 'hidden';
    cssRenderer.domElement.style.pointerEvents = 'none';
    cssRenderer.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(cssRenderer.domElement);

    // B1 has no reflective matter or transmissive box. Avoid allocating and
    // sampling a room environment solely to depict an abstract field.
    const pmremGenerator=isBoundedStage?null:new THREE.PMREMGenerator(renderer);
    const roomEnvironment=pmremGenerator?new RoomEnvironment():null;
    const environmentTarget=pmremGenerator&&roomEnvironment?pmremGenerator.fromScene(roomEnvironment,.04):null;
    if(environmentTarget)scene.environment=environmentTarget.texture;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.copy(orbitTarget);
    if (!morph || !initialViewport) controls.update();
    else controls.enabled = false;

    const grid = createRadialGrid(isMag3d);
    const ambient = new THREE.HemisphereLight(0xc7e7ff, 0x101826, isMag3d||isDeviceStage ? 0.72 : 1.05);
    const keyLight = new THREE.DirectionalLight(0xffe1b1, isMag3d||isDeviceStage ? 2.0 : 3.1);
    keyLight.position.set(3.5, 5, 4);
    const rimLight = new THREE.DirectionalLight(0x38bdf8, isMag3d||isDeviceStage ? 1.45 : 2.2);
    rimLight.position.set(-4, 2, -3);
    scene.add(grid, ambient, keyLight, rimLight);
    const planarDriver = createPlanarFlagshipScene(plugin.meta.id, scene) ?? createRemainingFlagshipScene(plugin.meta.id, scene);
    if (planarDriver) grid.visible = false;

    const staticGroup = new THREE.Group();
    const trailGroup = new THREE.Group();
    scene.add(staticGroup, trailGroup);
    const magneticTrail=isMag3d?new DynamicTubeTrail(301,.012,6):null;
    const magneticTrailHalo=isMag3d?new DynamicTubeTrail(301,.029,6):null;
    if(magneticTrailHalo){
      const mesh=new THREE.Mesh(magneticTrailHalo.geometry,new THREE.MeshBasicMaterial({color:0xff9b38,toneMapped:false,transparent:true,opacity:.20,depthWrite:false,blending:THREE.AdditiveBlending}));
      mesh.name='magnetic-particle-trail-halo';mesh.frustumCulled=false;trailGroup.add(mesh);
    }
    if(magneticTrail){
      const mesh=new THREE.Mesh(magneticTrail.geometry,new THREE.MeshBasicMaterial({ color: 0xffcb75, toneMapped: false }));
      mesh.name='magnetic-particle-trail';mesh.frustumCulled=false;trailGroup.add(mesh);
    }
    const fusionTrail=isTokamak3d?new DynamicTubeTrail(FUSION_TRAIL_CAP,.009,6):null;
    const fusionHalo=isTokamak3d?new DynamicTubeTrail(FUSION_TRAIL_CAP,.023,6):null;
    if(fusionTrail&&fusionHalo){
      const halo=new THREE.Mesh(fusionHalo.geometry,new THREE.MeshBasicMaterial({color:0xffa445,toneMapped:false,transparent:true,opacity:.15,depthWrite:false,blending:THREE.AdditiveBlending}));
      const core=new THREE.Mesh(fusionTrail.geometry,new THREE.MeshBasicMaterial({color:0xffcb75,toneMapped:false}));
      core.name='fusion-particle-trail';halo.name='fusion-particle-trail-halo';core.frustumCulled=halo.frustumCulled=false;trailGroup.add(halo,core);
    }
    const fusionPins=isTokamak3d?new THREE.Group():null;
    if(fusionPins)scene.add(fusionPins);
    let fusionPinKey='',lastFusionTrail:TokamakMirrorState['trail']|null=null,lastFusionMode='';
    const sphereGeo = new THREE.SphereGeometry(1, 20, 20);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: isMag3d ? 0xffe8bd : 0x86efac,
      emissive: isMag3d ? 0xffb64f : 0x16a34a,
      emissiveIntensity: isMag3d ? 2.4 : 1.4,
      metalness: 0.2,
      roughness: 0.28
    });
    const marker = new THREE.Mesh(sphereGeo, sphereMat);
    const particleGlow = isMag3d||isTokamak3d ? createParticleGlow() : null;
    if (particleGlow) marker.add(particleGlow.sprite);
    scene.add(marker);
    if (planarDriver) marker.visible = false;

    const velocityArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.65, 0xfacc15, 0.2, 0.12);
    const lorentzForceArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.55, 0xfb7185, 0.18, 0.11);
    const magneticFieldArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.6, 0x38bdf8, 0.2, 0.12);
    velocityArrow.name = 'particle-velocity-vector';
    lorentzForceArrow.name = 'particle-lorentz-force-vector';
    magneticFieldArrow.name = 'particle-magnetic-field-vector';
    if (isMag3d||isTokamak3d) {
      addMagneticVectorShaft(velocityArrow,0xffd36b);
      addMagneticVectorShaft(lorentzForceArrow,isTokamak3d?0xf472b6:0xfb7185);
      addMagneticVectorShaft(magneticFieldArrow,0x54d7ed);
    }
    velocityArrow.visible = false;
    lorentzForceArrow.visible = false;
    magneticFieldArrow.visible = false;
    scene.add(velocityArrow, lorentzForceArrow, magneticFieldArrow);

    const velocityLabel = createWorldLabel('v', '#facc15');
    const forceLabel = createWorldLabel('a洛', '#fb7185');
    const fieldLabel = createWorldLabel('B', '#38bdf8');
    velocityLabel.visible = false;
    forceLabel.visible = false;
    fieldLabel.visible = false;
    scene.add(velocityLabel, forceLabel, fieldLabel);

    const performanceGuard = new PerformanceGuard();
    let lastConfigSig = '';
    let lastMagneticTrail:Magnetic3dState['trail']|null=null;
    let lastSyncedState: unknown;
    let rafId = 0;
    let dirty = true;
    let contextLost = false;
    let lastRenderTime = 0;

    const markDirty = () => {
      dirty = true;
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      morphPropsRef.current.onWebGLFallback?.();
    };
    const onContextRestored = () => {
      contextLost = false;
      dirty = true;
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost, false);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored, false);
    controls.addEventListener('change', markDirty);
    let b1AutoFit=initialB1AutoFit,b1FramingKey='',b1FramedAt=-Infinity,b1RenderCount=0;
    let b1LastPolicy=b1PolicyRef.current;
    const lockB1Camera=()=>{b1AutoFit=false;};
    if(isBoundedStage||isTokamak3d)controls.addEventListener('start',lockB1Camera);

    const velocityLabelAnchor = new THREE.Vector3();
    const forceLabelAnchor = new THREE.Vector3();
    const fieldLabelAnchor = new THREE.Vector3();

    // S02 labels share the schematic anchors; rebuild only when direction/polarity changes.
    let deviceLabels: Array<{obj:CSS2DObject;anchor:THREE.Vector3}> = [];
    let deviceLabelSignature='';
    const clearDeviceLabels=()=>{for(const {obj} of deviceLabels){scene.remove(obj);obj.element.remove();}deviceLabels=[];};
    const syncDeviceLabels=(p:EmDevicesParams,layers:ReadonlySet<string>)=>{
      const signature=[p.device,p.carrierType,Math.sign(p.hallCurrentA),Math.sign(p.bFieldT),Math.sign(p.particleSpeedMps)].join(':');
      if(signature!==deviceLabelSignature){
        deviceLabelSignature=signature;clearDeviceLabels();
        if(isSensorDevice(p.device)){
          const diagram=getDeviceSchematic(p.device,p);
          const add=(text:string,color:string,x:number,y:number)=>{
            const obj=createWorldLabel(text,color),anchor=new THREE.Vector3(x,.22,-y);
            obj.element.dataset.deviceLabel=text;obj.position.copy(anchor);scene.add(obj);deviceLabels.push({obj,anchor});
          };
          for(const l of diagram.labels.filter(l=>/^(上|下) /.test(l.text)))add(l.text,'#f8fafc',l.x,l.y);
          for(const c of diagram.cues)add(c.label,deviceCueColor(c.kind),c.x+c.dx*.5,c.y+c.dy*.5);
        }
      }
      for(const {obj} of deviceLabels)obj.visible=layers.has('main');
    };

    const separateWorldLabels = (viewportWidth: number, viewportHeight: number) => {
      const activeCamera = morph?.getActiveCamera() ?? camera;
      activeCamera.updateMatrixWorld();
      const activeLabels: Array<{ obj: CSS2DObject; ndcZ: number; x: number; y: number; width: number; height: number }> = [];
      const candidates: Array<{ obj: CSS2DObject; anchor: THREE.Vector3 }> = [
        { obj: velocityLabel, anchor: velocityLabelAnchor },
        { obj: forceLabel, anchor: forceLabelAnchor },
        { obj: fieldLabel, anchor: fieldLabelAnchor },
        ...deviceLabels
      ];
      for (const item of candidates) {
        if (!item.obj.visible) continue;
        const projected = item.anchor.clone().project(activeCamera);
        if (![projected.x, projected.y, projected.z].every(Number.isFinite)) continue;
        const rect = item.obj.element.getBoundingClientRect();
        activeLabels.push({
          obj: item.obj,
          ndcZ: projected.z,
          x: (projected.x * 0.5 + 0.5) * viewportWidth,
          y: (-projected.y * 0.5 + 0.5) * viewportHeight,
          width: Math.max(30, rect.width, item.obj.element.offsetWidth, item.obj.element.dataset.deviceLabel ? item.obj.element.dataset.deviceLabel.length*12+12 : 0),
          height: Math.max(32, rect.height, item.obj.element.offsetHeight)
        });
      }
      const separated = separateScreenLabelBoxes(activeLabels);
      for (let i = 0; i < activeLabels.length; i++) {
        const item = activeLabels[i]!, next = separated[i]!;
        // Exact inverse projection at the same NDC depth, including orthographic morph.
        item.obj.position.copy(new THREE.Vector3(
          next.x / viewportWidth * 2 - 1,
          1 - next.y / viewportHeight * 2,
          item.ndcZ
        ).unproject(activeCamera));
      }
    };

    const syncState = (
      state: unknown,
      curParams: ParamRecord,
      layers: ReadonlySet<string>
    ) => {
      if (state === null || state === undefined) return;
      if (planarDriver) { planarDriver.sync(state, curParams, layers); if(isDeviceStage)syncDeviceLabels(curParams as EmDevicesParams,layers); dirty = true; return; }
      if (isMag3d || isTokamak3d) {
        const magState = state as Magnetic3dState | TokamakMirrorState;
        const fusionParams = curParams as TokamakMirrorParams;
        const project = (point: { x: number; y: number; z: number }) => {
          if (isMag3d) return mapMagneticPoint(point);
          const p = fusionDisplayPoint(point, fusionParams.mode);
          return new THREE.Vector3(p.x, p.y, p.z);
        };
        const position = project(magState.position);
        marker.position.copy(position);

        if (isMag3d) {
          const magneticParams = curParams as Magnetic3dParams;
          if (framedMagneticGeometry !== magneticParams.geometryType) {
            framedMagneticGeometry = magneticParams.geometryType;
            if (morph && morph.getMorphT() === 0 && !morph.isAnimating) {
              morph.syncFromOrbitPosition(camera.position, controls.target, camera.fov);
              const aspect=(container.clientWidth || width)/(container.clientHeight || height);
              controls.target.set(0,0,0);
              morph.setFraming(controls.target,magnetic3dDefaultVisibleHeight(magneticParams,aspect));
              controls.update();
            }
          }
          const particleRadius = magneticParams.geometryType === 'uniform-helix'
            ? 0.055 : Math.max(0.025, 0.055 * Math.max(0.2, magneticParams.radiusR));
          marker.scale.setScalar(particleRadius);
          const particleState = state as Magnetic3dState;
          const vectorsVisible = layers.has('handednessTriad');
          const velocity = mapMagneticPoint(particleState.velocity);
          const lorentzForce = mapMagneticPoint(particleState.lorentzForce);
          const magneticField = mapMagneticPoint(particleState.bAtParticle);
          const speed = velocity.length();
          const forceMagnitude = lorentzForce.length();
          const fieldMagnitude = magneticField.length();
          const velocityLength = vectorsVisible
            ? updateVectorArrow(velocityArrow, position, velocity, speed, 0.48, 0.48, 0.95)
            : 0;
          const forceLength = vectorsVisible
            ? updateVectorArrow(lorentzForceArrow, position, lorentzForce, forceMagnitude, 0.62, 0.4, 0.82)
            : 0;
          const fieldLength = vectorsVisible
            ? updateVectorArrow(magneticFieldArrow, position, magneticField, fieldMagnitude, 0.52, 0.45, 0.9)
            : 0;
          if (!vectorsVisible) {
            velocityArrow.visible = false;
            lorentzForceArrow.visible = false;
            magneticFieldArrow.visible = false;
          }
          container.dataset.renderedVelocityArrow = String(velocityArrow.visible);
          container.dataset.renderedForceArrow = String(lorentzForceArrow.visible);
          container.dataset.renderedFieldArrow = String(magneticFieldArrow.visible);
          velocityLabel.visible = velocityLength > 0;
          forceLabel.visible = forceLength > 0;
          fieldLabel.visible = fieldLength > 0;
          if (velocityLength > 0) {
            velocityLabelAnchor
              .copy(position)
              .add(velocity.clone().normalize().multiplyScalar(velocityLength + 0.24));
            velocityLabel.position.copy(velocityLabelAnchor);
          }
          if (forceLength > 0) {
            forceLabelAnchor
              .copy(position)
              .add(lorentzForce.clone().normalize().multiplyScalar(forceLength + 0.22));
            forceLabel.position.copy(forceLabelAnchor);
          }
          if (fieldLength > 0) {
            fieldLabelAnchor
              .copy(position)
              .add(magneticField.clone().normalize().multiplyScalar(fieldLength + 0.22));
            fieldLabel.position.copy(fieldLabelAnchor);
          }
          separateWorldLabels(renderer.domElement.clientWidth || width, renderer.domElement.clientHeight || height);
        } else {
          marker.scale.setScalar(.038);
          const fusion=state as TokamakMirrorState;
          sphereMat.color.set(fusion.escaped?0xfb7185:0xffe9b0);
          sphereMat.emissive.set(fusion.escaped?0xa5253e:0xffaf4b);
          if(fusionTrail&&fusionHalo&&(lastFusionTrail!==fusion.trail||lastFusionMode!==fusionParams.mode)){
            lastFusionTrail=fusion.trail;lastFusionMode=fusionParams.mode;
            fusionTrail.update(fusion.trail,p=>fusionDisplayPoint(p,fusionParams.mode));
            fusionHalo.update(fusion.trail,p=>fusionDisplayPoint(p,fusionParams.mode));
          }
          const vectors=fusionVelocityVectors(fusion,fusionParams);
          for(const [i,arrow] of [velocityArrow,magneticFieldArrow,lorentzForceArrow].entries()){
            const v=vectors[i]!,origin=new THREE.Vector3(v.a.x,v.a.y,v.a.z),delta=new THREE.Vector3(v.b.x-v.a.x,v.b.y-v.a.y,v.b.z-v.a.z);
            if(layers.has('velocityComponents')&&delta.length()>1e-8)updateVectorArrow(arrow,origin,delta,delta.length(),1,0,1);
            else arrow.visible=false;
          }
          velocityLabel.visible=forceLabel.visible=fieldLabel.visible=false;
          if(fusionPins){
            const pins=layers.has('eventPins')?fusionEventPoints(fusion,fusionParams):[];
            const key=JSON.stringify([fusionParams.mode,pins]);
            if(key!==fusionPinKey){
              fusionPinKey=key;disposeGroupChildren(fusionPins);
              for(const ev of pins){
                const color=ev.id==='fusion-escape'?0xfb7185:0x4ade80;
                const pin=new THREE.Mesh(new THREE.SphereGeometry(.065,12,8),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.75,wireframe:true,toneMapped:false}));
                pin.name=ev.id;pin.position.set(ev.point.x,ev.point.y,ev.point.z);fusionPins.add(pin);
              }
            }
          }

        }

        const configSignature = JSON.stringify({
          model: plugin.meta.id,
          params: isMag3d ? magneticFieldGeometrySignature(curParams as Magnetic3dParams) : fusionGeometryKey(fusionParams),
          conductors: layers.has('conductors'),
          fieldLines: layers.has('fieldLines3d')
        });
        if (configSignature !== lastConfigSig) {
          lastConfigSig = configSignature;
          disposeGroupChildren(staticGroup);

          if (isMag3d) grid.position.y = -1.2 * Math.max(0.2, (curParams as Magnetic3dParams).radiusR);
          let renderedConductorCount = 0;
          if (layers.has('conductors')) {
            const magneticParams = curParams as Magnetic3dParams;
            const fusionSegments=isTokamak3d?fusionDisplayGeometry(fusionParams).segments:[];
            const fusionSize = fusionParams.mode === 'tokamak' ? 24 : 32;
            const paths = isMag3d ? buildMagneticConductorPaths(magneticParams)
              : Array.from({ length: Math.ceil(fusionSegments.length / fusionSize) }, (_, i) => fusionSegments.slice(i*fusionSize, (i+1)*fusionSize));
            for (const group of paths) {
              if (group.length === 0) continue;
              const points = [group[0]!.a, ...group.map(segment => segment.b)].map(project);
              const closed = isTokamak3d || (isMag3d && ['single-loop','helmholtz-coil','finite-solenoid'].includes(magneticParams.geometryType));
              if (closed && points[0]!.distanceTo(points[points.length - 1]!) < 1e-8) points.pop();
              const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
              const radius = isMag3d ? Math.min(0.055, 0.063 * Math.max(0.2, magneticParams.radiusR)) : .043;
              const tubeGeo = new THREE.TubeGeometry(curve, Math.max(64, group.length), radius, isMag3d ? 14 : 10, closed);
              staticGroup.add(new THREE.Mesh(tubeGeo, coilCopperMaterial()));
              if (isMag3d && !closed) {
                // The visual finite conductor is a solid cylinder, not an open pipe.
                for (const [end, adjacent] of [[points[0]!,points[1]!],[points.at(-1)!,points.at(-2)!]] as const) {
                  const cap=new THREE.Mesh(new THREE.CircleGeometry(radius,16),coilCopperMaterial());
                  cap.position.copy(end);
                  cap.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),end.clone().sub(adjacent).normalize());
                  staticGroup.add(cap);
                }
              }
              renderedConductorCount++;
            }
          }

          if (isTokamak3d && layers.has('conductors') && fusionParams.mode === 'tokamak') {
            const chamber = new THREE.Mesh(new THREE.TorusGeometry(fusionParams.majorRadiusM,TOKAMAK_MINOR_RADIUS_M,24,96),new THREE.MeshBasicMaterial({color:0x7dd3fc,transparent:true,opacity:.06,depthWrite:false,toneMapped:false}));
            chamber.name = 'tokamak-vacuum-chamber';
            staticGroup.add(chamber);
          }
          let renderedFieldCount = 0;
          if (layers.has('fieldLines3d')) {
            const lines = isMag3d
              ? getMagneticDisplayFieldLines(curParams as Magnetic3dParams)
              : fusionDisplayGeometry(fusionParams).lines;
            for (const line of lines) {
              if (line.length < 2) continue;
              const points = line.map(project);
              const closed=isMag3d&&points[0]!.distanceTo(points[points.length-1]!)<.06;
              if (isMag3d && closed && points[0]!.distanceTo(points[points.length - 1]!) < 1e-8) points.pop();
              const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
              const divisions=Math.min(512,Math.max(32,points.length));
              const geometry = new THREE.TubeGeometry(curve, divisions, isMag3d?.006:.009, 5, closed);
              applyFluxEndpointFade(geometry,closed);
              staticGroup.add(new THREE.Mesh(geometry,coilFluxCoreMaterial(true)));
              if (isMag3d||isTokamak3d) {
                const haloGeometry = new THREE.TubeGeometry(curve, divisions, 0.024, 5, closed);
                applyFluxEndpointFade(haloGeometry,closed);
                staticGroup.add(new THREE.Mesh(haloGeometry, coilFluxHaloMaterial()));
                // Tangent of an actual ordered field sample, not a decorative direction.
                if (renderedFieldCount % (isTokamak3d?2:4) === 0) {
                  const index = Math.max(1, Math.floor(points.length / 2));
                  const start = points[index-1]!, delta = points[index]!.clone().sub(start);
                  if (delta.lengthSq() > 1e-10) {
                    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.085, 8), coilFluxCoreMaterial());
                    cone.position.copy(start).lerp(points[index]!, 0.5);
                    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), delta.normalize());
                    staticGroup.add(cone);
                  }
                }
              }
              renderedFieldCount++;
            }
          }
          if(isMag3d||isTokamak3d){
            container.dataset.fieldLineCount = String(renderedFieldCount);
            container.dataset.conductorCount = String(renderedConductorCount);
          }
        }

        if(isMag3d&&magneticTrail){
          const trail=(state as Magnetic3dState).trail;
          if(trail!==lastMagneticTrail){
            lastMagneticTrail=trail;magneticTrail.update(trail,magnetic3dDisplayPoint);
            magneticTrailHalo?.update(trail,magnetic3dDisplayPoint);
          }
        }
      } else {
        const generic = state as { x?: number; y?: number; z?: number; x1?: number };
        marker.position.set(generic.x ?? generic.x1 ?? 0, generic.y ?? 0, generic.z ?? 0);
      }
      dirty = true;
    };

    bridgeRef.current = {
      sync: syncState,
      resize: (nextWidth, nextHeight) => {
        const nextW = Math.max(320, nextWidth);
        const nextH = Math.max(240, nextHeight);
        if (morph) {
          if (morph.getMorphT() === 0 && !morph.isAnimating) morph.syncFromOrbitPosition(camera.position, controls.target, camera.fov);
          morph.resize(nextW, nextH);
        }
        else { camera.aspect = nextW / nextH; camera.updateProjectionMatrix(); }
        renderer.setSize(nextW, nextH);
        cssRenderer.setSize(nextW, nextH);
        dirty = true;
      },
      dispose: () => {
        cancelAnimationFrame(rafId);
        renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
        renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
        controls.removeEventListener('change', markDirty);
        if(isBoundedStage||isTokamak3d)controls.removeEventListener('start',lockB1Camera);
        planarDriver?.dispose();
        clearDeviceLabels();
        disposeGroupChildren(staticGroup);
        disposeGroupChildren(trailGroup);
        if(fusionPins){disposeGroupChildren(fusionPins);scene.remove(fusionPins);}
        scene.remove(velocityArrow, lorentzForceArrow, magneticFieldArrow, marker, velocityLabel, forceLabel, fieldLabel);
        disposeObjectResources(velocityArrow);
        disposeObjectResources(lorentzForceArrow);
        disposeObjectResources(magneticFieldArrow);
        if (particleGlow) { marker.remove(particleGlow.sprite); particleGlow.material.dispose(); particleGlow.texture.dispose(); }
        sphereGeo.dispose();
        sphereMat.dispose();
        disposeObjectResources(grid);
        magneticBackdrop?.dispose();
        environmentTarget?.dispose();
        pmremGenerator?.dispose();
        if(roomEnvironment)disposeObjectResources(roomEnvironment);
        controls.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
        if (cssRenderer.domElement.parentNode === container) container.removeChild(cssRenderer.domElement);
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current) return;
      bridgeRef.current?.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    });
    resizeObserver.observe(container);

    let lastSyncedParams = getFrameParams?.() ?? latestParamsRef.current;
    let lastSyncedLayers = readLayers();
    syncState(readState(), lastSyncedParams, lastSyncedLayers);

    const renderLoop = (now: number) => {
      rafId = requestAnimationFrame(renderLoop);
      if (morph) {
        const target = morphPropsRef.current.morphTarget;
        const command = storyCameraCommandRef?.current;
        const wasEnabled = controls.enabled;
        let authored = false;
        if (command && command.modelId === plugin.meta.id &&
            target === (command.view.morphT === 1 ? 1 : 0)) {
          if (morph.getMorphT() === 0 && !morph.isAnimating) {
            morph.syncFromOrbitPosition(camera.position, controls.target, camera.fov);
          }
          if(isBoundedStage||isTokamak3d)b1AutoFit=false;
          morph.startKeyframe(command.view, now, command.durationMs);
          if (storyCameraCommandRef) storyCameraCommandRef.current = null;
          lastMorphTarget = target;
          flatNotified = false;
          authored = true;
          dirty = true;
        } else if (target !== lastMorphTarget) {
          if (target === 1 && morph.getMorphT() === 0 && !morph.isAnimating) {
            morph.syncFromOrbitPosition(camera.position, controls.target, camera.fov);
          }
          morph.startMorphTo(target, now);
          lastMorphTarget = target;
          flatNotified = false;
          dirty = true;
        }
        if (morph.update(now)) dirty = true;
        controls.enabled = morph.getMorphT() === 0 && !morph.isAnimating;
        if (controls.enabled) {
          if (!wasEnabled || authored) controls.target.copy(morph.getOrbitTarget());
          controls.update();
        }
        const progress = morph.getMorphT();
        container.dataset.morphT = String(progress);
        morphPropsRef.current.onMorphProgress?.(progress);
      } else {
        controls.update();
      }

      const b1Policy=b1PolicyRef.current;
      if(isBoundedStage||isTokamak3d){
        if(b1Policy.nonce!==b1LastPolicy.nonce){b1AutoFit=true;b1FramingKey='';b1FramedAt=-Infinity;dirty=true;}
        if(b1Policy.allowed!==b1LastPolicy.allowed||b1Policy.presentation!==b1LastPolicy.presentation||b1Policy.scopeCollapsed!==b1LastPolicy.scopeCollapsed)dirty=true;
        b1LastPolicy=b1Policy;
      }
      const latestState = readState();
      const frameParams = getFrameParams?.() ?? latestParamsRef.current;
      const frameLayers = readLayers();
      const changed=latestState!==null&&latestState!==undefined&&(latestState!==lastSyncedState||frameParams!==lastSyncedParams||frameLayers!==lastSyncedLayers);
      const syncLatest=()=>{
        syncState(latestState,frameParams,frameLayers);
        lastSyncedState=latestState;lastSyncedParams=frameParams;lastSyncedLayers=frameLayers;
      };
      // B1's tube buffers are computed for a rendered frame, not every rAF
      // callback that the adaptive frame guard is about to discard.
      if(changed&&!isBoundedStage&&!isTokamak3d)syncLatest();
      if(changed&&(isBoundedStage||isTokamak3d))dirty=true;
      if (contextLost || !dirty || now - lastRenderTime < performanceGuard.interval) return;

      const renderStart = performance.now();
      if(changed&&(isBoundedStage||isTokamak3d))syncLatest();
      const b1=isBoundedStage&&latestState!==null&&latestState!==undefined?latestState as BoundedMagneticState:null;
      const bp=frameParams as BoundedMagneticParams;
      const rw=renderer.domElement.clientWidth||width,rh=renderer.domElement.clientHeight||height;
      if(b1&&morph&&morph.getMorphT()===0&&!morph.isAnimating){
        const key=JSON.stringify([bp.mode,bp.fieldScale,rw,rh,b1Policy.presentation,b1Policy.scopeCollapsed]);
        const fresh=key!==b1FramingKey;
        if(fresh){b1FramingKey=key;}
        if(b1AutoFit&&b1Policy.allowed&&(fresh||now-b1FramedAt>=250)){
          b1FramedAt=now;
          const bounds=b1FrameBounds(b1,bp,frameLayers),safe=b1SafeRect(rw,rh,b1Policy.presentation,!b1Policy.scopeCollapsed);
          if(fresh||!b1ProjectionFits(bounds,camera,rw,rh,safe)){
            morph.syncFromOrbitPosition(camera.position,controls.target,camera.fov);
            fitB1SpatialFrame(morph,bounds,rw,rh,safe);
            controls.target.copy(morph.getOrbitTarget());controls.update();
          }
        }
      }
      const fusion=isTokamak3d&&latestState!==null&&latestState!==undefined?latestState as TokamakMirrorState:null;
      const fp=frameParams as TokamakMirrorParams;
      const fusionPoints=fusion?fusionFramePoints(fusion,fp,frameLayers):null;
      if(fusionPoints&&morph&&morph.getMorphT()===0&&!morph.isAnimating){
        const key=JSON.stringify([fusionGeometryKey(fp),rw,rh,b1Policy.presentation,b1Policy.scopeCollapsed,[...frameLayers]]);
        const fresh=key!==b1FramingKey;
        if(fresh)b1FramingKey=key;
        if(b1AutoFit&&b1Policy.allowed){
          const safe=fusionSafeRect(rw,rh,b1Policy.presentation,!b1Policy.scopeCollapsed);
          // Check every actual rendered frame; a final paused frame cannot
          // be left outside merely because the previous fit was <250 ms ago.
          if(fresh||!fusionScreenFits(projectFusionFrame(fusionPoints,camera,rw,rh),safe)){
            morph.syncFromOrbitPosition(camera.position,controls.target,camera.fov);
            fitFusionSpatialFrame(morph,fusionPoints,rw,rh,safe);
            controls.target.copy(morph.getOrbitTarget());controls.update();
          }
        }
      }
      if (isMag3d || isDeviceStage) {
        separateWorldLabels(renderer.domElement.clientWidth || width, renderer.domElement.clientHeight || height);
      }
      const renderCamera = morph?.getActiveCamera() ?? camera;
      if (magneticAxisWidget) updateMagneticAxisWidget(magneticAxisWidget,renderCamera,isBoundedStage,isTokamak3d?(frameParams as TokamakMirrorParams).mode:undefined);
      renderer.render(scene, renderCamera);
      cssRenderer.render(scene, renderCamera);
      if(isOrbitStage&&latestState){
        const trail=scene.getObjectByName('engine-trail');
        const actual=trail instanceof THREE.Line?trail.geometry.drawRange.count:0;
        container.dataset.m10Rendered=JSON.stringify({...orbitRenderSnapshot(latestState as AstroOrbitalState,frameParams as AstroOrbitalParams,frameLayers),actualTrailVertices:actual});
      }
      if(isTokamak3d&&latestState){
        const f=latestState as TokamakMirrorState,p=frameParams as TokamakMirrorParams;
        container.dataset.s01Rendered=JSON.stringify({t:f.t,position:f.position,velocity:f.velocity,bField:f.bField,escaped:f.escaped,reflectionCount:f.reflectionCount,escapeEvent:f.escapeEvent,lastReflection:f.lastReflection,trailLength:f.trail.length,muDev:f.maxMuRelDev,vParallel:fusionParallelVelocity(f.velocity,f.bField),mode:p.mode});
        container.dataset.s01VelocityVectors=String(frameLayers.has('velocityComponents'));
        if(fusionPoints)container.dataset.s01ScreenBounds=JSON.stringify(projectFusionFrame(fusionPoints,renderCamera,rw,rh));
        container.dataset.s01AutoFit=String(b1AutoFit&&b1Policy.allowed);
      }
      if(b1){
        // Diagnostics and visible caption refer to the state just rendered.
        // No React state is updated at animation frequency.
        container.dataset.b1RenderTime=String(b1.t);
        container.dataset.b1RenderPrimary=JSON.stringify(b1.particles[0]?.state??null);
        container.dataset.b1RenderExits=JSON.stringify(b1.particles.flatMap(t=>t.exitPoint?[t.exitPoint]:[]));
        container.dataset.b1RenderMode=bp.mode;
        container.dataset.b1RenderCount=String(++b1RenderCount);
        container.dataset.b1AutoFit=String(b1AutoFit&&b1Policy.allowed);
        const b=b1FrameBounds(b1,bp,frameLayers);
        container.dataset.b1ScreenBounds=JSON.stringify(b1ProjectedBounds(b,renderCamera,rw,rh));
      }
      if (morph && morphPropsRef.current.morphTarget === 1 && morph.getMorphT() === 1 && !morph.isAnimating && !flatNotified) {
        flatNotified = true;
        morphPropsRef.current.onMorphFlat?.(alignedCanvasViewport(morph.get2DAlignMetrics(), Math.min(window.devicePixelRatio || 1, 2)),(isBoundedStage||isTokamak3d)?b1AutoFit:undefined);
      }
      const renderDuration = performance.now() - renderStart;
      performanceGuard.observe(renderDuration);
      lastRenderTime = now;
      dirty = false;
    };
    lastSyncedState = readState();
    rafId = requestAnimationFrame(renderLoop);

    return () => {
      resizeObserver.disconnect();
      bridgeRef.current?.dispose();
      bridgeRef.current = null;
    };
  }, [plugin]);

  useEffect(() => {
    if (plugin.mountThreeScene && simState !== null && simState !== undefined) bridgeRef.current?.sync(simState, params, activeLayers);
  }, [plugin, simState, params, activeLayers]);

  const magnetic3dState = plugin.meta.id === 'em-3d-magnetic-fields'
    && simState !== null
    && typeof simState === 'object'
    ? simState as Magnetic3dState
    : null;
  const b1State=plugin.meta.id==='builder-composite-em-field'?simState as BoundedMagneticState|null:null;
  const b1Params=params as BoundedMagneticParams;
  const b1Primary=b1State?.particles[0];
  const deviceState=plugin.meta.id==='stse-em-devices-suite'?simState as EmDevicesState|null:null;
  const deviceFlight=deviceState?.flight;
  const cyclotron=deviceState?.cyclotron;
  const speed = magnetic3dState
    ? Math.hypot(magnetic3dState.velocity.x, magnetic3dState.velocity.y, magnetic3dState.velocity.z)
    : undefined;
  const forceMagnitude = magnetic3dState
    ? Math.hypot(
        magnetic3dState.lorentzForce.x,
        magnetic3dState.lorentzForce.y,
        magnetic3dState.lorentzForce.z
      )
    : undefined;
  const vectorsVisible = Boolean(magnetic3dState && activeLayers.has('handednessTriad'));
  const particleRadius = magnetic3dState && params.geometryType === 'finite-solenoid'
    ? 0.055 * Math.max(0.2, typeof params.radiusR === 'number' ? params.radiusR : 1)
    : undefined;

  const fusionState=plugin.meta.id==='stse-tokamak-magnetic-mirror'?simState as TokamakMirrorState|null:null;
  const fusionParams=params as TokamakMirrorParams;
  const lossCone = plugin.meta.id === 'stse-tokamak-magnetic-mirror' && params.mode === 'magnetic-mirror'
    ? computeMirrorLossConeDeg(params as TokamakMirrorParams) : undefined;
  const coneRadius = 23;
  const coneX = lossCone === undefined ? 0 : coneRadius * Math.cos(lossCone * Math.PI / 180);
  const coneY = lossCone === undefined ? 0 : coneRadius * Math.sin(lossCone * Math.PI / 180);
  return (
    <div
      ref={containerRef}
      data-testid="three-stage-container"
      data-sim-time={magnetic3dState?.t}
      data-trail-points={magnetic3dState?.trail.length}
      data-speed={speed}
      data-lorentz-force-magnitude={forceMagnitude}
      data-velocity-arrow-visible={vectorsVisible && (speed ?? 0) > 1e-10}
      data-force-arrow-visible={vectorsVisible && (forceMagnitude ?? 0) > 1e-10}
      data-particle-radius={particleRadius}
      data-beam-status={deviceFlight?.status}
      data-beam-physical-time={deviceFlight?.physicalTimeS}
      data-beam-x={deviceFlight?.position.x}
      data-beam-y={deviceFlight?.position.y}
      data-cyclotron-status={cyclotron?.status}
      data-cyclotron-gaps={cyclotron?.gapCount}
      data-cyclotron-energy={cyclotron?.energyJ}
      data-cyclotron-phase={cyclotron?.phaseSlip}
      data-cyclotron-time={cyclotron?.physicalTimeS}
      data-cyclotron-radius={cyclotron?.radiusM}
      data-cyclotron-rf={cyclotron?.rfVoltageV}
      data-b1-time={b1State?.t}
      data-b1-primary={b1Primary?JSON.stringify(b1Primary.state):undefined}
      data-b1-exits={b1State?JSON.stringify(b1State.particles.flatMap(t=>t.exitPoint?[t.exitPoint]:[])):undefined}
      data-sensor-drift={deviceState&&isSensorDevice((params as EmDevicesParams).device)?deviceState.particleVel.x:undefined}
      data-hall-voltage={deviceState?.hallVoltageV}
      data-mhd-emf={deviceState?.mhdEmfV}
      data-mhd-terminal={deviceState?.mhdTerminalVoltageV}
      data-mhd-current={deviceState?.mhdLoadCurrentA}
      data-flow-voltage={deviceState?.flowVoltageV}
      data-flow-rate={deviceState?.flowRateM3ps}
      className="relative w-full h-full min-h-[260px] rounded-xl overflow-hidden"
    >
      {b1State&&<div data-testid="b1-field-caption" className={`pointer-events-none absolute ${presentationMode?'bottom-3':'bottom-[78px]'} left-3 z-10 max-w-[38%] rounded-lg border border-white/10 bg-slate-950/80 px-2 py-1 text-[11px] text-slate-200`}><div>{b1FieldCaption(b1Params)}</div><div>{b1StateCaption(b1State,b1Params)}</div>{b1Params.mode==='crossed-eb'&&b1Params.charge!==0&&b1Params.magneticFieldZ!==0&&activeLayers.has('speedDecomposition')&&<div><span className="text-emerald-300">v</span> = <span className="text-amber-300">v_d</span> + <span className="text-pink-300">v_rot</span></div>}</div>}
      {lossCone !== undefined && <div data-testid="mirror-loss-cone" className={`pointer-events-none absolute ${presentationMode?'bottom-3':'bottom-[78px]'} left-3 z-10 rounded-lg border border-white/10 bg-slate-950/85 px-3 py-2 text-[11px] text-slate-200`}>
        <div>中心速度空间 · θc≈{lossCone.toFixed(1)}°</div>
        <svg viewBox="0 0 104 60" width="104" height="60" aria-label="速度空间示意">
          <path d={`M52 30 L${52 + coneX} ${30 - coneY} L${52 + coneX} ${30 + coneY} Z M52 30 L${52 - coneX} ${30 - coneY} L${52 - coneX} ${30 + coneY} Z`} fill="#fbbf2455" stroke="#fbbf24" />
          <path d="M5 30 H99 M52 5 V55" stroke="#94a3b8" strokeWidth="1" />
          <path d={`M52 30 L${52+coneRadius*Math.cos(fusionParams.pitchAngleDeg*Math.PI/180)} ${30-coneRadius*Math.sin(fusionParams.pitchAngleDeg*Math.PI/180)}`} stroke="#4ade80" strokeWidth="2" />
          <text x="76" y="15" fontSize="8" fill="#86efac">θ₀</text><text x="85" y="42" fontSize="8" fill="#cbd5e1">v∥</text>
        </svg>
        <div>{fusionState?fusionStatus(fusionState,fusionParams):''}</div>
        {activeLayers.has('velocityComponents')&&<div><span className="text-amber-300">v</span> = <span className="text-sky-300">v∥</span> + <span className="text-pink-300">v⊥</span></div>}
      </div>}
      {fusionState&&fusionParams.mode==='tokamak'&&<div data-testid="s01-torus-status" className={`pointer-events-none absolute ${presentationMode?'bottom-3':'bottom-[78px]'} left-3 z-10 rounded-lg border border-white/10 bg-slate-950/85 px-3 py-2 text-[11px] text-slate-200`}><div>给定外场 · 单粒子教学模型</div><div>{fusionStatus(fusionState,fusionParams)}</div></div>}
      {plugin.meta.id === 'stse-em-devices-suite' && <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded bg-slate-950/80 p-2 text-[11px] text-slate-200">{deviceFlight?flightReadout(deviceFlight):cyclotron?cyclotronReadout(params as EmDevicesParams,cyclotron):deviceState&&isSensorDevice((params as EmDevicesParams).device)?sensorReadout(deviceState,params as EmDevicesParams)+' · 蓝色箭头 B 出剖面 · 稳态示意': '归一化原理示意 · 蓝色箭头 B 垂直剖面 · 定量值见公式区'}{cyclotron&&cyclotron.arcIndex>=8&&<div className="mt-1 text-amber-200/80">浅色：抽样历史圆弧 · 亮色：最近实际轨迹</div>}</div>}
      {plugin.meta.id === 'astro-orbital-mechanics' && <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded bg-slate-950/80 p-2 text-[11px] text-slate-200">轨道使用归一化长度 · 天体尺寸为示意{params.mode === 'binary-lagrange' && activeLayers.has('corotatingView') ? ' · 共转系不绘制无逐点时刻的历史轨迹' : params.mode === 'hohmann-transfer' ? ' · 橙色标记为引擎记录的点火' : ''}</div>}
      {vectorsVisible && (
        <div data-testid="three-vector-legend" className={`pointer-events-none absolute ${presentationMode ? 'bottom-3 left-3' : 'left-3 top-3'} z-10 flex items-center gap-3 rounded-lg border border-white/10 bg-slate-950/75 px-3 py-2 text-[11px] text-slate-200 shadow-lg backdrop-blur`}>
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-amber-300" />v 速度</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-rose-400" />aₗ 洛伦兹加速度</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-sky-400" />B 磁场</span>
          <span className="text-slate-400">方向示意 · 非比例</span>
        </div>
      )}
      <div aria-hidden="true" data-testid="three-axis-widget" className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-lg border border-white/10 bg-slate-950/70 p-1 shadow-lg backdrop-blur">
        {(plugin.meta.id === 'em-3d-magnetic-fields'||plugin.meta.id==='builder-composite-em-field'||plugin.meta.id==='stse-tokamak-magnetic-mirror') ? <svg data-magnetic-axis-widget="" viewBox="0 0 60 60" width="60" height="60" aria-label="实际物理坐标轴方向">
          <circle cx="30" cy="30" r="1.8" fill="#cbd5e1" />
          {magneticAxisColors.map(axis => <g key={axis.name} data-physical-axis={axis.name}>
            <line x1="30" y1="30" x2="30" y2="30" stroke={axis.color} strokeWidth="1.8" strokeLinecap="round" />
            <polygon fill={axis.color} />
            <text x="30" y="30" textAnchor="middle" fontSize="9" fill={axis.color} fontWeight="600">{axis.name}</text>
          </g>)}
        </svg> : <svg viewBox="0 0 44 38" width="44" height="38">
          <path d="M8 30 L34 30 M8 30 L8 6 M8 30 L25 13" fill="none" strokeWidth="2" strokeLinecap="round" />
          <path d="M34 30 L29 27 L29 33 Z" fill="#fb7185" />
          <path d="M8 6 L5 11 L11 11 Z" fill="#4ade80" />
          <path d="M25 13 L19 14 L23 19 Z" fill="#38bdf8" />
          <path d="M8 30 L34 30" stroke="#fb7185" strokeWidth="2" />
          <path d="M8 30 L8 6" stroke="#4ade80" strokeWidth="2" />
          <path d="M8 30 L25 13" stroke="#38bdf8" strokeWidth="2" />
          <text x="35" y="33" fill="#fb7185" fontSize="7">X</text>
          <text x="5" y="6" fill="#4ade80" fontSize="7">Y</text>
          <text x="26" y="12" fill="#38bdf8" fontSize="7">Z</text>
        </svg>}
      </div>
    </div>
  );
};
