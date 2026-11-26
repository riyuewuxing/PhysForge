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
  const setAnalysis=async(id,view)=>{
    const details=page.locator('[data-testid="right-control-panel"] details');
    if(!await details.evaluate(el=>el.open))await details.locator('summary').click();
    const check=page.getByTestId('equilibrium-layer-'+id);await check.check();
    await page.waitForFunction(view=>document.querySelector('[data-testid="simulation-canvas"]')?.dataset.equilibriumView===view,view);
    await details.locator('summary').click();
  };
  await setAnalysis('angle-curve','angle-curve');
  const same=await read();if(same.t!==scanned.t||same.angleDeg!==scanned.angleDeg)throw Error('M02 angle graph reset physical state');
  await page.screenshot({path:path.join(OUT_DIR,'H16_M02_sphere_angle_curve.png')});
  await selectPreset(page,'hinged-rod-compression-tension',true);await waitAngle(60);
  const compression=await read();
  if(Math.abs(compression.rodAxialForceN-9.8)>1e-9||Math.abs(compression.force2-19.6*Math.sqrt(3)/2)>1e-9||compression.momentResidualNm>=1e-10)throw Error('M02 hinged compression '+JSON.stringify(compression));
  await page.screenshot({path:path.join(OUT_DIR,'H16_M02_hinged_compression.png')});
  await page.getByTestId('param-slider-sweepAngleDeg').fill('120');await waitAngle(120);
  const tension=await read();if(Math.abs(tension.rodAxialForceN+19.6)>1e-9||Math.abs(tension.force2-19.6*Math.sqrt(3))>1e-9||tension.netResidualN>=1e-10)throw Error('M02 hinged tension '+JSON.stringify(tension));
  await setAnalysis('aux-circle','aux-circle');
  await page.screenshot({path:path.join(OUT_DIR,'H16_M02_hinged_tension_aux.png')});
  await page.getByTestId('param-slider-sweepAngleDeg').fill('150');await waitAngle(150);
  const singular=await read();if(singular.solutionDefined!==0||'force1'in singular||'rodAxialForceN'in singular)throw Error('M02 hinged singular '+JSON.stringify(singular));
  await page.screenshot({path:path.join(OUT_DIR,'H16_M02_hinged_singular.png')});
  await selectPreset(page,'fixed-rod-support-moment',true);await waitAngle(60);
  const fixed=await read(),rx=4,ry=19.6-4*Math.sqrt(3),moment=1.2*(Math.sqrt(3)/2*ry-.5*rx);
  if(Math.abs(fixed.force2-8)>1e-10||Math.abs(fixed.reactionXN-rx)>1e-10||Math.abs(fixed.reactionYN-ry)>1e-10||Math.abs(fixed.supportMomentNm-moment)>1e-10||fixed.momentResidualNm>=1e-10||'minPullForceN'in fixed)throw Error('M02 fixed wrench '+JSON.stringify(fixed));
  await page.screenshot({path:path.join(OUT_DIR,'H16_M02_fixed_rod.png')});
  // Directly measure the actual KaTeX content, not the clipped viewport.
  const fixedOverflow=await page.locator('[data-testid="formula-card"] .pf-right-formula').evaluateAll(nodes=>nodes.map(n=>({id:n.parentElement.dataset.formulaId,available:n.clientWidth,required:n.scrollWidth})).filter(x=>x.required>x.available+1));
  console.log('H17 M02 formula overflow '+JSON.stringify(fixedOverflow));
  if(fixedOverflow.length)throw Error('M02 clipped symbolic formula '+JSON.stringify(fixedOverflow));
  // Real drag against the rendered transform; no direct store or engine mutation.
  const vp=JSON.parse(await canvas.getAttribute('data-equilibrium-viewport')),rect=await canvas.boundingBox();
  if(!rect||!vp)throw Error('M02 missing actual viewport');
  const pt=a=>{const rad=a*Math.PI/180,ppm=.24*Math.min(vp.width,vp.height)*vp.scale;return {x:rect.x+.45*vp.width+vp.offsetX-1.48*Math.cos(rad)*ppm,y:rect.y+.5*vp.height+vp.offsetY-1.48*Math.sin(rad)*ppm};};
  const from=pt(60),to=pt(85);
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:5});await page.mouse.up();await waitAngle(85);
  const dragged=await read();if(dragged.force2!==8||dragged.netResidualN>=1e-10||Math.abs(dragged.reactionXN-8*Math.cos(85*Math.PI/180))>1e-10)throw Error('M02 actual handle '+JSON.stringify(dragged));
  await page.screenshot({path:path.join(OUT_DIR,'H17_M02_fixed_drag.png')});
  await selectPreset(page,'fixed-rod-support-moment',true);await waitAngle(60);

  await setAnalysis('angle-curve','angle-curve');
  await page.screenshot({path:path.join(OUT_DIR,'H16_M02_fixed_angle_curve.png')});
  console.log('H16 M02 online '+JSON.stringify({minimum,invalid,pulley,sphere,scanned,compression,tension,singular,fixed}));
  return {minimum,invalid,pulley,sphere,scanned,compression,tension,singular,fixed};
}

async function auditM03Constraints(page,origin){
  const url=new URL(origin);url.searchParams.set('model','mech-constrained-velocity');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='mech-constrained-velocity',null,{timeout:20000});
  const canvas=page.getByTestId('simulation-canvas'),play=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]');
  const read=async()=>JSON.parse(await canvas.getAttribute('data-constrained-rendered'));
  const waitMode=async(mode)=>page.waitForFunction(mode=>{const d=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.constrainedRendered||'null');return d?.mode===mode&&d.t===0;},mode);
  const run=async()=>{
    const expand=page.getByTestId('btn-expand-oscilloscope');
    if(await expand.isVisible())await expand.click();
    await play.click();
    await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.constrainedRendered||'null')?.t>.22);
    await play.click();
    const samples=await page.evaluate(async()=>{
      const result=[];
      for(let i=0;i<8;i++){
        await new Promise(requestAnimationFrame);
        const state=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]').dataset.constrainedRendered);
        const timeText=document.querySelector('[data-testid="topbar"]').innerText.match(/t\s*=\s*([\d.]+)\s*s/);
        result.push({t:state.t,clock:Number(timeText?.[1]),plot:Number(document.querySelector('[data-testid="uplot-container"]')?.dataset.lastSampleT)});
      }
      return result;
    });
    console.log('H19 M03 paused snapshots '+JSON.stringify(samples));
    if(samples.some(x=>!Number.isFinite(x.clock)||!Number.isFinite(x.plot)||Math.abs(x.t-x.clock)>.00501||Math.abs(x.t-x.plot)>1e-10))throw Error('M03 paused snapshot mismatch '+JSON.stringify(samples));
    return read();
  };
  const check=(v,x,name,tol=1e-8)=>{if(!Number.isFinite(v)||Math.abs(v-x)>tol)throw Error('M03 '+name+' '+JSON.stringify({v,x}));};
  const residual=d=>{check(d.projSpeedDiff,0,'projection',1e-10);check(d.geometryResidualM,0,'geometry',1e-10);};
  await selectPreset(page,'ladder-sliding-wall',true);await waitMode('ladder-wall');
  const ladder=await run(),y=3*Math.sin(55*Math.PI/180)-ladder.t,x=Math.sqrt(9-y*y);
  check(ladder.yA,y,'ladder y');check(ladder.xB,x,'ladder x');check(ladder.vAy,-1,'ladder vy');check(ladder.vBx,y/x,'ladder vx');residual(ladder);
  await page.screenshot({path:path.join(OUT_DIR,'H18_M03_ladder.png')});
  await selectPreset(page,'wedge-vertical-rod',true);await waitMode('wedge-rod');
  const wedge=await run(),tan=Math.tan(37*Math.PI/180);
  check(wedge.xA,2*wedge.t,'wedge x');check(wedge.yB,(.5+2*wedge.t)*tan,'rod y');check(wedge.vBy,2*tan,'rod vy');residual(wedge);
  await page.screenshot({path:path.join(OUT_DIR,'H18_M03_wedge.png')});
  await selectPreset(page,'dual-rope-asymmetric',true);await waitMode('dual-rope-pull');
  const dual=await run(),l0=3/Math.sqrt(2),l1=l0-1.5*dual.t,l2=l0-.9*dual.t;
  check(Math.hypot(dual.xA,dual.yA),l1,'left rope');check(Math.hypot(dual.xA-3,dual.yA),l2,'right rope');
  check((-dual.xA*dual.vAx-dual.yA*dual.vAy)/l1,1.5,'left material projection',1e-10);
  check(((3-dual.xA)*dual.vAx-dual.yA*dual.vAy)/l2,.9,'right material projection',1e-10);residual(dual);
  await page.screenshot({path:path.join(OUT_DIR,'H18_M03_dual.png')});
  await selectPreset(page,'boat-dock-winch',true);await waitMode('rope-pull-boat');
  const vp0=JSON.parse(await canvas.getAttribute('data-constrained-viewport'));
  const box=await canvas.boundingBox();
  const ppm=.24*Math.min(vp0.width,vp0.height)*vp0.scale;
  const sx=x=>box.x+.45*vp0.width+vp0.offsetX+ppm*x,sy=y=>box.y+.5*vp0.height+vp0.offsetY-ppm*y;
  const initial=await read();
  await page.mouse.move(sx(initial.xA),sy(0));await page.mouse.down();await page.mouse.move(sx(1.8),sy(0),{steps:4});await page.mouse.up();
  await page.waitForFunction(()=>{const d=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.constrainedRendered||'null');return d?.t===0&&Math.abs(d.angleDeg-45)<1e-8;});
  await page.screenshot({path:path.join(OUT_DIR,'H19_M03_boat_drag.png')});
  await page.getByTestId('param-slider-initialAngleDeg').fill('75');
  await page.waitForFunction(()=>{const d=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.constrainedRendered||'null');return d?.t===0&&Math.abs(d.angleDeg-75)<1e-8;});
  const vp75=JSON.parse(await canvas.getAttribute('data-constrained-viewport'));
  if(vp75.scale<vp0.scale*1.5||await canvas.getAttribute('data-constrained-auto-fit')!=='true')throw Error('M03 high-angle automatic camera did not reframe '+JSON.stringify({vp0,vp75}));
  await page.mouse.move(box.x+40,box.y+55);await page.mouse.down();await page.mouse.move(box.x+80,box.y+75,{steps:4});await page.mouse.up();
  const manual=JSON.parse(await canvas.getAttribute('data-constrained-viewport'));
  if(await canvas.getAttribute('data-constrained-auto-fit')!=='false'||Math.abs(manual.offsetX-vp75.offsetX-40)>1||Math.abs(manual.offsetY-vp75.offsetY-20)>1)throw Error('M03 manual camera ownership '+JSON.stringify({vp75,manual}));
  await page.getByTestId('btn-reset-view').click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="simulation-canvas"]')?.dataset.constrainedAutoFit==='true');
    await play.click();await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.constrainedRendered||'null')?.terminal===1);
  const boat=await read(),time=(1.8/Math.sin(75*Math.PI/180)-1.8/Math.sin(80*Math.PI/180))/1.5;
  check(boat.t,time,'boat terminal time',1e-7);check(boat.accelBoatMag,1.5**2*1.8**2/boat.xA**3,'boat instantaneous acceleration',1e-5);
  residual(boat);await page.getByTestId('btn-step').click();const again=await read();check(again.t,boat.t,'terminal frozen time',1e-10);
  await page.screenshot({path:path.join(OUT_DIR,'H18_M03_boat_terminal.png')});
  console.log('H18 M03 online '+JSON.stringify({ladder,wedge,dual,boat}));
  return {ladder,wedge,dual,boat};
}






// M11 uses the actual rendered frame, not independently synthesized telemetry.
// E07 independent analytical oracles, evaluated at the actual rendered time.
function checkE07(s,mode){
  const a=4*Math.PI,R=10,f=2,t=s.t,x=f*t,phase=x-Math.floor(x),w=2*Math.PI*f;
  let u,rms,Q;
  if(mode==='sine'){u=a*Math.sin(w*t);rms=a/Math.sqrt(2);Q=a*a/R*(t/2-Math.sin(2*w*t)/(4*w));}
  else if(mode==='full-wave'){u=Math.abs(a*Math.sin(w*t));rms=a/Math.sqrt(2);Q=a*a/R*(t/2-Math.sin(2*w*t)/(4*w));}
  else if(mode==='sawtooth'){u=a*(2*phase-1);rms=a/Math.sqrt(3);Q=a*a/(R*f)*(Math.floor(x)/3+4*phase**3/3-2*phase**2+phase);}
  else if(mode==='duty-square'){u=phase<.25?a:0;rms=a*.5;Q=a*a/(R*f)*(Math.floor(x)*.25+Math.min(phase,.25));}
  else if(mode==='half-wave'){const z=Math.min(phase,.5);u=Math.max(0,a*Math.sin(w*t));rms=a/2;Q=a*a/(R*f)*(Math.floor(x)/4+z/2-Math.sin(4*Math.PI*z)/(8*Math.PI));}
  else if(mode==='dc-plus-sine'){u=10+a*Math.sin(w*t);rms=Math.hypot(10,a/Math.sqrt(2));Q=(100*t+20*a*(1-Math.cos(w*t))/w+a*a*(t/2-Math.sin(2*w*t)/(4*w)))/R;}
  else throw Error('E07 unknown mode '+mode);
  for(const [key,expected] of Object.entries({uInstV:u,uRmsV:rms,jouleHeatJ:Q,pAvgW:rms*rms/R,pInstW:u*u/R,sourceEmfV:a*Math.sin(w*t)})){
    if(!Number.isFinite(s[key])||Math.abs(s[key]-expected)>1e-6)throw Error('E07 '+mode+' '+key+' '+JSON.stringify({actual:s[key],expected,t}));
  }
}

function checkE08(s){
  if(s.efficiencyDefined===0&&('efficiencyPct'in s||'efficiency'in s))throw Error('E08 undefined efficiency leaked');
  const check=(k,expected)=>{if(!Number.isFinite(s[k])||Math.abs(s[k]-expected)>1e-7*Math.max(1,Math.abs(expected)))throw Error('E08 '+k+' '+JSON.stringify({actual:s[k],expected,s}));};
  if(s.mode==='multi-tap-transformer'){
    const G2=s.parallelUsersCount/s.loadR2,G3=s.branch3Closed?1/s.loadR3:0,G=G2*(s.n2Ratio/s.n1Ratio)**2+G3*(s.n3Ratio/s.n1Ratio)**2,
      U1=s.sourceU0/(1+s.primaryR0*G),I1=U1*G,U2=U1*s.n2Ratio/s.n1Ratio,U3=U1*s.n3Ratio/s.n1Ratio,
      P0=s.sourceU0*I1,P1=U1*I1,Q=I1**2*s.primaryR0,P2=U2**2*G2,P3=U3**2*G3;
    for(const [k,x] of Object.entries({operatingPointValid:1,u1:U1,i1:I1,u2:U2,i2:U2*G2,u3:U3,i3:U3*G3,pInW:P0,pTransformerInW:P1,p2W:P2,p3W:P3,pUserW:P2+P3,pLineLossW:Q,efficiencyDefined:P0>0?1:0,...(P0>0?{efficiencyPct:100*(P2+P3)/P0}:{})}))check(k,x);
  }else{
    const P=s.genPowerKw*1000,U=s.sourceU0*s.stepUpRatioK1,I=P/U,R=s.lineResistanceR,limit=R>0?U**2/R:0;
    check('requestedPowerW',P);check('requestedCurrentA',I);check('requestedLossW',I**2*R);check('maxPowerW',limit);
    if(R>0&&P>limit){check('operatingPointValid',0);check('efficiencyDefined',0);if('pInW'in s||'lineCurrentA'in s||'pUserW'in s||'efficiencyPct'in s)throw Error('E08 invalid observables leaked');return;}
    const Ur=U-I*R,Pr=Ur*I;
    for(const [k,x] of Object.entries({operatingPointValid:1,lineVoltageV:U,lineCurrentA:I,voltageDropV:I*R,u2:Ur,u3:Ur>0?220:0,pInW:P,pLineLossW:I*I*R,pUserW:Pr,efficiencyDefined:P>0?1:0,...(P>0?{efficiencyPct:100*Pr/P}:{})}))check(k,x);
  }
}
async function waitE08Display(page,offline,expected){
  await page.waitForFunction(({offline,expected})=>{
    const c=document.querySelector('[data-testid="'+(offline?'sf-canvas':'simulation-canvas')+'"]'),s=JSON.parse(c?.dataset.transformerRendered||'null'),prefix=offline?'sf-transformer-':'transformer-';
    if(!s||!Object.entries(expected).every(([k,v])=>s[k]===v))return false;
    const valid=s.operatingPointValid===1,key=valid?'pInW':'requestedPowerW',node=document.querySelector('[data-testid="'+prefix+key+'"]');
    return node&&Math.abs(Number.parseFloat(node.textContent||'NaN')-s[key])<=.006;
  },{offline,expected},{timeout:10000});
  const s=JSON.parse(await page.getByTestId(offline?'sf-canvas':'simulation-canvas').getAttribute('data-transformer-rendered'));
  checkE08(s);
  const prefix=offline?'sf-transformer-':'transformer-';
  if(s.operatingPointValid===0){
    if(await page.getByTestId(prefix+'pInW').count()||await page.getByTestId(prefix+'lineCurrentA').count())throw Error('E08 invalid sentinel shown as actual');
    if(!(await page.getByTestId(prefix+'status').innerText()).includes('无有效工作点'))throw Error('E08 invalid status absent');
  }else if(s.efficiencyDefined===0&&((await page.getByTestId(prefix+'efficiencyPct').innerText()).trim()!=='—'))throw Error('E08 undefined efficiency shown as actual');
  return s;
}

function e09Homogeneous(q,i,a,w0,t){
  if(Math.abs(a-w0)<=1e-12*Math.max(1,a,w0)){
    const B=i+a*q,e=Math.exp(-a*t);return {q:e*(q+B*t),i:e*(i-a*B*t)};
  }
  if(a<w0){
    const b=Math.sqrt(w0*w0-a*a),B=(i+a*q)/b,c=Math.cos(b*t),sn=Math.sin(b*t),e=Math.exp(-a*t);
    return {q:e*(q*c+B*sn),i:e*((-a*q+B*b)*c+(-q*b-a*B)*sn)};
  }
  const b=Math.sqrt(a*a-w0*w0),r1=-a+b,r2=-a-b,A=(i-r2*q)/(r1-r2),B=q-A;
  return {q:A*Math.exp(r1*t)+B*Math.exp(r2*t),i:r1*A*Math.exp(r1*t)+r2*B*Math.exp(r2*t)};
}
function checkE09(s){
  const L=s.inductanceH,C=s.capacitanceF,driven=s.mode==='rlc-ac-resonance',R=s.mode==='lc-undamped'?0:s.resistanceR,
    w=s.driveOmega,Um=driven?s.driveVoltAmpUm:0,w0=1/Math.sqrt(L*C),a=R/(2*L),q0=driven?0:s.initialChargeC,E0=q0*q0/(2*C),
    xl=w*L,xc=1/(w*C),delta=xl-xc,singular=R===0&&Math.abs(delta)<=1e-12*Math.max(1,xl,xc),Z=singular?0:Math.hypot(R,delta);
  const kind=driven?(singular?(Um>0?3:4):R>0?1:2):0,regime=R===0?0:Math.abs(a-w0)<=1e-12*Math.max(1,a,w0)?2:a>w0?3:1;
  const trajectory=t=>{
    if(!driven)return e09Homogeneous(q0,0,a,w0,t);
    if(singular){const A=Um/(2*L*w0);return {q:A*t*Math.sin(w0*t),i:A*(Math.sin(w0*t)+w0*t*Math.cos(w0*t))};}
    const I=Um/Z,phi=Math.atan2(delta,R),h=e09Homogeneous(I*Math.sin(phi)/w,-I*Math.cos(phi),a,w0,t);
    return {q:h.q+I*Math.sin(w*t-phi)/w,i:h.i+I*Math.cos(w*t-phi)};
  };
  const check=(k,x,tol=3e-6)=>{if(!Number.isFinite(s[k])||Math.abs(s[k]-x)>tol*Math.max(1,Math.abs(x)))throw Error('E09 '+k+' '+JSON.stringify({actual:s[k],expected:x,t:s.t,mode:s.mode}));};
  const {q,i}=trajectory(s.t),EC=q*q/(2*C),EL=L*i*i/2,u=Um*Math.cos(w*s.t);
  for(const [k,x] of Object.entries({chargeQ:q,currentI:i,energyElectricJ:EC,energyMagneticJ:EL,totalEmEnergyJ:EC+EL,uCapV:q/C,uResV:R*i,uDriveV:u,uIndV:u-R*i-q/C,lossPowerW:R*i*i,drivePowerW:u*i,dampingRegime:regime,responseKind:kind,naturalPeriod:2*Math.PI/w0}))check(k,x);
  let heat=0,work=0;
  if(s.t>0){
    // Independent Simpson quadrature of the analytical trajectory, not the RK4 energy ledger.
    const n=2*Math.max(100,Math.ceil(s.t*Math.max(w,w0)*100)),h=s.t/n;
    for(let j=0;j<=n;j++){const t=j*h,ii=trajectory(t).i,c=j===0||j===n?1:j%2===0?2:4;heat+=c*R*ii*ii;work+=c*Um*Math.cos(w*t)*ii;}
    heat*=h/3;work*=h/3;
  }
  check('jouleHeatJ',heat,8e-6);check('sourceWorkJ',work,8e-6);
  if(!Number.isFinite(s.energyResidualJ)||Math.abs(s.energyResidualJ)>1e-5*Math.max(1,E0,Math.abs(work)))throw Error('E09 independent energy balance '+JSON.stringify(s));
  if(driven){check('impedanceR',R);check('impedanceMag',Z);
    if(singular){if('referenceCurrentPeak'in s||'referencePhaseRad'in s)throw Error('E09 undefined reference leaked');}
    else check('referenceCurrentPeak',Um/Z);
  }else if('referenceCurrentPeak'in s)throw Error('E09 free oscillation has fictitious driven response');
  if(!driven&&regime>=2&&'measuredPeriod'in s)throw Error('E09 nonoscillatory fabricated period');
  return {q,i,heat,work,kind,regime};
}
async function syncE09(page,offline){
  const prefix=offline?'sf-':'',canvas=page.getByTestId(offline?'sf-canvas':'simulation-canvas');
  await page.waitForFunction(({offline,prefix})=>{
    const s=JSON.parse(document.querySelector('[data-testid="'+(offline?'sf-canvas':'simulation-canvas')+'"]')?.dataset.lcRendered||'null');
    const t=Number(document.querySelector('[data-testid="'+prefix+'lc-readouts"]')?.dataset.sampleTime),
      plot=Number(document.querySelector('[data-testid="'+(offline?'sf-uplot':'uplot-container')+'"]')?.dataset.lastSampleT);
    return s&&Math.abs(s.t-t)<1e-10&&Math.abs(s.t-plot)<1e-10;
  },{offline,prefix},{timeout:6000});
  const s=JSON.parse(await canvas.getAttribute('data-lc-rendered'));checkE09(s);
  if(s.responseKind===3||s.responseKind===4){
    if(await page.getByTestId(prefix+'lc-referenceCurrentPeak').count())throw Error('E09 fake finite reference in UI');
    if(!(await page.getByTestId(prefix+'lc-status').innerText()).includes(s.responseKind===3?'无有限周期稳态':'退化无激发'))throw Error('E09 singular/zero status missing');
  }
  if(!('measuredPeriod'in s)&&((await page.getByTestId(prefix+'lc-measuredPeriod').innerText()).trim()!=='—'))throw Error('E09 unmeasured period not blank');
  const readout=await page.getByTestId(prefix+'lc-chargeQ').innerText();
  if(Math.abs(Number.parseFloat(readout)-s.chargeQ)>.0006)throw Error('E09 stale charge readout');
  return s;
}


