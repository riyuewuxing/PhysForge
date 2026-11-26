import { resolvePluginParams, type InvariantReport, type SceneDSL } from '@physforge/sim-sdk';
import { loadSimulationById, type AnySimulationPlugin } from '@physforge/simulations/catalog';
import { normalizeToSceneDsl } from './sceneSchema.js';
import { formatModelSchemaHint } from './byokClient.js';

export interface SceneAuditResult {
  readonly passed: boolean;
  readonly scene: SceneDSL | null;
  readonly errors: readonly string[];
  readonly invariants: readonly InvariantReport[];
  readonly finalObservables: Readonly<Record<string, number>>;
}

export interface AuditSceneOptions {
  readonly steps?: number;
  readonly dt?: number;
  readonly pluginResolver?: (id: string) => Promise<AnySimulationPlugin | undefined>;
}

export async function auditSceneHeadless(
  rawCandidate: unknown,
  options: AuditSceneOptions = {}
): Promise<SceneAuditResult> {
  const errors: string[] = [];
  let scene: SceneDSL;
  try {
    scene = normalizeToSceneDsl(rawCandidate);
  } catch (err) {
    return {
      passed: false,
      scene: null,
      errors: [err instanceof Error ? err.message : String(err)],
      invariants: [],
      finalObservables: {}
    };
  }

  const resolveFn = options.pluginResolver ?? loadSimulationById;
  const plugin = await resolveFn(scene.modelId);
  if (!plugin) {
    return {
      passed: false,
      scene,
      errors: [`Unknown modelId "${scene.modelId}" in catalog.`],
      invariants: [],
      finalObservables: {}
    };
  }

  // Reject hallucinated keys before resolving defaults or invoking the engine.
  const allowedKeys = new Set(plugin.paramSchema.map((field) => field.key));
  for (const key of Object.keys(scene.params)) {
    if (!allowedKeys.has(key)) errors.push(`Unknown param "${key}" for model "${scene.modelId}".`);
  }

  // Validate supplied params against declared paramSchema (type & bounds)
  for (const field of plugin.paramSchema) {
    if (Object.prototype.hasOwnProperty.call(scene.params, field.key)) {
      const val = scene.params[field.key];
      if (field.kind === 'number') {
        if (typeof val !== 'number' || !Number.isFinite(val)) {
          errors.push(`Param "${field.key}" must be a finite number, got ${String(val)}.`);
        } else if (
          (field.min !== undefined && val < field.min) ||
          (field.max !== undefined && val > field.max)
        ) {
          errors.push(
            `Param "${field.key}"=${val} out of schema range [${field.min ?? '-inf'}, ${field.max ?? '+inf'}].`
          );
        }
      } else if (field.kind === 'boolean') {
        if (typeof val !== 'boolean') {
          errors.push(`Param "${field.key}" must be boolean.`);
        }
      } else if (field.kind === 'select') {
        if (typeof val !== 'string' || (field.customTextMaxLength!==undefined ? val.trim().length===0 || val.length>field.customTextMaxLength : !field.options.some((o) => o.value === val))) {
          errors.push(`Param "${field.key}"="${String(val)}" is not an allowed option.`);
        }
      }
    }
  }
  if (errors.length > 0) {
    errors.push(formatModelSchemaHint(scene.modelId, plugin.paramSchema));
    return { passed: false, scene, errors, invariants: [], finalObservables: {} };
  }

  const resolvedParams = resolvePluginParams(plugin.paramSchema, scene.params);
  let initial;
  let state;
  try {
    initial = plugin.engine.createInitialState(resolvedParams);
    state = initial;
  } catch (err) {
    return {
      passed: false,
      scene,
      errors: [`createInitialState threw: ${err instanceof Error ? err.message : String(err)}`],
      invariants: [],
      finalObservables: {}
    };
  }

  const steps = Math.max(1, options.steps ?? 40);
  const dt = options.dt ?? 0.02;
  const staticAnalytic = (typeof plugin.timeSemantics==='function'?plugin.timeSemantics(resolvedParams):plugin.timeSemantics) === 'static-analytic';
  try {
    if (staticAnalytic) {
      // Static experiments still exercise their solver and invariants. Only
      // an explicitly declared model can certify a zero-time terminal result.
      const initialObs = plugin.engine.computeObservables(initial, resolvedParams);
      if (initialObs.t !== 0 || Object.values(initialObs).some(v => !Number.isFinite(v))) {
        throw new Error('Static analytic initial observations must be finite with t=0.');
      }
      const step = plugin.engine.step(state, resolvedParams, dt);
      state = step.nextState;
      if (step.advancedTime !== 0 || step.halt !== true || step.events.length !== 0) {
        throw new Error('Static analytic solver must explicitly halt without advancing time or emitting time events.');
      }
      const finalObs = plugin.engine.computeObservables(state, resolvedParams);
      if (finalObs.t !== 0) throw new Error('Static analytic solver advanced physical time.');
    } else {
      for (let i = 0; i < steps; i++) {
        const step=plugin.engine.step(state,resolvedParams,dt);
        state=step.nextState;
        if(step.advancedTime===0)throw new Error('Engine did not advance; cannot certify headless physics.');
        if(step.halt)break;
      }
    }
  } catch (err) {
    plugin.engine.disposeState?.(state);
    return {
      passed: false,
      scene,
      errors: [`Simulation step threw at dt=${dt}: ${err instanceof Error ? err.message : String(err)}`],
      invariants: [],
      finalObservables: {}
    };
  }

  try {
  const finalObservables = plugin.engine.computeObservables(state, resolvedParams);
  for (const [k, v] of Object.entries(finalObservables)) {
    if (!Number.isFinite(v)) {
      errors.push(`Observable "${k}" became non-finite (${v}) during headless run.`);
    }
  }

  const invariants = plugin.engine.checkInvariants
    ? plugin.engine.checkInvariants(state, initial, resolvedParams)
    : [];
  if (staticAnalytic && invariants.length === 0) errors.push('Static analytic certification requires explicit physical invariants.');
  for (const inv of invariants) {
    if (!inv.passed) {
      errors.push(
        `Invariant "${inv.name}" failed: error=${inv.measuredError} > tol=${inv.tolerance}`
      );
    }
  }

  return {
    passed: errors.length === 0,
    scene: { ...scene, params: resolvedParams },
    errors,
    invariants,
    finalObservables
  };
  } finally { plugin.engine.disposeState?.(state); }
}

