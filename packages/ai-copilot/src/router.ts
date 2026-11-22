import type { SceneDSL } from '@physforge/sim-sdk';
import { loadSimulationById, resolveCanonicalModelId, simulationCatalog } from '@physforge/simulations/catalog';

export type RouteTier = 'specialized' | 'builder' | 'custom-ode-fallback';

export interface RouteMatchResult {
  readonly tier: RouteTier;
  readonly modelId: string;
  readonly matchedRule: string;
  readonly rationale: string;
}

interface RouteRule {
  readonly tier: RouteTier;
  readonly modelId: string;
  readonly pattern: RegExp;
  readonly label: string;
}

const ROUTE_RULES: readonly RouteRule[] = [
  // Tier 3: Arbitrary custom differential equations / user-defined ODE formulas -> B5
  {
    tier: 'custom-ode-fallback',
    modelId: 'builder-custom-ode-lab',
    pattern: /(d\^?2x\/dt\^?2|dv\/dt|自定义\s*ode|微分方程|拉格朗日|相轨迹自定义)/i,
    label: 'B5 自定义 ODE/拉格朗日万能兜底'
  },
  // Tier 1: Domain specialized units
  {
    tier: 'specialized',
    modelId: 'comp-relativity-quantum-tunneling',
    pattern: /(量子隧穿|薛定谔|势垒|闵可夫斯基|光锥|双生子|洛伦兹变换)/i,
    label: 'C03 狭义相对论与量子隧穿'
  },
  {
    tier: 'specialized',
    modelId: 'comp-chaos-normal-coriolis',
    pattern: /(混沌双摆|庞加莱|简正模|科里奥利|旋转圆盘)/i,
    label: 'C02 混沌双摆、简正模与科里奥利力'
  },
  {
    tier: 'specialized',
    modelId: 'comp-rigid-rolling-slip',
    pattern: /(滑滚|纯滚|转动惯量|保龄球|刚体斜面)/i,
    label: 'C01 刚体转动与滑滚转换'
  },
  {
    tier: 'specialized',
    modelId: 'exp-electrical-error-lab',
    pattern: /(游标卡尺|螺旋测微器|千分尺|半偏法|测电源|内接.*外接|小灯泡伏安)/i,
    label: 'X02 电学实验误差与读数台'
  },
  {
    tier: 'specialized',
    modelId: 'exp-mechanics-error-lab',
    pattern: /(逐差法|打点纸带|平衡摩擦力|a-F|phyphox)/i,
    label: 'X01 力学实验误差与逐差法'
  },
  {
    tier: 'specialized',
    modelId: 'stse-tokamak-magnetic-mirror',
    pattern: /(托卡马克|磁镜|磁瓶|逃逸锥|磁矩绝热)/i,
    label: 'S01 托卡马克与磁镜'
  },
  {
    tier: 'specialized',
    modelId: 'stse-em-devices-suite',
    pattern: /(速度选择器|质谱仪|回旋加速器|霍尔|磁流体|MHD|电磁流量计)/i,
    label: 'S02 现代电磁科技器件'
  },
  {
    tier: 'specialized',
    modelId: 'stse-em-launch-regen-brake',
    pattern: /(电磁弹射|导轨炮|再生制动|能量回收)/i,
    label: 'S03 电磁弹射与再生制动'
  },
  {
    tier: 'specialized',
    modelId: 'stse-gravity-assist-rendezvous',
    pattern: /(引力弹弓|掠飞|交会对接|降轨追赶)/i,
    label: 'S04 引力弹弓与空间站交会'
  },
  {
    tier: 'specialized',
    modelId: 'modern-photoelectric-compton',
    pattern: /(光电效应|遏止电压|逸出功|康普顿)/i,
    label: 'N01 光电效应与康普顿散射'
  },
  {
    tier: 'specialized',
    modelId: 'modern-rutherford-bohr',
    pattern: /(卢瑟福|α.*散射|玻尔|巴耳末|氢原子能级)/i,
    label: 'N02 卢瑟福散射与玻尔能级'
  },
  {
    tier: 'specialized',
    modelId: 'modern-nuclear-recoil-decay',
    pattern: /(半衰期|质能亏损|核裂变|控制棒|云室.*外切|内切圆)/i,
    label: 'N03 核衰变反冲与半衰期'
  },
  {
    tier: 'specialized',
    modelId: 'thermo-piston-gas-laws',
    pattern: /(汽缸|卡口|活塞|水银柱|玻意耳|抽气|打气)/i,
    label: 'T01 气体定律与活塞卡口'
  },
  {
    tier: 'specialized',
    modelId: 'thermo-cycles-kinetic-md',
    pattern: /(卡诺|热力学循环|分子动理论|麦克斯韦|布朗运动)/i,
    label: 'T02 热力学循环与分子动理论'
  },
  {
    tier: 'specialized',
    modelId: 'optics-wave-interference',
    pattern: /(劈尖|牛顿环|衍射光栅|单缝衍射|半波损失|缺级)/i,
    label: 'O01 波动光学干涉与衍射'
  },
  {
    tier: 'specialized',
    modelId: 'wave-2d-ripple-fdtd',
    pattern: /(水波|二维.*双缝|FDTD|全反射折射波|小孔衍射)/i,
    label: 'W02 二维波动 FDTD'
  },
  {
    tier: 'specialized',
    modelId: 'wave-vibration-coupling',
    pattern: /(简谐波|多普勒|驻波|波速多解|马赫锥)/i,
    label: 'W01 机械波与多解驻波'
  },
  {
    tier: 'specialized',
    modelId: 'em-induction-double-rod',
    pattern: /(双杆|导轨切割|单杆.*电容|含容导轨)/i,
    label: 'E04 电磁感应双杆与含容导轨'
  },
  {
    tier: 'specialized',
    modelId: 'mech-block-conveyor',
    pattern: /(板块|传送带|共速|划痕)/i,
    label: 'M05 板块与传送带'
  },
  {
    tier: 'specialized',
    modelId: 'astro-orbital-mechanics',
    pattern: /(霍曼转移|拉格朗日|双星|第一宇宙速度|开普勒)/i,
    label: 'M10 天体力学与拉格朗日点'
  },
  // Tier 2: Compound open builders B1-B4
  {
    tier: 'builder',
    modelId: 'builder-composite-em-field',
    pattern: /(有界磁场|复合场|磁聚焦|磁发散|组合场)/i,
    label: 'B1 复合电磁场自由建模器'
  },
  {
    tier: 'builder',
    modelId: 'builder-circuit-mna',
    pattern: /(自由电路|串并联|二极管|动态直流|RC.*充放电)/i,
    label: 'B2 自由拓扑电路 MNA 建模器'
  },
  {
    tier: 'builder',
    modelId: 'builder-optics-ray',
    pattern: /(透镜|全反射|平行玻璃砖|光纤|三棱镜|折射)/i,
    label: 'B3 几何光学沙盒'
  },
  {
    tier: 'builder',
    modelId: 'builder-mechanics-lab',
    pattern: /(自由力学|绳杆约束|碰撞沙盒|斜面自由)/i,
    label: 'B4 自由约束力学沙盒'
  }
];

