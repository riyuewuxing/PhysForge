import { afterEach, describe, expect, it } from 'vitest';
import { getStoryDecks, resolvePresentationHotkey, useClassroomStore } from '../store/useClassroomStore.js';

describe('V3 tri-mode shell', () => {
  afterEach(() => useClassroomStore.getState().setAppMode('studio'));
  it('keeps legacy fullscreen boolean synchronized through every mode and toggle', () => {
    const get = useClassroomStore.getState;
    get().setAppMode('studio');
    expect(get().fullscreenPresentation).toBe(false);
    get().toggleFullscreenPresentation();
    expect(get().appMode).toBe('stage');
    expect(get().fullscreenPresentation).toBe(true);
    const deck = getStoryDecks(get().loadedPlugin)[0];
    expect(deck?.beats.length).toBeGreaterThan(0);
    get().setAppMode('story', deck?.id);
    expect(get().appMode).toBe('story');
    expect(get().fullscreenPresentation).toBe(true);
    get().setStoryBeat(1);
    get().setAutoFreezeBadge('critical');
    get().toggleBlackout();
    expect(get().isBlackout).toBe(true);
    get().toggleFullscreenPresentation();
    expect(get().appMode).toBe('studio');
    expect(get().fullscreenPresentation).toBe(false);
    expect(get().storyBeatIndex).toBe(-1);
    expect(get().activeDeckId).toBeNull();
    expect(get().autoFreezeBadge).toBeNull();
    expect(get().isBlackout).toBe(false);
  });
  it('routes presentation hotkeys only in their own mode', () => {
    for (const key of ['f', 'b', ' ', 'PageDown', 'Escape']) expect(resolvePresentationHotkey('studio', key)).toBeNull();
    expect(resolvePresentationHotkey('stage', ' ')).toBe('play-toggle');
    expect(resolvePresentationHotkey('stage', 'PageDown')).toBeNull();
    for (const key of [' ', 'ArrowRight', 'PageDown']) expect(resolvePresentationHotkey('story', key)).toBe('next');
    for (const key of ['ArrowLeft', 'PageUp']) expect(resolvePresentationHotkey('story', key)).toBe('prev');
    for (const mode of ['stage', 'story'] as const) {
      expect(resolvePresentationHotkey(mode, 'B')).toBe('blackout');
      expect(resolvePresentationHotkey(mode, '.')).toBe('blackout');
      expect(resolvePresentationHotkey(mode, 'F')).toBe('play-toggle');
      expect(resolvePresentationHotkey(mode, 'M')).toBe('mirror');
      expect(resolvePresentationHotkey(mode, 'Escape')).toBe('exit');
      expect(resolvePresentationHotkey(mode, '1')).toBeNull();
    }
  });
  it('coalesces an entire live formula gesture to one undo step', () => {
    const get = useClassroomStore.getState;
    const before = get();
    const field = before.loadedPlugin.paramSchema.find((item) => item.kind === 'number' && item.max > item.min);
    if (!field || field.kind !== 'number') throw new Error('No numeric field for gesture test');
    const initial = before.params[field.key];
    const last = initial === field.max ? field.min : field.max;
    before.beginLiveFormula(before.selectedPluginId, field.key);
    before.updateLiveFormula(before.selectedPluginId, field.key, (field.min + field.max) / 2);
    before.updateLiveFormula(before.selectedPluginId, field.key, last);
    before.endLiveFormula(before.selectedPluginId, field.key);
    expect(get().params[field.key]).toBe(last);
    get().undoParam();
    expect(get().params[field.key]).toBe(initial);
    get().redoParam();
    expect(get().params[field.key]).toBe(last);
    get().undoParam();
    useClassroomStore.setState({ params: before.params, activePresetId: before.activePresetId, scrubTime: before.scrubTime });
  });
  it('synchronizes story params without resetting physics or creating per-frame undo commands', () => {
    const get = useClassroomStore.getState;
    const before = get();
    const next = { ...before.params };
    before.syncStoryParams(before.selectedPluginId, next);
    expect(get().params).toBe(next);
    expect(get().resetNonce).toBe(before.resetNonce);
    expect(get().canUndo).toBe(before.canUndo);
    before.syncStoryParams('unrelated', { bogus: 1 });
    expect(get().params).toBe(next);
    useClassroomStore.setState({ params: before.params, activePresetId: before.activePresetId, scrubTime: before.scrubTime });
  });
});
