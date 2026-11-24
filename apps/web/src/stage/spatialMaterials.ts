import * as THREE from 'three';

/** Return individually owned materials: callers dispose them with their scene geometry. */
export function anodizedRailMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: 0x334155, metalness: 0.82, roughness: 0.28, clearcoat: 0.2 });
}
export function brushedCopperMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.88, roughness: 0.24 });
}
export function magneticFluxMaterial(color = 0x38bdf8): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, transparent: true, opacity: 0.72, depthWrite: false });
}
export function dielectricGlassMaterial(color = 0x7dd3fc): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, transmission: 0.78, roughness: 0.08, ior: 1.5, transparent: true, opacity: 0.45, depthWrite: false });
}
export function obsidianStageFloorMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x0b0f17, roughness: 0.65, metalness: 0.15 });
}

/** E10 only: copper highlights and bounded local flux glow (no postprocessing pass). */
export function coilCopperMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: 0xa45e38, metalness: 0.92, roughness: 0.19, clearcoat: 0.42, clearcoatRoughness: 0.16, envMapIntensity: 0.92 });
}
export function coilFluxCoreMaterial(vertexColors = false): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: 0x75e5f1, toneMapped: false, transparent: true, opacity: 0.87, depthWrite: false, vertexColors });
}
export function coilFluxHaloMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: 0x2ebbd7, toneMapped: false, transparent: true, opacity: 0.11, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true });
}

/** Fade only the ends of display-truncated curves; not a field-strength encoding.
 * Tube UV.x is normalized arc length. Four-channel vertex colors carry alpha. */
export function applyFluxEndpointFade(geometry: THREE.TubeGeometry, closed: boolean): void {
  const uv = geometry.getAttribute('uv');
  const rgba = new Float32Array(uv.count * 4);
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const t = closed ? 1 : Math.min(1, Math.max(0, Math.min(u, 1-u) / 0.15));
    rgba.set([1,1,1,t*t*(3-2*t)], 4*i);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
}

/** Screen-space midnight gradient for E10 only; deterministic local texture. */
export function createMagneticBackdrop(): THREE.DataTexture {
  const size = 96, data = new Uint8Array(size*size*4);
  for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
    const u=(x+0.5)/size, v=(y+0.5)/size;
    const glow=Math.exp(-3.8*((u-.49)**2+(v-.56)**2));
    const i=4*(y*size+x);
    data[i]=Math.round(6+7*glow); data[i+1]=Math.round(9+11*glow);
    data[i+2]=Math.round(15+15*glow); data[i+3]=255;
  }
  const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.minFilter=THREE.LinearFilter; texture.magFilter=THREE.LinearFilter;
  texture.needsUpdate=true;
  return texture;
}
/** Procedural sprite; no external assets. Explicit disposal owned by the caller. */
export function createParticleGlow() {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot((x+0.5-size/2)/(size/2), (y+0.5-size/2)/(size/2));
    const i = (y*size+x)*4;
    data[i]=255; data[i+1]=210; data[i+2]=120;
    data[i+3]=Math.round(225*Math.max(0,Math.exp(-5*r*r)-Math.exp(-5)));
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.minFilter=THREE.LinearFilter; texture.magFilter=THREE.LinearFilter;
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(7.5,7.5,1);
  return { sprite, texture, material };
}
