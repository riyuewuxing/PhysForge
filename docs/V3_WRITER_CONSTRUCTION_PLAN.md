# PhysForge V3.0 写手可执行施工方案与原子级 PR 任务单（GPT-6.2 Sol 落地版）

> **权威定位**：本文件由本地总控（Antigravity）依据 [V3_ARCHITECT_BLUEPRINT_AND_HARD_CORES.md](file:///d:/project%20code/44-PhysForge/docs/v3-specs/V3_ARCHITECT_BLUEPRINT_AND_HARD_CORES.md) 对照仓库 **`main@b5e3ae4`（V2.0.2 Wave A–C 已合入基线）** 真实源码逐文件审校编制，**正式替代**早期基于 `c4dbcfa` 的旧版 43 单元全量 3D 草案。  
> **配套宪法**：[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md) ｜ **写手交接日志**：[WRITER_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_HANDOFF_LOG.md) ｜ **总控交接日志**：[ARCHITECT_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/ARCHITECT_HANDOFF_LOG.md)

---

## 一、总控对 `main@b5e3ae4` 本地源码的实盘纠偏（开工必读）

结合当前实际仓库代码与配置文件，写手（GPT-6.2 Sol）在开写任何 PR 前必须严格遵循以下 **6 项实盘裁定**：

1. **包架构瘦身裁定（零新增工作区包、零新增外部 npm 依赖）**：
   - 不采用旧草案中的 `packages/stage-3d`、`packages/director-deck`、`packages/live-math` 三包拆法，亦**无需安装 `camera-controls` 或任何新依赖**。
   - **纯逻辑与类型**落在 `packages/sim-sdk/src/`（`v3Types.ts` + `storyRunner.ts`），经 `packages/sim-sdk/src/index.ts` 统一导出（`packages/sim-sdk/package.json` 仅暴露 `"."`）。
   - **表现层模块**落在 `apps/web/src/presentation/`（`presenterSync.ts`、`liveFormulaEngine.ts`、`PresenterView.tsx` 等）与 `apps/web/src/stage/`（`cameraMorphController.ts`、`spatialMaterials.ts`），保持独立 `React.lazy()` / 动态 `import()` chunk，确保首屏主入口 `< 350 KB` gzip 且非 3D 页 0 字节 `three` 泄漏。
2. **TypeScript 严格配置与 ESM 导入裁定**：
   - [tsconfig.base.json](file:///d:/project%20code/44-PhysForge/tsconfig.base.json) 开启了 `"strict": true` 与 **`"noUncheckedIndexedAccess": true`**。所有索引读取（如 `this.deck.beats[index]`、`fromParams[key]`）必须显式判空或 `?? null`；
   - `packages/` 与 `apps/web/src/` 内所有相对路径导入**必须保留 `.js` 扩展名**（如 `import type { StoryDeck } from './v3Types.js';`），否则 `packages/sim-sdk/tsconfig.build.json` 与 Node/Vitest 解析会不一致；
   - `SimulationPluginV3<TParams extends ParamRecord = ParamRecord, TState = unknown>` 必须继承 `SimulationPluginV2<TParams, TState>`，保持**先 `TParams` 后 `TState`**的泛型顺序。
3. **三态模式与现有 `App.tsx` / `useClassroomStore.ts` / `visual-audit.mjs` 兼容裁定**：
   - [useClassroomStore.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/store/useClassroomStore.ts) 当前持有 `fullscreenPresentation: boolean` 与 `bigScreenMode: boolean`；新增 `appMode: 'studio' | 'stage' | 'story'` 时必须保持 **`fullscreenPresentation === (appMode !== 'studio')`** 同步（`toggleFullscreenPresentation` 在 `studio` ↔ `stage` 间切换），并**100% 保留** [App.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/App.tsx#L618-L641) 现有全部 `data-testid`（`btn-fullscreen-speech`、`fullscreen-title`、`fullscreen-formula`、`fullscreen-controls`、`btn-play-pause`、`btn-reset`、`btn-view-3d-fullscreen`、`btn-exit-fullscreen-speech`），确保 Wave A–C 审计零回退。
   - 快捷键分态路由：`studio` 态完全保留现有 `F`（进 `stage`）、`B`（大屏字体）、`P`（POE 遮罩）、`1-9`（预设）、`Space`（运行/暂停）、`R`/`S`；进入 `stage` / `story` 态后激活演说快捷键（`ArrowRight`/`PageDown`、`ArrowLeft`/`PageUp`、`B`/`.` 黑屏遮罩、`F` 定格、`M` 切镜、`Esc` 退回 `studio`）。
4. **60fps 零 React 重渲染接线裁定**：
   - [SimulationStage.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/SimulationStage.tsx) 在 `requestAnimationFrame` 内维护 `simStateRef` 与 `latestRef`。`StoryRunner.tick(nowMs, observables)` 必须挂在 `SimulationStage` 的 `rAF` 循环中运行；缓动期间参数先写入 `tweenedParamsRef` / `latestRef.current.params` 直接驱动物理步进与重绘，以节流（≤ 15Hz）或 Beat 落点同步回 Zustand，严禁每帧 `setState` 触发 React 整树重渲染。
5. **Vanilla Three.js 与显存零泄漏裁定**：
   - [ThreeStage.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/ThreeStage.tsx) 已实现 `RoomEnvironment`、`CSS2DRenderer`、`PerformanceGuard` 与 `disposeGroupChildren()` + `renderer.dispose()` + `renderer.forceContextLoss()`。V3 Wave 3–4 必须沿用同一套资源释放规范（含 `PMREMGenerator` / `WebGLRenderTarget` 释放与 `webglcontextlost` 回退）。
6. **Step 0 实盘定位出的在线 AI（BYOK）真缺口**：
   - 核查 [byokClient.ts](file:///d:/project%20code/44-PhysForge/packages/ai-copilot/src/byokClient.ts#L142-L150) 发现：`buildByokSystemPrompt()` 仅传给模型 `modelId (title)`，**完全未提供各模型 `paramSchema` 字段名、类型、枚举值与数值范围**；
   - 核查 [refiner.ts](file:///d:/project%20code/44-PhysForge/packages/ai-copilot/src/refiner.ts#L50-L74) 发现：`auditSceneHeadless()` 会**静默放行模型幻觉出的未知参数键**，且 `errors` 反馈未附带目标模型的真实 `paramSchema` 提示，导致 3 轮自修正难以收敛；
   - 核查 [AiCopilotDrawer.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/AiCopilotDrawer.tsx#L124-L167) 缺少常见兼容提供商快捷模板（OpenAI / DeepSeek / 硅基流动 / Gemini OpenAI-compat）、“测试连通性”按钮与错误码引导提示。

---

## 二、GitHub PR 协作与门禁铁律（GPT-6.2 Sol 必守）

1. **分支隔离**：严禁直推 `main`。每个原子 PR 单独拉短分支，**单 PR 修改文件数 $\le 12$ 个**。
2. **严禁触碰清单**：
   - 严禁修改或削弱既有 `simulations/*/engine.ts` 物理方程、任何 `engine.test.ts` 守恒阈值、`coordinate-alignment.test.ts` 与 `wave-c-interaction.test.ts` 门禁；
   - 严禁使用 `as any`、`@ts-ignore`、`eslint-disable`、`skip`/`only`、`eval`/`new Function`、`Math.random()` 或任何外网 CDN。
3. **PR 提交前必跑本地/CI 自检命令**：
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm verify:packs && pnpm verify:scenes && pnpm verify:vault`
   - `VITE_BASE_PATH=/PhysForge/ pnpm build`（核验 CI 主包 `< 350 KB` gzip 与重型依赖零泄漏）
   - `pnpm export:singlefile -- --model=em-bounded-magnetic-field`
4. **PR 描述模板**：必须附“① 修改文件清单；② 新增/更新单测列表；③ 红线与包体自检结果；④ 存在的局限或待本地实机核验项”。

---

## 三、Step 0 + Wave 1 原子级 PR 任务单（可直接派发给 GPT-6.2 Sol）

---

### Task PR-0（前置闭环）：`@physforge/ai-copilot` 在线 BYOK Schema 感知与连通性加固

* **分支名**：`fix/v3-step0-online-byok`
* **目标**：解决在线 LLM 调用因缺少 `paramSchema` 信息而幻觉参数键的问题，并补齐前端连通性自检与错误码诊断。
* **允许改动文件（≤ 6 个）**：
  1. `packages/ai-copilot/src/byokClient.ts`
  2. `packages/ai-copilot/src/refiner.ts`
  3. `packages/ai-copilot/src/byokClient.test.ts`
  4. `packages/ai-copilot/src/ai-copilot.test.ts`
  5. `apps/web/src/components/AiCopilotDrawer.tsx`
* **具体施工要求**：
  1. **Schema 摘要注入（`byokClient.ts`）**：新增纯函数 `formatModelSchemaHint(modelId)` 与轻量目录摘要，在 `buildByokSystemPrompt()` 中引导模型优先匹配合法 `modelId`，并在 `requestByokSceneCandidate()` 的 `feedback` 轮或通过辅助提示提供常见关键参数格式要求（严禁将完整 43 模型大 JSON 塞爆 token，保持紧凑摘要，如枚举值列表与单位/范围）。
  2. **未知键审计与自修正回馈（`refiner.ts`）**：在 `auditSceneHeadless()` 校验 `scene.params` 时，检测并拒绝不存在于 `plugin.paramSchema` 中的未知键（`Unknown param "..."`），并在 `errors` 中明确附上该 `modelId` 合法的参数签名清单（`key: number[min..max] | select(a|b) | boolean`），使 Round 2–3 自修正真正可收敛。
  3. **前端连通性自检与预设模板（`AiCopilotDrawer.tsx`）**：
     - 增加一键填充提供商快捷芯片（仅填充默认 `baseUrl` 与推荐 `model`，**严禁**预填或持久化任何 `apiKey` 到 `localStorage`）；
     - 新增“测试连通性”按钮（调用 `fetchWithTimeoutAndCorsHint` 请求 `/models` 或最小 `max_tokens: 8` 探测），清晰区分 `TIMEOUT` / `CORS_OR_NETWORK` / `HTTP_ERROR` / `INVALID_JSON` 提示并保留原 `data-testid` 不变。
  4. **单测补强**：在 `byokClient.test.ts` 与 `ai-copilot.test.ts` 补齐“未知参数键被拦截并返回 Schema 提示 → Round 2 修正通过”与连通性探测异常分类测试。
* **验收标准**：`pnpm typecheck && pnpm test` 全绿；`AiCopilotDrawer` 保持 lazy chunk 不进主包；不改变现有离线三层路由行为。

---

### Task PR-1A（Wave 1A）：`packages/sim-sdk` V3 增量契约与 `StoryRunner` 纯内核

* **分支名**：`feat/v3-w1a-story-runner`
* **目标**：落地 V3 演说类型系统与零 DOM 依赖的 `StoryRunner` 分镜状态机。
* **允许改动文件（≤ 5 个）**：
  1. `packages/sim-sdk/src/v3Types.ts`（新建）
  2. `packages/sim-sdk/src/storyRunner.ts`（新建）
  3. `packages/sim-sdk/src/storyRunner.test.ts`（新建）
  4. `packages/sim-sdk/src/index.ts`（导出 `./v3Types.js` 与 `./storyRunner.js`）
* **必须复用底座代码**：严格对照 [V3_ARCHITECT_BLUEPRINT_AND_HARD_CORES.md](file:///d:/project%20code/44-PhysForge/docs/v3-specs/V3_ARCHITECT_BLUEPRINT_AND_HARD_CORES.md) 第二节与第三节硬骨头 #1 实现，并确保：
  - 所有相对导入带 `.js` 扩展名；
  - 通过 `noUncheckedIndexedAccess` 严格检查；
  - `SimulationPluginV3<TParams, TState>` 继承 `SimulationPluginV2<TParams, TState>`；
  - 新增 `isSimulationPluginV3()` 类型守卫（不破坏现有 `isSimulationPluginV2()`）。
* **单测要求（`storyRunner.test.ts`）**：
  - 覆盖 `next()` / `prev()` / `goTo()` 边界；
  - 覆盖数值参数 `easeInOutCubic` 插值及快速连按中断前一个 Tween 并从当前值衔接；
  - 覆盖非数值参数（`string`/`boolean`）立即切换；
  - 覆盖 `autoFreeze` 三种操作符（`>=`、`<=`、`cross`）精准触发一次暂停与 `onAutoFreezeTriggered` 回调。
* **验收标准**：`pnpm --filter @physforge/sim-sdk build` 与 `pnpm typecheck && pnpm test` 全绿，现有 43 个 V2 插件零改动零报错。

---

### Task PR-1B（Wave 1B）：三态演说壳（`studio / stage / story`）与灵动岛胶囊

* **分支名**：`feat/v3-w1b-tri-mode-shell`
* **目标**：在不破坏 Wave A/B/C 任何 UI 与测试断言的前提下，将工作台升级为 `studio / stage / story` 三态运行壳并接入 `StoryRunner`。
* **允许改动文件（≤ 8 个）**：
  1. `apps/web/src/store/useClassroomStore.ts`
  2. `apps/web/src/App.tsx`
  3. `apps/web/src/components/SimulationStage.tsx`
  4. `apps/web/src/presentation/StoryStageHud.tsx`（新建，演说态底部字幕条、进度点、黑屏遮罩与极简胶囊，建议与 `StoryRunner` 控制条懒加载或轻量拆分）
  5. `apps/web/src/index.css`
  6. `apps/web/src/presentation/triMode.test.ts`（新建，验证状态流转与热键作用域纯逻辑）
* **关键兼容与接线细节**：
  1. **状态同步**：`useClassroomStore` 新增 `appMode: 'studio' | 'stage' | 'story'`、`isBlackout: boolean`、`activeDeckId: string | null`、`storyBeatIndex: number`、`autoFreezeBadge: string | null`，并保持 `fullscreenPresentation` 与 `appMode !== 'studio'` 严格一致。
  2. **保留 `data-testid`**：`stage` 与 `story` 态下必须继续保留 `btn-fullscreen-speech`、`fullscreen-title`、`fullscreen-formula`、`fullscreen-controls`、`btn-play-pause`、`btn-reset`、`btn-view-3d-fullscreen`、`btn-exit-fullscreen-speech`，并在胶囊中增量增加“分镜/自由”切换与“副屏控制台”入口按钮。
  3. **rAF 接线（严禁 60fps `setState`）**：`SimulationStage` 接收可选 `storyRunnerRef` 或内部管理 `StoryRunner` 实例，在现有 `loop` 内先调用 `storyRunner.tick(nowMs, latestObservables)`；`applyParamsImperative` 仅更新 `latestRef.current.params` 与内部临时引用驱动引擎，节流（≤ 15Hz）或 Beat 完成时再同步 store UI 展示。
  4. **快捷键作用域**：`studio` 下保留 `F/B/P/Space/R/S/1-9` 原行为；`stage/story` 下按翻页笔铁律绑定 `ArrowRight`/`PageDown`/`ArrowLeft`/`PageUp`/`Space`/`B`/`.`/`F`/`M`/`Escape`，并在输入控件聚焦或 `annotationOpen`/`commandPaletteOpen` 时屏蔽。
* **验收标准**：`pnpm typecheck && pnpm test && pnpm build` 全绿；主包 `< 350 KB` gzip；`pnpm test:e2e:subpath` 全绿。

---

### Task PR-1C（Wave 1C）：双屏 `PresenterSyncBridge` + `?mode=presenter` + 3 套示范课 `StoryDeck`

* **分支名**：`feat/v3-w1c-presenter-decks`
* **目标**：实现零后端双屏同步提词控制台与首批 3 套高中物理示范课 `StoryDeck`。
* **允许改动文件（≤ 10 个）**：
  1. `apps/web/src/presentation/presenterSync.ts`（新建，照硬骨头 #2 落盘）
  2. `apps/web/src/presentation/presenterSync.test.ts`（新建）
  3. `apps/web/src/presentation/PresenterView.tsx`（新建，通过 `React.lazy` 懒加载，含大字提词讲稿、下一拍预告、计时器、参数微调滑块、激光笔轨迹发射、黑屏/切镜/翻页遥控）
  4. `apps/web/src/App.tsx`（识别 `?mode=presenter&session=<id>` 时渲染 `<Suspense><LazyPresenterView /></Suspense>`，不挂载主仿真画布与 WebGL；主屏 `stage/story` 下接入 `PresenterSyncBridge` 发送 15Hz 快照与接收遥控指令，支持大屏激光红点叠加）
  5. `simulations/em-induction-double-rod/storyDecks.ts` & `plugin.ts`（E04 双杆电磁感应：`共速稳定` / `能量转化` 自动定格分镜）
  6. `simulations/em-bounded-magnetic-field/storyDecks.ts` & `plugin.ts`（B1 磁聚焦与缩放圆分镜）
  7. `simulations/mech-vertical-circular/storyDecks.ts` & `plugin.ts`（M06 竖直圆周最高点脱轨临界定格分镜）
  8. `scripts/e2e-subpath-and-export.mjs`（新增 `?mode=presenter` 双页面 `BroadcastChannel` 同步冒烟检查）
* **关键兼容细节**：
  - `buildPresenterWindowUrl` 必须使用 `new URL(window.location.href)` 并删除陈旧 `preset`，天然兼容 `/` 与 `/PhysForge/`；
  - 3 套 `StoryDeck` 内所有 `paramPatch` 与 `autoFreeze.observableKey` 必须经由 `StoryRunner` + 真实引擎在单测或验证脚本中跑通，严禁臆造不存在的 `observableKey`！
* **验收标准**：`pnpm typecheck && pnpm test && pnpm build && VITE_BASE_PATH=/PhysForge/ pnpm test:e2e:subpath` 全绿；主入口 `< 350 KB` gzip 且 `PresenterView` 隔离在异步 chunk。

---

## 四、Wave 2 – Wave 4 后续原子 PR 规划总表（Wave 1 验收后按序派发）

| 波次 | PR 编号 | 分支名 | 核心交付范围（单 PR ≤ 12 文件） | 必达门禁 |
| :--- | :--- | :--- | :--- | :--- |
| **Wave 2** | **PR-2A** | `feat/v3-w2a-live-formula-engine` | 落地 `apps/web/src/presentation/liveFormulaEngine.ts` + 浮层 HUD + `.pf-live-var` 触屏防误触样式 + `Stage/Story` 右上活公式卡接线 | 拖动期间 **0 次 KaTeX DOM 重建**；`0.25×`/`0.1×` 变速档 + 双击复位单测通过；主包 `< 350 KB` |
| **Wave 2** | **PR-2B** | `feat/v3-w2b-live-formula-specs` | 分批（≤ 12 文件/PR，可拆 `2B-1`/`2B-2`）为 15 个高频模型（B1–B3, M04–M06, M10, E01–E05, W01, O01, S02）配置 `liveFormulas` 并加全覆盖单测校验 `bindings` 与 `paramSchema` 一致性 | 15 模型活公式全部通过自动化参数回写校验；无配置模型优雅回退只读 KaTeX |
| **Wave 3** | **PR-3A** | `feat/v3-w3a-morph-core` | 落地 `apps/web/src/stage/cameraMorphController.ts` + `spatialMaterials.ts` + 跨管线 `project3DToScreen` 对齐桥 + `CameraMorphController` 几何投影单测 | 压平终点 `morphT=1` 正交对齐误差 `< 0.5 px`；动态 `near/far` 无 Z-fighting；主包 0 字节 Three.js 泄漏 |
| **Wave 3** | **PR-3B** | `feat/v3-w3b-flagship-3d-p0` | 实装首批 3 旗舰（**E10、E04、B1**）3D 实体与 `3D ↔ 2D` 一键压平切镜（压平后自动对齐 2D Auto-FBD 与包络圆） | 切离 3D 严格 `dispose` + `forceContextLoss()`；本地总控 `visual-audit` 3D 态 vs 压平态双图实看通过 |
| **Wave 4** | **PR-4A** | `feat/v3-w4a-flagship-3d-p1` | 实装剩余 3 旗舰（**S02、S01、M10**）3D 实体与压平切镜 | 同 PR-3B 显存零泄漏与压平对齐校验 |
| **Wave 4** | **PR-4B** | `chore/v3-w4b-audit-release` | 升级 `scripts/visual-audit.mjs`（覆盖 `stage`/`story` 自动定格、活公式指针实拖、E04 3D vs 2D 压平双截图）+ 单文件导出无 Three.js 回归封板 `v3.0.0` | 全 CI + 多模态看图审计 + 单文件导出（`< 2.5 MB`）全绿后打 `v3.0.0` Tag |

---

## 五、本地总控收 PR 验收流水线（标准操作）

每当 GPT-6.2 Sol 提交 PR 且 GitHub Actions CI 全绿后，本地总控按以下步骤执行零信任终审：
1. `git fetch origin && git checkout <pr-branch>`；
2. 本地核查静态红线与 diff（确认无 `as any` / `@ts-ignore` / 越权修改内核测试）；
3. 跑通全套门禁 + `VITE_BASE_PATH=/PhysForge/` 构建 + 单文件导出；
4. 若涉及界面、公式、3D 或演说流，以 `BypassSandbox: true` 运行 `visual-audit.mjs` 与 `e2e-subpath-and-export.mjs`，并多模态逐张读图验收；
5. 验收通过后由总控 squash/merge 进 `main`，同步更新 [ARCHITECT_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/ARCHITECT_HANDOFF_LOG.md) 与 [WRITER_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_HANDOFF_LOG.md) 派发下一张 PR 单。
