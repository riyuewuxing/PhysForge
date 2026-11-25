/**
 * 2025 修订版普通高中物理课程标准四大核心素养标签
 */
export type CurriculumTag = '物理观念' | '科学思维' | '科学探究' | '科学态度与责任';

/**
 * 教学难度分级
 */
export type DifficultyLevel = '基础新授' | '高三一轮' | '压轴专题';

/**
 * 仿真参数允许的原始值类型
 */
export type ParamValue = number | boolean | string;

/**
 * 仿真参数对象约束
 */
export type ParamRecord = Record<string, ParamValue>;

/**
 * 数值参数声明（滑块/步进输入）
 */
export interface NumberParamSpec<K extends string = string> {
  key: K;
  kind: 'number';
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  description?: string;
}

/**
 * 开关参数声明
 */
export interface BooleanParamSpec<K extends string = string> {
  key: K;
  kind: 'boolean';
  label: string;
  defaultValue: boolean;
  description?: string;
}

/**
 * 枚举选项定义
 */
export interface SelectOption<TVal extends string = string> {
  label: string;
  value: TVal;
}

/**
 * 枚举参数声明
 */
export interface SelectParamSpec<K extends string = string, TVal extends string = string> {
  key: K;
  kind: 'select';
  label: string;
  options: readonly SelectOption<TVal>[];
  defaultValue: TVal;
  /** Opt-in editable string with preset suggestions. The model validates its domain. */
  customTextMaxLength?: number;
  description?: string;
}

/**
 * 类型擦除态通用参数声明联合（供壳层遍历渲染控件使用）
 */
export type AnyParamFieldSpec =
  | NumberParamSpec<string>
  | BooleanParamSpec<string>
  | SelectParamSpec<string, string>;

/**
 * 单条参数声明的强类型映射联合
 */
export type ParamFieldSpec<TParams extends ParamRecord> = {
  [K in keyof TParams & string]: string extends K
    ? never
    : Exclude<TParams[K], undefined> extends number
      ? NumberParamSpec<K>
      : Exclude<TParams[K], undefined> extends boolean
        ? BooleanParamSpec<K>
        : Exclude<TParams[K], undefined> extends string
          ? SelectParamSpec<K, Exclude<TParams[K], undefined>>
          : never;
}[keyof TParams & string];

/**
 * 课堂预设剧本
 */
export interface PresetSpec<TParams extends ParamRecord> {
  id: string;
  name: string;
  description: string;
  params: Partial<TParams>;
  visibleLayers?: string[];
  curriculumNotes?: string;
}

/**
 * 可叠加图层定义
 */
export interface LayerSpec {
  id: string;
  label: string;
  defaultVisible: boolean;
}

/**
 * uPlot 实时示波器通道定义
 */
export interface TelemetryChannelSpec {
  key: string;
  label: string;
  unit: string;
  color: string;
}

/**
 * 主画布视口与坐标映射信息
 */
