# PhysForge - 写手跨会话交接日志（Writer Handoff Log）

> **声明**：本文件仅作**写手角色（Writer）跨会话状态交接日志**，不替代项目权威规则（[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md)）或总控施工方案（[V2_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V2_WRITER_CONSTRUCTION_PLAN.md)），也不得写入或修改 [ARCHITECT_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/ARCHITECT_HANDOFF_LOG.md)。  
> **滚动上限**：不超过 **250 行 / 15 KB / 5 条会话增量**；超限写入时保留顶部当前权威快照、最近 1–2 轮详细增量及所有未闭环事项，将更早增量压缩为 3–8 行历史归档摘要。

---

## 当前施工快照（2026-11-24，V3.0 已验收封板合入 `main` 并发布 `v3.0.0`）

* **Git 基线与发布状态**：基于云端 `handoff/v3-complete-source-r6@9a49b91` + 总控 7 项直修 + 本地 Luna L1–L3 深化，经总控零信任验收全绿后合入 `main` 并打 `v3.0.0` 标签推送至 `origin`。
* **最终门禁实证（总控终审复跑）**：18 项 TypeScript（11 `tsconfig.json` + 7 `tsconfig.build.json`）及 7 个 workspace 包构建全过；Vitest **77 文件 / 425 用例通过**；6 教研包/20 题、10 场景、43 单元 Vault 校验全过；`/PhysForge/` 主入口 `index-CD681VWE.js` **271.43 kB gzip**（`< 350 KB`、零重型泄漏）；6 旗舰离线单文件导出 `2009.2–2022.5 KB`；`visual-audit.mjs`（0 错误/0 外网请求）与 `e2e-subpath-and-export.mjs`（direct WebM `53801 B`、PNG `121883 B`、drawer WebM `128015 B`）全通过，实机截图多模态核验达标；`git diff --check` 通过。
* **如实未测与延后事项（Online AI / BYOK）**：
  * `@physforge/ai-copilot` 已合入 PR-0 的 Schema 感知提示、未知参数键拦截与自修正反馈、前端提供商模板与连通性探测，离线单测（`byokClient.test.ts` 12/12、`ai-copilot.test.ts` 5/5）全绿；
  * **但尚未在浏览器中使用真实外部大模型 API Key 进行实网在线联调（已按用户明确指示暂缓，留待用户日后决定启用时再单独实测）**。
* **既有非阻塞告警与环境备注**：Vite 构建仍有 `[INEFFECTIVE_DYNAMIC_IMPORT]`（`em-induction-double-rod`）与大延迟 chunk 提示；Windows 本机 Corepack 受 DNS 阻塞需直调 `node_modules` 二进制，Playwright 与 Git 写入需 `BypassSandbox: true`。

---

## 会话增量记录

### [2026-11-24 23:06 +09:00] 云端 Turn 2：预设标识与公网验收

* 基于 PR #34 已绿的 `193914e`，修复外部参数载入后错误沿用命名预设的显示问题。仅当实际解析参数等于该预设解析参数才保留 ID，否则显示自定义参数；参数解析与图层契约不变。新增三项真实 store 测试和浏览器 400 nm 自定义/405 nm 原预设恢复断言。
* Pages 部署增加只读公网 Chromium 复验 job，记录实际发布入口 JS、核对线上资源、用拦截 fixture 复用完整 BYOK 链路与截图（无真实 Key）。用户授权本轮测试通过后合并部署，正式 `v3.0.0` 标签保留。用户本人在线输入 DeepSeek Key 的真实认证仍是独立出口。
* 本轮最终 SHA、运行 ID、实际截图审查和 Library 更新以 PR 最终评论及 Library 03 为准。

### [2026-11-24 22:58 +09:00] 云端接手 Turn 1：BYOK 专项候选（草稿 PR #34）

