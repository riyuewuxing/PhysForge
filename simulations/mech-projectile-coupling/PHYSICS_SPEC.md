# M04 抛体运动与斜面/曲面耦合（`mech-projectile-coupling`）物理建模规范

- **微分方程**：
  - 真空平抛/斜抛：$\ddot{x}=0,\; \ddot{y}=-g$；
  - 二次空气阻力：$\ddot{\mathbf{r}} = \mathbf{g} - \frac{c_d}{m}\|\mathbf{v}\|\mathbf{v}$，由 RK4 高阶推进。
- **边界事件捕获**：`bisectEvent`（$|\Delta t| \le 10^{-8}\text{ s}$）精确捕获落入倾角为 $\theta$ 斜面 $y + x\tan\theta = 0$ 或半圆槽 $x^2 + y^2 - R^2 = 0$ 的碰撞时刻与位置。
- **解析验证特征**：
  - 真空平抛落斜面飞行时间 $t_{\text{fly}} = \frac{2v_0\tan\theta}{g}$；
  - 任意发射角斜抛包络线（安全抛物线）$y_{\text{env}}(x) = \frac{v_0^2}{2g} - \frac{g}{2v_0^2}x^2$；
  - 速度反向延长线交于水平位移中点（平抛特性）。
