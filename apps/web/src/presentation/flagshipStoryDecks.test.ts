import { describe, expect, it } from 'vitest';
import { StoryRunner, isSimulationPluginV3, resolvePluginParams, selectLiveFormulas, type ParamRecord } from '@physforge/sim-sdk';
import { loadSimulationById } from '@physforge/simulations/catalog';
import { renderInteractiveLatex } from './liveFormulaEngine.js';
import { validStoryView2D, validStoryView3D } from './storyCamera.js';

const models = [
  'em-3d-magnetic-fields',
  'stse-tokamak-magnetic-mirror',
  'stse-em-devices-suite',
  'astro-orbital-mechanics'
] as const;

describe('authored flagship classroom decks', () => {
  it.each(models)('checks independently navigable beats, real schema and freeze rules: %s', async (id) => {
    const plugin = await loadSimulationById(id);
    if (!plugin || !isSimulationPluginV3(plugin) || !plugin.storyDecks?.length) throw new Error('Missing story decks: ' + id);
    const defaults = resolvePluginParams(plugin.paramSchema);
    const deckIds = new Set<string>();
    const beatIds = new Set<string>();
    for (const deck of plugin.storyDecks) {
      expect(deck.modelId).toBe(plugin.meta.id);
      expect(deckIds.has(deck.id)).toBe(false);
      deckIds.add(deck.id);
      expect(deck.beats.length).toBeGreaterThanOrEqual(3);
      for (const [index, beat] of deck.beats.entries()) {
        expect(beatIds.has(beat.id)).toBe(false);
        beatIds.add(beat.id);
        expect(beat.title.length).toBeGreaterThan(0);
        expect(beat.caption.length).toBeGreaterThan(0);
        expect(beat.speakerNotes.length).toBeGreaterThan(0);
        // Every new beat can be selected directly, independent of earlier beats or presets.
        expect(Object.keys(beat.paramPatch ?? {}).sort()).toEqual(Object.keys(defaults).sort());
        const target = resolvePluginParams(plugin.paramSchema, beat.paramPatch);
        expect(target).toEqual(beat.paramPatch);
        let params: ParamRecord = { ...defaults };
        let state: unknown = plugin.engine.createInitialState(params);
        let playing = false;
        let freezes = 0;
        const runner = new StoryRunner(deck, {
          getCurrentParams: () => params,
          applyParamsImperative: patch => {
            const next: ParamRecord = { ...params };
            for (const [key, value] of Object.entries(patch)) {
              if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') throw new Error('Bad parameter ' + key);
              next[key] = value;
            }
            params = resolvePluginParams(plugin.paramSchema, next);
          },
          controlSimulation: action => {
            playing = action === 'play' || action === 'reset-play';
            if (action === 'reset-play' || action === 'reset-pause') state = plugin.engine.createInitialState(params);
          },
          applyCameraKeyframe: keyframe => {
            if (keyframe.view2D) expect(validStoryView2D(keyframe.view2D)).toBe(true);
            if (keyframe.view3D) {
              expect(plugin.spatial3D).toBeDefined();
              expect(validStoryView3D(keyframe.view3D)).toBe(true);
            }
          },
          applyLayerOverrides: overrides => {
            for (const layer of overrides.visibleLayerIds ?? []) expect(plugin.layers.some(item => item.id === layer)).toBe(true);
            if (overrides.highlightFormulaId) expect(selectLiveFormulas(plugin.liveFormulas, target).some(item => item.id === overrides.highlightFormulaId)).toBe(true);
          },
          onBeatChanged: () => {},
          onAutoFreezeTriggered: () => { freezes++; }
        });
        expect(runner.goTo(index, 0)).toBe(true);
        runner.tick(1000);
        expect(params).toEqual(target);
        const readouts = plugin.formatFormulas?.(state, params) ?? [];
        expect(readouts.some(item => Boolean(item.substitutedLatex)), beat.id).toBe(true);
        for (const item of readouts) {
          expect(renderInteractiveLatex(item.latex), item.id).not.toContain('katex-error');
          if (item.substitutedLatex) {
            expect(item.substitutedLatex).not.toMatch(/NaN|Infinity/);
            expect(renderInteractiveLatex(item.substitutedLatex), item.id).not.toContain('katex-error');
          }
        }
        let obs = plugin.engine.computeObservables(state, params);
        if (beat.autoFreeze) {
          expect(Number.isFinite(obs[beat.autoFreeze.observableKey]), beat.id).toBe(true);
          // Match the main stage fixed timestep, including initial observation.
          runner.checkAutoFreeze(obs);
          for (let i = 0; i < 15 * 240 && playing; i++) {
            state = plugin.engine.step(state, params, 1 / 240).nextState;
            obs = plugin.engine.computeObservables(state, params);
            runner.checkAutoFreeze(obs);
          }
          expect(freezes, beat.id).toBe(1);
          expect(playing, beat.id).toBe(false);
        } else if (playing) {
          state = plugin.engine.step(state, params, 1 / 240).nextState;
          expect(state).toBeDefined();
        }
      }
    }
  }, 30000);

  it('S02 compares numerical outputs rather than illustrative screen geometry', async () => {
    const plugin = await loadSimulationById('stse-em-devices-suite');
    if (!plugin || !isSimulationPluginV3(plugin)) throw new Error('Missing S02');
    const read = (id: string) => {
      const beat = plugin.storyDecks?.flatMap(deck => deck.beats).find(item => item.id === id);
      if (!beat?.paramPatch) throw new Error('Missing beat: ' + id);
      const params = resolvePluginParams(plugin.paramSchema, beat.paramPatch);
      return plugin.engine.computeObservables(plugin.engine.createInitialState(params), params);
    };
    const light = read('s02-spectrum-light').spectrometerRadiusM!;
    const heavy = read('s02-spectrum-heavy').spectrometerRadiusM!;
    expect(light).toBeGreaterThan(0);
    expect(heavy / light).toBeCloseTo(2, 12);
    expect(read('s02-select').selectedSpeed).toBeCloseTo(2e5);
    const electron = read('s02-hall-electron').hallVoltageMv!;
    const hole = read('s02-hall-hole').hallVoltageMv!;
    expect(electron).toBeLessThan(0);
    expect(hole).toBeCloseTo(-electron, 12);
    expect(read('s02-mhd-match').mhdOutputWatt).toBeCloseTo(288000, 6);
    expect(read('s02-mhd-match').mhdOutputWatt!).toBeGreaterThan(read('s02-mhd-low').mhdOutputWatt!);
  });
});

