import type { ParamRecord, ParamValue, SimulationPlugin, SimulationPluginV2 } from './index.js';

export interface LiveFormulaVarBinding {
  /** 对应 KaTeX 中 \htmlData{param=xxx}{...} 的标识 */
  tokenKey: string;
  /** 映射到插件 params 的真实字段名 */
  paramKey: string;
  /** 显示名与单位 */
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  /** 拖动灵敏度：每移动 1px 对应的数值增量（可选，缺省按 (max-min)/240 计算） */
  sensitivity?: number;
  /** 格式化小数位数，默认保留 2 位小数 */
  precision?: number;
}

export interface LiveFormulaSpec {
  id: string;
  title?: string;
  /**
   * 标准 KaTeX 字符串，使用 \htmlClass{pf-live-var}{\htmlData{param=B}{B}} 标记可拖字母
   * 例：R = \frac{\htmlClass{pf-live-var}{\htmlData{param=m}{m}}\,\htmlClass{pf-live-var}{\htmlData{param=v0}{v_0}}}{\htmlClass{pf-live-var}{\htmlData{param=q}{q}}\,\htmlClass{pf-live-var}{\htmlData{param=B}{B}}}
   */
  latex: string;
  bindings: LiveFormulaVarBinding[];
  /** Optional conjunction of exact parameter values. Only show a law in the physical modes in which it applies. */
  when?: Readonly<Record<string, readonly ParamValue[]>>;
}

/** Declarative conditions keep model plugins independent of DOM and prevent invalid-mode controls. */
export function isLiveFormulaApplicable(spec: LiveFormulaSpec, params: ParamRecord): boolean {
  return Object.entries(spec.when ?? {}).every(([key, allowed]) => {
    const value = params[key];
    return value !== undefined && allowed.includes(value);
  });
}

export function selectLiveFormulas(specs: readonly LiveFormulaSpec[] | undefined, params: ParamRecord): readonly LiveFormulaSpec[] {
  return (specs ?? []).filter(spec => isLiveFormulaApplicable(spec, params));
}

export interface StoryCameraKeyframe {
  /** 2D 视口目标（与 createWorldMapper 对齐） */
  view2D?: { centerX: number; centerY: number; zoom: number };
  /** 3D 球面轨道与压平进度：morphT=0 纯 3D 透视，morphT=1 完全压平为 2D 正交剖面 */
  view3D?: {
    azimuthRad: number;
    polarRad: number;
    target: [number, number, number];
    visibleHeight: number;
    morphT: number;
  };
  durationMs?: number;
}

export interface StoryBeat {
  id: string;
  title: string;
  /** 大屏底部极简 1-2 句金句字幕（10米外可读） */
  caption: string;
  /** 仅显示在副屏提词器上的教师私密讲稿与提问话术 */
  speakerNotes: string;
  /** 切入本镜时的参数补丁（数值型自动平滑插值，枚举/布尔立即切换） */
  paramPatch?: Record<string, number | string | boolean>;
  paramTweenMs?: number;
  /** 切入本镜时是否重置仿真时间并自动播放 */
  simAction?: 'keep' | 'reset-pause' | 'reset-play' | 'play' | 'pause';
  /** 临界事件自动定格规则（匹配 observables 条件即冻结并弹出高亮标注） */
  autoFreeze?: {
    observableKey: string;
    operator: '>=' | '<=' | 'cross';
    threshold: number;
    badgeText: string;
  };
  /** 强制开关特定教学图层 */
  layerOverrides?: {
    showFbd?: boolean;
    /** Exact set of visible teaching layers for this beat, when specified. */
    visibleLayerIds?: readonly string[];
    referenceFrameId?: string;
    highlightFormulaId?: string;
  };
  camera?: StoryCameraKeyframe;
}

export interface StoryDeck {
  id: string;
  modelId: string;
  title: string;
  subtitle?: string;
  beats: StoryBeat[];
}

export interface Spatial3DFlattenSpec {
  /** 压平后的标准 2D 剖面法向（通常为 +Z 对应 XY 平面，或 +Y 对应 XZ 俯视图） */
  flattenPlane: 'xy' | 'xz';
  defaultVisibleHeight: number;
  sceneDepthRadius: number;
  default3DAzimuthRad: number;
  default3DPolarRad: number;
}

export interface SimulationPluginV3<TParams extends ParamRecord = ParamRecord, TState = unknown>
  extends SimulationPluginV2<TParams, TState> {
  liveFormulas?: readonly LiveFormulaSpec[];
  storyDecks?: readonly StoryDeck[];
  spatial3D?: Spatial3DFlattenSpec;
}

/** Detect declared V3 capability without excluding legacy V1/V2 plugins. */
export function isSimulationPluginV3<TParams extends ParamRecord, TState>(
  plugin: SimulationPlugin<TParams, TState>
): plugin is SimulationPluginV3<TParams, TState> {
  const candidate = plugin as SimulationPluginV3<TParams, TState>;
  return Array.isArray(candidate.liveFormulas) ||
    Array.isArray(candidate.storyDecks) || candidate.spatial3D !== undefined;
}
