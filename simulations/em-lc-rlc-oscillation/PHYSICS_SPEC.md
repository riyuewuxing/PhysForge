# E09 LC 电磁振荡与 RLC 交流谐振（em-lc-rlc-oscillation）物理与数值规格书

## 1. 物理背景与课标对照
- 对应人教版《选择性必修二》第四章《电磁振荡与电磁波》（LC 振荡周期、电场能与磁场能相互转化、阻尼衰减与 RLC 串联受迫交流谐振）。
- 核心微分方程：
  $$L\ddot{q} + R\dot{q} + \frac{q}{C} = U_m\cos(\omega t), \qquad i = \dot{q}$$
  - 无阻尼 LC 自由振荡固有周期：$T_0 = 2\pi\sqrt{LC}$，$\omega_0 = \frac{1}{\sqrt{LC}}$；
  - 电场能 $E_E = \frac{q^2}{2C}$，磁场能 $E_B = \frac{1}{2} L i^2$；
  - RLC 串联交流稳态阻抗：$X_L = \omega L$，$X_C = \frac{1}{\omega C}$，$|Z| = \sqrt{R^2 + (X_L - X_C)^2}$，电流振幅 $I_m = U_m / |Z|$；谐振频率 $f_0 = \frac{1}{2\pi\sqrt{LC}}$ 处感抗等于容抗，电流峰值严格等于 $U_m / R$。

## 2. 单元测试与精度卡点
1. 无阻尼 LC（$R=0, U_m=0$）连续振荡 **20 个完整周期**：总电磁能量 $E_E + E_B$ 相对漂移 `< 1e-5`；
2. 借助 `bisectEvent` 捕获过零点实测周期与 $2\pi\sqrt{LC}$ 相对误差 `< 1e-5`；
3. 受迫 RLC 在谐振角频率 $\omega = 1/\sqrt{LC}$ 时时域积分稳态峰值电流与 $U_m / R$ 误差 `< 1e-4`；
4. 边界值（`dt=0`, $U_m=0$）无 `NaN` / `Infinity`。
