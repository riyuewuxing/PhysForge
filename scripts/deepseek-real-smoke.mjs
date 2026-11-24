import fs from 'node:fs/promises';
import { chromium } from 'playwright';

// One explicit run, at most one model-directory request and three generation requests.
// Never log raw exceptions, request/response bodies, headers or credentials.
const key = process.env.DEEPSEEK_TEST_KEY?.trim();
delete process.env.DEEPSEEK_TEST_KEY;
const live = 'https://riyuewuxing.github.io/PhysForge/';
const target = 'modern-photoelectric-compton';
const expectedEntry = '/PhysForge/assets/index-D38kBbdg.js';
const out = 'artifacts/deepseek-real';
const report = { sha: process.env.GITHUB_SHA, deployedEntry: null, modelsHttp: [], generationHttp: [], generationRequests: 0, directoryRequests: 0, result: 'FAIL', stage: 'secret availability', checks: {} };
let browser;
const requireCheck = (condition, label) => { if (!condition) throw new Error(label); };
await fs.mkdir(out, { recursive: true });
try {
  requireCheck(Boolean(key), 'missing repository secret');
  report.stage = 'public website build';
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  // Disallow unexpected external destinations, redirects and unbounded requests.
  await context.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === new URL(live).origin && ['GET','HEAD'].includes(req.method())) return route.continue();
    if (url.origin !== 'https://api.deepseek.com' || req.redirectedFrom()) return route.abort();
    if (req.method() === 'OPTIONS' && ['/models','/chat/completions'].includes(url.pathname)) return route.continue();
    if (req.method() === 'GET' && url.pathname === '/models' && ++report.directoryRequests <= 1) return route.continue();
    if (req.method() === 'POST' && url.pathname === '/chat/completions' && ++report.generationRequests <= 3) return route.continue();
    return route.abort();
  });
  page.on('response', res => {
    const u = new URL(res.url());
    if (u.origin !== 'https://api.deepseek.com') return;
    if (res.request().method() === 'GET' && u.pathname === '/models') report.modelsHttp.push(res.status());
    if (res.request().method() === 'POST' && u.pathname === '/chat/completions') report.generationHttp.push(res.status());
  });
  const response = await page.goto(live + '?real-audit=' + encodeURIComponent(process.env.GITHUB_SHA ?? 'local'), { waitUntil: 'domcontentloaded', timeout: 45000 });
  requireCheck(response?.status() === 200, 'Pages HTTP');
  const entry = await page.locator('script[type="module"][src]').first().getAttribute('src');
  report.deployedEntry = new URL(entry ?? '', live).pathname;
  requireCheck(report.deployedEntry === expectedEntry, 'unexpected deployed entry; no secret injected');
  await page.getByTestId('app-shell').waitFor({ timeout: 30000 });
  await page.getByTestId('simulation-canvas').or(page.getByTestId('three-stage-container')).first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: out + '/01-public-before-key.png', animations: 'disabled' });
  report.checks.publicBuild = 'PASS';
  report.stage = 'authenticated model directory';
  await page.getByTestId('btn-tools-menu').click();
  await page.getByTestId('btn-ai-copilot-menu').click();
  await page.getByTestId('byok-enabled').check();
  requireCheck(await page.getByTestId('byok-base-url').inputValue() === 'https://api.deepseek.com', 'unexpected API endpoint');
  requireCheck(await page.getByTestId('byok-model').inputValue() === 'deepseek-flash', 'unexpected model');
  await page.getByTestId('byok-api-key').fill(key);
  await page.getByTestId('btn-test-byok-connection').click();
  await page.getByTestId('byok-model-list').waitFor({ timeout: 20000 });
  requireCheck(report.modelsHttp.includes(200), 'directory HTTP');
  requireCheck(await page.getByTestId('byok-model-list').locator('option[value="deepseek-flash"]').count() === 1, 'model absent');
  report.checks.authenticatedDirectory = 'PASS';
  report.stage = 'real generation';
  await page.getByTestId('ai-prompt-input').fill('建立光电效应实验：400 nm 紫光照射钠阴极，金属逸出功 2.36 eV。使用光电效应模式，展示遏止电压与伏安特性曲线。');
  await page.getByTestId('btn-run-ai-copilot').click();
  await page.waitForFunction(() => {
    const status = document.querySelector('[data-testid="byok-run-status"]');
    return !!status?.textContent;
  }, null, { timeout: 200000 });
  const accepted = await page.getByTestId('btn-apply-ai-scene').isEnabled().catch(() => false);
  requireCheck(accepted && report.generationHttp.includes(200), 'generation not accepted');
  report.checks.realGenerationAndAudit = 'PASS';
  report.stage = 'semantic scene check';
  const sceneText = await page.getByTestId('byok-result-card').locator('pre').textContent();
  requireCheck(typeof sceneText === 'string' && !sceneText.includes(key), 'unsafe scene content');
  const scene = JSON.parse(sceneText);
  requireCheck(scene.modelId === target && scene.params?.mode === 'photoelectric' && scene.params?.cathodeMetal === 'Na' && scene.params?.wavelengthNm === 400, 'wrong model or parameters');
  report.checks.requestedPhysics = 'PASS';
  report.stage = 'apply and clear';
  await page.getByTestId('btn-apply-ai-scene').click();
  await page.waitForFunction(id => document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id') === id, target);
  requireCheck(Number(await page.getByTestId('param-slider-wavelengthNm').inputValue()) === 400, 'wrong applied wavelength');
  requireCheck(await page.getByTestId('preset-select').inputValue() === '', 'wrong preset label');
  // Drawer was unmounted; no credential saved. Reload is intentionally avoided to preserve scene.
  requireCheck(await page.getByTestId('ai-copilot-drawer').count() === 0, 'drawer still visible');
  requireCheck(!(await page.locator('body').innerText()).includes(key), 'sensitive display');
  await page.screenshot({ path: out + '/02-real-applied-scene.png', animations: 'disabled' });
  report.checks.appliedScene = 'PASS';
  report.result = 'PASS';
  report.stage = 'complete';
  await context.close();
} catch {
  // Fixed stage name and numeric status only, never Playwright diagnostics.
} finally {
  await browser?.close().catch(() => {});
  await fs.writeFile(out + '/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
if (report.result !== 'PASS') process.exitCode = 1;