export interface Viewport {
  /** Optional presentation palette, never a physics-engine parameter. */
  theme?: 'chalkboard' | 'projector';
  width: number;
  height: number;
  dpr: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * 物理临界事件（由精确事件定位器捕获并供壳层钉点标注）
 */
export interface PhysicsEvent {
  id: string;
  time: number;
  label: string;
  position?: {
    x: number;
    y: number;
    z?: number;
  };
  metrics?: Record<string, number>;
}

/**
 * 物理守恒律与解析校验报告
 */
export interface InvariantReport {
  name: string;
  measuredError: number;
  tolerance: number;
  passed: boolean;
  unit?: string;
}

/**
 * 物理状态最小时间基线
 */
export interface TimedPhysicsState {
  t: number;
}

/**
 * 物理步进返回契约（含下一状态与本步内捕获到的全部临界事件）
 */
export interface StepResult<TState> {
  nextState: TState;
  events: PhysicsEvent[];
  /** Actual simulated time, in [0, requested dt]. Defaults to requested dt. */
  advancedTime?: number;
  /** Terminal physical event: preserve the last pre-event state and pause. */
  halt?: boolean;
}

/**
 * 纯物理内核接口（零 DOM / Canvas / React 依赖）
 */
export interface SimulationEngine<TParams extends ParamRecord, TState> {
  createInitialState: (params: TParams) => TState;
  step: (state: TState, params: TParams, dt: number) => StepResult<TState>;
  /** Release external resources owned by this state; value snapshots remain readable. */
  disposeState?: (state:TState)=>void;
  computeObservables: (state: TState, params: TParams) => Record<string, number>;
  checkInvariants?: (state: TState, initial: TState, params: TParams) => InvariantReport[];
}

/**
 * 模型教学元数据
 */
export interface SimulationMeta {
  id: string;
  title: string;
  textbookRef: string;
  curriculumTags: readonly CurriculumTag[];
  difficulty: DifficultyLevel;
  version: string;
}

/**
 * 动态公式卡片（供教室外壳 KaTeX 面板展示）
 */
export interface FormulaDisplayItem {
  id: string;
  label: string;
  latex: string;
  substitutedLatex?: string;
}

/**
 * 画布直操控制手柄（在工作台拖拽更新仿真参数，保持与左侧滑块双向同步）
 */
export interface ControlHandle {
  id: string;
  label: string;
  /** 世界坐标系手柄锚点 */
  position: { x: number; y: number };
  handleKind: 'point' | 'vector' | 'angle' | 'radius';
  /** 默认为真；已有场景符号充当手柄时可隐藏静止态标记。 */
  showWhenIdle?: boolean;
  /** 矢量或角度手柄的基准原点（用于绘制牵引虚线与计算夹角） */
  origin?: { x: number; y: number };
  /** 可选矢量显示（若为空则使用 position - origin） */
  color?: string;
  onDrag: (worldPos: { x: number; y: number }) => Record<string, ParamValue>;
}

/**
 * Auto-FBD 受力矢量项（供外壳统一绘制箭头、正交分解虚线与碰撞排斥标签）
 */
export interface ForceVectorItem {
  id: string;
  label: string;
  origin: { x: number; y: number };
  force: { x: number; y: number };
  color?: string;
  category?: 'gravity' | 'normal' | 'friction' | 'tension' | 'electric' | 'magnetic' | 'net' | 'other';
  unit?: string;
}

/**
 * 随动参考系声明（惯性参考系变换 v' = v - v_ref, r' = r - r_ref）
 */
export interface ReferenceFrameSpec<TParams extends ParamRecord = ParamRecord, TState = unknown> {
  id: string;
  label: string;
  description?: string;
  getOrigin: (state: TState, params: TParams, activeLayers?: ReadonlySet<string>) => { x: number; y: number };
  getVelocity?: (state: TState, params: TParams, activeLayers?: ReadonlySet<string>) => { x: number; y: number };
}

/**
 * 黑白打印级试卷矢量配图中间表示 (DiagramIR)
 */
export type DiagramPrimitive =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; dashed?: boolean; strokeWidth?: number }
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; label?: string; dashed?: boolean }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill?: boolean; dashed?: boolean }
  | { kind: 'arc'; cx: number; cy: number; r: number; startAngle: number; endAngle: number; dashed?: boolean }
  | { kind: 'arcAngle'; cx: number; cy: number; r: number; startAngle: number; endAngle: number; label?: string; dashed?: boolean }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; hatch?: boolean; dashed?: boolean }
  | { kind: 'hatchedGround'; x1: number; y1: number; x2: number; y2: number; depth?: number }
  | { kind: 'spring'; x1: number; y1: number; x2: number; y2: number; coils?: number; amplitude?: number }
  | { kind: 'block'; cx: number; cy: number; width: number; height: number; angleDeg?: number; label?: string }
  | { kind: 'polyline'; points: readonly { x: number; y: number }[]; dashed?: boolean; closed?: boolean }
  | { kind: 'trajectory'; points: readonly { x: number; y: number }[]; dashed?: boolean; strokeWidth?: number }
  | { kind: 'text'; x: number; y: number; text: string; align?: 'start' | 'middle' | 'end' }
  | { kind: 'mathLabel'; x: number; y: number; text: string; align?: 'start' | 'middle' | 'end'; fontSize?: number }
  | { kind: 'fieldSymbol'; x: number; y: number; symbol: 'cross' | 'dot' }
  | { kind: 'fieldMarker'; x: number; y: number; symbol: 'cross' | 'dot' | 'plus' | 'minus'; radius?: number }
  | {
      kind: 'circuitElement';
      element: 'resistor' | 'capacitor' | 'battery' | 'ammeter' | 'voltmeter' | 'lamp' | 'diode' | 'switch';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      label?: string;
    };

