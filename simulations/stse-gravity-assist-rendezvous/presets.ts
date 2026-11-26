import type { PresetSpec } from '@physforge/sim-sdk';
import type { GravityAssistRendezvousParams } from './engine.js';

export const gravityAssistPresets: readonly PresetSpec<GravityAssistRendezvousParams>[] = [
  {
    id: 'slingshot-trailing-speedup',
    name: '局部二体掠飞：后侧示意',
    description: '归一化局部模型：比较参考系速度与比机械能，不是实测木星轨迹或真实任务规划',
    curriculumNotes: '必修第二册 第七章 · 引力弹弓借力与参考系转换 STSE',
    params: {
      mode: 'gravity-assist',
      flybySide: 'trailing',
      muPlanet: 0.16,
      planetOrbitRadius: 5.0,
      impactParam: 0.38,
      rendezvousBurn: 'prograde-boost',
      deltaVFraction: 0.05
    }
  },
  {
    id: 'slingshot-leading-braking',
    name: '局部二体掠飞：前侧示意',
    description: '比较局部惯性系与行星系速度；不冒充真实任务轨迹',
    curriculumNotes: '必修第二册 第七章 · 引力减速进入内行星轨道',
    params: {
      mode: 'gravity-assist',
      flybySide: 'leading',
      muPlanet: 0.16,
      planetOrbitRadius: 5.0,
      impactParam: 0.38,
      rendezvousBurn: 'prograde-boost',
      deltaVFraction: 0.05
    }
  },
  {
    id: 'rendezvous-prograde-paradox',
    name: '圆轨相位比较：初始切向增速',
    description: '目标和追踪舱的归一化轨道周期及相角比较；不表示交会或对接已经完成',
    curriculumNotes: '必修第二册 第七章 · 开普勒第三定律与天体追及逆直觉变轨',
    params: {
      mode: 'rendezvous',
      flybySide: 'trailing',
      muPlanet: 0.16,
      planetOrbitRadius: 5.0,
      impactParam: 0.38,
      rendezvousBurn: 'prograde-boost',
      deltaVFraction: 0.06
    }
  }
];
