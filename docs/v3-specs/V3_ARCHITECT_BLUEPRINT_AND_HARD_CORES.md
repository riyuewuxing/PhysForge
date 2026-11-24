# PhysForge V3.0（Spatial Stage 空间演说引擎）总体施工方案与四大难点底座

**文档定位**：面向本地总控（Antigravity）与云端/桌面写手（**GPT-6.2 Sol via GitHub PR / Codex**）的 V3.0 顶层对齐方案与核心难点完整解。  
**代码基线**：`main@b5e3ae4`（V2.0.2 Wave A–C 已验收合入：43 单元、43/43 `createWorldMapper`、43/43 交互手柄、30/43 Auto-FBD、28/43 随动系、63 文件 / 301 单测全绿、`/PhysForge/` 主包 `259.78 kB` gzip）。  
**本地对齐说明**：本文档已由本地总控对照当前 `main@211907b` 真实源码完成差异审校，配套可执行分波次与原子 PR 施工单见 [V3_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V3_WRITER_CONSTRUCTION_PLAN.md)（其中修正了 `tsconfig.base.json` 的 `noUncheckedIndexedAccess` 守卫、ESM `.js` 导入后缀、`App.tsx` 现有热键与 `data-testid` 兼容等本地实盘细节）。

---

## 一、V3.0 战略定位与五条不可逾越的施工红线

V2.0.2 已经是一台完全成熟的“物理计算发动机 + 专业工坊”；V3.0 的唯一使命是在**完全不破坏 43 个物理引擎的前提下**，为其加装一套可以**直接替代 PPT 上公开课与面试试讲**的“三态空间演说座舱”。

### 1. 严防范围爆炸的五条铁律
1. **绝不搞“43 单元全量 3D 化”**：
   - **全局普惠能力（43/43 自动继承）**：全屏演说态（Stage）、翻页笔分镜（Story）、双屏隐形提词控制台（Presenter）与活公式拖拽调参（Live Formula），全部基于 V2.0.2 统一的 `createWorldMapper` 与 `SimulationPluginV2` 接口实现，43 个模型零重写自动获得演说能力。
   - **3D 实体建模与 3D $\leftrightarrow$ 2D 压平切镜（精选 6 旗舰单元）**：只对最能镇场、最需要空间视角的 **6 个王牌单元**做电影级 3D 实体与平滑切镜（见第四节清单），其余 37 个单元在演说态下直接驱动高精度 2D 发光舞台，保证质量拉满且不烂尾。
2. **首屏体积与懒加载红线不变**：
   - 主入口 gzip 严格守在 `< 350 KB`（当前 `259.78 kB`）；V3 新增的 `StoryDeck` 引擎、`Presenter` 视图、`CameraMorphController` 与 6 套 3D 实体场景**全部必须独立异步 chunk 懒加载**，非 3D 页面严禁泄漏 `three`。
3. **纯 Vanilla Three.js + 显存零泄漏铁律**：
   - 沿用现有 `three@^0.187.0`（React 19.3.1 环境下严禁引入 `@react-three/fiber`），切出 3D 模型或退出全屏时必须递归释放全部 `BufferGeometry` / `Material` / `Texture` 并执行 `renderer.dispose()` + `forceContextLoss()`。
4. **物理内核零回退铁律**：
   - 现有 63 文件 / 301 条 Vitest、`verify:packs`、`verify:scenes`、`verify:vault`、单文件离线 HTML 导出（`< 2.5 MB`）与 `/PhysForge/` 子路径零 404 全部必须持续全绿；严禁 `as any`、`@ts-ignore`、`eval`、引擎层 `Math.random()`。
5. **前置 Step 0（不阻塞 V3 架构，但须先闭环）**：
   - 按交接日志约定，在开启 V3 Wave 1 之前，先用 1 个极小 PR 完成 `@physforge/ai-copilot` 在线 BYOK 的实网可用性验证与容错收口（确认 CORS 提示、超时提示、Schema 提示与 Markdown-JSON 提取稳健），随后立即全速进入 V3 Wave 1。

---

## 二、总体架构：三态壳子与零侵入 `SimulationPluginV3` 契约

### 1. 三态运行模式（Tri-Mode Shell）
在 `useClassroomStore`（或独立 `usePresentationStore`）中新增单一枚举 `appMode: 'studio' | 'stage' | 'story'`：

