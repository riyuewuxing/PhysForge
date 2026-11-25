import { CLASSROOM_GRAVITY as g } from '@physforge/physics-core';
import type { PresetSpec } from '@physforge/sim-sdk';
import type { VerticalCircularParams } from './engine.js';

export const verticalCircularPresets: readonly PresetSpec<VerticalCircularParams>[] = [
  {
    id: 'smooth-dome-derail',
    name: '1. 光滑半球面微扰下滑（近似 cosθd=2/3）',
    description: '从顶点附近以微小初速下滑，脱轨角接近 arccos(2/3)≈48.19°；切向速度连续，之后为自由抛体（并非平抛）。精确顶点静止不自发运动。',
    params: { trackMode: 'outer-dome', mass: 1.0, radius: 1.6, vLaunch: 0.01, startAngleDeg: 0.5 }
  },
  {
    id: 'inner-loop-subcritical',
    name: '2. 竖直内圆轨道脱离（√2gR < v₀ < √5gR）',
    description: '底部初速不足以过最高点，质点上升过圆心等高线后在压力 FN = 0 处脱离转为斜抛运动。',
    params: { trackMode: 'inner-loop', mass: 1.0, radius: 1.4, vLaunch: 6.8, startAngleDeg: 0 }
  },
  {
    id: 'light-rod-full-loop',
    name: '3. 双边轻杆完整圆周（可压可拉）',
    description: '切换为轻杆模型后约束力可双向变号，最低点初速严格大于 √(4gR) 才能在有限时间越过最高点；等号是渐近极限。',
    params: { trackMode: 'light-rod', mass: 1.0, radius: 1.4, vLaunch: 7.6, startAngleDeg: 0 }
  },
  {id:'inner-loop-critical',name:'4. 内轨临界完整圆周（最高点 N=0）',description:'底部初速精确 √5gR，最高点零反力切触，不进入负反力区，不脱轨。',params:{trackMode:'inner-loop',mass:1,radius:1.6,vLaunch:Math.sqrt(5*g*1.6),startAngleDeg:0}},
  {id:'outer-launch-release',name:'5. 外凸起始接触不成立（t=0 脱离）',description:'所需向外反力为负；支持面不能拉住质点，立即沿初始切向自由抛体。',params:{trackMode:'outer-dome',mass:1,radius:1.6,vLaunch:5,startAngleDeg:30}},
  {id:'inner-loop-side-turn',name:'6. 内轨侧点零力折返（v=0）',description:'初速 √2gR，侧点速度和反力同时为零，重力切向驱动折返，不脱离。',params:{trackMode:'inner-loop',mass:1,radius:1.6,vLaunch:Math.sqrt(2*g*1.6),startAngleDeg:0}}
];
