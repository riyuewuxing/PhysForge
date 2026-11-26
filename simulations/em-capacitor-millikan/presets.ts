import type { PresetSpec } from '@physforge/sim-sdk';
import type { CapacitorMillikanParams } from './engine.js';

export const capacitorMillikanPresets: readonly PresetSpec<CapacitorMillikanParams>[] = [
  {
    id: 'open-switch-distance-invariant',
    name: '断开开关改变极板间距 d（场强 E 严格不变）',
    description: '开关断开保持电荷 Q 恒定，拖动 d 观察电压与静电计指针变化及内部场强 ΔE≡0',
    curriculumNotes: '必修三 第十章 · 电容器动态分析经典结论',
    params: {
      switchMode: 'open-const-q',
      groundMode: 'bottom',
      sourceVoltageU0: 200,
      distanceMm: 28,
      refDistanceMm: 20,
      areaRatioS: 1.0,
      refAreaRatioS: 1.0,
      dielectricEr: 1,
      refDielectricEr: 1,
      probeFracP: 0.4,
      oilDropEnabled: false,
      dropChargeSteps: 2,
      dropMassScale: 1,
      stokesDrag: 4
    }
  },
  {
    id: 'closed-switch-const-u',
    name: '闭合开关接恒压电源（调 d、S、εr）',
    description: '开关闭合保持电压 U 恒定，增大介电常数 εr 或减小 d 将显著增加电容与带电量',
    curriculumNotes: '必修三 第十章 · 恒压动态分析',
    params: {
      switchMode: 'closed-const-u',
      groundMode: 'bottom',
      sourceVoltageU0: 200,
      distanceMm: 16,
      refDistanceMm: 20,
      areaRatioS: 0.85,
      refAreaRatioS: 1.0,
      dielectricEr: 2.5,
      refDielectricEr: 1,
      probeFracP: 0.5,
      oilDropEnabled: false,
      dropChargeSteps: 2,
      dropMassScale: 1,
      stokesDrag: 4
    }
  },
  {
    id: 'millikan-oil-drop-balance',
    name: '密立根油滴静悬平衡态 (qE = mg)',
    description: '闭合高压微调电压 U₀，真实 q=−2e 与示教质量，固定电压下静悬；改变电压观察运动',
    curriculumNotes: '必修三 · 密立根油滴测量元电荷',
    params: {
      switchMode: 'closed-const-u',
      groundMode: 'bottom',
      sourceVoltageU0: 200,
      distanceMm: 20,
      refDistanceMm: 20,
      areaRatioS: 1.0,
      refAreaRatioS: 1.0,
      dielectricEr: 1,
      refDielectricEr: 1,
      probeFracP: 0.5,
      oilDropEnabled: true,
      dropChargeSteps: 2,
      dropMassScale: 1,
      stokesDrag: 6
    }
  },
  {
    id: 'top-plate-grounded-potential',
    name: '上极板接地 · 电势零点对照',
    description: '切换上/下板接地，定量读出探针 P 点电势 φP 随极板间距变化的单调规律',
    curriculumNotes: '必修三 · 电容器内部某点电势判断',
    params: {
      switchMode: 'open-const-q',
      groundMode: 'top',
      sourceVoltageU0: 200,
      distanceMm: 24,
      refDistanceMm: 20,
      areaRatioS: 1.0,
      refAreaRatioS: 1.0,
      dielectricEr: 1,
      refDielectricEr: 1,
      probeFracP: 0.3,
      oilDropEnabled: false,
      dropChargeSteps: 2,
      dropMassScale: 1,
      stokesDrag: 4
    }
  },
  {id:'millikan-free-fall',name:'零电压 · 油滴自由落体触板',description:'U=0，β=0；首次触下板终止并保留碰撞前速度。',curriculumNotes:'必修三 · 临界事件',
    params:{switchMode:'closed-const-u',groundMode:'bottom',sourceVoltageU0:0,distanceMm:20,areaRatioS:1,dielectricEr:1,oilDropEnabled:true,dropChargeSteps:2,dropMassScale:1,stokesDrag:0}},
  {id:'millikan-rise-contact',name:'增大电压 · 油滴向上触板',description:'U=400V，β=0；负油滴受向上电场力，首次触上板。',curriculumNotes:'必修三 · 电场力与重力',
    params:{switchMode:'closed-const-u',groundMode:'bottom',sourceVoltageU0:400,distanceMm:20,areaRatioS:1,dielectricEr:1,oilDropEnabled:true,dropChargeSteps:2,dropMassScale:1,stokesDrag:0}},
  {id:'capacitor-reversed-polarity',name:'反向电压 · 正对区域与电场反向',description:'U=−200V，上板带负电，下板为零势；部分正对且介质完全填充正对区。',curriculumNotes:'必修三 · 有向场强',
    params:{switchMode:'closed-const-u',groundMode:'bottom',sourceVoltageU0:-200,distanceMm:20,areaRatioS:.3,dielectricEr:2,probeFracP:.4,oilDropEnabled:false}},
  {id:'capacitor-reference-double-gap',name:'恒荷 · 板距加倍',description:'20mm、200V 的参考状态；当前板距40mm，Q与E不变，U加倍。',curriculumNotes:'必修三 · 定量比较',
    params:{switchMode:'open-const-q',groundMode:'bottom',sourceVoltageU0:200,refDistanceMm:20,refAreaRatioS:1,refDielectricEr:1,distanceMm:40,areaRatioS:1,dielectricEr:1,probeFracP:.25,oilDropEnabled:false}}
];
