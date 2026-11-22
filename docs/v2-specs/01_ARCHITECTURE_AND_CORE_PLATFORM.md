# PhysForge V2.0 完全体施工方案（1/3）：总体架构与八大平台支柱全规格书

> **文档编号**：`docs/v2-specs/01_ARCHITECTURE_AND_CORE_PLATFORM.md`
> **前置基线**：`PhysForge` V1.0（仓库 `main@62f9383`，已通过 `typecheck`、46 条物理单测、20 条定量教研验算与 Chrome Playwright 全链路检查）
> **配套文档**：
> * `01_ARCHITECTURE_AND_CORE_PLATFORM.md`（本文件）：总体架构、核心接口契约、七大平台能力支柱施工规格与全局路线图；
> * `02_MODELS_BUILDERS_AND_MECHANICS_EM.md`：5 大自由建模器（B1–B5）+ 力学天体（M01–M11）+ 电磁与 3D 场（E01–E10）共 26 单元逐项数学与验收规格；
> * `03_MODELS_WAVES_MODERN_STSE_EXP.md`：波动光学、热学、近代物理、STSE、真误差实验与强基竞赛共 17 单元逐项数学与验收规格 + 终版验收矩阵。
> **核心理念**：面向个人长期使用与专业沉淀，**不设人为时间死线**，一切决策以**物理数值严谨性、自由建模深度、素材生产效率与长期架构可维护性**为唯一准绳。

---

## 一、V1.0 基线盘点与 V2.0 战略边界

### 1. 严禁推倒重来：必须完整继承的 V1.0 核心资产
基于 `main@62f9383` 的实测盘点，以下地基已具备高水准，V2.0 必须在其上增量演进并保持全部既有测试全绿：
1. **零 DOM 物理内核**（`packages/physics-core`）：`stepRK4`、`stepVelocityVerlet`、`stepBorisPusher`、`integrateAdaptiveRK45`、步进回溯二分事件定位 `bisectEvent`（精度 $10^{-8}\text{ s}$）与不变量漂移审计。
2. **高性能渲染管线**：`240Hz` 固定步长累加器运行于 `rAF + ref`，物理坐标严禁进入 React `useState`。
3. **7 个已验证自包含模型**：有界磁场、机械波联动、双杆电磁感应、传送带与板块、2D 几何光学、按需懒加载 `Rapier2D` 力学沙箱、零 GPL 纯 TS MNA 直流含容电路。
4. **单文件离线切片导出**（`apps/singlefile-exporter`）与零外部 CDN 离线运行架构。

### 2. 战略裁剪清单（明确不做，防止精力分散）

| 类别 | 具体项 | V2.0 明确裁定 |
| :--- | :--- | :--- |
| **坚决砍掉 / 无限期搁置** | 真实教室 5–10 节试讲流程门禁、WCAG 屏幕阅读器与 Scenery Parallel DOM、手机竖屏端响应式重构、网页端图形化教研包富文本编辑器 | **全部砍掉**。专注桌面/大屏个人高频建模、出题、备课与研究场景。 |
| **保留但降级为轻量工具** | `TeachingPackDrawer`、POE 遮罩、Excalidraw 透明批注层 | 保持正常运行与零退化，不再投入重开发精力；个人场景资产统一由新版 `workspace-vault` 管理。 |
| **绝对不可打破的四条红线** | ① 物理求解与 UI 彻底解耦（Node/Vitest 无头可测）；<br>② 严禁引入 GPL（如 `circuitjs1`）或商业受限 SDK（如 `tldraw`）；<br>③ 非 3D / 非沙箱模块首屏零 Three.js 与 Rapier WASM 体积；<br>④ 严禁使用 `eval` / `new Function` 执行用户输入公式。 | 任何 PR 或 Wave 提交违反上述任一红线，门禁直接判失败。 |

---

## 二、Monorepo 目录扩展与开源依赖合规矩阵

### 1. V2.0 仓库目录蓝图（在现有 `pnpm workspace` 上增量扩展）

