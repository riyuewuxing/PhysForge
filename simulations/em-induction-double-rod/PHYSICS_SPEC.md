# E04 电磁感应单/双杆全族模型（em-induction-double-rod）V2 物理规格书

## 1. 覆写场景与 V1/V2 兼容范围
- **单杆切割（`single`）**：接纯电阻 $R$、电容器 $C$（含含阻 RC 充电及零阻 $R\to 0$ 理想惯量极限）、恒定电源 $E$（电磁驱动）；支持导轨倾角 $\theta$ 与粗糙摩擦因数 $\mu$。
- **双杆联动切割（`double`）**：支持等距导轨（$L_1=L_2$ 动量守恒）与**不等距导轨**（$L_1\neq L_2$ 广义动量守恒）。

## 2. 微分-代数方程与解析基准
1. 感应电流：$I = \frac{B L_1 v_1 - B L_2 v_2}{R_{\text{tot}}}$（不等距双杆），累计电荷 $q_{\text{total}} = \int I\,\mathrm{d}t$。
2. **零阻单杆接电容器（$R_{\text{tot}} \to 0$ 恒力 $F$）**：
   $$m_{\text{eff}} = m_1 + C B^2 L_1^2, \qquad a_1 = \frac{F - m_1 g\sin\theta + f}{m_1 + C B^2 L_1^2}, \qquad q = C B L_1 v_1$$
3. **不等距双杆无外力光滑导轨（$L_1 \ne L_2$）**：
   - 安培冲量关联：$m_1 \Delta v_1 = -B L_1 q$，$m_2 \Delta v_2 = +B L_2 q$，即**广义动量守恒** $m_1 L_2 v_1 + m_2 L_1 v_2 = \text{const}$；
   - 稳态电流归零条件：$L_1 v_1 - L_2 v_2 = 0$，总能量 $E_{k1}+E_{k2}+Q_{\text{焦耳}} = E_{k0}$。
