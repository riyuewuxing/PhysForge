import type {DiagramPrimitive} from '@physforge/sim-sdk';
import {computeSpeedStatistics,type ThermoCycleMdParams,type ThermoCycleMdState} from './engine.js';
type Tone='ink'|'grid'|'gas'|'pollen'|'heat'|'work'|'cool'|'adiabat'|'sample'|'theory'|'alert';
export interface ThermalMark{primitive:DiagramPrimitive;tone:Tone}
const P=(x:number,y:number)=>({x,y});
const num=(v:number)=>Math.abs(v)>=1000?v.toFixed(0):v.toFixed(1);
const signed=(v:number)=>(v>0?'+':'')+num(v);
const niceMax=(v:number)=>{
  if(!(v>0))return 1;
  const s=10**Math.floor(Math.log10(v)),r=v/s;
  return s*(r<=1?1:r<=2?2:r<=5?5:10);
};
export const THERMAL_BOUNDS={minX:-2.42,minY:-1.42,maxX:2.42,maxY:1.52};
export function thermalGeometry(s:ThermoCycleMdState,p:ThermoCycleMdParams){
  const marks:ThermalMark[]=[];
  const push=(primitive:DiagramPrimitive,tone:Tone='ink')=>marks.push({primitive,tone});
  const line=(x1:number,y1:number,x2:number,y2:number,tone:Tone='ink',dashed=false)=>push({kind:'line',x1,y1,x2,y2,dashed},tone);
  const text=(x:number,y:number,text:string,tone:Tone='ink',align:'start'|'middle'|'end'='middle')=>push({kind:'text',x,y,text,align},tone);
  const circle=(x:number,y:number,r:number,tone:Tone)=>push({kind:'circle',cx:x,cy:y,r,fill:true},tone);
  if(p.mode==='kinetic-md-box'){
    const x=-2.2,y=-1.08,w=2.12,L=s.boxSize,map=(q:{x:number;y:number})=>P(x+q.x*w/L,y+q.y*w/L);
    push({kind:'rect',x,y,width:w,height:w},'grid');
    text(x+w/2,1.36,'二维硬盘 · 绝热反射盒');text(x+w/2,1.18,'气体 '+s.particles.filter(q=>q.mass===1).length+' 个'+(p.brownianPollen?' · 花粉 1 个':''));
    if(s.brownianTrail.length>1)push({kind:'trajectory',points:s.brownianTrail.map(map),strokeWidth:1.5},'pollen');
    for(const q of s.particles){const a=map(q);circle(a.x,a.y,q.radius*w/L,q.mass>2?'pollen':'gas');}
    text(x+w/2,-1.23,'总动能 '+num(s.kineticEnergy)+'（约化单位）');
    const stats=computeSpeedStatistics(s.particles),top=stats.bins.at(-1)!.hi;
    const hx=.32,hy=-.95,hw=1.92,hh=1.75;
    const ymax=niceMax(Math.max(.01,...stats.bins.map(b=>Math.max(b.fraction,b.expectedFraction)))*1.05);
    const mx=(v:number)=>hx+hw*v/top,my=(v:number)=>hy+hh*v/ymax;
    text(hx+hw/2,1.36,'实测速率分布 · N='+stats.count);text(hx+hw/2,1.18,'样本拟合二维参考，非显著性检验');
    line(hx,hy,hx+hw,hy);line(hx,hy,hx,hy+hh);
    for(let i=0;i<=4;i++){
      const q=ymax*i/4,Y=my(q);line(hx-.035,Y,hx,Y);text(hx-.07,Y,(q*100).toFixed(0)+'%','ink','end');
      if(i>0)line(hx,Y,hx+hw,Y,'grid',true);
      const v=top*i/4,X=mx(v);line(X,hy,X,hy-.035);text(X,hy-.12,num(v));
    }
    text(hx+hw/2,-1.2,'速率 v*（约化）');text(hx,1.00,'每箱比例','ink','start');
    for(const b of stats.bins){
      const lo=mx(b.lo)+.006,hi=mx(b.hi)-.006;
      push({kind:'rect',x:lo,y:hy,width:Math.max(.001,hi-lo),height:Math.max(0,my(b.fraction)-hy)},'sample');
      line(lo,my(b.expectedFraction),hi,my(b.expectedFraction),'theory',true);
    }
    text(hx+hw/2,.98,'实测柱 · 拟合期望虚线','theory');
    text(hx+hw/2,-1.37,'D='+stats.cdfDistance.toFixed(3)+' · 理论尾部 '+(stats.theoreticalTail*100).toFixed(3)+'%');
    return {marks,stats};
  }
  const c=s.cycle;
  if(!c.valid){text(0,.35,'当前参数无有效热机循环','alert');text(0,.05,'卡诺要求 T_H > T_C > 0；体积比 > 1','alert');text(0,-.23,'保持输入，不自动改写热源温度');return {marks,stats:null};}
  const all=c.segments.flatMap(q=>q.points),x0=-2.16,x1=.10,y0=-1.02,y1=1.04;
  const vmax=niceMax(Math.max(...all.map(q=>q.vL))*1.05),pmax=niceMax(Math.max(...all.map(q=>q.pKPa))*1.05);
  const mx=(v:number)=>x0+(x1-x0)*v/vmax,my=(v:number)=>y0+(y1-y0)*v/pmax;
  const map=(q:{vL:number;pKPa:number})=>P(mx(q.vL),my(q.pKPa));
  text((x0+x1)/2,1.38,p.mode==='cycle-carnot'?'卡诺循环 · 解析 P–V 路径':'矩形循环 · 解析 P–V 路径');
  text(x0,1.19,'P / kPa','ink','start');line(x0,y0,x1,y0);line(x0,y0,x0,y1);
  for(let i=0;i<=4;i++){
    const v=vmax*i/4,X=mx(v),pv=pmax*i/4,Y=my(pv);
    line(X,y0,X,y0-.035);text(X,y0-.13,num(v));line(x0-.035,Y,x0,Y);text(x0-.075,Y,num(pv),'ink','end');
    if(i>0){line(x0,Y,x1,Y,'grid',true);}
  }
  text((x0+x1)/2,-1.27,'V / L  ·  顺时针净功为正');
  const tones:Tone[]=['heat','work','cool','adiabat'];
  c.segments.forEach((seg,i)=>{
    const points=seg.points.map(map),tone=tones[i]!;
    push({kind:'polyline',points},tone);
    const j=Math.floor((points.length-1)/2),a=points[j]!,b=points[j+1]!,dx=b.x-a.x,dy=b.y-a.y;
    const len=Math.hypot(dx,dy);
    if(len>0){
      const q=P((a.x+b.x)/2,(a.y+b.y)/2),u=dx/len,v=dy/len;
      push({kind:'arrow',x1:q.x-u*.06,y1:q.y-v*.06,x2:q.x+u*.06,y2:q.y+v*.06},tone);
    }
    const corner=points[0]!;
    circle(corner.x,corner.y,.024,tone);text(corner.x+(i===0||i===3?-.06:.07),corner.y+(i===0||i===1?.09:-.10),'ABCD'[i]!,tone,i===0||i===3?'end':'start');
  });
  const x=[.51,1.10,1.65,2.21],top=1.02;
  text(1.36,1.38,'逐段热量、功、内能（J）');
  text(1.36,1.19,'Q>0 吸热 · W>0 对外做功');
  for(const [i,h] of ['段','Q','W','ΔU'].entries())text(x[i]!,top,h);
  line(.38,.90,2.39,.90,'grid');
  c.segments.forEach((seg,i)=>{
    const y=.70-i*.32,tone=tones[i]!;
    text(x[0]!,y,'ABCD'[i]+'→'+'BCDA'[i],tone);
    text(x[1]!,y,signed(seg.qJ));text(x[2]!,y,signed(seg.wJ));text(x[3]!,y,signed(seg.duJ));
  });
  line(.38,-.39,2.39,-.39,'grid');
  text(x[0]!,-.56,'合计');text(x[1]!,-.56,signed(c.sumQJ));text(x[2]!,-.56,signed(c.sumWJ));text(x[3]!,-.56,signed(c.sumDuJ));
  text(1.36,-.82,'吸热 '+num(c.qInJ)+' J · 放热 '+num(c.qOutJ)+' J');
  text(1.36,-1.04,'η = '+(100*c.efficiency).toFixed(2)+'% · 上限 '+(100*c.carnotEfficiency).toFixed(2)+'%','gas');
  text(1.36,-1.27,'实际温区 '+num(c.minTemperatureK)+'–'+num(c.maxTemperatureK)+' K');
  return {marks,stats:null};
}
