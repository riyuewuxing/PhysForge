# 总控跨会话交接日志（Architect Handoff Log）

> **文档定位声明**：本文件**仅作总控（Chief Architect）角色的跨会话状态交接日志，不替代项目权威规则或主计划**（V2.0 写手权威施工方案见 [V2_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V2_WRITER_CONSTRUCTION_PLAN.md)，三卷全规格见 `docs/v2-specs/01~03.md`，仓库宪法见 [AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md)）。  
> **滚动上限**：默认不超过 **250 行 / 15 KB / 5 条历史增量**；超限写入时必须保留顶部权威状态快照、最近 1–2 轮详细增量及全部未关闭阻塞项，更早增量压缩为 3–8 行历史归档摘要。  
> **角色隔离**：仅总控角色读写本文件；写手角色请独立读写 [WRITER_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_HANDOFF_LOG.md)，严禁互相覆盖。

---

## 一、当前权威状态快照（Snapshot）

* **最近更新时间**：`2026-11-22 21:05 +08:00`
* **GitHub 远端与本地基线**：
  * 远端仓库：`https://github.com/riyuewuxing/PhysForge`（公开仓库，默认分支 `main`）
  * 代码与发布状态：**`V2-W3`（力学与天体全矩阵 `M01–M11`，11 单元）零信任验收通过**，即将提交并推送至 `origin/main`。
* **V2.0 总体规划进展**：
  * ✅ **`V2-W1`（`main@61cad64`）**：`physics-core` V2 底座、`sim-sdk` V2、`analysis-lab`、`workspace-vault`、交互/3D 舞台与双路径 CI/Pages。
  * ✅ **`V2-W2`（`main@3e86d3b`）**：`@physforge/export-studio`、`LEGACY_MODEL_ALIASES`、`--preset-file` 与 `B1–B5` 五大自由建模器（`mathjs@15.2.0` 懒加载 AST 沙箱）。
  * ✅ **`V2-W3` 已验收通过**：`M01` 追及相遇、`M02` 动态平衡、`M03` 关联速度、`M04` 抛体耦合、`M05` 板块传送带（V2 原地升级）、`M06` 竖直圆周（Udwadia-Kalaba + 脱轨二分）、`M07` 圆盘双物块与圆锥摆、`M08` 弹簧连接体分离、`M09` 碰撞与反冲、`M10` 万有引力与天体力学（`ScaleContext` + 四阶 Yoshida 辛积分 + 霍曼转移 + Lagrange `L1–L5` + Roche 等势线）、`M11` 简谐/单摆/受迫共振（`Scale` & `bisectEvent`）。
  * ⏳ **下一待写手启动：`V2-W4`**（电磁学全矩阵与 3D 空间场 `E01–E10`，10 单元 + **首屏注册表按需懒加载拆分**）。
  * 后续轮次：`V2-W5`（`W01–W02, O01, T01–T02, N01–N03`）→ `V2-W6`（`S01–S04, X01–X02, C01–C03` + `ai-copilot` + V2.0 终版封板）。
* **⚠️ `V2-W4` 首屏体积硬预警（必读约束）**：
  * `V2-W3` 接入 18 个模型后，`apps/web` 主 HTML 入口 `index-*.js` 已达 **`304.82 kB` Vite gzip**（`.NET Gzip` `295.31 KB`），距离 `ci.yml` `< 350 KB` 门禁仅余约 `45 KB` 空间。
  * **要求写手在 `V2-W4` 率先落实模型代码按需异步拆分**（建议在 `@physforge/simulations` 暴露轻量化目录元数据 `@physforge/simulations/catalog` + 动态异步 `loadSimulationById(id)` 供 `apps/web` 首屏按需加载单个模型 `plugin.ts`，同时保留 `@physforge/simulations/registry` 给单测、`verify:packs` 与 `sweep.worker.ts`），严禁 43 模型同步静态打入 `index-*.js` 突破 `350 KB` 红线！

---

