# PhysForge（智理视界）V2.0 竣工总结与架构审阅报告（提交线上原方案 AI 审查）

> **文档用途**：本文档与配套清单 [PHYSFORGE_V2_UNITS_AND_GATES.md](file:///d:/project%20code/44-PhysForge/docs/PHYSFORGE_V2_UNITS_AND_GATES.md) 专为上传给提出原方案的线上 AI 进行跨端审查、对照验收与演进诊断而编写。全文所有提交哈希、版本号、文件结构、覆盖统计与测试/体积数据均基于 `main@c4dbcfa` 之上当前工作区 **`V2.0.1`（Wave 0 封口轮）** 的真实源码与实跑结果。

---

## 一、交付总览与版本里程碑

* **仓库地址**：`https://github.com/riyuewuxing/PhysForge`（MIT 协议，默认分支 `main`）
* **当前版本与基线**：**PhysForge `V2.0.1`（工作区基于 `main@c4dbcfa` 完成 Wave 0 补齐，待提交封板）**，共覆盖 **43 个物理仿真单元 + 4 个 V1 兼容别名**。
* **V2.0 → V2.0.1 交付轨迹**：
  1. `V2-W1` (`61cad64`)：`packages/physics-core` V2 底座、`packages/sim-sdk` V2、`@physforge/analysis-lab`、`@physforge/workspace-vault`、交互/3D 舞台（纯 Vanilla `three`）与 CI/GitHub Pages 双路径部署；
  2. `V2-W2` (`3e86d3b`)：`@physforge/export-studio`、`LEGACY_MODEL_ALIASES`、`--preset-file` 与五大自由建模器 `B1–B5`（含按需懒加载 `mathjs@^15.2.0` 白名单 AST 沙箱）；
  3. `V2-W3` (`7c252a7`)：力学与天体力学全矩阵 `M01–M11`（11 单元）；
  4. `V2-W4` (`e2d4bb6`)：`@physforge/simulations/catalog` 首屏按需拆包重构 + 电磁学与 3D 空间场 `E01–E10`（10 单元）；
  5. `V2-W5` (`3d7f8f8`)：波动光学、热学微观与近代物理 `W01–W02, O01, T01–T02, N01–N03`（8 单元）；
  6. `V2-W6` (`c4dbcfa`)：新高考 STSE `S01–S04`、真误差实验 `X01–X02`、强基竞赛 `C01–C03`（9 单元）+ `@physforge/ai-copilot` + `verify:scenes` / `verify:vault` / `export:release` 与 43 单元终版封板；
  7. **`V2.0.1`（当前工作区待提交）**：补齐 `M07/M08/C01` Auto-FBD、`X01/X02/C01/S04/C02` 手柄与参考系、`B2` 电势着色/电流光珠/短路脉冲告警、`E04` 零电阻电容模式、`content/presets/` 扩至 10 份高考真题、`byokClient.ts` 平衡 JSON 提取与超时/CORS 诊断、`mediaRecorder.ts` WebM 收尾加固及 `.github/workflows/ci.yml` `/PhysForge/` E2E 冒烟 Job。

---

## 二、技术栈与 Monorepo 实际落地结构

### 1. 运行时与依赖实情
* **工具链**：`Node v24.18.0`、`pnpm` Monorepo、`TypeScript`（`strict` 严格模式）、`Vitest 5.1.1`、`Vite 6.4.6`、`React 19.3.1`、`Zustand 5.1.0`、`Tailwind CSS 4.3.5`、`Playwright`。
* **核心三方依赖（全部 MIT / Apache-2.0，零 GPL 与零外网 CDN）**：
  * `zod@^4.6.7`（Schema 与 `SceneDSL` 校验）
  * `three@^0.187.0`（纯命令式 Vanilla `three` + `OrbitControls`，异步懒加载）
  * `@dimforge/rapier2d-compat@^0.21.0`（Apache-2.0 刚体 WASM，异步懒加载）
  * `mathjs@^15.2.0`（仅 `B5` 异步动态 `import()`，规避 `< 15.2.0` AST 逃逸 CVE）
  * `@excalidraw/excalidraw@^0.18.1`（本地化 `/excalidraw-assets/` 离线白板层）
  * `papaparse@^5.7.1`（`analysis-lab` CSV 解析）、`fflate@^0.8.3`（`workspace-vault` ZIP 打包）、`uplot@^1.6.32`、`katex@^0.19.1`。

### 2. 七大核心底座包与两个应用端

| 工作区包 / 目录 | 源文件数 | 核心已落地能力 |
| :--- | :---: | :--- |
| **`packages/physics-core/`** | 19 | 100% 零 DOM/Canvas/React、零 `Math.random()`：<br>• `units/scaleContext.ts`（微观/天体无量纲尺度归算）<br>• `integrators/`（RK4、Velocity-Verlet、Boris Pusher、Dormand-Prince RK45）<br>• `hybrid/hybridAutomaton.ts`（离散模态机 + `bisectEvent` + Zeno 上限）<br>• `constraints/udwadiaKalaba.ts`（解析约束动力学直接求拘束反力）<br>• `inverse/rootFinder.ts`（Bracketing + Brent 混合反解）<br>• `fields/{waveFDTD2D,marchingSquares}.ts`、`particles/spatialHash2D.ts`、`optics/wavelengthToRgb.ts`、`random/seededPrng.ts`（Mulberry32 + Box-Muller）、`circuits/nonlinearMna.ts`、`verification/auditor.ts` |
| **`packages/sim-sdk/`** | 2 | `SimulationPlugin` V1 与 `SimulationPluginV2`（`getControlHandles`、`getForceVectors`、`referenceFrames`、`exportDiagramIR`、`sceneSerializer`、`renderMode`、`mountThreeScene`）100% 向后兼容 |
| **`packages/analysis-lab/`** | 6 | `fftAnalyzer.ts`（Radix-2 FFT + Hann/矩形窗 + Top-3 峰）、`csvFitting.ts`（兼容 Phyphox `;`/`\t`/欧式逗号小数与 Tracker 多行头；线性/多项式/指数/LM 阻尼简谐拟合）、`sweepRunner.ts`（Worker 并发扫参）、`PhaseXYPlotter.tsx`（相图/循环/格林公式环路面积） |
| **`packages/workspace-vault/`** | 4 | IndexedDB + FileSystemAccess 目录同步 + `fflate` ZIP 全库导入导出 + 自动合入 `content/presets/*.json` + `globalSearch.ts` 模糊加权检索 |
| **`packages/export-studio/`** | 6 | `DiagramIR` -> 黑白试卷矢量 `SVG`（`svgRenderer.ts`）、LaTeX `TikZ`（`tikzRenderer.ts`）、`2x/4x/600DPI PNG`（`pngRenderer.ts`）、`60fps WebM` 录屏与 12 帧频闪长图（`mediaRecorder.ts`） |
| **`packages/ai-copilot/`** | 6 | `SceneDSLSchema`（`schemaVersion: '2.0'` + 兼容 V1 预设归一化）、三层离线意图路由（`router.ts`：32+ 专题 / B1–B4 / B5 万能兜底）、最多 3 轮无头仿真 `Generate-then-Refine` 自修正闭环（`refiner.ts`）、可选内存 BYOK 客户端（`byokClient.ts`） |
| **`packages/pedagogy-schema/`** | 2 | Zod 教研导学案与定量变式题校验 Schema（兼容 V1 6 套 20 题防幻觉校验） |
| **`simulations/`** | 43 单元 | 全部具备 `PHYSICS_SPEC.md`、`engine.ts`、`engine.test.ts`、`plugin.ts`，经 `catalog.ts` 按需动态 `import()`，经 `registry.ts` 维护全量清单与 4 个 V1 别名 |
| **`apps/web/`** | — | 三栏工作台：`ViewportController`（`0.1x–20x` 光标锚点缩放/平移/复位）、`CommandStack`（50 步撤销重做）、虚拟尺规/量角器/三点圆规、`AutoFbdOverlay`、懒加载 `ThreeStage.tsx` / `AnalysisLabDrawer.tsx` / `CommandPalette.tsx` (`Ctrl+K`) / `ExportStudioDrawer.tsx` / `AiCopilotDrawer.tsx` / `ExcalidrawOverlay.tsx`，双路径 `VITE_BASE_PATH` 兼容与 VitePWA 离线缓存 |
| **`apps/singlefile-exporter/`** | — | `export.mjs` 支持 `--model=<id>`、`--preset-file=<path>`、V1/V2 别名映射，内置防泄漏扫描（严禁非 3D 打入 `three`、非 B5 打入 `mathjs`、严禁 `papaparse`/`fflate`）；配合 `scripts/export-release-bundle.mjs --all` 批量产出 8 件旗舰单文件 HTML |

---

## 三、与云端原三卷方案的对齐情况及总控工程纠偏对照

在完全继承云端三卷 `01~03` 的全部架构与 43 单元目标前提下，工程落地阶段实施了 **7 项关键调优与纠偏**，现提请线上 AI 核查其合理性：

1. **统一迭代编号（`V2-W1 ~ V2-W6`）**：解决原卷一与卷三对 `Wave 5/6` 范围描述冲突的问题，按基建 → 导出/自由建模器 → 力学 → 电磁 → 光热原 → STSE/实验/竞赛/AI 收官顺序平稳交付。
2. **V1.0 兼容防断链（`LEGACY_MODEL_ALIASES`）**：`B1–B4` 在 `em-bounded-magnetic-field`、`circuit-dc-capacitor-mna`、`optics-ray-studio`、`mech-free-sandbox` 基础上升级，`registry.ts` 与 `catalog.ts` 同时解析新旧两套 ID，确保 V1.0 的 6 份教研包 20 题零改动全通过。
3. **`@physforge/simulations/catalog` 异步分包架构重构（`V2-W4` 关键发现）**：V2-W3 落地 19 个模型时主入口 gzip 曾涨至 `304.82 KB`。V2-W4 将侧边栏元数据与重型插件代码剥离：首屏只导入轻量 `simulationCatalog` 元数据数组，选中模型后再通过 `loadSimulationById()` 动态 `import()` 对应 `./*/plugin.js`，从而在扩至 **43 个模型**后主入口 gzip 反而回落到 **`244.82 KB`（Node zlib）/ `250.70 kB`（Vite）**。
4. **`mathjs >= 15.2.0` CVE 隔离**：显式绑定 `mathjs@^15.2.0` 仅在 `B5 (builder-custom-ode-lab)` 中按需懒加载，并配独立白名单 AST 编译器与最大节点/步数限制（含恶意表达式与原型链污染拦截单测）。
5. **纯 Vanilla `three` 替代 `@react-three/fiber`**：由于主仓使用 `React 19.3.1`，采用命令式 Vanilla `three@^0.187.0` + `OrbitControls` 实现 `ThreeStage.tsx`，并在 `S01`/`E10` 切出时显式调用 `dispose()` 与 `forceContextLoss()` 释放显存。
6. **GitHub Pages 子路径资源修复**：重构 `apps/web/vite.config.ts`、`main.tsx` 的 `EXCALIDRAW_ASSET_PATH` 与 `index.html`/PWA manifest 为 `BASE_URL` 相对路径，消除子路径部署 `/PhysForge/` 下的 `/excalidraw-assets/` 404。
7. **战略范围裁剪严格执行**：按原卷一约定，未开发手机竖屏端适配、WCAG/Parallel DOM、网页端教研包富文本编辑器与商业 SaaS 后台。

---

## 四、最新实测门禁与性能基准（`V2.0.1` 工作区最后一次改动后实跑）

* **静态合规扫描**：全仓（`packages/`, `simulations/`, `apps/`, `scripts/` 非构建目录）零 `@ts-ignore`、`@ts-expect-error`、`as any`、`eslint-disable`、`.skip(`、`.only(`、`Math.random(`、`new Function(` 及非白名单 `eval(`（仅 `builder-custom-ode-lab/engine.test.ts:22` 含恶意拦截测试字符串 `'eval("1+1")'`），`git diff --check` 退出码 `0`。
* **全仓类型检查 (`tsc --noEmit`)**：退出码 `0`（10/10 工作区包 + `scripts/tsconfig.json` 全过）。
* **全仓单测 (`vitest run`)**：退出码 `0`，**60 个测试文件 / 240 条用例 100% 通过**（含 `catalog.test.ts` 对全部 43 单元执行 `createInitialState` -> 5 步演进 -> 有限观测量 -> 不变量 -> `exportDiagramIR` 回归，以及新增 `byokClient.test.ts`、`mediaRecorder.test.ts`、`circuit-dc-capacitor-mna/plugin.test.ts` 等）。
* **三大内容与资产门禁**：
  * `pnpm verify:packs`：6 套教研包、20 道变式题全部通过 Zod + 无头物理核对；
  * `pnpm verify:scenes`：**10 份** `content/presets/*.json`（含新增 6 份 `gaokao-*.json` 高考真题场景）通过 `SceneDSLSchema` + 无头仿真不变量审计；
  * `pnpm verify:vault`：43 单元全局检索、10 份内置场景合并与 `fflate` ZIP 打包/解包往返完全一致（`ZIP = 6080 B`）。
* **生产构建与防泄漏 (`VITE_BASE_PATH=/PhysForge/ vite build apps/web`)**：
  * 主 HTML 入口 `apps/web/dist/assets/index-hxEHlDK-.js`：Node zlib gzip **`228.96 KB`**（Vite 日志 `755.41 kB / gzip 236.57 kB`，远低于 `< 350 KB` 预算）；
  * `MAIN_LEAK_CHECK: CLEAN`（主包零打入 `OrbitControls`、`papaparse`、`rapier_wasm2d`、`@excalidraw/excalidraw`、`physforge-workspace-vault`、`mathjs`）；
  * PWA 预缓存 `548 entries (32810.94 KiB)`；`export.mjs --model=em-bounded-magnetic-field` 产物 **`2011.5 KB`**。
* **Playwright 子路径与导出端到端 (`scripts/e2e-subpath-and-export.mjs`)**：
  * 在 `/PhysForge/` 挂载路径下（根路径 `/` 返回 404 防泄漏）使用本机 **Edge (`msedge.exe`)** 实测全通：Canvas 直接 WebM（`43,455 B`，EBML 魔数校验通过）、频闪合成 PNG（`48,585 B`）、ExportStudio WebM（`110,224 B`）、SVG/TikZ 下载、`S01` 懒加载 `ThreeStage` 与 `S02` 卸载脱离，全程 `consoleErrors: []`, `pageErrors: []`, `failed404: []`, `externalRequests: []`。
  * **注记**：同脚本在本机 `chrome.exe` 无头模式下 `directRecorderCheck` 的 `video/webm;codecs=vp8` 录得 `0` 字节（需盯 CI `ubuntu-latest` Chromium 实跑）。

---

## 五、主动披露的现存边界与请线上 AI 重点审查的 6 个问题

为避免审查盲区，以下实情不作粉饰，请线上 AI 从**物理完备性、教学产品体验、工程后续演进**三方面重点把关：

1. **V2 交互钩子覆写统计（`V2.0.1` 补齐后最新实查）**：
   * 实际代码扫描显示：`43/43` 单元均完整具备 `PHYSICS_SPEC.md`、`engine.ts`、`engine.test.ts`、`exportDiagramIR` 与 `sceneSerializer`；`getControlHandles` 已升至 **`34/43`**、`getForceVectors`（Auto-FBD）已升至 **`16/43`**、`referenceFrames` 已升至 **`10/43`**（`C02` 因现行 `ReferenceFrameSpec` 仅支持原点/速度平移不支持旋转变换，旋转圆盘仍保持双轨迹并列展示）。
2. **深度教研导学案（`content/teaching-packs/`）与预设库覆盖密度**：
   * 目前仓库自带 `6` 份教研包（20 题）与 **`10` 份** `content/presets/*.json`，其余新增单元仍主要依靠各自 `plugin.ts` 内置的 `3–4` 个教学 `presets`。
3. **首屏默认模型的静态耦合**：
   * `useClassroomStore.ts` 仍静态导入默认首模型 `em-bounded-magnetic-field`（导致 Vite 1 条提示；V3.0 Wave 1 已规划改为首屏异步按需加载以继续压低主包）。
4. **AI Copilot 的在线 BYOK 真实大模型联调**：
   * `byokClient.ts` 已在 `V2.0.1` 补齐 Markdown 围栏/引号平衡 JSON 提取与超时/CORS/HTTP 错误分类单测（8 测全过），但仍未接真实商用 API Key 跑实网 Prompt 联调。
5. **CI Chromium 无头 WebM 编解码实跑待验证**：
   * `.github/workflows/ci.yml` 已新增 `e2e-subpath-smoke` Job（`/PhysForge/` 子路径 + 导出 + `ThreeStage`），本地 `msedge.exe` 已通过，但 `chrome.exe` 无头录屏 `vp8` 遇到 0 字节现象，需在提交推送后观察 CI Ubuntu Chromium 实际跑况。
6. **后续 V3.0 演进基准已就位**：
   * `V2.0.1` 为 V3.0（Stage/Story/Studio 三态演说平台）的 Wave 0 封口基线；V3.0 规格与施工代码已整理至 `docs/v3-specs/PHYSFORGE_V3_SPATIAL_STAGE_BLUEPRINT.md` 与 `docs/V3_WRITER_CONSTRUCTION_PLAN.md`，待本轮收口审阅后即开启 Wave 1。
