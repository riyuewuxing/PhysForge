import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditSceneHeadless } from '../packages/ai-copilot/src/index.js';
import { getSimulationById } from '../simulations/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const presetsRoot = path.resolve(__dirname, '../content/presets');

function collectJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsonFiles(full));
    } else if (entry.name.endsWith('.json')) {
      results.push(full);
    }
  }
  return results.sort();
}

async function main(): Promise<void> {
  const customFileArg = process.argv.find((a) => a.startsWith('--file='));
  const targets = customFileArg
    ? [path.resolve(process.cwd(), customFileArg.slice('--file='.length))]
    : collectJsonFiles(presetsRoot);

  if (targets.length === 0) {
    throw new Error(`No SceneDSL / preset JSON files found under ${presetsRoot}.`);
  }

  let verifiedCount = 0;
  for (const file of targets) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    const audit = await auditSceneHeadless(raw, {
      steps: 60,
      dt: 0.02,
      pluginResolver: async (id) => getSimulationById(id)
    });
    if (!audit.passed || !audit.scene) {
      throw new Error(
        `Scene audit FAILED for ${path.relative(process.cwd(), file)}: ${audit.errors.join(' | ')}`
      );
    }
    verifiedCount++;
    console.log(
      `✓ Verified scene "${audit.scene.modelId}" (${path.basename(file)}): ${audit.invariants.length} invariants passed`
    );
  }

  console.log(`All ${verifiedCount} SceneDSL / preset files passed Zod + headless physics audit!`);
}

await main();
