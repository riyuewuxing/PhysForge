import type { AnyParamFieldSpec, ParamRecord, ParamValue } from '@physforge/sim-sdk';

type ScopedPresenterAction =
  | { type: 'CMD_NEXT_BEAT' | 'CMD_PREV_BEAT' | 'CMD_TOGGLE_PLAY' | 'CMD_RESET_SIM' | 'CMD_TOGGLE_MORPH_2D' | 'CMD_TOGGLE_BLACKOUT' }
  | { type: 'CMD_GOTO_BEAT'; index: number }
  | { type: 'CMD_SET_PARAM'; paramKey: string; value: ParamValue };
type UnscopedPresenterAction =
  | { type: 'CMD_REQUEST_SYNC' }
  | { type: 'CMD_LASER_POINTER'; active: boolean; normX: number; normY: number };
export type PresenterAction = ScopedPresenterAction | UnscopedPresenterAction;
export interface PresenterScope { modelId: string; deckId: string | null }
export type PresenterCommand = (ScopedPresenterAction & PresenterScope) | UnscopedPresenterAction;

/** Attach the model/deck shown on the presenter, not whichever model happens to be on stage later. */
export function scopePresenterAction(action: PresenterAction, scope: PresenterScope): PresenterCommand {
  if (action.type === 'CMD_REQUEST_SYNC' || action.type === 'CMD_LASER_POINTER') return action;
  return { ...action, modelId: scope.modelId, deckId: scope.deckId };
}
export function commandMatchesStage(command: PresenterCommand, scope: PresenterScope): boolean {
  return !('modelId' in command) || (command.modelId === scope.modelId && command.deckId === scope.deckId);
}

export interface StageSnapshotPayload {
  modelId: string;
  modelTitle: string;
  appMode: 'studio' | 'stage' | 'story';
  isPlaying: boolean;
  isBlackout: boolean;
  morphT: number;
  simTime: number;
  deckId: string | null;
  beatIndex: number;
  totalBeats: number;
  currentCaption: string;
  speakerNotes: string;
  nextBeatTitle: string | null;
  observables: Record<string, number>;
  params: ParamRecord;
  paramSchema: readonly AnyParamFieldSpec[];
  canMorph: boolean;
  freezeBadge: string | null;
}

export type SyncEnvelope =
  | { sessionId: string; sender: 'presenter'; ts: number; msg: PresenterCommand }
  | { sessionId: string; sender: 'stage'; ts: number; msg: { type: 'STAGE_SNAPSHOT'; payload: StageSnapshotPayload } };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonnegativeInteger = (v: unknown): v is number => finite(v) && Number.isInteger(v) && v >= 0;
const nullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';
const paramValue = (v: unknown): v is ParamValue => finite(v) || typeof v === 'boolean' || typeof v === 'string';
const norm = (v: unknown): v is number => finite(v) && v >= 0 && v <= 1;

export function isPresenterCommand(value: unknown): value is PresenterCommand {
  if (!isRecord(value)) return false;
  const scoped = typeof value.modelId === 'string' && value.modelId.length > 0 && nullableString(value.deckId);
  switch (value.type) {
    case 'CMD_NEXT_BEAT': case 'CMD_PREV_BEAT': case 'CMD_TOGGLE_PLAY': case 'CMD_RESET_SIM':
    case 'CMD_TOGGLE_MORPH_2D': case 'CMD_TOGGLE_BLACKOUT': return scoped;
    case 'CMD_REQUEST_SYNC': return true;
    case 'CMD_GOTO_BEAT': return scoped && nonnegativeInteger(value.index);
    case 'CMD_SET_PARAM': return scoped && typeof value.paramKey === 'string' && value.paramKey.length > 0 && paramValue(value.value);
    case 'CMD_LASER_POINTER': return typeof value.active === 'boolean' && norm(value.normX) && norm(value.normY);
    default: return false;
  }
}

function isParamField(value: unknown): value is AnyParamFieldSpec {
  if (!isRecord(value) || typeof value.key !== 'string' || typeof value.label !== 'string') return false;
  if (value.kind === 'number') return finite(value.min) && finite(value.max) && value.max >= value.min &&
    finite(value.step) && value.step > 0 && finite(value.defaultValue) && (value.unit === undefined || typeof value.unit === 'string');
  if (value.kind === 'boolean') return typeof value.defaultValue === 'boolean';
  return value.kind === 'select' && typeof value.defaultValue === 'string' && Array.isArray(value.options) &&
    value.options.every((option: unknown) => isRecord(option) && typeof option.label === 'string' && typeof option.value === 'string');
}

