import * as THREE from 'three';

type Point3 = {readonly x:number;readonly y:number;readonly z:number};

/** Fixed-capacity indexed tube around actual recorded samples. No spline overshoot,
 * geometry recreation or GPU resource disposal on every frame. */
export class DynamicTubeTrail {
  readonly geometry = new THREE.BufferGeometry();
  private readonly positions:THREE.BufferAttribute;
  private readonly normals:THREE.BufferAttribute;
  private readonly centers:Float64Array;
  private readonly tangent=new THREE.Vector3();
  private readonly normal=new THREE.Vector3();
  private readonly binormal=new THREE.Vector3();
  private readonly radialVector=new THREE.Vector3();
  constructor(private readonly capacity:number,private readonly radius:number,private readonly radial=6){
    if(!Number.isInteger(capacity)||capacity<2||!Number.isFinite(radius)||radius<=0||
       !Number.isInteger(radial)||radial<3)throw new RangeError('Invalid trail geometry');
    this.positions=new THREE.BufferAttribute(new Float32Array(capacity*radial*3),3).setUsage(THREE.DynamicDrawUsage);
    this.normals=new THREE.BufferAttribute(new Float32Array(capacity*radial*3),3).setUsage(THREE.DynamicDrawUsage);
    this.centers=new Float64Array(capacity*3);
    this.geometry.setAttribute('position',this.positions);this.geometry.setAttribute('normal',this.normals);
    const indices:number[]=[];
    for(let i=0;i<capacity-1;i++)for(let j=0;j<radial;j++){
      const a=i*radial+j,c=i*radial+(j+1)%radial,b=a+radial,d=c+radial;
      indices.push(a,c,b,c,d,b);
    }
    this.geometry.setIndex(indices);this.geometry.setDrawRange(0,0);
  }
  update(points:readonly Point3[],project:(point:Point3)=>Point3):void{
    const count=Math.min(this.capacity,points.length),start=points.length-count;
    if(count<2){this.geometry.setDrawRange(0,0);return;}
    for(let i=0;i<count;i++){
      const p=project(points[start+i]!);
      if(![p.x,p.y,p.z].every(Number.isFinite)){this.geometry.setDrawRange(0,0);return;}
      this.centers[i*3]=p.x;this.centers[i*3+1]=p.y;this.centers[i*3+2]=p.z;
    }
    this.normal.set(0,0,0);
    for(let i=0;i<count;i++){
      const a=Math.max(0,i-1)*3,b=Math.min(count-1,i+1)*3,c=i*3;
      this.tangent.set(this.centers[b]!-this.centers[a]!,this.centers[b+1]!-this.centers[a+1]!,this.centers[b+2]!-this.centers[a+2]!);
      if(this.tangent.lengthSq()<1e-20)this.tangent.set(1,0,0);
      else this.tangent.normalize();
      // Parallel transport the previous ring normal by projection onto the new normal plane.
      this.normal.addScaledVector(this.tangent,-this.normal.dot(this.tangent));
      if(this.normal.lengthSq()<1e-12){
        this.normal.set(Math.abs(this.tangent.y)<.8?0:1,Math.abs(this.tangent.y)<.8?1:0,0);
        this.normal.addScaledVector(this.tangent,-this.normal.dot(this.tangent));
      }
      this.normal.normalize();this.binormal.crossVectors(this.tangent,this.normal).normalize();
      for(let j=0;j<this.radial;j++){
        const angle=j*2*Math.PI/this.radial,index=i*this.radial+j;
        this.radialVector.copy(this.normal).multiplyScalar(Math.cos(angle)).addScaledVector(this.binormal,Math.sin(angle));
        this.normals.setXYZ(index,this.radialVector.x,this.radialVector.y,this.radialVector.z);
        this.positions.setXYZ(index,this.centers[c]!+this.radius*this.radialVector.x,
          this.centers[c+1]!+this.radius*this.radialVector.y,this.centers[c+2]!+this.radius*this.radialVector.z);
      }
    }
    this.positions.needsUpdate=true;this.normals.needsUpdate=true;
    this.geometry.setDrawRange(0,(count-1)*this.radial*6);
  }
}
