# W01 机械波多解性、叠加、驻波与多普勒效应（wave-vibration-coupling）V2 物理规格书

## 1. 升级能力与向后兼容性
- 完全保留 V1.0 既有横波坡度法、因果起振波前、双波源干涉、多普勒频率偏移与 5 条原单测 / `verify:packs` 教研包兼容。
- **V2 新增核心模块**：
  1. **机械波多解性枚举器** `enumerateMultiSolutionSpeeds(λ, Δx₀, Δt, N)`：
     $$v_{\text{右}}(n) = \frac{\Delta x_0 + n\lambda}{\Delta t}, \qquad v_{\text{左}}(n) = \frac{(\lambda - \Delta x_0) + n\lambda}{\Delta t}$$
     逐阶反演并在演进 $\Delta t$ 后检验全空间波形重合误差 `< 10⁻⁷`。
  2. **驻波波节与波腹模式 (`standing`)**：相向等幅两列行波叠加 $y(x,t) = 2A\sin(kx)\cos(\omega t)$，波节 $x = k\frac{\lambda}{2}$ 位移严格 `< 10⁻¹⁰`。
  3. **超音速马赫锥（`sourceSpeedRatio > 1`）**：绘制半顶角满足 $\sin\alpha = v_{\text{波}}/v_{\text{源}}$ 的包络激波线。
