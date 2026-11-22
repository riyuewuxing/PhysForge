import type { PresetSpec } from '@physforge/sim-sdk';
import type { TransformerGridParams } from './engine.js';

export const transformerGridPresets: readonly PresetSpec<TransformerGridParams>[] = [
  {
    id: 'primary-resistor-parallel-users',
    name: '含原线圈串联电阻 R₀ 动态并入多用户（电表↑/↓实时标定）',
    description: '闭合开关 S 并联更多用户时总负载减小，I₁↑ 导致 R₀ 分压上升、U₁↓ 及 U₂↓',
    curriculumNotes: '选择性必修二 第三章 第3节 · 理想变压器等效电阻法',
    params: {
      mode: 'multi-tap-transformer',
      sourceU0: 220,
      primaryR0: 10,
      n1Ratio: 2,
      n2Ratio: 1,
      n3Ratio: 1,
      loadR2: 50,
      loadR3: 40,
      branch3Closed: true,
      baselineParallelUsers: 1,
      parallelUsersCount: 2,
      genPowerKw: 100,
      stepUpRatioK1: 10,
      lineResistanceR: 20
    }
  },
  {
    id: 'high-voltage-10x-vs-20x',
    name: '远距离高压输电（升压比翻倍 → 线损降为 1/4）',
    description: '保持总传输功率 100 kW 不变，升压比由 10 倍提升至 20 倍，对比输电线损耗瀑布条锐减 75%',
    curriculumNotes: '选择性必修二 第三章 第4节 · 电能的输送',
    params: {
      mode: 'long-distance-grid',
      sourceU0: 250,
      primaryR0: 0,
      n1Ratio: 1,
      n2Ratio: 1,
      n3Ratio: 1,
      loadR2: 50,
      loadR3: 40,
      branch3Closed: false,
      baselineParallelUsers: 1,
      parallelUsersCount: 1,
      genPowerKw: 100,
      stepUpRatioK1: 20,
      lineResistanceR: 20
    }
  },
  {
    id: 'multi-tap-dual-secondary',
    name: '双副线圈独立变压输出功率耦合',
    description: '原边电阻设为 0 时副线圈互不影响；若闭合第 3 路开关，原边输入功率自动按 ΣUₖIₖ 叠加',
    curriculumNotes: '选择性必修二 · 一原多副变压器',
    params: {
      mode: 'multi-tap-transformer',
      sourceU0: 220,
      primaryR0: 0,
      n1Ratio: 4,
      n2Ratio: 2,
      n3Ratio: 1,
      loadR2: 55,
      loadR3: 27.5,
      branch3Closed: true,
      baselineParallelUsers: 1,
      parallelUsersCount: 1,
      genPowerKw: 100,
      stepUpRatioK1: 10,
      lineResistanceR: 20
    }
  }
];
