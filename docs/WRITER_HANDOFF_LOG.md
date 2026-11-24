# PhysForge - 写手跨会话交接日志（Writer Handoff Log）

> **声明**：本文件仅作**写手角色（Writer）跨会话状态交接日志**，不替代项目权威规则（[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md)）或总控施工方案（[V2_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V2_WRITER_CONSTRUCTION_PLAN.md)），也不得写入或修改 [ARCHITECT_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/ARCHITECT_HANDOFF_LOG.md)。  
> **滚动上限**：不超过 **250 行 / 15 KB / 5 条会话增量**；超限写入时保留顶部当前权威快照、最近 1–2 轮详细增量及所有未闭环事项，将更早增量压缩为 3–8 行历史归档摘要。

---

## 当前施工快照（2026-11-24，V3.0，未封板）

* **第三轮累计交付入口（最新）**：`handoff/v3-complete-source-r3`，基于 r2，含 [#25](https://github.com/riyuewuxing/PhysForge/pull/25) @cb00fbd 与 [#26](https://github.com/riyuewuxing/PhysForge/pull/26) @0a7ee4c。#25 为 E10/S01/S02/M10 的 5 套新课件、21 分镜（累计 8 套；六旗舰均有课件）；#26 为演说屏独立可收起数值区、POE 遮罩、切模型/预设清除旧遥测、E10/S01/M10/M06/E04/S02 模式正确数值读出。新增实际引擎分镜定格、KaTeX 公式、参数 schema 与数值变化/DOM 稳定性回归断言。源码已提交，未运行完整门禁，先由本地总控验收；不要将累计分支直接合并 main。
* **第二轮累计交付入口**：`handoff/v3-complete-source-r2`，源码顶端 #24 @22dad2d；基于上一轮累计分支 d91eba0，叠加 #22→#23→#24。上一轮入口保留。仅供本地 Agent 审查、修复和整栈验收，不作为 main 合并目标。
  * [#22](https://github.com/riyuewuxing/PhysForge/pull/22)：活公式按实际子模式显示；E10、S01、M10、S02 绑定与量纲显示，微小量科学计数法，卸载取消未提交的拖动。S02 拖动审计显式选择速度选择器。
  * [#23](https://github.com/riyuewuxing/PhysForge/pull/23)：其余十个模型的模式相关公式与 B1 漂移参考系辅助圆统一，保持原求解器和观测键。
  * [#24](https://github.com/riyuewuxing/PhysForge/pull/24)：E10 proper rotation (det=+1)，统一侧视并修正比动能、洛伦兹加速度标注；M10 双星真实运动位置、引力矢量和随动系投影统一。新增几何断言。
* **本轮未执行运行验收**；优先检查公式条件/绑定、S02 模式切换、B1 漂移半径、E10 叉乘手性与 M10 共转系，再执行下述全部门禁。沿用原子 PR 验收规则。main 本轮末核实为 `3a667f88219c504fced84212881c49080b3ae372`。

* **上一轮交付入口**：`handoff/v3-complete-source`，供本地 Agent 拉取和整栈测试的累计源码分支，不是 release 或 main 合并目标。包含原 #2→#17 施工链、本轮 #18→#21、独立 #1 BYOK 五个文件（逐个 Git blob SHA 与 #1 一致）。#1 正式 PR 仍独立；不要把交付分支和各正式 PR 重复合并。保持总控的原子 PR 验收流程。
* 本轮用户明确要求云端写手推进源码，本地 Agent 负责测试、修复与实际验收。本轮新增：
  * [#18](https://github.com/riyuewuxing/PhysForge/pull/18) @330350e：实际执行 2D/3D 教学镜头关键帧、相机缓动与公式高亮；E04/B1 切镜，M06 取景；分镜选择和 FBD 控件。
  * [#19](https://github.com/riyuewuxing/PhysForge/pull/19) @d9a533c：插值结束再按目标参数复位；逐 240 Hz 物理步检测临界观测，保留命中快照；预设图层继承；真实分镜浏览器审计脚本。
  * [#20](https://github.com/riyuewuxing/PhysForge/pull/20) @d0a5f5a：E04 双杆安培力、电流箭头与累计电荷驱动的示意脉冲、不等杆长动生电动势公式；B1 数值引擎报告的出入边界标记。
  * [#21](https://github.com/riyuewuxing/PhysForge/pull/21) @b34722d：副屏指令绑定模型/分镜身份，拒绝旧课件命令，并增加直接跳转。
* **本地首要行动**：保留当前工作区，执行 `git fetch origin`；在独立分支或 worktree 检出 `origin/handoff/v3-complete-source-r3`。按项目约定安装现有依赖，再执行 `pnpm typecheck`、`pnpm test`、`pnpm verify:packs`、`pnpm verify:scenes`、`pnpm verify:vault`、`pnpm build`、`pnpm test:e2e:subpath`、`pnpm audit:visual`、`pnpm export:release --v3-audit`；检查 /PhysForge/ 子路径、gzip 首屏、六旗舰单文件预算与截图。真实 BYOK 联调必须由本地用户提供 Key，不提交 Key。
* **重点验收/修复顺序**：类型与构建 → 分镜快速切换/暂停/定格时间/公式拖拽与状态一致性 → 双屏跨模型与断开重连 → 六旗舰实机画质、2D/3D 投影及资源释放 → 全部导出。E04 电流脉冲仅为方向与累计电荷示意，非微观漂移速度；不等宽导轨连接仍为示意。S02、S01、M10 原有示意边界不变。本轮未执行运行测试，新回归测试仅为已提交的待执行代码。禁止提前声称 3.0 已验收。


* main 最后核实为 `3a667f88219c504fced84212881c49080b3ae372`；以下均为独立 Draft PR 或校验专用分支，不能视为已合并或发布。
* V3 实施依据：`docs/V3_WRITER_CONSTRUCTION_PLAN.md` 与 `docs/v3-specs/V3_ARCHITECT_BLUEPRINT_AND_HARD_CORES.md`；不改动 engine 与旧物理阈值，不替代总控验收。
* 施工链：[#1](https://github.com/riyuewuxing/PhysForge/pull/1) BYOK；[#2](https://github.com/riyuewuxing/PhysForge/pull/2) SDK/StoryRunner；[#3](https://github.com/riyuewuxing/PhysForge/pull/3) 三态演说；[#4](https://github.com/riyuewuxing/PhysForge/pull/4) 双屏；[#5](https://github.com/riyuewuxing/PhysForge/pull/5) 三个课件；[#6](https://github.com/riyuewuxing/PhysForge/pull/6) 活公式拖拽；[#7](https://github.com/riyuewuxing/PhysForge/pull/7) 与 [#8](https://github.com/riyuewuxing/PhysForge/pull/8) 15 模型绑定；[#9](https://github.com/riyuewuxing/PhysForge/pull/9) 3D 压平数学与材质；[#10](https://github.com/riyuewuxing/PhysForge/pull/10) E10；[#12](https://github.com/riyuewuxing/PhysForge/pull/12) E04/B1；[#14](https://github.com/riyuewuxing/PhysForge/pull/14) S02/M10；[#15](https://github.com/riyuewuxing/PhysForge/pull/15) S01；最终验收脚本分支 `chore/v3-w4b-audit-release`。#16 为已关闭的替代施工分支，不重复合入。
* 已核实 CI：#1、#2；[#11](https://github.com/riyuewuxing/PhysForge/pull/11) W1A+W1B（run 45365320013，verify 与 Playwright 均成功）；[#13](https://github.com/riyuewuxing/PhysForge/pull/13) W3A 独立数学核心（run 45365665722，同样成功）。#11/#13 为 CI-only 校验，禁止合入。其余实际累计链尚未取得全量 CI 实证，不能以独立测试通过代替累计通过。
* 最终门禁：保留旧视觉审计，增加六旗舰双向切镜、实际中间帧、WebGL 上下文失效、暂停时钟保持、自动定格与活公式真实指针拖拽；单文件六旗舰上限 2,500,000 bytes 与 Three.js module graph 防泄漏。脚本已写入，**尚未实际运行最终累计链**。
* 未闭环：本地按施工链逐个审查、CI 全量运行、实际查看 3D/2D 截图，验证每个物理投影/标签布局与资源释放（context lost 不等同于测得显存归零）；真实 BYOK 联调须用户配置 Key。E04 部分导轨为示意；S02 归一化轨迹/间隙提示是原理示意，非真实 RF 相位；M10 球体大小非按比例。通过全部门禁后由总控决定 merge 和 v3.0.0 tag。禁止提前声称封板。

---

## V2 历史状态快照（2026-11-24，V3 全波次草稿代码提交，未封板）

* 写手起点 main@3a667f88219c504fced84212881c49080b3ae372；未直推 main、未合并、未打 v3.0.0 标签。
* 独立 #1 Step 0；依赖链 #2→#3→#4→#5→#6→#7→#8→#9→#10→#12→#14→#15→本分支 `chore/v3-w4b-audit-release`。全部是待总控审阅的原子 PR。六旗舰空间视图、15 个高频模型活公式及三套示范课已提交代码；不能视为通过整体验收。
* CI 已验证：[#1](https://github.com/riyuewuxing/PhysForge/actions/runs/45362188181)、[#2](https://github.com/riyuewuxing/PhysForge/actions/runs/45362611166)、[#3 同 SHA 累积](https://github.com/riyuewuxing/PhysForge/actions/runs/45365320013)、[#9 独立相机数学核心](https://github.com/riyuewuxing/PhysForge/actions/runs/45365665722)，均 verify + Playwright 全绿。#11/#13 验证用 PR 已关闭；#16 备用 W4A 已关闭，额外公式及注释已迁入 canonical #15。其余叠加 PR 未跑整栈 CI（工作流仅触发目标 main）。
* 分支头部依次：#1 337ea3e；#2 47b9ab2；#3 94c6e38；#4 b391a2b；#5 3e61dcc；#6 e5c14f8；#7 1100cfe；#8 b462179；#9 571ff57；#10 4ae18b6；#12 f75969b；#14 3b97d99；#15 c0a8dd6。
* 总控须逐张检查 PR（单张≤12 文件）、调整下游 base 后跑 CI，不得直接把累计顶端 squash 进 main 绕过门禁。执行 typecheck/test/verify:packs/verify:scenes/verify:vault、VITE_BASE_PATH=/PhysForge/ 构建、test:e2e:subpath、audit:visual、`pnpm export:release --v3-audit`。实际查看 artifacts/ui-audit/V3_*.png；六旗舰单文件 <2,500,000 bytes 且不含 Three.js。通过全部门禁才允许总控封板。
* S02 轨迹是既有归一化示意而非完整 SI 数值轨迹；能量由已有内核计算。S01 逃逸锥为速度空间，模式相关投影采用 #15；M10 天体大小为示意。真实服务商 BYOK 实网与多设备副屏仍待现场联调。

---

## 历史验收基线（V2.0.2 Wave A–C 已验收并合入 main@b5e3ae4）

* **Git 基线与工作区边界**：当前基线为 `main@b5e3ae4`（已合并提交 Wave A UI 1:1 复刻、Wave B 43 单元坐标系、Wave C 43/43 手柄 + 30/43 Auto-FBD + 28/43 随动系及总控 3 处验收直修），随交接日志一并推送至 `origin/main`。该段仅记录 V2.0.2 的历史验收基线；V3 现状以上方快照为准。
* **全量门禁实证（总控终审后）**：18 项 TypeScript（11 `tsconfig.json` + 7 `tsconfig.build.json`）及 7 个 workspace 包构建全过；Vitest **63 文件 / 301 用例通过**（含 `wave-c-interaction.test.ts` 2/2、`coordinate-alignment.test.ts` 43/43、`catalog.test.ts` 44/44）；`verify:packs`（6 包/20 题）、`verify:scenes`（10 场景）、`verify:vault`（43 单元，ZIP 6080 B）全通过；`/PhysForge/` 主包 `index-LTu6VV9G.js` **259.78 kB gzip**，单文件 `modern-rutherford-bohr.html` 导出 `2009.8 KB`；`visual-audit.mjs`（0 错误/0 外网请求）与 `e2e-subpath-and-export.mjs`（direct WebM `10458 B`、PNG `111632 B`、drawer WebM `134308 B`）全通过；`git diff --check` 通过。
* **待后续治理与环境备注**：
  * **在线 AI（BYOK）待检查联调**：`@physforge/ai-copilot` 真实在线服务商实网链路尚未联调检查；
  * **既有非阻塞告警**：Vite 存在 `[INEFFECTIVE_DYNAMIC_IMPORT]`（`em-induction-double-rod`）与大延迟 chunk 告警；
  * **Windows 避坑**：Corepack `pnpm` 受 DNS 阻塞需直调本地 `node_modules` 二进制；PowerShell 5.1 不支持 `&&`/`||`；Playwright 与 Git 写入需 `BypassSandbox: true`。
* **历史派单记录（按 [V3_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V3_WRITER_CONSTRUCTION_PLAN.md) 原子 PR 派单执行）**：
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
