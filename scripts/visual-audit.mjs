import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
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


async function auditB4Analytic(page,origin){
  const url=new URL(origin);url.searchParams.set('model','builder-mechanics-lab');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='builder-mechanics-lab',null,{timeout:20000});
  const canvas=page.getByTestId('simulation-canvas');
  const read=async()=>JSON.parse(await canvas.getAttribute('data-b4-rendered'));
  const waitMode=async(scenario)=>page.waitForFunction(mode=>{
    const d=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-b4-rendered')||'null');
    return d?.scenario===mode&&d.t===0;
  },scenario,{timeout:5000});
  const run=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]');
  const runTo=async(t)=>{
    await run.click();
    await page.waitForFunction(t=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-b4-rendered')||'null')?.t>t,t,{timeout:10000});
    await run.click();
    return await read();
  };
  await selectPreset(page,'atwood-udwadia-analytical',true);
  await waitMode('atwood-constrained');
  const initial=await read();
  if(initial.rapierActive!==0||Math.abs(initial.constraintTensionN-4*9.8/3)>1e-9)throw Error('B4 initial Atwood tension '+JSON.stringify(initial));
  if(!await page.getByTestId('param-slider-massRatio').isVisible()||await page.getByTestId('param-slider-restitution').count())throw Error('B4 Atwood mode controls are incorrect');
  await page.waitForFunction(()=>document.querySelector('[data-testid="scope-channel-a"]')?.textContent?.includes('左重物速度')&&document.querySelector('[data-testid="scope-channel-b"]')?.textContent?.includes('右重物速度'));
  await page.getByTestId('b4-scope-empty').waitFor({state:'visible'});
  if(await page.getByTestId('uplot-container').isVisible())throw Error('B4 one sample fabricated time axis');
  await page.screenshot({path:path.join(OUT_DIR,'H10_B4_atwood_initial.png')});
  const atwood=await runTo(.18),a=9.8/3;
  if(atwood.t>.65||atwood.rapierActive!==0||Math.abs(atwood.primaryY-(.1+.5*a*atwood.t**2))>1e-9||Math.abs(atwood.primaryY+atwood.secondaryY-.2)>1e-9||Math.abs(atwood.primaryVy-a*atwood.t)>1e-9||Math.abs(atwood.primaryVy+atwood.secondaryVy)>1e-9)throw Error('B4 Atwood independent trajectory '+JSON.stringify(atwood));
  await page.screenshot({path:path.join(OUT_DIR,'H10_B4_atwood_running.png')});
  await run.click();
  await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-b4-rendered')||'null')?.atwoodAtLimit===1,null,{timeout:10000});
  const terminal=await read(),limit=Math.sqrt(2*(1.4-Math.sqrt(.28**2-(.28-.22)**2)-.1-.22)/a);
  if(Math.abs(terminal.t-limit)>1e-9||Math.abs(terminal.primaryVy-a*limit)>1e-9||Math.abs(terminal.primaryY+terminal.secondaryY-.2)>1e-9)throw Error('B4 terminal event '+JSON.stringify(terminal));
  await page.waitForFunction(t=>Math.abs(Number(document.querySelector('[data-testid="uplot-container"]')?.getAttribute('data-last-sample-t'))-t)<1e-10,terminal.t);
  await page.waitForTimeout(150);
  if((await read()).t!==terminal.t)throw Error('B4 terminal physical time continued');
  await page.screenshot({path:path.join(OUT_DIR,'H10_B4_atwood_terminal.png')});
  await selectPreset(page,'incline-slide-impact');
  await waitMode('incline-slide');
  const slope0=await read();
  await page.screenshot({path:path.join(OUT_DIR,'H10_B4_incline_initial.png')});
  const slope=await runTo(.18),theta=Math.PI/6,acc=9.8*(Math.sin(theta)-.05*Math.cos(theta));
  if(slope.rapierActive!==1||Math.abs(slope.primaryVx*Math.cos(theta)-slope.sliderVy*Math.sin(theta)-acc*slope.t)>.06||Math.abs((slope.primaryX-slope0.primaryX)*Math.sin(theta)+(slope.sliderY-slope0.sliderY)*Math.cos(theta))>.01)throw Error('B4 incline independent contact dynamics '+JSON.stringify({slope0,slope}));
  await page.screenshot({path:path.join(OUT_DIR,'H10_B4_incline_running.png')});
  await selectPreset(page,'inelastic-collision');await waitMode('elastic-collision');
  const inelastic=await runTo(1.02),common=2.6/3;
  if(inelastic.rapierActive!==1||Math.abs(inelastic.primaryVx-common)>.08||Math.abs(inelastic.secondaryVx-common)>.08||Math.abs(inelastic.totalMomentumX-2.6)>.01||Math.abs(inelastic.kineticEnergy-.5*3*common**2)/3.38>.02)throw Error('B4 independent inelastic collision '+JSON.stringify(inelastic));
  await page.screenshot({path:path.join(OUT_DIR,'H10_B4_inelastic_running.png')});
  await selectPreset(page,'newtons-cradle-chain');await waitMode('newtons-cradle');
  const cradle=await runTo(.8);
  if(cradle.rapierActive!==1||Math.abs(cradle.totalMomentumX-3)>.01||Math.abs(cradle.kineticEnergy-4.5)/4.5>.02||Math.abs(cradle.lastBallVx-3)>.15)throw Error('B4 independent four-ball transfer '+JSON.stringify(cradle));
  await page.screenshot({path:path.join(OUT_DIR,'H10_B4_cradle_running.png')});
  await selectPreset(page,'ideal-spring-oscillator');
  await waitMode('spring-oscillator');
  const spring0=await read(),w=Math.sqrt(20);
  if(spring0.rapierActive!==0||Math.abs(spring0.springMechanicalEnergy-15.625)>1e-9)throw Error('B4 initial spring energy '+JSON.stringify(spring0));
  if(!await page.getByTestId('param-slider-springK').isVisible()||await page.getByTestId('param-slider-massRatio').count()||await page.getByTestId('param-slider-friction').count())throw Error('B4 spring mode controls incorrect');
  await page.waitForFunction(()=>document.querySelector('[data-testid="scope-channel-a"]')?.textContent?.includes('系统总动能')&&document.querySelector('[data-testid="scope-channel-b"]')?.textContent?.includes('弹性势能'));
  const spring=await runTo(.35);
  if(spring.rapierActive!==0||Math.abs(spring.primaryX-(-.45+1.25*Math.cos(w*spring.t)))>1e-8||Math.abs(spring.primaryVx+1.25*w*Math.sin(w*spring.t))>1e-8||Math.abs(spring.springMechanicalEnergy-15.625)>1e-8)throw Error('B4 spring independent trajectory '+JSON.stringify(spring));
  await page.screenshot({path:path.join(OUT_DIR,'H10_B4_spring_running.png')});
  await page.getByTestId('btn-tools-menu').click();
  await page.getByTestId('btn-auto-fbd').click();
  if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
  await page.screenshot({path:path.join(OUT_DIR,'H10_B4_spring_fbd.png')});
  console.log('H10 B4 independent browser '+JSON.stringify({initial,atwood,terminal,slope0,slope,inelastic,cradle,spring0,spring}));
  return {initial,atwood,terminal,slope0,slope,inelastic,cradle,spring0,spring};
}

async function auditB5Ode(page,origin){
  const url=new URL(origin);url.searchParams.set('model','builder-custom-ode-lab');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='builder-custom-ode-lab',null,{timeout:20000});
  const canvas=page.getByTestId('simulation-canvas'),run=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]');
  const read=async()=>JSON.parse(await canvas.getAttribute('data-ode-rendered'));
  const waitMode=async(template)=>page.waitForFunction(m=>{const d=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-ode-rendered')||'null');return d?.template===m&&d.t===0;},template,{timeout:5000});
  await selectPreset(page,'nonlinear-duffing-expr',true);await waitMode('custom-expr');
  await page.getByTestId('ode-expression-input').fill('-4*x');
  await page.getByTestId('ode-expression-apply').click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="formula-card"]')?.textContent?.includes('a = -4*x'));
  const initial=await read();if(initial.solverValid!==1||'energy' in initial||'angularMomentum' in initial)throw Error('B5 custom false energy '+JSON.stringify(initial));
  await page.getByTestId('ode-scope-empty').waitFor({state:'visible'});
  await run.click();await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-ode-rendered')||'null')?.t>.35,null,{timeout:10000});await run.click();
  const harmonic=await read(),w=2;
  if(Math.abs(harmonic.x-Math.cos(w*harmonic.t))>1e-7||Math.abs(harmonic.v+w*Math.sin(w*harmonic.t))>1e-7||Math.abs(harmonic.kineticEnergy-.5*harmonic.v**2)>1e-9)throw Error('B5 edited acceleration trajectory '+JSON.stringify(harmonic));
  await page.screenshot({path:path.join(OUT_DIR,'H11_B5_custom_running.png')});
  await page.getByTestId('ode-expression-input').fill('1/0');await page.getByTestId('ode-expression-apply').click();
  await page.getByTestId('ode-invalid').waitFor({state:'visible'});
  await run.click();await page.waitForTimeout(250);
  const invalid=await read();if(invalid.t!==0||invalid.solverValid!==0)throw Error('B5 singular formula advanced '+JSON.stringify(invalid));
  await page.screenshot({path:path.join(OUT_DIR,'H11_B5_invalid.png')});
  await selectPreset(page,'lagrangian-driven-pendulum',true);await waitMode('lagrangian-pendulum');
  await page.waitForFunction(()=>document.querySelector('[data-testid="scope-channel-a"]')?.textContent?.includes('摆角')&&document.querySelector('[data-testid="scope-channel-b"]')?.textContent?.includes('角速度'));
  const pend=await read();if(Math.abs(pend.energy-(.5*pend.omega**2+9.8*(1-Math.cos(pend.theta))))>1e-9)throw Error('B5 pendulum energy '+JSON.stringify(pend));
  if(await page.getByTestId('ode-expression-input').count())throw Error('B5 pendulum shows arbitrary expression editor');
  await page.screenshot({path:path.join(OUT_DIR,'H11_B5_pendulum_initial.png')});
  await selectPreset(page,'kepler-elliptical-orbit',true);await waitMode('kepler-2d');
  const orbit0=await read();
  await run.click();await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-ode-rendered')||'null')?.t>.5,null,{timeout:10000});await run.click();
  const orbit=await read();if(Math.abs(orbit.energy-orbit0.energy)>1e-4||Math.abs(orbit.angularMomentum-orbit0.angularMomentum)>1e-8)throw Error('B5 orbital invariants '+JSON.stringify({orbit0,orbit}));
  await page.screenshot({path:path.join(OUT_DIR,'H11_B5_orbit_running.png')});
  console.log('H11 B5 online '+JSON.stringify({initial,harmonic,invalid,pend,orbit0,orbit}));
  return {initial,harmonic,invalid,pend,orbit0,orbit};
}

async function assertChaseVisible(page,canvasId,tag){
  const result=await page.evaluate(({canvasId,tag})=>{
    const canvas=document.querySelector('[data-testid="'+canvasId+'"]'),v=JSON.parse(canvas.dataset.chaseViewport||'null'),s=JSON.parse(canvas.dataset.chaseRendered||'null');
    if(!v||!s)throw Error('M01 actual rendered viewport missing: '+tag);
    const box=canvas.getBoundingClientRect(),panel=document.querySelector('[data-testid="right-control-panel"]')?.getBoundingClientRect();
    const left=box.left+8,right=Math.min(box.right-8,panel&&panel.width&&panel.left>box.left?panel.left-8:box.right-8);
    const ppm=.24*Math.min(v.width,v.height)*v.scale,ctx=document.createElement('canvas').getContext('2d');ctx.font='12px ui-monospace,monospace';
    const cars=['A','B'].map(n=>{
      const x=box.left+.45*v.width+v.offsetX+s['x'+n]*ppm;
      const label='x='+s['x'+n].toFixed(2)+' m · v='+s['v'+n].toFixed(2)+' m/s';
      const half=Math.max(15,ctx.measureText(label).width/2)+2;
      return {n,x,left:x-half,right:x+half};
    });
    return {tag,t:s.t,left,right,cars};
  },{canvasId,tag});
  console.log('H14 M01 actual projection '+JSON.stringify(result));
  if(result.cars.some(c=>c.left<result.left||c.right>result.right))throw Error('M01 actual car or label occluded '+JSON.stringify(result));
  return result;
}