| 运行模式 | 触发热键 | 界面形态 | 核心用途 |
| :--- | :--- | :--- | :--- |
| **`studio`（工坊态）** | 默认 / `Esc` 退回 | 完整保留 V2.0.2 Wave A 的 48px 顶栏、折叠左侧轨、272px 悬浮面板与分析/导出抽屉 | 个人深度建模、出题、画试卷 SVG/TikZ、调参备课 |
| **`stage`（纯净演说态）** | `F11` / `F`（studio 下）或顶栏“全屏演说”按钮 | 100% 隐藏侧栏与顶栏；仅留左上极简标题、右上**活公式悬浮卡**、底部居中**灵动岛控制胶囊**（播放 / 3D-2D 切镜 / FBD / 副屏入口） | 课堂临时自由演示、随时拖拽公式现场变参、面试自由答辩 |
| **`story`（分镜讲课态）** | `Shift+F5` 或胶囊切入 | 在 `stage` 基础上激活 **翻页笔分镜引擎** + 底部字幕/关键结论条 + 进度点；每按一次翻页笔自动推进镜头、参数、临界定格与高亮图层 | **直接替代 PPT**，一镜到底讲完一整道压轴题或一节公开课 |

### 2. 向后兼容的 `SimulationPluginV3` 增量接口（`packages/sim-sdk`）
旧的 43 个 V2 插件一行不用改即可编译通过，V3 能力全部作为可选钩子按需挂载（`SimulationPluginV3<TParams, TState> extends SimulationPluginV2<TParams, TState>`，保持与 V2 相同的先 `TParams` 后 `TState` 泛型参数顺序）：

```ts
// packages/sim-sdk/src/v3Types.ts
import type { ParamRecord, SimulationPluginV2 } from './index.js';

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
```

---

## 三、四大硬骨头完整底座实现（写手直接照落盘，零自由发挥）

以下四块是 V3.0 最容易被写崩、写卡或做穿模的核心底座。数学推导与核心 TypeScript 骨架已全部解完，写手只需按仓库路径落盘并补齐单元测试与 React 壳绑定（注意满足仓库 `noUncheckedIndexedAccess: true` 与 ESM `.js` 后缀规范）。

---

### 硬骨头 #1：翻页笔分镜引擎与 rAF 平滑插值器（`StoryRunner`）

**易踩坑点**：直接用 `setInterval` 或在 React `useState` 里做参数缓动会触发 React 60fps 全树重渲染导致掉帧；翻页笔快速连按会导致多个补间打架；临界定格如果在渲染层轮询精度极差。  
**完整解**：纯 TypeScript 无 DOM 依赖内核（可 100% 进 Vitest 单测），挂入现有 `rAF` 主循环逐帧推进，连按自动取消前一个 Tween 并以当前值为新起点平滑衔接。