export function isStageSnapshotPayload(value: unknown): value is StageSnapshotPayload {
  if (!isRecord(value)) return false;
  return typeof value.modelId === 'string' && typeof value.modelTitle === 'string' &&
    (value.appMode === 'studio' || value.appMode === 'stage' || value.appMode === 'story') &&
    typeof value.isPlaying === 'boolean' && typeof value.isBlackout === 'boolean' &&
    norm(value.morphT) && finite(value.simTime) && value.simTime >= 0 &&
    nullableString(value.deckId) && (value.beatIndex === -1 || nonnegativeInteger(value.beatIndex)) &&
    nonnegativeInteger(value.totalBeats) && (value.beatIndex === -1 || value.beatIndex < value.totalBeats) &&
    typeof value.currentCaption === 'string' && typeof value.speakerNotes === 'string' && nullableString(value.nextBeatTitle) &&
    isRecord(value.observables) && Object.values(value.observables).every(finite) &&
    isRecord(value.params) && Object.values(value.params).every(paramValue) &&
    Array.isArray(value.paramSchema) && value.paramSchema.every(isParamField) &&
    typeof value.canMorph === 'boolean' && nullableString(value.freezeBadge);
}

export function parseSyncEnvelope(value: unknown, sessionId: string, receiver: 'stage' | 'presenter'): SyncEnvelope | null {
  if (!isRecord(value) || value.sessionId !== sessionId || !finite(value.ts) || !isRecord(value.msg)) return null;
  if (receiver === 'stage' && value.sender === 'presenter' && isPresenterCommand(value.msg)) {
    return { sessionId, sender: 'presenter', ts: value.ts, msg: value.msg };
  }
  if (receiver === 'presenter' && value.sender === 'stage' && value.msg.type === 'STAGE_SNAPSHOT' && isStageSnapshotPayload(value.msg.payload)) {
    return { sessionId, sender: 'stage', ts: value.ts, msg: { type: 'STAGE_SNAPSHOT', payload: value.msg.payload } };
  }
  return null;
}

export class PresenterSyncBridge {
  private channel: BroadcastChannel | null = null;
  private lastBroadcastMs = -Infinity;

  constructor(
    private readonly sessionId: string,
    private readonly role: 'stage' | 'presenter',
    onEnvelope: (envelope: SyncEnvelope) => void,
    private readonly clock: () => number = () => performance.now()
  ) {
    if (sessionId && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`physforge-v3-sync-${sessionId}`);
      this.channel.onmessage = (event: MessageEvent<unknown>) => {
        const envelope = parseSyncEnvelope(event.data, this.sessionId, this.role);
        if (envelope) onEnvelope(envelope);
      };
    }
  }

  public get available(): boolean { return this.channel !== null; }

  public sendCommand(cmd: PresenterCommand): void {
    if (this.role !== 'presenter' || !this.channel || !isPresenterCommand(cmd)) return;
    const envelope: SyncEnvelope = { sessionId: this.sessionId, sender: 'presenter', ts: this.clock(), msg: cmd };
    this.channel.postMessage(envelope);
  }

  public broadcastSnapshot(payload: StageSnapshotPayload, force = false): void {
    if (this.role !== 'stage' || !this.channel) return;
    const now = this.clock();
    if (!force && now - this.lastBroadcastMs < 1000 / 15) return;
    this.lastBroadcastMs = now;
    const envelope: SyncEnvelope = { sessionId: this.sessionId, sender: 'stage', ts: now, msg: { type: 'STAGE_SNAPSHOT', payload } };
    this.channel.postMessage(envelope);
  }

  public close(): void {
    this.channel?.close();
    this.channel = null;
  }
}

export function buildPresenterWindowUrl(sessionId: string, modelId: string, href = window.location.href): string {
  const url = new URL(href);
  url.searchParams.set('mode', 'presenter');
  url.searchParams.set('session', sessionId);
  url.searchParams.set('model', modelId);
  url.searchParams.delete('preset');
  return url.toString();
}
