type Point={x:number;y:number};

/** Decorative brightness only, not a calibrated luminous flux or temperature.
 * In particular, an exactly unpowered lamp never has a warm emission halo. */
export function lampDisplayLight(powerW:number):number{
  return Number.isFinite(powerW)&&powerW>0?Math.min(1,Math.sqrt(powerW/8)):0;
}

/** The standard two-terminal circle is retained. The glass tint, specular
 * highlights and emission are decorative; electrical connections remain
 * at the original ring endpoints, with the filament drawn by the caller. */
export function drawLampGlass(ctx:CanvasRenderingContext2D,q:Point,rr:number,power:number,paper:boolean):number{
  const light=lampDisplayLight(power);
  if(![q.x,q.y,rr].every(Number.isFinite)||rr<=0)return light;
  ctx.save();
  if(!paper&&light>0){
    const halo=ctx.createRadialGradient(q.x,q.y,0,q.x,q.y,rr*2.4);
    halo.addColorStop(0,'rgba(255,185,70,'+(.48*light)+')');
    halo.addColorStop(.28,'rgba(255,201,114,'+(.32*light)+')');
    halo.addColorStop(.58,'rgba(255,160,52,'+(.11*light)+')');
    halo.addColorStop(1,'rgba(255,185,70,0)');
    ctx.fillStyle=halo;ctx.beginPath();ctx.arc(q.x,q.y,rr*2.4,0,Math.PI*2);ctx.fill();
  }
  const glass=ctx.createRadialGradient(q.x-rr*.30,q.y-rr*.36,0,q.x,q.y,rr);
  glass.addColorStop(0,paper?'#ffffff':light>0?'rgba(255,235,190,'+(.24+.56*light)+')':'#657584');
  glass.addColorStop(.42,paper?'#f8fafc':light>0?'rgba(201,135,51,'+(.15+.42*light)+')':'#36434f');
  glass.addColorStop(.80,paper?'#edf2f7':light>0?'#49392c':'#202b35');
  glass.addColorStop(1,paper?'#e2e8f0':light>0?'#292520':'#18212a');
  ctx.fillStyle=glass;ctx.strokeStyle=light>0?(paper?'#92400e':'#ffcc80'):(paper?'#475569':'#8197ab');
  ctx.lineWidth=Math.max(1.5,rr*.07);ctx.shadowColor='#ffb85e';ctx.shadowBlur=paper?0:14*light;
  ctx.beginPath();ctx.arc(q.x,q.y,rr,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;
  // A curved reflection on the envelope, not a new conductor.
  ctx.strokeStyle=paper?'rgba(100,116,139,.35)':'rgba(225,243,255,.62)';
  ctx.lineWidth=Math.max(.7,rr*.045);ctx.lineCap='round';
  ctx.beginPath();ctx.arc(q.x,q.y,rr*.82,3.75,4.95);ctx.stroke();
  if(!paper&&light>0){
    const core=ctx.createRadialGradient(q.x,q.y,0,q.x,q.y,rr*.88);
    core.addColorStop(0,'rgba(255,230,166,'+(.46*light)+')');
    core.addColorStop(.42,'rgba(255,190,83,'+(.25*light)+')');
    core.addColorStop(1,'rgba(255,170,70,0)');
    ctx.fillStyle=core;ctx.beginPath();ctx.arc(q.x,q.y,rr*.88,0,Math.PI*2);ctx.fill();
    // Gentle short radiance ticks indicate emission without claiming a
    // geometric light propagation model. They are absent at zero power.
    ctx.strokeStyle='#ffd99d';ctx.globalAlpha=.18+.58*light;ctx.lineWidth=Math.max(.8,rr*.048);
    for(const angle of [-2.28,-1.57,-.86,.86,1.57,2.28]){
      const u=Math.cos(angle),v=Math.sin(angle);
      ctx.beginPath();ctx.moveTo(q.x+u*rr*1.12,q.y+v*rr*1.12);ctx.lineTo(q.x+u*rr*(1.27+.18*light),q.y+v*rr*(1.27+.18*light));ctx.stroke();
    }
  }
  ctx.restore();return light;
}

/** Glass-front instrument, with no changes to the numeric value or unit. */
export function drawCircuitMeterFace(ctx:CanvasRenderingContext2D,q:Point,rr:number,color:string,paper:boolean):void{
  if(![q.x,q.y,rr].every(Number.isFinite)||rr<=0)return;
  ctx.save();
  const metal=ctx.createLinearGradient(q.x-rr,q.y-rr,q.x+rr,q.y+rr);
  metal.addColorStop(0,paper?'#f1f5f9':'#768491');metal.addColorStop(.26,paper?'#ffffff':'#3d4a56');
  metal.addColorStop(.64,paper?'#e2e8f0':'#1a242d');metal.addColorStop(1,paper?'#cbd5e1':'#53616c');
  ctx.fillStyle=metal;ctx.strokeStyle=color;ctx.lineWidth=Math.max(1.5,rr*.075);ctx.shadowColor=color;ctx.shadowBlur=paper?0:13;
  ctx.beginPath();ctx.arc(q.x,q.y,rr,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;
  const face=ctx.createRadialGradient(q.x-rr*.25,q.y-rr*.35,0,q.x,q.y,rr*.85);
  face.addColorStop(0,paper?'#ffffff':'#384855');face.addColorStop(.75,paper?'#f8fafc':'#17232d');face.addColorStop(1,paper?'#edf2f7':'#111c25');
  ctx.fillStyle=face;ctx.beginPath();ctx.arc(q.x,q.y,rr*.86,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle=paper?'rgba(71,85,105,.28)':'rgba(204,235,247,.58)';ctx.lineWidth=Math.max(.8,rr*.038);
  ctx.beginPath();ctx.arc(q.x,q.y,rr*.90,3.62,5.15);ctx.stroke();ctx.restore();
}

/** Visible slider contact is centered at the original world-space tap.
 * The surrounding rim is a control affordance, not an additional node. */
export function drawWiperContact(ctx:CanvasRenderingContext2D,q:Point,r:number,potential:string,paper:boolean):void{
  if(![q.x,q.y,r].every(Number.isFinite)||r<=0)return;
  ctx.save();ctx.fillStyle=paper?'#f8fafc':'#1c2630';ctx.strokeStyle=paper?'#92400e':'#ffd395';
  ctx.lineWidth=Math.max(1.3,r*.23);ctx.shadowColor='#ffd395';ctx.shadowBlur=paper?0:10;
  ctx.beginPath();ctx.arc(q.x,q.y,r,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.shadowBlur=0;ctx.fillStyle=potential;ctx.beginPath();ctx.arc(q.x,q.y,r*.42,0,Math.PI*2);ctx.fill();ctx.restore();
}
