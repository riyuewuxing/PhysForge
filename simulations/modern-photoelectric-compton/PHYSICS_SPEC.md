# N01 光电效应与康普顿散射（modern-photoelectric-compton）物理建模规格

## 1. 权威物理常量（CODATA 2018 精确定义）
- $h = 6.62607015 \times 10^{-34}\ \text{J}\cdot\text{s}$
- $e = 1.602176634 \times 10^{-19}\ \text{C}$
- $c = 299792458\ \text{m/s}$
- $m_e = 9.1093837015 \times 10^{-31}\ \text{kg}$

## 2. 光电效应模型（`mode = 'photoelectric'`）
- 截止频率：$\nu_0 = \frac{W_0}{h}$，截止波长：$\lambda_0 = \frac{hc}{W_0}$。
- 爱因斯坦光电效应方程：$E_{km} = \max(0,\ h\nu - W_0) = e U_c$（$h\nu > W_0$）。
- 光电流伏安特性曲线：当 $U \le -U_c$ 时 $I(U)=0$；当 $U > -U_c$ 时按实验饱和响应平滑趋向饱和电流 $I_{\text{sat}} \propto P_{\text{light}}$。提供冻结参考曲线，课堂上直接对比“改光强 $U_c$ 不变”与“改频率 $U_c$ 移动、$E_{km}\text{--}\nu$ 图像斜率恒为 $h/e$”。

## 3. 康普顿散射相对论闭合三角形（`mode = 'compton'`）
- 康普顿波长：$\lambda_C = \frac{h}{m_e c} \approx 2.42631024 \times 10^{-3}\ \text{nm}$。
- 波长偏移：$\Delta\lambda = \lambda' - \lambda = \lambda_C (1 - \cos\theta)$。
- 能量守恒：$E_\gamma = \frac{hc}{\lambda},\quad E_\gamma' = \frac{hc}{\lambda'},\quad E_{k,e} = E_\gamma - E_\gamma'$。
- 相对论动量闭合：
  - $p_\gamma = \frac{h}{\lambda},\quad p_\gamma' = \frac{h}{\lambda'}$
  - $p_e = \frac{\sqrt{(m_e c^2 + E_{k,e})^2 - (m_e c^2)^2}}{c}$
  - $\phi = -\operatorname{atan2}(p_\gamma' \sin\theta,\ p_\gamma - p_\gamma' \cos\theta)$
  - 守恒残差 $\|(p_\gamma'\cos\theta + p_e\cos\phi - p_\gamma,\ p_\gamma'\sin\theta + p_e\sin\phi)\| / p_\gamma < 10^{-10}$。

## 4. V3.1 图像与公式一致性
- $U_{AK}$ 是可调阳极相对阴极电压，$U_c$ 是发生光电效应时的遏止电压绝对值。伏安曲线在 $U_{AK}=-U_c$ 截止，不把当前采样点等同于遏止点。未超过阈频时本模型光电流恒零，不显示虚假的遏止电压测量值或无条件的能量等式。
- 伏安特性为经验响应模型（不是电子群微观轨迹积分），其饱和电流观测量和曲线渐近值必须同源。电流坐标以 mA、电压坐标以 V 标记，虚线为参考曲线。Canvas 与 DiagramIR 采用一致电流响应与遏止点。
- 康普顿散射使用共同的有向二维动量：入射沿 +x，散射光子沿正角 θ，反冲电子角 φ 为引擎给出的有符号角（通常为负）；相对长度按同一 $p_\gamma$ 归一化。Canvas 与黑白配图保留真实向量闭合，不能将负角再取反。