async function auditM01Chase(page,origin){
  const url=new URL(origin);url.searchParams.set('model','mech-kinematics-chase');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='mech-kinematics-chase',null,{timeout:20000});
  const canvas=page.getByTestId('simulation-canvas'),play=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]');
  const read=async()=>JSON.parse(await canvas.getAttribute('data-chase-rendered'));
  const waitInitial=async(x)=>page.waitForFunction(x=>{const d=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-chase-rendered')||'null');return d?.t===0&&d.xB===x;},x,{timeout:5000});
  const runTo=async(t)=>{await play.click();await page.waitForFunction(t=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-chase-rendered')||'null')?.t>t,t,{timeout:15000});await play.click();const s=await read();await page.waitForFunction(t=>Math.abs(Number(document.querySelector('[data-testid="uplot-container"]')?.getAttribute('data-last-sample-t'))-t)<1e-10,t===s.t?t:s.t);return s;};
  await selectPreset(page,'catchup-acceleration',true);await waitInitial(16);
  await page.getByTestId('chase-scope-empty').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="scope-channel-a"]')?.getAttribute('data-channel-key')==='vA'&&document.querySelector('[data-testid="scope-channel-b"]')?.getAttribute('data-channel-key')==='vB');
  const initial=await read();if(initial.deltaX!==16||initial.minGap!==16||initial.meetCount!==0)throw Error('M01 initial data '+JSON.stringify(initial));
  await page.screenshot({path:path.join(OUT_DIR,'H12_M01_initial.png')});
  await page.locator('[data-testid="topbar"]').getByLabel('播放倍速').selectOption('2');
  const catchup=await runTo(9.70);
  if(Math.abs(catchup.xA-catchup.t**2)>1e-7||Math.abs(catchup.xB-(16+8*catchup.t))>1e-7||Math.abs(catchup.vA-2*catchup.t)>1e-7||Math.abs(catchup.firstCoVelocityTime-4)>1e-9||Math.abs(catchup.firstMeetTime-(4+4*Math.SQRT2))>1e-9||catchup.meetCount!==1||catchup.minGap!==0||catchup.deltaX>=0)throw Error('M01 analytic crossing '+JSON.stringify(catchup));
  await page.screenshot({path:path.join(OUT_DIR,'H12_M01_catchup_velocity.png')});
  for(const [id,key] of [['scope-channel-a','xA'],['scope-channel-b','xB']]){
    const b=page.getByTestId(id);for(let i=0;i<8&&await b.getAttribute('data-channel-key')!==key;i++)await b.click();
    if(await b.getAttribute('data-channel-key')!==key)throw Error('M01 position channel missing '+key);
  }
  await page.waitForFunction(t=>{const d=document.querySelector('[data-testid="uplot-container"]')?.dataset;return d?.plotChannelA==='xA'&&d?.plotChannelB==='xB'&&Number(d.sampleCount)>2&&Math.abs(Number(d.lastSampleT)-t)<1e-10;},catchup.t,{timeout:5000});
  await page.screenshot({path:path.join(OUT_DIR,'H12_M01_catchup_position.png')});
  const nearVisibility=await assertChaseVisible(page,'simulation-canvas','near-meeting');
  const long=await runTo(12.10);
  if(Math.abs(long.xA-long.t**2)>1e-7||Math.abs(long.xB-(16+8*long.t))>1e-7||long.meetCount!==1||long.minGap!==0)throw Error('M01 long analytic trajectory '+JSON.stringify(long));
  await page.screenshot({path:path.join(OUT_DIR,'H14_M01_long_position.png')});
  const longVisibility=await assertChaseVisible(page,'simulation-canvas','over-12s');
  const view=async()=>JSON.parse(await canvas.getAttribute('data-chase-viewport'));
  const prior=await view(),box=await canvas.boundingBox();
  if(!box)throw Error('M01 missing canvas for real pan');
  await page.mouse.move(box.x+80,box.y+120);await page.mouse.down();await page.mouse.move(box.x+140,box.y+145,{steps:4});await page.mouse.up();
  const manual=await view();
  if(await canvas.getAttribute('data-chase-auto-fit')!=='false'||Math.abs(manual.offsetX-prior.offsetX-60)>1||Math.abs(manual.offsetY-prior.offsetY-25)>1)throw Error('M01 pan ownership '+JSON.stringify({prior,manual}));
  const manualTime=await runTo(13.2),afterManual=await view();
  if(['scale','offsetX','offsetY'].some(k=>Math.abs(afterManual[k]-manual[k])>1e-9))throw Error('M01 manual camera overwritten '+JSON.stringify({manual,afterManual,manualTime}));
  await page.getByTestId('btn-reset-view').click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="simulation-canvas"]')?.dataset.chaseAutoFit==='true');
  const resetVisibility=await assertChaseVisible(page,'simulation-canvas','reset-after-manual-pan');
  await page.screenshot({path:path.join(OUT_DIR,'H14_M01_reset_auto.png')});
  await selectPreset(page,'brake-safe-margin',true);await waitInitial(42);
  const safe=await runTo(5.45);
  if(Math.abs(safe.xA-58)>1e-8||safe.vA!==0||safe.aA!==0||Math.abs(safe.xB-(42+6*safe.t))>1e-8||Math.abs(safe.minGap-11.9)>1e-8||Math.abs(safe.firstCoVelocityTime-3.9)>1e-8||safe.meetCount!==0)throw Error('M01 safe braking '+JSON.stringify(safe));
  if(!await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
  await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
  if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
  await page.screenshot({path:path.join(OUT_DIR,'H12_M01_safe_paper.png')});
  if(!await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
  await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='chalkboard');
  if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
  await page.locator('[data-testid="topbar"]').getByLabel('播放倍速').selectOption('1');
  console.log('H12 M01 online '+JSON.stringify({initial,catchup,long,safe,nearVisibility,longVisibility,resetVisibility}));
  return {initial,catchup,long,safe,nearVisibility,longVisibility,resetVisibility};
}


async function auditM02Equilibrium(page,origin){
  const url=new URL(origin);url.searchParams.set('model','mech-dynamic-equilibrium');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='mech-dynamic-equilibrium',null,{timeout:20000});
  const canvas=page.getByTestId('simulation-canvas'),play=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]');
  const read=async()=>JSON.parse(await canvas.getAttribute('data-equilibrium-rendered'));
  const waitAngle=async(a)=>page.waitForFunction(a=>{const d=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-equilibrium-rendered')||'null');return d?.t===0&&Math.abs(d.angleDeg-a)<1e-8;},a,{timeout:5000});
  await selectPreset(page,'dead-knot-triangle',true);await waitAngle(37);
  const minimum=await read();
  if(Math.abs(minimum.force2-19.6*Math.sin(37*Math.PI/180))>1e-9||minimum.netResidualN>=1e-10)throw Error('M02 minimum '+JSON.stringify(minimum));
  await page.screenshot({path:path.join(OUT_DIR,'H13_M02_minimum.png')});
  await page.getByTestId('param-slider-baseAngleDeg').fill('75');
  await page.getByTestId('param-slider-sweepAngleDeg').fill('-30');await waitAngle(-30);
  await page.getByTestId('equilibrium-no-solution').waitFor({state:'visible'});
  const invalid=await read();if(invalid.solutionDefined!==0||'force1' in invalid||'force2' in invalid)throw Error('M02 invalid invented force '+JSON.stringify(invalid));
  await page.screenshot({path:path.join(OUT_DIR,'H13_M02_infeasible.png')});
  await selectPreset(page,'active-pulley-symmetry',true);await waitAngle(45);
  const pulley=await read();if(Math.abs(pulley.force1-19.6/Math.SQRT2)>1e-9||pulley.force1!==pulley.force2)throw Error('M02 unequal pulley '+JSON.stringify(pulley));
  await page.screenshot({path:path.join(OUT_DIR,'H13_M02_pulley.png')});
  await selectPreset(page,'hemisphere-suspended-rope',true);await waitAngle(35);
  const sphere=await read();
  const checkSphere=d=>{const L=Math.sqrt(1+1.6**2-3.2*Math.cos(d.angleDeg*Math.PI/180));if(Math.abs(d.force1-19.6/1.6)>1e-9||Math.abs(d.force2-19.6*L/1.6)>1e-9||Math.abs(d.ropeLengthM-L)>1e-9||d.netResidualN>=1e-10)throw Error('M02 hemisphere '+JSON.stringify(d));};
  checkSphere(sphere);
  const expand=page.getByTestId('btn-expand-oscilloscope');
  if(await expand.isVisible())await expand.click();
  await page.getByTestId('uplot-container').waitFor({state:'attached'});
  await page.getByTestId('equilibrium-scope-empty').waitFor({state:'visible'});
  await play.click();await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-equilibrium-rendered')||'null')?.t>.8,null,{timeout:10000});await play.click();
  const scanned=await read();checkSphere(scanned);if(Math.abs(scanned.angleDeg-sphere.angleDeg)<1)throw Error('M02 scan did not change');
  await page.waitForFunction(t=>Math.abs(Number(document.querySelector('[data-testid="uplot-container"]')?.getAttribute('data-last-sample-t'))-t)<1e-10,scanned.t,{timeout:5000});
  await page.screenshot({path:path.join(OUT_DIR,'H13_M02_hemisphere_running.png')});
  if(!await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
  await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
  if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
  await page.screenshot({path:path.join(OUT_DIR,'H13_M02_hemisphere_paper.png')});
  if(!await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
  await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='chalkboard');
  if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
  console.log('H13 M02 online '+JSON.stringify({minimum,invalid,pulley,sphere,scanned}));
  return {minimum,invalid,pulley,sphere,scanned};
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

async function auditB1Physics(page,origin,screenshot){
  const url=new URL(origin);url.searchParams.set('model','builder-composite-em-field');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='builder-composite-em-field');
  const report=[];
  // Capture actual rendered state on timeout, not just a generic Playwright line.
  const waitB1=async(condition,label,timeout=15000)=>{
    try{await page.waitForFunction(condition,null,{timeout});}
    catch(error){
      const status=await page.evaluate(()=>{
        const stage=document.querySelector('[data-testid="three-stage-container"]');
        const play=[...document.querySelectorAll('[data-testid="btn-play-pause"]')].find(el=>el.getBoundingClientRect().width>0);
        return {stage:stage?{...stage.dataset}:null,play:play?.getAttribute('aria-label'),topbar:document.querySelector('[data-testid="topbar"]')?.textContent};
      });
      if(screenshot)await screenshot('B1_failure_'+label);
      throw Error('B1 '+label+' timeout: '+JSON.stringify(status),{cause:error});
    }
  };
  const checkB1Composition=async(stage)=>{
    const result=await stage.evaluate(el=>{
      const b=JSON.parse(el.dataset.b1ScreenBounds||'null'),r=el.getBoundingClientRect();
      const relative=selector=>{const e=document.querySelector(selector);if(!e)return null;const a=e.getBoundingClientRect();return {left:a.left-r.left,right:a.right-r.left,top:a.top-r.top,bottom:a.bottom-r.top};};
      const formula=relative('[data-testid="fullscreen-formula"]'),controls=relative('[data-testid="fullscreen-controls"]'),title=relative('[data-testid="fullscreen-title"]');
      return {b,width:r.width,height:r.height,formula,controls,title};
    });
    const {b,width,height,formula,controls,title}=result;
    if(!b?.visible||b.left<8||b.right>width-8||b.top<8||b.bottom>height-8)throw Error('B1 physical envelope is clipped '+JSON.stringify(result));
    for(const rect of [formula,controls,title])if(rect&&b.left<rect.right+4&&b.right>rect.left-4&&b.top<rect.bottom+4&&b.bottom>rect.top-4)
      throw Error('B1 real content overlaps presentation chrome '+JSON.stringify(result));
    return result;
  };
  for(const preset of ['circle-magnetic-focusing','crossed-eb-cycloid']){
    await selectPreset(page,preset);
    const scope=page.getByTestId('floating-scope-dock');
    await scope.waitFor({state:'visible'});
    if(await scope.getAttribute('data-scope-units')!=='separate')throw Error('B1 mixed physical units share a scope axis');
    if(preset==='crossed-eb-cycloid'){
      const workbenchPlay=page.locator('[data-testid="btn-play-pause"]:visible');
      if(await workbenchPlay.getAttribute('aria-label')==='运行')await workbenchPlay.click();
      await page.waitForFunction(()=>Number(document.querySelector('[data-testid="topbar"]')?.textContent?.match(/t\s*=\s*([0-9.]+)\s*s/)?.[1])>0.7,null,{timeout:10000});
      if(await workbenchPlay.getAttribute('aria-label')==='暂停')await workbenchPlay.click();
      const scopeCanvas=await scope.locator('canvas').first().boundingBox();
      if(!scopeCanvas||scopeCanvas.height<140||await page.getByTestId('scope-empty').isVisible())throw Error('B1 running chart missing or clipped');
      if(screenshot)await screenshot('B1_workbench_running');
      await page.getByTestId('btn-tools-menu').click();
      await page.getByTestId('btn-theme').click();
      await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
      if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
      if(screenshot)await screenshot('B1_workbench_projector');
      await page.getByTestId('btn-tools-menu').click();
      await page.getByTestId('btn-theme').click();
      await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='chalkboard');
      if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
      await page.locator('[data-testid="btn-reset"]:visible').click();
      await page.waitForFunction(()=>Number(document.querySelector('[data-testid="topbar"]')?.textContent?.match(/t\s*=\s*([0-9.]+)\s*s/)?.[1])===0);
    }
    await page.getByTestId('btn-fullscreen-speech').click();
    const toggle=page.getByTestId('btn-view-3d-fullscreen');
    if((await toggle.textContent())?.includes('3D 空间'))await toggle.click();
    const stage=page.getByTestId('three-stage-container');
    await stage.waitFor({state:'visible',timeout:20000});
    await page.waitForFunction(()=>Number(document.querySelector('[data-testid="three-stage-container"]')?.getAttribute('data-morph-t'))===0);
    const play=page.locator('[data-testid="btn-play-pause"]:visible');
    // The previous workbench reset must propagate through the real morph.
    // No synthetic advance, retry click, or increased original run timeout.
    await waitB1(()=>Number(document.querySelector('[data-testid="three-stage-container"]')?.getAttribute('data-b1-render-time'))===0,'reset-frame');
    if(await play.getAttribute('aria-label')!=='运行')throw Error('B1 reset did not pause');
    await play.click();
    await page.waitForFunction(()=>[...document.querySelectorAll('[data-testid="btn-play-pause"]')].some(el=>el.getBoundingClientRect().width>0&&el.getAttribute('aria-label')==='暂停'));
    if(preset==='circle-magnetic-focusing'){
      await waitB1(()=>JSON.parse(document.querySelector('[data-testid="three-stage-container"]')?.getAttribute('data-b1-render-exits')||'[]').length===5,'focus-exits');
      if(await play.getAttribute('aria-label')==='暂停')await play.click();
      const exits=JSON.parse(await stage.getAttribute('data-b1-render-exits')||'[]');
      const maxError=Math.max(...exits.map(p=>Math.hypot(p.x,p.y+1.2)));
      if(exits.length!==5||maxError>1e-6)throw Error('B1 real focusing error '+maxError);
      report.push({preset,exits,maxError});
    }else{
      await waitB1(()=>Number(document.querySelector('[data-testid="three-stage-container"]')?.getAttribute('data-b1-render-time'))>1.1,'cycloid-progress');
      if(await play.getAttribute('aria-label')==='暂停')await play.click();
      const s=JSON.parse(await stage.getAttribute('data-b1-render-primary')||'null');
      if(!s||!(s.t>1))throw Error('B1 crossed field has no actual state');
      const theta=2*s.t,x=1.5*(s.t-Math.sin(theta)/2),y=.75*(1-Math.cos(theta)),vx=1.5*(1-Math.cos(theta)),vy=1.5*Math.sin(theta);
      const error=Math.max(Math.hypot(s.position.x-x,s.position.y-y),Math.hypot(s.velocity.x-vx,s.velocity.y-vy));
      if(error>1e-6)throw Error('B1 browser cycloid oracle error '+error);
      report.push({preset,t:s.t,error});
    }
    // Ensure the last paused WebGL frame catches up to the final engine state.
    await waitB1(()=>{
      const el=document.querySelector('[data-testid="three-stage-container"]');
      const t=Number(el?.getAttribute('data-b1-time')),rendered=Number(el?.getAttribute('data-b1-render-time'));
      return Number.isFinite(t)&&Number.isFinite(rendered)&&Math.abs(t-rendered)<1e-8;
    },'paused-state-agreement');
    report[report.length-1].composition=await checkB1Composition(stage);
    if(screenshot)await screenshot('B1_'+preset+'_3d');
    if(preset==='circle-magnetic-focusing'){
      const axis=stage.locator('[data-magnetic-axis-widget]');
      await axis.waitFor({state:'visible'});
      const before=await axis.getAttribute('data-axis-orientation');
      if(!before)throw Error('B1 physical axes not initialized');
      const bounds=await stage.locator('canvas').boundingBox();
      if(!bounds)throw Error('B1 orbit canvas missing');
      const paused=await stage.getAttribute('data-b1-time');
      await page.mouse.move(bounds.x+bounds.width*.54,bounds.y+bounds.height*.43);
      await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.64,bounds.y+bounds.height*.49,{steps:8});await page.mouse.up();
      await page.waitForFunction(old=>document.querySelector('[data-magnetic-axis-widget]')?.getAttribute('data-axis-orientation')!==old,before);
      if(await stage.getAttribute('data-b1-time')!==paused)throw Error('B1 paused time changed during orbit');
      if(await stage.getAttribute('data-b1-auto-fit')!=='false')throw Error('B1 manual orbit must take ownership of camera');
      if(screenshot)await screenshot('B1_focus_orbit');
    }
    await toggle.click();await stage.waitFor({state:'detached',timeout:15000});
    const flat=page.getByTestId('simulation-canvas');
    await flat.waitFor({state:'visible'});
    const expectedOwner=preset==='circle-magnetic-focusing'?'false':'true';
    await page.waitForFunction(expected=>document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-b1-auto-fit')===expected,expectedOwner);
    if(screenshot)await screenshot('B1_'+preset+'_flat');
    await page.getByTestId('btn-exit-fullscreen-speech').click();
  }
  // Real paused 2D pan, followed by a 3D round-trip, must not silently
  // re-enable automatic framing; explicit center reset is the owner switch.
  const flat=page.getByTestId('simulation-canvas');
  await flat.waitFor({state:'visible'});
  await page.waitForFunction(()=>{
    const e=document.querySelector('[data-testid="simulation-canvas"]'),v=JSON.parse(e?.getAttribute('data-b1-viewport')||'null'),r=e?.getBoundingClientRect();
    return !!v&&!!r&&Math.abs(v.width-r.width)<1&&Math.abs(v.height-r.height)<1&&e.getAttribute('data-b1-auto-fit')==='true';
  });
  const time=await flat.getAttribute('data-b1-time');
  const rect=await flat.boundingBox();
  if(!rect||!time)throw Error('B1 flat camera diagnostics missing');
  const x=Math.round(rect.x+rect.width*.14),y=Math.round(rect.y+rect.height*.17);
  await page.mouse.move(x,y);
  const before=JSON.parse(await flat.getAttribute('data-b1-viewport')||'null');
  if(!before)throw Error('B1 pre-gesture camera diagnostics missing');
  await page.mouse.down();
  await page.waitForFunction(()=>document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-b1-auto-fit')==='false');
  const locked=JSON.parse(await flat.getAttribute('data-b1-viewport')||'null');
  if(Math.abs(locked.offsetX-before.offsetX)>.5||Math.abs(locked.offsetY-before.offsetY)>.5||locked.scale!==before.scale)
    throw Error('B1 camera changed when taking ownership: '+JSON.stringify({before,locked}));
  await page.mouse.move(x+50,y+32,{steps:6});await page.mouse.up();
  const moved=JSON.parse(await flat.getAttribute('data-b1-viewport')||'null');
  if(Math.abs(moved.offsetX-before.offsetX-50)>.5||Math.abs(moved.offsetY-before.offsetY-32)>.5||moved.scale!==before.scale)
    throw Error('B1 physical pan differs from pointer delta: '+JSON.stringify({before,locked,moved,expected:[50,32]}));
  if(await flat.getAttribute('data-b1-time')!==time)throw Error('B1 pan changed physical time');
  await page.getByTestId('btn-fullscreen-speech').click();
  const toggle=page.getByTestId('btn-view-3d-fullscreen');await toggle.click();
  const stage=page.getByTestId('three-stage-container');await stage.waitFor({state:'visible',timeout:20000});
  await waitB1(()=>{const e=document.querySelector('[data-testid="three-stage-container"]');return e?.getAttribute('data-morph-t')==='0'&&e?.getAttribute('data-b1-auto-fit')==='false';},'manual-2d-to-3d');
  if(Math.abs(Number(await stage.getAttribute('data-b1-render-time'))-Number(time))>1e-8)throw Error('B1 camera round trip altered time');
  await toggle.click();await stage.waitFor({state:'detached',timeout:15000});
  await flat.waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-b1-auto-fit')==='false');
  await page.getByTestId('btn-exit-fullscreen-speech').click();
  await page.getByTestId('btn-reset-view').click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-b1-auto-fit')==='true');
  if(await flat.getAttribute('data-b1-time')!==time)throw Error('B1 center reset changed physical time');
  report.push({manualPan:true,manualRoundTrip:true,autoRecenter:true});
  if(screenshot)await screenshot('B1_recenter');
  return report;
}

async function auditS01Physics(page,origin,screenshot){
  const url=new URL(origin);url.searchParams.set('model','stse-tokamak-magnetic-mirror');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='stse-tokamak-magnetic-mirror');
  const report=[];
  const assertComposition=async(element)=>{
    const bounds=await element.evaluate(el=>{
      const b=JSON.parse(el.getAttribute('data-s01-screen-bounds')||'null'),r=el.getBoundingClientRect();
      const relative=selector=>{const e=document.querySelector(selector);if(!e)return null;const a=e.getBoundingClientRect();return {left:a.left-r.left,right:a.right-r.left,top:a.top-r.top,bottom:a.bottom-r.top};};
      return {b,width:r.width,height:r.height,chrome:['[data-testid="fullscreen-formula"]','[data-testid="fullscreen-controls"]','[data-testid="fullscreen-title"]','[data-testid="mirror-loss-cone"]','[data-testid="s01-torus-status"]'].map(relative).filter(Boolean)};
    });
    const {b,width,height,chrome}=bounds;
    if(!b?.visible||b.left<10||b.right>width-10||b.top<10||b.bottom>height-10)throw Error('S01 clipped real frame '+JSON.stringify(bounds));
    for(const rect of chrome)if(b.left<rect.right+8&&b.right>rect.left-8&&b.top<rect.bottom+8&&b.bottom>rect.top-8)throw Error('S01 overlap '+JSON.stringify(bounds));
    return bounds;
  };
  for(const preset of ['mirror-trapped-bounce','mirror-loss-cone-escape','tokamak-helical-confinement']){
    await selectPreset(page,preset);
    const scope=page.getByTestId('floating-scope-dock');await scope.waitFor({state:'visible'});
    const torus=preset==='tokamak-helical-confinement';
    const expectedChannels=torus?['bMagT','minorRadiusM','separate']:['vParallel','vPerp','shared'];
    await page.waitForFunction(([a,b,units])=>document.querySelector('[data-testid="scope-channel-a"]')?.getAttribute('data-channel-key')===a&&document.querySelector('[data-testid="scope-channel-b"]')?.getAttribute('data-channel-key')===b&&document.querySelector('[data-testid="floating-scope-dock"]')?.getAttribute('data-scope-units')===units,expectedChannels);
    // Inspect an actual sampled plot, not a paused initial empty chart.
    if(preset==='mirror-trapped-bounce'||torus){
      const workbenchPlay=page.locator('[data-testid="btn-play-pause"]:visible');
      if(await workbenchPlay.getAttribute('aria-label')==='运行')await workbenchPlay.click();
      await page.waitForFunction(()=>Number(document.querySelector('[data-testid="uplot-container"]')?.getAttribute('data-sample-count'))>=5,null,{timeout:10000});
      if(await workbenchPlay.getAttribute('aria-label')==='暂停')await workbenchPlay.click();
      const chart=await scope.locator('canvas').first().boundingBox();
      if(!chart||chart.height<140||await page.getByTestId('scope-empty').isVisible())throw Error('S01 sampled chart missing or clipped');
      if(screenshot)await screenshot('S01_'+preset+'_workbench_running');
      await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
      await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
      if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
      if(screenshot)await screenshot('S01_'+preset+'_workbench_projector');
      await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
      await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='chalkboard');
      if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
      await page.locator('[data-testid="btn-reset"]:visible').click();
      await page.waitForFunction(()=>Number(document.querySelector('[data-testid="topbar"]')?.textContent?.match(/t\s*=\s*([0-9.]+)\s*s/)?.[1])===0);
    }
    await page.getByTestId('btn-fullscreen-speech').click();
    const toggle=page.getByTestId('btn-view-3d-fullscreen');
    if((await toggle.textContent())?.includes('3D 空间'))await toggle.click();
    const stage=page.getByTestId('three-stage-container');await stage.waitFor({state:'visible',timeout:20000});
    await page.waitForFunction(()=>{const s=document.querySelector('[data-testid="three-stage-container"]');return s?.getAttribute('data-morph-t')==='0'&&JSON.parse(s.getAttribute('data-s01-rendered')||'null')?.t===0;},null,{timeout:15000});
    const init=JSON.parse(await stage.getAttribute('data-s01-rendered')||'null');
    if(torus){
      const v=init.velocity,b=init.bField,speed=Math.hypot(v.x,v.y,v.z),cos=(v.x*b.x+v.y*b.y+v.z*b.z)/(speed*Math.hypot(b.x,b.y,b.z));
      if(Math.abs(Math.acos(cos)*180/Math.PI-45)>1e-8)throw Error('S01 rendered initial pitch mismatch');
    }
    const play=page.locator('[data-testid="btn-play-pause"]:visible');
    if(await play.getAttribute('aria-label')!=='运行')throw Error('S01 preset did not pause');
    await play.click();
    try{
      await page.waitForFunction(p=>{
        const el=document.querySelector('[data-testid="three-stage-container"]');
        const state=JSON.parse(el?.getAttribute('data-s01-rendered')||'null');
        return state&&(p==='mirror-trapped-bounce'?state.reflectionCount>=1:p==='mirror-loss-cone-escape'?state.escaped:state.t>.7);
      },preset,{timeout:15000});
    }catch(error){
      if(screenshot)await screenshot('S01_failure_'+preset);
      throw Error('S01 runtime '+preset+': '+(await stage.getAttribute('data-s01-rendered')),{cause:error});
    }
    if(await play.getAttribute('aria-label')==='暂停')await play.click();
    const state=JSON.parse(await stage.getAttribute('data-s01-rendered')||'null');
    if(preset==='mirror-trapped-bounce'){
      if(state.escaped||!state.lastReflection||Math.abs(state.lastReflection.time-1.19564781)>.005||Math.abs(state.lastReflection.metrics.vParallel)>1e-5||state.muDev>.05)throw Error('S01 wrong actual reflection '+JSON.stringify(state));
    }else if(preset==='mirror-loss-cone-escape'){
      if(!state.escapeEvent||Math.abs(Math.abs(state.escapeEvent.position.z)-1.5)>1e-7)throw Error('S01 wrong localized throat crossing');
    }
    if(state.trailLength<30)throw Error('S01 missing actual trail samples');
    const speed=Math.hypot(state.velocity.x,state.velocity.y,state.velocity.z),initialSpeed=Math.hypot(init.velocity.x,init.velocity.y,init.velocity.z);
    if(Math.abs(speed-initialSpeed)>1e-8)throw Error('S01 magnetic speed drift');
    report.push({preset,t:state.t,reflection:state.lastReflection,escape:state.escapeEvent,muDev:state.muDev,trail:state.trailLength});
    // The camera may fit again on the next render after pause; wait for the real frame within the original timeout.
    await page.waitForFunction(()=>{const el=document.querySelector('[data-testid="three-stage-container"]');const b=JSON.parse(el?.getAttribute('data-s01-screen-bounds')||'null');const r=el?.getBoundingClientRect();return !!b&&!!r&&b.visible&&b.right<r.width-Math.min(360,r.width*.40)&&b.bottom<r.height-Math.min(158,r.height*.41);},null,{timeout:15000});
    report.at(-1).spatialComposition=await assertComposition(stage);
    if(screenshot)await screenshot('S01_'+preset+'_3d');
    await toggle.click();await stage.waitFor({state:'detached',timeout:15000});
    const flat=page.getByTestId('simulation-canvas');await flat.waitFor({state:'visible'});
    await page.waitForFunction(()=>{const el=document.querySelector('[data-testid="simulation-canvas"]');const b=JSON.parse(el?.getAttribute('data-s01-screen-bounds')||'null');const r=el?.getBoundingClientRect();return !!b&&!!r&&b.visible&&b.right<r.width-Math.min(360,r.width*.40)&&b.bottom<r.height-Math.min(158,r.height*.41);},null,{timeout:15000});
    report.at(-1).flatComposition=await assertComposition(flat);
    if(screenshot)await screenshot('S01_'+preset+'_flat');
    await page.getByTestId('btn-exit-fullscreen-speech').click();
  }
  return report;
}

async function auditM10Physics(page,origin,screenshot){
  const url=new URL(origin);url.searchParams.set('model','astro-orbital-mechanics');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='astro-orbital-mechanics');
  const report=[];
  for(const preset of ['kepler-ellipse-second-law','hohmann-geo-transfer','solar-escape-velocity','binary-lagrange-roche']){
    await selectPreset(page,preset);
    const flat=page.getByTestId('simulation-canvas');await flat.waitFor({state:'visible'});
    const binary=preset==='binary-lagrange-roche',play=page.locator('[data-testid="btn-play-pause"]:visible');
    await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-m10-rendered')||'null')?.tNorm===0);
    if(binary)await page.waitForFunction(()=>document.querySelector('[data-testid="scope-channel-a"]')?.getAttribute('data-channel-key')==='jacobiConstant'&&document.querySelector('[data-testid="scope-channel-b"]')?.getAttribute('data-channel-key')==='rotatingSpeedNorm'&&document.querySelector('[data-testid="floating-scope-dock"]')?.getAttribute('data-scope-units')==='separate');
    if(await play.getAttribute('aria-label')!=='运行')throw Error('M10 preset did not reset to paused');
    await play.click();
    try{await page.waitForFunction(p=>{
      const v=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-m10-rendered')||'null');
      return v&&(p==='kepler-ellipse-second-law'?v.sectors.length>=2:p==='hohmann-geo-transfer'?v.phase==='circularized':p==='solar-escape-velocity'?v.tNorm>.8:v.tNorm>1.2);
    },preset,{timeout:20000});}catch(error){if(screenshot)await screenshot('M10_failure_'+preset);throw Error('M10 run '+preset+': '+await flat.getAttribute('data-m10-rendered'),{cause:error});}
    if(await play.getAttribute('aria-label')==='暂停')await play.click();
    const state=JSON.parse(await flat.getAttribute('data-m10-rendered')||'null');
    if(state.historyCount<10)throw Error('M10 actual history missing');
    if(preset==='kepler-ellipse-second-law'){
      for(const sector of state.sectors)if(Math.abs(sector.end-sector.start-.55)>1e-9||Math.abs(sector.area-.33)>.33e-4)throw Error('M10 incorrect equal-time polygon '+JSON.stringify(sector));
    }else if(preset==='hohmann-geo-transfer'){
      const event=state.events.find(e=>e.id.startsWith('hohmann-burn-2-')),rho=2.4,vc=Math.sqrt(6.6743e-11*5.972e24/7e6);
      if(!event||Math.abs(event.metrics.tNorm-Math.PI*((1+rho)/2)**1.5)>2e-5||
        Math.abs(Math.hypot(event.position.x,event.position.y)-rho)>1e-4||event.metrics.bracketWidth>1e-7||
        Math.abs(state.deltaV1SI/(vc*(Math.sqrt(2*rho/(1+rho))-1))-1)>1e-5||
        Math.abs(state.deltaV2SI/(vc/Math.sqrt(rho)*(1-Math.sqrt(2/(1+rho))))-1)>1e-5||state.eccentricity>1e-4)
        throw Error('M10 incorrect actual Hohmann event '+JSON.stringify(state));
    }else if(preset==='solar-escape-velocity'){
      if(Math.abs(state.energy)>1e-6||Math.abs(state.eccentricity-1)>1e-6||state.guideClosed)throw Error('M10 false parabolic escape');
    }else if(!state.corotating||Math.abs(state.jacobi-state.jacobi0)>1e-6||!state.historyLast)throw Error('M10 incorrect Jacobi or rotating history');
    const scope=page.getByTestId('floating-scope-dock');await scope.waitFor({state:'visible'});
    const chart=await scope.locator('canvas').first().boundingBox();
    if(!chart||chart.height<140||await page.getByTestId('scope-empty').isVisible())throw Error('M10 sampled chart missing or clipped');
    if(screenshot)await screenshot('M10_'+preset+'_running');
    if(binary){
      await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
      await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
      if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
      if(screenshot)await screenshot('M10_binary_projector');
      await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
      await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='chalkboard');
      if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
    }
    await page.getByTestId('btn-fullscreen-speech').click();
    const toggle=page.getByTestId('btn-view-3d-fullscreen');
    if((await toggle.textContent())?.includes('3D 空间'))await toggle.click();
    const stage=page.getByTestId('three-stage-container');await stage.waitFor({state:'visible',timeout:20000});
    await page.waitForFunction(()=>{const el=document.querySelector('[data-testid="three-stage-container"]');return el?.getAttribute('data-morph-t')==='0'&&!!el.getAttribute('data-m10-rendered');},null,{timeout:15000});
    const spatial=JSON.parse(await stage.getAttribute('data-m10-rendered')||'null');
    if(Math.abs(spatial.tNorm-state.tNorm)>1e-8||spatial.actualTrailVertices!==state.historyCount||
       Math.hypot(spatial.position.x-state.position.x,spatial.position.y-state.position.y)>1e-10)
      throw Error('M10 spatial display changed paused physics '+JSON.stringify({state,spatial}));
    if(screenshot)await screenshot('M10_'+preset+'_3d');
    await toggle.click();await stage.waitFor({state:'detached',timeout:15000});await flat.waitFor({state:'visible'});
    await page.waitForFunction(()=>!!document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-m10-rendered'));
    const after=JSON.parse(await flat.getAttribute('data-m10-rendered')||'null');
    if(Math.abs(after.tNorm-state.tNorm)>1e-8||after.historyCount!==state.historyCount||Math.hypot(after.position.x-state.position.x,after.position.y-state.position.y)>1e-10)
      throw Error('M10 planar return changed paused physics');
    if(screenshot)await screenshot('M10_'+preset+'_flat');
    await page.getByTestId('btn-exit-fullscreen-speech').click();
    report.push({preset,state,spatialTrailVertices:spatial.actualTrailVertices,pausedRoundTrip:true});
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
    if(device==='cyclotron')await selectPreset(page,'cyclotron-classic-vs-rel');
    if(device==='hall-sensor')await selectPreset(page,'hall-electron-vs-hole');
    if(device==='mhd-generator')await selectPreset(page,'mhd-peak-power');
    if(device==='em-flowmeter')await selectPreset(page,'flowmeter-open-circuit');
    const expectedScope={ 'velocity-selector':['selectedSpeed','particleSpeedMps','shared'], 'mass-spectrometer':['spectrometerRadiusM','particleSpeedMps','separate'],cyclotron:['cyclotronEnergyJ','cyclotronPhaseSlipRad','separate'],'hall-sensor':['hallVoltageMv','hallCurrentA','separate'],'mhd-generator':['mhdOutputWatt','mhdLoadCurrentA','separate'],'em-flowmeter':['flowVoltageMv','flowRateM3ps','separate']}[device];
    await page.waitForFunction(([a,b,units])=>document.querySelector('[data-testid="scope-channel-a"]')?.getAttribute('data-channel-key')===a&&document.querySelector('[data-testid="scope-channel-b"]')?.getAttribute('data-channel-key')===b&&document.querySelector('[data-testid="floating-scope-dock"]')?.getAttribute('data-scope-units')===units,expectedScope);
    if(screenshot)await screenshot('S02_'+device+'_scope');
    await page.getByTestId('btn-fullscreen-speech').click();
    const toggle = page.getByTestId('btn-view-3d-fullscreen');
    if ((await toggle.textContent())?.includes('3D 空间')) await toggle.click();
    const stage = page.getByTestId('three-stage-container');
    await stage.waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="three-stage-container"]')?.getAttribute('data-morph-t') ?? 'NaN') === 0);
    await page.locator('[data-testid="stage-formula-values"] [data-readout-id="em-devices-law"]').waitFor({ state: 'visible' });
    if (device==='mass-spectrometer') {
      const play=page.locator('[data-testid="btn-play-pause"]:visible');
      await page.waitForFunction(()=>document.querySelector('[data-testid="three-stage-container"]')?.getAttribute('data-beam-status')==='flying');
      if((await play.getAttribute('aria-label'))==='运行')await play.click();
      await page.waitForFunction(()=>['detected','missed'].includes(document.querySelector('[data-testid="three-stage-container"]')?.getAttribute('data-beam-status')??''),null,{timeout:15000});
      const status=await stage.getAttribute('data-beam-status');
      const t=Number(await stage.getAttribute('data-beam-physical-time'));
      const x=Number(await stage.getAttribute('data-beam-x')),y=Number(await stage.getAttribute('data-beam-y'));
      if(status!=='detected'||!(t>0)||Math.abs(x)>1e-6||!(y<0))throw new Error('S02 spectrometer physical detector event failed: '+JSON.stringify({status,t,x,y}));
      if((await play.getAttribute('aria-label'))==='暂停')await play.click();
      if(screenshot)await screenshot('S02_mass-spectrometer_detector');
    }
    if(device==='cyclotron'){
      const play=page.locator('[data-testid="btn-play-pause"]:visible');
      const initial=Number(await stage.getAttribute('data-cyclotron-energy'));
      if(!(initial>0))throw new Error('S02 cyclotron initial kick absent');
      if((await play.getAttribute('aria-label'))==='运行')await play.click();
      await page.waitForFunction(()=>Number(document.querySelector('[data-testid="three-stage-container"]')?.getAttribute('data-cyclotron-gaps'))>2,null,{timeout:15000});
      const middle=Number(await stage.getAttribute('data-cyclotron-energy'));
      if(!(middle>initial))throw new Error('S02 cyclotron physical energy did not increase');
      if(screenshot)await screenshot('S02_cyclotron_running');
      await page.waitForFunction(()=>['wall','detuned','limit'].includes(document.querySelector('[data-testid="three-stage-container"]')?.getAttribute('data-cyclotron-status')??''),null,{timeout:20000});
      if(await stage.getAttribute('data-cyclotron-status')!=='wall')throw new Error('S02 classic cyclotron did not reach outer wall');
      const gaps=Number(await stage.getAttribute('data-cyclotron-gaps')),energy=Number(await stage.getAttribute('data-cyclotron-energy'));
      if(gaps!==829||Math.abs(energy/(1.602176634e-19*25000)-gaps)>1e-6)throw new Error('S02 classic cyclotron independent work/gap count mismatch: '+JSON.stringify({gaps,energy}));
      if((await play.getAttribute('aria-label'))==='暂停')await play.click();
      if(screenshot)await screenshot('S02_cyclotron_wall');
    }
    if(device==='hall-sensor'){
      const drift=Number(await stage.getAttribute('data-sensor-drift')),u=Number(await stage.getAttribute('data-hall-voltage'));
      if(!(drift<0)||Math.abs(u-(-3*.8/(2e24*1.602176634e-19*.0005)))>1e-10)throw Error('S02 electron polarity/drift mismatch');
      for(const label of ['上 ＋','下 −','电子漂移','E_H','F洛','I'])await stage.locator(`[data-device-label="${label}"]`).waitFor({state:'visible'});
    }
    if(device==='mhd-generator'){
      const emf=Number(await stage.getAttribute('data-mhd-emf')),u=Number(await stage.getAttribute('data-mhd-terminal')),i=Number(await stage.getAttribute('data-mhd-current'));
      if(Math.abs(emf-960)>1e-6||Math.abs(u-480)>1e-6||Math.abs(i-600)>1e-6)throw Error('S02 MHD loaded voltage/current mismatch');
      for(const label of ['上 −','下 ＋','I外','v'])await stage.locator(`[data-device-label="${label}"]`).waitFor({state:'visible'});
    }
    if(device==='em-flowmeter'){
      const u=Number(await stage.getAttribute('data-flow-voltage')),q=Number(await stage.getAttribute('data-flow-rate'));
      if(Math.abs(u-20)>1e-8||Math.abs(q-Math.PI)>1e-8)throw Error('S02 flowmeter independent oracle mismatch');
      for(const label of ['上 −','下 ＋','v'])await stage.locator(`[data-device-label="${label}"]`).waitFor({state:'visible'});
    }
    if (screenshot) await screenshot('S02_' + device + '_3d');
    await toggle.click();
    await stage.waitFor({state:'detached',timeout:15000});
    await page.getByTestId('simulation-canvas').waitFor({state:'visible'});
    if (screenshot) await screenshot('S02_' + device + '_flat');
    report.push({device,spatial:true,flat:true});
    await page.getByTestId('btn-exit-fullscreen-speech').click();
  }
  // Switch electron to hole via the actual control and check its independent polarity.
  await selectPreset(page,'hall-electron-vs-hole');
  const carrier=page.locator('#param-carrierType');
  if(!await carrier.isVisible())await page.getByText('更多参数与图层',{exact:false}).first().click();
  await carrier.selectOption('hole');
  await page.getByTestId('btn-fullscreen-speech').click();
  const sensorToggle=page.getByTestId('btn-view-3d-fullscreen');
  if((await sensorToggle.textContent())?.includes('3D 空间'))await sensorToggle.click();
  const sensorStage=page.getByTestId('three-stage-container');
  await sensorStage.waitFor({state:'visible',timeout:20000});
  await page.waitForFunction(()=>Number(document.querySelector('[data-testid="three-stage-container"]')?.getAttribute('data-sensor-drift'))>0);
  const holeU=Number(await sensorStage.getAttribute('data-hall-voltage'));
  if(Math.abs(holeU-3*.8/(2e24*1.602176634e-19*.0005))>1e-10)throw Error('S02 hole polarity mismatch');
  for(const label of ['上 −','下 ＋','空穴漂移','E_H','F洛','I'])await sensorStage.locator(`[data-device-label="${label}"]`).waitFor({state:'visible'});
  if(screenshot)await screenshot('S02_hall_hole_3d');
  await sensorToggle.click();await sensorStage.waitFor({state:'detached',timeout:15000});
  if(screenshot)await screenshot('S02_hall_hole_flat');
  await page.getByTestId('btn-exit-fullscreen-speech').click();
  // Run actual relativistic and low-turn presets through the same stage.
  for(const preset of ['cyclotron-classic-vs-rel','cyclotron-gap-classroom']){
    const relativistic=preset==='cyclotron-classic-vs-rel';
    await selectPreset(page,preset);
    if(relativistic){
      const checkbox=page.getByLabel('启用相对论质速失谐',{exact:true});
      if(!await checkbox.isVisible())await page.getByText('更多参数与图层',{exact:false}).first().click();
      await checkbox.check();
    }
    await page.getByTestId('btn-fullscreen-speech').click();
    const toggle=page.getByTestId('btn-view-3d-fullscreen');
    if((await toggle.textContent())?.includes('3D 空间'))await toggle.click();
    const stage=page.getByTestId('three-stage-container');
    await stage.waitFor({state:'visible',timeout:20000});
    await page.waitForFunction(()=>document.querySelector('[data-testid="three-stage-container"]')?.getAttribute('data-cyclotron-status')==='running');
    const play=page.locator('[data-testid="btn-play-pause"]:visible');
    if((await play.getAttribute('aria-label'))==='运行')await play.click();
    const expected=relativistic?'detuned':'wall';
    await page.waitForFunction(status=>document.querySelector('[data-testid="three-stage-container"]')?.getAttribute('data-cyclotron-status')===status,expected,{timeout:20000});
    const state=await stage.evaluate(el=>({gaps:Number(el.dataset.cyclotronGaps),energy:Number(el.dataset.cyclotronEnergy),phase:Number(el.dataset.cyclotronPhase),time:Number(el.dataset.cyclotronTime)}));
    const energyMeV=state.energy/1.602176634e-13;
    if(relativistic?(state.gaps!==203||state.phase<Math.PI/2||Math.abs(energyMeV-3.86433944)>1e-5):(state.gaps!==11||Math.abs(energyMeV-.275)>1e-6))throw new Error('S02 cyclotron preset independent oracle failed '+JSON.stringify({preset,state,energyMeV}));
    if((await play.getAttribute('aria-label'))==='暂停')await play.click();
    if(screenshot)await screenshot(relativistic?'S02_cyclotron_detuned':'S02_cyclotron_low_energy');
    await toggle.click();
    await stage.waitFor({state:'detached',timeout:15000});
    if(screenshot)await screenshot(relativistic?'S02_cyclotron_detuned_flat':'S02_cyclotron_low_energy_flat');
    report.push({device:'cyclotron',preset,status:expected,...state});
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
          return Number(stage?.getAttribute('data-field-line-count')) === 33 && Number(stage?.getAttribute('data-conductor-count')) === 10;
        });
        await page.screenshot({ path: path.join(OUT_DIR, 'E10_04_fullscreen_3d.png') });
        const widget = page.locator('[data-magnetic-axis-widget]');
        await page.waitForFunction(() => Boolean(document.querySelector('[data-magnetic-axis-widget]')?.getAttribute('data-axis-orientation')));
        const initialAxis = await widget.getAttribute('data-axis-orientation');
        const orbitBox = await page.locator('[data-testid="three-stage-container"] canvas').boundingBox();
        if (!orbitBox || !initialAxis) throw new Error('E10 missing real orbit/axis indicator');
        await page.mouse.move(orbitBox.x+orbitBox.width*.48, orbitBox.y+orbitBox.height*.46);
        await page.mouse.down();
        await page.mouse.move(orbitBox.x+orbitBox.width*.40, orbitBox.y+orbitBox.height*.40,{steps:8});
        await page.mouse.up();
        await page.waitForFunction(before => document.querySelector('[data-magnetic-axis-widget]')?.getAttribute('data-axis-orientation') !== before, initialAxis);
        await page.waitForTimeout(350);
        await page.screenshot({path:path.join(OUT_DIR,'H4_E10_orbit.png')});
        await page.getByTestId('btn-exit-fullscreen-speech').click();
        const stage = page.getByTestId('three-stage-container');
        const current = page.getByTestId('param-slider-currentI');
        await current.focus(); await current.press('Home');
        await page.waitForFunction(() => {
          const d = document.querySelector('[data-testid="three-stage-container"]')?.dataset;
          return d?.fieldLineCount === '0' && d.conductorCount === '10' && d.renderedFieldArrow === 'false' && d.renderedForceArrow === 'false' && d.renderedVelocityArrow === 'true';
        });
        await page.screenshot({path:path.join(OUT_DIR,'H4_E10_zero_current.png')});
        await selectPreset(page,'finite-solenoid-3d');
        await page.waitForFunction(() => document.querySelector('[data-testid="three-stage-container"]')?.dataset.fieldLineCount === '33');
        const vectors = page.getByLabel('速度、磁场与洛伦兹加速度',{exact:true});
        if (!await vectors.isVisible()) await page.getByText('更多参数与图层',{exact:false}).first().click();
        await vectors.uncheck();
        await page.waitForFunction(() => {
          const d = document.querySelector('[data-testid="three-stage-container"]')?.dataset;
          return d?.renderedVelocityArrow === 'false' && d.renderedForceArrow === 'false' && d.renderedFieldArrow === 'false' && d.fieldLineCount === '33';
        });
        await vectors.check();
        await page.waitForFunction(() => document.querySelector('[data-testid="three-stage-container"]')?.dataset.renderedVelocityArrow === 'true');
        await page.locator('#param-geometryType').selectOption('parallel-wires');
        await page.waitForFunction(() => { const d=document.querySelector('[data-testid="three-stage-container"]')?.dataset; return d?.conductorCount==='2' && d.fieldLineCount==='15'; });
        await page.screenshot({path:path.join(OUT_DIR,'H4_E10_parallel_wires.png')});
        await page.locator('#param-geometryType').selectOption('straight-wire');
        await page.waitForFunction(() => { const d=document.querySelector('[data-testid="three-stage-container"]')?.dataset; return d?.conductorCount==='1' && d.fieldLineCount==='9'; });
        await page.screenshot({path:path.join(OUT_DIR,'H4_E10_straight_wire.png')});
        await selectPreset(page,'finite-solenoid-3d');
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
        await selectPreset(page,'thin-lens-real-image');
        await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-b3-rendered')||'null')?.mode==='thin-lens-imaging');
        await page.screenshot({path:path.join(OUT_DIR,'H9_B3_lens_projector.png')});
        await selectPreset(page,'double-slit-interference');
        await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-b3-rendered')||'null')?.mode==='double-slit');
        await page.screenshot({path:path.join(OUT_DIR,'H9_B3_slit_projector.png')});
        await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
        await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='chalkboard');
        if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
        const readB3=async(mode)=>{
          await page.waitForFunction(m=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-b3-rendered')||'null')?.mode===m,mode);
          return JSON.parse(await page.getByTestId('simulation-canvas').getAttribute('data-b3-rendered'));
        };
        const checkReadout=async(key,value)=>{
          try{
            await page.waitForFunction(({key,value})=>Math.abs(parseFloat(document.querySelector('[data-testid="b3-'+key+'"]')?.textContent||'')-value)<.000501,{key,value},{timeout:5000});
          }catch(error){
            const probe=await page.evaluate(key=>({readout:document.querySelector('[data-testid="b3-'+key+'"]')?.textContent,canvas:document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-b3-rendered'),sliders:[...document.querySelectorAll('[data-testid^="param-slider-"]')].map(el=>({id:el.getAttribute('data-testid'),value:el.value}))}),key);
            await page.screenshot({path:path.join(OUT_DIR,'H9_B3_'+key+'_failure.png')});
            throw Error('B3 readout mismatch '+JSON.stringify({key,value,probe}),{cause:error});
          }
        };
        // Actual pointer drag and exact parameter boundary are distinct tests:
        // keyboard steps set a quantized input without guessing thumb geometry.
        const exactRange=async(slider,target)=>{
          const spec=await slider.evaluate(el=>({min:Number(el.min),step:Number(el.step),value:Number(el.value)}));
          if(!Number.isFinite(spec.step)||spec.step<=0)throw Error('Invalid B3 range step');
          await slider.focus();
          const count=Math.round((target-spec.value)/spec.step);
          for(let k=0;k<Math.abs(count);k++)await slider.press(count>0?'ArrowRight':'ArrowLeft');
          const actual=Number(await slider.inputValue());
          if(Math.abs(actual-target)>1e-10)throw Error('B3 exact keyboard parameter mismatch '+JSON.stringify({target,actual,spec}));
          return actual;
        };
        const checkTitle=async(title)=>{
          if(!(await page.getByTestId('topbar').innerText()).includes(title))throw Error('B3 stale mode title '+title);
        };
        await selectPreset(page,'parallel-glass-slab');
        await checkTitle('几何光学·平行玻璃砖');
        const slab=await readB3('parallel-slab'),th=50*Math.PI/180,r=Math.asin(Math.sin(th)/1.5),shift=Math.sin(th-r)/Math.cos(r);
        if(Math.abs(slab.lateralShift-shift)>1e-9)throw Error('B3 slab geometry differs from independent displacement');
        await checkReadout('lateralShift',shift);
        await page.screenshot({path:path.join(OUT_DIR,'H9_B3_slab.png')});
        await selectPreset(page,'prism-dispersion');
        const prism=await readB3('prism-dispersion'),i=Math.PI/4,A=Math.PI/3,rr=Math.asin(Math.sin(i)/1.52),dev=(i+Math.asin(1.52*Math.sin(A-rr))-A)*180/Math.PI;
        if(Math.abs(prism.prismDeviationDeg-dev)>1e-8)throw Error('B3 prism deviation incorrect');
        await checkReadout('prismDeviationDeg',dev);
        await page.screenshot({path:path.join(OUT_DIR,'H9_B3_prism.png')});
        await selectPreset(page,'optical-fiber');
        const fiber=await readB3('optical-fiber'),accept=Math.asin(Math.sqrt(1.6**2-1.4**2))*180/Math.PI;
        if(Math.abs(fiber.fiberAcceptanceDeg-accept)>1e-8||fiber.fiberGuided!==1)throw Error('B3 fiber acceptance mismatch');
        await checkReadout('fiberAcceptanceDeg',accept);
        await page.screenshot({path:path.join(OUT_DIR,'H9_B3_fiber.png')});
        await dragRangeTo(page,page.getByTestId('param-slider-n2'),1.8);
        await page.waitForFunction(()=>{const x=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-b3-rendered')||'null');return x&&x.mode==='optical-fiber'&&!('fiberAcceptanceDeg' in x);});
        await page.screenshot({path:path.join(OUT_DIR,'H9_B3_fiber_no_guiding.png')});
        await selectPreset(page,'double-slit-interference');
        const slit=await readB3('double-slit');if(Math.abs(slit.fringeSpacingMm-1.8)>1e-9)throw Error('B3 slit spacing incorrect');
        await checkReadout('fringeSpacingMm',1.8);
        await page.screenshot({path:path.join(OUT_DIR,'H9_B3_slit.png')});
        await checkTitle('波动光学·双缝干涉');
        const pre=await canvasFingerprint(page),waveSlider=page.getByTestId('param-slider-wavelengthNm');
        await dragRangeTo(page,waveSlider,500);
        const actualLambda=Number(await waveSlider.inputValue());
        if(!Number.isFinite(actualLambda)||actualLambda===600)throw Error('B3 wavelength pointer drag did not update');
        await checkReadout('fringeSpacingMm',1.5*actualLambda/500);
        const dragged=await readB3('double-slit');
        if(Math.abs(dragged.fringeSpacingMm-1.5*actualLambda/500)>1e-9)throw Error('B3 dragged wavelength and physical state disagree');
        const post=await canvasFingerprint(page);
        await exactRange(waveSlider,500);
        await checkReadout('fringeSpacingMm',1.5);
        if(!pre||!post||pre.hash===post.hash)throw Error('B3 physical slit profile did not react to wavelength');
        await page.screenshot({path:path.join(OUT_DIR,'H9_B3_slit_changed.png')});
        await selectPreset(page,'thin-lens-real-image');
        const lens=await readB3('thin-lens-imaging'),v=1.5*.65/(1.5-.65);
        if(Math.abs(lens.imageDistanceM-v)>1e-9)throw Error('B3 real lens mismatch');
        await checkReadout('imageDistanceM',v);
        await page.screenshot({path:path.join(OUT_DIR,'H9_B3_lens_real.png')});
        await checkTitle('几何光学·薄凸透镜成像');
        await exactRange(page.getByTestId('param-slider-objectDistanceM'),.45);
        await checkReadout('imageDistanceM',.45*.65/(.45-.65));
        await page.screenshot({path:path.join(OUT_DIR,'H9_B3_lens_virtual.png')});
        await exactRange(page.getByTestId('param-slider-objectDistanceM'),.65);
        await page.getByTestId('b3-focus-infinity').waitFor({state:'visible'});
        const focus=await readB3('thin-lens-imaging');
        if(focus.imageAtInfinity!==1||'imageDistanceM' in focus||'magnification' in focus)throw Error('B3 focus fabricated finite image');
        await page.screenshot({path:path.join(OUT_DIR,'H9_B3_lens_focus.png')});
        console.log('H9 B3 quantitative browser '+JSON.stringify({slab,prism,fiber,slit,lens,focus}));
        await selectPreset(page,'tir-water-air');
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
        // Independent preset readout expectations. No mock model, no screenshot-only pass.
        const b2Cases=[
          ['closed-circuit-max-power','closed_power',{totalCurrent:3,terminalVoltage:6,outputPower:18}],
          ['series-parallel-branches','mixed',{totalCurrent:1.5,branchCurrent1:.5,branchCurrent2:1}],
          ['rc-charging-curve','rc_charge',{capVoltage:0,capCurrent:1,capCharge:0}],
          ['rc-discharging-curve','rc_discharge',{capVoltage:10,capCurrent:-10/9,capCharge:.5}],
          ['bridge-capacitor-polarity','bridge',{capVoltage:-144/89,capCurrent:0,capCharge:-14.4/89}],
          ['nonlinear-diode-iv','diode',null],['nonlinear-lamp-iv','lamp',null],['closed-power-short-circuit','ideal_short',null]
        ];
        for(const [preset,tag,expected] of b2Cases){
          await selectPreset(page,preset);
          await page.waitForTimeout(300);
          if(expected){await page.waitForFunction(values=>Object.entries(values).every(([k,v])=>Math.abs(parseFloat(document.querySelector('[data-testid="b2-'+k+'"]')?.textContent??'')-v)<.0015),expected,{timeout:5000});}
          if(tag==='ideal_short'){
            await page.getByTestId('b2-invalid').waitFor({state:'visible'});
            if(await page.getByTestId('b2-totalCurrent').textContent()!=='—')throw new Error('B2 undefined current shown as numeric measurement');
          }
          if(tag==='diode'||tag==='lamp'){
            const i=parseFloat(await page.getByTestId('b2-totalCurrent').textContent()),u=parseFloat(await page.getByTestId('b2-terminalVoltage').textContent());
            const expectedI=tag==='diode'?1e-12*Math.expm1(u/.026):.25*Math.pow(u+1e-6,-.35)*u;
            if(Math.abs(5-10.5*i-u)>.008||Math.abs(expectedI-i)>.012)throw new Error('B2 nonlinear displayed KVL/law mismatch '+JSON.stringify({tag,u,i,expectedI}));
          }
          if(tag==='rc_charge'||tag==='rc_discharge'||tag==='bridge'||tag==='mixed'){
            await page.getByTestId('b2-scope-empty').waitFor({state:'visible'});
            if(await page.getByTestId('uplot-container').isVisible())throw Error('B2 single sample shows spurious time axes');
          }
          await page.screenshot({path:path.join(OUT_DIR,'H8_B2_'+tag+'.png')});
          if(tag==='rc_charge'||tag==='rc_discharge'){
            await page.waitForFunction(()=>document.querySelector('[data-testid="scope-channel-a"]')?.getAttribute('data-channel-key')==='capVoltage'&&document.querySelector('[data-testid="scope-channel-b"]')?.getAttribute('data-channel-key')==='capCurrent'&&document.querySelector('[data-testid="floating-scope-dock"]')?.getAttribute('data-scope-units')==='separate');
            const play=page.locator('[data-testid="btn-play-pause"]:visible');
            if(await play.getAttribute('aria-label')!=='运行')throw new Error('B2 RC preset not reset to paused');
            await play.click();
            await page.waitForFunction(()=>{const x=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-b2-rendered')||'null');return x&&x.t>.35&&Number(document.querySelector('[data-testid="uplot-container"]')?.getAttribute('data-sample-count'))>=5;},null,{timeout:10000});
            if(await play.getAttribute('aria-label')==='暂停')await play.click();
            // A pause must commit one shared physical frame to canvas, inspector and scope.
            try { await page.waitForFunction(()=>{
              const x=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.getAttribute('data-b2-rendered')||'null');
              const readout=document.querySelector('[data-testid="b2-topology-readouts"]');
              const scope=document.querySelector('[data-testid="uplot-container"]');
              const inspectorT=Number(readout?.getAttribute('data-sample-time'));
              const scopeT=Number(scope?.getAttribute('data-last-sample-t'));
              const scopeMax=Number(scope?.getAttribute('data-scope-max'));
              const v=parseFloat(document.querySelector('[data-testid="b2-capVoltage"]')?.textContent||'');
              const i=parseFloat(document.querySelector('[data-testid="b2-capCurrent"]')?.textContent||'');
              return x && readout && scope && Math.abs(inspectorT-x.t)<1e-10 && Math.abs(scopeT-x.t)<1e-10 &&
                Math.abs(v-x.capVoltage)<.000501 && Math.abs(i-x.capCurrent)<.000501 &&
                scopeMax>=x.t-1e-9 && scopeMax<=Math.max(.1,x.t)+.01;
            },null,{timeout:5000}); } catch(error) {
              const probe=await page.evaluate(()=>{
                const el=id=>document.querySelector('[data-testid="'+id+'"]');
                return {canvas:el('simulation-canvas')?.getAttribute('data-b2-rendered'),inspectorT:el('b2-topology-readouts')?.getAttribute('data-sample-time'),
                  voltage:el('b2-capVoltage')?.textContent,current:el('b2-capCurrent')?.textContent,
                  scopeT:el('uplot-container')?.getAttribute('data-last-sample-t'),scopeMax:el('uplot-container')?.getAttribute('data-scope-max'),
                  play:el('btn-play-pause')?.getAttribute('aria-label'),scopeText:el('floating-scope-dock')?.textContent};
              });
              await page.screenshot({path:path.join(OUT_DIR,'H8_B2_'+tag+'_pause_failure.png')});
              throw Error('B2 pause alignment failed '+JSON.stringify(probe),{cause:error});
            }
            if(await page.getByTestId('b2-scope-empty').isVisible()||!await page.getByTestId('uplot-container').isVisible())throw Error('B2 real sampled curve remains hidden');
            const x=JSON.parse(await page.getByTestId('simulation-canvas').getAttribute('data-b2-rendered')||'null');
            const charging=tag==='rc_charge',tau=charging?.5:.45,voltage=charging?10*(-Math.expm1(-x.t/tau)):10*Math.exp(-x.t/tau),current=charging?(10-voltage)/10:-voltage/9;
            if(Math.abs(x.capVoltage-voltage)>1e-8||Math.abs(x.capCurrent-current)>1e-8)throw new Error('B2 RC real rendered state differs from independent law '+JSON.stringify({tag,x,voltage,current}));
            console.log('H8 B2 exact RC browser '+JSON.stringify({tag,t:x.t,u:x.capVoltage,i:x.capCurrent}));
            await page.screenshot({path:path.join(OUT_DIR,'H8_B2_'+tag+'_running.png')});
          }
        }
        await selectPreset(page,'bridge-capacitor-polarity');
        await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
        await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
        if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
        await page.screenshot({path:path.join(OUT_DIR,'H8_B2_bridge_projector.png')});
        await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();
        await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='chalkboard');
        if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
        await selectPreset(page,'rc-charging-curve');
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
    const b4AnalyticReport=await auditB4Analytic(page,origin);
    const b5OdeReport=await auditB5Ode(page,origin);
    const m01ChaseReport=await auditM01Chase(page,origin);
    const m02EquilibriumReport=await auditM02Equilibrium(page,origin);
    const waveBCoordinateReport = await runWaveBCoordinateAudit(page, origin);
    const waveCInteractionReport = await runWaveCInteractionAudit(page, origin);
    const v3MorphReport = await auditV3Morph(page, origin, name => page.screenshot({ path: path.join(OUT_DIR, 'V3_' + name + '.png') }));
    const v3StoryFormulaReport = await auditV3StoryAndFormula(page, origin, name => page.screenshot({ path: path.join(OUT_DIR, 'V3_' + name + '.png') }));
    const v3DeviceReport = await auditV3DeviceGeometry(page, origin, name => page.screenshot({ path: path.join(OUT_DIR, 'V3_' + name + '.png') }));
    const b1PhysicsReport=await auditB1Physics(page,origin,name=>page.screenshot({path:path.join(OUT_DIR,'V3_'+name+'.png')}));
    const s01PhysicsReport=await auditS01Physics(page,origin,name=>page.screenshot({path:path.join(OUT_DIR,'V3_'+name+'.png')}));
    const m10PhysicsReport=await auditM10Physics(page,origin,name=>page.screenshot({path:path.join(OUT_DIR,'V3_'+name+'.png')}));
    // Build and actually open one isolated B2 slice with network disabled.
    const b2File=path.join(OUT_DIR,'H8_B2_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','builder-circuit-mna','--preset','rc-charging-curve','--out',b2File],{stdio:'inherit'});
    const offline=await browser.newContext({viewport:VIEWPORT,offline:true});
    const sf=await offline.newPage(),offlineErrors=[],network=[];
    sf.on('pageerror',e=>offlineErrors.push(e.message));sf.on('console',m=>{if(m.type()==='error')offlineErrors.push(m.text());});sf.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
    const b2OfflineReport={};
    try{
      await sf.goto(pathToFileURL(b2File).href);
      await sf.getByTestId('sf-canvas').waitFor({state:'visible'});
      await sf.waitForFunction(()=>document.querySelector('[data-testid="sf-scope-channel-a"]')?.value==='capVoltage'&&document.querySelector('[data-testid="sf-uplot"]')?.getAttribute('data-scope-units')==='separate');
      await sf.getByTestId('sf-scope-empty').waitFor({state:'visible'});
      if(await sf.getByTestId('sf-uplot').isVisible())throw Error('B2 offline single sample shows spurious time axes');
      await sf.screenshot({path:path.join(OUT_DIR,'H8_B2_offline_initial.png')});
      await sf.getByTestId('sf-play-pause').click();
      await sf.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.getAttribute('data-b2-rendered')||'null')?.t>.35,null,{timeout:10000});
      await sf.getByTestId('sf-play-pause').click();
      const pausedOfflineRC=async()=>{
        try { await sf.waitForFunction(()=>{
          const x=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.getAttribute('data-b2-rendered')||'null');
          const summary=document.querySelector('[data-testid="sf-summary-clock"]');
          const scope=document.querySelector('[data-testid="sf-uplot"]');
          return x && summary && scope && Math.abs(Number(summary.getAttribute('data-sample-time'))-x.t)<1e-10 &&
            Math.abs(Number(scope.getAttribute('data-last-sample-t'))-x.t)<1e-10 &&
            Number(scope.getAttribute('data-scope-max'))>=x.t-1e-9 &&
            Number(scope.getAttribute('data-scope-max'))<=Math.max(.1,x.t)+.01;
        },null,{timeout:5000}); } catch(error) {
          const probe=await sf.evaluate(()=>{
            const el=id=>document.querySelector('[data-testid="'+id+'"]');
            return {canvas:el('sf-canvas')?.getAttribute('data-b2-rendered'),summaryT:el('sf-summary-clock')?.getAttribute('data-sample-time'),
              scopeT:el('sf-uplot')?.getAttribute('data-last-sample-t'),scopeMax:el('sf-uplot')?.getAttribute('data-scope-max'),play:el('sf-play-pause')?.textContent};
          });
          await sf.screenshot({path:path.join(OUT_DIR,'H8_B2_offline_pause_failure.png')});
          throw Error('B2 offline pause alignment failed '+JSON.stringify(probe),{cause:error});
        }
        const x=JSON.parse(await sf.getByTestId('sf-canvas').getAttribute('data-b2-rendered'));
        if(Math.abs(x.capVoltage-10*(-Math.expm1(-x.t/.5)))>1e-8 ||
           Math.abs(x.capCurrent-(10-x.capVoltage)/10)>1e-8)
          throw Error('B2 offline RC failed independent exact law '+JSON.stringify(x));
        return x;
      };
      const x=await pausedOfflineRC();
      if(await sf.getByTestId('sf-scope-empty').isVisible()||!await sf.getByTestId('sf-uplot').isVisible())throw Error('B2 offline sampled curve remains hidden');
      await sf.screenshot({path:path.join(OUT_DIR,'H8_B2_offline_rc.png')});
      await sf.getByRole('button',{name:'单步',exact:true}).click();
      await sf.waitForFunction(t=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.getAttribute('data-b2-rendered')||'null')?.t>t,x.t);
      const stepped=await pausedOfflineRC();
      if(Math.abs(stepped.t-x.t-4/240)>1e-10)throw Error('Offline step clock is not four fixed steps');
      await sf.getByLabel('播放倍速').selectOption('0.5');
      await sf.getByTestId('sf-play-pause').click();
      await sf.waitForFunction(t=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.getAttribute('data-b2-rendered')||'null')?.t>t+.1,stepped.t,{timeout:10000});
      await sf.getByTestId('sf-play-pause').click();
      const resumed=await pausedOfflineRC();
      b2OfflineReport.rc={t:x.t,u:x.capVoltage,stepT:stepped.t,resumeT:resumed.t,resumeU:resumed.capVoltage,clockAligned:true};
      await sf.locator('[data-preset-id="series-parallel-branches"]').click();
      await sf.waitForFunction(()=>document.querySelector('[data-testid="sf-scope-channel-a"]')?.value==='branchCurrent1'&&document.querySelector('[data-testid="sf-scope-channel-b"]')?.value==='branchCurrent2');
      const mixed=JSON.parse(await sf.getByTestId('sf-canvas').getAttribute('data-b2-rendered'));
      if(Math.abs(mixed.totalCurrent-1.5)>1e-9||Math.abs(mixed.branchCurrent1-.5)>1e-9||Math.abs(mixed.branchCurrent2-1)>1e-9)throw Error('B2 offline mixed KCL failed');
      b2OfflineReport.mixed={i:mixed.totalCurrent,i2:mixed.branchCurrent1,ip:mixed.branchCurrent2};
      await sf.getByRole('button',{name:'黑板深蓝'}).click();
      await sf.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
      await sf.screenshot({path:path.join(OUT_DIR,'H8_B2_offline_mixed_paper.png')});
      await sf.locator('[data-preset-id="closed-power-short-circuit"]').click();
      await sf.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.getAttribute('data-b2-rendered')||'null')?.solutionDefined===0);
      const fault=JSON.parse(await sf.getByTestId('sf-canvas').getAttribute('data-b2-rendered'));
      if('totalCurrent' in fault)throw Error('B2 offline invalid solution reports current');
      if(offlineErrors.length||network.length)throw Error('B2 offline errors '+JSON.stringify({offlineErrors,network}));
      b2OfflineReport.errors=offlineErrors;b2OfflineReport.network=network;
    }finally{await offline.close();}
    const b3File=path.join(OUT_DIR,'H9_B3_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','builder-optics-ray','--preset','thin-lens-real-image','--out',b3File],{stdio:'inherit'});
    const b3Context=await browser.newContext({viewport:VIEWPORT,offline:true});
    const b3Page=await b3Context.newPage(),b3Errors=[],b3Network=[],b3OfflineReport={};
    b3Page.on('pageerror',e=>b3Errors.push(e.message));b3Page.on('console',m=>{if(m.type()==='error')b3Errors.push(m.text());});b3Page.on('request',r=>{if(/^https?:/.test(r.url()))b3Network.push(r.url());});
    try{
      await b3Page.goto(pathToFileURL(b3File).href);
      await b3Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.getAttribute('data-b3-rendered')||'null')?.mode==='thin-lens-imaging');
      const read=async()=>JSON.parse(await b3Page.getByTestId('sf-canvas').getAttribute('data-b3-rendered'));
      const real=await read();if(Math.abs(real.imageDistanceM-1.5*.65/(1.5-.65))>1e-9)throw Error('B3 offline real image mismatch');
      if(await b3Page.getByTestId('sf-uplot').isVisible())throw Error('B3 static offline time scope visible');
      await b3Page.screenshot({path:path.join(OUT_DIR,'H9_B3_offline_lens.png')});
      const uSlider=b3Page.getByTestId('sf-param-objectDistanceM');
      await uSlider.focus();
      const uSpec=await uSlider.evaluate(el=>({value:Number(el.value),step:Number(el.step)}));
      for(let k=0;k<Math.round((uSpec.value-.65)/uSpec.step);k++)await uSlider.press('ArrowLeft');
      if(Math.abs(Number(await uSlider.inputValue())-.65)>1e-10)throw Error('B3 offline exact focal input mismatch');
      await b3Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.getAttribute('data-b3-rendered')||'null')?.imageAtInfinity===1);
      const focus=await read();if('imageDistanceM' in focus)throw Error('B3 offline finite image at focus');
      await b3Page.getByRole('button',{name:'黑板深蓝'}).click();
      await b3Page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
      await b3Page.screenshot({path:path.join(OUT_DIR,'H9_B3_offline_focus_paper.png')});
      await b3Page.locator('[data-preset-id="double-slit-interference"]').click();
      await b3Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.getAttribute('data-b3-rendered')||'null')?.mode==='double-slit');
      const slit=await read();if(Math.abs(slit.fringeSpacingMm-1.8)>1e-9)throw Error('B3 offline fringe mismatch');
      await b3Page.screenshot({path:path.join(OUT_DIR,'H9_B3_offline_slit_paper.png')});
      if(b3Errors.length||b3Network.length)throw Error('B3 offline errors '+JSON.stringify({b3Errors,b3Network}));
      Object.assign(b3OfflineReport,{real,focus,slit,errors:b3Errors,network:b3Network});
    }finally{await b3Context.close();}
    const b4File=path.join(OUT_DIR,'H10_B4_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','builder-mechanics-lab','--preset','atwood-udwadia-analytical','--out',b4File],{stdio:'inherit'});
    const b4Context=await browser.newContext({viewport:VIEWPORT,offline:true});
    const b4Page=await b4Context.newPage(),b4Errors=[],b4Network=[],b4OfflineReport={};
    b4Page.on('pageerror',e=>b4Errors.push(e.message));b4Page.on('console',m=>{if(m.type()==='error')b4Errors.push(m.text());});
    b4Page.on('request',r=>{if(/^https?:/.test(r.url()))b4Network.push(r.url());});
    try{
      await b4Page.goto(pathToFileURL(b4File).href);
      const b4Canvas=b4Page.getByTestId('sf-canvas'),play=b4Page.getByTestId('sf-play-pause');
      const read=async()=>JSON.parse(await b4Canvas.getAttribute('data-b4-rendered'));
      const waitMode=async scenario=>b4Page.waitForFunction(m=>{const d=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.getAttribute('data-b4-rendered')||'null');return d?.scenario===m&&d.t===0;},scenario);
      await waitMode('atwood-constrained');
      await b4Page.getByTestId('sf-scope-empty').waitFor({state:'visible'});
      if(await b4Page.getByTestId('sf-uplot').isVisible()||await b4Page.getByTestId('sf-param-restitution').count())throw Error('B4 offline initial controls/scope');
      await b4Page.waitForFunction(()=>document.querySelector('[data-testid="sf-scope-channel-a"]')?.value==='primaryVy'&&document.querySelector('[data-testid="sf-scope-channel-b"]')?.value==='secondaryVy');
      await play.click();
      await b4Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.getAttribute('data-b4-rendered')||'null')?.atwoodAtLimit===1,null,{timeout:10000});
      const terminal=await read(),a=9.8/3,limit=Math.sqrt(2*(1.4-Math.sqrt(.28**2-(.28-.22)**2)-.1-.22)/a);
      if(Math.abs(terminal.t-limit)>1e-9||Math.abs(terminal.primaryVy-a*limit)>1e-9)throw Error('B4 offline terminal physical event '+JSON.stringify(terminal));
      await b4Page.waitForFunction(t=>Math.abs(Number(document.querySelector('[data-testid="sf-summary-clock"]')?.getAttribute('data-sample-time'))-t)<1e-10&&Math.abs(Number(document.querySelector('[data-testid="sf-uplot"]')?.getAttribute('data-last-sample-t'))-t)<1e-10,terminal.t);
      await b4Page.getByRole('button',{name:'单步',exact:true}).click();
      await b4Page.waitForTimeout(100);
      if((await read()).t!==terminal.t)throw Error('B4 offline continued after terminal event');
      await b4Page.getByRole('button',{name:'黑板深蓝'}).click();
      await b4Page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
      await b4Page.screenshot({path:path.join(OUT_DIR,'H10_B4_offline_terminal_paper.png')});
      await b4Page.locator('[data-preset-id="ideal-spring-oscillator"]').click();await waitMode('spring-oscillator');
      await b4Page.waitForFunction(()=>document.querySelector('[data-testid="sf-scope-channel-a"]')?.value==='kineticEnergy'&&document.querySelector('[data-testid="sf-scope-channel-b"]')?.value==='springPotentialEnergy');
      await b4Page.getByRole('button',{name:'单步',exact:true}).click();
      await b4Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.getAttribute('data-b4-rendered')||'null')?.t>0);
      const spring=await read();if(Math.abs(spring.t-4/240)>1e-10||Math.abs(spring.primaryX-(-.45+1.25*Math.cos(Math.sqrt(20)*spring.t)))>1e-9)throw Error('B4 offline spring step '+JSON.stringify(spring));
      await b4Page.screenshot({path:path.join(OUT_DIR,'H10_B4_offline_spring_paper.png')});
      await b4Page.locator('[data-preset-id="elastic-equal-mass"]').click();await waitMode('elastic-collision');
      await play.click();
      await b4Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.getAttribute('data-b4-rendered')||'null')?.t>1.02,null,{timeout:15000});
      await play.click();
      const collision=await read();
      if(collision.rapierActive!==1||Math.abs(collision.primaryVx)>.15||Math.abs(collision.totalMomentumX-2.6)>.01||Math.abs(collision.kineticEnergy-3.38)/3.38>.02)throw Error('B4 offline WASM collision '+JSON.stringify(collision));
      await b4Page.screenshot({path:path.join(OUT_DIR,'H10_B4_offline_collision_paper.png')});
      if(b4Errors.length||b4Network.length)throw Error('B4 offline errors '+JSON.stringify({b4Errors,b4Network}));
      Object.assign(b4OfflineReport,{terminal,spring,collision,errors:b4Errors,network:b4Network});
    }finally{await b4Context.close();}
    const b5File=path.join(OUT_DIR,'H11_B5_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','builder-custom-ode-lab','--preset','nonlinear-duffing-expr','--out',b5File],{stdio:'inherit'});
    const b5Context=await browser.newContext({viewport:VIEWPORT,offline:true});const b5Page=await b5Context.newPage(),b5Errors=[],b5Network=[],b5OfflineReport={};
    b5Page.on('pageerror',e=>b5Errors.push(e.message));b5Page.on('console',m=>{if(m.type()==='error')b5Errors.push(m.text());});b5Page.on('request',r=>{if(/^https?:/.test(r.url()))b5Network.push(r.url());});
    try{
      await b5Page.goto(pathToFileURL(b5File).href);const canvas=b5Page.getByTestId('sf-canvas');const read=async()=>JSON.parse(await canvas.getAttribute('data-ode-rendered'));
      await b5Page.getByTestId('sf-ode-expression-input').fill('-4*x');await b5Page.getByTestId('sf-ode-expression-apply').click();
      await b5Page.getByRole('button',{name:'单步',exact:true}).click();await b5Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.getAttribute('data-ode-rendered')||'null')?.t>0);
      const step=await read();if(Math.abs(step.t-1/60)>1e-10||Math.abs(step.x-Math.cos(2*step.t))>1e-7||Math.abs(step.v+2*Math.sin(2*step.t))>1e-7||'energy' in step)throw Error('B5 offline edited acceleration '+JSON.stringify(step));
      await b5Page.getByRole('button',{name:'黑板深蓝'}).click();await b5Page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');await b5Page.screenshot({path:path.join(OUT_DIR,'H11_B5_offline_custom_paper.png')});
      await b5Page.getByTestId('sf-ode-expression-input').fill('sqrt(-1)');await b5Page.getByTestId('sf-ode-expression-apply').click();await b5Page.getByRole('button',{name:'单步',exact:true}).click();await b5Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.getAttribute('data-ode-rendered')||'null')?.solverValid===0);
      const invalid=await read();if(invalid.t!==0)throw Error('B5 offline singular formula advanced');await b5Page.screenshot({path:path.join(OUT_DIR,'H11_B5_offline_invalid_paper.png')});
      if(b5Errors.length||b5Network.length)throw Error('B5 offline errors '+JSON.stringify({b5Errors,b5Network}));Object.assign(b5OfflineReport,{step,invalid,errors:b5Errors,network:b5Network});
    }finally{await b5Context.close();}
    const m01File=path.join(OUT_DIR,'H12_M01_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','mech-kinematics-chase','--preset','brake-safe-margin','--out',m01File],{stdio:'inherit'});
    const m01Context=await browser.newContext({viewport:VIEWPORT,offline:true});const m01Page=await m01Context.newPage(),m01Errors=[],m01Network=[],m01OfflineReport={};
    m01Page.on('pageerror',e=>m01Errors.push(e.message));m01Page.on('console',m=>{if(m.type()==='error')m01Errors.push(m.text());});m01Page.on('request',r=>{if(/^https?:/.test(r.url()))m01Network.push(r.url());});
    try{
      await m01Page.goto(pathToFileURL(m01File).href);const canvas=m01Page.getByTestId('sf-canvas'),read=async()=>JSON.parse(await canvas.getAttribute('data-chase-rendered'));
      await m01Page.getByTestId('sf-scope-empty').waitFor({state:'visible'});
      await m01Page.getByRole('button',{name:'单步',exact:true}).click();await m01Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.getAttribute('data-chase-rendered')||'null')?.t>0);
      const step=await read();if(Math.abs(step.t-1/60)>1e-10||Math.abs(step.xA-20*step.t)>1e-9||Math.abs(step.xB-(42+6*step.t))>1e-9||step.aA!==0)throw Error('M01 offline reaction step '+JSON.stringify(step));
      await m01Page.getByLabel('播放倍速').selectOption('2');const play=m01Page.getByTestId('sf-play-pause');await play.click();await m01Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.getAttribute('data-chase-rendered')||'null')?.t>5.45,null,{timeout:15000});await play.click();
      const stop=await read();if(stop.vA!==0||stop.aA!==0||Math.abs(stop.xA-58)>1e-8||Math.abs(stop.minGap-11.9)>1e-8||Math.abs(stop.firstCoVelocityTime-3.9)>1e-8||stop.meetCount!==0)throw Error('M01 offline braking '+JSON.stringify(stop));
      await m01Page.getByRole('button',{name:'黑板深蓝'}).click();await m01Page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');await m01Page.screenshot({path:path.join(OUT_DIR,'H12_M01_offline_safe_paper.png')});
      await play.click();
      await m01Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.getAttribute('data-chase-rendered')||'null')?.t>18.1,null,{timeout:15000});await play.click();
      // Inspect the first painted paused frame, not a later retry that could
      // hide a canvas/React summary phase mismatch.
      const pauseSamples=await m01Page.evaluate(async()=>{
        const canvas=document.querySelector('[data-testid="sf-canvas"]'),clock=document.querySelector('[data-testid="sf-summary-clock"]'),gap=document.querySelector('[data-testid="sf-chase-gap"]'),plot=document.querySelector('[data-testid="sf-uplot"]');
        const play=document.querySelector('[data-testid="sf-play-pause"]');
        const read=()=>{const state=JSON.parse(canvas.dataset.chaseRendered);return {t:state.t,clock:Number(clock.dataset.sampleTime),gap:state.gap,shownGap:parseFloat(gap.textContent),plot:plot?.dataset.lastSampleT,paused:play.textContent.includes('运行')};};
        const result=[];
        for(let i=0;i<8;i++){await new Promise(requestAnimationFrame);result.push(read());}
        return result;
      });
      const bad=pauseSamples.filter(x=>x.paused&&(Math.abs(x.t-x.clock)>1e-10||Math.abs(x.gap-x.shownGap)>.00051||Math.abs(x.t-Number(x.plot))>1e-10||!Number.isFinite(x.shownGap)||!Number.isFinite(Number(x.plot))));
      if(bad.length)throw Error('M01 offline paused snapshot mismatch '+JSON.stringify(bad));
      console.log('H15 M01 paused snapshots '+JSON.stringify(pauseSamples));
      const long=await read();
      if(long.vA!==0||long.aA!==0||Math.abs(long.xA-58)>1e-8||Math.abs(long.xB-(42+6*long.t))>1e-8||Math.abs(long.minGap-11.9)>1e-8)throw Error('M01 offline long analytic braking '+JSON.stringify(long));
      const visible=await assertChaseVisible(m01Page,'sf-canvas','offline-over-18s');
      await m01Page.screenshot({path:path.join(OUT_DIR,'H14_M01_offline_long_paper.png')});
      if(m01Errors.length||m01Network.length)throw Error('M01 offline errors '+JSON.stringify({m01Errors,m01Network}));Object.assign(m01OfflineReport,{step,stop,long,visible,errors:m01Errors,network:m01Network});
    }finally{await m01Context.close();}

    const m02File=path.join(OUT_DIR,'H13_M02_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','mech-dynamic-equilibrium','--preset','hemisphere-suspended-rope','--out',m02File],{stdio:'inherit'});
    const m02Context=await browser.newContext({viewport:VIEWPORT,offline:true});const m02Page=await m02Context.newPage(),m02Errors=[],m02Network=[],m02OfflineReport={};
    m02Page.on('pageerror',e=>m02Errors.push(e.message));m02Page.on('console',m=>{if(m.type()==='error')m02Errors.push(m.text());});m02Page.on('request',r=>{if(/^https?:/.test(r.url()))m02Network.push(r.url());});
    try{
      await m02Page.goto(pathToFileURL(m02File).href);
      const canvas=m02Page.getByTestId('sf-canvas'),read=async()=>JSON.parse(await canvas.getAttribute('data-equilibrium-rendered'));
      await m02Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.getAttribute('data-equilibrium-rendered')||'null')?.angleDeg===35);
      const initial=await read();
      await m02Page.getByRole('button',{name:'单步',exact:true}).click();
      await m02Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.getAttribute('data-equilibrium-rendered')||'null')?.t>0);
      const step=await read(),L=Math.sqrt(1+1.6**2-3.2*Math.cos(step.angleDeg*Math.PI/180));
      if(Math.abs(step.t-1/60)>1e-10||Math.abs(step.force1-19.6/1.6)>1e-9||Math.abs(step.force2-19.6*L/1.6)>1e-9||step.netResidualN>=1e-10)throw Error('M02 offline independent geometry '+JSON.stringify(step));
      await m02Page.getByRole('button',{name:'黑板深蓝'}).click();
      await m02Page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');await m02Page.screenshot({path:path.join(OUT_DIR,'H13_M02_offline_paper.png')});
      if(m02Errors.length||m02Network.length)throw Error('M02 offline errors '+JSON.stringify({m02Errors,m02Network}));
      Object.assign(m02OfflineReport,{initial,step,errors:m02Errors,network:m02Network});
    }finally{await m02Context.close();}
    const summary = { m02EquilibriumReport,m02OfflineReport,m01ChaseReport,m01OfflineReport,b5OdeReport,b5OfflineReport,b4OfflineReport,b4AnalyticReport,b3OfflineReport,b2OfflineReport,m10PhysicsReport,s01PhysicsReport,report, waveBCoordinateReport, waveCInteractionReport, v3MorphReport, v3StoryFormulaReport, v3DeviceReport, b1PhysicsReport, consoleErrors, pageErrors, failedResponses, externalRequests, screenshots: OUT_DIR };
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
