# 总控跨会话交接日志（Architect Handoff Log）

> **文档定位声明**：本文件**仅作总控（Chief Architect）角色的跨会话状态交接日志，不替代项目权威规则或主计划**（总架构蓝本见 [physforge_ai.md](file:///d:/project%20code/44-PhysForge/physforge_ai.md)，写手执行计划见 [WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_CONSTRUCTION_PLAN.md)，仓库宪法见 [AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md)）。  
> **滚动上限**：默认不超过 **250 行 / 15 KB / 5 条历史增量**；超限写入时必须保留顶部权威状态快照、最近 1–2 轮详细增量及全部未关闭阻塞项，更早增量压缩为 3–8 行历史归档摘要。  
> **角色隔离**：仅总控角色读写本文件；写手角色请独立读写 [WRITER_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_HANDOFF_LOG.md)，严禁互相覆盖。

---

## 一、当前权威状态快照（Snapshot）

* **最近更新时间**：`2026-11-22 16:58 +08:00`
* **GitHub 远端与本地基线**：
  * 远端仓库：`https://github.com/riyuewuxing/PhysForge`（公开仓库，默认分支 `main`）
  * 本地仓库：`d:\project code\44-PhysForge`，位于 `main` 分支并绑定 `origin = https://github.com/riyuewuxing/PhysForge.git`；Phase 0 + Wave 1 全量基线已随验收提交并同步至 `origin/main`（具体 SHA 以 `git log -n 1` 为准）。
* **主线阶段进展（大轮次合并版）**：
  * **Phase 0（M0）**：✅ **已通过总控验收**。
  * **Wave 1（第一大轮：教室全栈外壳 + 单文件导出 + 4 大旗舰模型）**：✅ **已通过总控零信任验收**。
  * **Wave 2（第二大轮，待写手启动）**：`optics-ray-studio`（`ricktu288/ray-optics` Apache-2.0）、`mech-free-sandbox`（`@dimforge/rapier2d-compat` 懒加载）、`circuit-dc-capacitor-mna`（纯 TS 自研 MNA，零 GPL）、`content/teaching-packs/` + `pnpm verify:packs` 防幻觉验算闭环、中英双语 `README.md` / `CONTRIBUTING.md`。
* **Wave 1 总控独立复验实证（2026-11-22 16:54–16:57 亲跑）**：
  * `pnpm typecheck`：退出码 `0`（6/6 工作区项目通过）。
  * `pnpm test`：退出码 `0`（7 测试文件 / **36 条用例全绿**，耗时 `396 ms`）。
  * `pnpm build`：退出码 `0`（6/6 项目编译通过；`packages/*/dist` 已排除 `*.test.ts`；`apps/web/dist` 生成 PWA SW 预缓存 441 entries 与 `/excalidraw-assets/`；`em-bounded-magnetic-field.html` 产出 `2007.5 KB`）。
  * `pnpm export:singlefile -- --model=mech-block-conveyor`：退出码 `0`（产出 `mech-block-conveyor.html` `2002.6 KB`，两份单文件 HTML 均无外网 CDN 字面量）。
  * **Playwright 实机全链路审计（本机 Chrome 无头）**：4 大旗舰模型依次切换运行且 Canvas 非空渲染；`uPlot` 悬停触发时间轴双向回放（`scrubWorking: true`）；POE 遮罩切换正常；大屏模式 `fontSize = 18 px`、30 处 `.pf-touch-target` 零欠尺寸（`undersized: 0`）；Excalidraw 离线透明批注加载并导出合成 PNG（`1036x563`）；`mech-block-conveyor.html` 通过 `file:///` 独立加载运行；全程 `consoleErrors: []`、`pageErrors: []`、`externalRequests: []`。
  * **静态安全扫描**：`packages` / `simulations` / `apps` 自有源码零 `@ts-ignore`、`@ts-expect-error`、`as any`、`eslint-disable`、`.skip(`、`.only(`。
* **非阻断性观察项（纳入 Wave 2 顺带优化）**：
  1. `LeftCatalogSidebar.tsx` 教材筛选下拉目前硬编码 3 册（`必修第一册`/`选择性必修一`/`选择性必修二`），Wave 2 新增模型后需同步补齐其余分册或动态从注册表提取。
  2. `SimulationStage.tsx` 通用频闪打点层仅消费 `observables.x/y`（`em-bounded-magnetic-field` 生效，其余模型优雅跳过）；Wave 2 可按需由插件图层透传或拓展。
  3. `@excalidraw/excalidraw` 库自身 chunk 内含默认常量字符串 `ASSETS_FALLBACK_URL = "https://esm.sh/..."`，运行态已被 `main.tsx` 的 `EXCALIDRAW_ASSET_PATH` 完全覆盖（实测 `externalRequests: []`）。
* **关键避坑与后续红线**：继续严守零 GPL（`circuitjs1` 源码禁入）、`Rapier` 仅在沙箱模型动态懒加载、单文件切片严禁打入 WASM/Excalidraw、角色日志严格隔离与未经确认不 `push`。

---

## 二、会话增量记录

### 2026-11-22 16:58 — Wave 1（Module A–C）总控零信任验收通过
* **源码与数学核查**：逐文件核对 `packages/{physics-core,sim-sdk,pedagogy-schema}` 收口改动、`apps/web` 全套组件（固定 240Hz 步长累加器、`uPlot` 双向回放、POE 遮罩、本地 `/excalidraw-assets/` 离线白板）、`apps/singlefile-exporter`（`target-plugin` 按模型裁剪）及 4 大旗舰模型（`PHYSICS_SPEC.md`、`engine.ts`、`engine.test.ts`、`plugin.ts`、`registry.ts`）；确认 `ARCHITECT_HANDOFF_LOG.md` 未被写手触碰。
* **独立实证**：`pnpm typecheck`、`pnpm test`（7 文件 36 用例全绿，`396 ms`）、`pnpm build`、`export:singlefile` 与 Chrome Playwright 全链路验收全部通过且零外网请求/零报错。
* **下一优先级动作**：待用户确认是否先行提交 Wave 1 Git 基线，随后指示写手按 [WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_CONSTRUCTION_PLAN.md) 启动 **Wave 2（Module D → E → F）**。

### 2026-11-22 16:05 — 按用户节奏优化：将剩余施工重编为 Wave 1 / Wave 2 两大高产出轮次
* 将原 Phase 1+2 合并为 Wave 1，原 Phase 3+4 合并为 Wave 2，写手施工方案落盘于 [WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_CONSTRUCTION_PLAN.md)。

### 2026-11-22 16:00 — Phase 0（M0 地基与物理内核）总控零信任验收通过
* 核查并实跑 `sim-sdk`、`pedagogy-schema`、`physics-core` 全套源码与 18 条内核守恒/事件单测全部通过。

### 2026-11-22 15:20 — 项目冷启动：接任本地总控、核验 GitHub 空仓并落盘施工与双交接体系
* 通读 [physforge_ai.md](file:///d:/project%20code/44-PhysForge/physforge_ai.md)，核实 `riyuewuxing/PhysForge` 公开空仓及本地工具链，建立施工方案与双角色交接文件。
