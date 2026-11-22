# B4 自由力学约束与多刚体建模器（`builder-mechanics-lab`）物理建模规范

- **规范 ID**：`builder-mechanics-lab`（兼容 V1.0 旧 ID：`mech-free-sandbox`）
- **双求解器架构**：
  1. **解析约束模式（默认确定性模式）**：基于 `solveUdwadiaKalaba` 精确求解阿特伍德机不可伸长轻绳约束（$\ddot{y}_1+\ddot{y}_2=0$），直接输出解析张力 $T = \frac{2m_1 m_2 g}{m_1+m_2}$；无阻尼弹簧振子采用 Velocity-Verlet 对称辛步进保持 20s 机械能漂移 $< 10^{-6}$。
  2. **Rapier2D 多刚体沙箱模式**：按需动态加载 `@dimforge/rapier2d-compat` WASM，支持多体碰撞、斜面滑块与牛顿摆。
- **V2 能力**：`ControlHandle` 直操、`Auto-FBD` 重力/张力/弹力分解、质心随动参考系及 `DiagramIR` 导出。
