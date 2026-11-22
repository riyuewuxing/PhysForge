# E06 感生涡旋电场与电磁阻尼（em-eddy-vortex-field）物理与数值规格书

## 1. 物理背景与课标对照
- 对应人教版《选择性必修二》第二章 第4节（麦克斯韦涡旋电场假说、电子感应加速器、电磁阻尼与整块/开槽铜盘阻尼对比）。
- 核心方程：
  1. 柱对称变化磁场（半径 $R_c$）产生的涡旋电场：
     $$E_\theta(r) = \begin{cases} \dfrac{r}{2}|\dot{B}|, & r \le R_c \\[4pt] \dfrac{R_c^2}{2r}|\dot{B}|, & r > R_c \end{cases}$$
     满足麦克斯韦法拉第环流定律：
     $$\oint_C \mathbf{E}\cdot\mathrm{d}\mathbf{l} = -\frac{\mathrm{d}\Phi_B}{\mathrm{d}t} = -\dot{B}\cdot\text{Area}(C \cap D_{R_c})$$
  2. **电子感应加速器试探粒子**：受涡旋切向电场加速 + 洛伦兹向心力弯曲，四阶 `stepRK4` 推进。
  3. **电磁阻尼双摆对比**：整块铜摆（$\gamma_{\text{solid}}$ 强涡流阻尼）与开槽梳状铜摆（$\gamma_{\text{slotted}} \ll \gamma_{\text{solid}}$ 切断涡流回路）并行对比。

## 2. 单元测试与精度卡点
1. 任意闭合圆环及偏移闭合矩形环路积分 $\oint \mathbf{E}\cdot d\mathbf{l}$ 与 $-d\Phi_B/dt$ 相对误差 `< 1e-8`；
2. 整块铜板摆振幅衰减显著快于开槽铜板摆（$|\theta_{\text{solid}}| < 0.3|\theta_{\text{slotted}}|$）；
3. 边界条件（$\dot{B}=0, dt=0$）无 `NaN` / `Infinity`。
