import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME_MAP: Record<string, string> = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.json': 'application/json; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function copyDirRecursive(srcDir: string, destDir: string): void {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 将 @excalidraw/excalidraw 本地字体与语言包映射至 /excalidraw-assets/，彻底消除运行时外网 CDN 请求
 */
function excalidrawOfflineAssetsPlugin(): Plugin {
  const excalidrawProdDir = path.resolve(
    __dirname,
    'node_modules/@excalidraw/excalidraw/dist/prod'
  );
  const distAssetsDir = path.resolve(__dirname, 'dist/excalidraw-assets');

  const serveMiddleware = (
    req: { url?: string },
    res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: Buffer) => void },
    next: () => void
  ) => {
    const rawUrl = req.url?.split('?')[0];
    if (!rawUrl || !rawUrl.startsWith('/excalidraw-assets/')) {
      next();
      return;
    }
    const rel = rawUrl.replace(/^\/excalidraw-assets\//, '');
    const candidate = path.resolve(excalidrawProdDir, rel);
    if (!candidate.startsWith(excalidrawProdDir) || !fs.existsSync(candidate)) {
      next();
      return;
    }
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) {
      next();
      return;
    }
    const ext = path.extname(candidate).toLowerCase();
    res.setHeader('Content-Type', MIME_MAP[ext] ?? 'application/octet-stream');
    res.end(fs.readFileSync(candidate));
  };

  return {
    name: 'physforge-excalidraw-offline-assets',
    configureServer(server) {
      server.middlewares.use(serveMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveMiddleware);
    },
    closeBundle() {
      copyDirRecursive(path.join(excalidrawProdDir, 'fonts'), path.join(distAssetsDir, 'fonts'));
      copyDirRecursive(
        path.join(excalidrawProdDir, 'locales'),
        path.join(distAssetsDir, 'locales')
      );
    }
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    excalidrawOfflineAssetsPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'PhysForge 高中物理可视化教学工作台',
        short_name: 'PhysForge',
        description: '离线优先、高数值精度高中物理仿真与白板批注平台',
        theme_color: '#0b1628',
        background_color: '#0b1628',
        display: 'standalone',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,json}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024
      }
    })
  ],
  server: {
    port: 5173
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
