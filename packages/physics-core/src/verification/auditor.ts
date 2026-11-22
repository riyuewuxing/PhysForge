import type { Vec3 } from '../vectors/index.js';

export interface EnergyBudget {
  readonly kinetic?: number;
  readonly gravitationalPotential?: number;
  readonly elasticPotential?: number;
  readonly electromagnetic?: number;
  readonly dissipatedHeat?: number;
  readonly externalWork?: number;
}

export interface MomentumBudget {
  readonly linear: Vec3;
  readonly angularZ?: number;
}

export type AuditStatus = 'pass' | 'warn' | 'fail';

export interface ConservationAuditReport {
  readonly name: string;
  readonly currentTotal: number;
  readonly expectedTotal: number;
  readonly absoluteResidual: number;
  readonly relativeResidual: number;
  readonly tolerance: number;
  readonly status: AuditStatus;
}

/**
 * 统一全能量预算审计器：
 * δ_E = |E_total(t) - E_total(0) - W_ext(t)| / max(|E_total(0)|, E_ref)
 */
export function auditEnergyBudget(
  budget: EnergyBudget,
  initialMechanicalAndEm: number,
  tolerance = 1e-4,
  referenceScale = 1e-9
): ConservationAuditReport {
  const totalStored =
    (budget.kinetic ?? 0) +
    (budget.gravitationalPotential ?? 0) +
    (budget.elasticPotential ?? 0) +
    (budget.electromagnetic ?? 0) +
    (budget.dissipatedHeat ?? 0);

  const expected = initialMechanicalAndEm + (budget.externalWork ?? 0);
  const absRes = Math.abs(totalStored - expected);
  const denom = Math.max(Math.abs(initialMechanicalAndEm), Math.abs(expected), referenceScale);
  const relRes = absRes / denom;

  const status: AuditStatus =
    relRes <= tolerance ? 'pass' : relRes <= tolerance * 10 ? 'warn' : 'fail';

  return {
    name: '全系统能量预算审计 δ_E',
    currentTotal: totalStored,
    expectedTotal: expected,
    absoluteResidual: absRes,
    relativeResidual: relRes,
    tolerance,
    status
  };
}

/**
 * 线动量守恒残差审计器
 */
export function auditMomentumBudget(
  current: MomentumBudget,
  initial: MomentumBudget,
  tolerance = 1e-5,
  referenceScale = 1e-9
): ConservationAuditReport {
  const dx = current.linear.x - initial.linear.x;
  const dy = current.linear.y - initial.linear.y;
  const dz = current.linear.z - initial.linear.z;
  const absRes = Math.hypot(dx, dy, dz);
  const initMag = Math.hypot(initial.linear.x, initial.linear.y, initial.linear.z);
  const relRes = absRes / Math.max(initMag, referenceScale);

  const status: AuditStatus =
    relRes <= tolerance ? 'pass' : relRes <= tolerance * 10 ? 'warn' : 'fail';

  return {
    name: '系统线动量守恒审计 δ_p',
    currentTotal: Math.hypot(current.linear.x, current.linear.y, current.linear.z),
    expectedTotal: initMag,
    absoluteResidual: absRes,
    relativeResidual: relRes,
    tolerance,
    status
  };
}
