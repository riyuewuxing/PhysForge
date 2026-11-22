# PhysForge（智理视界）项目全景总结与总控深度诊断（供线上 AI 快速接手对齐）

> **用途说明**：本文档专为跨平台/线上 AI 助手（Gemini / Claude / ChatGPT / NotebookLM 等）快速把握 **PhysForge** 当前真实代码现状、架构边界、实测门禁结果、全网横向成熟度差距与总控演进建议而撰写。所有现状陈述均基于本地源码与实跑验证。

---

## 一、项目基本盘与定位

* **项目名称**：**PhysForge（智理视界）**
* **GitHub 仓库**：`https://github.com/riyuewuxing/PhysForge`（公开仓库，MIT 协议，`main` 分支最新提交 `62f9383`，前置 Wave 1 基线 `eb6b34c`）
* **目标人群与政策/课标锚点**：面向中国普通高中物理（对齐《普通高中物理课程标准（2017年版2025年修订）》与人教版 2019 教材全 6 册），服务于**一线教室 1080p/4K 触控大屏（希沃白板 / 鸿合一体机）**、**断网离线教学**与**循证教研出题**。
* **核心差异化主张**：
  1. **理论物理级数值引擎**（非玩具动画或粗糙欧拉法）；
  2. **100% 离线优先 + 单模型独立 HTML 切片导出**（可插 U 盘/PPT/希沃白板双击即开，直击 PhET Studio 预设需联网的痛点）；
  3. **物理内核反向验算防幻觉教研闭环**（题目数值由真实物理引擎跑数核对，拒绝大模型算术编造）。

---

## 二、当前已落地系统全景（1.0 完全体现状）

### 1. 技术栈与 Monorepo 架构（`pnpm workspace`）
* **运行时与核心工具链**：`Node v24.18.0`、`pnpm 11.24.0`、`TypeScript ^7.0.2`（`strict: true` + `noUncheckedIndexedAccess: true`）、`Vitest ^5.1.1`、`Zod ^4.6.7`。
* **前端与渲染栈**：`Vite ^6.4.6`、`React ^19.3.1`、`Tailwind CSS ^4.3.5`、`Zustand ^5.1.0`、`uPlot ^1.6.32`、`KaTeX ^0.19.1`、`@excalidraw/excalidraw ^0.18.1`（MIT）、`@dimforge/rapier2d-compat ^0.21.0`（Apache-2.0，按需懒加载）、`vite-plugin-pwa ^2.0.0`、`vite-plugin-singlefile ^2.3.4`、`Playwright ^1.65.1`。

### 2. 核心目录与模块清单

