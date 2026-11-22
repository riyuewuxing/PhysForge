import type { PresetSpec } from '@physforge/sim-sdk';
import type { ShmResonanceParams } from './engine.js';

export const shmResonancePresets: readonly PresetSpec<ShmResonanceParams>[] = [
  {
    id: 'small-angle-pendulum-reference',
    name: '小角单摆等时性与参考圆对照 (2°)',
    description: '验证小角周期 T=2π√(L/g) 与底部参考圆投影的严格同步性',
    curriculumNotes: '选择性必修一 · 单摆与简谐运动',
    params: {
      mode: 'pendulum-compare',
      lengthL: 1,
      gravityG: 9.8,
      massM: 1,
      initialAngleDeg: 2,
      dampingGamma: 0,
      driveAccelAmp: 0,
      driveOmega: 3.13
    }
  },
  {
    id: 'large-angle-nonisochronous',
    name: '大角度非线性摆 vs 谐振幽灵摆 (60°)',
    description: '无阻尼 60° 摆动下真实单摆逐渐滞后于粉色简谐幽灵摆，验证等时性仅限小角',
    curriculumNotes: '选择性必修一 · 拓展模型辨析',
    params: {
      mode: 'pendulum-compare',
      lengthL: 1.2,
      gravityG: 9.8,
      massM: 1,
      initialAngleDeg: 60,
      dampingGamma: 0,
      driveAccelAmp: 0,
      driveOmega: 2.86
    }
  },
  {
    id: 'damped-phase-spiral',
    name: '阻尼单摆与相空间螺线收敛',
    description: '在分析实验室切换 θ-ω 相图，观察系统能量耗散向平衡点收缩的相轨线',
    curriculumNotes: '选择性必修一 · 阻尼振动',
    params: {
      mode: 'damped-free',
      lengthL: 1,
      gravityG: 9.8,
      massM: 1,
      initialAngleDeg: 45,
      dampingGamma: 0.25,
      driveAccelAmp: 0,
      driveOmega: 3
    }
  },
  {
    id: 'forced-resonance-peak',
    name: '受迫振动与共振曲线峰值 (ω_res=√(ω₀²-2γ²))',
    description: '驱动频率逼近理论共振峰，振幅显著放大并锁定稳态受迫相位差',
    curriculumNotes: '选择性必修一 · 受迫振动与共振',
    params: {
      mode: 'forced-resonance',
      lengthL: 1,
      gravityG: 9.8,
      massM: 1,
      initialAngleDeg: 2,
      dampingGamma: 0.45,
      driveAccelAmp: 0.8,
      driveOmega: 3.065
    }
  }
];
