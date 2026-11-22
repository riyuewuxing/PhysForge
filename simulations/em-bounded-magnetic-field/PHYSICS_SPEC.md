# B1 自由复合场建模器（`builder-composite-em-field`）物理建模规范

- **规范 ID**：`builder-composite-em-field`（兼容 V1.0 旧 ID：`em-bounded-magnetic-field`）
- **控制方程**：$\frac{d\mathbf{v}}{dt} = \frac{q}{m}(\mathbf{E} + \mathbf{v}\times\mathbf{B})$
- **数值积分器**：纯磁场及恒定正交电磁场采用时间反演对称 Boris 推力器 `stepBorisPusher`；有界区域边界（半空间、圆形、矩形）通过 Signed Distance Function + `bisectEvent`（精度 $|\Delta t| \le 10^{-8}\text{ s}$）捕获进出磁场界面的精确时刻与位置，分段推进避免跨界数值耗散。
- **V2 能力**：9 束平行光磁聚焦、斜入旋转圆/放缩圆/平移圆、配速法 $\mathbf{v}_d = \mathbf{E}\times\mathbf{B}/B^2$ 正交分解、逆问题临界半径求根 `solveCriticalSpeedForRadius`、直操手柄、Auto-FBD 洛伦兹力与电场力分解、随动参考系及黑白试卷 `DiagramIR`。
