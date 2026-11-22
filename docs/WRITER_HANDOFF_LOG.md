# PhysForge - 写手跨会话交接日志（Writer Handoff Log）

> **声明**：本文件仅作**写手角色（Writer）跨会话状态交接日志**，不替代项目权威规则（[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md)）或总控施工方案（[WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_CONSTRUCTION_PLAN.md)），也不得写入或修改 [ARCHITECT_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/ARCHITECT_HANDOFF_LOG.md)。  
> **滚动上限**：不超过 **250 行 / 15 KB / 5 条会话增量**；超限写入时保留顶部当前权威快照、最近 1–2 轮详细增量及所有未闭环事项，将更早增量压缩为 3–8 行历史归档摘要。

---

## 当前权威状态快照（2026-11-22 16:30）

* **Git 分支与基线**：
  * 本地仓库位于 `main` 分支（`HEAD` 尚无提交，未执行 `git commit` / `git push`），已绑定 `origin = https://github.com/riyuewuxing/PhysForge.git`。
* **权威参考文档**：
  * 仓库宪法：[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md) ｜ 写手施工方案：[docs/WRITER_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_CONSTRUCTION_PLAN.md)
* **已核实依赖与运行环境**：
  * `Node v24.18.0`、`pnpm 11.24.0`（`pnpm-workspace.yaml` 已配置 `allowBuilds: { esbuild: true }`）。
  * 核心前端栈：`vite@6.4.6`、`@vitejs/plugin-react@5.2.0`、`react@19.3.1`、`react-dom@19.3.1`、`tailwindcss@4.3.5`、`zustand@5.1.0`、`uplot@1.6.32`、`katex@0.19.1`、`@excalidraw/excalidraw@0.18.1`、`vite-plugin-pwa@2.0.0`、`vite-plugin-singlefile@2.3.4`、`playwright@1.65.1`。
  * 兼容预检备忘：`@excalidraw/excalidraw@0.18.1` 原生支持 `React 19`，仅传递依赖 `@radix-ui/react-tabs@1.0.2` 有 peer 范围警告；实机运行全链路零报错。`vite` 使用 `@vitejs/plugin-react@5.2.0`（6.x 要求 Vite 8）。
* **当前施工状态**：**Wave 1（Module A + Module B + Module C）已全量竣工并完成端到端门禁自检**，**等待总控一次性验收**（验收通过后再启动 Wave 2）。
* **最后一次代码编辑后的实测门禁结果**：
  * `pnpm typecheck`：退出码 `0`（6/6 子包全部通过，`strict: true` + `noUncheckedIndexedAccess: true`，零 `@ts-ignore` / `as any`）。
  * `pnpm test`：退出码 `0`（7 个测试文件、36/36 条用例全绿：`physics-core` 12、`sim-sdk` 3、`pedagogy-schema` 3、`em-bounded-magnetic-field` 5、`wave-vibration-coupling` 5、`em-induction-double-rod` 4、`mech-block-conveyor` 4）。
  * `pnpm build`：退出码 `0`（`packages/*/dist` 已排除 `*.test.ts`；`apps/web/dist` 生成 PWA SW 预缓存 441 entries 与本地 `/excalidraw-assets/`；`apps/singlefile-exporter/dist/em-bounded-magnetic-field.html` 2007.5 KB）。
  * `pnpm export:singlefile -- --model=mech-block-conveyor`：退出码 `0`（生成 `mech-block-conveyor.html` 2002.6 KB，自动校验零外网 CDN、零无关模型与零 Excalidraw）。
  * **Playwright 全链路实机验收**：退出码 `0`（4 大模型切换+运行+Canvas 绘制、uPlot 双向时间轴回放、POE 遮罩切换、双主题与大屏 18px/30 处热区 ≥44px、Excalidraw 离线批注与 `physforge-mech-block-conveyor-annotated.png` 导出、2 份单文件 HTML 通过 `file://` 打开运行；`consoleErrors: []`、`pageErrors: []`、`externalRequests: []`）。
