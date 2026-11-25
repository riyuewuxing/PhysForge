import type { PresetSpec } from '@physforge/sim-sdk';
import type { ProjectileCouplingParams } from './engine.js';

export const projectileCouplingPresets: readonly PresetSpec<ProjectileCouplingParams>[] = [
  {
    id: 'flat-throw-onto-37deg',
    name: '1. 平抛落 37° 斜面（飞行时间 t=2v₀tanθ/g）',
    description: '水平抛出后精准捕获落入斜面时刻，同时对比速度反向延长线交于水平位移中点。',
    params: { mode: 'incline-flat', v0: 6.0, launchAngleDeg: 0, inclineDeg: 37, troughRadius: 2.0, dragCoeff: 0, mass: 1.0 }
  },
  {
    id: 'semicircle-trough-hit',
    name: '2. 水平抛射进入半圆弧槽',
    description: '平抛进入真实下半圆槽，通过改变初速度观察第一次撞击位置；不是完整的双解搜索器。',
    params: { mode: 'semicircle-trough', v0: 4.0, launchAngleDeg: 0, inclineDeg: 30, troughRadius: 2.5, dragCoeff: 0, mass: 1.0 }
  },
  {
    id: 'oblique-safety-envelope',
    name: '3. 斜抛运动安全包络线与空气阻力对比',
    description: '打开空气阻力 c_d 后，实时轨迹严格处于真空安全抛物线包络内侧且落地动能更小。',
    params: { mode: 'safety-envelope', v0: 8.0, launchAngleDeg: 55, inclineDeg: 30, troughRadius: 2.0, dragCoeff: 0.08, mass: 1.0 }
  },
  {id:'oblique-escape-rim',name:'4. 斜抛越过半圆槽右口',description:'不碰撞不存在的上半圆；在右槽口上方终止，区分出界与撞击。',params:{mode:'semicircle-trough',v0:8,launchAngleDeg:60,inclineDeg:30,troughRadius:1,dragCoeff:0,mass:1}}
];
