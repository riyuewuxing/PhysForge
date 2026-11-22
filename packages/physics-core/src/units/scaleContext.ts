export type PhysicalDimension =
  | 'dimensionless'
  | 'length'
  | 'time'
  | 'mass'
  | 'charge'
  | 'velocity'
  | 'acceleration'
  | 'force'
  | 'energy'
  | 'momentum'
  | 'electricField'
  | 'magneticField';

export interface ScaleConfig {
  readonly lengthUnit: number; // L0 (m)
  readonly timeUnit: number; // T0 (s)
  readonly massUnit: number; // M0 (kg)
  readonly chargeUnit: number; // Q0 (C)
}

export interface ScaleContext extends ScaleConfig {
  readonly velocityUnit: number;
  readonly accelerationUnit: number;
  readonly forceUnit: number;
  readonly energyUnit: number;
  readonly momentumUnit: number;
  readonly electricFieldUnit: number;
  readonly magneticFieldUnit: number;
  toDimless: (valueSI: number, dim: PhysicalDimension) => number;
  toSI: (dimlessValue: number, dim: PhysicalDimension) => number;
}

/**
 * 创建基于 (L0, T0, M0, Q0) 四基本量的无量纲物理缩放上下文，防止跨尺度数值下溢/病态
 */
export function createScaleContext(config: ScaleConfig): ScaleContext {
  const { lengthUnit: L0, timeUnit: T0, massUnit: M0, chargeUnit: Q0 } = config;
  if (
    !Number.isFinite(L0) ||
    L0 <= 0 ||
    !Number.isFinite(T0) ||
    T0 <= 0 ||
    !Number.isFinite(M0) ||
    M0 <= 0 ||
    !Number.isFinite(Q0) ||
    Q0 <= 0
  ) {
    throw new Error('ScaleContext base units (L0, T0, M0, Q0) must be positive finite numbers.');
  }

  const velocityUnit = L0 / T0;
  const accelerationUnit = L0 / (T0 * T0);
  const forceUnit = (M0 * L0) / (T0 * T0);
  const energyUnit = forceUnit * L0;
  const momentumUnit = M0 * velocityUnit;
  const electricFieldUnit = forceUnit / Q0;
  const magneticFieldUnit = M0 / (Q0 * T0);

  const getUnit = (dim: PhysicalDimension): number => {
    switch (dim) {
      case 'dimensionless':
        return 1;
      case 'length':
        return L0;
      case 'time':
        return T0;
      case 'mass':
        return M0;
      case 'charge':
        return Q0;
      case 'velocity':
        return velocityUnit;
      case 'acceleration':
        return accelerationUnit;
      case 'force':
        return forceUnit;
      case 'energy':
        return energyUnit;
      case 'momentum':
        return momentumUnit;
      case 'electricField':
        return electricFieldUnit;
      case 'magneticField':
        return magneticFieldUnit;
    }
  };

  return {
    lengthUnit: L0,
    timeUnit: T0,
    massUnit: M0,
    chargeUnit: Q0,
    velocityUnit,
    accelerationUnit,
    forceUnit,
    energyUnit,
    momentumUnit,
    electricFieldUnit,
    magneticFieldUnit,
    toDimless: (valueSI, dim) => valueSI / getUnit(dim),
    toSI: (dimlessValue, dim) => dimlessValue * getUnit(dim)
  };
}

/** 原子尺度哈特里缩放上下文 (L0 = a_0, M0 = m_e, Q0 = e) */
export const ATOMIC_BOHR_SCALE: ScaleContext = createScaleContext({
  lengthUnit: 5.29177210903e-11,
  timeUnit: 2.4188843265857e-17,
  massUnit: 9.1093837015e-31,
  chargeUnit: 1.602176634e-19
});

/** 行星天体轨道缩放上下文 (L0 = 1e7 m, T0 = 1e3 s, M0 = 1e24 kg) */
export const PLANETARY_ORBIT_SCALE: ScaleContext = createScaleContext({
  lengthUnit: 1e7,
  timeUnit: 1e3,
  massUnit: 1e24,
  chargeUnit: 1
});

/** 经典实验室 SI 单位制直通缩放 */
export const SI_IDENTITY_SCALE: ScaleContext = createScaleContext({
  lengthUnit: 1,
  timeUnit: 1,
  massUnit: 1,
  chargeUnit: 1
});