| 路径 | 职责与核心实现细节 |
| :--- | :--- |
| **`packages/physics-core/`** | **100% 零 DOM/Canvas/React 依赖**（`lib: ["ES2022"]`）。含 SI 常量与单位换算（`units`）、2D/3D 矢量与洛伦兹/安培/点电荷场强算子（`vectors`）、**`stepRK4` / `stepVelocityVerlet` / `stepBorisPusher`（Cayley 纯旋转 + 时间对称更新）/ `integrateAdaptiveRK45`（Dormand-Prince 5(4)）**（`integrators`）、有向距离函数与**步进积分回溯二分事件定位器 `bisectEvent`**（默认收敛容限 $10^{-8}\text{ s}$，`geometry`）、不变量漂移追踪（`verification`）。 |
| **`packages/sim-sdk/`** | 统一插件协议 `SimulationPlugin<TParams, TState>`，包含声明式 `ParamFieldSpec`（`number`/`boolean`/`select`，含边界钳位 `resolvePluginParams`）、`PresetSpec`、`LayerSpec`、`TelemetryChannelSpec`、`StepResult`（含 `PhysicsEvent[]`）、`InvariantReport` 与 `FormulaDisplayItem`。 |
| **`packages/pedagogy-schema/`** | 基于 Zod v4 定义 `CurriculumMetaSchema`、`PoeWorksheetSchema`、`VariantQuestionSchema`（含 `simDurationSec`、`tolerance`、`expectedMetrics`）、`MisconceptionCardSchema` 与 `TeachingPackSchema`。 |
| **`simulations/`（7 个自包含模型）** | 均配备 `PHYSICS_SPEC.md`、`engine.ts`、`engine.test.ts`、`plugin.ts` 并注册于 `simulations/registry.ts`：<br>1. `em-bounded-magnetic-field`（5 预设）：直线/圆/矩形有界磁场（`BorisPusher` + 单向 `bisectEvent` 捕获出入界）+ 放缩圆/旋转圆/平移圆/磁聚焦 + 正交电磁场配速法；<br>2. `wave-vibration-coupling`（5 预设）：一维横波与探测质点 $y-t$ 双图联动 + 上下坡微平移法 + 双波源干涉 + 多普勒效应；<br>3. `em-induction-double-rod`（4 预设）：单/双杆切割（电阻/电容/恒定电源、动量与焦耳热守恒、摩擦停驻锁止）；<br>4. `mech-block-conveyor`（4 预设）：水平/倾斜传送带与叠放板块，`bisectEvent` 捕获共速突变与相对划痕生热；<br>5. `optics-ray-studio`（5 预设）：纯 TS 零重依赖 2D 光线追迹与干涉内核（全反射临界角、平行玻璃砖侧移、三棱镜色散、光导纤维、双缝干涉；规范致谢 `ricktu288/ray-optics`）；<br>6. `mech-free-sandbox`（4 预设）：动态按需懒加载 `Rapier2D` WASM（首屏不加载，切入沙箱后接管弹性/非弹性碰撞、斜面滑块、弹簧振子、牛顿摆）；<br>7. `circuit-dc-capacitor-mna`（4 预设）：100% 零 GPL，从零自研纯 TS 改进节点分析法（MNA）+ 梯形伴随电容求解器（功率极值、混联动态、RC 充放电、电桥含容）。 |
| **`apps/web/`** | 教室演示三栏工作台：左侧人教版全 6 册/课标筛选大厅；中央高 DPR Canvas（**240Hz 固定物理步长累加器**跑在 `rAF + ref`，每帧坐标绝不入 React `useState`）+ 频闪 + POE 预测遮罩 + 底部 `uPlot` 双通道双向悬停回放示波器；右侧预设速切（快捷键 `1–9`）、触控参数条、`KaTeX` 动态代入公式、能量堆叠柱状图；懒加载 **Excalidraw 透明板书批注层**（`/excalidraw-assets/` 本地化，零 CDN，可合成导出 PNG）；右上角 **教研导学案抽屉 `TeachingPackDrawer`**（一键启动 POE/变式题预设、导出 Markdown 导学案、支持打印 CSS）；集成 `VitePWA` 离线缓存。 |
| **`apps/singlefile-exporter/`** | CLI 脚本 `pnpm export:singlefile -- --model=<id> [--preset=<id>]`，基于 `vite-plugin-singlefile` 按单模型打包（仅含精简壳 + 目标模型 + `uPlot` + `KaTeX`，严禁打入 Excalidraw、其余模型或非沙箱 `Rapier` WASM），实测产出约 `2.0 MB` 独立离线 `.html`。 |
| **`content/` & `scripts/`** | 6 份覆盖 4 大旗舰 + 光学 + 电路的 `content/teaching-packs/*.json`（含 20 道定量变式题）+ 2 份 `content/presets/*.json` 示例；`scripts/verify-teaching-packs.ts`（`pnpm verify:packs`）运行真实仿真内核逐一比对题目指标。 |
| **`docs/` & 开源门面** | 中英 `README.md`、教师无代码贡献指南 `CONTRIBUTING.md`、`THIRD_PARTY_NOTICES.md`、`LICENSE`（MIT）、`AGENTS.md`（AI 工程与物理严谨性宪法）、`docs/{BLUEPRINT,CURRICULUM_MAP,PEDAGOGY_GUIDE,WRITER_CONSTRUCTION_PLAN}.md` 与双角色交接日志。 |

### 3. 已通过的实证门禁（基于 `main@62f9383`）
* `pnpm typecheck`：6/6 子包 + `scripts` 全过；自有源码零 `@ts-ignore`、`as any`、`eslint-disable`、`.skip(`、`.only(`。
* `pnpm test`：10 个测试文件 / **46 条用例全绿**（含 100 周期机械能守恒、10 周期回旋动能与半径误差、欠阻尼/摆线/RC 指数解析解 `< 1e-4`、`bisectEvent` `< 1e-6 s` 边界捕获等）。
* `pnpm verify:packs`：6/6 教研包、**20/20 道变式题**全部通过 Zod 校验与真实物理内核定量验算。
* `pnpm build` & `export:singlefile`：PWA 预缓存 442 条资源，`rapier` 拆入独立懒加载 chunk；多份单文件 HTML（`~2001–2008 KB`）实测生成通过。
* **Chrome Playwright 实机全链路**：7 模型全部非空渲染；首屏未加载 Rapier、切入沙箱后才懒加载；导学案导出与 Preset 跳转、uPlot 双向回放、POE 遮罩、大屏 `18px`/热区 `≥ 44px`、Excalidraw 离线批注导出 PNG、单文件 HTML `file://` 运行全部通过，全程 `consoleErrors: []`、`pageErrors: []`、`externalRequests: []`。

