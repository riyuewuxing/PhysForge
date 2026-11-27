import type { PresetSpec } from '@physforge/sim-sdk';
import type { RelativityQuantumParams } from './engine.js';

export const relativityQuantumPresets: readonly PresetSpec<RelativityQuantumParams>[] = [
  {
    id: 'tdse-sub-barrier-tunneling',
    name: '一维高斯波包量子势垒隧穿（E₀ < V₀, Crank-Nicolson 幺正演化）',
    description: '中心动能 E₀=2.0 低于势垒 V₀=2.45；有限波包具有动量展宽，观察势垒两侧占据概率随时间演化',
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
    name: '双势垒干涉腔（扫描中心波矢探查共振）',
    description: '对称双势垒的腔内干涉与占据概率；比较不同中心波矢，不预设当前参数必然共振',
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
    description: '静态调节有向 β=v/c 与事件坐标；等比例光锥、洛伦兹轴和不变间隔；理想瞬时折返世界线的同端点固有时比较',
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
