# M10 万有引力与天体力学（astro-orbital-mechanics）物理与数值规格书

## 1. 物理背景与课标对照
- 对应人教版《必修第二册》第七章《万有引力与宇宙航行》（开普勒三大定律、宇宙速度、卫星变轨与霍曼转移、双星与限制性三体拉格朗日点）。
- 核心工程约束：
  - 严禁直接将太阳/地球尺度 ($10^{11}\text{ m}$, $10^{24}\text{–}10^{30}\text{ kg}$) 原始 SI 数值送入显式常微分积分器；
  - 必须在 `engine.ts` 内部调用 `@physforge/physics-core` 的 `createScaleContext` 构建无量纲尺度上下文 $(L_0, T_0, M_0)$，使无量纲引力参数 $GM_{\text{norm}} = 1$；
  - 采用基于 `stepVelocityVerlet` 的四阶 Yoshida 辛组合推进器，确保 50 个轨道周期以上的长时辛守恒性。

## 2. 无量纲归一化与演化方程
- 选取特征长度 $L_0 = r_1$，特征时间 $T_0 = \sqrt{L_0^3 / (GM)}$，特征质量 $M_0 = m_{\text{sat}}$：
  - $\mathbf{r}_{\text{norm}} = \mathbf{r}_{\text{SI}} / L_0$，$\mathbf{v}_{\text{norm}} = \mathbf{v}_{\text{SI}} / (L_0 / T_0)$，$t_{\text{norm}} = t_{\text{SI}} / T_0$；
  - 二体中心引力加速度：$\mathbf{a}_{\text{norm}} = -\frac{\mathbf{r}_{\text{norm}}}{|\mathbf{r}_{\text{norm}}|^3}$。
- **开普勒椭圆与第一/二宇宙速度 (`kepler-ellipse`)**：
  - 近地点初速度比 $k_v = v_0 / \sqrt{GM/r_1}$，比机械能 $\varepsilon_{\text{norm}} = \frac{1}{2}v_{\text{norm}}^2 - \frac{1}{r_{\text{norm}}}$，半长轴 $a_{\text{norm}} = -\frac{1}{2\varepsilon_{\text{norm}}}$，偏心率矢量 $\mathbf{e} = \mathbf{v}\times(\mathbf{r}\times\mathbf{v}) - \hat{\mathbf{r}}$。
  - 等时间扇形面积元 $\Delta A_k = \frac{1}{2}|\mathbf{r}\times\mathbf{v}|\Delta t$ 验证开普勒第二定律。
- **霍曼转移变轨 (`hohmann-transfer`)**：
  - 近地点瞬时切向加速 $\Delta v_1 = \sqrt{\frac{GM}{r_1}}\left(\sqrt{\frac{2r_2}{r_1+r_2}} - 1\right)$；
  - 用 `bisectEvent` 捕获径向速度 $v_r = \frac{\mathbf{r}\cdot\mathbf{v}}{r} = 0$（由正转负）即远地点 $r = r_2$，执行第二次圆化脉冲 $\Delta v_2 = \sqrt{\frac{GM}{r_2}}\left(1 - \sqrt{\frac{2r_1}{r_1+r_2}}\right)$。
- **双星与拉格朗日点 (`binary-lagrange`)**：
  - 质量比 $q = \frac{m_2}{m_1+m_2}$，共转系有效势 $\Phi_{\text{eff}}(x,y) = -\frac{1-q}{r_1} - \frac{q}{r_2} - \frac{1}{2}(x^2+y^2)$，使用 `findRootBrent` 求解 $L_1, L_2, L_3$ 及等边 $L_4, L_5$，并用 `extractIsolines` 提取零速度等势面轮廓。

## 3. 单元测试与精度卡点
1. 开普勒椭圆 ($e \approx 0.35$) 连续积分 **50 个完整周期**：半长轴与无量纲总能量相对漂移 `< 1e-6`，角动量相对漂移 `< 1e-7`；
2. 霍曼转移两次脉冲 $\Delta v_1, \Delta v_2$ 与解析解误差 `< 1e-5`，转移到达远地点后圆化偏心率 $e < 10^{-4}$；
3. 双星拉格朗日点 $L_1\text{–}L_5$ 有效势梯度 $\nabla\Phi_{\text{eff}} = 0$ 残差 `< 1e-9`；
4. 边界条件（`dt=0`、$q$ 极值）无 `NaN` / `Infinity`。
