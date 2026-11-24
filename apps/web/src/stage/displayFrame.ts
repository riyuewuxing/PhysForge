/** Pure display selection shared by both rendering pipelines; never changes the engine state. */
export interface DisplayFrame {
  readonly t: number;
  readonly state: unknown;
  readonly observables?: Readonly<Record<string, number>>;
}

export function closestDisplayFrame<T extends DisplayFrame>(frames: readonly T[], targetT: number): T | null {
  if (!frames.length || !Number.isFinite(targetT)) return null;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.t < targetT) lo = mid + 1;
    else hi = mid;
  }
  const candidate = frames[lo]!;
  const previous = frames[lo - 1];
  return previous && Math.abs(previous.t - targetT) < Math.abs(candidate.t - targetT)
    ? previous : candidate;
}

/** The live state is not necessarily the most recently recorded history sample. */
export function selectDisplayFrame(input: {
  modelId: string;
  ownerModelId: string | null;
  currentState: unknown;
  currentTime: number;
  scrubTime: number | null;
  snapshots: readonly DisplayFrame[];
}): DisplayFrame | null {
  if (input.ownerModelId !== input.modelId) return null;
  if (input.scrubTime !== null) {
    const recorded = closestDisplayFrame(input.snapshots, input.scrubTime);
    if (recorded) return recorded;
  }
  return input.currentState === null || input.currentState === undefined
    ? null : { t: input.currentTime, state: input.currentState };
}

const POE_HIDDEN_LAYERS = ['trajectory', 'larmorCircle', 'slopeGhost', 'vibrationGraph', 'eventPins'] as const;

/** Preserve set identity across frame reads so the spatial renderer does not rebuild static geometry. */
export function createDisplayLayerSelector(): (layers: readonly string[], masked: boolean) => ReadonlySet<string> {
  let previousLayers: readonly string[] | undefined;
  let previousMasked: boolean | undefined;
  let result: ReadonlySet<string> = new Set();
  return (layers, masked) => {
    if (layers === previousLayers && masked === previousMasked) return result;
    const next = new Set(layers);
    if (masked) for (const layer of POE_HIDDEN_LAYERS) next.delete(layer);
    previousLayers = layers;
    previousMasked = masked;
    result = next;
    return result;
  };
}
