import type { StoryDeck } from '@physforge/sim-sdk';
import type { EmDevicesParams } from './engine.js';

const base = {
  device: 'velocity-selector', eFieldVPerM: 2e5, bFieldT: 1, bDeflectT: 0.5,
  particleSpeedMps: 2e5, chargeC: 1.602176634e-19, massKg: 1.67262192369e-27,
  cyclotronRadiusM: 0.45, cyclotronVoltageV: 25000, relativisticDetune: false,
  hallCurrentA: 3, hallDensityPerM3: 2e24, hallThicknessM: 0.0005, carrierType: 'electron',
  mhdDuctWidthM: 0.4, mhdDuctAreaM2: 0.1, mhdPlasmaResOhmM: 0.2,
  mhdLoadOhm: 0.8, flowDiameterM: 0.2
} as const satisfies EmDevicesParams;
const camera = (morphT: 0 | 1) => ({
  view3D: { azimuthRad: 0.6, polarRad: 0.9, target: [0, 0, 0] as [number, number, number], visibleHeight: 3.4, morphT },
  durationMs: 750
});
const layerOverrides = (highlightFormulaId: string) => ({
  visibleLayerIds: ['main'], showFbd: false, referenceFrameId: 'ground', highlightFormulaId
});
const mhd = { ...base, device: 'mhd-generator', bFieldT: 2, particleSpeedMps: 1200 } as const;

export const emDevicesStoryDecks: readonly StoryDeck[] = [
  { id: 's02-particle-devices', modelId: 'stse-em-devices-suite', title: '带电粒子器件：选速、分离、加速',
    beats: [
      { id: 's02-select', title: '正交电磁场选速', caption: '电场力与磁场力反向平衡，选出特定速率。',
        speakerNotes: '给定 E=2×10⁵ V/m、B=1 T，选速条件 v=E/B=2×10⁵ m/s。只改变速度或场强，观察偏离平衡；要求学生说明质量和电荷量为何在平衡条件中约去。轨迹使用正交场解析解，长度固定为每坐标单位 2 cm，时间单独慢放；有限狭缝可能允许非严格选速粒子通过。',
        paramPatch: base, paramTweenMs: 0, simAction: 'reset-play', camera: camera(1), layerOverrides: layerOverrides('velocity-selector') },
      { id: 's02-spectrum-light', title: '质谱仪：同速不同荷质比', caption: '同速同电荷时，偏转半径随质量增加。',
        speakerNotes: '偏转场为 0.5 T，速率不变，先观察质子质量参数对应的计算半径 r=mv/(qB₂)。运行到探测板，观察同一固定空间尺度下的半圆与落点。',
        paramPatch: { ...base, device: 'mass-spectrometer' }, paramTweenMs: 0, simAction: 'reset-play', camera: camera(1), layerOverrides: layerOverrides('spectrometer-radius') },
      { id: 's02-spectrum-heavy', title: '改变粒子质量', caption: '质量加倍，定量计算的偏转半径加倍。',
        speakerNotes: '把质量改为上一镜两倍，其他条件不变；比较计算的半径和同尺度轨迹落点，质量增大使半径和落点距离增大。质谱仪实质上比较质荷比 m/q。',
        paramPatch: { ...base, device: 'mass-spectrometer', massKg: 3.34524384738e-27 }, paramTweenMs: 0, simAction: 'reset-play', layerOverrides: layerOverrides('spectrometer-radius') },
      { id: 's02-cyclotron', title: '回旋加速器的能量上限', caption: '磁场使粒子转弯，狭缝电场做功。',
        speakerNotes: 'D 形盒半径 0.45 m，B=1.5 T，先用经典非相对论公式求最大动能。提高电压改变每次做功及过缝次数；实际圆弧由过缝后能量决定，零宽缝的 RF 电压每半周反号。有限圆形装置触壁不是成功抽取，终止动能不强制等于理想上限。',
        paramPatch: { ...base, device: 'cyclotron', bFieldT: 1.5 }, paramTweenMs: 0, simAction: 'reset-play', camera: camera(0), layerOverrides: layerOverrides('cyclotron-energy') },
      { id: 's02-detune', title: '相对论失谐对照', caption: '能量增大后，经典等周期条件不再严格成立。',
        speakerNotes: '开启已有相对论失谐计算，比较模型动能与经典上限。每半周按过缝后 γ 计算飞行时间，观察相位差增大，达到 π/2 时停止加速模型；也可能先触及装置外缘。',
        paramPatch: { ...base, device: 'cyclotron', bFieldT: 1.5, relativisticDetune: true }, paramTweenMs: 0, simAction: 'reset-play', camera: camera(1), layerOverrides: layerOverrides('cyclotron-energy') }
    ] },
  { id: 's02-field-sensors', modelId: 'stse-em-devices-suite', title: '电磁测量与能量转化',
    beats: [
      { id: 's02-hall-electron', title: '霍尔电压的符号', caption: '载流子偏转，横向电场建立平衡。',
        speakerNotes: '固定电流、磁场与厚度，采用模型的电子载流子符号约定，计算 U_H=IB/(nq_cd)。说明电压正负与接线和载流子符号有关，不把符号本身当成绝对电势。',
        paramPatch: { ...base, device: 'hall-sensor', bFieldT: 0.8 }, paramTweenMs: 0, simAction: 'reset-pause', camera: camera(1), layerOverrides: layerOverrides('hall-voltage') },
      { id: 's02-hall-hole', title: '电子与空穴对照', caption: '其他条件不变，载流子符号改变，霍尔电压反号。',
        speakerNotes: '只切换空穴载流子，保持 |q_c|=e、n、I、B、d 不变。比较引擎输出的霍尔电压符号和绝对值。',
        paramPatch: { ...base, device: 'hall-sensor', bFieldT: 0.8, carrierType: 'hole' }, paramTweenMs: 0, simAction: 'reset-pause', layerOverrides: layerOverrides('hall-voltage') },
      { id: 's02-mhd-low', title: '磁流体发电与外负载', caption: '导电流体切割磁场，产生动生电动势。',
        speakerNotes: 'B=2 T，d=0.4 m，v=1200 m/s，开路电动势 960 V；模型内阻为 ρd/S=0.8 Ω。先设置外阻 0.4 Ω，比较负载功率。',
        paramPatch: { ...mhd, mhdLoadOhm: 0.4 }, paramTweenMs: 0, simAction: 'reset-pause', layerOverrides: layerOverrides('mhd-load-power') },
      { id: 's02-mhd-match', title: '负载匹配', caption: '外阻等于内阻时，外电路获得最大功率。',
        speakerNotes: '将外阻设为 0.8 Ω。在电动势与内阻固定的等效电源模型中，输出功率峰值为 E²/(4r)=288000 W。最大功率不等于最高效率。',
        paramPatch: mhd, paramTweenMs: 0, simAction: 'reset-pause', layerOverrides: layerOverrides('mhd-load-power') },
      { id: 's02-flow', title: '电磁流量计', caption: '测电压，结合管径与磁场求体积流量。',
        speakerNotes: '均匀流速、有效极间距为管径 D 时 U=BDv，Q=πD²v/4=πDU/(4B)。这是理想模型的定量关系，真实仪表还需校准速度分布与电极响应。',
        paramPatch: { ...base, device: 'em-flowmeter', particleSpeedMps: 100, bFieldT: 1 }, paramTweenMs: 0, simAction: 'reset-pause', camera: camera(1), layerOverrides: layerOverrides('flowmeter-rate') }
    ] }
];
