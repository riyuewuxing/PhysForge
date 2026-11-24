# PhysForge UI 重构与“禁止盲交”两阶段写手施工方案

> **文档定位**：本文件是总控在亲自比对 4 张视觉标尺图（[01_workbench_em.png](file:///d:/project%20code/44-PhysForge/docs/ui-benchmark/01_workbench_em.png) ~ [04_fullscreen_3d.png](file:///d:/project%20code/44-PhysForge/docs/ui-benchmark/04_fullscreen_3d.png)）与本地实机源码排障后，定稿交给写手（Writer）直接动手的**唯一权威施工方案**。  
> **配套宪法**：[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md)（已增补第 6 节《禁止盲交：实机交互 + 多模态视觉看图验收铁律》）

---

## 一、4 张视觉标尺图逐像素拆解（写手必读，不得自由发挥）

| 标尺文件 | 对应形态与样本模型 | 必须达到的界面布局与渲染特征 |
| :--- | :--- | :--- |
| [01_workbench_em.png](file:///d:/project%20code/44-PhysForge/docs/ui-benchmark/01_workbench_em.png) | **动态带波形标准态**<br>（`em-induction-double-rod` E04 等时序模型） | • 底色 `#0B0F17` + 极细点阵网格；<br>• 顶栏固定 `48px`：左“标题 + `t = X.XX s`”，中悬浮圆角播放胶囊（发光蓝圆形播放键 + `单步` + `复位` + `1.0x`），右仅 **`工具` / `导出` / `全屏演说` 3 个按钮**；<br>• 左侧默认折叠为 **`48px` 极细图标轨**（仅点击图标才滑出半透明浮层目录，选完模型自动收回）；<br>• 右侧为宽 `272px` 悬浮毛玻璃卡片：顶部单行 `<select>` 选预设 → 首屏第一眼直接露出核心滑块 → 中部暗底公式卡 → 底部细长能量/守恒条；<br>• 底部居中悬浮紧凑半透明示波器（高度 `<= 136px`，占屏高 `<= 18%`，双曲线带渐变填充，可一键折叠）；<br>• 画布内：金属渐变导轨、暗淡 `×` 磁场网格、发光青色导体棒、上方珊瑚红 `F安`、右侧青色 `v`、底轨下方琥珀色 `I` 箭头，**零文字重叠**。 |
| [02_optics_clean.png](file:///d:/project%20code/44-PhysForge/docs/ui-benchmark/02_optics_clean.png) | **无示波器纯净画布态**<br>（`builder-optics-ray` B3、静力平衡、波动干涉等非时序模型） | • **默认完全隐藏底部示波器**，画布可见面积 `>= 85%`；<br>• 左下角悬浮一枚毛玻璃小胶囊（`直尺` / `量角器` / `居中复位` 3 图标）；<br>• 半透明渐变介质块（`n₁ = 1.50`）与发光分界线、虚线法线、带 `shadowBlur` 发光的光线（入射/反射/折射）、交点处黄色可拖拽圆环手柄、清晰圆弧角标（`θ₁`、`θ₂`）与外侧文字标注，**彻底远离分界线零穿模**。 |
| [03_circuit_mna.png](file:///d:/project%20code/44-PhysForge/docs/ui-benchmark/03_circuit_mna.png) | **自由建模器仪器级质感**<br>（`builder-circuit-mna` B2 与 B1–B5） | • 导线按节点电势从珊瑚红（高电势）到天青蓝（低电势）平滑发光渐变；<br>• 电流方向用发光小三角粒子流呈现；元件（电源/变阻器/小灯泡）带柔和 `shadowBlur` 微光与可拖拽圆柄；<br>• 左下角保留悬浮工具/电势色条胶囊；电流表/电压表改为回路上的**圆形发光数字表盘**（替代原本遮挡画布的左上大黑框），特性曲线可悬浮于角落迷你卡或右侧卡片，不抢主画布。 |
| [04_fullscreen_3d.png](file:///d:/project%20code/44-PhysForge/docs/ui-benchmark/04_fullscreen_3d.png) | **一键全屏演说与 3D 空间态**<br>（`em-3d-magnetic-fields` E10 / `S01` 及任意模型的全屏演说模式） | • 点击顶栏 `全屏演说` 后：顶栏、左图标轨、右参数栏、示波器 **100% 退场**；<br>• 仅保留左上极简大字标题 + 副标题（`全屏课堂演说模式`）、右上高对比度悬浮毛玻璃公式卡、底部居中一颗**灵动岛控制胶囊**（播放/暂停、复位、`3D / 2D 剖面` 切换、退出全屏）；<br>• 3D 舞台（E10/S01）升级为工作室材质光影：铜金属光泽螺线管/线圈（`TubeGeometry` / `TorusGeometry` 替代 1px 细线）、发光青色磁感线、发光带电粒子与 3D 矢量箭头（`v`/`F洛`/`B`）、地面微光透视网格与右下角 XYZ 坐标轴。 |

---

## 二、阶段一施工清单：先修实锤 P0 Bug + 落地 `scripts/visual-audit.mjs`

### 1. 修复 B3 光学滑块与画布/公式脱节（已实锤根因）
* **问题根因**：[simulations/optics-ray-studio/engine.ts](file:///d:/project%20code/44-PhysForge/simulations/optics-ray-studio/engine.ts#L414-L416) 的 `createInitialState` 写死了 `const angle = params.animateSweep ? 15 : params.incidentAngleDeg;`，且 Preset 1 默认 `animateSweep: true, incidentAngleDeg: 35`，导致静止态和每次拖动滑块都强行画 `15.0°`；另外 [optics-ray-studio/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/optics-ray-studio/plugin.ts#L354) 的 `toScreen` 原点在 `0.5 * width`（与 `ViewportController.ts` 的 `0.45 * width` 和 `0.24 * scale` 错位），导致黄点手柄浮在光线左边！
* **修改方案**：
  1. `optics-ray-studio/engine.ts`：
     * `createInitialState(params)` 改为 `const angle = params.incidentAngleDeg;`；
     * `stepOptics` 在 `params.animateSweep` 为 `true` 时，根据 `params.incidentAngleDeg` 计算起始相位 `phase0 = Math.asin(clamp((params.incidentAngleDeg - 42.5) / 37.5, -1, 1))`，保证从 `t=0` 连续平滑扫描不跳变。
  2. `optics-ray-studio/plugin.ts`：
     * `renderCanvas` 的 `toScreen` 统一对齐 `ViewportController`：`pxPerM = Math.min(viewport.width, viewport.height) * 0.24 * viewport.scale`，`cx = viewport.width * 0.45 + viewport.offsetX`，`cy = viewport.height * 0.5 + viewport.offsetY`；
     * 若在 `RightControlPanel.tsx` 中修改 `incidentAngleDeg`（`plugin.meta.id === 'builder-optics-ray'`），通过 `updateParamsBatch({ incidentAngleDeg: nextVal, animateSweep: false })` 自动关闭自动扫描，防止用户手动调角后点运行又飘走。
  3. 在 `optics-ray-studio/engine.test.ts` 补充回归用例：验证 `animateSweep: true` 且 `incidentAngleDeg: 35` 时 `createInitialState` 的 `activeAngleDeg === 35`。

### 2. 优化 `SimulationStage.tsx` 运行节奏与 `t` 同步响应
* **问题根因**：[SimulationStage.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/SimulationStage.tsx#L616-L621) 在每个物理帧都同步调用 `uPlot.setData()`，导致软件渲染环境下帧耗过高、`rawDtSec` 被钳位在 `0.05` 使 `t` 推进缓慢；同时非时序模型也一直挂载重绘 `uPlot`。
* **修改方案**：
  1. 新增 `lastPlotSyncMsRef`，将 `syncUPlotData()` 节流至 `65ms`（约 15Hz），且当示波器处于折叠/隐藏态时跳过 `plot.setData()`；
  2. `isPlaying` 切为 `true` 时立即触发一次 `emitTelemetrySummary(true)`；保持固定 `240 Hz` 步进精度不变，但单帧 `rawDtSec` 上限放宽至 `0.08`（分 `4` 次 `0.02` 子步内插或常规累加），确保点击 `▶ 运行` 后 800ms 内 `t` 稳定推进 `> 0.5 s`；
  3. 在 `resetNonce` 触发的初始化 `useEffect` 内同时重置 `lastFrameMsRef.current = null`、`eventsRef.current = []` 并强制 `emitTelemetrySummary(true)`，杜绝状态/事件日志残留。

### 3. 落地实机交互与截图审计脚本 `scripts/visual-audit.mjs`
* 在 `package.json` 新增 `"audit:ui": "node scripts/visual-audit.mjs"`。
* `scripts/visual-audit.mjs` 要求：
  1. 自行起停本地静态预览服（针对 `apps/web/dist`，先构建或检查已构建产物）与 Playwright 无头浏览器（优先读 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`，未设时自动尝试本机 Chrome/Edge 或 Playwright Chromium，视口 `1440×900`）；
  2. 依次检查 4 个代表模型：**`em-induction-double-rod` (E04, Preset 4)**、**`builder-optics-ray` (B3, Preset 1)**、**`builder-circuit-mna` (B2, Preset 1)**、**`em-3d-magnetic-fields` (E10, Preset 1)**；
  3. 对每个模型执行真实 UI 操作并保存截图至 `artifacts/ui-audit/`：
     * `<tag>_01_init.png`：初始加载截图（同时采集 DOM 几何指标：顶栏高度 `<= 52px`、顶栏右侧按钮数 `<= 3`、左轨宽度 `<= 56px`、右侧面板宽度 `<= 288px` 且首个滑块在视口上半屏可见、主画布面积占比 `>= 72%`、非时序模型 B3 默认隐藏示波器且画布占比 `>= 85%`）；
     * `<tag>_02_running.png`：真实点击 `[data-testid="btn-play-pause"]`，等待 `800ms`，硬性断言顶栏时间 `t > 0.2 s` 且运行前后 `<canvas>` 像素存在真实变化；
     * `<tag>_03_slider_synced.png`：真实拖动/设置右侧第一个参数滑块为非默认值，硬性断言公式卡或画布同步变化（如 B3 拖动 `incidentAngleDeg` 至 `50` 时，右侧公式卡显示 `50.0°` 且不再锁死 `15.0°`）；
     * `E10_04_fullscreen_3d.png`：点击 `[data-testid="btn-fullscreen-speech"]` 进入全屏演说态，硬性断言顶栏与左右侧栏不可见、Three.js `<canvas>` 非空且宽高有效，截图留档；
  4. 收集全程 `consoleErrors`、`pageErrors`、`failed404`、`externalRequests`，任意一项非空即退出码 `1`。

---

## 三、阶段二施工清单：对照 4 张标尺图重构 `apps/web` 与核心画布

### 1. 全局设计 Token（[apps/web/src/index.css](file:///d:/project%20code/44-PhysForge/apps/web/src/index.css)）
* 暗色默认（对标 4 张标尺图）：
  * `--pf-bg: #0B0F17`、`--pf-canvas-bg: #0B0F17`
  * `--pf-surface: rgba(15, 23, 42, 0.72)`、`--pf-surface-elevated: rgba(20, 30, 48, 0.84)`
  * `--pf-border: #1E293B`（浮层配 `backdrop-filter: blur(12px)`）
  * `--pf-accent: #38BDF8`
* 保留 `[data-theme="projector"]` 白底高对比切换不退化。
* 画布背景在暗色态渲染点阵微网格（`radial-gradient(rgba(148, 163, 184, 0.14) 1px, transparent 1px)`，`background-size: 24px 24px`），与标尺 1–3 一致。

### 2. 三大外壳组件重构（`apps/web/src/`）
1. **Store 默认态调整（[useClassroomStore.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/store/useClassroomStore.ts)）**：
   * **`leftSidebarOpen` 默认改为 `false`**（默认折叠为 `48px` 图标轨，点击目录按钮才滑出浮层，选中模型后自动收回）；
   * 新增 `fullscreenPresentation: boolean`（`全屏演说` 独立于旧 `bigScreenMode`，点击进入标尺 4 纯净演说态，按 `Esc` 或点击悬浮胶囊退出）；
   * 新增 `oscilloscopeCollapsed: boolean` 与非时序模型自动判断函数 `isNonTimeSeriesModel(modelId)`（涵盖 `builder-optics-ray`、`optics-wave-interference`、`mech-dynamic-equilibrium`、`mech-constrained-velocity`、`exp-electrical-error-lab` 的静态模式等：切换至这些模型时默认隐藏底部示波器，保留左上/左下微按钮可手动展开）。
2. **`48px` 极简顶栏 + `48px` 左图标轨 + `全屏演说态`（[App.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/App.tsx) & [LeftCatalogSidebar.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/LeftCatalogSidebar.tsx)）**：
   * **顶栏**：固定 `h-12`（`48px`），左“目录切换 + 模型名 + `t = X.XXX s`”，中“圆角玻璃播放胶囊”（`btn-play-pause`, `btn-step`, `btn-reset`, 倍速 `<select>`），右**严格只留 3 个按钮**：
     1. `工具`（`data-testid="btn-tools-menu"`）：点击展开悬浮毛玻璃菜单，收纳直尺/量角器/圆规/Auto-FBD/参考系/POE 遮罩/频闪/板书/主题切换/3D视角/撤销重做；
     2. `导出`（`data-testid="btn-export-studio"`）：直达导出工坊；
     3. `全屏演说`（`data-testid="btn-fullscreen-speech"`）：切入标尺 4 演说态。
   * **左侧 `48px` 极细图标轨**：始终占位 `w-12`（仅占 `3.3%` 宽），放 5 个核心图标按钮：`模型目录` (`rail-btn-catalog`)、`检索 Ctrl+K` (`btn-command-palette`)、`教研导学案` (`btn-teaching-pack`)、`数据分析` (`btn-analysis-lab`)、`AI 建模` (`btn-ai-copilot`)。点击目录后以 `fixed left-12 top-12 bottom-0 z-30 w-80 backdrop-blur-md` 浮层滑出，不挤压主画布，选完模型自动关闭。
   * **全屏演说态（标尺 4）**：隐藏顶栏、图标轨、右侧栏与底部示波器，仅在画布上悬浮：
     * 左上：极简标题 + `全屏课堂演说模式` 副标题；
     * 右上：放大高对比度悬浮毛玻璃公式卡（调用 `KatexFormulaCard`）；
     * 底部居中：灵动岛胶囊（`btn-play-pause`、`btn-reset`、3D 模型专有 `3D / 2D 剖面` 切换按钮、`退出全屏`）。
3. **宽 `272px` 悬浮毛玻璃右侧控制台（[RightControlPanel.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/RightControlPanel.tsx)）**：
   * 以悬浮圆角卡片形式停靠画布右侧（`w-[272px] rounded-2xl border border-[#1E293B] bg-slate-900/72 backdrop-blur-md shadow-2xl`，画布可铺满底区，保留高占比）；
   * **垂直顺序严格对齐标尺图**：
     1. **顶部单行 `<select>` 选预设**（替代原来占掉半屏的 6 张大按钮卡片！保留下方一行当前预设简短提示可折叠）；
     2. **第一屏正上方直接露出核心参数滑块**（前 3–4 个核心参数直接置顶，不需滚动即可看到）；
     3. **中部精致暗色公式卡**（`KatexFormulaCard`）；
     4. **底部细长能量/守恒条**（精简版 `EnergyBarChart`，折叠/精简事件日志，避免撑爆高度）。
4. **底部悬浮工具胶囊与紧凑示波器（[SimulationStage.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/SimulationStage.tsx)）**：
   * 左下角悬浮一枚毛玻璃小胶囊（`直尺` / `量角器` / `居中复位` 图标，对应标尺 2 与标尺 3）；
   * 底部居中悬浮紧凑示波器（仅时序模型默认显示，宽度 `max-w-[560px]`、高度 `<= 136px`，带半透明渐变曲线填充与一键收起按钮）；非时序模型默认收起为一个小巧的 `展开示波器` 微标签，使光学/静力学舞台可见面积 **`>= 85%`**。
   * **兼容性硬守则**：保留 `e2e-subpath-and-export.mjs` 所依赖的 `simulation-canvas`、`btn-play-pause`、`btn-export-studio`、`export-studio-drawer`、`three-stage-container` 与 `model-card-*` 的 `data-testid`（`e2e-subpath-and-export.mjs` 选模型前先点击 `[data-testid="rail-btn-catalog"]` 展开浮层即可）。

### 3. 四大标尺单元画布与 3D 渲染质感升级
1. **`E04`（[simulations/em-induction-double-rod/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/em-induction-double-rod/plugin.ts)）**——对齐标尺 1：
   * 金属线性渐变导轨、淡化 `×` 磁场网格、青色 `shadowBlur` 发光导体棒；
   * **彻底解决文字重叠**：`杆1` 标于导轨上方、`F安` 箭头与文字在 `railMidY - 14`（文字在箭头上方）、`v` 矢量在 `railMidY + 12`、`I = ... A` 电流箭头与文字独立标在**下导轨下方**，经包围盒检测绝不互压。
2. **`B3`（[simulations/optics-ray-studio/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/optics-ray-studio/plugin.ts)）**——对齐标尺 2：
   * `toScreen` 对齐 `ViewportController`（手柄精准套在入射光上）；
   * 渐变半透明介质 1 玻璃块 + 发光分界线、虚线法线、`shadowBlur` 发光光路、交点黄色发光圆环、清晰的 `θ₁` / `θ₂` 圆弧角标，所有文字放在光线外侧与空白区，远离分界线零穿模。
3. **`B2`（[simulations/circuit-dc-capacitor-mna/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/circuit-dc-capacitor-mna/plugin.ts)）**——对齐标尺 3：
   * 导线增加柔和 `shadowBlur` 辉光；`meters` 图层改为在回路底边与右端绘制**发光圆形电流表 / 电压表表盘**（消除左上大黑框遮挡），节点电势标签移到导线外侧且互不重叠。
4. **`E10` & 3D 舞台（[apps/web/src/stage/ThreeStage.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/ThreeStage.tsx)）**——对齐标尺 4：
   * 背景切换为 `#0B0F17` + 柔和暗色透视地面网格；增加双光源（主方向光 + 轮廓补光）；
   * 将 `E10`（及 `S01`）的载流线圈升级为真实立体铜金属光泽 `TorusGeometry` / `TubeGeometry`（`MeshStandardMaterial({ color: 0xd97706, metalness: 0.78, roughness: 0.25 })`），磁感线采用柔和青色半透明流线，带电粒子采用发光球体 + 渐变轨迹线 + 3D 速度/洛伦兹力箭头，并在右下角渲染微型 XYZ 坐标轴与支持全屏胶囊的 `3D / 2D 剖面`（正交视角）切换。
   * **仍严格保持懒加载**：`ThreeStage` 仅在切入 `three3d` 模型时按需加载，切离时完整 `dispose()` 释放显存。

---

## 四、写手自检与提交总控验收流程

1. 本地跑通全部门禁：
   * `tsc --noEmit`（全工作区 + `scripts/tsconfig.json`）
   * `vitest run`（全仓单测全绿，含 B3 新增回归测试）
   * `verify:packs`、`verify:scenes`、`verify:vault`
   * `VITE_BASE_PATH=/PhysForge/ vite build apps/web`（首屏主包 `< 350 KB` gzip，`MAIN_LEAK_CHECK: CLEAN`）
   * `node scripts/e2e-subpath-and-export.mjs`（Edge / Chrome 全通）
   * **`node scripts/visual-audit.mjs`**（Chrome/Edge 实机点击、拖动、全屏演说，产出 `artifacts/ui-audit/*.png`）
2. 写手**必须亲自用图像读取查看 `artifacts/ui-audit/*.png` 并对照 `docs/ui-benchmark/*.png` 自查 6 条硬指标**，确认无误后再更新 [WRITER_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_HANDOFF_LOG.md) 交由总控做最终多模态并排看图终审。
