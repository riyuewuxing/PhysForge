# B3 自由几何光学建模器（`builder-optics-ray`）物理建模规范

- **规范 ID**：`builder-optics-ray`（兼容 V1.0 旧 ID：`optics-ray-studio`）
- **核心算法**：基于 `refractVector2D` 的多级界面斯涅尔矢量折射与全反射判据（$\sin\theta_t = \frac{n_1}{n_2}\sin\theta_i \ge 1$）、平行玻璃砖侧移 $\Delta x = d\frac{\sin(\theta_1-\theta_2)}{\cos\theta_2}$、三棱镜柯西色散光谱、光纤连续多次反射、双缝干涉 $\Delta x = \frac{L}{d}\lambda$，以及理想薄凸透镜高斯公式 $\frac{1}{u}+\frac{1}{v}=\frac{1}{f}$ 与虚像延长虚线。
- **V2 能力**：`ControlHandle` 入射角 / 物距直操拖拽、`SceneDSL` 序列化及 `DiagramIR` 黑白光路图输出。
