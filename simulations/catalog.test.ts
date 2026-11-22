import { describe, expect, it } from 'vitest';
import { loadSimulationById, resolveCanonicalModelId, simulationCatalog } from './catalog.js';
import { simulationPlugins } from './registry.js';

describe('@physforge/simulations catalog vs registry parity', () => {
  it('keeps lightweight catalog metadata 1:1 synced with full plugin registry and dynamic loaders', async () => {
    expect(simulationCatalog.length).toBe(simulationPlugins.length);

    for (const plugin of simulationPlugins) {
      const entry = simulationCatalog.find((c) => c.meta.id === plugin.meta.id);
      expect(entry).toBeDefined();
      expect(entry!.meta).toEqual(plugin.meta);

      const loaded = await loadSimulationById(plugin.meta.id);
      expect(loaded).toBeDefined();
      expect(loaded!.meta.id).toBe(plugin.meta.id);
    }

    // Legacy V1 alias dynamically resolves cleanly
    const legacyLoaded = await loadSimulationById('em-bounded-magnetic-field');
    expect(legacyLoaded?.meta.id).toBe(resolveCanonicalModelId('em-bounded-magnetic-field'));
  });
});