function checkW01(s){
  const c=s.frequency*s.wavelength,w=2*Math.PI*s.frequency,k=2*Math.PI/s.wavelength,A=s.amplitude,t=s.t;
  const check=(name,got,want,tol=3e-7)=>{if(!Number.isFinite(got)||Math.abs(got-want)>tol*Math.max(1,Math.abs(want)))throw Error('W01 '+name+' '+JSON.stringify({got,want,s}));};
  check('wave speed',s.waveSpeed,c);
  let y=0,vy=0,ay=0,amp;
  if(s.mode==='transverse'){
    const sign=s.direction==='right'?1:-1,d=sign*s.probeX,active=!s.causalFront||d>=0&&d<=c*t,phase=w*t-k*d;
    if(active){y=A*Math.sin(phase);vy=A*w*Math.cos(phase);ay=-w*w*y;}
    amp=active?A:0;check('signed spatial slope',s.spatialSlope,active?-sign*A*k*Math.cos(phase):0);
  }else if(s.mode==='standing'){
    const a=2*A*Math.sin(k*s.probeX);y=a*Math.cos(w*t);vy=-a*w*Math.sin(w*t);ay=-w*w*y;amp=Math.abs(a);
  }else if(s.mode==='interference'){
    const r1=Math.hypot(s.probeX+s.sourceSeparation/2,s.probeY),r2=Math.hypot(s.probeX-s.sourceSeparation/2,s.probeY),phi=s.phaseDiffDeg*Math.PI/180;
    const a1=!s.causalFront||r1<=c*t,a2=!s.causalFront||r2<=c*t;
    y=A*((a1?Math.sin(w*t-k*r1):0)+(a2?Math.sin(w*t-k*r2+phi):0));vy=A*w*((a1?Math.cos(w*t-k*r1):0)+(a2?Math.cos(w*t-k*r2+phi):0));ay=-w*w*y;
    amp=A*Math.hypot((a1?Math.cos(-k*r1):0)+(a2?Math.cos(-k*r2+phi):0),(a1?Math.sin(-k*r1):0)+(a2?Math.sin(-k*r2+phi):0));
    check('signed path',s.signedPathDifference,r2-r1);check('absolute path',s.pathDifference,Math.abs(r2-r1));check('active count',s.activeCount,Number(a1)+Number(a2));
  }else{
    const u=c*s.sourceSpeedRatio,X=s.probeX+2,Y=s.probeY;
    // Independent root isolation in emission time: the arrival-time function
    // is convex. Split at its minimum for the supersonic case, then bisect.
    const arrival=tau=>tau+Math.hypot(X-u*tau,Y)/c;
    const cuts=[0,t];
    if(u>c){const turn=(X-c*Math.abs(Y)/Math.sqrt(s.sourceSpeedRatio**2-1))/u;if(turn>0&&turn<t)cuts.splice(1,0,turn);}
    const roots=[];
    for(let j=1;j<cuts.length;j++){
      let lo=cuts[j-1],hi=cuts[j],a=arrival(lo)-t,b=arrival(hi)-t;
      if(Math.abs(a)<1e-10)roots.push(lo);if(Math.abs(b)<1e-10)roots.push(hi);
      if(a*b<0){for(let i=0;i<70;i++){const mid=(lo+hi)/2,z=arrival(mid)-t;if(a*z<=0){hi=mid;b=z;}else{lo=mid;a=z;}}roots.push((lo+hi)/2);}
    }
    roots.sort((a,b)=>a-b);const taus=roots.filter((x,i)=>i===0||Math.abs(x-roots[i-1])>1e-9);
    check('source x',s.sourceX,-2+u*t);check('arrival count',s.arrivalCount,taus.length,0);
    if(s.retardedTimes.length!==taus.length)throw Error('W01 retarded branch count');
    const fs=[];
    for(const [i,tau] of taus.entries()){
      check('retarded root',s.retardedTimes[i],tau,1e-8);
      const r=Math.hypot(X-u*tau,Y),J=1-u*(X-u*tau)/(c*r),Jprime=u*u*Y*Y/(c*r*r*r);
      if(r<1e-9||Math.abs(J)<1e-8){if(s.probeSampleDefined!==0||'probeY'in s)throw Error('W01 singular measurement');return s;}
      y+=A*Math.sin(w*tau);vy+=A*w*Math.cos(w*tau)/J;ay+=A*(-w*w*Math.sin(w*tau)/(J*J)-w*Math.cos(w*tau)*Jprime/(J*J*J));fs.push(Math.abs(s.frequency/J));
    }
    if(taus.length===1)check('local frequency',s.localFrequencyHz,fs[0]);
    else if('localFrequencyHz'in s)throw Error('W01 single frequency fabricated');
    const n=Math.floor(t*s.frequency+1e-10);check('emission count',s.emittedCount,n+1,0);
    if(s.wavefronts.length!==Math.min(40,n+1))throw Error('W01 emission history length');
    for(const [i,f] of s.wavefronts.entries()){const tau=(Math.max(0,n-39)+i)/s.frequency;check('front time',f.emittedAt,tau,1e-10);check('front center',f.cx,-2+u*tau,1e-10);}
    if(s.sourceSpeedRatio<1)check('front frequency',s.frontFreq,s.frequency/(1-s.sourceSpeedRatio));
    else if('frontFreq'in s)throw Error('W01 sonic/supersonic forward frequency');
  }
  check('actual displacement',s.probeY,y);check('actual velocity',s.probeVy,vy);check('actual acceleration',s.probeAy,ay,2e-6);
  if(amp!==undefined)check('actual local amplitude',s.analyticalAmplitude,amp);
  if(s.historyLast){check('actual history time',s.historyLast.x,t,1e-9);check('actual history displacement',s.historyLast.y,y);}
  return s;
}
async function syncW01(page,offline){
  const pre=offline?'sf-':'',canvas=page.getByTestId(offline?'sf-canvas':'simulation-canvas');
  await page.waitForFunction(({pre,offline})=>{const s=JSON.parse(document.querySelector('[data-testid="'+(offline?'sf-canvas':'simulation-canvas')+'"]')?.dataset.waveRendered||'null'),p=Number(document.querySelector('[data-testid="'+(offline?'sf-uplot':'uplot-container')+'"]')?.dataset.lastSampleT),t=Number(document.querySelector('[data-testid="'+pre+'wave-readouts"]')?.dataset.sampleTime);return s&&Math.abs(s.t-p)<1e-9&&Math.abs(s.t-t)<1e-9;},{pre,offline},{timeout:8000});
  const s=checkW01(JSON.parse(await canvas.getAttribute('data-wave-rendered'))),v=JSON.parse(await canvas.getAttribute('data-wave-view'));
  const ppm=.24*Math.min(v.width,v.height)*v.scale,b=v.bounds,q=v.safe,x1=v.width*.45+v.offsetX+b.minX*ppm,x2=v.width*.45+v.offsetX+b.maxX*ppm,y1=v.height*.5+v.offsetY-b.maxY*ppm,y2=v.height*.5+v.offsetY-b.minY*ppm;
  if(q&&(x1<q.left-2||x2>q.right+2||y1<q.top-2||y2>q.bottom+2))throw Error('W01 scene bounds '+JSON.stringify({x1,x2,y1,y2,q}));
  if(s.probeSampleDefined===1){const y=parseFloat(await page.getByTestId(pre+'wave-probeY').innerText());if(Math.abs(y-s.probeY)>.0006)throw Error('W01 stale readout');}
  return s;
}
async function auditW01(page,origin){
  const url=new URL(origin);url.searchParams.set('model','wave-vibration-coupling');await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='wave-vibration-coupling');
  const canvas=page.getByTestId('simulation-canvas'),play=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]'),report={};
  const photo=name=>page.screenshot({path:path.join(OUT_DIR,'H40_W01_'+name+'.png')});
  const run=async t=>{await play.click();await page.waitForFunction(t=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.waveRendered||'null')?.t>t,t,{timeout:15000});await play.click();return syncW01(page,false);};
  for(const [id,mode,duration] of [['transverse-slope-rule','transverse',.5],['causal-wavefront-startup','transverse',1.43],['causal-wavefront-left','transverse',1.35],['standing-wave-nodes','standing',.4],['standing-wave-node','standing',.4],['interference-in-phase','interference',.42],['interference-anti-phase-misconception','interference',.42],['interference-causal-two-arrivals','interference',.9],['doppler-moving-source','doppler',2.35],['doppler-offaxis','doppler',1.45],['doppler-sonic-boundary','doppler',.45],['doppler-two-branches','doppler',.58],['supersonic-mach-cone','doppler',1.25]]){
    await selectPreset(page,id,true);await page.waitForFunction(mode=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.waveRendered||'null');return s?.mode===mode&&s.t===0;},mode);
    const expand=page.getByTestId('btn-expand-oscilloscope');if(await expand.isVisible())await expand.click();
    const pair=mode==='doppler'?['probeY','localFrequencyHz','separate']:mode==='transverse'?['probeY','probeVy','separate']:['probeY','analyticalAmplitude','shared'];
    await page.waitForFunction(([a,b,u])=>document.querySelector('[data-testid="scope-channel-a"]')?.dataset.channelKey===a&&document.querySelector('[data-testid="scope-channel-b"]')?.dataset.channelKey===b&&document.querySelector('[data-testid="floating-scope-dock"]')?.dataset.scopeUnits===u,pair);
    await page.getByTestId('wave-scope-empty').waitFor({state:'visible'});
    const initial=checkW01(JSON.parse(await canvas.getAttribute('data-wave-rendered')));
    if(await page.getByTestId('viewport-zoom-badge').innerText()!=='100%')throw Error('W01 default zoom');
    if(mode==='standing'&&await page.locator('#param-direction').count())throw Error('W01 irrelevant direction control');
    if(mode!=='doppler'&&await page.getByTestId('param-slider-sourceSpeedRatio').count())throw Error('W01 irrelevant source speed control');
    if(id==='causal-wavefront-startup'){await photo('causal_initial');const pre=await run(.7);if(pre.probeY!==0)throw Error('W01 precocious receiver');await photo('causal_before_arrival');}
    if(id==='interference-causal-two-arrivals'){const one=await run(.51);if(one.activeCount!==1)throw Error('W01 single-source stage');await photo('interference_single_source');}
    const final=await run(duration);
    report[id]={initial,final};await photo(id);
  }
  console.log('H40 W01 online '+JSON.stringify(report));return report;
}

function checkE10(raw){
  const s=raw.position?raw:{...raw,position:{x:raw.x,y:raw.y,z:raw.z},velocity:{x:raw.vx,y:raw.vy,z:raw.vz},B:{x:raw.bxT,y:raw.byT,z:raw.bzT},a:{x:raw.ax,y:raw.ay,z:raw.az}};
  const t=s.t,p=s.position,v=s.velocity,B=s.B,a=s.a,qm=s.qOverM*(s.geometryType==='uniform-helix'?1:1e6);
  const check=(label,got,want,tol=3e-5)=>{if(!Number.isFinite(got)||Math.abs(got-want)>tol*Math.max(1,Math.abs(want)))throw Error('E10 '+label+' '+JSON.stringify({got,want,s}));};
  if(!B||!a)throw Error('E10 unexpected undefined field');
  const speed=Math.hypot(v.x,v.y,v.z);
  check('speed',speed,Math.hypot(s.vPerp,s.vParallel),1e-8);
  check('ax',a.x,qm*(v.y*B.z-v.z*B.y),1e-9);
  check('ay',a.y,qm*(v.z*B.x-v.x*B.z),1e-9);
  check('az',a.z,qm*(v.x*B.y-v.y*B.x),1e-9);
  check('specific work',v.x*a.x+v.y*a.y+v.z*a.z,0,1e-8);
  if(s.geometryType==='uniform-helix'){
    const w=qm*s.uniformBz,c=Math.cos(w*t),sn=Math.sin(w*t);
    check('Bx',B.x,0);check('By',B.y,0);check('Bz',B.z,s.uniformBz);
    check('vx',v.x,s.vPerp*c);check('vy',v.y,-s.vPerp*sn);check('vz',v.z,s.vParallel,1e-9);
    check('x',p.x,.4+(w===0?s.vPerp*t:s.vPerp/w*sn));
    check('y',p.y,w===0?0:s.vPerp/w*(c-1));
    check('z',p.z,-1.2+s.vParallel*t,1e-9);
  }else if(s.geometryType==='straight-wire'){
    const rho=Math.hypot(p.x,p.y),M=1e-7*s.currentI/rho*((4-p.z)/Math.hypot(rho,4-p.z)+(4+p.z)/Math.hypot(rho,4+p.z));
    check('finite-wire Bx',B.x,-M*p.y/rho,1e-12);check('finite-wire By',B.y,M*p.x/rho,1e-12);check('finite-wire Bz',B.z,0,1e-12);
  }
  return s;
}
async function auditE10Magnetic(page,origin){
  const url=new URL(origin);url.searchParams.set('model','em-3d-magnetic-fields');await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='em-3d-magnetic-fields');
  const stage=page.getByTestId('three-stage-container'),play=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]'),report={};
  await stage.waitFor({state:'visible',timeout:20000});
  for(const [id,geometry,qm,bz,I,vperp] of [
    ['uniform-negative-charge','uniform-helix',-4,4,2,2.4],
    ['uniform-negative-field','uniform-helix',4,-4,2,2.4],
    ['uniform-zero-field','uniform-helix',1,0,2,1.5],
    ['uniform-parallel-only','uniform-helix',1,2,2,0],
    ['finite-wire-reverse','straight-wire',1.2,2,-2.5,1]
  ]){
    await selectPreset(page,id,true);
    await page.waitForFunction(({geometry,qm,bz,I,vperp})=>{const s=JSON.parse(document.querySelector('[data-testid="three-stage-container"]')?.dataset.magneticRendered||'null');return s?.geometryType===geometry&&s.qOverM===qm&&s.uniformBz===bz&&s.currentI===I&&s.vPerp===vperp&&s.t===0;},{geometry,qm,bz,I,vperp},{timeout:10000});
    const initial=checkE10(JSON.parse(await stage.getAttribute('data-magnetic-rendered')));
    const expand=page.getByTestId('btn-expand-oscilloscope');if(await expand.isVisible())await expand.click();
    const expected=geometry==='uniform-helix'?['vx','vy','shared']:['speed','bMagMicroT','separate'];
    await page.waitForFunction(([a,b,u])=>document.querySelector('[data-testid="scope-channel-a"]')?.dataset.channelKey===a&&document.querySelector('[data-testid="scope-channel-b"]')?.dataset.channelKey===b&&document.querySelector('[data-testid="floating-scope-dock"]')?.dataset.scopeUnits===u,expected);
    await page.getByTestId('magnetic-scope-empty').waitFor({state:'visible'});
    if(geometry==='uniform-helix'&&await page.getByTestId('param-slider-currentI').count())throw Error('E10 irrelevant current control');
    if(geometry==='straight-wire'&&await page.getByTestId('param-slider-uniformBz').count())throw Error('E10 irrelevant uniform B control');
    if(id==='uniform-zero-field'||id==='uniform-parallel-only'){
      await page.waitForFunction(()=>document.querySelector('[data-testid="three-stage-container"]')?.dataset.renderedForceArrow==='false');
    }
    if(id==='uniform-zero-field')await page.waitForFunction(()=>{const d=document.querySelector('[data-testid="three-stage-container"]')?.dataset;return d?.renderedFieldArrow==='false'&&d.fieldLineCount==='0';});
    if(geometry==='straight-wire')await page.waitForFunction(()=>{const d=document.querySelector('[data-testid="three-stage-container"]')?.dataset;return d?.conductorCount==='1'&&d.fieldLineCount==='9'&&d.currentArrowCount==='2'&&d.currentArrowDirection==='-1';});
    await play.click();await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="three-stage-container"]')?.dataset.magneticRendered||'null')?.t>.38,null,{timeout:15000});await play.click();
    await page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="three-stage-container"]')?.dataset.magneticRendered||'null'),p=Number(document.querySelector('[data-testid="uplot-container"]')?.dataset.lastSampleT),t=Number(document.querySelector('[data-testid="magnetic-readouts"]')?.dataset.sampleTime);return s&&Math.abs(s.t-t)<1e-9&&Math.abs(s.t-p)<1e-9;},null,{timeout:8000});
    const final=checkE10(JSON.parse(await stage.getAttribute('data-magnetic-rendered')));
    const vx=parseFloat(await page.getByTestId('magnetic-vx').innerText());if(Math.abs(vx-final.velocity.x)>.0006)throw Error('E10 stale signed velocity readout');
    report[id]={initial,final};await page.screenshot({path:path.join(OUT_DIR,'H39_E10_'+id+'.png')});
  }
  console.log('H39 E10 online '+JSON.stringify(report));return report;
}

async function auditE09Lc(page,origin){
  const url=new URL(origin);url.searchParams.set('model','em-lc-rlc-oscillation');await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='em-lc-rlc-oscillation');
  const play=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]'),report={};
  const photo=name=>page.screenshot({path:path.join(OUT_DIR,'H38_E09_'+name+'.png')});
  const run=async t=>{
    await play.click();await page.waitForFunction(t=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.lcRendered||'null')?.t>t,t,{timeout:18000});await play.click();
    return syncE09(page,false);
  };
  for(const [id,mode,kind,regime,duration] of [
    ['lc-free-energy-exchange','lc-undamped',0,0,1.84],
    ['rlc-damped-decay','rlc-damped',0,1,.83],
    ['rlc-critical-decay','rlc-damped',0,2,.70],
    ['rlc-overdamped-decay','rlc-damped',0,3,.70],
    ['rlc-series-resonance-peak','rlc-ac-resonance',1,1,.82],
    ['rlc-detuned-driven','rlc-ac-resonance',1,1,.82],
    ['lc-lossless-resonance','rlc-ac-resonance',3,0,.95],
    ['lc-lossless-detuned','rlc-ac-resonance',2,0,.85],
    ['lc-zero-excitation','rlc-ac-resonance',4,0,.30]
  ]){
    await selectPreset(page,id,true);
    await page.waitForFunction(({mode,kind,regime})=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.lcRendered||'null');return s?.mode===mode&&s.responseKind===kind&&s.dampingRegime===regime&&s.t===0;},{mode,kind,regime});
    const expand=page.getByTestId('btn-expand-oscilloscope');if(await expand.isVisible())await expand.click();
    const expected=mode==='lc-undamped'?['energyElectricJ','energyMagneticJ','shared']:mode==='rlc-damped'?['totalEmEnergyJ','jouleHeatJ','shared']:['currentI','uDriveV','separate'];
    await page.waitForFunction(([a,b,u])=>document.querySelector('[data-testid="scope-channel-a"]')?.dataset.channelKey===a&&document.querySelector('[data-testid="scope-channel-b"]')?.dataset.channelKey===b&&document.querySelector('[data-testid="floating-scope-dock"]')?.dataset.scopeUnits===u,expected);
    await page.waitForFunction(()=>document.querySelector('[data-testid="viewport-zoom-badge"]')?.textContent?.trim()==='100%',null,{timeout:5000});
    await page.getByTestId('lc-scope-empty').waitFor({state:'visible'});
    const initial=JSON.parse(await page.getByTestId('simulation-canvas').getAttribute('data-lc-rendered'));checkE09(initial);
    if('measuredPeriod'in initial)throw Error('E09 initial period fabricated');
    if(mode!=='rlc-ac-resonance'&&await page.getByTestId('param-slider-driveOmega').count())throw Error('E09 inactive drive controls');
    if(mode==='lc-undamped'){await photo('lc_initial');const exchange=await run(.22);if(exchange.energyMagneticJ<.7*exchange.initialEnergyJ)throw Error('E09 quarter-cycle transfer');await photo('lc_quarter');}
    const final=await run(duration);
    if(mode==='lc-undamped'&&(!Number.isFinite(final.measuredPeriod)||Math.abs(final.measuredPeriod-final.naturalPeriod)>1e-5))throw Error('E09 measured free period');
    report[id]={initial,final};await photo(id);
  }
  console.log('H38 E09 online '+JSON.stringify(report));return report;
}

