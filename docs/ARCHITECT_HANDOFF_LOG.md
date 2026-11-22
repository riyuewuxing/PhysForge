# 总控跨会话交接日志（Architect Handoff Log）

> **文档定位声明**：本文件**仅作总控（Chief Architect）角色的跨会话状态交接日志，不替代项目权威规则或主计划**（V2.0 写手权威施工方案见 [V2_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V2_WRITER_CONSTRUCTION_PLAN.md)，三卷全规格见 `docs/v2-specs/01~03.md`，仓库宪法见 [AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md)）。  
> **滚动上限**：默认不超过 **250 行 / 15 KB / 5 条历史增量**；超限写入时必须保留顶部权威状态快照、最近 1–2 轮详细增量及全部未关闭阻塞项，更早增量压缩为 3–8 行历史归档摘要。  
> **角色隔离**：仅总控角色读写本文件；写手角色请独立读写 [WRITER_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_HANDOFF_LOG.md)，严禁互相覆盖。

---

## 一、当前权威状态快照（Snapshot）

* **最近更新时间**：`2026-11-22 20:11 +08:00`
* **GitHub 远端与本地基线**：
  * 远端仓库：`https://github.com/riyuewuxing/PhysForge`（公开仓库，默认分支 `main`）
  * 代码与发布状态：**`V2-W1`（底座升维与子路径部署修复）零信任验收通过**，即将提交并推送至 `origin/main`。
* **V2.0 总体规划进展**：
  * ✅ **V2.0 需求对齐、全网调研与写手施工方案定稿**（`AGENTS.md` V2 宪法、`docs/v2-specs/01~03.md`、`V2_WRITER_CONSTRUCTION_PLAN.md`、`PROJECT_BRIEFING_FOR_CLOUD_AI.md`）。
  * ✅ **`V2-W1` 已验收通过**：`physics-core` V2 底座（`ScaleContext` / `HybridAutomaton` / `UdwadiaKalaba` / `RootFinder` / `WaveFDTD2D` / `MarchingSquares` / `SpatialHash2D` / `wavelengthToRgb` / `SeededPrng` / `NonlinearMna` / `Auditor`）、`sim-sdk` V2 向后兼容契约、`@physforge/analysis-lab`（`PhaseXYPlotter` / Radix-2 FFT / Phyphox+Tracker CSV & LM 拟合 / ParameterSweep）、`@physforge/workspace-vault`（IndexedDB + `fflate` ZIP + FileSystemAccess + `Ctrl+K` 全局检索）、`apps/web` 视口控制/50 步撤销栈/尺规量角圆规/Auto-FBD 叠绘/纯 Vanilla `three` 懒加载 `ThreeStage`/双路径 (`/` 与 `/PhysForge/`) 构建及 `.github/workflows/{ci,deploy-pages}.yml`。
  * ⏳ **下一待写手启动：`V2-W2`**（`@physforge/export-studio` 黑白试卷矢量图 SVG/PNG/LaTeX 导出 + `B1–B5` 五大基座模型，含 `B1–B4` 原 ID 升级与兼容别名、以及仅在 `B5` 异步懒加载的 `mathjs >= 15.2.0`）。
  * 后续轮次：`V2-W3`（`M01–M11`）→ `V2-W4`（`E01–E10`）→ `V2-W5`（`W01–W02, O01, T01–T02, N01–N03`）→ `V2-W6`（`S01–S04, X01–X02, C01–C03` + `ai-copilot` + V2.0 终版封板）。
* **总控审校与全网调研确立的 6 项核心纠偏（写手必守）**：
  1. **批次重命名**：统一为 `V2-W1` ~ `V2-W6`。
  2. **V1.0 模型兼容性**：`V2-W2` 升级 `B1–B4` 时必须在 `simulations/registry.ts` 保留 V1.0 `modelId` 别名与旧 `presetId`，确保 `pnpm verify:packs`（20 题）不断链。
  3. **`mathjs >= 15.2.0`**：封堵 `< 15.2.0` AST 沙箱逃逸 CVE，仅允许在 `B5` 异步懒加载并设白名单/步数上限。
  4. **3D 锁定 Vanilla `three`**：禁止 `@react-three/fiber` / `drei`，统一由 `ThreeStage` 挂载并严格 `dispose()`。
  5. **子路径部署**：坚持使用 `VITE_BASE_PATH` / `import.meta.env.BASE_URL` / `./icon.svg`，禁止任何绝对根路径回归。
  6. **CSV 多方言与单文件拦截**：`export.mjs` 禁止泄露非模型对应依赖（`three` / `mathjs` / `papaparse` / `fflate` / `rapier_wasm2d` / `@excalidraw/excalidraw`）。

