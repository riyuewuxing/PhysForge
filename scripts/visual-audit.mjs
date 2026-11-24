import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(SCRIPT_DIR, '../apps/web/dist');
const OUT_DIR = path.resolve(SCRIPT_DIR, '../artifacts/ui-audit');
const VIEWPORT = { width: 1440, height: 900 };
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function isWithinDirectory(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function startDistServer() {
  const realDist = fs.realpathSync(DIST_DIR);
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      let requestPath;
      try {
        requestPath = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
      } catch {
        response.writeHead(400).end('Bad request path');
        return;
      }

      if (requestPath === '/favicon.ico') {
        response.writeHead(204).end();
        return;
      }

      const normalizedPath = requestPath.startsWith('/PhysForge/')
        ? requestPath.slice('/PhysForge/'.length)
        : requestPath.replace(/^\/+/, '');
      const relativePath = normalizedPath && !normalizedPath.endsWith('/')
        ? normalizedPath
        : `${normalizedPath}index.html`;
      const unresolvedPath = path.resolve(DIST_DIR, relativePath);
      if (!isWithinDirectory(DIST_DIR, unresolvedPath) || !fs.existsSync(unresolvedPath)) {
        response.writeHead(404).end(`Not found: ${requestPath}`);
        return;
      }

      let filePath;
      try {
        filePath = fs.realpathSync(unresolvedPath);
      } catch {
        response.writeHead(404).end(`Not found: ${requestPath}`);
        return;
      }
      if (!isWithinDirectory(realDist, filePath) || fs.statSync(filePath).isDirectory()) {
        response.writeHead(404).end(`Not found: ${requestPath}`);
        return;
      }

      response.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff'
      });
      fs.createReadStream(filePath).pipe(response);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not start the UI audit preview server.'));
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

async function canvasFingerprint(page, selector = '[data-testid="simulation-canvas"]') {
  return page.locator(selector).evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0 || canvas.height === 0) {
      return { width: canvas.width, height: canvas.height, hash: '' };
    }
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let i = 0; i < pixels.length; i += 97) {
      hash ^= pixels[i] ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    return { width: canvas.width, height: canvas.height, hash: (hash >>> 0).toString(16) };
  });
}

async function screenshotFingerprint(locator) {
  const screenshot = await locator.screenshot({ animations: 'disabled' });
  return { hash: createHash('sha256').update(screenshot).digest('hex') };
}

async function readDisplayedTime(page) {
  return page.locator('[data-testid="topbar"]').evaluate((header) => {
    const match = (header.textContent ?? '').match(/t\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*s/i);
    return match ? Number(match[1]) : null;
  });
}

async function readLayoutMetrics(page, expectScopeHidden, expectedTitle, hideEnergyBars = false) {
  return page.evaluate(({ hideScope, hideEnergy, title }) => {
    const rectOf = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const header = rectOf('[data-testid="topbar"]');
    const rail = rectOf('[data-testid="left-catalog-rail"]');
    const panel = rectOf('[data-testid="right-control-panel"]');
    const titleText = document.querySelector('[data-testid="topbar"] > div')?.textContent?.trim() ?? '';
    const formulaNodes = [...document.querySelectorAll('[data-testid="formula-card"] .pf-right-formula')];
    const formulaOverflows = formulaNodes.some((node) => node.scrollWidth > node.clientWidth + 2);
    const formulaToggle = rectOf('[data-testid="btn-toggle-formula-values"]');
    const formulaToggleOverlaps = Boolean(formulaToggle && formulaNodes.some((node) => {
      const formula = node.getBoundingClientRect();
      return formula.left < formulaToggle.right && formula.right > formulaToggle.left
        && formula.top < formulaToggle.bottom && formula.bottom > formulaToggle.top;
    }));
    const energyBarsVisible = [...document.querySelectorAll('[data-testid="right-control-panel"] *')]
      .some((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0
          && ['动能 / 场能', '耗散 / 储能转化'].includes(node.textContent?.trim() ?? '');
      });
    const canvas = rectOf('[data-testid="simulation-canvas"]')
      ?? rectOf('[data-testid="three-stage-container"] canvas');
    const canvasRatio = canvas ? (canvas.width * canvas.height) / (innerWidth * innerHeight) : 0;
    const scope = rectOf('[data-testid="floating-scope-dock"]');
    const firstSlider = document.querySelector('[data-testid^="param-slider-"]');
    const sliderRect = firstSlider?.getBoundingClientRect() ?? null;
    const visibleFirstSlider = Boolean(sliderRect && sliderRect.width > 0 && sliderRect.height > 0 && sliderRect.top >= 0 && sliderRect.bottom <= innerHeight);
    const rightActions = document.querySelectorAll('[data-testid="topbar-actions"] > button').length;
    const issues = [];

    if (!header || header.height > 52) issues.push(`Top bar height ${header?.height ?? 'missing'}px, expected <= 52px`);
    if (rightActions > 3) issues.push(`Top bar has ${rightActions} resident actions, expected <= 3`);
    if (!rail || rail.width > 56) issues.push(`Icon rail width ${rail?.width ?? 'missing'}px, expected <= 56px`);
    if (!panel || panel.width < 271 || panel.width > 273) issues.push(`Inspector width ${panel?.width ?? 'missing'}px, expected 272px at 1440px viewport`);
    if (!panel || panel.top < 65 || panel.top > 82) issues.push(`Inspector top ${panel?.top ?? 'missing'}px, expected 65–82px`);
    if (!titleText.includes(title)) issues.push(`Top bar title "${titleText}" does not include "${title}"`);
    if (formulaOverflows) issues.push('A formula in the inspector overflows its card at the benchmark viewport');
    if (formulaToggleOverlaps) issues.push('A formula overlaps the formula value toggle button');
    if (hideEnergy && energyBarsVisible) issues.push('A non-energy scene shows meaningless zero energy bars');
    if (!visibleFirstSlider) issues.push('The first core slider is not visible without scrolling');
    if (canvasRatio < (hideScope ? 0.85 : 0.72)) issues.push(`Canvas area ${(canvasRatio * 100).toFixed(1)}%, expected >= ${hideScope ? 85 : 72}%`);
    if (hideScope && scope && scope.height > 20) issues.push('Static scene shows the oscilloscope dock by default');

    return {
      headerHeight: header?.height ?? null,
      residentRightActions: rightActions,
      railWidth: rail?.width ?? null,
      inspectorWidth: panel?.width ?? null,
      inspectorTop: panel?.top ?? null,
      titleText,
      formulaOverflows,
      formulaToggleOverlaps,
      energyBarsVisible,
      firstSliderVisible: visibleFirstSlider,
      canvasAreaPercent: Number((canvasRatio * 100).toFixed(1)),
      scopeVisible: Boolean(scope && scope.height > 20),
      issues
    };
  }, { hideScope: expectScopeHidden, hideEnergy: hideEnergyBars, title: expectedTitle });
}

