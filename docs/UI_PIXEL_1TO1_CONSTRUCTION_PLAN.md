# PhysForge 总控全维度深度调研与 1:1 视觉复刻施工方案（Luna 直接落地版）

> **文档定位**：本文件是总控在完成 **43 单元全仓静态/架构审计 + 4 张基准图（[01_workbench_em.png](file:///d:/project%20code/44-PhysForge/docs/ui-benchmark/01_workbench_em.png) ~ [04_fullscreen_3d.png](file:///d:/project%20code/44-PhysForge/docs/ui-benchmark/04_fullscreen_3d.png)）逐像素对比 + 业界标杆平台（PhET / NOBOOK / Falstad / oPhysics / Algodoo / Desmos）全网调研** 后，为写手（Luna）编写的**可直接复制编译级施工代码与分波次整改总纲**。  
> **配套宪法**：[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md) ｜ **当前仅落盘施工方案，不擅改业务代码**。

---

## 第一部分：总控全方位调研与批判（为什么现在远未达到 1:1 复刻？）

### 1.1 一比一视觉复刻逐项差距审计（实机 vs 4 张标尺图）

当前实机虽然通过了基础结构验收（48px 顶栏、不重叠、能运行），但与用户要求“打开网页即与四张效果图一模一样”存在 **5 类结构性视觉断层**：

| 对标部位 | 基准图真实形态（`01`~`04`） | 当前实机代码缺陷与位置 | 必须达到的 1:1 复刻标准 |
| :--- | :--- | :--- | :--- |
| **首屏打开默认态** | 打开即见 **电磁感应·单杆切割**（`01_workbench_em.png`） | [useClassroomStore.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/store/useClassroomStore.ts#L15) 默认静态导入 `emBoundedMagneticFieldPlugin` (`B1`) | 默认首屏加载 `em-induction-double-rod`（且默认单杆电源驱动预设），一打开即见标尺 1 画面 |
| **顶栏左右与中心胶囊** | 左：简洁主标题 + `t = X.XX s`；中：蓝色发光圆形播控键 + `前移/重置/1.0x` | [App.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/App.tsx#L190-L195) 左侧强塞过长教材章节号被截断；右侧按钮偏方偏重 | 左只保留简洁两行；中心圆形主按钮加青蓝漫射晕；右侧 3 个胶囊保持极简呼吸感 |
| **左侧极细图标轨** | 顶部 **`≡` 汉堡按钮**（无 `PF` 方块）；图标激活态为**左缘 `3px` 青蓝竖条 + 纯青图标**；最底端沉底 **`⚙` 设置齿轮** | [LeftCatalogSidebar.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/LeftCatalogSidebar.tsx#L99-L108) 顶部有蓝底 `PF` 方块、缺失底部 `⚙` 设置键、激活态用粗边框方框 | 完全替换：顶 `≡`、中 5 图标左缘亮条指示、底 `⚙` 快捷设置浮层（主题/倍速/大屏模式） |
| **右侧悬浮控制卡片** | **右上悬浮紧凑卡片**（不拉到屏底！），**无顶部大标题头**；顶部单行 `预设 [下拉 v]`；第 1 屏直接露 **3 个纯正数值滑块**（如 `电动势 E / 磁感应强度 B / 电阻 R`）；中部暗凹槽大号公式卡；底部**纤细双进度条或 `0V..12V` 电势色条** | [RightControlPanel.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/RightControlPanel.tsx#L97-L202) 从顶通到底；顶部有 `参数控制台 ×` 占高；前 4 个字段机械切前 4 项，把 `select` 下拉框挤占首屏滑块位；底部 `EnergyBarChart` 庞大被裁切溢出 | 取消顶通到底高度限制（改为紧凑右上卡片 `max-h-[calc(100vh-84px)]`）；删冗长标题栏；按情景优先展示 **3 个关键数值滑块**；公式卡改为深凹槽居中排版；底部改为纤细条/色标 |
| **底部示波器（标尺 1）** | 宽约 `400px` 居中精巧浮卡：左上 `示波器`、右上 **`v-t` / `I-t` 双色药丸标签**；曲线带发光描边 + **下方青/橙渐变半透明面积填充** | [SimulationStage.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/SimulationStage.tsx#L693-L756) `560px` 宽卡上方强塞两个 `<select>` 下拉框，下方 `uPlot` 只有扁平细折线与原生底部文字图例 | 去掉丑陋 `<select>` 与 uPlot 原生底图例，改用顶部双色药丸切换 + Canvas `LinearGradient` 渐变填充曲线 |
| **E04 舞台（标尺 1）** | **两端优雅渐隐高光圆柱导轨**、暗灰精细 `×`（无圆圈！）、导体棒后方带青色高速运动光晕尾迹；仅 3 个清晰矢量：`F安 = 3.12 N`（左箭头+大字）、青色向右箭头、`I = 2.08 A` 紧贴下导轨 | [em-induction-double-rod/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/em-induction-double-rod/plugin.ts#L444-L557) 把画布框在生硬矩形框里、画圆圈 `⊗`、左端贴扁平 `[E]` 方框、未使用 `worldToScreen` 导致缩放失灵 | 采用 `CanvasVisualKit` 的 `drawMetallicRail`、`drawDotCrossField`、`drawGlowingConductorRod`，全坐标对齐 `ViewportController` |
| **B3 舞台（标尺 2）** | 屏幕中央**有边界矩形半透明玻璃块**（介质 1）、交点处发光黄圆环、暖金反射光晕与宽光束、清晰外侧弧线度数 `θ₁ = 35.0°` / `θ₂ = 59.4°`、左下纯净 3 格毛玻璃底座 | [optics-ray-studio/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/optics-ray-studio/plugin.ts#L441-L461) 用 `fillRect(0, 0, w, p0.sy)` 涂蓝上半屏并拉出通屏横线，黄点脱离交点，角度弧线未标具体度数 | 介质 1 改为居中透光玻璃块 + 边缘微光，交点内置发光黄环手柄，弧线旁标明精准度数并剔除顶部多余 HUD 文字 |
| **B2 舞台（标尺 3）** | 圆角粗发光**红→黄→蓝电势梯度导线**、三角流动电流粒子、**锯齿滑动变阻器+可拖滑片环**、**随功率发光的玻璃小灯泡**、三横 `GND`、圆形数字表盘、**右下角悬浮 `I-U 曲线` 小玻璃卡**、左下双层 `0V/12V` + **7 格元件工具栏** | [circuit-dc-capacitor-mna/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/circuit-dc-capacitor-mna/plugin.ts#L448-L537) 为直角折线 + 方框电阻，缺锯齿滑变符号、缺真实发光灯泡、缺 `GND`、缺右下角 `I-U` 小曲线、缺左下 7 格仪器工具栏 | 新增 `'divider-lamp'`（分压测小灯泡 MNA-NR）与标尺 3 绘制套件，彻底补齐 `I-U` 悬浮小卡与左下器材栏 |
| **E10 3D 全屏（标尺 4）** | **水平横放铜金属螺旋管**（工作室 IBL 高光反射）、内部+外侧**上下对称闭合回弯青色磁感线环**、3D 矢量旁**直接带 `v` / `F_洛` / `B` 标签**、地平线暗色渐隐透视网格（无彩色长十字线）、右上大字简洁 KaTeX 公式（高亮 `v` 和 `B` 胶囊） | [ThreeStage.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/ThreeStage.tsx#L132-L315) 螺线管竖放、仅中心 4 根发散直线无外部闭合回流、无 `RoomEnvironment` 反射、存在 `AxesHelper(2.2)` 杂线、3D 矢量无文字标识 | 引入 `RoomEnvironment` + 横向映射 `(p.z, p.y, p.x)` + 双向闭合环路种子追踪 + `CSS2DRenderer` 空间矢量标签 + 径向渐隐地面网格 |

---

### 1.2 全仓 43 个物理单元与交互硬伤深度排查

经脚本扫描 `simulations/*/plugin.ts` 与 `engine.ts` 全仓实盘状态，发现 **4 个必须排入计划的深层技术债**：

1. **【严重隐形 Bug】`18 / 43` 个模型存在坐标系分裂（缩放与平移失效）**：
   - `SimulationStage.tsx` 的画布平移（`offsetX/offsetY`）、滚轮缩放（`scale`）、`getControlHandles` 命中与 `Auto-FBD` 矢量叠加统一走 [ViewportController.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/ViewportController.ts)（原点 `0.45 * width, 0.5 * height`，`ppm = min(w, h) * 0.24 * scale`）。
   - 然而以下 **18 个模型** 在 `renderCanvas` 中硬编码 `viewport.width * ...` 而未使用 `worldToScreen` / `viewport.scale`：**一滚轮缩放或拖动画布，画面纹丝不动但绿色/粉色拖动手柄会脱离物体飞走！**
     - 受影响清单：`em-induction-double-rod`、`circuit-dc-capacitor-mna`、`builder-custom-ode-lab`、`em-ac-field-oscilloscope`、`em-capacitor-millikan`、`em-eddy-vortex-field`、`em-electrostatic-field`、`em-wireframe-rotation`、`mech-block-conveyor`、`mech-collision-recoil`、`mech-constrained-velocity`、`mech-dynamic-equilibrium`、`mech-free-sandbox`、`mech-kinematics-chase`、`mech-projectile-coupling`、`mech-vertical-circular`、`wave-2d-ripple-fdtd`、`wave-vibration-coupling`。
2. **【悬停与触控缺失】`SimulationStage.tsx` 缺少交互微反馈**：
   - 鼠标悬停在任意 `getControlHandles` 圆柄上时，画布 `cursor` 死锁为 `grab` 而不切换 `pointer`，圆柄无放大高亮与实时数值标签提示，学生不知可抓可拖。
   - 缺少多点触控双指捏合缩放（希沃大屏/iPad 刚需），也缺少双击画布一键居中复位。
3. **【交互覆盖率两极分化】43 单元交互能力分布不均**：
   - `getControlHandles`：**34 / 43** 具备（缺 9 项：`em-3d-magnetic-fields`、`stse-tokamak-magnetic-mirror`、`stse-em-launch-regen-brake`、`stse-em-devices-suite`、`thermo-cycles-kinetic-md`、`comp-relativity-quantum-tunneling`、`modern-nuclear-recoil-decay`、`modern-rutherford-bohr`、`modern-photoelectric-compton`）。
   - `getForceVectors`（Auto-FBD）：仅 **16 / 43** 具备（27 项缺失）。
   - `referenceFrames`（随动参考系）：仅 **10 / 43** 具备。
   - 3D PBR 舞台：仅 **2 / 43**（`E10`、`S01`）。
   - 代码体量明显分层：头部 7 个核心单元（`B1–B3, E04, M05, B4, W01`）有 `404–692` 行深度定制与丰富预设；其余 36 个单元的 `plugin.ts` 仅 `154–323` 行，视觉还停留在基础几何线段。
4. **【文字重叠隐忧】仅靠手工摆点微调，缺公共碰撞避让器**：
   - 目前仅 `AutoFbdOverlay.tsx` 内置简易斥力算法，各模型的 `renderCanvas` 互相独立绘制文字，随着视角缩放或参数极端（如双杆靠近、电势节点靠近）仍容易互压。

---

### 1.3 全网竞品深度对标（模型数 × UI 质感 × 交互自由度）

| 维度 | **PhET Interactive** | **NOBOOK 物理实验** | **Falstad Circuit** | **oPhysics / GeoGebra / Algodoo** | **PhysForge 当前状态与破局策略** |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **物理模型数量** | 物理专题 **50–60** 个（HTML5 全平台） | 初高中合计 **200–700+** 细分实验 | 电路为核心，含百余经典拓扑预设 | oPhysics ~80 单点实验；GeoGebra 工具驱动 | **43 单元已逼近 PhET 物理体量！** 短板不在总数，而在后 36 单元“深度薄”。建议后续精选补强 **5 个高频缺口场景**至 ~48 单元 |
| **画布直接操纵** | 物理实体即手柄（拉弹簧、拖透镜、拖测量尺表笔直接读数） | 1000+ 器材自由拖放连线、烧坏告警 | 节点连线+右键属性+悬停实时读 `U/I` | GeoGebra 联动几何点；Algodoo 任意斜劈刚体绘制 | 必须把 18 单元坐标统一起来，加**手柄悬停高亮+数值提示气泡**，并在 B2/B3/B4 加入**底栏器材点击/放置模式** |
| **隐藏量可视化** | 能量柱状图、场线箭头随拖动零延迟更新 | 3D 磁感线与电流方向可视化 | 电势绿/红染色 + 黄点流动 | 动态矢量分力实时缩放 | 用 `CanvasVisualKit` 统一电势色流、矢量发光、玻璃体折射、能量细条 |
| **教学痛点匹配** | 概念直觉极强，缺中国高考压轴综合题与全屏演说节奏 | 适合随堂分组操作，UI 较杂且付费闭源、无离线单文件分发 | 工程味过重，不适合教室大屏后排观摩 | 偏静态微件感，无统一课标目录与试卷矢量导出 | **PhysForge 独有杀手锏**：离线零 CDN + **全屏课堂演说态** + 黑白试卷 SVG/TikZ 导出 + 高考临界事件二分定位（$10^{-7}\text{ s}$） |

**全网对标建议补齐的 5 个高价值模型/深化方向（纳入后续第 2/3 波，不阻塞本轮 1:1 UI 施工）**：
1. **B3 组合光具座（多透镜+平面镜任意拖拽组合，实时找实像/虚像光路交点）** — 对标 PhET Geometric Optics 与 NOBOOK 光具座；
2. **B2 交互自由连线/元件开关点击（画布内直接点击闭合开关 `S`、切换灯泡/二极管/定值/电容、悬停导线/节点出 `U/I` 浮动读数，对应右上/左下器材工具栏）** — 对标 Falstad + NOBOOK；
3. **高三高频多体动量/弹簧滑块/人船连接体专项强化（扩展 `mech-collision-recoil` 与 `mech-spring-separation` 拖拽初速与滑轮斜劈组合）**；
4. **物理必做实验专台增强（示波器电子束偏转荧光屏实操 `em-ac-field-oscilloscope` + 多用电表黑箱探测交互）**；
5. **现代物理交互手柄补全（光电效应直接拖动入射光颜色光谱条与滑动变阻器 `modern-photoelectric-compton`；卢瑟福散射直接拖动粒子瞄准距 `b` `modern-rutherford-bohr`）**。

---

## 第二部分：1:1 像素级复刻基层直接施工代码（Luna 照抄集成）

> **致 Luna 的强制施工说明**：以下 10 份核心模块代码已严格核对本地类型定义与 E2E `data-testid`。请严格按顺序落盘替换或创建，**严禁私自删减已有 `data-testid`**，严禁引入任何 `as any`、`@ts-ignore` 或外网链接。

---

### 模块 1：精确视觉 Token 与滑块/发光样式（覆盖 `apps/web/src/index.css`）

```css
@import "tailwindcss";
@import "uplot/dist/uPlot.min.css";
@import "katex/dist/katex.min.css";

:root {
  --pf-bg: #0b0f17;
  --pf-topbar-bg: rgba(13, 19, 30, 0.86);
  --pf-rail-bg: rgba(11, 16, 26, 0.9);
  --pf-surface: rgba(17, 24, 38, 0.78);
  --pf-surface-elevated: rgba(11, 16, 27, 0.84);
  --pf-glass: rgba(18, 25, 39, 0.76);
  --pf-border: rgba(148, 163, 184, 0.16);
  --pf-border-strong: rgba(56, 189, 248, 0.42);
  --pf-text: #f1f5f9;
  --pf-text-muted: #94a3b8;
  --pf-accent: #38bdf8;
  --pf-accent-glow: rgba(56, 189, 248, 0.52);
  --pf-canvas-bg: #0b0f17;
}

[data-theme="projector"] {
  --pf-bg: #f8fafc;
  --pf-topbar-bg: rgba(255, 255, 255, 0.94);
  --pf-rail-bg: rgba(248, 250, 252, 0.96);
  --pf-surface: rgba(255, 255, 255, 0.94);
  --pf-surface-elevated: rgba(241, 245, 249, 0.96);
  --pf-glass: rgba(255, 255, 255, 0.92);
  --pf-border: rgba(100, 116, 139, 0.28);
  --pf-border-strong: rgba(2, 132, 199, 0.55);
  --pf-text: #0f172a;
  --pf-text-muted: #475569;
  --pf-accent: #0284c7;
  --pf-accent-glow: rgba(2, 132, 199, 0.35);
  --pf-canvas-bg: #ffffff;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
  background-color: var(--pf-bg);
  color: var(--pf-text);
  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
}

.big-screen-mode {
  font-size: 18px;
}

.pf-touch-target {
  min-height: 36px;
  min-width: 36px;
}

.big-screen-mode .pf-touch-target {
  min-height: 44px;
  min-width: 44px;
  font-size: 17px;
}

/* 顶部玻璃胶囊与右侧三键 */
.pf-floating-glass {
  background: linear-gradient(160deg, rgba(24, 33, 50, 0.82) 0%, rgba(13, 19, 31, 0.78) 100%) !important;
  backdrop-filter: blur(18px) saturate(135%);
  -webkit-backdrop-filter: blur(18px) saturate(135%);
  box-shadow:
    0 14px 36px rgba(0, 0, 0, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

[data-theme="projector"] .pf-floating-glass {
  background: rgba(255, 255, 255, 0.92) !important;
  color: #0f172a;
  border-color: rgba(100, 116, 139, 0.32);
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
}

.pf-top-pill {
  display: inline-flex;
  height: 32px;
  align-items: center;
  gap: 6px;
  border-radius: 9px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(30, 41, 59, 0.48);
  padding: 0 12px;
  font-size: 12px;
  font-weight: 500;
  color: #cbd5e1;
  transition: all 140ms ease;
  cursor: pointer;
}

.pf-top-pill:hover,
.pf-top-pill[aria-expanded="true"] {
  border-color: rgba(148, 163, 184, 0.32);
  background: rgba(51, 65, 85, 0.6);
  color: #f8fafc;
}

.pf-top-pill-primary {
  border-color: rgba(56, 189, 248, 0.35);
  background: rgba(56, 189, 248, 0.14);
  color: #e0f2fe;
}

.pf-top-pill-primary:hover {
  border-color: rgba(56, 189, 248, 0.6);
  background: rgba(56, 189, 248, 0.22);
}

[data-theme="projector"] .pf-top-pill {
  background: rgba(226, 232, 240, 0.72);
  color: #1e293b;
}

[data-theme="projector"] .pf-top-pill-primary {
  background: rgba(2, 132, 199, 0.14);
  color: #0369a1;
}

/* 标尺 1/2/3 发光青色滑轨 */
input[type="range"].pf-slider {
  --pf-progress: 0%;
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 26px;
  background: transparent;
  cursor: pointer;
  margin: 0;
}

input[type="range"].pf-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    #38bdf8 0%,
    #38bdf8 var(--pf-progress),
    rgba(148, 163, 184, 0.22) var(--pf-progress),
    rgba(148, 163, 184, 0.22) 100%
  );
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.22);
}

input[type="range"].pf-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  margin-top: -5px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid #e0f2fe;
  background: #38bdf8;
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.85);
  transition: transform 100ms ease, box-shadow 100ms ease;
}

input[type="range"].pf-slider:hover::-webkit-slider-thumb {
  transform: scale(1.16);
  box-shadow: 0 0 16px rgba(56, 189, 248, 1);
}

input[type="range"].pf-slider::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.22);
}

input[type="range"].pf-slider::-moz-range-progress {
  height: 4px;
  border-radius: 999px;
  background: #38bdf8;
}

input[type="range"].pf-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 2px solid #e0f2fe;
  border-radius: 50%;
  background: #38bdf8;
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.85);
}

/* 标尺 4 全屏公式卡大字排版 + 青光高亮变量支持 */
.pf-presentation-formula .katex {
  font-size: 1.55em;
  color: #f8fafc;
}

.pf-right-formula .katex {
  font-size: 1.06em;
}

.pf-3d-label {
  pointer-events: none;
  user-select: none;
  font-family: "Times New Roman", "Cambria Math", Georgia, serif;
  font-style: italic;
  font-weight: 700;
  font-size: 18px;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.92), 0 0 14px rgba(0, 0, 0, 0.75);
  white-space: nowrap;
}

button:focus-visible,
select:focus-visible,
input:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--pf-accent);
  outline-offset: 2px;
}

/* 隐藏 uPlot 默认多余图例行（改用卡片右上双药丸） */
.pf-compact-scope .u-legend {
  display: none !important;
}

.pf-compact-scope .u-wrap {
  background: transparent !important;
}

@media (max-width: 760px) {
  [data-testid="topbar"] > div:first-child {
    max-width: 34%;
  }
  [data-testid="topbar"] [data-testid="topbar-actions"] span {
    display: none;
  }
  [data-testid="right-control-panel"] {
    width: min(268px, calc(100vw - 64px));
  }
}
```

---

### 模块 2：公共物理画布质感与防重叠原语库（新建 `packages/sim-sdk/src/visualKit.ts` 并从 `packages/sim-sdk/src/index.ts` 导出）

> **包边界铁律**：放在 `packages/sim-sdk/src/visualKit.ts`（并从 `packages/sim-sdk/src/index.ts` 增加 `export * from './visualKit.js';`），**绝不放在 `apps/web/` 下**，以便全部 43 个 `simulations/*/plugin.ts` 与 `apps/singlefile-exporter` 统一直接 `import { ... } from '@physforge/sim-sdk'`。纯 Canvas 2D 接口零 DOM 实例化，可在 Node / Vitest / headless 完美运行。

```ts
export interface LabelBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
  font?: string;
  bgColor?: string;
}

/**
 * 标尺 1 级三维高光渐变圆柱导轨（两端平滑淡出，无生硬端点矩形边框）
 */
export function drawMetallicRail(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y: number,
  x2: number,
  thickness = 8
): void {
  ctx.save();
  const vGrad = ctx.createLinearGradient(0, y - thickness * 0.5, 0, y + thickness * 0.5);
  vGrad.addColorStop(0, '#64748b');
  vGrad.addColorStop(0.28, '#f1f5f9');
  vGrad.addColorStop(0.58, '#94a3b8');
  vGrad.addColorStop(1, '#334155');

  const hMask = ctx.createLinearGradient(x1, 0, x2, 0);
  hMask.addColorStop(0, 'rgba(255,255,255,0)');
  hMask.addColorStop(0.08, 'rgba(255,255,255,0.92)');
  hMask.addColorStop(0.92, 'rgba(255,255,255,0.92)');
  hMask.addColorStop(1, 'rgba(255,255,255,0)');

  ctx.shadowColor = 'rgba(226, 232, 240, 0.25)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = vGrad;
  ctx.fillRect(x1, y - thickness * 0.5, x2 - x1, thickness);

  // 两端柔和淡入暗背景
  ctx.shadowBlur = 0;
  const fadeW = Math.max(24, (x2 - x1) * 0.08);
  const leftFade = ctx.createLinearGradient(x1, 0, x1 + fadeW, 0);
  leftFade.addColorStop(0, '#0b0f17');
  leftFade.addColorStop(1, 'rgba(11, 15, 23, 0)');
  ctx.fillStyle = leftFade;
  ctx.fillRect(x1 - 2, y - thickness, fadeW + 2, thickness * 2);

  const rightFade = ctx.createLinearGradient(x2 - fadeW, 0, x2, 0);
  rightFade.addColorStop(0, 'rgba(11, 15, 23, 0)');
  rightFade.addColorStop(1, '#0b0f17');
  ctx.fillStyle = rightFade;
  ctx.fillRect(x2 - fadeW, y - thickness, fadeW + 2, thickness * 2);

  void hMask;
  ctx.restore();
}

/**
 * 标尺 1 级精细暗灰磁场阵点（仅画细净 × 或 · 符号，去掉杂乱圆圈边框）
 */
export function drawDotCrossField(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  direction: 'in' | 'out',
  spacingX = 76,
  spacingY = 58
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
  ctx.fillStyle = 'rgba(148, 163, 184, 0.36)';
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  const r = 4.5;
  for (let x = left + spacingX * 0.5; x < left + width - 16; x += spacingX) {
    for (let y = top + spacingY * 0.5; y < top + height - 10; y += spacingY) {
      if (direction === 'in') {
        ctx.beginPath();
        ctx.moveTo(x - r, y - r);
        ctx.lineTo(x + r, y + r);
        ctx.moveTo(x + r, y - r);
        ctx.lineTo(x - r, y + r);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

/**
 * 标尺 1 级带高速残影辉光的发光导体棒
 */
export function drawGlowingConductorRod(
  ctx: CanvasRenderingContext2D,
  x: number,
  yTop: number,
  yBot: number,
  velocitySign: number,
  tintHex = '#38bdf8',
  coreHex = '#e0f2fe',
  rodWidth = 11
): void {
  ctx.save();
  // 后方运动残影尾迹
  if (Math.abs(velocitySign) > 0.01) {
    const dir = velocitySign >= 0 ? -1 : 1;
    const wakeLen = 96;
    const wakeGrad = ctx.createLinearGradient(x, 0, x + dir * wakeLen, 0);
    wakeGrad.addColorStop(0, 'rgba(56, 189, 248, 0.26)');
    wakeGrad.addColorStop(0.55, 'rgba(56, 189, 248, 0.08)');
    wakeGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = wakeGrad;
    const wx = dir < 0 ? x + dir * wakeLen : x;
    ctx.fillRect(wx, yTop + 4, wakeLen, yBot - yTop - 8);
  }

  const rodGrad = ctx.createLinearGradient(x - rodWidth * 0.5, 0, x + rodWidth * 0.5, 0);
  rodGrad.addColorStop(0, '#0284c7');
  rodGrad.addColorStop(0.45, coreHex);
  rodGrad.addColorStop(1, '#0369a1');

  ctx.shadowColor = tintHex;
  ctx.shadowBlur = 22;
  ctx.fillStyle = rodGrad;
  ctx.beginPath();
  ctx.roundRect(x - rodWidth * 0.5, yTop - 12, rodWidth, yBot - yTop + 24, rodWidth * 0.45);
  ctx.fill();
  ctx.restore();
}

/**
 * 统一发光矢量箭头（支持水平/任意角度与精致三角尖头）
 */
export function drawGlowVectorArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  lineWidth = 4,
  headLen = 13
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 6) return;
  const ang = Math.atan2(dy, dx);
  const tipStartX = x2 - headLen * 0.72 * Math.cos(ang);
  const tipStartY = y2 - headLen * 0.72 * Math.sin(ang);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(tipStartX, tipStartY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(ang - 0.48), y2 - headLen * Math.sin(ang - 0.48));
  ctx.lineTo(x2 - headLen * Math.cos(ang + 0.48), y2 - headLen * Math.sin(ang + 0.48));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * 标尺 2 级居中有界玻璃砖（上下带 Fresnel 微光，不再铺满整个上半屏）
 */
export function drawRefractiveGlassBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  ctx.save();
  const grad = ctx.createLinearGradient(x, y, x + width, y + height);
  grad.addColorStop(0, 'rgba(125, 211, 252, 0.24)');
  grad.addColorStop(0.55, 'rgba(56, 189, 248, 0.14)');
  grad.addColorStop(1, 'rgba(56, 189, 248, 0.08)');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, width, height);

  // 玻璃四边框与底部分界高亮
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);

  const botY = y + height;
  ctx.shadowColor = 'rgba(125, 211, 252, 0.65)';
  ctx.shadowBlur = 10;
  ctx.strokeStyle = 'rgba(186, 230, 253, 0.72)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x, botY);
  ctx.lineTo(x + width, botY);
  ctx.stroke();
  ctx.restore();
}

/**
 * 标尺 3 级圆角平滑电势渐变导线
 */
export function drawRoundedPotentialPath(
  ctx: CanvasRenderingContext2D,
  pts: ReadonlyArray<{ x: number; y: number }>,
  startColor: string,
  endColor: string,
  cornerRadius = 12,
  lineWidth = 5
): void {
  if (pts.length < 2) return;
  const pStart = pts[0]!;
  const pEnd = pts[pts.length - 1]!;
  const grad = ctx.createLinearGradient(pStart.x, pStart.y, pEnd.x, pEnd.y);
  grad.addColorStop(0, startColor);
  grad.addColorStop(1, endColor);

  ctx.save();
  ctx.strokeStyle = grad;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = startColor;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.moveTo(pStart.x, pStart.y);
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]!;
    const curr = pts[i]!;
    const next = pts[i + 1]!;
    const len1 = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const len2 = Math.hypot(next.x - curr.x, next.y - curr.y);
    const r = Math.min(cornerRadius, len1 * 0.4, len2 * 0.4);
    ctx.arcTo(curr.x, curr.y, next.x, next.y, r);
  }
  ctx.lineTo(pEnd.x, pEnd.y);
  ctx.stroke();
  ctx.restore();
}

/**
 * 标尺 3 级随真实功率动态发光的玻璃小灯泡符号
 */
export function drawGlowingBulbSymbol(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  powerWatts: number,
  ratedWatts = 10,
  radius = 18
): void {
  const ratio = Math.max(0, Math.min(1.3, powerWatts / Math.max(0.2, ratedWatts)));
  ctx.save();

  // 外部光晕
  if (ratio > 0.02) {
    const halo = ctx.createRadialGradient(cx, cy - 2, 2, cx, cy - 2, radius * 2.5);
    halo.addColorStop(0, `rgba(253, 224, 71, ${(0.45 * Math.min(1, ratio)).toFixed(2)})`);
    halo.addColorStop(0.5, `rgba(251, 146, 60, ${(0.22 * Math.min(1, ratio)).toFixed(2)})`);
    halo.addColorStop(1, 'rgba(251, 146, 60, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy - 2, radius * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 玻璃球泡
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.strokeStyle = ratio > 0.05 ? '#fde047' : '#94a3b8';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#fbbf24';
  ctx.shadowBlur = 16 * Math.min(1, ratio);
  ctx.beginPath();
  ctx.arc(cx, cy - 3, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 灯丝弧线与基座
  ctx.shadowBlur = 0;
  ctx.strokeStyle = ratio > 0.05 ? '#fef08a' : '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 5, cy + radius - 6);
  ctx.lineTo(cx - 5, cy - 3);
  ctx.lineTo(cx - 2, cy - 7);
  ctx.lineTo(cx + 2, cy - 1);
  ctx.lineTo(cx + 5, cy - 7);
  ctx.lineTo(cx + 5, cy + radius - 6);
  ctx.stroke();

  // 放射光芒短线
  if (ratio > 0.1) {
    ctx.strokeStyle = `rgba(253, 224, 71, ${(0.35 + 0.55 * Math.min(1, ratio)).toFixed(2)})`;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    for (let k = -2; k <= 2; k++) {
      const a = -Math.PI * 0.5 + k * 0.58;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (radius + 5), cy - 3 + Math.sin(a) * (radius + 5));
      ctx.lineTo(cx + Math.cos(a) * (radius + 11 + ratio * 4), cy - 3 + Math.sin(a) * (radius + 11 + ratio * 4));
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * 标准三横接地符号 (GND)
 */
export function drawGroundSymbol(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color = '#38bdf8'
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + 10);
  ctx.moveTo(x - 13, y + 10);
  ctx.lineTo(x + 13, y + 10);
  ctx.moveTo(x - 8, y + 16);
  ctx.lineTo(x + 8, y + 16);
  ctx.moveTo(x - 4, y + 22);
  ctx.lineTo(x + 4, y + 22);
  ctx.stroke();
  ctx.restore();
}

/**
 * 标尺 3 级嵌入右下角迷你玻璃 I-U 特性曲线卡片
 */
export function drawFloatingIUCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  samples: ReadonlyArray<{ u: number; i: number }>,
  currentPoint?: { u: number; i: number }
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(18, 25, 39, 0.84)';
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
  ctx.lineWidth = 1.2;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 14);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();

  ctx.fillStyle = '#cbd5e1';
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillText('I-U 曲线', x + 14, y + 24);

  if (samples.length < 2) {
    ctx.restore();
    return;
  }
  const padX = 16;
  const padTop = 38;
  const padBot = 16;
  const pw = width - padX * 2;
  const ph = height - padTop - padBot;
  const maxU = Math.max(1e-3, ...samples.map((s) => Math.abs(s.u)));
  const maxI = Math.max(1e-3, ...samples.map((s) => Math.abs(s.i)));

  const toPx = (u: number, i: number) => ({
    px: x + padX + (u / maxU) * pw,
    py: y + height - padBot - (i / maxI) * ph
  });

  // 面积半透明红蓝渐变填充
  const areaGrad = ctx.createLinearGradient(x + padX, y + height - padBot, x + padX + pw, y + padTop);
  areaGrad.addColorStop(0, 'rgba(56, 189, 248, 0.05)');
  areaGrad.addColorStop(1, 'rgba(251, 113, 133, 0.24)');
  ctx.beginPath();
  const p0 = toPx(samples[0]!.u, samples[0]!.i);
  ctx.moveTo(p0.px, y + height - padBot);
  for (const s of samples) {
    const pt = toPx(s.u, s.i);
    ctx.lineTo(pt.px, pt.py);
  }
  const pLast = toPx(samples[samples.length - 1]!.u, samples[samples.length - 1]!.i);
  ctx.lineTo(pLast.px, y + height - padBot);
  ctx.closePath();
  ctx.fillStyle = areaGrad;
  ctx.fill();

  // 主曲线（蓝→暖红渐变）
  const lineGrad = ctx.createLinearGradient(x + padX, y + height - padBot, x + padX + pw, y + padTop);
  lineGrad.addColorStop(0, '#38bdf8');
  lineGrad.addColorStop(0.55, '#fbbf24');
  lineGrad.addColorStop(1, '#fb7185');
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  samples.forEach((s, idx) => {
    const pt = toPx(s.u, s.i);
    if (idx === 0) ctx.moveTo(pt.px, pt.py);
    else ctx.lineTo(pt.px, pt.py);
  });
  ctx.stroke();

  if (currentPoint) {
    const cp = toPx(currentPoint.u, currentPoint.i);
    ctx.fillStyle = '#fde047';
    ctx.shadowColor = '#fde047';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(cp.px, cp.py, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * 通用标签包围盒碰撞避让算法（禁止画布任意两枚文字互压）
 */
export function resolveAndDrawLabels(
  ctx: CanvasRenderingContext2D,
  rawLabels: ReadonlyArray<Omit<LabelBox, 'width' | 'height'>>,
  canvasWidth: number,
  canvasHeight: number
): void {
  if (rawLabels.length === 0) return;
  const boxes: LabelBox[] = rawLabels.map((lbl) => {
    ctx.font = lbl.font ?? '600 13px system-ui, sans-serif';
    const w = Math.ceil(ctx.measureText(lbl.text).width) + 12;
    return { ...lbl, width: w, height: 22 };
  });

  for (let iter = 0; iter < 12; iter++) {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlapX = (a.width + b.width) * 0.5 - Math.abs(a.x - b.x);
        const overlapY = (a.height + b.height) * 0.5 - Math.abs(a.y - b.y);
        if (overlapX > 0 && overlapY > 0) {
          const dy = a.y <= b.y ? -overlapY * 0.55 - 2 : overlapY * 0.55 + 2;
          a.y += dy;
          b.y -= dy;
        }
      }
      const box = boxes[i]!;
      box.x = Math.max(box.width * 0.5 + 8, Math.min(canvasWidth - box.width * 0.5 - 8, box.x));
      box.y = Math.max(box.height * 0.5 + 8, Math.min(canvasHeight - box.height * 0.5 - 8, box.y));
    }
  }

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const box of boxes) {
    ctx.font = box.font ?? '600 13px system-ui, sans-serif';
    if (box.bgColor) {
      ctx.fillStyle = box.bgColor;
      ctx.beginPath();
      ctx.roundRect(box.x - box.width * 0.5, box.y - box.height * 0.5, box.width, box.height, 6);
      ctx.fill();
    }
    ctx.fillStyle = box.color;
    ctx.fillText(box.text, box.x, box.y);
  }
  ctx.restore();
}
```

---

### 模块 3：左侧极细图标轨 1:1 复刻（替换 `apps/web/src/components/LeftCatalogSidebar.tsx`）

> 对齐标尺 `01`~`03`：删除蓝色 `PF` 方块；顶放 `≡` 汉堡展开按钮；中间 5 个图标带**左缘 3px 发光青色竖条**；最底部沉底 `⚙` 全局设置按钮（快速切换黑板暗色 / 投影白底与大屏模式）。全部既有 `data-testid` 原封保留。

```tsx
import React, { useMemo, useState } from 'react';
import { Activity, BookOpen, Bot, Layers, Menu, Search, Settings, SunMoon, Maximize2, X } from 'lucide-react';
import { simulationCatalog, type SimulationCatalogEntry } from '@physforge/simulations/catalog';
import type { CurriculumTag, DifficultyLevel } from '@physforge/sim-sdk';
import type { ClassroomTheme } from '../store/useClassroomStore.js';

interface LeftCatalogSidebarProps {
  selectedPluginId: string;
  isOpen: boolean;
  theme: ClassroomTheme;
  bigScreenMode: boolean;
  onSelectPlugin: (id: string) => void;
  onOpen: () => void;
  onClose: () => void;
  onOpenCommandPalette: () => void;
  onOpenTeachingPack: () => void;
  onOpenAnalysisLab: () => void;
  onOpenAiCopilot: () => void;
  onToggleTheme: () => void;
  onToggleBigScreen: () => void;
}

const TEXTBOOKS = [
  '全部教材',
  '必修第一册',
  '必修第二册',
  '必修第三册',
  '选择性必修一',
  '选择性必修二',
  '选择性必修三'
] as const;
const TAGS: readonly ('全部素养' | CurriculumTag)[] = [
  '全部素养',
  '物理观念',
  '科学思维',
  '科学探究',
  '科学态度与责任'
];
const DIFFICULTIES: readonly ('全部难度' | DifficultyLevel)[] = [
  '全部难度',
  '基础新授',
  '高三一轮',
  '压轴专题'
];

export const LeftCatalogSidebar: React.FC<LeftCatalogSidebarProps> = ({
  selectedPluginId,
  isOpen,
  theme,
  bigScreenMode,
  onSelectPlugin,
  onOpen,
  onClose,
  onOpenCommandPalette,
  onOpenTeachingPack,
  onOpenAnalysisLab,
  onOpenAiCopilot,
  onToggleTheme,
  onToggleBigScreen
}) => {
  const [search, setSearch] = useState('');
  const [textbookFilter, setTextbookFilter] = useState<string>('全部教材');
  const [tagFilter, setTagFilter] = useState<'全部素养' | CurriculumTag>('全部素养');
  const [diffFilter, setDiffFilter] = useState<'全部难度' | DifficultyLevel>('全部难度');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const filtered = useMemo<readonly SimulationCatalogEntry[]>(() => {
    const q = search.trim().toLowerCase();
    return simulationCatalog.filter((plugin) => {
      if (textbookFilter !== '全部教材' && !plugin.meta.textbookRef.includes(textbookFilter)) return false;
      if (tagFilter !== '全部素养' && !plugin.meta.curriculumTags.includes(tagFilter)) return false;
      if (diffFilter !== '全部难度' && plugin.meta.difficulty !== diffFilter) return false;
      if (
        q &&
        !plugin.meta.title.toLowerCase().includes(q) &&
        !plugin.meta.id.toLowerCase().includes(q) &&
        !plugin.meta.textbookRef.toLowerCase().includes(q)
      ) return false;
      return true;
    });
  }, [search, textbookFilter, tagFilter, diffFilter]);

  const railButton = (
    testId: string,
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    active = false
  ) => (
    <button
      key={testId}
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`relative grid h-10 w-12 place-items-center transition cursor-pointer ${
        active ? 'text-sky-400' : 'text-slate-400 hover:text-slate-100'
      }`}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.9)]"
        />
      )}
      {icon}
    </button>
  );

  return (
    <>
      <aside
        data-testid="left-catalog-rail"
        className="relative z-30 flex h-full w-12 shrink-0 flex-col items-center justify-between border-r py-2"
        style={{
          borderColor: 'var(--pf-border)',
          backgroundColor: 'var(--pf-rail-bg)'
        }}
      >
        <div className="flex flex-col items-center">
          <button
            type="button"
            data-testid="rail-btn-catalog"
            aria-label="展开物理模型目录"
            title="物理模型目录 (43)"
            onClick={isOpen ? onClose : onOpen}
            className={`grid h-10 w-12 place-items-center transition cursor-pointer ${
              isOpen ? 'text-sky-400' : 'text-slate-300 hover:text-white'
            }`}
          >
            <Menu className="h-4 w-4" />
          </button>

          <div className="mt-4 flex flex-col items-center gap-1.5">
            {railButton('rail-btn-stages', '仿真舞台', <Layers className="h-4 w-4" />, isOpen ? onClose : onOpen, true)}
            {railButton('btn-command-palette', '全局检索 Ctrl+K', <Search className="h-4 w-4" />, onOpenCommandPalette)}
            {railButton('btn-teaching-pack', '教研导学案', <BookOpen className="h-4 w-4" />, onOpenTeachingPack)}
            {railButton('btn-analysis-lab', '数据分析', <Activity className="h-4 w-4" />, onOpenAnalysisLab)}
            {railButton('btn-ai-copilot', 'AI 建模', <Bot className="h-4 w-4" />, onOpenAiCopilot)}
          </div>
        </div>

        <div className="relative">
          {railButton('btn-rail-settings', '显示与主题设置', <Settings className="h-4 w-4" />, () => setSettingsOpen((v) => !v), settingsOpen)}
          {settingsOpen && (
            <div className="pf-floating-glass absolute bottom-1 left-14 z-50 w-48 space-y-1.5 rounded-xl border border-white/10 p-2 shadow-2xl">
              <button
                type="button"
                data-testid="btn-rail-theme"
                onClick={() => { onToggleTheme(); setSettingsOpen(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-slate-200 hover:bg-white/10 cursor-pointer"
              >
                <SunMoon className="h-3.5 w-3.5 text-sky-400" />
                <span>{theme === 'chalkboard' ? '切换投影白底' : '切换黑板深蓝'}</span>
              </button>
              <button
                type="button"
                data-testid="btn-rail-big-screen"
                onClick={() => { onToggleBigScreen(); setSettingsOpen(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-slate-200 hover:bg-white/10 cursor-pointer"
              >
                <Maximize2 className="h-3.5 w-3.5 text-sky-400" />
                <span>{bigScreenMode ? '关闭大屏字号' : '开启大屏字号'}</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {isOpen && (
        <>
          <button
            type="button"
            data-testid="catalog-backdrop"
            aria-label="关闭模型目录"
            onClick={onClose}
            className="fixed inset-0 z-30 bg-slate-950/35"
          />
          <aside
            data-testid="left-catalog-sidebar"
            className="pf-floating-glass fixed bottom-0 left-12 top-12 z-40 flex w-80 max-w-[calc(100vw-48px)] flex-col overflow-hidden border-r border-white/10 text-slate-100 shadow-2xl"
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-4">
              <div>
                <div className="text-sm font-semibold">物理仿真目录</div>
                <div className="text-[10px] text-slate-400">2025 修订课标 · {filtered.length} 个模型</div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="收起模型目录"
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2 border-b border-white/10 p-3">
              <input
                type="search"
                aria-label="搜索物理模型"
                placeholder="搜索模型名称或章节..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-full rounded-xl border border-white/10 bg-slate-950/55 px-3 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/70"
              />
              <select aria-label="按教材分册筛选" value={textbookFilter} onChange={(e) => setTextbookFilter(e.target.value)} className="h-8 w-full rounded-lg border border-white/10 bg-slate-950/55 px-2 text-xs text-slate-200">
                {TEXTBOOKS.map((textbook) => <option key={textbook}>{textbook}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <select aria-label="按核心素养筛选" value={tagFilter} onChange={(e) => setTagFilter(e.target.value as '全部素养' | CurriculumTag)} className="h-8 min-w-0 rounded-lg border border-white/10 bg-slate-950/55 px-2 text-[11px] text-slate-200">
                  {TAGS.map((tag) => <option key={tag}>{tag}</option>)}
                </select>
                <select aria-label="按教学难度筛选" value={diffFilter} onChange={(e) => setDiffFilter(e.target.value as '全部难度' | DifficultyLevel)} className="h-8 min-w-0 rounded-lg border border-white/10 bg-slate-950/55 px-2 text-[11px] text-slate-200">
                  {DIFFICULTIES.map((difficulty) => <option key={difficulty}>{difficulty}</option>)}
                </select>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
              {filtered.map((plugin) => {
                const active = plugin.meta.id === selectedPluginId;
                return (
                  <button
                    key={plugin.meta.id}
                    type="button"
                    data-testid={`model-card-${plugin.meta.id}`}
                    onClick={() => onSelectPlugin(plugin.meta.id)}
                    className={`w-full rounded-xl border p-3 text-left transition cursor-pointer ${
                      active
                        ? 'border-sky-400/70 bg-sky-400/10'
                        : 'border-white/10 bg-slate-950/30 hover:border-white/25 hover:bg-white/5'
                    }`}
                  >
                    <div className="mb-1 text-xs font-semibold leading-snug">{plugin.meta.title}</div>
                    <div className="mb-2 text-[10px] text-slate-400">{plugin.meta.textbookRef}</div>
                    <div className="flex flex-wrap gap-1">
                      <span className="rounded bg-sky-400/15 px-1.5 py-0.5 text-[10px] text-sky-200">{plugin.meta.difficulty}</span>
                      {plugin.meta.curriculumTags.map((tag) => (
                        <span key={tag} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">{tag}</span>
                      ))}
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && <div className="p-4 text-center text-xs text-slate-500">当前筛选条件下暂无匹配模型</div>}
            </div>
          </aside>
        </>
      )}
    </>
  );
};
```

---

### 模块 4：右上紧凑悬浮控制卡 1:1 复刻（替换 `apps/web/src/components/RightControlPanel.tsx` 与 `KatexFormulaCard.tsx`）

> **关键设计**：
> 1. **去掉 `bottom-3` 通天拉伸与顶部 `参数控制台 ×` 占高头**！卡片紧凑停靠右上角（`top-3 right-3 w-[272px] max-h-[calc(100%-24px)]`），高度自适应内容，与标尺 1/2/3 完全一致；
> 2. **智能上下文首屏滑块提取 (`pickCoreFields`)**：不再机械 `.slice(0, 4)` 把长下拉框放首位！自动优先把当前模型最重要的 **3 个核心数值滑块**（如 E04 的 `batteryEmf / magneticB / resistorR`、B3 的 `incidentAngleDeg / n1 / n2`、B2 的 `emf / sliderR / internalR`）直出在预设下面第一屏，所有其余调节与拓扑切换折叠进 `更多参数`；
> 3. **深凹槽居中公式卡**：日常紧凑居中显示核心公式，右上角留微切换按钮可随时展开/隐藏代入数值与能量详情；
> 4. **底部超纤细状态条**：标准模型渲染标尺 1/2 的纤细双条能量分布；B2 电路渲染标尺 3 专属 `0V ———— 12V` 连续红蓝电势色标条！

#### 4A. `apps/web/src/components/KatexFormulaCard.tsx`

```tsx
import React, { useMemo } from 'react';
import katex from 'katex';
import type { FormulaDisplayItem } from '@physforge/sim-sdk';

interface KatexFormulaCardProps {
  items: readonly FormulaDisplayItem[];
  compact?: boolean;
  showSubstituted?: boolean;
}

function renderLatex(latex: string): string {
  return katex.renderToString(latex, {
    throwOnError: false,
    displayMode: false
  });
}

export const KatexFormulaCard: React.FC<KatexFormulaCardProps> = ({
  items,
  compact = false,
  showSubstituted = true
}) => {
  const rendered = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        baseHtml: renderLatex(item.latex),
        subHtml: item.substitutedLatex ? renderLatex(item.substitutedLatex) : null
      })),
    [items]
  );

  if (rendered.length === 0) return null;

  return (
    <div className={compact ? 'space-y-2 text-center' : 'space-y-2.5'}>
      {rendered.map((item) => (
        <div key={item.id} className="space-y-1">
          {!compact && (
            <div className="text-[11px]" style={{ color: 'var(--pf-text-muted)' }}>
              {item.label}
            </div>
          )}
          <div
            className={`overflow-x-auto py-0.5 ${compact ? 'pf-right-formula text-slate-100' : 'text-sm'}`}
            dangerouslySetInnerHTML={{ __html: item.baseHtml }}
          />
          {showSubstituted && item.subHtml && (
            <div
              className="overflow-x-auto py-0.5 text-[11px] text-emerald-400/95"
              dangerouslySetInnerHTML={{ __html: item.subHtml }}
            />
          )}
        </div>
      ))}
    </div>
  );
};
```

#### 4B. `apps/web/src/components/RightControlPanel.tsx`

```tsx
import React, { useMemo, useState } from 'react';
import type { AnySimulationPlugin } from '@physforge/simulations/registry';
import type { ParamRecord } from '@physforge/sim-sdk';
import type { TelemetrySummary } from '../store/useClassroomStore.js';
import { KatexFormulaCard } from './KatexFormulaCard.js';
import { EnergyBarChart } from './EnergyBarChart.js';

interface RightControlPanelProps {
  plugin: AnySimulationPlugin;
  activePresetId: string | null;
  params: ParamRecord;
  activeLayers: readonly string[];
  telemetry: TelemetrySummary;
  onApplyPreset: (presetId: string) => void;
  onUpdateParam: (key: string, value: number | boolean | string) => void;
  onToggleLayer: (layerId: string) => void;
  onClose: () => void;
}

const CONTEXT_CORE_KEYS: Readonly<Record<string, readonly string[]>> = {
  'em-induction-double-rod': ['batteryEmf', 'magneticB', 'resistorR', 'externalForce'],
  'builder-optics-ray': ['incidentAngleDeg', 'n1', 'n2', 'objectDistanceM'],
  'optics-ray-studio': ['incidentAngleDeg', 'n1', 'n2', 'objectDistanceM'],
  'builder-circuit-mna': ['emf', 'sliderR', 'internalR'],
  'circuit-dc-capacitor-mna': ['emf', 'sliderR', 'internalR'],
  'em-3d-magnetic-fields': ['currentI', 'radiusR', 'solenoidTurns']
};

export const RightControlPanel: React.FC<RightControlPanelProps> = ({
  plugin,
  activePresetId,
  params,
  activeLayers,
  telemetry,
  onApplyPreset,
  onUpdateParam,
  onToggleLayer
}) => {
  const [showLiveSubstituted, setShowLiveSubstituted] = useState(false);

  const { coreFields, extraFields } = useMemo(() => {
    const preferred = CONTEXT_CORE_KEYS[plugin.meta.id];
    const numericFields = plugin.paramSchema.filter((f) => f.kind === 'number');
    if (preferred && preferred.length > 0) {
      const core: Array<(typeof plugin.paramSchema)[number]> = [];
      for (const k of preferred) {
        const hit = plugin.paramSchema.find((f) => f.key === k);
        if (hit && core.length < 3) core.push(hit);
      }
      if (core.length > 0) {
        const coreKeys = new Set(core.map((f) => f.key));
        return {
          coreFields: core,
          extraFields: plugin.paramSchema.filter((f) => !coreKeys.has(f.key))
        };
      }
    }
    const chosen = numericFields.length >= 3 ? numericFields.slice(0, 3) : plugin.paramSchema.slice(0, 3);
    const chosenKeys = new Set(chosen.map((f) => f.key));
    return {
      coreFields: chosen,
      extraFields: plugin.paramSchema.filter((f) => !chosenKeys.has(f.key))
    };
  }, [plugin]);

  const renderField = (field: (typeof plugin.paramSchema)[number]) => {
    const val = params[field.key] ?? field.defaultValue;
    if (field.kind === 'number') {
      const numVal = typeof val === 'number' ? val : field.defaultValue;
      const min = field.min ?? 0;
      const max = field.max ?? 100;
      const progress = max > min ? Math.max(0, Math.min(100, ((numVal - min) / (max - min)) * 100)) : 0;
      const decimals = String(field.step ?? '').split('.')[1]?.length ?? 1;
      const shortLabel = field.label.replace(/（[^）]*）/g, '');
      return (
        <div key={field.key} className="space-y-0.5">
          <div className="flex items-baseline justify-between gap-2 text-[11px] font-medium">
            <label htmlFor={`param-${field.key}`} className="min-w-0 truncate text-slate-300">
              {shortLabel}
            </label>
            <span data-testid={`param-value-${field.key}`} className="shrink-0 font-mono text-slate-100 tabular-nums">
              {numVal.toFixed(Math.min(Math.max(decimals, 1), 2))} {field.unit ?? ''}
            </span>
          </div>
          <input
            id={`param-${field.key}`}
            type="range"
            data-testid={`param-slider-${field.key}`}
            min={field.min}
            max={field.max}
            step={field.step}
            value={numVal}
            onChange={(e) => onUpdateParam(field.key, Number(e.target.value))}
            className="pf-slider pf-touch-target"
            style={{ '--pf-progress': `${progress}%` } as React.CSSProperties}
          />
        </div>
      );
    }

    if (field.kind === 'boolean') {
      const boolVal = typeof val === 'boolean' ? val : field.defaultValue;
      return (
        <label
          key={field.key}
          className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-950/35 px-2.5 py-1.5 text-[11px] text-slate-200 cursor-pointer"
        >
          <span>{field.label}</span>
          <input
            type="checkbox"
            checked={boolVal}
            onChange={(e) => onUpdateParam(field.key, e.target.checked)}
            className="h-4 w-4 accent-sky-400"
          />
        </label>
      );
    }

    const strVal = typeof val === 'string' ? val : field.defaultValue;
    return (
      <div key={field.key} className="space-y-1">
        <label htmlFor={`param-${field.key}`} className="block text-[10px] text-slate-400">
          {field.label}
        </label>
        <select
          id={`param-${field.key}`}
          value={strVal}
          onChange={(e) => onUpdateParam(field.key, e.target.value)}
          className="h-8 w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 text-xs text-slate-100"
        >
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    );
  };

  const isCircuit = plugin.meta.id === 'builder-circuit-mna' || plugin.meta.id === 'circuit-dc-capacitor-mna';
  const emf = typeof params.emf === 'number' ? params.emf : 12;
  const kineticPct = Math.min(100, Math.round(((telemetry.observables.kineticEnergy ?? 0) / 10) * 100));
  const heatPct = Math.min(100, Math.round(((telemetry.observables.jouleHeat ?? telemetry.observables.capacitorEnergy ?? 0) / 10) * 100));

  return (
    <aside
      data-testid="right-control-panel"
      className="pf-floating-glass absolute right-3 top-3 z-20 flex max-h-[calc(100%-24px)] w-[272px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl border border-white/10 text-slate-100"
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3.5">
        {/* 1. 单行紧凑预设胶囊 */}
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/45 px-2.5 py-1.5">
          <span className="shrink-0 text-[11px] font-medium text-slate-400">预设</span>
          <select
            id="preset-select"
            data-testid="preset-select"
            aria-label="课堂预设"
            value={activePresetId ?? ''}
            onChange={(e) => onApplyPreset(e.target.value)}
            className="min-w-0 flex-1 truncate bg-transparent text-xs font-medium text-slate-100 outline-none cursor-pointer"
          >
            {!activePresetId && <option value="" className="bg-slate-900">自定义参数</option>}
            {plugin.presets.map((preset, idx) => (
              <option key={preset.id} value={preset.id} data-testid={`preset-btn-${preset.id}`} className="bg-slate-900 text-slate-100">
                {/^\d+\s*[.、]/.test(preset.name) ? preset.name : `${idx + 1}. ${preset.name}`}
              </option>
            ))}
          </select>
        </div>

        {/* 2. 首屏直出核心滑块 */}
        <section className="space-y-1.5">{coreFields.map(renderField)}</section>

        {/* 3. 深凹槽暗底公式卡 */}
        <section
          data-testid="formula-card"
          className="relative rounded-xl border border-white/10 bg-slate-950/75 px-3 py-3 shadow-inner"
        >
          <button
            type="button"
            onClick={() => setShowLiveSubstituted((v) => !v)}
            title={showLiveSubstituted ? '切换纯符号公式' : '显示实时代入数值'}
            className="absolute right-2 top-1.5 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10 hover:text-sky-300 cursor-pointer"
          >
            {showLiveSubstituted ? '符号' : '123'}
          </button>
          <KatexFormulaCard items={telemetry.formulaItems} compact showSubstituted={showLiveSubstituted} />
        </section>

        {/* 4. 标尺专属底部极简细条 / B2 电势色标 */}
        {isCircuit ? (
          <div className="space-y-1.5 pt-0.5">
            <div className="flex justify-between font-mono text-[10px] text-slate-400">
              <span>0V</span>
              <span>电势分布</span>
              <span>{emf.toFixed(0)}V</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-gradient-to-r from-sky-400 via-amber-300 to-rose-400 shadow-[0_0_8px_rgba(56,189,248,0.4)]" />
          </div>
        ) : (
          <div className="space-y-2 pt-0.5 text-[11px] text-slate-300">
            <div>
              <div className="mb-1 flex justify-between text-[10px] text-slate-400">
                <span>动能 / 场能占比</span>
                <span className="font-mono">{kineticPct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-sky-400/80 transition-all" style={{ width: `${Math.max(8, kineticPct)}%` }} />
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[10px] text-slate-400">
                <span>耗散 / 储能转化</span>
                <span className="font-mono">{heatPct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-amber-400/75 transition-all" style={{ width: `${Math.max(6, heatPct)}%` }} />
              </div>
            </div>
          </div>
        )}

        {/* 5. 全部进阶参数与守恒/图层默认折叠 */}
        {(extraFields.length > 0 || telemetry.invariants.length > 0) && (
          <details className="rounded-xl border border-white/10 bg-slate-950/35 px-2.5">
            <summary className="cursor-pointer list-none py-2 text-[11px] font-medium text-slate-400 hover:text-slate-200">
              更多参数与守恒校验 <span className="float-right">⌄</span>
            </summary>
            <div className="space-y-2.5 pb-3">
              {extraFields.map(renderField)}
              <EnergyBarChart observables={telemetry.observables} invariants={telemetry.invariants} />
              <div className="space-y-1 pt-1">
                {plugin.layers.map((layer) => (
                  <label key={layer.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[11px] text-slate-300 hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={activeLayers.includes(layer.id)}
                      onChange={() => onToggleLayer(layer.id)}
                      className="h-3.5 w-3.5 accent-sky-400"
                    />
                    <span>{layer.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </details>
        )}
      </div>
    </aside>
  );
};
```

---

### 模块 5：`SimulationStage.tsx` 关键升级片段（示波器渐变填充 + 手柄悬停高亮 + B2 工具栏 + 多点缩放）

> Luna 在 `apps/web/src/components/SimulationStage.tsx` 中落实以下 4 处精准替换/增强（**保留原有物理循环与全部 `data-testid`**）：

#### 5A. 增加悬停手柄命中检测状态与 `cursor` 自动切换（加在 `dragModeRef` 附近及 Canvas 事件上）

```tsx
  const hoveredHandleIdRef = useRef<string | null>(null);
  const [cursorStyle, setCursorStyle] = useState<'grab' | 'grabbing' | 'pointer'>('grab');
  const activeTouchMapRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const prevPinchDistRef = useRef<number | null>(null);
```

在绘制 `V2 画布直操手柄渲染`（第 374–401 行）替换为高亮环+悬停数值胶囊：

```tsx
      // V2 画布直操手柄渲染（含悬停发光外环与参数标签）
      if (!masked && v2.getControlHandles) {
        const handles = v2.getControlHandles(drawState, pm);
        ctx.save();
        for (const h of handles) {
          const sPos = worldToScreen(h.position.x, h.position.y, vp);
          const isHovered = hoveredHandleIdRef.current === h.id;
          if (h.origin) {
            const sOrig = worldToScreen(h.origin.x, h.origin.y, vp);
            ctx.setLineDash([4, 3]);
            ctx.strokeStyle = h.color ?? '#38bdf8';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(sOrig.x, sOrig.y);
            ctx.lineTo(sPos.x, sPos.y);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          if (isHovered) {
            ctx.beginPath();
            ctx.arc(sPos.x, sPos.y, 13, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(251, 191, 36, 0.22)';
            ctx.fill();
          }
          ctx.shadowColor = h.color ?? '#fbbf24';
          ctx.shadowBlur = isHovered ? 16 : 10;
          ctx.fillStyle = '#0b0f17';
          ctx.strokeStyle = h.color ?? '#fbbf24';
          ctx.lineWidth = isHovered ? 3.2 : 2.5;
          ctx.beginPath();
          ctx.arc(sPos.x, sPos.y, isHovered ? 8.5 : 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.shadowBlur = 0;

          if (isHovered || h.id !== 'incident-ray-pivot') {
            ctx.font = '600 11px system-ui, sans-serif';
            ctx.fillStyle = h.color ?? '#e2e8f0';
            ctx.fillText(h.label, sPos.x + 12, sPos.y + 4);
          }
        }
        ctx.restore();
      }
```

#### 5B. 替换 `onPointerMove` 实现手柄悬停高亮 + 双指捏合缩放（替换第 807–866 行）

```tsx
            style={{ cursor: cursorStyle }}
            onDoubleClick={onResetView}
            onPointerDown={(e) => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              activeTouchMapRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
              if (activeTouchMapRef.current.size === 2) {
                const pts = [...activeTouchMapRef.current.values()];
                prevPinchDistRef.current = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
                dragModeRef.current = null;
                return;
              }
              const rect = canvas.getBoundingClientRect();
              const sx = e.clientX - rect.left;
              const sy = e.clientY - rect.top;
              const v2 = plugin as SimulationPluginV2<ParamRecord, unknown>;
              const state = simStateRef.current;
              const { effectiveVp } = computeEffectiveViewport(viewportRef.current, state);
              if (state !== null && v2.getControlHandles && e.button === 0) {
                const handles = v2.getControlHandles(state, params);
                for (const h of handles) {
                  const hs = worldToScreen(h.position.x, h.position.y, effectiveVp);
                  if (Math.hypot(hs.x - sx, hs.y - sy) <= 18) {
                    canvas.setPointerCapture?.(e.pointerId);
                    dragModeRef.current = { kind: 'handle', handle: h };
                    setCursorStyle('grabbing');
                    return;
                  }
                }
              }
              canvas.setPointerCapture?.(e.pointerId);
              dragModeRef.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
              setCursorStyle('grabbing');
            }}
            onPointerMove={(e) => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              if (activeTouchMapRef.current.has(e.pointerId)) {
                activeTouchMapRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
              }
              if (activeTouchMapRef.current.size === 2) {
                const pts = [...activeTouchMapRef.current.values()];
                const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
                const prevDist = prevPinchDistRef.current;
                if (prevDist && prevDist > 10) {
                  const rect = canvas.getBoundingClientRect();
                  const midX = (pts[0]!.x + pts[1]!.x) * 0.5 - rect.left;
                  const midY = (pts[0]!.y + pts[1]!.y) * 0.5 - rect.top;
                  const next = zoomViewportAtCursor(cameraRef.current, midX, midY, viewportRef.current.width, viewportRef.current.height, dist / prevDist);
                  cameraRef.current = next;
                  viewportRef.current = { ...viewportRef.current, ...next };
                  setZoomPercent(Math.round(next.scale * 100));
                  setOverlayViewport(viewportRef.current);
                  renderFrameToCanvas();
                }
                prevPinchDistRef.current = dist;
                return;
              }
              const mode = dragModeRef.current;
              if (!mode) {
                // 悬停命中检测，改变指针样式并触发局部高光
                const rect = canvas.getBoundingClientRect();
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;
                const v2 = plugin as SimulationPluginV2<ParamRecord, unknown>;
                const state = simStateRef.current;
                let hitId: string | null = null;
                if (state !== null && v2.getControlHandles) {
                  const { effectiveVp } = computeEffectiveViewport(viewportRef.current, state);
                  for (const h of v2.getControlHandles(state, params)) {
                    const hs = worldToScreen(h.position.x, h.position.y, effectiveVp);
                    if (Math.hypot(hs.x - sx, hs.y - sy) <= 18) {
                      hitId = h.id;
                      break;
                    }
                  }
                }
                if (hoveredHandleIdRef.current !== hitId) {
                  hoveredHandleIdRef.current = hitId;
                  setCursorStyle(hitId ? 'pointer' : 'grab');
                  renderFrameToCanvas();
                }
                return;
              }
              if (mode.kind === 'handle') {
                const rect = canvas.getBoundingClientRect();
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;
                const { effectiveVp } = computeEffectiveViewport(viewportRef.current, simStateRef.current);
                const world = screenToWorld(sx, sy, effectiveVp);
                onUpdateParamsBatch(mode.handle.onDrag(world), `拖拽手柄 ${mode.handle.label}`);
              } else {
                const dx = e.clientX - mode.lastX;
                const dy = e.clientY - mode.lastY;
                mode.lastX = e.clientX;
                mode.lastY = e.clientY;
                const next = panViewport(cameraRef.current, dx, dy);
                cameraRef.current = next;
                viewportRef.current = { ...viewportRef.current, offsetX: next.offsetX, offsetY: next.offsetY };
                setOverlayViewport(viewportRef.current);
                renderFrameToCanvas();
              }
            }}
            onPointerUp={(e) => {
              activeTouchMapRef.current.delete(e.pointerId);
              if (activeTouchMapRef.current.size < 2) prevPinchDistRef.current = null;
              dragModeRef.current = null;
              setCursorStyle(hoveredHandleIdRef.current ? 'pointer' : 'grab');
            }}
            onPointerCancel={(e) => {
              activeTouchMapRef.current.delete(e.pointerId);
              prevPinchDistRef.current = null;
              dragModeRef.current = null;
              setCursorStyle('grab');
            }}
```

#### 5C. 标尺 1 级渐变填充示波器（替换第 692–771 行与第 955–1007 行）

```tsx
    const opts: uPlot.Options = {
      width,
      height,
      cursor: { drag: { x: false, y: false }, points: { size: 6 } },
      legend: { show: false },
      scales: { x: { time: false }, y: { auto: true } },
      axes: [
        {
          stroke: 'rgba(148, 163, 184, 0.5)',
          font: '10px ui-monospace, monospace',
          ticks: { show: false },
          grid: { stroke: gridColor, width: 1 },
          values: (_u, splits) => splits.map((v) => `${v.toFixed(1)}s`)
        },
        {
          stroke: 'rgba(148, 163, 184, 0.5)',
          font: '10px ui-monospace, monospace',
          size: 36,
          ticks: { show: false },
          grid: { stroke: gridColor, width: 1 }
        }
      ],
      series: [
        { label: 't' },
        {
          label: specA?.label ?? 'A',
          stroke: specA?.color ?? '#38bdf8',
          width: 2.2,
          fill: (u) => {
            const grad = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
            grad.addColorStop(0, 'rgba(56, 189, 248, 0.34)');
            grad.addColorStop(1, 'rgba(56, 189, 248, 0.01)');
            return grad;
          }
        },
        {
          label: specB?.label ?? 'B',
          stroke: specB?.color ?? '#fb7185',
          width: 2.0,
          fill: (u) => {
            const grad = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
            grad.addColorStop(0, 'rgba(251, 113, 133, 0.24)');
            grad.addColorStop(1, 'rgba(251, 113, 133, 0.01)');
            return grad;
          }
        }
      ],
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            if (idx === null || idx === undefined || latestRef.current.isPlaying) return;
            const tVal = u.data[0]?.[idx];
            if (typeof tVal === 'number' && Number.isFinite(tVal)) {
              latestRef.current.onScrubTime(tVal);
            }
          }
        ]
      }
    };
```

对应 JSX 悬浮卡片（标尺 1 仅 `400px` 宽 + 双彩色药丸切换按钮）：

```tsx
      {!presentationMode && !oscilloscopeCollapsed && (
        <div
          data-testid="floating-scope-dock"
          className="pf-floating-glass pf-compact-scope absolute bottom-3 left-1/2 z-10 w-[min(410px,calc(100%-24px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 px-3 pb-2 pt-2"
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold tracking-wide text-slate-200">示波器</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                title="点击切换通道 A"
                onClick={() => {
                  if (channels.length < 2) return;
                  const idx = channels.findIndex((c) => c.key === channelA);
                  setChannelA(channels[(idx + 1) % channels.length]!.key);
                }}
                className="rounded-md bg-sky-400/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-sky-300 ring-1 ring-sky-400/45 hover:bg-sky-400/30 cursor-pointer"
              >
                {specA?.label.split(' ')[0] ?? 'v-t'}
              </button>
              <button
                type="button"
                title="点击切换通道 B"
                onClick={() => {
                  if (channels.length < 2) return;
                  const idx = channels.findIndex((c) => c.key === channelB);
                  setChannelB(channels[(idx + 1) % channels.length]!.key);
                }}
                className="rounded-md bg-rose-400/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-rose-300 ring-1 ring-rose-400/45 hover:bg-rose-400/30 cursor-pointer"
              >
                {specB?.label.split(' ')[0] ?? 'I-t'}
              </button>
              <button
                type="button"
                onClick={onToggleOscilloscope}
                aria-label="收起示波器"
                className="grid h-5 w-5 place-items-center rounded text-slate-400 hover:bg-white/10 hover:text-white cursor-pointer"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="relative h-[88px] overflow-hidden">
            <div ref={uplotWrapRef} data-testid="uplot-container" className="w-full" />
            {poeMasked && (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-slate-950/85 text-xs font-semibold text-amber-300">
                示波器曲线已在 POE 预测阶段遮蔽
              </div>
            )}
          </div>
        </div>
      )}
```

#### 5D. 标尺 2 & 标尺 3 左下角自适应仪器底座（替换第 880–916 行）

当 `plugin.meta.id === 'builder-circuit-mna' || plugin.meta.id === 'circuit-dc-capacitor-mna'` 时渲染**标尺 3 专属双层仪器工具栏**（上层 `0V / 12V` 电势色条，下层 7 格器件与工具按钮支持一键切换电路拓扑或量具）；其余模型（包含 B3 光学）渲染标尺 2 纯净 3 格毛玻璃大图标底座（`直尺 / 量角器 / 居中复位`）：

```tsx
        {!presentationMode && (
          <div className="absolute bottom-3 left-3 z-10 flex flex-col items-start gap-1.5">
            {(plugin.meta.id === 'builder-circuit-mna' || plugin.meta.id === 'circuit-dc-capacitor-mna') && (
              <div className="pf-floating-glass flex items-center gap-2.5 rounded-xl border border-white/10 px-3 py-1.5 text-[11px] font-mono text-slate-300">
                <span>0V / {Number(params.emf ?? 12).toFixed(0)}V</span>
                <span className="h-1.5 w-20 rounded-full bg-gradient-to-r from-sky-400 via-amber-300 to-rose-400" />
              </div>
            )}
            <div className="pf-floating-glass flex items-center gap-1 rounded-2xl border border-white/10 p-1.5">
              {(plugin.meta.id === 'builder-circuit-mna' || plugin.meta.id === 'circuit-dc-capacitor-mna') && (
                <>
                  <button type="button" title="电阻/分压限流电路" onClick={() => onUpdateParamsBatch({ topology: 'closed-power' }, '切换电阻负载')} className={`grid h-9 w-9 place-items-center rounded-xl text-xs transition cursor-pointer ${params.topology === 'closed-power' ? 'bg-sky-400/20 text-sky-300 ring-1 ring-sky-400/50' : 'text-slate-300 hover:bg-white/10'}`}>R</button>
                  <button type="button" title="含容 RC 瞬态电路" onClick={() => onUpdateParamsBatch({ topology: 'rc-transient' }, '切换电容瞬态')} className={`grid h-9 w-9 place-items-center rounded-xl text-xs transition cursor-pointer ${params.topology === 'rc-transient' ? 'bg-sky-400/20 text-sky-300 ring-1 ring-sky-400/50' : 'text-slate-300 hover:bg-white/10'}`}>C</button>
                  <button type="button" title="小灯泡非线性测绘" onClick={() => onUpdateParamsBatch({ topology: 'divider-lamp' }, '切换分压灯泡')} className={`grid h-9 w-9 place-items-center rounded-xl text-xs transition cursor-pointer ${params.topology === 'divider-lamp' ? 'bg-sky-400/20 text-sky-300 ring-1 ring-sky-400/50' : 'text-slate-300 hover:bg-white/10'}`}>💡</button>
                  <button type="button" title="电桥含容平衡" onClick={() => onUpdateParamsBatch({ topology: 'rc-bridge-charge' }, '切换含容电桥')} className={`grid h-9 w-9 place-items-center rounded-xl text-xs transition cursor-pointer ${params.topology === 'rc-bridge-charge' ? 'bg-sky-400/20 text-sky-300 ring-1 ring-sky-400/50' : 'text-slate-300 hover:bg-white/10'}`}>⏚</button>
                </>
              )}
              <button
                type="button"
                data-testid="btn-tool-ruler"
                aria-label="直尺"
                title="虚拟直尺"
                onClick={() => onToggleMeasureTool('ruler')}
                className={`grid h-9 w-9 place-items-center rounded-xl transition cursor-pointer ${measureTool === 'ruler' ? 'bg-sky-400/20 text-sky-200 ring-1 ring-sky-400/60' : 'text-slate-300 hover:bg-white/10'}`}
              >
                <Ruler className="h-4 w-4" />
              </button>
              <button
                type="button"
                data-testid="btn-tool-protractor"
                aria-label="量角器"
                title="0.1° 量角器"
                onClick={() => onToggleMeasureTool('protractor')}
                className={`grid h-9 w-9 place-items-center rounded-xl transition cursor-pointer ${measureTool === 'protractor' ? 'bg-amber-400/20 text-amber-200 ring-1 ring-amber-400/60' : 'text-slate-300 hover:bg-white/10'}`}
              >
                <MoveDiagonal2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                data-testid="btn-reset-view"
                aria-label="居中复位"
                title={`居中复位视口 (${zoomPercent}%)`}
                onClick={onResetView}
                className="grid h-9 w-9 place-items-center rounded-xl text-slate-300 transition hover:bg-white/10 hover:text-sky-200 cursor-pointer"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
```

---

### 模块 6：`useClassroomStore.ts` & `App.tsx` 首屏 1:1 落地与全屏演说态

#### 6A. `apps/web/src/store/useClassroomStore.ts`（第 15、123–128 行）
1. 将默认首屏入口改为标尺 1 模型 **`em-induction-double-rod`**（以 Preset 4 单杆电源驱动为首屏初始演示态），在 `useClassroomStore.ts` 替换：

```ts
import { emInductionDoubleRodPlugin } from '@physforge/simulations/em-induction-double-rod';
// ...
const initialPlugin = emInductionDoubleRodPlugin as unknown as AnySimulationPlugin;
const initialPreset = initialPlugin.presets.find((p) => p.id === 'single-rod-battery-drive') ?? initialPlugin.presets[0] ?? null;
```
> 注意：把 `simulations/catalog.ts` 里 `em-induction-double-rod` 改成直接静态复用已加载实例（或者保留动态导入但主包确认 `< 350 KB` gzip），并把 `em-bounded-magnetic-field` 重新还原回纯动态懒加载消除 Rollup 警告。

#### 6B. `apps/web/src/App.tsx` 顶栏左区 & 右侧三胶囊 & 全屏演说态
- 第 181–226 行：

```tsx
      <header
        data-testid="topbar"
        className={`relative z-40 flex h-12 shrink-0 items-center justify-between border-b px-4 ${store.fullscreenPresentation ? 'hidden' : ''}`}
        style={{
          borderColor: 'var(--pf-border)',
          backgroundColor: 'var(--pf-topbar-bg)'
        }}
      >
        <div className="min-w-0 max-w-[34%]">
          <div className="truncate text-[14px] font-medium tracking-tight text-slate-100">
            {plugin.meta.title.replace(/\s*\([A-Z]\d+\)$/, '')}
          </div>
          <div className="font-mono text-[11px] tabular-nums text-slate-400">
            t = {store.telemetry.t.toFixed(2)} s
          </div>
        </div>

        <div className="pf-floating-glass absolute left-1/2 flex h-9 -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 p-1">
          <button
            type="button"
            data-testid="btn-play-pause"
            onClick={store.togglePlaying}
            aria-label={store.isPlaying ? '暂停' : '运行'}
            className="grid h-7 w-7 place-items-center rounded-full bg-sky-400 text-slate-950 shadow-[0_0_20px_rgba(56,189,248,0.7)] transition hover:bg-sky-300 cursor-pointer"
          >
            {store.isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
          </button>
          <button type="button" data-testid="btn-step" onClick={store.triggerStepOnce} className="h-7 rounded-full px-2.5 text-[11px] text-slate-300 hover:bg-white/10 cursor-pointer">前移</button>
          <button type="button" data-testid="btn-reset" onClick={store.triggerReset} className="h-7 rounded-full px-2.5 text-[11px] text-slate-300 hover:bg-white/10 cursor-pointer">重置</button>
          <select aria-label="播放倍速" value={store.playbackSpeed} onChange={(e) => store.setPlaybackSpeed(Number(e.target.value))} className="h-7 rounded-full bg-transparent px-1.5 font-mono text-[11px] text-slate-300 outline-none cursor-pointer">
            {SPEED_OPTIONS.map((speed) => <option key={speed} value={speed} className="bg-slate-900">{speed.toFixed(1)}x</option>)}
          </select>
        </div>

        <div data-testid="topbar-actions" className="relative flex shrink-0 items-center gap-2">
          <button type="button" data-testid="btn-tools-menu" aria-expanded={toolsOpen} onClick={() => setToolsOpen((open) => !open)} className="pf-top-pill">
            <span>工具</span>
          </button>
          <button type="button" data-testid="btn-export-studio" onClick={() => setExportStudioOpen(true)} className="pf-top-pill">
            <span>导出</span> <ImageIcon className="h-3.5 w-3.5 opacity-80" />
          </button>
          <button type="button" data-testid="btn-fullscreen-speech" onClick={store.toggleFullscreenPresentation} className="pf-top-pill pf-top-pill-primary">
            <Maximize2 className="h-3.5 w-3.5" /> <span>全屏演说</span>
          </button>
        </div>
```

- 传给 `<LeftCatalogSidebar>` 补充 `theme={store.theme}`、`bigScreenMode={store.bigScreenMode}`、`onToggleTheme={store.toggleTheme}`、`onToggleBigScreen={store.toggleBigScreenMode}`。
- 第 606–629 行 `fullscreenPresentation` 右上公式卡默认关掉绿色数值冗长行（`showSubstituted={false}`，展示简洁大字 KaTeX），完全对齐 `04_fullscreen_3d.png`！

---

### 模块 7：标尺 1 画布 1:1 复刻（更新 `simulations/em-induction-double-rod/plugin.ts` 的 `renderCanvas`）

> 对齐 [01_workbench_em.png](file:///d:/project%20code/44-PhysForge/docs/ui-benchmark/01_workbench_em.png) 且完整接入 `worldToScreen` 以彻底治愈缩放漂移 Bug（从 `@physforge/sim-sdk` 导入模块 2 新增的 `drawDotCrossField`、`drawGlowVectorArrow`、`drawGlowingConductorRod`、`drawMetallicRail`、`resolveAndDrawLabels`）：

`em-induction-double-rod/plugin.ts` 的 `renderCanvas` 核心实现：

```ts
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const pxPerM = Math.min(viewport.width, viewport.height) * 0.24 * viewport.scale;
    const camShift = Math.max(0, state.x1 - 2.6);
    const ox = viewport.width * 0.45 + viewport.offsetX;
    const oy = viewport.height * 0.5 + viewport.offsetY;
    const toX = (wx: number) => ox + (wx - 1.2 - camShift) * pxPerM;
    const halfGap = Math.max(84, params.railWidth * pxPerM * 0.62);
    const railTopY = oy - halfGap;
    const railBotY = oy + halfGap;
    const railMidY = oy;
    const spanHalf = Math.min(viewport.width * 0.42, 420 * viewport.scale);
    const railLeft = ox - spanHalf - 40;
    const railRight = ox + spanHalf - 20;

    if (activeLayers.has('railsAndField')) {
      drawDotCrossField(ctx, railLeft + 24, railTopY + 12, railRight - railLeft - 48, railBotY - railTopY - 24, 'in', 76, 56);
      drawMetallicRail(ctx, railLeft, railTopY, railRight, 8);
      drawMetallicRail(ctx, railLeft, railBotY, railRight, 8);
    }

    const labelQueue: Array<{ id: string; x: number; y: number; text: string; color: string; font?: string }> = [];

    if (activeLayers.has('rods')) {
      if (params.rodMode === 'double') {
        drawGlowingConductorRod(ctx, toX(state.x2), railTopY, railBotY, state.v2, '#f472b6', '#fbcfe8', 10);
        labelQueue.push({ id: 'rod2', x: toX(state.x2), y: railBotY + 30, text: `杆2 v₂=${state.v2.toFixed(2)}`, color: '#f9a8d4' });
      }
      const x1s = toX(state.x1);
      drawGlowingConductorRod(ctx, x1s, railTopY, railBotY, state.v1, '#38bdf8', '#e0f2fe', 11);

      // 右侧速度指示青色矢量
      if (Math.abs(state.v1) > 0.05 || params.rodMode === 'single') {
        const vLen = Math.max(36, Math.min(110, state.v1 * 18));
        drawGlowVectorArrow(ctx, x1s + 8, railMidY + 12, x1s + 8 + vLen, railMidY + 12, '#38bdf8', 4.5, 14);
      }
    }

    if (activeLayers.has('currentFlow') && Math.abs(state.current) > 0.02) {
      const x1s = toX(state.x1);
      const curY = railBotY + 18;
      const dir = state.current >= 0 ? 1 : -1;
      const curStart = x1s - 56 * dir;
      drawGlowVectorArrow(ctx, curStart, curY, curStart + 58 * dir, curY, '#f59e0b', 4, 13);
      labelQueue.push({
        id: 'current-label',
        x: curStart + 28 * dir,
        y: railBotY + 38,
        text: `I = ${Math.abs(state.current).toFixed(2)} A`,
        color: '#fbbf24',
        font: '600 14px system-ui, sans-serif'
      });
    }

    if (activeLayers.has('forceVectors')) {
      const x1s = toX(state.x1);
      const BL = params.magneticB * params.railWidth;
      const fAmp = BL * state.current;
      const netElectro1 = params.rodMode === 'single' && params.circuitLoad === 'battery' ? fAmp : -fAmp;
      if (Math.abs(netElectro1) > 0.05) {
        const len = Math.max(-120, Math.min(120, netElectro1 * 24));
        const ay = railMidY - 14;
        drawGlowVectorArrow(ctx, x1s - 6 * Math.sign(len), ay, x1s + len, ay, '#fb7185', 4.5, 14);
        labelQueue.push({
          id: 'f-amp',
          x: x1s + len * 0.55,
          y: ay - 22,
          text: `F安 = ${Math.abs(fAmp).toFixed(2)} N`,
          color: '#fb7185',
          font: '600 15px system-ui, sans-serif'
        });
      }
    }

    resolveAndDrawLabels(ctx, labelQueue, viewport.width, viewport.height);
  }
```

---

### 模块 8：标尺 2 画布 1:1 复刻（`simulations/optics-ray-studio/plugin.ts` 的 `tir-interface` 段）

> 替换 `tir-interface` 渲染：居中半透明玻璃块、交点发光黄色圆环手柄（同时把 `getControlHandles` 的 `incident-ray-pivot` 或角度拖动环对齐交点+入射光线引导点）、反射光暖金渐隐宽束、清晰 `θ₁ = XX.X°` / `θ₂ = XX.X°` 弧标，并去掉顶部冗余角度文本。

```ts
      if (params.sceneMode === 'tir-interface') {
        const p0 = toScreen(0, 0);
        const blockW = Math.min(viewport.width * 0.56, 620 * viewport.scale);
        const blockH = Math.min(viewport.height * 0.24, 185 * viewport.scale);
        const bx = p0.sx - blockW * 0.5;
        const by = p0.sy - blockH;
        drawRefractiveGlassBlock(ctx, bx, by, blockW, blockH);

        ctx.fillStyle = '#cbd5e1';
        ctx.font = '500 14px system-ui, sans-serif';
        ctx.fillText(`介质 1 (n₁ = ${params.n1.toFixed(2)})`, bx + blockW - 145, p0.sy - 14);
        ctx.fillText(`介质 2 (n₂ = ${params.n2.toFixed(2)})`, bx + blockW - 145, p0.sy + 26);
      }
```

角度弧线加上直接数值显示（替换第 565–587 行）：

```ts
    if (activeLayers.has('normalLine') && params.sceneMode === 'tir-interface') {
      const p0 = toScreen(0, 0);
      const theta1 = degToRad(state.activeAngleDeg);
      const theta2 = degToRad(state.refractedAngleDeg ?? state.activeAngleDeg);
      ctx.save();
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
      ctx.fillStyle = '#fde68a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(p0.sx, p0.sy, 56, -Math.PI / 2 - theta1, -Math.PI / 2);
      ctx.stroke();
      ctx.font = '600 14px ui-monospace, monospace';
      const a1Mid = -Math.PI / 2 - theta1 * 0.52;
      ctx.fillText(`θ₁ = ${state.activeAngleDeg.toFixed(1)}°`, p0.sx + Math.cos(a1Mid) * 82 - 48, p0.sy + Math.sin(a1Mid) * 76);

      if (state.refractedAngleDeg !== null) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
        ctx.fillStyle = '#7dd3fc';
        ctx.beginPath();
        ctx.arc(p0.sx, p0.sy, 56, Math.PI / 2 - theta2, Math.PI / 2);
        ctx.stroke();
        const a2Mid = Math.PI / 2 - theta2 * 0.52;
        ctx.fillText(`θ₂ = ${state.refractedAngleDeg.toFixed(1)}°`, p0.sx + Math.cos(a2Mid) * 82 - 36, p0.sy + Math.sin(a2Mid) * 78 + 8);
      }
      ctx.restore();
    }
```

并在 `(0, 0)` 交点处绘制标尺 2 的发光黄圆环焦斑，同时去掉底部的顶部 HUD (`θ₁ = ... | 临界角`)：

```ts
    if (params.sceneMode === 'tir-interface') {
      const p0 = toScreen(0, 0);
      ctx.save();
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#0b0f17';
      ctx.strokeStyle = '#fcd34d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p0.sx, p0.sy, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
```

---

### 模块 9：标尺 3 电路与 `I-U 曲线` 1:1 复刻（`circuit-dc-capacitor-mna/engine.ts` + `plugin.ts`）

#### 9A. 在 `simulations/circuit-dc-capacitor-mna/engine.ts` 扩展 `'divider-lamp'`（保留既有 5 拓扑与 6 条单测零修改）

1. `CircuitTopology` 联合新增 `| 'divider-lamp'`；
2. 在 `solveTopology` 加入分压接法小灯泡 MNA-NR 求解（电源 $E, r$ 串接滑动变阻器全阻 $R_0=20\,\Omega$，滑片比例 $k = \text{sliderR}/20$ 将下段分压节点 3 送给非线性小灯泡 $I = 0.25 U^{0.65}$，直接调用已有 `solveNonlinearMna(3, elements)`！）：

```ts
  if (params.topology === 'divider-lamp') {
    const rTotal = 20;
    const ratio = Math.max(0.05, Math.min(0.95, params.sliderR / 20));
    const rUpper = Math.max(0.2, rTotal * (1 - ratio) + r);
    const rLower = Math.max(0.2, rTotal * ratio);
    const elements: NonlinearCircuitElement[] = [
      { kind: 'voltageSource', id: 'V_main', pos: 1, neg: 0, voltage: E },
      { kind: 'resistor', id: 'R_upper', a: 1, b: 2, resistance: rUpper },
      { kind: 'resistor', id: 'R_lower', a: 2, b: 0, resistance: rLower },
      { kind: 'lamp', id: 'Lamp', a: 2, b: 0, k: 0.25, alpha: 0.65 }
    ];
    const sol = solveNonlinearMna(2, elements);
    const uBulb = sol.nodeVoltages[2]!;
    const iBulb = sol.elementCurrents['Lamp']!;
    const iMain = sol.elementCurrents['R_upper']!;
    return {
      nodeVoltages: sol.nodeVoltages,
      totalCurrent: iBulb,
      branchCurrent1: iMain,
      branchCurrent2: iBulb,
      terminalVoltage: uBulb,
      outputPower: uBulb * iBulb,
      efficiency: E * iMain > 1e-9 ? (uBulb * iBulb) / (E * iMain) : 0,
      capVoltage: uBulb,
      capCurrent: 0,
      capCharge: 0,
      capEnergy: 0
    };
  }
```

#### 9B. 在 `plugin.ts` 的 `paramSchema.topology.options` & `presets` 首位/对应项加入 `分压电路测小灯泡`，并在 `renderCanvas` 对 `'divider-lamp'` 与所有拓扑使用 `CanvasVisualKit`：
- 导线用 `drawRoundedPotentialPath`；
- 中部支路调用 `drawGlowingBulbSymbol(ctx, { x: cx + w * 0.2, y: cy }, state.outputPower, 8)`；
- 变阻器绘制锯齿折线+左侧提示 `滑片位置`；
- 底部中间正下方挂 `drawGroundSymbol(ctx, cx, bot)`；
- 右下角调用 `drawFloatingIUCard(ctx, right + 28, bot - 48, 175, 130, samples, { u: state.terminalVoltage, i: state.totalCurrent })` 呈现悬浮玻璃 `I-U 曲线` 卡（其中 `samples` 用引擎公式或 `solveNonlinearMna` 对 `[0..E]` 均匀采样 16 点真实计算生成，**绝不硬编码假曲线**！）。

---

### 模块 10：标尺 4 3D 工作室光照、横放螺线管、闭合磁感线与 3D 矢量文字（`ThreeStage.tsx` + `em-3d-magnetic-fields/engine.ts`）

#### 10A. 升级 `simulations/em-3d-magnetic-fields/engine.ts` 的 `trace3dFieldLines`（增加外部对称闭合回路种子点 + 双向 RK4 追踪，确保生成标尺 4 上下对称闭合的蓝青色磁感线环路！）

```ts
  const seeds: Vec3[] =
    params.geometryType === 'straight-wire' || params.geometryType === 'parallel-wires'
      ? [
          { x: 0.6, y: 0, z: 0 },
          { x: 1.1, y: 0, z: 0 },
          { x: 0.6, y: 0, z: 1.0 }
        ]
      : params.geometryType === 'finite-solenoid'
        ? [
            { x: 0, y: 0, z: 0 },
            { x: 0.25 * R, y: 0, z: 0 },
            { x: -0.25 * R, y: 0, z: 0 },
            { x: 0.52 * R, y: 0, z: 0 },
            { x: -0.52 * R, y: 0, z: 0 },
            { x: 0, y: 0.35 * R, z: 0 },
            { x: 0, y: -0.35 * R, z: 0 },
            { x: 0.68 * R, y: 0, z: 0 },
            { x: -0.68 * R, y: 0, z: 0 }
          ]
        : [
            { x: 0, y: 0, z: -1.4 },
            { x: 0.35 * R, y: 0, z: -1.3 },
            { x: -0.35 * R, y: 0, z: -1.3 },
            { x: 0, y: 0.35 * R, z: -1.3 }
          ];

  const traceDir = (start: Vec3, sign: 1 | -1): Vec3[] => {
    const out: Vec3[] = [];
    let p = start;
    for (let i = 0; i < (params.geometryType === 'finite-solenoid' ? 110 : 65); i++) {
      const next = stepRK4([p.x, p.y, p.z], 0, 0.055 * sign, (_t, xyz) => {
        const b = evalBiotSavartB({ x: xyz[0]!, y: xyz[1]!, z: xyz[2]! }, params);
        const mag = Math.hypot(b.x, b.y, b.z);
        return mag > 1e-14 ? [b.x / mag, b.y / mag, b.z / mag] : [0, 0, 0];
      });
      p = { x: next[0]!, y: next[1]!, z: next[2]! };
      out.push(p);
      if (Math.hypot(p.x, p.y, p.z) > 3.6) break;
      if (i > 12 && Math.hypot(p.x - start.x, p.y - start.y, p.z - start.z) < 0.08) break;
    }
    return out;
  };

  return seeds.map((seed) => {
    if (params.geometryType === 'finite-solenoid') {
      const backward = traceDir(seed, -1).reverse();
      const forward = traceDir(seed, 1);
      return [...backward, seed, ...forward];
    }
    return [seed, ...traceDir(seed, 1)];
  });
```

#### 10B. 升级 `apps/web/src/stage/ThreeStage.tsx`（关键渲染改造）

1. 导入已验证存在于 `apps/web/node_modules/three` 的 MIT 扩展模块：

```ts
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
```

2. 创建 `PMREMGenerator` 工作室反射环境 + **移除杂乱 `AxesHelper`** + 增加柔和透视径向渐隐地面网格（用 `THREE.FogExp2(0x0b0f17, 0.085)`）：

```ts
    scene.fog = new THREE.FogExp2('#0b0f17', 0.09);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(width, height);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.inset = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(labelRenderer.domElement);
```

3. 物理 `(x, y, z)` 到 Three.js 水平横放轴映射 helper（确保螺线管横卧居中、与标尺 4 完全相同视角）：

```ts
    const toThreePos = (p: { x: number; y: number; z: number }): THREE.Vector3 =>
      isMag3d
        ? new THREE.Vector3(p.z, p.y, p.x)
        : new THREE.Vector3(p.x, p.z, p.y);
```

4. 挂载 3 个 `CSS2DObject`（分别为黄色 `v`、珊瑚红 `F_洛`、天青 `B` 轴线矢量标签），随着箭头端头实时更新三维投影位置，且在 `dispose()` 严格销毁 `envTarget`、`pmrem`、`labelRenderer.domElement` 与场景对象！

5. 增加 `webglcontextlost` 与 `PerformanceGuard`（连续帧耗时降档与静止省电）。

---

## 第三部分：全仓分波次完善路线图（给总控与写手的后续排期）

| 波次 | 目标 | 涵盖文件与工作量 | 硬验收门禁 |
| :--- | :--- | :--- | :--- |
| **Wave A（本轮优先）** | **1:1 像素复刻 4 张标尺图** | 落地上述 **模块 1 ~ 模块 10**（含 `visualKit.ts`、Shell 三件套、E04/B3/B2/E10 升级、`visual-audit.mjs` 首屏默认 `E04`） | 重跑 `visual-audit.mjs` 后并排对照 `01`~`04` 标尺图，整体视觉布局与元素还原度 **>= 95%** |
| **Wave B** | **彻底根治 18 单元坐标分裂** | 为其余 16 个 `renderCanvas` 硬编码像素坐标的模型统一接入 `ViewportController.worldToScreen` 与 `resolveAndDrawLabels` | 任意模型滚轮放大 200%/拖拽平移后，控制手柄、Auto-FBD 与图形 100% 紧咬零偏移 |
| **Wave C** | **全仓交互齐平（43/43 覆盖）** | 为缺手柄的 9 个模型补 `getControlHandles`（含光电波段拖拽、卢瑟福瞄准距、E10 粒子初速），为力学/电磁缺口补 `getForceVectors`（目标 >= 30/43）与 `referenceFrames`（目标 >= 20/43） | 全仓 `plugin.test.ts` 回归覆盖 + 交互审计全部通过 |
| **Wave D** | **全网竞品高频刚需补齐** | B3 多透镜可摆光具座模式、B2 画布点选开关与悬停节点 `U/I` 探针读数、物理实验台实操深化（共扩充至 ~48 核心强体验模态） | 单文件切片 `< 350 KB` gzip 与 100% 离线打包零破坏 |

---

## 第四部分：Luna 提交验收前自检硬门禁

每次修改完毕后，**必须在最后一次代码编辑后**依次跑通以下全部命令，且 Luna 须**亲自读取 `artifacts/ui-audit/*.png` 与 `docs/ui-benchmark/*.png` 并排自查**后再更新 [WRITER_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_HANDOFF_LOG.md) 交总控复核：

1. 全仓 11 个 `tsconfig.json` `tsc --noEmit` 全绿（`0 error`）；
2. `node_modules\.bin\vitest run`（全仓已有 243+ 单测全通过，新加 B2 `'divider-lamp'` 与 `visualKit` 必须配齐单测，**严禁 `skip`/`only` 或修改旧断言**）；
3. `node ./scripts/run-verify-packs.mjs`、`node ./scripts/run-verify-scenes.mjs`、`node ./scripts/run-verify-vault.mjs` 全通过；
4. `$env:VITE_BASE_PATH='/PhysForge/'; node_modules\.bin\vite build apps/web` 主入口 JS `< 350 KB` gzip 且 `MAIN_LEAK_CHECK: CLEAN`（`RoomEnvironment` 与 `CSS2DRenderer` 随 `ThreeStage` 异步 chunk 打包，严禁泄入主包！）；
5. `node scripts/visual-audit.mjs` + `node scripts/e2e-subpath-and-export.mjs` 全通过，`git diff --check` 退出码 `0`。