```ts
// packages/sim-sdk/src/storyRunner.ts
import type { StoryBeat, StoryDeck } from './v3Types.js';

export interface ActiveTween {
  startTimeMs: number;
  durationMs: number;
  fromParams: Record<string, number>;
  toParams: Record<string, number>;
}

export interface StoryRunnerCallbacks {
  getCurrentParams: () => Record<string, unknown>;
  applyParamsImperative: (patch: Record<string, unknown>) => void;
  controlSimulation: (action: 'reset-pause' | 'reset-play' | 'play' | 'pause') => void;
  applyCameraKeyframe: (camera: NonNullable<StoryBeat['camera']>) => void;
  applyLayerOverrides: (overrides: NonNullable<StoryBeat['layerOverrides']>) => void;
  onBeatChanged: (index: number, beat: StoryBeat) => void;
  onAutoFreezeTriggered: (badgeText: string) => void;
}

export function easeInOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

export class StoryRunner {
  private deck: StoryDeck;
  private cb: StoryRunnerCallbacks;
  private beatIndex = -1;
  private activeTween: ActiveTween | null = null;
  private freezeArmed = false;
  private prevObservableVal: number | null = null;

  constructor(deck: StoryDeck, callbacks: StoryRunnerCallbacks) {
    this.deck = deck;
    this.cb = callbacks;
  }

  public getCurrentIndex(): number {
    return this.beatIndex;
  }

  public getCurrentBeat(): StoryBeat | null {
    return this.beatIndex >= 0 && this.beatIndex < this.deck.beats.length
      ? (this.deck.beats[this.beatIndex] ?? null)
      : null;
  }

  public next(nowMs: number): boolean {
    if (this.beatIndex + 1 >= this.deck.beats.length) return false;
    return this.goTo(this.beatIndex + 1, nowMs);
  }

  public prev(nowMs: number): boolean {
    if (this.beatIndex <= 0) return false;
    return this.goTo(this.beatIndex - 1, nowMs);
  }

  public goTo(index: number, nowMs: number): boolean {
    if (index < 0 || index >= this.deck.beats.length) return false;
    const beat = this.deck.beats[index];
    if (!beat) return false;
    this.beatIndex = index;

    // 1. 参数补丁分类：非数值立即生效，数值进入 rAF 缓动队列
    this.activeTween = null;
    if (beat.paramPatch) {
      const current = this.cb.getCurrentParams();
      const immediatePatch: Record<string, unknown> = {};
      const fromNums: Record<string, number> = {};
      const toNums: Record<string, number> = {};
      const duration = beat.paramTweenMs ?? 450;

      for (const [k, v] of Object.entries(beat.paramPatch)) {
        if (typeof v === 'number' && typeof current[k] === 'number' && duration > 0) {
          fromNums[k] = current[k] as number;
          toNums[k] = v;
        } else {
          immediatePatch[k] = v;
        }
      }
      if (Object.keys(immediatePatch).length > 0) {
        this.cb.applyParamsImperative(immediatePatch);
      }
      if (Object.keys(toNums).length > 0) {
        this.activeTween = {
          startTimeMs: nowMs,
          durationMs: duration,
          fromParams: fromNums,
          toParams: toNums,
        };
      }
    }

    // 2. 图层与镜头关键帧
    if (beat.layerOverrides) this.cb.applyLayerOverrides(beat.layerOverrides);
    if (beat.camera) this.cb.applyCameraKeyframe(beat.camera);

    // 3. 仿真播放状态与临界定格武装
    if (beat.simAction && beat.simAction !== 'keep') {
      this.cb.controlSimulation(beat.simAction);
    }
    this.freezeArmed = Boolean(beat.autoFreeze);
    this.prevObservableVal = null;

    this.cb.onBeatChanged(index, beat);
    return true;
  }

  /** 每帧由主 rAF 驱动，零 React 重渲染 */
  public tick(nowMs: number, observables?: Record<string, number>): void {
    // 1. 推进参数平滑插值
    if (this.activeTween) {
      const elapsed = nowMs - this.activeTween.startTimeMs;
      const rawT = elapsed / Math.max(1, this.activeTween.durationMs);
      const eased = easeInOutCubic(rawT);
      const patch: Record<string, number> = {};
      for (const key of Object.keys(this.activeTween.toParams)) {
        const a = this.activeTween.fromParams[key];
        const b = this.activeTween.toParams[key];
        if (a === undefined || b === undefined) continue;
        patch[key] = a + (b - a) * eased;
      }
      this.cb.applyParamsImperative(patch);
      if (rawT >= 1) this.activeTween = null;
    }

    // 2. 临界自动定格检测
    const beat = this.getCurrentBeat();
    if (this.freezeArmed && beat?.autoFreeze && observables) {
      const { observableKey, operator, threshold, badgeText } = beat.autoFreeze;
      const val = observables[observableKey];
      if (typeof val === 'number' && Number.isFinite(val)) {
        let hit = false;
        if (operator === '>=') hit = val >= threshold;
        else if (operator === '<=') hit = val <= threshold;
        else if (operator === 'cross' && this.prevObservableVal !== null) {
          hit =
            (this.prevObservableVal - threshold) * (val - threshold) <= 0 &&
            this.prevObservableVal !== val;
        }
        this.prevObservableVal = val;
        if (hit) {
          this.freezeArmed = false;
          this.cb.controlSimulation('pause');
          this.cb.onAutoFreezeTriggered(badgeText);
        }
      }
    }
  }
}
```

**翻页笔全局热键铁律**（挂载于 `Stage/Story` 容器，输入焦点在 `<input>/<select>/<textarea>` 时自动屏蔽）：
- `ArrowRight` / `PageDown` / `Space`（`story` 态）：下一分镜（`stage` 态下 `Space` 切换播放/暂停）；
- `ArrowLeft` / `PageUp`（`story` 态）：上一分镜；
- `KeyB` 或 `.`（`stage`/`story` 态）：黑屏护眼遮罩（符合罗技/得力翻页笔黑屏键习惯；`studio` 态下 `B` 保持 `bigScreenMode` 兼容）；
- `KeyF`（`stage`/`story` 态）：手动定格/恢复；`KeyM`：一键 3D $\leftrightarrow$ 2D 压平切镜；`Escape`：退回 `studio`。

---

### 硬骨头 #2：双屏零后端演说同步协议（`PresenterSyncBridge`）

**使用场景**：教室大屏/希沃白板投屏主窗口（`role = 'stage'`），老师笔记本屏幕打开副屏控制台（`role = 'presenter'`，URL 为 `?mode=presenter&session=<id>`，天然兼容根路径 `/` 与 GitHub Pages `/PhysForge/`）。  
**架构原则（单一真理源）**：物理求解与 60fps 渲染**只在主屏（Stage）运行**；副屏只发“意图指令”，接收主屏节流后的 `15Hz` 状态快照与讲稿，彻底杜绝双屏物理状态漂移。

