import * as THREE from 'three';

type Rect={left:number;right:number;top:number;bottom:number};

/** Conservative actual visible mesh/line bounds. Transform each local box
 * corner by the actual world matrix; hidden rails/arrows do not participate. */
export function inductionOpeningPoints(root:THREE.Object3D):THREE.Vector3[]{
  root.updateWorldMatrix(true,true);
  const points:THREE.Vector3[]=[];
  root.traverseVisible(node=>{
    if(!(node instanceof THREE.Mesh||node instanceof THREE.Line||node instanceof THREE.LineSegments))return;
    const geometry=node.geometry;
    if(!geometry.boundingBox)geometry.computeBoundingBox();
    const b=geometry.boundingBox;
    if(!b||b.isEmpty())return;
    for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){
      const p=new THREE.Vector3(x,y,z).applyMatrix4(node.matrixWorld);
      if([p.x,p.y,p.z].every(Number.isFinite))points.push(p);
    }
  });
  return points;
}

/** Opening story only: reserve the actual formula column and the caption /
 * control strip. A compact screen must not hide conductor or field geometry. */
export function inductionOpeningSafeRect(w:number,h:number,panel:Rect|null,dock:Rect|null,hud:Rect|null):Rect{
  return {left:24,right:Math.min(w-24,panel?panel.left-16:w-24),top:88,
    bottom:Math.min(h-24,dock?dock.top-14:h-24,hud?hud.top-14:h-24)};
}
