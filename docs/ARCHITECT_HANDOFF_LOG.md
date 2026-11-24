# 总控跨会话交接日志（Architect Handoff Log）

> **文档定位声明**：本文件**仅作总控（Chief Architect）角色的跨会话状态交接日志，不替代项目权威规则或主计划**（仓库宪法见 [AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md)，主视觉施工方案见 [UI_PIXEL_1TO1_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/UI_PIXEL_1TO1_CONSTRUCTION_PLAN.md)，波次方案见 [WAVE_B_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/WAVE_B_CONSTRUCTION_PLAN.md) 与 [WAVE_C_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/WAVE_C_CONSTRUCTION_PLAN.md)）。
> **滚动上限**：不超过 **250 行 / 15 KB / 5 条会话增量**；超限写入时必须保留顶部权威状态快照、最近 1–2 轮详细增量及全部未关闭阻塞项，更早增量压缩为 3–8 行历史归档摘要。
> **角色隔离**：仅总控角色读写本文件；写手角色请独立读写 [WRITER_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_HANDOFF_LOG.md)，严禁互相覆盖。

---

## 一、当前权威状态快照（Snapshot）

* **最近更新时间**：`2026-11-24 16:05 +08:00`
* **Git 基线与工作区状态**：
  * 远端仓库：`https://github.com/riyuewuxing/PhysForge` ｜ 当前分支：**`main`** ｜ Wave A–C 代码基线：**`b5e3ae4`**（`feat(v2.0.2): complete Wave A UI parity, Wave B 43-unit coordinates, and Wave C interaction coverage`，83 文件已提交，随本交接一并推送 `origin/main`）。
  * **工作区状态**：仅剩两份交接日志待提交并推送，推送后工作区洁净。
* **阶段里程碑现状**：
  * **Wave A（UI 1:1 视觉复刻与交互修复）— 已验收通过**：48px 顶栏/右三键/折叠左侧轨/272px 悬浮面板/渐变双曲线示波器/全屏 3D `RoomEnvironment` + 闭合磁感线 + `CSS2DRenderer` 矢量标签/E04·B3·B2·E10 标尺全部达标。
  * **Wave B（全仓 43 单元坐标系统一）— 已验收通过**：`PluginDefaultViewSpec` + `createWorldMapper`/`screenToWorld`/`resolveInitialCameraTransform` 落地，`43/43` 迁移对齐，`coordinate-alignment.test.ts` 全预设通过，实机六模型缩放/平移/复位全部通过。
  * **Wave C（交互覆盖齐平）— 已验收通过**：全仓实盘统计 **`getControlHandles` `43/43`（100%）**、**`getForceVectors` `30/43`（≥ 30）**、**`referenceFrames` `28/43`（≥ 20）**；总控直修 `SimulationStage.tsx` 随动参考系锁定角标与左下工具栏遮挡、`AutoFbdOverlay.tsx` 微观 SI 受力阈值/科学计数显示及 `wave-c-interaction.test.ts` 遍历用例 20s 超时保护。
* **最后一次代码改动后的真实独立复核结果**：
  * 类型与编译：`18` 项配置（`11` 个 `tsconfig.json` + `7` 个 `packages/*/tsconfig.build.json`）`tsc --noEmit` 与 `7` 个 workspace 包构建全过。
  * 单元测试：Vitest **`63` 文件 / `301` 用例全通过**（含 `wave-c-interaction.test.ts` 2/2、`coordinate-alignment.test.ts` 43/43、`catalog.test.ts` 44/44）。
  * 内容校验：`verify:packs`（6 包 20 题）、`verify:scenes`（10 场景）、`verify:vault`（43 单元 + ZIP `6080 B`）全通过；`git diff --check` 退出码 `0`。
  * 构建与单文件导出：`VITE_BASE_PATH=/PhysForge/` 构建成功，主入口 `index-LTu6VV9G.js` **`830.45 kB`（`gzip: 259.78 kB < 350 KB`）**；`modern-rutherford-bohr.html` 单文件导出 `2009.8 KB`。
  * 实机浏览器审计与看图：`visual-audit.mjs`（Wave A 4 场景 + Wave B 6 模型 + Wave C 3 交互场景，0 错误/0 外网请求）与 `e2e-subpath-and-export.mjs`（`directWebmBytes: 10458, pngBytes: 111632, drawerWebmBytes: 134308`）均 PASS；总控已多模态查验更新后的 `WaveC_Projectile_Frame.png`、`WaveC_Astro_FBD.png`、`WaveC_Rutherford_Handle.png` 及 `E04/B3/B2/E10` 截图，确认无重叠遮挡。
* **遗留风险与环境避坑**：
  * **在线 AI（BYOK）待检查联调**：用户明确要求推送 GitHub 后检查一下在线 AI（`@physforge/ai-copilot` / BYOK 真实服务商联调此前仅测离线与 mock 容错，未做真实在线端点实测）。
  * **Wave C 物理边界记录**：`em-ac-generator-rms` 受力采用正方形线圈近似且 `coil-frame` 为平动中心；`thermo-piston-gas-laws` 仅对有活塞/水银柱几何的模式输出矢量（`multi-stroke-pump` 无机械活塞位置状态，按反作弊原则返回 `[]`）；`stse-gravity-assist-rendezvous`、`thermo-cycles-kinetic-md` 等未强凑力矢，全仓真实受力模型为 `30/43`（满足 `≥ 30` 门禁）。
  * **Windows 工具链注意**：本机 Corepack `pnpm` 因 DNS 无法连接 `registry.npmjs.org` 会失败，需直接调用仓库本地二进制；PowerShell 5.1 不支持 `&&`/`||`；Playwright 脚本与 `.git/` 写入（`.git/index.lock`）需 `BypassSandbox: true`。
  * **非阻塞告警**：Vite 仍有 `[INEFFECTIVE_DYNAMIC_IMPORT]`（`em-induction-double-rod`）与大延迟 chunk 告警。
