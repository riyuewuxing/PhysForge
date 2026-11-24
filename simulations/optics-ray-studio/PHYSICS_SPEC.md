# B3 自由几何光学建模器（`builder-optics-ray`）物理建模规范

- **规范 ID**：`builder-optics-ray`（兼容 V1.0 旧 ID：`optics-ray-studio`）
- **核心算法**：基于 `refractVector2D` 的多级界面斯涅尔矢量折射与全反射判据（$\sin\theta_t = \frac{n_1}{n_2}\sin\theta_i \ge 1$）、平行玻璃砖侧移 $\Delta x = d\frac{\sin(\theta_1-\theta_2)}{\cos\theta_2}$、三棱镜柯西色散光谱、光纤连续多次反射、双缝干涉 $\Delta x = \frac{L}{d}\lambda$，以及理想薄凸透镜高斯公式 $\frac{1}{u}+\frac{1}{v}=\frac{1}{f}$ 与虚像延长虚线。
- **V2 能力**：`ControlHandle` 入射角 / 物距直操拖拽、`SceneDSL` 序列化及 `DiagramIR` 黑白光路图输出。

## V3.1 H2 界面功率契约
- 对无吸收、非磁性均匀介质界面的非偏振光，功率反射率 R=(r_s²+r_p²)/2，透射率 T=1−R。斜入射使用 Fresnel 公式。显示百分比来自真实 R/T，光晕明暗经感知压缩以可读，不是线性光强计；颜色区分光路角色，不是波长改变。相同折射率时 R=0，不绘制虚假反射线。
- 临界角等号为极限掠射、法向传播功率为零；不声称不存在倏逝场。临界角仅 n₁>n₂ 时定义。此契约仅针对 tir-interface，不替代其他五子模式的独立验收。
