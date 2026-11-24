# PhysForge - 写手跨会话交接日志（Writer Handoff Log）

> **声明**：本文件仅作**写手角色（Writer）跨会话状态交接日志**，不替代项目权威规则（[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md)）或总控施工方案（[V2_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V2_WRITER_CONSTRUCTION_PLAN.md)），也不得写入或修改 [ARCHITECT_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/ARCHITECT_HANDOFF_LOG.md)。  
> **滚动上限**：不超过 **250 行 / 15 KB / 5 条会话增量**；超限写入时保留顶部当前权威快照、最近 1–2 轮详细增量及所有未闭环事项，将更早增量压缩为 3–8 行历史归档摘要。

---

## 当前权威状态快照（2026-11-24，V2.0.2 Wave A–C 已验收并合入 `main@b5e3ae4`）

* **Git 基线与工作区边界**：当前基线为 `main@b5e3ae4`（已合并提交 Wave A UI 1:1 复刻、Wave B 43 单元坐标系、Wave C 43/43 手柄 + 30/43 Auto-FBD + 28/43 随动系及总控 3 处验收直修），随交接日志一并推送至 `origin/main`。**注意：目前完成的是 V2.0.2，V3.0 尚未启动。**
* **全量门禁实证（总控终审后）**：18 项 TypeScript（11 `tsconfig.json` + 7 `tsconfig.build.json`）及 7 个 workspace 包构建全过；Vitest **63 文件 / 301 用例通过**（含 `wave-c-interaction.test.ts` 2/2、`coordinate-alignment.test.ts` 43/43、`catalog.test.ts` 44/44）；`verify:packs`（6 包/20 题）、`verify:scenes`（10 场景）、`verify:vault`（43 单元，ZIP 6080 B）全通过；`/PhysForge/` 主包 `index-LTu6VV9G.js` **259.78 kB gzip**，单文件 `modern-rutherford-bohr.html` 导出 `2009.8 KB`；`visual-audit.mjs`（0 错误/0 外网请求）与 `e2e-subpath-and-export.mjs`（direct WebM `10458 B`、PNG `111632 B`、drawer WebM `134308 B`）全通过；`git diff --check` 通过。
* **待后续治理与环境备注**：
  * **在线 AI（BYOK）待检查联调**：`@physforge/ai-copilot` 真实在线服务商实网链路尚未联调检查；
  * **既有非阻塞告警**：Vite 存在 `[INEFFECTIVE_DYNAMIC_IMPORT]`（`em-induction-double-rod`）与大延迟 chunk 告警；
  * **Windows 避坑**：Corepack `pnpm` 受 DNS 阻塞需直调本地 `node_modules` 二进制；PowerShell 5.1 不支持 `&&`/`||`；Playwright 与 Git 写入需 `BypassSandbox: true`。
* **下一会话任务（按 [V3_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V3_WRITER_CONSTRUCTION_PLAN.md) 原子 PR 派单执行）**：
  1. **PR-0 (`fix/v3-step0-online-byok`)**：补齐 `byokClient.ts` Schema 摘要、`refiner.ts` 未知参数键拦截与 Schema 回馈、`AiCopilotDrawer.tsx` 提供商模板与连通性自检；
  2. **PR-1A (`feat/v3-w1a-story-runner`) → PR-1B (`feat/v3-w1b-tri-mode-shell`) → PR-1C (`feat/v3-w1c-presenter-decks`)**：严格按 [V3_ARCHITECT_BLUEPRINT_AND_HARD_CORES.md](file:///d:/project%20code/44-PhysForge/docs/v3-specs/V3_ARCHITECT_BLUEPRINT_AND_HARD_CORES.md) 与施工单单 PR ≤ 12 文件提分支 PR 过 CI 后交本地总控验收合入。

---

## 会话增量记录

### [2026-11-24 16:05 +08:00] V2.0.2（Wave A–C）封板提交推送与交接压缩（总控同步）

* Wave A–C 全量改动已验收并提交至 `main@b5e3ae4`（总控同期直修 `SimulationStage.tsx` 随动系角标遮挡、`AutoFbdOverlay.tsx` 微观 SI 阈值与 `wave-c-interaction.test.ts` 超时），本日志按滚动上限完成历史增量压缩并更新下一会话首要目标为“在线 AI 检查联调”。

### [2026-11-24] Wave C C1–C3 完成与验收（写手交付）

* 完成 C1–C3：补齐交互句柄、模型受力与参考系（43/43 手柄、30/43 真实受力、28/43 随动系）；新增 `wave-c-interaction.test.ts`。`em-ac-generator-rms` 线圈受力采用方形线圈近似，线圈参考系仅表示平移；`thermo-piston-gas-laws` 多行程泵未提供可计算的机械部件状态，因此不显示受力图。
* 视觉审计新增 Rutherford 参数拖动、天体模型受力图开关、抛体随体参考系切换，并保存三张截图至 `artifacts/ui-audit/`；`/PhysForge/` 子路径与导出 E2E 及单文件 Rutherford 导出均通过。

### [2026-11-24 13:18 +08:00] Wave B B1–B4 坐标施工与最终验收

* 将 B1–B4 43 单元画布迁移至共享世界坐标映射器 `createWorldMapper`，并为 11 个 B4 模型补齐默认视窗、装置/曲线/波场渲染和手柄对齐；扩展 B6 六模型平移/缩放/复位浏览器审计并全数通过。

---

### [2026-11-22 ~ 2026-11-24] 历史归档摘要（V1.0 → Wave A，已全部合入 `main`）

* **V1.0 → V2-W6（`eb6b34c` → `c4dbcfa`）**：完成 Monorepo、43 单元物理仿真矩阵、8 大平台底座（`physics-core` / `sim-sdk` / `analysis-lab` / `export-studio` / `ai-copilot` / `workspace-vault`）、6 套教研包与 `verify:packs`/`scenes`/`vault`。
* **V2.0.1 & Wave A（`16c5316` → `b5e3ae4`）**：完成交互钩子/BYOK 容错/WebM 跨端修复、工作台 UI 1:1 视觉复刻（48px 顶栏/折叠左侧轨/272px 悬浮面板/3D `RoomEnvironment` + 闭合磁感线 + `CSS2DRenderer` 矢量标签）及 E04·B3·B2·E10 标尺审计。
