import type { PresetSpec } from '@physforge/sim-sdk';
import type { ThermoCycleMdParams } from './engine.js';

export const thermoCycleMdPresets: readonly PresetSpec<ThermoCycleMdParams>[] = [
  {
    id: 'kinetic-md-300-maxwell',
    name: '300 分子二维硬盘 MD（麦克斯韦速率分布与器壁压强）',
    description: '约化二维硬盘、确定性随机种子与有界子步弹性碰撞，实时累计壁冲量，比较样本拟合速率分布',
    curriculumNotes: '选择性必修三 第一章 · 分子动理论与统计规律',
    params: {
      mode: 'kinetic-md-box',
      molesN: 1,
      tHotK: 600,
      tColdK: 300,
      compressionRatioV2OverV1: 2.5,
      rectPressureRatio: 2.0,
      particleCountN: 300,
      seed: 20261122,
      brownianPollen: true,
      mdSpeedScale: 1.0
    }
  },
  {
    id: 'carnot-ideal-cycle',
    name: '卡诺理想热机循环（η_C = 1 - T_C/T_H）',
    description: '两段等温与两段绝热过程闭合，精确验算循环净功 W、热效率 η 与 ΔU总=0',
    curriculumNotes: '选择性必修三 第三章 · 热力学第二定律与卡诺效率极限',
    params: {
      mode: 'cycle-carnot',
      molesN: 1,
      tHotK: 600,
      tColdK: 300,
      compressionRatioV2OverV1: 2.5,
      rectPressureRatio: 2.0,
      particleCountN: 200,
      seed: 20261122,
      brownianPollen: false,
      mdSpeedScale: 1.0
    }
  },
  {
    id: 'rect-pv-thermo-cycle',
    name: 'P-V 矩形热力学循环（四段功热账本拆解）',
    description: '展示等容升温—定压膨胀—等容降温—定压压缩的 W、Q、ΔU 全账本及效率低于同温区卡诺机',
    curriculumNotes: '选择性必修三 · P-V 图面积计算净功与循环吸放热',
    params: {
      mode: 'cycle-rect-pv',
      molesN: 1,
      tHotK: 600,
      tColdK: 300,
      compressionRatioV2OverV1: 2.2,
      rectPressureRatio: 2.0,
      particleCountN: 200,
      seed: 20261122,
      brownianPollen: false,
      mdSpeedScale: 1.0
    }
  },
  {id:'md-400-pollen',name:'400 气体圆盘 + 重花粉',description:'高密度约化模型，真实粒子数与总动能；观察长时壁压和花粉轨迹',params:{mode:'kinetic-md-box',particleCountN:400,brownianPollen:true,seed:20261122,mdSpeedScale:1}},
  {id:'md-fast-sample',name:'200 圆盘 · 初速 2 倍',description:'相同种子下初始温度代理为原速率的四倍，无热浴',params:{mode:'kinetic-md-box',particleCountN:200,brownianPollen:false,seed:20261122,mdSpeedScale:2}},
  {id:'carnot-crossed-reservoirs',name:'卡诺非法边界 · T_H≤T_C',description:'保留请求温度，不输出虚假热效率',params:{mode:'cycle-carnot',tHotK:400,tColdK:450,molesN:1,compressionRatioV2OverV1:2.5}},
  {id:'rect-pv-wide',name:'矩形循环 · 实际高温由 PV 决定',description:'压强比 3、体积比 4，最高温为最低温的 12 倍',params:{mode:'cycle-rect-pv',tColdK:300,compressionRatioV2OverV1:4,rectPressureRatio:3,molesN:1}}
];
