import type { DiagramPrimitive } from '@physforge/sim-sdk';
import { equilibriumAngleSamples, type EquilibriumAngleSample, type EquilibriumParams, type EquilibriumState, type Point } from './engine.js';

export type AnalysisRole='ink'|'force1'|'force2'|'gravity';
export interface AnalysisItem {primitive:DiagramPrimitive;role:AnalysisRole}
const line=(a:Point,b:Point,role:AnalysisRole='ink',dashed=false):AnalysisItem=>({role,primitive:{kind:'line',x1:a.x,y1:a.y,x2:b.x,y2:b.y,dashed}});
const text=(x:number,y:number,value:string,align:'start'|'middle'|'end'='middle',role:AnalysisRole='ink'):AnalysisItem=>({role,primitive:{kind:'text',x,y,text:value,align}});
const dot=(p:Point,role:AnalysisRole):AnalysisItem=>({role,primitive:{kind:'circle',cx:p.x,cy:p.y,r:.023,fill:true}});
const move=(p:Point,u:Point,k:number)=>({x:p.x+k*u.x,y:p.y+k*u.y});
export function forceNames(s:EquilibriumState):readonly [string,string]{
  if(s.mode==='hinged-rod')return ['|C|','T'];
  if(s.mode==='fixed-rod')return ['|R|','T'];
  if(s.mode==='hemisphere-similar')return ['N','F'];
  if(s.mode==='hemisphere-suspension')return ['N','T'];
  return ['T₁','T₂'];
}
/** The right angle construction is in force space, not the rod's spatial geometry.
 * B represents -G, A is the orthogonal projection of B onto the fixed force line.
 */