async function selectPreset(page, preset, force = false) {
  const select = page.locator('[data-testid="preset-select"]');
  const presetOptions = select.locator('option[value]:not([value=""])');
  const count = await presetOptions.count();
  let value;
  if (typeof preset === 'number') {
    if (preset >= count) throw new Error(`Preset option index ${preset} is missing (only ${count} options).`);
    value = await presetOptions.nth(preset).getAttribute('value');
  } else {
    value = preset;
    if (await select.locator(`option[value="${preset}"]`).count() === 0) {
      throw new Error(`Preset option ${preset} is missing.`);
    }
  }
  if (!value) throw new Error(`Preset ${String(preset)} is missing a value.`);
  await select.selectOption(value, { force });
  await page.waitForTimeout(180);
  return value;
}

async function runWaveBCoordinateAudit(page, origin) {
  const cases = [
    { id: 'em-induction-double-rod', name: 'E04 defaultView' },
    { id: 'builder-optics-ray', name: 'B3 thin lens', select: ['#param-sceneMode', 'thin-lens-imaging'] },
    { id: 'builder-circuit-mna', name: 'B2 closed power', select: ['#param-topology', 'closed-power'] },
    { id: 'mech-shm-resonance', name: 'SHM' },
    { id: 'mech-projectile-coupling', name: 'Projectile' },
    { id: 'wave-2d-ripple-fdtd', name: 'FDTD', selectPreset: 'fdtd-double-slit-interference' }
  ];
  const screenshots = {
    'mech-shm-resonance': 'WaveB_SHM.png',
    'mech-projectile-coupling': 'WaveB_Projectile.png',
    'wave-2d-ripple-fdtd': 'WaveB_FDTD.png'
  };
  const report = [];

  for (const testCase of cases) {
    const issues = [];
    const url = new URL(origin);
    url.searchParams.set('model', testCase.id);
    await page.goto(url.toString(), { waitUntil: 'networkidle' });
    await page.waitForFunction((id) => document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id') === id, testCase.id, { timeout: 20000 });
    const exitPresentation = page.locator('[data-testid="btn-exit-fullscreen-speech"]');
    if (await exitPresentation.count()) await exitPresentation.click();
    await page.waitForSelector('[data-testid="simulation-canvas"]', { timeout: 10000 });
    const panel = page.locator('[data-testid="right-control-panel"]');
    if (!(await panel.isVisible())) {
      const openPanel = page.getByRole('button', { name: '参数栏' });
      if (await openPanel.count()) await openPanel.click();
    }
    if (testCase.select) {
      await page.locator(testCase.select[0]).selectOption(testCase.select[1], { force: true });
      await page.waitForTimeout(250);
    }
    if (testCase.selectPreset) await selectPreset(page, testCase.selectPreset, true);
    if (testCase.id === 'wave-2d-ripple-fdtd') {
      const runButton = page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]');
      await runButton.click();
      await page.waitForTimeout(900);
      await runButton.click();
      await page.waitForTimeout(120);
    }
    const zoomBadge = page.locator('[data-testid="viewport-zoom-badge"]');
    const initialZoom = Number.parseFloat((await zoomBadge.innerText()).replace('%', '').trim());
    if (initialZoom !== 100) issues.push(`Initial zoom is ${initialZoom}%, expected 100%`);

    const canvas = page.locator('[data-testid="simulation-canvas"]');
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error(`${testCase.name}: simulation canvas has no bounding box`);
    await page.waitForTimeout(180);
    const beforeZoom = await canvasFingerprint(page);
    await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(120);
    await page.mouse.wheel(0, -300);
    try {
      await page.waitForFunction(() => {
        const text = document.querySelector('[data-testid="viewport-zoom-badge"]')?.textContent ?? '';
        return Number.parseFloat(text.replace('%', '').trim()) > 115;
      }, undefined, { timeout: 3000 });
    } catch {
      issues.push('Two wheel inputs did not raise the zoom badge above 115%');
    }
    const zoomedPixels = await canvasFingerprint(page);
    const zoomedValue = Number.parseFloat((await zoomBadge.innerText()).replace('%', '').trim());
    if (!(zoomedValue > 115)) issues.push(`Zoom badge is ${zoomedValue}%, expected > 115%`);
    if (!beforeZoom || !zoomedPixels || beforeZoom.hash === zoomedPixels.hash) issues.push('Canvas fingerprint did not change after zoom');

    const panStartX = bounds.x + Math.max(90, bounds.width * 0.18);
    const panStartY = bounds.y + Math.max(85, bounds.height * 0.16);
    const beforePan = await canvasFingerprint(page);
    await page.mouse.move(panStartX, panStartY);
    await page.mouse.down();
    await page.mouse.move(panStartX + 100, panStartY + 60, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const afterPan = await canvasFingerprint(page);
    if (!beforePan || !afterPan || beforePan.hash === afterPan.hash) issues.push('Canvas fingerprint did not change after +100px/+60px pan');
    if (testCase.id in screenshots) await page.screenshot({ path: path.join(OUT_DIR, screenshots[testCase.id]) });

    await page.locator('[data-testid="btn-reset-view"]').click();
    try {
      await page.waitForFunction(() => {
        const text = document.querySelector('[data-testid="viewport-zoom-badge"]')?.textContent ?? '';
        return Number.parseFloat(text.replace('%', '').trim()) === 100;
      }, undefined, { timeout: 3000 });
    } catch {
      issues.push('Reset view did not restore the zoom badge to 100%');
    }
    const resetZoom = Number.parseFloat((await zoomBadge.innerText()).replace('%', '').trim());
    if (resetZoom !== 100) issues.push(`Reset zoom is ${resetZoom}%, expected 100%`);
    report.push({ model: testCase.id, initialZoom, zoomedValue, resetZoom, issues });
  }
  return report;
}

async function runWaveCInteractionAudit(page, origin) {
  const report = [];
  const openModel = async (modelId) => {
    const url = new URL(origin);
    url.searchParams.set('model', modelId);
    await page.goto(url.toString(), { waitUntil: 'networkidle' });
    await page.waitForFunction((id) => document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id') === id, modelId, { timeout: 20000 });
    await page.waitForSelector('[data-testid="simulation-canvas"]', { timeout: 10000 });
    await page.waitForTimeout(180);
  };

  {
    const model = 'modern-rutherford-bohr';
    const issues = [];
    await openModel(model);
    const selectedPreset = await selectPreset(page, 'rutherford-gold-foil-scatter', true);
    const valueNode = page.locator('[data-testid="param-value-impactParamFm"]');
    const beforeValue = (await valueNode.innerText()).trim();
    const beforePixels = await canvasFingerprint(page);
    let afterValue = beforeValue;
    let canvasChanged = false;
    const handlePoint = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="simulation-canvas"]');
      if (!(canvas instanceof HTMLCanvasElement)) return null;
      const rect = canvas.getBoundingClientRect();
      const ppm = Math.min(rect.width, rect.height) * 0.24;
      const b = Number.parseFloat(document.querySelector('[data-testid="param-value-impactParamFm"]')?.textContent ?? '25');
      return { x: rect.left + rect.width * 0.45 - (160 / 65) * ppm, y: rect.top + rect.height * 0.5 - (b / 65) * ppm, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    if (!handlePoint || handlePoint.x < handlePoint.left || handlePoint.x > handlePoint.right || handlePoint.y < handlePoint.top || handlePoint.y > handlePoint.bottom) {
      issues.push(`Rutherford impact handle is outside the visible canvas: ${JSON.stringify(handlePoint)}`);
    } else {
      await page.mouse.move(handlePoint.x, handlePoint.y);
      await page.mouse.down();
      await page.mouse.move(handlePoint.x, handlePoint.y - 55, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(250);
      afterValue = (await valueNode.innerText()).trim();
      const afterPixels = await canvasFingerprint(page);
      canvasChanged = Boolean(beforePixels && afterPixels && beforePixels.hash !== afterPixels.hash);
      if (beforeValue === afterValue) issues.push(`Rutherford handle did not change impactParamFm (${beforeValue})`);
      if (!canvasChanged) issues.push('Rutherford canvas did not change after dragging the impact parameter');
    }
    await page.screenshot({ path: path.join(OUT_DIR, 'WaveC_Rutherford_Handle.png') });
    report.push({ model, selectedPreset, beforeValue, afterValue, canvasChanged, issues });
  }

  {
    const model = 'astro-orbital-mechanics';
    const issues = [];
    await openModel(model);
    const beforePixels = await canvasFingerprint(page);
    const toolsButton = page.locator('[data-testid="btn-tools-menu"]');
    if ((await toolsButton.getAttribute('aria-expanded')) !== 'true') await toolsButton.click();
    const fbdButton = page.locator('[data-testid="btn-auto-fbd"]');
    await fbdButton.waitFor({ state: 'visible', timeout: 5000 });
    await fbdButton.click();
    await page.getByText(/Auto-FBD/).waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(160);
    const afterPixels = await canvasFingerprint(page);
    const badgeVisible = await page.getByText(/Auto-FBD/).isVisible();
    if (!badgeVisible) issues.push('Astro Auto-FBD badge did not appear');
    if (!beforePixels || !afterPixels || beforePixels.hash === afterPixels.hash) issues.push('Astro canvas did not change after enabling Auto-FBD');
    await page.screenshot({ path: path.join(OUT_DIR, 'WaveC_Astro_FBD.png') });
    report.push({ model, badgeVisible, canvasChanged: Boolean(beforePixels && afterPixels && beforePixels.hash !== afterPixels.hash), issues });
  }

  {
    const model = 'mech-projectile-coupling';
    const issues = [];
    await openModel(model);
    const runButton = page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]');
    await runButton.click();
    await page.waitForFunction(() => {
      const match = document.querySelector('[data-testid="topbar"]')?.textContent?.match(/t\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*s/i);
      return match ? Number(match[1]) >= 0.5 : false;
    }, undefined, { timeout: 10000 });
    await runButton.click();
    const beforePixels = await canvasFingerprint(page);
    const toolsButton = page.locator('[data-testid="btn-tools-menu"]');
    if ((await toolsButton.getAttribute('aria-expanded')) !== 'true') await toolsButton.click();
    const frameSelect = page.locator('[data-testid="select-reference-frame"]');
    await frameSelect.waitFor({ state: 'visible', timeout: 5000 });
    await frameSelect.selectOption('projectile-comoving');
    await page.waitForTimeout(200);
    const selectedFrame = await frameSelect.inputValue();
    const afterPixels = await canvasFingerprint(page);
    if (selectedFrame !== 'projectile-comoving') issues.push(`Projectile moving frame selection is ${selectedFrame}`);
    if (!beforePixels || !afterPixels || beforePixels.hash === afterPixels.hash) issues.push('Projectile canvas did not change after selecting its moving frame');
    await page.screenshot({ path: path.join(OUT_DIR, 'WaveC_Projectile_Frame.png') });
    report.push({ model, selectedFrame, canvasChanged: Boolean(beforePixels && afterPixels && beforePixels.hash !== afterPixels.hash), issues });
  }

  return report;
}

async function dragRangeTo(page, slider, target) {
  const bounds = await slider.boundingBox();
  if (!bounds || bounds.width < 20) throw new Error('Parameter slider has no usable bounding box.');
  const { min, max } = await slider.evaluate((el) => ({
    min: Number((el).min),
    max: Number((el).max)
  }));
  if (!(max > min)) throw new Error('Parameter slider has an invalid range.');
  const ratio = Math.max(0, Math.min(1, (target - min) / (max - min)));
  const thumbRadius = 14;
  const x = bounds.x + thumbRadius + ratio * Math.max(1, bounds.width - thumbRadius * 2);
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 1, y, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function auditV3Morph(page, origin, screenshot) {
  const cases = [
    ['E10', 'em-3d-magnetic-fields'], ['E04', 'em-induction-double-rod'],
    ['B1', 'builder-composite-em-field'], ['S02', 'stse-em-devices-suite'],
    ['S01', 'stse-tokamak-magnetic-mirror'], ['M10', 'astro-orbital-mechanics']
  ];
  const report = [];
  for (const [code, id] of cases) {
    const url = new URL(origin);
    url.searchParams.set('model', id);
    await page.goto(url.toString(), { waitUntil: 'networkidle' });
    await page.waitForFunction(modelId => document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id') === modelId, id, { timeout: 20000 });
    const enter = page.getByTestId('btn-fullscreen-speech');
    if (await enter.isVisible()) await enter.click();
    const toggle = page.getByTestId('btn-view-3d-fullscreen');
    await toggle.waitFor({ state: 'visible' });
    if ((await toggle.textContent())?.includes('3D 空间')) await toggle.click();
    const spatial = page.getByTestId('three-stage-container');
    await spatial.waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="three-stage-container"]')?.getAttribute('data-morph-t') ?? 'NaN') === 0, null, { timeout: 15000 });
    if (screenshot) await screenshot(code + '_3d');
    // Keep the actual context across DOM removal; detachment alone is not resource release.
    await spatial.locator('canvas').evaluate(canvas => {
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!gl || gl.isContextLost()) throw new Error('Expected a live WebGL context before flattening');
      window.__PF_AUDIT_GL = gl;
    });
    const beforeTime = await readDisplayedTime(page);
    // Capture a genuine intermediate frame, not just the button label.
    await toggle.click();
    await page.waitForFunction(() => {
      const v = Number(document.querySelector('[data-testid="three-stage-container"]')?.getAttribute('data-morph-t') ?? 'NaN');
      return v > 0 && v < 1;
    }, null, { timeout: 10000 });
    await spatial.waitFor({ state: 'detached', timeout: 15000 });
    await page.getByTestId('simulation-canvas').waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.__PF_AUDIT_GL?.isContextLost() === true, null, { timeout: 10000 });
    const afterTime = await readDisplayedTime(page);
    if (beforeTime === null || afterTime !== beforeTime) throw new Error(code + ': paused simulation time changed during morph');
    await page.evaluate(() => { delete window.__PF_AUDIT_GL; });
    if (screenshot) await screenshot(code + '_flat');
    await toggle.click();
    await spatial.waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="three-stage-container"]')?.getAttribute('data-morph-t') ?? 'NaN') === 0, null, { timeout: 15000 });
    await toggle.click();
    await spatial.waitFor({ state: 'detached', timeout: 15000 });
    await page.getByTestId('simulation-canvas').waitFor({ state: 'visible' });
    report.push({ model: id, intermediateMorph: true, flatCanvas: true, roundTrip: true, firstContextLost: true, pausedTimePreserved: true });
  }
  return report;
}

