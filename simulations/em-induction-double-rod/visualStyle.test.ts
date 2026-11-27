import { describe,expect,it } from 'vitest';
import { inductionArrowLength,inductionVisualPalette,inductionWakeExtent } from './visualStyle.js';

function luminance(hex:string):number{
  const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  return rgb.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
    .reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i]!,0);
}
describe('E04 presentation-only style',()=>{
  it('preserves direction, magnitude ordering and zero, with bounded vector length',()=>{
    expect(inductionArrowLength(0,60,135)).toBe(0);
    expect(inductionArrowLength(1,60,135)).toBe(60);
    expect(inductionArrowLength(-1,60,135)).toBe(-60);
    expect(inductionArrowLength(100,60,135)).toBe(135);
    expect(inductionArrowLength(NaN,60,135)).toBe(0);
  });
  it('places the decorative wake behind both motion directions, never at rest',()=>{
    expect(inductionWakeExtent(0)).toBe(0);
    expect(inductionWakeExtent(.01)).toBe(0);
    expect(inductionWakeExtent(1)).toBe(-70);
    expect(inductionWakeExtent(-1)).toBe(70);
    expect(inductionWakeExtent(100)).toBe(-165);
    expect(inductionWakeExtent(Infinity)).toBe(0);
  });
  it('uses projector-readable text colors for every diagram annotation',()=>{
    const p=inductionVisualPalette(true);
    for(const color of [p.loadLabel,p.currentLabel,p.force,p.velocity,p.external,p.rod2Label,p.note]){
      expect(1.05/(luminance(color)+.05)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
