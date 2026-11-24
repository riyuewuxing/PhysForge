import type { StoryBeat, StoryDeck } from './v3Types.js';

export interface ActiveTween {
  startTimeMs: number;
  durationMs: number;
  fromParams: Record<string, number>;
  toParams: Record<string, number>;
}

export interface StoryRunnerCallbacks {
  getCurrentParams: () => Record<string, unknown>;
  applyParamsImperative: (patch: Record<string, unknown>) => void;
  controlSimulation: (action: 'reset-pause' | 'reset-play' | 'play' | 'pause') => void;
  applyCameraKeyframe: (camera: NonNullable<StoryBeat['camera']>) => void;
  applyLayerOverrides: (overrides: NonNullable<StoryBeat['layerOverrides']>) => void;
  onBeatChanged: (index: number, beat: StoryBeat) => void;
  onAutoFreezeTriggered: (badgeText: string) => void;
}

export function easeInOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

export class StoryRunner {
  private deck: StoryDeck;
  private cb: StoryRunnerCallbacks;
  private beatIndex = -1;
  private activeTween: ActiveTween | null = null;
  private freezeArmed = false;
  private prevObservableVal: number | null = null;

  constructor(deck: StoryDeck, callbacks: StoryRunnerCallbacks) {
    this.deck = deck;
    this.cb = callbacks;
  }

  public getCurrentIndex(): number {
    return this.beatIndex;
  }

  public getCurrentBeat(): StoryBeat | null {
    return this.beatIndex >= 0 && this.beatIndex < this.deck.beats.length
      ? (this.deck.beats[this.beatIndex] ?? null)
      : null;
  }

  public next(nowMs: number): boolean {
    if (this.beatIndex + 1 >= this.deck.beats.length) return false;
    return this.goTo(this.beatIndex + 1, nowMs);
  }

  public prev(nowMs: number): boolean {
    if (this.beatIndex <= 0) return false;
    return this.goTo(this.beatIndex - 1, nowMs);
  }

  public goTo(index: number, nowMs: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this.deck.beats.length || !Number.isFinite(nowMs)) return false;
    const beat = this.deck.beats[index];
    if (!beat) return false;
    // Advance the old tween to the exact interruption time, without testing the old beat's freeze rule.
    this.tick(nowMs);
    this.beatIndex = index;

    // 1. 参数补丁分类：非数值立即生效，数值进入 rAF 缓动队列
    this.activeTween = null;
    if (beat.paramPatch) {
      const current = this.cb.getCurrentParams();
      const immediatePatch: Record<string, unknown> = {};
      const fromNums: Record<string, number> = {};
      const toNums: Record<string, number> = {};
      const duration = beat.paramTweenMs ?? 450;

      for (const [k, v] of Object.entries(beat.paramPatch)) {
        const from = current[k];
        if (typeof v === 'number' && Number.isFinite(v) && typeof from === 'number' && Number.isFinite(from) && Number.isFinite(duration) && duration > 0) {
          fromNums[k] = from;
          toNums[k] = v;
        } else {
          immediatePatch[k] = v;
        }
      }
      if (Object.keys(immediatePatch).length > 0) {
        this.cb.applyParamsImperative(immediatePatch);
      }
      if (Object.keys(toNums).length > 0) {
        this.activeTween = {
          startTimeMs: nowMs,
          durationMs: duration,
          fromParams: fromNums,
          toParams: toNums,
        };
      }
    }

    // 2. 图层与镜头关键帧
    if (beat.layerOverrides) this.cb.applyLayerOverrides(beat.layerOverrides);
    if (beat.camera) this.cb.applyCameraKeyframe(beat.camera);

    // 3. 仿真播放状态与临界定格武装
    if (beat.simAction && beat.simAction !== 'keep') {
      this.cb.controlSimulation(beat.simAction);
    }
    this.freezeArmed = Boolean(beat.autoFreeze);
    this.prevObservableVal = null;

    this.cb.onBeatChanged(index, beat);
    return true;
  }

  /** 每帧由主 rAF 驱动，零 React 重渲染 */
  public tick(nowMs: number, observables?: Record<string, number>): void {
    if (!Number.isFinite(nowMs)) return;
    // 1. 推进参数平滑插值
    if (this.activeTween) {
      const elapsed = nowMs - this.activeTween.startTimeMs;
      const rawT = elapsed / this.activeTween.durationMs;
      const eased = easeInOutCubic(rawT);
      const patch: Record<string, number> = {};
      for (const key of Object.keys(this.activeTween.toParams)) {
        const a = this.activeTween.fromParams[key];
        const b = this.activeTween.toParams[key];
        if (a === undefined || b === undefined) continue;
        patch[key] = rawT >= 1 ? b : a * (1 - eased) + b * eased;
      }
      this.cb.applyParamsImperative(patch);
      if (rawT >= 1) this.activeTween = null;
    }

    // 2. 临界自动定格检测
    const beat = this.getCurrentBeat();
    if (this.freezeArmed && beat?.autoFreeze && observables) {
      const { observableKey, operator, threshold, badgeText } = beat.autoFreeze;
      const val = observables[observableKey];
      if (typeof val === 'number' && Number.isFinite(val)) {
        let hit = false;
        if (operator === '>=') hit = val >= threshold;
        else if (operator === '<=') hit = val <= threshold;
        else if (operator === 'cross' && this.prevObservableVal !== null) {
          hit =
            ((this.prevObservableVal < threshold && val >= threshold) ||
             (this.prevObservableVal > threshold && val <= threshold));
        }
        this.prevObservableVal = val;
        if (hit) {
          this.freezeArmed = false;
          this.cb.controlSimulation('pause');
          this.cb.onAutoFreezeTriggered(badgeText);
        }
      } else {
        // Never infer a crossing across a missing or non-finite observation.
        this.prevObservableVal = null;
      }
    }
  }
}
