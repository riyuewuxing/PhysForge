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
  const args = { model: 'em-bounded-magnetic-field', preset: null, presetFile: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') continue;
    if (token.startsWith('--model=')) args.model = token.slice('--model='.length);
    else if (token === '--model' && argv[i + 1]) args.model = argv[++i];
    else if (token.startsWith('--preset=')) args.preset = token.slice('--preset='.length);
    else if (token === '--preset' && argv[i + 1]) args.preset = argv[++i];
    else if (token.startsWith('--preset-file='))
      args.presetFile = token.slice('--preset-file='.length);
    else if (token === '--preset-file' && argv[i + 1]) args.presetFile = argv[++i];
    else if (token.startsWith('--out=')) args.out = token.slice('--out='.length);
    else if (token === '--out' && argv[i + 1]) args.out = argv[++i];
  }
  return args;
}

const MODEL_ALIAS_TO_DIR = {
  'builder-composite-em-field': 'em-bounded-magnetic-field',
  'builder-circuit-mna': 'circuit-dc-capacitor-mna',
  'builder-optics-ray': 'optics-ray-studio',
  'builder-mechanics-lab': 'mech-free-sandbox'
};

const KNOWN_MODELS = [
  'em-bounded-magnetic-field',
  'builder-composite-em-field',
  'wave-vibration-coupling',
  'em-induction-double-rod',
  'mech-block-conveyor',
  'optics-ray-studio',
  'builder-optics-ray',
  'mech-free-sandbox',
  'builder-mechanics-lab',
  'circuit-dc-capacitor-mna',
  'builder-circuit-mna',
  'builder-custom-ode-lab',
  'mech-kinematics-chase',
  'mech-dynamic-equilibrium',
  'mech-constrained-velocity',
  'mech-projectile-coupling',
  'mech-vertical-circular',
  'mech-conical-turntable',
  'mech-spring-separation',
  'mech-collision-recoil',
  'astro-orbital-mechanics',
  'mech-shm-resonance',
  'em-electrostatic-field',
  'em-capacitor-millikan',
  'em-ac-field-oscilloscope',
  'em-wireframe-rotation',
  'em-eddy-vortex-field',
  'em-ac-generator-rms',
  'em-transformer-grid',
  'em-lc-rlc-oscillation',
  'em-3d-magnetic-fields',
  'wave-2d-ripple-fdtd',
  'optics-wave-interference',
  'thermo-piston-gas-laws',
  'thermo-cycles-kinetic-md',
  'modern-photoelectric-compton',
  'modern-rutherford-bohr',
  'modern-nuclear-recoil-decay',
  'stse-tokamak-magnetic-mirror',
  'stse-em-devices-suite',
  'stse-em-launch-regen-brake',
  'stse-gravity-assist-rendezvous',
  'exp-mechanics-error-lab',
  'exp-electrical-error-lab',
  'comp-rigid-rolling-slip',
  'comp-chaos-normal-coriolis',
  'comp-relativity-quantum-tunneling'
];

function isSameModelGroup(a, b) {
  if (a === b) return true;
  const da = MODEL_ALIAS_TO_DIR[a] ?? a;
  const db = MODEL_ALIAS_TO_DIR[b] ?? b;
  return da === db;
}

