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
    : TParams[K] extends number
      ? NumberParamSpec<K>
      : TParams[K] extends boolean
        ? BooleanParamSpec<K>
        : TParams[K] extends string
          ? SelectParamSpec<K, TParams[K]>
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
}

/**
 * 纯物理内核接口（零 DOM / Canvas / React 依赖）
 */
export interface SimulationEngine<TParams extends ParamRecord, TState> {
  createInitialState: (params: TParams) => TState;
  step: (state: TState, params: TParams, dt: number) => StepResult<TState>;
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
 * PhysForge 统一仿真插件契约
 */
export interface SimulationPlugin<TParams extends ParamRecord, TState> {
  meta: SimulationMeta;
  paramSchema: readonly (string extends keyof TParams ? AnyParamFieldSpec : ParamFieldSpec<TParams>)[];
  presets: readonly PresetSpec<TParams>[];
  engine: SimulationEngine<TParams, TState>;
  layers: readonly LayerSpec[];
  telemetryChannels: readonly TelemetryChannelSpec[];
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
    if (typeof rawOverride === 'string' && allowedValues.has(rawOverride)) {
      resolved[field.key] = rawOverride;
    } else {
      resolved[field.key] = field.defaultValue;
    }
  }

  return resolved as TParams;
}

/**
 * 注册并校验仿真插件定义的结构完整性
 */
export function defineSimulationPlugin<TParams extends ParamRecord, TState>(
  plugin: SimulationPlugin<TParams, TState>
): SimulationPlugin<TParams, TState> {
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
