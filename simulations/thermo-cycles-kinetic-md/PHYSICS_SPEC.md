# T02 热力学循环与分子动理论微观盒（thermo-cycles-kinetic-md）物理与数值规格书

## 1. 物理背景与课标对照
- 对应人教版《选择性必修三》第一章《分子动理论》（布朗运动、气体分子速率统计麦克斯韦分布、气体压强微观解释）与第三章《热力学定律》（第一/二定律、卡诺循环与矩形循环效率）。
- 核心方法：
  1. **封闭热力学循环 (`cycle-carnot`, `cycle-rect-pv`)**：
     - 四段解析求取做功 $W_i$、吸放热 $Q_i$、内能变 $\Delta U_i$ 与循环效率 $\eta = \sum W_i / \sum_{Q_i>0} Q_i$，对照卡诺理想效率上限 $\eta_C = 1 - T_C / T_H$。
  2. **二维空间哈希硬球 MD 与布朗运动 (`kinetic-md-box`)**：
     - 严格禁用 `Math.random()`，采用 `@physforge/physics-core` 的确定性 `createSeededPrng(seed)` 在无重叠晶格上初始化 $N \in [100, 400]$ 个弹性硬球分子（及可选大质量布朗花粉微粒）；
     - 每步调用 `SpatialHash2D.resolveDiskCollisions(particles, 1.0)`（$\mathcal{O}(N)$ 邻域弹性碰撞与防穿透修正），器壁绝对弹性反射统计微观瞬时压强 $P_{\text{wall}}$。

## 2. 单元测试与精度卡点
1. 卡诺与矩形封闭循环满足 $|\sum\Delta U_i| < 10^{-10}\text{ J}$ 且 $|\sum Q_i - \sum W_i| < 10^{-8}\text{ J}$；
2. 绝热硬球盒连续推进 **1000 步**：总动能相对漂移 `< 1e-8`；
3. $N=300$ 分子弛豫后速率分布通过与理论二维麦克斯韦分布 $F(v) = 1 - \exp(-v^2 / v_{\text{rms}}^2)$ 的 Kolmogorov-Smirnov 统计检验（$D_{300} < 1.36/\sqrt{300}$）；
4. 参数边界（`dt=0`, `seed` 复现）一致无 `NaN`。
