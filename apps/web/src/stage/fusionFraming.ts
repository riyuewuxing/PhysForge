import * as THREE from 'three';
import type { CameraMorphController } from './cameraMorphController.js';
import { fusionScreenFits,type FusionFramePoint,type FusionSafeRect,type FusionScreenBounds } from '../../../../simulations/stse-tokamak-magnetic-mirror/plugin.js';

/** Project the exact geometry/trajectory samples with one camera transform.
 * Margins cover tube radius, arrowheads and event markers. */
export function projectFusionFrame(points:readonly FusionFramePoint[],camera:THREE.Camera,width:number,height:number):FusionScreenBounds{
  camera.updateMatrixWorld(true);
  const matrix=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
  const v=new THREE.Vector4();let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity,visible=true;
  for(const p of points){
    v.set(p.x,p.y,p.z,1).applyMatrix4(matrix);
    if(v.w<=0||!Number.isFinite(v.w)){visible=false;continue;}
    const x=v.x/v.w,y=v.y/v.w,z=v.z/v.w;
    if(![x,y,z].every(Number.isFinite)||Math.abs(z)>1)visible=false;
    left=Math.min(left,(x+1)*width/2);right=Math.max(right,(x+1)*width/2);
    top=Math.min(top,(1-y)*height/2);bottom=Math.max(bottom,(1-y)*height/2);
  }
  return {left,right,top,bottom,visible:visible&&[left,right,top,bottom].every(Number.isFinite)};
}

/** Frame in the existing camera's screen plane, not the physics XY plane.
 * Unlike a planar fit, this accounts for the depth of a torus and coils. */
export function fitFusionSpatialFrame(morph:CameraMorphController,points:readonly FusionFramePoint[],width:number,height:number,safe:FusionSafeRect){
  const box=new THREE.Box3().makeEmpty(),v=new THREE.Vector3();
  for(const p of points)box.expandByPoint(v.set(p.x,p.y,p.z));
  const target=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
  const safeWidth=Math.max(1,safe.right-safe.left-64),safeHeight=Math.max(1,safe.bottom-safe.top-64);
  let span=Math.max(3.6,1.05*size.length()*height/Math.min(safeWidth,safeHeight));
  let best:{target:THREE.Vector3;span:number;score:number}|null=null;
  for(let i=0;i<14;i++){
    morph.setFraming(target,span);
    const camera=morph.getActiveCamera();
    const b=projectFusionFrame(points,camera,width,height);
    if(!b.visible){span*=1.4;continue;}
    const dx=(b.left+b.right-safe.left-safe.right)/2,dy=(b.top+b.bottom-safe.top-safe.bottom)/2;
    const ratio=Math.max((b.right-b.left)/safeWidth,(b.bottom-b.top)/safeHeight);
    const fits=fusionScreenFits(b,safe,24);
    if(fits){
      // Keep the best safe composition even if later zoom trials fail.
      const score=Math.min(ratio,1)-.002*(Math.abs(dx)+Math.abs(dy));
      if(!best||score>best.score)best={target:target.clone(),span,score};
      if(ratio>=.87&&ratio<=1&&Math.abs(dx)<12&&Math.abs(dy)<12)return b;
    }
    // Positive camera-right target shift moves the object left on the screen.
    const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion);
    const up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);
    target.addScaledVector(right,dx*span/height).addScaledVector(up,-dy*span/height);
    if(ratio>1)span*=ratio*1.04;
    else if(ratio<.87)span*=Math.max(.65,ratio/.94);
    else if(!fits&&i>=5)span*=1.04;
  }
  if(best)morph.setFraming(best.target,best.span);
  else morph.setFraming(target,span);
  return projectFusionFrame(points,morph.getActiveCamera(),width,height);
}
