import type {DiagramPrimitive} from '@physforge/sim-sdk';
import {HC_EV_NM,H_OVER_E,computePhotocurrentMa,solvePhotoelectric,type ComptonSolution,type PhotoelectricComptonState,type PhotoelectricComptonParams} from './engine.js';

type Tone='ink'|'grid'|'beam'|'cathode'|'anode'|'electron'|'current'|'reference'|'active'|'incident'|'scattered'|'recoil'|'alert';
export interface QuantumMark {primitive:DiagramPrimitive;tone:Tone;layer:'apparatus'|'characteristic'}
export const QUANTUM_BOUNDS={minX:-2.42,minY:-1.82,maxX:2.42,maxY:1.66};
export const IV_PLOT={x:.18,y:.26,width:2.06,height:.98,uMin:-7,uMax:6,iMax:7.5};
export const EK_PLOT={x:.18,y:-1.36,width:2.06,height:.91,fMax:16,kMax:6};
export const graphX=(u:number)=>IV_PLOT.x+(u-IV_PLOT.uMin)/(IV_PLOT.uMax-IV_PLOT.uMin)*IV_PLOT.width;
export const graphY=(i:number)=>IV_PLOT.y+i/IV_PLOT.iMax*IV_PLOT.height;
export const graphV=(x:number)=>IV_PLOT.uMin+(x-IV_PLOT.x)/IV_PLOT.width*(IV_PLOT.uMax-IV_PLOT.uMin);
const ekX=(f:number)=>EK_PLOT.x+f/EK_PLOT.fMax*EK_PLOT.width;
const ekY=(k:number)=>EK_PLOT.y+k/EK_PLOT.kMax*EK_PLOT.height;
export const COMPTON_ORIGIN={x:-.8,y:0};
export function comptonMomentumVectors(solution:ComptonSolution,angleDeg:number,length=.95){
 const theta=angleDeg*Math.PI/180,s=angleDeg===0||angleDeg===180?0:Math.sin(theta),cos=1-2*Math.sin(theta/2)**2;
 return {incident:{x:length,y:0},scattered:{x:length*solution.pScattered/solution.pIncident*cos,y:length*solution.pScattered/solution.pIncident*s},
   recoil:{x:length*solution.pElectronX/solution.pIncident,y:length*solution.pElectronY/solution.pIncident}};
}
export function photoelectricCurves(s:PhotoelectricComptonState,p:PhotoelectricComptonParams){
 const sample=(q:typeof s.photoelectric,I:number)=>{
   const us=Array.from({length:131},(_,i)=>IV_PLOT.uMin+i/130*(IV_PLOT.uMax-IV_PLOT.uMin));
   if(q.stoppingDefined&&-q.stoppingVoltageV>=IV_PLOT.uMin&&-q.stoppingVoltageV<=IV_PLOT.uMax)us.push(-q.stoppingVoltageV);
   us.push(p.anodeVoltageV);us.sort((a,b)=>a-b);
   return [...new Set(us)].map(u=>({voltageV:u,currentMa:computePhotocurrentMa(u,q,I)}));
 };
 const reference=p.freezeRefEnabled?solvePhotoelectric({...p,wavelengthNm:p.refWavelengthNm,intensityRel:p.refIntensityRel}):null;
 const cutoff=s.photoelectric.cutoffFreqHz/1e14,currentFreq=s.photoelectric.incidentFreqHz/1e14;
 const energy=(f:number)=>H_OVER_E*f*1e14-s.photoelectric.workFunctionEv;
 const line=cutoff<=EK_PLOT.fMax?[{frequency14:cutoff,kineticEv:0},{frequency14:EK_PLOT.fMax,kineticEv:Math.max(0,energy(EK_PLOT.fMax))}]:[];
 return {live:sample(s.photoelectric,p.intensityRel),reference:reference?sample(reference,p.refIntensityRel):null,referenceSolution:reference,
   cutoff14:cutoff,currentFreq14:currentFreq,energyLine:line,kinematicPoint:s.photoelectric.thresholdPassed?{frequency14:currentFreq,kineticEv:s.photoelectric.maxKineticEv}:null};
}
export function quantumGeometry(s:PhotoelectricComptonState,p:PhotoelectricComptonParams){
 const marks:QuantumMark[]=[];let layer:'apparatus'|'characteristic'='apparatus';
 const push=(primitive:DiagramPrimitive,tone:Tone='ink')=>marks.push({primitive,tone,layer});
 const text=(x:number,y:number,text:string,tone:Tone='ink',align:'start'|'middle'|'end'='middle')=>push({kind:'text',x,y,text,align},tone);
 const line=(x1:number,y1:number,x2:number,y2:number,tone:Tone='ink',dashed=false)=>push({kind:'line',x1,y1,x2,y2,dashed},tone);
 const rect=(x:number,y:number,width:number,height:number,tone:Tone='grid')=>push({kind:'rect',x,y,width,height},tone);
 const circle=(cx:number,cy:number,r:number,tone:Tone='ink',fill=false)=>push({kind:'circle',cx,cy,r,fill},tone);
 const arrow=(x1:number,y1:number,x2:number,y2:number,tone:Tone,label?:string)=>push({kind:'arrow',x1,y1,x2,y2,...(label?{label}:{})},tone);
 const poly=(points:readonly {x:number;y:number}[],tone:Tone,dashed=false)=>push({kind:'polyline',points,dashed},tone);
 if(p.mode==='compton'){
   const c=s.compton,o=COMPTON_ORIGIN,v=comptonMomentumVectors(c,p.scatterAngleDeg);
   const at=(q:{x:number;y:number})=>({x:o.x+q.x,y:o.y+q.y});
   const a=at(v.scattered),b=at(v.recoil),sum=at(v.incident);
   text(-.60,1.47,'康普顿散射 · 共同动量标尺');
   text(-.60,1.27,'静止自由电子 · 单次散射');
   arrow(o.x-v.incident.x,o.y,o.x,o.y,'incident','pγ');
   arrow(o.x,o.y,a.x,a.y,'scattered','p′γ');
   if(c.recoilAngleDefined){
     arrow(o.x,o.y,b.x,b.y,'recoil','pe');line(a.x,a.y,sum.x,sum.y,'grid',true);line(b.x,b.y,sum.x,sum.y,'grid',true);
     text(o.x+v.recoil.x*.64,o.y+v.recoil.y*.64-.13,'pe','recoil');
   }else{
     text(o.x,-.28,'pₑ = 0；反冲方向未定义','recoil');
   }
   circle(o.x,o.y,.029,'ink',true);
   text(o.x-v.incident.x*.55,.12,'pγ','incident');
   text(o.x+v.scattered.x*.67,v.scattered.y*.67+.14,'p′γ','scattered');
   if(p.scatterAngleDeg>0){
     push({kind:'arc',cx:o.x,cy:o.y,r:.26,startAngle:0,endAngle:p.scatterAngleDeg*Math.PI/180},'scattered');
     const t=p.scatterAngleDeg*Math.PI/360;text(o.x+.34*Math.cos(t),o.y+.34*Math.sin(t),'θ','scattered');
   }
   text(-.80,-1.16,'θ = '+p.scatterAngleDeg.toFixed(0)+'° · 方向采用有符号平面角');
   text(-.80,-1.37,'归一化箭长 ∝ 动量；虚线为平行四边形');
   layer='characteristic';
   text(1.64,1.47,'光子与电子能量账本');
   text(1.64,1.25,'入射 '+c.incidentEnergyKev.toFixed(4)+' keV');
   const ex=1.10,ew=1.09,ey=.83,eh=.16;
   rect(ex,ey,ew,eh,'incident');
   const f=c.scatteredEnergyKev/c.incidentEnergyKev;
   rect(ex,ey-.34,ew*f,eh,'scattered');if(f<1)rect(ex+ew*f,ey-.34,ew*(1-f),eh,'recoil');
   text(1.64,.33,'散射 '+c.scatteredEnergyKev.toFixed(4)+' keV','scattered');
   text(1.64,.12,'电子 K = '+c.electronKineticKev.toFixed(4)+' keV','recoil');
   text(1.64,-.16,'λ′ = '+c.scatteredWavelengthNm.toFixed(6)+' nm');
   text(1.64,-.36,'Δλ = '+(c.deltaLambdaNm*1000).toFixed(4)+' pm');
   text(1.64,-.56,c.recoilAngleDefined?'φ = '+c.recoilAngleDeg.toFixed(2)+'°':'φ 未定义（零反冲）','recoil');
   text(1.64,-.81,'Eγ = E′γ + Kₑ');
   text(1.64,-1.02,'pγ = p′γ + pₑ（矢量）');
   return {marks,curves:null};
 }
 const pe=s.photoelectric,curves=photoelectricCurves(s,p);
 text(-1.20,1.48,'真空光电管 · 示意装置');
 text(-1.20,1.28,p.intensityRel===0?'光源关闭':p.wavelengthNm<380?'紫外光：颜色仅示意':'入射 λ = '+p.wavelengthNm.toFixed(0)+' nm','beam');
 circle(-1.22,.43,.70,'grid');
 line(-2.28,-.15,-2.28,.65,'grid');
 line(-1.55,.72,-1.55,.14,'cathode');line(-.82,.67,-.82,.19,'anode');
 text(-1.55,.91,'K','cathode');text(-.82,.86,'A','anode');
 if(p.intensityRel>0)for(let k=-1;k<=1;k++)arrow(-2.29,.92+k*.10,-1.57,.46+k*.10,'beam');
 if(pe.emissionActive){
   circle(-1.42,.45,.026,'electron',true);
   if(pe.currentMa>0){arrow(-1.40,.45,-.87,.45,'electron');text(-1.20,.10,'有电子被收集','electron');}
   else{poly([{x:-1.42,y:.45},{x:-1.29,y:.51},{x:-1.24,y:.42},{x:-1.43,y:.30}],'electron',true);text(-1.20,.10,'逸出但未收集','electron');}
 }else text(-1.20,.10,p.intensityRel===0?'无入射光':'未过阈 · 无逸出','alert');
 // Real schematic connections to adjustable supply and ammeter.
 line(-1.55,.14,-1.55,-.30,'cathode');line(-.82,.19,-.82,-.30,'anode');
 line(-1.55,-.30,-1.92,-.30);line(-1.92,-.30,-1.92,-.76);
 line(-.82,-.30,-.46,-.30);line(-.46,-.30,-.46,-.43);circle(-.46,-.57,.14);text(-.46,-.57,'A');
 line(-.46,-.71,-.46,-.76);line(-.46,-.76,-.83,-.76);
 rect(-1.56,-.90,.73,.28);text(-1.195,-.76,'可调 U');
 line(-1.92,-.76,-1.56,-.76);
 text(-1.20,-1.07,'U_AK = '+p.anodeVoltageV.toFixed(2)+' V · I = '+pe.currentMa.toFixed(3)+' mA');
 text(-1.20,-1.28,'W₀ = '+pe.workFunctionEv.toFixed(2)+' eV · hν = '+pe.photonEnergyEv.toFixed(3)+' eV');
 text(-1.20,-1.48,pe.stoppingDefined?'遏止电压幅值 '+pe.stoppingVoltageV.toFixed(3)+' V':p.intensityRel===0?'未测得遏止电压（无光）':'未过阈，不存在遏止电压测量','alert');
 layer='characteristic';
 text(1.21,1.49,'I–U 经验伏安特性（mA / V）');
 const {x,y,width,height,uMin,uMax,iMax}=IV_PLOT;
 line(x,y,x+width,y);line(graphX(0),y,graphX(0),y+height);
 for(const u of [-7,-3,0,3,6]){line(graphX(u),y,graphX(u),y-.027);text(graphX(u),y-.105,String(u));}
 for(const i of [2.5,5,7.5]){line(x,graphY(i),x+width,graphY(i),'grid',true);text(x-.06,graphY(i),String(i),'ink','end');}
 if(curves.reference){
   poly(curves.reference.map(q=>({x:graphX(q.voltageV),y:graphY(q.currentMa)})),'reference',true);
   text(1.21,1.30,'虚线：同材料 λ_ref='+p.refWavelengthNm.toFixed(0)+' nm, P_ref='+p.refIntensityRel.toFixed(1),'reference');
 }
 poly(curves.live.map(q=>({x:graphX(q.voltageV),y:graphY(q.currentMa)})),'current');
 if(pe.stoppingDefined){
   const stop=graphX(-pe.stoppingVoltageV);circle(stop,y,.025,'current');
   line(stop,y,stop,y+.14,'current',true);text(stop,y+.19,'−Uc','current');
 }
 circle(graphX(p.anodeVoltageV),graphY(pe.currentMa),.033,'active',true);
 text(1.21,-.012,'U_AK（V） · 实点为当前值');
 const q=EK_PLOT;
 text(1.21,-.20,'最大初动能–频率（能量许可）');
 line(q.x,q.y,q.x+q.width,q.y);line(q.x,q.y,q.x,q.y+q.height);
 for(const f of [0,4,8,12,16]){line(ekX(f),q.y,ekX(f),q.y-.027);text(ekX(f),q.y-.10,String(f));}
 for(const k of [2,4,6]){line(q.x,ekY(k),q.x+q.width,ekY(k),'grid',true);text(q.x-.055,ekY(k),String(k),'ink','end');}
 text(q.x-.055,q.y+q.height+.07,'eV','ink','end');
 if(curves.energyLine.length)poly(curves.energyLine.map(a=>({x:ekX(a.frequency14),y:ekY(a.kineticEv)})),'current');
 if(curves.cutoff14<=q.fMax){const cx=ekX(curves.cutoff14);circle(cx,q.y,.023,'current');line(cx,q.y,cx,q.y+.14,'current',true);text(cx,q.y+.19,'ν₀','current');}
 if(curves.kinematicPoint){const a=curves.kinematicPoint;circle(ekX(a.frequency14),ekY(a.kineticEv),.030,'active',pe.emissionActive);}
 else if(curves.currentFreq14<=q.fMax){const X=ekX(curves.currentFreq14);line(X,q.y,X,q.y+.10,'alert',true);text(X,q.y+.16,'未过阈','alert');}
 text(1.21,-1.66,'ν / 10¹⁴ Hz · 阈上斜率 h/e');
 return {marks,curves};
}