async function auditE08Transformer(page,origin){
  const url=new URL(origin);url.searchParams.set('model','em-transformer-grid');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='em-transformer-grid');
  const photo=async name=>page.screenshot({path:path.join(OUT_DIR,'H37_E08_'+name+'.png')});
  const select=async(id,expected)=>{await selectPreset(page,id,true);const s=await waitE08Display(page,false,expected);
    if(await page.getByTestId('floating-scope-dock').count()||await page.getByTestId('btn-expand-oscilloscope').count())throw Error('E08 static scene fabricated time scope');
    await page.waitForFunction(()=>document.querySelector('[data-testid="viewport-zoom-badge"]')?.textContent?.trim()==='100%',null,{timeout:5000});
    return s;};
  const multi=await select('primary-resistor-parallel-users',{mode:'multi-tap-transformer',branch3Closed:true,parallelUsersCount:2});
  if(await page.getByTestId('param-slider-genPowerKw').count())throw Error('E08 inactive grid controls');
  await photo('multi_closed');
  await page.getByRole('checkbox',{name:'闭合第 2 副路开关'}).uncheck();
  const opened=await waitE08Display(page,false,{mode:'multi-tap-transformer',branch3Closed:false});
  if(opened.u1<=multi.u1||opened.i1>=multi.i1||opened.i3!==0||opened.u3<=0)throw Error('E08 open switch response');
  await photo('multi_switch_open');
  const dual=await select('multi-tap-dual-secondary',{mode:'multi-tap-transformer',primaryR0:0,n1Ratio:4,branch3Closed:true});
  await page.getByRole('checkbox',{name:'闭合第 2 副路开关'}).uncheck();
  const dualOpen=await waitE08Display(page,false,{mode:'multi-tap-transformer',primaryR0:0,branch3Closed:false});
  if(dualOpen.u2!==dual.u2||dualOpen.i1>=dual.i1)throw Error('E08 ideal primary source independence');
  const idle=await select('multi-tap-open-load',{mode:'multi-tap-transformer',parallelUsersCount:0,branch3Closed:false});
  await photo('multi_no_load');
  const grid10=await select('grid-10x-reference',{mode:'long-distance-grid',stepUpRatioK1:10,genPowerKw:100});
  if(await page.getByTestId('param-slider-primaryR0').count())throw Error('E08 inactive primary controls');
  await photo('grid_10x');
  const slider=page.getByTestId('param-slider-stepUpRatioK1');await slider.press('ArrowRight');await slider.press('ArrowRight');
  const grid20=await waitE08Display(page,false,{mode:'long-distance-grid',stepUpRatioK1:20,genPowerKw:100});
  if(Math.abs(grid20.pLineLossW/grid10.pLineLossW-.25)>1e-10)throw Error('E08 loss ratio');
  await photo('grid_20x');
  const invalid=await select('grid-infeasible-request',{mode:'long-distance-grid',genPowerKw:200,stepUpRatioK1:5,operatingPointValid:0});await photo('grid_invalid');
  const zero=await select('grid-zero-power',{mode:'long-distance-grid',genPowerKw:0,efficiencyDefined:0});await photo('grid_zero');
  await select('high-voltage-10x-vs-20x',{mode:'long-distance-grid',genPowerKw:100,stepUpRatioK1:20});
  const menu=page.getByTestId('btn-tools-menu');if((await menu.getAttribute('aria-expanded'))!=='true')await menu.click();
  const theme=await page.locator('html').getAttribute('data-theme');
  if(theme!=='projector')await page.getByTestId('btn-theme').click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='projector');
  if((await menu.getAttribute('aria-expanded'))==='true')await menu.click();
  await photo('grid_projector');
  if(theme!=='projector'){if((await menu.getAttribute('aria-expanded'))!=='true')await menu.click();await page.getByTestId('btn-theme').click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='chalkboard');if((await menu.getAttribute('aria-expanded'))==='true')await menu.click();}
  const report={multi,opened,dual,dualOpen,idle,grid10,grid20,invalid,zero};console.log('H37 E08 online '+JSON.stringify(report));return report;
}

async function auditE07Generator(page,origin){
  const url=new URL(origin);url.searchParams.set('model','em-ac-generator-rms');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='em-ac-generator-rms');
  const canvas=page.getByTestId('simulation-canvas'),play=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]'),read=async()=>JSON.parse(await canvas.getAttribute('data-generator-rendered'));
  const report={};
  for(const [id,mode] of [['sine-ac-neutral-plane','sine'],['half-wave-rectifier-rms','half-wave'],['full-wave-rectifier-rms','full-wave'],['duty-square-wave-rms','duty-square'],['sawtooth-wave-rms','sawtooth'],['dc-ac-superposition','dc-plus-sine']]){
    await selectPreset(page,id,true);
    await page.waitForFunction(mode=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.generatorRendered||'null');return s?.waveform===mode&&s.t===0;},mode);
    const expand=page.getByTestId('btn-expand-oscilloscope');if(await expand.isVisible())await expand.click();
    await page.waitForFunction(()=>document.querySelector('[data-testid="scope-channel-a"]')?.dataset.channelKey==='uInstV'&&document.querySelector('[data-testid="scope-channel-b"]')?.dataset.channelKey==='uRmsV');
    const initial=await read();checkE07(initial,mode);
    await page.waitForFunction(()=>document.querySelector('[data-testid="viewport-zoom-badge"]')?.textContent?.trim()==='100%',null,{timeout:5000});
    if(mode!=='duty-square'&&await page.getByTestId('param-slider-dutyCycleD').count())throw Error('E07 inactive duty control');
    await page.getByTestId('generator-scope-empty').waitFor({state:'visible'});
    if(mode==='sine')await page.screenshot({path:path.join(OUT_DIR,'H36_E07_neutral_plane.png')});
    await play.click();await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.generatorRendered||'null')?.t>.72,null,{timeout:18000});await play.click();
    await page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.generatorRendered||'null'),p=Number(document.querySelector('[data-testid="uplot-container"]')?.dataset.lastSampleT),t=Number(document.querySelector('[data-testid="generator-readouts"]')?.dataset.sampleTime);return s&&Math.abs(s.t-p)<1e-10&&Math.abs(s.t-t)<1e-10;},null,{timeout:5000});
    const final=await read();checkE07(final,mode);report[mode]={initial,final};
    await page.screenshot({path:path.join(OUT_DIR,'H36_E07_'+mode+'.png')});
  }
  console.log('H36 E07 online '+JSON.stringify(report));return report;
}

async function auditE06Eddy(page,origin){
  const url=new URL(origin);url.searchParams.set('model','em-eddy-vortex-field');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='em-eddy-vortex-field');
  const canvas=page.getByTestId('simulation-canvas'),play=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]');
  const read=async()=>JSON.parse(await canvas.getAttribute('data-eddy-rendered'));
  const check=(v,x,label,tol=1e-7)=>{if(!Number.isFinite(v)||Math.abs(v-x)>tol)throw Error('E06 '+label+' '+JSON.stringify({v,x}));};
  const select=async(id,mode,a,b)=>{
    await selectPreset(page,id,true);
    await page.waitForFunction(mode=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.eddyRendered||'null');return s?.mode===mode&&s.t===0;},mode);
    const expand=page.getByTestId('btn-expand-oscilloscope');if(await expand.isVisible())await expand.click();
    await page.waitForFunction(([a,b])=>document.querySelector('[data-testid="scope-channel-a"]')?.dataset.channelKey===a&&document.querySelector('[data-testid="scope-channel-b"]')?.dataset.channelKey===b,[a,b]);
    return read();
  };
  const runTo=async(t)=>{
    await play.click();await page.waitForFunction(t=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.eddyRendered||'null')?.t>t,t,{timeout:18000});await play.click();
    await page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.eddyRendered||'null'),t=Number(document.querySelector('[data-testid="eddy-readouts"]')?.dataset.sampleTime),p=Number(document.querySelector('[data-testid="uplot-container"]')?.dataset.lastSampleT);return s&&Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;},null,{timeout:5000});return read();
  };
  const photo=async name=>page.screenshot({path:path.join(OUT_DIR,'H35_E06_'+name+'.png')});
  const initial=await select('betatron-vortex-acceleration','betatron-vortex','bCurrent','eVortexMag');
    await page.waitForFunction(()=>document.querySelector('[data-testid="viewport-zoom-badge"]')?.textContent?.trim()==='100%',null,{timeout:5000});
  check(initial.Ey,-.675,'initial E_y');check(initial.Ex,0,'initial E_x');
  check(initial.specificKineticEnergy,.18,'initial K/m');check(initial.bLocal,1,'inside B');
  if('solidAngleDeg'in initial||await page.getByTestId('param-slider-solidDampingGamma').count())throw Error('E06 inactive damping control');
  await page.getByTestId('eddy-scope-empty').waitFor({state:'visible'});
  const ramp=await runTo(.55);
  check(ramp.bCurrent,1+1.5*ramp.t,'actual ramp');check(ramp.specificKineticEnergy-.18,ramp.specificElectricWork,'independent work',1e-6);await photo('positive_ramp');
  const outside=await select('outer-region-1overr-decay','betatron-vortex','bCurrent','eVortexMag');
  check(outside.bLocal,0,'outer B');check(outside.Ey,-2*.8*.8/(2*1.25),'outer E');await photo('outer');
  await select('vortex-negative-charge','betatron-vortex','bCurrent','eVortexMag');
  const negative=await runTo(.35);check(negative.particleChargeRatio,-1.6,'negative q/m');check(negative.specificKineticEnergy-.18,negative.specificElectricWork,'negative work',1e-6);await photo('negative');
  await select('vortex-zero-ramp','betatron-vortex','bCurrent','eVortexMag');
  const pure=await runTo(.55),w=2;
  check(pure.px,.3+.6*(Math.cos(w*pure.t)-1)/w,'pure B x');check(pure.py,-.6*Math.sin(w*pure.t)/w,'pure B y');check(pure.specificKineticEnergy,.18,'pure B K/m');check(pure.eVortexMag,0,'pure B E');await photo('pure_B');
  await select('vortex-neutral-crossing','betatron-vortex','bCurrent','eVortexMag');
  const neutral=await runTo(1.8),hit=Math.sqrt(1.2**2-.6**2)/.6;
  check(neutral.px,.6,'neutral x');check(neutral.py,-.6*neutral.t,'neutral y');check(neutral.eventCount,1,'neutral event');check(neutral.eventTime,hit,'neutral exit time',1e-9);check(neutral.bLocal,0,'exit B');await photo('neutral_exit');
  const damp0=await select('eddy-solid-vs-slotted-pendulum','eddy-damping-compare','solidAngleDeg','slottedAngleDeg');
  if('eVortexMag'in damp0||await page.getByTestId('param-slider-particleChargeRatio').count())throw Error('E06 inactive particle control');
  const damp=await runTo(3.1),E0=9.8*(1-Math.cos(35*Math.PI/180));
  check(damp.solidEnergySpecific+damp.solidHeatSpecific,E0,'solid energy',1e-6);check(damp.slottedEnergySpecific+damp.slottedHeatSpecific,E0,'slotted energy',1e-6);
  if(damp.solidHeatSpecific<=damp.slottedHeatSpecific)throw Error('E06 damping contrast');await photo('damping');
  await select('eddy-zero-damping','eddy-damping-compare','solidAngleDeg','slottedAngleDeg');
  const zero=await runTo(1.4);check(zero.solidAngleDeg,zero.slottedAngleDeg,'equal zero damping');check(zero.solidHeatSpecific,0,'zero heat');check(zero.solidEnergySpecific,E0,'zero damping energy',1e-6);await photo('zero_damping');
  const report={initial,ramp,outside,negative,pure,neutral,damp0,damp,zero};console.log('H35 E06 online '+JSON.stringify(report));return report;
}

async function auditE05Wireframe(page,origin){
  const url=new URL(origin);url.searchParams.set('model','em-wireframe-rotation');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='em-wireframe-rotation');
  const canvas=page.getByTestId('simulation-canvas'),play=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]');
  const read=async()=>JSON.parse(await canvas.getAttribute('data-wire-rendered'));
  const check=(v,x,label,tol=1e-7)=>{if(!Number.isFinite(v)||Math.abs(v-x)>tol)throw Error('E05 '+label+' '+JSON.stringify({v,x}));};
  const select=async(id,mode,a,b)=>{
    await selectPreset(page,id,true);
    await page.waitForFunction(mode=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.wireRendered||'null');return s?.mode===mode&&s.t===0;},mode);
    const expand=page.getByTestId('btn-expand-oscilloscope');if(await expand.isVisible())await expand.click();
    await page.waitForFunction(([a,b])=>document.querySelector('[data-testid="scope-channel-a"]')?.dataset.channelKey===a&&document.querySelector('[data-testid="scope-channel-b"]')?.dataset.channelKey===b,[a,b]);
    return read();
  };
  const runTo=async(t)=>{
    await play.click();await page.waitForFunction(t=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.wireRendered||'null')?.t>t,t,{timeout:18000});await play.click();
    await page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.wireRendered||'null'),t=Number(document.querySelector('[data-testid="wire-readouts"]')?.dataset.sampleTime),p=Number(document.querySelector('[data-testid="uplot-container"]')?.dataset.lastSampleT);return s&&Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;},null,{timeout:5000});return read();
  };
  const photo=async name=>page.screenshot({path:path.join(OUT_DIR,'H34_E05_'+name+'.png')});
  const initial=await select('wireframe-offgrid-flux','wireframe-gravity-fall','fluxWb','emfV');
  check(initial.centerY,.75,'initial y');check(initial.fluxWb,0,'outside flux');
  await page.getByTestId('wire-scope-empty').waitFor({state:'visible'});
  const offgrid=await runTo(.62),v=-Math.exp(-2*(offgrid.t-.25)),y=.5-(1+v)/2;
  check(offgrid.centerY,y,'analytic y');check(offgrid.vy,v,'analytic velocity');check(offgrid.fluxWb,2*(.5-y),'exact overlap flux');
  check(offgrid.emfV,2*v,'signed emf');check(offgrid.ampereForceN,-2*v,'magnetic drag');check(offgrid.jouleHeatJ,.5*(1-v*v),'independent Q');
  check(offgrid.eventCount,1,'entry event');await photo('offgrid');
  await select('dual-opposite-field-2x-emf','wireframe-gravity-fall','fluxWb','emfV');
  const dual=await runTo(1.4);
  if(dual.eventCount<2||dual.jouleHeatJ<=0||Math.abs(dual.energyResidualJ)>1e-5)throw Error('E05 dual crossing '+JSON.stringify(dual));await photo('dual');
  await select('triangle-loop-linear-emf','wireframe-gravity-fall','fluxWb','emfV');
  const triangle=await runTo(.45);if(triangle.loopShape!=='triangle'||Math.abs(triangle.energyResidualJ)>1e-5)throw Error('E05 triangle '+JSON.stringify(triangle));await photo('triangle');
  await select('circle-gradient-flux','wireframe-gravity-fall','fluxWb','emfV');
  const circle=await runTo(.45);if(circle.loopShape!=='circle'||circle.fieldProfile!=='linear-gradient'||Math.abs(circle.energyResidualJ)>1e-5)throw Error('E05 circle gradient '+JSON.stringify(circle));await photo('circle_gradient');
  const disk0=await select('disk-driven-power','faraday-disk','emfV','emTorqueNm');
  check(disk0.fluxWb,2*Math.PI,'actual disk flux');check(disk0.emfV,3,'disk emf');check(disk0.emTorqueNm,-1.5,'disk torque');check(disk0.drivePowerW,4.5,'drive power');
  if('ampereForceN'in disk0||await page.getByTestId('param-slider-massM').count())throw Error('E05 irrelevant rotating quantities');
  const disk=await runTo(.5);check(disk.fluxWb,2*Math.PI,'unchanged disk flux');check(disk.driveWorkJ,4.5*disk.t,'drive work');check(disk.jouleHeatJ,disk.driveWorkJ,'Joule heat');await photo('disk');
  const rev=await select('disk-reverse-drive','faraday-disk','emfV','emTorqueNm');check(rev.emfV,-3,'reverse emf');check(rev.emTorqueNm,1.5,'reverse torque');check(rev.drivePowerW,4.5,'reverse power');await photo('reverse');
  const rod=await select('rotating-rod-cutting','rotating-rod','emfV','emTorqueNm');if('fluxWb'in rod)throw Error('E05 invented rod flux');check(rod.emfV,3,'rod emf');await photo('rod');
  const report={initial,offgrid,dual,triangle,circle,disk0,disk,rev,rod};console.log('H34 E05 online '+JSON.stringify(report));return report;
}

async function auditE03AcScope(page,origin){
  const url=new URL(origin);url.searchParams.set('model','em-ac-field-oscilloscope');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='em-ac-field-oscilloscope');
  const canvas=page.getByTestId('simulation-canvas'),play=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]');
  const read=async()=>JSON.parse(await canvas.getAttribute('data-ac-rendered'));
  const check=(v,x,label,tol=1e-7)=>{if(!Number.isFinite(v)||Math.abs(v-x)>tol)throw Error('E03 '+label+' '+JSON.stringify({v,x}));};
  const select=async(id,mode,a,b)=>{
    await selectPreset(page,id,true);
    await page.waitForFunction(mode=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.acRendered||'null');return s?.mode===mode&&s.t===0;},mode);
    const expand=page.getByTestId('btn-expand-oscilloscope');if(await expand.isVisible())await expand.click();
    await page.waitForFunction(([a,b])=>document.querySelector('[data-testid="scope-channel-a"]')?.dataset.channelKey===a&&document.querySelector('[data-testid="scope-channel-b"]')?.dataset.channelKey===b,[a,b]);
    return read();
  };
  const sync=async()=>{
    await page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.acRendered||'null'),t=Number(document.querySelector('[data-testid="ac-readouts"]')?.dataset.sampleTime),p=Number(document.querySelector('[data-testid="uplot-container"]')?.dataset.lastSampleT);return s&&Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;},null,{timeout:5000});
    return read();
  };
  const runTo=async(t,beamStatus=null)=>{
    await play.click();
    await page.waitForFunction(([t,status])=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.acRendered||'null');return status===null?s?.t>t:s?.beamStatus===status;},[t,beamStatus],{timeout:18000});
    await play.click();return sync();
  };
  const photo=async name=>page.screenshot({path:path.join(OUT_DIR,'H33_E03_'+name+'.png')});
  const square=await select('square-wave-four-phases','ac-square-wave','x0','xQuarter');
  if('xQuarter'in square||await page.getByTestId('param-slider-uAccelV').count())throw Error('E03 inactive reading or irrelevant CRT slider');
  await page.getByTestId('ac-scope-empty').waitFor({state:'visible'});
  const motion=await runTo(2.5);
  // Independent hand-derived reference using current sampled time near the
  // quarter-phase return: in the positive half after t=2.5, v=4*(t-2.5).
  check(motion.xQuarter,2*(motion.t-2.5)**2,'quarter return',1e-6);
  check(motion.vQuarter,4*(motion.t-2.5),'quarter return velocity',1e-6);
  const n=Math.floor(motion.t/2),r=motion.t-2*n;
  check(motion.x0,4*n+2*r*r,'absolute displacement',1e-6);
  await photo('square');
  await page.getByRole('button',{name:'直尺',exact:true}).click();
  const acRuler=page.getByTestId('ruler-measurement');
  await acRuler.waitFor({state:'visible'});
  if(!(await acRuler.textContent()).includes('竖向示意'))throw Error('E03 ruler lane scale');
  await page.getByRole('button',{name:'直尺',exact:true}).click();
  const sine=await select('sine-wave-acceleration','ac-sine-wave','x0','xQuarter');
  const wave=await runTo(2.05),w=Math.PI;
  check(wave.x0,5/w*(wave.t-Math.sin(w*wave.t)/w),'sine primitive',1e-6);
  check(wave.v0,5/w*(1-Math.cos(w*wave.t)),'sine velocity',1e-6);await photo('sine');
  const crt=await select('oscilloscope-lissajous-2to1','oscilloscope-lissajous','screenXCm','screenYCm');
  check(crt.screenXCm,0,'actual initial X');check(crt.screenYCm,11/3,'actual initial Y');check(crt.trailCount,1,'initial hit sample');
  const beam=await runTo(1.65);
  check(beam.screenXCm,11/3*Math.sin(2*Math.PI*beam.t/1.6),'CRT X',1e-6);
  check(beam.screenYCm,11/3*Math.sin(4*Math.PI*beam.t/1.6+Math.PI/2),'CRT Y',1e-6);
  if(beam.trailCount<100)throw Error('E03 missing actual phosphor samples');await photo('crt');
  await page.getByRole('button',{name:'直尺',exact:true}).click();
  await acRuler.waitFor({state:'visible'});
  if(!(await acRuler.textContent()).includes('cm'))throw Error('E03 ruler physical CRT centimetres');
  await page.getByRole('button',{name:'直尺',exact:true}).click();
  const blocked=await select('crt-plate-contact','oscilloscope-lissajous','screenXCm','screenYCm');
  check(blocked.beamStatus,3,'Y plate contact');check(blocked.trailCount,0,'blocked trail');
  if('screenYCm'in blocked||await page.getByTestId('ac-screenYCm').count())throw Error('E03 fake blocked screen reading');await photo('blocked');
  const noBeam=await select('crt-no-acceleration','oscilloscope-lissajous','screenXCm','screenYCm');
  check(noBeam.beamStatus,1,'no acceleration');if('screenXCm'in noBeam)throw Error('E03 fictitious zero-U screen');await photo('no_beam');
  await select('crt-screen-miss','oscilloscope-lissajous','screenXCm','screenYCm');
  const miss=await runTo(0,5);if('screenXCm'in miss||'screenYCm'in miss)throw Error('E03 screen miss fake reading');await photo('screen_miss');
  const zero=await select('equivalent-gravity-zero','equivalent-gravity','eqThetaDeg','eqOmega');
  check(zero.gEffMag,0,'zero equivalent field');check(zero.rodForceN,0,'zero reaction');
  if('eqLowestAngleDeg'in zero)throw Error('E03 invented zero-field lowest point');
  const stationary=await runTo(.3);check(stationary.eqThetaDeg,35,'zero field stays static');await photo('zero_gravity');
  const compression=await select('equivalent-rod-compression','equivalent-gravity','eqThetaDeg','eqOmega');
  check(compression.rodForceN,-2.2,'signed rod compression');await photo('compression');
  const tilted=await select('equivalent-gravity-tilted','equivalent-gravity','eqThetaDeg','eqOmega');
  check(tilted.eqLowestAngleDeg,45,'equivalent lowest point');
  const swing=await runTo(.6);check(swing.eqTotalEnergy,tilted.eqTotalEnergy,'energy',1e-6);await photo('tilted');
  const report={square,motion,sine,wave,crt,beam,blocked,noBeam,miss,zero,stationary,compression,tilted,swing};console.log('H33 E03 online '+JSON.stringify(report));return report;
}