---

## 三、架构红线（后续任何扩展不可打破）

1. **物理与视图解耦**：所有 ODE/MNA/追迹计算留在 `packages/physics-core` 或模型 `engine.ts`，可在 Node/Vitest 无头运行。
2. **渲染性能红线**：物理循环坚持固定步长累加器 + `rAF` + `ref`，禁止高频更新 React `useState`。
3. **开源许可证红线**：公开 MIT 仓，严禁引入 `GPL`（如 `circuitjs1` 源码）或商业受限 SDK（如 `tldraw`）。
4. **100% 离线与切片轻量化**：任何静态字体/资源必须本地打包；单文件切片禁止打入重型 WASM 或 Excalidraw。

---

## 四、总控的客观成熟度诊断与深度意见（核心思考）

> **总控坦诚评估**：如果将全球成熟的物理教学标杆（**PhET、ricktu288/ray-optics、CircuitJS1、Algodoo、GeoGebra/oPhysics、NB物理实验**）定义为 **100% 成熟度**，**PhysForge 1.0 目前大约处于 35%–45% 的位置**——它是一套**“架构地基扎实、数值最严谨、高考重难点精准的精品专题原型（MVP+）”**，但距离**“一线教师日常全科高频使用的成熟产品”**仍有以下 **6 大硬缺口**：

### 1. 我们已经真正领先（甚至超过部分标杆）的地方
* **离线 Preset 与单文件分发**：PhET Studio 的预设链接必须联网，PhysForge 可以导出 ~2MB 单文件离线 HTML 插进 PPT / 希沃白板双击即用。
* **理论物理级精确性与“零幻觉出题校验”**：`BorisPusher` + `bisectEvent` + `pnpm verify:packs` 实跑物理内核验算题目数值，这是多数定性动画工具或纯大模型出题工具所不具备的护城河。
* **紧扣中国高考压轴模型**：磁聚焦/动态圆、配速法、双杆含容、传送带共速突变，国内外开源项目几乎没有成体系的封装。

### 2. 距离成熟产品还差的 6 大关键短板（基于代码核查与全网横向对比）

1. **最大交互代差——Canvas 仍为“只读画布”，缺乏直接操纵（Direct Manipulation）与自由搭建**：
   * 成熟产品（PhET / Algodoo / ricktu288 ray-optics / CircuitJS1）都支持在画布上**直接用鼠标/手指拖拽元件**（拉弹簧、挪透镜、连导线、拖动探测点、放虚拟尺规）。
   * 反观 PhysForge 1.0：参数调整 **100% 依赖右侧滑块与下拉框**；核查 `SimulationStage.tsx` 可知，虽然 `Viewport` 定义了 `scale` / `offsetX` / `offsetY`，但目前连**画布鼠标拖拽平移与滚轮/双指缩放事件都未接通**；光学（5 个固定模式）、电路（4 个固定拓扑）、沙箱（4 个固定场景）仍属于“参数化预设演示”，还不是教师/学生能从零自由拼装的画板编辑器。
2. **模型与高考实验覆盖度低，尤其缺“高考分组实验仪器操作与误差分析”**：
   * PhET 拥有 **175+** 仿真；NB物理实验覆盖全部高中必考分组实验（打点计时器纸带逐差法、游标卡尺/螺旋测微器读数、描绘伏安特性曲线、测电源电动势与内阻、半偏法测表头内阻、油膜法测分子直径等），并具备接错烧表等容错反馈。
   * PhysForge 目前只有 **7 个模型**（不足人教版 6 册核心模型的 15%），且占高考物理 15–18 分的**实验仪器与误差分析类仿真目前空白**。
3. **缺少虚拟测量探针与 3D 空间视角**：
   * 缺少可拖拽的**虚拟直尺、量角器、秒表、万用表红黑表笔**以及 CircuitJS1 式的**电流粒子流速/节点染色**；
   * 纯 2D 在讲解**右手定则/左手定则、通电螺线管立体磁场、回旋加速器三维 D 形盒、质谱仪空间轨迹**时直观性明显受限。
