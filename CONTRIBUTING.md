# 贡献指南（Contributing to PhysForge）

欢迎物理教师、教研员与开源开发者参与共建！**即使不会编写 TypeScript 代码，一线教师也可以通过纯文本 JSON 文件为社区贡献精品课堂预设或经过物理内核验算的导学案！**

---

## 一、一线教师无代码贡献流程（推荐）

### 方式 1：贡献课堂预设 JSON（`content/presets/`）
1. 在 `apps/web` 中调好某道高考题或课堂例题的物理参数与图层开关；
2. 参考 [content/presets/em-bounded-magnetic-field.focusing.json](./content/presets/em-bounded-magnetic-field.focusing.json) 的格式新建 JSON 文件：
   ```json
   {
     "modelId": "em-bounded-magnetic-field",
     "preset": {
       "id": "my-custom-preset",
       "name": "例题：半空间磁场斜射偏转",
       "description": "课堂使用场景说明...",
       "params": {
         "mode": "half-space",
         "initialSpeed": 2.4
       },
       "visibleLayers": ["fieldRegion", "trajectory", "larmorCircle"]
     }
   }
   ```
3. 也可直接将新预设追加到对应模型的 `simulations/<model-id>/plugin.ts` 的 `presets` 数组中。

### 方式 2：贡献循证教研包（`content/teaching-packs/`）
1. 在 `content/teaching-packs/` 新建或补充 `<model-id>.json`，结构遵循 `@physforge/pedagogy-schema`：
   - `curriculum`：教材分册、章节与 2025 修订课标核心素养枚举；
   - `poeWorksheets`：POE 探究单（必须绑定真实存在的 `modelId` 与 `presetId`）；
   - `variantQuestions`：母题与基础/进阶/压轴变式题，须填写 `verification.simDurationSec` 与 `verification.expectedMetrics`；
   - `misconceptions`：前概念误区与反例预设绑定。
2. 在本地运行防幻觉校验脚本验证格式与物理数值无误：
   ```bash
   pnpm verify:packs
   ```

---

## 二、开发者新增物理模型标准流程（须遵守 `AGENTS.md`）

1. **数学建模先行**：先在 `simulations/<model-id>/PHYSICS_SPEC.md` 写明坐标系、控制方程、解析特例与所选积分器。
2. **物理与视图严格解耦**：纯计算放在 `engine.ts`（零 DOM/Canvas/React 依赖），临界事件必须使用 `@physforge/physics-core` 的 `bisectEvent` 收敛至 $|\Delta t| \le 10^{-7}\text{ s}$。
3. **强制物理守恒测试**：编写 `engine.test.ts`，验证守恒律、解析特例误差（`< 1e-4`）及零参数边界安全性。
4. **插件组装与门禁**：在 `plugin.ts` 中提供至少 3 套教学预设并注册进 `simulations/registry.ts`，随后依次跑通：
   ```bash
   pnpm typecheck
   pnpm test
   pnpm verify:packs
   pnpm build
   ```

## 三、许可证合规提示
PhysForge 主仓使用 **MIT 协议**，严禁向主代码库提交任何 `GPL-2.0/3.0` 源码或商业受限代码。
