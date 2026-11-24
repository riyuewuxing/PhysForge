import { describe, expect, it, vi } from 'vitest';
import { StoryRunner, easeInOutCubic, type StoryRunnerCallbacks } from './storyRunner.js';
import { isSimulationPluginV3, type StoryBeat, type StoryDeck } from './v3Types.js';
import type { SimulationPlugin, ParamRecord } from './index.js';

function beat(id: string, extra: Partial<StoryBeat> = {}): StoryBeat {
  return { id, title: id, caption: id, speakerNotes: '', ...extra };
}

function setup(beats: StoryBeat[]) {
  const deck: StoryDeck = { id: 'deck', modelId: 'test', title: 'test', beats };
  let params: Record<string, unknown> = { speed: 0, mode: 'a', visible: false };
  const callbacks = {
    getCurrentParams: () => params,
    applyParamsImperative: vi.fn((patch: Record<string, unknown>) => { params = { ...params, ...patch }; }),
    controlSimulation: vi.fn<StoryRunnerCallbacks['controlSimulation']>(),
    applyCameraKeyframe: vi.fn<StoryRunnerCallbacks['applyCameraKeyframe']>(),
    applyLayerOverrides: vi.fn<StoryRunnerCallbacks['applyLayerOverrides']>(),
    onBeatChanged: vi.fn<StoryRunnerCallbacks['onBeatChanged']>(),
    onAutoFreezeTriggered: vi.fn<StoryRunnerCallbacks['onAutoFreezeTriggered']>()
  };
  return { runner: new StoryRunner(deck, callbacks), callbacks, params: () => params };
}

