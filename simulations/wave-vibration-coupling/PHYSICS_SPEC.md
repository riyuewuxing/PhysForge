# 机械波与质点振动双图联动 · 干涉与多普勒模型（`wave-vibration-coupling`）物理建模规范

## 1. 坐标系与物理约定
- 一维横波传播轴为 $x$（右为正），质点振动位移为 $y$（上为正）；二维干涉与多普勒平面为 $(x, y)$。
- 物理参数：波源频率 $f\text{ (Hz)}$、波长 $\lambda\text{ (m)}$、振幅 $A\text{ (m)}$、圆频率 $\omega = 2\pi f$、波数 $k = \frac{2\pi}{\lambda}$、波速 $v = \lambda f$。

## 2. 三种核心模式方程
1. **`transverse`（一维横波与质点振动双图联动）**：
   $$y(x, t) = \begin{cases} A \sin\!\left(\omega\left(t - \frac{|x|}{v}\right) + \phi_0\right), & \text{若 }\text{causalFront}\text{ 关闭或 } |x| \le v t \\ 0, & \text{否则} \end{cases}$$
   （若指定单向传播 `direction = ±1` 且无起振边界截断，则相位为 $\omega(t - \text{dir}\cdot x/v) + \phi_0$）。
   探测质点 $x_P$ 处的振动速度与加速度：
   $$v_y(x_P, t) = A\omega\cos(\dots), \quad a_y(x_P, t) = -\omega^2 y(x_P, t)$$
2. **`interference`（双波源干涉）**：
   波源 $S_1 = (-d/2, 0)$、$S_2 = (+d/2, 0)$，初相差 $\Delta\phi_0$（同相 $0^\circ$ / 反相 $180^\circ$）：
   $$y(x, y, t) = A\sin(\omega t - k r_1) + A\sin(\omega t - k r_2 + \Delta\phi_0)$$
   探测点 $P(x_P, y_P)$ 处合振幅解析解：
   $$A_{\text{net}} = 2A \left|\cos\!\left(\frac{k(r_2 - r_1) - \Delta\phi_0}{2}\right)\right|$$
3. **`doppler`（运动波源多普勒效应）**：
   波源以速度 $v_s$ 沿 $+x$ 方向匀速运动，连续发射圆形波前；当 $v_s < v$ 时，正前方接收频率 $f_{\text{front}} = f \frac{v}{v - v_s}$，正后方接收频率 $f_{\text{back}} = f \frac{v}{v + v_s}$。

## 3. 验收门槛
- 数值差分验证横波质点振动速度 $v_y = \partial y/\partial t$ 与加速度 $a_y = -\omega^2 y$ 相对误差 $< 10^{-4}$；
- 同相/反相双波源干涉合振幅在波程差 $\Delta r = 0, \lambda/2, \lambda$ 处与解析解误差 $< 10^{-4}$；
- 多普勒前后接收频率公式校验误差 $< 10^{-4}$；$A=0, f=0, dt=0$ 无 `NaN/Infinity`。
