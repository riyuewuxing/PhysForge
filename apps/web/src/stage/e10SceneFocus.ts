import * as THREE from 'three';

/** Fixed physical z-y meridian, emphasized only for teaching contrast. */
export type E10FluxRole='meridian'|'context';
export function e10FluxRole(geometryType:string,line:readonly {x:number;y:number;z:number}[]):E10FluxRole{
  if(geometryType!=='finite-solenoid')return 'meridian';
  let r=0,x=0;
  for(const p of line){const rr=Math.hypot(p.x,p.y);if(rr>r){r=rr;x=p.x;}}
  return r<1e-7||Math.abs(x)<=.16*r?'meridian':'context';
}

/** Scene-depth query for the displayed sphere CENTER, not its whole silhouette.
 * Only actual opaque conductor meshes can occlude it. */
export class E10ParticleProjection {
  private readonly ray=new THREE.Raycaster();
  private readonly ndc=new THREE.Vector3();
  private readonly eye=new THREE.Vector3();
  private readonly ndcXY=new THREE.Vector2();
  private readonly offset=new THREE.Vector3();
  private readonly hits:THREE.Intersection[]=[];
  read(center:THREE.Vector3,radius:number,camera:THREE.PerspectiveCamera|THREE.OrthographicCamera,occluders:readonly THREE.Mesh[],width:number,height:number){
    camera.updateMatrixWorld(true);
    this.eye.copy(center).applyMatrix4(camera.matrixWorldInverse);
    this.ndc.copy(center).project(camera);
    const {x,y,z}=this.ndc;
    const visible=this.eye.z<0&&[x,y,z].every(Number.isFinite)&&Math.abs(x)<=1&&Math.abs(y)<=1&&Math.abs(z)<=1;
    const screenX=(x+1)*width/2,screenY=(1-y)*height/2;
    if(!visible)return {visible,occluded:false,x:screenX,y:screenY,radiusPx:0,centerDistance:null,hitDistance:null};
    this.offset.set(radius,0,0).applyQuaternion(camera.quaternion).add(center).project(camera);
    const radiusPx=Math.max(9,Math.min(26,Math.abs(this.offset.x-x)*width/2+3));
    this.ndcXY.set(x,y);this.ray.setFromCamera(this.ndcXY,camera);
    const centerDistance=center.distanceTo(this.ray.ray.origin);
    this.ray.near=0;this.ray.far=Math.max(0,centerDistance-1e-6);
    this.hits.length=0;
    for(const mesh of occluders)if(mesh.visible)this.ray.intersectObject(mesh,false,this.hits);
    const hitDistance=this.hits[0]?.distance??null;
    return {visible,occluded:hitDistance!==null,x:screenX,y:screenY,radiusPx,centerDistance,hitDistance};
  }
}
