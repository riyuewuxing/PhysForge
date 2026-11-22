import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTeachingPack } from '../packages/pedagogy-schema/src/index.js';
import { resolvePluginParams, type PhysicsEvent } from '../packages/sim-sdk/src/index.js';
import { getSimulationById } from '../simulations/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packsDir = path.resolve(__dirname, '../content/teaching-packs');

const SIM_STEP_DT = 1 / 240;

function runPluginToHorizon(
  modelId: string,
  presetId: string,
  durationSec: number
): { observables: Record<string, number>; events: PhysicsEvent[] } {
  const plugin = getSimulationById(modelId);
  if (!plugin) {
    throw new Error(`Unknown modelId "${modelId}" in teaching pack.`);
  }
  const preset = plugin.presets.find((p) => p.id === presetId);
  if (!preset) {
    throw new Error(`Unknown presetId "${presetId}" for model "${modelId}".`);
  }

  const params = resolvePluginParams(plugin.paramSchema, preset.params);
  let state = plugin.engine.createInitialState(params);
  const allEvents: PhysicsEvent[] = [];

  const totalSteps = Math.round(durationSec / SIM_STEP_DT);
  for (let i = 0; i < totalSteps; i++) {
    const res = plugin.engine.step(state, params, SIM_STEP_DT);
    state = res.nextState;
    if (res.events.length > 0) {
      allEvents.push(...res.events);
    }
  }

  const observables = plugin.engine.computeObservables(state, params);
  return { observables, events: allEvents };
}

function assertPresetExists(modelId: string, presetId: string, context: string): void {
  const plugin = getSimulationById(modelId);
  if (!plugin) {
    throw new Error(`[${context}] Referenced modelId "${modelId}" not found in registry.`);
  }
  const found = plugin.presets.some((p) => p.id === presetId);
  if (!found) {
    throw new Error(
      `[${context}] Referenced presetId "${presetId}" not found in model "${modelId}".`
    );
  }
}

function main(): void {
  if (!fs.existsSync(packsDir)) {
    throw new Error(`Teaching packs directory missing: ${packsDir}`);
  }

  const files = fs
    .readdirSync(packsDir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No teaching pack JSON files found in ${packsDir}.`);
  }

  let verifiedQuestions = 0;

  for (const file of files) {
    const fullPath = path.join(packsDir, file);
    const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as unknown;
    const pack = parseTeachingPack(raw);

    for (const poe of pack.poeWorksheets) {
      assertPresetExists(poe.modelId, poe.presetId, `${file}:poe:${poe.id}`);
    }

    for (const mis of pack.misconceptions) {
      assertPresetExists(
        mis.counterExampleModelId,
        mis.counterExamplePresetId,
        `${file}:misconception:${mis.id}`
      );
    }

    for (const q of pack.variantQuestions) {
      assertPresetExists(q.modelId, q.presetId, `${file}:question:${q.id}`);
      const metricEntries = Object.entries(q.verification.expectedMetrics);
      if (metricEntries.length === 0) {
        throw new Error(
          `[${file}:question:${q.id}] verification.expectedMetrics must specify at least 1 metric.`
        );
      }

      const durationSec = q.verification.simDurationSec ?? 0;
      const tol = q.verification.tolerance ?? 1e-3;
      const { observables, events } = runPluginToHorizon(q.modelId, q.presetId, durationSec);

      const metricBag: Record<string, number> = {
        ...observables,
        eventCount: events.length
      };
      if (events[0]) {
        metricBag.firstEventTime = events[0].time;
      }
      const lastEvent = events[events.length - 1];
      if (lastEvent) {
        metricBag.lastEventTime = lastEvent.time;
      }

      for (const [key, expected] of metricEntries) {
        const actual = metricBag[key];
        if (actual === undefined || !Number.isFinite(actual)) {
          throw new Error(
            `[${file}:question:${q.id}] Metric "${key}" missing from simulation output. Available keys: ${Object.keys(metricBag).join(', ')}`
          );
        }
        const absDiff = Math.abs(actual - expected);
        const scale = Math.max(1, Math.abs(expected));
        if (absDiff > tol * scale) {
          throw new Error(
            `[${file}:question:${q.id}] Metric "${key}" mismatch: expected=${expected}, actual=${actual}, diff=${absDiff} > tol*scale=${tol * scale}`
          );
        }
      }

      verifiedQuestions++;
    }

    console.log(
      `✓ Verified pack "${pack.id}" (${file}): ${pack.poeWorksheets.length} POE, ${pack.variantQuestions.length} questions, ${pack.misconceptions.length} misconceptions`
    );
  }

  console.log(
    `All ${files.length} teaching packs (${verifiedQuestions} physics-verified questions) passed!`
  );
}

main();
