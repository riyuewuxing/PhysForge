# 动力学板块模型与传送带摩擦力突变（`mech-block-conveyor`）物理建模规范

## 1. 坐标系与两种子系统
沿传送带（倾角 $\theta \ge 0$）或水平桌面建立一维运动坐标 $s$（向右/沿斜面向上为正）。

### 1.1 传送带模式（`conveyor`）
- 传送带恒速 $v_{\text{belt}}$（$>0$ 顺时针向上/向右，$<0$ 逆时针向下/向左），物块质量 $m$，动摩擦因数 $\mu$，倾角 $\theta$。
- 滑动摩擦力大小 $f_k = \mu m g \cos\theta$，重力下滑分力 $G_\parallel = m g \sin\theta$。
- **未共速阶段**（$v_{\text{rel}} = v - v_{\text{belt}} \neq 0$）：
  $$a = -\text{sgn}(v_{\text{rel}})\mu g \cos\theta - g\sin\theta$$
  相对划痕路程演化 $\frac{d(\Delta x_{\text{rel}})}{dt} = |v_{\text{rel}}|$，摩擦生热 $\frac{dQ}{dt} = f_k |v_{\text{rel}}|$，传送带电动机对系统做功功率 $P_{\text{belt}} = (-f_{\text{on block}}) v_{\text{belt}}$。
- **共速突变判定**（$v = v_{\text{belt}}$）：
  - 若 $G_\parallel \le f_k$（即 $\tan\theta \le \mu$）：静摩擦力满足平衡条件，进入共速锁定（$v \equiv v_{\text{belt}}, a = 0$，摩擦生热停止）；
  - 若 $G_\parallel > f_k$（即 $\tan\theta > \mu$）：静摩擦无法维持相对静止，共速瞬间立即越过并反转摩擦力方向继续加速下滑！

### 1.2 板块模式（`plank`）
- 上物块 $m_1$、下木板 $m_2$（地面摩擦因数 $\mu_2$，块板间 $\mu_1$，水平外力 $F_{\text{ext}}$ 作用于木板或物块；此处统一设作用于木板 $m_2$）。
- 未共速时由各自滑动摩擦力驱动；共速瞬间校验整体共同加速度 $a_c$ 所需静摩擦力 $m_1 |a_c| \le \mu_1 m_1 g$ 是否成立以决定锁定共速或相对滑动。

## 2. 精确事件捕获与数值守恒验证
- 采用解析/VelocityVerlet 分段推进配合 `bisectEvent`（收敛容限 $\le 10^{-8}\text{ s}$）精确捕捉共速临界瞬间，确保摩擦力切换点无数值抖振。
- 必须通过的单测：
  1. 水平传送带从静止加速至共速 $v_{\text{belt}}$：验证共速时刻 $t^* = \frac{v_{\text{belt}}}{\mu g}$ 捕获误差 $< 10^{-6}\text{ s}$，物块对地位移 $x_{\text{物}} = \frac{v^2}{2\mu g}$、相对划痕 $\Delta x_{\text{rel}} = x_{\text{物}}$、摩擦生热 $Q = \frac{1}{2} m v^2$；
  2. 倾斜逆时针传送带（$\mu < \tan\theta$）共速瞬间精确捕获（误差 $< 10^{-6}\text{ s}$）并验证共速后加速度从 $g(\sin\theta + \mu\cos\theta)$ 突变为 $g(\sin\theta - \mu\cos\theta)$；
  3. 光滑地面板块模型动量守恒（$< 10^{-8}$）与能量守恒 $Q = f_1 \Delta x_{\text{rel}} = \Delta E_k$（$< 10^{-4}$）；
  4. 极端边界（$\mu = 0$、$v_{\text{belt}} = 0$、$v_0 = v_{\text{belt}}$、$dt = 0$）无 `NaN / Infinity`。
