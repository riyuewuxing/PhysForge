# B1 自由复合场建模器（`builder-composite-em-field`）物理建模规范

- **规范 ID**：`builder-composite-em-field`（兼容 V1.0 旧 ID：`em-bounded-magnetic-field`）
- **控制方程**：$\frac{d\mathbf{v}}{dt} = \frac{q}{m}(\mathbf{E} + \mathbf{v}\times\mathbf{B})$
- **数值积分器**：纯磁场及恒定正交电磁场采用时间反演对称 Boris 推力器 `stepBorisPusher`；有界区域边界（半空间、圆形、矩形）通过 Signed Distance Function + `bisectEvent`（精度 $|\Delta t| \le 10^{-8}\text{ s}$）捕获进出磁场界面的精确时刻与位置，分段推进避免跨界数值耗散。
- **V2 能力**：9 束平行光磁聚焦、斜入旋转圆/放缩圆/平移圆、配速法 $\mathbf{v}_d = \mathbf{E}\times\mathbf{B}/B^2$ 正交分解、逆问题临界半径求根 `solveCriticalSpeedForRadius`、直操手柄、Auto-FBD 洛伦兹力与电场力分解、随动参考系及黑白试卷 `DiagramIR`。

## V3.1 待验证目标：有限场域的真实事件与全时间推进
- 坐标 x 向右、y 向上、B_z>0 出纸面；场外直线运动；场内及全空间正交 E_y/B_z 均为分段常场，计划采用其解析流映射而非修改公共 Boris。所有时刻仍由真实状态推进，禁止装饰轨迹。
- 事件要求：端点同侧亦能检测真实穿越；直线按凸域相交区间寻找内部样本，磁场圆弧按坐标或径向极值分割以保证事件括区，再调用共享 bisectEvent（目标时间误差≤1e-8 s）。相切而无内外符号变化不记为穿越；精确步末接触可在下一步确认，事件时间仍为边界时刻。每次出入场后推进全部余时，粒子与全局时钟同步。
- 独立复现先行：矩形中性粒子一整步穿越两边界、半空间入射半圆出射后自由飞行、假设完整磁圆首尾同侧但首次离场、相切不穿越、四分之一周期位置/速度及整周期闭合、中性粒子无 E×B 漂移。此提交仅测试与规格，预期旧算法失败，不作为候选验收。
