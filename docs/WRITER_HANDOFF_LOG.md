# PhysForge - 写手跨会话交接日志（Writer Handoff Log）

> **声明**：本文件仅作**写手角色（Writer）跨会话状态交接日志**，不替代项目权威规则（[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md)）或总控施工方案（[V2_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V2_WRITER_CONSTRUCTION_PLAN.md)），也不得写入或修改 [ARCHITECT_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/ARCHITECT_HANDOFF_LOG.md)。  
> **滚动上限**：不超过 **250 行 / 15 KB / 5 条会话增量**；超限写入时保留顶部当前权威快照、最近 1–2 轮详细增量及所有未闭环事项，将更早增量压缩为 3–8 行历史归档摘要。

---

## 当前权威状态快照（2026-11-22 21:02）

* **Git 分支与基线**：
  * 本地仓库位于 `main` 分支（`HEAD = 3e86d3b` 为已验收的 V2-W2 基线）；当前 `V2-W3` 全部新增与修改文件（4 个修改文件 + 10 个新建仿真模块目录共 50 个源码/规格/测试文件）处于本地工作区未提交状态，未执行 `git commit` / `git push`，等待总控验收。
  * 远端：`origin = https://github.com/riyuewuxing/PhysForge.git`。
* **权威参考文档**：
  * 仓库宪法：[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md) ｜ V2 权威施工方案：[docs/V2_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V2_WRITER_CONSTRUCTION_PLAN.md) ｜ 第2卷模型规格：[docs/v2-specs/02_MODELS_BUILDERS_AND_MECHANICS_EM.md](file:///d:/project%20code/44-PhysForge/docs/v2-specs/02_MODELS_BUILDERS_AND_MECHANICS_EM.md)
* **当前施工状态**：**V2-W3（力学与天体全矩阵 `M01–M11`，含 `M05` V2 原地升级及 10 个新建单元）已全量竣工并跑通最后一次编辑后的全部门禁与 Playwright 实机回归验证，等待总控验收**。
* **最后一次代码编辑后的实测门禁结果**：
  * **静态合规扫描**：全仓（`packages/`、`simulations/`、`apps/`、`scripts/` 非构建/非 `node_modules` 源码）零 `@ts-ignore`、零 `@ts-expect-error`、零 `as any`、零 `eslint-disable`、零 `.skip(`/`.only(`、零 `Math.random(`（仅 `B5` 恶意表达式测试字面量包含 `'eval("1+1")'`）。
  * `pnpm typecheck`：退出码 `0`（9/9 有该脚本工作区子包 + `scripts/tsconfig.json` 通过）。
  * `pnpm test`：退出码 `0`（**30 个测试文件、90/90 条用例全绿**，耗时 `2.73s`）。
  * `pnpm verify:packs`：退出码 `0`（6/6 教研包、20/20 道物理验算题全通过）。
  * `pnpm build` & 体积隔离：主入口 `dist/assets/index-DXvy7LOr.js` 体积 `969.55 kB` / gzip **`304.82 kB`**（`< 350 KB`），异步独立分包 `ThreeStage` (`135.59 kB` gzip)、`AnalysisLabDrawer` (`17.17 kB` gzip)、`esm` (`mathjs`, `209.30 kB` gzip)、`rapier` (`1,283.02 kB` gzip)，PWA `450 entries`。
  * `pnpm export:singlefile --model=astro-orbital-mechanics`：`2009.4 KB`，通过零外网 CDN 与零重型库/跨模型泄漏校验。
  * **Playwright 无头 Chrome 全 11 模型实机验证**（`http://127.0.0.1:4175/`）：校验教材分册筛选（`选择性必修一` / `必修第二册`）并依次切换 `M01–M11` 全部 11 个模型，确认主画布 `<canvas>` 非空白渲染、支持模型切换 `Auto-FBD`、且 `ExportStudioDrawer` 均成功生成并下载有效 `<svg>` 试卷配图；全程 `consoleErrors: []`、`pageErrors: []`、`failed404: []`、`externalRequests: []`。
* **下一优先级动作**：请总控对 `V2-W3` 进行零信任验收；验收通过后按规划推进 `V2-W4`（电磁学全矩阵与 3D 空间场 `E01–E10`）。

---

## 会话增量记录

### [2026-11-22 21:02 +08:00] 完成 V2-W3（力学与天体物理全矩阵 `M01–M11`，11 单元）全量交付

* **分批落地与统一注册**（[simulations/registry.ts](file:///d:/project%20code/44-PhysForge/simulations/registry.ts)、[simulations/package.json](file:///d:/project%20code/44-PhysForge/simulations/package.json)、[apps/singlefile-exporter/export.mjs](file:///d:/project%20code/44-PhysForge/apps/singlefile-exporter/export.mjs)）：
  * **`M01–M04` 运动学与平面动力学**：
    * `M01` [mech-kinematics-chase](file:///d:/project%20code/44-PhysForge/simulations/mech-kinematics-chase/plugin.ts)（追及相遇、反应延迟、刹车单向锁定、`bisectEvent` 共速与追及时刻 `< 1e-7 s`、A 车随动参考系，2 测）
    * `M02` [mech-dynamic-equilibrium](file:///d:/project%20code/44-PhysForge/simulations/mech-dynamic-equilibrium/plugin.ts)（动态平衡矢量三角形、死结旋转、活结滑轮、半球面相似三角形、`Auto-FBD`、合力残差 `< 1e-10 N`，1 测）
    * `M03` [mech-constrained-velocity](file:///d:/project%20code/44-PhysForge/simulations/mech-constrained-velocity/plugin.ts)（关联速度：拉船、梯子滑墙、楔块落杆投影约束及方向验证 `< 1e-10 m/s`，1 测）
    * `M04` [mech-projectile-coupling](file:///d:/project%20code/44-PhysForge/simulations/mech-projectile-coupling/plugin.ts)（平抛/斜抛耦合斜面、半圆槽、`RK4` 二次空气阻力对比与安全抛射包络线，1 测）
  * **`M05–M08` 进阶动力学与圆周/弹簧临界**：
    * `M05` [mech-block-conveyor](file:///d:/project%20code/44-PhysForge/simulations/mech-block-conveyor/plugin.ts)（V2 原地升级：保留全部 V1 预设与 4 单测，新增带速 `ControlHandle`、受力矢量、`carrier` 随动参考系、`SceneDSL` 与 `DiagramIR`）
    * `M06` [mech-vertical-circular](file:///d:/project%20code/44-PhysForge/simulations/mech-vertical-circular/plugin.ts)（竖直圆周三态：`Udwadia-Kalaba` 约束求支/拉力、`bisectEvent` 脱轨切抛、`arccos(2/3)` `< 1e-6 rad`、能量漂移 `< 1e-6`，1 测）
    * `M07` [mech-conical-turntable](file:///d:/project%20code/44-PhysForge/simulations/mech-conical-turntable/plugin.ts)（转盘双物块临界角速度 `ω₁, ω₂, ω₃` 解析吻合 `< 1e-10` 与圆锥摆验证，1 测）
    * `M08` [mech-spring-separation](file:///d:/project%20code/44-PhysForge/simulations/mech-spring-separation/plugin.ts)（含弹簧连接体斜面/水平牵引分离、`bisectEvent` 捕获 `F_N=0` 精确位置 `< 1e-7`，1 测）
  * **`M09–M11` 动量碰撞、天体轨道与简谐共振**：
    * `M09` [mech-collision-recoil](file:///d:/project%20code/44-PhysForge/simulations/mech-collision-recoil/plugin.ts)（一维/二维恢复系数斜碰动量矢量三角形、等质量弹性正交分离 `|v₁'·v₂'| < 1e-9`、子弹打木块共速 `Q=f·d`、人船质心恒定，4 测）
    * `M10` [astro-orbital-mechanics](file:///d:/project%20code/44-PhysForge/simulations/astro-orbital-mechanics/plugin.ts)（**无量纲 `ScaleContext` 归一化 + 四阶 Yoshida `stepVelocityVerlet` 辛组合**；50 周期能量/半长轴漂移 `< 1e-6`、角动量 `< 1e-7`；霍曼双脉冲转移 `< 1e-5`；双星 `L₁–L₅` 与洛希 `extractIsolines`，3 测）
    * `M11` [mech-shm-resonance](file:///d:/project%20code/44-PhysForge/simulations/mech-shm-resonance/plugin.ts)（非线性受迫阻尼单摆 + 简谐幽灵摆对照 + 参考圆；2° 小角周期误差 `< 1e-4`、60° 无阻尼能量漂移 `< 1e-6`、共振峰匹配 `√(ω₀² - 2γ²)`，4 测）

---

### [2026-11-22 20:31 +08:00] 完成 V2-W2（`export-studio` + 五大自由建模器 `B1–B5`）

* 交付 `@physforge/export-studio`（黑白打印 SVG / 600DPI PNG / LaTeX TikZ / WebM 录屏 / 频闪长图）、`--preset-file` 单文件增强及 `B1–B5`（含 `LEGACY_MODEL_ALIASES` 与懒加载 `mathjs@15.2.0` 白名单 AST 沙箱）；71 测全绿，合入 `3e86d3b`。

---

### [2026-11-22 15:55–19:53 +08:00] 历史归档摘要（V1.0 `62f9383` & V2-W1 `61cad64`）

* V1.0 完成 Monorepo、7 大模型、离线 Excalidraw、单文件导出与 6 套防幻觉教研包（46 测 20 题）；V2-W1 完成 `physics-core` 7 大 V2 内核、`SimulationPluginV2`、`analysis-lab`、`workspace-vault`、画布直操/尺规/Auto-FBD/3D、`VITE_BASE_PATH` 修复与 CI/Pages 流水线（合入 `61cad64`）。
