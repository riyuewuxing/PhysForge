import { z } from 'zod';
import type { SceneDSL } from '@physforge/sim-sdk';
import { resolveCanonicalModelId } from '@physforge/simulations/catalog';

export const ParamValueSchema = z.union([z.number().finite(), z.boolean(), z.string()]);

export const SceneDSLSchema = z.object({
  schemaVersion: z.literal('2.0'),
  modelId: z.string().trim().min(1, 'SceneDSL 必须指定 modelId'),
  presetId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  params: z.record(z.string(), ParamValueSchema),
  visibleLayers: z.array(z.string().trim().min(1)).optional(),
  activeFrameId: z.string().trim().min(1).optional(),
  notes: z.string().optional()
});

export const LegacyPresetFileSchema = z.object({
  modelId: z.string().trim().min(1),
  preset: z.object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    description: z.string().optional(),
    params: z.record(z.string(), ParamValueSchema),
    visibleLayers: z.array(z.string().trim().min(1)).optional()
  })
});

export function normalizeToSceneDsl(raw: unknown): SceneDSL {
  const v2 = SceneDSLSchema.safeParse(raw);
  if (v2.success) {
    return {
      ...v2.data,
      modelId: resolveCanonicalModelId(v2.data.modelId)
    };
  }
  const legacy = LegacyPresetFileSchema.safeParse(raw);
  if (legacy.success) {
    return {
      schemaVersion: '2.0',
      modelId: resolveCanonicalModelId(legacy.data.modelId),
      presetId: legacy.data.preset.id,
      title: legacy.data.preset.name,
      params: legacy.data.preset.params,
      visibleLayers: legacy.data.preset.visibleLayers,
      notes: legacy.data.preset.description
    };
  }
  const details = v2.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ');
  throw new Error(`Invalid SceneDSL / Preset JSON: ${details}`);
}