async function main() {
  const parsedArgs = parseCliArgs(process.argv.slice(2));
  let model = parsedArgs.model;
  const preset = parsedArgs.preset;
  const out = parsedArgs.out;

  let presetData = null;
  if (parsedArgs.presetFile) {
    const candCwd = path.resolve(process.cwd(), parsedArgs.presetFile);
    const candRoot = path.resolve(repoRoot, parsedArgs.presetFile);
    const absPresetPath = fs.existsSync(candCwd) ? candCwd : candRoot;
    if (!fs.existsSync(absPresetPath)) {
      throw new Error(`Preset JSON file not found: ${candCwd} (also checked ${candRoot})`);
    }
    const rawJson = JSON.parse(fs.readFileSync(absPresetPath, 'utf8'));
    if (typeof rawJson.modelId === 'string' && rawJson.modelId.trim()) {
      model = rawJson.modelId;
    }
    if (rawJson.preset && typeof rawJson.preset === 'object') {
      presetData = {
        presetId: rawJson.preset.id,
        name: rawJson.preset.name,
        params: rawJson.preset.params,
        visibleLayers: rawJson.preset.visibleLayers
      };
    } else if (rawJson.params && typeof rawJson.params === 'object') {
      presetData = {
        presetId: rawJson.presetId,
        name: rawJson.title,
        params: rawJson.params,
        visibleLayers: rawJson.visibleLayers
      };
    } else {
      throw new Error(`Invalid preset file format in ${absPresetPath}`);
    }
  }

  const pluginDirName = MODEL_ALIAS_TO_DIR[model] ?? model;
  const pluginEntry = path.resolve(repoRoot, 'simulations', pluginDirName, 'plugin.ts');
  if (!fs.existsSync(pluginEntry)) {
    throw new Error(`Target simulation plugin not found: ${pluginEntry}`);
  }

  const tempOutDir = path.resolve(__dirname, '.tmp-build', pluginDirName);
  fs.rmSync(tempOutDir, { recursive: true, force: true });

  await build({
    root: __dirname,
    configFile: false,
    logLevel: 'warn',
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'physforge-no-three-module-leak',
        renderChunk(_code, chunk) {
          const leaked = Object.keys(chunk.modules).filter(id =>
            id.replace(/\\/g, '/').includes('/node_modules/three/')
          );
          if (leaked.length) this.error('Singlefile bundle contains Three.js modules: ' + leaked.join(', '));
          return null;
        }
      },
      viteSingleFile({ removeViteModuleLoader: false })
    ],
    resolve: {
      alias: {
        '@physforge/target-plugin': pluginEntry
      }
    },
    define: {
      __INITIAL_PRESET_ID__: JSON.stringify(preset),
      __INITIAL_PRESET_DATA__: JSON.stringify(presetData)
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
    ? path.isAbsolute(out)
      ? out
      : out.replace(/\\/g, '/').startsWith('apps/singlefile-exporter/')
        ? path.resolve(repoRoot, out)
        : path.resolve(process.cwd(), out)
    : path.join(distDir, `${model}.html`);
  fs.rmSync(tempOutDir, { recursive: true, force: true });

  // 严格安全与轻量化自检
  const leakedExternalCdn = /(https?:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net|esm\.sh))/i.test(html);
  if (leakedExternalCdn) {
    throw new Error(`Singlefile bundle ${finalOutPath} contains disallowed external CDN references!`);
  }
  const otherModels = KNOWN_MODELS.filter((m) => !isSameModelGroup(m, model) && html.includes(m));
  if (otherModels.length > 0) {
    throw new Error(
      `Singlefile bundle ${finalOutPath} leaked unrelated simulation models: ${otherModels.join(', ')}`
    );
  }
  if (html.includes('EXCALIDRAW_ASSET_PATH') || html.includes('@excalidraw/excalidraw')) {
    throw new Error(`Singlefile bundle ${finalOutPath} must not include Excalidraw!`);
  }
  if (!isSameModelGroup(model, 'mech-free-sandbox') && html.includes('rapier_wasm2d')) {
    throw new Error(`Singlefile bundle ${finalOutPath} must not include Rapier2D WASM!`);
  }
  if (html.includes('papaparse') || html.includes('PapaParse')) {
    throw new Error(`Singlefile bundle ${finalOutPath} must not include papaparse!`);
  }
  if (html.includes('fflate') && html.includes('physforge-workspace-vault')) {
    throw new Error(`Singlefile bundle ${finalOutPath} must not include workspace-vault/fflate!`);
  }
  if (html.includes('OrbitControls') || html.includes('THREE.WebGLRenderer')) {
    throw new Error(`Singlefile bundle ${finalOutPath} must not include Three.js!`);
  }
  if (model !== 'builder-custom-ode-lab' && html.includes('mathjs')) {
    throw new Error(`Singlefile bundle ${finalOutPath} must not include mathjs!`);
  }

  const bytes = Buffer.byteLength(html, 'utf8');
  // V3 flagship slices remain lightweight and strictly 2D; unrelated models retain their own constraints.
  const flagship = ['em-3d-magnetic-fields', 'em-induction-double-rod', 'builder-composite-em-field',
    'stse-em-devices-suite', 'stse-tokamak-magnetic-mirror', 'astro-orbital-mechanics'];
  if (flagship.some(id => isSameModelGroup(model, id)) && bytes >= 2_500_000) {
    throw new Error(`V3 flagship singlefile exceeds 2.5 MB: ${finalOutPath} (${bytes} bytes)`);
  }
  // Publish only after every isolation and size gate succeeds; a rejected build must not overwrite a previous valid export.
  fs.mkdirSync(path.dirname(finalOutPath), { recursive: true });
  fs.writeFileSync(finalOutPath, html, 'utf8');
  const sizeKb = (bytes / 1024).toFixed(1);
  console.log(`Exported singlefile HTML for "${model}" -> ${finalOutPath} (${sizeKb} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
