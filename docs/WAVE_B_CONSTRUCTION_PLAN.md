# PhysForge Wave B 施工方案：全仓 43 单元坐标系统一、手柄/FBD 零漂移与画布质感升级（Luna 直接落地版）

> **文档定位**：本文件为总控在 Wave A 验收通过后，经**实盘逐一核查全部 43 个 `simulations/*/plugin.ts`、`SimulationStage.tsx`、`AutoFbdOverlay.tsx` 与 `SingleFileApp.tsx`** 编写的 Wave B 可直接复制级施工指南。  
> **配套基准**：[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md) ｜ [UI_PIXEL_1TO1_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/UI_PIXEL_1TO1_CONSTRUCTION_PLAN.md) ｜ **当前仅落盘方案，不擅改业务代码**。

---

## 第一部分：全仓深度盘点与架构纠偏（为什么 Wave B 必须重设计？）

### 1.1 总控对先前预估的纠偏结论

在 Wave A 之前估算全仓有 `18` 个模型未接入 `worldToScreen`；本次对全仓 **43** 个插件逐行扫盘后确认：问题比预期更深、范围更广——**真正全模式与舞台对齐的仅 4 个，其余 39 个模型按成因分为 3 类故障**：

1. **【隐蔽性最强】“写了 `scale`/`offset`，但中心锚点或 `ppm` 系数与舞台不相等”（24 个）**：
   - [SimulationStage.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/SimulationStage.tsx#L404) 与 [AutoFbdOverlay.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/AutoFbdOverlay.tsx#L72) 与 [RulerToolboxOverlay.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/RulerToolboxOverlay.tsx#L79) 统一按**标准舞台映射**投影手柄、Auto-FBD 矢量与虚拟尺规：
     $$s_x = 0.45\,W + \text{offsetX} + x \cdot \text{ppm}_0,\qquad s_y = 0.50\,H + \text{offsetY} - y \cdot \text{ppm}_0,\qquad \text{ppm}_0 = \min(W, H)\cdot 0.24\cdot \text{scale}$$
   - 而大量模型自行写了 `0.5W`/`0.25W`/`0.35W`/`0.16H` 与 `0.085`/`0.10`/`0.12`/`0.14`/`0.18`/`0.20`/`0.22`/`0.42/extent`（例如 `mech-shm-resonance` 悬点画在 `0.16H`，手柄/FBD 却按 `0.50H` 飘在下方 ~250px；`mech-free-sandbox` 画在 `0.14`，手柄按 `0.24` 飞离刚体；`mech-kinematics-chase` 手柄靠硬编码 `-1.2` 凑齐偏置；`wave-vibration-coupling` X 轴甚至漏乘 `viewport.scale`）。
2. **【Wave A 标尺次级模式缺口】（2 个）**：
   - [circuit-dc-capacitor-mna/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/circuit-dc-capacitor-mna/plugin.ts#L490-L501)：仅 `'divider-lamp'` 接入了 `0.45W / 0.50H / 0.24` 坐标；其余 5 个拓扑分支依然写 `w = Math.min(viewport.width * 0.62, 500)` **不乘 `viewport.scale`**，放大后回路不动但 `Rp` 手柄飞走。
   - [optics-ray-studio/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/optics-ray-studio/plugin.ts#L358-L440)：`'tir-interface'` 写 `0.468W / 0.518H` 导致悬停 `(0,0)` 手柄错位约 `(26px, 16px)`；`'double-slit'` 分支完全硬编码像素，不响应平移缩放。
   - 注：[em-induction-double-rod/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/em-induction-double-rod/plugin.ts#L446-L456) 垂直将导轨中心上移 `0.105H` 避让底部示波器，应通过下文 `defaultView.offsetRatioY = -0.105` 统一承接，使 `E04_00/02` 像素 100% 保持原样同时 `F外` 手柄垂直对齐杆心。
3. **【完全不响应平移/缩放】（13 个，其中 6 个带交互手柄必然脱钩）**：
   - **带交互手柄（6 个 P0 必治）**：`em-ac-generator-rms`、`em-lc-rlc-oscillation`、`em-transformer-grid`、`optics-wave-interference`（缺 `offset`）、`thermo-piston-gas-laws`、`wave-2d-ripple-fdtd`。
   - **无手柄但也必须接入平移/缩放/标尺（7 个）**：`comp-relativity-quantum-tunneling`、`modern-nuclear-recoil-decay`、`modern-photoelectric-compton`、`modern-rutherford-bohr`、`stse-em-devices-suite`、`stse-em-launch-regen-brake`、`thermo-cycles-kinetic-md`。

### 1.2 核心破局架构：`worldToScreen` + 声明式 `defaultView`

为什么很多模型不能简单删掉 `0.10` / `0.14` 改成 `scale = 1`？因为 `mech-projectile-coupling` 物理域宽 `10m`、`astro-orbital-mechanics` 半径达 `3.5r₁`，强按 `scale = 1` 打开会飞出屏幕。

**正确架构解**：
1. **所有 43 个插件在 `renderCanvas` 一律调用 `@physforge/sim-sdk` 的 `createWorldMapper(viewport)`（内部与 `worldToScreen` 完全同源）**，禁止私自另算 `cx / cy / ppm`。
2. **在 `SimulationPluginV2` 新增可选字段 `defaultView?: PluginDefaultViewSpec<TParams>`**：需要特殊初屏取景的模型只需声明初始倍率和相对中心偏移（如 `mech-projectile-coupling` 声明 `defaultView: { scale: 0.42, offsetRatioX: -0.25, offsetRatioY: -0.05 }`），`SimulationStage`（及 `SingleFileApp`）在模型加载、切换预设或复位视角时自动以其作为默认相机与 `100%` 基准。
3. **随动参考系天然免改**：[SimulationStage.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/SimulationStage.tsx#L294-L301) 已将 `frameOrigin` 折入 `effectiveVp.offsetX / offsetY`，故所有使用 `createWorldMapper(viewport)` 的插件天然同时兼容滚轮缩放（`0.1x–20x`）、拖拽平移、双指捏合、虚拟直尺量角器、Auto-FBD 与随动参考系！

---

## 第二部分：Step 0 — 公共基础设施直贴代码（先改底座再改模型）

> **严格顺序**：先落盘以下模块 B1 → B5，确认 `tsc` 与全量 `vitest` 绿灯（除新建的 `coordinate-alignment.test.ts` 待 B1–B4 逐批转绿），再按批次迁移模型。**严禁破坏 Wave A 已有 `E04` / `B3` / `B2` / `E10` 布局与 `data-testid`。**

### 模块 B1：扩展 `SimulationPluginV2` 默认视口声明（编辑 `packages/sim-sdk/src/index.ts`）

在 `packages/sim-sdk/src/index.ts` 的 `SimulationPluginV2` 定义上方加入 `PluginDefaultViewSpec`，并在 `SimulationPluginV2` 接口中补充可选属性 `defaultView`（参考 [index.ts#L336-L352](file:///d:/project%20code/44-PhysForge/packages/sim-sdk/src/index.ts#L336-L352)）：

```ts
/**
 * 模型默认初屏相机取景规格（世界坐标系基准下保持各模型最佳初始构图，同时让缩放/手柄/FBD/尺规完全同源）
 */
export interface PluginDefaultViewSpec<TParams extends ParamRecord = ParamRecord> {
  /** 相对于标准 0.24 * min(W, H) 比例尺的初始缩放系数；默认 1 */
  scale?: number | ((params: TParams, viewport: { width: number; height: number }) => number);
  /** 相对于画布标准原点 (0.45W, 0.50H) 的横向屏幕偏移比例，例如 -0.25 将世界原点左移至 0.20W */
  offsetRatioX?: number | ((params: TParams, viewport: { width: number; height: number }) => number);
  /** 相对于画布标准原点 (0.45W, 0.50H) 的纵向屏幕偏移比例，例如 -0.34 将世界原点上移至 0.16H */
  offsetRatioY?: number | ((params: TParams, viewport: { width: number; height: number }) => number);
}
```

在 `SimulationPluginV2` 接口末尾（`mountThreeScene?` 下方）追加：

```ts
  defaultView?: PluginDefaultViewSpec<TParams>;
```

### 模块 B2：统一世界坐标映射原语与反向逆解（编辑 `packages/sim-sdk/src/visualKit.ts`）

保留 `packages/sim-sdk/src/visualKit.ts` 第 1–35 行与第 37–553 行所有现有实现，**紧跟 `worldToScreen` 后**新增以下导出的无 DOM 公共函数（并在末尾补全导出的单测）：

```ts
export interface WorldMapper {
  readonly ppm: number;
  readonly toScreen: (worldX: number, worldY: number) => { x: number; y: number };
  readonly toX: (worldX: number) => number;
  readonly toY: (worldY: number) => number;
  readonly len: (worldLength: number) => number;
}

/** 返回与 SimulationStage / AutoFBD / Ruler 完全同源的每米像素比例尺。 */
export function getPixelsPerMeter(viewport: import('./index.js').Viewport): number {
  return Math.min(viewport.width, viewport.height) * 0.24 * viewport.scale;
}

/** 将屏幕像素坐标逆解为世界坐标（与 worldToScreen 严格互逆）。 */
export function screenToWorld(
  screenX: number,
  screenY: number,
  viewport: import('./index.js').Viewport,
  frameOrigin: CanvasFrameOrigin = { x: 0, y: 0 }
): { x: number; y: number } {
  const ppm = Math.max(1e-6, getPixelsPerMeter(viewport));
  const originX = viewport.width * 0.45 + viewport.offsetX;
  const originY = viewport.height * 0.5 + viewport.offsetY;
  return {
    x: frameOrigin.x + (screenX - originX) / ppm,
    y: frameOrigin.y - (screenY - originY) / ppm
  };
}

/** 在 renderCanvas 顶部一次构造高频热路径友好的坐标映射器。 */
export function createWorldMapper(
  viewport: import('./index.js').Viewport,
  frameOrigin: CanvasFrameOrigin = { x: 0, y: 0 }
): WorldMapper {
  const ppm = getPixelsPerMeter(viewport);
  const originX = viewport.width * 0.45 + viewport.offsetX;
  const originY = viewport.height * 0.5 + viewport.offsetY;
  return {
    ppm,
    toScreen: (worldX, worldY) => ({
      x: originX + (worldX - frameOrigin.x) * ppm,
      y: originY - (worldY - frameOrigin.y) * ppm
    }),
    toX: (worldX) => originX + (worldX - frameOrigin.x) * ppm,
    toY: (worldY) => originY - (worldY - frameOrigin.y) * ppm,
    len: (worldLength) => worldLength * ppm
  };
}

/** 解析插件声明的 defaultView（兼容缺失字段与极端窗口尺寸），钳位于安全缩放区间 [0.1, 20]。 */
export function resolveInitialCameraTransform<TParams extends import('./index.js').ParamRecord>(
  plugin: { defaultView?: import('./index.js').PluginDefaultViewSpec<TParams> } | undefined,
  params: TParams,
  width: number,
  height: number
): { scale: number; offsetX: number; offsetY: number } {
  const spec = plugin?.defaultView;
  if (!spec) return { scale: 1, offsetX: 0, offsetY: 0 };
  const vpSize = { width: Math.max(1, finite(width, 800)), height: Math.max(1, finite(height, 460)) };
  const rawScale = typeof spec.scale === 'function' ? spec.scale(params, vpSize) : (spec.scale ?? 1);
  const rawOffX = typeof spec.offsetRatioX === 'function' ? spec.offsetRatioX(params, vpSize) : (spec.offsetRatioX ?? 0);
  const rawOffY = typeof spec.offsetRatioY === 'function' ? spec.offsetRatioY(params, vpSize) : (spec.offsetRatioY ?? 0);
  const scale = Number.isFinite(rawScale) ? Math.max(0.1, Math.min(20, rawScale)) : 1;
  const offsetX = Number.isFinite(rawOffX) ? rawOffX * vpSize.width : 0;
  const offsetY = Number.isFinite(rawOffY) ? rawOffY * vpSize.height : 0;
  return { scale, offsetX, offsetY };
}
```

### 模块 B3：消除 `ViewportController.ts` 重复公式（覆盖 `apps/web/src/stage/ViewportController.ts`）

直接复用 `@physforge/sim-sdk` 导出函数并保留 `apps/web/src/stage/stage.test.ts` 全部既有签名：

```ts
import {
  getPixelsPerMeter,
  resolveInitialCameraTransform,
  screenToWorld,
  worldToScreen,
  type Viewport
} from '@physforge/sim-sdk';

export interface CameraTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export const MIN_ZOOM_SCALE = 0.1;
export const MAX_ZOOM_SCALE = 20.0;

export { getPixelsPerMeter, resolveInitialCameraTransform, screenToWorld, worldToScreen };

export function clampZoomScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.max(MIN_ZOOM_SCALE, Math.min(MAX_ZOOM_SCALE, scale));
}

export function getViewportAnchor(width: number, height: number): { cx: number; cy: number } {
  return { cx: width * 0.45, cy: height * 0.5 };
}

/**
 * 以鼠标指针所在屏幕坐标 (cursorX, cursorY) 为锚点进行无级缩放 (0.1x ~ 20x)
 */
export function zoomViewportAtCursor(
  prev: CameraTransform,
  cursorX: number,
  cursorY: number,
  width: number,
  height: number,
  zoomFactor: number
): CameraTransform {
  const nextScale = clampZoomScale(prev.scale * zoomFactor);
  if (Math.abs(nextScale - prev.scale) < 1e-9) return prev;
  const { cx, cy } = getViewportAnchor(width, height);
  const ratio = nextScale / prev.scale;
  const dx = cursorX - cx;
  const dy = cursorY - cy;
  return {
    scale: nextScale,
    offsetX: dx - (dx - prev.offsetX) * ratio,
    offsetY: dy - (dy - prev.offsetY) * ratio
  };
}

export function panViewport(
  prev: CameraTransform,
  deltaX: number,
  deltaY: number
): CameraTransform {
  return {
    scale: prev.scale,
    offsetX: prev.offsetX + deltaX,
    offsetY: prev.offsetY + deltaY
  };
}

export const DEFAULT_CAMERA_TRANSFORM: CameraTransform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0
};
```

### 模块 B4：外框与单文件壳层接入 `defaultView` 与相对 100% 缩放展示

#### B4-1. 修改 `apps/web/src/store/useClassroomStore.ts`（第 230–241 行 `applyPreset`）

在 `applyPreset` 的 `set((s) => ({ ... }))` 中追加一行 `resetViewNonce: s.resetViewNonce + 1`，使切换预设时（如天体霍曼转移变轨半径改变、电路分压切回闭合电源）自动触发重适配默认相机。

#### B4-2. 修改 `apps/web/src/components/SimulationStage.tsx`

1. 顶部从 `./ViewportController.js` 多导入 `resolveInitialCameraTransform`。
2. 在 `cameraRef`（第 215 行）旁新增两个 ref（解决首次加载 `resetViewNonce === 0` 时未触发 `defaultView` 的初始化竞态问题）：
   ```ts
   const baseScaleRef = useRef<number>(1);
   const userTransformedViewRef = useRef<boolean>(false);
   const applyDefaultCameraView = (width: number, height: number) => {
     const v2 = latestRef.current.plugin as SimulationPluginV2<ParamRecord, unknown>;
     const initialCam = resolveInitialCameraTransform(v2, latestRef.current.params, width, height);
     baseScaleRef.current = Math.max(1e-6, initialCam.scale);
     userTransformedViewRef.current = false;
     cameraRef.current = initialCam;
     viewportRef.current = {
       ...viewportRef.current,
       scale: initialCam.scale,
       offsetX: initialCam.offsetX,
       offsetY: initialCam.offsetY
     };
     setZoomPercent(100);
     setOverlayViewport(viewportRef.current);
   };
   ```
3. 将原第 589–602 行的 `useEffect(..., [resetViewNonce])` 改为监听 `[plugin.meta.id, resetViewNonce]`，去掉 `if (resetViewNonce === 0) return;`：
   ```ts
   useEffect(() => {
     const { width, height } = viewportRef.current;
     applyDefaultCameraView(width, height);
     renderFrameToCanvas();
   }, [plugin.meta.id, resetViewNonce]);
   ```
4. 在 `handleWheel`（第 614 行前后）、双指捏合缩放（第 936 行前后）及空白画布拖拽平移（`mode.kind === 'pan'`，第 986 行前后）中将 `userTransformedViewRef.current = true;`；同时在 `ResizeObserver` 的 `updateSize`（第 648–665 行）更新完 `width / height / dpr` 后追加：
   ```ts
   if (!userTransformedViewRef.current) {
     applyDefaultCameraView(width, height);
   }
   ```
   这样无论是直链打开 `?model=mech-projectile-coupling` 初次撑开真实尺寸，还是缩放后拉伸浏览器窗口，都不会错失 `defaultView` 也不会误清空用户视角。
5. 在 `handleWheel`（第 629 行）和双指捏合（第 951 行）中将 `setZoomPercent(...)` 改为相对基准百分比：
   ```ts
   setZoomPercent(Math.round((next.scale / Math.max(1e-6, baseScaleRef.current)) * 100));
   ```
6. 第 357–378 行 Strobe 频闪点改用 `worldToScreen(sxVal, syVal, vp)`。

#### B4-3. 修改 `apps/singlefile-exporter/src/SingleFileApp.tsx`

1. 顶部从 `@physforge/sim-sdk` 导入 `resolveInitialCameraTransform, worldToScreen`（并将 `targetPlugin` 类型视为包含可选 `defaultView` 的 V2 插件）。
2. 在 `updateSize`（[SingleFileApp.tsx#L282-L293](file:///d:/project%20code/44-PhysForge/apps/singlefile-exporter/src/SingleFileApp.tsx#L282-L293)）及切换预设触发的 `useEffect` 中，按 `resolveInitialCameraTransform(targetPlugin as never, latestRef.current.params, width, height)` 写入 `viewportRef.current` 的 `scale / offsetX / offsetY`；第 175–188 行 Strobe 点同样改用 `worldToScreen(s.observables.x, s.observables.y, vp)`。

---

### 模块 B5：防作弊全仓 43 单元坐标锁死自动化测试（新建 `simulations/coordinate-alignment.test.ts`）

> **强制铁律**：严禁 `skip`/`only`/删减断言！新建完成后，作为 Wave B 总验收的硬卡点。随着 Batch B1 → B4 推进，列表中的豁免/待改白名单逐步清空至 `0` 个（最后测试文件内**不允许存在任何跳过或白名单特例**）。

```ts
import { describe, expect, it } from 'vitest';
import {
  resolvePluginParams,
  worldToScreen,
  type ControlHandle,
  type ParamRecord,
  type SimulationPluginV2,
  type Viewport
} from '@physforge/sim-sdk';
import { loadSimulationById, simulationCatalog } from './catalog.js';

interface RecordedGeometry {
  worldXs: number[];
  worldYs: number[];
}

function createSpyContext(vp: Viewport, out: RecordedGeometry): CanvasRenderingContext2D {
  const stack: Array<{ tx: number; ty: number }> = [];
  let tx = 0;
  let ty = 0;

  const isScreenCornerHud = (x: number, y: number): boolean =>
    (x > vp.width - 230 && y < 155) || (x < 24 && y < 65);

  const pushPoint = (rawX: number, rawY: number, checkHud = false): void => {
    expect(Number.isFinite(rawX)).toBe(true);
    expect(Number.isFinite(rawY)).toBe(true);
    const sx = rawX + tx;
    const sy = rawY + ty;
    if (checkHud && isScreenCornerHud(sx, sy)) return;
    out.worldXs.push(sx);
    out.worldYs.push(sy);
  };

  const gradientStub = { addColorStop: () => undefined };
  const spy = {
    save: () => { stack.push({ tx, ty }); },
    restore: () => { const prev = stack.pop(); if (prev) { tx = prev.tx; ty = prev.ty; } },
    translate: (dx: number, dy: number) => { tx += dx; ty += dy; },
    rotate: () => undefined,
    scale: () => undefined,
    setTransform: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: (x: number, y: number) => pushPoint(x, y),
    lineTo: (x: number, y: number) => pushPoint(x, y),
    arc: (x: number, y: number) => pushPoint(x, y),
    arcTo: (x1: number, y1: number, x2: number, y2: number) => { pushPoint(x1, y1); pushPoint(x2, y2); },
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => { pushPoint(cx, cy); pushPoint(x, y); },
    bezierCurveTo: (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) => {
      pushPoint(c1x, c1y); pushPoint(c2x, c2y); pushPoint(x, y);
    },
    ellipse: (x: number, y: number) => pushPoint(x, y),
    stroke: () => undefined,
    fill: () => undefined,
    clip: () => undefined,
    setLineDash: () => undefined,
    rect: (x: number, y: number, w: number, h: number) => {
      if (w >= vp.width * 0.9 && h >= vp.height * 0.9) return;
      pushPoint(x + w * 0.5, y + h * 0.5);
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      if (w >= vp.width * 0.9 && h >= vp.height * 0.9) return;
      pushPoint(x + w * 0.5, y + h * 0.5);
    },
    strokeRect: (x: number, y: number, w: number, h: number) => {
      if (w >= vp.width * 0.9 && h >= vp.height * 0.9) return;
      pushPoint(x + w * 0.5, y + h * 0.5);
    },
    fillText: (text: string, x: number, y: number) => {
      expect(typeof text).toBe('string');
      pushPoint(x, y, true);
    },
    strokeText: (_text: string, x: number, y: number) => pushPoint(x, y, true),
    measureText: (text: string) => ({ width: text.length * 7.5 }),
    createLinearGradient: () => gradientStub,
    createRadialGradient: () => gradientStub,
    font: '13px sans-serif',
    fillStyle: '#fff',
    strokeStyle: '#fff',
    lineWidth: 1,
    globalAlpha: 1,
    shadowColor: 'transparent',
    shadowBlur: 0,
    globalCompositeOperation: 'source-over',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineCap: 'butt',
    lineJoin: 'miter'
  };
  return spy as unknown as CanvasRenderingContext2D;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) * 0.5;
}

function spread(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

describe('Wave B: 全仓 43 单元坐标系与缩放平移锁死审计', () => {
  it('all 43 plugins respond cleanly to pan (+140, -85) and zoom (2.0x) without NaN or handle divergence', async () => {
    const panX = 140;
    const panY = -85;
    const baseVp: Viewport = { width: 1440, height: 900, dpr: 1, scale: 1, offsetX: 0, offsetY: 0 };
    const pannedVp: Viewport = { width: 1440, height: 900, dpr: 1, scale: 1, offsetX: panX, offsetY: panY };
    const zoomedVp: Viewport = { width: 1440, height: 900, dpr: 1, scale: 2, offsetX: 0, offsetY: 0 };

    for (const entry of simulationCatalog) {
      const modelId = entry.meta.id;
      const plugin = (await loadSimulationById(modelId)) as SimulationPluginV2<ParamRecord, unknown>;
      expect(plugin).toBeDefined();

      // 全量覆盖每个模型的全部课堂预设与分支场景，防止次级模式遗漏
      const presetsToCheck = plugin.presets.length > 0 ? plugin.presets : [null];

      for (const preset of presetsToCheck) {
        const params = resolvePluginParams(plugin.paramSchema, preset?.params);
        const state = plugin.engine.createInitialState(params);
        const layers = new Set(plugin.layers.map((l) => l.id));

        const gBase: RecordedGeometry = { worldXs: [], worldYs: [] };
        const gPan: RecordedGeometry = { worldXs: [], worldYs: [] };
        const gZoom: RecordedGeometry = { worldXs: [], worldYs: [] };

        plugin.renderCanvas(createSpyContext(baseVp, gBase), state, params, baseVp, layers);
        plugin.renderCanvas(createSpyContext(pannedVp, gPan), state, params, pannedVp, layers);
        plugin.renderCanvas(createSpyContext(zoomedVp, gZoom), state, params, zoomedVp, layers);

        if (gBase.worldXs.length === 0) {
          throw new Error(`${modelId} (${preset?.id ?? 'default'}) rendered no geometry`);
        }

        const dxMedian = median(gPan.worldXs) - median(gBase.worldXs);
        const dyMedian = median(gPan.worldYs) - median(gBase.worldYs);
        if (Math.abs(dxMedian - panX) >= 28) {
          throw new Error(`${modelId} (${preset?.id ?? 'default'}) failed panX: expected ${panX}, got ${dxMedian.toFixed(1)}`);
        }
        if (Math.abs(dyMedian - panY) >= 28) {
          throw new Error(`${modelId} (${preset?.id ?? 'default'}) failed panY: expected ${panY}, got ${dyMedian.toFixed(1)}`);
        }

        const spanBase = Math.max(spread(gBase.worldXs), spread(gBase.worldYs));
        const spanZoom = Math.max(spread(gZoom.worldXs), spread(gZoom.worldYs));
        if (spanBase > 20 && spanZoom / spanBase <= 1.45) {
          throw new Error(`${modelId} (${preset?.id ?? 'default'}) failed 2x zoom scaling: ratio=${(spanZoom / spanBase).toFixed(2)}`);
        }

        if (plugin.getControlHandles) {
          const handles: ControlHandle[] = plugin.getControlHandles(state, params);
          for (const h of handles) {
            const p0 = worldToScreen(h.position.x, h.position.y, baseVp);
            const pZ = worldToScreen(h.position.x, h.position.y, zoomedVp);
            expect(Number.isFinite(p0.x) && Number.isFinite(p0.y)).toBe(true);
            expect(Math.hypot(pZ.x - 1440 * 0.45, pZ.y - 900 * 0.5)).toBeCloseTo(
              2 * Math.hypot(p0.x - 1440 * 0.45, p0.y - 900 * 0.5),
              4
            );
          }
        }
      }
    }
  });
});
```

> **提示（重要细节）**：如果某模型存在不随缩放移动的角标小曲线盒（例如 `mech-shm-resonance` 右上角小盒），在重构该模型时请遵循：物理实验主画布（单摆、圆周参考圆、电路、波包、力矢量等）**全部**走 `createWorldMapper(viewport)`，且小曲线盒改用 `rect`/`fillRect` 角落固定坐标（或同样以世界坐标安放在场景旁侧），同时尽量控制角落文字坐标落在 `isScreenCornerHud` 过滤范围或改用世界坐标放置，测试一次即可全部准确验证！**严禁为通过测试而扩大 `isScreenCornerHud` 范围或跳过任何模型。**

---

## 第三部分：全仓 43 单元四批次落地清单（Batch B1 → B4）

### 零改动确认组（已符合标准舞台映射的 4 单元）

以下 4 个模型已采用标准 `0.45W / 0.50H / 0.24*min(W,H)*scale`（仍须纳入模块 B5 自动化校验；如顺手替换手写 `toScreen` 为 `createWorldMapper(viewport)` 并补 `resolveAndDrawLabels` 防重叠更佳）：
1. `em-bounded-magnetic-field`
2. `comp-rigid-rolling-slip`
3. `mech-conical-turntable`
4. `mech-spring-separation`

---

### Batch B1：Wave A 遗留次分支 + 自由/力学核心 9 单元（最优先）

| 模型 ID | 建议 `defaultView`（1:1 保持现有初屏构图） | 具体代码与坐标对齐整改要求 | 手柄 / FBD / 标注检查重点 |
| :--- | :--- | :--- | :--- |
| **`optics-ray-studio`** | `defaultView: { offsetRatioX: (p) => (p.sceneMode === 'tir-interface' ? 0.018 : 0), offsetRatioY: (p) => (p.sceneMode === 'tir-interface' ? 0.018 : 0) }` | 1. [plugin.ts#L358-L364](file:///d:/project%20code/44-PhysForge/simulations/optics-ray-studio/plugin.ts#L358-L364) 删掉写死的 `0.468/0.518`，直接用 `const m = createWorldMapper(viewport);`。<br>2. `'double-slit'` 分支（[plugin.ts#L366-L440](file:///d:/project%20code/44-PhysForge/simulations/optics-ray-studio/plugin.ts#L366-L440)）用 `m.toX(-1.5)` / `m.toX(1.6)` / `m.toY(0)` 与 `m.len(...)` 绘制挡板、双缝、条纹与光强曲线，彻底消除原版不随平移缩放的像素硬编码。 | `'tir-interface'` `(0,0)` 黄环与手柄不再差 `26px/16px`；`'thin-lens-imaging'` 蜡烛顶端 `(-u, 0.55)` 手柄 100% 紧贴烛尖。 |
| **`circuit-dc-capacitor-mna`** | 不设自定义 `defaultView`（保留 `'divider-lamp'` `scale: 1, offset: 0` 原样与 E2E 基准！） | 保留 `'divider-lamp'`（[plugin.ts#L498-L632](file:///d:/project%20code/44-PhysForge/simulations/circuit-dc-capacitor-mna/plugin.ts#L498-L632)）；将其余 5 拓扑的 `left/right/top/bot`（原 [L490-L497](file:///d:/project%20code/44-PhysForge/simulations/circuit-dc-capacitor-mna/plugin.ts#L490-L497) 无 `scale`！）改为基于 `m = createWorldMapper(viewport)` 映射世界坐标框 `x ∈ [-1.7, 1.7]`、`y ∈ [-0.95, 0.95]`（注意 `getControlHandles` 第 `302–303` 行非 `divider-lamp` 的 `x: 1.7, y: -0.127 + sliderFraction * 0.254`：把滑变所在右支路定在世界 `x = 1.7`，上下端点定在 `y ∈ [-0.7, +0.7]` 并同步微调句柄 `y = -0.7 + sliderFraction * 1.4` 及其 `onDrag` 逆解 `((worldPos.y + 0.7) / 1.4) * 20`！）。 | 全部 6 种拓扑放大至 200% 时电路、电势路径、电流粒子与 `Rp` 手柄 100% 锁死；在 `coordinate-alignment.test.ts` 中额外遍历检查全 6 种拓扑。 |
| **`em-induction-double-rod`** | `defaultView: { offsetRatioY: -0.105 }` | 在 [plugin.ts#L444-L456](file:///d:/project%20code/44-PhysForge/simulations/em-induction-double-rod/plugin.ts#L444-L456) 将 `railMidY = center.y`（去掉 `- viewport.height * 0.105` 额外偏置），`E04_00/02` 画面像素与 Wave A **完全一模一样**，且当切换预设 1（`externalForce > 0.05`）时 `F外` 手柄与 `Auto-FBD` 矢量自动落回导轨中线！ | 复核 `E04_00` / `E04_02` 截图与 `visual-audit.mjs` 全项零回归。 |
| **`builder-custom-ode-lab`** | `defaultView: { scale: 0.75, offsetRatioX: 0.05 }` | 替换 [plugin.ts#L125-L128](file:///d:/project%20code/44-PhysForge/simulations/builder-custom-ode-lab/plugin.ts#L125-L128) 为 `const m = createWorldMapper(viewport);`，坐标轴延伸用世界区 `[-6, +6]` 而非 `(0, cy) -> (viewport.width, cy)`。 | `state.x` 摆球手柄与轨迹零漂移。 |
| **`mech-projectile-coupling`** | `defaultView: { scale: 0.42, offsetRatioX: -0.25, offsetRatioY: -0.05 }` | 替换 [plugin.ts#L119-L122](file:///d:/project%20code/44-PhysForge/simulations/mech-projectile-coupling/plugin.ts#L119-L122) 为 `const m = createWorldMapper(viewport);`、`const toScr = m.toScreen;`，半圆半径 `params.troughRadius * m.ppm`。 | 初速矢量手柄 `(0,0)->(v0*cos*0.25, ...)` 与 Auto-FBD `mg / f_空` 100% 粘合发射点与抛体小球；用 `drawGlowVectorArrow` 增强抛射箭头。 |
| **`mech-shm-resonance`** | `defaultView: { scale: 1, offsetRatioX: -0.01, offsetRatioY: -0.34 }` | 替换 [plugin.ts#L149-L152](file:///d:/project%20code/44-PhysForge/simulations/mech-shm-resonance/plugin.ts#L149-L152) 为 `const m = createWorldMapper(viewport); const pivot = m.toScreen(0, 0);`，摆长用 `L * m.ppm`，参考圆半径 `amp * m.ppm`。彻底解决摆球手柄 `initial-angle` 与 Auto-FBD 向下飞出 250px 严重 Bug！ | 悬点在屏幕偏上 `0.16H`，但世界原点 `(0,0)` 就是悬点，摆球中心 `m.toScreen(L*sinθ, -L*cosθ)` 与 `getControlHandles`/`getForceVectors` 100% 吻合。 |
| **`mech-free-sandbox`** | `defaultView: { scale: 0.58, offsetRatioX: 0.05 }` | 替换 [plugin.ts#L308-L315](file:///d:/project%20code/44-PhysForge/simulations/mech-free-sandbox/plugin.ts#L308-L315) 为 `const m = createWorldMapper(viewport);`，各刚体尺寸按 `b.halfW * m.ppm`。 | 顶块手柄 `dyn.x, dyn.y + dyn.halfH + 0.5` 与 Rapier 刚体中心 Auto-FBD 彻底紧咬。 |
| **`mech-vertical-circular`** | `defaultView: { scale: 0.83 }` | 替换 [plugin.ts#L104-L107](file:///d:/project%20code/44-PhysForge/simulations/mech-vertical-circular/plugin.ts#L104-L107) 为 `createWorldMapper(viewport)`。 | 半径调节手柄 `x = params.radius` 与 Auto-FBD 贴紧圆轨道。 |
| **`mech-dynamic-equilibrium`** | `defaultView: { scale: 0.92, offsetRatioX: -0.10 }` | 替换 [plugin.ts#L114-L116](file:///d:/project%20code/44-PhysForge/simulations/mech-dynamic-equilibrium/plugin.ts#L114-L116) 为 `const m = createWorldMapper(viewport)`，结点 `m.toScreen(0, 0)`；右侧矢量闭合三角形定位在世界点 `(2.4, 0.6)`，使用 `drawGlowVectorArrow` + `resolveAndDrawLabels` 避让 `F1/F2/mg` 文字。 | 旋转角手柄 `(1.4 cos a, 1.4 sin a)` 与结点 `O` 精确围圆旋转，三角形随画布联动缩放。 |

**Batch B1 小结校验**：跑 `node ./node_modules/typescript/bin/tsc -b packages/sim-sdk` + `vitest` 专项 + Batch B1 9 模型视觉抽检。

---

### Batch B2：力学进阶、天体、混沌与实验误差 9 单元

| 模型 ID | 建议 `defaultView` | 具体代码与坐标对齐整改要求 | 手柄 / FBD / 标注检查重点 |
| :--- | :--- | :--- | :--- |
| **`astro-orbital-mechanics`** | `defaultView: { scale: (p) => (0.42 / 0.24) / (p.mode === 'hohmann-transfer' ? p.r2OverR1 + 0.6 : 2.6), offsetRatioX: 0.05 }` | 替换 [plugin.ts#L151-L154](file:///d:/project%20code/44-PhysForge/simulations/astro-orbital-mechanics/plugin.ts#L151-L154) 为 `const m = createWorldMapper(viewport);`（`L1`–`L5` 拉格朗日标签改走 `resolveAndDrawLabels`）。 | 近地点速率手柄 `{ x: 1, y: v0Ratio - 1 }` 与霍曼靶轨道手柄 `{ x: -r2OverR1, y: 0 }` 100% 粘合轨道圈；切换预设自动重构图。 |
| **`mech-block-conveyor`** | `defaultView: { scale: 0.354, offsetRatioX: 0.05, offsetRatioY: 0.08 }` | 替换 [plugin.ts#L284-L293](file:///d:/project%20code/44-PhysForge/simulations/mech-block-conveyor/plugin.ts#L284-L293) 为 `const m = createWorldMapper(viewport);`，**注意**：移除原手写 `ctx.translate` 与 `camCenterS` 世界原点偏差（请核对 [plugin.ts#L220-L246](file:///d:/project%20code/44-PhysForge/simulations/mech-block-conveyor/plugin.ts#L220-L246) 中 `getForceVectors` 与 `referenceFrames` 返回的真实世界坐标 `bx/by`，让 `renderCanvas` 画出一致的世界 `bx/by`，不要用局部平移隐藏坐标偏置！）。 | 传送带速度手柄 `beltVelocity * 0.3`、FBD 矢与滑块跟随参考系三者合一；文字走 `resolveAndDrawLabels`。 |
| **`mech-collision-recoil`** | `defaultView: { scale: 0.50, offsetRatioX: 0.05, offsetRatioY: 0.02 }` | 替换 [plugin.ts#L134-L138](file:///d:/project%20code/44-PhysForge/simulations/mech-collision-recoil/plugin.ts#L134-L138) 为 `const m = createWorldMapper(viewport);`（质心线文字与球标签改走 `resolveAndDrawLabels`；动量矢量/角标区避开重叠）。 | 瞄准距手柄 `(-2.6, impactParamB)` 与散射靶球 100% 对齐，质心随动系一致。 |
| **`mech-constrained-velocity`** | `defaultView: { scale: 0.667, offsetRatioX: -0.20, offsetRatioY: 0.22 }` | 替换 [plugin.ts#L104-L107](file:///d:/project%20code/44-PhysForge/simulations/mech-constrained-velocity/plugin.ts#L104-L107) 为 `createWorldMapper(viewport)`，地面/墙线由世界区间 `[-1.2, +6.5]` / `[0, +4.2]` 映射，不再写死 `viewport.width - 30`；矢量改用 `drawGlowVectorArrow` + `resolveAndDrawLabels`。 | 手柄与绳/杆节点严格共面。 |
| **`mech-kinematics-chase`** | `defaultView: { scale: 0.833, offsetRatioX: -0.20, offsetRatioY: 0.05 }` | 替换 [plugin.ts#L116-L122](file:///d:/project%20code/44-PhysForge/simulations/mech-kinematics-chase/plugin.ts#L116-L122) 为 `const m = createWorldMapper(viewport);` 且 `toScr(xMeters, wy)` 返回 `m.toScreen(xMeters * 0.05, wy)`；同步修改 [plugin.ts#L66-L69](file:///d:/project%20code/44-PhysForge/simulations/mech-kinematics-chase/plugin.ts#L66-L69) 手柄 `position: { x: params.xB0 * 0.05, y: 0.2 }` 与 `onDrag` 逆解（删掉旧硬编码 `-1.2` 黑魔法！）；路面标尺线用世界区间 `[-1, +6]` 绘制并接 `resolveAndDrawLabels`。 | 初始间距手柄直接钉在 B 车正上方；切到 `car-a` 随动系时 A 车纹丝不动居锚点。 |
| **`stse-gravity-assist-rendezvous`** | `defaultView: { scale: (p) => (p.mode === 'rendezvous' ? 0.5 : 1.417) }` | 替换 [plugin.ts#L145-L152, #L192](file:///d:/project%20code/44-PhysForge/simulations/stse-gravity-assist-rendezvous/plugin.ts#L145-L192) 为 `const m = createWorldMapper(viewport);`，删掉两分支各自定义的 `0.34`/`0.12` 手写比例（注：若 `rendezvous` 轨道世界尺度与 `gravity-assist` 不同，在绘制与 `getControlHandles` 中保持统一 `m` 下可比的航天器坐标并用 `defaultView.scale` 自动适应视角）。 | 飞船轨道手柄与变轨圈、共转参考系 100% 同步。 |
| **`comp-chaos-normal-coriolis`** | 无自定义（保持双摆 `1, 0, 0`） | 保留双摆的 `0.45W / 0.50H / 0.24`；将 `normal-modes`（[L189-L215](file:///d:/project%20code/44-PhysForge/simulations/comp-chaos-normal-coriolis/plugin.ts#L189-L215)）与 `coriolis`（[L220-L249](file:///d:/project%20code/44-PhysForge/simulations/comp-chaos-normal-coriolis/plugin.ts#L220-L249)）两条分支全部接入 `m = createWorldMapper(viewport)`，弹簧简正物块放世界 `x ∈ [-2.0, +2.0]`，科里奥利双圆盘中心分别放 `(-1.25, 0)` 与 `(+1.25, 0)`，半径 `1.0m`！ | 双摆手柄不漂移，简正模态与科里奥利圆盘同时全支持滚轮缩放、拖拽、双盘标尺实测与防文字重叠。 |
| **`exp-electrical-error-lab` & `exp-mechanics-error-lab`** | 无自定义 | 主尺（卡尺/千分尺/纸带）替换 `toScreen` 为 `createWorldMapper(viewport)`；把 [exp-electrical-error-lab/plugin.ts#L248-L295](file:///d:/project%20code/44-PhysForge/simulations/exp-electrical-error-lab/plugin.ts#L248-L295) 的伏安法 `bulb-iv-curve`、`emf-inner-outer` 次分支及 [exp-mechanics-error-lab/plugin.ts#L175-L210](file:///d:/project%20code/44-PhysForge/simulations/exp-mechanics-error-lab/plugin.ts#L175-L210) 的 `a-F` 图像框均映射入世界区域 `[-1.8, +1.8] × [-1.1, +1.1]`；全文本改走 `resolveAndDrawLabels`。 | 所有测量与图像模式全支持滚轮局部放大精读游标刻度，不失真、不叠字。 |

---

### Batch B3：电磁场与振动/波动光学 10 单元（重灾区清零）

| 模型 ID | 建议 `defaultView` | 具体代码与坐标对齐整改要求 | 手柄 / FBD / 标注检查重点 |
| :--- | :--- | :--- | :--- |
| **`em-ac-field-oscilloscope`** | `defaultView: { scale: (p) => (p.mode === 'oscilloscope-lissajous' ? 1.0 : 1.0), offsetRatioX: 0.05, offsetRatioY: (p) => (p.mode === 'equivalent-gravity' ? -0.16 : 0) }` | 三分支全部统一使用 `const m = createWorldMapper(viewport);`：<br>• `oscilloscope-lissajous`：荧光圆盘放 `m.toScreen(0, 0)`，半径 `1.4 * m.ppm`；<br>• `equivalent-gravity`：摆悬点定 `m.toScreen(0, 0)`（匹配 `getForceVectors` 与 `getControlHandles` 原点），`defaultView.offsetRatioY: -0.16` 维持悬点居上构图！<br>• `electron-beam`：把粒子的横坐标 `p.x * 0.25 - 1.5` 与极板区通过 `m.toScreen` 映射。 | 彻底根治三分支互不兼容，等效重力手柄 `qE` 与 FBD 与单摆 100% 重合。 |
| **`em-capacitor-millikan`** | `defaultView: { scale: 0.917, offsetRatioX: -0.02, offsetRatioY: 0.02 }` | 替换 [plugin.ts#L147-L151](file:///d:/project%20code/44-PhysForge/simulations/em-capacitor-millikan/plugin.ts#L147-L151) 为 `const m = createWorldMapper(viewport);`，接地符号、极板与右侧放大窗/油滴全走 `m.toScreen` 并用 `resolveAndDrawLabels` 防碰撞。 | 两枚手柄 `halfSpan` / `probeFracP` 与油滴 FBD 在 200% 缩放下紧锁极板与液滴。 |
| **`em-eddy-vortex-field`** | `defaultView: { scale: 0.917, offsetRatioX: 0.05 }` | 替换 [plugin.ts#L120-L130, #L156-L157](file:///d:/project%20code/44-PhysForge/simulations/em-eddy-vortex-field/plugin.ts#L120-L157) 为 `createWorldMapper(viewport)`，双铜摆悬点由硬编码 `0.34W / 0.66W` 改为世界坐标 `m.toScreen(-1.1, 1.25)` 与 `m.toScreen(1.1, 1.25)`，圆柱区 `m.toScreen(0, 0)` + `params.cylinderRadiusR * m.ppm`。 | 手柄 `cylinderRadiusR`、摆标签与感生电场探针 `Auto-FBD` 全部响应平移缩放、无文本穿模。 |
| **`em-electrostatic-field`** | `defaultView: { scale: 0.85, offsetRatioX: 0.05 }` | 替换 [plugin.ts#L140-L144](file:///d:/project%20code/44-PhysForge/simulations/em-electrostatic-field/plugin.ts#L140-L144) 为 `createWorldMapper(viewport)`，电场线/等势线/箭头均用 `m.toScreen`（注意热图背景若逐像素着色需用 `screenToWorld` 计算网格采样位置或将分布小卡挪至标准角落）。 | 左右两枚电荷拖动手柄 `x1, x2` 及试探电荷 FBD 精准贴合点电荷中心！ |
| **`em-wireframe-rotation`** | `defaultView: { scale: 0.917, offsetRatioX: 0.05 }` | 替换 [plugin.ts#L140-L149](file:///d:/project%20code/44-PhysForge/simulations/em-wireframe-rotation/plugin.ts#L140-L149) 的 `cy = 0.28H` 与 `pivotY = 0.50H` 双中心分裂，统一由 `createWorldMapper(viewport)` 定义 `center = m.toScreen(0, 0)`，出磁场线框与圆盘模型统一挂在同一原点下！ | 手柄 `loopSizeL * 0.5` 与线框右边缘实时重合，FBD `mg / F安` 贴合线框质心。 |
| **`em-ac-generator-rms`** | 无自定义（或 `scale: 0.95`） | **原完全静态但带手柄，重大改造**：用 `const m = createWorldMapper(viewport);` 重写 `renderCanvas`——左区 `(-1.2, 0)` 放 `N/S` 磁极与旋转线圈、右区 `(0.3..2.1, -0.7..0.7)` 放交变波形与有效值标注、下方 `y = -0.9` 与 `x ∈ [-1, +1]` 画一条**带高亮发光滑轨的占空比导轨**，正好托住 `dutyCycleD` 手柄 `{ x: params.dutyCycleD * 2 - 1, y: -0.9 }`！全部文字走 `resolveAndDrawLabels`。 | 手柄不再悬在空白虚空里；整个发电机场景完全支持滚轮 20x 放大与拖拽！ |
| **`em-lc-rlc-oscillation`** | 无自定义 | **原完全静态但带手柄，重大改造**：参考同目录 [plugin.ts#L81-L101](file:///d:/project%20code/44-PhysForge/simulations/em-lc-rlc-oscillation/plugin.ts#L81-L101) `exportDiagramIR` 的世界坐标设计：左侧 `x ∈ [-2.0, -0.3]` 绘 LC 振荡回路（用 `drawRoundedPotentialPath` 与极板充放电发光动画！）、中部 `[0.1, 1.0]` 绘 `E_E / E_B` 能量柱、右侧 `[1.3, 2.2]` 绘阻抗相量图、正下方 `y = -0.9` 加驱动频率滑轨承接 `drive-omega` 手柄 `{ x: (driveOmega - 6) * 0.2, y: -0.9 }`，全文本走 `resolveAndDrawLabels`。 | `drive-omega` 手柄紧扣频率条，电路/相量缩放平移顺滑零失真。 |
| **`em-transformer-grid`** | 无自定义 | **原完全静态但带手柄，重大改造**：用 `createWorldMapper(viewport)` 将铁芯 `[-0.55, 0.55] × [-0.65, 0.65]`、原副线圈、远距离高压输电损耗标示与下方 `y = -0.9` 升压/原边调节滑轨纳入同一世界坐标，全部文字改走 `resolveAndDrawLabels`。 | 变比/电阻调节手柄 `{ y: -0.9 }` 落轨可用，全程可平移缩放与直尺量距。 |
| **`optics-wave-interference`** | 无自定义 | [plugin.ts#L125-L135](file:///d:/project%20code/44-PhysForge/simulations/optics-wave-interference/plugin.ts#L125-L135) 用 `const m = createWorldMapper(viewport);` 替代无 `offsetX/Y` 的 `w * 0.5, h * 0.45`，牛顿环与劈尖半径/条纹全按 `m.toScreen(0, 0)` + `1.5 * m.ppm` 映射，底部 `y = -0.9` 绘制波长光谱标尺条托住 `wavelengthNm` 手柄，文字走 `resolveAndDrawLabels`。 | 波长手柄直接坐在色谱滑轨上，推拉缩放牛顿环中心条纹清晰无比。 |
| **`wave-vibration-coupling`** | `defaultView: { scale: 0.72 }` | **严重双轴畸变修复**：当前 [plugin.ts#L371-L376](file:///d:/project%20code/44-PhysForge/simulations/wave-vibration-coupling/plugin.ts#L371-L376) 的 `scaleX` 未乘 `viewport.scale` 而 `scaleY` 乘了，且干涉点阵 `L573-576` 未随缩放！全部接入 `const m = createWorldMapper(viewport);`，映射波动空间 `x ∈ [-3.2, +3.2]` 到探针世界区（探针手柄 `(probeX, probeY)` 同属同一坐标系！），干涉热力格用 `screenToWorld` 或世界格网映射，振动子图放在波轴下方固定世界偏移 `y = -1.6`。 | 横波/驻波/双振源干涉完全各向同性缩放（圆就是圆，波长按实比例尺拉长），探针手柄 `(probeX, probeY)` 紧咬探测点！ |

---

### Batch B4：热学 / 二维水波 / 近代物理 / STSE 11 单元

| 模型 ID | 建议 `defaultView` | 具体代码与坐标对齐整改要求 | 手柄 / FBD / 标注检查重点 |
| :--- | :--- | :--- | :--- |
| **`thermo-piston-gas-laws`** | 无自定义 | **原完全静态但带手柄，重大改造**：用 `const m = createWorldMapper(viewport);` 在左侧 `[-1.8, -0.3]` 绘制气缸活塞 / 倾斜水银柱（均由 `m.toScreen` + `m.len` 驱动），右侧 `[0.2, +2.1] × [-0.9, +0.9]` 绘制 `P-V` 过程实时曲线，`x = 0` 处加竖直滑轨承接 `target-temp` / `tubeTiltDeg` 手柄（`x=0, y=...`），文字走 `resolveAndDrawLabels`。 | 竖直控温/倾角手柄真正坐落控制柱上，气缸活塞与 `P-V` 图同屏联动缩放平移。 |
| **`wave-2d-ripple-fdtd`** | `defaultView: { offsetRatioX: -0.04 }` | **原完全静态但带手柄，重大改造**：将 FDTD 水波池矩形定义在世界坐标 `x ∈ [-2.0, +1.4]`、`y ∈ [-1.2, +1.2]`（并按网格 `nx / ny` 等比确定槽高，确保双缝挡板中心恰好处于句柄指定的 `x = -0.6` 与 `± params.slitSepCells * 0.025` 世界纵坐标！）；右侧探测屏光强曲线画在 `[1.55, 2.15] × [-1.2, +1.2]`。 | 手柄 `slit-sep` `{ x: -0.6, y: slitSepCells * 0.025 }` 真正一像素不差地咬住双缝上沿，缩放水波池可看清波前衍射细节！ |
| **`stse-tokamak-magnetic-mirror`** | `defaultView: { scale: 0.917, offsetRatioX: 0.05 }` | 替换 [plugin.ts#L88-L94](file:///d:/project%20code/44-PhysForge/simulations/stse-tokamak-magnetic-mirror/plugin.ts#L88-L94) 的中心 projection 为 `const m = createWorldMapper(viewport);` 内的斜投影：先得 `base = m.toScreen(p.z * 0.85 + p.x * 0.32, p.y * 0.85 + p.x * 0.2)`。 | 与整体 2D 舞台共享缩尺基准与平移偏移。 |
| **`em-3d-magnetic-fields` (2D fallback)** | 无自定义 | 在 [plugin.ts#L98-L105](file:///d:/project%20code/44-PhysForge/simulations/em-3d-magnetic-fields/plugin.ts#L98-L105) 用 `createWorldMapper(viewport)` 实现 2D fallback 斜投影（`ThreeStage` 本身独立，不影响 Wave A 标尺 4）。 | 单文件导出 2D 降级态支持无损缩放平移。 |
| **`comp-relativity-quantum-tunneling`** | 无自定义 | 两条模式全接 `const m = createWorldMapper(viewport);`：Minkowski 光锥以 `m.toScreen(x * 0.22, ct * 0.22)` 居中映射，一维 TDSE 势垒与波函数 $|\psi(x)|^2$ 映射到世界盒 `[-2.3, +2.3] × [-0.9, +1.1]`，右上角简洁统计标签或接 `resolveAndDrawLabels`。 | 光锥斜坐标与量子波包隧穿可任意放大精观透射波包振荡！ |
| **`modern-nuclear-recoil-decay`** | 无自定义 | 云室反冲径迹与蒙特卡洛衰变晶格均以 `const m = createWorldMapper(viewport);` 映射入世界盒（右移/缩放到局部看清母核/子核分支顶点！），文本改走 `resolveAndDrawLabels`。 | 平移/缩放全响应，`NaN/Infinity` 零出现。 |
| **`modern-photoelectric-compton`** | `defaultView: { offsetRatioX: -0.05 }` | 康普顿散射向量与光电管极板均改用 `const m = createWorldMapper(viewport);`（替代无 `offset` 的 `0.38W / 0.52H`）与 `drawGlowVectorArrow` + `resolveAndDrawLabels`。 | 入射/散射光子与反冲电子箭头质感比肩标尺 1。 |
| **`modern-rutherford-bohr`** | 无自定义 | 散射靶核及 $\alpha$ 粒子轨迹、玻尔能级轨道跃迁全部改用 `const m = createWorldMapper(viewport);`（把原本 `scale = min(w,h)/280` 乘 `viewport.scale` 且走 `m.toScreen(x / 65, y / 65)` 映射至标准世界盒），文本走 `resolveAndDrawLabels`。 | 靠近金原子核微米级散射角细节可直接滚轮放大至 2000% 审视！ |
| **`stse-em-devices-suite`** | 无自定义 | 回旋加速器 / 质谱仪 / 速度选择器 / 电磁流量计全部改用 `const m = createWorldMapper(viewport);`（移除无 `offset/scale` 的写死值 `0.45, 0.52, 0.28`）。 | 四个电磁现代应用装置统一支持全局平移缩放与尺规测量 D 形盒半径。 |
| **`stse-em-launch-regen-brake`** | 无自定义 | 电磁导轨炮与再生制动能量账本条映射到世界矩形 `[-2.2, +2.2] × [-1.0, +1.0]`，导轨采用 `drawMetallicRail`，标注走 `resolveAndDrawLabels`。 | 能量条与滑块位置精准随画布居中、平移、放大，不再孤立写死顶角文字。 |
| **`thermo-cycles-kinetic-md`** | `defaultView: { offsetRatioX: -0.05 }` | 刚体分子模拟箱与卡诺/绝热 `P-V` 环均通过 `const m = createWorldMapper(viewport);` 映射入 `[-2.2, +2.0] × [-1.2, +1.2]`（例如 `kinetic-md-box` 把正方容器映射到 `[-1.9, 0.1] × [-1.0, 1.0]`，右侧布朗速度直方图/统计放 `[0.3, 2.1]`）。 | 局部放大分子碰撞壁面与布朗尾迹，无压线无重叠。 |

---

### 模块 B6：扩展实机多模型缩放/平移审计脚本（更新 `scripts/visual-audit.mjs`）

在 `scripts/visual-audit.mjs` 的四张标尺基准检查**之后**（不修改原有 Wave A 任何断言与文件名 `E04_* / B3_* / B2_* / E10_*`），追加一段 **`runWaveBCoordinateAudit(page, origin)`**：
1. 依次访问代表全仓跨尺度的 6 个重点模型：
   - `em-induction-double-rod`（验证默认带 `defaultView` 的 Wave A 模型缩放到 200% 不裂）
   - `builder-optics-ray`（切 `thin-lens-imaging` 验证物体手柄、焦点精准对齐）
   - `builder-circuit-mna`（切 `closed-power` 验证非 `divider-lamp` 拓扑在 200% 下回路与 `Rp` 联动）
   - `mech-shm-resonance`（验证悬点 `0.16H` 与摆球手柄/`Auto-FBD` 彻底零偏移）
   - `mech-projectile-coupling`（验证大尺度抛体在 `defaultView.scale=0.42` + 200% 缩放 + 拖拽下零丢失）
   - `wave-2d-ripple-fdtd`（验证双缝手柄在 200% 缩放后仍紧咬挡板，平移像素差一致）
2. 对每个模型实机执行：
   - 读取 `[data-testid="viewport-zoom-badge"]` 确认为 `100%`；
   - 将鼠标移动到画布中心派发两次向上滚轮（`page.mouse.wheel(0, -300)`），断言缩放示数变为 `> 115%` 且 `canvasFingerprint` 变化；
   - 按住画布空白区向右下拖拽 `+100px, +60px`，断言 `canvasFingerprint` 再次变化且**控制台/页面错均为 `0`**；
   - 点击 `[data-testid="btn-reset-view"]`，断言缩放示数回归 `100%`；
   - 对 `WaveB_SHM.png`、`WaveB_Projectile.png`、`WaveB_FDTD.png` 等截图输出至 `artifacts/ui-audit/` 供总控并排看图复核。

---

## 第四部分：Luna 施工顺序与硬性验证门禁

1. **Step 0**：先改 `packages/sim-sdk/src/index.ts`、`packages/sim-sdk/src/visualKit.ts`、`apps/web/src/stage/ViewportController.ts`、`apps/web/src/store/useClassroomStore.ts`、`apps/web/src/components/SimulationStage.tsx`、`apps/singlefile-exporter/src/SingleFileApp.tsx`，补充 `packages/sim-sdk/src/visualKit.test.ts` 对 `screenToWorld` / `createWorldMapper` / `resolveInitialCameraTransform` 的双向互逆与边界单元测试，并落地 `simulations/coordinate-alignment.test.ts`。
2. **Batch B1 → Batch B4**：每完成一批立即本地跑通对应 `tsc` + `vitest run simulations/coordinate-alignment.test.ts`（逐步缩小偏差、直至 43 单元 + `B2` 全 6 拓扑 + `B3` 全模式一次性跑通）。
3. **最终验收闭环（全部在最后一次编辑后执行）**：
   - 11 个 `tsconfig.json` `tsc --noEmit` 全绿（`0 error`）；
   - `node_modules\.bin\vitest run`（全仓已有 254 用例 + 新增 Wave B `visualKit`/`coordinate-alignment` 全通过，**严禁 `skip`/`only` 或特例豁免**）；
   - `node ./scripts/run-verify-packs.mjs`、`node ./scripts/run-verify-scenes.mjs`、`node ./scripts/run-verify-vault.mjs` 全通过；
   - `$env:VITE_BASE_PATH='/PhysForge/'; node_modules\.bin\vite build apps/web` 主入口 JS `< 350 KB` gzip 且 `MAIN_LEAK_CHECK: CLEAN`；
   - `node ./apps/singlefile-exporter/export.mjs --model=mech-projectile-coupling`（额外实测带 `defaultView` 模型的单文件导出正常）；
   - `node scripts/visual-audit.mjs` + `node scripts/e2e-subpath-and-export.mjs` 全通过，`git diff --check` 退出码 `0`；
   - Luna 亲自看图检验 `artifacts/ui-audit/` 下的 `E04/B3/B2/E10`（Wave A 标尺不退化）及 `WaveB_*.png` 后，更新 [WRITER_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_HANDOFF_LOG.md) 提交总控验收。