```text
physforge/
├── docs/v2-specs/
│   ├── 01_ARCHITECTURE_AND_CORE_PLATFORM.md   # 本文件
│   ├── 02_MODELS_BUILDERS_AND_MECHANICS_EM.md # 模型规格书（上）
│   └── 03_MODELS_WAVES_MODERN_STSE_EXP.md     # 模型规格书（下）
├── packages/
│   ├── physics-core/         # 【支柱一】升级：无量纲、混合自动机、Udwadia-Kalaba、反解器、FDTD、MarchingSquares、非线性MNA
│   ├── sim-sdk/              # 【支柱二】升级：SimulationPluginV2、ControlHandle、AutoFBD、ReferenceFrame、SceneDSL
│   ├── analysis-lab/         # 【支柱三·新增】非单调 XY 相图、Phyphox/Tracker CSV 拟合、Radix-2 FFT、WebWorker 参数扫描
│   ├── export-studio/        # 【支柱四·新增】DiagramIR（SVG/高清PNG/LaTeX TikZ 印刷级配图）、Canvas 录屏/频闪长图
│   ├── ai-copilot/           # 【支柱五·新增】Problem-to-Sim 读题建模协议、SceneDSL 校验与物理内核自修正闭环
│   ├── workspace-vault/      # 【支柱六·新增】IndexedDB + FileSystemAccess 本地资产库、打通 content/presets、Ctrl+K 索引
│   └── pedagogy-schema/      # 保留 V1.0 Zod 校验，并与 SceneDSL 互通
├── simulations/              # 【支柱八】5 大自由建模器 + 38 个高密度专题模型
├── apps/
│   ├── web/                  # 主工作台（整合直操画布、尺规工具箱、懒加载 3D 视口、分析实验室、导出工坊、资产库）
│   └── singlefile-exporter/  # 升级支持“指定模型 + 自定义个人场景 JSON”一键打包 ~2MB 独立离线 HTML
└── .github/workflows/        # 【支柱七·新增】CI 全门禁 + GitHub Pages / Cloudflare Pages 双线发布 + Release 离线包
```

### 2. 新增开源依赖合规审查表（全部为 MIT / Apache-2.0 / BSD）

| 依赖包 | 许可证 | 用途与加载策略 | 选型理由与避坑说明 |
| :--- | :--- | :--- | :--- |
| `mathjs`（按需子模块） | Apache-2.0 | `custom-ode-lab` AST 安全公式解析与编译 | 严禁使用 `eval`，采用白名单 AST 编译并做执行步数上限保护 |
| `three` + `@types/three` | MIT | 3D 电磁空间场、回旋加速器、天体 3D 视角 | **必须动态 `import()` 懒加载**，仅进入 3D 模型时加载，不污染首屏与单文件切片 |
| `fflate` | MIT | 个人资产库一键 ZIP 打包备份与导入 | 极轻量零依赖（约 8 KB gzip），纯客户端高速压缩 |
| `papaparse` | MIT | 导入 Phyphox / Tracker / DISLab 实验 `.csv` 数据 | 健壮处理不同编码、表头、空行与科学计数法 |
| `uPlot`（已有） | MIT | 严格单调时间轴高频实时示波器（60fps） | **绝不用 `uPlot` 画相图或闭环循环**，非单调图统一交由自研 `PhaseXYPlotter` |
| 自研模块（不引重库） | MIT | `Udwadia-Kalaba`、稀疏/主元 LU、Marching Squares、Radix-2 FFT、最小二乘拟合、`DiagramIR` | 物理算法轻量且对数值精度有绝对掌控需求，几百行纯 TS 远比引入黑盒大库稳定 |

---

## 三、支柱一：物理求解内核全面升级（`packages/physics-core`）

V1.0 的求解器适用于标准单阶段光滑 ODE。要支撑 5 大自由建模器与 38 个跨尺度、含突变与非线性的专题模型，必须在 `packages/physics-core` 新增以下 **7 个核心子模块**（全部保持 100% 零 DOM 依赖与 Vitest 全覆盖）。