async function assertCapacitorLayout(page,offline=false){
  const selector=offline?'[data-testid="sf-canvas"]':'[data-testid="simulation-canvas"]';
  await page.waitForFunction(sel=>{const c=document.querySelector(sel);if(!c?.dataset.capacitorView)return false;
    const v=JSON.parse(c.dataset.capacitorView);return Math.abs(v.width-c.getBoundingClientRect().width)<3&&v.boxes.length>0;
  },selector);
  const result=await page.evaluate(({selector,offline})=>{
    const c=document.querySelector(selector),r=c.getBoundingClientRect(),v=JSON.parse(c.dataset.capacitorView);
    const visible=sel=>{const el=document.querySelector(sel);if(!el||!el.getClientRects().length)return null;const a=el.getBoundingClientRect();return {left:a.left-r.left,right:a.right-r.left,top:a.top-r.top,bottom:a.bottom-r.top};};
    const chrome=offline?[]:['[data-testid="right-control-panel"]','[data-testid="floating-scope-dock"]','[data-testid="fullscreen-formula"]','[data-testid="fullscreen-controls"]','[data-testid="fullscreen-title"]'].map(visible).filter(Boolean);
    const intersects=(a,b)=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;
    const errors=[];
    for(const b of v.boxes){
      if(b.left<0||b.right>r.width+1||b.top<0||b.bottom>r.height+1)errors.push('outside:'+b.id);
      for(const d of chrome)if(intersects(b,d))errors.push('chrome:'+b.id);
    }
    const ids=['top-potential','overlap','bottom-potential','field-label','gap','probe','drop','meter-title','mode'];
    const labels=v.boxes.filter(b=>ids.includes(b.id));
    for(let i=0;i<labels.length;i++){
      for(let j=i+1;j<labels.length;j++)if(intersects(labels[i],labels[j]))errors.push('labels:'+labels[i].id+'/'+labels[j].id);
      for(const b of v.boxes.filter(b=>['top-plate','bottom-plate','meter'].includes(b.id)))if(intersects(labels[i],b))errors.push('geometry:'+labels[i].id+'/'+b.id);
    }
    return {errors,view:v,chrome};
  },{selector,offline});
  if(result.errors.length)throw Error('E02 layout '+JSON.stringify(result));
  return result.view;
}
async function auditE02Capacitor(page,origin){
  const url=new URL(origin);url.searchParams.set('model','em-capacitor-millikan');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='em-capacitor-millikan');
  const canvas=page.getByTestId('simulation-canvas'),play=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]');
  const read=async()=>JSON.parse(await canvas.getAttribute('data-capacitor-rendered'));
  const check=(v,x,label,tol=1e-7)=>{if(!Number.isFinite(v)||Math.abs(v-x)>tol)throw Error('E02 '+label+' '+JSON.stringify({v,x}));};
  const select=async(id,mode,voltage,oil)=>{
    await selectPreset(page,id,true);
    await page.waitForFunction(([m,v,o])=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.capacitorRendered||'null');return s?.switchMode===m&&s.sourceVoltageU0===v&&s.oilDropEnabled===o&&s.t===0;},[mode,voltage,oil]);
    const expand=page.getByTestId('btn-expand-oscilloscope');if(await expand.isVisible())await expand.click();
    await page.waitForFunction(o=>document.querySelector('[data-testid="scope-channel-a"]')?.dataset.channelKey===(o?'dropHeightMm':'capacitancePF')&&document.querySelector('[data-testid="scope-channel-b"]')?.dataset.channelKey===(o?'dropVyMmS':'voltageV'),oil);
    return read();
  };
  const sync=async()=>{
    await page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.capacitorRendered||'null'),t=Number(document.querySelector('[data-testid="capacitor-readouts"]')?.dataset.sampleTime),p=Number(document.querySelector('[data-testid="uplot-container"]')?.dataset.lastSampleT);return s&&Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;},null,{timeout:5000});
    return read();
  };
  const runTo=async(t,terminal=false)=>{
    await play.click();
    await page.waitForFunction(([t,terminal])=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.capacitorRendered||'null');return terminal?s?.terminal===1:s?.t>t;},[t,terminal],{timeout:15000});
    if(!terminal)await play.click();
    return sync();
  };
  const photo=async(name)=>{await assertCapacitorLayout(page);return page.screenshot({path:path.join(OUT_DIR,'H31_E02_'+name+'.png')});};
  const open=await select('capacitor-reference-double-gap','open-const-q',200,false);
  check(open.capacitancePF,8.8541878128,'C at double gap');
  check(open.chargeNC,3.54167512512,'reference Q');check(open.voltageV,400,'U at double gap');
  check(open.fieldEy,-10000,'signed field');check(open.phiPV,100,'bottom gauge');
  if('dropVyMmS'in open)throw Error('E02 invisible oil drop observable');
  await page.getByTestId('capacitor-scope-empty').waitFor({state:'visible'});
  await photo('open_double_gap');
  await page.getByRole('button',{name:'直尺',exact:true}).click();
  const capRuler=page.getByTestId('ruler-measurement');await capRuler.waitFor({state:'visible'});
  if(!(await capRuler.textContent()).includes('mm · 横向示意'))throw Error('E02 ruler physical vertical scale');
  const capHandle=page.getByTestId('ruler-handle-1'),box=await capHandle.boundingBox();
  if(!box)throw Error('E02 ruler handle missing');
  const prior=await capRuler.textContent();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2+28,{steps:6});await page.mouse.up();
  await page.waitForFunction(prior=>document.querySelector('[data-testid="ruler-measurement"]')?.textContent!==prior,prior);
  const moved=await capRuler.textContent();
  if(!moved.includes('Δy=-')||!moved.includes('mm · 横向示意'))throw Error('E02 ruler drag physical delta '+moved);
  await photo('ruler_mm');
  await page.getByRole('button',{name:'直尺',exact:true}).click();
  await page.getByTestId('ruler-toolbox-overlay').waitFor({state:'detached'});
  const openRun=await runTo(.2);check(openRun.chargeNC,open.chargeNC,'constant Q while running');
  const top=await select('top-plate-grounded-potential','open-const-q',200,false);
  check(top.phiTopV,0,'top grounded');check(top.phiPV,-168,'top gauge');await photo('top_grounded');
  const closed=await select('closed-switch-const-u','closed-const-u',200,false);
  check(closed.capacitancePF,8.8541878128e-12*2.5*.85*.04/.016*1e12,'closed C');
  check(closed.voltageV,200,'closed U');check(closed.fieldEy,-12500,'closed E');
  if(await page.getByTestId('param-slider-refDistanceMm').count())throw Error('E02 irrelevant reference controls');
  await photo('closed');
  const reversed=await select('capacitor-reversed-polarity','closed-const-u',-200,false);
  check(reversed.fieldEy,10000,'reversed E');check(reversed.phiPV,-80,'reversed probe');
  if(reversed.chargeNC>=0)throw Error('E02 reversed plate charge');
  await photo('reverse');
  const balance=await select('millikan-oil-drop-balance','closed-const-u',200,true);
  check(balance.dropChargeC,-2*1.602176634e-19,'elementary charge',1e-30);
  check(balance.dropMassKg,2*1.602176634e-19*10000/9.8,'mass',1e-28);
  const balanced=await runTo(.4);check(balanced.dropHeightMm,10,'suspended height');check(balanced.dropVyMmS,0,'suspended speed');check(balanced.dropAcceleration,0,'suspended a');
  await photo('balance');
  await select('millikan-free-fall','closed-const-u',0,true);
  const fall=await runTo(0,true),tc=Math.sqrt(.02/9.8);
  check(fall.t,tc,'free fall time');check(fall.dropHeightMm,0,'bottom touch');check(fall.dropVyMmS,-9.8*tc*1000,'pre-impact velocity');check(fall.dropContact,-1,'bottom contact');
  await page.getByTestId('btn-step').click();check((await read()).t,fall.t,'terminal freeze');
  await photo('fall');
  await select('millikan-rise-contact','closed-const-u',400,true);
  const rise=await runTo(0,true);
  check(rise.t,tc,'rise time');check(rise.dropHeightMm,20,'top touch');check(rise.dropVyMmS,9.8*tc*1000,'upward pre-impact speed');check(rise.dropContact,1,'top contact');
  await photo('rise');
  await select('capacitor-reversed-polarity','closed-const-u',-200,false);
  await page.setViewportSize({width:1024,height:768});
  await page.waitForTimeout(250);
  await photo('compact_reverse');
  await page.getByTestId('param-slider-distanceMm').fill('40');
  await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.capacitorRendered||'null')?.distanceMm===40);
  await photo('compact_max_gap_min_overlap');
  await page.getByTestId('btn-toggle-oscilloscope').click();
  await page.waitForTimeout(180);await photo('compact_scope_closed');
  const before=await assertCapacitorLayout(page),bb=await canvas.boundingBox();
  await page.mouse.move(bb.x+bb.width*.36,bb.y+bb.height*.42);await page.mouse.wheel(0,-100);
  await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.capacitorView||'null')?.automatic===false);
  const manual=JSON.parse(await canvas.getAttribute('data-capacitor-view'));
  if(!(manual.scale>before.scale))throw Error('E02 manual zoom not retained');
  await page.getByTestId('param-slider-distanceMm').fill('8');
  await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.capacitorRendered||'null')?.distanceMm===8);
  const after=JSON.parse(await canvas.getAttribute('data-capacitor-view'));
  if(after.automatic||after.scale!==manual.scale||after.offsetX!==manual.offsetX||after.offsetY!==manual.offsetY)throw Error('E02 manual camera overwritten');
  await page.getByTestId('btn-reset-view').click();
  await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.capacitorView||'null')?.automatic===true);
  await photo('compact_min_gap');
  const was=await page.evaluate(()=>document.documentElement.getAttribute('data-theme'));
  if(was!=='projector'){
    if(!await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
    await page.getByTestId('btn-theme').click();
    await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
    if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
  }
  await photo('compact_projector');
  await page.getByTestId('btn-fullscreen-speech').click();await page.waitForSelector('[data-testid="fullscreen-controls"]');
  await page.waitForTimeout(250);await photo('compact_fullscreen_projector');
  await page.getByTestId('btn-exit-fullscreen-speech').click();
  if(was!=='projector'){
    if(!await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
    await page.getByTestId('btn-theme').click();
    if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
  }
  await page.setViewportSize(VIEWPORT);await page.waitForTimeout(200);
  const expand=page.getByTestId('btn-expand-oscilloscope');if(await expand.isVisible())await expand.click();
  const report={open,openRun,top,closed,reversed,balance,balanced,fall,rise};
  console.log('H31 E02 online '+JSON.stringify(report));return report;
}

async function auditE01Electrostatic(page,origin){
  const url=new URL(origin);url.searchParams.set('model','em-electrostatic-field');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='em-electrostatic-field');
  const canvas=page.getByTestId('simulation-canvas'),play=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]');
  const read=async()=>JSON.parse(await canvas.getAttribute('data-electro-rendered'));
  const check=(v,x,label,tol=1e-7)=>{if(!Number.isFinite(v)||Math.abs(v-x)>tol)throw Error('E01 '+label+' '+JSON.stringify({v,x}));};
  const select=async(id,mode,key,value,a,b)=>{
    await selectPreset(page,id,true);
    await page.waitForFunction(([m,k,v])=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.electroRendered||'null');return s?.mode===m&&s[k]===v&&s.t===0;},[mode,key,value]);
    const expand=page.getByTestId('btn-expand-oscilloscope');if(await expand.isVisible())await expand.click();
    await page.waitForFunction(([a,b])=>document.querySelector('[data-testid="scope-channel-a"]')?.dataset.channelKey===a&&document.querySelector('[data-testid="scope-channel-b"]')?.dataset.channelKey===b,[a,b]);
    return read();
  };
  const sync=async()=>{
    await page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.electroRendered||'null'),t=Number(document.querySelector('[data-testid="electro-readouts"]')?.dataset.sampleTime),p=Number(document.querySelector('[data-testid="uplot-container"]')?.dataset.lastSampleT);return s&&Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;},null,{timeout:5000});
    return read();
  };
  const runTo=async(t,terminal=false)=>{
    await play.click();
    await page.waitForFunction(([t,terminal])=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.electroRendered||'null');return terminal?s?.terminal===1:s?.t>t;},[t,terminal],{timeout:15000});
    if(!terminal)await play.click();
    return sync();
  };
  const photo=async(name)=>page.screenshot({path:path.join(OUT_DIR,'H30_E01_'+name+'.png')});
  await select('dipole-opposite-charges','dipole-point-charges','q2MicroC',-3,'phi','eMag');
  await page.getByTestId('electro-scope-empty').waitFor({state:'visible'});
  if(await page.getByTestId('param-slider-uAccelV').count())throw Error('E01 irrelevant tube control');
  const dipole=await runTo(.25);check(dipole.energyResidual,0,'dipole energy',1e-5);
  await photo('dipole');
  const verifyLab=async(unitKey,unit,absent)=>{
    if(!await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
    await page.getByTestId('btn-analysis-lab-menu').click();
    const lab=page.getByTestId('analysis-lab-drawer');await lab.waitFor({state:'visible'});
    const options=lab.locator('select').first().locator('option');
    const labels=await options.evaluateAll(nodes=>nodes.map(o=>({key:o.value,label:o.textContent??''})));
    if(!labels.some(o=>o.key===unitKey&&o.label.includes(unit))||labels.some(o=>o.key===absent))throw Error('E01 analysis lab channels '+JSON.stringify(labels));
    await page.getByTestId('btn-close-analysis-lab').click();
    if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
  };
  await verifyLab('phi','Φ₀','tubeWork');
  await select('equal-same-sign-charges','dipole-point-charges','q2MicroC',3,'phi','eMag');
  const same=await runTo(.25);check(same.energyResidual,0,'like charge energy',1e-5);await photo('same');
  const uniform=await select('uniform-three-point-trisection','uniform-three-point','phiB',4,'phi','eMag');
  check(uniform.constructionDefined,1,'three points construction');check(uniform.constructionFraction,1/3,'original trisection');
  await photo('uniform');
  const reordered=await select('uniform-reordered-potential','uniform-three-point','phiA',4,'phi','eMag');
  check(reordered.constructionStartX,-1.4,'middle vertex A');check(reordered.constructionStartY,-.9,'middle vertex A y');
  check(reordered.constructionEndX,1.5+(0.2-1.5)/3,'C-B interpolation');check(reordered.constructionEndY,-.7+(1.1+.7)/3,'C-B interpolation y');
  check(reordered.Ex*(reordered.constructionEndX-reordered.constructionStartX)+reordered.Ey*(reordered.constructionEndY-reordered.constructionStartY),0,'orthogonal');
  await photo('reordered');
  const zero=await select('uniform-equal-potential','uniform-three-point','phiC',4,'phi','eMag');
  check(zero.eMag,0,'zero field');check(zero.constructionDefined,0,'no arbitrary line');await photo('zero_field');
  const p0=await select('deflection-capacitor-tube','deflection-tube','testChargeRatio',1,'py','vy');
  if(await page.getByTestId('param-slider-q1MicroC').count()||!await page.getByTestId('param-slider-uAccelV').count())throw Error('E01 tube mode fields');
  const exit=await runTo(.55);check(exit.yExit,.25,'positive signed exit');check(exit.tubePhase,2,'out of plates');check(exit.ek-exit.tubeWork,p0.ek,'work energy');
  if('totalEnergy'in exit)throw Error('E01 fictitious conservative tube energy');await photo('exit');
  await verifyLab('py','m','totalEnergy');
  await select('deflection-negative-charge','deflection-tube','testChargeRatio',-1,'py','vy');
  const negative=await runTo(.55);check(negative.yExit,-.25,'negative signed exit');await photo('negative');
  await select('deflection-plate-contact','deflection-tube','uDeflectV',16,'py','vy');
  const contact=await runTo(0,true),thit=.4/4+Math.sqrt(2/16);
  check(contact.t,thit,'first contact time');check(contact.py,1,'first contact point');check(contact.px,-1+4*Math.sqrt(2/16),'first contact x');check(contact.energyResidual,0,'contact work');
  if('yExit'in contact)throw Error('E01 contact invented exit');await photo('contact');
  await select('deflection-neutral','deflection-tube','testChargeRatio',0,'py','vy');
  const neutral=await runTo(.3);check(neutral.vx,0,'zero charge speed');check(neutral.px,-1.4,'neutral stationary');check(neutral.py,0,'neutral y');await photo('neutral');
  const report={dipole,same,uniform,reordered,zero,exit,negative,contact,neutral};console.log('H30 E01 online '+JSON.stringify(report));return report;
}

