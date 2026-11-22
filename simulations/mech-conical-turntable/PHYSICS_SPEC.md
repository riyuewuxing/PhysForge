# M07 圆锥摆与水平圆盘临界滑移（`mech-conical-turntable`）物理建模规范

- **双物块连线水平圆盘模型（`turntable-dual`）**：
  - 外侧物块 $B$（$m_B, r_B$）优先达到最大静摩擦触发点 $\omega_1 = \sqrt{\frac{\mu g}{r_B}}$（绳开始出现张力 $T > 0$）；
  - 随 $\omega$ 继续增大，$A$ 的静摩擦减小至零反号处 $\omega_2 = \sqrt{\frac{\mu m_B g}{m_B r_B - m_A r_A}}$；
  - 当 $f_A$ 反向达极限 $-\mu m_A g$ 时系统整体失稳滑出：$\omega_3 = \sqrt{\frac{\mu (m_A+m_B) g}{m_B r_B - m_A r_A}}$，超阈值后执行切向/径向向外动力学滑出。
- **圆锥摆（`conical-pendulum`）**：摆长 $L$ 倾角 $\theta$ 满足 $\omega = \sqrt{\frac{g}{L\cos\theta}}$，周期 $T = 2\pi\sqrt{\frac{L\cos\theta}{g}}$。
