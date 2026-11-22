# C02 混沌双摆、耦合振子简正模与非惯性科里奥利力（comp-chaos-normal-coriolis）

1. **欧拉-拉格朗日双摆（`double-pendulum`）**：自适应 Dormand-Prince `integrateAdaptiveRK45`（`tol = 1e-10`），同场演化主双摆与 $+\delta\theta = 10^{-4}\text{ rad}$ 邻近轨线，30 秒机械能漂移 $< 10^{-6}$ 并收集庞加莱截面点。
2. **双耦合振子简正模（`normal-modes`）**：四阶/辛 `stepVelocityVerlet` 求解同相 $\omega_1 = \sqrt{k_w / m}$ 与反相 $\omega_2 = \sqrt{(k_w + 2 k_c) / m}$ 简正模，零交叉测定频率误差 $< 10^{-5}$，支持单球激振能量周期拍频往返。
3. **非惯性系科里奥利力（`coriolis-disk`）**：惯性系自由直线轨道与转动圆盘内非惯性系直接积分（$-2\boldsymbol{\Omega}\times\mathbf{v}_r - \boldsymbol{\Omega}\times(\boldsymbol{\Omega}\times\mathbf{r}_r)$）实时对照，双系偏差 $< 10^{-6}$。
