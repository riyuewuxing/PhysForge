# S03 电磁弹射、磁悬浮与新能源制动能量回收（stse-em-launch-regen-brake）

## 1. 电磁导轨弹射（`mode = 'railgun'`）
- 驱动方式：脉冲储能电容（初始电容能 $\frac{1}{2} C U_0^2$，$C\frac{dU}{dt}=-I$，$U - B L v = I R$）或恒流脉冲源（计入 $P_{\text{in}} = U_{\text{term}} I = I^2 R + B L v I$）。
- 状态演化方程：$m \frac{dv}{dt} = B I L - k_d v^2$，全程精确积分输入能量 $E_{\text{in}}$、焦耳热 $E_{\text{joule}}$、气动阻力损耗 $E_{\text{drag}}$ 与动能 $E_k$，全过程能量账本残差 $< 10^{-6}\text{ J}$。

## 2. 新能源汽车再生制动（`mode = 'regen-brake'`）
- 再生发电回路 $I = \frac{B L v}{R_{\text{int}} + R_{\text{load}}}$，电磁制动力 $F_{\text{em}} = \frac{B^2 L^2}{R_{\text{total}}} v$，再生回收储能 $E_{\text{regen}} = \int I^2 R_{\text{load}}\,dt$ 与内阻损耗 $E_{\text{int}} = \int I^2 R_{\text{int}}\,dt$。
- 平路纯电磁制动下解析停驻总距 $x_{\text{total}} = \frac{M v_0 R_{\text{total}}}{B^2 L^2}$ 与积分终点距离吻合误差 $< 10^{-6}$。