describe('StoryRunner V3 headless', () => {
  it('handles empty decks, initial state, bounds, fractional indices and forward/backward navigation', () => {
    const empty = setup([]).runner;
    expect(empty.next(0)).toBe(false);
    const { runner, callbacks } = setup([beat('a'), beat('b')]);
    expect(runner.getCurrentIndex()).toBe(-1);
    expect(runner.getCurrentBeat()).toBeNull();
    expect(runner.prev(0)).toBe(false);
    expect(runner.goTo(-1, 0)).toBe(false);
    expect(runner.goTo(0.5, 0)).toBe(false);
    expect(runner.goTo(0, NaN)).toBe(false);
    expect(runner.next(0)).toBe(true);
    expect(runner.next(1)).toBe(true);
    expect(runner.next(2)).toBe(false);
    expect(runner.getCurrentBeat()?.id).toBe('b');
    expect(runner.prev(3)).toBe(true);
    expect(runner.prev(4)).toBe(false);
    expect(callbacks.onBeatChanged.mock.calls.map(([index]) => index)).toEqual([0, 1, 0]);
  });

  it('eases numeric patches, switches nonnumeric values immediately and lands exactly', () => {
    const { runner, params, callbacks } = setup([beat('a', {
      paramPatch: { speed: 16, mode: 'b', visible: true }, paramTweenMs: 1000,
      simAction: 'reset-play', layerOverrides: { showFbd: true },
      camera: { view2D: { centerX: 0, centerY: 0, zoom: 2 } }
    })]);
    expect([easeInOutCubic(-1), easeInOutCubic(0.25), easeInOutCubic(0.5), easeInOutCubic(0.75), easeInOutCubic(2)]).toEqual([0, 0.0625, 0.5, 0.9375, 1]);
    runner.next(100);
    expect(params()).toEqual({ speed: 0, mode: 'b', visible: true });
    runner.tick(350);
    expect(params()['speed']).toBeCloseTo(1);
    runner.tick(600);
    expect(params()['speed']).toBeCloseTo(8);
    runner.tick(1100);
    expect(params()['speed']).toBe(16);
    const calls = callbacks.applyParamsImperative.mock.calls.length;
    runner.tick(1200);
    expect(callbacks.applyParamsImperative).toHaveBeenCalledTimes(calls);
    expect(callbacks.controlSimulation).toHaveBeenCalledWith('reset-play');
    expect(callbacks.applyCameraKeyframe).toHaveBeenCalledOnce();
    expect(callbacks.applyLayerOverrides).toHaveBeenCalledWith({ showFbd: true });
  });

  it('pauses through a reset tween, initializes at target values, and ignores pre-reset observations', () => {
    const { runner, params, callbacks } = setup([beat('a', { paramPatch: { speed: 16 }, paramTweenMs: 1000,
      simAction: 'reset-play', autoFreeze: { observableKey: 'x', operator: '<=', threshold: 1, badgeText: 'hit' } })]);
    const resetSpeeds: unknown[] = [];
    callbacks.controlSimulation.mockImplementation(action => {
      if (action === 'reset-play') resetSpeeds.push(params()['speed']);
    });
    runner.next(0);
    expect(callbacks.controlSimulation).toHaveBeenCalledExactlyOnceWith('pause');
    expect(runner.hasArmedFreeze).toBe(false);
    runner.tick(500, { x: 0 });
    expect(resetSpeeds).toEqual([]);
    expect(runner.checkAutoFreeze({ x: 0 })).toBe(false);
    runner.tick(1000, { x: 0 });
    expect(resetSpeeds).toEqual([16]);
    expect(callbacks.onAutoFreezeTriggered).not.toHaveBeenCalled();
    expect(runner.checkAutoFreeze({ x: 2 })).toBe(false);
    expect(runner.checkAutoFreeze({ x: 0.9 })).toBe(true);
    expect(runner.checkAutoFreeze({ x: 0.8 })).toBe(false);
    expect(callbacks.onAutoFreezeTriggered).toHaveBeenCalledOnce();
  });

  it('never fires an abandoned reset when navigation or a manual edit interrupts its tween', () => {
    const { runner, callbacks } = setup([
      beat('a', { paramPatch: { speed: 16 }, paramTweenMs: 1000, simAction: 'reset-play' }),
      beat('b', { paramPatch: { speed: 8 }, paramTweenMs: 1000, simAction: 'reset-pause',
        autoFreeze: { observableKey: 'x', operator: '>=', threshold: 2, badgeText: 'hit' } })
    ]);
    runner.next(0);
    runner.next(500);
    expect(callbacks.controlSimulation).not.toHaveBeenCalledWith('reset-play');
    runner.cancelTween();
    runner.tick(1500, { x: 3 });
    expect(callbacks.controlSimulation).not.toHaveBeenCalledWith('reset-pause');
    expect(callbacks.onAutoFreezeTriggered).not.toHaveBeenCalled();
  });

  it('interrupts a tween at the actual navigation instant and uses the current interpolated value', () => {
    const { runner, params } = setup([
      beat('a', { paramPatch: { speed: 20 }, paramTweenMs: 1000 }),
      beat('b', { paramPatch: { speed: 40 }, paramTweenMs: 1000 }),
      beat('c', { paramPatch: { speed: -5 }, paramTweenMs: 0 })
    ]);
    runner.next(0);
    runner.tick(250);
    expect(params()['speed']).toBeCloseTo(1.25);
    runner.next(500);
    expect(params()['speed']).toBeCloseTo(10);
    runner.tick(1000);
    expect(params()['speed']).toBeCloseTo(25);
    runner.next(1100);
    expect(params()['speed']).toBe(-5);
    runner.tick(2200);
    expect(params()['speed']).toBe(-5);
  });

  it.each([
    { operator: '>=' as const, samples: [1, 2, 3] },
    { operator: '<=' as const, samples: [3, 2, 1] },
    { operator: 'cross' as const, samples: [1, 3, 1] },
    { operator: 'cross' as const, samples: [3, 1, 3] }
  ])('fires $operator once per beat and rearms on navigation', ({ operator, samples }) => {
    const rule = { observableKey: 'x', operator, threshold: 2, badgeText: 'critical' };
    const { runner, callbacks } = setup([beat('a', { autoFreeze: rule }), beat('b', { autoFreeze: rule })]);
    runner.next(0);
    samples.forEach((x, i) => runner.tick(i + 1, { x }));
    expect(callbacks.controlSimulation).toHaveBeenCalledExactlyOnceWith('pause');
    expect(callbacks.onAutoFreezeTriggered).toHaveBeenCalledExactlyOnceWith('critical');
    runner.next(10);
    samples.forEach((x, i) => runner.tick(i + 11, { x }));
    expect(callbacks.onAutoFreezeTriggered).toHaveBeenCalledTimes(2);
  });

  it('lets a manual parameter edit cancel an in-flight tween', () => {
    const { runner, params, callbacks } = setup([beat('a', { paramPatch: { speed: 20 }, paramTweenMs: 1000 })]);
    runner.next(0);
    runner.tick(500);
    runner.cancelTween();
    callbacks.applyParamsImperative({ speed: 7 });
    runner.tick(1000);
    expect(params()['speed']).toBe(7);
  });

  it('does not fabricate a crossing across invalid observations or when starting at threshold', () => {
    const { runner, callbacks } = setup([beat('a', { autoFreeze: { observableKey: 'x', operator: 'cross', threshold: 2, badgeText: 'hit' } })]);
    runner.next(0);
    runner.tick(1, { x: 2 });
    runner.tick(2, { x: 3 });
    runner.tick(3, { x: NaN });
    runner.tick(4, { x: 1 });
    expect(callbacks.onAutoFreezeTriggered).not.toHaveBeenCalled();
    runner.tick(5, { x: 2 });
    expect(callbacks.onAutoFreezeTriggered).toHaveBeenCalledOnce();
  });

  it('detects only opt-in V3 capabilities while preserving V2 structural compatibility', () => {
    const plugin: SimulationPlugin<ParamRecord, number> = {
      meta: { id: 'old', title: 'old', textbookRef: '', curriculumTags: ['物理观念'], difficulty: '基础新授', version: '2' },
      paramSchema: [], presets: [], layers: [], telemetryChannels: [],
      engine: { createInitialState: () => 0, step: (state) => ({ nextState: state, events: [] }), computeObservables: () => ({}) },
      renderCanvas: () => {}
    };
    expect(isSimulationPluginV3(plugin)).toBe(false);
    expect(isSimulationPluginV3({ ...plugin, storyDecks: [] } as SimulationPlugin<ParamRecord, number>)).toBe(true);
  });
});
