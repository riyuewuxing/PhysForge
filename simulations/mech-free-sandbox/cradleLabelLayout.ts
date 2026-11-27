/** Pack measured velocity labels into non-intersecting horizontal lanes.
 * B4 cradle and two-ball collisions use this; physical coordinates/velocities never change. */
export interface CradleLabel {
  id:string; text:string; color:string; x:number; top:number; bottom:number; width:number;
}
export interface PlacedCradleLabel extends CradleLabel { y:number; lane:number; }
export function layoutCradleLabels(labels:readonly CradleLabel[],width:number,height:number):PlacedCradleLabel[]{
  if(!labels.length)return [];
  const gap=8, pitch=22, margin=6;
  const sorted=[...labels].sort((a,b)=>a.x-b.x||a.id.localeCompare(b.id));
  const lanes:number[]=[];
  const placed=sorted.map(label=>{
    const half=label.width/2;
    const x=width<2*(half+margin)?width/2:Math.max(half+margin,Math.min(width-half-margin,label.x));
    const left=x-half,right=x+half;
    let lane=lanes.findIndex(end=>end+gap<=left);
    if(lane<0){lane=lanes.length;lanes.push(right);}else lanes[lane]=right;
    return {...label,x,lane,y:0};
  });
  const top=Math.min(...labels.map(l=>l.top)),bottom=Math.max(...labels.map(l=>l.bottom));
  const needed=lanes.length*pitch+8;
  const above=top-42,below=height-bottom-8;
  const useAbove=above>=needed||above>=below;
  const first=useAbove?Math.max(42+(lanes.length-1)*pitch,top-15):Math.min(height-10-(lanes.length-1)*pitch,bottom+15);
  return placed.map(label=>({...label,y:first+(useAbove?-1:1)*label.lane*pitch}));
}
