# T01 汽缸活塞、水银柱与变质量充放气模型（thermo-piston-gas-laws）物理与数值规格书

## 1. 物理背景与课标对照
- 对应人教版《选择性必修三》第二章《气体、固体和液体》（玻意耳定律、查理定律、盖-吕萨克定律、理想气体状态方程及变质量充放气模型）。
- 核心方程：
  - 理想气体常量：$R = 8.31446261815324\text{ J/(mol}\cdot\text{K)}$；严格保持 $PV/(nRT) = 1$；
  1. **带卡口竖直汽缸 (`stop-pin-cylinder`)**：
     - 活塞质量 $m_p$、面积 $A$、大气压 $P_0$，等压平衡压强 $P_{\text{eq}} = P_0 + m_p g / A$；
     - 采用 `stepHybridAutomaton` 管理离散模态切换：`pinned`（卡口限位容积 $V_{\text{pin}}$ 下等容升温）$\to$ `bisectEvent` 精确捕获脱离卡口临界温度 $T_{\text{crit}} = \frac{P_{\text{eq}} V_{\text{pin}}}{n R}$ $\to$ `floating`（等压自由膨胀 $V = \frac{n R T}{P_{\text{eq}}}$）。
  2. **倾转水银柱玻璃管 (`mercury-tube-tilt`)**：
     - 密闭气体压强 $P = P_0 + \rho_{\text{Hg}} g h_{\text{Hg}} \sin\theta$，水银柱高度换算 `76 cmHg = P0`，检验管长边界溢出判别。
  3. **变质量打气与抽气 (`multi-stroke-pump`)**：
     - 每次抽气等温膨胀后分断，经 $k$ 次抽气容器压强解析通式：$P_k = P_0 \left(\frac{V}{V + \Delta V}\right)^k$。

## 2. 单元测试与精度卡点
1. 全流程任意时刻理想气体状态比误差 $|PV/(nRT) - 1| < 10^{-10}$；
2. 多次抽气数值迭代与 $P_0 (V/(V+\Delta V))^k$ 相对误差 `< 10^{-10}`；
3. 卡口汽缸脱离临界温度捕获误差 `< 10^{-7}\text{ K}`；
4. 边界条件（`dt=0`, $\theta=0$, $k=0$）无 `NaN` / `Infinity`。
