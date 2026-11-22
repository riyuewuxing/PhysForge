# N02 卢瑟福 $\alpha$ 散射与玻尔氢原子能级跃迁（modern-rutherford-bohr）物理建模规格

## 1. 无量纲核物理缩放上下文（`ScaleContext`）
- $L_0 = 10^{-15}\ \text{m}\ (\text{fm}),\ T_0 = 10^{-22}\ \text{s},\ M_0 = m_\alpha = 6.6446573357\times 10^{-27}\ \text{kg},\ Q_0 = e$。
- 库仑排斥无量纲常数 $\kappa = \frac{k_e Z_1 Z_2 e^2}{E_0 L_0}$，运动方程 $\frac{d^2 \hat{\mathbf{r}}}{d\hat{t}^2} = \frac{\kappa}{\hat{r}^3}\hat{\mathbf{r}}$，由 `integrateAdaptiveRK45` 求解。
- 渐近解析对照：$\tan(\theta / 2) = \frac{k_e Z_1 Z_2 e^2}{2 K_\alpha b}$，机械能全程严格守恒（相对误差 $< 10^{-6}$），散射角相对误差 $< 10^{-4}$。

## 2. 玻尔氢原子能级（`mode = 'bohr'`）
- 能级公式：$E_n = -\frac{13.6}{n^2}\ \text{eV}$。
- 跃迁波长：$\lambda_{n_i \to n_f} = \frac{hc}{e |E_{n_i} - E_{n_f}|}$，通过 `wavelengthToRgb` 渲染巴耳末可见光谱线。
- 区别“单个受激原子”（级联跃迁最多 $n-1$ 条）与“一群受激原子”（$C_n^2 = \frac{n(n-1)}{2}$ 条）；区分光子共振吸收（须精确满足 $\Delta E$ 或电离）与电子碰撞非弹性激发（仅需 $E_e \ge \Delta E$，保留剩余动能）。
