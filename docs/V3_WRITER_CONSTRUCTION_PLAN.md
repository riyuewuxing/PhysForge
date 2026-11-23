# PhysForge V3.0 写手直接施工代码与原子任务单（Wave 0 + Wave 1 实盘版）

> **文档定位**：本文件是总控依据 [PHYSFORGE_V3_SPATIAL_STAGE_BLUEPRINT.md](file:///d:/project%20code/44-PhysForge/docs/v3-specs/PHYSFORGE_V3_SPATIAL_STAGE_BLUEPRINT.md) 对照 `main@c4dbcfa` **真实本地源码** 审校纠偏后，为写手生成的**直接可落地施工代码与逐文件任务单**。  
> **配套宪法**：[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md) ｜ **写手交接日志**：[WRITER_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_HANDOFF_LOG.md)

---

## 一、总控对本地代码的实盘审校与纠偏（开工前必读）

实查本地仓库 `main@c4dbcfa` 后，线上蓝图有 **8 处必须按本地代码实际修正的差异点**，写手必须严格按本节裁定施工，禁止按蓝图字面盲写：

1. **`packages/sim-sdk` 入口与泛型顺序纠偏**：
   * 本地不存在 `packages/sim-sdk/src/types.ts`，全部类型导出均在 [packages/sim-sdk/src/index.ts](file:///d:/project%20code/44-PhysForge/packages/sim-sdk/src/index.ts)。
   * 本地 `SimulationPluginV2<TParams extends ParamRecord = ParamRecord, TState = unknown>` 的泛型参数顺序为 **先 `TParams` 后 `TState`**（蓝图第 6 节错写成 `<TState, TParams>`）。
   * **裁定**：新增 `packages/sim-sdk/src/v3.ts`（并从 `src/index.ts` `export * from './v3.js'`），保持 `SimulationPluginV3<TParams extends ParamRecord = ParamRecord, TState = unknown>` 泛型顺序一致，且在 `sim-sdk` 内保持**零外部运行时依赖**（`live-math` 与 `director-deck` 复用 `sim-sdk` 的纯类型定义，避免循环依赖）。
2. **主题枚举桥接（`chalkboard | projector` ↔ `obsidian | daylight`）**：
   * 本地 [useClassroomStore.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/store/useClassroomStore.ts#L19) 与 [index.css](file:///d:/project%20code/44-PhysForge/apps/web/src/index.css#L16) 使用 `'chalkboard' | 'projector'` 与 `[data-theme="projector"]`。
   * **裁定**：保留 `ClassroomTheme = 'chalkboard' | 'projector'` 兼容 V2 组件，新增 `StageTheme = 'obsidian' | 'daylight'` 与 `toStageTheme()` 映射函数，同时在 `index.css` 中同时支持 `[data-theme="chalkboard"]` / `[data-theme="obsidian"]`（底色 `#090E1A`）与 `[data-theme="projector"]` / `[data-theme="daylight"]`（底色 `#F3F6FA`）。
3. **快捷键冲突仲裁（分态作用域路由）**：
   * 本地 [App.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/App.tsx#L105-L122) 已占用 `1-9`（切预设）、`Space`（播放/暂停）、`B`（大屏模式）、`P`（POE 遮罩）。
   * **裁定**：在 `App.tsx` 实现分态键盘路由：
     * 全局安全切态：`1` = `stage`、`2` = `story`、`3` = `studio`（Studio 下改用 `Alt+1..9` 切预设）；
     * `stage` 态：`PageDown`/`ArrowRight`/`Space` = 下一拍，`PageUp`/`ArrowLeft` = 上一拍，`B`/`.` = 黑屏聚焦，`P` = 打开双屏讲演台，`O` = POE 遮罩，`D` = $3\text{D}\leftrightarrow 2\text{D}$ 切镜，`F` = Auto-FBD，`G` = 迷你示波器，`W` = Excalidraw 透明板书，`M` = 物理微触感音效，`T` = 暗夜/白昼，`R` = 重播当前拍；
     * `studio` 态：保留 `Space` 播放/暂停、`R` 重置、`S` 单步、`O` POE 遮罩、`Ctrl+K` 搜索、`Ctrl+Z/Y` 撤销重做。
4. **解除首屏 `B1` 静态导入 + 重构 `ThreeStage.tsx` 硬编码耦合**：
   * 实查 [useClassroomStore.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/store/useClassroomStore.ts#L15) 仍静态 `import { emBoundedMagneticFieldPlugin }`；[ThreeStage.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/ThreeStage.tsx#L5-L16) 静态耦合 `E10`/`S01` 引擎且每次卸载调用 `forceContextLoss()`。
   * **裁定**：Wave 1 将 `useClassroomStore` 初始加载改为异步 `loadSimulationById('builder-composite-em-field')`（配合占位空态或最小轻壳），并把 `E10`/`S01` 迁移到 `SimulationPluginV3.createStage3DAdapter()`，用 `@physforge/stage-3d` 单例池替换 `ThreeStage.tsx` 原实现。
5. **KaTeX `.woff2` 字体瘦身插件落盘位置**：
   * 本地 [apps/web/src/index.css](file:///d:/project%20code/44-PhysForge/apps/web/src/index.css#L3) 同步 `@import "katex/dist/katex.min.css";`（`katex@^0.19.1`）。
   * **裁定**：在 [apps/web/vite.config.ts](file:///d:/project%20code/44-PhysForge/apps/web/vite.config.ts) 注入 `katexWoff2OnlyPlugin()`，在 CSS transform 与 bundle 阶段剔除 `.woff` / `.ttf` 字体，仅打包 `.woff2`；主入口包体门禁从 `< 350 KB` 收紧为 **`<= 320 KB` gzip**。
6. **2D 画布世界坐标锚点注意（Wave 0 FBD/手柄必填避坑）**：
   * 实查 [ViewportController.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/ViewportController.ts#L17-L38)：`worldToScreen` 以 `(width * 0.45 + offsetX, height * 0.5 + offsetY)` 为原点、`ppm = Math.min(width, height) * 0.24 * scale`、`+y` 朝上。部分模型（如 `C01`、`X01`、`X02`）的 `renderCanvas` 使用了屏幕相对像素坐标，Wave 0 添加 `getControlHandles` / `getForceVectors` 时必须注意视觉锚点一致性（必要时将句柄拖拽映射为归一化屏幕-世界域或微调对应画布绘制原点）。
7. **新包配置标准与 Vitest 自动发现**：
   * 本地 [pnpm-workspace.yaml](file:///d:/project%20code/44-PhysForge/pnpm-workspace.yaml) 已声明 `"packages/*"`，[vitest.config.ts](file:///d:/project%20code/44-PhysForge/vitest.config.ts) 已自动包含 `packages/*/src/**/*.test.ts`。
   * 每个新包必须严格对齐 `packages/ai-copilot` 的 `package.json` + `tsconfig.json` + `tsconfig.build.json`（含 `exclude: ["src/**/*.test.ts"]`），否则 `pnpm typecheck` 与 `pnpm build` 会失败。
8. **Windows PowerShell 5.1 与沙盒规则**：
   * 禁止在 PowerShell 中写 `&&`，改用 `; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE };`；
   * 安装 `camera-controls`（MIT）必须使用 `BypassSandbox: true` 执行 `pnpm --filter @physforge/stage-3d add camera-controls`；
   * **禁止在任何 Wave 修改或放松已有 218 条 `engine.test.ts` 断言**。

---

## 二、Wave 0 直接施工代码（V2.0.1 缺口彻底封口）

> **目标**：补齐 `AGENTS.md` V3 红线、8 个模型缺失交互/视觉强化、10 份高考真题 `SceneDSL`、`byokClient.ts` 容错、`ci.yml` `/PhysForge/` 冒烟与 WebM Playwright 校验。完成后跑通全门禁并打 `v2.0.1` Tag。

### 1. `AGENTS.md` 增量追加第五节（V3.0 四大红线）

在根目录 `AGENTS.md` 末尾追加：

```markdown
## 6. V3.0 演说平台硬性工程红线
1. **100% MIT 协议红线**：严禁引入 GSAP（非 MIT）、`@theatre/studio`（AGPL-3.0）、`@react-three/fiber` 或任何外部 `.glb`/`.hdr`/字体 CDN。仅允许 MIT 协议的 `three`、`camera-controls`、`katex`、`uplot` 等纯本地库。
2. **WebGL 单例与核显兜底红线**：全应用同时活跃的 `WebGLRenderer` 实例与 WebGL Context 数必须严格等于 `1`（由 `@physforge/stage-3d` 的 `Stage3DPool` 统一持有并强制 `dispose()` 旧场景资源）。必须实现 `PerformanceGuard`（DPR 上限、低帧降档、静止休眠）与 `webglcontextlost` 自动回退 2D Canvas 兜底。
3. **主包与字体瘦身红线**：`apps/web` 首屏主入口 JS（gzip）必须 **`<= 320 KB`**；`three`、`camera-controls` 严禁打入主包；`katex` 仅允许打包 `.woff2` 字体（剔除 `.woff`/`.ttf`）。
4. **零 DOM 内核不可侵犯**：3D PBR 几何生成、相机切镜、活公式渲染与导演剧本时间轴全部放在表现层包（`stage-3d` / `director-deck` / `live-math`），绝不污染 `packages/physics-core` 与 43 单元 `engine.ts`。
```

### 2. 定向交互与视觉补齐（直接合入对应 `plugin.ts`）

#### (1) `M07` [simulations/mech-conical-turntable/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/mech-conical-turntable/plugin.ts) — 补齐 `getForceVectors`

在 `defineSimulationPlugin({...})` 中加入 `getForceVectors`（需从 `@physforge/physics-core` 引入 `CLASSROOM_GRAVITY`，注意 `degToRad` 已有）：

```ts
  getForceVectors: (state, params) => {
    const g = CLASSROOM_GRAVITY;
    if (params.mode === 'conical-pendulum') {
      const th = degToRad(state.coneAngleDeg);
      const rHoriz = params.pendulumLength * Math.sin(th) * Math.cos(state.angleRad);
      const yVert = -params.pendulumLength * Math.cos(th) * 0.6;
      const bobOrigin = { x: rHoriz, y: yVert };
      const tx = -state.tensionN * Math.sin(th) * Math.cos(state.angleRad);
      const ty = state.tensionN * Math.cos(th);
      return [
        {
          id: 'gravity',
          label: 'm_A g',
          origin: bobOrigin,
          force: { x: 0, y: -params.massA * g },
          color: '#fb7185',
          category: 'gravity',
          unit: 'N'
        },
        {
          id: 'tension',
          label: 'T',
          origin: bobOrigin,
          force: { x: tx, y: ty },
          color: '#38bdf8',
          category: 'tension',
          unit: 'N'
        }
      ];
    }

    const c = Math.cos(state.angleRad);
    const s = Math.sin(state.angleRad);
    const posA = { x: -state.rA * c, y: -state.rA * s };
    const posB = { x: state.rB * c, y: state.rB * s };
    return [
      {
        id: 'friction-a',
        label: 'f_A',
        origin: posA,
        force: { x: state.frictionAN * c, y: state.frictionAN * s },
        color: '#4ade80',
        category: 'friction',
        unit: 'N'
      },
      {
        id: 'tension-a',
        label: 'T_A',
        origin: posA,
        force: { x: state.tensionN * c, y: state.tensionN * s },
        color: '#38bdf8',
        category: 'tension',
        unit: 'N'
      },
      {
        id: 'friction-b',
        label: 'f_B',
        origin: posB,
        force: { x: -state.frictionBN * c, y: -state.frictionBN * s },
        color: '#f472b6',
        category: 'friction',
        unit: 'N'
      },
      {
        id: 'tension-b',
        label: 'T_B',
        origin: posB,
        force: { x: -state.tensionN * c, y: -state.tensionN * s },
        color: '#38bdf8',
        category: 'tension',
        unit: 'N'
      }
    ];
  },
```

#### (2) `M08` [simulations/mech-spring-separation/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/mech-spring-separation/plugin.ts) — 补齐 `getForceVectors`

引入 `CLASSROOM_GRAVITY`（从 `@physforge/physics-core`），增加 `getForceVectors`：

```ts
  getForceVectors: (state, params) => {
    const th = degToRad(params.inclineDeg);
    const cosT = Math.cos(th);
    const sinT = Math.sin(th);
    const g = CLASSROOM_GRAVITY;
    const fSpring = -params.springK * state.s1;
    const fN = state.separated ? 0 : state.normalForceN;
    const p1 = { x: state.s1 * cosT, y: state.s1 * sinT };
    const p2 = { x: (state.s2 + 0.52) * cosT, y: (state.s2 + 0.52) * sinT };

    return [
      {
        id: 'm1-spring',
        label: 'F_弹',
        origin: p1,
        force: { x: fSpring * cosT, y: fSpring * sinT },
        color: '#fbbf24',
        category: 'other',
        unit: 'N'
      },
      {
        id: 'm1-gravity',
        label: 'm_1 g',
        origin: p1,
        force: { x: 0, y: -params.mass1 * g },
        color: '#fb7185',
        category: 'gravity',
        unit: 'N'
      },
      {
        id: 'm1-normal-contact',
        label: 'F_{N21}',
        origin: p1,
        force: { x: -fN * cosT, y: -fN * sinT },
        color: '#38bdf8',
        category: 'normal',
        unit: 'N'
      },
      {
        id: 'm2-normal-contact',
        label: 'F_{N12}',
        origin: p2,
        force: { x: fN * cosT, y: fN * sinT },
        color: '#38bdf8',
        category: 'normal',
        unit: 'N'
      },
      {
        id: 'm2-external',
        label: 'F_外',
        origin: p2,
        force: { x: params.externalForce * cosT, y: params.externalForce * sinT },
        color: '#4ade80',
        category: 'other',
        unit: 'N'
      }
    ];
  },
```

#### (3) `C01` [simulations/comp-rigid-rolling-slip/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/comp-rigid-rolling-slip/plugin.ts) — 补齐 `getForceVectors` 与 `getControlHandles`

从 `@physforge/physics-core` 引入 `CLASSROOM_GRAVITY, degToRad`，新增：

```ts
  getControlHandles: (state, params) => {
    if (params.scenario !== 'flat-bowling-slip') return [];
    const basePos = { x: -1.0, y: -0.25 };
    return [
      {
        id: 'initial-v0',
        label: `v₀=${params.v0Mps.toFixed(1)}m/s`,
        origin: basePos,
        position: { x: basePos.x + params.v0Mps * 0.14, y: basePos.y },
        handleKind: 'vector',
        color: '#38bdf8',
        onDrag: (wp) => ({
          v0Mps: Number(Math.max(-10, Math.min(15, (wp.x - basePos.x) / 0.14)).toFixed(1))
        })
      },
      {
        id: 'initial-omega0',
        label: `ω₀=${params.omega0Radps.toFixed(0)}rad/s`,
        origin: { x: -1.0, y: 0.4 },
        position: { x: -1.0 + params.omega0Radps * 0.012, y: 0.4 },
        handleKind: 'vector',
        color: '#fbbf24',
        onDrag: (wp) => ({
          omega0Radps: Math.round(Math.max(-150, Math.min(100, (wp.x + 1.0) / 0.012)) / 10) * 10
        })
      }
    ];
  },
  getForceVectors: (state, params) => {
    const g = CLASSROOM_GRAVITY;
    const m = Math.max(0.2, params.massKg);
    const origin = { x: Math.max(-1.6, Math.min(1.6, -1.2 + (state.x % 2.8))), y: -0.2 };
    if (params.scenario === 'incline-race') {
      const th = degToRad(params.inclineDeg);
      const c = SHAPE_INERTIA_COEFF[params.shape];
      const fStatic = (c / (1 + c)) * m * g * Math.sin(th);
      const normal = m * g * Math.cos(th);
      return [
        { id: 'mg', label: 'mg', origin, force: { x: 0, y: -m * g }, color: '#fb7185', category: 'gravity', unit: 'N' },
        { id: 'normal', label: 'N', origin, force: { x: normal * Math.sin(th), y: normal * Math.cos(th) }, color: '#38bdf8', category: 'normal', unit: 'N' },
        { id: 'friction', label: 'f_静', origin, force: { x: -fStatic * Math.cos(th), y: fStatic * Math.sin(th) }, color: '#fbbf24', category: 'friction', unit: 'N' }
      ];
    }

    const R = Math.max(0.05, params.radiusM);
    const slip = state.v - state.omega * R;
    const fMag = state.mode === 'pure-rolling' || Math.abs(slip) < 1e-9 ? 0 : params.muK * m * g;
    const fDir = slip > 0 ? -1 : 1;
    return [
      { id: 'mg', label: 'mg', origin, force: { x: 0, y: -m * g }, color: '#fb7185', category: 'gravity', unit: 'N' },
      { id: 'normal', label: 'N', origin, force: { x: 0, y: m * g }, color: '#38bdf8', category: 'normal', unit: 'N' },
      ...(fMag > 0
        ? [{ id: 'fk', label: 'f_滑', origin, force: { x: fDir * fMag, y: 0 }, color: '#fbbf24', category: 'friction' as const, unit: 'N' }]
        : [])
    ];
  },
```

#### (4) `X01` & `X02` 补齐 `getControlHandles`

* **`X01`** [simulations/exp-mechanics-error-lab/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/exp-mechanics-error-lab/plugin.ts)：
```ts
  getControlHandles: (_state, params) => [
    {
      id: 'hanger-mass',
      label: `钩码 m=${params.hangerMassKg.toFixed(2)}kg`,
      origin: { x: 0.2, y: -0.9 },
      position: { x: 0.2 + (params.hangerMassKg / 0.5) * 1.4, y: -0.9 },
      handleKind: 'point',
      color: '#fbbf24',
      onDrag: (wp) => ({
        hangerMassKg: Number(Math.max(0.01, Math.min(0.5, ((wp.x - 0.2) / 1.4) * 0.5)).toFixed(2))
      })
    },
    {
      id: 'track-tilt',
      label: `倾角 θ=${params.trackTiltDeg.toFixed(1)}°`,
      origin: { x: -1.4, y: -0.6 },
      position: {
        x: -1.4 + Math.cos((params.trackTiltDeg * Math.PI) / 180) * 0.9,
        y: -0.6 + Math.sin((params.trackTiltDeg * Math.PI) / 180) * 0.9
      },
      handleKind: 'angle',
      color: '#38bdf8',
      onDrag: (wp) => {
        const deg = (Math.atan2(wp.y + 0.6, wp.x + 1.4) * 180) / Math.PI;
        return { trackTiltDeg: Math.round(Math.max(0, Math.min(10, deg)) * 2) / 2 };
      }
    }
  ],
```

* **`X02`** [simulations/exp-electrical-error-lab/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/exp-electrical-error-lab/plugin.ts)：
```ts
  getControlHandles: (_state, params) => {
    if (params.mode === 'caliper-micrometer') {
      return [
        {
          id: 'vernier-jaw',
          label: `卡尺=${params.targetVernierMm.toFixed(2)}mm`,
          origin: { x: -1.4, y: 0.5 },
          position: { x: -1.4 + (params.targetVernierMm / 50) * 2.8, y: 0.5 },
          handleKind: 'point',
          color: '#a855f7',
          onDrag: (wp) => ({
            targetVernierMm: Number(Math.max(0, Math.min(50, ((wp.x + 1.4) / 2.8) * 50)).toFixed(2))
          })
        }
      ];
    }
    return [
      {
        id: 'rheostat-tap',
        label: `滑片 ${(params.rheostatTapFrac * 100).toFixed(0)}%`,
        origin: { x: -1.2, y: -0.9 },
        position: { x: -1.2 + params.rheostatTapFrac * 2.4, y: -0.9 },
        handleKind: 'point',
        color: '#38bdf8',
        onDrag: (wp) => ({
          rheostatTapFrac: Math.round(Math.max(0.05, Math.min(1, (wp.x + 1.2) / 2.4)) * 20) / 20
        })
      }
    ];
  },
```

#### (5) `S04` & `C02` 补齐 `getControlHandles` 与 `referenceFrames`

* **`S04`** [simulations/stse-gravity-assist-rendezvous/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/stse-gravity-assist-rendezvous/plugin.ts)：
```ts
  getControlHandles: (_state, params) => [
    params.mode === 'gravity-assist'
      ? {
          id: 'impact-param',
          label: `b=${params.impactParam.toFixed(2)}`,
          origin: { x: 0, y: 0 },
          position: { x: 0, y: (params.flybySide === 'trailing' ? -1 : 1) * params.impactParam },
          handleKind: 'point',
          color: '#38bdf8',
          onDrag: (wp) => ({
            impactParam: Number(Math.max(0.15, Math.min(1.2, Math.abs(wp.y))).toFixed(2)),
            flybySide: wp.y <= 0 ? 'trailing' : 'leading'
          })
        }
      : {
          id: 'delta-v',
          label: `Δv/v₀=${(params.deltaVFraction * 100).toFixed(0)}%`,
          origin: { x: 1.0, y: 0 },
          position: { x: 1.0, y: params.deltaVFraction * 6 },
          handleKind: 'vector',
          color: '#4ade80',
          onDrag: (wp) => ({
            deltaVFraction: Number(Math.max(0.01, Math.min(0.16, Math.abs(wp.y) / 6)).toFixed(2))
          })
        }
  ],
  referenceFrames: [
    {
      id: 'planet-frame',
      label: '行星 / 目标舱共动参考系',
      getOrigin: (state) => ({ x: state.planetPos.x, y: state.planetPos.y }),
      getVelocity: (state) => ({ x: state.planetVel.x, y: state.planetVel.y })
    }
  ],
```

* **`C02`** [simulations/comp-chaos-normal-coriolis/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/comp-chaos-normal-coriolis/plugin.ts)：
```ts
  getControlHandles: (_state, params) => {
    if (params.mode === 'coriolis-disk') {
      return [
        {
          id: 'puck-speed',
          label: `v₀=${params.puckSpeedMps.toFixed(1)}m/s`,
          origin: { x: 0, y: 0 },
          position: { x: params.puckSpeedMps * 0.8, y: 0 },
          handleKind: 'vector',
          color: '#38bdf8',
          onDrag: (wp) => ({
            puckSpeedMps: Number(Math.max(0.3, Math.min(2.0, wp.x / 0.8)).toFixed(1))
          })
        }
      ];
    }
    return [
      {
        id: 'theta1-init',
        label: `θ₁=${params.theta1Deg}°`,
        origin: { x: 0, y: 0.4 },
        position: {
          x: Math.sin((params.theta1Deg * Math.PI) / 180) * params.l1M,
          y: 0.4 - Math.cos((params.theta1Deg * Math.PI) / 180) * params.l1M
        },
        handleKind: 'angle',
        color: '#38bdf8',
        onDrag: (wp) => {
          const deg = (Math.atan2(wp.x, -(wp.y - 0.4)) * 180) / Math.PI;
          return { theta1Deg: Math.round(Math.max(10, Math.min(175, Math.abs(deg))) / 5) * 5 };
        }
      }
    ];
  },
  referenceFrames: [
    {
      id: 'rotating-disk-frame',
      label: '转盘旋转参考系中心',
      getOrigin: (state, params) =>
        params.mode === 'coriolis-disk'
          ? { x: state.labPos.x - state.rotDirectState[0], y: state.labPos.y - state.rotDirectState[1] }
          : { x: 0, y: 0 }
    }
  ],
```

#### (6) `B2` [simulations/circuit-dc-capacitor-mna/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/circuit-dc-capacitor-mna/plugin.ts) — 电势着色、电流光珠与 `SHORT_CIRCUIT` 告警

更新 `B2` `renderCanvas` 的 `schematic` 分支（利用 `state.nodeVoltages`、`state.totalCurrent`、`state.events`）：

```ts
    const voltageToColor = (v: number): string => {
      const ratio = Math.max(0, Math.min(1, v / Math.max(1e-3, params.emf || 12)));
      const r = Math.round(56 + ratio * 195);
      const g = Math.round(189 - ratio * 65);
      const b = Math.round(248 - ratio * 180);
      return `rgb(${r}, ${g}, ${b})`;
    };

    const vTopLeft = state.nodeVoltages[1] ?? params.emf;
    const vTopRight = state.nodeVoltages[2] ?? params.terminalVoltage;
    const vGround = state.nodeVoltages[0] ?? 0;

    if (activeLayers.has('schematic')) {
      ctx.save();
      // 按节点电势渐变绘制四周导线
      ctx.lineWidth = 4;
      ctx.strokeStyle = voltageToColor(vTopLeft);
      ctx.beginPath(); ctx.moveTo(left, cy); ctx.lineTo(left, top); ctx.lineTo(cx, top); ctx.stroke();

      ctx.strokeStyle = voltageToColor(vTopRight);
      ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(right, top); ctx.lineTo(right, cy); ctx.stroke();

      ctx.strokeStyle = voltageToColor(vGround);
      ctx.beginPath(); ctx.moveTo(right, cy); ctx.lineTo(right, bot); ctx.lineTo(left, bot); ctx.lineTo(left, cy); ctx.stroke();

      // 流动电荷光珠动画（对数映射速率防高流过快）
      const iAbs = Math.abs(state.totalCurrent);
      if (iAbs > 1e-4) {
        const beadSpeed = Math.log1p(iAbs * 2.5) * 0.25 * Math.sign(state.totalCurrent || 1);
        const phase = ((state.t * beadSpeed) % 1 + 1) % 1;
        const perim = 2 * (w + h);
        const samplePerim = (u: number): { x: number; y: number } => {
          const d = ((u % 1 + 1) % 1) * perim;
          if (d < w) return { x: left + d, y: top };
          if (d < w + h) return { x: right, y: top + (d - w) };
          if (d < 2 * w + h) return { x: right - (d - w - h), y: bot };
          return { x: left, y: bot - (d - 2 * w - h) };
        };
        ctx.fillStyle = '#38bdf8';
        for (let k = 0; k < 12; k++) {
          const pt = samplePerim(phase + k / 12);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 4.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // ...保留原有电源/R1/C/负载元件与 SHORT_CIRCUIT 红色脉冲告警：
      if (state.events.some((ev) => ev.id === 'SHORT_CIRCUIT') || (params.internalR <= 0.25 && params.sliderR <= 0.5 && params.emf > 0)) {
        ctx.fillStyle = 'rgba(244, 63, 94, 0.22)';
        ctx.strokeStyle = '#fb7185';
        ctx.lineWidth = 2.5;
        ctx.fillRect(cx - 120, bot - 42, 240, 32);
        ctx.strokeRect(cx - 120, bot - 42, 240, 32);
        ctx.fillStyle = '#fecdd3';
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.fillText('⚠ SHORT_CIRCUIT 电流过载警告', cx - 102, bot - 21);
      }
```

### 3. `packages/ai-copilot/src/byokClient.ts` — 平衡花括号 JSON 提取与 CORS 容错

替换 [packages/ai-copilot/src/byokClient.ts](file:///d:/project%20code/44-PhysForge/packages/ai-copilot/src/byokClient.ts) 第 19–58 行：

```ts
export function extractJsonObjectFromLlmText(rawText: string): unknown {
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || rawText.trim();
  const start = candidate.indexOf('{');
  if (start === -1) {
    throw new Error(`BYOK 返回内容中未检测到 JSON 对象：${rawText.slice(0, 120)}`);
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return JSON.parse(candidate.slice(start, i + 1)) as unknown;
      }
    }
  }
  throw new Error(`BYOK 返回的 JSON 花括号未闭合：${candidate.slice(start, start + 140)}`);
}

export async function requestByokSceneCandidate(
  config: ByokConfig,
  userPrompt: string,
  feedback?: string
): Promise<unknown> {
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const content = feedback
    ? `${userPrompt}\n\n[上轮无头物理引擎检验未通过，请针对下列报错修正参数后重试]:\n${feedback}`
    : userPrompt;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: buildByokSystemPrompt() },
          { role: 'user', content }
        ]
      }),
      signal: AbortSignal.timeout(15000)
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error(`BYOK 请求超时（15s），请检查 Base URL 网络连通性：${endpoint}`);
    }
    throw new Error(
      `BYOK 网络请求失败（常见原因：目标 API 未开启浏览器 CORS 跨域头或 Base URL 不可达；建议使用支持 CORS 的网关或本地代理）。原始错误：${msg}`
    );
  }

  if (!res.ok) {
    const body = (await res.text()).slice(0, 240);
    if (res.status === 401 || res.status === 403) {
      throw new Error(`BYOK 鉴权失败（HTTP ${res.status}），请检查 API Key 权限：${body}`);
    }
    if (res.status === 429) {
      throw new Error(`BYOK 触发限流（HTTP 429），请稍后重试或切换模型：${body}`);
    }
    throw new Error(`BYOK API HTTP ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const rawText = data.choices?.[0]?.message?.content ?? '';
  return extractJsonObjectFromLlmText(rawText);
}
```

### 4. `content/presets/` 扩至 10 份高考压轴真题 `SceneDSL`（全部过 `pnpm verify:scenes`）

在现有 4 份基础上，按 [sceneSchema.ts](file:///d:/project%20code/44-PhysForge/packages/ai-copilot/src/sceneSchema.ts) 格式新增 6 份文件（各单元参数键先用 `cat/read_file` 核对对应 `engine.ts` 的 `ParamFieldSpec` 键名与合法区间）：
1. `content/presets/em-induction-double-rod.equal-width.json`（`em-induction-double-rod`）
2. `content/presets/mech-vertical-circular.track-derail.json`（`mech-vertical-circular`）
3. `content/presets/mech-spring-separation.incline.json`（`mech-spring-separation`）
4. `content/presets/em-electrostatic-field.dipole.json`（`em-electrostatic-field`）
5. `content/presets/astro-orbital-mechanics.hohmann.json`（`astro-orbital-mechanics`）
6. `content/presets/exp-electrical-error-lab.emf-outer.json`（`exp-electrical-error-lab`）

### 5. `.github/workflows/ci.yml` 增加 `/PhysForge/` 子路径与 WebM E2E 冒烟 Job

在 [.github/workflows/ci.yml](file:///d:/project%20code/44-PhysForge/.github/workflows/ci.yml) 追加 `e2e-subpath` Job：
- 构建 `VITE_BASE_PATH=/PhysForge/ pnpm --filter @physforge/web build`；
- 在同一命令块内用 Node HTTP 静态服务器将 `apps/web/dist` 挂载到 `/PhysForge/` 路径下（端口 `4179`），通过 Playwright 无头 Chromium 打开 `http://127.0.0.1:4179/PhysForge/`：
  * 校验 `consoleErrors = []`、`pageErrors = []`、`failed404 = []`、`externalRequests = []`；
  * 打开 `ExportStudioDrawer` → 切换 `media` tab → 点击 WebM 录制开始/停止（验证 `createCanvasWebmRecorder` 不抛错并生成非空 `video/webm` Blob 下载）；
  * 校验退出前干净关闭静态服务器。

---

## 三、Wave 1 直接施工代码（V3.0 三大演说底座 + 三态工作台）

> **目标**：新增 `packages/live-math`、`packages/stage-3d`、`packages/director-deck`，增量扩展 `packages/sim-sdk/src/v3.ts`，重塑 `apps/web` Stage/Story/Studio 三态工作台与 `SpeakerView` 双屏路由，同时实现 KaTeX `.woff2` 字体瘦身与首屏主包 **`<= 320 KB` gzip**。

### 1. `packages/sim-sdk/src/v3.ts`（并在 `packages/sim-sdk/src/index.ts` 末尾加 `export * from './v3.js';`）

```ts
import type { ParamRecord, SimulationPluginV2 } from './index.js';

export type SemanticColorRole =
  | 'velocity'
  | 'acceleration'
  | 'force'
  | 'electric'
  | 'magnetic'
  | 'energy'
  | 'neutral';

export type StageTheme = 'obsidian' | 'daylight';

export type LiveFormulaToken =
  | { kind: 'latex'; tex: string }
  | {
      kind: 'var';
      paramKey: string;
      symbolTex: string;
      unit?: string;
      min: number;
      max: number;
      step: number;
      precision?: number;
      colorRole: SemanticColorRole;
      highlightTarget?: string;
    }
  | {
      kind: 'readout';
      telemetryKey: string;
      symbolTex: string;
      unit?: string;
      precision?: number;
      colorRole: SemanticColorRole;
    };

export interface LiveFormulaSpec {
  id: string;
  label: string;
  tokens: readonly LiveFormulaToken[];
}

export type BeatKind = 'concept-card' | 'stage-sim' | 'split-compare' | 'poe-challenge';

export interface CameraPreset {
  viewMode: 'perspective3d' | 'ortho2d';
  position?: readonly [number, number, number];
  target?: readonly [number, number, number];
  orthoAxis?: 'xy' | 'xz' | 'yz';
  zoom2D?: { scale: number; offsetX: number; offsetY: number };
  durationMs?: number;
}

export interface DirectorBeat {
  id: string;
  kind: BeatKind;
  title: string;
  caption?: string;
  speakerNotes?: string;
  modelId?: string;
  conceptBodyMd?: string;
  camera?: CameraPreset;
  simAction?: {
    reset?: boolean;
    playing?: boolean;
    timeScale?: number;
    targetParams?: ParamRecord;
    tweenMs?: number;
    pauseAtEvent?: string;
  };
  compareRightParams?: ParamRecord;
  poeQuestion?: {
    prompt: string;
    options: readonly string[];
    revealNote: string;
  };
  overlays?: {
    showFbd?: boolean;
    referenceFrame?: string;
    highlightTargets?: readonly string[];
    visibleLayers?: readonly string[];
    miniPlot?: { xChannel: string; yChannel: string } | null;
  };
  liveFormulaIds?: readonly string[];
  pinnedParams?: readonly string[];
}

export interface LessonDeck {
  schemaVersion: '3.0';
  id: string;
  title: string;
  subtitle?: string;
  theme?: StageTheme;
  tags: readonly string[];
  beats: readonly DirectorBeat[];
}

export interface Stage3DHandle {
  id: string;
  label: string;
  worldPosition: readonly [number, number, number];
  planeNormal?: readonly [number, number, number];
  hitRadiusWorld?: number;
  color?: string;
}

export interface Stage3DOverlayState {
  activeLayers: ReadonlySet<string>;
  showFbd: boolean;
  theme: StageTheme;
  highlightTargets: ReadonlySet<string>;
  activeFrameId: string;
}

export interface Stage3DMountContext {
  scene: unknown; // 运行时为 THREE.Scene，避免 sim-sdk 强绑定 three 类型
  propKit: unknown;
  setLabel: (id: string, textLatexOrHtml: string, worldPos: readonly [number, number, number]) => void;
  removeLabel: (id: string) => void;
  setOrthoProfileAxis: (axis: 'xy' | 'xz' | 'yz') => void;
}

export interface Stage3DAdapter<
  TParams extends ParamRecord = ParamRecord,
  TState = unknown
> {
  mount: (ctx: Stage3DMountContext) => void;
  sync: (state: TState, params: TParams, overlays: Stage3DOverlayState) => void;
  get3DHandles?: (state: TState, params: TParams) => Stage3DHandle[];
  on3DHandleDrag?: (
    handleId: string,
    worldPos: readonly [number, number, number],
    params: TParams
  ) => Partial<TParams>;
  dispose: () => void;
}

export interface SimulationPluginV3<
  TParams extends ParamRecord = ParamRecord,
  TState = unknown
> extends SimulationPluginV2<TParams, TState> {
  stageTier?: 'tier-s-3d' | 'tier-a-25d';
  createStage3DAdapter?: () => Promise<Stage3DAdapter<TParams, TState>>;
  liveFormulas?: readonly LiveFormulaSpec[];
  defaultBeats?: readonly DirectorBeat[];
}
```

### 2. 新建 3 个工作区包通用清单模板

每个新包 `packages/<pkg-name>/` 均按此配置创建（以 `packages/live-math` 为例）：

* `package.json`:
```json
{
  "name": "@physforge/live-math",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "dependencies": {
    "@physforge/sim-sdk": "workspace:*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc -p tsconfig.build.json"
  }
}
```
* `tsconfig.json` & `tsconfig.build.json`：完全复用 `packages/ai-copilot/tsconfig.json` 与 `packages/ai-copilot/tsconfig.build.json`。
* 依赖差异：
  * `@physforge/live-math`：`dependencies` 加 `"katex": "^0.19.1"`、`"react": "^19.3.1"`（或 `peerDependencies`）；`devDependencies` 加 `"@types/katex": "^0.16.8"`、`"@types/react": "^19.3.0"`。
  * `@physforge/stage-3d`：`dependencies` 加 `"three": "^0.187.0"`、`"camera-controls"`（执行 `pnpm --filter @physforge/stage-3d add camera-controls`）；`devDependencies` 加 `"@types/three": "^0.187.0"`。
  * `@physforge/director-deck`：`dependencies` 加 `"@physforge/sim-sdk": "workspace:*"`、`"zod": "^4.6.7"`。

### 3. `packages/live-math/src/` 核心施工代码

#### (1) `packages/live-math/src/palette.ts` — 全局物理语义色码总线

```ts
import type { SemanticColorRole } from '@physforge/sim-sdk';

export const SEMANTIC_COLOR_MAP: Readonly<Record<SemanticColorRole, string>> = {
  velocity: '#38BDF8',
  acceleration: '#F59E0B',
  force: '#FB7185',
  electric: '#A78BFA',
  magnetic: '#34D399',
  energy: '#FB923C',
  neutral: '#E2E8F0'
};

export function getSemanticColor(role: SemanticColorRole): string {
  return SEMANTIC_COLOR_MAP[role];
}
```

#### (2) `packages/live-math/src/formulaCompiler.ts` — 结构化 Token 转符号/数值 KaTeX 片段

```ts
import type { LiveFormulaSpec, LiveFormulaToken, ParamRecord } from '@physforge/sim-sdk';

export function formatFormulaValue(val: number, precision = 2): string {
  if (!Number.isFinite(val)) return '—';
  return val.toFixed(precision);
}

export function buildTokenLatex(
  token: LiveFormulaToken,
  params: ParamRecord,
  observables: Readonly<Record<string, number>>,
  numericMode: boolean
): string {
  if (token.kind === 'latex') return token.tex;
  if (token.kind === 'var') {
    if (!numericMode) return token.symbolTex;
    const raw = Number(params[token.paramKey] ?? token.min);
    const numStr = formatFormulaValue(raw, token.precision ?? 2);
    return token.unit ? `${numStr}\\,\\text{${token.unit}}` : numStr;
  }
  const obs = observables[token.telemetryKey];
  const valStr = typeof obs === 'number' ? formatFormulaValue(obs, token.precision ?? 2) : '—';
  if (!numericMode) return token.symbolTex;
  return token.unit ? `${valStr}\\,\\text{${token.unit}}` : valStr;
}

export function compileFormulaSpecLatex(
  spec: LiveFormulaSpec,
  params: ParamRecord,
  observables: Readonly<Record<string, number>>,
  numericMode: boolean
): string {
  return spec.tokens.map((t) => buildTokenLatex(t, params, observables, numericMode)).join(' ');
}

export function clampScrubbedParam(
  token: Extract<LiveFormulaToken, { kind: 'var' }>,
  current: number,
  deltaPx: number,
  fineMode: boolean
): number {
  const span = token.max - token.min;
  const sensitivity = fineMode ? 0.1 : 1.0;
  const raw = current + (deltaPx / 180) * span * sensitivity;
  const stepped = Math.round(raw / token.step) * token.step;
  const clamped = Math.max(token.min, Math.min(token.max, stepped));
  const prec = token.precision ?? 4;
  return Number(clamped.toFixed(prec));
}
```

#### (3) `packages/live-math/src/webAudioSynth.ts` — 纯 Web Audio API 微触感音效（默认静音）

```ts
export class PhysicsAudioSynth {
  private ctx: AudioContext | null = null;
  private enabled = false;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled && !this.ctx && typeof AudioContext !== 'undefined') {
      this.ctx = new AudioContext();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  playCollisionTick(intensity = 0.6): void {
    if (!this.enabled || !this.ctx) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(280 + intensity * 260, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.055);
    gain.gain.setValueAtTime(Math.min(0.18, 0.04 + intensity * 0.1), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.065);
  }

  dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
```

### 4. `packages/stage-3d/src/` 核心施工代码（单例 WebGL + 无缝切镜 + 3D 抓取 + 性能守卫）

#### (1) `packages/stage-3d/src/performanceGuard.ts`

```ts
export type QualityTier = 'high' | 'balanced' | 'classroom-lite';

export interface QualityProfile {
  readonly tier: QualityTier;
  readonly maxDpr: number;
  readonly shadowsEnabled: boolean;
  readonly allowTransmission: boolean;
}

const QUALITY_PROFILES: Readonly<Record<QualityTier, QualityProfile>> = {
  high: { tier: 'high', maxDpr: 1.5, shadowsEnabled: true, allowTransmission: true },
  balanced: { tier: 'balanced', maxDpr: 1.0, shadowsEnabled: true, allowTransmission: false },
  'classroom-lite': { tier: 'classroom-lite', maxDpr: 1.0, shadowsEnabled: false, allowTransmission: false }
};

export class PerformanceGuard {
  private tier: QualityTier = 'high';
  private slowDurationMs = 0;

  getProfile(): QualityProfile {
    return QUALITY_PROFILES[this.tier];
  }

  setTier(tier: QualityTier): void {
    this.tier = tier;
    this.slowDurationMs = 0;
  }

  recordFrameMs(frameDtMs: number): QualityTier {
    if (frameDtMs > 35.7) {
      // < 28 fps
      this.slowDurationMs += frameDtMs;
      if (this.slowDurationMs >= 1500) {
        this.slowDurationMs = 0;
        if (this.tier === 'high') this.tier = 'balanced';
        else if (this.tier === 'balanced') this.tier = 'classroom-lite';
      }
    } else {
      this.slowDurationMs = Math.max(0, this.slowDurationMs - frameDtMs * 0.5);
    }
    return this.tier;
  }
}
```

#### (2) `packages/stage-3d/src/seamlessOrthoCamera.ts` — 希区柯克 $3\text{D} \leftrightarrow 2\text{D}$ 无缝切镜

```ts
import * as THREE from 'three';
import CameraControls from 'camera-controls';

CameraControls.install({
  THREE: {
    Vector2: THREE.Vector2,
    Vector3: THREE.Vector3,
    Vector4: THREE.Vector4,
    Quaternion: THREE.Quaternion,
    Matrix4: THREE.Matrix4,
    Spherical: THREE.Spherical,
    Box3: THREE.Box3,
    Sphere: THREE.Sphere,
    Raycaster: THREE.Raycaster
  }
});

export type OrthoProfileAxis = 'xy' | 'xz' | 'yz';

export class SeamlessOrthoCamera {
  readonly perspCamera: THREE.PerspectiveCamera;
  readonly orthoCamera: THREE.OrthographicCamera;
  readonly controls: CameraControls;
  private activeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private viewMode: 'perspective3d' | 'ortho2d' = 'perspective3d';
  private frustumHeight = 6.0;
  private orthoAxis: OrthoProfileAxis = 'xy';
  private animFrameId = 0;
  private onWake?: () => void;

  constructor(domElement: HTMLElement, width: number, height: number, onWake?: () => void) {
    this.onWake = onWake;
    const aspect = Math.max(0.1, width / Math.max(1, height));
    this.perspCamera = new THREE.PerspectiveCamera(45, aspect, 0.05, 500);
    this.perspCamera.position.set(4.5, 3.2, 5.4);

    const halfH = this.frustumHeight * 0.5;
    const halfW = halfH * aspect;
    this.orthoCamera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.05, 500);
    this.orthoCamera.position.copy(this.perspCamera.position);

    this.activeCamera = this.perspCamera;
    this.controls = new CameraControls(this.perspCamera, domElement);
    this.controls.dampingFactor = 0.08;
    this.controls.mouseButtons.wheel = CameraControls.ACTION.DOLLY;
  }

  getActiveCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.activeCamera;
  }

  getViewMode(): 'perspective3d' | 'ortho2d' {
    return this.viewMode;
  }

  setOrthoAxis(axis: OrthoProfileAxis): void {
    this.orthoAxis = axis;
  }

  resize(width: number, height: number): void {
    const aspect = Math.max(0.1, width / Math.max(1, height));
    this.perspCamera.aspect = aspect;
    this.perspCamera.updateProjectionMatrix();

    const halfH = this.frustumHeight * 0.5;
    const halfW = halfH * aspect;
    this.orthoCamera.left = -halfW;
    this.orthoCamera.right = halfW;
    this.orthoCamera.top = halfH;
    this.orthoCamera.bottom = -halfH;
    this.orthoCamera.updateProjectionMatrix();
  }

  private getProfileDirection(axis: OrthoProfileAxis): THREE.Vector3 {
    if (axis === 'xz') return new THREE.Vector3(0, 1, 0.0001).normalize();
    if (axis === 'yz') return new THREE.Vector3(1, 0, 0);
    return new THREE.Vector3(0, 0, 1);
  }

  async toOrtho2D(axis = this.orthoAxis): Promise<void> {
    if (this.viewMode === 'ortho2d') return;
    cancelAnimationFrame(this.animFrameId);
    this.orthoAxis = axis;
    this.onWake?.();

    const target = new THREE.Vector3();
    this.controls.getTarget(target);
    const dir = this.getProfileDirection(axis);
    const startDist = this.perspCamera.position.distanceTo(target);
    this.frustumHeight = Math.max(1.5, 2 * startDist * Math.tan(THREE.MathUtils.degToRad(45 * 0.5)));

    // 1. 300ms 对齐剖面法向
    const alignPos = target.clone().addScaledVector(dir, startDist);
    await this.controls.setLookAt(alignPos.x, alignPos.y, alignPos.z, target.x, target.y, target.z, true);

    // 2. 550ms Dolly Zoom 压平 fov 45° -> 3.5°
    await new Promise<void>((resolve) => {
      const startMs = performance.now();
      const durationMs = 550;
      const step = (now: number) => {
        const rawT = Math.min(1, (now - startMs) / durationMs);
        const easeT = rawT < 0.5 ? 2 * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 2) / 2;
        const fov = THREE.MathUtils.lerp(45, 3.5, easeT);
        const d = this.frustumHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fov * 0.5)));
        this.perspCamera.fov = fov;
        this.perspCamera.updateProjectionMatrix();
        const p = target.clone().addScaledVector(dir, d);
        void this.controls.setLookAt(p.x, p.y, p.z, target.x, target.y, target.z, false);
        this.onWake?.();

        if (fov <= 3.6 || rawT >= 1) {
          // 无缝切换至 OrthographicCamera 且滚轮切为 ZOOM
          this.orthoCamera.position.copy(this.perspCamera.position);
          this.orthoCamera.quaternion.copy(this.perspCamera.quaternion);
          this.orthoCamera.zoom = 1;
          this.orthoCamera.updateProjectionMatrix();
          this.activeCamera = this.orthoCamera;
          this.controls.camera = this.orthoCamera;
          this.controls.mouseButtons.wheel = CameraControls.ACTION.ZOOM;
          this.controls.touches.two = CameraControls.ACTION.TOUCH_ZOOM_TRUCK;
          this.viewMode = 'ortho2d';
          resolve();
          return;
        }
        this.animFrameId = requestAnimationFrame(step);
      };
      this.animFrameId = requestAnimationFrame(step);
    });
  }

  async toPerspective3D(): Promise<void> {
    if (this.viewMode === 'perspective3d') return;
    cancelAnimationFrame(this.animFrameId);
    this.onWake?.();

    const target = new THREE.Vector3();
    this.controls.getTarget(target);
    const dir = this.orthoCamera.position.clone().sub(target).normalize();
    const effHeight = this.frustumHeight / Math.max(0.1, this.orthoCamera.zoom);
    const startDist = effHeight / (2 * Math.tan(THREE.MathUtils.degToRad(3.6 * 0.5)));

    this.perspCamera.fov = 3.6;
    this.perspCamera.position.copy(target).addScaledVector(dir, startDist);
    this.perspCamera.updateProjectionMatrix();
    this.activeCamera = this.perspCamera;
    this.controls.camera = this.perspCamera;
    this.controls.mouseButtons.wheel = CameraControls.ACTION.DOLLY;
    this.controls.touches.two = CameraControls.ACTION.TOUCH_DOLLY_TRUCK;
    this.viewMode = 'perspective3d';

    await new Promise<void>((resolve) => {
      const startMs = performance.now();
      const durationMs = 550;
      const step = (now: number) => {
        const rawT = Math.min(1, (now - startMs) / durationMs);
        const easeT = rawT < 0.5 ? 2 * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 2) / 2;
        const fov = THREE.MathUtils.lerp(3.6, 45, easeT);
        const d = effHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fov * 0.5)));
        this.perspCamera.fov = fov;
        this.perspCamera.updateProjectionMatrix();
        const p = target.clone().addScaledVector(dir, d);
        void this.controls.setLookAt(p.x, p.y, p.z, target.x, target.y, target.z, false);
        this.onWake?.();
        if (rawT >= 1) {
          resolve();
          return;
        }
        this.animFrameId = requestAnimationFrame(step);
      };
      this.animFrameId = requestAnimationFrame(step);
    });
  }

  dispose(): void {
    cancelAnimationFrame(this.animFrameId);
    this.controls.dispose();
  }
}
```

#### (3) `packages/stage-3d/src/dragPlaneRaycaster.ts` — 3D 约束平面射线直接抓取（`>= 44px` 触控热区 + 镜头锁止）

```ts
import * as THREE from 'three';
import type CameraControls from 'camera-controls';
import type { Stage3DHandle } from '@physforge/sim-sdk';

export class DragPlaneRaycaster {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly dragPlane = new THREE.Plane();
  private readonly hitPoint = new THREE.Vector3();
  private activeHandle: Stage3DHandle | null = null;

  hitTest(
    clientX: number,
    clientY: number,
    domRect: DOMRect,
    camera: THREE.Camera,
    handles: readonly Stage3DHandle[]
  ): Stage3DHandle | null {
    if (handles.length === 0) return null;
    this.ndc.set(
      ((clientX - domRect.left) / Math.max(1, domRect.width)) * 2 - 1,
      -((clientY - domRect.top) / Math.max(1, domRect.height)) * 2 + 1
    );
    this.raycaster.setFromCamera(this.ndc, camera);

    const sphere = new THREE.Sphere();
    let best: Stage3DHandle | null = null;
    let bestDist = Infinity;

    for (const h of handles) {
      const center = new THREE.Vector3(h.worldPosition[0], h.worldPosition[1], h.worldPosition[2]);
      // 将屏幕 24px 半径（48px 直径 >= 44px 触控热区）折算为世界空间最小抓取半径
      const camDist = camera.position.distanceTo(center);
      const minWorldR = Math.max(0.18, camDist * 0.032);
      sphere.set(center, Math.max(minWorldR, h.hitRadiusWorld ?? 0));
      if (this.raycaster.ray.intersectsSphere(sphere)) {
        const d = this.raycaster.ray.origin.distanceTo(center);
        if (d < bestDist) {
          bestDist = d;
          best = h;
        }
      }
    }
    return best;
  }

  beginDrag(handle: Stage3DHandle, camera: THREE.Camera, controls: CameraControls): void {
    this.activeHandle = handle;
    controls.enabled = false;
    const normal = handle.planeNormal
      ? new THREE.Vector3(handle.planeNormal[0], handle.planeNormal[1], handle.planeNormal[2]).normalize()
      : new THREE.Vector3(0, 0, 1);
    const point = new THREE.Vector3(handle.worldPosition[0], handle.worldPosition[1], handle.worldPosition[2]);
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, point);
  }

  updateDrag(
    clientX: number,
    clientY: number,
    domRect: DOMRect,
    camera: THREE.Camera
  ): { handleId: string; worldPos: readonly [number, number, number] } | null {
    if (!this.activeHandle) return null;
    this.ndc.set(
      ((clientX - domRect.left) / Math.max(1, domRect.width)) * 2 - 1,
      -((clientY - domRect.top) / Math.max(1, domRect.height)) * 2 + 1
    );
    this.raycaster.setFromCamera(this.ndc, camera);
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.hitPoint)) {
      return null;
    }
    return {
      handleId: this.activeHandle.id,
      worldPos: [this.hitPoint.x, this.hitPoint.y, this.hitPoint.z]
    };
  }

  endDrag(controls: CameraControls): void {
    this.activeHandle = null;
    controls.enabled = true;
  }
}
```

#### (4) `packages/stage-3d/src/stage3dPool.ts` — 全局唯一 `WebGLRenderer` + `CSS2DRenderer` 单例池 + 休眠/降级

写手实现 `Stage3DPool` 单例类时必须锁定以下结构：
* 模块级唯一实例 `let globalPool: Stage3DPool | null = null;`；
* `attachTo(hostEl)`：将唯一 `renderer.domElement` 与 `labelRenderer.domElement`（强制 `pointerEvents = 'none'`、`position = 'absolute'`、`inset = '0'`、包裹在 `isolation = 'isolate'` 容器）挂载到当前舞台容器；
* `CSS2DRenderer` 与 `RoomEnvironment` 从 `three/examples/jsm/renderers/CSS2DRenderer.js` 与 `three/examples/jsm/environments/RoomEnvironment.js` 导入；
* `mountAdapter(adapter)`：先递归 `disposeObject3D(this.modelRoot)` 释放全部 `BufferGeometry`、`Material`、`Texture` 与 `CSS2DObject.element.remove()`，再挂载新适配器；
* `controls.addEventListener('rest', ...)` 配合 `isSimPlaying` 实现静止零耗电休眠；`wake()` 即刻重启 `requestAnimationFrame`；
* 监听 `renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); onContextLost(); })`，通知上层切回 V2.0 2D Canvas 渲染器！

#### (5) `packages/stage-3d/src/proceduralPropKit.ts` — Wave 1 核心程序化 3D 道具库

封装：`createBeveledBlock`、`createInclinedPlane`、`createHelicalSpring`（按形变长度动态更新螺旋 `TubeGeometry`）、`createConveyorBelt`、`createMagneticBox`（半透明盒 + `InstancedMesh` 磁感线箭头）、`createVector3DArrow`（柱体 + 锥头 + 正交虚线投影，受 `SEMANTIC_COLOR_MAP` 驱动）。

### 5. `packages/director-deck/src/` 核心施工代码

1. **`deckSchema.ts`**：基于 `zod@^4.6.7` 定义 `LessonDeckSchema` 与 `DirectorBeatSchema`（校验 4 类 `BeatKind`、`camera`、`simAction`、`overlays`），提供 `validateLessonDeck(raw)`。
2. **`deckChannel.ts`**：封装 `BroadcastChannel('physforge-stage-sync')`，定义消息联合类型：
   * `{ type: 'SYNC_STATE'; deckId: string; beatIndex: number; totalBeats: number; beat: DirectorBeat; theme: StageTheme; blackout: boolean; elapsedSec: number }`
   * `{ type: 'COMMAND'; action: 'NEXT' | 'PREV' | 'GOTO' | 'BLACKOUT' | 'TOGGLE_2D' | 'TOGGLE_FBD' | 'SET_PARAM'; beatIndex?: number; paramKey?: string; paramValue?: number | boolean | string }`
3. **`snapshotComposer.ts`**：实现 `captureCurrentBeat(input)`——从当前 `modelId`、当前 `params`、当前 `activeLayers`、`activeFrameId`、`view3dEnabled`、`autoFbdEnabled` 与可选 3D 相机位姿自动生成合法 `DirectorBeat` 插入当前 `LessonDeck`，并持久化至 `@physforge/workspace-vault`。
4. **`deckRunner.ts`**：纯时间/参数缓动插值器 `interpolateParams(from, to, progress)`（线性插值数值字段、布尔/枚举在终点切换）+ 临界事件冻结检测 `shouldPauseForBeat(events, beat)`。

### 6. `apps/web` 三态工作台、双屏路由与字体瘦身

1. **`apps/web/vite.config.ts` 新增 `katexWoff2OnlyPlugin()`**：
```ts
function katexWoff2OnlyPlugin(): Plugin {
  return {
    name: 'physforge-katex-woff2-only',
    transform(code, id) {
      if (!id.replace(/\\/g, '/').includes('katex/dist/katex')) return null;
      // 仅保留 woff2 字体源，剔除 .woff 与 .ttf 声明（节省约 1.2 MB）
      return {
        code: code.replace(/,?\s*url\([^)]+\.(?:woff|ttf)\)\s*format\(["'][^"']+["']\)/gi, ''),
        map: null
      };
    }
  };
}
```
2. **`apps/web/src/store/useClassroomStore.ts` 增量改造**：
   * 移除第 15 行静态 `import { emBoundedMagneticFieldPlugin }`；启动初始化提供轻量化 `LOADING_PLACEHOLDER_PLUGIN`（零物理计算空壳），在 `App.tsx` 首帧挂载后立刻 `void store.selectPlugin('builder-composite-em-field')` 异步载入（确保首屏主包体积进一步下降）。
   * 新增状态：`appMode: 'stage' | 'story' | 'studio'`（默认 `'studio'` 还是 `'stage'`？蓝图定义默认 `'stage'`，但必须注意：**Wave 1 E2E 与 V2 既有测例若期望先看 Studio 控件或支持切态，可默认 `'stage'` 并在顶栏/浮窗显眼提供 `1 Stage / 2 Story / 3 Studio` 胶囊，同时保证切换至 `studio` 后 V2 全功能零退化**）、`blackout: boolean`、`miniPlotOpen: boolean`、`soundEnabled: boolean`、`viewMode3d: 'perspective3d' | 'ortho2d'`、`activeDeck: LessonDeck`、`activeBeatIndex: number`。
3. **`apps/web/src/components/StageHudShell.tsx` + `StoryScrollShell.tsx` + `SpeakerViewPage.tsx`**：
   * `StageHudShell`：全屏舞台、左上角悬浮毛玻璃 `LiveFormulaOverlay`（调用 `@physforge/live-math`，带 `123` 符号/数值切换与悬停共振）、右下角 2–4 个 `pinnedParams` 胶囊、底部可自动淡化导演条（含 `📸 捕获为新节拍` 按钮）、右上角折叠迷你示波器胶囊（`G` 键）、`poe-challenge` 预测遮罩、`split-compare` 左右双实例渲染与 `B` 键黑屏遮罩。
   * `StoryScrollShell`：左 34% 流式 Markdown/KaTeX 卡片 + IntersectionObserver 滚动驱动切拍、右 66% 粘性固定舞台。
   * `SpeakerViewPage`：当 `window.location.hash === '#/speaker'` 或 `?view=speaker` 时在 `App.tsx` 懒加载渲染，通过 `BroadcastChannel('physforge-stage-sync')` 同步翻页、读秒、提词与全参数滑块。

### 7. Wave 1 验收门禁实测命令（PowerShell 5.1 安全版）

```powershell
pnpm typecheck; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
pnpm test; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
pnpm verify:packs; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
pnpm verify:scenes; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
pnpm verify:vault; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
pnpm build; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```
* 核对 `apps/web/dist/assets/index-*.js` gzip **$\le 320\text{ KB}$**，且不含 `CameraControls`、`WebGLRenderer`、`RoomEnvironment`、`CSS2DRenderer`、`OrbitControls`、`mathjs`、`papaparse`、`rapier_wasm2d`、`@excalidraw/excalidraw`、`physforge-workspace-vault`；
* 核对 `apps/web/dist/assets/` 内 **0 个 `KaTeX_*.woff` 与 `KaTeX_*.ttf`**（仅存在 `.woff2`）；
* Playwright 无头 Chrome 实测：Stage/Story/Studio 三态切换、`D` 键 `toOrtho2D`/`toPerspective3D`、活公式拖拽调参 + `123` 数值切换、`BroadcastChannel` 双屏同步、`webglcontextlost` 2D 兜底无报错。

---

## 四、Wave 2 ~ Wave 5 施工接续规范（里程碑节奏）

| 轮次 | 施工重点 | 总控验看卡点 |
| --- | --- | --- |
| **Wave 2（开箱验看里程碑）** | 为 **B1、E04、M06、B3、M10、E07** 实现 `createStage3DAdapter()` 异步 3D PBR 适配器 + 活公式 + 5 拍默认分镜；产出 `content/decks/` 下 2 套示范课例 JSON。 | **完成后立即暂停交由用户浏览器开箱验看**：6 单元 3D 光影、$3\text{D}\leftrightarrow 2\text{D}$ 切镜、3D 抓取与连续切 20 次 WebGL Context 恒为 `1` 通过。 |
| **Wave 3（22 Tier S 完工）** | 完成剩余 16 个 Tier S 3D 单元（含把已有 `E10`/`S01` 纳入统一 `Stage3DPool`）。 | Playwright 遍历全 22 个 Tier S 单元零报错、双主题切换、Canvas 非空白、WebGL 单例计数 `=== 1`。 |
| **Wave 4（21 Tier A 2.5D 升级）** | 全 21 个 2.5D 单元接入语义色码、`zoom2D` 运镜、活公式与默认分镜；打磨 `X01/X02` 仪器放大镜与 `C03` 量子波包。 | 全库 43/43 单元 100% 具备三态体验、`LiveFormulaSpec` 与默认 `DirectorBeat[]`。 |
| **Wave 5（AI 导演与离线封板）** | `ai-copilot` 上线 `LessonDeck` 生成校验、`singlefile-exporter` 支持 `--mode=stage|story --deck-file=...`（2.5D `< 2.5 MB`, 3D `< 3.8 MB`）、6 套示范课、打 `v3.0.0` Release。 | 离线 3D 单文件 HTML 断网 `file://` 双击运行零外网请求、翻页笔与活公式 100% 正常；全仓门禁全绿。 |
