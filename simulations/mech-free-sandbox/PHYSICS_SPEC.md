# 自由力学探究沙箱（`mech-free-sandbox`）物理建模规范

## 1. 架构与按需懒加载契约
- 按仓库红线要求，本模块采用 **动态按需懒加载** 引入 `@dimforge/rapier2d-compat`（Apache-2.0），严禁在顶层静态 import WASM 模块，确保不进入主应用首屏 chunk 及其他单文件切片。
- `rapierLoader.ts` 通过 `import('@dimforge/rapier2d-compat')` + `await RAPIER.init()` 异步就绪，就绪后由 Rapier2D 刚体世界步进；首帧同步初始化或异步加载窗口内提供确定性纯 TS 运动学兜底，无头测试显式等待 Rapier WASM 就绪后校验真实刚体物理守恒。

## 2. 预设实验场景
1. **`elastic-collision`（一维弹性/非弹性碰撞）**：两刚体滑块/小球在水平光滑地面发生碰撞，调节恢复系数 $e \in [0, 1]$，验证总动量守恒 $m_1 v_1 + m_2 v_2 = \text{const}$ 及弹性碰撞（$e=1$）机械能守恒。
2. **`incline-slide`（斜面滑块下滑碰撞）**：斜角 $\theta$ 斜面上方释放滑块与底部静止物块碰撞。
3. **`spring-oscillator`（胡克弹簧振子）**：刚体与固定点间的轻弹簧系统（$F = -k\Delta x$）。
4. **`newtons-cradle`（牛顿摆多球碰撞动量传递）**：四球一维紧挨碰撞，展示等质量完全弹性碰撞的速度交替传递。

## 3. 验收标准
- `@dimforge/rapier2d-compat` 真实 WASM 环境下验证自由落体解析位移误差 $< 10^{-3}\text{ m}$、完全弹性碰撞总动量守恒及总动能变化可控、零参数与 `dt=0` 无 `NaN`。
