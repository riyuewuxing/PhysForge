# X01 力学核心实验真误差仿真台（exp-mechanics-error-lab）

## 1. 系统误差动力学真值方程
$$a_{\text{true}}(m) = \frac{m g + M g\sin\theta - f}{M + m}$$
- **四种高考 $a\text{--}F_{\text{app}}$（$F_{\text{app}} = m g$）异常图线全复现**：
  1. 恰当平衡摩擦力（$M g\sin\theta = f,\ m \ll M$）：过原点直线；
  2. 未平衡或平衡不足（$M g\sin\theta < f$）：横轴（$F$ 轴）正截距 $F_0 = f - M g\sin\theta$；
  3. 过度平衡倾角过大（$M g\sin\theta > f$）：纵轴（$a$ 轴）正截距 $a_0 = \frac{M g\sin\theta - f}{M}$；
  4. 未满足 $m \ll M$ 尾部下弯：精确曲线 $a(F_{\text{app}}) = \frac{F_{\text{app}}}{M + F_{\text{app}} / g}$。

## 2. 50 Hz 打点纸带 + Seeded 高斯噪声 + 逐差法与最小二乘拟合
- 使用 `createSeededPrng(seed).gaussian(0, sigmaMm)` 注入毫米刻度随机读数噪声，六段逐差法 $a = \frac{(s_4+s_5+s_6)-(s_1+s_2+s_3)}{9 T^2}$（$T=0.1\text{ s}$）在 $\sigma=0$ 时误差 $< 10^{-10}$；支持 Phyphox/Tracker CSV 数据叠合展示。

## 3. F08 independent regression contract (candidate, red evidence pending)
- The heavy-hanger mode changes the sweep masses, not the force law. Nonzero positive compensation bias must appear in both the active tape and every analytic / measured sweep point. The nominal balanced special case retains the existing exact tolerance.
- The unloaded, positive-acceleration theoretical intercept is the limit at exactly m=0; do not insert a hidden positive mass. The supported UI hanger interval is unchanged.
- All four scenarios stated above must have explicit selectable presets. The ideal compensation preset has zero net bias; finite-mass curvature is not claimed to be exactly linear.
- A measured curve drawn for any supported parameter combination must lie inside its exported DiagramIR viewBox, with its real data unchanged. No clipping or saturating numerical values to force fit.
- Negative net force requires a clearly stated motion/friction assumption. No signed-motion or static-friction policy is changed by these red-only tests; resolve that separate ambiguity in the candidate specification before implementation.
- User-supplied experimental data and built-in illustrative data must not be conflated. No new external empirical data are supplied with these tests.

## 4. H57 candidate interpretation and geometry
- The tape is a six-interval sample of **already forward-moving** cart/hanger motion, not a static-friction or release-from-rest simulator. The constant resisting force acts opposite the forward velocity. The initial speed is chosen as 0.15 + max(0,-0.6a) m/s so the analytic velocity remains at least 0.15 m/s throughout the 0.6 s window. Negative net force gives signed negative acceleration and decreasing intervals; no clipping or reversing without changing the friction model.
- Four preset comparisons use the same equation. Heavy-hanger changes only sampled masses; the exact balanced curve is F/(M+F/g), not exactly linear. The ideal preset is appended so prior IDs and indices remain. The signed theory's zero force/acceleration axes are explicit; the OLS fit is not the exact theory.
- Canvas and DiagramIR consume the same graph primitives. Measured, theory, OLS and CSV roles are separate; axes and limits are derived from data without numerical saturation. The ruler's affine domain depends on tape coordinates and the allowed zero offset range, never the current zero offset, so dragging cannot rescale itself. Labels are readings relative to that zero; translating it leaves differences and acceleration unchanged.
- CSV is illustrative unless provenance is provided. The existing selector contains a built-in teaching sample, not verified real experimental data. Parser accepts exactly two finite numeric columns, 0≤F≤100 N and |a|≤100 m/s²; malformed/missing/out-of-domain rows are not plotted. This is a bounded input policy, not a real measurement guarantee.
- This candidate is unverified until same-head tests and real screenshots. No claim of a full 50 Hz animation: the seven points shown are every fifth tick (0.1 s).

## 5. H58 视觉与操作验收（候选，未运行）
- 图例使用实线表示精确理论、虚线表示 OLS 拟合、实心圆表示纸带测点；测点不再以另一条虚线连起来。黑白导出无需依赖颜色区分，测点回归检查实际导出圆心与半径，不能只查模型数据。
- 横纵轴、纸带定量标签固定在对应位置；七个纸带读数在独立的顺序单元格内显示，不能由通用避让算法移动或省略。纸带标识明确预先正向运动与恒阻力假设；不是从静止释放。
- 离线示波图仅在实际采样后显示经过时间（s），不得用日历日期代替。符号公式与代入数值分开，浏览器应检查在线公式真实溢出、实际零点手柄拖动及离线采样坐标。
- 内置 CSV 为明确标记的教学样例；当前选择器不宣称具备任意外部文件上传入口。此项保持现有范围。
- 这些修改须在同一 HEAD 下通过单测、隔离构建、在线与离线浏览器审计及人工原图检查后才可准入。