async function auditV3DeviceGeometry(page, origin, screenshot) {
  const url = new URL(origin);
  url.searchParams.set('model', 'stse-em-devices-suite');
  await page.goto(url.toString(), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id') === 'stse-em-devices-suite');
  const report = [];
  for (const device of ['velocity-selector','mass-spectrometer','cyclotron','hall-sensor','mhd-generator','em-flowmeter']) {
    // The real model selector, not a synthetic scene or a screenshot mock.
    const deviceSelect = page.locator('#param-device');
    await deviceSelect.waitFor({state:'attached'});
    if (!await deviceSelect.isVisible()) await page.getByText('更多参数与图层',{exact:false}).first().click();
    await deviceSelect.selectOption(device);
    await page.getByTestId('btn-fullscreen-speech').click();
    const toggle = page.getByTestId('btn-view-3d-fullscreen');
    if ((await toggle.textContent())?.includes('3D 空间')) await toggle.click();
    const stage = page.getByTestId('three-stage-container');
    await stage.waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="three-stage-container"]')?.getAttribute('data-morph-t') ?? 'NaN') === 0);
    await page.locator('[data-testid="stage-formula-values"] [data-readout-id="em-devices-law"]').waitFor({ state: 'visible' });
    if (screenshot) await screenshot('S02_' + device + '_3d');
    await toggle.click();
    await stage.waitFor({state:'detached',timeout:15000});
    await page.getByTestId('simulation-canvas').waitFor({state:'visible'});
    if (screenshot) await screenshot('S02_' + device + '_flat');
    report.push({device,spatial:true,flat:true});
    await page.getByTestId('btn-exit-fullscreen-speech').click();
  }
  return report;
}