4. **“教师零代码 Preset / 教研工作流”在网页端尚未闭环**：
   * 代码核查确认：目前 `apps/web/src` **并未自动读取 `content/presets/*.json`**（网页当前只加载各模型 `plugin.ts` 里硬编码的 `presets` 数组，`content/presets/` 仅作为仓库示例文件存在）。
   * 教师目前无法在网页内一键将调好的参数导出为 Preset JSON，也无法在网页里直接编辑/生成新教研包并触发校验（Google Research 2026 论文 *Harnessing Generative UI for Education* 倡导的 *Generate-then-Refine* 闭环目前仍停留在离线脚本阶段）。
5. **多端响应式与无障碍（WCAG）欠缺**：
   * 当前三栏工作台主要面向 1080p 横屏大屏/桌面浏览器，学生在手机竖屏或窄屏平板上访问会被挤压；
   * 相比 PhET 的 Scenery Parallel DOM（支持全键盘 Tab 导航、焦点框、屏幕阅读器与声音化），PhysForge 的 Canvas 内部图形元素尚无键盘可访问性或语义映射。
6. **工程自动化与真实教室“十节课淬炼”缺失**：
   * 仓库尚缺 **GitHub Actions 自动 CI**（自动跑 `typecheck + test + verify:packs + build`）、**GitHub Pages 在线体验部署**与动态演示 GIF；
   * 更核心的是尚未经过**真实高中教室希沃一体机 5–10 节完整 40 分钟课堂实地试讲与同行教师试用反馈**——真实大屏的触控防误触、单文件 U 盘在校园老旧 Windows/WPS/PPT 超链接下的真实兼容性、课堂讲评一键撤回等体感细节，必须靠真课堂暴露后反哺迭代。

---

## 五、总控推荐的 V2.0 演进路线（不盲目堆数量，先补“交互代差与真课闭环”）

1. **Stage V2-A（把“死画布”变“活画布” + 打通教师 Preset 闭环）**：
   * 在 `SimulationStage.tsx` 与 `sim-sdk` 中引入可选交互钩子（`onPointerDown/Move/Up`、画布拖拽平移与滚轮缩放），优先让磁场的发射源、机械波探测质点 P、光学入射角手柄、力学滑块位置**可直接用电磁笔在画布上拖着走**；
   * 打通 `content/presets/*.json` 自动合并加载入 `apps/web`，并增加网页端“一键导出当前参数为 Preset JSON”与“独立浏览器编辑/导入”。
2. **Stage V2-B（CI 自动化 + 真实课堂试讲淬炼）**：
   * 配置 `.github/workflows/ci.yml` 与 GitHub Pages 在线演示；
   * 到真实教室希沃一体机实测 3–5 节课（覆盖“单文件 PPT 插入”“Excalidraw 画圆心”“POE 遮罩提问”），记录并修掉一线全部 UX 摩擦点。
3. **Stage V2-C（补齐高考刚需实验仪器 + 3D 电磁视角 + 自由电路/光学画板）**：
   * 新增 4 个高频高考实验仿真（打点计时器纸带处理、游标卡尺与螺旋测微器、电表内阻与伏安特性、测电源电动势与内阻，含虚拟表笔与接错保护警示）；
   * 按需懒加载 `Three.js` 增加 **3D 电磁空间场与回旋加速器/质谱仪视角**；
   * 逐步将 `circuit-dc-capacitor-mna` 和 `optics-ray-studio` 从固定模式升级为“可拖拽连线/放置元件的自由画板”。

---

## 六、给线上 AI 的协作引导建议

当你将本文件上传给线上 AI 时，可以重点让它帮你出谋划策或细化以下 3 类问题：
1. **交互架构设计**：如何在保持 `packages/physics-core` 与视图解耦的前提下，把 `SimulationPlugin` 协议优雅地扩展出“画布直接拖拽控制点 + 虚拟直尺/量角器/电表表笔层”？
2. **高中物理实验仿真建模**：针对“测电源电动势和内阻”“描绘小灯泡伏安特性曲线”“纸带逐差法”等高考实验，如何用真实误差模型（电表内阻分压/分流、非线性灯丝伏安曲线、偶然误差分布）做出超越普通演示动画的探究体验？
3. **AI 教研自动出题管线**：参考 Google 2026 *Learning Design Guardrails* 论文，如何设计“教师输入考点 → LLM 生成变式题与 Preset JSON → 自动调用 `verify-teaching-packs` 闭环自修正”的本地/半自动工作流？
