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

## 4. V3.1 M10 物理一致性专项（Turn08）
- 等时扇区须在真实积分的归一化时间边界 \(t_n=0.55n\) 分割子步，输出每个完整区间的真实轨迹多边形及面积；不得用外层帧时间替代，亦不得用理论面积冒充多边形面积。历史点存各自的 \(t_{\rm norm}\)，共转显示逐点使用 \(R(-t_i)\mathbf r_i\)。
- 双星模式是圆型限制性三体，归一化总质量为1、星间距为1、共转角速度为1。统一质量比、引力与有效势：点质量外部严格 Newton 引力；只在极近核心内使用连续有限球势（核心半径 0.001 归一化单位），此区不是精确点质量散射，禁止据此宣称近碰撞精度。三体专用守恒量 \(C=2U+x^2+y^2-|\mathbf v-\boldsymbol\Omega\times\mathbf r|^2\)，其中 \(U\) 与实际动力学使用同一引力势。L1–L5 的精确根位于核心之外，图中等势线与实际势一致。普通惯性系机械能不守恒；不将二体偏心率/半长轴解释为三体轨道根数。
- 霍曼事件精度和二体原守恒阈值保持；预设名明确理想目标半径2.4倍而非真实地球同步轨道，逃逸初值采用精确 sqrt(2)。
- 先提交独立红灯测试（圆轨道解析扇区、逐点时间、精确L4、独立DOP853三体参考、精确逃逸阈值）再修正实现，不放宽原阈值。

- 初始 r₁ 并非恒为近地点：v₀低于圆轨道速度时初始点为远地点。解析 conic guide 统一 Canvas/3D/DiagramIR，虚线解析路径与暖色真实积分轨迹区分，近临界椭圆只裁显示引导线，不误分类；霍曼只画解析半椭圆。M10四预设真实浏览器运行、实际示波器、点火/扇区/雅可比/抛物线断言、2D/3D暂停时刻与真实轨迹顶点核对。