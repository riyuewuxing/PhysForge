# E02 平行板电容器动态分析与密立根油滴（em-capacitor-millikan）物理与数值规格书

## 1. 物理背景与课标对照
- 对应人教版《必修第三册》第十章 第4节《电容器的电容》与拓展专题（密立根油滴测元电荷）。
- 核心教学物理量：
  - 真空介电常数 $\varepsilon_0 = 8.8541878128\times 10^{-12}\text{ F/m}$；
  - 极板电容：$C = \frac{\varepsilon_0 \varepsilon_r S}{d}$（$S = S_0 \cdot r_S$ 为正对面积，$d$ 为间距）；
  - 闭合开关（恒压 $U = U_0$）：$Q = C U_0$，$E = U_0 / d$；
  - 断开开关（恒电荷 $Q = Q_0 = C_{\text{ref}} U_0$）：$U = Q_0 / C$，$E = \frac{Q_0}{\varepsilon_0 \varepsilon_r S}$ 与 $d$ 无关（$\Delta E \equiv 0$）；
  - 接地参考电势 $\varphi_P$：下极板接地时 $\varphi_{\text{bot}}=0 \implies \varphi_P = E \cdot y_P$；上极板接地时 $\varphi_{\text{top}}=0 \implies \varphi_P = -E \cdot (d - y_P)$。
  - 密立根油滴动力学：$m\ddot{y} = q_{\text{drop}} E - m g - \gamma_{\text{stokes}} \dot{y}$，静悬平衡条件 $q_{\text{drop}} E = m g$。

## 2. 单元测试卡点
1. 两种开关模式（恒 $U$ / 恒 $Q$）与三种接地状态下 $C, Q, U, E, \varphi_P$ 解析误差 `< 1e-10`；
2. 断开开关仅改变极板间距 $d$ 时，板间场强变化 $|\Delta E| \equiv 0$（`< 1e-12`）；
3. 密立根油滴平衡电压下 $\ddot{y}=0, \dot{y}=0$，非平衡状态在斯托克斯粘滞阻力下收敛至终端速度 $v_t = \frac{qE-mg}{\gamma}$；
4. 边界值（`dt=0`, $U_0=0$）无 `NaN` / `Infinity`。
