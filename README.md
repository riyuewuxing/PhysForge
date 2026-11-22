# PhysForge（智理视界）

**面向中国普通高中物理（《普通高中物理课程标准（2017年版2025年修订）》与人教版 2019 教材体系）的开源、离线优先、高数值精度交互式物理仿真内核 + 教室白板批注 + AI 循证教研平台。**

*An open-source, offline-first, numerically rigorous high-school physics simulation platform and evidence-based teaching workbench built for classroom interactive whiteboards.*

---

## 核心特性 | Key Features

1. **理论物理级数值计算内核（`packages/physics-core`）**
   - 100% 零 DOM / Canvas / React 依赖，可直接在 Node / Vitest 无头运行。
   - 按体系分级积分：`VelocityVerlet`（保守简谐振动 100 周期能量漂移 `< 1e-4`）、`BorisPusher`（纯磁场 10 周期动能相对误差 `< 1e-6`、回旋半径偏差 `< 1e-5`）、`stepRK4` / `integrateAdaptiveRK45`（Dormand-Prince 5(4)）及步进回溯二分事件定位器 `bisectEvent`（收敛容限 $|\Delta t| \le 10^{-7}\text{ s}$）。
2. **一线教室大屏演示外壳（`apps/web`）**
   - **240Hz 固定物理步长累加器**运行在 `requestAnimationFrame` + `ref` 上，高刷屏下演化严格一致，禁止每帧坐标写入 React `useState`。
   - **四维同步表征**：高 DPR Canvas 2D 主视窗 + Strobe 频闪打点 + `uPlot` 双通道双向时间轴回放示波器 + `KaTeX` 动态公式实时代入与能量堆叠柱状图。
   - **课堂三大杀手锏**：黑板深蓝 / 投影仪高对比白底双主题（大屏模式 $\ge 18\text{px}$、热区 $\ge 44\text{px}$）、POE 预测遮罩、`Excalidraw`（MIT）全本地透明板书批注与高清合成 PNG 导出。
   - **100% 离线优先**：内置 PWA Service Worker 离线缓存与本地静态字体资产，零外网 CDN 泄漏。
3. **单文件教学切片导出器（`apps/singlefile-exporter`）**
   - 按单个目标模型按需裁剪（只打包精简教室壳 + 目标模型 + `uPlot` + `KaTeX`，不包含 Excalidraw、Rapier WASM 或其余无关模型），生成可直接插入 PPT 或希沃白板双击运行的独立 `.html` 文件。
4. **7 大覆盖人教版核心模块的模型插件（`simulations/`）**
   - `em-bounded-magnetic-field`：有界磁场（直线/圆/矩形）动态圆（放缩/旋转/平移/磁聚焦）+ 正交电磁复合场配速法
   - `wave-vibration-coupling`：机械波与质点 $y-t$ 振动双图联动、上下坡法、双波源干涉与多普勒效应
   - `em-induction-double-rod`：电磁感应单/双杆切割（电阻/电容/恒定电源、动量与焦耳热守恒）
   - `mech-block-conveyor`：板块模型与传送带共速突变捕获、相对划痕 $\Delta x_{\text{rel}}$ 与生热守恒
   - `optics-ray-studio`：全反射临界角、平行玻璃砖侧移、三棱镜色散、光导纤维与双缝干涉
   - `mech-free-sandbox`：按需动态懒加载 `@dimforge/rapier2d-compat`（Apache-2.0）刚体碰撞沙箱
   - `circuit-dc-capacitor-mna`：纯 TS 自研改进节点分析法（MNA）直流与 RC 含容电路求解器（零 GPL）
5. **AI 循证教研与防幻觉闭环（`packages/pedagogy-schema` & `scripts/verify-teaching-packs.ts`）**
   - 每份 `content/teaching-packs/*.json` 必须通过 Zod v4 校验，并由 `pnpm verify:packs` 自动调用物理内核运行仿真比对题目定量指标，彻底杜绝算术幻觉。

---

## 快速开始 | Quick Start

### 环境要求 / Prerequisites
- `Node.js >= 22`（已实测 `Node v24.18.0`）
- `pnpm >= 10`（已实测 `pnpm 11.24.0`）

### 安装与启动 / Install & Develop
```bash
pnpm install
pnpm dev:web
```

### 质量门禁与单文件导出 / Quality Gates & Single-File Export
```bash
# 全仓严格类型检查
pnpm typecheck

# 运行全部物理守恒、解析对照与契约测试
pnpm test

# 用物理仿真内核反向验算所有教研包题目数值
pnpm verify:packs

# 全量生产构建（含 PWA 与本地 Excalidraw 资产）
pnpm build

# 为指定模型导出单文件离线 HTML（输出至 apps/singlefile-exporter/dist/）
pnpm export:singlefile -- --model=em-bounded-magnetic-field
pnpm export:singlefile -- --model=mech-block-conveyor --preset=conveyor-inclined-downward-break
```

---

## 仓库架构 | Repository Structure
```text
PhysForge/
├── AGENTS.md                         # AI 协作与物理严谨性宪法
├── LICENSE                           # MIT License
├── THIRD_PARTY_NOTICES.md            # 第三方开源许可致谢
├── docs/                             # 蓝图、课标映射与教学法规范
├── packages/
│   ├── physics-core/                 # 零 UI 依赖纯 TS 物理计算内核
│   ├── sim-sdk/                      # SimulationPlugin 统一插件协议
│   └── pedagogy-schema/              # Zod 教研包防幻觉数据契约
├── simulations/                      # 7 个自包含物理模型插件与注册表
├── content/
│   ├── presets/                      # 教师可无代码贡献的预设 JSON 示例
│   └── teaching-packs/               # 经过物理内核验算的 POE/变式题教研包
├── scripts/                          # 教研防幻觉自动验算脚本
└── apps/
    ├── web/                          # 主工作台（三栏壳 + Excalidraw + PWA + 导学案）
    └── singlefile-exporter/          # 单模型独立离线 HTML 打包器
```

## 开源协议 | License
主仓库基于 [MIT License](./LICENSE) 开源；全部第三方组件采用 MIT / Apache-2.0 / ISC 等宽松协议，详见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。欢迎一线物理教师参考 [CONTRIBUTING.md](./CONTRIBUTING.md) 无代码提交课堂预设与导学案！
