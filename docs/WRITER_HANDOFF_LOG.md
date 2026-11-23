# PhysForge - 写手跨会话交接日志（Writer Handoff Log）

> **声明**：本文件仅作**写手角色（Writer）跨会话状态交接日志**，不替代项目权威规则（[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md)）或总控施工方案（[V2_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V2_WRITER_CONSTRUCTION_PLAN.md)），也不得写入或修改 [ARCHITECT_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/ARCHITECT_HANDOFF_LOG.md)。  
> **滚动上限**：不超过 **250 行 / 15 KB / 5 条会话增量**；超限写入时保留顶部当前权威快照、最近 1–2 轮详细增量及所有未闭环事项，将更早增量压缩为 3–8 行历史归档摘要。

---

## 当前权威状态快照（2026-11-23，本轮 V2.0.1 承接后）

* **Git 分支与最新基线**：
  * 本地仓库位于 `main` 分支，**最新提交 `HEAD = c4dbcfa`**（`feat(v2-w6): complete 43-unit PhysForge V2.0 with STSE, error labs, competition physics and AI copilot`），**`V2-W1 ~ V2-W6` 全量 43 单元与 V2.0 平台底座已全部验收合并并推送至 `origin/main`**。
  * 当前工作区有本轮 V2.0.1 写手源码、测试、CI 与场景资产改动，均未提交；同时保留总控侧既有审查文档与日志：
    * `M docs/ARCHITECT_HANDOFF_LOG.md`（总控专属，**写手严禁修改**）
    * `?? docs/PHYSFORGE_V2_REVIEW_OVERVIEW.md` / `?? docs/PHYSFORGE_V2_UNITS_AND_GATES.md` / `?? docs/V3_WRITER_CONSTRUCTION_PLAN.md` / `?? docs/v3-specs/`
    * `M docs/WRITER_HANDOFF_LOG.md`（本文件）
  * 远端：`origin = https://github.com/riyuewuxing/PhysForge.git`。
