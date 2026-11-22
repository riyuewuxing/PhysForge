# E05 线框进出多区域磁场与旋转切割（em-wireframe-rotation）物理与数值规格书

## 1. 物理背景与课标对照
- 对应人教版《选择性必修二》第二章《电磁感应》（闭合线框自由下落进出单区域/反向双区域/梯度磁场、矩形/正三角形/圆形线框有效切割长度、金属棒转动切割与法拉第圆盘发电机）。
- 核心方程：
  1. **平动线框（`wireframe-gravity-fall`）**：
     - 线框几何宽度函数 $w(u)$（竖直相对坐标 $u \in [-h/2, h/2]$）：
       - 矩形：`w(u) = L`；
       - 正三角形：`w(u) = L (0.5 + u/h)`；
       - 圆形：`w(u) = 2 \sqrt{r^2 - u^2}`。
     - 磁通量 $\Phi(y_c) = \int_{-h/2}^{h/2} B(y_c - u) w(u)\,\mathrm{d}u$，有效切割等效宽度/磁通梯度：
       $$G(y_c) = \frac{\mathrm{d}\Phi}{\mathrm{d}y_c} = \int_{-h/2}^{h/2} \left(B'(y_c - u)\right) w(u)\,\mathrm{d}u$$
       对于单边界或反向双边界阶跃磁场，$G(y_c) = \sum \Delta B_k w(u_k)$ 严格给出精确等效切割电动势：
       $$\mathcal{E} = -G(y_c) v, \qquad I = \frac{\mathcal{E}}{R}, \qquad F_{\text{安}} = -G(y_c) I = -\frac{G^2 v}{R}$$
     - 反向双磁场穿越边界时上下边同向切割叠加，$\mathcal{E}_{\text{dual}} = 2 B L v = 2.000 \times \mathcal{E}_{\text{single}}$。
  2. **旋转切割与法拉第圆盘（`rotating-rod` / `faraday-disk`）**：
     - $\mathcal{E} = \frac{1}{2} B \omega L^2$（或法拉第铜盘 $\frac{1}{2} B \omega R^2$），四联实时观测量 `fluxWb, emfV, currentA, ampereForceN`。

## 2. 单元测试与精度卡点
1. 反向双磁场交界穿越瞬间电动势严格等于单边界电动势的 `2.000` 倍（相对误差 `< 1e-6`）；
2. 线框自由下落完整穿越单/双区域磁场：能量守恒 $m g \Delta h - (\Delta E_k + Q_{\text{焦耳}}) < 10^{-6}$；
3. 转动切割杆与法拉第圆盘电动势与 $\frac{1}{2}B\omega R^2$ 吻合 `< 1e-10`；
4. 参数边界（$B=0, v_0=0, dt=0$）无 `NaN` / `Infinity`。
