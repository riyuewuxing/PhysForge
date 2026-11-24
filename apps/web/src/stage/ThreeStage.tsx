import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { getPixelsPerMeter, isSimulationPluginV3, type ParamRecord, type SimulationPluginV2, type ThreeSceneBridge, type Viewport } from '@physforge/sim-sdk';
import { CameraMorphController, alignedCanvasViewport, liftPoint } from './cameraMorphController.js';
import type { StorySpatialCommand } from '../presentation/storyCamera.js';
import { brushedCopperMaterial, magneticFluxMaterial, dielectricGlassMaterial } from './spatialMaterials.js';
import { createPlanarFlagshipScene } from './planarFlagshipScenes.js';
import { createRemainingFlagshipScene } from './remainingFlagshipScenes.js';
import { magnetic3dDisplayPoint } from '@physforge/simulations/em-3d-magnetic-fields';
import { fusionDisplayPoint } from '@physforge/simulations/stse-tokamak-magnetic-mirror';
import {
  buildConductorSegments,
  trace3dFieldLines,
  type Magnetic3dParams,
  type Magnetic3dState
} from '@physforge/simulations/em-3d-magnetic-fields/engine';
import {
  buildTokamakMirrorSegments,
  computeMirrorLossConeDeg,
  traceTokamakMirrorLines,
  type TokamakMirrorParams,
  type TokamakMirrorState
} from '@physforge/simulations/stse-tokamak-magnetic-mirror/engine';

