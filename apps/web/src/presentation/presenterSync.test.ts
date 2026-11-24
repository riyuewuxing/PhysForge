import { describe, expect, it } from 'vitest';
import { buildPresenterWindowUrl, isPresenterCommand, parseSyncEnvelope, PresenterSyncBridge, commandMatchesStage, scopePresenterAction, type StageSnapshotPayload, type SyncEnvelope } from './presenterSync.js';

const snapshot: StageSnapshotPayload = {
  modelId: 'demo', modelTitle: 'Demo', appMode: 'story', isPlaying: false, isBlackout: false,
  morphT: 1, simTime: 0, deckId: 'deck', beatIndex: 0, paramContextEpoch: 3, totalBeats: 2,
  currentCaption: 'first', speakerNotes: 'private', nextBeatTitle: 'next', observables: { x: 1 },
  params: { speed: 1 }, paramSchema: [], canMorph: false, freezeBadge: null
};

describe('PresenterSyncBridge', () => {
  it('preserves root and Pages paths while removing stale presets', () => {
    for (const path of ['/', '/PhysForge/']) {
      const url = new URL(buildPresenterWindowUrl('s', 'model', 'https://example.test' + path + '?preset=old'));
      expect(url.pathname).toBe(path);
      expect(url.searchParams.get('preset')).toBeNull();
      expect(url.searchParams.get('mode')).toBe('presenter');
      expect(url.searchParams.get('session')).toBe('s');
      expect(url.searchParams.get('model')).toBe('model');
    }
  });
  it('rejects malformed, out-of-session and same-role messages', () => {
    const envelope = { sessionId: 's', sender: 'presenter', ts: 1, msg: { type: 'CMD_NEXT_BEAT', modelId: 'demo', deckId: 'deck', paramContextEpoch: 3 } };
    expect(parseSyncEnvelope(envelope, 's', 'stage')).toEqual(envelope);
    expect(parseSyncEnvelope(envelope, 'other', 'stage')).toBeNull();
    expect(parseSyncEnvelope(envelope, 's', 'presenter')).toBeNull();
    expect(isPresenterCommand({ type: 'CMD_GOTO_BEAT', index: 1.5 })).toBe(false);
    expect(isPresenterCommand({ type: 'CMD_SET_PARAM', paramKey: 'v', value: NaN })).toBe(false);
    expect(isPresenterCommand({ type: 'CMD_LASER_POINTER', active: true, normX: 2, normY: 0 })).toBe(false);
    expect(parseSyncEnvelope({ sessionId: 's', sender: 'stage', ts: 1, msg: { type: 'STAGE_SNAPSHOT', payload: {} } }, 's', 'presenter')).toBeNull();
  });
  it('rejects stale model and deck mutations instead of editing a different lesson', () => {
    const command = scopePresenterAction({ type: 'CMD_SET_PARAM', paramKey: 'speed', value: 2 }, snapshot);
    expect(isPresenterCommand(command)).toBe(true);
    expect(isPresenterCommand({ type: 'CMD_SET_PARAM', paramKey: 'speed', value: 2 })).toBe(false);
    expect(commandMatchesStage(command, snapshot)).toBe(true);
    expect(commandMatchesStage(command, { modelId: 'other', deckId: 'deck', paramContextEpoch: 3 })).toBe(false);
    expect(commandMatchesStage(command, { modelId: 'demo', deckId: null, paramContextEpoch: 3 })).toBe(false);
    expect(commandMatchesStage({ type: 'CMD_REQUEST_SYNC' }, { modelId: 'other', deckId: null, paramContextEpoch: 3 })).toBe(true);
  });
  it('rejects parameter and replay commands from an old beat while permitting rapid navigation', () => {
    const previous = { ...snapshot, paramContextEpoch: 2 };
    const change = scopePresenterAction({ type: 'CMD_SET_PARAM', paramKey: 'speed', value: 2 }, previous);
    expect(commandMatchesStage(change, snapshot)).toBe(false);
    expect(commandMatchesStage(scopePresenterAction({ type: 'CMD_RESET_SIM' }, previous), snapshot)).toBe(false);
    expect(commandMatchesStage(scopePresenterAction({ type: 'CMD_NEXT_BEAT' }, previous), snapshot)).toBe(true);
    expect(commandMatchesStage(scopePresenterAction({ type: 'CMD_SET_PARAM', paramKey: 'speed', value: 2 }, snapshot), snapshot)).toBe(true);
    expect(isPresenterCommand({ type: 'CMD_SET_PARAM', modelId: 'demo', deckId: 'deck', paramKey: 'speed', value: 2 })).toBe(false);
  });
  it('exchanges real BroadcastChannel messages, throttles snapshots, and closes the channel', async () => {
    const session = crypto.randomUUID();
    const fromPresenter: SyncEnvelope[] = [];
    const fromStage: SyncEnvelope[] = [];
    let now = 0;
    const stage = new PresenterSyncBridge(session, 'stage', (env) => fromPresenter.push(env), () => now);
    const presenter = new PresenterSyncBridge(session, 'presenter', (env) => fromStage.push(env), () => now);
    try {
      expect(stage.available).toBe(true);
      presenter.sendCommand(scopePresenterAction({ type: 'CMD_NEXT_BEAT' }, snapshot));
      stage.broadcastSnapshot(snapshot);
      now = 20;
      stage.broadcastSnapshot({ ...snapshot, simTime: 20 });
      now = 70;
      stage.broadcastSnapshot({ ...snapshot, simTime: 70 });
      stage.broadcastSnapshot({ ...snapshot, simTime: 71 }, true);
      await new Promise<void>((resolve, reject) => {
        const started = performance.now();
        const timer = setInterval(() => {
          if (fromPresenter.length === 1 && fromStage.length >= 3) { clearInterval(timer); resolve(); }
          else if (performance.now() - started > 1500) { clearInterval(timer); reject(new Error('BroadcastChannel timed out')); }
        }, 10);
      });
      expect(fromPresenter[0]?.msg.type).toBe('CMD_NEXT_BEAT');
      expect(fromStage.map((env) => env.sender === 'stage' ? env.msg.payload.simTime : null)).toEqual([0, 70, 71]);
    } finally {
      stage.close();
      presenter.close();
    }
    expect(stage.available).toBe(false);
    expect(presenter.available).toBe(false);
  });
});


