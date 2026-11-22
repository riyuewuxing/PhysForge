# 有界磁场与复合场动态圆模型（`em-bounded-magnetic-field`）物理建模规范

## 1. 坐标系与物理约定
- 采用右手直角坐标系：$x$ 轴水平向右，$y$ 轴竖直向上，$z$ 轴垂直纸面向外。
- 磁感应强度 $\vec{B} = (0, 0, B_z)$：$B_z > 0$ 表示垂直纸面向外（$\odot$），$B_z < 0$ 表示垂直纸面向里（$\otimes$）。
- 电场强度 $\vec{E} = (0, E_y, 0)$（仅在 `crossed-eb` 复合场模式下非零）。
- 粒子运动平面为 $z = 0$ 平面，满足牛顿-洛伦兹动力学方程：
  $$m \frac{d\vec{v}}{dt} = q\left(\vec{E}(\vec{r}) + \vec{v} \times \vec{B}(\vec{r})\right), \quad \frac{d\vec{r}}{dt} = \vec{v}$$

## 2. 四种场域与事件函数 $g(\vec{r})$
1. **`half-space`（直线边界磁场）**：$x \ge x_{\text{min}}$ 存在匀强磁场 $\vec{B}$；事件函数 $g(\vec{r}) = -(x - x_{\text{min}})$（磁场内 $g \le 0$，外部 $g > 0$）。
2. **`circular`（圆形有界磁场）**：以原点 $(0, 0)$ 为圆心、半径 $R_{\text{field}}$ 的圆内存在匀强磁场；事件函数 $g(\vec{r}) = \sqrt{x^2 + y^2} - R_{\text{field}}$。
3. **`rectangular`（矩形有界磁场）**：区域 $[0, W] \times [-H/2, H/2]$ 内存在匀强磁场；事件函数采用二维矩形有向距离 `signedDistanceRect2D`。
4. **`crossed-eb`（正交匀强电磁复合场）**：全空间同时存在 $\vec{E} = (0, E_y, 0)$ 与 $\vec{B} = (0, 0, B_z)$。

## 3. 数值积分器与精确事件定位
- **积分器**：采用 `stepBorisPusher`（半步电场加速 $\rightarrow$ 磁场 Cayley 纯旋转 $\rightarrow$ 半步电场加速 + 时间对称位置更新）。在纯磁场下动能数学严格守恒，匀强场回旋圆半径离散零漂移。
- **临界事件定位**：每步检测主粒子是否跨越磁场边界 $g(\vec{r}) = 0$，触发时调用 `bisectEvent`（收敛容限 $\le 10^{-8}\text{ s}$）精确定位进入/穿出边界时刻 $t^*$、位置 $(x^*, y^*)$ 与偏向角，并将该步拆分为边界前后两段积分。

## 4. 解析特例与配速法
1. **纯匀强磁场回旋半径与周期**：
   $$R_c = \frac{mv_0}{|q B_z|}, \quad T = \frac{2\pi m}{|q B_z|}$$
2. **圆形磁场磁聚焦特例**：当 $R_c = R_{\text{field}}$ 时，沿 $+x$ 方向从左半圆不同高度 $y_0 \in (-R_{\text{field}}, R_{\text{field}})$ 射入磁场的同种粒子（$q B_z > 0$），全部精确汇聚于边界点 $(0, -R_{\text{field}})$（若 $q B_z < 0$ 则汇聚于 $(0, +R_{\text{field}})$）。
3. **正交复合场配速法**：当 $B_z \neq 0$ 时，将速度分解为匀速漂移分速度 $\vec{v}_d = \frac{\vec{E} \times \vec{B}}{B^2} = \left(\frac{E_y}{B_z}, 0, 0\right)$ 与匀速圆周分速度 $\vec{v}_{\text{rot}} = \vec{v} - \vec{v}_d$；初速度为零时解析摆线轨道为：
   $$x(t) = \frac{E_y}{B_z}\left(t - \frac{\sin(\omega_c t)}{\omega_c}\right), \quad y(t) = \frac{E_y}{B_z \omega_c}\left(1 - \max(\text{sgn}) \dots\right) \text{ 即 } \frac{q E_y}{m \omega_c^2}(1 - \cos(\omega_c t))$$

## 5. 教学预设与守恒验证门槛
- 至少提供 5 套课堂预设（直线边界旋转圆、圆形磁聚焦、放缩圆包络、正交复合场配速法摆线、洛伦兹力永不做功反例）。
- 单测要求：纯磁场 10 周期动能相对误差 $< 10^{-6}$、半径偏差 $< 10^{-5}$；磁聚焦汇聚偏差 $< 10^{-4}\text{ m}$；正交复合场摆线与解析解偏差 $< 10^{-4}$；`bisectEvent` 边界穿出时间误差 $< 10^{-6}\text{ s}$；$B=0, q=0, v_0=0, dt=0$ 无 `NaN/Infinity`。
