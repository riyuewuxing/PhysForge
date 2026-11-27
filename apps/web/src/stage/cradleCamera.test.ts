import { describe,it,expect } from 'vitest';
import type { Viewport } from '@physforge/sim-sdk';
import { cradleBodiesFit, fitCradleCamera, type CradleBody } from './cradleCamera.js';

const vp:Viewport={width:976,height:720,dpr:1,scale:.58,offsetX:48.8,offsetY:0};
const compact={left:28,right:676,top:28,bottom:515};
const ball=(x:number,y=-.96):CradleBody=>({x,y,halfW:.24,halfH:.24,dynamic:true});
const rail={x:0,y:-1.35,halfW:5,halfH:.15,dynamic:false};
describe('B4 cradle real safe camera',()=>{
  it('reframes actual moving balls and reserves the measured text margin at compact width',()=>{
    const bodies=[rail,ball(0),ball(.5),ball(1),ball(2.65)];
    expect(cradleBodiesFit(bodies,vp,compact,60)).toBe(false);
    const before=JSON.stringify(bodies),next=fitCradleCamera(bodies,vp,compact,60);
    expect(next).not.toBeNull();
    expect(cradleBodiesFit(bodies,next!,compact,60)).toBe(true);
    expect(next!.scale).toBeLessThanOrEqual(.58);
    expect(JSON.stringify(bodies)).toBe(before);
    expect(cradleBodiesFit(bodies,next!,compact,60)).toBe(true);
  });
  it('fits both axes with the same scale and ignores the static rail',()=>{
    const bodies=[ball(-2),ball(0),ball(.5),ball(1)];
    const a=fitCradleCamera(bodies,vp,compact,60);
    const b=fitCradleCamera([rail,...bodies],vp,compact,60);
    expect(a).toEqual(b);
    expect(cradleBodiesFit(bodies,a!,compact,60)).toBe(true);
    const expanded={left:28,right:950,top:28,bottom:680};
    expect(cradleBodiesFit(bodies,a!,expanded,60)).toBe(true);
  });
  it('does not fabricate a fit for empty, non-finite or impossibly narrow input',()=>{
    expect(fitCradleCamera([rail],vp,compact,60)).toBeNull();
    expect(fitCradleCamera([ball(NaN)],vp,compact,60)).toBeNull();
    expect(fitCradleCamera([ball(0)],vp,{...compact,right:100},60)).toBeNull();
  });
});
