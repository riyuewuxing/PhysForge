import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const out = 'artifacts/byok-audit';
const verifyLive = process.env.PHYSFORGE_VERIFY_DEPLOYMENT === '1';
const preview = verifyLive ? 'https://riyuewuxing.github.io/PhysForge/' : 'http://127.0.0.1:4173/PhysForge/';
const offlineTool = path.resolve(out, 'physforge-ai-vault.html');
await fs.mkdir(out, {recursive:true});
if (verifyLive) {
  const response = await fetch(new URL('ai-vault.html', preview), { cache:'no-store', redirect:'error', signal:AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Published offline tool unavailable');
  const html = await response.text();
  if (!html.includes('PhysForge AI 密钥保险库') || !html.includes('connect-src')) throw new Error('Wrong published offline tool');
  await fs.writeFile(offlineTool, html);
} else {
  await fs.copyFile('apps/web/dist/ai-vault.html', offlineTool);
}
const password = 'fixture-only-vault-password-2026';
const key = 'fixture-vault-deepseek-not-real';
const secondKey = 'fixture-vault-openai-not-real';
const browser = await chromium.launch({headless:true});
let phase = 'offline tool';
const report = {result:'FAIL', checks:{}};
try {
  const offline = await browser.newContext({viewport:{width:1440,height:900}, serviceWorkers:'block', acceptDownloads:true});
  let requests = 0;
  await offline.route(/^https?:\/\//, route => { requests++; return route.abort(); });
  const tool = await offline.newPage();
  await tool.goto(pathToFileURL(offlineTool).href);
  await tool.locator('[data-field=apiKey]').first().fill(key);
  await tool.locator('#add').click();
  await tool.getByLabel('供应商模板').nth(1).selectOption('OpenAI');
  await tool.locator('[data-field=apiKey]').nth(1).fill(secondKey);
  await tool.locator('#password').fill(password);
  await tool.locator('#confirm').fill(password);
  const downloadEvent = tool.waitForEvent('download', {timeout:20000});
  await tool.locator('#encrypt').click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), 'ai-vault.enc.json');
  const raw = await fs.readFile(await download.path(), 'utf8');
  for (const value of [key, secondKey, password]) assert.ok(!raw.includes(value));
  assert.equal(requests, 0);
  assert.equal(await tool.locator('[data-field=apiKey]').first().inputValue(), '');
  await tool.screenshot({path:out+'/09-offline-encryption-tool.png', animations:'disabled', fullPage:true});
  report.checks.offlineTool = 'PASS';
  await offline.close();

  phase = 'workbench import / wrong password / unlock';
  const context = await browser.newContext({viewport:{width:1440,height:900}, serviceWorkers:'block'});
  const page = await context.newPage();
  let paidCalls = 0;
  await context.route('https://api.deepseek.com/**', route => { paidCalls++; return route.abort(); });
  await context.route('https://api.openai.com/**', route => { paidCalls++; return route.abort(); });
  async function drawer(p) {
    await p.getByTestId('app-shell').waitFor();
    await p.getByTestId('btn-tools-menu').click();
    await p.getByTestId('btn-ai-copilot-menu').click();
    await p.getByTestId('ai-copilot-drawer').waitFor();
    await p.getByTestId('ai-vault-panel').locator('summary').click();
  }
  await page.goto(preview);
  await drawer(page);
  await page.getByTestId('vault-file').setInputFiles({name:'ai-vault.enc.json',mimeType:'application/json',buffer:Buffer.from(raw)});
  await page.getByTestId('vault-password').fill('wrong-password-fixture');
  await page.getByTestId('vault-unlock').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=vault-status]')?.textContent?.includes('解锁失败'));
  assert.equal(await page.getByTestId('byok-enabled').isChecked(), false);
  await page.getByTestId('vault-password').fill(password);
  await page.getByTestId('vault-unlock').click();
  await page.getByTestId('vault-profile-0').waitFor();
  assert.equal(await page.getByTestId('byok-api-key').inputValue(), key);
  assert.equal(await page.getByTestId('byok-model').inputValue(), 'deepseek-flash');
  await page.getByTestId('vault-profile-1').click();
  assert.equal(await page.getByTestId('byok-base-url').inputValue(), 'https://api.openai.com/v1');
  assert.equal(await page.getByTestId('byok-api-key').inputValue(), secondKey);
  await page.getByTestId('vault-profile-0').click();
  await page.screenshot({path:out+'/10-workbench-unlocked-vault.png', animations:'disabled'});
  report.checks.importUnlockSwitch = 'PASS';

  phase = 'new tab and refresh';
  const other = await context.newPage();
  await other.goto(preview);
  await drawer(other);
  await other.getByTestId('vault-password').waitFor();
  assert.equal(await other.getByTestId('byok-enabled').isChecked(), false);
  await other.getByTestId('vault-password').fill(password);
  await other.getByTestId('vault-unlock').click();
  await other.getByTestId('vault-profile-0').waitFor();
  assert.equal(await other.getByTestId('byok-api-key').inputValue(), key);
  await other.getByTestId('vault-lock').click();
  assert.equal(await other.getByTestId('byok-enabled').isChecked(), false);
  // Removing shared ciphertext invalidates unlocked state in other open tabs.
  await other.getByTestId('vault-forget').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=vault-status]')?.textContent?.includes('另一标签页'));
  assert.equal(await page.getByTestId('byok-enabled').isChecked(), false);
  await page.getByTestId('vault-file').setInputFiles({name:'ai-vault.enc.json',mimeType:'application/json',buffer:Buffer.from(raw)});
  await page.getByTestId('vault-password').waitFor();
  await page.reload();
  await drawer(page);
  await page.getByTestId('vault-password').waitFor();
  assert.equal(await page.getByTestId('byok-enabled').isChecked(), false);
  const storageSafe = await page.evaluate(values => {
    const all = JSON.stringify([...Object.entries(localStorage), ...Object.entries(sessionStorage)]) + document.cookie;
    return values.every(value => !all.includes(value));
  }, [password,key,secondKey]);
  assert.ok(storageSafe);
  await page.screenshot({path:out+'/11-vault-after-refresh-locked.png', animations:'disabled'});
  await page.getByTestId('vault-forget').click();
  assert.equal(await page.getByTestId('vault-password').count(), 0);
  await page.reload();
  await drawer(page);
  assert.equal(await page.getByTestId('vault-password').count(), 0);
  report.checks.refreshAndForget = 'PASS';

  phase = 'cloud ciphertext fixture';
  await page.route('**/ai-vault.enc.json', route => route.fulfill({status:200,contentType:'application/json',body:raw}));
  await page.getByTestId('vault-load-cloud').click();
  await page.getByTestId('vault-password').fill(password);
  await page.getByTestId('vault-unlock').click();
  await page.getByTestId('vault-profile-0').waitFor();
  assert.equal(await page.getByTestId('byok-api-key').inputValue(), key);
  await page.getByTestId('vault-lock').click();
  assert.equal(paidCalls, 0);
  report.checks.cloudCiphertextFixture = 'PASS';
  report.result = 'PASS';
  await context.close();
} catch (err) {
  report.phase = phase;
  report.error = String(err).slice(0, 500); // Only synthetic test data exists in this workflow.
} finally {
  await browser.close();
  await fs.mkdir(out,{recursive:true});
  await fs.writeFile(out+'/vault-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
assert.equal(report.result,'PASS');
