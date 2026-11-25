import { describe, expect, it } from 'vitest';
import { createWorldMapper, resolveInitialCameraTransform, resolvePluginParams } from '@physforge/sim-sdk';
import { opticsRayStudioPlugin } from './plugin.js';
import { createInitialState, slitIntensity, type OpticsParams } from './engine.js';
import { opticalScene, SLIT_SCREEN } from './sceneGeometry.js';

describe('B3 builder-optics-ray V2 verification', () => {
  it('fits real interface rays in the desktop workbench without distorting angles', () => {
    for(const angle of [0,35,41,50,85]) {
      const params=resolvePluginParams<OpticsParams>(opticsRayStudioPlugin.paramSchema,{sceneMode:'tir-interface',n1:1.5,n2:1,incidentAngleDeg:angle,animateSweep:false});
      const state=createInitialState(params);
      for(const [width,height] of [[976,720],[1392,852]] as const) {
        const m=createWorldMapper({width,height,dpr:1,...resolveInitialCameraTransform(opticsRayStudioPlugin,params,width,height)});
        for(const r of state.rays) for(const point of [r.from,r.to]) {
          const s=m.toScreen(point.x,point.y);
          expect(s.x).toBeGreaterThan(12);expect(s.x).toBeLessThan(width-280-12);
          expect(s.y).toBeGreaterThan(12);expect(s.y).toBeLessThan(height-12);
        }
      }
      const ir=opticsRayStudioPlugin.exportDiagramIR?.(state,params);
      expect(ir?.primitives.filter(p=>p.kind==='arcAngle')).toHaveLength(state.isTotalInternalReflection?1:2);
      if(state.isTotalInternalReflection)expect(opticsRayStudioPlugin.formatFormulas?.(state,params)[0]?.latex).not.toContain('sin\\\\theta_2');
    }
  });

  it('satisfies critical angle < 0.01 deg, parallel slab shift < 1e-6, and thin-lens formula < 1e-5', () => {
    // 1) Critical angle arcsin(1.0 / 1.5)
    const tirParams = resolvePluginParams<OpticsParams>(opticsRayStudioPlugin.paramSchema, {
      sceneMode: 'tir-interface',
      n1: 1.5,
      n2: 1.0,
      incidentAngleDeg: 35,
      animateSweep: false
    });
    const tirState = createInitialState(tirParams);
    const expectedCrit = (Math.asin(1.0 / 1.5) * 180) / Math.PI;
    expect(Math.abs(tirState.criticalAngleDeg! - expectedCrit)).toBeLessThan(0.01);

    // 2) Thin lens 1/u + 1/v = 1/f (< 1e-5) for both real (u > f) and virtual (u < f) images
    for (const u of [1.4, 0.45]) {
      const f = 0.65;
      const lensParams = resolvePluginParams<OpticsParams>(opticsRayStudioPlugin.paramSchema, {
        sceneMode: 'thin-lens-imaging',
        focalLengthM: f,
        objectDistanceM: u,
        animateSweep: false
      });
      const lensState = createInitialState(lensParams);
      const v = lensState.imageDistanceM!;
      const lhs = 1 / u + 1 / v;
      const rhs = 1 / f;
      expect(Math.abs(lhs - rhs) / rhs).toBeLessThan(1e-5);
    }

    const ir = opticsRayStudioPlugin.exportDiagramIR?.(tirState, tirParams);
    expect(ir?.primitives.some((p) => p.kind === 'arcAngle')).toBe(true);
  });

  it('anchors the draggable incident-angle control on the illuminated interface ring', () => {
    const params = resolvePluginParams<OpticsParams>(opticsRayStudioPlugin.paramSchema, {
      sceneMode: 'tir-interface',
      n1: 1.5,
      n2: 1,
      incidentAngleDeg: 35,
      animateSweep: false
    });
    const state = createInitialState(params);
    const handle = opticsRayStudioPlugin.getControlHandles?.(state, params)[0];

    expect(handle?.position).toEqual({ x: 0, y: 0 });
    expect(handle?.showWhenIdle).toBe(false);
    expect(handle?.onDrag({ x: -Math.sin((35 * Math.PI) / 180), y: Math.cos((35 * Math.PI) / 180) }).incidentAngleDeg)
      .toBe(35);
  });
});

describe('H9 shared optical scene',()=>{
  it('keeps all five presets finite and their physical rays in the exported geometry',()=>{
    for(const preset of opticsRayStudioPlugin.presets.slice(1)){
      const p=resolvePluginParams<OpticsParams>(opticsRayStudioPlugin.paramSchema,preset.params);
      const state=createInitialState(p),scene=opticalScene(state,p),ir=opticsRayStudioPlugin.exportDiagramIR!(state,p);
      expect(ir.primitives).toEqual(scene.marks.map(m=>m.primitive));
      for(const ray of state.rays)expect(ir.primitives.some(q=>(q.kind==='line'||q.kind==='arrow')&&q.x1===ray.from.x&&q.y1===ray.from.y&&q.x2===ray.to.x&&q.y2===ray.to.y&&Boolean(q.dashed)===Boolean(ray.dashed))).toBe(true);
      expect(scene.marks.length).toBeGreaterThan(5);
      if(p.sceneMode==='double-slit')expect(opticsRayStudioPlugin.getControlHandles!(state,p)).toEqual([]);
      else if(p.sceneMode==='thin-lens-imaging'){
        const handle=opticsRayStudioPlugin.getControlHandles!(state,p)[0]!;
        expect(handle.position).toEqual({x:-(p.objectDistanceM??1.2),y:.55});
        expect(handle.showWhenIdle).toBe(false);
        expect(handle.onDrag({x:-.65,y:.55}).objectDistanceM).toBe(.65);
      }else{
        const handle=opticsRayStudioPlugin.getControlHandles!(state,p)[0]!;
        expect(handle.position).toEqual(state.rays[0]!.from);
        expect(handle.onDrag(handle.position).incidentAngleDeg).toBe(state.activeAngleDeg);
      }
    }
  });
  it('uses one fixed mm scale for the screen profile and normalized interference curve',()=>{
    const p=resolvePluginParams<OpticsParams>(opticsRayStudioPlugin.paramSchema,{sceneMode:'double-slit',wavelengthNm:600,slitSeparationMm:.5,screenDistanceM:1.5});
    const state=createInitialState(p),scene=opticalScene(state,p);
    expect(slitIntensity(0,state.fringeSpacingMm)).toBe(1);
    expect(slitIntensity(state.fringeSpacingMm/2,state.fringeSpacingMm)).toBeCloseTo(0,12);
    expect(slitIntensity(state.fringeSpacingMm,state.fringeSpacingMm)).toBeCloseTo(1,12);
    for(const q of scene.profile!)expect((q.x-SLIT_SCREEN.curveX)/SLIT_SCREEN.curveWidth).toBeCloseTo(Math.cos(Math.PI*q.y*2.5/state.fringeSpacingMm)**2,12);
    for(const mm of [-4,-2,0,2,4]){
      const mark=scene.marks.find(m=>m.primitive.kind==='text'&&m.primitive.text===String(mm)+' mm');
      expect(mark?.fixedLabel).toBe(true);
      if(mark?.primitive.kind!=='text')throw Error('Missing metric tick');
      expect(mark.primitive.y).toBe(mm/2.5);
      expect(mark.primitive.align).toBe('end');
    }
    expect(scene.profile![0]!.y).toBe(-1.6);expect(scene.profile!.at(-1)!.y).toBe(1.6);
  });
});
