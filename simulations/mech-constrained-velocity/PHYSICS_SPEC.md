# M03 关联速度分解与约束导数模型（`mech-constrained-velocity`）物理建模规范

- **约束全导数**：不可伸长轻绳或刚杆连接 $A, B$ 两质点时，$\mathbf{v}_A \cdot \hat{\mathbf{e}}_{AB} = \mathbf{v}_B \cdot \hat{\mathbf{e}}_{AB}$。
- **内置 3 场景**：
  1. `rope-pull-boat`（河岸高 $H$ 滑轮收绳拉船）：收绳速率 $v_{\text{rope}}$ 恒定时，$v_{\text{boat}} = \frac{v_{\text{rope}}}{\cos\theta}$，解析加速度 $a_{\text{boat}} = \frac{v_{\text{rope}}^2 \sin^2\theta}{x \cos^2\theta} = \frac{v_{\text{rope}}^2 \tan^3\theta}{H}$（沿收绳指向变加速）；
  2. `ladder-wall`（直杆斜靠墙角下滑）：端 $A$ 沿墙竖直下移速率 $v_A$，端 $B$ 沿地面水平速度 $v_B = v_A \tan\theta$；
  3. `wedge-rod`（斜面推杆）：斜面水平速率 $v_1$ 推动竖直杆上移速率 $v_2 = v_1 \tan\alpha$。
- **V2 能力**：`ControlHandle` 拖拽位置/倾角、合速度与沿绳/垂绳正交分量双视图及 `DiagramIR` 关联分解配图。