### 1. 无量纲物理缩放层（`units/scaleContext.ts`）
* **解决痛点**：电子质量 $m_e \approx 9.11 \times 10^{-31}\text{ kg}$、地球质量 $M_\oplus \approx 5.97 \times 10^{24}\text{ kg}$、普朗克常量 $h \approx 6.626 \times 10^{-34}\text{ J}\cdot\text{s}$，直接用 SI 原始浮点数做矩阵求逆或自适应误差估计极易触发下溢/病态条件数。
* **实现规格**：
  ```ts
  export interface ScaleContext {
    readonly lengthUnit: number;  // 特征长度 L0 (m)，如原子尺度 1e-10，天体尺度 1e7
    readonly timeUnit: number;    // 特征时间 T0 (s)
    readonly massUnit: number;    // 特征质量 M0 (kg)
    readonly chargeUnit: number;  // 特征电荷 Q0 (C)
    toDimless(value: number, dim: PhysicalDimension): number;
    toSI(dimlessValue: number, dim: PhysicalDimension): number;
  }
  ```
* **门禁标准**：粒子物理、原子散射、天体轨道三类跨尺度模型必须全部在内部无量纲量级 $\mathcal{O}(1)$ 下完成积分，仅在 `computeObservables` 输出层换算回标准 SI 单位。

### 2. 混合动力自动机（`hybrid/hybridAutomaton.ts`）
* **解决痛点**：高中物理大量核心考点发生在**离散力学模式切换瞬间**——静摩擦锁止 $\leftrightarrow$ 相对滑动、滑滚 $\to$ 纯滚动、圆周运动 $F_N = 0 \to$ 脱轨抛体、弹簧压缩 $\to$ 接触分离、刹车速度归零锁止。
* **实现规格**：
  * 定义离散模式枚举 `TMode`、连续状态 `TState`、守卫函数（Guard Function）$g_k(t, \mathbf{y}, \text{mode}) = 0$ 与状态跃迁映射（Reset Map）$\Phi_k(\mathbf{y}^-) \to (\text{mode}^+, \mathbf{y}^+)$。
  * 在单步积分跨过任意守卫函数变号时，自动调用 `bisectEvent` 将步长精确切分至临界时刻 $t^*$（精度 $\le 10^{-8}\text{ s}$），发射强类型 `PhysicsEvent`（供画布自动钉住临界点标签），执行 Reset Map 后再走完剩余子步长 $\Delta t - (t^* - t_0)$。
  * **防 Zeno 锁死保护**：单步内模式切换次数上限设为 `MAX_TRANSITIONS_PER_STEP = 8`，并支持静摩擦/接触零速度死区（`epsilonVelocity`）滞回锁定，防止临界点高频抖动。

### 3. 解析约束动力学求解器（`constraints/udwadiaKalaba.ts`）
* **解决痛点**：游戏引擎（如 `Rapier2D`）用冲量迭代近似约束，无法提供精确的解析约束力 $F_N$ 或轻绳张力 $T$，导致 Auto-FBD 受力图抖动、竖直面圆周脱轨角算不准。
* **数学规格**：采用高斯最小拘束原理的 **Udwadia-Kalaba 显式方程**。设系统质量矩阵为 $M$，无约束加速度为 $\mathbf{a}_u = M^{-1}\mathbf{F}_{\text{ext}}$，完整/非完整约束经二次求导写成标准线性形式 $A(\mathbf{q}, \dot{\mathbf{q}}, t)\mathbf{a} = \mathbf{b}(\mathbf{q}, \dot{\mathbf{q}}, t)$（含 Baumgarte 稳定项 $-\alpha \dot{\boldsymbol{\phi}} - \beta^2 \boldsymbol{\phi}$ 消除长期位置漂移），则精确加速度与精确约束反力为：
  $$\mathbf{a} = \mathbf{a}_u + M^{-1/2}\left(A M^{-1/2}\right)^+\left(\mathbf{b} - A\mathbf{a}_u\right), \qquad \mathbf{F}_c = M(\mathbf{a} - \mathbf{a}_u)$$
  其中 $(\cdot)^+$ 为 Moore-Penrose 伪逆（通过小型 SVD 或 Tikhonov 正则化求解，维度一般 $\le 12$，单步耗时 $< 0.02\text{ ms}$）。
