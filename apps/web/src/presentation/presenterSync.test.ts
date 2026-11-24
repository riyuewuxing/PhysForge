import { describe, expect, it } from 'vitest';
import { buildPresenterWindowUrl, isPresenterCommand, parseSyncEnvelope, PresenterSyncBridge, type StageSnapshotPayload, type SyncEnvelope } from './presenterSync.js';

const snapshot: StageSnapshotPayload = {
  modelId: 'demo', modelTitle: 'Demo', appMode: 'story', isPlaying: false, isBlackout: false,
  morphT: 1, simTime: 0, deckId: 'deck', beatIndex: 0, totalBeats: 2,
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
    const envelope = { sessionId: 's', sender: 'presenter', ts: 1, msg: { type: 'CMD_NEXT_BEAT' } };
    expect(parseSyncEnvelope(envelope, 's', 'stage')).toEqual(envelope);
    expect(parseSyncEnvelope(envelope, 'other', 'stage')).toBeNull();
    expect(parseSyncEnvelope(envelope, 's', 'presenter')).toBeNull();
    expect(isPresenterCommand({ type: 'CMD_GOTO_BEAT', index: 1.5 })).toBe(false);
    expect(isPresenterCommand({ type: 'CMD_SET_PARAM', paramKey: 'v', value: NaN })).toBe(false);
    expect(isPresenterCommand({ type: 'CMD_LASER_POINTER', active: true, normX: 2, normY: 0 })).toBe(false);
    expect(parseSyncEnvelope({ sessionId: 's', sender: 'stage', ts: 1, msg: { type: 'STAGE_SNAPSHOT', payload: {} } }, 's', 'presenter')).toBeNull();
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
      presenter.sendCommand({ type: 'CMD_NEXT_BEAT' });
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
