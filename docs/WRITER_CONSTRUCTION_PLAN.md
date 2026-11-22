# PhysForge 写手施工方案（Writer Construction Plan — 大轮次合并版）

> **文档定位**：本文件为**总控审校后的可执行施工方案**。为减少频繁中断与无效交接，剩余建设任务合并为 **2 个高产出大轮次（Wave 1 与 Wave 2）**。写手须在每大轮内部按模块自推进并逐项自检，仅在**整轮全部模块竣工且通过全量门禁后**更新 [WRITER_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_HANDOFF_LOG.md) 并交由总控一次性验收。  
> **顶层架构蓝本**：[physforge_ai.md](file:///d:/project%20code/44-PhysForge/physforge_ai.md) ｜ **仓库宪法**：[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md)  
> **目标远程仓库**：`https://github.com/riyuewuxing/PhysForge`（公开仓库，默认分支 `main`）

---

## 一、已完成基线与总控硬约束

### 1. 已验收基线（Phase 0 ✅ 已通过总控验收）
* 本地已初始化 `main` 分支并绑定 `origin`，落盘 `LICENSE`（MIT）、`.gitignore`、`AGENTS.md`、`docs/{BLUEPRINT,CURRICULUM_MAP,PEDAGOGY_GUIDE}.md`。
* `@physforge/sim-sdk`、`@physforge/pedagogy-schema`、`@physforge/physics-core`（含 `RK4`、`VelocityVerlet`、`BorisPusher`、`AdaptiveRK45`、`bisectEvent` 与守恒校验工具）已落地并通过 `pnpm typecheck`、`pnpm test`（3 文件 18 用例）、`pnpm build`。
* 环境：`Node v24.18.0`、`pnpm 11.24.0`（Windows；依赖安装用 `BypassSandbox: true`，常规 `typecheck/test/build` 在沙箱内运行；PowerShell 5.1 命令串联用 `; if ($LASTEXITCODE -eq 0) { ... }`）。

### 2. 六条不可逾越的工程红线
1. **物理与视图严格隔离 + 60fps 渲染红线**：`packages/physics-core` 与模型 `engine.ts` 零 DOM/Canvas/React 依赖；高频物理循环用**固定物理步长累加器**跑在 `requestAnimationFrame` + `ref`，禁止每帧坐标写入 `useState`。
2. **许可证合规**：公开 MIT 仓，严禁复制 `circuitjs1`（GPL-2.0/3.0）或 `tldraw`（商业限制）源码；严禁使用 `--force` 强压依赖冲突。
3. **100% 离线可用（零外网 CDN）**：`@excalidraw/excalidraw` 必须配置本地静态资源路径（`EXCALIDRAW_ASSET_PATH`），`KaTeX` 字体全部本地打包，严禁运行时请求 `unpkg.com` / `jsdelivr` 等外网。
4. **反作弊与显式报错**：严禁 `@ts-ignore`、`as any`、`eslint-disable`、`skip`/`only`、放宽守恒误差阈值或空 `try/catch`。遇不可解阻断立即停下报错。
5. **精确事件捕获实度**：`bisectEvent` 必须基于步进积分回溯二分收敛至 $|\Delta t| \le 10^{-7}\text{ s}$，禁止端点线性插值混充。
6. **单文件切片轻量化**：`apps/singlefile-exporter` 须按**单个目标模型**打包（仅含壳 + 目标模型 + `uPlot` + `KaTeX`），严禁将全量模型、`Rapier` WASM 或 `Pyodide` 塞入切片。

---

## 二、大轮次施工规划（剩余共 2 大轮）

> **节奏说明**：Phase 0 已竣工；接下来写手按 **Wave 1** 一次性拿下“全功能教室外壳 + 离线单文件导出 + 4 大旗舰模型”，经总控一次验收后，再按 **Wave 2** 一次性拿下“生态集成/电路/沙箱 + 循证教研防幻觉闭环 + 开源发布”。

---

### Wave 1（第一大轮）：教室演示全栈外壳 + 单文件导出 + 4 大旗舰物理模型
> **等价覆盖原 Phase 1 + Phase 2 + Phase 0 两项小收口**  
> **目标产物**：一套可直接在真实高中物理课堂大屏离线运行、可导单文件 HTML 插入希沃白板、且自带 4 个“天花板级”旗舰力学/电磁/波动仿真模型的完整产品。

#### Module A：Phase 0 遗留收口与 Phase 1 依赖兼容性预检
1. **顺手收口 2 项工程卫生**：
   * 调整 `packages/*/tsconfig.json`（或增补 `tsconfig.build.json`），使 `pnpm build` 编译 `dist/` 时排除 `**/*.test.ts`，不向产物目录输出测试代码与 `vitest` 引用。
   * 在 `packages/physics-core/src/integrators/index.ts` 的 `stepRK4`、`stepVelocityVerlet`、`tryStepRK45` 中增加导数/加速度返回数组长度与状态维度一致的显式校验。
2. **React 19 兼容性与离线资产前置核查**：
   * 实查 `vite@^6`、`react@^19`、`react-dom@^19`、`tailwindcss@^4`、`zustand`、`uplot`、`katex`、`@excalidraw/excalidraw`、`vite-plugin-singlefile`、`vite-plugin-pwa`、`playwright` 的实际可用版本与 `peerDependencies`。
   * 确认 `@excalidraw/excalidraw` 在 React 19 下安装与运行无异常，并确定其本地字体/资产复制到 `public/` 或构建目录的配置方案（若与 React 19 存在硬冲突，**立刻停下报总控裁决**，严禁 `--force`）。

#### Module B：`apps/web` 教室演示外壳 + 离线基建 + `apps/singlefile-exporter`
1. **主工作台架构（`apps/web`）**：
   * 三栏可折叠布局：
     * **左栏**：仿真大厅导航（支持按人教版 6 册教材、2025 课标四大核心素养、难度分级筛选与搜索）；
     * **中栏**：高 `devicePixelRatio` Canvas 2D 主渲染视窗（固定物理步长累加器 `rAF + ref` 驱动、暂停/单步/倍速 $0.1\times$–$2\times$、**Strobe 频闪打点**开关、临界事件钉点高亮）；底部 **`uPlot` 双通道实时示波器**（支持切换物理量通道及鼠标悬停/拖动时间轴**双向联动回放**）；
     * **右栏**：基于 `paramSchema` 自动生成的触控滑块/开关/枚举面板、**课堂预设剧本速切**（支持键盘 `1/2/3/4` 快捷键秒切）、可切换图层清单、`KaTeX` 动态公式数值实时代入与分项能量堆叠柱状图。
2. **三大课堂杀手锏**：
   * **教室大屏双主题**：一键切换“黑板护眼深蓝”与“投影仪高对比白底”，大屏模式隐藏无关装饰、全局正文 $\ge 18\text{px}$、全部触控热区 $\ge 44\text{px} \times 44\text{px}$。
   * **POE 预测遮罩模式**：开启后隐藏轨迹预测线、辅助包络与示波器曲线，供学生预测后再点击揭晓。
   * **Excalidraw（MIT）透明课堂板书层**：暂停仿真后一键叠加透明 Excalidraw 画布供电磁笔作圆心/辅助线，全部静态资产本地打包（`EXCALIDRAW_ASSET_PATH` 指向本地），支持一键导出“仿真画面 + 手绘批注”合成高清 PNG。
3. **离线分发双引擎**：
   * 为 `apps/web` 配置 **PWA 离线缓存**（断网秒开）。
   * 构建 **`apps/singlefile-exporter`**：通过 CLI/脚本（如 `pnpm export:singlefile --model=<id> [--preset=<presetId>]`）将**单个指定模型 + 预设 + 精简教室壳 + `uPlot` + `KaTeX`** 打包为独立离线 `.html`（零外网 `http(s)://`，不包含其他无关模型、Rapier WASM 或 Excalidraw 重型资源包）。

#### Module C：4 大 Tier-0 旗舰物理仿真模型（全部落地并接入 `simulations/registry.ts`）
每个模型位于 `simulations/<model-id>/`，必须完整交付 `PHYSICS_SPEC.md`、`engine.ts`、`engine.test.ts`、`plugin.ts`（含 `≥ 4` 套人教版课标/高考真题/迷思反例 `presets`）：
1. **`em-bounded-magnetic-field`（有界磁场与动态圆 + 复合场配速法）**：
   * 覆盖直线边界/半空间、圆形边界、矩形边界匀强磁场，以及正交匀强电磁复合场；
   * 物理内核采用 `BorisPusher` + `bisectEvent` 精确捕获粒子入射/出界/相切临界点；
   * 渲染层提供**放缩圆、旋转圆、平移圆、磁聚焦/磁发散动态包络圆与圆心轨迹**辅助图层，以及复合场**配速法（匀速直线 + 匀速圆周）**双分量分解矢量图层。
2. **`wave-vibration-coupling`（机械波与质点振动双图联动 + 干涉衍射 + 多普勒）**：
   * 顶部 $y-x$ 波形传播主画布 + 任点可选质点同步绘制 $y-t$ 振动曲线（内置“上下坡法/微平移法”下一时刻位移矢量辅助线）；
   * 支持切换**双波源二维水波干涉**（实时渲染加强区/减弱区双曲线族与任意点合振幅验证）与**多普勒效应**波前挤压可视化；
   * 严格验证波速 $v = \lambda f$、相位匹配及双波源叠加解析解精度（`< 1e-4`）。
3. **`em-induction-double-rod`（电磁感应单杆/双杆切割模型）**：
   * 支持单杆/双杆、光滑/粗糙导轨、接纯电阻/接电容器/接恒定电源、有/无外力拉动多种组合；
   * 使用 `RK4`（或 `AdaptiveRK45`）+ `bisectEvent` 精确捕捉共速临界点，实时联动 $v-t$、$I-t$、安培力冲量与焦耳热/动能/电容储能柱状图；
   * 单元测试验证无外力双杆动量守恒 $m_1 v_1 + m_2 v_2 = \text{const}$、能量守恒 $Q + \Delta E_k + E_C = W_{\text{外}}$ 与电容充电最终稳定电流/电荷量解析解（`< 1e-4`）。
4. **`mech-block-conveyor`（动力学板块模型与传送带摩擦力突变）**：
   * 支持水平/倾斜传送带（顺/逆时针运动）与上下叠放木块–木板模型；
   * 使用 `bisectEvent` 精确捕获物块与传送带/木板达到**共速的瞬间**并切换静/滑动摩擦力分支（杜绝数值抖振）；
   * 实时同屏对比“物块对地位移 $x_{\text{物}}$”“传送带/木板位移 $x_{\text{带}}$”与“**相对划痕长度 $\Delta x_{\text{rel}}$**”，量化摩擦生热 $Q = f \cdot \Delta x_{\text{rel}}$ 并通过能量守恒单测校验。

#### Wave 1 验收门禁（整轮竣工后一次性跑齐并报总控验收）
1. `pnpm typecheck` 退出码 `0`（`dist/` 产出干净且无测试文件混入）。
2. `pnpm test` 退出码 `0`（包含 Phase 0 内核测试 + 4 大旗舰模型各自完整的 `engine.test.ts` 守恒律/解析解/事件捕获/边界零 NaN 测试）。
3. `pnpm build` 退出码 `0`；构建产物与运行态均零外网 `http(s)://` 请求。
4. `apps/singlefile-exporter` 实测导出至少 2 个旗舰模型（如 `em-bounded-magnetic-field`、`mech-block-conveyor`）生成独立 `.html`，验证文件自包含、零外网引用且在浏览器独立打开可正常运行。
5. **Playwright 实机全链路验收**：依次切换 4 大旗舰模型与预设、验证 `uPlot` 双向时间轴回放、POE 遮罩切换、Excalidraw 批注与 PNG 导出、教室大屏双主题与热区检查，全程 `consoleErrors = []`、`pageErrors = []`、零外网请求，并清理全部临时进程与截图脚本。

---

### Wave 2（第二大轮）：生态扩展集成 + AI 循证教研防幻觉闭环 + 开源社区发布
> **等价覆盖原 Phase 3 + Phase 4**  
> **目标产物**：补全几何光学、自由力学沙箱、无 GPL 电路求解器，建成“AI 教研包 + 物理内核防幻觉验算”工作台，完成开源社区发布级门面。

#### Module D：专业开源生态整合与无 GPL 电路求解器
1. **`optics-ray-studio`（几何光学实验室）**：
   * 合规集成 **`ricktu288/ray-optics`（Apache-2.0）** 核心光学引擎（如无现成 npm 包则审慎评估合规源码引入与独立 NOTICE 声明，严守 Apache-2.0 / MIT 兼容）；
   * 注入人教版高中光学标准预设（全反射临界角、平行玻璃砖侧移、三棱镜色散、光导纤维、双缝/光栅），封装进 `SimulationPlugin` 与中文大屏壳，配 `PHYSICS_SPEC.md` 与折射定律/临界角解析校验单测。
2. **`mech-free-sandbox`（自由力学探究沙箱）**：
   * 按需动态懒加载 **`@dimforge/rapier2d-compat`（Apache-2.0）** WASM 引擎（严禁提前打入主首屏 chunk 或单文件导出器）；
   * 支持在画布上交互搭积木式放置斜面、刚体滑块、轻弹簧、定/动滑轮与弹性/非弹性碰撞实验，并接入统一示波器与能量读数。
3. **`circuit-dc-capacitor-mna`（纯 TS 轻量 MNA 直流/含容电路）**：
   * **严禁引入 GPL `circuitjs1` 源码**；基于公开 **MNA（改进节点分析法）** 从零编写纯 TS 轻量节点电压与瞬态积分求解器；
   * 覆盖闭合电路欧姆定律、滑动变阻器动态分析、电源输出功率 $P-R$ 极值曲线、含容电路充放电瞬态电流/电压曲线，配 `PHYSICS_SPEC.md` 与基尔霍夫/RC 解析指数解校验 `engine.test.ts`。

#### Module E：AI 循证教研闭环与零幻觉验算体系
1. **首批全套教研资产（`content/teaching-packs/` & `content/presets/`）**：
   * 为 4 大旗舰模型（及可选生态模型）编写完整的 JSON 教研包，每包必含：POE 课堂探究任务单、母题 + 基础/进阶/压轴三层高考变式题、前概念误区诊断卡（带反例 Preset 绑定）。
2. **自动化数值防幻觉验算脚本（`scripts/verify-teaching-packs.ts`）**：
   * 遍历 `content/teaching-packs/*.json` 先过 `@physforge/pedagogy-schema` Zod 校验；
   * 再自动加载 `simulations/registry.ts` 中对应的物理模型 `engine` 与绑定 `presetId`，运行仿真提取关键指标并与题目 `verification.expectedMetrics` 逐一比对，**任何误差超限立即显式失败退出**（在 `package.json` 暴露 `pnpm verify:packs` 并纳入 CI/验收门禁）。
3. **网页端教研与导学案面板（`apps/web`）**：
   * 内置“教研包 / 导学案”抽屉或标签页：一键浏览 POE 任务单、点击变式题/误区反例即刻加载对应 Preset 运行仿真、支持导出/打印规范化排版导学案（Markdown / HTML / 打印 CSS）。

#### Module F：开源社区门面与终验封板
1. 完善中英双语 `README.md`（架构介绍、在线/离线/单文件用法、模型矩阵与本地开发命令）与 `CONTRIBUTING.md`（专门指导一线物理教师无代码贡献 `content/presets/` 与 `content/teaching-packs/` 的流程与校验命令）。
2. 同步刷新 [docs/BLUEPRINT.md](file:///d:/project%20code/44-PhysForge/docs/BLUEPRINT.md) 中实际工具链版本（如 TypeScript 7、Vitest 5、Zod 4 等）。
3. **Wave 2 最终全量门禁**：`pnpm typecheck && pnpm test && pnpm verify:packs && pnpm build` 全绿；Playwright 实机验证 Wave 2 新增光学/沙箱/电路/教研面板与全量回归、`consoleErrors = []`、零外网请求；`docs/WRITER_HANDOFF_LOG.md` 更新完整实证并交总控终验。

---

## 三、写手大轮次交接 Checklist
每大轮（Wave 1 / Wave 2）全部竣工交总控验收前，写手必须自检以下全部条目：
- [ ] 是否严格遵守物理计算层与 UI/React 零耦合，无每帧坐标 `useState`？
- [ ] 是否无任何 `skip` / 放宽误差阈值 / `@ts-ignore` / `as any` / 空 `try-catch` / GPL 代码引入 / 外网 CDN 请求？
- [ ] 是否在**最后一次代码编辑后**完整跑通全量 `pnpm typecheck`、`pnpm test`、`pnpm build`、`单文件导出实测`、Playwright 实机回归（Wave 2 含 `pnpm verify:packs`）？
- [ ] 是否已清理临时调试脚本、截图与残留后台进程？
- [ ] 是否仅更新了 [WRITER_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_HANDOFF_LOG.md)，未越界修改 [ARCHITECT_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/ARCHITECT_HANDOFF_LOG.md)？
