# PhysForge 架构蓝图（Engineering Blueprint）

> 本文件由顶层方案 [physforge_ai.md](../physforge_ai.md) 提炼为工程实施权威蓝图，原文件只读保留。

## 1. 定位与三大支柱
PhysForge（智理视界）面向中国普通高中物理（《普通高中物理课程标准（2017年版2025年修订）》与人教版 2019 教材体系），构建“理论物理级数值仿真内核 + 教室白板无缝融合 + AI 人机协同循证教研”三端合一开源平台。

1. **理论物理级数值严谨性**：分级辛积分（`VelocityVerlet`）、电磁 `BorisPusher`、`RK4`/`AdaptiveRK45`、精确二分事件捕获 `bisectEvent`（$|\Delta t| \le 10^{-7}\text{ s}$）与 Vitest 守恒律回归校验。
2. **一线教室大屏真实可用性**：100% 离线优先、高对比大字号主题、POE 遮罩探究、Excalidraw 透明板书批注、`uPlot` 双向联动示波器与单文件 HTML 切片导出。
3. **AI 原生插件化长期演进**：强类型 `SimulationPlugin` 契约与 Zod `pedagogy-schema` 数据防幻觉校验。

## 2. 技术栈与分层复用
- **Monorepo 与构建**：`pnpm` workspace + `Vite 6` + `TypeScript 5.x`（`strict: true`）+ `Vitest`。
- **应用层（Phase 1+）**：`React 19` + `Tailwind CSS v4` + `Zustand` + `uPlot`（MIT）+ `KaTeX`（MIT）+ `@excalidraw/excalidraw`（MIT，完全本地资源）。
- **专业生态集成（Phase 3）**：
  - 几何光学：`ricktu288/ray-optics`（Apache-2.0）封装；
  - 自由力学沙箱：`@dimforge/rapier2d-compat`（Apache-2.0，按需懒加载）；
  - 电路求解器：基于公开 MNA（改进节点分析法）纯 TS 自研（严禁复制 GPL `circuitjs1` 源码）。

## 3. Monorepo 目录结构
```text
physforge/
├── AGENTS.md                         # 仓库工程与物理严谨性宪法
├── LICENSE                           # MIT 许可证
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
├── simulations/                      # 独立自包含仿真模型插件库（Phase 2+）
├── content/                          # 课堂预设 JSON 与教研包（Phase 2+/4）
└── apps/
    ├── web/                          # 主工作台与教室演示壳（Phase 1）
    └── singlefile-exporter/          # 单模型离线 HTML 切片导出器（Phase 1）
```

## 4. 分阶段里程碑
- **Phase 0 (M0)**：仓库初始化、`sim-sdk`、`pedagogy-schema`、`physics-core` 与全部数值守恒/事件精度门禁测试。
- **Phase 1 (M1)**：`apps/web` 教室演示壳 + Excalidraw 离线批注 + POE 遮罩 + PWA + `singlefile-exporter`。
- **Phase 2 (M2)**：4 个旗舰物理模型（有界磁场/复合场、机械波与振动联动、电磁感应单双杆、动力学板块与传送带）。
- **Phase 3 (M3)**：`ray-optics`、`rapier2d` 沙箱与自研 MNA 直流/含容电路求解器。
- **Phase 4 (M4)**：AI 循证教研闭环（POE任务单/三层变式题/误区反例卡 + 数值验算脚本）与社区开源文档。
