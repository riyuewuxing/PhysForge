import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ParamRecord, SimulationPluginV2, ThreeSceneBridge } from '@physforge/sim-sdk';
import {
  buildConductorSegments,
  trace3dFieldLines,
  type Magnetic3dParams,
  type Magnetic3dState
} from '@physforge/simulations/em-3d-magnetic-fields/engine';
import {
  buildTokamakMirrorSegments,
  traceTokamakMirrorLines,
  type TokamakMirrorParams,
  type TokamakMirrorState
} from '@physforge/simulations/stse-tokamak-magnetic-mirror/engine';

interface ThreeStageProps {
  readonly plugin: SimulationPluginV2<ParamRecord, unknown>;
  readonly simState: unknown;
  readonly params: ParamRecord;
  readonly activeLayers: ReadonlySet<string>;
}

function disposeGroupChildren(group: THREE.Group): void {
  while (group.children.length > 0) {
    const child = group.children[0]!;
    group.remove(child);
    if (
      child instanceof THREE.Mesh ||
      child instanceof THREE.Line ||
      child instanceof THREE.LineSegments
    ) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  }
}

/**
 * 纯 Vanilla Three.js + OrbitControls 命令式懒加载 3D 舞台（严禁依赖 R3F，卸载时严格 dispose 显存）
 */
export const ThreeStage: React.FC<ThreeStageProps> = ({
  plugin,
  simState,
  params,
  activeLayers
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bridgeRef = useRef<ThreeSceneBridge<ParamRecord, unknown> | null>(null);

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

    const width = Math.max(320, container.clientWidth);
    const height = Math.max(240, container.clientHeight);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#091220');

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 200);
    camera.position.set(3.4, 2.5, 4.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const grid = new THREE.GridHelper(10, 20, 0x38bdf8, 0x1e293b);
    const axes = new THREE.AxesHelper(2.2);
    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(grid, axes, ambient);

    const dynamicGroup = new THREE.Group();
    scene.add(dynamicGroup);

    const sphereGeo = new THREE.SphereGeometry(0.12, 20, 20);
    const sphereMat = new THREE.MeshStandardMaterial({ color: 0x4ade80, emissive: 0x166534 });
    const marker = new THREE.Mesh(sphereGeo, sphereMat);
    scene.add(marker);

    let lastConfigSig = '';
    let rafId = 0;
    const renderLoop = () => {
      rafId = requestAnimationFrame(renderLoop);
      controls.update();
      renderer.render(scene, camera);
    };
    renderLoop();

    const ro = new ResizeObserver(() => {
      if (!containerRef.current) return;
      const w = Math.max(320, containerRef.current.clientWidth);
      const h = Math.max(240, containerRef.current.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    const isMag3d = plugin.meta.id === 'em-3d-magnetic-fields';
    const isTokamak3d = plugin.meta.id === 'stse-tokamak-magnetic-mirror';

    bridgeRef.current = {
      sync: (state, curParams, layers) => {
        if (!state) return;
        if (isMag3d || isTokamak3d) {
          const magState = state as Magnetic3dState | TokamakMirrorState;
          marker.position.set(magState.position.x, magState.position.z, magState.position.y);

          const sig = isMag3d
            ? `${(curParams as Magnetic3dParams).geometryType}:${(curParams as Magnetic3dParams).radiusR}:${(curParams as Magnetic3dParams).solenoidTurns}:${(curParams as Magnetic3dParams).currentI}:${layers.has('conductors')}:${layers.has('fieldLines3d')}:${magState.trail.length}`
            : `tok:${(curParams as TokamakMirrorParams).mode}:${(curParams as TokamakMirrorParams).b0Tesla}:${(curParams as TokamakMirrorParams).coilHalfSpanM}:${(curParams as TokamakMirrorParams).majorRadiusM}:${layers.has('conductors')}:${layers.has('fieldLines3d')}:${magState.trail.length}`;
          if (sig !== lastConfigSig) {
            lastConfigSig = sig;
            disposeGroupChildren(dynamicGroup);

            if (layers.has('conductors')) {
              const segs = isMag3d
                ? buildConductorSegments(curParams as Magnetic3dParams)
                : buildTokamakMirrorSegments(curParams as TokamakMirrorParams);
              if (segs.length > 0) {
                const posArr = new Float32Array(segs.length * 6);
                segs.forEach((s, idx) => {
                  posArr[idx * 6] = s.a.x;
                  posArr[idx * 6 + 1] = s.a.z;
                  posArr[idx * 6 + 2] = s.a.y;
                  posArr[idx * 6 + 3] = s.b.x;
                  posArr[idx * 6 + 4] = s.b.z;
                  posArr[idx * 6 + 5] = s.b.y;
                });
                const wireGeo = new THREE.BufferGeometry();
                wireGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
                const wireMat = new THREE.LineBasicMaterial({ color: 0xf59e0b });
                dynamicGroup.add(new THREE.LineSegments(wireGeo, wireMat));
              }
            }

            if (layers.has('fieldLines3d')) {
              const lines = isMag3d
                ? trace3dFieldLines(curParams as Magnetic3dParams)
                : traceTokamakMirrorLines(curParams as TokamakMirrorParams);
              for (const line of lines) {
                if (line.length < 2) continue;
                const pts = line.map((p) => new THREE.Vector3(p.x, p.z, p.y));
                const lGeo = new THREE.BufferGeometry().setFromPoints(pts);
                const lMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.72 });
                dynamicGroup.add(new THREE.Line(lGeo, lMat));
              }
            }

            if (magState.trail.length > 1) {
              const tPts = magState.trail.map((p) => new THREE.Vector3(p.x, p.z, p.y));
              const tGeo = new THREE.BufferGeometry().setFromPoints(tPts);
              const tMat = new THREE.LineBasicMaterial({ color: 0x4ade80 });
              dynamicGroup.add(new THREE.Line(tGeo, tMat));
            }
          }
          return;
        }

        const s = state as { x?: number; y?: number; z?: number; x1?: number };
        marker.position.set(s.x ?? s.x1 ?? 0, s.y ?? 0, s.z ?? 0);
      },
      resize: (w, h) => {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      },
      dispose: () => {
        cancelAnimationFrame(rafId);
        ro.disconnect();
        disposeGroupChildren(dynamicGroup);
        controls.dispose();
        sphereGeo.dispose();
        sphereMat.dispose();
        grid.dispose();
        axes.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        if (renderer.domElement.parentNode === container) {
          container.removeChild(renderer.domElement);
        }
      }
    };

    return () => {
      bridgeRef.current?.dispose();
      bridgeRef.current = null;
    };
  }, [plugin]);

  useEffect(() => {
    bridgeRef.current?.sync(simState, params, activeLayers);
  }, [simState, params, activeLayers]);

  return (
    <div
      ref={containerRef}
      data-testid="three-stage-container"
      className="w-full h-full min-h-[260px] rounded-xl overflow-hidden"
    />
  );
};
