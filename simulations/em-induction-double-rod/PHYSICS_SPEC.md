# 电磁感应单杆与双杆切割模型（`em-induction-double-rod`）物理建模规范

## 1. 坐标系与模型构型
- 水平导轨沿 $x$ 轴放置，导轨间距 $L$，磁感应强度 $B$ 垂直导轨平面向下。
- 支持两种构型：
  1. **双杆切割（`double`）**：杆 1（质量 $m_1$，内阻 $r_1$，外力 $F_{\text{ext}}$）与杆 2（质量 $m_2$，内阻 $r_2$）在导轨上运动，与外接电阻 $R$ 构成闭合回路，总电阻 $R_{\text{tot}} = R + r_1 + r_2$。
  2. **单杆切割（`single`）**：杆 2 固定，杆 1 与外部电路元件串联，电路负载可选纯电阻（`resistor`）、电容器（`capacitor`，电容 $C$）或恒定直流电源（`battery`，电动势 $E_{\text{src}}$）。

## 2. 控制微分方程组
设电流正方向为顺时针或与电动势一致方向，杆 1/2 位置与速度为 $(x_1, v_1, x_2, v_2)$：
1. **双杆（电阻负载）**：
   $$\mathcal{E} = BL(v_1 - v_2), \quad I = \frac{\mathcal{E}}{R_{\text{tot}}}, \quad F_{\text{amp}} = BIL$$
   $$m_1 \frac{dv_1}{dt} = F_{\text{ext}} - F_{\text{amp}} + f_1, \quad m_2 \frac{dv_2}{dt} = F_{\text{amp}} + f_2$$
2. **单杆 + 电容器 $C$**：
   $$I = \frac{BLv_1 - q_C / C}{R_{\text{tot}}}, \quad \frac{dq_C}{dt} = I, \quad m_1 \frac{dv_1}{dt} = F_{\text{ext}} - BIL + f_1$$
3. **单杆 + 恒定电源 $E_{\text{src}}$**：
   $$I = \frac{E_{\text{src}} - BLv_1}{R_{\text{tot}}}, \quad m_1 \frac{dv_1}{dt} = F_{\text{ext}} + BIL + f_1$$
4. **能量累积方程**：
   $$\frac{dQ_{\text{Joule}}}{dt} = I^2 R_{\text{tot}}, \quad \frac{dW_{\text{ext}}}{dt} = F_{\text{ext}} v_1, \quad \frac{dW_{\text{src}}}{dt} = E_{\text{src}} I \text{ (仅电源模式)}$$

## 3. 数值积分与事件捕获
- 连续状态采用四阶显式龙格-库塔 `stepRK4` 积分；
- 当存在动摩擦 $\mu > 0$ 且运动杆速度过零时，使用 `bisectEvent`（容限 $\le 10^{-8}\text{ s}$）精确捕获静止临界时刻并切换静摩擦锁止态，避免零速抖振；同时检测双杆共速或相对运动极值事件。

## 4. 解析检验特例与守恒指标
- **双杆无外力光滑**：任意时刻动量守恒 $m_1 v_1 + m_2 v_2 = m_1 v_{10} + m_2 v_{20}$（相对误差 $< 10^{-8}$），共速后焦耳热等于动能损失 $Q = \frac{1}{2}\frac{m_1 m_2}{m_1 + m_2}(v_{10} - v_{20})^2$；
- **单杆接电容无外力**：最终稳态速度解析解 $v_\infty = \frac{m_1 v_{10}}{m_1 + B^2 L^2 C}$，总能量守恒 $\Delta E_k + E_C + Q_{\text{Joule}} = 0$（相对误差 $< 10^{-4}$）；
- **单杆恒力接电阻**：收尾速度 $v_{\text{term}} = \frac{F_{\text{ext}} R_{\text{tot}}}{B^2 L^2}$（相对误差 $< 10^{-4}$）。
