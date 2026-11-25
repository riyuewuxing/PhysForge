import type { DiagramPrimitive,DiagramExportOptions,ForceVectorItem,Viewport } from '@physforge/sim-sdk';
import { computeObservables,createInitialState,type CollisionRecoilParams,type CollisionRecoilState } from './engine.js';
type Point={x:number;y:number};
type Bounds={minX:number;maxX:number;minY:number;maxY:number};
export type CollisionSafeRect={left:number;right:number;top:number;bottom:number};
export type CollisionRole='track'|'body1'|'body2'|'block'|'boat'|'person'|'velocity1'|'velocity2'|'p1'|'p2'|'total'|'axis'|'ink'|'guide'|'event'|'ghost'|'force'|'heat'|'cm';
type Item={primitive:DiagramPrimitive;role:CollisionRole;layer:'bodies'|'momentumTriangle'|'cmLine'|'construction'|'forces'|'always'};
const v=(x:number,y:number):Point=>({x,y});
const add=(a:Point,b:Point)=>v(a.x+b.x,a.y+b.y);
const mul=(a:Point,k:number)=>v(a.x*k,a.y*k);
const norm=(a:Point)=>Math.hypot(a.x,a.y);
export function collisionForceVectors(s:CollisionRecoilState,p:CollisionRecoilParams):ForceVectorItem[]{
  if(p.mode!=='bullet-block'||s.bulletPhase!=='penetrating'||p.dragForceF===0)return [];
  // Horizontal internal pair only. No fictitious finite collision force
  // for a sphere impulse, and no vertical force in this planar model.
  return [{id:'bullet-resistance',label:'−f',origin:v(s.x1,0),force:v(-p.dragForceF,0),color:'#f472b6',category:'friction',unit:'N'},
    {id:'block-resistance',label:'+f',origin:v(s.x2,0),force:v(p.dragForceF,0),color:'#a78bfa',category:'friction',unit:'N'}];
}
export function collisionDiagram(s:CollisionRecoilState,p:CollisionRecoilParams,opts?:DiagramExportOptions){
  const items:Item[]=[],o=computeObservables(s,p),init=createInitialState(p),a=v(s.x1,s.y1),b=v(s.x2,s.y2),cm=v(o.xCm!,o.yCm!),boat=p.mode==='boat-recoil',bullet=p.mode==='bullet-block',sphere=!boat&&!bullet;
  const push=(primitive:DiagramPrimitive,role:CollisionRole,layer:Item['layer'])=>items.push({primitive,role,layer});
  const line=(a:Point,b:Point,role:CollisionRole,layer:Item['layer'],dashed=false)=>push({kind:'line',x1:a.x,y1:a.y,x2:b.x,y2:b.y,dashed},role,layer);
  const txt=(a:Point,text:string,role:CollisionRole,layer:Item['layer'])=>push({kind:'text',x:a.x,y:a.y,text,align:'middle'},role,layer);
  const dot=(a:Point,r:number,role:CollisionRole,layer:Item['layer'],fill=true,dashed=false)=>push({kind:'circle',cx:a.x,cy:a.y,r,fill,dashed},role,layer);
  const arrow=(a:Point,b:Point,label:string,role:CollisionRole,layer:Item['layer'])=>{if(Math.hypot(b.x-a.x,b.y-a.y)>1e-11)push({kind:'arrow',x1:a.x,y1:a.y,x2:b.x,y2:b.y,label},role,layer);};
  const poly=(points:readonly Point[],role:CollisionRole,layer:Item['layer'],closed=true)=>push({kind:'polyline',points,closed},role,layer);
  const R1=sphere?p.radius1:boat?.16:.035,R2=sphere?p.radius2:p.blockLength/2;
  let minX=Math.min(a.x-R1,b.x-R2,cm.x)-.52,maxX=Math.max(a.x+R1,b.x+R2,cm.x)+.52;
  const minY=Math.min(a.y-R1,b.y-(sphere?R2:.32),cm.y)-.62,maxY=Math.max(a.y+R1,b.y+(sphere?R2:.52),cm.y)+.68;
  // Keep true world coordinates; include the event only while it remains
  // within the local physical scene. Do not artificially shorten gaps.
  if(sphere){
    if(p.mode==='collision-1d')line(v(minX,0),v(maxX,0),'track','bodies',true);
    else{
      line(v(minX,b.y),v(maxX,b.y),'track','construction',true);
      if(!s.collided){line(v(minX,a.y),v(maxX,a.y),'guide','construction',true);
        const x=b.x+.22;line(v(x,b.y),v(x,a.y),'guide','construction',true);txt(v(x+.38,(b.y+a.y)/2),'b='+p.impactParamB.toFixed(3)+'m','guide','construction');}
    }
    if(opts?.showTrajectory!==false&&s.impact){
      const h=s.impact;line(h.center1,a,'velocity1','construction',true);line(h.center2,b,'velocity2','construction',true);
      dot(h.center1,p.radius1,'ghost','construction',false,true);dot(h.center2,p.radius2,'ghost','construction',false,true);
      line(h.center1,h.center2,'event','construction',true);
      arrow(h.contact,add(h.contact,mul(h.normal,.55)),'n','event','construction');
      txt(add(h.contact,v(0,.35)),'碰撞 '+h.t.toFixed(3)+' s','event','construction');
    }
    dot(a,p.radius1,'body1','bodies');dot(b,p.radius2,'body2','bodies');
    txt(v(a.x,a.y+p.radius1+.18),'m₁','body1','always');txt(v(b.x,b.y+p.radius2+.18),'m₂','body2','always');
    const miss=p.mode==='collision-2d-oblique'&&Math.abs(p.impactParamB)>p.radius1+p.radius2;
    const graze=p.mode==='collision-2d-oblique'&&Math.abs(Math.abs(p.impactParamB)-p.radius1-p.radius2)<=32*Number.EPSILON;
    txt(v((minX+maxX)/2,minY+.12),s.collided?'瞬时冲量已发生 · 自由运动':miss?'未命中 · 无冲量':graze?'擦边 · 法向冲量为零':'光滑球体 · 平面投影','ink','always');
  }else if(bullet){
    const left=b.x-p.blockLength/2,right=b.x+p.blockLength/2;
    push({kind:'rect',x:left,y:-.30,width:p.blockLength,height:.60},'block','bodies');
    line(v(left,0),v(right,0),'guide','construction',true);
    line(v(minX,-.39),v(maxX,-.39),'track','bodies');
    if(s.penetrationDist>0){
      line(v(left,0),v(left+s.penetrationDist,0),'heat','bodies');
      line(v(left,-.47),v(left+s.penetrationDist,-.47),'heat','construction');
      txt(v(left+s.penetrationDist/2,-.61),'d='+s.penetrationDist.toFixed(3)+' m','heat','construction');
    }
    dot(a,.035,'body1','always');txt(v(a.x,.18),'m₁ · 质点','body1','always');txt(v(b.x,.45),'m₂ · 木块','ink','always');
    txt(v((minX+maxX)/2,minY+.08),s.bulletPhase==='penetrating'?'恒定内阻力 · Q=f d':s.bulletPhase==='comoving'?'已共速 · 阻力停止':s.bulletPhase==='exited'?'已穿出 · 阻力停止':'入靶前 · 自由运动','ink','always');
  }else{
    const L=p.blockLength,left=b.x-L/2,right=b.x+L/2;
    poly([v(left,.14),v(right,.14),v(right-.13,-.28),v(left+.13,-.28)],'boat','bodies');
    line(v(minX,-.34),v(maxX,-.34),'track','bodies');
    const x=a.x;dot(v(x,.42),.075,'person','bodies');line(v(x,.34),v(x,.19),'person','bodies');
    line(v(x,.28),v(x-.10,.22),'person','bodies');line(v(x,.28),v(x+.10,.22),'person','bodies');
    line(v(x,.19),v(x-.07,.14),'person','bodies');line(v(x,.19),v(x+.07,.14),'person','bodies');
    txt(v(x,.65),'人 m₁','body1','always');txt(v(b.x,-.12),'船 m₂','ink','always');
    line(v(left+.05*L,-.48),v(right-.05*L,-.48),'guide','construction');
    txt(v(b.x,-.61),'相对行走跨度 0.9L','guide','construction');
    txt(v((minX+maxX)/2,minY+.08),p.v10===0?'零步行速度 · 静止':s.bulletPhase==='comoving'?'到达右端 · 平滑静止':'内部驱动 · 总水平动量为零','ink','always');
  }
  if(opts?.showVelocityVectors!==false){
    const vv1=v(s.vx1,s.vy1),vv2=v(s.vx2,s.vy2),k=.84/Math.max(1,norm(vv1),norm(vv2));
    const o1=sphere?a:boat?v(a.x,.60):v(a.x,.31),o2=sphere?b:boat?v(b.x,-.24):v(b.x,.31);
    arrow(o1,add(o1,mul(vv1,k)),'v₁','velocity1','construction');arrow(o2,add(o2,mul(vv2,k)),'v₂','velocity2','construction');
  }
  if(boat){line(v(cm.x,minY+.24),v(cm.x,maxY-.13),'cm','cmLine',true);txt(v(cm.x,maxY-.08),'固定质心 x_cm','cm','cmLine');}
  else{dot(cm,.045,'cm','cmLine');txt(v(cm.x,cm.y-.22),'CM','cm','cmLine');if(sphere&&opts?.showTrajectory!==false)line(v(init.xCm0,init.yCm0),cm,'cm','cmLine',true);}
  if(opts?.showForceLabels!==false){
    for(const f of collisionForceVectors(s,p)){const k=.45/Math.max(1,p.dragForceF);arrow(f.origin,add(f.origin,mul(f.force,k)),f.label,'force','forces');}
  }
  // Momentum polygon in an explicitly separate drawing scale. All three
  // vectors share one scale and are connected head-to-tail.
  const span=Math.max(3,maxX-minX),W=Math.min(2.25,.48*span),H=Math.min(1.25,.29*span+.2);
  const p1=v(o.px1!,o.py1!),p2=v(o.px2!,o.py2!),pt=add(p1,p2),xs=[0,p1.x,pt.x],ys=[0,p1.y,pt.y],mx=Math.min(...xs),Mx=Math.max(...xs),my=Math.min(...ys),My=Math.max(...ys);
  const k=Math.min(W/Math.max(1e-9,Mx-mx),H/Math.max(1e-9,My-my),.52);
  const cx=(minX+maxX)/2,cy=maxY+H/2+.28,O=v(cx-k*(mx+Mx)/2,cy-k*(my+My)/2),P=add(O,mul(p1,k)),S=add(O,mul(pt,k));
  arrow(O,P,'p₁','p1','momentumTriangle');arrow(P,S,'p₂','p2','momentumTriangle');arrow(O,S,'p总','total','momentumTriangle');
  if(norm(pt)<1e-10)dot(O,.045,'total','momentumTriangle');
  txt(v(cx,cy+H/2+.28),'动量矢量 · 地面惯性系','ink','momentumTriangle');
  txt(v(cx,cy-H/2-.18),'p₁+p₂=p总（同一动量标尺）','guide','momentumTriangle');
  if(s.impact&&sphere){
    const h=s.impact;
    txt(v(cx,cy+H/2+.45),'Jₙ='+h.impulse.toFixed(3)+' N·s','event','momentumTriangle');
  }
  // All primitives contribute to fit bounds, including real impact points.
  const all=[v(minX,minY),v(maxX,maxY)];
  for(const {primitive:q} of items){
    if(q.kind==='line'||q.kind==='arrow')all.push(v(q.x1,q.y1),v(q.x2,q.y2));
    else if(q.kind==='circle')all.push(v(q.cx-q.r,q.cy-q.r),v(q.cx+q.r,q.cy+q.r));
    else if(q.kind==='text')all.push(v(q.x-.25,q.y-.12),v(q.x+.25,q.y+.12));
    else if(q.kind==='polyline')all.push(...q.points);
    else if(q.kind==='rect')all.push(v(q.x,q.y),v(q.x+q.width,q.y+q.height));
  }
  const bounds:Bounds={minX:Math.min(...all.map(z=>z.x))-.12,maxX:Math.max(...all.map(z=>z.x))+.12,minY:Math.min(...all.map(z=>z.y))-.12,maxY:Math.max(...all.map(z=>z.y))+.12};
  return {items,bounds,momentum:{origin:O,joint:P,end:S,scale:k}};
}
export function collisionBoundsFit(s:CollisionRecoilState,p:CollisionRecoilParams,v:Viewport,safe:CollisionSafeRect){
  const b=collisionDiagram(s,p).bounds,ppm=.24*Math.min(v.width,v.height)*v.scale,ox=.45*v.width+v.offsetX,oy=.5*v.height+v.offsetY;
  return ox+b.minX*ppm>=safe.left&&ox+b.maxX*ppm<=safe.right&&oy-b.maxY*ppm>=safe.top&&oy-b.minY*ppm<=safe.bottom;
}
export function fitCollisionViewport(s:CollisionRecoilState,p:CollisionRecoilParams,v:Viewport,safe:CollisionSafeRect):Viewport|null{
  if(safe.right-safe.left<70||safe.bottom-safe.top<70)return null;
  const b=collisionDiagram(s,p).bounds,ppm=.93*Math.min((safe.right-safe.left)/(b.maxX-b.minX),(safe.bottom-safe.top)/(b.maxY-b.minY));
  if(!Number.isFinite(ppm)||ppm<=0)return null;
  return {...v,scale:ppm/(.24*Math.min(v.width,v.height)),offsetX:(safe.left+safe.right)/2-(b.minX+b.maxX)*ppm/2-.45*v.width,offsetY:(safe.top+safe.bottom)/2+(b.minY+b.maxY)*ppm/2-.5*v.height};
}
export function collisionInitialView(s:CollisionRecoilState,p:CollisionRecoilParams,v:{width:number;height:number}){
  const full={...v,dpr:1,scale:1,offsetX:0,offsetY:0};
  const fit=fitCollisionViewport(s,p,full,{left:30,right:v.width>=1200?v.width-300:v.width-30,top:28,bottom:v.height>=650?v.height-170:v.height-30})??full;
  return {scale:fit.scale,offsetRatioX:fit.offsetX/v.width,offsetRatioY:fit.offsetY/v.height};
}
