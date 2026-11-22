import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ParamRecord, SimulationPluginV2, ThreeSceneBridge } from '@physforge/sim-sdk';

interface ThreeStageProps {
  readonly plugin: SimulationPluginV2<ParamRecord, unknown>;
  readonly simState: unknown;
  readonly params: ParamRecord;
  readonly activeLayers: ReadonlySet<string>;
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

    // Fallback generic 3D reference grid + axes when a plugin switches to 3D inspection before adding custom 3D mesh
    const width = Math.max(320, container.clientWidth);
    const height = Math.max(240, container.clientHeight);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#091220');

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 200);
    camera.position.set(4, 3.2, 5.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const grid = new THREE.GridHelper(10, 20, 0x38bdf8, 0x1e293b);
    const axes = new THREE.AxesHelper(2.2);
    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(grid, axes, ambient);

    const sphereGeo = new THREE.SphereGeometry(0.18, 24, 24);
    const sphereMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x075985 });
    const marker = new THREE.Mesh(sphereGeo, sphereMat);
    scene.add(marker);

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

    bridgeRef.current = {
      sync: (state) => {
        const s = state as { x?: number; y?: number; z?: number; x1?: number } | null;
        if (!s) return;
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
        controls.dispose();
        sphereGeo.dispose();
        sphereMat.dispose();
        grid.dispose();
        axes.dispose();
        renderer.dispose();
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
