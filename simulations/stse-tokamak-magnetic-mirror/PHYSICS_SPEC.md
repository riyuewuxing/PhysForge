# S01 托卡马克环形磁场与磁镜/磁瓶（stse-tokamak-magnetic-mirror）

## 1. 无散度 3D 磁镜场（$\nabla\cdot\mathbf{B} = 0$）与绝热不变量 $\mu$
- 轴对称磁瓶场强（柱坐标无散解析构型）：
  $$B_x = -B_0 \frac{x z}{L^2},\quad B_y = -B_0 \frac{y z}{L^2},\quad B_z = B_0\left(1 + \frac{z^2}{L^2}\right)$$
  恒满足 $\nabla\cdot\mathbf{B} \equiv 0$。
- 磁矩绝热不变量：$\mu = \frac{m v_\perp^2}{2 B}$；镜比 $R_m = 1 + z_{\text{coil}}^2 / L^2$，逃逸锥临界角 $\sin\theta_c = 1 / \sqrt{R_m}$。
- 数值积分采用 3D `stepBorisPusher`（纯磁场动能严格守恒 $< 10^{-8}$），$\theta > \theta_c$ 时粒子在磁喉前往复反射，$\theta < \theta_c$ 时穿透磁镜逃逸；且 $\mu$ 相对波动 $< 5\%$。

## 2. 托卡马克环形与极向螺旋场（`mode = 'tokamak'`）
- 大半径 $R_0$、环向场 $B_\phi \propto 1/R$ 与安全因子 $q$ 控制的极向场叠加形成螺旋磁面，懒加载 Vanilla `three` 视图展示 3D 磁感线与约束轨线。
