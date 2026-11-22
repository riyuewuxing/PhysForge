# M02 动态平衡几何图解（`mech-dynamic-equilibrium`）物理建模规范

- **控制方程**：准静态矢量平衡 $\mathbf{F}_1 + \mathbf{F}_2 + \mathbf{G} = \mathbf{0}$。
- **典型模型对比**：
  1. `active-pulley-knot`（活结等张力模型）：跨过光滑轻滑轮的同一根轻绳张力恒满足 $T_1 \equiv T_2 = \frac{mg}{2\sin\theta}$；
  2. `dead-knot-rotate`（死结转绳与矢量闭合三角形）：固定方向夹角为 $\alpha$ 时，旋转施力 $\mathbf{F}_2$ 与水平方向夹角 $\beta$，由正弦定理求解析张力，极小拉力恰出现在 $\mathbf{F}_2 \perp \mathbf{F}_1$ 处（$F_{2,\min}=mg\cos\alpha$）；
  3. `hemisphere-similar`（光滑半球/辅助圆相似三角形）：重力与几何高度比 $R/(R+h)$ 成正比；
  4. `hinged-rod`（活杆 vs 定杆方向判别）。
- **V2 能力**：`Auto-FBD` 正交分解矢量与 `DiagramIR` 矢量闭合三角形输出。
