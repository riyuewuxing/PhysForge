import { afterEach, describe, expect, it } from 'vitest';
import { resolvePluginParams } from '@physforge/sim-sdk';
import { useClassroomStore } from './useClassroomStore.js';

describe('external scene preset identity', () => {
  const get = useClassroomStore.getState;
  const initial = get();
  const modelId = 'modern-photoelectric-compton';
  const presetId = 'photoelectric-sodium-violet';

  afterEach(() => useClassroomStore.setState(initial));

  it('shows custom parameters when AI overrides the default preset without a preset ID', async () => {
    await get().applyExternalState(modelId, undefined, { wavelengthNm: 400 });
    expect(get().params.wavelengthNm).toBe(400);
    expect(get().activePresetId).toBeNull();
  });

  it('does not claim the explicitly named preset if its parameters differ', async () => {
    await get().applyExternalState(modelId, presetId, { wavelengthNm: 400 });
    expect(get().params.wavelengthNm).toBe(400);
    expect(get().activePresetId).toBeNull();
  });

  it('preserves genuine preset identity for exactly matching resolved parameters and restores it on selection', async () => {
    await get().applyExternalState(modelId, presetId);
    expect(get().activePresetId).toBe(presetId);
    expect(get().params.wavelengthNm).toBe(405);
    const authored = get().loadedPlugin.presets.find(p => p.id === presetId);
    if (!authored) throw new Error('Missing photoelectric preset');
    const exact = resolvePluginParams(get().loadedPlugin.paramSchema, authored.params);
    await get().applyExternalState(modelId, presetId, exact);
    expect(get().activePresetId).toBe(presetId);
    await get().applyExternalState(modelId, 'nonexistent-preset', exact);
    expect(get().activePresetId).toBeNull();
    get().applyPreset(presetId);
    expect(get().activePresetId).toBe(presetId);
    expect(get().params).toEqual(exact);
  });
});