* **验收标准**：竖直面圆弧轨道、双摆、滑轮轻绳、动斜面滑块模型必须通过此求解器直接输出精确法向支持力 $F_N(t)$ 与绳张力 $T(t)$，单边约束检测 $F_N \le 0$ 触发脱轨/松绳误差 $< 10^{-6}$。

### 4. 反问题与临界参数求解器（`inverse/rootFinder.ts`）
* **解决痛点**：物理建模不止“正推看结果”，最高频的教研与解题需求是**反推临界参数**——例如“求粒子刚好从磁场右边界相切射出的临界速度 $v_0$”“求木块刚好不滑离木板的最小板长 $L$”“求斜抛刚好击中指定目标点 $(x_t, y_t)$ 的发射角 $\theta$”。
* **实现规格**：
  * 提供无头打靶求解器 `solveBoundaryParameter(simFactory, paramKey, bounds, residualFn, options)`：结合粗网格括号扫描（Bracketing）+ **Brent 混合寻根法**（兼具二分稳健性与反二次插值超线性收敛）。
  * 支持返回多解（例如斜抛击中目标的高低弹道双解），单次求解在 Web Worker 中运行，上限 60 次仿真迭代，相对容差默认 $10^{-5}$。

### 5. 场、波动与统计专用数值算子（`fields/`）
* **2D 波动 FDTD 求解器（`fields/waveFDTD2D.ts`）**：基于 `Float32Array` 双缓冲求解 $\frac{\partial^2 u}{\partial t^2} = c(x,y)^2 \nabla^2 u$，内置 12 格宽 **Mur / 指数衰减吸收边界层（PML）** 防止边缘虚假反射，强制检查 CFL 条件 $c_{\max}\Delta t / \Delta x \le 1/\sqrt{2}$。
* **等势线提取器（`fields/marchingSquares.ts`）**：输入任意 2D 标量势场 $\varphi(x,y)$ 网格与等值级列表，线性插值输出连续闭合/开放折线段，用于静电场等势面与拉格朗日有效势能等高线。
* **2D 空间哈希碰撞器（`particles/spatialHash2D.ts`）**：用于分子动理论硬球气体盒（$N = 200 \sim 800$ 粒子，复杂度从 $\mathcal{O}(N^2)$ 降至 $\mathcal{O}(N)$），精确满足弹性碰撞动量与动能守恒。

### 6. 自由拓扑非线性 MNA 电路内核升级（`circuits/nonlinearMna.ts`）
* 在 V1.0 固定拓扑 MNA 基础上，升级为面向自由画板的通用电路求解器：
  * **动态拓扑预检（Graph Validator）**：运行 BFS/DFS 检测独立参考地（自动为孤立子网注入 $10^{12}\,\Omega$ 对地泄放电阻防奇异矩阵）、检测理想电压源/电容并联短路环与理想电流源/电感串联开路，向 UI 返回明确中文错误节点定位，**绝不出现 `NaN` 崩溃**。
  * **稀疏/列主元高斯-LU 求解器** + **梯形伴随模型（同时支持电容 $C$ 与电感 $L$）** + **带阻尼步长的 Newton-Raphson 非线性迭代**（支持灯丝非线性电阻 $I = k U^\alpha$、理想/肖克利二极管与理想变压器耦合方程）。
  * **验收标准**：非线性小灯泡 + 电源内阻回路 10 次迭代内残差 $< 10^{-9}$；含电感 RLC 振荡 20 周期总电磁能漂移 $< 10^{-5}$。

