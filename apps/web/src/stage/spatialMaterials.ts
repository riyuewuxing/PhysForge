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
  return new THREE.MeshPhysicalMaterial({ color: 0xb87353, metalness: 0.83, roughness: 0.22, clearcoat: 0.55, clearcoatRoughness: 0.18, envMapIntensity: 1.15 });
}
export function coilFluxCoreMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: 0x54d7ed, toneMapped: false, transparent: true, opacity: 0.77, depthWrite: false });
}
export function coilFluxHaloMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: 0x258eaf, toneMapped: false, transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending });
}
/** Procedural sprite; no external assets. Explicit disposal owned by the caller. */
export function createParticleGlow() {
  const size = 32, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot((x+0.5-size/2)/(size/2), (y+0.5-size/2)/(size/2));
    const i = (y*size+x)*4;
    data[i]=255; data[i+1]=210; data[i+2]=120;
    data[i+3]=Math.round(190*Math.max(0,1-r)**2);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(6,6,1);
  return { sprite, texture, material };
}
