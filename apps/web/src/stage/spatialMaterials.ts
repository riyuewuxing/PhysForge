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