### 7. 守恒律与物理量纲审计器（`verification/auditor.ts`）
* 统一提供 `EnergyBudget`（$E_k, E_{pg}, E_{pe}, E_{\text{em}}, Q_{\text{heat}}, W_{\text{ext}}$）、`MomentumBudget`（$\vec{p}, \vec{L}$）实时残差核算：
  $$\delta_E(t) = \frac{|E_{\text{total}}(t) - E_{\text{total}}(0) - W_{\text{ext}}(t)|}{\max(|E_{\text{total}}(0)|, E_{\text{ref}})}$$
* 任意模型在测试与运行期均可读取 $\delta_E(t)$，并在开发诊断面板中红绿灯预警。

---

## 四、支柱二：插件协议 v2、画布直操与 3D 统一底座（`packages/sim-sdk` & `apps/web`）

### 1. 向后兼容的 `SimulationPluginV2` 接口契约
V1.0 的 7 个模型无需立即改写即可继续运行，新能力通过可选字段平滑挂载：

```ts
export interface ControlHandle {
  id: string;
  kind: 'point' | 'vector' | 'angle' | 'region-corner';
  worldPos: { x: number; y: number };
  label?: string;
  snapMode?: 'none' | 'grid' | 'axis' | 'keypoint';
  onDrag: (nextWorldPos: { x: number; y: number }, params: Record<string, unknown>) => Partial<Record<string, unknown>>;
}

export interface ForceVectorItem {
  bodyId: string;
  origin: { x: number; y: number };
  force: { fx: number; fy: number };
  category: 'gravity' | 'normal' | 'friction' | 'tension' | 'spring' | 'electric' | 'magnetic' | 'external' | 'net';
  label: string;
}

export interface ReferenceFrameSpec {
  id: string;
  label: string;
  getTransform: (state: unknown, params: unknown) => {
    origin: { x: number; y: number };
    velocity: { vx: number; vy: number };
    angleRad?: number;
  };
}

export interface SimulationPluginV2<TParams, TState> extends SimulationPlugin<TParams, TState> {
  renderMode?: 'canvas2d' | 'three3d' | 'hybrid';
  getControlHandles?: (state: TState, params: TParams) => ControlHandle[];
  getForceVectors?: (state: TState, params: TParams) => ForceVectorItem[];
  referenceFrames?: ReferenceFrameSpec[];
  sceneSerializer?: {
    exportScene: (params: TParams, state: TState) => SceneDSL;
    importScene: (scene: SceneDSL) => Partial<TParams>;
  };
  exportDiagramIR?: (state: TState, params: TParams, options: DiagramExportOptions) => DiagramIR;
  mountThreeScene?: (container: HTMLElement, context: ThreeSceneBridge<TParams, TState>) => () => void;
}
```

### 2. 画布直接操纵与几何尺规工具箱（`apps/web/src/stage/`）
* **交互式视口控制器（`ViewportController`）**：双向变换 `worldToScreen` / `screenToWorld`，滚轮以光标位置为锚点缩放（$0.1\times \sim 20\times$），中键/空格+左键平移，双击或 `R` 键自适应居中。命中检测优先级：`尺规工具 > ControlHandle（14px 半径） > 自由元件主体 > 画布平移`。
* **物理几何作图尺规工具箱**：虚拟直尺、虚拟量角器（$0.1^\circ$ 精度）、虚拟圆规 / 三点定圆器。
* **Auto-FBD 动态受力分析图叠加层**：统一语义配色、正交分解一键开关、标签防重叠排斥布局。
* **全局撤销/重做栈（`CommandStack`）**：深度上限 50 步，`Ctrl+Z` / `Ctrl+Shift+Z`。
* **3D 懒加载视口封装（`ThreeStage.tsx`）**：仅 `three3d` 模型动态 `import('three')`，切离时严格 `dispose()`。

---

## 五、支柱三：科学绘图、真实实验数据融合与批量扫描（`packages/analysis-lab`）

