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

## 6. 禁止盲交：实机交互 + 多模态视觉看图验收铁律
1. **实机交互与截图审计**：凡涉及 `apps/web` 外壳、控件交互、Canvas 2D 或 3D 渲染改动，禁止仅凭命令行构建/单测通过验收，必须在最后一次编辑后运行 `node scripts/visual-audit.mjs`（真实浏览器点击运行、拖动滑块、切换全屏演说），将截图输出至 `artifacts/ui-audit/`。
2. **多模态逐张并排看图核验**：总控必须亲自读取 `artifacts/ui-audit/*.png`，并与 `docs/ui-benchmark/01_workbench_em.png` ~ `04_fullscreen_3d.png` 逐张并排对比，以下 6 条任意一条不达标即一票否决打回：
   - 顶栏固定 `48px` 高，右侧常驻入口 `≤ 3` 个（`工具` / `导出` / `全屏演说`）；
   - 左侧模型目录默认折叠为 `48px` 极细图标轨，点击滑出半透明浮层、选完自动收回；
   - 右侧控制台为宽 `272px` 悬浮毛玻璃卡片，顶部单行下拉选预设，第一屏直接露出核心滑块；
   - 画布可见面积 `≥ 72%`（光学/静力平衡/静态电路等非时序模型默认隐藏底部示波器，保持 `≥ 85%` 纯净舞台）；
   - Canvas 内任何两个文字标签包围盒严禁重叠或压线；
   - 点击运行 `t` 必须真实推进，拖动滑块数值与画布/公式 100% 实时同步。

## 7. V3.1 用户追加视觉金标准与施工计时（2026-11-25）
- 仅正式施工 Turn（代码/规则/路线持久化修改、验证、交付）记录本会话施工轮号与真实墙钟 T0/T1/T2；约20分钟预算，临近18分钟收口。简单问答、讨论、解释不计时、不编号。缺样如实标记，禁止按推理耗时估算或为凑时间空转。**每个正式施工 Turn 必须以约 20 分钟真实有效施工为目标，正常不得在 1–2 分钟就主动结轮；有实质工作时持续推进到约 18 分钟开始收口。被平台硬截断、工具不可用或其他真实阻塞时，明确报告实际已工作时长、未完成事项与证据，不得伪造计时，不计为完整 Turn，用户继续时承接原轮号。中断间隔不计有效施工时长；不得以长时间空等凑预算。**
- 四张 `docs/ui-benchmark/01_workbench_em.png`、`02_optics_clean.png`、`03_circuit_mna.png`、`04_fullscreen_3d.png` 是强制展示级视觉目标，不仅是布局参考。每次旗舰验收必须与实际同 SHA 截图并排核对玻璃材质、冷暖发光、金属/透明体、标签/公式/仪表、主图层次与全屏效果，逐项说明差距；功能或自动化 PASS 不代表视觉达标。
- 先共享视觉母版、E04 样板，再 B3/B2/E10 四旗舰，随后推广到43单元；V3.2+继承同一视觉语言。原物理正确性、交互、离线、包体、48px/272px 布局与投影可读性红线不降级；不照抄概念图中的错误公式/矢量/数据或以静态参考图片冒充仿真。具体见施工方案新增 V3.1 章节。
