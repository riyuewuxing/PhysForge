import type {
  DiagramIR,
  DiagramPrimitive,
  ParamRecord,
  SimulationPlugin,
  SimulationPluginV2
} from '@physforge/sim-sdk';

export * from './svgRenderer.js';
export * from './tikzRenderer.js';
export * from './pngRenderer.js';
export * from './mediaRecorder.js';

/**
 * 获取当前插件的 DiagramIR；若该插件尚未自定义 exportDiagramIR，则基于其可观测物理量与受力矢量生成标准黑白试卷框架图
 */
export function resolvePluginDiagramIR(
  plugin: SimulationPlugin<ParamRecord, unknown>,
  state: unknown,
  params: ParamRecord
): DiagramIR {
  const v2 = plugin as SimulationPluginV2<ParamRecord, unknown>;
  if (v2.exportDiagramIR) {
    return v2.exportDiagramIR(state, params, {
      monochrome: true,
      showForceLabels: true,
      showTrajectory: true,
      showVelocityVectors: true
    });
  }

  const primitives: DiagramPrimitive[] = [
    { kind: 'line', x1: -4, y1: 0, x2: 4, y2: 0, dashed: true },
    { kind: 'line', x1: 0, y1: -2.5, x2: 0, y2: 2.5, dashed: true },
    { kind: 'mathLabel', x: 3.7, y: -0.25, text: 'x / m', align: 'end' },
    { kind: 'mathLabel', x: 0.2, y: 2.25, text: 'y / m', align: 'start' }
  ];

  const obs = plugin.engine.computeObservables(state, params);
  if (typeof obs['x'] === 'number' && typeof obs['y'] === 'number') {
    primitives.push({ kind: 'circle', cx: obs['x'], cy: obs['y'], r: 0.16, fill: true });
  }
  if (v2.getForceVectors) {
    for (const fv of v2.getForceVectors(state, params)) {
      const mag = Math.hypot(fv.force.x, fv.force.y);
      if (mag < 1e-6) continue;
      const scale = 1.2 / mag;
      primitives.push({
        kind: 'arrow',
        x1: fv.origin.x,
        y1: fv.origin.y,
        x2: fv.origin.x + fv.force.x * scale,
        y2: fv.origin.y + fv.force.y * scale,
        label: fv.label
      });
    }
  }

  return {
    width: 720,
    height: 460,
    viewBox: { minX: -4.5, minY: -2.8, maxX: 4.5, maxY: 2.8 },
    title: plugin.meta.title,
    primitives
  };
}
