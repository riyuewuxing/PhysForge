# W02 2D 波动池 FDTD 衍射、折射与干涉（wave-2d-ripple-fdtd）物理与数值规格书

## 1. 物理背景与课标对照
- 对应人教版《选择性必修一》第三章 第5节《波的衍射、干涉与多普勒效应》与《选择性必修一》第四章（惠更斯原理与折射波形弯曲）。
- 核心方程：
  $$\frac{\partial^2 u}{\partial t^2} = c(x, y)^2 \left(\frac{\partial^2 u}{\partial x^2} + \frac{\partial^2 u}{\partial y^2}\right)$$
  - 采用 `@physforge/physics-core` 的 `WaveFDTD2D`（`200 × 150` `Float32Array` 三缓冲五点差分 + `16` 格指数衰减吸收海绵层）；
  - **CFL 稳定性硬性钳位**：给定波速 $c_0$ 与空间步长 $\Delta x$，强制限制时间步长使柯朗数 $r = \frac{c_0 \Delta t}{\Delta x} \le 0.45 < \frac{1}{\sqrt{2}}$；
  - 支持双缝干涉（接收屏时间平均波强 $\langle u^2(y) \rangle$）、单缝衍射、障碍物绕射及非均匀折射率介质 $c(x, y) = c_0 / n(x, y)$ 折射聚焦。

## 2. 单元测试与精度卡点
1. 强制验证 CFL 数 `< 0.5`，连续推进 **2000 步**后全场无任何 `NaN` / `Infinity` 或指数发散；
2. 双缝干涉接收屏时间平均强度极大值间距 $\Delta y$ 与远场解析公式 $\frac{L}{d}\lambda$ 偏差 `< 5%`；
3. 边界条件（振幅为 0、`dt=0`）无 `NaN`。