async function auditM11Shm(page,origin){
  const url=new URL(origin);url.searchParams.set('model','mech-shm-resonance');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='mech-shm-resonance');
  const canvas=page.getByTestId('simulation-canvas'),play=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]');
  const read=async()=>JSON.parse(await canvas.getAttribute('data-shm-rendered'));
  const check=(v,x,label,tol=1e-7)=>{if(!Number.isFinite(v)||Math.abs(v-x)>tol)throw Error('M11 '+label+' '+JSON.stringify({v,x}));};
  const select=async(id,mode,angle,first,second)=>{
    await selectPreset(page,id,true);
    await page.waitForFunction(([m,a])=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.shmRendered||'null');return s?.mode===m&&s.initialAngleDeg===a&&s.t===0;},[mode,angle]);
    const expand=page.getByTestId('btn-expand-oscilloscope');if(await expand.isVisible())await expand.click();
    await page.waitForFunction(([a,b])=>document.querySelector('[data-testid="scope-channel-a"]')?.dataset.channelKey===a&&document.querySelector('[data-testid="scope-channel-b"]')?.dataset.channelKey===b,[first,second]);
    return read();
  };
  const runTo=async(t)=>{
    await play.click();await page.waitForFunction(t=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.shmRendered||'null')?.t>t,t,{timeout:15000});await play.click();
    await page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.shmRendered||'null'),t=Number(document.querySelector('[data-testid="shm-readouts"]')?.dataset.sampleTime),p=Number(document.querySelector('[data-testid="uplot-container"]')?.dataset.lastSampleT);return s&&Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;},null,{timeout:5000});
    return read();
  };
  const phase=s=>{const A=s.lengthL*s.initialAngleDeg*Math.PI/180,w=Math.sqrt(s.gravityG/s.lengthL);check(s.referenceCircleRadius,A,'radius');check(s.referenceCircleX,A*Math.cos(w*s.t),'phase X');check(s.referenceCircleY,A*Math.sin(w*s.t),'phase Y');check(s.energyResidual,0,'energy');};
  const small0=await select('small-angle-pendulum-reference','pendulum-compare',2,'thetaRad','thetaLinearRad');
  await page.getByTestId('shm-scope-empty').waitFor({state:'visible'});
  if(await page.getByTestId('param-slider-driveOmega').count()||await page.getByTestId('param-slider-dampingGamma').count())throw Error('M11 comparison fields');
  const small=await runTo(.45);phase(small);
  await page.screenshot({path:path.join(OUT_DIR,'H29_M11_small.png')});
  const large0=await select('large-angle-nonisochronous','pendulum-compare',60,'thetaRad','thetaLinearRad');
  const large=await runTo(1.5);phase(large);
  if(Math.abs(large.thetaRad-large.thetaLinearRad)<.01)throw Error('M11 nonlinear vs linear states not distinguishable');
  await page.screenshot({path:path.join(OUT_DIR,'H29_M11_large_phase.png')});
  const damped0=await select('damped-phase-spiral','damped-free',45,'mechanicalEnergy','heatLostJ');
  const damped=await runTo(.9);check(damped.mechanicalEnergy+damped.heatLostJ,damped0.mechanicalEnergy,'damped balance');check(damped.driveWorkJ,0,'unforced work');
  if(!(damped.heatLostJ>0)||'referenceCircleX' in damped)throw Error('M11 damped energy or circle');
  await page.screenshot({path:path.join(OUT_DIR,'H29_M11_damped.png')});
  const forced0=await select('forced-resonance-peak','forced-resonance',2,'mechanicalEnergy','driveWorkJ');
  if(!await page.getByTestId('param-slider-driveOmega').count())throw Error('M11 drive field');
  const forced=await runTo(1);check(forced.mechanicalEnergy+forced.heatLostJ-forced.driveWorkJ,forced0.mechanicalEnergy,'driven balance');
  check(forced.linearResponseAmplitude,forced.driveAccelAmp/Math.hypot(forced.w0**2-forced.driveOmega**2,2*forced.dampingGamma*forced.driveOmega),'linear response');
  if(!(forced.heatLostJ>0))throw Error('M11 forced dissipation');
  await page.screenshot({path:path.join(OUT_DIR,'H29_M11_forced.png')});
  await select('zero-angle-equilibrium','pendulum-compare',0,'thetaRad','thetaLinearRad');
  const zero=await runTo(.35);phase(zero);check(zero.thetaRad,0,'equilibrium');check(zero.omega,0,'zero velocity');check(zero.measuredPeriod,0,'no crossings');
  await page.screenshot({path:path.join(OUT_DIR,'H29_M11_zero.png')});
  await select('undamped-resonance','forced-resonance',0,'mechanicalEnergy','driveWorkJ');
  const undamped=await runTo(.7);check(undamped.linearResponseDefined,0,'singularity');check(undamped.heatLostJ,0,'zero dissipation');check(undamped.mechanicalEnergy-undamped.driveWorkJ,0,'undamped work');
  if('linearResponseAmplitude' in undamped)throw Error('M11 fabricated singular amplitude');
  await page.getByTestId('shm-unbounded').waitFor({state:'visible'});
  const theme=await page.evaluate(()=>document.documentElement.getAttribute('data-theme'));
  if(theme!=='projector'){if(!await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');}
  if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
  await page.screenshot({path:path.join(OUT_DIR,'H29_M11_undamped_paper.png')});
  if(theme!=='projector'){if(!await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();}
  const report={small0,small,large0,large,damped0,damped,forced0,forced,zero,undamped};console.log('H29 M11 online '+JSON.stringify(report));return report;
}

async function auditM09Collision(page,origin){
  const url=new URL(origin);url.searchParams.set('model','mech-collision-recoil');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='mech-collision-recoil');
  const canvas=page.getByTestId('simulation-canvas'),play=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]');
  const read=async()=>JSON.parse(await canvas.getAttribute('data-collision-rendered'));
  const check=(v,x,label,tol=1e-8)=>{if(!Number.isFinite(v)||Math.abs(v-x)>tol)throw Error('M09 '+label+' '+JSON.stringify({v,x}));};
  const select=async(id,mode,key,value,first,second)=>{
    await selectPreset(page,id,true);
    await page.waitForFunction(([m,k,v])=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.collisionRendered||'null');return s?.mode===m&&s?.[k]===v&&s.t===0;},[mode,key,value]);
    const expand=page.getByTestId('btn-expand-oscilloscope');if(await expand.isVisible())await expand.click();
    await page.waitForFunction(([a,b])=>document.querySelector('[data-testid="scope-channel-a"]')?.dataset.channelKey===a&&document.querySelector('[data-testid="scope-channel-b"]')?.dataset.channelKey===b,[first,second]);
  };
  const sync=async()=>{
    await page.waitForFunction(()=>{
      const d=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.collisionRendered||'null'),t=Number(document.querySelector('[data-testid="collision-readouts"]')?.dataset.sampleTime),p=Number(document.querySelector('[data-testid="uplot-container"]')?.dataset.lastSampleT);
      return d&&Math.abs(d.t-t)<1e-10&&Math.abs(d.t-p)<1e-10;
    },null,{timeout:5000});return read();
  };
  const runTo=async(t)=>{
    await play.click();await page.waitForFunction(t=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.collisionRendered||'null')?.t>t,t,{timeout:15000});await play.click();return sync();
  };
  await select('oblique-equal-mass-elastic','collision-2d-oblique','impactParamB',.36,'px','py');
  await page.getByTestId('collision-scope-empty').waitFor({state:'visible'});
  const init=await read();check(init.y1,.36,'actual aiming offset');check(init.yCm,.18,'true initial CM y');
  if(await page.getByTestId('floating-scope-dock').getAttribute('data-scope-units')!=='shared')throw Error('M09 momentum axes');
  await page.screenshot({path:path.join(OUT_DIR,'H28_M09_oblique_initial.png')});
  const hit=await runTo(.75);check(hit.impactTime,.53,'oblique hit');check(hit.vx1,1.44,'vx1');check(hit.vy1,1.92,'vy1');check(hit.vx2,2.56,'vx2');check(hit.vy2,-1.92,'vy2');check(hit.yCm,.18,'CM y');check(hit.vDotProduct,0,'orthogonal nonzero velocities');check(hit.energyResidual,0,'elastic energy');
  await page.screenshot({path:path.join(OUT_DIR,'H28_M09_oblique_hit.png')});
  await select('oblique-miss','collision-2d-oblique','impactParamB',.66,'px','py');
  const miss=await runTo(.85);check(miss.collided,0,'actual miss');check(miss.y1,.66,'no clamp');check(miss.vx1,4,'unchanged velocity');
  await page.screenshot({path:path.join(OUT_DIR,'H28_M09_miss.png')});
  await select('oblique-grazing','collision-2d-oblique','impactParamB',.6,'px','py');
  const grazing=await runTo(.85);check(grazing.collided,0,'zero impulse grazing');check(grazing.vx1,4,'grazing velocity');
  await page.screenshot({path:path.join(OUT_DIR,'H28_M09_grazing.png')});
  await select('bullet-hits-block','bullet-block','blockLength',1.8,'penetrationDist','heatLostJ');
  if(await page.getByTestId('param-slider-impactParamB').count()||!await page.getByTestId('param-slider-dragForceF').count())throw Error('M09 bullet mode fields');
  const embedded=await runTo(.8);check(embedded.phase,2,'common velocity');check(embedded.penetrationDist,1.28,'actual penetration');check(embedded.heatLostJ,12.8,'heat');check(embedded.relativeSpeed,0,'common speed');check(embedded.energyResidual,0,'energy');
  await page.screenshot({path:path.join(OUT_DIR,'H28_M09_block_common.png')});
  await select('bullet-exit','bullet-block','blockLength',1,'penetrationDist','heatLostJ');
  const exit=await runTo(.6);check(exit.phase,3,'first exit');check(exit.entryTime,.2375,'entry');check(exit.phaseEndTime,.2375+2/(8+Math.sqrt(14)),'exit time');check(exit.penetrationDist,1,'depth');check(exit.heatLostJ,10,'heat');check(exit.relativeSpeed,Math.sqrt(14),'exit relative speed');check(exit.energyResidual,0,'exit energy');
  await page.screenshot({path:path.join(OUT_DIR,'H28_M09_block_exit.png')});
  await select('boat-person-recoil','boat-recoil','v10',2,'relativePosition','relativeSpeed');
  if(await page.getByTestId('param-slider-dragForceF').count()||!await page.getByTestId('param-slider-blockLength').count())throw Error('M09 boat mode fields');
  if(await page.getByTestId('floating-scope-dock').getAttribute('data-scope-units')!=='separate')throw Error('M09 boat independent axes');
  const boat=await runTo(1.1),u=boat.t/2.7;
  check(boat.relativePosition,-1.35+2.7*(u-Math.sin(2*Math.PI*u)/(2*Math.PI)),'smooth relative motion');check(boat.relativeSpeed,2*Math.sin(Math.PI*u)**2,'smooth relative speed');check(boat.xCm,-.3375,'fixed CM');check(boat.px,0,'zero total momentum');
  await page.screenshot({path:path.join(OUT_DIR,'H28_M09_boat_walk.png')});
  const done=await runTo(2.85);check(done.phase,2,'boat finished');check(done.relativePosition,1.35,'span');check(done.relativeSpeed,0,'smooth stop');check(done.xCm,-.3375,'fixed CM after walk');
  const theme=await page.evaluate(()=>document.documentElement.getAttribute('data-theme'));
  if(theme!=='projector'){if(!await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');}
  if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
  await page.screenshot({path:path.join(OUT_DIR,'H28_M09_boat_stop_paper.png')});
  if(theme!=='projector'){if(!await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();}
  await select('boat-zero-speed','boat-recoil','v10',0,'relativePosition','relativeSpeed');
  const rest=await runTo(.35);check(rest.x1,-1.35,'zero walk x1');check(rest.x2,0,'zero walk x2');check(rest.relativeSpeed,0,'zero walk speed');if('walkDuration'in rest)throw Error('M09 fictitious duration at zero speed');
  await page.screenshot({path:path.join(OUT_DIR,'H28_M09_boat_rest.png')});
  const report={init,hit,miss,grazing,embedded,exit,boat,done,rest};console.log('H28 M09 online '+JSON.stringify(report));return report;
}

async function auditM08Spring(page,origin){
  const url=new URL(origin);url.searchParams.set('model','mech-spring-separation');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='mech-spring-separation');
  const canvas=page.getByTestId('simulation-canvas'),play=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]'),plot=page.getByTestId('uplot-container');
  const read=async()=>JSON.parse(await canvas.getAttribute('data-spring-rendered'));
  const check=(v,x,label,tol=1e-8)=>{if(!Number.isFinite(v)||Math.abs(v-x)>tol)throw Error('M08 '+label+' '+JSON.stringify({v,x}));};
  const select=async(id,comp,force)=>{
    await selectPreset(page,id,true);
    await page.waitForFunction(([c,f])=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.springRendered||'null');return s?.initialComp===c&&s.externalForce===f&&s.t===0;},[comp,force]);
    const expand=page.getByTestId('btn-expand-oscilloscope');if(await expand.isVisible())await expand.click();
    await page.waitForFunction(()=>document.querySelector('[data-testid="scope-channel-a"]')?.dataset.channelKey==='normalForceN'&&document.querySelector('[data-testid="scope-channel-b"]')?.dataset.channelKey==='a1');
  };
  const sync=async()=>{
    await page.waitForFunction(()=>{
      const d=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.springRendered||'null'),t=Number(document.querySelector('[data-testid="spring-readouts"]')?.dataset.sampleTime),p=Number(document.querySelector('[data-testid="uplot-container"]')?.dataset.lastSampleT);
      return d&&Math.abs(d.t-t)<1e-10&&Math.abs(d.t-p)<1e-10;
    },null,{timeout:5000});return read();
  };
  const runTo=async(t)=>{
    await play.click();await page.waitForFunction(t=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.springRendered||'null')?.t>t,t,{timeout:15000});
    await play.click();return sync();
  };
  await select('horizontal-natural-length-sep',1,0);
  await page.getByTestId('spring-scope-empty').waitFor({state:'visible'});
  const init=await read();check(init.normalForceN,20,'initial contact');check(init.a1,10,'common a1');check(init.a2,10,'common a2');
  if(await page.getByTestId('floating-scope-dock').getAttribute('data-scope-units')!=='separate')throw Error('M08 independent N/acceleration axes');
  await page.screenshot({path:path.join(OUT_DIR,'H27_M08_horizontal_initial.png')});
  await page.getByTestId('btn-step').click();await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.springRendered||'null')?.t>0);
  const step=await sync();check(step.t,1/60,'single step',1e-10);check(step.s1,-Math.cos(Math.sqrt(10)*step.t),'analytic coupled');check(step.gap,0,'contact gap');
  const mid=await runTo(.68);check(mid.separationTime,Math.PI/(2*Math.sqrt(10)),'horizontal separation');check(mid.separationS,0,'natural length');check(mid.a2,0,'free second mass');check(mid.normalForceN,0,'free N');check(mid.energyResidual,0,'energy');
  await page.screenshot({path:path.join(OUT_DIR,'H27_M08_horizontal_separated.png')});
  await select('spring-zero-tangent',.98,0);
  const tangent=await runTo(1.12);if(tangent.separated||tangent.gap!==0||tangent.normalForceN<0)throw Error('M08 zero tangency '+JSON.stringify(tangent));
  await page.screenshot({path:path.join(OUT_DIR,'H27_M08_zero_tangent.png')});
  await select('spring-initial-release',.4,30);
  const immediate=await read();check(immediate.separated,1,'initial release');check(immediate.separationTime,0,'initial event');check(immediate.normalForceN,0,'initial force');
  const open=await runTo(.22);if(open.gap<=0)throw Error('M08 failed to open initial contact');
  check(open.energyResidual,0,'work ledger');
  await page.screenshot({path:path.join(OUT_DIR,'H27_M08_initial_release.png')});
  await select('external-pull-early-sep',1,12);
  const early=await runTo(.65);check(early.separationTime,Math.acos(3/7)/Math.sqrt(10),'early time');check(early.separationS,-.2,'compressed release');check(early.externalWork,12*(early.s2+1),'external work');check(early.energyResidual,0,'work residual');
  await page.screenshot({path:path.join(OUT_DIR,'H27_M08_early_pull.png')});
  await select('spring-recontact',1.2,0);
  const incline=await runTo(.95);check(incline.separationTime,.7375949353217733,'incline separation');check(incline.normalForceN,0,'incline free N');if(incline.gap<=0)throw Error('M08 incline gap');
  await page.screenshot({path:path.join(OUT_DIR,'H27_M08_incline_free.png')});
  await play.click();
  await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.springRendered||'null')?.terminal===1,null,{timeout:15000});
  await page.waitForFunction(()=>document.querySelector('[data-testid="topbar"] [data-testid="btn-play-pause"]')?.getAttribute('aria-label')==='运行');
  const edge=await sync();check(edge.t,1.6103797957876382,'recontact time');check(edge.gap,0,'nonpenetration',1e-9);check(edge.relativeVelocity,-3.6548648049950065,'impact relative speed');check(edge.energyResidual,0,'impact energy before collision');
  await page.getByTestId('btn-step').click();await page.evaluate(()=>new Promise(requestAnimationFrame));check((await read()).t,edge.t,'terminal single step',1e-10);
  await page.screenshot({path:path.join(OUT_DIR,'H27_M08_recontact.png')});
  const theme=await page.evaluate(()=>document.documentElement.getAttribute('data-theme'));
  if(theme!=='projector'){if(!await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');}
  if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
  await page.screenshot({path:path.join(OUT_DIR,'H27_M08_recontact_paper.png')});
  if(theme!=='projector'){if(!await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();if(await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();}
  const report={init,step,mid,tangent,immediate,open,early,incline,edge};console.log('H27 M08 online '+JSON.stringify(report));return report;
}

async function auditM07Turntable(page,origin){
  const url=new URL(origin);url.searchParams.set('model','mech-conical-turntable');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='mech-conical-turntable');
  const canvas=page.getByTestId('simulation-canvas'),play=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]'),plot=page.getByTestId('uplot-container');
  const read=async()=>JSON.parse(await canvas.getAttribute('data-turntable-rendered'));
  const check=(v,x,label,tol=1e-7)=>{if(!Number.isFinite(v)||Math.abs(v-x)>tol)throw Error('M07 '+label+' '+JSON.stringify({v,x}));};
  const select=async(id,mode)=>{
    await selectPreset(page,id,true);
    await page.waitForFunction(m=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.turntableRendered||'null');return s?.mode===m&&s.t===0;},mode);
    const expand=page.getByTestId('btn-expand-oscilloscope');if(await expand.isVisible())await expand.click();
    await page.waitForFunction(m=>document.querySelector('[data-testid="scope-channel-a"]')?.dataset.channelKey==='tensionN'&&document.querySelector('[data-testid="scope-channel-b"]')?.dataset.channelKey===(m==='turntable-dual'?'frictionAN':'coneAngleDeg'),mode);
  };
  const sync=async()=>{
    await page.waitForFunction(()=>{
      const d=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.turntableRendered||'null'),t=Number(document.querySelector('[data-testid="turntable-readouts"]')?.dataset.sampleTime),p=Number(document.querySelector('[data-testid="uplot-container"]')?.dataset.lastSampleT);
      return d&&Math.abs(d.t-t)<1e-10&&Math.abs(d.t-p)<1e-10;
    },null,{timeout:5000});
    return read();
  };
  await select('turntable-friction-flip','turntable-dual');
  await page.getByTestId('turntable-scope-empty').waitFor({state:'visible'});
  const stat=await read();check(stat.tensionN,2.79,'static T');check(stat.frictionAN,-1.056,'static fA');check(stat.frictionBN,5.88,'static fB');
  check(stat.omega1,1.4,'omega1');check(stat.omega2,Math.sqrt(5.88/2.4),'omega2');check(stat.omega3,Math.sqrt(8.82/2.4),'omega3');
  await page.screenshot({path:path.join(OUT_DIR,'H26_M07_static_flip.png')});
  await select('turntable-a-dominant','turntable-dual');const rev=await read();
  if(!(rev.frictionBN<0&&rev.frictionAN>0&&rev.slippingOut===0))throw Error('M07 A-dominant branch '+JSON.stringify(rev));
  await page.screenshot({path:path.join(OUT_DIR,'H26_M07_A_dominant.png')});
  await select('turntable-balanced','turntable-dual');const balanced=await read();
  if('omega3' in balanced||'omega2' in balanced||balanced.slippingOut!==0)throw Error('M07 fictitious balanced threshold');
  if(!(await page.getByTestId('turntable-omega3').innerText()).includes('不存在'))throw Error('M07 balanced label');
  await page.screenshot({path:path.join(OUT_DIR,'H26_M07_balanced.png')});
  await select('turntable-breakout','turntable-dual');
  await play.click();await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.turntableRendered||'null')?.t>.45);
  await play.click();const mid=await sync();
  check(mid.actualSeparation,2.1,'actual string',1e-10);check(mid.energyResidual,0,'energy ledger',1e-6);
  if(mid.heat<=0||mid.slippingOut!==1)throw Error('M07 no real slip '+JSON.stringify(mid));
  await page.screenshot({path:path.join(OUT_DIR,'H26_M07_sliding.png')});
  await play.click();await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.turntableRendered||'null')?.terminal===1,null,{timeout:15000});
  await page.waitForFunction(()=>document.querySelector('[data-testid="topbar"] [data-testid="btn-play-pause"]')?.getAttribute('aria-label')==='运行');
  const edge=await sync();check(edge.t,1.03331744326271,'first edge time');check(edge.rA,2.6,'fixed disk edge');check(edge.rB,2.5757195066690546,'other radius');check(edge.actualSeparation,2.1,'edge string',1e-10);check(edge.heat,25.779116693071362,'heat',1e-5);check(edge.diskWork,31.11955606419061,'disk work',1e-5);
  await page.getByTestId('btn-step').click();await page.evaluate(()=>new Promise(requestAnimationFrame));check((await read()).t,edge.t,'terminal step',1e-10);
  await page.screenshot({path:path.join(OUT_DIR,'H26_M07_edge.png')});
  await select('conical-pendulum-steady','conical-pendulum');
  const cone=await read();check(cone.tensionN,19.44,'true cone T');check(cone.coneTensionY,9.8,'true vertical tension');
  if(await page.getByTestId('param-slider-radiusB').count()||!await page.getByTestId('param-slider-pendulumLength').count())throw Error('M07 mode fields');
  await play.click();await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.turntableRendered||'null')?.t>.38);await play.click();const rotated=await sync();
  check(rotated.xA,rotated.rA*Math.cos(3.6*rotated.t),'side projection');check(rotated.coneTensionY,9.8,'vertical tension in motion');
  if(await page.getByTestId('floating-scope-dock').getAttribute('data-scope-units')!=='separate'||!await plot.isVisible())throw Error('M07 independent cone axes');
  await page.screenshot({path:path.join(OUT_DIR,'H26_M07_cone_linked.png')});
  const theme=await page.evaluate(()=>document.documentElement.getAttribute('data-theme'));
  if(theme!=='projector'){if(!await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');}
  await page.screenshot({path:path.join(OUT_DIR,'H26_M07_cone_paper.png')});
  if(theme!=='projector'){if(!await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();await page.getByTestId('btn-theme').click();}
  await select('conical-pendulum-rest','conical-pendulum');const rest=await read();check(rest.rA,0,'rest radius');check(rest.tensionN,9.8,'rest tension');if('period' in rest||rest.rotatingCone!==0)throw Error('M07 fictitious stationary period');
  await page.screenshot({path:path.join(OUT_DIR,'H26_M07_cone_rest.png')});
  const report={stat,rev,balanced,mid,edge,rotated,rest};console.log('H26 M07 online '+JSON.stringify(report));return report;
}

async function auditM06Vertical(page,origin){
  const url=new URL(origin);url.searchParams.set('model','mech-vertical-circular');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='mech-vertical-circular');
  const canvas=page.getByTestId('simulation-canvas'),play=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]'),plot=page.getByTestId('uplot-container');
  const read=async()=>JSON.parse(await canvas.getAttribute('data-vertical-rendered'));
  const check=(v,x,label,tol=1e-7)=>{if(!Number.isFinite(v)||Math.abs(v-x)>tol)throw Error('M06 '+label+' '+JSON.stringify({v,x}));};
  const select=async(id,mode)=>{
    await selectPreset(page,id,true);
    await page.waitForFunction(m=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.verticalRendered||'null');return s?.mode===m&&s.t===0;},mode);
    const expand=page.getByTestId('btn-expand-oscilloscope');if(await expand.isVisible())await expand.click();
    await page.waitForFunction(()=>document.querySelector('[data-testid="scope-channel-a"]')?.dataset.channelKey==='normalForceN'&&document.querySelector('[data-testid="scope-channel-b"]')?.dataset.channelKey==='speed');
  };
  const sync=async()=>{
    await page.waitForFunction(()=>{
      const d=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.verticalRendered||'null'),t=Number(document.querySelector('[data-testid="vertical-readouts"]')?.dataset.sampleTime),p=Number(document.querySelector('[data-testid="uplot-container"]')?.dataset.lastSampleT);
      return d&&Math.abs(d.t-t)<1e-10&&Math.abs(d.t-p)<1e-10;
    },null,{timeout:5000});
    return read();
  };
  const runTo=async(t)=>{
    await play.click();await page.waitForFunction(t=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.verticalRendered||'null')?.t>t,t,{timeout:20000});
    await play.click();return sync();
  };
  const ballistic=(d,R,theta,td,outer,v0)=>{
    if(d.derailed!==1)throw Error('M06 not released '+JSON.stringify(d));
    check(d.derailTime,td,'release time');check(d.derailAngleDeg,theta*180/Math.PI,'release angle',1e-5);
    const v=v0??Math.sqrt(9.8*R*Math.cos(theta)),vx=outer?v*Math.cos(theta):-v*Math.cos(theta),vy=outer?-v*Math.sin(theta):v*Math.sin(theta),dt=d.t-td;
    check(d.x,R*Math.sin(theta)+vx*dt,'ballistic x',2e-6);check(d.y,R*Math.cos(theta)+vy*dt-4.9*dt*dt,'ballistic y',2e-6);check(d.vx,vx,'vx',2e-6);check(d.vy,vy-9.8*dt,'vy',2e-6);check(d.normalForceN,0,'released reaction',1e-12);
  };
  await select('outer-launch-release','outer-dome');
  await page.getByTestId('vertical-scope-empty').waitFor({state:'visible'});
  const immediate=await read();ballistic(immediate,1.6,Math.PI/6,0,true,5);
  await page.screenshot({path:path.join(OUT_DIR,'H25_M06_initial_release.png')});
  await page.getByTestId('btn-step').click();await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.verticalRendered||'null')?.t>0);
  const step=await sync();check(step.t,1/60,'single step',1e-10);ballistic(step,1.6,Math.PI/6,0,true,5);
  const late=await runTo(2.1);ballistic(late,1.6,Math.PI/6,0,true,5);
  const vp=JSON.parse(await canvas.getAttribute('data-vertical-viewport')),ppm=.24*Math.min(vp.width,vp.height)*vp.scale,bx=.45*vp.width+vp.offsetX+late.x*ppm,by=.5*vp.height+vp.offsetY-late.y*ppm;
  if(!(bx>25&&bx<vp.width-25&&by>25&&by<vp.height-25&&ppm>15))throw Error('M06 late projectile visibility '+JSON.stringify({vp,bx,by,ppm}));
  await page.screenshot({path:path.join(OUT_DIR,'H25_M06_free_follow.png')});
  const rect=await canvas.boundingBox();await page.mouse.move(rect.x+90,rect.y+120);
  const before=JSON.parse(await canvas.getAttribute('data-vertical-viewport'));await page.mouse.down();await page.mouse.move(rect.x+130,rect.y+145,{steps:4});await page.mouse.up();
  const after=JSON.parse(await canvas.getAttribute('data-vertical-viewport'));
  check(after.offsetX-before.offsetX,40,'manual pan x',.5);check(after.offsetY-before.offsetY,25,'manual pan y',.5);
  if(await canvas.getAttribute('data-vertical-auto-fit')!=='false')throw Error('M06 camera ownership lost');
  await page.getByTestId('btn-reset-view').click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="simulation-canvas"]')?.dataset.verticalAutoFit==='true');
  await select('smooth-dome-derail','outer-dome');
  const dome=await runTo(2.12);ballistic(dome,1.6,48.19147298944372*Math.PI/180,2.0292738208672785,true);
  await page.screenshot({path:path.join(OUT_DIR,'H25_M06_dome_release.png')});
  await select('inner-loop-subcritical','inner-loop');
  const inner=await runTo(.67);ballistic(inner,1.4,62.82214502966877*Math.PI/180,.5693585335711913,false);
  await page.screenshot({path:path.join(OUT_DIR,'H25_M06_inner_release.png')});
  await select('inner-loop-critical','inner-loop');
  const critical=await runTo(1.05);
  if(critical.derailed!==0||critical.normalForceN<0)throw Error('M06 critical contact lost '+JSON.stringify(critical));
  check(Math.hypot(critical.x,critical.y),1.6,'critical radius',1e-10);check(critical.energy,1.5*9.8*1.6,'critical energy',1e-7);
  if(await page.getByTestId('param-slider-startAngleDeg').count())throw Error('M06 inactive dome angle leaked into inner mode');
  if(await page.getByTestId('floating-scope-dock').getAttribute('data-scope-units')!=='separate'||!await plot.isVisible())throw Error('M06 missing true two-unit plot');
  await page.screenshot({path:path.join(OUT_DIR,'H25_M06_critical_loop.png')});
  await select('inner-loop-side-turn','inner-loop');
  const side=await runTo(1.1);if(side.derailed!==0||side.normalForceN<0)throw Error('M06 side tangency wrongly detached');
  check(Math.hypot(side.x,side.y),1.6,'side radius',1e-10);check(side.energy,0,'zero-reference energy',1e-8);
  await page.screenshot({path:path.join(OUT_DIR,'H25_M06_side_turn.png')});
  await select('light-rod-full-loop','light-rod');await play.click();
  await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.verticalRendered||'null')?.normalForceN<-.5,null,{timeout:15000});
  await play.click();const rod=await sync();if(rod.derailed!==0||rod.normalForceN>=0)throw Error('M06 rod compression not displayed '+JSON.stringify(rod));
  check(Math.hypot(rod.x,rod.y),1.4,'rod radius',1e-10);check(rod.normalForceN,rod.speed**2/1.4-9.8*rod.y/1.4,'signed rod force');
  const force=page.getByLabel('实际受力矢量（等比例）');if(!await force.isVisible())await page.locator('details').filter({has:force}).locator('summary').click();
  await force.check();await page.screenshot({path:path.join(OUT_DIR,'H25_M06_rod_compression.png')});
  const theme=await page.evaluate(()=>document.documentElement.getAttribute('data-theme'));
  if(theme!=='projector'){
    if(!await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
    await page.getByTestId('btn-theme').click();await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
  }
  await page.screenshot({path:path.join(OUT_DIR,'H25_M06_rod_paper.png')});
  if(theme!=='projector'){
    if(!await page.getByTestId('tools-menu').isVisible())await page.getByTestId('btn-tools-menu').click();
    await page.getByTestId('btn-theme').click();
  }
  const report={immediate,step,late,dome,inner,critical,side,rod,manualPan:true};console.log('H25 M06 online '+JSON.stringify(report));return report;
}

