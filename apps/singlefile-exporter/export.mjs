import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function parseCliArgs(argv) {
  const args = { model: 'em-bounded-magnetic-field', preset: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') continue;
    if (token.startsWith('--model=')) args.model = token.slice('--model='.length);
    else if (token === '--model' && argv[i + 1]) args.model = argv[++i];
    else if (token.startsWith('--preset=')) args.preset = token.slice('--preset='.length);
    else if (token === '--preset' && argv[i + 1]) args.preset = argv[++i];
    else if (token.startsWith('--out=')) args.out = token.slice('--out='.length);
    else if (token === '--out' && argv[i + 1]) args.out = argv[++i];
  }
  return args;
}

const KNOWN_MODELS = [
  'em-bounded-magnetic-field',
  'wave-vibration-coupling',
  'em-induction-double-rod',
  'mech-block-conveyor'
];

async function main() {
  const { model, preset, out } = parseCliArgs(process.argv.slice(2));
  const pluginEntry = path.resolve(repoRoot, 'simulations', model, 'plugin.ts');
  if (!fs.existsSync(pluginEntry)) {
    throw new Error(`Target simulation plugin not found: ${pluginEntry}`);
  }

  const tempOutDir = path.resolve(__dirname, '.tmp-build', model);
  fs.rmSync(tempOutDir, { recursive: true, force: true });

  await build({
    root: __dirname,
    configFile: false,
    logLevel: 'warn',
    plugins: [
      react(),
      tailwindcss(),
      viteSingleFile({ removeViteModuleLoader: false })
    ],
    resolve: {
      alias: {
        '@physforge/target-plugin': pluginEntry
      }
    },
    define: {
      __INITIAL_PRESET_ID__: JSON.stringify(preset)
    },
    build: {
      outDir: tempOutDir,
      emptyOutDir: true,
      assetsInlineLimit: 100 * 1024 * 1024,
      cssCodeSplit: false
    }
  });

  const builtHtmlPath = path.join(tempOutDir, 'index.html');
  if (!fs.existsSync(builtHtmlPath)) {
    throw new Error(`Expected singlefile output missing at ${builtHtmlPath}`);
  }

  const html = fs.readFileSync(builtHtmlPath, 'utf8');
  const distDir = path.resolve(__dirname, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  const finalOutPath = out
    ? path.resolve(process.cwd(), out)
    : path.join(distDir, `${model}.html`);
  fs.mkdirSync(path.dirname(finalOutPath), { recursive: true });
  fs.writeFileSync(finalOutPath, html, 'utf8');
  fs.rmSync(tempOutDir, { recursive: true, force: true });

  // 严格安全与轻量化自检
  const leakedExternalCdn = /(https?:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net|esm\.sh))/i.test(html);
  if (leakedExternalCdn) {
    throw new Error(`Singlefile bundle ${finalOutPath} contains disallowed external CDN references!`);
  }
  const otherModels = KNOWN_MODELS.filter((m) => m !== model && html.includes(m));
  if (otherModels.length > 0) {
    throw new Error(
      `Singlefile bundle ${finalOutPath} leaked unrelated simulation models: ${otherModels.join(', ')}`
    );
  }
  if (html.includes('EXCALIDRAW_ASSET_PATH') || html.includes('@excalidraw/excalidraw')) {
    throw new Error(`Singlefile bundle ${finalOutPath} must not include Excalidraw!`);
  }

  const sizeKb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log(`Exported singlefile HTML for "${model}" -> ${finalOutPath} (${sizeKb} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