* 发布基线 `main` / `v3.0.0` 同为 `3d4a528`，CI 45404961984 与 Pages 45404961882 通过。浏览器独立访问正式站工作台、AI 抽屉成功。正式站仍是原 V3.0，未合并、未发布候选。
* 独立分支 `fix/byok-deepseek-online`：DeepSeek 当前 `deepseek-flash` / `deepseek-v4-pro`，现有 OpenAI / 硅基流动 / Gemini / 自定义兼容端点；显式页内内存保存、清除、切换 URL 清 Key、关闭在线模式不自动恢复、模型目录、错误脱敏、拒绝重定向、请求取消。默认离线，在线缺 Key 不静默回退。DeepSeek 默认非思考 JSON 输出、2048 tokens、60s 请求时限；无新增依赖、无物理解算器改动。
* `4924c44` 的专项 run 45408439839 已下载真实截图与 report（artifact 14926677222，SHA256 6c5f8e176224daf34dbb7aeb664385d990f35f36bec70d3b8c81c272b9a459f5）：正式站 PASS，模拟端到端 PASS（400 nm 钠阴极光电效应，虚构参数拒绝→第2轮纠正→实际工作台参数400 nm；401错误不回显原文、刷新清 Key）。DeepSeek 两端点 OPTIONS 200 且允许 Pages Origin、authorization；OpenAI/Gemini 预检亦符合；硅基流动仅通配 allow-headers，Authorization 不可据此认定允许。真实带 Key 请求尚未测，必须由用户在自己可信网页输入，绝不经聊天/仓库/CI日志。OpenAI/Google 官方建议服务端保存长期密钥；页面内存不能抵御恶意脚本或扩展。
* 两次早期专项浏览器失败均是 Vite preview 未继承构建的 /PhysForge/ base，不是公网/CORS失败；已修正并取得上述 PASS。实际读图发现原抽屉背景透字，已修成不透明；随后发现结果卡需自动滚动、载入后旧工具菜单挡住控制面板，`a04cb9f` 修复并增加浏览器断言，待同一候选 HEAD 的 CI、专项图、完整视觉及导出复验。
* 下一步只完成 BYOK 验收：核实本 PR 最新 HEAD、全部门禁及实际截图、再由总控/用户明确授权合并部署；用户在正式页自行测试认证与生成。不提前推进 V3.1。最新终轮证据以 PR #34 最后核验评论及 Library /PhysForge/03 为准。

### [2026-11-24 21:28 +08:00] V3.0 终审封板合入 `main` 与 `v3.0.0` 发布（总控同步）

* 总控独立复验 Luna L1–L3 全部改动与全套门禁后，将 `v3-review` 合并进 `main`、打 `v3.0.0` Tag 并推送 GitHub；在线 AI 真密钥实网联调按用户要求如实记录为“已过离线单测、暂缓实网验证”。

### [2026-11-24] V3.0 L1–L3 视觉收尾（写手交付）

* 保持在 `v3-review` 分支，保留总控 7 个文件直修改动，完成 L1（B1 `z=±0.22` 磁域边界环/线框与初速度矢量）、L2（M10 解析开普勒轨道与恒星晕环）、L3（E10 对称磁感线种子与 2D 线圈 `⊙/⊗` 截面符号及切线箭头）并补齐 3 组回归断言；Vitest 77 文件 / 425 用例与浏览器实测全绿。

### [2026-11-24] V3.0 云端全栈施工（GPT-6.2 Sol `handoff/v3-complete-source-r6@9a49b91`）

* 交付 PR-0（BYOK Schema 感知）、Wave 1–2（`StoryRunner`、三态演说壳、双屏 `PresenterSyncBridge`、活公式拖拽与 15 模型绑定）、Wave 3–4（`CameraMorphController`、5 套 PBR 材质与 6 旗舰 3D/压平对齐及 8 套 `StoryDeck`），本地总控直修 5 项回归/重叠/超时问题后由 Luna 接力完成 L1–L3。

---

### [2026-11-22 ~ 2026-11-24] 历史归档摘要（V1.0 → V2.0.2 Wave A–C，已合入）

* **V1.0 → V2.0.1（`eb6b34c` → `16c5316`）**：Monorepo、43 单元物理矩阵、8 大平台底座、6 教研包、10 场景、BYOK 容错与 WebM 跨端修复。
* **V2.0.2 Wave A–C（`b5e3ae4`）**：UI 1:1 视觉重构、全仓 43 单元 `createWorldMapper` 坐标统一及 `43/43` 手柄 + `30/43` Auto-FBD + `28/43` 随动系。

---

### [2026-11-22 ~ 2026-11-24] 历史归档摘要（V1.0 → Wave A，已全部合入 `main`）

* **V1.0 → V2-W6（`eb6b34c` → `c4dbcfa`）**：完成 Monorepo、43 单元物理仿真矩阵、8 大平台底座（`physics-core` / `sim-sdk` / `analysis-lab` / `export-studio` / `ai-copilot` / `workspace-vault`）、6 套教研包与 `verify:packs`/`scenes`/`vault`。
* **V2.0.1 & Wave A（`16c5316` → `b5e3ae4`）**：完成交互钩子/BYOK 容错/WebM 跨端修复、工作台 UI 1:1 视觉复刻（48px 顶栏/折叠左侧轨/272px 悬浮面板/3D `RoomEnvironment` + 闭合磁感线 + `CSS2DRenderer` 矢量标签）及 E04·B3·B2·E10 标尺审计。
