import { describe, expect, it } from 'vitest';
import { isSimulationPluginV3, resolvePluginParams } from '@physforge/sim-sdk';
import { loadSimulationById } from '@physforge/simulations/catalog';
import { clampAndQuantize, renderInteractiveLatex } from './liveFormulaEngine.js';

const modelIds = [
  "builder-composite-em-field",
  "builder-circuit-mna",
  "builder-optics-ray",
  "mech-projectile-coupling",
  "mech-block-conveyor",
  "mech-vertical-circular",
  "astro-orbital-mechanics",
  "em-electrostatic-field"
];

describe('V3 live formula model bindings', () => {
  it.each(modelIds)('binds actual numeric schema fields and renders interactive tokens for %s', async (id) => {
    const plugin = await loadSimulationById(id);
    if (!plugin || !isSimulationPluginV3(plugin) || !plugin.liveFormulas?.length) throw new Error('No live formulas: ' + id);
    const schema = plugin.paramSchema;
    const initial = resolvePluginParams(schema);
    const formulaIds = new Set<string>();
    for (const spec of plugin.liveFormulas) {
      expect(formulaIds.has(spec.id)).toBe(false);
      formulaIds.add(spec.id);
      const html = renderInteractiveLatex(spec.latex);
      expect(html).not.toContain('katex-error');
      expect(spec.bindings.length).toBeGreaterThan(0);
      const keys = new Set<string>();
      for (const binding of spec.bindings) {
        expect(keys.has(binding.tokenKey)).toBe(false);
        keys.add(binding.tokenKey);
        const field = schema.find(item => item.key === binding.paramKey);
        if (!field || field.kind !== 'number') throw new Error('Invalid numeric binding: ' + binding.paramKey);
        expect([binding.min, binding.max, binding.step]).toEqual([field.min, field.max, field.step]);
        expect(binding.unit).toBe(field.unit ?? '');
        expect(html).toContain('data-param="' + binding.tokenKey + '"');
        const candidate = clampAndQuantize(field.min + (field.max - field.min) * 0.37, field.min, field.max, field.step);
        const updated = resolvePluginParams(schema, { ...initial, [binding.paramKey]: candidate });
        expect(updated[binding.paramKey]).toBe(candidate);
        for (const other of schema) if (other.key !== binding.paramKey) expect(updated[other.key]).toEqual(initial[other.key]);
      }
    }
  });
});
