import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(path.join(repoRoot, 'apps/web/package.json'));
const vitePath = require.resolve('vite');
const { createServer } = await import(pathToFileURL(vitePath).href);

async function main() {
  const server = await createServer({
    root: repoRoot,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    logLevel: 'silent'
  });

  try {
    await server.ssrLoadModule('/scripts/verify-scenes.ts');
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
