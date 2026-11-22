# M01 运动学追及相遇与多过程图像（`mech-kinematics-chase`）物理建模规范

- **控制方程**：分段匀变速与单向刹车锁止：
  - $A$ 车：反应时间 $0 \le t < t_{\text{react}}$ 内匀速 $a_A = 0$；之后按加速度 $a_A$ 匀变速；若 $a_A < 0$，经 `bisectEvent`（$|\Delta t| \le 10^{-8}\text{ s}$）精确捕获 $v_A = 0$ 后锁止为 $v_A \equiv 0$（绝不倒车）。
  - $B$ 车：初始超前 $\Delta x_0$，按加速度 $a_B$ 匀变速；同样支持单向刹车锁止 $v_B \equiv 0$。
- **临界事件捕获**：利用 `bisectEvent` 在 $[0, \Delta t]$ 内高精度二分收敛捕获共速时刻 $v_A - v_B = 0$（极大/极小距离时刻）与追及相遇时刻 $x_A - x_B = 0$（误差 $< 10^{-7}\text{ s}$）。
- **V2 能力**：`ControlHandle` 拖拽初始间距、随动 `car-a` 参考系及 `DiagramIR` 黑白追及过程示意图。