## 二、会话增量记录

### 2026-11-22 21:05 — `V2-W3` 零信任验收通过（准备合入 `origin/main`）
* **逐模型源码与物理严谨性核验**：
  * 全部 11 个 `M01–M11` 引擎零 DOM/Canvas/React、零 `Math.random()`；`M01/M04/M05/M06/M08/M09/M11` 使用 `bisectEvent` 精确捕临界；`M06` 使用 `solveUdwadiaKalaba` 求支/拉力、`arccos(2/3)` 误差 `< 1e-6 rad`；`M10` 使用 `ScaleContext` 无量纲化 + 四阶 Yoshida `stepVelocityVerlet` 辛组合、`findRootBrent` 与 `extractIsolines`，50 周期能量/半长轴漂移 `< 1e-6`、角动量 `< 1e-7`。
* **最后一次代码改动后的实测验收证据**：
  * **静态合规扫描**：全仓（`packages/simulations/apps/scripts`）零 `@ts-ignore` / `@ts-expect-error` / `\bas any\b` / `eslint-disable` / `.skip(` / `.only(` / `Math.random(` / 真实 `eval(` / `new Function(`（仅 `B5` 恶意用例测试字面量第 22 行）。
  * **`pnpm typecheck`**：退出码 `0`（9/10 工作区有脚本子包 + `scripts/tsconfig.json` 全部通过）。
  * **`pnpm test`**：退出码 `0`（**30 个测试文件 / 90 条用例全绿**，耗时 `2.66s`）。
  * **`pnpm verify:packs`**：退出码 `0`（6 份教研包 / 20 道物理验算题通过）。
  * **`pnpm build` 与包体隔离**：主 HTML 入口 `index-DXvy7LOr.js`（`969.55 kB`，`.NET Gzip` `295.31 KB` / Vite gzip `304.82 kB`，`< 350 KB`），主包零打入 `OrbitControls` / `papaparse` / `rapier_wasm2d` / `@excalidraw/excalidraw` / `physforge-workspace-vault` / `mathjs`；`M10` 单文件导出 `astro-orbital-mechanics.html`（`2009.4 KB`）通过防泄漏校验。
  * **Playwright 无头 Chrome 实机 E2E**：校验教材分册筛选（`必修第二册`）并依次切换运行 `M01–M11` 全部 11 个模型，确认 `<canvas>` 非空白渲染、支持 `Auto-FBD`、`ExportStudioDrawer` SVG 渲染及 `astro-orbital-mechanics.html` `file://` 运行全绿（`consoleErrors: []`, `pageErrors: []`, `failed404: []`, `externalRequests: []`）。
* **下一优先级动作**：通知用户 `V2-W3` 已验收合入并推送 `origin/main`，由写手读取 [WRITER_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_HANDOFF_LOG.md) 与本预警后启动 **`V2-W4`**（先将 `apps/web` 改为轻量化目录 + 模型插件动态 `import()` 懒加载，再落地 `E01–E10`）。

### 2026-11-22 20:37 — `V2-W2` 零信任验收通过并合入 `main@3e86d3b`
* 验收通过 `@physforge/export-studio`、单文件 `--preset-file` 增强、`LEGACY_MODEL_ALIASES` 与 `B1–B5`（含 `mathjs@15.2.0` 懒加载 AST 沙箱）；71 测全绿，提交并推送 `origin/main@3e86d3b`。

---

## 历史归档摘要（V1.0 & V2 早期轮次，已合入 `origin/main`）
* **V1.0 基线（`eb6b34c` → `62f9383`）**：Monorepo、7 大模型、PWA、离线 Excalidraw、单文件切片、6 教研包与 `verify:packs`（46 测 20 题）。
* **V2-W1（`61cad64`）**：三卷全规格定稿、6 项全网纠偏、`physics-core` V2 底座、`sim-sdk` V2、`analysis-lab`、`workspace-vault`、交互/3D 舞台及双路径 CI/Pages。