```ts
// apps/web/src/presentation/presenterSync.ts
export type PresenterCommand =
  | { type: 'CMD_NEXT_BEAT' }
  | { type: 'CMD_PREV_BEAT' }
  | { type: 'CMD_GOTO_BEAT'; index: number }
  | { type: 'CMD_SET_PARAM'; paramKey: string; value: number | string | boolean }
  | { type: 'CMD_TOGGLE_PLAY' }
  | { type: 'CMD_RESET_SIM' }
  | { type: 'CMD_TOGGLE_MORPH_2D' }
  | { type: 'CMD_TOGGLE_BLACKOUT' }
  | { type: 'CMD_LASER_POINTER'; active: boolean; normX: number; normY: number }
  | { type: 'CMD_REQUEST_SYNC' };

export interface StageSnapshotPayload {
  modelId: string;
  modelTitle: string;
  appMode: 'studio' | 'stage' | 'story';
  isPlaying: boolean;
  isBlackout: boolean;
  morphT: number; // 0 = 3D, 1 = 2D
  simTime: number;
  deckId: string | null;
  beatIndex: number;
  totalBeats: number;
  currentCaption: string;
  speakerNotes: string;
  nextBeatTitle: string | null;
  observables: Record<string, number>;
  params: Record<string, unknown>;
}

export type SyncEnvelope =
  | { sessionId: string; sender: 'presenter'; ts: number; msg: PresenterCommand }
  | { sessionId: string; sender: 'stage'; ts: number; msg: { type: 'STAGE_SNAPSHOT'; payload: StageSnapshotPayload } };

export class PresenterSyncBridge {
  private channel: BroadcastChannel | null = null;
  private sessionId: string;
  private role: 'stage' | 'presenter';
  private lastBroadcastMs = 0;

  constructor(
    sessionId: string,
    role: 'stage' | 'presenter',
    onEnvelope: (env: SyncEnvelope) => void
  ) {
    this.sessionId = sessionId;
    this.role = role;
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`physforge-v3-sync-${sessionId}`);
      this.channel.onmessage = (ev: MessageEvent<SyncEnvelope>) => {
        const data = ev.data;
        if (!data || data.sessionId !== this.sessionId || data.sender === this.role) return;
        onEnvelope(data);
      };
    }
  }

  public sendCommand(cmd: PresenterCommand): void {
    if (this.role !== 'presenter' || !this.channel) return;
    const env: SyncEnvelope = {
      sessionId: this.sessionId,
      sender: 'presenter',
      ts: performance.now(),
      msg: cmd,
    };
    this.channel.postMessage(env);
  }

  /** 主屏节流广播，默认上限 ~15Hz（66ms），重要状态切换可传 force=true */
  public broadcastSnapshot(payload: StageSnapshotPayload, force = false): void {
    if (this.role !== 'stage' || !this.channel) return;
    const now = performance.now();
    if (!force && now - this.lastBroadcastMs < 66) return;
    this.lastBroadcastMs = now;
    const env: SyncEnvelope = {
      sessionId: this.sessionId,
      sender: 'stage',
      ts: now,
      msg: { type: 'STAGE_SNAPSHOT', payload },
    };
    this.channel.postMessage(env);
  }

  public close(): void {
    this.channel?.close();
    this.channel = null;
  }
}

/** 构造严格兼容 Vite BASE_URL（/ 与 /PhysForge/）的副屏打开链接 */
export function buildPresenterWindowUrl(sessionId: string, modelId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('mode', 'presenter');
  url.searchParams.set('session', sessionId);
  url.searchParams.set('model', modelId);
  url.searchParams.delete('preset');
  return url.toString();
}
```

---

### 硬骨头 #3：活公式直接拖字母调参引擎（`LiveFormulaScrubber`）

**易踩坑点**：
1. 每次拖 1px 就重新跑一次 `katex.renderToString` 会让 DOM 抖动且丢失 `PointerCapture`；
2. 教室希沃触屏白板手指较粗，点击热区太小点不中，且手势容易误触发浏览器滚动或文字选中；
3. 开启 `katex` 的 `trust: true` 存在 XSS 安全隐患。

**完整解（零重新解析 + 安全白名单 + 垂直变速精调）**：
- KaTeX 渲染仅在公式字符串变化时执行一次，安全白名单**只允许** `\htmlClass` 与 `\htmlData`；
- 拖拽过程中完全不动 KaTeX DOM，仅通过 `setPointerCapture` 捕获指针，**左右拖动改值、手指向上/下拉离公式距离越大精度越细（$1\times \to 0.25\times \to 0.1\times$）**，并在字母正上方通过独立的浮层 HUD 实时显示当前数值与比例条；
- CSS 强制赋予 `.pf-live-var` 至少 `padding: 3px 6px; touch-action: none; user-select: none; cursor: ew-resize;` + 底部虚线微光提示，教室白板一指即中。