* **新会话总控第一优先级动作**：
  1. **检查与联调在线 AI（BYOK / `@physforge/ai-copilot`）**：审阅在线 AI 配置入口、提示词与前端交互链路，完成实机/实网可用性验证与必要的体验/稳定性修复；
  2. 在线 AI 检查通过后，按用户指示开启 V3（[V3_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V3_WRITER_CONSTRUCTION_PLAN.md)）Wave 1 施工排期（当前仓库仍处于 V2.0.2，V3 尚未开工）。

---

## 二、会话增量记录

### 2026-11-24 15:54 — Wave C 零信任验收通过与三处总控直修
* **Wave C 实盘核查与直修**：核验全仓 43 单元达成 **`getControlHandles` `43/43`**、**`getForceVectors` `30/43`**、**`referenceFrames` `28/43`**；多模态看图发现 `WaveC_Projectile_Frame.png` 中“随动参考系锁定”文字与左下角工具栏重叠，直修 [SimulationStage.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/SimulationStage.tsx) 移至左上角无遮挡带（避开 `AutoFbdBadge`）并补全 `latestRef.presentationMode`；同步修正 [AutoFbdOverlay.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/AutoFbdOverlay.tsx) 微观 SI 受力阈值（`1e-9`→相对 `maxMag * 1e-6` 与科学计数显示）及 [wave-c-interaction.test.ts](file:///d:/project%20code/44-PhysForge/simulations/wave-c-interaction.test.ts) 43 模型遍历用例 20s 超时。
* **全量终审门禁**：最后一次代码编辑后独立复跑 18 项 `tsc --noEmit` + 7 包构建、63 文件 / 301 用例 Vitest、3 项 verify、`/PhysForge/` 构建（主包 `259.78 kB` gzip）、`modern-rutherford-bohr` 单文件导出（`2009.8 KB`）、`visual-audit.mjs`、`e2e-subpath-and-export.mjs` 与 `WaveC_*.png` 复看全数 PASS。

### 2026-11-24 11:46–14:16 — Wave A 收尾直修 + Wave B 方案/全量验收 + Wave C 施工方案落盘
* **Wave A 终审直修**：在写手第 2 轮修复 5 项缺陷后，总控直接于 [ThreeStage.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/ThreeStage.tsx)、[index.css](file:///d:/project%20code/44-PhysForge/apps/web/src/index.css)、[visual-audit.mjs](file:///d:/project%20code/44-PhysForge/scripts/visual-audit.mjs) 与 [circuit-dc-capacitor-mna/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/circuit-dc-capacitor-mna/plugin.ts) 修复 `E10` 矢量标签远景漂移（改回箭头端点并加屏幕空间防重叠与深色胶囊衬底）与 `B2` 小灯泡电压表青色虚线并联引线，重跑全门禁与多模态看图验收通过。
* **Wave B 纠偏规划与零信任验收**：全仓 43 单元扫盘发现实际有 **39/43** 存在比例/锚点分叉、次分支遗漏或静默固定像素问题，据此落盘 [WAVE_B_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/WAVE_B_CONSTRUCTION_PLAN.md)（引入 `defaultView` + `createWorldMapper` + 全仓 `coordinate-alignment.test.ts`）。写手施工完成后，总控独立复跑全仓 11+7 编译、62 文件/299 测、3 项校验、`/PhysForge/` 构建（`253.61 KB` gzip）、单文件导出及 6 模型浏览器缩放平移审计并通过看图复核。
* **Wave C 施工方案编制**：核验全部 43 单元 `State`/`ParamSchema` 字段后落盘 [WAVE_C_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/WAVE_C_CONSTRUCTION_PLAN.md)（9 个无手柄模型直贴代码达成 `43/43`、物理真实性边界下补足 `32/43` Auto-FBD 与 `28/43` 随动系、配套 `wave-c-interaction.test.ts` 与 B6/C2 实机交互审计）。

### 2026-11-23 18:56 — `V2.0.1`（Wave 0）零信任验收与 Chrome/Edge WebM 根因修复（已合入 `main@16c5316`）
* 完成 `V2.0.1` 验收、修正 `mediaRecorder.ts` / `e2e-subpath-and-export.mjs` 跨浏览器自适应 `'video/webm'` 编码选择，并通过双端 E2E 与全部物理门禁后合入 `main@16c5316`。

---

## 三、历史归档摘要（V1.0 → V2-W6 & V3 规划，已合入或归档）
* **V1.0（`eb6b34c` → `62f9383`）**：Monorepo、7 大模型、PWA、离线 Excalidraw、单文件导出、6 教研包与 `verify:packs`。
* **V2-W1 ~ V2-W6（`61cad64` → `c4dbcfa`）**：V2 物理与 SDK 底座、分析/Vault/导出工坊、自由建模器 `B1–B5`、`catalog.ts` 首屏分包、43 单元物理矩阵、`@physforge/ai-copilot` 与 `verify:scenes`/`verify:vault`（57 文件 / 218 测全绿）。
* **V3 远期规划（已归档待后续排期）**：[PHYSFORGE_V3_SPATIAL_STAGE_BLUEPRINT.md](file:///d:/project%20code/44-PhysForge/docs/v3-specs/PHYSFORGE_V3_SPATIAL_STAGE_BLUEPRINT.md) 与 [V3_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V3_WRITER_CONSTRUCTION_PLAN.md)（待 Wave A–C 提交封板后再按用户指示推进）。
