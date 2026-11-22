# PhysForge 架构蓝图（Engineering Blueprint）

> 本文件由顶层方案 [physforge_ai.md](../physforge_ai.md) 提炼为工程实施权威蓝图，原文件只读保留。

## 1. 定位与三大支柱
PhysForge（智理视界）面向中国普通高中物理（《普通高中物理课程标准（2017年版2025年修订）》与人教版 2019 教材体系），构建“理论物理级数值仿真内核 + 教室白板无缝融合 + AI 人机协同循证教研”三端合一开源平台。

1. **理论物理级数值严谨性**：分级辛积分（`VelocityVerlet`）、电磁 `BorisPusher`、`RK4`/`AdaptiveRK45`、精确二分事件捕获 `bisectEvent`（$|\Delta t| \le 10^{-7}\text{ s}$）与 Vitest 守恒律回归校验。
2. **一线教室大屏真实可用性**：100% 离线优先、高对比大字号主题（$\ge 18\text{px}$ / 热区 $\ge 44\text{px}$）、POE 遮罩探究、Excalidraw 透明板书批注、`uPlot` 双向联动示波器与单文件 HTML 切片导出。
3. **AI 原生插件化长期演进**：强类型 `SimulationPlugin` 契约与 Zod `pedagogy-schema` 教研防幻觉自动化验算闭环（`pnpm verify:packs`）。

## 2. 已落地工具链与核心依赖版本
- **运行时与包管理**：`Node v24.18.0`、`pnpm 11.24.0`（Workspace Monorepo）
- **语言与测试**：`TypeScript 7.0.2`（`strict: true` + `noUncheckedIndexedAccess: true`）、`Vitest 5.1.1`、`Zod 4.6.7`、`Playwright 1.65.1`
- **应用层（`apps/web`）**：`Vite 6.4.6`、`@vitejs/plugin-react 5.2.0`、`React 19.3.1`、`Tailwind CSS 4.3.5`、`Zustand 5.1.0`、`uPlot 1.6.32`、`KaTeX 0.19.1`、`@excalidraw/excalidraw 0.18.1`（MIT，完全本地静态资源）、`vite-plugin-pwa 2.0.0`、`vite-plugin-singlefile 2.3.4`
- **专业生态集成（Wave 2 已落地）**：
  - 几何光学：`simulations/optics-ray-studio/`（对齐 `ricktu288/ray-optics` Apache-2.0 场景抽象的零重依赖纯 TS 光线追迹引擎，已在 `THIRD_PARTY_NOTICES.md` 声明）
  - 自由力学沙箱：`simulations/mech-free-sandbox/`（按需动态懒加载 `@dimforge/rapier2d-compat 0.21.0` Apache-2.0 WASM，严禁进入首屏主 chunk 或其他单文件切片）
  - 电路求解器：`simulations/circuit-dc-capacitor-mna/`（100% 零 GPL，基于公开 MNA 改进节点分析法纯 TS 从零自研）

## 3. Monorepo 目录结构
```text
physforge/
├── AGENTS.md                         # 仓库工程与物理严谨性宪法
├── LICENSE                           # MIT 许可证
├── THIRD_PARTY_NOTICES.md            # 第三方开源组件许可声明
├── README.md / CONTRIBUTING.md       # 开源门面与教师无代码贡献指南
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── docs/
│   ├── BLUEPRINT.md                  # 架构蓝图（本文件）
│   ├── CURRICULUM_MAP.md             # 课标与人教版教材章节映射
│   └── PEDAGOGY_GUIDE.md             # 四维表征、POE 与教室大屏规范
├── packages/
│   ├── physics-core/                 # 零 UI 依赖纯 TS 物理计算内核
│   ├── sim-sdk/                      # SimulationPlugin 统一插件协议
│   └── pedagogy-schema/              # Zod 教研包与防幻觉校验契约
├── simulations/                      # 7 个自包含物理模型插件与全局注册表
├── content/
│   ├── presets/                      # 独立预设 JSON 示例
│   └── teaching-packs/               # 经物理内核验算的 POE/变式题/误区 JSON
├── scripts/                          # 教研防幻觉自动验算脚本 (verify:packs)
└── apps/
    ├── web/                          # 主工作台（教室演示壳 + Excalidraw + PWA + 导学案）
    └── singlefile-exporter/          # 单模型独立离线 HTML 切片导出器
```