```ts
// apps/web/src/presentation/liveFormulaEngine.ts
import katex from 'katex';
import type { LiveFormulaSpec, LiveFormulaVarBinding } from '@physforge/sim-sdk';

/** 严格白名单渲染：严禁使用 trust: true */
export function renderInteractiveLatex(latex: string): string {
  return katex.renderToString(latex, {
    throwOnError: false,
    displayMode: true,
    strict: 'ignore',
    trust: (context) =>
      context.command === '\\htmlClass' || context.command === '\\htmlData',
  });
}

export interface ScrubVisualState {
  active: boolean;
  binding: LiveFormulaVarBinding | null;
  value: number;
  gearLabel: '1×' | '0.25×' | '0.1×';
  anchorX: number;
  anchorY: number;
}

export function clampAndQuantize(
  raw: number,
  min: number,
  max: number,
  step: number
): number {
  const clamped = Math.max(min, Math.min(max, raw));
  if (step <= 0) return clamped;
  const snapped = Math.round((clamped - min) / step) * step + min;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number(Math.max(min, Math.min(max, snapped)).toFixed(Math.min(6, decimals)));
}

/**
 * 指针拖拽状态机：挂载在活公式容器上，事件委托捕获 [data-param] 元素
 */
export function attachFormulaScrubber(
  container: HTMLElement,
  spec: LiveFormulaSpec,
  hooks: {
    getParamValue: (paramKey: string) => number;
    getDefaultValue: (paramKey: string) => number;
    onParamChange: (paramKey: string, nextValue: number) => void;
    onVisualUpdate: (state: ScrubVisualState) => void;
  }
): () => void {
  const bindingMap = new Map<string, LiveFormulaVarBinding>(
    spec.bindings.map((b) => [b.tokenKey, b])
  );

  let activePointerId: number | null = null;
  let activeBinding: LiveFormulaVarBinding | null = null;
  let activeEl: HTMLElement | null = null;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let accumValue = 0;
  let rafId = 0;
  let pendingEmit: { key: string; value: number } | null = null;

  const flushEmit = () => {
    rafId = 0;
    if (!pendingEmit) return;
    hooks.onParamChange(pendingEmit.key, pendingEmit.value);
    pendingEmit = null;
  };

  const scheduleEmit = (key: string, value: number) => {
    pendingEmit = { key, value };
    if (!rafId) rafId = requestAnimationFrame(flushEmit);
  };

  const findTokenEl = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof HTMLElement)) return null;
    return target.closest<HTMLElement>('[data-param]');
  };

  const onPointerDown = (e: PointerEvent) => {
    const tokenEl = findTokenEl(e.target);
    if (!tokenEl) return;
    const tokenKey = tokenEl.dataset.param;
    if (!tokenKey) return;
    const binding = bindingMap.get(tokenKey);
    if (!binding) return;

    e.preventDefault();
    e.stopPropagation();

    activePointerId = e.pointerId;
    activeBinding = binding;
    activeEl = tokenEl;
    startX = e.clientX;
    startY = e.clientY;
    lastX = e.clientX;
    accumValue = hooks.getParamValue(binding.paramKey);

    tokenEl.setPointerCapture(e.pointerId);
    tokenEl.classList.add('pf-live-var--dragging');

    const rect = tokenEl.getBoundingClientRect();
    hooks.onVisualUpdate({
      active: true,
      binding,
      value: accumValue,
      gearLabel: '1×',
      anchorX: rect.left + rect.width / 2,
      anchorY: rect.top,
    });
  };

  const onPointerMove = (e: PointerEvent) => {
    if (activePointerId !== e.pointerId || !activeBinding || !activeEl) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    if (dx === 0) return;

    const dyAbs = Math.abs(e.clientY - startY);
    let gear = 1;
    let gearLabel: '1×' | '0.25×' | '0.1×' = '1×';
    if (dyAbs > 110 || e.shiftKey) {
      gear = 0.1;
      gearLabel = '0.1×';
    } else if (dyAbs > 55) {
      gear = 0.25;
      gearLabel = '0.25×';
    }

    const baseSensitivity =
      activeBinding.sensitivity ?? (activeBinding.max - activeBinding.min) / 240;
    accumValue = Math.max(
      activeBinding.min,
      Math.min(activeBinding.max, accumValue + dx * baseSensitivity * gear)
    );
    const quantized = clampAndQuantize(
      accumValue,
      activeBinding.min,
      activeBinding.max,
      activeBinding.step
    );

    scheduleEmit(activeBinding.paramKey, quantized);

    const rect = activeEl.getBoundingClientRect();
    hooks.onVisualUpdate({
      active: true,
      binding: activeBinding,
      value: quantized,
      gearLabel,
      anchorX: rect.left + rect.width / 2,
      anchorY: rect.top,
    });
  };

  const endDrag = (e: PointerEvent) => {
    if (activePointerId !== e.pointerId) return;
    if (activeEl?.hasPointerCapture(e.pointerId)) {
      activeEl.releasePointerCapture(e.pointerId);
    }
    activeEl?.classList.remove('pf-live-var--dragging');
    activePointerId = null;
    activeBinding = null;
    activeEl = null;
    hooks.onVisualUpdate({
      active: false,
      binding: null,
      value: 0,
      gearLabel: '1×',
      anchorX: 0,
      anchorY: 0,
    });
  };

  const onDoubleClick = (e: MouseEvent) => {
    const tokenEl = findTokenEl(e.target);
    const tokenKey = tokenEl?.dataset.param;
    if (!tokenKey) return;
    const binding = bindingMap.get(tokenKey);
    if (!binding) return;
    e.preventDefault();
    hooks.onParamChange(binding.paramKey, hooks.getDefaultValue(binding.paramKey));
  };

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', endDrag);
  container.addEventListener('pointercancel', endDrag);
  container.addEventListener('dblclick', onDoubleClick);

  return () => {
    if (rafId) cancelAnimationFrame(rafId);
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', endDrag);
    container.removeEventListener('pointercancel', endDrag);
    container.removeEventListener('dblclick', onDoubleClick);
  };
}
```

