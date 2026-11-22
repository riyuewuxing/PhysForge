import type { PresetSpec } from '@physforge/sim-sdk';
import type { GravityAssistRendezvousParams } from './engine.js';

export const gravityAssistPresets: readonly PresetSpec<GravityAssistRendezvousParams>[] = [
  {
    id: 'slingshot-trailing-speedup',
    name: '木星背向绕飞“引力弹弓”加速（日心增速 + 行星系守恒）',
    description: '探测器从行星运动尾后方掠过，行星系下出入速率相等（<1e-5），日心系中动能大幅提升',
    curriculumNotes: '必修第二册 第七章 · 引力弹弓借力与参考系转换 STSE',
    params: {
      mode: 'gravity-assist',
      flybySide: 'trailing',
      frameView: 'heliocentric',
      muPlanet: 0.16,
      planetOrbitRadius: 5.0,
      impactParam: 0.38,
      rendezvousBurn: 'prograde-boost',
      deltaVFraction: 0.05
    }
  },
  {
    id: 'slingshot-leading-braking',
    name: '木星前侧绕飞“引力刹车”减速（信使号/卡西尼号模式）',
    description: '探测器从行星前方绕过时将轨道能量反向传递给行星，日心速率与机械能显著降低',
    curriculumNotes: '必修第二册 第七章 · 引力减速进入内行星轨道',
    params: {
      mode: 'gravity-assist',
      flybySide: 'leading',
      frameView: 'planet-frame',
      muPlanet: 0.16,
      planetOrbitRadius: 5.0,
      impactParam: 0.38,
      rendezvousBurn: 'prograde-boost',
      deltaVFraction: 0.05
    }
  },
  {
    id: 'rendezvous-prograde-paradox',
    name: '空间站交会悖论：正向加速反而被目标舱越甩越远',
    description: '同轨后方追赶舱正向点火加速后进入周期更长的高轨椭圆，绕飞一整周后反比加速前更加落后',
    curriculumNotes: '必修第二册 第七章 · 开普勒第三定律与天体追及逆直觉变轨',
    params: {
      mode: 'rendezvous',
      flybySide: 'trailing',
      frameView: 'heliocentric',
      muPlanet: 0.16,
      planetOrbitRadius: 5.0,
      impactParam: 0.38,
      rendezvousBurn: 'prograde-boost',
      deltaVFraction: 0.06
    }
  }
];
