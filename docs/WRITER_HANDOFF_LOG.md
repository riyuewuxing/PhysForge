# PhysForge - 写手跨会话交接日志（Writer Handoff Log）

> **声明**：本文件仅作**写手角色（Writer）跨会话状态交接日志**，不替代项目权威规则（[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md)）或总控施工方案（[V2_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V2_WRITER_CONSTRUCTION_PLAN.md)），也不得写入或修改 [ARCHITECT_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/ARCHITECT_HANDOFF_LOG.md)。  
> **滚动上限**：不超过 **250 行 / 15 KB / 5 条会话增量**；超限写入时保留顶部当前权威快照、最近 1–2 轮详细增量及所有未闭环事项，将更早增量压缩为 3–8 行历史归档摘要。

---

## 当前权威状态快照（2026-11-22 21:28）

* **Git 分支与基线**：
  * 本地仓库位于 `main` 分支（`HEAD = 7c252a7` 为已验收的 V2-W3 基线）；当前 `V2-W4` 全部新增与修改文件（按需懒加载目录重构 + `E01–E10`）处于本地工作区未提交状态，未执行 `git commit` / `git push`，等待总控验收。
  * 远端：`origin = https://github.com/riyuewuxing/PhysForge.git`。
* **权威参考文档**：
  * 仓库宪法：[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md) ｜ V2 权威施工方案：[docs/V2_WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/V2_WRITER_CONSTRUCTION_PLAN.md) ｜ 第2卷模型规格：[docs/v2-specs/02_MODELS_BUILDERS_AND_MECHANICS_EM.md](file:///d:/project%20code/44-PhysForge/docs/v2-specs/02_MODELS_BUILDERS_AND_MECHANICS_EM.md)
* **当前施工状态**：**V2-W4（`apps/web` 按需动态加载拆包重构 + 电磁学全矩阵与 3D 空间场 `E01–E10`）已全量竣工并跑通最后一次编辑后的全部门禁与 Playwright 实机验证，等待总控验收**。
* **最后一次代码编辑后的实测门禁结果**：
  * **静态合规扫描**：全仓（`packages/`、`simulations/`、`apps/`、`scripts/` 非构建/非 `node_modules` 源码）零 `@ts-ignore`、零 `@ts-expect-error`、零 `as any`、零 `eslint-disable`、零 `.skip(`/`.only(`、零 `Math.random(`（仅 `B5` 恶意用例测试字面量第 22 行含 `'eval("1+1")'`）。
  * `pnpm typecheck`：退出码 `0`（9/9 有脚本工作区子包 + `scripts/tsconfig.json` 通过）。
  * `pnpm test`：退出码 `0`（**40 个测试文件、121/121 条用例全绿**，耗时 `2.97s`）。
  * `pnpm verify:packs`：退出码 `0`（6/6 教研包、20/20 道物理验算题全通过）。
  * `pnpm build` & 首屏体积（接通全部 27 模型后较 `V2-W3` 逆势大幅回落）：
    * 主入口 `dist/assets/index-CeReMVYR.js` 体积 `787.68 kB` / Vite gzip **`247.86 kB`**（Node zlib **`242.05 KB`**，远低于 `< 350 KB` CI 红线，预留 >100 KB 空间）；
    * 异步独立分包：`ThreeStage-Cq5PYtBK.js` (`136.14 kB` gzip)、`AnalysisLabDrawer` (`17.17 kB` gzip)、`esm` (`mathjs`, `209.30 kB` gzip)、`rapier` (`1,283.02 kB` gzip)；PWA `479 entries`。
  * `pnpm export:singlefile` 实测：`em-electrostatic-field.html`（`2007.4 KB`）、`em-3d-magnetic-fields.html`（`2003.0 KB`），均通过零 CDN 与防 `three`/`mathjs`/`rapier`/`papaparse`/`fflate` 泄漏检查。
  * **Playwright 无头 Chrome 实机全链路验收**（`http://127.0.0.1:4176/`）：
    * 首屏未请求任何 `ThreeStage` / `three` 分包（`initialThreeChunks: []`）；
    * 教材分册筛选（`必修第三册` / `选择性必修二`）准确命中，`E01–E09` 全部 9 个模型 `<canvas>` 非空白渲染且 `ExportStudioDrawer` 均成功导出有效 `<svg>`；
    * 切入 `E10`（`em-3d-magnetic-fields`）后才按需拉取 `ThreeStage-Cq5PYtBK.js`，WebGL `<canvas>`（`746x425`）成功挂载，切离后 `three-stage-container` 彻底卸载销毁并释放 WebGL；
    * 全程 `consoleErrors: []`、`pageErrors: []`、`failed404: []`、`externalRequests: []`。
* **下一优先级动作**：请总控对 `V2-W4` 进行零信任验收；验收通过后按规划推进 `V2-W5`（波动光学、热学微观与近代物理 `W01–W02, O01, T01–T02, N01–N03`，8 单元）。

---

## 会话增量记录

### [2026-11-22 21:28 +08:00] 完成 `V2-W4`（首屏按需目录重构 + 电磁学全矩阵与 3D 空间场 `E01–E10`）

1. **首屏按需动态加载拆包重构（落实总控预警）**：
   * 新增 [@physforge/simulations/catalog](file:///d:/project%20code/44-PhysForge/simulations/catalog.ts)（仅含 27 个模型 `meta` 摘要 + 显式静态路径 `import('./<dir>/plugin.js')` 动态 `loadSimulationById(id)` + `LEGACY_MODEL_ALIASES`）与一致校验 [catalog.test.ts](file:///d:/project%20code/44-PhysForge/simulations/catalog.test.ts)；
   * 保留 [simulations/registry.ts](file:///d:/project%20code/44-PhysForge/simulations/registry.ts) 供 `vitest` / `verify:packs` / `sweep.worker.ts` 同步全量引用；
   * 改造 [useClassroomStore.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/store/useClassroomStore.ts)、[App.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/App.tsx)、[LeftCatalogSidebar.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/LeftCatalogSidebar.tsx)、[CommandPalette.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/CommandPalette.tsx)、[TeachingPackDrawer.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/TeachingPackDrawer.tsx)，仅同步预置默认模型 `B1` 保持首帧零闪烁，其余模型按需异步拆包加载，使首屏主入口逆势从 `304.82 kB` 降至 `247.86 kB` gzip。

2. **电磁学全矩阵与 3D 空间场（`E01–E10`）**：
   * `E01` [em-electrostatic-field](file:///d:/project%20code/44-PhysForge/simulations/em-electrostatic-field/plugin.ts)：`121×89` `extractIsolines` 等势线与场强正交偏差 `< 1°`、`RK45` 试探粒子能量误差 `< 1e-5`、三点等分法与偏转板公式 `< 1e-6`（4 测）。
   * `E02` [em-capacitor-millikan](file:///d:/project%20code/44-PhysForge/simulations/em-capacitor-millikan/plugin.ts)：闭合/断开切换、调 $d$ 场强恒不变 `< 1e-12`、上下/中心接地 $\varphi_P$、密立根油滴静悬与 Stokes 终端速度 `< 1e-6`（3 测）。
   * `E03` [em-ac-field-oscilloscope](file:///d:/project%20code/44-PhysForge/simulations/em-ac-field-oscilloscope/plugin.ts)：方波换向 `bisectEvent` 四相位粒子对比（$t_0=T/4$ 一周期回零 `< 1e-7 m`）、示波管偏转 `< 1e-6` 与余辉李萨如、等效重力摆（4 测）。
   * `E04` [em-induction-double-rod](file:///d:/project%20code/44-PhysForge/simulations/em-induction-double-rod/plugin.ts)（V2 原地升级）：保留全部 V1 预设与 4 测，新增零阻单杆电容加速度 $\frac{F}{m+CB^2L^2}$ (`< 1e-7`)、不等距双杆 $L_1\neq L_2$ 广义动量及终态 $L_1v_1-L_2v_2<10^{-6}$、导轨倾角、`Auto-FBD`、`rod1` 参考系与 `DiagramIR`（6 测）。
   * `E05` [em-wireframe-rotation](file:///d:/project%20code/44-PhysForge/simulations/em-wireframe-rotation/plugin.ts)：方/正三角/圆线框切割、`bisectEvent` 同侧跨越边界分裂积分能量守恒 `< 1e-6`、反向双磁场 `2.000x` 电动势与法拉第圆盘（3 测）。
   * `E06` [em-eddy-vortex-field](file:///d:/project%20code/44-PhysForge/simulations/em-eddy-vortex-field/plugin.ts)：柱内外涡旋电场环流积分 $\oint\mathbf{E}\cdot d\mathbf{l}=-d\Phi_B/dt$ `< 1e-8` 与整块/开槽铜板阻尼对照摆（3 测）。
   * `E07` [em-ac-generator-rms](file:///d:/project%20code/44-PhysForge/simulations/em-ac-generator-rms/plugin.ts)：2.5D 线圈与中性面提示、分段复合 Simpson 积分检验 6 种波形（正弦/半波/全波/占空比方波/锯齿/直交叠加）有效值全部 `< 1e-6`（2 测）。
   * `E08` [em-transformer-grid](file:///d:/project%20code/44-PhysForge/simulations/em-transformer-grid/plugin.ts)：原边含 $R_0$ 多副线圈电表 $\uparrow/\downarrow$ 趋势与功率平衡 `< 1e-10`、高压输电升压比翻倍线损严格降为 `1/4`（3 测）。
   * `E09` [em-lc-rlc-oscillation](file:///d:/project%20code/44-PhysForge/simulations/em-lc-rlc-oscillation/plugin.ts)：LC 20 周期能量漂移 `< 1e-5`、`bisectEvent` 周期误差 `< 1e-5`、RLC 谐振峰值电流 $U_m/R$ `< 1e-4`（3 测）。
   * `E10` [em-3d-magnetic-fields](file:///d:/project%20code/44-PhysForge/simulations/em-3d-magnetic-fields/plugin.ts) & [ThreeStage.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/ThreeStage.tsx)：无头圆弧积分单环 Biot-Savart `< 1e-4`、3D `BorisPusher` 螺旋螺距 `< 1e-5` 与动能守恒 `< 1e-10`；Vanilla `three` + `OrbitControls` 按需挂载 3D 载流线圈/磁感线/螺旋轨线并在卸载时 `dispose()` 全部几何/材质/上下文（3 测）。

---

### [2026-11-22 21:02–21:05 +08:00] 历史归档摘要（V1.0 → V2-W3，均已合入 `origin/main`）

* V1.0 (`eb6b34c`–`62f9383`) 与 `V2-W1` (`61cad64`) 完成底层内核、交互/3D 舞台与 CI/Pages；`V2-W2` (`3e86d3b`) 交付 `@physforge/export-studio` 与五大建模器 `B1–B5`（懒加载 `mathjs@15.2.0`）；`V2-W3` (`7c252a7`) 交付力学与天体全矩阵 `M01–M11`（90 测全绿）。
