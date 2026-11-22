# PhysForge — AI Coding Agent 工程与物理严谨性宪法

## 1. 仓库铁律（最高优先级）
- **物理与视图严格解耦**：所有微分方程求解、力学/电磁算子、事件检测必须放在 `packages/physics-core/` 或各模型的 `engine.ts` 中，严禁依赖 DOM、Canvas 或 React 状态，必须可在 Node / Vitest 下无头运行。
- **渲染性能红线**：60fps 主仿真循环必须采用**固定物理步长累加器（Fixed-Timestep Accumulator）**运行在 `requestAnimationFrame` + `ref` + Canvas 2D / `uPlot` 通道中，保证 60Hz/120Hz/144Hz 屏幕下数值演化一致，严禁将每帧粒子坐标写入 React `useState` 或高频触发整页重渲染。
- **许可证合规红线**：主仓库使用 MIT 协议。严禁直接复制任何 GPL（如 `circuitjs1`）或需商业授权 SDK（如 `tldraw`）的源码进入主代码库。
- **100% 离线可用红线**：所有运行时字体、图标与静态资产（含 `@excalidraw/excalidraw` 的 `EXCALIDRAW_ASSET_PATH` 与 `KaTeX` 字体）必须本地打包，严禁在运行时请求 `unpkg.com`、`jsdelivr` 等外网 CDN。
- **依赖兼容性与静态安全红线**：严禁使用 `--force` 强压 `peerDependencies` 冲突，严禁使用 `@ts-ignore`、`as any`、`eslint-disable`、`skip`/`only` 跳过测试或掩盖报错。
- **精确事件捕获红线**：临界事件检测（碰撞、出界、共速、相切）必须使用基于步进积分回溯与二分定位的 `bisectEvent` 收敛至 $|\Delta t| \le 10^{-7}\text{ s}$，禁止仅用两端点线性插值混充。
- **单文件切片轻量化红线**：`apps/singlefile-exporter` 按单个目标模型按需打包（仅含壳层 + 目标模型 + `uPlot` + `KaTeX`），严禁将全量模型或 `Rapier`/`Pyodide` WASM 塞入教学切片。

## 2. 新增物理仿真模型标准流程（必须逐步验收）
每当被要求新增一个模型（位于 `simulations/<model-id>/`）时，必须严格遵守以下四步：
1. **数学与物理建模先行**：先在模型目录创建 `PHYSICS_SPEC.md`，写明坐标系、状态向量、微分方程、解析特例、临界事件条件与所选数值积分器（保守系统优先 `VelocityVerlet`，纯磁场优先 `BorisPusher`，一般系统优先 `RK4` / `AdaptiveRK45`）。
2. **教学法护栏（四阶段对齐）**：对照《普通高中物理课程标准（2017年版2025年修订）》与人教版 2019 教材，至少设计 3 个有明确教学意图的课堂预设（`presets`：如标准导入、经典易错反例、高考压轴临界），并明确可切换的矢量/辅助线图层与示波器通道。
3. **编写物理守恒单元测试（强制卡点）**：必须编写 `engine.test.ts` 并通过 `pnpm test`，验证：
   - 至少一项物理守恒律（能量/动量/半径/周期）在长时演化下的误差在规定阈值内；
   - 至少一项解析特例解与数值仿真结果吻合（相对误差 `< 1e-4`）；
   - 参数边界值（如 $B=0$、$v=0$、$q=0$、`dt=0`、极大/极小阻尼）不产生 `NaN` 或 `Infinity`。
4. **教室大屏 UX 审查**：检查触控控件大小（热区 $\ge 44\text{px}$、字号 $\ge 18\text{px}$）、1080p 投影仪可读性、Excalidraw 透明批注层及单文件导出兼容性，最后在 `simulations/registry.ts` 注册。

## 3. 生成 AI 教研包（Teaching Pack）防幻觉规则
- 所有写入 `content/teaching-packs/` 的教案、POE 任务单与变式题必须通过 `packages/pedagogy-schema` 的 Zod 校验。
- 涉及定量计算的例题与变式题，必须附带可执行的校验脚本或直接绑定对应的仿真 Preset ID，经物理内核数值验算确认答案与物理过程完全一致后方可提交。

## 4. 质量门禁命令
每次提交或阶段验收前，必须在**最后一次代码编辑后**依次跑通：
- `pnpm typecheck`（全仓 TypeScript 严格类型检查）
- `pnpm test`（全仓 Vitest 单元测试与物理守恒回归测试）
- `pnpm build`（存在可构建应用/包后全量构建校验）
