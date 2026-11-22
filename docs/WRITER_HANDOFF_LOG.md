# PhysForge - 写手跨会话交接日志（Writer Handoff Log）

> **声明**：本文件仅作**写手角色（Writer）跨会话状态交接日志**，不替代项目权威规则（[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md)）或总控施工方案（[V2_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V2_WRITER_CONSTRUCTION_PLAN.md)），也不得写入或修改 [ARCHITECT_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/ARCHITECT_HANDOFF_LOG.md)。  
> **滚动上限**：不超过 **250 行 / 15 KB / 5 条会话增量**；超限写入时保留顶部当前权威快照、最近 1–2 轮详细增量及所有未闭环事项，将更早增量压缩为 3–8 行历史归档摘要。

---

## 当前权威状态快照（2026-11-22 20:31）

* **Git 分支与基线**：
  * 本地仓库位于 `main` 分支（`HEAD = 61cad64` 为已验收的 V2-W1 基线）；当前 `V2-W2` 全部新增与修改文件处于本地工作区未提交状态，未执行 `git commit` / `git push`，等待总控验收。
  * 远端：`origin = https://github.com/riyuewuxing/PhysForge.git`。
* **权威参考文档**：
  * 仓库宪法：[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md) ｜ V2 权威施工方案：[docs/V2_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V2_WRITER_CONSTRUCTION_PLAN.md) ｜ 第2卷模型规格：[docs/v2-specs/02_MODELS_BUILDERS_AND_MECHANICS_EM.md](file:///d:/project%20code/44-PhysForge/docs/v2-specs/02_MODELS_BUILDERS_AND_MECHANICS_EM.md)
* **V2-W2 新增技术栈**：
  * `mathjs@15.2.0`（`Apache-2.0`，仅安装于 `@physforge/simulations`，严格在 `B5` 内通过 `preloadMathjsCompiler()` 动态 `import('mathjs')` 懒加载）。
* **当前施工状态**：**V2-W2（`export-studio` + `--preset-file` 单文件增强 + `B1–B5` 五大自由建模器）已全量竣工并跑通最后一次编辑后的全部门禁与 Playwright 实测，等待总控验收**。
* **最后一次代码编辑后的实测门禁结果**：
  * **静态合规扫描**：全仓（`packages/`、`apps/`、`simulations/` 非构建源码）零 `@ts-ignore`、零 `@ts-expect-error`、零 `as any`、零 `eslint-disable`、零 `.skip(`/`.only(`、零 `Math.random(`（仅 `B5` 恶意用例测试字面量包含拒绝测试串 `'eval("1+1")'`）。
  * `pnpm typecheck`：退出码 `0`（9/9 有该脚本工作区子包 + `scripts/tsconfig.json` 通过）。
  * `pnpm test`：退出码 `0`（**20 个测试文件、71/71 条用例全绿**，耗时 `2.09s`）。
  * `pnpm verify:packs`：退出码 `0`（6/6 教研包、20/20 道物理验算题全通过，兼容 `LEGACY_MODEL_ALIASES`）。
  * `pnpm build` & 体积隔离：主入口 `index-BOEjHW8I.js` 压缩后 `270.69 KB` gzip（`< 350 KB`），确认未提前打入 `OrbitControls`、`papaparse`、`rapier_wasm2d`、`@excalidraw/excalidraw`、`physforge-workspace-vault`、`mathjs`；`mathjs` 拆入异步分包 `esm-*.js`（`209.30 KB` gzip）。
  * `pnpm export:singlefile` 实测：`--preset-file=content/presets/em-bounded-magnetic-field.focusing.json`（`2012.0 KB`）、`--model=builder-custom-ode-lab`（`2740.0 KB`），均通过依赖防泄漏检查。
  * **Playwright 无头实机验收**：主站与单文件 `file://` 均 `consoleErrors: []`、`pageErrors: []`、`externalRequests: []`、`failed404: []`；实测 `ExportStudioDrawer` 黑白矢量 SVG、TikZ 代码、12 帧频闪合成长图 PNG 下载、60fps WebM 录屏下载、`TeachingPackDrawer` 别名兼容匹配 `B1`，以及切换 `B5` 后才按需加载 `mathjs` chunk。
* **下一优先级动作**：请总控对 `V2-W2` 进行零信任验收；验收通过后按规划推进 `V2-W3`（力学与天体全矩阵 `M01–M11`，11 单元）。

---

## 会话增量记录

### [2026-11-22 20:31 +08:00] 完成 V2-W2（`export-studio` + 五大自由建模器 `B1–B5`）全量交付

#### 1. `@physforge/export-studio` 试卷矢量与媒体导出工坊 + 单文件升级
* 扩充 [packages/sim-sdk/src/index.ts](file:///d:/project%20code/44-PhysForge/packages/sim-sdk/src/index.ts) 的 `DiagramPrimitive`（支持 `arcAngle`, `hatchedGround`, `spring`, `block`, `fieldMarker`, `trajectory`, `circuitElement`, `mathLabel`）。
* 新建 `@physforge/export-studio`：[svgRenderer.ts](file:///d:/project%20code/44-PhysForge/packages/export-studio/src/svgRenderer.ts)（黑白打印 SVG）、[tikzRenderer.ts](file:///d:/project%20code/44-PhysForge/packages/export-studio/src/tikzRenderer.ts)（LaTeX TikZ 代码）、[pngRenderer.ts](file:///d:/project%20code/44-PhysForge/packages/export-studio/src/pngRenderer.ts)（2x/4x/600 DPI PNG 与剪贴板）、[mediaRecorder.ts](file:///d:/project%20code/44-PhysForge/packages/export-studio/src/mediaRecorder.ts)（60fps WebM 录屏与多帧频闪合成长图）、[export.test.ts](file:///d:/project%20code/44-PhysForge/packages/export-studio/src/export.test.ts)（2 单测）。
* 在 `apps/web` 按需懒加载接入 [ExportStudioDrawer.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/ExportStudioDrawer.tsx)，同步更新 [SimulationStage.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/SimulationStage.tsx)、[App.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/App.tsx) 与 [TeachingPackDrawer.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/TeachingPackDrawer.tsx)（调用 `resolveCanonicalModelId` 兼容旧包 ID）。
* 升级 [apps/singlefile-exporter/export.mjs](file:///d:/project%20code/44-PhysForge/apps/singlefile-exporter/export.mjs) 与 [SingleFileApp.tsx](file:///d:/project%20code/44-PhysForge/apps/singlefile-exporter/src/SingleFileApp.tsx) 支持 `--preset-file=<path>`、跨模型别名映射与 `mathjs`/`three`/`papaparse`/`fflate` 防泄漏红线。

#### 2. 五大自由建模器（`B1–B5`）与 `LEGACY_MODEL_ALIASES`
* **注册表与兼容层**（[simulations/registry.ts](file:///d:/project%20code/44-PhysForge/simulations/registry.ts) & [simulations/package.json](file:///d:/project%20code/44-PhysForge/simulations/package.json)）：建立 `LEGACY_MODEL_ALIASES` 映射旧 ID 至 `builder-*` 规范 ID。
* **`B1` `builder-composite-em-field`**（升级 [em-bounded-magnetic-field](file:///d:/project%20code/44-PhysForge/simulations/em-bounded-magnetic-field/plugin.ts)）：扩展至 9 粒子磁聚焦、`solveCriticalSpeedForRadius` Brent 反解、`ControlHandle`、`Auto-FBD` 洛伦兹力与电场力、随动参考系及 `DiagramIR`，补齐 [v2-builder.test.ts](file:///d:/project%20code/44-PhysForge/simulations/em-bounded-magnetic-field/v2-builder.test.ts)（3 测）。
* **`B2` `builder-circuit-mna`**（升级 [circuit-dc-capacitor-mna](file:///d:/project%20code/44-PhysForge/simulations/circuit-dc-capacitor-mna/plugin.ts)）：接入 `solveNonlinearMna` 肖克利二极管/小灯泡牛顿迭代与 `SHORT_CIRCUIT` 告警、`ControlHandle`、`DiagramIR` 及 [v2-builder.test.ts](file:///d:/project%20code/44-PhysForge/simulations/circuit-dc-capacitor-mna/v2-builder.test.ts)（2 测）。
* **`B3` `builder-optics-ray`**（升级 [optics-ray-studio](file:///d:/project%20code/44-PhysForge/simulations/optics-ray-studio/plugin.ts)）：新增理想薄透镜高斯成像模式（$1/u+1/v=1/f$ 与虚像延长线）、角度/物距 `ControlHandle`、`DiagramIR` 及 [v2-builder.test.ts](file:///d:/project%20code/44-PhysForge/simulations/optics-ray-studio/v2-builder.test.ts)（1 测）。
* **`B4` `builder-mechanics-lab`**（升级 [mech-free-sandbox](file:///d:/project%20code/44-PhysForge/simulations/mech-free-sandbox/plugin.ts)）：新增 `Udwadia-Kalaba` 阿特伍德机解析约束、Velocity-Verlet 弹簧振子、`Auto-FBD`、质心参考系、`DiagramIR` 及 [v2-builder.test.ts](file:///d:/project%20code/44-PhysForge/simulations/mech-free-sandbox/v2-builder.test.ts)（2 测）。
* **`B5` `builder-custom-ode-lab`**（新建 [simulations/builder-custom-ode-lab/](file:///d:/project%20code/44-PhysForge/simulations/builder-custom-ode-lab/plugin.ts)）：动态懒加载 `mathjs@15.2.0` + 严格白名单 AST 沙箱 [safeAstCompiler.ts](file:///d:/project%20code/44-PhysForge/simulations/builder-custom-ode-lab/safeAstCompiler.ts)（零 `eval` / `new Function`）、RK4 + Velocity-Verlet 开普勒/单摆/Duffing 模板，[engine.test.ts](file:///d:/project%20code/44-PhysForge/simulations/builder-custom-ode-lab/engine.test.ts) 验证全部恶意表达式拦截、开普勒守恒及 50 步无头扫参通过。

---

### [2026-11-22 15:55–19:53 +08:00] 历史归档摘要（V1.0 `62f9383` & V2-W1 `61cad64`）

* V1.0 完成 Monorepo、7 大模型、离线 Excalidraw、单文件导出与 6 套防幻觉教研包（46 测 20 题）；V2-W1 完成 `physics-core` 7 大 V2 内核、`SimulationPluginV2`、`analysis-lab`（相图/CSV/FFT/Worker 扫参）、`workspace-vault`（ZIP/IndexedDB/`Ctrl+K`）、画布缩放/尺规/Auto-FBD/3D、`VITE_BASE_PATH` 双路径修复及 CI/Pages 流水线（合入 `61cad64`）。