* **下一优先级动作**：总控验收 Wave 1；通过后启动 **Wave 2（Module D 光学/Rapier 沙箱/MNA 电路 + Module E 教研防幻觉闭环 + Module F 开源门面）**。

---

## 会话增量记录

### [2026-11-22 16:30 +08:00] 完成 Wave 1（Module A–C）全量施工与全链路验收

#### 1. Module A（收口与预检）
* 为 `packages/{physics-core,sim-sdk,pedagogy-schema}` 增设 `tsconfig.build.json` 排除 `**/*.test.ts`，验证 `dist/` 产物纯净。
* 为 `stepRK4`、`stepVelocityVerlet`、`tryStepRK45` 增补导数/加速度数组长度显式校验；为 `bisectEvent` 增补 `biasEndpoint` 单向防跨界震荡选项；为 `sim-sdk` 增加 `AnyParamFieldSpec` 泛型擦除分支（保留 `resolvePluginParams` 推断能力）。

#### 2. Module B（`apps/web` + PWA + `apps/singlefile-exporter`）
* `apps/web`：[vite.config.ts](file:///d:/project%20code/44-PhysForge/apps/web/vite.config.ts) 实现 `/excalidraw-assets/` 本地中间件与构建拷贝及 `VitePWA`；[SimulationStage.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/SimulationStage.tsx) 实现 240Hz 固定步长 `rAF + ref` 引擎、Strobe 频闪、POE 遮罩、`uPlot` 双通道双向回放；[ExcalidrawOverlay.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/ExcalidrawOverlay.tsx) 实现懒加载透明板书与合成 PNG 导出；[LeftCatalogSidebar.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/LeftCatalogSidebar.tsx) 与 [RightControlPanel.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/RightControlPanel.tsx) 实现人教版/课标筛选、预设速切、KaTeX 实时公式代入、能量柱状图及大屏双主题热区。
* `apps/singlefile-exporter`：[export.mjs](file:///d:/project%20code/44-PhysForge/apps/singlefile-exporter/export.mjs) 与 [SingleFileApp.tsx](file:///d:/project%20code/44-PhysForge/apps/singlefile-exporter/src/SingleFileApp.tsx) 通过 `@physforge/target-plugin` 实现单模型按需打包与外网/体积安全静态检查。

#### 3. Module C（4 大 Tier-0 旗舰物理模型）
* [em-bounded-magnetic-field](file:///d:/project%20code/44-PhysForge/simulations/em-bounded-magnetic-field/plugin.ts)（5 预设，5 单测）：Boris + 单向 `bisectEvent`，含磁聚焦/放缩/旋转/平移圆与复合场配速法。
* [wave-vibration-coupling](file:///d:/project%20code/44-PhysForge/simulations/wave-vibration-coupling/plugin.ts)（5 预设，5 单测）：横波与质点 $y-t$ 双图联动、上下坡微平移法、双波源干涉与多普勒效应。
* [em-induction-double-rod](file:///d:/project%20code/44-PhysForge/simulations/em-induction-double-rod/plugin.ts)（4 预设，4 单测）：双杆动量守恒、单杆电阻/电容/电源及摩擦停驻捕获。
* [mech-block-conveyor](file:///d:/project%20code/44-PhysForge/simulations/mech-block-conveyor/plugin.ts)（4 预设，4 单测）：传送带与板块模型 `bisectEvent` 共速突变捕获、相对划痕 $\Delta x_{\text{rel}}$ 与生热守恒。
* 注册表：[simulations/registry.ts](file:///d:/project%20code/44-PhysForge/simulations/registry.ts)。

---

### [2026-11-22 15:55 +08:00] 历史归档摘要（Phase 0 冷启动与内核基建）

* 完成 Git `main` 初始化、工程规范/文档落盘（`LICENSE`、`AGENTS.md`、`docs/{BLUEPRINT,CURRICULUM_MAP,PEDAGOGY_GUIDE}.md`）及 `@physforge/{sim-sdk,pedagogy-schema,physics-core}` 核心包开发，18 条内核与契约单元测试全绿并通过总控验收。
