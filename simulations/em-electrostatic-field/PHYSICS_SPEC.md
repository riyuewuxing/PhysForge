# E01 多点电荷静电场、等势面与粒子偏转（em-electrostatic-field）物理与数值规格书

## 1. 物理背景与课标对照
- 对应人教版《必修第三册》第九章、第十章（库仑定律、电场强度叠加、电势与等势面、匀强场三点等分法、带电粒子在匀强电场中的加速与偏转）。
- 尺度归一化：长度以 $L_0 = 1\text{ m}$、电荷以 $Q_0 = 1\ \mu\text{C}$、库仑常量缩放至特征场强单位 $k_e Q_0 / L_0^2 \mapsto 1$，试探粒子荷质比 $\eta = q_{\text{test}}/m$ 以无量纲推进（并用 `createScaleContext` 映射回物理单位）。

## 2. 核心算法
1. **点电荷叠加场 (`dipole-point-charges`)**：
   - 双电荷 $q_1, q_2$ 位于 $(x_1, y_1), (x_2, y_2)$，软化截断 $\delta = 0.04$ 避免奇点：
     $$\varphi(\mathbf{r}) = \sum_{k=1}^{2} \frac{q_k}{\sqrt{|\mathbf{r}-\mathbf{r}_k|^2 + \delta^2}}, \qquad \mathbf{E}(\mathbf{r}) = -\nabla\varphi(\mathbf{r})$$
   - 调用 `@physforge/physics-core` 的 `extractIsolines` 提取等势线；从电荷周围按四阶 `stepRK4` 正/反向追踪静电电场线；试探粒子调用自适应 `integrateAdaptiveRK45` 推进轨迹。
2. **匀强电场三点等分法 (`uniform-three-point`)**：
   - 给定不共线三点 $A, B, C$ 的电势 $\varphi_A, \varphi_B, \varphi_C$，通过线性梯度方程求解唯一匀强场强 $\mathbf{E}$，并在高/低电势顶点连线标注与目标中值点同电势的等分等势线（严格正交 $\mathbf{E}$）。
3. **带电粒子偏转示波管极限 (`deflection-tube`)**：
   - 加速电压 $U_1$ 与偏转板电压 $U_2$、板长 $L_p$、板间距 $d$，采用 `integrateAdaptiveRK45` 求解板内运动，检验出射偏转位移 $y_{\text{exit}} = \frac{U_2 L_p^2}{4 d U_1}$。

## 3. 单元测试与精度卡点
1. 等势面切向量 $\hat{\mathbf{t}}_{\text{iso}}$ 与场强 $\mathbf{E}$ 夹角与 $90^\circ$ 偏差 `< 1°`；
2. 无外驱点电荷场中 `RK45` 试探粒子总能量 $E_k + q_{\text{test}}\varphi$ 相对漂移 `< 1e-5`；
3. 三点等分法求解场强与等势线正交性 `< 1e-10`，偏转板解析偏转距离相对误差 `< 1e-6`；
4. 边界值（$q_1=q_2=0$、$q_{\text{test}}=0$、`dt=0`）无 `NaN` / `Infinity`。
