import { describe,it,expect } from 'vitest';
import { layoutCradleLabels,type CradleLabel } from './cradleLabelLayout.js';

const label=(id:string,x:number,top=510,bottom=568,width=115):CradleLabel=>({id,text:id+' vₓ=0.00 m/s',color:'#38bdf8',x,top,bottom,width});
describe('B4 cradle velocity label lanes',()=>{
  it('separates the touching three-ball cluster while reusing a lane for the distant ball',()=>{
    const input=[label('1',640),label('2',700),label('3',760),label('4',930)];
    const out=layoutCradleLabels(input,1392,852);
    expect(out.map(x=>x.id)).toEqual(['1','2','3','4']);
    expect(out.map(x=>x.lane)).toEqual([0,1,2,0]);
    expect(out.every(x=>x.y<510&&x.y>=42)).toBe(true);
    for(let i=0;i<out.length;i++)for(let j=i+1;j<out.length;j++){
      const a=out[i]!,b=out[j]!;
      expect(Math.abs(a.y-b.y)>=22||Math.abs(a.x-b.x)>=(a.width+b.width)/2+8).toBe(true);
    }
    expect(input.map(x=>x.x)).toEqual([640,700,760,930]);
  });
  it('keeps separate text lanes even at nearly identical screen x and preserves ids/colors',()=>{
    const input=[label('3',5,100,140,140),label('1',4,100,140),label('2',4,100,140)];
    const out=layoutCradleLabels(input,320,500);
    expect(new Set(out.map(x=>x.lane)).size).toBe(3);
    expect(out.every(x=>x.x-x.width/2>=6&&x.x+x.width/2<=314)).toBe(true);
    expect(out.every(x=>x.y>140)).toBe(true);
    expect(out.map(x=>x.id)).toEqual(['1','2','3']);
  });
  it('leaves spaced labels on a common row and handles an empty list',()=>{
    expect(layoutCradleLabels([label('1',100),label('2',300)],500,700).map(x=>x.lane)).toEqual([0,0]);
    expect(layoutCradleLabels([],500,700)).toEqual([]);
  });
});
