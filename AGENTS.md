# PhysForge — AI Coding Agent 工程与物理严谨性宪法

## 1. 仓库铁律（最高优先级，V1.0 & V2.0 通用）
- **物理与视图严格解耦**：所有微分方程求解、力学/电磁算子、事件检测必须放在 `packages/physics-core/` 或各模型的 `engine.ts` 中，严禁依赖 DOM、Canvas 或 React 状态，必须可在 Node / Vitest 下无头运行。
- **渲染性能红线**：60fps 主仿真循环必须采用**固定物理步长累加器（Fixed-Timestep Accumulator）**运行在 `requestAnimationFrame` + `ref` + Canvas 2D / `uPlot` / `PhaseXYPlotter` 通道中，保证高刷屏下数值演化一致，严禁将每帧粒子坐标写入 React `useState` 或高频触发整页重渲染。
- **许可证合规红线**：主仓库使用 MIT 协议。严禁直接复制任何 GPL（如 `circuitjs1`）或需商业授权 SDK（如 `tldraw`）的源码进入主代码库。
- **100% 离线可用红线**：所有运行时字体、图标与静态资产（含 `@excalidraw/excalidraw` 的 `EXCALIDRAW_ASSET_PATH` 与 `KaTeX` 字体）必须本地打包，严禁在运行时请求 `unpkg.com`、`jsdelivr` 等外网 CDN；且必须通过 `BASE_URL` / `VITE_BASE_PATH` 同时兼容根路径 `/` 与 GitHub Pages 子路径 `/PhysForge/`。
- **依赖兼容性与静态安全红线**：严禁使用 `--force` 强压 `peerDependencies` 冲突，严禁使用 `@ts-ignore`、`as any`、`eslint-disable`、`skip`/`only` 跳过测试或掩盖报错。
- **精确事件捕获红线**：临界事件检测（碰撞、出界、共速、相切、脱轨、分离）必须使用基于步进积分回溯与二分定位的 `bisectEvent` 收敛至 $|\Delta t| \le 10^{-7}\text{ s}$，禁止仅用两端点线性插值混充。
- **单文件切片轻量化红线**：`apps/singlefile-exporter` 按单个目标模型按需打包（仅含壳层 + 目标模型 + `uPlot` + `KaTeX`），严禁将全量模型、Excalidraw 或无关重型 WASM/`three`/`mathjs` 塞入教学切片。

## 2. 新增物理仿真模型标准流程（必须逐步验收）
每当被要求新增或升级一个模型（位于 `simulations/<model-id>/`）时，必须严格遵守以下四步：
1. **数学与物理建模先行**：先在模型目录创建/更新 `PHYSICS_SPEC.md`，写明坐标系、状态向量、微分/代数方程、解析特例、临界事件条件与所选数值积分器（保守系统优先 `VelocityVerlet`，纯磁场优先 `BorisPusher`，刚体解析约束优先 `UdwadiaKalaba`，一般系统优先 `RK4` / `AdaptiveRK45`）。
2. **教学法与可组合契约对齐**：对照《普通高中物理课程标准（2017年版2025年修订）》与人教版 2019 教材，至少设计 3–4 个有明确教学意图的课堂预设（`presets`），实现 `SimulationPluginV2` 的 `getControlHandles`、`getForceVectors`、`referenceFrames` 与 `exportDiagramIR`（黑白试卷配图）。
3. **编写物理守恒单元测试（强制卡点）**：必须编写 `engine.test.ts` 并通过 `pnpm test`，验证：
   - 至少一项物理守恒律（能量/动量/角动量/半径/周期/幺正概率）在长时演化下的误差在规定阈值内；
   - 至少一项解析特例解与数值仿真结果吻合（相对误差 `< 1e-4` 或规格书规定更严阈值）；
   - 参数边界值（如 $B=0$、$v=0$、$q=0$、`dt=0`、极大/极小阻尼）不产生 `NaN` 或 `Infinity`。
4. **工作台与注册检查**：检查高对比可读性、单文件导出兼容性与 `simulations/registry.ts` 注册（含 V1.0 旧模型 ID 兼容别名）。

## 3. 生成 AI 教研包与场景 DSL 防幻觉规则
- 所有写入 `content/teaching-packs/` 的教案、POE 任务单与变式题必须通过 `packages/pedagogy-schema` 的 Zod 校验与 `pnpm verify:packs` 物理内核定量验算。
- 所有 `SceneDSL`（`packages/ai-copilot`）与个人预设资产必须先过 Zod 校验与无头仿真守恒审计方可入库。

## 4. V2.0 工程与建模硬性增量规范
1. **三卷规格与施工方案权威源**：所有 V2.0 架构演进、平台支柱与 43 单元实现必须对齐 `docs/v2-specs/01~03` 与总控纠偏后的 [docs/V2_WRITER_CONSTRUCTION_PLAN.md](docs/V2_WRITER_CONSTRUCTION_PLAN.md)（批次编号与兼容性以总控施工方案为准）。
2. **禁止范围漂移**：坚决不开发手机竖屏端适配、WCAG 读屏/Parallel DOM 适配、网页端教研包富文本编辑器或商业 SaaS 后台，亦不将课堂试讲作为阻塞门禁。
3. **增量自检与分轮验收**：按总控指定的 V2.0 大轮次推进；每完成 1 个平台支柱或 3–4 个物理模型必须在本地跑通 `pnpm typecheck && pnpm test && pnpm build` 自检不留债，整轮竣工后更新 `docs/WRITER_HANDOFF_LOG.md` 交总控验收。
4. **物理引擎零作弊铁律**：
   - 严禁在 `engine.ts` 中使用 `Math.random()`（必须使用 `physics-core` 提供的确定性 seeded PRNG）；
   - 严禁使用 `eval()` / `new Function()` 解析用户输入公式（`B5` 必须使用 `mathjs >= 15.2.0` 白名单 AST 编译并限制执行步数）；
   - 严禁在微观/天体模型中跳过 `ScaleContext` 无量纲缩放；
   - 严禁为“省事”用固定预设动画冒充真实 ODE/MNA/FDTD/TDSE 求解。
5. **按需懒加载与版本安全红线**：`three`（纯 Vanilla `three`，不引入 `@react-three/fiber`）、`@dimforge/rapier2d-compat`、`@excalidraw/excalidraw`、`mathjs`（`>= 15.2.0`）必须保持独立异步 chunk，首屏主 JS 包（gzip）`< 350 KB`，零外部 CDN 请求。

## 5. 质量门禁命令
每次提交或阶段验收前，必须在**最后一次代码编辑后**依次跑通：
- `pnpm typecheck`（全仓 TypeScript 严格类型检查）
- `pnpm test`（全仓 Vitest 单元测试与物理守恒回归测试）
- `pnpm verify:packs`（教研包物理内核防幻觉定量验算；V2 增设 `verify:scenes` / `verify:vault` 后同步纳入）
- `pnpm build`（全量构建与懒加载 chunk 隔离校验）