import { isSimulationPluginV3, resolvePluginParams, StoryRunner, type ParamRecord } from '@physforge/sim-sdk';
import { loadSimulationById } from '@physforge/simulations/catalog';

describe('authored physics StoryDecks use real schemas and headless engines', () => {
  it.each(['em-induction-double-rod', 'builder-composite-em-field', 'mech-vertical-circular'])('executes every beat of %s with its actual plugin', async (id) => {
    const plugin = await loadSimulationById(id);
    if (!plugin || !isSimulationPluginV3(plugin) || !plugin.storyDecks?.length) throw new Error('Missing authored V3 deck: ' + id);
    const schema = plugin.paramSchema;
    for (const deck of plugin.storyDecks) {
      expect(deck.modelId).toBe(plugin.meta.id);
      for (const [index, beat] of deck.beats.entries()) {
        let params = resolvePluginParams(schema);
        let state = plugin.engine.createInitialState(params);
        let playing = false;
        let frozen = 0;
        let freezeObs: Record<string, number> | null = null;
        const patch = beat.paramPatch ?? {};
        for (const [key, value] of Object.entries(patch)) {
          const field = schema.find((item) => item.key === key);
          if (!field) throw new Error('Unknown authored parameter: ' + key);
          if (field.kind === 'number') {
            expect(typeof value).toBe('number');
            expect(Number(value)).toBeGreaterThanOrEqual(field.min);
            expect(Number(value)).toBeLessThanOrEqual(field.max);
          } else if (field.kind === 'select') expect(field.options.some((option) => option.value === value)).toBe(true);
          else expect(typeof value).toBe('boolean');
        }
        const runner = new StoryRunner(deck, {
          getCurrentParams: () => params,
          applyParamsImperative: (raw) => {
            const next: ParamRecord = { ...params };
            for (const [key, value] of Object.entries(raw)) {
              if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') next[key] = value;
            }
            params = resolvePluginParams(schema, next);
          },
          controlSimulation: (action) => {
            if (action === 'reset-play' || action === 'reset-pause') state = plugin.engine.createInitialState(params);
            playing = action === 'play' || action === 'reset-play';
          },
          applyCameraKeyframe: () => {}, applyLayerOverrides: () => {}, onBeatChanged: () => {},
          onAutoFreezeTriggered: () => { frozen++; freezeObs = plugin.engine.computeObservables(state, params); }
        });
        expect(runner.goTo(index, 0)).toBe(true);
        const initial = plugin.engine.computeObservables(state, params);
        if (beat.autoFreeze) expect(Number.isFinite(initial[beat.autoFreeze.observableKey])).toBe(true);
        // One fixed physics step per iteration; autoFreeze observes the exact engine state, not a mock signal.
        const dt = 1 / 240;
        const maxSteps = beat.autoFreeze ? 2880 : 120;
        for (let i = 0; i < maxSteps; i++) {
          runner.tick(i * dt * 1000, plugin.engine.computeObservables(state, params));
          if (!playing) break;
          state = plugin.engine.step(state, params, dt).nextState;
        }
        const end = plugin.engine.computeObservables(state, params);
        expect(Object.values(end).every(Number.isFinite)).toBe(true);
        if (beat.autoFreeze) {
          expect(frozen, beat.id).toBe(1);
          expect(playing).toBe(false);
          const value = (freezeObs ?? end)[beat.autoFreeze.observableKey];
          expect(value).toBeDefined();
          if (beat.autoFreeze.operator === '>=') expect(value).toBeGreaterThanOrEqual(beat.autoFreeze.threshold);
          if (beat.autoFreeze.operator === '<=') expect(value).toBeLessThanOrEqual(beat.autoFreeze.threshold);
        }
        if (beat.id === 'b1-radius' || beat.id === 'b1-focus') expect(initial['larmorRadius']).toBeCloseTo(1.2, 8);
      }
    }
  }, 20000);
});