async function auditV3StoryAndFormula(page, origin, screenshot) {
  const url = new URL(origin);
  url.searchParams.set('model', 'em-induction-double-rod');
  await page.goto(url.toString(), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id') === 'em-induction-double-rod', null, { timeout: 20000 });
  await page.getByTestId('btn-fullscreen-speech').click();
  await page.getByTestId('btn-toggle-story').click();
  await page.getByTestId('story-caption').waitFor({ state: 'visible' });
  const spatial = page.getByTestId('three-stage-container');
  await spatial.waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="three-stage-container"]')?.getAttribute('data-morph-t') ?? 'NaN') === 0, null, { timeout: 15000 });
  await page.locator('[data-formula-id="faraday-emf"][data-highlighted="true"]').waitFor({ state: 'visible' });
  if (screenshot) await screenshot('E04_story_opening_3d');
  await spatial.locator('canvas').evaluate(canvas => {
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl || gl.isContextLost()) throw new Error('Story opening has no active WebGL context');
    window.__PF_STORY_GL = gl;
  });
  await page.getByTestId('btn-story-next').click();
  await page.waitForFunction(() => {
    const value = Number(document.querySelector('[data-testid="three-stage-container"]')?.getAttribute('data-morph-t') ?? 'NaN');
    return value > 0 && value < 1;
  }, null, { timeout: 10000 });
  await spatial.waitFor({ state: 'detached', timeout: 15000 });
  await page.getByTestId('simulation-canvas').waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.__PF_STORY_GL?.isContextLost() === true, null, { timeout: 10000 });
  await page.evaluate(() => { delete window.__PF_STORY_GL; });
  await page.getByTestId('story-freeze-badge').waitFor({ state: 'visible', timeout: 45000 });
  const freeze = await page.getByTestId('story-freeze-badge').textContent();
  if (!freeze?.includes('接近共速')) throw new Error('Unexpected E04 physics freeze: ' + freeze);
  if (await page.locator('[data-testid="fullscreen-controls"] [aria-label="运行"]').count() !== 1) throw new Error('Auto-freeze did not pause simulation');
  const frozenTime = await readDisplayedTime(page);
  await page.waitForTimeout(250);
  if (frozenTime === null || await readDisplayedTime(page) !== frozenTime) throw new Error('Story clock advanced after freeze');
  if (screenshot) await screenshot('E04_story_freeze');
  await page.getByTestId('btn-stage-blackout').click();
  await page.getByTestId('story-blackout').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /解除黑屏/ }).click();
  await page.getByTestId('story-blackout').waitFor({ state: 'detached' });
  await page.getByTestId('btn-exit-fullscreen-speech').click();

  url.searchParams.set('model', 'stse-em-devices-suite');
  url.searchParams.set('preset', 'velocity-selector-spectrometer');
  await page.goto(url.toString(), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id') === 'stse-em-devices-suite', null, { timeout: 20000 });
  const slider = page.getByTestId('param-slider-eFieldVPerM');
  const before = Number(await slider.inputValue());
  await page.getByTestId('btn-fullscreen-speech').click();
  const token = page.locator('[data-testid="live-formula-velocity-selector"] [data-param="eFieldVPerM"]').first();
  await token.waitFor({ state: 'visible' });
  await token.evaluate(node => { window.__PF_V3_AUDIT_TOKEN = node; });
  const rect = await token.boundingBox();
  if (!rect) throw new Error('Formula token missing bounds');
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  try {
    await page.mouse.move(x + (before > 300000 ? -60 : 60), y, { steps: 8 });
    await page.locator('[data-testid="live-formula-hud"]:visible').waitFor({ state: 'visible' });
    if (!await token.evaluate(node => node === window.__PF_V3_AUDIT_TOKEN)) throw new Error('KaTeX node identity changed during drag');
    if (screenshot) await screenshot('S02_live_formula_drag');
  } finally { await page.mouse.up(); }
  await page.getByTestId('btn-exit-fullscreen-speech').click();
  const after = Number(await slider.inputValue());
  if (!Number.isFinite(after) || after === before) throw new Error('Formula drag did not change actual slider');
  return { freeze, frozenTime, authoredMorph: true, storyContextLost: true, formulaHighlight: true, formulaBefore: before, formulaAfter: after, tokenIdentityPreserved: true };
}

