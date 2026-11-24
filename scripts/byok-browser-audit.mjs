import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const out = 'artifacts/byok-audit';
const live = 'https://riyuewuxing.github.io/PhysForge/';
const preview = 'http://127.0.0.1:4173/PhysForge/';
const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
const report = { sha: process.env.GITHUB_SHA ?? 'local', headSha: event.pull_request?.head.sha ?? null, checks: {}, cors: [] };
let fixturePage;
let fixturePhase = 'not started';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const pageOptions = { viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' };
const mockKey = 'fixture-not-a-real-api-key';
const target = 'modern-photoelectric-compton';
const candidate = { schemaVersion: '2.0', modelId: target, title: '400 nm 光电效应', params: { mode: 'photoelectric', cathodeMetal: 'Na', wavelengthNm: 400 } };
const prompt = '400 nm 紫光照射钠阴极，观察光电效应';
async function openDrawer(page) {
  const menu = page.getByTestId('btn-ai-copilot-menu');
  if (!await menu.isVisible()) await page.getByTestId('btn-tools-menu').click();
  await menu.click();
  await page.getByTestId('ai-copilot-drawer').waitFor();
}
async function shot(page, name) {
  await page.screenshot({ path: out + '/' + name + '.png', animations: 'disabled' });
}
async function preflight(url, method) {
  try {
    const r = await fetch(url, {
      method: 'OPTIONS', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: {
        Origin: new URL(live).origin,
        'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': method === 'POST' ? 'authorization,content-type' : 'authorization'
      }
    });
    return { url, method, status: r.status, origin: r.headers.get('access-control-allow-origin'),
      methods: r.headers.get('access-control-allow-methods'), headers: r.headers.get('access-control-allow-headers') };
  } catch { return { url, method, error: 'network_or_timeout' }; }
}
try {
  // Independent actual public Pages navigation: no mock, no user key, no external API request.
  const publicContext = await browser.newContext(pageOptions);
  const publicPage = await publicContext.newPage();
  const publicErrors = [];
  publicPage.on('pageerror', () => publicErrors.push('pageerror'));
  try {
    const response = await publicPage.goto(live, { waitUntil: 'domcontentloaded', timeout: 45000 });
    assert.equal(response?.status(), 200);
    await publicPage.getByTestId('app-shell').waitFor({ timeout: 30000 });
    await publicPage.getByTestId('simulation-canvas').or(publicPage.getByTestId('three-stage-container')).first().waitFor({ timeout: 30000 });
    await shot(publicPage, '01-live-pages');
    await openDrawer(publicPage);
    await shot(publicPage, '02-live-ai-baseline');
    assert.equal(publicErrors.length, 0);
    report.checks.publicPages = 'PASS';
  } catch (error) {
    report.checks.publicPages = 'FAIL: ' + String(error).slice(0, 300);
  } finally { await publicContext.close(); }

  // OPTIONS is a real provider network probe, not an authenticated request or a CORS guarantee.
  const bases = ['https://api.deepseek.com', 'https://api.openai.com/v1', 'https://api.siliconflow.cn/v1', 'https://generativelanguage.googleapis.com/v1beta/openai'];
  report.cors = await Promise.all(bases.flatMap(base => [
    preflight(base + '/models', 'GET'), preflight(base + '/chat/completions', 'POST')
  ]));

  const ctx = await browser.newContext(pageOptions);
  const page = await ctx.newPage();
  fixturePage = page;
  const errors = [];
  page.on('pageerror', () => errors.push('pageerror'));
  let gets = 0, posts = 0, mode = 'ok';
  const corsHeaders = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS' };
  await page.route('https://api.deepseek.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders }); return;
    }
    assert.equal((await request.allHeaders()).authorization, 'Bearer ' + mockKey);
    const respond = (json, status = 200) => route.fulfill({ status, headers: corsHeaders, json });
    if (url.pathname === '/models' && request.method() === 'GET') {
      gets++;
      await respond(mode === '401' ? { error: mockKey } : { data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] }, mode === '401' ? 401 : 200);
    } else if (url.pathname === '/chat/completions' && request.method() === 'POST') {
      posts++;
      const body = request.postDataJSON();
      assert.equal(body.model, 'deepseek-flash');
      assert.equal(body.thinking.type, 'disabled');
      assert.equal(body.response_format.type, 'json_object');
      assert.ok(!JSON.stringify(body).includes(mockKey));
      if (posts === 1) assert.ok(body.messages[0].content.includes('Schema ' + target));
      assert.ok(body.messages[1].content.includes(prompt));
      if (mode === '401') { await respond({ error: mockKey }, 401); return; }
      const scene = posts === 1 ? { ...candidate, params: { fakeParam: 1 } } : candidate;
      if (posts === 2) {
        assert.ok(body.messages[1].content.includes('Unknown param'));
        assert.ok(body.messages[1].content.includes('Schema ' + target));
      }
      await respond({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(scene) } }] });
    } else { throw new Error('Unexpected fixture endpoint'); }
  });
  fixturePhase = 'candidate preview load';
  const previewResponse = await page.goto(preview, { waitUntil: 'domcontentloaded' });
  assert.equal(previewResponse?.status(), 200);
  await page.getByTestId('app-shell').waitFor({ timeout: 30000 });
  await page.getByTestId('simulation-canvas').or(page.getByTestId('three-stage-container')).first().waitFor({ timeout: 30000 });
  fixturePhase = 'configuration save / offline choice';
  await openDrawer(page);
  await page.getByTestId('byok-enabled').check();
  assert.equal(await page.getByTestId('byok-model').inputValue(), 'deepseek-flash');
  assert.equal(await page.getByTestId('btn-run-ai-copilot').isDisabled(), true);
  assert.equal(posts, 0);
  await page.getByTestId('byok-api-key').fill(mockKey);
  await page.getByTestId('btn-save-byok').click();
  await page.getByTestId('btn-close-ai-copilot').click();
  await openDrawer(page);
  assert.equal(await page.getByTestId('byok-api-key').inputValue(), mockKey);
  await page.getByTestId('byok-enabled').uncheck();
  await page.getByTestId('btn-close-ai-copilot').click();
  await openDrawer(page);
  assert.equal(await page.getByTestId('byok-enabled').isChecked(), false);
  await page.getByTestId('byok-enabled').check();
  assert.equal(await page.getByTestId('byok-api-key').inputValue(), mockKey);
  fixturePhase = 'model directory';
  await page.getByTestId('btn-test-byok-connection').click();
  await page.getByTestId('byok-model-list').waitFor();
  assert.equal(gets, 1);
  assert.equal(posts, 0);
  await page.getByTestId('byok-model-list').selectOption('deepseek-v4-pro');
  await page.getByTestId('byok-model-list').selectOption('deepseek-flash');
  await page.getByTestId('btn-save-byok').click();
  // Screenshot only a masked, explicitly synthetic fixture; no actual API key exists in CI.
  await shot(page, '03-candidate-config');
  fixturePhase = 'refinement';
  await page.getByTestId('ai-prompt-input').fill(prompt);
  await page.getByTestId('btn-run-ai-copilot').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="byok-run-status"]')?.textContent?.includes('第 2 轮通过'), null, { timeout: 30000 });
  assert.equal(posts, 2);
  await page.getByTestId('btn-apply-ai-scene').waitFor();
  assert.equal(await page.getByTestId('btn-apply-ai-scene').isEnabled(), true);
  await page.getByTestId('btn-apply-ai-scene').scrollIntoViewIfNeeded();
  await shot(page, '04-candidate-refined-scene');
  fixturePhase = 'apply physics scene';
  await page.getByTestId('btn-apply-ai-scene').click();
  await page.waitForFunction(id => document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id') === id, target);
  await page.getByTestId('simulation-canvas').waitFor();
  assert.equal(Number(await page.getByTestId('param-slider-wavelengthNm').inputValue()), 400);
  await shot(page, '05-applied-physics');
  await openDrawer(page);
  await page.getByTestId('ai-prompt-input').fill(prompt);
  fixturePhase = 'safe error / clear / reload';
  mode = '401';
  await page.getByTestId('btn-test-byok-connection').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="byok-probe-status"]')?.textContent?.includes('401'));
  assert.ok(!(await page.getByTestId('byok-probe-status').textContent()).includes(mockKey));
  await shot(page, '06-safe-error');
  await page.getByTestId('btn-clear-byok').click();
  assert.equal(await page.getByTestId('byok-api-key').inputValue(), '');
  await page.getByTestId('btn-close-ai-copilot').click();
  await openDrawer(page);
  assert.equal(await page.getByTestId('byok-enabled').isChecked(), false);
  await page.getByTestId('byok-enabled').check();
  await page.getByTestId('byok-api-key').fill(mockKey);
  await page.getByTestId('btn-save-byok').click();
  await page.getByTestId('byok-base-url').fill('https://example.test/v1');
  assert.equal(await page.getByTestId('byok-api-key').inputValue(), '');
  await page.getByTestId('byok-base-url').fill('https://api.deepseek.com');
  await page.getByTestId('byok-api-key').fill(mockKey);
  await page.getByTestId('btn-save-byok').click();
  const storageContainsKey = await page.evaluate(async key => {
    const records = [...Object.entries(localStorage), ...Object.entries(sessionStorage)];
    return JSON.stringify(records).includes(key) || document.cookie.includes(key);
  }, mockKey);
  assert.equal(storageContainsKey, false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openDrawer(page);
  assert.equal(await page.getByTestId('byok-enabled').isChecked(), false);
  await page.getByTestId('byok-enabled').check();
  assert.equal(await page.getByTestId('byok-api-key').inputValue(), '');
  assert.equal(errors.length, 0);
  report.checks.fixtureEndToEnd = 'PASS';
  report.checks.realAuthenticatedProvider = 'NOT_RUN: user must enter own key';
  await ctx.close();
} catch (error) {
  report.checks.fixtureEndToEnd = 'FAIL at ' + fixturePhase + ': ' + String(error).slice(0, 300);
  if (fixturePage) await shot(fixturePage, '07-fixture-failure').catch(() => {});
} finally {
  await browser.close();
  await fs.writeFile(out + '/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
assert.equal(report.checks.publicPages, 'PASS');
assert.equal(report.checks.fixtureEndToEnd, 'PASS');
