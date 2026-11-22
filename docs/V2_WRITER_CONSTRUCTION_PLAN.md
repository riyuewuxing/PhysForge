# PhysForge V2.0 写手施工方案（总控审校对齐版）

> **文档定位**：本文件是总控在通读云端三卷 V2.0 方案（[01](file:///d:/project%20code/44-PhysForge/docs/v2-specs/01_ARCHITECTURE_AND_CORE_PLATFORM.md) / [02](file:///d:/project%20code/44-PhysForge/docs/v2-specs/02_MODELS_BUILDERS_AND_MECHANICS_EM.md) / [03](file:///d:/project%20code/44-PhysForge/docs/v2-specs/03_MODELS_WAVES_MODERN_STSE_EXP.md)）、结合本地基线 `main@62f9383` 与全网技术安全核查后，最终定稿交给写手执行的**唯一权威施工总方案**。  
> **配套宪法**：[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md) ｜ **交接日志**：[WRITER_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_HANDOFF_LOG.md)

---

## 一、总控审校与全网调研纠偏（开工前必读，防止踩大坑）

在继承云端三卷 V2.0 全部架构与 43 单元目标的前提下，总控通过本地代码实查与全网调研发现并提前修正以下 **6 项盲区与冲突**，写手必须严格按本节裁定施工：

### 1. 统一施工批次编号，消除三卷自相矛盾
* **冲突事实**：本地 V1.0 已占用 `Wave 1` / `Wave 2`；云端卷一将 V2.0 排为 `Wave 2–7`（Wave 5 做电磁、Wave 6 做波光热原/STSE/实验），而云端卷三把 Wave 5 写成了波动热学、Wave 6 写成了近代/STSE/实验。
* **总控裁定**：V2.0 全部 6 大轮次统一命名为 **`V2-W1` 至 `V2-W6`**（见第三章统一排期表），彻底杜绝编号混淆。

### 2. V1.0 既有模型 ID 与教研包兼容铁律（防 `verify:packs` 断链）
* **本地现状**：`content/teaching-packs/*.json`（6 包 20 题）与 `apps/singlefile-exporter/export.mjs` 强绑定 7 个 V1.0 模型 ID 与全部旧 `presetId`。
* **总控裁定**：
  * `W01`（`wave-vibration-coupling`）、`E04`（`em-induction-double-rod`）、`M05`（`mech-block-conveyor`）**原目录与 `meta.id` 就地升级**；
  * `B1–B4` 升级为自由建模器时（`builder-composite-em-field`、`builder-circuit-mna`、`builder-optics-ray`、`builder-mechanics-lab`），必须在 [simulations/registry.ts](file:///d:/project%20code/44-PhysForge/simulations/registry.ts) 的 `getSimulationById(id)` 中维护 `LEGACY_MODEL_ALIASES` 映射旧 ID（如 `em-bounded-magnetic-field` → `builder-composite-em-field`），并保留全部 V1.0 `presetId`（或迁移并同步通过 `pnpm verify:packs`），**确保 V1.0 已有 46 条测试与 20 道教研验算题全程不崩**。

### 3. `mathjs` 安全版本与孤岛隔离（CVE 核查结果）
* **全网实查**：`mathjs < 15.2.0` 曾曝出高危 AST 沙箱逃逸漏洞（`CVE-2026-40897`、`CVE-2026-41139`）。
* **总控裁定**：安装 **`mathjs >= 15.2.0`**（推荐仅引入必要依赖工厂或 `mathjs` 15.2+ 白名单 AST 编译器，显式禁用 `import`、`createUnit`、`evaluate` 原型链属性），且**仅允许在 `B5 (builder-custom-ode-lab)` 内部动态 `import()` 懒加载**，并施加最大表达式节点数与计算步数上限。

### 4. 3D 视口技术选型锁定纯 Vanilla `three`（禁用 `@react-three/fiber`）
* **全网实查**：本仓当前运行 **`react@19.3.1`**。`@react-three/fiber@8` 不兼容 React 19；而 `@react-three/fiber@9` + `drei` 会增加 reconciler 复杂度与打包体积。云端卷一接口契约 `mountThreeScene(container, context)` 原生面向命令式挂载。
* **总控裁定**：只安装 **`three` + `@types/three`**（MIT），使用 `OrbitControls`（`three/examples/jsm/controls/OrbitControls.js`）实现 `ThreeStage.tsx` 与 `mountThreeScene` 桥接，切离模型时严格执行 `renderer.dispose()` / `geometry.dispose()` / `material.dispose()`；**不安装 `@react-three/fiber` 或 `@react-three/drei`**。

### 5. GitHub Pages 子路径部署修复（解决 `/excalidraw-assets/` 404 隐患）
* **本地现状核查**：V1.0 的 [apps/web/src/main.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/main.tsx) 硬编码 `'/excalidraw-assets/'`、[index.html](file:///d:/project%20code/44-PhysForge/apps/web/index.html) 硬编码 `'/icon.svg'`、[vite.config.ts](file:///d:/project%20code/44-PhysForge/apps/web/vite.config.ts) 未设置动态 `base`。若直接部署到 GitHub Pages 子路径 `https://riyuewuxing.github.io/PhysForge/`，所有静态资产与 PWA SW 将全部 404！
* **总控裁定**：在 `V2-W1` 中必须重构为：
  * `vite.config.ts` 读取 `base: process.env.VITE_BASE_PATH || '/'`；
  * `main.tsx` 改用 `new URL(`${import.meta.env.BASE_URL}excalidraw-assets/`, window.location.href).href`；
  * `index.html` 与 `VitePWA` `manifest` 使用相对路径 `./icon.svg` 与 `./`，使 Cloudflare Pages（`/`）与 GitHub Pages（`VITE_BASE_PATH=/PhysForge/`）双线 100% 正常。

### 6. Phyphox / Tracker CSV 解析方言与单文件切片体积防线
* **全网实查**：手机实验软件 `Phyphox` 常导出**分号 `;` 或制表符 `\t`** 分隔 CSV（甚至欧洲区域逗号小数 `3,14`），`Tracker` 常带首行元数据描述行后再接表头；`papaparse`（MIT）需配 `@types/papaparse` 并由 `csvFitting.ts` 显式兼容这两类格式。
* **单文件切片防线**：升级 [apps/singlefile-exporter/export.mjs](file:///d:/project%20code/44-PhysForge/apps/singlefile-exporter/export.mjs)，除禁止无关模型与 Excalidraw 外，必须新增拦截：非 3D 模型严禁夹带 `three`、非 `B5` 严禁夹带 `mathjs`、全切片禁止夹带 `papaparse` / `fflate`，常规切片产物保持 $< 2.5\text{ MB}$。

---

## 二、战略裁剪提醒（严禁过度开发）
按云端卷一第二节裁定，V2.0 **明确不做**：
* ❌ 手机竖屏端响应式重构；
* ❌ WCAG 读屏器 / Scenery Parallel DOM 适配；
* ❌ 网页端教研包图形化富文本编辑器（仅保留 V1.0 轻量 `TeachingPackDrawer` 零退化）；
* ❌ 真实课堂 5–10 节试讲流程卡点。

---

## 三、V2.0 六大施工轮次规划（`V2-W1` ~ `V2-W6`）

> **交接节奏**：延续高产出大轮次模式——写手每完整跑通 1 个 `V2-W*` 大轮次的全部源码、单测、构建与 E2E 门禁后，更新 [WRITER_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_HANDOFF_LOG.md) 交由总控验收并提交推送 `origin/main`；轮次内部则以 1 个支柱或 3–4 个模型为小步进行本地测试防债。

---

### `V2-W1`：物理内核升维 + 交互底座 + 分析/资产库 + CI 双线部署
> **详细规格对照**：`01_ARCHITECTURE_AND_CORE_PLATFORM.md` 第三、四、五、八、九章  
> **首轮开工重点**：把 V1.0 底座升级成能支撑 43 单元与自由建模的 V2.0 平台。

1. **`packages/physics-core` 七大核心能力落地**（100% 零 DOM，覆盖全量 Vitest 单测）：
   * `units/scaleContext.ts`（微观/天体无量纲缩放）；
   * `hybrid/hybridAutomaton.ts`（离散模式切换 + `bisectEvent` + 防 Zeno 上限 8 + 零速滞回）；
   * `constraints/udwadiaKalaba.ts`（显式最小拘束方程 + Baumgarte 稳定 + SVD/Tikhonov 伪逆，直接输出精确约束反力 $\mathbf{F}_c$）；
   * `inverse/rootFinder.ts`（Bracketing + Brent 混合反解器）；
   * `fields/{waveFDTD2D,marchingSquares}.ts` & `particles/spatialHash2D.ts` & `optics/wavelengthToRgb.ts` & `random/seededPrng.ts`（Mulberry32 + Box-Muller）；
   * `circuits/nonlinearMna.ts`（动态拓扑预检 + 孤岛泄放 + 列主元 LU + 电容/电感梯形伴随 + Newton-Raphson 非线性小灯泡/二极管）；
   * `verification/auditor.ts`（全能量与动量预算残差审计）。
2. **`packages/sim-sdk` V2 协议**：
   * 扩展 `SimulationPluginV2`、`ControlHandle`、`ForceVectorItem`、`ReferenceFrameSpec`、`SceneDSL` 基础契约、`ThreeSceneBridge`，保持对 V1.0 全部 7 个插件 100% 向后兼容。
3. **`packages/analysis-lab`（MIT: `papaparse` + 自研算法）**：
   * `PhaseXYPlotter`（Canvas 2D + SVG，非单调相图/循环、时间色带、格林公式面积 $\oint y\,dx$、悬停联动画布）；
   * `csvFitting.ts`（兼容 Phyphox 分号/制表符与 Tracker 多行头 CSV + 线性/多项式/指数/LM 阻尼简谐拟合 + $R^2$）；
   * `fftAnalyzer.ts`（Cooley-Tukey Radix-2 FFT + Hann/矩形窗 + 前 3 峰标定）；
   * `sweepRunner.ts`（Web Worker 并发参数扫描，输出 $Y-X$ 曲线与点击回放）。
4. **`packages/workspace-vault`（MIT: `fflate`）**：
   * IndexedDB + FileSystemAccess API 本地目录绑定 + `fflate` ZIP 全库备份导入；
   * **打通 V1.0 断点**：自动扫描并合并 `content/presets/**/*.json` 进工作台；
   * **`Ctrl+K` 全局命令与资产秒搜面板**。
5. **`apps/web` 交互与部署升级**：
   * 接通 `ViewportController`（光标锚点缩放 $0.1\times\text{–}20\times$、平移、居中）；
   * 落地虚拟尺规工具箱（直尺、量角器、三点定圆圆规）、Auto-FBD 受力正交分解叠加层、参考系锁定相机、`CommandStack`（`Ctrl+Z/Shift+Z` 50 步撤销重做）；
   * 落地懒加载 `ThreeStage.tsx`（纯 Vanilla `three`，仅 `three3d` 模型加载）及 `VITE_BASE_PATH` 子路径兼容。
6. **CI/CD 双线流水线**：
   * 落地 `.github/workflows/ci.yml`（typecheck + 静态扫描 + test + verify:packs + build + 首屏 gzip `< 350 KB` 与 chunk 隔离校验 + Playwright 冒烟）与 `deploy-pages.yml`（支持 GitHub Pages `/PhysForge/` + Cloudflare Pages `/`）。
7. **`V2-W1` 验收门禁**：V1.0 既有 46 测试与 20 题教研验算 100% 全绿；`physics-core` 与 `analysis-lab` 新增单测全绿；Playwright 实测光标缩放平移、尺规测量、`PhaseXYPlotter`、CSV 拟合与 `Ctrl+K` 全通、`consoleErrors = []`。

---

### `V2-W2`：导出工坊（`export-studio`）+ 五大自由建模器（`B1–B5`）
> **详细规格对照**：`01` 第六章 & `02` 第一章

1. **`packages/export-studio` & `apps/singlefile-exporter` 升级**：
   * 定义 `DiagramIR` 与三大后端：`renderToSvg`（黑白试卷矢量图，公式转内联 SVG 路径防缺字）、`renderToPng`（2x/4x/600 DPI 剪贴板）、`renderToTikz`（LaTeX TikZ 代码）；
   * `mediaRecorder.ts`（Canvas 60fps `WebM` 录屏 + 多帧叠加频闪合成长图）；
   * 升级 `export.mjs` 支持 `--preset-file=<path>` 并增加 `three`/`mathjs`/`papaparse`/`fflate` 泄漏拦截。
2. **五大自由建模器（均接通直操手柄、`DiagramIR`、SceneDSL 序列化与 Vault 保存）**：
   * **`B1`** `builder-composite-em-field`（升级并兼容 `em-bounded-magnetic-field`）；
   * **`B2`** `builder-circuit-mna`（升级并兼容 `circuit-dc-capacitor-mna`）；
   * **`B3`** `builder-optics-ray`（升级并兼容 `optics-ray-studio`）；
   * **`B4`** `builder-mechanics-lab`（升级并兼容 `mech-free-sandbox`，默认 `Udwadia-Kalaba` + 懒加载 `Rapier2D`）；
   * **`B5`** `builder-custom-ode-lab`（按需懒加载 `mathjs >= 15.2.0` 白名单 AST + 拉格朗日模板 + Worker 50 步扫参）。
3. **`V2-W2` 验收门禁**：`B1–B5` 单测与 V1.0 兼容回归全绿；`mathjs` 与 `rapier` 严禁进入首屏主 chunk；Playwright 实测导出 SVG/TikZ/WebM 录屏/自定义单文件 HTML 均非空可运行。

---

### `V2-W3`：力学与天体核心母题全矩阵（`M01–M11`，11 单元）
> **详细规格对照**：`02` 第二章  
> **内部小步节奏**：`[M01–M04]` → `[M05(升级)–M08]` → `[M09–M11]`

* 交付 `mech-kinematics-chase`、`mech-dynamic-equilibrium`、`mech-constrained-velocity`、`mech-projectile-coupling`、`mech-block-conveyor`（V2 升级）、`mech-vertical-circular`、`mech-conical-turntable`、`mech-spring-separation`、`mech-collision-recoil`、`astro-orbital-mechanics`、`mech-shm-resonance`。
* **统一交付底线**：每单元齐全 `PHYSICS_SPEC.md` + 零 DOM `engine.ts` + `engine.test.ts` + `plugin.ts` + `presets.ts` + `buildDiagramIR` + `Auto-FBD`。
* **`V2-W3` 验收门禁**：11 单元守恒/解析/脱轨/50 周期辛积分单测全绿，Playwright 遍历全部力学模型 Canvas 非空与试卷 SVG 导出通过。

---

### `V2-W4`：电磁学全矩阵与 3D 空间场（`E01–E10`，10 单元）
> **详细规格对照**：`02` 第三章  
> **内部小步节奏**：`[E01–E04(升级)]` → `[E05–E08]` → `[E09–E10]`

* 交付 `em-electrostatic-field`、`em-capacitor-millikan`、`em-ac-field-oscilloscope`、`em-induction-double-rod`（V2 升级）、`em-wireframe-rotation`、`em-eddy-vortex-field`、`em-ac-generator-rms`、`em-transformer-grid`、`em-lc-rlc-oscillation`、`em-3d-magnetic-fields`（懒加载 Vanilla `three`）。
* **`V2-W4` 验收门禁**：10 单元全绿；Playwright 验证首屏未加载 `three` chunk、切入 `E10` 后 3D 渲染正常、切离后 WebGL 资源干净释放。

---

### `V2-W5`：波动光学、热学微观与近代物理（`W01–W02, O01, T01–T02, N01–N03`，8 单元）
> **详细规格对照**：`03` 第一、二、三章  
> **内部小步节奏**：`[W01(升级), W02, O01]` → `[T01, T02]` → `[N01, N02, N03]`

* 交付 `wave-vibration-coupling`（升级多解性/驻波/马赫锥）、`wave-2d-ripple-fdtd`（CFL 钳位 + 海绵层）、`optics-wave-interference`、`thermo-piston-gas-laws`、`thermo-cycles-kinetic-md`（空间哈希硬球 MD + 布朗运动）、`modern-photoelectric-compton`、`modern-rutherford-bohr`、`modern-nuclear-recoil-decay`（seeded PRNG）。
* **`V2-W5` 验收门禁**：8 单元全绿（FDTD 2000 步零发散、硬球 MD 动能漂移 $<10^{-8}$、PRNG 可复现性断言通过）。

---

### `V2-W6`：STSE 前沿、真误差实验、强基竞赛与 `ai-copilot` 闭环封板
> **详细规格对照**：`01` 第七章 & `03` 第四、五、六、七章  
> **内部小步节奏**：`[S01–S04]` → `[X01–X02]` → `[C01–C03]` → `[packages/ai-copilot + 终版封板]`

1. **STSE 4 单元**：`stse-tokamak-magnetic-mirror`（3D 无散磁镜 $\nabla\cdot\mathbf{B}=0$）、`stse-em-devices-suite`（6 器件集成）、`stse-em-launch-regen-brake`、`stse-gravity-assist-rendezvous`。
2. **真误差高考实验 2 单元**：`exp-mechanics-error-lab`、`exp-electrical-error-lab`（Phyphox CSV 叠加拟合 + 卡尺/千分尺 + 非理想 MNA 系统误差）。
3. **强基竞赛 3 单元**：`comp-rigid-rolling-slip`、`comp-chaos-normal-coriolis`、`comp-relativity-quantum-tunneling`（Crank-Nicolson TDSE + 三对角托马斯算法，幺正漂移 $<10^{-10}$）。
4. **`packages/ai-copilot` 落地与闭环**：`SceneDSL` 3 层路由（专题 → B1–B4 → B5）+ `Generate-then-Refine` 3 轮自修正 + `scripts/verify-scenes.ts`（`pnpm verify:scenes`）+ 网页可选 BYOK 直连入口 + Release 单文件合集打包流水线。
5. **V2.0 终版 6 大发布门禁**：全部 **43 单元**入表；`typecheck` + 静态安全扫描 + `test`（$\ge 200$ 用例全绿）+ `verify:packs` + `verify:scenes` + `build`（首屏 gzip $< 350\text{ KB}$，独立异步 chunk 隔离）+ Playwright 多模态导出（SVG/TikZ/WebM/单文件 HTML/`Ctrl+K`/Vault）+ GitHub Actions CI 全绿。

---

## 四、写手每轮提交 Checklist（`V2-W1` ~ `V2-W6` 通用）
- [ ] 是否遵守物理引擎零 DOM、零 `Math.random()`、零 `eval`/`new Function`、`ScaleContext` 跨尺度归一化？
- [ ] 是否保留 V1.0 已有模型别名与预设，保证既有 46 测试与 20 题教研验算持续全绿？
- [ ] 新增包（`mathjs >= 15.2.0`、`three`、`@dimforge/rapier2d-compat`）是否严格拆入异步懒加载 chunk，且未引入 `@react-three/fiber` 或 GPL 代码？
- [ ] 是否验证过 `VITE_BASE_PATH=/PhysForge/` 与 `/` 双路径下的静态资产离线加载？
- [ ] 最后一次代码编辑后是否完整跑通 `pnpm typecheck && pnpm test && pnpm verify:packs && pnpm build` 与对应 Playwright 实机验证，并仅更新了 [WRITER_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_HANDOFF_LOG.md)？