---

### 硬骨头 #4（最硬核心）：3D 透视 $\leftrightarrow$ 2D 剖面无跳变压平切镜 + 跨管线对齐桥

**数学完整解（等视高 Dolly-Zoom 线性消透视 + 动态深度窗 + 零跳变正交接管）**：
设目标剖面处的恒定视口物理高度为 $H_{\text{view}}$，场景深度半径为 $R_d$。令压平进度 $u = \text{easeInOutCubic}(\text{morphT}) \in [0, 1]$：
1. **线性消除透视畸变**：
   $$\tan\left(\frac{\text{fov}(u)}{2}\right) = (1 - u)\tan\left(\frac{\text{fov}_{3D}}{2}\right) + u\tan\left(\frac{\text{fov}_{\min}}{2}\right)$$
2. **保持物体视觉尺寸恒定**：
   $$d(u) = \frac{H_{\text{view}}}{2 \tan(\text{fov}(u)/2)}$$
3. **动态裁剪窗根治 Z-fighting**：
   $$\text{near}(u) = \max(0.05,\ d(u) - 2.5 R_d), \qquad \text{far}(u) = d(u) + 2.5 R_d$$
4. **末端无缝切换正交相机**：当 $u \ge 0.999$ 时原子切换为严格同尺寸 `OrthographicCamera`，像素位移 $< 0.2\text{ px}$。

