# PhysForge - 写手跨会话交接日志（Writer Handoff Log）

> **声明**：本文件仅作**写手角色（Writer）跨会话状态交接日志**，不替代项目权威规则（[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md)）或总控施工方案（[V2_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V2_WRITER_CONSTRUCTION_PLAN.md)），也不得写入或修改 [ARCHITECT_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/ARCHITECT_HANDOFF_LOG.md)。  
> **滚动上限**：不超过 **250 行 / 15 KB / 5 条会话增量**；超限写入时保留顶部当前权威快照、最近 1–2 轮详细增量及所有未闭环事项，将更早增量压缩为 3–8 行历史归档摘要。

---

## 当前权威状态快照（2026-11-22 19:53）

* **Git 分支与基线**：
  * 本地仓库位于 `main` 分支（`HEAD = 62f9383` 为 V1.0 + V2.0 规格/总控方案基线）；当前 `V2-W1` 全部新增与修改文件处于本地工作区未提交状态，未执行 `git commit` / `git push`，等待总控验收。
  * 远端：`origin = https://github.com/riyuewuxing/PhysForge.git`。
* **权威参考文档**：
  * 仓库宪法：[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md) ｜ V2 权威施工方案：[docs/V2_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V2_WRITER_CONSTRUCTION_PLAN.md) ｜ 第1卷架构规格：[docs/v2-specs/01_ARCHITECTURE_AND_CORE_PLATFORM.md](file:///d:/project%20code/44-PhysForge/docs/v2-specs/01_ARCHITECTURE_AND_CORE_PLATFORM.md)
* **已新增 / 核实技术栈与版本**：
  * V1 基线：`Node v24.18.0`、`pnpm 11.24.0`、`typescript@7.0.2`、`vitest@5.1.1`、`zod@4.6.7`、`vite@6.4.6`、`react@19.3.1`、`zustand@5.1.0`、`uplot@1.6.32`、`katex@0.19.1`、`@excalidraw/excalidraw@0.18.1`、`@dimforge/rapier2d-compat@0.21.0`、`vite-plugin-pwa@2.0.0`、`vite-plugin-singlefile@2.3.4`、`playwright@1.65.1`。
  * V2-W1 新增（均为 MIT，未引入 R3F 或 `mathjs`）：`papaparse@5.7.1`、`@types/papaparse@5.5.2`、`fflate@0.8.3`、`three@0.187.0`、`@types/three@0.187.0`。
* **当前施工状态**：**V2-W1（底座升维）已全量竣工并完成双路径构建及 Playwright 端到端自检，等待总控验收**。
* **最后一次代码编辑后的实测门禁结果**：
  * **静态合规扫描**（`packages/`、`apps/`、`simulations/` 非构建源码）：零 `@ts-ignore`、零 `@ts-expect-error`、零 `as any`、零 `eslint-disable`、零 `.skip(`/`.only(`、零 `Math.random(`、零 `eval(`/ `new Function(`。
  * `pnpm typecheck`：退出码 `0`（9/9 工作区全部子包 + `scripts/tsconfig.json` 通过）。
  * `pnpm test`：退出码 `0`（14 个测试文件、59/59 条用例全绿，耗时 `673ms`；涵盖原有 V1 46 题基线与新增 13 条 V2 测试）。
  * `pnpm verify:packs`：退出码 `0`（6/6 教研包、20/20 道物理题全数通过）。
  * `pnpm build`（`/` 与 `VITE_BASE_PATH=/PhysForge/` 双路径）：均退出码 `0`；主入口 `index-*.js` 压缩后 `258.05–258.06 KB` gzip（远低于 `350 KB` 红线），确认未提前打入 `OrbitControls`、`papaparse`、`rapier_wasm2d`、`@excalidraw/excalidraw`、`physforge-workspace-vault`、`mathjs`；单文件 `em-bounded-magnetic-field.html` 产物 `2008.5 KB`（零依赖泄漏）。
  * **Playwright 无头实机验收（`/` 与 `/PhysForge/` 双路径）**：`consoleErrors: []`、`pageErrors: []`、`externalRequests: []`、`failed404: []`；实测缩放 `100% → 112% → 居中复位 100%`、虚拟直尺/0.1°量角器、Phyphox 分号欧式小数 CSV 阻尼谐振拟合、`Ctrl+K` IndexedDB Vault 保存、Excalidraw 离线批注切换均正常。
* **下一优先级动作**：请总控对 `V2-W1` 进行零信任验收；验收通过后进入 `V2-W2`（`packages/export-studio` + `apps/singlefile-exporter --preset-file` + `B1–B5` 自由建模器，`B5` 按需异步引入 `mathjs >= 15.2.0`）。

---

## 会话增量记录

### [2026-11-22 19:53 +08:00] 完成 V2-W1（底座升维）全量交付

#### 1. `packages/physics-core` 7 大 V2 算法内核（零 DOM/React，零 `Math.random()`）
* 新增 [scaleContext.ts](file:///d:/project%20code/44-PhysForge/packages/physics-core/src/units/scaleContext.ts)、[hybridAutomaton.ts](file:///d:/project%20code/44-PhysForge/packages/physics-core/src/hybrid/hybridAutomaton.ts)（含零速静摩擦滞回与 `DEFAULT_MAX_TRANSITIONS_PER_STEP = 8` Zeno 防护）、[udwadiaKalaba.ts](file:///d:/project%20code/44-PhysForge/packages/physics-core/src/constraints/udwadiaKalaba.ts)（Jacobi 对称特征 SVD 伪逆）、[rootFinder.ts](file:///d:/project%20code/44-PhysForge/packages/physics-core/src/inverse/rootFinder.ts)（Brent 边界打靶多解求根）、[waveFDTD2D.ts](file:///d:/project%20code/44-PhysForge/packages/physics-core/src/fields/waveFDTD2D.ts) + [marchingSquares.ts](file:///d:/project%20code/44-PhysForge/packages/physics-core/src/fields/marchingSquares.ts)、[spatialHash2D.ts](file:///d:/project%20code/44-PhysForge/packages/physics-core/src/particles/spatialHash2D.ts)、[wavelengthToRgb.ts](file:///d:/project%20code/44-PhysForge/packages/physics-core/src/optics/wavelengthToRgb.ts)、[seededPrng.ts](file:///d:/project%20code/44-PhysForge/packages/physics-core/src/random/seededPrng.ts)、[nonlinearMna.ts](file:///d:/project%20code/44-PhysForge/packages/physics-core/src/circuits/nonlinearMna.ts)（修正二极管/小灯泡牛顿迭代等效电流源符号并补足梯形 LC 20 周期检验）与 [auditor.ts](file:///d:/project%20code/44-PhysForge/packages/physics-core/src/verification/auditor.ts)。
* 单测 [v2-modules.test.ts](file:///d:/project%20code/44-PhysForge/packages/physics-core/src/v2-modules.test.ts)（7 组综合检验）全通过。

#### 2. `packages/sim-sdk` V2 向后兼容契约
* 扩充 [index.ts](file:///d:/project%20code/44-PhysForge/packages/sim-sdk/src/index.ts)：新增 `SimulationPluginV2`、`ControlHandle`、`ForceVectorItem`、`ReferenceFrameSpec`、`DiagramIR`、`DiagramExportOptions`、`SceneDSL`、`ThreeSceneBridge` 与 `isSimulationPluginV2`，并通过 [index.test.ts](file:///d:/project%20code/44-PhysForge/packages/sim-sdk/src/index.test.ts) 验证与全部 7 个 V1.0 模型无缝兼容。

#### 3. `@physforge/analysis-lab` 与 `@physforge/workspace-vault`
* 新建 `@physforge/analysis-lab`：[fftAnalyzer.ts](file:///d:/project%20code/44-PhysForge/packages/analysis-lab/src/fftAnalyzer.ts)（Radix-2 FFT + Hann 窗 + 亚 bin Top-3 峰值）、[csvFitting.ts](file:///d:/project%20code/44-PhysForge/packages/analysis-lab/src/csvFitting.ts)（Phyphox `;`/`\t`/欧式逗号小数、Tracker 多行表头、线性/多项式/指数/LM 阻尼谐振子拟合、Green 定理环路面积）、[sweepRunner.ts](file:///d:/project%20code/44-PhysForge/packages/analysis-lab/src/sweepRunner.ts)、[PhaseXYPlotter.tsx](file:///d:/project%20code/44-PhysForge/packages/analysis-lab/src/components/PhaseXYPlotter.tsx) 及 4 组单测。
* 新建 `@physforge/workspace-vault`：[vaultStore.ts](file:///d:/project%20code/44-PhysForge/packages/workspace-vault/src/vaultStore.ts)（IndexedDB + FileSystemAccess 目录同步 + `fflate` ZIP 打包恢复 + 合入 `content/presets/*.json`）、[globalSearch.ts](file:///d:/project%20code/44-PhysForge/packages/workspace-vault/src/globalSearch.ts) 及 2 组单测。

#### 4. `apps/web` 交互工作台、懒加载 3D、子路径适配与 CI/Pages
* 新增 [ViewportController.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/ViewportController.ts)（`0.1x–20x` 光标锚点缩放/拖拽平移/复位）、[CommandStack.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/CommandStack.ts)（50 步 `Ctrl+Z`/`Ctrl+Shift+Z` 撤销重做）、[RulerToolboxOverlay.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/RulerToolboxOverlay.tsx)（虚拟直尺、`0.1°` 量角器、三点定圆圆规）、[AutoFbdOverlay.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/AutoFbdOverlay.tsx)、纯 Vanilla Three.js [ThreeStage.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/ThreeStage.tsx)（严格 `dispose()`）与 [stage.test.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/stage.test.ts)。
* 懒加载接入 [AnalysisLabDrawer.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/AnalysisLabDrawer.tsx)、[sweep.worker.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/workers/sweep.worker.ts)（`vite.config.ts` 设 `worker.format = 'es'`）与 [CommandPalette.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/CommandPalette.tsx)（`Ctrl+K`）；同步升级 [useClassroomStore.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/store/useClassroomStore.ts)、[SimulationStage.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/SimulationStage.tsx)、[App.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/App.tsx) 及 [export.mjs](file:///d:/project%20code/44-PhysForge/apps/singlefile-exporter/export.mjs) 防泄漏红线校验。
* 修复 [vite.config.ts](file:///d:/project%20code/44-PhysForge/apps/web/vite.config.ts)、[index.html](file:///d:/project%20code/44-PhysForge/apps/web/index.html) 与 [main.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/main.tsx) 的 `VITE_BASE_PATH` / `/PhysForge/` 子路径映射，新增 [.github/workflows/ci.yml](file:///d:/project%20code/44-PhysForge/.github/workflows/ci.yml) 与 [.github/workflows/deploy-pages.yml](file:///d:/project%20code/44-PhysForge/.github/workflows/deploy-pages.yml)。

---

### [2026-11-22 15:55–17:28 +08:00] 历史归档摘要（V1.0 基线 `62f9383`）

* Phase 0 & Wave 1 + Wave 2 已完成 Monorepo、`physics-core` V1、7 大物理模型（4 旗舰 + 光学追迹 + Rapier2D 沙箱 + MNA 电路）、`uPlot` 双向回放、POE 遮罩、本地 `Excalidraw`、按模型裁剪单文件导出、6 份防幻觉 `teaching-packs`（20 题）及开源门面文档，46 条 V1 单测全部传承通过。