async function auditM05Contact(page,origin){
  const url=new URL(origin);url.searchParams.set('model','mech-block-conveyor');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='mech-block-conveyor');
  const canvas=page.getByTestId('simulation-canvas'),play=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]'),plot=page.getByTestId('uplot-container');
  const read=async()=>JSON.parse(await canvas.getAttribute('data-contact-rendered'));
  const check=(v,x,label,tol=1e-7)=>{if(!Number.isFinite(v)||Math.abs(v-x)>tol)throw Error('M05 '+label+' '+JSON.stringify({v,x}));};
  const select=async(id,mode)=>{
    await selectPreset(page,id,true);
    await page.waitForFunction(m=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.contactRendered||'null');return s?.mode===m&&s.t===0;},mode);
    const expand=page.getByTestId('btn-expand-oscilloscope');if(await expand.isVisible())await expand.click();
    await page.waitForFunction(()=>document.querySelector('[data-testid="scope-channel-a"]')?.dataset.channelKey==='vBlock'&&document.querySelector('[data-testid="scope-channel-b"]')?.dataset.channelKey==='vCarrier');
  };
  const sync=async()=>{
    await page.waitForFunction(()=>{
      const d=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.contactRendered||'null'),t=Number(document.querySelector('[data-testid="contact-readouts"]')?.dataset.sampleTime),p=Number(document.querySelector('[data-testid="uplot-container"]')?.dataset.lastSampleT);
      return d&&Math.abs(d.t-t)<1e-10&&Math.abs(d.t-p)<1e-10;
    },null,{timeout:5000});
    return read();
  };
  const runTo=async(t)=>{
    await play.click();
    await page.waitForFunction(t=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.contactRendered||'null')?.t>t,t,{timeout:20000});
    await play.click();return sync();
  };
  const checkArea=async(s,tol=.03)=>{
    const area=Number(await plot.getAttribute('data-sampled-relative-slip'));
    check(area,s.relativeScratch,'sampled v-t inter-curve area',tol);
    if(!await plot.isVisible()||Number(await plot.getAttribute('data-sample-count'))<2)throw Error('M05 missing sampled graph');
  };
  await select('conveyor-horizontal-startup','conveyor');
  await page.getByTestId('contact-scope-empty').waitFor({state:'visible'});
  const mid=await runTo(.4);check(mid.vBlock,2.45*mid.t,'horizontal acceleration');check(mid.xBlock,1.225*mid.t**2,'horizontal displacement');await checkArea(mid);
  await page.screenshot({path:path.join(OUT_DIR,'H24_M05_horizontal_slip.png')});
  const late=await runTo(4.5);check(late.vBlock,4,'locked speed');check(late.xBlock,4*late.t-8/2.45,'late displacement');check(late.frictionHeat,16,'heat');check(late.carrierWork,32,'motor work');check(late.relativeScratch,8/2.45,'slip');await checkArea(late);
  const vp=JSON.parse(await canvas.getAttribute('data-contact-viewport')),rect=await canvas.boundingBox();
  const ppm=.24*Math.min(vp.width,vp.height)*vp.scale,bx=.45*vp.width+vp.offsetX+late.xBlock*ppm,by=.5*vp.height+vp.offsetY-.21*ppm;
  if(!(bx>25&&bx<rect.width-25&&by>25&&by<rect.height-25&&ppm>15))throw Error('M05 long-run block not visible '+JSON.stringify({vp,late,bx,by,ppm}));
  await page.screenshot({path:path.join(OUT_DIR,'H24_M05_long_run.png')});
  await select('conveyor-inclined-downward-break','conveyor');
  const inclined=await runTo(.9),th=37*Math.PI/180,tStar=4/(9.8*(Math.sin(th)+.25*Math.cos(th)));
  check(inclined.vBlock,-4-9.8*(Math.sin(th)-.25*Math.cos(th))*(inclined.t-tStar),'post-crossing velocity');
  check(inclined.frictionOnBlockN,2*.25*9.8*Math.cos(th),'reversed friction');if(inclined.coMovingLocked!==0)throw Error('M05 inclined state wrongly locked');
  await checkArea(inclined);await page.screenshot({path:path.join(OUT_DIR,'H24_M05_inclined_flip.png')});
  await select('plank-smooth-ground-momentum','plank');
  const plank=await runTo(2.4);check(plank.vBlock,2,'plank common speed');check(plank.vCarrier,2,'plank speed');check(plank.frictionHeat,24,'plank heat');await checkArea(plank);
  if(await page.getByTestId('param-slider-beltVelocity').count()||!await page.getByTestId('param-slider-massPlank').count())throw Error('M05 stale mode fields');
  await page.screenshot({path:path.join(OUT_DIR,'H24_M05_plank_momentum.png')});
  await select('conveyor-horizontal-startup','conveyor');
  const length=page.getByTestId('param-slider-carrierLengthM');
  if(!await length.isVisible())await page.locator('details').filter({has:length}).locator('summary').click();
  await length.fill('2');await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.contactRendered||'null')?.t===0);
  await play.click();await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.contactRendered||'null')?.terminal===1,null,{timeout:10000});
  await page.waitForFunction(()=>document.querySelector('[data-testid="topbar"] [data-testid="btn-play-pause"]')?.getAttribute('aria-label')==='运行');
  const terminal=await sync();check(terminal.t,Math.sqrt(2/2.45),'finite edge time');check(terminal.xBlock,1,'finite edge position');
  await page.getByTestId('btn-step').click();await page.evaluate(()=>new Promise(requestAnimationFrame));check((await read()).t,terminal.t,'terminal single step');
  await page.screenshot({path:path.join(OUT_DIR,'H24_M05_finite_edge.png')});
  const report={mid,late,inclined,plank,terminal,vp};console.log('H24 M05 online '+JSON.stringify(report));return report;
}