```ts
// apps/web/src/stage/cameraMorphController.ts
import * as THREE from 'three';
import { easeInOutCubic, type Spatial3DFlattenSpec } from '@physforge/sim-sdk';

export interface World2DAlignMetrics {
  isFlatOrtho: boolean;
  pxPerWorldUnit: number;
  centerWorldX: number;
  centerWorldY: number;
  viewportWidth: number;
  viewportHeight: number;
}

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export class CameraMorphController {
  public readonly perspCamera: THREE.PerspectiveCamera;
  public readonly orthoCamera: THREE.OrthographicCamera;

  private spec: Spatial3DFlattenSpec;
  private fov3DDeg = 42;
  private fovMinDeg = 2.0;

  private target = new THREE.Vector3(0, 0, 0);
  private visibleHeight: number;
  private aspect = 16 / 9;

  private orbitAzimuthRad: number;
  private orbitPolarRad: number;

  private morphT = 0; // 0 = 3D, 1 = 2D Ortho
  private morphFrom = 0;
  private morphTo = 0;
  private morphStartMs = 0;
  private morphDurationMs = 0;

  constructor(spec: Spatial3DFlattenSpec, width: number, height: number) {
    this.spec = spec;
    this.visibleHeight = spec.defaultVisibleHeight;
    this.orbitAzimuthRad = spec.default3DAzimuthRad;
    this.orbitPolarRad = spec.default3DPolarRad;
    this.aspect = Math.max(0.1, width / Math.max(1, height));

    this.perspCamera = new THREE.PerspectiveCamera(this.fov3DDeg, this.aspect, 0.1, 2000);
    const halfH = this.visibleHeight / 2;
    const halfW = halfH * this.aspect;
    this.orthoCamera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.05, 1000);

    this.applyPose();
  }

  public getMorphT(): number {
    return this.morphT;
  }

  public getActiveCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.morphT >= 0.999 ? this.orthoCamera : this.perspCamera;
  }

  public resize(width: number, height: number): void {
    this.aspect = Math.max(0.1, width / Math.max(1, height));
    this.perspCamera.aspect = this.aspect;
    this.applyPose();
  }

  public syncFromOrbitPosition(camPos: THREE.Vector3, orbitTarget: THREE.Vector3): void {
    if (this.morphT > 0.01) return;
    this.target.copy(orbitTarget);
    const offset = camPos.clone().sub(this.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    this.orbitAzimuthRad = sph.theta;
    this.orbitPolarRad = sph.phi;
    this.visibleHeight = 2 * sph.radius * Math.tan((this.fov3DDeg * DEG2RAD) / 2);
  }

  public startMorphTo(targetMorphT: number, nowMs: number, durationMs = 750): void {
    this.morphFrom = this.morphT;
    this.morphTo = Math.max(0, Math.min(1, targetMorphT));
    this.morphStartMs = nowMs;
    this.morphDurationMs = Math.max(1, durationMs);
  }

  public update(nowMs: number): boolean {
    if (this.morphDurationMs <= 0) return false;
    const raw = (nowMs - this.morphStartMs) / this.morphDurationMs;
    if (raw >= 1) {
      this.morphT = this.morphTo;
      this.morphDurationMs = 0;
    } else {
      this.morphT = this.morphFrom + (this.morphTo - this.morphFrom) * easeInOutCubic(raw);
    }
    this.applyPose();
    return true;
  }

  private applyPose(): void {
    const u = this.morphT;
    const flatAzimuth = 0;
    const flatPolar = this.spec.flattenPlane === 'xy' ? Math.PI / 2 : 0.0001;

    let dAz = ((flatAzimuth - this.orbitAzimuthRad + Math.PI) % (2 * Math.PI)) - Math.PI;
    if (dAz < -Math.PI) dAz += 2 * Math.PI;
    const curAz = this.orbitAzimuthRad + dAz * u;
    const curPolar = this.orbitPolarRad + (flatPolar - this.orbitPolarRad) * u;

    const tanMax = Math.tan((this.fov3DDeg * DEG2RAD) / 2);
    const tanMin = Math.tan((this.fovMinDeg * DEG2RAD) / 2);
    const curTan = tanMax + (tanMin - tanMax) * u;
    const curFovDeg = 2 * Math.atan(curTan) * RAD2DEG;
    const dist = this.visibleHeight / (2 * curTan);

    const depthSpan = Math.max(4, this.spec.sceneDepthRadius * 2.5);
    this.perspCamera.fov = curFovDeg;
    this.perspCamera.near = Math.max(0.05, dist - depthSpan);
    this.perspCamera.far = dist + depthSpan;
    this.perspCamera.updateProjectionMatrix();

    const sph = new THREE.Spherical(dist, Math.max(0.0001, Math.min(Math.PI - 0.0001, curPolar)), curAz);
    const offset = new THREE.Vector3().setFromSpherical(sph);
    this.perspCamera.position.copy(this.target).add(offset);
    this.perspCamera.up.set(0, 1, 0);
    if (this.spec.flattenPlane === 'xz' && u > 0.95) {
      this.perspCamera.up.set(0, 0, -1);
    }
    this.perspCamera.lookAt(this.target);

    const halfH = this.visibleHeight / 2;
    const halfW = halfH * this.aspect;
    this.orthoCamera.left = -halfW;
    this.orthoCamera.right = halfW;
    this.orthoCamera.top = halfH;
    this.orthoCamera.bottom = -halfH;
    this.orthoCamera.near = 0.05;
    this.orthoCamera.far = depthSpan * 4;
    this.orthoCamera.updateProjectionMatrix();

    const orthoDist = depthSpan * 2;
    if (this.spec.flattenPlane === 'xy') {
      this.orthoCamera.position.set(this.target.x, this.target.y, this.target.z + orthoDist);
      this.orthoCamera.up.set(0, 1, 0);
    } else {
      this.orthoCamera.position.set(this.target.x, this.target.y + orthoDist, this.target.z);
      this.orthoCamera.up.set(0, 0, -1);
    }
    this.orthoCamera.lookAt(this.target);
  }

  public project3DToScreen(
    world: { x: number; y: number; z?: number },
    viewportWidth: number,
    viewportHeight: number
  ): { x: number; y: number; visible: boolean } {
    const cam = this.getActiveCamera();
    const v = new THREE.Vector3(world.x, world.y, world.z ?? 0);
    v.project(cam);
    return {
      x: (v.x * 0.5 + 0.5) * viewportWidth,
      y: (-v.y * 0.5 + 0.5) * viewportHeight,
      visible: v.z >= -1 && v.z <= 1,
    };
  }

  public get2DAlignMetrics(viewportWidth: number, viewportHeight: number): World2DAlignMetrics {
    const pxPerWorldUnit = viewportHeight / Math.max(1e-6, this.visibleHeight);
    return {
      isFlatOrtho: this.morphT >= 0.999,
      pxPerWorldUnit,
      centerWorldX: this.target.x,
      centerWorldY: this.spec.flattenPlane === 'xy' ? this.target.y : -this.target.z,
      viewportWidth,
      viewportHeight,
    };
  }
}
```

