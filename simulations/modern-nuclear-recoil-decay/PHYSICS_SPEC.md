# N03 核反应质能亏损、磁云室反冲径迹与半衰期蒙特卡洛（modern-nuclear-recoil-decay）

## 1. 质能亏损与二体相对论反冲径迹（`mode = 'cloud-chamber-recoil'`）
- 质量亏损能量：$Q = \Delta m c^2$（$1\ \text{u} = 931.49410242\ \text{MeV}/c^2$）。
- 静止母核二体衰变严格相对论守恒：
  $E_1 = \frac{M^2 + m_1^2 - m_2^2}{2M}c^2,\quad p = \frac{\sqrt{E_1^2 - (m_1 c^2)^2}}{c},\quad p_1 = p_2 = p$。
- 在匀强磁场 $\mathbf{B} = (0, 0, B_z)$ 中以相对论有效质量 $\gamma_i m_i$ 调用 `stepBorisPusher` 推进子核与出射粒子轨迹：
  - $\alpha$ 衰变（$+2e$ 与 $+(Z-2)e$ 同号）：洛伦兹力反向 $\Rightarrow$ 圆心在衰变点两侧，呈**外切圆**，半径比 $R_\alpha / R_Y = q_Y / q_\alpha$。
  - $\beta^-$ 衰变（$-e$ 与 $+(Z+1)e$ 异号）：洛伦兹力同向 $\Rightarrow$ 圆心在衰变点同侧，呈**内切圆**，半径比 $R_\beta / R_Y = q_Y / e$。

## 2. 放射性半衰期蒙特卡洛与链式裂变（`mode = 'half-life-mc' | 'chain-fission'`）
- 使用 `createSeededPrng(seed)` 确定性伪随机数（严禁 `Math.random()`），按步长概率 $p = 1 - 2^{-\Delta t / T_{1/2}}$ 模拟 $N_0 \in [16, 4000]$ 个核的随机衰变与核统计规律。
- 链式反应模块定量刻画控制棒吸收率与中子倍增系数 $k_{\text{eff}}$ 决定的次临界/临界/超临界倍增。
