import type { PresetSpec } from '@physforge/sim-sdk';
import type { RigidRollingParams } from './engine.js';

export const rigidRollingPresets: readonly PresetSpec<RigidRollingParams>[] = [
  {
    id: 'solid-sphere-slip-to-roll',
    name: '水平实心球平动打滑转纯滚（t_c = 2v₀/7μg, v_c = 5v₀/7）',
    description: '实心球以初平动速率 v₀ 无旋转掷出，HybridAutomaton 精确二分捕捉纯滚转换点',
    curriculumNotes: '强基/竞赛专题 · 刚体平面运动滑滚转换二分事件定位',
    params: {
      scenario: 'flat-bowling-slip',
      shape: 'solid-sphere',
      massKg: 2.0,
      radiusM: 0.12,
      v0Mps: 7.0,
      omega0Radps: 0,
      muK: 0.25,
      inclineDeg: 20
    }
  },
  {
    id: 'bowling-backspin-return',
    name: '“回旋保龄球”强倒旋抛投：减速止步后逆向滚回起点',
    description: '设置强烈反向自旋 ω₀ = -120 rad/s，在摩擦力矩尚未耗尽反转前使质心速度反向滚回',
    curriculumNotes: '强基/大学先修 · 角动量与平动耦合逆直觉现象',
    params: {
      scenario: 'flat-bowling-slip',
      shape: 'solid-sphere',
      massKg: 2.0,
      radiusM: 0.12,
      v0Mps: 4.0,
      omega0Radps: -120,
      muK: 0.3,
      inclineDeg: 20
    }
  },
  {
    id: 'four-rigid-bodies-incline-race',
    name: '四刚体同斜面纯滚动竞速：实心球最快 vs 薄圆环最慢',
    description: '同时对比实心球(0.4)、实心圆柱(0.5)、空心球壳(2/3)、薄圆环(1.0) 从斜面同时静止滚落',
    curriculumNotes: '强基/大学先修 · 转动惯量因子 c 对平动加速度 a = g sinθ/(1+c) 的影响',
    params: {
      scenario: 'incline-race',
      shape: 'solid-sphere',
      massKg: 1.5,
      radiusM: 0.12,
      v0Mps: 0,
      omega0Radps: 0,
      muK: 0.3,
      inclineDeg: 25
    }
  }
];