#### 配套 PBR 仪器质感材质工厂（`apps/web/src/stage/spatialMaterials.ts`）
在 `apps/web/src/stage/spatialMaterials.ts` 中统一封装 5 套基于 `RoomEnvironment` 的实体材质，6 个旗舰 3D 单元统一调用，严禁单模型手写刺眼 `MeshBasicMaterial`：
- `anodizedRailMaterial`：阳极氧化深灰铝导轨（`MeshPhysicalMaterial`, `color: 0x334155`, `metalness: 0.82`, `roughness: 0.28`, `clearcoat: 0.2`）；
- `brushedCopperMaterial`：拉丝紫铜导体棒/螺线管（`color: 0xd97706`, `metalness: 0.88`, `roughness: 0.24`）；
- `magneticFluxMaterial`：克制微发光磁感线管（`MeshStandardMaterial`, `color: 0x38bdf8`, `emissive: 0x0284c7`, `emissiveIntensity: 0.55`, `transparent: true`, `opacity: 0.72`）；
- `dielectricGlassMaterial`：光学介质/磁约束透明壳（`MeshPhysicalMaterial`, `transmission: 0.78`, `roughness: 0.08`, `ior: 1.5`, `transparent: true`, `opacity: 0.45`）；
- `obsidianStageFloorMaterial`：极暗微反射实验台底面（`color: 0x0b0f17`, `roughness: 0.65`, `metalness: 0.15`），配合淡青极细坐标网格。

---

## 四、精选 6 大旗舰 3D 实体升级清单

其余 37 个单元自动通过统一壳子获得 `Stage / Story / Live Formula / Presenter` 能力；以下 6 个旗舰单元在 Wave 3–4 实装 3D 实体与 `CameraMorphController` 一键压平：

| 优先级 | 编号 | 模型 ID / 名称 | 3D 实体核心视觉件 | 压平剖面 | 活公式绑定变量示例 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **P0** | **E10** | `em-3d-magnetic-fields`（3D 电磁空间场） | 升级现有 3D：拉丝紫铜螺线管/环形线圈 + 粒子螺旋发光尾迹 + 三维矢量锥 | `xy` / `xz` | $B = \mu_0 n I$, $\mathbf{F} = q\mathbf{v}\times\mathbf{B}$ 拖 $I, v, B$ |
| **P0** | **E04** | `em-induction-double-rod`（双杆电磁感应） | 3D 阳极氧化平行导轨 + 双紫铜导体棒 + 穿透磁通柱体 + 动态电流光流；**一键压平为俯视 2D 受力剖面** | `xz` | $E = B L v$, $F_{\text{安}} = \frac{B^2 L^2 v}{R}$ 拖 $B, L, R$ |
| **P1** | **B1** | `em-bounded-magnetic-field`（有界磁场） | 3D 透明发光磁场盒/圆柱 + 粒子发光轨 + 磁聚焦汇聚光斑；**一键压平叠 2D 动态放缩圆/旋转圆包络** | `xy` | $R = \frac{m v_0}{q B}$, $T = \frac{2\pi m}{q B}$ 拖 $v_0, B, q$ |
| **P1** | **S02** | `stse-em-devices-suite`（回旋加速器等） | 3D 双 D 形金属空腔 + 交变电场狭缝辉光脉冲 + 立体加速螺旋轨迹 | `xz` | $E_{k\max} = \frac{q^2 B^2 R^2}{2m}$ 拖 $B, U, R$ |
| **P1** | **S01** | `stse-tokamak-magnetic-mirror`（托卡马克与磁镜） | 升级现有 3D：环形真空室透视壳 + 环向/极向线圈 + 螺旋闭合磁面与逃逸锥 | `xy` | 磁镜比 $R_m = B_{\max}/B_{\min}$ 拖 $B_{\max}, \theta_0$ |
| **P2** | **M10** | `astro-orbital-mechanics`（万有引力与变轨） | 3D 发光恒星/行星球体 + 轨道面透明圆盘 + 霍曼转移脉冲轨迹；压平对照 2D 能量与角动量矢量 | `xz` | $v = \sqrt{\frac{GM}{r}}$, $\Delta v_1$ 拖 $r_1, r_2, M$ |

---

## 五、分波次施工路线图与协作协议

* **执行路线**：`Step 0（在线 AI BYOK 闭环） → Wave 1（PR-1A/1B/1C 三态演说 + StoryRunner + 双屏提词） → Wave 2（PR-2A/2B 活公式拖拽调参） → Wave 3（PR-3A/3B 3D 压平切镜 + E10/E04/B1） → Wave 4（PR-4A/4B S02/S01/M10 + V3 视觉总检封板）`。
* **GitHub PR 协作协议（本地总控 Antigravity + 云端写手 GPT-6.2 Sol）**：
  1. 写手严禁直接推送 `main`，每个原子任务开独立短分支（单 PR 修改文件数 $\le 12$ 个）；
  2. GitHub Actions CI 全绿为第一道门禁；
  3. 本地总控拉取 PR 分支复跑完整门禁与 Playwright 实机多模态看图后，由总控合并进 `main` 并更新交接日志。
