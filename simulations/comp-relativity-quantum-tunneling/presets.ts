import type { PresetSpec } from '@physforge/sim-sdk';
import type { RelativityQuantumParams } from './engine.js';

export const relativityQuantumPresets: readonly PresetSpec<RelativityQuantumParams>[] = [
  {
    id: 'tdse-sub-barrier-tunneling',
    name: '一维高斯波包量子势垒隧穿（E₀ < V₀, Crank-Nicolson 幺正演化）',
    description: '波包能量 E₀=2.0 低于势垒 V₀=2.45，经典粒子 100% 反射，而量子波函数指数穿透势垒产生非零透射率 T',
    curriculumNotes: '强基/大学量子先修 · 512 格一维含时薛定谔方程与概率流守恒',
    params: {
      mode: 'tdse-tunneling',
      potentialShape: 'single-barrier',
      barrierHeightV0: 2.45,
      barrierWidth: 1.4,
      waveMomentumK0: 2.0,
      packetSigma: 3.2,
      lorentzBeta: 0.6,
      eventX: 3.0,
      eventCt: 5.0
    }
  },
  {
    id: 'tdse-double-barrier-resonance',
    name: '双势垒量子共振隧穿与方势阱散射（法布里-珀罗量子态）',
    description: '对称双势垒内形成驻波准束缚态，特定动量波包可发生强烈共振透射与势阱内波纹干涉',
    curriculumNotes: '强基/大学量子 · 谐振隧穿与散射振幅干涉',
    params: {
      mode: 'tdse-tunneling',
      potentialShape: 'double-barrier',
      barrierHeightV0: 2.45,
      barrierWidth: 1.2,
      waveMomentumK0: 2.0,
      packetSigma: 3.2,
      lorentzBeta: 0.6,
      eventX: 3.0,
      eventCt: 5.0
    }
  },
  {
    id: 'minkowski-lorentz-twins',
    name: '狭义相对论闵可夫斯基时空图：同时线偏转、光锥与双生子佯谬',
    description: '动态调节相对速率 β=v/c，直观展示洛伦兹剪切坐标轴、类时双曲线不变性 (Δs²=c²t²-x²) 与固有时差异',
    curriculumNotes: '选择性必修三 / 强基竞赛 · 狭义相对论时空几何不变量',
    params: {
      mode: 'minkowski-relativity',
      potentialShape: 'single-barrier',
      barrierHeightV0: 2.45,
      barrierWidth: 1.4,
      waveMomentumK0: 2.0,
      packetSigma: 3.2,
      lorentzBeta: 0.6,
      eventX: 3.0,
      eventCt: 5.0
    }
  }
];
