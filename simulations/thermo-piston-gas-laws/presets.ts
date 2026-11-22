import type { PresetSpec } from '@physforge/sim-sdk';
import type { ThermoGasParams } from './engine.js';

export const thermoGasPresets: readonly PresetSpec<ThermoGasParams>[] = [
  {
    id: 'cylinder-pin-detach',
    name: '下卡口汽缸先等容升温后等压膨胀（拐点精准二分）',
    description: '初始温度 T₀=260K 时活塞抵在卡口上等容增压；达到临界温度 Tcrit 自动脱离卡口转为等压上升',
    curriculumNotes: '选择性必修三 第二章 · 汽缸卡口双模态热力学过程',
    params: {
      mode: 'stop-pin-cylinder',
      molesN: 0.25,
      targetTempK: 420,
      heatingRateKPerS: 60,
      pistonAreaCm2: 50,
      pistonMassKg: 10,
      pinVolumeL: 5.0,
      tubeTiltDeg: 0,
      mercuryCm: 20,
      tubeLengthCm: 75,
      tankVolumeL: 10,
      pumpDeltaVL: 2,
      pumpStrokesK: 3,
      pumpDirection: 'extract'
    }
  },
  {
    id: 'mercury-tube-inverted-spill',
    name: '倾转水银柱玻璃管（开口向上/水平/倒置溢出判别）',
    description: '拖动倾角 θ 由 +90° 转至 -90°，实时计算气柱膨胀与水银柱是否溢出临界长度',
    curriculumNotes: '选择性必修三 · 玻璃管封闭气体液柱平衡',
    params: {
      mode: 'mercury-tube-tilt',
      molesN: 0.25,
      targetTempK: 300,
      heatingRateKPerS: 40,
      pistonAreaCm2: 10,
      pistonMassKg: 5,
      pinVolumeL: 5.0,
      tubeTiltDeg: -60,
      mercuryCm: 22,
      tubeLengthCm: 62,
      tankVolumeL: 10,
      pumpDeltaVL: 2,
      pumpStrokesK: 3,
      pumpDirection: 'extract'
    }
  },
  {
    id: 'vacuum-pump-boyle-strokes',
    name: '变质量抽气机连续抽气 k 次（P_k = P₀(V/(V+ΔV))^k）',
    description: '利用等温微元体积守恒推导并逐次检验密闭容器连续抽气后的精确衰减压强',
    curriculumNotes: '选择性必修三 · 变质量等温充放气经典题型',
    params: {
      mode: 'multi-stroke-pump',
      molesN: 0.25,
      targetTempK: 300,
      heatingRateKPerS: 40,
      pistonAreaCm2: 50,
      pistonMassKg: 10,
      pinVolumeL: 5.0,
      tubeTiltDeg: 0,
      mercuryCm: 20,
      tubeLengthCm: 75,
      tankVolumeL: 10,
      pumpDeltaVL: 2.5,
      pumpStrokesK: 5,
      pumpDirection: 'extract'
    }
  }
];
