import type { PresetSpec } from '@physforge/sim-sdk';
import type { ElectricalErrorParams } from './engine.js';

export const electricalErrorPresets: readonly PresetSpec<ElectricalErrorParams>[] = [
  {
    id: 'emf-voltmeter-across-source',
    name: '测电源 E,r 电压表直接并接电源（E_测 < E, r_测 < r）',
    description: '基于非理想 MNA 计入电压表分流 U/R_V，实测拟合截距与斜率均系统偏小，严密匹配 E·R_V/(R_V+r)',
    curriculumNotes: '必修第三册 第十二章 · 测量电源电动势和内阻的系统误差分析',
    params: {
      mode: 'emf-inner-outer',
      emfWiring: 'voltmeter-across-source',
      emfVolts: 3.0,
      rInternalOhm: 1.5,
      rAmmeterOhm: 0.4,
      rVoltmeterOhm: 150,
      bulbWiring: 'voltage-divider',
      rheostatMaxOhm: 20,
      rheostatTapFrac: 0.5,
      rgTrueOhm: 100,
      halfBiasSupplyV: 6.0,
      targetVernierMm: 23.46,
      vernierDivisions: '50',
      targetMicrometerMm: 5.73
    }
  },
  {
    id: 'half-bias-rg-bias',
    name: '半偏法测电流表内阻 R_g（严格偏小且随电源电压 E 增大趋近真值）',
    description: '闭合电阻箱 R₂ 后总电流略微增大，故流过待测表头一半时 R₂ < R_g；提高干路电阻 R₁ 可压低系统误差',
    curriculumNotes: '必修第三册 · 电流表内阻半偏法测量及其系统偏小机理',
    params: {
      mode: 'half-bias-rg',
      emfWiring: 'ammeter-in-series',
      emfVolts: 3.0,
      rInternalOhm: 1.0,
      rAmmeterOhm: 0.5,
      rVoltmeterOhm: 200,
      bulbWiring: 'voltage-divider',
      rheostatMaxOhm: 20,
      rheostatTapFrac: 0.5,
      rgTrueOhm: 120,
      halfBiasSupplyV: 3.0,
      targetVernierMm: 14.35,
      vernierDivisions: '20',
      targetMicrometerMm: 3.28
    }
  },
  {
    id: 'bulb-divider-vs-limit',
    name: '小灯泡非线性伏安特性：分压接法（0 伏起调）vs 限流接法',
    description: '调用 nonlinearMna 非线性灯丝方程对比两种滑变接法的电压调控覆盖范围与曲线下凹特性',
    curriculumNotes: '必修第三册 第十一章 · 测绘小灯泡伏安特性曲线',
    params: {
      mode: 'bulb-iv-curve',
      emfWiring: 'voltmeter-across-source',
      emfVolts: 4.5,
      rInternalOhm: 1.0,
      rAmmeterOhm: 0.4,
      rVoltmeterOhm: 300,
      bulbWiring: 'voltage-divider',
      rheostatMaxOhm: 20,
      rheostatTapFrac: 0.5,
      rgTrueOhm: 100,
      halfBiasSupplyV: 6.0,
      targetVernierMm: 23.46,
      vernierDivisions: '50',
      targetMicrometerMm: 5.73
    }
  },
  {
    id: 'caliper-micrometer-drill',
    name: '游标卡尺（50 分度）与螺旋测微器交互零误差读数台',
    description: '支持 10/20/50 分度游标对齐演示与螺旋测微器半毫米露线判定，训练 0 失误精确读数',
    curriculumNotes: '必修第三册 第十一章第 2 节 · 长度精密测量仪器读数',
    params: {
      mode: 'caliper-micrometer',
      emfWiring: 'voltmeter-across-source',
      emfVolts: 3.0,
      rInternalOhm: 1.5,
      rAmmeterOhm: 0.4,
      rVoltmeterOhm: 150,
      bulbWiring: 'voltage-divider',
      rheostatMaxOhm: 20,
      rheostatTapFrac: 0.5,
      rgTrueOhm: 100,
      halfBiasSupplyV: 6.0,
      targetVernierMm: 23.46,
      vernierDivisions: '50',
      targetMicrometerMm: 5.73
    }
  }
];
