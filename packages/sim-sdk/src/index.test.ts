import { describe, expect, it } from 'vitest';
import {
  defineSimulationPlugin,
  resolvePluginParams,
  type ParamFieldSpec,
  type SimulationPlugin
} from './index.js';

type DemoParams = {
  mass: number;
  showVector: boolean;
  mode: 'ideal' | 'damped';
};

interface DemoState {
  t: number;
  x: number;
  v: number;
}

const schema: readonly ParamFieldSpec<DemoParams>[] = [
  {
    key: 'mass',
    kind: 'number',
    label: '质量',
    unit: 'kg',
    min: 0.1,
    max: 10,
    step: 0.1,
    defaultValue: 2
  },
  {
    key: 'showVector',
    kind: 'boolean',
    label: '显示速度矢量',
    defaultValue: true
  },
  {
    key: 'mode',
    kind: 'select',
    label: '阻尼模式',
    options: [
      { label: '理想无阻尼', value: 'ideal' },
      { label: '线性阻尼', value: 'damped' }
    ],
    defaultValue: 'ideal'
  }
];

function createDemoPlugin(): SimulationPlugin<DemoParams, DemoState> {
  return defineSimulationPlugin<DemoParams, DemoState>({
    meta: {
      id: 'demo-oscillator',
      title: '测试振子',
      textbookRef: '人教版 选择性必修一 第二章',
      curriculumTags: ['物理观念', '科学思维'],
      difficulty: '基础新授',
      version: '0.1.0'
    },
    paramSchema: schema,
    presets: [
      {
        id: 'default-ideal',
        name: '标准简谐',
        description: '默认无阻尼振动',
        params: { mass: 1.5, mode: 'ideal' }
      }
    ],
    engine: {
      createInitialState: () => ({ t: 0, x: 1, v: 0 }),
      step: (state, _params, dt) => ({
        nextState: { t: state.t + dt, x: state.x, v: state.v },
        events: []
      }),
      computeObservables: (state) => ({ x: state.x, v: state.v })
    },
    layers: [{ id: 'velocity', label: '速度矢量', defaultVisible: true }],
    telemetryChannels: [{ key: 'x', label: '位移', unit: 'm', color: '#38bdf8' }],
    renderCanvas: () => {}
  });
}

describe('sim-sdk', () => {
  it('resolves default params and clamps out-of-range or NaN inputs', () => {
    const resolved = resolvePluginParams(schema, {
      mass: 999,
      showVector: false
    });
    expect(resolved).toEqual({
      mass: 10,
      showVector: false,
      mode: 'ideal'
    });

    const fallbackFromInvalid = resolvePluginParams(schema, {
      mass: Number.NaN,
      mode: 'unknown-mode' as DemoParams['mode']
    });
    expect(fallbackFromInvalid).toEqual({
      mass: 2,
      showVector: true,
      mode: 'ideal'
    });
  });

  it('defines a valid plugin and executes engine step contract', () => {
    const plugin = createDemoPlugin();
    const params = resolvePluginParams(plugin.paramSchema, plugin.presets[0]?.params);
    const initial = plugin.engine.createInitialState(params);
    const { nextState, events } = plugin.engine.step(initial, params, 0.01);
    expect(nextState.t).toBeCloseTo(0.01, 12);
    expect(events).toEqual([]);
  });

  it('rejects duplicate param keys or invalid number bounds', () => {
    expect(() =>
      defineSimulationPlugin<DemoParams, DemoState>({
        ...createDemoPlugin(),
        paramSchema: [
          schema[0]!,
          {
            key: 'mass',
            kind: 'number',
            label: '重复质量',
            min: 1,
            max: 5,
            step: 0.5,
            defaultValue: 2
          }
        ]
      })
    ).toThrow(/Duplicate paramSchema key/);

    expect(() =>
      defineSimulationPlugin<DemoParams, DemoState>({
        ...createDemoPlugin(),
        paramSchema: [
          {
            key: 'mass',
            kind: 'number',
            label: '非法区间',
            min: 10,
            max: 1,
            step: 0.5,
            defaultValue: 2
          }
        ]
      })
    ).toThrow(/Invalid min\/max bounds/);
  });
});
