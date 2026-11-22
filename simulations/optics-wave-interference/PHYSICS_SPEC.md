# O01 光的波动性进阶（optics-wave-interference）物理与数值规格书

## 1. 物理背景与课标对照
- 对应人教版《选择性必修一》第四章 第4–6节（薄膜干涉、空气劈尖凹凸缺陷判别、增透膜、牛顿环、单缝衍射与多缝光栅缺级）。
- 核心物理方程：
  1. **薄膜等厚干涉（`thin-film-wedge`, 空气/油膜劈尖）**：
     - 反射半波损失 $\delta_{\text{half}} \in \{0, 1\}$（空气劈尖上下表面仅下表面有半波损失 $\implies \delta_{\text{half}}=1$）：
       $$\Delta = 2 n_2 d(x)\cos\theta_2 + \delta_{\text{half}}\frac{\lambda}{2}$$
     - 劈尖条纹间距：$\Delta x = \frac{\lambda}{2 n_2 \tan\alpha}$；支持表面微凸起/微凹陷缺陷检测（凸处条纹向棱边弯，凹处向厚端弯）。
  2. **牛顿环等厚干涉（`newtons-rings`）**：
     - 球面凸透镜曲率半径 $R$，空气隙厚度 $d(r) = R - \sqrt{R^2 - r^2} \approx \frac{r^2}{2R}$；
     - 第 $k$ 级暗环半径：$r_k = \sqrt{\frac{k R \lambda}{n_2}}$（含中心暗斑 $k=0$）。
  3. **夫琅禾费单缝与光栅衍射（`single-slit-grating`）**：
     $$I(\theta) = I_0 \left(\frac{\sin\beta}{\beta}\right)^2 \left(\frac{\sin(N\gamma)}{N\sin\gamma}\right)^2, \quad \beta = \frac{\pi a \sin\theta}{\lambda}, \quad \gamma = \frac{\pi d \sin\theta}{\lambda}$$
     当 $d / a = 3$ 时，第 $3$ 级主极大恰好落入单缝第 $1$ 级暗纹（$\beta = \pi$）发生严格缺级（$I < 10^{-10}$）。
- 颜色映射：全线调用 `wavelengthToRgb`（`380–750 nm`）。

## 2. 单元测试与精度卡点
1. 空气劈尖相邻亮/暗条纹间距与 $\frac{\lambda}{2 n_2 \tan\alpha}$ 误差 `< 1e-6`；
2. 牛顿环第 $1, 2, 3$ 暗环半径与 $\sqrt{k R \lambda}$ 相对误差 `< 1e-4`；
3. $d / a = 3$ 光栅第 3 级缺级相对光强 `< 10^{-10}$；
4. 参数边界（$N=1$, $dt=0$, 极小波长/零缝宽兜底）无 `NaN` / `Infinity`。
