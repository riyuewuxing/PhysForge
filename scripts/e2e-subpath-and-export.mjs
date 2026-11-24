import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(scriptDir, '../apps/web/dist');
const basePrefix = '/PhysForge/';

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2'
};

function isWithinDirectory(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function startSubpathServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      let requestPath;
      try {
        requestPath = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
      } catch {
        response.writeHead(400);
        response.end('Bad request path');
        return;
      }

      if (!requestPath.startsWith(basePrefix)) {
        response.writeHead(404);
        response.end(`Forbidden root path leak: ${requestPath}`);
        return;
      }

      let relativePath = requestPath.slice(basePrefix.length);
      if (!relativePath || relativePath.endsWith('/')) relativePath += 'index.html';
      const filePath = path.resolve(distDir, relativePath);
      if (!isWithinDirectory(distDir, filePath) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        response.writeHead(404);
        response.end(`Not Found: ${requestPath}`);
        return;
      }

      response.writeHead(200, {
        'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff'
      });
      fs.createReadStream(filePath).pipe(response);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to start the subpath static server.'));
        return;
      }
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function launchBrowser() {
  const configuredPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  const attempts = [
    configuredPath ? { executablePath: configuredPath } : null,
    { channel: 'chrome' },
    { channel: 'msedge' },
    {}
  ].filter(Boolean);
  let lastError;
  for (const options of attempts) {
    try {
      return await chromium.launch({ ...options, headless: true });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Unable to launch Chromium, Chrome, or Edge: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function main() {
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error('apps/web/dist/index.html 不存在，请先运行 VITE_BASE_PATH=/PhysForge/ pnpm build');
  }

  const { server, origin } = await startSubpathServer();
  let browser;
  const consoleErrors = [];
  const pageErrors = [];
  const failedResponses = [];
  const externalRequests = [];

  try {
    const rootLeakResponse = await fetch(`${origin}/index.html`);
    if (rootLeakResponse.status !== 404) {
      throw new Error(`Root path must be rejected with 404, received ${rootLeakResponse.status}`);
    }

    browser = await launchBrowser();
    // This pass validates subpath routing and exports; service-worker lifecycle is exercised separately from the static preview server.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
    });
    page.on('request', (request) => {
      const requestUrl = request.url();
      if (!requestUrl.startsWith(origin) && !requestUrl.startsWith('data:') && !requestUrl.startsWith('blob:')) {
        externalRequests.push(requestUrl);
      }
    });

    await page.addInitScript(() => {
      window.__CAPTURED_BLOBS = [];
      const createObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (value) => {
        if (value instanceof Blob) window.__CAPTURED_BLOBS.push(value);
        return createObjectURL(value);
      };
    });

    await page.goto(`${origin}${basePrefix}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="simulation-canvas"]', { timeout: 15000 });
    // Start the fixed-step loop so the canvas produces advancing frames in headless browsers.
    await page.getByTestId('btn-play-pause').click();
    await page.waitForTimeout(500);

    const directRecorderCheck = await page.evaluate(async () => {
      const canvas = document.querySelector('[data-testid="simulation-canvas"]');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('未找到主 Canvas');
      const candidates = ['video/webm', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', '']
        .filter((candidate) => !candidate || MediaRecorder.isTypeSupported(candidate));
      if (candidates.length === 0) throw new Error('浏览器不支持 WebM MediaRecorder');

      let lastResult = null;
      for (const mimeType of candidates) {
        const stream = canvas.captureStream(30);
        const chunks = [];
        const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        const videoTrack = stream.getVideoTracks()[0];
        let dataEvents = 0;
        recorder.ondataavailable = (event) => {
          dataEvents++;
          if (event.data.size > 0) chunks.push(event.data);
        };
        const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
        recorder.start(100);
        if (videoTrack && typeof videoTrack.requestFrame === 'function') videoTrack.requestFrame();
        await new Promise((resolve) => setTimeout(resolve, 800));
        if (recorder.state === 'recording') {
          if (videoTrack && typeof videoTrack.requestFrame === 'function') videoTrack.requestFrame();
          recorder.requestData();
        }
        recorder.stop();
        await stopped;
        for (const track of stream.getTracks()) track.stop();

        const blob = new Blob(chunks, { type: mimeType || recorder.mimeType || 'video/webm' });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        lastResult = {
          size: blob.size,
          mimeType: mimeType || recorder.mimeType || 'default',
          isEbml: bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3,
          dataEvents,
          track: videoTrack ? {
            kind: videoTrack.kind,
            readyState: videoTrack.readyState,
            muted: videoTrack.muted,
            width: videoTrack.getSettings().width,
            height: videoTrack.getSettings().height,
            supportsRequestFrame: typeof videoTrack.requestFrame === 'function'
          } : null,
          canvas: { width: canvas.width, height: canvas.height, pixels: canvas.toDataURL().length }
        };
        if (lastResult.size > 0 && lastResult.isEbml) return lastResult;
      }
      return lastResult;
    });
    if (directRecorderCheck.size <= 0 || !directRecorderCheck.isEbml) {
      throw new Error(`Canvas WebM 非空/EBML 校验失败: ${JSON.stringify(directRecorderCheck)}`);
    }

    await page.getByTestId('btn-export-studio').click();
    await page.waitForSelector('[data-testid="export-studio-drawer"]');
    await page.getByTestId('tab-export-media').click();

    const pngDownloadPromise = page.waitForEvent('download');
    await page.getByTestId('btn-strobe-composite').click();
    const pngDownload = await pngDownloadPromise;
    if (!pngDownload.suggestedFilename().endsWith('.png')) {
      throw new Error(`频闪导出文件扩展名错误: ${pngDownload.suggestedFilename()}`);
    }
    const pngCheck = await page.evaluate(async () => {
      const blob = [...window.__CAPTURED_BLOBS].reverse().find((entry) => entry.type === 'image/png');
      if (!blob) return { found: false, size: 0, signature: [] };
      return {
        found: true,
        size: blob.size,
        signature: [...new Uint8Array(await blob.slice(0, 4).arrayBuffer())]
      };
    });
    if (!pngCheck.found || pngCheck.size <= 500 || pngCheck.signature.join(',') !== '137,80,78,71') {
      throw new Error(`频闪 PNG 魔数/大小校验失败: ${JSON.stringify(pngCheck)}`);
    }

    await page.getByTestId('btn-toggle-webm-record').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="btn-toggle-webm-record"]')?.textContent?.includes('停止'));
    await page.waitForTimeout(800);
    const webmDownloadPromise = page.waitForEvent('download');
    await page.getByTestId('btn-toggle-webm-record').click();
    const webmDownload = await webmDownloadPromise;
    if (!webmDownload.suggestedFilename().endsWith('.webm')) {
      throw new Error(`WebM 录屏导出扩展名错误: ${webmDownload.suggestedFilename()}`);
    }
    const webmCheck = await page.evaluate(async () => {
      const blob = [...window.__CAPTURED_BLOBS].reverse().find((entry) => entry.type.startsWith('video/webm'));
      if (!blob) return { found: false, size: 0, type: '', isEbml: false };
      const bytes = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
      return {
        found: true,
        size: blob.size,
        type: blob.type,
        isEbml: bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
      };
    });
    if (!webmCheck.found || webmCheck.size <= 0 || !webmCheck.isEbml) {
      throw new Error(`导出工坊 WebM Blob 为空或缺少 EBML 头: ${JSON.stringify(webmCheck)}`);
    }

    await page.getByTestId('tab-export-svg').click();
    const svgDownloadPromise = page.waitForEvent('download');
    await page.getByTestId('btn-download-svg').click();
    const svgDownload = await svgDownloadPromise;
    const svgText = await page.evaluate(async () => {
      const blob = [...window.__CAPTURED_BLOBS].reverse().find((entry) => entry.type.startsWith('image/svg+xml'));
      return blob ? blob.text() : null;
    });
    if (!svgDownload.suggestedFilename().endsWith('.svg')) throw new Error(`SVG export filename is ${svgDownload.suggestedFilename()}`);
    if (typeof svgText !== 'string' || !svgText.includes('<svg') || !svgText.includes('</svg>')) {
      throw new Error('SVG 导出内容缺失或无效');
    }

    await page.getByTestId('tab-export-tikz').click();
    const tikzDownloadPromise = page.waitForEvent('download');
    await page.getByTestId('btn-download-tikz').click();
    const tikzDownload = await tikzDownloadPromise;
    const tikzText = await page.evaluate(async () => {
      const blob = [...window.__CAPTURED_BLOBS].reverse().find((entry) => entry.type.startsWith('text/plain'));
      return blob ? blob.text() : null;
    });
    if (!tikzDownload.suggestedFilename().endsWith('.tex')) throw new Error(`TikZ export filename is ${tikzDownload.suggestedFilename()}`);
    if (typeof tikzText !== 'string' || !tikzText.includes('\\begin{tikzpicture}') || !tikzText.includes('\\end{tikzpicture}')) {
      throw new Error('TikZ 导出内容缺失或无效');
    }

    await page.getByTestId('btn-close-export-studio').click();
    await page.getByTestId('rail-btn-catalog').click();
    await page.getByTestId('model-card-stse-tokamak-magnetic-mirror').click();
    await page.waitForSelector('[data-testid="three-stage-container"]', { timeout: 15000 });
    await page.getByTestId('rail-btn-catalog').click();
    await page.getByTestId('model-card-stse-em-devices-suite').click();
    await page.waitForSelector('[data-testid="three-stage-container"]', { state: 'detached', timeout: 15000 });

    // Actual pointer gesture: formula token identity survives parameter changes.
    const fieldSlider = page.getByTestId('param-slider-eFieldVPerM');
    await fieldSlider.waitFor({ timeout: 15000 });
    const beforeField = Number(await fieldSlider.inputValue());
    await page.getByTestId('btn-fullscreen-speech').click();
    const fieldToken = page.locator('[data-testid="live-formula-velocity-selector"] [data-param="eFieldVPerM"]').first();
    await fieldToken.waitFor({ timeout: 15000 });
    await fieldToken.evaluate(node => { window.__PF_TEST_TOKEN = node; });
    const tokenBox = await fieldToken.boundingBox();
    if (!tokenBox) throw new Error('Live formula token not visible');
    const x = tokenBox.x + tokenBox.width / 2, y = tokenBox.y + tokenBox.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + (beforeField > 300000 ? -60 : 60), y, { steps: 6 });
    await page.getByTestId('live-formula-hud').waitFor({ state: 'visible' });
    if (!await fieldToken.evaluate(node => node === window.__PF_TEST_TOKEN)) throw new Error('Live formula token was replaced during pointer capture');
    await page.mouse.up();
    await page.getByTestId('live-formula-hud').waitFor({ state: 'hidden' });
    await page.getByTestId('btn-exit-fullscreen-speech').click();
    await fieldSlider.waitFor({ timeout: 15000 });
    const afterField = Number(await fieldSlider.inputValue());
    if (!Number.isFinite(afterField) || afterField === beforeField) throw new Error('Live formula did not update actual model parameter');
    await page.getByTestId('btn-fullscreen-speech').click();
    await fieldToken.dblclick();
    await page.getByTestId('btn-exit-fullscreen-speech').click();
    if (Number(await fieldSlider.inputValue()) !== 200000) throw new Error('Live formula double click did not restore schema default');

    // Presenter is a second page in the same origin/profile. It must not mount another simulation.
    await page.getByTestId('btn-fullscreen-speech').click();
    await page.getByTestId('btn-toggle-story').click();
    await page.getByTestId('story-caption').waitFor({ timeout: 15000 });
    const presenterPopup = page.waitForEvent('popup');
    await page.getByTestId('btn-presenter').click();
    const presenter = await presenterPopup;
    presenter.on('pageerror', (error) => pageErrors.push(error.message));
    presenter.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    presenter.on('response', (response) => { if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`); });
    presenter.on('request', (request) => { if (/^https?:/.test(request.url()) && !request.url().startsWith(origin + basePrefix)) externalRequests.push(request.url()); });
    await presenter.getByTestId('presenter-view').waitFor({ timeout: 15000 });
    await presenter.waitForFunction(() => document.querySelector('[data-testid="presenter-connection"]')?.textContent === '主屏已连接');
    if (new URL(presenter.url()).pathname !== basePrefix || await presenter.getByTestId('simulation-canvas').count() || await presenter.getByTestId('three-stage-container').count()) {
      throw new Error('Presenter path incorrect or second simulation mounted');
    }
    const originalBeat = await page.getByTestId('story-progress').textContent();
    await presenter.getByTestId('presenter-next').click();
    await page.waitForFunction((old) => document.querySelector('[data-testid="story-progress"]')?.textContent !== old, originalBeat);
    await presenter.getByTestId('presenter-blackout').click();
    await page.getByTestId('story-blackout').waitFor({ timeout: 5000 });
    await presenter.getByTestId('presenter-blackout').click();
    await page.getByTestId('story-blackout').waitFor({ state: 'detached', timeout: 5000 });
    await presenter.close();
    await page.getByTestId('btn-exit-fullscreen-speech').click();

    if (consoleErrors.length || pageErrors.length || failedResponses.length || externalRequests.length) {
      throw new Error(JSON.stringify({ consoleErrors, pageErrors, failedResponses, externalRequests }, null, 2));
    }

    console.log('E2E_SUBPATH_AND_EXPORT: PASS', {
      directWebmBytes: directRecorderCheck.size,
      pngBytes: pngCheck.size,
      drawerWebmBytes: webmCheck.size
    });
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