export function routePhysicsProblemPrompt(promptText: string): RouteMatchResult {
  const q = promptText.trim();
  for (const rule of ROUTE_RULES) {
    if (rule.pattern.test(q)) {
      return {
        tier: rule.tier,
        modelId: resolveCanonicalModelId(rule.modelId),
        matchedRule: rule.label,
        rationale: `命中[${rule.tier}]路由规则 "${rule.label}"`
      };
    }
  }
  return {
    tier: 'builder',
    modelId: 'builder-mechanics-lab',
    matchedRule: 'B4 默认力学通用建模兜底',
    rationale: '未触发专用单元关键词，回退至自由约束力学建模器 B4'
  };
}

export async function synthesizeSceneFromPrompt(promptText: string): Promise<{
  route: RouteMatchResult;
  scene: SceneDSL;
}> {
  const route = routePhysicsProblemPrompt(promptText);
  const plugin = await loadSimulationById(route.modelId);
  const target = plugin ?? (await loadSimulationById(simulationCatalog[0]!.meta.id))!;
  const preset = target.presets[0];
  const params: Record<string, number | boolean | string> = {};
  for (const field of target.paramSchema) {
    const presetVal = preset?.params[field.key];
    const val = presetVal !== undefined ? presetVal : field.defaultValue;
    if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'string') {
      params[field.key] = val;
    }
  }

  return {
    route,
    scene: {
      schemaVersion: '2.0',
      modelId: target.meta.id,
      presetId: preset?.id,
      title: preset?.name ?? target.meta.title,
      params,
      notes: `AI 路由自动装配：${route.rationale}；题干摘要：${promptText.slice(0, 80)}`
    }
  };
}
