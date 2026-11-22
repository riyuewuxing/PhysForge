# E03 交变电场加速、示波管与等效重力场（em-ac-field-oscilloscope）物理与数值规格书

## 1. 物理背景与课标对照
- 对应人教版《必修第三册》第十章 第5节《带电粒子在电场中的运动》（交变电场多时刻入射、示波管原理与李萨如图形、重力场+匀强电场等效重力场圆周运动）。
- 核心方程：
  1. **方波/正弦交变电场 (`ac-square-wave`, `ac-sine-wave`)**：
     - 同步对比 4 组不同入射相位 $t_0 \in \{0, T/8, T/4, 3T/8\}$ 的带电粒子；
     - 采用 `bisectEvent` 精确定位 $t = k\frac{T}{2}$ 极板电压反向突变，消弭跨跳误差（$t_0=T/4$ 入射一周期末位移精确回零）；
  2. **示波管荧光屏偏转与李萨如图 (`oscilloscope-lissajous`)**：
     - 电子经 $U_1$ 加速 $v_0 = \sqrt{2(e/m)U_1}$，经偏转板长 $L_1$、间距 $d$、到屏距 $L_2$：
       $$Y_{\text{screen}} = \frac{U_y L_1}{2 d U_1}\left(\frac{L_1}{2} + L_2\right)$$
     - 并用 `stepRK4` 同步数值积分检验偏转精度；$U_x = U_{xm}\sin(\omega_x t), U_y = U_{ym}\sin(\omega_y t + \delta)$ 生成余辉扫描李萨如图形；
  3. **等效重力场 (`equivalent-gravity`)**：
     - $\mathbf{g}_{\text{eff}} = (a_{ex}, -g + a_{ey})$，识别“等效最低点”与“等效最高点”，`Auto-FBD` 自动标出 $mg, qE, T$。

## 2. 单元测试与精度卡点
1. 示波管直流静偏转数值积分位移与公式 $\frac{U_y L_1}{2 d U_1}(\frac{L_1}{2} + L_2)$ 相对误差 `< 1e-6`；
2. 方波交变电场 $t_0 = T/4$ 静止释放粒子完整一周期净位移 $|x(t_0 + T)| < 10^{-7}\text{ m}$；
3. 等效重力场无阻尼单摆能量 $E_k - m\mathbf{g}_{\text{eff}}\cdot\mathbf{r}$ 守恒 `< 1e-6`；
4. 边界值（`dt=0`, $E_0=0$）无 `NaN` / `Infinity`。