describe('mode-specific physical formula readouts', () => {
  it('E10 uniform field readout remains finite for zero charge-to-mass ratio', async () => {
    const p = await loadSimulationById('em-3d-magnetic-fields');
    if (!p) throw new Error('Missing E10');
    const params = resolvePluginParams(p.paramSchema, { geometryType: 'uniform-helix', qOverM: 0 });
    const items = p.formatFormulas?.(p.engine.createInitialState(params), params) ?? [];
    expect(items.map(item => item.id)).toContain('uniform-helix-state');
    expect(items.map(item => item.substitutedLatex).join(' ')).not.toMatch(/NaN|Infinity/);
    expect(items.map(item => item.id)).not.toContain('biot-savart-lorentz');
  });
  it('binary orbit and tokamak do not inherit unrelated diagnostic equations', async () => {
    for (const [id, patch, expected, excluded] of [
      ['astro-orbital-mechanics', { mode: 'binary-lagrange' }, 'binary-state', 'orbit-state'],
      ['stse-tokamak-magnetic-mirror', { mode: 'tokamak' }, 'tokamak-field', 'magnetic-mirror-mu']
    ] as const) {
      const p = await loadSimulationById(id);
      if (!p) throw new Error('Missing ' + id);
      const params = resolvePluginParams(p.paramSchema, patch);
      const items = p.formatFormulas?.(p.engine.createInitialState(params), params) ?? [];
      expect(items.map(item => item.id)).toContain(expected);
      expect(items.map(item => item.id)).not.toContain(excluded);
    }
  });
});
