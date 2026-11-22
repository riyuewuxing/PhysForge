# M06 竖直面圆周运动与脱轨切换（`mech-vertical-circular`）物理建模规范

- **约束反力**：基于 `solveUdwadiaKalaba` 实时求解约束加速度与精确法向约束反力 $F_N(\theta, v)$：
  - 滑块在光滑圆形外凸半球表面下滑（`outer-dome`）或内轨/轻绳（`inner-loop`）做单边约束运动；
  - 轻杆（`light-rod`）提供双边刚性约束，绝不脱轨；
  - 单边约束检测到 $F_N \le 0$ 时触发 `bisectEvent`（$|\Delta t| \le 10^{-8}\text{ s}$）精确冻结脱轨时刻与脱轨角 $\theta_d$，自动切换为自由抛体模态。
- **解析对照基准**：光滑外凸半球顶点无初速下滑时，严格在 $\theta_d = \arccos(2/3)$ 处 $F_N = 0$ 脱轨。