* **权威参考文档**：
  * 仓库宪法：[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md) ｜ V2 施工方案：[docs/V2_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V2_WRITER_CONSTRUCTION_PLAN.md) ｜ 三卷规格：`docs/v2-specs/01~03.md` ｜ 现况总览：[PHYSFORGE_V2_REVIEW_OVERVIEW.md](file:///d:/project%20code/44-PhysForge/docs/PHYSFORGE_V2_REVIEW_OVERVIEW.md) / [PHYSFORGE_V2_UNITS_AND_GATES.md](file:///d:/project%20code/44-PhysForge/docs/PHYSFORGE_V2_UNITS_AND_GATES.md)
* **V2.0.1 本轮改动与门禁实测**（基线仍为 `main@c4dbcfa`，本轮改动尚未提交）：
  * `pnpm` Corepack shim 因访问 `registry.npmjs.org` DNS 失败无法启动；改用仓库本地 Vitest/TypeScript/Vite 与验证脚本完成等价检查。
  * 全工作区 TypeScript 检查通过；全量 Vitest **60 个文件 / 240 条用例**通过。
  * `verify:packs`：6 份教学包、20 道物理验算题通过；`verify:scenes`：10 份 SceneDSL / preset 通过；`verify:vault`：43 单元目录、10 份内置场景、ZIP 与搜索检查通过。
  * 工作区包 TypeScript build 与单文件导出构建通过；`VITE_BASE_PATH=/PhysForge/` 生产构建通过。HTML 实际入口 gzip **244.82 KB**（低于 350 KB），入口未发现被禁止的重型依赖标记；PWA 生成 502 个预缓存条目。
  * 最新产物 Playwright 子路径 E2E 通过：WebM 47,381 B、PNG 48,900 B、抽屉 WebM 105,198 B；并覆盖 SVG/TikZ 下载、S01 ThreeStage 懒加载和 S02 卸载。
  * `git diff --check` 通过。未执行提交或推送；`docs/ARCHITECT_HANDOFF_LOG.md` 是既有总控修改，本轮未触碰。
* **已知非阻塞债务与后续可承接方向（`V2.1` 候选）**：
  1. **V2 交互钩子全覆盖补齐**：本轮为七个现存模型补充或修正控制、力矢量/参考系；其余模型的 `getControlHandles`、`getForceVectors`/Auto-FBD、`referenceFrames` 覆盖率仍需按施工计划审计。
  2. **教研资产扩充**：`content/teaching-packs/` 仍为 6 份 20 题；本轮将 SceneDSL / preset 总数增至 10，后续可继续覆盖其余 V2 单元。
  3. **运行态补验项**：BYOK helper 与错误分支已有单元测试，但尚未使用真实商用 LLM API 联调；旋转盘非惯性参考系无法由当前 SDK 的纯平移 `ReferenceFrameSpec` 表达，插件保留双轨迹显示；`useClassroomStore.ts` 仍同步预置默认首模型 `em-bounded-magnetic-field`。
* **Windows 环境避坑清单**：
  * PowerShell 5.1 不支持 `&&` 链式拼接，请用 `; if ($LASTEXITCODE -eq 0) { ... }`；
  * 带 `[` 的命令勿直接塞入双引号 `node -e "..."`，请写进 `scratch/*.mjs`；
  * 沙盒内 Playwright 需传 `{ channel: 'chrome', headless: true }`，Node ESM 从外部导入根目录 `playwright` 用 `createRequire('D:/project code/44-PhysForge/package.json')`；本地预览服须与 Playwright 同进程启动。
* **新会话第一优先级动作**：
  1. 执行 `git status --short; git log -n 5 --oneline` 核验当前是否仍为 `main@c4dbcfa` 且无未追踪代码冲突；
  2. 接收用户或总控下发的下一轮指令（例如根据线上 AI 对 `PHYSFORGE_V2_REVIEW_OVERVIEW.md` 的评审结论开展 `V2.1` 补强、新增教研包/Preset、补齐剩余模型 `ControlHandle`/`Auto-FBD`，或定向缺陷修复），按 `AGENTS.md` 门禁推进。

---

## 会话增量记录

### [2026-11-23 17:16 +08:00] V2.0 封板状态确认与写手跨会话交接快照归档

* 核对 Git 基线已由总控完成 `V2-W6` 终版验收提交并推送（`main@c4dbcfa`），V2.0 规划全部 43 单元与 8 大平台模块均已进入远端基线；
* 本轮无代码文件修改，仅更新交接快照、整理非阻塞债务清单（交互钩子覆盖差 / 教研资产密度 / `/PhysForge/` 全路径 E2E 复验 / BYOK 实网联调）及 Windows 沙盒避坑约定，确保新写手会话一键无缝接手。

---

### [2026-11-23 18:32 +08:00] V2.0.1 写手承接：交互钩子、B2 可视化、导出验证与 BYOK / SceneDSL

* 为 `mech-conical-turntable`、`mech-spring-separation`、`comp-rigid-rolling-slip`、`exp-electrical-error-lab`、`exp-mechanics-error-lab`、`stse-gravity-assist-rendezvous`、`comp-chaos-normal-coriolis` 补齐控制/力矢量/参考系细节与回归用例；E04 零电阻教学情形也已从参数界面开放并覆盖回归。
* `circuit-dc-capacitor-mna` 增加电势着色、带符号电流动画、短路提醒与闭合电源短路预设，并将短路事件限制到真实闭合电源拓扑；BYOK JSON 响应解析增加 fenced/prose/超时/CORS/HTTP 错误处理；新增 6 份通过校验的 SceneDSL preset。
* 媒体录制器改善 WebM codec/timeslice/帧请求和停止时数据收尾；新增 `/PhysForge/` Playwright 子路径、导出和 ThreeStage 懒加载 CI smoke job。
* 检查结果见本文件上方最新权威快照。`pnpm` shim 受 DNS 限制，已用本地等价命令完成验证；真实 BYOK 服务商联调未做。所有源码改动仍在工作区待总控审阅，未提交/推送。

---

### [2026-11-22 23:11 +08:00] 历史归档摘要（V1.0 → V2-W6，全部 43 单元已合入 `origin/main`）

* **V1.0（`eb6b34c`–`62f9383`）**：完成 Monorepo、7 个基础模型、PWA、离线 Excalidraw、单文件导出、6 教研包与 `verify:packs`；
* **V2-W1（`61cad64`）**：完成 `physics-core` 7 大模块、`sim-sdk` V2、`analysis-lab`、`workspace-vault`、交互尺规与 CI/Pages；
* **V2-W2（`3e86d3b`）**：交付 `@physforge/export-studio`（SVG/PNG/TikZ/WebM）与自由建模器 `B1–B5`（懒加载 `mathjs@15.2.0` + V1 别名）；
* **V2-W3（`7c252a7`）**：交付力学与天体全矩阵 `M01–M11`；
* **V2-W4（`e2d4bb6`）**：完成 `@physforge/simulations/catalog` 首屏按需动态拆包与电磁/3D 场 `E01–E10`；
* **V2-W5（`3d7f8f8`）**：交付波光热近现代矩阵 `W01–W02, O01, T01–T02, N01–N03`；
* **V2-W6（`c4dbcfa`）**：交付 `S01–S04` STSE、`X01–X02` 真误差实验、`C01–C03` 强基竞赛、`@physforge/ai-copilot`、`verify:scenes` / `verify:vault`、批量单文件导出及 43 单元全链路收官（57 测试文件 / 218 用例全绿）。