export function minimumAuxiliaryCircle(s:EquilibriumState){
  if(s.mode!=='dead-knot-rotate'&&s.mode!=='hinged-rod')return null;
  const u=s.rod?.axis??s.direction1, W=s.gravity.mag;
  const a={x:W*u.y*u.x,y:W*u.y*u.y},b={x:0,y:W};
  return {a,b,radius:W/2,center:{x:0,y:W/2},minimumN:Math.hypot(b.x-a.x,b.y-a.y)};
}
export function auxiliaryItems(s:EquilibriumState):AnalysisItem[]{
  const g=minimumAuxiliaryCircle(s);
  if(!g)return [text(2.45,.65,'辅助圆适用于死结与动杆'),text(2.45,.40,'请选择对应课堂预设')];
  const o={x:2.45,y:-.72},k=1.4/s.gravity.mag,a=move(o,g.a,k),b=move(o,g.b,k),center=move(o,g.center,k);
  const toO={x:(o.x-a.x)/Math.hypot(o.x-a.x,o.y-a.y),y:(o.y-a.y)/Math.hypot(o.x-a.x,o.y-a.y)};
  const toB={x:(b.x-a.x)/Math.hypot(b.x-a.x,b.y-a.y),y:(b.y-a.y)/Math.hypot(b.x-a.x,b.y-a.y)};
  const q=move(a,toO,.10),r=move(q,toB,.10),z=move(a,toB,.10);
  return [
    text(2.45,1.13,'辅助圆 · 最小拉力构型'),
    {role:'ink',primitive:{kind:'circle',cx:center.x,cy:center.y,r:g.radius*k,dashed:true}},
    line(o,b,'gravity',true),line(o,a,'force1'),line(a,b,'force2'),line(q,r),line(r,z),dot(a,'force1'),dot(o,'ink'),dot(b,'gravity'),
    text(o.x+.10,o.y-.10,'O','start'),text(b.x+.1,b.y+.06,'B = −G','start','gravity'),
    text(a.x+(a.x<o.x?-.09:.09),a.y+.05,'A',a.x<o.x?'end':'start','force1'),
    text(2.45,-.99,'OA ⟂ AB · Tₘᵢₙ = '+g.minimumN.toFixed(2)+' N','middle','force2'),
    text(2.45,-1.20,'力空间构造，不是当前受力箭头')
  ];
}
let cachedKey='',cachedSamples:EquilibriumAngleSample[]=[];
function samplesFor(p:EquilibriumParams){
  const key=JSON.stringify([p.mode,p.mass,p.baseAngleDeg,p.radiusM,p.anchorHeightM,p.rodLengthM,p.pullForceN]);
  if(key!==cachedKey){cachedKey=key;cachedSamples=equilibriumAngleSamples(p);}
  return cachedSamples;
}
const num=(x:number)=>x>=1000?x.toExponential(1):Number(x.toPrecision(3)).toString();
export function anglePlotItems(s:EquilibriumState,p:EquilibriumParams):AnalysisItem[]{
  const samples=samplesFor(p);
  const lo=samples[0]?.angleDeg??0,hi=samples.at(-1)?.angleDeg??1;
  const values=samples.flatMap(x=>[x.force1??0,x.force2??0]);
  const maxN=Math.max(1,...values,s.status==='balanced'?s.force1.mag:0,s.status==='balanced'?s.force2.mag:0);
  const raw=maxN/4,pow=10**Math.floor(Math.log10(raw)),frac=raw/pow;
  const tick=(frac<=1?1:frac<=2?2:frac<=5?5:10)*pow,yMax=Math.ceil(maxN/tick)*tick;
  const left=1.60,right=3.65,bottom=-.77,top=.82;
  const pos=(a:number,v:number):Point=>({x:left+(a-lo)/(hi-lo)*(right-left),y:bottom+v/yMax*(top-bottom)});
  const names=forceNames(s),angleName=s.mode==='dead-knot-rotate'||s.rod?'β':'θ';
  const items:AnalysisItem[]=[text(2.63,1.25,'解析力—角度函数'),text(1.60,1.03,names[0]+' / N','start','force1'),text(3.65,1.03,names[1]+' / N','end','force2')];
  for(let i=0;i<=Math.round(yMax/tick);i++){
    const value=i*tick,a=pos(lo,value),b=pos(hi,value);
    items.push(line(a,b,'ink',i!==0),text(left-.06,a.y,num(value),'end'));
  }
  items.push(line(pos(lo,0),pos(lo,yMax)),line(pos(lo,0),pos(hi,0)));
  for(const a of [lo,(lo+hi)/2,hi]){
    const q=pos(a,0);items.push(line(q,{x:q.x,y:q.y-.04}),text(q.x,q.y-.13,num(a)+'°'));
  }
  items.push(text(right,-1.02,angleName+' / °','end'));
  for(const [key,role] of [['force1','force1'],['force2','force2']] as const){
    let prev:Point|null=null;
    for(const sample of samples){
      const val=sample[key];
      if(val===null){prev=null;continue;}
      const q=pos(sample.angleDeg,val);
      if(prev)items.push(line(prev,q,role));prev=q;
    }
  }
  items.push(line(pos(s.activeAngleDeg,0),pos(s.activeAngleDeg,yMax),'gravity',true));
  if(s.status==='balanced')items.push(dot(pos(s.activeAngleDeg,s.force1.mag),'force1'),dot(pos(s.activeAngleDeg,s.force2.mag),'force2'));
  items.push(text(2.63,-1.23,'每 1° 解析采样 · 无解断开'));
  return items;
}
/** Print the same geometric primitives below the main diagram, not an
 * independently re-derived picture. */
export function shiftedAnalysis(items:readonly AnalysisItem[],dy:number):DiagramPrimitive[]{
  return items.map(({primitive:d}):DiagramPrimitive=>{
    if(d.kind==='line')return {...d,y1:d.y1+dy,y2:d.y2+dy};
    if(d.kind==='circle')return {...d,cy:d.cy+dy};
    if(d.kind==='text')return {...d,y:d.y+dy};
    return d;
  });
}
