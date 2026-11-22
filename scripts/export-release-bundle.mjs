import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FLAGSHIP_SINGLEFILES = [
  'builder-composite-em-field',
  'wave-vibration-coupling',
  'em-induction-double-rod',
  'mech-block-conveyor',
  'optics-wave-interference',
  'modern-rutherford-bohr',
  'exp-electrical-error-lab',
  'comp-relativity-quantum-tunneling'
];

const targetList = process.argv.includes('--all')
  ? FLAGSHIP_SINGLEFILES
  : FLAGSHIP_SINGLEFILES.slice(0, 4);

console.log(`Packaging ${targetList.length} offline singlefile slices for Release...`);
for (const model of targetList) {
  execFileSync('node', ['apps/singlefile-exporter/export.mjs', '--model', model], {
    stdio: 'inherit'
  });
}

const outDir = path.resolve('apps/singlefile-exporter/dist');
const builtFiles = targetList.map((m) => path.join(outDir, `${m}.html`));
console.log(
  'Release singlefile artifacts ready:',
  builtFiles.map((f) => `${path.basename(f)} (${(fs.statSync(f).size / 1024).toFixed(1)} KB)`).join(', ')
);
