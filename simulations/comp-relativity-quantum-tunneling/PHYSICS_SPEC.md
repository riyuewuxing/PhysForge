# C03 狭义相对论时空图与一维量子波包隧穿（comp-relativity-quantum-tunneling）

## 1. 狭义相对论时空图（`mode = 'minkowski-relativity'`）
- 洛伦兹变换：$(x', ct') = \gamma(x - \beta c t,\ c t - \beta x)$，严格校验固有时空间隔不变量 $\Delta s^2 = (ct)^2 - x^2$ 跨参考系相对误差 $< 10^{-10}$。
- 同屏可视化光锥 $|x|=ct$、类时/类空不变双曲线、同时线倾斜与双生子佯谬世界线固有时对比。

## 2. 一维含时薛定谔方程 Crank-Nicolson 隐式求解器（`mode = 'tdse-tunneling'`）
- 512 格空间网格（$x \in [-50, 50]$），$\hbar=1, m=1$：
  $$\left(I + \frac{i \Delta t}{2} H\right)\psi^{n+1} = \left(I - \frac{i \Delta t}{2} H\right)\psi^n$$
  以复数三对角 Thomas 算法严格求解，凯莱幺正算子 $(I+iK)^{-1}(I-iK)$ 保证 **1000 步总概率归一化漂移 $< 10^{-10}$**。
- 支持单势垒、双势垒共振隧穿与方势阱，实时积分左侧反射率 $R(t)$ 与右侧透射率 $T(t)$；满足 $E_0 < V_0$ 时 $T > 0$ 且随势垒厚度增加指数衰减。
