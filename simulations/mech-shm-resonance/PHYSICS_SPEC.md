# M11 简谐振动、非线性单摆与受迫共振（mech-shm-resonance）物理与数值规格书

## 1. 物理背景与课标对照
- 对应人教版《选择性必修第一册》第二章《机械振动》（简谐运动与参考圆、单摆等时性与非线性大角修正、阻尼振动、受迫振动与共振曲线）。
- 核心方程：
  1. 完整非线性受迫阻尼单摆：
     $$\ddot{\theta} + 2\gamma\dot{\theta} + \frac{g}{L}\sin\theta = \frac{F_0}{mL}\cos(\omega_d t)$$
  2. 并行小角近似谐振子对比幽灵摆（用于直观对比等时性破缺）：
     $$\ddot{\theta}_{\text{lin}} + 2\gamma\dot{\theta}_{\text{lin}} + \frac{g}{L}\theta_{\text{lin}} = \frac{F_0}{mL}\cos(\omega_d t)$$
- 核心特征量：
  - 固有圆频率 $\omega_0 = \sqrt{g / L}$，小角周期 $T_0 = 2\pi\sqrt{L/g}$；
  - 线性受迫位移共振峰角频率：$\omega_{\text{res}} = \sqrt{\omega_0^2 - 2\gamma^2}$（当 $\omega_0^2 > 2\gamma^2$）；
  - 单摆机械能（无外驱无阻尼）：$E = \frac{1}{2}m L^2 \dot{\theta}^2 + m g L (1 - \cos\theta)$；
  - 线切向杆张力：$T = m g \cos\theta + m L \dot{\theta}^2$。

## 2. 数值算法与精度控制
- 使用四阶显式龙格-库塔 `stepRK4`（子步长上限 $\Delta t_{\text{sub}} \le 0.004\text{ s}$），同步推进非线性摆 $(\theta, \dot{\theta})$ 与参考谐振幽灵摆 $(\theta_{\text{lin}}, \dot{\theta}_{\text{lin}})$；
- 采用 `bisectEvent` 精确定位平衡位置 $\theta = 0$ 过零点以实测周期与半周期相位差；
- 向 `@physforge/analysis-lab` 的 `PhaseXYPlotter` 导出相空间观测量 `thetaRad` 与 `omega`，支持吸引子/相轨迹可视化。

## 3. 解析特例与单元测试卡点
1. $2^\circ$ 小角自由单摆实测周期与 $2\pi\sqrt{L/g}$ 相对误差 `< 1e-4`；
2. 无阻尼、无外驱大角（$\theta_0 = 60^\circ$）连续 10 周期机械能相对漂移 `< 1e-6`；
3. 弱激励稳态受迫共振扫描实测峰值角频率与解析峰值 $\omega_{\text{res}} = \sqrt{\omega_0^2 - 2\gamma^2}$ 一致（误差 `< 2%`）；
4. 边界参数（$\theta_0=0, L$ 极值, `dt=0`）无 `NaN` / `Infinity`。