1. **双引擎科学绘图架构**：`uPlot` 负责单调时间轴；自研 `PhaseXYPlotter`（Canvas 2D + SVG 坐标轴）负责非单调 XY 相图、循环图、闭合环面积 $\oint y\,dx$ 与悬停反查回放。
2. **真实实验数据叠合与最小二乘拟合（`csvFitting.ts`）**：兼容 Phyphox / Tracker / DISLab `.csv/.tsv`，支持线性、多项式、指数衰减、简谐阻尼（LM 非线性最小二乘）拟合，输出参数、标准误与 $R^2$。
3. **FFT 频谱分析器（`fftAnalyzer.ts`）**：Cooley-Tukey Radix-2 FFT（矩形/Hann 窗），自动标注前 3 主频峰。
4. **无头多参数批量扫描引擎（`sweepRunner.ts`）**：独立 Web Worker 并发扫描，输出 `Y vs X` 曲线并支持点击回放。

---

## 六、支柱四：试卷级矢量配图、动画录屏与离线切片导出（`packages/export-studio`）

1. **后端无关印刷级矢量图 IR（`DiagramIR`）**：支持 `line`, `arrow`, `arcAngle`, `hatchedGround`, `spring`, `block`, `fieldMarker`, `trajectory`, `circuitElement`, `mathLabel`。
2. **三种输出后端**：SVG 印刷矢量（公式内联 SVG 路径防缺字）、`2x/4x/600 DPI` 高清 PNG（一键剪贴板）、LaTeX TikZ 代码生成器。
3. **内置动画录屏与频闪长图导出（`mediaRecorder.ts`）**：`canvas.captureStream(60)` + `MediaRecorder` 导出 WebM，以及按 $\Delta t$ 叠加频闪合成长图。
4. **单文件离线 HTML 切片升级**：支持 `--preset-file` 烘焙个人场景 JSON（~2 MB，严禁打入无关模型、Excalidraw 或非沙箱/非对应重依赖）。

---

## 七、支柱五：AI 逆向读题建模与防幻觉验算管线（`packages/ai-copilot`）

1. **三层路由**：① 38 专题直达 → ② `B1–B4` 自由建模器组装 → ③ `B5 (custom-ode-lab)` 万能方程兜底。
2. **Generate-then-Refine 闭环**：Zod 校验 `SceneDSL` → 无头内核实跑 → 守恒残差 `< 1e-4` 与答案比对 → 最多 3 轮自动修正。
3. **双运行模式**：本地 Coding Agent 写入 `content/presets/` + `pnpm verify:scene`，以及网页端可选 BYOK 直连配置。

---

## 八、支柱六：个人物理资产库与全局秒搜系统（`packages/workspace-vault`）

1. **双层本地持久化**：浏览器 `IndexedDB` + Chromium `FileSystemAccess API`（自动扫描合并 `content/presets/**/*.json`）+ `fflate` ZIP 一键备份导入。
2. **元数据与 `Ctrl+K` 全局秒搜**：支持跨全部 43 模型、个人真题场景、教材章节与命令检索。

---

## 九、支柱七：工程自动化 CI/CD 与双线零成本发布

1. **GitHub Actions CI（`.github/workflows/ci.yml`）**：`typecheck` + 静态扫描 → `test` → `verify:packs` + `verify:scenes` → `build` + chunk 预算检查 → Playwright 无头冒烟。
2. **双线发布**：Cloudflare Pages（`/` 根路径国内直连）+ GitHub Pages（`https://riyuewuxing.github.io/PhysForge/`）+ GitHub Release 离线单文件合集包。

---

## 十、支柱八总索引：43 单元模型地图与施工路线图

覆盖 `B1–B5`（5）、`M01–M11`（11）、`E01–E10`（10）、`W01–W02, O01`（3）、`T01–T02`（2）、`N01–N03`（3）、`S01–S04`（4）、`X01–X02`（2）、`C01–C03`（3）共 **43 个单元**（统一施工批次以 `docs/V2_WRITER_CONSTRUCTION_PLAN.md` 为权威调度基准）。
