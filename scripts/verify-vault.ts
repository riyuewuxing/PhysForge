import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeToSceneDsl } from '../packages/ai-copilot/src/index.js';
import {
  WorkspaceVaultStore,
  searchGlobalEntries,
  type BuiltinPresetAsset,
  type GlobalSearchEntry
} from '../packages/workspace-vault/src/index.js';
import { simulationCatalog } from '../simulations/catalog.js';
import { simulationPlugins } from '../simulations/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const presetsRoot = path.resolve(__dirname, '../content/presets');

async function main(): Promise<void> {
  if (simulationCatalog.length !== 43 || simulationPlugins.length !== 43) {
    throw new Error(
      `Expected 43 simulation units, got catalog=${simulationCatalog.length}, registry=${simulationPlugins.length}.`
    );
  }

  for (const entry of simulationCatalog) {
    if (!entry.meta.textbookRef.trim()) {
      throw new Error(`Model ${entry.meta.id} has empty textbookRef.`);
    }
  }

  const assets: BuiltinPresetAsset[] = [];
  if (fs.existsSync(presetsRoot)) {
    for (const file of fs.readdirSync(presetsRoot).filter((f) => f.endsWith('.json')).sort()) {
      const raw = JSON.parse(fs.readFileSync(path.join(presetsRoot, file), 'utf8')) as unknown;
      const dsl = normalizeToSceneDsl(raw);
      assets.push({
        id: dsl.presetId ?? file.replace(/\.json$/, ''),
        modelId: dsl.modelId,
        title: dsl.title ?? dsl.modelId,
        tags: ['V2-SceneDSL', dsl.modelId],
        params: dsl.params
      });
    }
  }

  const store = new WorkspaceVaultStore();
  const merged = await store.mergeBuiltinAssets(assets);
  const zipBytes = await store.exportZipBytes();
  const restored = await new WorkspaceVaultStore().importZipBytes(zipBytes);
  if (restored.length !== merged) {
    throw new Error(`Vault ZIP roundtrip mismatch: ${restored.length} vs ${merged}`);
  }

  const entries: GlobalSearchEntry[] = simulationCatalog.map((c) => ({
    kind: 'model',
    id: `model:${c.meta.id}`,
    modelId: c.meta.id,
    title: c.meta.title,
    subtitle: c.meta.textbookRef,
    keywords: [c.meta.id, ...c.meta.curriculumTags]
  }));
  const hits = searchGlobalEntries(entries, '量子隧穿');
  if (!hits.some((h) => h.entry.modelId === 'comp-relativity-quantum-tunneling')) {
    throw new Error('Global search smoke check failed to locate C03 tunneling model.');
  }

  console.log(
    `✓ Verified Vault + 43-unit catalog integrity: merged=${merged} builtin scenes, ZIP=${zipBytes.byteLength} B, search hits=${hits.length}`
  );
}

await main();
