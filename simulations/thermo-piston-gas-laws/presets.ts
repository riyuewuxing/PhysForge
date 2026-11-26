import type { PresetSpec } from '@physforge/sim-sdk';
import type { ThermoGasParams } from './engine.js';

export const thermoGasPresets: readonly PresetSpec<ThermoGasParams>[] = [
  {
    id: 'cylinder-pin-detach',
    name: '下卡口 · 等容升温后等压膨胀',
    description: '初始温度 T₀=260K 时活塞抵在卡口上等容增压；达到临界温度 Tcrit 自动脱离卡口转为等压上升',
    curriculumNotes: '选择性必修三 第二章 · 汽缸卡口双模态热力学过程',
    params: {
      mode: 'stop-pin-cylinder',
      molesN: 0.25,
      initialTempK: 260,
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
    description: '每个倾角从同一水平参考独立求解，比较气柱长度与是否溢出',
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
    description: '理想等温变质量过程，逐级显示定容储气罐压强与物质的量',
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
  },
  {id:'cylinder-cooling-hit-pin',name:'热汽缸降温 · 触及下卡口',description:'420 K 开始等压压缩，触及限位后等容降温，气体对外做功为负',curriculumNotes:'反向临界事件',params:{mode:'stop-pin-cylinder',initialTempK:420,targetTempK:220,molesN:.25,pistonAreaCm2:50,pistonMassKg:10,pinVolumeL:5,heatingRateKPerS:60}},
  {id:'mercury-spill-conserved',name:'竖直倒置 · 溢出后守恒',description:'L=45 cm，水平参考 h₀=30 cm，联立静力平衡与封闭气体量',curriculumNotes:'溢出后重新求根',params:{mode:'mercury-tube-tilt',tubeTiltDeg:-90,tubeLengthCm:45,mercuryCm:30,pistonAreaCm2:20,targetTempK:300}},
  {id:'mercury-horizontal-reference',name:'水平管 · 原始参考状态',description:'同一参考构型的零倾角基准',curriculumNotes:'玻意耳定律初态',params:{mode:'mercury-tube-tilt',tubeTiltDeg:0,tubeLengthCm:45,mercuryCm:30,pistonAreaCm2:20,targetTempK:300}},
  {id:'pump-injection-stages',name:'打气 · 五次等温操作',description:'每次吸入大气压下固定体积气体，储气罐定容，压强线性增加',curriculumNotes:'变质量充气',params:{mode:'multi-stroke-pump',tankVolumeL:10,pumpDeltaVL:2.5,pumpStrokesK:5,pumpDirection:'inject',targetTempK:300}},
  {id:'pump-zero-stroke',name:'零次操作 · 大气压初态',description:'无物质转移，不生成虚假冲程',curriculumNotes:'离散序列边界',params:{mode:'multi-stroke-pump',tankVolumeL:10,pumpDeltaVL:2.5,pumpStrokesK:0,pumpDirection:'extract',targetTempK:300}}
];