---

## 二、会话增量记录

### 2026-11-22 20:11 — `V2-W1` 零信任验收通过（含 `SimulationStage.tsx` rAF 状态同步小修）
* **核查发现与总控顺手修复**：
  * 审阅 [SimulationStage.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/SimulationStage.tsx#L150-L331) 时发现 `renderFrameToCanvas()` 在初始 `useEffect([], [])` rAF 闭包中捕获了 `fbdCount`（恒为 `0`），当 `V2-W2` 模型开启 `autoFbdEnabled` 时会每帧触发 `setFbdCount` 重渲染；总控已补充 `fbdCountRef` 修复该闭包隐患。
* **最后一次代码改动后的实测验收证据**：
  * **静态合规扫描**：全仓（`packages/simulations/apps/scripts`）零 `@ts-ignore` / `@ts-expect-error` / `\bas any\b` / `eslint-disable` / `.skip(` / `.only(` / `Math.random(` / `eval(` / `new Function(`（`STATIC_COMPLIANCE_CLEAN`）。
  * **`pnpm typecheck`**：退出码 `0`（8/9 工作区有脚本包及 `scripts/tsconfig.json` 全部通过）。
  * **`pnpm test`**：退出码 `0`（14 个测试文件 / 59 条用例全绿，耗时 `517ms`）。
  * **`pnpm verify:packs`**：退出码 `0`（6 份教研包 / 20 道物理验算题全部通过）。
  * **`pnpm build` 与包体审计**：主 HTML 入口 `index-DBaOPBDD.js` gzip `256.15 KB`（Vite 输出 `264.27 kB`，远低于 `350 KB` 红线），主包零打入 `OrbitControls` / `papaparse` / `rapier_wasm2d` / `@excalidraw/excalidraw` / `physforge-workspace-vault` / `mathjs`；`ThreeStage`、`AnalysisLabDrawer`、`CommandPalette`、`sweep.worker` 均独立分包；单文件导出 `em-bounded-magnetic-field.html`（`2008.5 KB`）通过静态防泄漏校验。
  * **Playwright 无头 Chrome 双路径实机验收（`/` 与 `/PhysForge/`）**：均实现鼠标指针锚点缩放（`112% -> 100%`）、虚拟直尺/量角器/圆规（`L=2.000m / 45.0° / R = 0.900 m`）、Phyphox 分号逗号小数 CSV 解析与 LM 拟合、Radix-2 FFT 频谱、Web Worker 参数扫描、`Ctrl+K` Vault 保存检索与 Excalidraw 离线零 404 加载（`consoleErrors: []`, `pageErrors: []`, `failed404: []`, `externalRequests: []`）。
* **下一优先级动作**：通知用户 `V2-W1` 已验收合入并推送 `origin/main`，由写手读取 [WRITER_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_HANDOFF_LOG.md) 与 [V2_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V2_WRITER_CONSTRUCTION_PLAN.md) 启动 **`V2-W2`**。

### 2026-11-22 19:35 — V2.0 三卷规范落盘、全网技术调研与 `V2_WRITER_CONSTRUCTION_PLAN.md` 定稿
* 完成三卷规格落盘（`docs/v2-specs/01~03.md`）、`AGENTS.md` V2 宪法升级、全网 CVE/生态调研纠偏 6 项硬规则并定稿 `V2-W1` ~ `V2-W6` 六轮施工方案。

---

## 历史归档摘要（V1.0 基线，已合入 `origin/main`）
* **Phase 0（V1 地基）**：初始化 `main`、MIT `LICENSE`、`AGENTS.md` 与 `@physforge/{physics-core,sim-sdk,pedagogy-schema}`，18 条单测全绿。
* **Wave 1（`eb6b34c`）**：交付 `apps/web` 三栏教室壳（240Hz `rAF`、`uPlot`、`KaTeX`、POE、离线 Excalidraw、PWA）、`apps/singlefile-exporter` 与 4 大旗舰模型（36 条单测 + Playwright 验收）。
* **Wave 2（`62f9383`）**：交付 `optics-ray-studio`、`mech-free-sandbox`（懒加载 Rapier2D）、`circuit-dc-capacitor-mna`（纯 TS MNA）、6 份教研包 + `pnpm verify:packs`（20 题）与开源文档，46 条单测与全链路终验通过。