async function main() {
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    throw new Error('apps/web/dist/index.html is missing. Run `pnpm build` before the visual audit.');
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { server, origin } = await startDistServer();
  let browser;
  const consoleErrors = [];
  const pageErrors = [];
  const failedResponses = [];
  const externalRequests = [];
  const report = [];

  try {
    browser = await launchBrowser();
    // The audit serves a built bundle from a minimal local HTTP server; offline-cache lifecycle is outside this visual interaction pass.
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, serviceWorkers: 'block' });
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
      if (/^https?:/i.test(requestUrl) && !requestUrl.startsWith(origin)) externalRequests.push(requestUrl);
    });

    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id') === 'em-induction-double-rod', undefined, { timeout: 20000 });
    const defaultPreset = await page.locator('[data-testid="preset-select"]').inputValue();
    if (defaultPreset !== 'single-rod-battery-drive') {
      throw new Error(`Default E04 preset is ${defaultPreset}; expected single-rod-battery-drive.`);
    }
    // Hero material regression: no transparent holes in the actual canvas.
    const material = await page.getByTestId('simulation-canvas').evaluate(canvas => {
      const ctx = canvas.getContext('2d');
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let alphaHoles = 0;
      for (let i=3; i<pixels.length; i+=4) if (pixels[i] < 255) alphaHoles++;
      const sample = (x,y) => Array.from(ctx.getImageData(Math.floor(canvas.width*x),Math.floor(canvas.height*y),1,1).data);
      return {alphaHoles, center: sample(.46,.43), edge: sample(.99,.98)};
    });
    if (material.alphaHoles !== 0) throw new Error('Rail/canvas material erased '+material.alphaHoles+' pixels');
    if (material.center[0] <= material.edge[0]) throw new Error('Hero background gradient missing');
    await page.screenshot({ path: path.join(OUT_DIR, 'E04_00_default.png') });

    const cases = [
      { id: 'em-induction-double-rod', tag: 'E04', title: '电磁感应·单杆切割', presetId: 'single-rod-battery-drive', scopeHidden: false, run: true, runUntil: 1.42 },
      { id: 'builder-optics-ray', tag: 'B3', title: '几何光学·全反射与折射', presetIndex: 0, scopeHidden: true, hideEnergyBars: true, run: true },
      { id: 'builder-circuit-mna', tag: 'B2', title: '自由拓扑电路·非线性 MNA', presetId: 'divider-lamp-measurement', scopeHidden: false, run: true },
      { id: 'em-3d-magnetic-fields', tag: 'E10', title: '3D空间电磁场·螺旋轨迹', presetId: 'finite-solenoid-3d', scopeHidden: false, run: true, verifySlider: false }
    ];

    for (const testCase of cases) {
      const url = new URL(origin);
      url.searchParams.set('model', testCase.id);
      await page.goto(url.toString(), { waitUntil: 'networkidle' });
      await page.bringToFront();
      await page.waitForFunction((id) => document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id') === id, testCase.id, { timeout: 20000 });
      await page.waitForSelector('[data-testid="right-control-panel"]', { timeout: 10000 });
      if (testCase.id === 'em-3d-magnetic-fields') {
        await page.waitForSelector('[data-testid="three-stage-container"] canvas', { timeout: 15000 });
      }
      await page.waitForTimeout(250);
      if (testCase.presetId) await selectPreset(page, testCase.presetId);
      else await selectPreset(page, testCase.presetIndex);

      const layout = await readLayoutMetrics(page, testCase.scopeHidden, testCase.title, testCase.hideEnergyBars ?? false);
      if (testCase.id === 'em-induction-double-rod') {
        const initialChannel = (await page.getByTestId('scope-channel-a').textContent())?.trim();
        if (initialChannel !== 'I-t · A') layout.issues.push(`Single-rod E04 default channel is ${initialChannel ?? 'missing'}, expected I-t · A`);
      }
      await page.screenshot({ path: path.join(OUT_DIR, `${testCase.tag}_01_init.png`) });
      if (testCase.id === 'builder-circuit-mna') {
        const handlePoint = await page.evaluate(() => {
          const canvas = document.querySelector('[data-testid="simulation-canvas"]');
          const slider = document.querySelector('[data-testid="param-slider-sliderR"]');
          if (!(canvas instanceof HTMLCanvasElement) || !(slider instanceof HTMLInputElement)) return null;
          const rect = canvas.getBoundingClientRect();
          const base=Math.min(rect.width,rect.height)*.24,usable=rect.width-(rect.width>=900?300:0);
          const scale=Math.max(.1,Math.min(1.05,(usable-36)/(5*base),(rect.height-125)/(3.6*base))),ppm=base*scale;
          const worldY=-1.093+Number(slider.value)/20*2.52;
          return {x:rect.left+usable/2-.10*ppm+.17*ppm,y:rect.top+rect.height*.465-worldY*ppm,ppm};
        });
        if (handlePoint) {
          await page.mouse.move(handlePoint.x, handlePoint.y);
          await page.waitForTimeout(120);
          await page.screenshot({ path: path.join(OUT_DIR, 'B2_00_slider_hover.png') });
          await page.mouse.down();
          await page.mouse.move(handlePoint.x,handlePoint.y-handlePoint.ppm*.63,{steps:10});
          await page.mouse.up();
          await page.waitForFunction(()=>Math.abs(Number(document.querySelector('[data-testid="param-slider-sliderR"]')?.value)-15)<.1);
          await page.screenshot({path:path.join(OUT_DIR,'H3_B2_wiper_drag.png')});
          await selectPreset(page,'divider-lamp-measurement');
          await page.mouse.move(24, 24);
        } else {
          layout.issues.push('Could not locate the divider-lamp Rp handle for hover audit');
        }
      }
      let runVerified = 'skipped';
      let sliderVerified = 'skipped';

      if (testCase.run) {
        const isThreeDimensional = testCase.id === 'em-3d-magnetic-fields';
        const beforePixels = isThreeDimensional
          ? await screenshotFingerprint(page.locator('[data-testid="three-stage-container"] canvas'))
          : await canvasFingerprint(page);
        const beforeTime = await readDisplayedTime(page);
        await page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]').click();
        if (isThreeDimensional) {
          await page.waitForFunction(() => {
            const stage = document.querySelector('[data-testid="three-stage-container"]');
            return Number(stage?.getAttribute('data-sim-time')) >= 0.8
              && Number(stage?.getAttribute('data-trail-points')) >= 10
              && stage?.getAttribute('data-velocity-arrow-visible') === 'true'
              && stage?.getAttribute('data-force-arrow-visible') === 'true';
          }, undefined, { timeout: 10000 });
        } else if (testCase.runUntil) {
          await page.waitForFunction((target) => {
            const match = document.querySelector('[data-testid="topbar"]')?.textContent?.match(/t\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*s/i);
            return match ? Number(match[1]) >= target : false;
          }, testCase.runUntil, { timeout: 10000 });
        } else {
          await page.waitForTimeout(850);
        }
        await page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]').click();
        const afterPixels = isThreeDimensional
          ? await screenshotFingerprint(page.locator('[data-testid="three-stage-container"] canvas'))
          : await canvasFingerprint(page);
        const afterTime = await readDisplayedTime(page);
        const threeDimensionalMetrics = isThreeDimensional
          ? await page.locator('[data-testid="three-stage-container"]').evaluate((stage) => ({
              trailPoints: Number(stage.getAttribute('data-trail-points')),
              speed: Number(stage.getAttribute('data-speed')),
              lorentzForce: Number(stage.getAttribute('data-lorentz-force-magnitude')),
              velocityArrowVisible: stage.getAttribute('data-velocity-arrow-visible') === 'true',
              forceArrowVisible: stage.getAttribute('data-force-arrow-visible') === 'true'
            }))
          : null;
        if (testCase.id === 'em-induction-double-rod') {
          const scope = page.getByTestId('floating-scope-dock');
          if (await scope.getAttribute('data-scope-units') !== 'separate') throw new Error('E04 current and velocity must have independent unit axes');
          const scopeCanvas = await scope.locator('canvas').first().boundingBox();
          if (!scopeCanvas || scopeCanvas.height < 140) throw new Error('E04 instrument chart is clipped or too short');
          if (await page.getByTestId('scope-empty').isVisible()) throw new Error('E04 running chart still marked empty');
          if (!(await page.getByTestId('scope-channel-a').innerText()).includes('A') || !(await page.getByTestId('scope-channel-b').innerText()).includes('m/s')) throw new Error('E04 missing visible axis units');
          for (const key of ['kineticEnergy','jouleHeat','sourceWork']) {
            const value = await page.getByTestId('e04-energy-'+key).innerText();
            if (!/^\d+\.\d{3} J$/.test(value) || parseFloat(value) <= 0) throw new Error('E04 missing measured energy in joules: '+key);
          }
        }
        await page.screenshot({ path: path.join(OUT_DIR, `${testCase.tag}_02_running.png`) });

        const timeAdvanced = beforeTime !== null && afterTime !== null && afterTime - beforeTime > 0.2;
        const canvasChanged = Boolean(beforePixels && afterPixels && beforePixels.hash !== afterPixels.hash);
        const threeDimensionalRunValid = !isThreeDimensional || Boolean(
          threeDimensionalMetrics
          && threeDimensionalMetrics.trailPoints >= 10
          && threeDimensionalMetrics.speed > 0
          && threeDimensionalMetrics.lorentzForce > 1e-10
          && threeDimensionalMetrics.velocityArrowVisible
          && threeDimensionalMetrics.forceArrowVisible
        );
        if (!timeAdvanced || !canvasChanged || !threeDimensionalRunValid) {
          layout.issues.push(`Run interaction failed: t ${beforeTime} -> ${afterTime}; canvas changed=${canvasChanged}; 3D=${JSON.stringify(threeDimensionalMetrics)}`);
          runVerified = 'FAIL';
        } else {
          runVerified = `PASS (t ${beforeTime} -> ${afterTime}s; canvas changed${threeDimensionalMetrics ? `; trail=${threeDimensionalMetrics.trailPoints}; v/F arrows visible` : ''})`;
        }

        if (testCase.verifySlider === false) {
          sliderVerified = 'not required (3D trail and vector audit)';
        } else {
          const sliderId = testCase.id === 'builder-optics-ray'
            ? 'incidentAngleDeg'
            : await page.locator('[data-testid^="param-slider-"]').first().getAttribute('data-testid').then((id) => id?.replace('param-slider-', '') ?? '');
          const slider = page.locator(`[data-testid="param-slider-${sliderId}"]`);
          const valueNode = page.locator(`[data-testid="param-value-${sliderId}"]`);
          const beforeValue = await valueNode.innerText();
          const formulaBefore = await page.locator('[data-testid="formula-card"]').innerText();
          const pixelsBefore = await canvasFingerprint(page);
          const sliderLimits = await slider.evaluate((el) => ({ min: Number(el.min), max: Number(el.max) }));
          const target = testCase.id === 'builder-optics-ray'
            ? 50
            : sliderLimits.min + (sliderLimits.max - sliderLimits.min) * 0.78;
          await dragRangeTo(page, slider, target);
          const afterValue = await valueNode.innerText();
          const pixelsAfter = await canvasFingerprint(page);
          const formulaAfter = await page.locator('[data-testid="formula-card"]').innerText();
          const valueChanged = beforeValue !== afterValue;
          const canvasChangedAfterSlider = Boolean(pixelsBefore && pixelsAfter && pixelsBefore.hash !== pixelsAfter.hash);
          const formulaChangedAfterSlider = formulaBefore !== formulaAfter;
          if (!valueChanged || (!canvasChangedAfterSlider && !formulaChangedAfterSlider)) {
            layout.issues.push(`Slider ${sliderId} did not update its value and rendered scene.`);
            sliderVerified = 'FAIL';
          } else if (testCase.id === 'builder-optics-ray' && Number.parseFloat(afterValue) !== 50) {
            layout.issues.push(`B3 incident angle slider did not reach 50 degrees (displayed ${afterValue}).`);
            sliderVerified = 'FAIL';
          } else {
            sliderVerified = `PASS (${sliderId}: ${beforeValue.trim()} -> ${afterValue.trim()}; canvas changed=${canvasChangedAfterSlider}; formula changed=${formulaChangedAfterSlider})`;
          }
          await page.screenshot({ path: path.join(OUT_DIR, `${testCase.tag}_03_slider_synced.png`) });
        }
      }

      if (testCase.id === 'em-3d-magnetic-fields') {
        await page.locator('[data-testid="btn-fullscreen-speech"]').click();
        await page.waitForSelector('[data-testid="fullscreen-controls"]', { timeout: 5000 });
        await page.waitForTimeout(500);
        const presentation = await page.evaluate(() => {
          const visible = (selector) => {
            const node = document.querySelector(selector);
            if (!node) return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden';
          };
          const threeCanvas = document.querySelector('[data-testid="three-stage-container"] canvas');
          const rect = threeCanvas?.getBoundingClientRect();
          const presentationFormulas = [...document.querySelectorAll('[data-testid="fullscreen-formula"] .pf-right-formula')];
          const formulaOverflows = presentationFormulas.some((node) => node.scrollWidth > node.clientWidth + 2);
          const worldVectorLabels = [...document.querySelectorAll('.pf-3d-label')].map((label) => {
            const labelRect = label.getBoundingClientRect();
            return {
              text: label.textContent?.trim() ?? '',
              left: labelRect.left,
              right: labelRect.right,
              top: labelRect.top,
              bottom: labelRect.bottom,
              visible: labelRect.width > 0 && labelRect.height > 0 && labelRect.left >= 0
                && labelRect.right <= innerWidth && labelRect.top >= 0 && labelRect.bottom <= innerHeight
            };
          });
          const visibleLabels = worldVectorLabels.filter((label) => label.visible);
          let labelsDisjoint = true;
          for (let i = 0; i < visibleLabels.length; i++) {
            for (let j = i + 1; j < visibleLabels.length; j++) {
              const a = visibleLabels[i];
              const b = visibleLabels[j];
              if (a.right + 4 > b.left && b.right + 4 > a.left && a.bottom + 2 > b.top && b.bottom + 2 > a.top) {
                labelsDisjoint = false;
              }
            }
          }
          return {
            topbarVisible: visible('[data-testid="topbar"]'),
            railVisible: visible('[data-testid="left-catalog-rail"]'),
            panelVisible: visible('[data-testid="right-control-panel"]'),
            scopeVisible: visible('[data-testid="floating-scope-dock"]'),
            threeCanvas: Boolean(threeCanvas && rect && rect.width > 0 && rect.height > 0),
            axisWidgetVisible: visible('[data-testid="three-axis-widget"]'),
            vectorLegendVisible: visible('[data-testid="three-vector-legend"]'),
            formulaOverflows,
            worldVectorLabels,
            labelsDisjoint,
            velocityArrowVisible: threeCanvas?.parentElement?.getAttribute('data-velocity-arrow-visible') === 'true',
            forceArrowVisible: threeCanvas?.parentElement?.getAttribute('data-force-arrow-visible') === 'true',
            particleRadius: Number(threeCanvas?.parentElement?.getAttribute('data-particle-radius')),
            trailPoints: Number(threeCanvas?.parentElement?.getAttribute('data-trail-points') ?? 0)
          };
        });
        const readableVectorLabels = ['v', 'a洛', 'B'].every((text) =>
          presentation.worldVectorLabels.some((label) => label.text === text && label.visible)
        );
        if (presentation.topbarVisible || presentation.railVisible || presentation.panelVisible || presentation.scopeVisible || !presentation.threeCanvas || !presentation.axisWidgetVisible || !presentation.vectorLegendVisible || !presentation.velocityArrowVisible || !presentation.forceArrowVisible || presentation.formulaOverflows || !readableVectorLabels || !presentation.labelsDisjoint || presentation.trailPoints < 10 || Math.abs(presentation.particleRadius - 0.055 * 0.7) > 1e-6) {
          layout.issues.push(`Fullscreen E10 layout failed: ${JSON.stringify(presentation)}`);
        }
        await page.waitForFunction(() => {
          const stage = document.querySelector('[data-testid="three-stage-container"]');
          return Number(stage?.getAttribute('data-field-line-count')) === 21 && Number(stage?.getAttribute('data-conductor-count')) === 10;
        });
        await page.screenshot({ path: path.join(OUT_DIR, 'E10_04_fullscreen_3d.png') });
      }

      if (testCase.id === 'builder-optics-ray') {
        await selectPreset(page,'tir-water-air');
        await page.waitForFunction(()=>{
          const r=parseFloat(document.querySelector('[data-testid="b3-interface-R"]')?.textContent??'');
          const t=parseFloat(document.querySelector('[data-testid="b3-interface-T"]')?.textContent??'');
          return r>0&&r<100&&Math.abs(r+t-100)<.11;
        });
        await page.screenshot({path:path.join(OUT_DIR,'H2_B3_below_critical.png')});
        await dragRangeTo(page,page.getByTestId('param-slider-incidentAngleDeg'),50);
        await page.waitForFunction(()=>document.querySelector('[data-testid="b3-interface-R"]')?.textContent==='100.0%'&&document.querySelector('[data-testid="b3-interface-T"]')?.textContent==='0.0%');
        await page.screenshot({path:path.join(OUT_DIR,'H2_B3_total_reflection.png')});
        await selectPreset(page,'tir-water-air');
        await dragRangeTo(page,page.getByTestId('param-slider-n2'),1.5);
        await page.waitForFunction(()=>document.querySelector('[data-testid="b3-interface-R"]')?.textContent==='0.0%'&&document.querySelector('[data-testid="b3-interface-T"]')?.textContent==='100.0%');
        await page.screenshot({path:path.join(OUT_DIR,'H2_B3_matched_indices.png')});
        await selectPreset(page,'tir-water-air');
        await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
        await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
        if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
        await page.screenshot({path:path.join(OUT_DIR,'H2_B3_projector.png')});
        await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
        await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='chalkboard');
        if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
      }
      if (testCase.id === 'builder-circuit-mna') {
        await selectPreset(page,'divider-lamp-measurement');
        const readouts=()=>page.evaluate(()=>Object.fromEntries(['sourceTerminalVoltage','lampVoltage','lampCurrent','outputPower'].map(k=>[k,parseFloat(document.querySelector('[data-testid="b2-'+k+'"]')?.textContent??'')])));
        await page.waitForFunction(()=>parseFloat(document.querySelector('[data-testid="b2-lampVoltage"]')?.textContent??'')>0);
        const initial=await readouts();
        if(!(initial.sourceTerminalVoltage>initial.lampVoltage&&initial.lampVoltage>0&&Math.abs(initial.outputPower-initial.lampVoltage*initial.lampCurrent)<.015))throw new Error('B2 terminal/lamp readout mismatch '+JSON.stringify(initial));
        await page.screenshot({path:path.join(OUT_DIR,'H3_B2_nominal.png')});
        for(const [target,tag] of [[0,'bottom'],[20,'top']]){
          // Native range keyboard reaches exact endpoints; canvas wiper
          // drag was independently verified 10->15 Ω above.
          await page.getByTestId('param-slider-sliderR').focus();
          await page.getByTestId('param-slider-sliderR').press(target===0?'Home':'End');
          await page.waitForFunction(target=>Number(document.querySelector('[data-testid="param-slider-sliderR"]')?.value)===target,target);
          await page.waitForTimeout(180);
          const data=await readouts();
          if(target===0&&(data.lampVoltage!==0||data.lampCurrent!==0||data.outputPower!==0))throw new Error('B2 bottom contact must short only lamp '+JSON.stringify(data));
          if(target===20&&Math.abs(data.lampVoltage-data.sourceTerminalVoltage)>.001)throw new Error('B2 top contact must equal source terminal '+JSON.stringify(data));
          await page.screenshot({path:path.join(OUT_DIR,'H3_B2_'+tag+'.png')});
        }
        await page.getByTestId('param-slider-emf').focus();
        await page.getByTestId('param-slider-emf').press('Home');
        await page.waitForFunction(()=>document.querySelector('[data-testid="b2-inspector-potential"]')?.getAttribute('data-divider-palette')==='zero'&&parseFloat(document.querySelector('[data-testid="b2-outputPower"]')?.textContent??'')===0);
        await page.screenshot({path:path.join(OUT_DIR,'H3_B2_zero_emf.png')});
        await selectPreset(page,'divider-lamp-measurement');
        await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
        await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
        if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
        await page.screenshot({path:path.join(OUT_DIR,'H3_B2_projector.png')});
        await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
        await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='chalkboard');
        if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
        const selectedPreset = await selectPreset(page, 'rc-charging-curve');
        await page.waitForTimeout(250);
        const rcCheck = await page.evaluate(() => {
          const presetSelect = document.querySelector('[data-testid="preset-select"]');
          const topologySelect = document.querySelector('#param-topology');
          const formulaText = document.querySelector('[data-testid="formula-card"]')?.textContent ?? '';
          return {
            presetValue: presetSelect instanceof HTMLSelectElement ? presetSelect.value : null,
            topologyValue: topologySelect instanceof HTMLSelectElement ? topologySelect.value : null,
            hasCapFormula: formulaText.includes('U_C') || formulaText.includes('C')
          };
        });
        if (rcCheck.presetValue !== selectedPreset || rcCheck.topologyValue !== 'rc-transient' || !rcCheck.hasCapFormula) {
          layout.issues.push(`B2 failed to switch to RC transient mode: ${JSON.stringify(rcCheck)}`);
        }
        await page.screenshot({ path: path.join(OUT_DIR, 'B2_04_rc_no_handle.png') });
      }

      if (testCase.id === 'em-induction-double-rod') {
        // Real 1024x768 layout and projector-theme smoke; restore defaults for other models.
        await page.setViewportSize({width:1024,height:768});
        await page.waitForTimeout(300);
        const small = await page.getByTestId('floating-scope-dock').boundingBox();
        const inspector = await page.getByTestId('right-control-panel').boundingBox();
        if (!small || !inspector || small.x + small.width > inspector.x || small.y + small.height > 768) throw new Error('E04 compact scope overlaps inspector or viewport');
        await page.screenshot({path:path.join(OUT_DIR,'H1_E04_compact.png')});
        await page.getByTestId('btn-tools-menu').click();
        await page.getByTestId('btn-theme').click();
        await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
        if (await page.getByTestId('tools-menu').isVisible()) await page.getByTestId('btn-tools-menu').click();
        const contrast = await page.evaluate(() => {
          const luminance = (rgb) => {
            const channels = rgb.match(/[\d.]+/g)?.slice(0,3).map(Number) ?? [];
            return channels.length === 3 ? channels.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0) : 1;
          };
          const selectors=['[data-testid="topbar"] > div:first-child > div:first-child','[data-testid="param-value-batteryEmf"]','label[for="param-batteryEmf"]','[data-testid="preset-select"]','[data-testid="formula-card"] .pf-right-formula'];
          return selectors.map(selector=>{
            const el=document.querySelector(selector);
            return {selector, ratio:el?1.05/(luminance(getComputedStyle(el).color)+.05):0};
          });
        });
        if (contrast.some(c=>c.ratio<4.5)) throw new Error('E04 paper text contrast failed '+JSON.stringify(contrast));
        if (!await page.getByTestId('scope-empty').isVisible()) throw new Error('E04 reset must show empty-series notice');
        await page.screenshot({path:path.join(OUT_DIR,'H1_E04_projector.png')});
        await page.getByTestId('btn-tools-menu').click();
        await page.getByTestId('btn-theme').click();
        await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='chalkboard');
        if (await page.getByTestId('tools-menu').isVisible()) await page.getByTestId('btn-tools-menu').click();
        await page.setViewportSize(VIEWPORT);
      }
      report.push({ model: testCase.id, layout, runVerified, sliderVerified });
    }

    // V3.1 targeted N01: the actual displayed symbolic formula, mode-specific
    // controls and visual changes are checked on three real browser presets.
    const n01Url = new URL(origin);
    n01Url.searchParams.set('model','modern-photoelectric-compton');
    await page.goto(n01Url.toString(), {waitUntil:'networkidle'});
    await page.waitForFunction(() => document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id') === 'modern-photoelectric-compton');
    await selectPreset(page,'photoelectric-sodium-violet');
    const n01Formula = page.getByTestId('formula-card');
    const n01Toggle = page.getByTestId('btn-toggle-formula-values');
    if ((await n01Toggle.innerText()).trim() !== '显示数值') throw new Error('Formula toggle is not explicit');
    const uSlider = page.getByTestId('param-slider-anodeVoltageV');
    if (!await uSlider.isVisible()) throw new Error('Applied voltage slider not visible in photoelectric mode');
    await page.waitForFunction(() => document.querySelector('[data-testid="scope-channel-a"]')?.textContent?.includes('光电流'));
    await page.screenshot({path:path.join(OUT_DIR,'N01_01_photoelectric.png')});
    const beforeVoltage = await uSlider.inputValue();
    const beforeVoltagePixels = await canvasFingerprint(page);
    await dragRangeTo(page,uSlider,2);
    if (await uSlider.inputValue() === beforeVoltage) throw new Error('Photoelectric voltage did not change');
    const afterVoltagePixels = await canvasFingerprint(page);
    if (!beforeVoltagePixels || !afterVoltagePixels || beforeVoltagePixels.hash===afterVoltagePixels.hash) throw new Error('Photoelectric canvas did not respond to applied voltage');
    await n01Toggle.click();
    if (!await n01Toggle.getAttribute('aria-pressed') || await n01Toggle.getAttribute('aria-pressed')!=='true') throw new Error('Formula value toggle did not activate');
    await page.screenshot({path:path.join(OUT_DIR,'N01_02_voltage_and_values.png')});
    await selectPreset(page,'photoelectric-red-below-cutoff');
    if (!(await n01Formula.innerText()).includes('I') || (await n01Formula.innerText()).includes('U_c')) throw new Error('Below threshold formula missing I=0 or shows stopping voltage');
    await page.screenshot({path:path.join(OUT_DIR,'N01_03_below_threshold.png')});
    await selectPreset(page,'compton-molybdenum-90deg');
    const angleSlider=page.getByTestId('param-slider-scatterAngleDeg');
    if (!await angleSlider.isVisible()) throw new Error('Compton scatter angle control not visible');
    await page.waitForFunction(() => document.querySelector('[data-testid="scope-channel-a"]')?.textContent?.includes('康普顿波长差')
      && document.querySelector('[data-testid="scope-channel-b"]')?.textContent?.includes('反冲电子动能'));
    if (!(await page.getByTestId('param-value-xrayWavelengthNm').innerText()).includes('0.071')) throw new Error('Incident X-ray wavelength lost slider precision');
    await page.screenshot({path:path.join(OUT_DIR,'N01_04_compton.png')});
    const angleBefore=await angleSlider.inputValue();
    await dragRangeTo(page,angleSlider,135);
    if (await angleSlider.inputValue()===angleBefore) throw new Error('Compton angle slider not responsive');
    await page.screenshot({path:path.join(OUT_DIR,'N01_05_compton_angle.png')});
    // Direct drag from the signed scattered momentum endpoint (physical p is
    // ~10^-23 kg m/s, not a value that may be clamped to a generic 10^-9).
    await selectPreset(page,'compton-molybdenum-90deg');
    const handlePoint=await page.evaluate(() => {
      const canvas=document.querySelector('[data-testid="simulation-canvas"]');
      if (!(canvas instanceof HTMLCanvasElement)) return null;
      const rect=canvas.getBoundingClientRect();
      const ppm=Math.min(rect.width,rect.height)*0.24;
      const ratio=0.071/(0.071+0.00242631024);
      const cx=rect.left+rect.width*0.40-0.8*ppm;
      const cy=rect.top+rect.height*0.5;
      const r=0.95*ratio*ppm;
      return { x:cx, y:cy-r, tx:cx+r/Math.sqrt(2), ty:cy-r/Math.sqrt(2) };
    });
    if (!handlePoint) throw new Error('Compton canvas missing');
    await page.mouse.move(handlePoint.x,handlePoint.y);
    await page.mouse.down();
    await page.mouse.move(handlePoint.tx,handlePoint.ty,{steps:10});
    await page.mouse.up();
    await page.waitForTimeout(200);
    if (Math.abs(Number(await angleSlider.inputValue())-45)>5) throw new Error('Compton canvas handle does not follow momentum endpoint');
    await page.screenshot({path:path.join(OUT_DIR,'N01_06_compton_direct_drag.png')});
    const waveBCoordinateReport = await runWaveBCoordinateAudit(page, origin);
    const waveCInteractionReport = await runWaveCInteractionAudit(page, origin);
    const v3MorphReport = await auditV3Morph(page, origin, name => page.screenshot({ path: path.join(OUT_DIR, 'V3_' + name + '.png') }));
    const v3StoryFormulaReport = await auditV3StoryAndFormula(page, origin, name => page.screenshot({ path: path.join(OUT_DIR, 'V3_' + name + '.png') }));
    const v3DeviceReport = await auditV3DeviceGeometry(page, origin, name => page.screenshot({ path: path.join(OUT_DIR, 'V3_' + name + '.png') }));
    const summary = { report, waveBCoordinateReport, waveCInteractionReport, v3MorphReport, v3StoryFormulaReport, v3DeviceReport, consoleErrors, pageErrors, failedResponses, externalRequests, screenshots: OUT_DIR };
    console.log(JSON.stringify(summary, null, 2));
    const layoutIssues = report.flatMap((item) => item.layout.issues.map((issue) => `[${item.model}] ${issue}`));
    const coordinateIssues = waveBCoordinateReport.flatMap((item) => item.issues.map((issue) => `[${item.model}] ${issue}`));
    const interactionIssues = waveCInteractionReport.flatMap((item) => item.issues.map((issue) => `[${item.model}] ${issue}`));
    const auditErrors = [...layoutIssues, ...coordinateIssues, ...interactionIssues, ...consoleErrors, ...pageErrors, ...failedResponses, ...externalRequests];
    if (auditErrors.length > 0) throw new Error(`VISUAL_AUDIT_FAILED:\n${auditErrors.join('\n')}`);
    console.log('VISUAL_AUDIT: PASS');
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
