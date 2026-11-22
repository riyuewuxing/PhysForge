import { describe, expect, it } from 'vitest';
import {
  defineSimulationPlugin,
  isSimulationPluginV2,
  resolvePluginParams,
  type SimulationPluginV2
} from './index.js';

interface TestParams {
  mass: number;
  mode: 'a' | 'b';
  showTrail: boolean;
  [key: string]: number | boolean | string;
}

interface TestState {
  t: number;
  x: number;
}

describe('sim-sdk V2 contract', () => {
  it('supports V2 capabilities while remaining backward compatible with V1 plugins', () => {
    const v1Plugin = defineSimulationPlugin<TestParams, TestState>({
      meta: {
        id: 'test-v1',
        title: 'Test V1',
        textbookRef: '必修一',
        curriculumTags: ['物理观念'],
        difficulty: '基础新授',
        version: '1.0.0'
      },
      paramSchema: [
        { key: 'mass', kind: 'number', label: 'Mass', min: 1, max: 10, step: 0.5, defaultValue: 2 },
        {
          key: 'mode',
          kind: 'select',
          label: 'Mode',
          options: [
            { label: 'A', value: 'a' },
            { label: 'B', value: 'b' }
          ],
          defaultValue: 'a'
        },
        { key: 'showTrail', kind: 'boolean', label: 'Trail', defaultValue: true }
      ],
      presets: [{ id: 'p1', name: 'Default', description: 'desc', params: { mass: 3 } }],
      engine: {
        createInitialState: () => ({ t: 0, x: 0 }),
        step: (s, _p, dt) => ({ nextState: { t: s.t + dt, x: s.x + dt }, events: [] }),
        computeObservables: (s) => ({ x: s.x })
      },
      layers: [{ id: 'main', label: 'Main', defaultVisible: true }],
      telemetryChannels: [{ key: 'x', label: 'x', unit: 'm', color: '#38bdf8' }],
      renderCanvas: () => {}
    });

    expect(isSimulationPluginV2(v1Plugin)).toBe(false);
    expect(resolvePluginParams(v1Plugin.paramSchema, { mass: 99 })).toEqual({
      mass: 10,
      mode: 'a',
      showTrail: true
    });

    const v2Plugin: SimulationPluginV2<TestParams, TestState> = defineSimulationPlugin({
      ...v1Plugin,
      renderMode: 'hybrid',
      getControlHandles: (state) => [
        {
          id: 'pos',
          label: '位置',
          position: { x: state.x, y: 0 },
          handleKind: 'point',
          onDrag: (pos) => ({ mass: Math.max(1, Math.min(10, Math.round(pos.x))) })
        }
      ],
      getForceVectors: () => [
        {
          id: 'weight',
          label: 'mg',
          origin: { x: 0, y: 0 },
          force: { x: 0, y: -19.6 },
          category: 'gravity'
        }
      ],
      referenceFrames: [
        {
          id: 'ground',
          label: '地面系',
          getOrigin: () => ({ x: 0, y: 0 })
        }
      ],
      exportDiagramIR: () => ({
        width: 800,
        height: 500,
        viewBox: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
        title: 'Test',
        primitives: [{ kind: 'circle', cx: 0, cy: 0, r: 1 }]
      })
    });

    expect(isSimulationPluginV2(v2Plugin)).toBe(true);
    expect(v2Plugin.getControlHandles?.({ t: 0, x: 4 }, resolvePluginParams(v2Plugin.paramSchema))).toHaveLength(1);
    expect(v2Plugin.exportDiagramIR?.({ t: 0, x: 0 }, resolvePluginParams(v2Plugin.paramSchema)).primitives).toHaveLength(1);
  });
});
