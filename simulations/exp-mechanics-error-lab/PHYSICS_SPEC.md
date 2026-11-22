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
