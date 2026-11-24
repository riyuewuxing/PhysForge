import { describe, expect, it } from 'vitest';
import { isSimulationPluginV3, resolvePluginParams, selectLiveFormulas } from '@physforge/sim-sdk';
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
  "em-electrostatic-field",
  "em-capacitor-millikan",
  "em-ac-field-oscilloscope",
  "em-induction-double-rod",
  "em-wireframe-rotation",
  "wave-vibration-coupling",
  "optics-wave-interference",
  "stse-em-devices-suite",
  "stse-tokamak-magnetic-mirror",
  "em-3d-magnetic-fields"
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
      for (const [key, allowed] of Object.entries(spec.when ?? {})) {
        const field = schema.find(item => item.key === key);
        expect(field, key).toBeDefined();
        expect(allowed.length).toBeGreaterThan(0);
        for (const value of allowed) {
          if (field?.kind === 'select') expect(field.options.some(option => option.value === value)).toBe(true);
          else if (field?.kind === 'boolean') expect(typeof value).toBe('boolean');
          else if (field?.kind === 'number') expect(typeof value === 'number' && value >= field.min && value <= field.max).toBe(true);
        }
      }
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

describe('mode-aware live formula selection', () => {
  it.each([
    ['stse-em-devices-suite', 'device', 'velocity-selector', ['velocity-selector']],
    ['stse-em-devices-suite', 'device', 'mass-spectrometer', ['spectrometer-radius']],
    ['stse-em-devices-suite', 'device', 'hall-sensor', ['hall-voltage']],
    ['stse-em-devices-suite', 'device', 'cyclotron', ['cyclotron-energy', 'cyclotron-gap-energy']],
    ['stse-em-devices-suite', 'device', 'mhd-generator', ['mhd-emf', 'mhd-load-power']],
    ['stse-em-devices-suite', 'device', 'em-flowmeter', ['flowmeter-rate']],
    ['em-3d-magnetic-fields', 'geometryType', 'single-loop', ['biot-savart-current']],
    ['em-3d-magnetic-fields', 'geometryType', 'uniform-helix', ['uniform-gyro-frequency', 'uniform-parallel-velocity']],
    ['stse-tokamak-magnetic-mirror', 'mode', 'tokamak', ['tokamak-toroidal-field']],
    ['astro-orbital-mechanics', 'mode', 'binary-lagrange', ['binary-barycenter']]
  ] as const)('selects %s %s=%s', async (id, key, value, expected) => {
    const plugin = await loadSimulationById(id);
    if (!plugin || !isSimulationPluginV3(plugin)) throw new Error('Missing plugin: ' + id);
    const params = resolvePluginParams(plugin.paramSchema, { [key]: value });
    expect(selectLiveFormulas(plugin.liveFormulas, params).map(item => item.id)).toEqual(expected);
  });
});