export interface RefineLoopResult {
  readonly accepted: boolean;
  readonly attempts: number;
  readonly finalScene: SceneDSL | null;
  readonly lastAudit: SceneAuditResult;
  readonly history: readonly { round: number; errors: readonly string[] }[];
}

export async function runGenerateThenRefine(
  generateCandidate: (round: number, previousFeedback?: string) => Promise<unknown> | unknown,
  options: AuditSceneOptions & { maxRounds?: number } = {}
): Promise<RefineLoopResult> {
  const maxRounds = Math.max(1, Math.min(5, options.maxRounds ?? 3));
  let feedback: string | undefined;
  let lastAudit: SceneAuditResult = {
    passed: false,
    scene: null,
    errors: ['No refinement round executed'],
    invariants: [],
    finalObservables: {}
  };
  const history: { round: number; errors: readonly string[] }[] = [];

  for (let round = 1; round <= maxRounds; round++) {
    const candidate = await generateCandidate(round, feedback);
    lastAudit = await auditSceneHeadless(candidate, options);
    history.push({ round, errors: lastAudit.errors });
    if (lastAudit.passed) {
      return {
        accepted: true,
        attempts: round,
        finalScene: lastAudit.scene,
        lastAudit,
        history
      };
    }
    feedback = lastAudit.errors.join(' | ');
  }

  return {
    accepted: false,
    attempts: maxRounds,
    finalScene: lastAudit.scene,
    lastAudit,
    history
  };
}