async function auditM04Projectile(page,origin){
  const url=new URL(origin);url.searchParams.set('model','mech-projectile-coupling');
  await page.goto(url.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-model-id')==='mech-projectile-coupling');
  const canvas=page.getByTestId('simulation-canvas'),play=page.locator('[data-testid="topbar"] [data-testid="btn-play-pause"]');
  const read=async()=>JSON.parse(await canvas.getAttribute('data-projectile-rendered'));
  const waitMode=async mode=>page.waitForFunction(mode=>{const s=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.projectileRendered||'null');return s?.mode===mode&&s.t===0;},mode);
  const check=(v,x,label,tol=1e-7)=>{if(!Number.isFinite(v)||Math.abs(v-x)>tol)throw Error('M04 '+label+' '+JSON.stringify({v,x}));};
  const sync=async()=>{
    const a=await page.evaluate(async()=>{
      const out=[];
      for(let i=0;i<8;i++){
        await new Promise(requestAnimationFrame);
        const d=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]').dataset.projectileRendered),m=document.querySelector('[data-testid="topbar"]').innerText.match(/t\s*=\s*([\d.]+)\s*s/);
        out.push({t:d.t,clock:Number(m?.[1]),plot:Number(document.querySelector('[data-testid="uplot-container"]')?.dataset.lastSampleT)});
      }return out;
    });
    for(const x of a){check(x.clock,x.t,'paused clock',.00501);check(x.plot,x.t,'paused plot',1e-10);}
    console.log('H21 M04 paused '+JSON.stringify(a));return a;
  };
  const expand=page.getByTestId('btn-expand-oscilloscope');if(await expand.isVisible())await expand.click();
  await selectPreset(page,'flat-throw-onto-37deg',true);await waitMode('incline-flat');if(await expand.isVisible())await expand.click();
  await play.click();await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.projectileRendered||'null')?.t>.27);await play.click();
  const mid=await read(),theta=37*Math.PI/180,T=12*Math.tan(theta)/9.8;
  check(mid.x,6*mid.t,'vacuum x');check(mid.y,-4.9*mid.t**2,'vacuum y');check(mid.vx,6,'vx');check(mid.vy,-9.8*mid.t,'vy');
  await sync();await page.screenshot({path:path.join(OUT_DIR,'H21_M04_midpoint.png')});
  const finish=async()=>{
    await play.click();await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.projectileRendered||'null')?.terminal===1);
    await page.waitForFunction(()=>document.querySelector('[data-testid="topbar"] [data-testid="btn-play-pause"]')?.getAttribute('aria-label')==='运行');
    return read();
  };
  const incline=await finish();check(incline.t,T,'incline impact time');check(incline.impactTime,T,'impactTime');check(incline.y+incline.x*Math.tan(theta),0,'incline residual',1e-6);await sync();
  await page.getByTestId('btn-step').click();await page.evaluate(()=>new Promise(requestAnimationFrame));check((await read()).t,T,'terminal time after single step');
  await page.screenshot({path:path.join(OUT_DIR,'H21_M04_incline_impact.png')});
  await selectPreset(page,'semicircle-trough-hit',true);await waitMode('semicircle-trough');if(await expand.isVisible())await expand.click();
  let lo=0,hi=2;const f=t=>16*t+9.8**2*t**3/4-20;
  for(let k=0;k<70;k++){const m=(lo+hi)/2;if(f(m)<0)lo=m;else hi=m;}
  const trough=await finish();check(trough.t,(lo+hi)/2,'lower arc root');
  check((trough.x-2.5)**2+trough.y**2,2.5**2,'lower arc radius',1e-6);if(!(trough.y<0)||trough.landed!==1)throw Error('M04 not physical lower arc '+JSON.stringify(trough));
  await sync();await page.screenshot({path:path.join(OUT_DIR,'H21_M04_trough_impact.png')});
  await selectPreset(page,'oblique-escape-rim',true);await waitMode('semicircle-trough');
  const escape=await finish();check(escape.t,.5,'rim escape time');check(escape.x,2,'rim x');
  if(escape.landed!==0||'impactTime'in escape||escape.y<=0)throw Error('M04 escape incorrectly reported as collision '+JSON.stringify(escape));
  await page.screenshot({path:path.join(OUT_DIR,'H21_M04_escape.png')});
  await selectPreset(page,'oblique-safety-envelope',true);await waitMode('safety-envelope');
  const drag=await finish();check(drag.y,0,'drag landing height',1e-6);
  if(drag.kineticEnergy>=32||drag.x>64/9.8+1e-7||drag.y>64/19.6-9.8*drag.x**2/128+1e-7)throw Error('M04 drag not within vacuum envelope '+JSON.stringify(drag));
  await page.screenshot({path:path.join(OUT_DIR,'H21_M04_drag_envelope.png')});
  await selectPreset(page,'flat-throw-onto-37deg',true);await waitMode('incline-flat');
  await page.getByTestId('param-slider-v0').fill('14');await page.getByTestId('param-slider-inclineDeg').fill('60');
  await page.waitForFunction(()=>{const d=JSON.parse(document.querySelector('[data-testid="simulation-canvas"]')?.dataset.projectileRendered||'null');return d?.t===0&&Math.abs(d.vx-14)<1e-8;});
  const vp=JSON.parse(await canvas.getAttribute('data-projectile-viewport')),box=await canvas.boundingBox(),panel=await page.getByTestId('right-control-panel').boundingBox(),dock=await page.getByTestId('floating-scope-dock').boundingBox();
  const x=2*14**2*Math.tan(Math.PI/3)/9.8,y=-x*Math.tan(Math.PI/3),ppm=.24*Math.min(vp.width,vp.height)*vp.scale;
  const start={x:box.x+.45*vp.width+vp.offsetX,y:box.y+.5*vp.height+vp.offsetY},end={x:start.x+x*ppm,y:start.y-y*ppm};
  if(start.x<box.x+20||start.y<box.y+15||end.x>panel.x-8||end.y>(dock?.height>20?dock.y-8:box.y+box.height-30))throw Error('M04 extreme physical domain covered '+JSON.stringify({start,end,panel,dock,vp}));
  await page.screenshot({path:path.join(OUT_DIR,'H21_M04_extreme_view.png')});
  console.log('H21 M04 online '+JSON.stringify({mid,incline,trough,escape,drag,start,end}));
  return {mid,incline,trough,escape,drag,start,end};
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
        for(let k=0;k<10;k++)await current.press('ArrowRight');
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
    const m03ConstraintReport=await auditM03Constraints(page,origin);
    const m04ProjectileReport=await auditM04Projectile(page,origin);
    const m05ContactReport=await auditM05Contact(page,origin);
    const m06VerticalReport=await auditM06Vertical(page,origin);
    const m07TurntableReport=await auditM07Turntable(page,origin);
    const m08SpringReport=await auditM08Spring(page,origin);
    const m09CollisionReport=await auditM09Collision(page,origin);
    const m11ShmReport=await auditM11Shm(page,origin);
    const e01ElectrostaticReport=await auditE01Electrostatic(page,origin);
    const e02CapacitorReport=await auditE02Capacitor(page,origin);
    const e03AcScopeReport=await auditE03AcScope(page,origin);
    const e05WireframeReport=await auditE05Wireframe(page,origin);
    const e06EddyReport=await auditE06Eddy(page,origin);
    const e07GeneratorReport=await auditE07Generator(page,origin);
    const e08TransformerReport=await auditE08Transformer(page,origin);
    const e09LcReport=await auditE09Lc(page,origin);
    const e10MagneticReport=await auditE10Magnetic(page,origin);
    const w01Report=await auditW01(page,origin);
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
      await m02Page.locator('[data-preset-id="fixed-rod-support-moment"]').click();
      await m02Page.waitForFunction(()=>{const d=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.equilibriumRendered||'null');return d?.t===0&&d.supportMomentNm!==undefined;});
      const fixed=await read(),expected=1.2*(Math.sqrt(3)/2*(19.6-4*Math.sqrt(3))-2);
      if(Math.abs(fixed.supportMomentNm-expected)>1e-10||Math.abs(fixed.force2-8)>1e-10||fixed.momentResidualNm>=1e-10)throw Error('M02 offline fixed '+JSON.stringify(fixed));
      await m02Page.getByTestId('sf-layer-angle-curve').check();
      await m02Page.waitForFunction(()=>document.querySelector('[data-testid="sf-canvas"]')?.dataset.equilibriumView==='angle-curve');
      const after=await read();if(after.t!==fixed.t||after.angleDeg!==fixed.angleDeg)throw Error('M02 offline view reset');
      await m02Page.screenshot({path:path.join(OUT_DIR,'H16_M02_offline_fixed_angle_paper.png')});
      if(m02Errors.length||m02Network.length)throw Error('M02 offline errors '+JSON.stringify({m02Errors,m02Network}));
      Object.assign(m02OfflineReport,{initial,step,fixed,errors:m02Errors,network:m02Network});
    }finally{await m02Context.close();}

    const m03File=path.join(OUT_DIR,'H18_M03_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','mech-constrained-velocity','--preset','dual-rope-asymmetric','--out',m03File],{stdio:'inherit'});
    const m03Context=await browser.newContext({viewport:VIEWPORT,offline:true});const m03Page=await m03Context.newPage(),m03Errors=[],m03Network=[],m03OfflineReport={};
    m03Page.on('pageerror',e=>m03Errors.push(e.message));m03Page.on('console',m=>{if(m.type()==='error')m03Errors.push(m.text());});m03Page.on('request',r=>{if(/^https?:/.test(r.url()))m03Network.push(r.url());});
    try{
      await m03Page.goto(pathToFileURL(m03File).href);
      const canvas=m03Page.getByTestId('sf-canvas'),read=async()=>JSON.parse(await canvas.getAttribute('data-constrained-rendered'));
      await m03Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.constrainedRendered||'null')?.mode==='dual-rope-pull');
      await m03Page.getByRole('button',{name:'单步',exact:true}).click();
      await m03Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.constrainedRendered||'null')?.t>0);
      const step=await read(),l0=3/Math.sqrt(2),l1=l0-1.5*step.t,l2=l0-.9*step.t;
      if(Math.abs(step.t-1/60)>1e-10||Math.abs(Math.hypot(step.xA,step.yA)-l1)>1e-9||Math.abs(Math.hypot(step.xA-3,step.yA)-l2)>1e-9||step.projSpeedDiff>=1e-10)throw Error('M03 offline analytic '+JSON.stringify(step));
      await m03Page.getByRole('button',{name:'黑板深蓝'}).click();await m03Page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
      await m03Page.screenshot({path:path.join(OUT_DIR,'H18_M03_offline_dual_paper.png')});
      if(m03Errors.length||m03Network.length)throw Error('M03 offline errors '+JSON.stringify({m03Errors,m03Network}));
      Object.assign(m03OfflineReport,{step,errors:m03Errors,network:m03Network});
    }finally{await m03Context.close();}

    const m04File=path.join(OUT_DIR,'H21_M04_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','mech-projectile-coupling','--preset','flat-throw-onto-37deg','--out',m04File],{stdio:'inherit'});
    const m04Context=await browser.newContext({viewport:VIEWPORT,offline:true}),m04Page=await m04Context.newPage(),m04Errors=[],m04Network=[],m04OfflineReport={};
    m04Page.on('pageerror',e=>m04Errors.push(e.message));m04Page.on('console',m=>{if(m.type()==='error')m04Errors.push(m.text());});m04Page.on('request',r=>{if(/^https?:/.test(r.url()))m04Network.push(r.url());});
    try{
      await m04Page.goto(pathToFileURL(m04File).href);
      const canvas=m04Page.getByTestId('sf-canvas'),read=async()=>JSON.parse(await canvas.getAttribute('data-projectile-rendered'));
      await m04Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.projectileRendered||'null')?.mode==='incline-flat');
      await m04Page.getByRole('button',{name:'单步',exact:true}).click();
      await m04Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.projectileRendered||'null')?.t>0);
      const step=await read();
      if(Math.abs(step.t-1/60)>1e-10||Math.abs(step.x-6*step.t)>1e-9||Math.abs(step.y+4.9*step.t**2)>1e-9)throw Error('M04 offline step '+JSON.stringify(step));
      await m04Page.getByRole('button',{name:'运行',exact:true}).click();
      await m04Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.projectileRendered||'null')?.terminal===1);
      const impact=await read(),T=12*Math.tan(37*Math.PI/180)/9.8;
      if(Math.abs(impact.t-T)>1e-7||Math.abs(impact.y+impact.x*Math.tan(37*Math.PI/180))>1e-6)throw Error('M04 offline impact '+JSON.stringify(impact));
      await m04Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]').dataset.projectileRendered),t=Number(document.querySelector('[data-testid="sf-summary-clock"]').dataset.sampleTime),p=Number(document.querySelector('[data-testid="sf-uplot"]').dataset.lastSampleT);return Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;});
      await m04Page.getByRole('button',{name:'单步',exact:true}).click();await m04Page.evaluate(()=>new Promise(requestAnimationFrame));
      if(Math.abs((await read()).t-impact.t)>1e-10)throw Error('M04 offline terminal advanced');
      await m04Page.getByRole('button',{name:'黑板深蓝'}).click();await m04Page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
      await m04Page.screenshot({path:path.join(OUT_DIR,'H21_M04_offline_impact_paper.png')});
      if(m04Errors.length||m04Network.length)throw Error('M04 offline errors '+JSON.stringify({m04Errors,m04Network}));
      Object.assign(m04OfflineReport,{step,impact,errors:m04Errors,network:m04Network});
    }finally{await m04Context.close();}

    const m05File=path.join(OUT_DIR,'H24_M05_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','mech-block-conveyor','--preset','conveyor-horizontal-startup','--out',m05File],{stdio:'inherit'});
    const m05Context=await browser.newContext({viewport:VIEWPORT,offline:true}),m05Page=await m05Context.newPage(),m05Errors=[],m05Network=[],m05OfflineReport={};
    m05Page.on('pageerror',e=>m05Errors.push(e.message));m05Page.on('console',m=>{if(m.type()==='error')m05Errors.push(m.text());});m05Page.on('request',r=>{if(/^https?:/.test(r.url()))m05Network.push(r.url());});
    try{
      await m05Page.goto(pathToFileURL(m05File).href);
      const canvas=m05Page.getByTestId('sf-canvas'),plot=m05Page.getByTestId('sf-uplot'),read=async()=>JSON.parse(await canvas.getAttribute('data-contact-rendered'));
      await m05Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.contactRendered||'null')?.mode==='conveyor');
      await m05Page.getByTestId('sf-scope-empty').waitFor({state:'visible'});
      await m05Page.getByRole('button',{name:'单步',exact:true}).click();
      await m05Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.contactRendered||'null')?.t>0);
      const step=await read();if(Math.abs(step.t-1/60)>1e-10||Math.abs(step.vBlock-2.45*step.t)>1e-9||Math.abs(step.xBlock-1.225*step.t**2)>1e-9)throw Error('M05 offline step '+JSON.stringify(step));
      await m05Page.getByTestId('sf-param-carrierLengthM').fill('2');
      await m05Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.contactRendered||'null')?.t===0);
      await m05Page.getByTestId('sf-play-pause').click();
      await m05Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.contactRendered||'null')?.terminal===1);
      const terminal=await read();
      if(Math.abs(terminal.t-Math.sqrt(2/2.45))>1e-7||Math.abs(terminal.xBlock-1)>1e-7)throw Error('M05 offline edge '+JSON.stringify(terminal));
      await m05Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]').dataset.contactRendered),t=Number(document.querySelector('[data-testid="sf-summary-clock"]').dataset.sampleTime),p=Number(document.querySelector('[data-testid="sf-uplot"]').dataset.lastSampleT);return Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;});
      if(Math.abs(Number(await plot.getAttribute('data-sampled-relative-slip'))-terminal.relativeScratch)>.03)throw Error('M05 offline sampled area');
      await m05Page.getByRole('button',{name:'单步',exact:true}).click();await m05Page.evaluate(()=>new Promise(requestAnimationFrame));
      if(Math.abs((await read()).t-terminal.t)>1e-10)throw Error('M05 offline terminal single step');
      await m05Page.getByRole('button',{name:'黑板深蓝'}).click();await m05Page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
      await m05Page.screenshot({path:path.join(OUT_DIR,'H24_M05_offline_edge_paper.png')});
      if(m05Errors.length||m05Network.length)throw Error('M05 offline errors '+JSON.stringify({m05Errors,m05Network}));
      Object.assign(m05OfflineReport,{step,terminal,errors:m05Errors,network:m05Network});
    }finally{await m05Context.close();}


    const m06File=path.join(OUT_DIR,'H25_M06_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','mech-vertical-circular','--preset','outer-launch-release','--out',m06File],{stdio:'inherit'});
    const m06Context=await browser.newContext({viewport:VIEWPORT,offline:true}),m06Page=await m06Context.newPage(),m06Errors=[],m06Network=[],m06OfflineReport={};
    m06Page.on('pageerror',e=>m06Errors.push(e.message));m06Page.on('console',m=>{if(m.type()==='error')m06Errors.push(m.text());});m06Page.on('request',r=>{if(/^https?:/.test(r.url()))m06Network.push(r.url());});
    try{
      await m06Page.goto(pathToFileURL(m06File).href);
      const canvas=m06Page.getByTestId('sf-canvas'),read=async()=>JSON.parse(await canvas.getAttribute('data-vertical-rendered'));
      await m06Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.verticalRendered||'null')?.derailed===1);
      await m06Page.getByTestId('sf-scope-empty').waitFor({state:'visible'});
      await m06Page.getByRole('button',{name:'单步',exact:true}).click();
      await m06Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.verticalRendered||'null')?.t>0);
      const step=await read(),th=Math.PI/6;
      if(step.derailTime!==0||Math.abs(step.t-1/60)>1e-10||Math.abs(step.x-(1.6*Math.sin(th)+5*Math.cos(th)*step.t))>1e-9||Math.abs(step.y-(1.6*Math.cos(th)-5*Math.sin(th)*step.t-4.9*step.t**2))>1e-9)throw Error('M06 offline step '+JSON.stringify(step));
      await m06Page.locator('[data-preset-id="inner-loop-critical"]').click();
      await m06Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.verticalRendered||'null');return s?.mode==='inner-loop'&&s.t===0;});
      await m06Page.getByTestId('sf-play-pause').click();
      await m06Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.verticalRendered||'null')?.t>1.05);
      await m06Page.getByTestId('sf-play-pause').click();
      await m06Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]').dataset.verticalRendered),t=Number(document.querySelector('[data-testid="sf-summary-clock"]').dataset.sampleTime),p=Number(document.querySelector('[data-testid="sf-uplot"]').dataset.lastSampleT);return Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;});
      const critical=await read();if(critical.derailed!==0||critical.normalForceN<0||Math.abs(Math.hypot(critical.x,critical.y)-1.6)>1e-10||Math.abs(critical.energy-1.5*9.8*1.6)>1e-7)throw Error('M06 offline critical '+JSON.stringify(critical));
      if(await m06Page.getByTestId('sf-param-startAngleDeg').count()||await m06Page.getByTestId('sf-uplot').getAttribute('data-scope-units')!=='separate')throw Error('M06 offline mode or units');
      await m06Page.getByRole('button',{name:'黑板深蓝'}).click();await m06Page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
      await m06Page.screenshot({path:path.join(OUT_DIR,'H25_M06_offline_critical_paper.png')});
      if(m06Errors.length||m06Network.length)throw Error('M06 offline errors '+JSON.stringify({m06Errors,m06Network}));
      Object.assign(m06OfflineReport,{step,critical,errors:m06Errors,network:m06Network});
    }finally{await m06Context.close();}


    const m07File=path.join(OUT_DIR,'H26_M07_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','mech-conical-turntable','--preset','turntable-breakout','--out',m07File],{stdio:'inherit'});
    const m07Context=await browser.newContext({viewport:VIEWPORT,offline:true}),m07Page=await m07Context.newPage(),m07Errors=[],m07Network=[],m07OfflineReport={};
    m07Page.on('pageerror',e=>m07Errors.push(e.message));m07Page.on('console',m=>{if(m.type()==='error')m07Errors.push(m.text());});m07Page.on('request',r=>{if(/^https?:/.test(r.url()))m07Network.push(r.url());});
    try{
      await m07Page.goto(pathToFileURL(m07File).href);
      const canvas=m07Page.getByTestId('sf-canvas'),read=async()=>JSON.parse(await canvas.getAttribute('data-turntable-rendered'));
      await m07Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.turntableRendered||'null')?.slippingOut===1);
      await m07Page.getByTestId('sf-scope-empty').waitFor({state:'visible'});
      await m07Page.getByTestId('sf-play-pause').click();
      await m07Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.turntableRendered||'null')?.terminal===1);
      await m07Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]').dataset.turntableRendered),t=Number(document.querySelector('[data-testid="sf-summary-clock"]').dataset.sampleTime),p=Number(document.querySelector('[data-testid="sf-uplot"]').dataset.lastSampleT);return Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;});
      const edge=await read();if(Math.abs(edge.t-1.03331744326271)>1e-7||Math.abs(edge.rA-2.6)>1e-7||Math.abs(edge.actualSeparation-2.1)>1e-10||Math.abs(edge.energyResidual)>1e-6)throw Error('M07 offline edge '+JSON.stringify(edge));
      await m07Page.getByRole('button',{name:'单步',exact:true}).click();await m07Page.evaluate(()=>new Promise(requestAnimationFrame));if(Math.abs((await read()).t-edge.t)>1e-10)throw Error('M07 offline terminal single step');
      await m07Page.screenshot({path:path.join(OUT_DIR,'H26_M07_offline_edge.png')});
      await m07Page.locator('[data-preset-id="conical-pendulum-steady"]').click();
      await m07Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.turntableRendered||'null');return s?.mode==='conical-pendulum'&&s.t===0;});
      await m07Page.waitForFunction(()=>document.querySelector('[data-testid="sf-scope-channel-b"]')?.value==='coneAngleDeg'&&document.querySelector('[data-testid="sf-uplot"]')?.getAttribute('data-scope-units')==='separate');
      if(await m07Page.getByTestId('sf-param-radiusB').count()||!await m07Page.getByTestId('sf-param-pendulumLength').count())throw Error('M07 offline mode fields');
      await m07Page.getByRole('button',{name:'单步',exact:true}).click();
      await m07Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.turntableRendered||'null')?.t>0);
      const cone=await read();if(Math.abs(cone.coneTensionY-9.8)>1e-9||Math.abs(cone.xA-cone.rA*Math.cos(3.6*cone.t))>1e-9)throw Error('M07 offline projection '+JSON.stringify(cone));
      await m07Page.getByRole('button',{name:'黑板深蓝'}).click();await m07Page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
      await m07Page.screenshot({path:path.join(OUT_DIR,'H26_M07_offline_cone_paper.png')});
      if(m07Errors.length||m07Network.length)throw Error('M07 offline errors '+JSON.stringify({m07Errors,m07Network}));
      Object.assign(m07OfflineReport,{edge,cone,errors:m07Errors,network:m07Network});
    }finally{await m07Context.close();}


    const m08File=path.join(OUT_DIR,'H27_M08_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','mech-spring-separation','--preset','spring-recontact','--out',m08File],{stdio:'inherit'});
    const m08Context=await browser.newContext({viewport:VIEWPORT,offline:true}),m08Page=await m08Context.newPage(),m08Errors=[],m08Network=[],m08OfflineReport={};
    m08Page.on('pageerror',e=>m08Errors.push(e.message));m08Page.on('console',m=>{if(m.type()==='error')m08Errors.push(m.text());});m08Page.on('request',r=>{if(/^https?:/.test(r.url()))m08Network.push(r.url());});
    try{
      await m08Page.goto(pathToFileURL(m08File).href);
      const canvas=m08Page.getByTestId('sf-canvas'),read=async()=>JSON.parse(await canvas.getAttribute('data-spring-rendered'));
      await m08Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.springRendered||'null')?.initialComp===1.2);
      await m08Page.getByTestId('sf-scope-empty').waitFor({state:'visible'});
      await m08Page.getByTestId('sf-play-pause').click();
      await m08Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.springRendered||'null')?.terminal===1);
      await m08Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]').dataset.springRendered),t=Number(document.querySelector('[data-testid="sf-summary-clock"]').dataset.sampleTime),p=Number(document.querySelector('[data-testid="sf-uplot"]').dataset.lastSampleT);return Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;});
      const edge=await read();if(Math.abs(edge.t-1.6103797957876382)>1e-8||Math.abs(edge.gap)>1e-9||Math.abs(edge.energyResidual)>1e-8)throw Error('M08 offline recontact '+JSON.stringify(edge));
      await m08Page.getByRole('button',{name:'单步',exact:true}).click();await m08Page.evaluate(()=>new Promise(requestAnimationFrame));if(Math.abs((await read()).t-edge.t)>1e-10)throw Error('M08 offline terminal single step');
      await m08Page.screenshot({path:path.join(OUT_DIR,'H27_M08_offline_recontact.png')});
      await m08Page.locator('[data-preset-id="external-pull-early-sep"]').click();
      await m08Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.springRendered||'null');return s?.externalForce===12&&s.t===0;});
      if(await m08Page.getByTestId('sf-uplot').getAttribute('data-scope-units')!=='separate')throw Error('M08 offline independent units');
      await m08Page.getByTestId('sf-play-pause').click();
      await m08Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.springRendered||'null')?.t>.7);
      await m08Page.getByTestId('sf-play-pause').click();
      const early=await read();if(Math.abs(early.separationS+.2)>1e-10||Math.abs(early.energyResidual)>1e-8||early.gap<=0)throw Error('M08 offline early release '+JSON.stringify(early));
      await m08Page.getByRole('button',{name:'黑板深蓝'}).click();await m08Page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
      await m08Page.screenshot({path:path.join(OUT_DIR,'H27_M08_offline_early_paper.png')});
      if(m08Errors.length||m08Network.length)throw Error('M08 offline errors '+JSON.stringify({m08Errors,m08Network}));
      Object.assign(m08OfflineReport,{edge,early,errors:m08Errors,network:m08Network});
    }finally{await m08Context.close();}


    const m09File=path.join(OUT_DIR,'H28_M09_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','mech-collision-recoil','--preset','oblique-equal-mass-elastic','--out',m09File],{stdio:'inherit'});
    const m09Context=await browser.newContext({viewport:VIEWPORT,offline:true}),m09Page=await m09Context.newPage(),m09Errors=[],m09Network=[],m09OfflineReport={};
    m09Page.on('pageerror',e=>m09Errors.push(e.message));m09Page.on('console',m=>{if(m.type()==='error')m09Errors.push(m.text());});m09Page.on('request',r=>{if(/^https?:/.test(r.url()))m09Network.push(r.url());});
    try{
      await m09Page.goto(pathToFileURL(m09File).href);
      const canvas=m09Page.getByTestId('sf-canvas'),read=async()=>JSON.parse(await canvas.getAttribute('data-collision-rendered'));
      await m09Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.collisionRendered||'null')?.mode==='collision-2d-oblique');
      await m09Page.getByTestId('sf-scope-empty').waitFor({state:'visible'});
      await m09Page.getByTestId('sf-play-pause').click();
      await m09Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.collisionRendered||'null')?.t>.72);
      await m09Page.getByTestId('sf-play-pause').click();
      await m09Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]').dataset.collisionRendered),t=Number(document.querySelector('[data-testid="sf-summary-clock"]').dataset.sampleTime),p=Number(document.querySelector('[data-testid="sf-uplot"]').dataset.lastSampleT);return Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;});
      const hit=await read();if(Math.abs(hit.impactTime-.53)>1e-8||Math.abs(hit.vx1-1.44)>1e-8||Math.abs(hit.vDotProduct)>1e-8||Math.abs(hit.energyResidual)>1e-8)throw Error('M09 offline hit '+JSON.stringify(hit));
      await m09Page.screenshot({path:path.join(OUT_DIR,'H28_M09_offline_oblique.png')});
      await m09Page.locator('[data-preset-id="bullet-exit"]').click();
      await m09Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.collisionRendered||'null');return s?.mode==='bullet-block'&&s.t===0;});
      await m09Page.waitForFunction(()=>document.querySelector('[data-testid="sf-scope-channel-b"]')?.value==='heatLostJ'&&document.querySelector('[data-testid="sf-uplot"]')?.getAttribute('data-scope-units')==='separate');
      if(await m09Page.getByTestId('sf-param-impactParamB').count()||!await m09Page.getByTestId('sf-param-dragForceF').count())throw Error('M09 offline mode fields');
      await m09Page.getByTestId('sf-play-pause').click();await m09Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.collisionRendered||'null')?.t>.6);await m09Page.getByTestId('sf-play-pause').click();
      const exit=await read();if(exit.phase!==3||Math.abs(exit.heatLostJ-10)>1e-8||Math.abs(exit.relativeSpeed-Math.sqrt(14))>1e-8)throw Error('M09 offline exit '+JSON.stringify(exit));
      await m09Page.getByRole('button',{name:'黑板深蓝'}).click();await m09Page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
      await m09Page.screenshot({path:path.join(OUT_DIR,'H28_M09_offline_exit_paper.png')});
      if(m09Errors.length||m09Network.length)throw Error('M09 offline errors '+JSON.stringify({m09Errors,m09Network}));
      Object.assign(m09OfflineReport,{hit,exit,errors:m09Errors,network:m09Network});
    }finally{await m09Context.close();}

    const m11File=path.join(OUT_DIR,'H29_M11_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','mech-shm-resonance','--preset','large-angle-nonisochronous','--out',m11File],{stdio:'inherit'});
    const m11Context=await browser.newContext({viewport:VIEWPORT,offline:true}),m11Page=await m11Context.newPage(),m11Errors=[],m11Network=[],m11OfflineReport={};
    m11Page.on('pageerror',e=>m11Errors.push(e.message));m11Page.on('console',m=>{if(m.type()==='error')m11Errors.push(m.text());});m11Page.on('request',r=>{if(/^https?:/.test(r.url()))m11Network.push(r.url());});
    try{
      await m11Page.goto(pathToFileURL(m11File).href);
      const canvas=m11Page.getByTestId('sf-canvas'),read=async()=>JSON.parse(await canvas.getAttribute('data-shm-rendered'));
      const run=async(t)=>{
        await m11Page.getByTestId('sf-play-pause').click();
        await m11Page.waitForFunction(t=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.shmRendered||'null')?.t>t,t,{timeout:15000});
        await m11Page.getByTestId('sf-play-pause').click();
        await m11Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.shmRendered||'null'),t=Number(document.querySelector('[data-testid="sf-summary-clock"]')?.dataset.sampleTime),p=Number(document.querySelector('[data-testid="sf-uplot"]')?.dataset.lastSampleT);return s&&Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;},null,{timeout:5000});
        return read();
      };
      await m11Page.getByTestId('sf-scope-empty').waitFor({state:'visible'});
      const large=await run(.7),A=large.lengthL*large.initialAngleDeg*Math.PI/180,w=Math.sqrt(large.gravityG/large.lengthL);
      if(Math.abs(large.referenceCircleX-A*Math.cos(w*large.t))>1e-7||Math.abs(large.referenceCircleY-A*Math.sin(w*large.t))>1e-7||large.energyResidual>1e-7)throw Error('M11 offline phase '+JSON.stringify(large));
      await m11Page.screenshot({path:path.join(OUT_DIR,'H29_M11_offline_large.png')});
      await m11Page.locator('[data-preset-id="forced-resonance-peak"]').click();
      await m11Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.shmRendered||'null');return s?.mode==='forced-resonance'&&s.t===0&&document.querySelector('[data-testid="sf-scope-channel-b"]')?.value==='driveWorkJ';});
      const forced0=await read(),forced=await run(.8);
      if(Math.abs(forced.mechanicalEnergy+forced.heatLostJ-forced.driveWorkJ-forced0.mechanicalEnergy)>1e-7||!(forced.heatLostJ>0))throw Error('M11 offline balance '+JSON.stringify(forced));
      await m11Page.getByRole('button',{name:'黑板深蓝'}).click();await m11Page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
      await m11Page.screenshot({path:path.join(OUT_DIR,'H29_M11_offline_forced_paper.png')});
      if(m11Errors.length||m11Network.length)throw Error('M11 offline errors '+JSON.stringify({m11Errors,m11Network}));
      Object.assign(m11OfflineReport,{large,forced,errors:m11Errors,network:m11Network});
    }finally{await m11Context.close();}

    const e01File=path.join(OUT_DIR,'H30_E01_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','em-electrostatic-field','--preset','uniform-reordered-potential','--out',e01File],{stdio:'inherit'});
    const e01Context=await browser.newContext({viewport:VIEWPORT,offline:true}),e01Page=await e01Context.newPage(),e01Errors=[],e01Network=[],e01OfflineReport={};
    e01Page.on('pageerror',e=>e01Errors.push(e.message));e01Page.on('console',m=>{if(m.type()==='error')e01Errors.push(m.text());});e01Page.on('request',r=>{if(/^https?:/.test(r.url()))e01Network.push(r.url());});
    try{
      await e01Page.goto(pathToFileURL(e01File).href);
      const canvas=e01Page.getByTestId('sf-canvas'),read=async()=>JSON.parse(await canvas.getAttribute('data-electro-rendered'));
      await e01Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.electroRendered||'null')?.constructionDefined===1);
      const uniform=await read();
      if(Math.abs(uniform.constructionFraction-1/3)>1e-10||Math.abs(uniform.Ex*(uniform.constructionEndX-uniform.constructionStartX)+uniform.Ey*(uniform.constructionEndY-uniform.constructionStartY))>1e-9)throw Error('E01 offline construction '+JSON.stringify(uniform));
      await e01Page.screenshot({path:path.join(OUT_DIR,'H30_E01_offline_uniform.png')});
      await e01Page.locator('[data-preset-id="deflection-plate-contact"]').click();
      await e01Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.electroRendered||'null');return s?.mode==='deflection-tube'&&s.t===0&&document.querySelector('[data-testid="sf-scope-channel-b"]')?.value==='vy';});
      await e01Page.getByTestId('sf-play-pause').click();
      await e01Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.electroRendered||'null')?.terminal===1);
      await e01Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.electroRendered||'null'),t=Number(document.querySelector('[data-testid="sf-summary-clock"]')?.dataset.sampleTime),p=Number(document.querySelector('[data-testid="sf-uplot"]')?.dataset.lastSampleT);return s&&Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;},null,{timeout:5000});
      const contact=await read();
      if(Math.abs(contact.t-(.1+Math.sqrt(2/16)))>1e-7||Math.abs(contact.py-1)>1e-10||contact.energyResidual>1e-7||'yExit'in contact)throw Error('E01 offline contact '+JSON.stringify(contact));
      await e01Page.getByRole('button',{name:'黑板深蓝'}).click();await e01Page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
      await e01Page.screenshot({path:path.join(OUT_DIR,'H30_E01_offline_contact_paper.png')});
      if(e01Errors.length||e01Network.length)throw Error('E01 offline errors '+JSON.stringify({e01Errors,e01Network}));
      Object.assign(e01OfflineReport,{uniform,contact,errors:e01Errors,network:e01Network});
    }finally{await e01Context.close();}

    const e02File=path.join(OUT_DIR,'H31_E02_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','em-capacitor-millikan','--preset','capacitor-reference-double-gap','--out',e02File],{stdio:'inherit'});
    const e02Context=await browser.newContext({viewport:VIEWPORT,offline:true}),e02Page=await e02Context.newPage(),e02Errors=[],e02Network=[],e02OfflineReport={};
    e02Page.on('pageerror',e=>e02Errors.push(e.message));e02Page.on('console',m=>{if(m.type()==='error')e02Errors.push(m.text());});e02Page.on('request',r=>{if(/^https?:/.test(r.url()))e02Network.push(r.url());});
    try{
      await e02Page.goto(pathToFileURL(e02File).href);
      const canvas=e02Page.getByTestId('sf-canvas'),read=async()=>JSON.parse(await canvas.getAttribute('data-capacitor-rendered'));
      await e02Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.capacitorRendered||'null')?.distanceMm===40);
      const open=await read();
      if(Math.abs(open.chargeNC-3.54167512512)>1e-10||Math.abs(open.voltageV-400)>1e-8||Math.abs(open.fieldEy+10000)>1e-8)throw Error('E02 offline open '+JSON.stringify(open));
      await assertCapacitorLayout(e02Page,true);
      await e02Page.screenshot({path:path.join(OUT_DIR,'H31_E02_offline_open.png')});
      await e02Page.locator('[data-preset-id="millikan-free-fall"]').click();
      await e02Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.capacitorRendered||'null');return s?.oilDropEnabled===true&&s.sourceVoltageU0===0&&s.t===0&&document.querySelector('[data-testid="sf-scope-channel-a"]')?.value==='dropHeightMm';});
      await e02Page.getByTestId('sf-play-pause').click();
      await e02Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.capacitorRendered||'null')?.terminal===1);
      await e02Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.capacitorRendered||'null'),t=Number(document.querySelector('[data-testid="sf-summary-clock"]')?.dataset.sampleTime),p=Number(document.querySelector('[data-testid="sf-uplot"]')?.dataset.lastSampleT);return s&&Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;},null,{timeout:5000});
      const fall=await read(),tc=Math.sqrt(.02/9.8);
      if(Math.abs(fall.t-tc)>1e-7||fall.dropContact!==-1||fall.dropHeightMm!==0||Math.abs(fall.dropVyMmS+9.8*tc*1000)>1e-6)throw Error('E02 offline fall '+JSON.stringify(fall));
      await e02Page.getByRole('button',{name:'黑板深蓝'}).click();await e02Page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
      await assertCapacitorLayout(e02Page,true);
      await e02Page.screenshot({path:path.join(OUT_DIR,'H31_E02_offline_fall_paper.png')});
      if(e02Errors.length||e02Network.length)throw Error('E02 offline errors '+JSON.stringify({e02Errors,e02Network}));
      Object.assign(e02OfflineReport,{open,fall,errors:e02Errors,network:e02Network});
    }finally{await e02Context.close();}
    const e03File=path.join(OUT_DIR,'H33_E03_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','em-ac-field-oscilloscope','--preset','crt-plate-contact','--out',e03File],{stdio:'inherit'});
    const e03Context=await browser.newContext({viewport:VIEWPORT,offline:true}),e03Page=await e03Context.newPage(),e03Errors=[],e03Network=[],e03OfflineReport={};
    e03Page.on('pageerror',e=>e03Errors.push(e.message));e03Page.on('console',m=>{if(m.type()==='error')e03Errors.push(m.text());});e03Page.on('request',r=>{if(/^https?:/.test(r.url()))e03Network.push(r.url());});
    try{
      await e03Page.goto(pathToFileURL(e03File).href);
      const canvas=e03Page.getByTestId('sf-canvas'),read=async()=>JSON.parse(await canvas.getAttribute('data-ac-rendered'));
      await e03Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.acRendered||'null')?.beamStatus===3);
      const blocked=await read();if('screenYCm'in blocked||blocked.trailCount!==0)throw Error('E03 offline blocked screen');
      await e03Page.screenshot({path:path.join(OUT_DIR,'H33_E03_offline_blocked.png')});
      await e03Page.locator('[data-preset-id="square-wave-four-phases"]').click();
      await e03Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.acRendered||'null');return s?.mode==='ac-square-wave'&&s.t===0&&document.querySelector('[data-testid="sf-scope-channel-a"]')?.value==='x0';});
      await e03Page.getByTestId('sf-play-pause').click();
      await e03Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.acRendered||'null')?.t>2.5);
      await e03Page.getByTestId('sf-play-pause').click();
      await e03Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.acRendered||'null'),t=Number(document.querySelector('[data-testid="sf-summary-clock"]')?.dataset.sampleTime),p=Number(document.querySelector('[data-testid="sf-uplot"]')?.dataset.lastSampleT);return s&&Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;},null,{timeout:5000});
      const motion=await read();
      if(Math.abs(motion.xQuarter-2*(motion.t-2.5)**2)>1e-6||Math.abs(motion.vQuarter-4*(motion.t-2.5))>1e-6)throw Error('E03 offline quarter '+JSON.stringify(motion));
      await e03Page.getByRole('button',{name:'黑板深蓝'}).click();await e03Page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
      await e03Page.screenshot({path:path.join(OUT_DIR,'H33_E03_offline_square_paper.png')});
      if(e03Errors.length||e03Network.length)throw Error('E03 offline errors '+JSON.stringify({e03Errors,e03Network}));
      Object.assign(e03OfflineReport,{blocked,motion,errors:e03Errors,network:e03Network});
    }finally{await e03Context.close();}
    const e05File=path.join(OUT_DIR,'H34_E05_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','em-wireframe-rotation','--preset','disk-driven-power','--out',e05File],{stdio:'inherit'});
    const e05Context=await browser.newContext({viewport:VIEWPORT,offline:true}),e05Page=await e05Context.newPage(),e05Errors=[],e05Network=[],e05OfflineReport={};
    e05Page.on('pageerror',e=>e05Errors.push(e.message));e05Page.on('console',m=>{if(m.type()==='error')e05Errors.push(m.text());});e05Page.on('request',r=>{if(/^https?:/.test(r.url()))e05Network.push(r.url());});
    try{
      await e05Page.goto(pathToFileURL(e05File).href);
      const canvas=e05Page.getByTestId('sf-canvas'),read=async()=>JSON.parse(await canvas.getAttribute('data-wire-rendered'));
      await e05Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.wireRendered||'null')?.mode==='faraday-disk');
      const disk0=await read();if(Math.abs(disk0.fluxWb-2*Math.PI)>1e-10||Math.abs(disk0.emTorqueNm+1.5)>1e-10)throw Error('E05 offline disk '+JSON.stringify(disk0));
      await e05Page.getByTestId('sf-play-pause').click();await e05Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.wireRendered||'null')?.t>.5);
      await e05Page.getByTestId('sf-play-pause').click();
      await e05Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.wireRendered||'null'),t=Number(document.querySelector('[data-testid="sf-summary-clock"]')?.dataset.sampleTime),p=Number(document.querySelector('[data-testid="sf-uplot"]')?.dataset.lastSampleT);return s&&Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;},null,{timeout:5000});
      const disk=await read();if(Math.abs(disk.driveWorkJ-4.5*disk.t)>1e-8||Math.abs(disk.jouleHeatJ-disk.driveWorkJ)>1e-8)throw Error('E05 offline drive '+JSON.stringify(disk));
      await e05Page.screenshot({path:path.join(OUT_DIR,'H34_E05_offline_disk.png')});
      await e05Page.locator('[data-preset-id="wireframe-offgrid-flux"]').click();
      await e05Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.wireRendered||'null');return s?.mode==='wireframe-gravity-fall'&&s.t===0&&document.querySelector('[data-testid="sf-scope-channel-a"]')?.value==='fluxWb';});
      await e05Page.getByTestId('sf-play-pause').click();await e05Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.wireRendered||'null')?.t>.62);await e05Page.getByTestId('sf-play-pause').click();
      await e05Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.wireRendered||'null'),t=Number(document.querySelector('[data-testid="sf-summary-clock"]')?.dataset.sampleTime),p=Number(document.querySelector('[data-testid="sf-uplot"]')?.dataset.lastSampleT);return s&&Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;},null,{timeout:5000});
      const fall=await read(),v=-Math.exp(-2*(fall.t-.25)),y=.5-(1+v)/2;
      if(Math.abs(fall.centerY-y)>1e-7||Math.abs(fall.fluxWb-2*(.5-y))>1e-7||fall.eventCount!==1)throw Error('E05 offline analytic fall '+JSON.stringify(fall));
      await e05Page.getByRole('button',{name:'黑板深蓝'}).click();await e05Page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
      await e05Page.screenshot({path:path.join(OUT_DIR,'H34_E05_offline_fall_paper.png')});
      if(e05Errors.length||e05Network.length)throw Error('E05 offline errors '+JSON.stringify({e05Errors,e05Network}));
      Object.assign(e05OfflineReport,{disk0,disk,fall,errors:e05Errors,network:e05Network});
    }finally{await e05Context.close();}
    const e06File=path.join(OUT_DIR,'H35_E06_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','em-eddy-vortex-field','--preset','vortex-neutral-crossing','--out',e06File],{stdio:'inherit'});
    const e06Context=await browser.newContext({viewport:VIEWPORT,offline:true}),e06Page=await e06Context.newPage(),e06Errors=[],e06Network=[],e06OfflineReport={};
    e06Page.on('pageerror',e=>e06Errors.push(e.message));e06Page.on('console',m=>{if(m.type()==='error')e06Errors.push(m.text());});e06Page.on('request',r=>{if(/^https?:/.test(r.url()))e06Network.push(r.url());});
    try{
      await e06Page.goto(pathToFileURL(e06File).href);
      const canvas=e06Page.getByTestId('sf-canvas'),read=async()=>JSON.parse(await canvas.getAttribute('data-eddy-rendered'));
      await e06Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.eddyRendered||'null')?.particleChargeRatio===0);
      await e06Page.getByTestId('sf-play-pause').click();await e06Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.eddyRendered||'null')?.t>1.8);
      await e06Page.getByTestId('sf-play-pause').click();
      await e06Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.eddyRendered||'null'),t=Number(document.querySelector('[data-testid="sf-summary-clock"]')?.dataset.sampleTime),p=Number(document.querySelector('[data-testid="sf-uplot"]')?.dataset.lastSampleT);return s&&Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;},null,{timeout:5000});
      const neutral=await read(),hit=Math.sqrt(1.2**2-.6**2)/.6;
      if(neutral.eventCount!==1||Math.abs(neutral.eventTime-hit)>1e-9||Math.abs(neutral.py+.6*neutral.t)>1e-7||neutral.bLocal!==0)throw Error('E06 offline neutral '+JSON.stringify(neutral));
      await e06Page.screenshot({path:path.join(OUT_DIR,'H35_E06_offline_neutral.png')});
      await e06Page.locator('[data-preset-id="eddy-solid-vs-slotted-pendulum"]').click();
      await e06Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.eddyRendered||'null');return s?.mode==='eddy-damping-compare'&&s.t===0&&document.querySelector('[data-testid="sf-scope-channel-a"]')?.value==='solidAngleDeg';});
      await e06Page.getByTestId('sf-play-pause').click();await e06Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.eddyRendered||'null')?.t>2.5);await e06Page.getByTestId('sf-play-pause').click();
      await e06Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.eddyRendered||'null'),t=Number(document.querySelector('[data-testid="sf-summary-clock"]')?.dataset.sampleTime),p=Number(document.querySelector('[data-testid="sf-uplot"]')?.dataset.lastSampleT);return s&&Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;},null,{timeout:5000});
      const damp=await read(),E0=9.8*(1-Math.cos(35*Math.PI/180));
      if(Math.abs(damp.solidEnergySpecific+damp.solidHeatSpecific-E0)>1e-6||Math.abs(damp.slottedEnergySpecific+damp.slottedHeatSpecific-E0)>1e-6||damp.solidHeatSpecific<=damp.slottedHeatSpecific)throw Error('E06 offline damping '+JSON.stringify(damp));
      await e06Page.getByRole('button',{name:'黑板深蓝'}).click();await e06Page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='projector');
      await e06Page.screenshot({path:path.join(OUT_DIR,'H35_E06_offline_damping_paper.png')});
      if(e06Errors.length||e06Network.length)throw Error('E06 offline errors '+JSON.stringify({e06Errors,e06Network}));
      Object.assign(e06OfflineReport,{neutral,damp,errors:e06Errors,network:e06Network});
    }finally{await e06Context.close();}
    const e07File=path.join(OUT_DIR,'H36_E07_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','em-ac-generator-rms','--preset','duty-square-wave-rms','--out',e07File],{stdio:'inherit'});
    const e07Context=await browser.newContext({viewport:VIEWPORT,offline:true}),e07Page=await e07Context.newPage(),e07Errors=[],e07Network=[],e07OfflineReport={};
    e07Page.on('pageerror',e=>e07Errors.push(e.message));e07Page.on('console',m=>{if(m.type()==='error')e07Errors.push(m.text());});e07Page.on('request',r=>{if(/^https?:/.test(r.url()))e07Network.push(r.url());});
    try{
      await e07Page.goto(pathToFileURL(e07File).href);
      const canvas=e07Page.getByTestId('sf-canvas'),read=async()=>JSON.parse(await canvas.getAttribute('data-generator-rendered'));
      for(const [id,mode] of [['duty-square-wave-rms','duty-square'],['dc-ac-superposition','dc-plus-sine']]){
        if(mode!=='duty-square')await e07Page.locator('[data-preset-id="'+id+'"]').click();
        await e07Page.waitForFunction(mode=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.generatorRendered||'null');return s?.waveform===mode&&s.t===0;},mode);
        checkE07(await read(),mode);
        await e07Page.getByTestId('sf-play-pause').click();await e07Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.generatorRendered||'null')?.t>.72);await e07Page.getByTestId('sf-play-pause').click();
        await e07Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.generatorRendered||'null'),t=Number(document.querySelector('[data-testid="sf-summary-clock"]')?.dataset.sampleTime),p=Number(document.querySelector('[data-testid="sf-uplot"]')?.dataset.lastSampleT);return s&&Math.abs(s.t-t)<1e-10&&Math.abs(s.t-p)<1e-10;},null,{timeout:5000});
        const s=await read();checkE07(s,mode);e07OfflineReport[mode]=s;
        await e07Page.screenshot({path:path.join(OUT_DIR,'H36_E07_offline_'+mode+'.png')});
      }
      if(e07Errors.length||e07Network.length)throw Error('E07 offline errors '+JSON.stringify({e07Errors,e07Network}));
      Object.assign(e07OfflineReport,{errors:e07Errors,network:e07Network});
    }finally{await e07Context.close();}
    const e08File=path.join(OUT_DIR,'H37_E08_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','em-transformer-grid','--preset','primary-resistor-parallel-users','--out',e08File],{stdio:'inherit'});
    const e08Context=await browser.newContext({viewport:VIEWPORT,offline:true}),e08Page=await e08Context.newPage(),e08Errors=[],e08Network=[],e08OfflineReport={};
    e08Page.on('pageerror',e=>e08Errors.push(e.message));e08Page.on('console',m=>{if(m.type()==='error')e08Errors.push(m.text());});e08Page.on('request',r=>{if(/^https?:/.test(r.url()))e08Network.push(r.url());});
    try{
      await e08Page.goto(pathToFileURL(e08File).href);
      for(const [id,expected] of [['primary-resistor-parallel-users',{mode:'multi-tap-transformer',parallelUsersCount:2,branch3Closed:true}],['high-voltage-10x-vs-20x',{mode:'long-distance-grid',stepUpRatioK1:20,genPowerKw:100}],['grid-infeasible-request',{mode:'long-distance-grid',operatingPointValid:0}],['grid-zero-power',{mode:'long-distance-grid',genPowerKw:0,efficiencyDefined:0}]]){
        if(id!=='primary-resistor-parallel-users')await e08Page.locator('[data-preset-id="'+id+'"]').click();
        const s=await waitE08Display(e08Page,true,expected);e08OfflineReport[id]=s;
        if(await e08Page.getByTestId('sf-uplot').isVisible())throw Error('E08 offline static scope visible');
        await e08Page.screenshot({path:path.join(OUT_DIR,'H37_E08_offline_'+id+'.png')});
      }
      if(e08Errors.length||e08Network.length)throw Error('E08 offline errors '+JSON.stringify({e08Errors,e08Network}));
      Object.assign(e08OfflineReport,{errors:e08Errors,network:e08Network});
    }finally{await e08Context.close();}
    const e09File=path.join(OUT_DIR,'H38_E09_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','em-lc-rlc-oscillation','--preset','lc-free-energy-exchange','--out',e09File],{stdio:'inherit'});
    const e09Context=await browser.newContext({viewport:VIEWPORT,offline:true}),e09Page=await e09Context.newPage(),e09Errors=[],e09Network=[],e09OfflineReport={};
    e09Page.on('pageerror',e=>e09Errors.push(e.message));e09Page.on('console',m=>{if(m.type()==='error')e09Errors.push(m.text());});e09Page.on('request',r=>{if(/^https?:/.test(r.url()))e09Network.push(r.url());});
    try{
      await e09Page.goto(pathToFileURL(e09File).href);
      for(const [id,kind,mode] of [['lc-free-energy-exchange',0,'lc-undamped'],['rlc-damped-decay',0,'rlc-damped'],['lc-lossless-resonance',3,'rlc-ac-resonance']]){
        if(id!=='lc-free-energy-exchange')await e09Page.locator('[data-preset-id="'+id+'"]').click();
        await e09Page.waitForFunction(({kind,mode})=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.lcRendered||'null');return s?.responseKind===kind&&s.mode===mode&&s.t===0;},{kind,mode});
        checkE09(JSON.parse(await e09Page.getByTestId('sf-canvas').getAttribute('data-lc-rendered')));
        await e09Page.getByTestId('sf-play-pause').click();await e09Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.lcRendered||'null')?.t>.78);await e09Page.getByTestId('sf-play-pause').click();
        const s=await syncE09(e09Page,true);e09OfflineReport[id]=s;
        await e09Page.screenshot({path:path.join(OUT_DIR,'H38_E09_offline_'+id+'.png')});
      }
      if(e09Errors.length||e09Network.length)throw Error('E09 offline errors '+JSON.stringify({e09Errors,e09Network}));
      Object.assign(e09OfflineReport,{errors:e09Errors,network:e09Network});
    }finally{await e09Context.close();}
    const e10File=path.join(OUT_DIR,'H39_E10_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','em-3d-magnetic-fields','--preset','uniform-negative-charge','--out',e10File],{stdio:'inherit'});
    const e10Context=await browser.newContext({viewport:VIEWPORT,offline:true}),e10Page=await e10Context.newPage(),e10Errors=[],e10Network=[],e10OfflineReport={};
    e10Page.on('pageerror',e=>e10Errors.push(e.message));e10Page.on('console',m=>{if(m.type()==='error')e10Errors.push(m.text());});e10Page.on('request',r=>{if(/^https?:/.test(r.url()))e10Network.push(r.url());});
    try{
      await e10Page.goto(pathToFileURL(e10File).href);
      for(const [id,geometry,qm] of [['uniform-negative-charge','uniform-helix',-4],['uniform-zero-field','uniform-helix',1],['finite-wire-reverse','straight-wire',1.2]]){
        if(id!=='uniform-negative-charge')await e10Page.locator('[data-preset-id="'+id+'"]').click();
        await e10Page.waitForFunction(({geometry,qm})=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.magneticRendered||'null');return s?.geometryType===geometry&&s.qOverM===qm&&s.t===0;},{geometry,qm});
        checkE10(JSON.parse(await e10Page.getByTestId('sf-canvas').getAttribute('data-magnetic-rendered')));
        await e10Page.getByTestId('sf-play-pause').click();await e10Page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.magneticRendered||'null')?.t>.4);await e10Page.getByTestId('sf-play-pause').click();
        await e10Page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.magneticRendered||'null'),p=Number(document.querySelector('[data-testid="sf-uplot"]')?.dataset.lastSampleT),t=Number(document.querySelector('[data-testid="sf-magnetic-readouts"]')?.dataset.sampleTime);return s&&Math.abs(s.t-t)<1e-9&&Math.abs(s.t-p)<1e-9;});
        const s=checkE10(JSON.parse(await e10Page.getByTestId('sf-canvas').getAttribute('data-magnetic-rendered')));e10OfflineReport[id]=s;
        await e10Page.screenshot({path:path.join(OUT_DIR,'H39_E10_offline_'+id+'.png')});
      }
      if(e10Errors.length||e10Network.length)throw Error('E10 offline errors '+JSON.stringify({e10Errors,e10Network}));
      Object.assign(e10OfflineReport,{errors:e10Errors,network:e10Network});
    }finally{await e10Context.close();}
    const w01File=path.join(OUT_DIR,'H40_W01_offline.html');
    execFileSync(process.execPath,[path.resolve(SCRIPT_DIR,'../apps/singlefile-exporter/export.mjs'),'--model','wave-vibration-coupling','--preset','causal-wavefront-startup','--out',w01File],{stdio:'inherit'});
    const w01Context=await browser.newContext({viewport:VIEWPORT,offline:true}),w01Page=await w01Context.newPage(),w01Errors=[],w01Network=[],w01OfflineReport={};
    w01Page.on('pageerror',e=>w01Errors.push(e.message));w01Page.on('console',m=>{if(m.type()==='error')w01Errors.push(m.text());});w01Page.on('request',r=>{if(/^https?:/.test(r.url()))w01Network.push(r.url());});
    try{
      await w01Page.goto(pathToFileURL(w01File).href);
      for(const [id,mode,stop] of [['causal-wavefront-startup','transverse',1.43],['standing-wave-node','standing',.38],['interference-causal-two-arrivals','interference',.85],['doppler-offaxis','doppler',1.45]]){
        if(id!=='causal-wavefront-startup')await w01Page.locator('[data-preset-id="'+id+'"]').click();
        await w01Page.waitForFunction(mode=>{const s=JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.waveRendered||'null');return s?.mode===mode&&s.t===0;},mode);
        checkW01(JSON.parse(await w01Page.getByTestId('sf-canvas').getAttribute('data-wave-rendered')));
        await w01Page.getByTestId('sf-play-pause').click();await w01Page.waitForFunction(t=>JSON.parse(document.querySelector('[data-testid="sf-canvas"]')?.dataset.waveRendered||'null')?.t>t,stop,{timeout:15000});await w01Page.getByTestId('sf-play-pause').click();
        w01OfflineReport[id]=await syncW01(w01Page,true);
        await w01Page.screenshot({path:path.join(OUT_DIR,'H40_W01_offline_'+id+'.png')});
      }
      if(w01Errors.length||w01Network.length)throw Error('W01 offline errors '+JSON.stringify({w01Errors,w01Network}));
      Object.assign(w01OfflineReport,{errors:w01Errors,network:w01Network});
    }finally{await w01Context.close();}
    const summary = { w01Report,w01OfflineReport,e10MagneticReport,e10OfflineReport,e09LcReport,e09OfflineReport,e08TransformerReport,e08OfflineReport,e07GeneratorReport,e07OfflineReport,e06EddyReport,e06OfflineReport,e05WireframeReport,e05OfflineReport,e03AcScopeReport,e03OfflineReport,e02CapacitorReport,e02OfflineReport,e01ElectrostaticReport,e01OfflineReport,m11ShmReport,m11OfflineReport,m09CollisionReport,m09OfflineReport,m08SpringReport,m08OfflineReport,m07TurntableReport,m07OfflineReport,m06VerticalReport,m06OfflineReport,m05ContactReport,m05OfflineReport,m04ProjectileReport,m04OfflineReport,m03ConstraintReport,m03OfflineReport,m02EquilibriumReport,m02OfflineReport,m01ChaseReport,m01OfflineReport,b5OdeReport,b5OfflineReport,b4OfflineReport,b4AnalyticReport,b3OfflineReport,b2OfflineReport,m10PhysicsReport,s01PhysicsReport,report, waveBCoordinateReport, waveCInteractionReport, v3MorphReport, v3StoryFormulaReport, v3DeviceReport, b1PhysicsReport, consoleErrors, pageErrors, failedResponses, externalRequests, screenshots: OUT_DIR };
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