export interface DiagramExportOptions {
  showVelocityVectors?: boolean;
  showTrajectory?: boolean;
  showForceLabels?: boolean;
  monochrome?: boolean;
}

export interface DiagramIR {
  width: number;
  height: number;
  viewBox: { minX: number; minY: number; maxX: number; maxY: number };
  title: string;
  primitives: readonly DiagramPrimitive[];
  metadata?: Record<string, string>;
}

/**
 * 可序列化教学场景描述 (SceneDSL)
 */
export interface SceneDSL {
  schemaVersion: '2.0';
  modelId: string;
  presetId?: string;
  title?: string;
  params: ParamRecord;
  visibleLayers?: string[];
  activeFrameId?: string;
  notes?: string;
}

/**
 * Three.js 原生命令式挂载句柄（严禁依赖 R3F，必须支持无泄漏 dispose）
 */
export interface ThreeSceneBridge<TParams extends ParamRecord = ParamRecord, TState = unknown> {
  sync: (state: TState, params: TParams, activeLayers: ReadonlySet<string>) => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
}

/**
 * PhysForge 统一仿真插件契约（V1.0 基线）
 */
export interface SimulationPlugin<TParams extends ParamRecord, TState> {
  meta: SimulationMeta;
  paramSchema: readonly (string extends keyof TParams ? AnyParamFieldSpec : ParamFieldSpec<TParams>)[];
  presets: readonly PresetSpec<TParams>[];
  engine: SimulationEngine<TParams, TState>;
  layers: readonly LayerSpec[];
  telemetryChannels: readonly TelemetryChannelSpec[];
  /** Mode-only presentation override; persisted parameter schema remains authoritative. */
  getParamFields?: (params:TParams)=>readonly AnyParamFieldSpec[];
  getTelemetryChannels?: (params:TParams)=>readonly TelemetryChannelSpec[];
  renderCanvas: (
    ctx: CanvasRenderingContext2D,
    state: TState,
    params: TParams,
    viewport: Viewport,
    activeLayers: ReadonlySet<string>
  ) => void;
  formatFormulas?: (state: TState, params: TParams) => FormulaDisplayItem[];
}

/**
 * PhysForge V2.0 仿真插件扩展契约（100% 向后兼容 V1.0 插件）
 */
export interface PluginDefaultViewSpec<TParams extends ParamRecord = ParamRecord> {
  /** Opt-in minimum absolute zoom for models using large physical world coordinates. */
  minScale?: number;
  /** Relative scale against the standard 0.24 * min(W, H) world mapping. */
  scale?: number | ((params: TParams, viewport: { width: number; height: number }) => number);
  /** Pixel offset as a fraction of viewport width from the standard 0.45W origin. */
  offsetRatioX?: number | ((params: TParams, viewport: { width: number; height: number }) => number);
  /** Pixel offset as a fraction of viewport height from the standard 0.50H origin. */
  offsetRatioY?: number | ((params: TParams, viewport: { width: number; height: number }) => number);
}

export interface SimulationPluginV2<TParams extends ParamRecord = ParamRecord, TState = unknown>
  extends SimulationPlugin<TParams, TState> {
  defaultView?: PluginDefaultViewSpec<TParams>;
  renderMode?: 'canvas2d' | 'three3d' | 'hybrid';
  getControlHandles?: (state: TState, params: TParams) => ControlHandle[];
  getForceVectors?: (state: TState, params: TParams, activeLayers?: ReadonlySet<string>) => ForceVectorItem[];
  referenceFrames?: readonly ReferenceFrameSpec<TParams, TState>[];
  sceneSerializer?: {
    exportScene: (state: TState, params: TParams) => SceneDSL;
    importScene: (dsl: SceneDSL) => Partial<TParams>;
  };
  exportDiagramIR?: (state: TState, params: TParams, options?: DiagramExportOptions) => DiagramIR;
  mountThreeScene?: (container: HTMLElement) => ThreeSceneBridge<TParams, TState>;
}

/**
 * 判断插件实例是否声明了任意 V2 交互或导出能力
 */
export function isSimulationPluginV2<TParams extends ParamRecord, TState>(
  plugin: SimulationPlugin<TParams, TState>
): plugin is SimulationPluginV2<TParams, TState> {
  const candidate = plugin as SimulationPluginV2<TParams, TState>;
  return (
    typeof candidate.getControlHandles === 'function' ||
    typeof candidate.getForceVectors === 'function' ||
    Array.isArray(candidate.referenceFrames) ||
    typeof candidate.sceneSerializer === 'object' ||
    typeof candidate.exportDiagramIR === 'function' ||
    typeof candidate.mountThreeScene === 'function' ||
    candidate.defaultView !== undefined ||
    candidate.renderMode === 'three3d' ||
    candidate.renderMode === 'hybrid'
  );
}

