import {describe,it,expect} from 'vitest';
import {DynamicTubeTrail} from './dynamicTubeTrail.js';

describe('dynamic magnetic trail',()=>{
  it('retains allocated buffers and keeps ring centers on real samples',()=>{
    const tube=new DynamicTubeTrail(3,.012,6),geo=tube.geometry;
    const positions=geo.getAttribute('position'),normals=geo.getAttribute('normal'),index=geo.index;
    const samples=[{x:-2,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:1,z:0},{x:1,y:1,z:1}];
    tube.update(samples,p=>({x:p.z,y:p.y,z:-p.x}));
    expect(geo.drawRange.count).toBe(72);
    for(let i=0;i<3;i++){
      const sample=samples[i+1]!;
      let x=0,y=0,z=0;
      for(let j=0;j<6;j++){const k=i*6+j;x+=positions.getX(k);y+=positions.getY(k);z+=positions.getZ(k);
        expect(Math.hypot(normals.getX(k),normals.getY(k),normals.getZ(k))).toBeCloseTo(1,5);
      }
      expect(x/6).toBeCloseTo(sample.z,6);expect(y/6).toBeCloseTo(sample.y,6);expect(z/6).toBeCloseTo(-sample.x,6);
    }
    tube.update([samples[0]!],p=>p);
    expect(geo.drawRange.count).toBe(0);
    tube.update([samples[0]!,samples[0]!,samples[1]!],p=>p);
    expect(geo.drawRange.count).toBe(72);
    expect(geo.getAttribute('position')).toBe(positions);expect(geo.getAttribute('normal')).toBe(normals);expect(geo.index).toBe(index);
    for(let k=0;k<18;k++)expect(Number.isFinite(positions.getX(k)+positions.getY(k)+positions.getZ(k))).toBe(true);
    tube.update([{x:NaN,y:0,z:0},samples[1]!],p=>p);expect(geo.drawRange.count).toBe(0);
    geo.dispose();
  });
});