interface ThreeStageProps {
  readonly plugin: SimulationPluginV2<ParamRecord, unknown>;
  readonly simState: unknown;
  readonly simStateRef?: React.RefObject<unknown>;
  readonly params: ParamRecord;
  readonly getFrameParams?: () => ParamRecord;
  readonly storyCameraCommandRef?: React.RefObject<StorySpatialCommand | null>;
  readonly activeLayers: ReadonlySet<string>;
  readonly presentationMode?: boolean;
  readonly morphTarget?: 0 | 1;
  readonly initialFlatViewport?: Viewport;
  readonly onMorphProgress?: (progress: number) => void;
  readonly onMorphFlat?: (viewport: Viewport) => void;
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
  arrow.setLength(length, Math.min(0.22, length * 0.32), Math.min(0.13, length * 0.2));
  return length;
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

function createRadialGrid(): THREE.Group {
  const grid = new THREE.Group();
  const xLimit = 7;
  const nearZ = -2;
  const farZ = 8;
  for (let index = 0; index <= 16; index++) {
    const z = nearZ + index * 0.625;
    const points = [
      new THREE.Vector3(-xLimit, -0.025, z),
      new THREE.Vector3(xLimit, -0.025, z)
    ];
    const material = new THREE.LineBasicMaterial({
      color: 0x64748b,
      transparent: true,
      opacity: 0.035 + 0.065 * Math.exp(-Math.abs(z) * 0.2)
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
      opacity: 0.075
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
  params,
  activeLayers,
  presentationMode = false,
  morphTarget = 0, initialFlatViewport, getFrameParams, storyCameraCommandRef, onMorphProgress, onMorphFlat, onWebGLFallback
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bridgeRef = useRef<ThreeSceneBridge<ParamRecord, unknown> | null>(null);
  const latestStateRef = useRef(simState);
  const latestParamsRef = useRef(params);
  const latestLayersRef = useRef(activeLayers);
  const morphPropsRef = useRef({ morphTarget, onMorphProgress, onMorphFlat, onWebGLFallback });
  morphPropsRef.current = { morphTarget, onMorphProgress, onMorphFlat, onWebGLFallback };
  const initialViewportRef = useRef(initialFlatViewport);
  latestStateRef.current = simState;
  latestParamsRef.current = params;
  latestLayersRef.current = activeLayers;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (plugin.mountThreeScene) {
      const bridge = plugin.mountThreeScene(container);
      bridgeRef.current = bridge;
      bridge.sync(simState, params, activeLayers);

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

    const width = Math.max(320, container.clientWidth);
    const height = Math.max(240, container.clientHeight);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b0f17');
    scene.fog = new THREE.FogExp2('#0b0f17', 0.085);

    const spatial = isSimulationPluginV3(plugin) ? plugin.spatial3D : undefined;
    const morph = spatial ? new CameraMorphController(spatial, width, height) : null;
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

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnvironment = new RoomEnvironment();
    const environmentTarget = pmremGenerator.fromScene(roomEnvironment, 0.04);
    scene.environment = environmentTarget.texture;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.copy(orbitTarget);
    if (!morph || !initialViewport) controls.update();
    else controls.enabled = false;

    const grid = createRadialGrid();
    const ambient = new THREE.HemisphereLight(0xc7e7ff, 0x101826, 1.05);
    const keyLight = new THREE.DirectionalLight(0xffe1b1, 3.1);
    keyLight.position.set(3.5, 5, 4);
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 2.2);
    rimLight.position.set(-4, 2, -3);
    scene.add(grid, ambient, keyLight, rimLight);
    const planarDriver = createPlanarFlagshipScene(plugin.meta.id, scene) ?? createRemainingFlagshipScene(plugin.meta.id, scene);
    if (planarDriver) grid.visible = false;

    const staticGroup = new THREE.Group();
    const trailGroup = new THREE.Group();
    scene.add(staticGroup, trailGroup);
    const fusionTrailGeometry = isTokamak3d ? new THREE.BufferGeometry() : null;
    const fusionTrailBuffer = fusionTrailGeometry ? new THREE.BufferAttribute(new Float32Array(261 * 3), 3).setUsage(THREE.DynamicDrawUsage) : null;
    if (fusionTrailGeometry && fusionTrailBuffer) {
      fusionTrailGeometry.setAttribute('position', fusionTrailBuffer);
      fusionTrailGeometry.setDrawRange(0, 0);
      const line = new THREE.Line(fusionTrailGeometry, new THREE.LineBasicMaterial({ color: 0x4ade80 }));
      line.frustumCulled = false; line.name = 'fusion-particle-trail'; trailGroup.add(line);
    }

    const sphereGeo = new THREE.SphereGeometry(1, 20, 20);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0x86efac,
      emissive: 0x16a34a,
      emissiveIntensity: 1.4,
      metalness: 0.2,
      roughness: 0.28
    });
    const marker = new THREE.Mesh(sphereGeo, sphereMat);
    scene.add(marker);
    if (planarDriver) marker.visible = false;

    const velocityArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.65, 0xfacc15, 0.2, 0.12);
    const lorentzForceArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.55, 0xfb7185, 0.18, 0.11);
    const magneticFieldArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.6, 0x38bdf8, 0.2, 0.12);
    velocityArrow.name = 'particle-velocity-vector';
    lorentzForceArrow.name = 'particle-lorentz-force-vector';
    magneticFieldArrow.name = 'particle-magnetic-field-vector';
    velocityArrow.visible = false;
    lorentzForceArrow.visible = false;
    magneticFieldArrow.visible = false;
    scene.add(velocityArrow, lorentzForceArrow, magneticFieldArrow);

    const velocityLabel = createWorldLabel('v', '#facc15');
    const forceLabel = createWorldLabel('a洛', '#fb7185');
    const fieldLabel = createWorldLabel('B', '#38bdf8');
    scene.add(velocityLabel, forceLabel, fieldLabel);

    const performanceGuard = new PerformanceGuard();
    let lastConfigSig = '';
    let lastTrailToken = '';
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

    const velocityLabelAnchor = new THREE.Vector3();
    const forceLabelAnchor = new THREE.Vector3();
    const fieldLabelAnchor = new THREE.Vector3();

    const separateWorldLabels = (viewportWidth: number, viewportHeight: number) => {
      const activeCamera = morph?.getActiveCamera() ?? camera;
      activeCamera.updateMatrixWorld();
      const activeLabels: Array<{ obj: CSS2DObject; anchor: THREE.Vector3; sx: number; sy: number; depth: number }> = [];
      const candidates: Array<{ obj: CSS2DObject; anchor: THREE.Vector3 }> = [
        { obj: velocityLabel, anchor: velocityLabelAnchor },
        { obj: forceLabel, anchor: forceLabelAnchor },
        { obj: fieldLabel, anchor: fieldLabelAnchor }
      ];
      for (const item of candidates) {
        if (!item.obj.visible) continue;
        const projected = item.anchor.clone().project(activeCamera);
        activeLabels.push({
          obj: item.obj,
          anchor: item.anchor,
          sx: (projected.x * 0.5 + 0.5) * viewportWidth,
          sy: (-projected.y * 0.5 + 0.5) * viewportHeight,
          depth: Math.max(0.5, item.anchor.distanceTo(activeCamera.position))
        });
      }
      if (activeLabels.length === 0) return;

      const baseX = activeLabels.map((item) => item.sx);
      const baseY = activeLabels.map((item) => item.sy);
      const minDx = 42;
      const minDy = 24;
      for (let iter = 0; iter < 8; iter++) {
        for (let i = 0; i < activeLabels.length; i++) {
          for (let j = i + 1; j < activeLabels.length; j++) {
            const a = activeLabels[i]!;
            const b = activeLabels[j]!;
            const dx = b.sx - a.sx;
            const dy = b.sy - a.sy;
            const gapX = minDx - Math.abs(dx);
            const gapY = minDy - Math.abs(dy);
            if (gapX > 0 && gapY > 0) {
              const dirX = Math.abs(dx) > 1 ? Math.sign(dx) : (i % 2 === 0 ? -1 : 1);
              const dirY = Math.abs(dy) > 1 ? Math.sign(dy) : -1;
              if (gapX < gapY) {
                a.sx -= dirX * (gapX * 0.55 + 2);
                b.sx += dirX * (gapX * 0.55 + 2);
              } else {
                a.sy -= dirY * (gapY * 0.55 + 2);
                b.sy += dirY * (gapY * 0.55 + 2);
              }
            }
          }
        }
      }

      const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(activeCamera.quaternion);
      const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(activeCamera.quaternion);
      const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
      for (let i = 0; i < activeLabels.length; i++) {
        const item = activeLabels[i]!;
        const worldPerPx = activeCamera instanceof THREE.OrthographicCamera
          ? (activeCamera.top - activeCamera.bottom) / Math.max(240, viewportHeight)
          : (2 * item.depth * tanHalfFov) / Math.max(240, viewportHeight);
        const shiftX = (item.sx - baseX[i]!) * worldPerPx;
        const shiftY = -(item.sy - baseY[i]!) * worldPerPx;
        item.obj.position
          .copy(item.anchor)
          .addScaledVector(cameraRight, shiftX)
          .addScaledVector(cameraUp, shiftY);
      }
    };

    const syncState = (
      state: unknown,
      curParams: ParamRecord,
      layers: ReadonlySet<string>
    ) => {
      if (!state) return;
      if (planarDriver) { planarDriver.sync(state, curParams, layers); dirty = true; return; }
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
          const particleRadius = magneticParams.geometryType === 'finite-solenoid'
            ? 0.055 * Math.max(0.2, magneticParams.radiusR)
            : 0.12;
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
          marker.scale.setScalar(0.055);
          const fusion = state as TokamakMirrorState;
          sphereMat.color.set(fusion.escaped ? 0xf87171 : 0x4ade80);
          sphereMat.emissive.set(fusion.escaped ? 0x7f1d1d : 0x14532d);
          if (fusionTrailGeometry && fusionTrailBuffer) {
            const count = Math.min(261, fusion.trail.length), start = fusion.trail.length - count;
            for (let i = 0; i < count; i++) { const p = project(fusion.trail[start + i]!); fusionTrailBuffer.setXYZ(i, p.x, p.y, p.z); }
            fusionTrailBuffer.needsUpdate = true; fusionTrailGeometry.setDrawRange(0, count);
          }
          velocityArrow.visible = false;
          lorentzForceArrow.visible = false;
          magneticFieldArrow.visible = false;
          velocityLabel.visible = false;
          forceLabel.visible = false;
          fieldLabel.visible = false;
        }

        const configSignature = JSON.stringify({
          model: plugin.meta.id,
          params: curParams,
          conductors: layers.has('conductors'),
          fieldLines: layers.has('fieldLines3d')
        });
        if (configSignature !== lastConfigSig) {
          lastConfigSig = configSignature;
          disposeGroupChildren(staticGroup);

          if (layers.has('conductors')) {
            const segments = isMag3d
              ? buildConductorSegments(curParams as Magnetic3dParams)
              : buildTokamakMirrorSegments(curParams as TokamakMirrorParams);
            if (segments.length > 0) {
              const magneticParams = curParams as Magnetic3dParams;
              const pointsPerConductor = isMag3d
                ? magneticParams.geometryType === 'single-loop' ? 96
                  : magneticParams.geometryType === 'helmholtz-coil' ? 72
                    : magneticParams.geometryType === 'finite-solenoid' ? 48
                      : magneticParams.geometryType === 'straight-wire' ? 24 : 0
                : fusionParams.mode === 'tokamak' ? 24 : 32;
              const segmentGroupSize = pointsPerConductor || segments.length;
              for (let start = 0; start < segments.length; start += segmentGroupSize) {
                const group = segments.slice(start, start + segmentGroupSize);
                if (group.length === 0) continue;
                const points = [group[0]!.a, ...group.map((segment) => segment.b)].map(
                  project
                );
                const closed = isTokamak3d || pointsPerConductor > 24;
                if (closed && points[0]!.distanceTo(points[points.length - 1]!) < 1e-8) points.pop();
                const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
                const tubeGeo = new THREE.TubeGeometry(curve, Math.max(64, group.length), 0.026, 10, closed);
                const conductorMat = brushedCopperMaterial();
                staticGroup.add(new THREE.Mesh(tubeGeo, conductorMat));
              }
            }
          }

          if (isTokamak3d && layers.has('conductors') && fusionParams.mode === 'tokamak') {
            const chamber = new THREE.Mesh(new THREE.TorusGeometry(fusionParams.majorRadiusM, 0.55, 24, 96), dielectricGlassMaterial());
            chamber.name = 'tokamak-vacuum-chamber';
            staticGroup.add(chamber);
          }
          if (layers.has('fieldLines3d')) {
            const lines = isMag3d
              ? trace3dFieldLines(curParams as Magnetic3dParams)
              : traceTokamakMirrorLines(curParams as TokamakMirrorParams);
            for (const line of lines) {
              if (line.length < 2) continue;
              const points = line.map(project);
              const closed = points[0]!.distanceTo(points[points.length - 1]!) < 0.06;
              const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
              const geometry = new THREE.TubeGeometry(curve, Math.max(32, points.length * 2), 0.012, 5, closed);
              const material = magneticFluxMaterial();
              staticGroup.add(new THREE.Mesh(geometry, material));
            }
          }
        }

        if (isMag3d) {
          const trail = (state as Magnetic3dState).trail;
          const lastPoint = trail[trail.length - 1];
          const trailToken = lastPoint
            ? `${trail.length}:${lastPoint.x.toPrecision(6)}:${lastPoint.y.toPrecision(6)}:${lastPoint.z.toPrecision(6)}`
            : 'empty';
          if (trailToken !== lastTrailToken) {
            lastTrailToken = trailToken;
            disposeGroupChildren(trailGroup);
            if (trail.length > 1) {
              const points = trail.map((point) => mapMagneticPoint(point));
              const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
              const geometry = new THREE.TubeGeometry(curve, Math.max(24, points.length), 0.012, 5, false);
              const material = magneticFluxMaterial(0x4ade80);
              trailGroup.add(new THREE.Mesh(geometry, material));
            }
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
        planarDriver?.dispose();
        disposeGroupChildren(staticGroup);
        disposeGroupChildren(trailGroup);
        scene.remove(velocityArrow, lorentzForceArrow, magneticFieldArrow, marker, velocityLabel, forceLabel, fieldLabel);
        disposeObjectResources(velocityArrow);
        disposeObjectResources(lorentzForceArrow);
        disposeObjectResources(magneticFieldArrow);
        sphereGeo.dispose();
        sphereMat.dispose();
        disposeObjectResources(grid);
        environmentTarget.dispose();
        pmremGenerator.dispose();
        disposeObjectResources(roomEnvironment);
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
    let lastSyncedLayers = latestLayersRef.current;
    syncState(simStateRef?.current ?? latestStateRef.current, lastSyncedParams, lastSyncedLayers);

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

      const latestState = simStateRef?.current ?? latestStateRef.current;
      const frameParams = getFrameParams?.() ?? latestParamsRef.current;
      const frameLayers = latestLayersRef.current;
      if (latestState && (latestState !== lastSyncedState || frameParams !== lastSyncedParams || frameLayers !== lastSyncedLayers)) {
        syncState(latestState, frameParams, frameLayers);
        lastSyncedState = latestState;
        lastSyncedParams = frameParams;
        lastSyncedLayers = frameLayers;
      }

      if (contextLost || !dirty || now - lastRenderTime < performanceGuard.interval) {
        return;
      }

      const renderStart = performance.now();
      if (isMag3d) {
        separateWorldLabels(renderer.domElement.clientWidth || width, renderer.domElement.clientHeight || height);
      }
      const renderCamera = morph?.getActiveCamera() ?? camera;
      renderer.render(scene, renderCamera);
      cssRenderer.render(scene, renderCamera);
      if (morph && morphPropsRef.current.morphTarget === 1 && morph.getMorphT() === 1 && !morph.isAnimating && !flatNotified) {
        flatNotified = true;
        morphPropsRef.current.onMorphFlat?.(alignedCanvasViewport(morph.get2DAlignMetrics(), Math.min(window.devicePixelRatio || 1, 2)));
      }
      const renderDuration = performance.now() - renderStart;
      performanceGuard.observe(renderDuration);
      lastRenderTime = now;
      dirty = false;
    };
    lastSyncedState = simStateRef?.current ?? latestStateRef.current;
    rafId = requestAnimationFrame(renderLoop);

    return () => {
      resizeObserver.disconnect();
      bridgeRef.current?.dispose();
      bridgeRef.current = null;
    };
  }, [plugin]);

  useEffect(() => {
    if (plugin.mountThreeScene) bridgeRef.current?.sync(simState, params, activeLayers);
  }, [plugin, simState, params, activeLayers]);

  const magnetic3dState = plugin.meta.id === 'em-3d-magnetic-fields'
    && simState !== null
    && typeof simState === 'object'
    ? simState as Magnetic3dState
    : null;
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
      className="relative w-full h-full min-h-[260px] rounded-xl overflow-hidden"
    >
      {lossCone !== undefined && <div data-testid="mirror-loss-cone" className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-lg border border-white/10 bg-slate-950/80 px-2 py-1 text-[11px] text-slate-200">
        <div>速度空间逃逸锥 θc={lossCone.toFixed(1)}°</div>
        <svg viewBox="0 0 104 60" width="104" height="60" aria-label="速度空间示意">
          <path d={`M52 30 L${52 + coneX} ${30 - coneY} L${52 + coneX} ${30 + coneY} Z M52 30 L${52 - coneX} ${30 - coneY} L${52 - coneX} ${30 + coneY} Z`} fill="#fbbf2455" stroke="#fbbf24" />
          <path d="M5 30 H99 M52 5 V55" stroke="#94a3b8" strokeWidth="1" />
        </svg>
      </div>}
      {plugin.meta.id === 'stse-em-devices-suite' && <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded bg-slate-950/80 p-2 text-[11px] text-slate-200">归一化原理示意 · 能量由物理内核计算</div>}
      {plugin.meta.id === 'astro-orbital-mechanics' && <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded bg-slate-950/80 p-2 text-[11px] text-slate-200">轨道使用 r/r₁ · 天体球体尺寸为示意</div>}
      {vectorsVisible && (
        <div data-testid="three-vector-legend" className={`pointer-events-none absolute ${presentationMode ? 'bottom-3 left-3' : 'left-3 top-3'} z-10 flex items-center gap-3 rounded-lg border border-white/10 bg-slate-950/75 px-3 py-2 text-[11px] text-slate-200 shadow-lg backdrop-blur`}>
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-amber-300" />v 速度</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-rose-400" />aₗ 洛伦兹加速度</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-sky-400" />B 磁场</span>
        </div>
      )}
      <div aria-hidden="true" data-testid="three-axis-widget" className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-lg border border-white/10 bg-slate-950/70 p-1 shadow-lg backdrop-blur">
        <svg viewBox="0 0 44 38" width="44" height="38">
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
        </svg>
      </div>
    </div>
  );
};