/**
 * 对数值进行闭区间钳位
 */
function clampNumber(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * 提取并钳位插件参数，保证缺失字段回退默认值且数值参数在合法范围内、无 NaN/Infinity
 */
export function resolvePluginParams<TParams extends ParamRecord>(
  schema: readonly (string extends keyof TParams ? AnyParamFieldSpec : ParamFieldSpec<TParams>)[],
  overrides?: Partial<NoInfer<TParams>>
): TParams {
  const resolved: Record<string, ParamValue> = {};

  for (const field of schema as readonly AnyParamFieldSpec[]) {
    const rawOverride = overrides?.[field.key];

    if (field.kind === 'number') {
      const candidate =
        typeof rawOverride === 'number' && Number.isFinite(rawOverride)
          ? rawOverride
          : field.defaultValue;
      resolved[field.key] = clampNumber(candidate, field.min, field.max);
      continue;
    }

    if (field.kind === 'boolean') {
      resolved[field.key] = typeof rawOverride === 'boolean' ? rawOverride : field.defaultValue;
      continue;
    }

    // field.kind === 'select'
    const allowedValues = new Set<string>(field.options.map((opt) => opt.value));
    if (typeof rawOverride === 'string' && (field.customTextMaxLength !== undefined || allowedValues.has(rawOverride))) {
      resolved[field.key] = rawOverride;
    } else {
      resolved[field.key] = field.defaultValue;
    }
  }

  return resolved as TParams;
}

/**
 * 注册并校验仿真插件定义的结构完整性（同时兼容 V1.0 与 V2.0 插件契约）
 */
export function defineSimulationPlugin<TParams extends ParamRecord, TState>(
  plugin: SimulationPluginV2<TParams, TState>
): SimulationPluginV2<TParams, TState> {
  if (!plugin.meta.id.trim()) {
    throw new Error('SimulationPlugin meta.id must be a non-empty string.');
  }
  if (plugin.meta.curriculumTags.length === 0) {
    throw new Error(`SimulationPlugin "${plugin.meta.id}" must declare at least one curriculumTag.`);
  }

  const seenParamKeys = new Set<string>();
  for (const field of plugin.paramSchema as readonly AnyParamFieldSpec[]) {
    if (seenParamKeys.has(field.key)) {
      throw new Error(`Duplicate paramSchema key "${field.key}" in plugin "${plugin.meta.id}".`);
    }
    seenParamKeys.add(field.key);

    if (field.kind === 'number') {
      if (!Number.isFinite(field.min) || !Number.isFinite(field.max) || field.min > field.max) {
        throw new Error(`Invalid min/max bounds for number param "${field.key}".`);
      }
      if (!Number.isFinite(field.step) || field.step <= 0) {
        throw new Error(`Invalid step (> 0 required) for number param "${field.key}".`);
      }
      if (field.defaultValue < field.min || field.defaultValue > field.max) {
        throw new Error(`Default value out of bounds for number param "${field.key}".`);
      }
    } else if (field.kind === 'select') {
      if (field.options.length === 0) {
        throw new Error(`Select param "${field.key}" must provide at least one option.`);
      }
      const valid = field.options.some((opt) => opt.value === field.defaultValue);
      if (!valid) {
        throw new Error(`Default value "${field.defaultValue}" not in options for "${field.key}".`);
      }
    }
  }

  const seenPresetIds = new Set<string>();
  for (const preset of plugin.presets) {
    if (seenPresetIds.has(preset.id)) {
      throw new Error(`Duplicate preset id "${preset.id}" in plugin "${plugin.meta.id}".`);
    }
    seenPresetIds.add(preset.id);
  }

  const seenLayerIds = new Set<string>();
  for (const layer of plugin.layers) {
    if (seenLayerIds.has(layer.id)) {
      throw new Error(`Duplicate layer id "${layer.id}" in plugin "${plugin.meta.id}".`);
    }
    seenLayerIds.add(layer.id);
  }

  return plugin;
}

export * from './visualKit.js';

export * from './v3Types.js';
export * from './storyRunner.js';
