# 直流与含容电路改进节点分析法模型（`circuit-dc-capacitor-mna`）物理建模规范

## 1. 合规声明与算法选择
- 本模块 **100% 零 GPL 代码引入**，完全依据公开电子电路数值分析标准 **MNA（Modified Nodal Analysis，改进节点分析法）** 从零使用纯 TypeScript 实现。
- 对任意线性时不变阻容网络构建增广导纳矩阵 $\mathbf{A}\mathbf{x} = \mathbf{b}$，未知量 $\mathbf{x} = [\mathbf{v}_{\text{nodes}}, \mathbf{i}_{\text{sources}}]^T$，以部分主元高斯消元求解各节点电势与支路电流。

## 2. 元件印记（MNA Stamps）与瞬态离散
1. **线性电阻 $R$**（接节点 $a, b$）：贡献导纳 $g = 1/R$ 到 $G_{aa}, G_{bb}, G_{ab}, G_{ba}$。
2. **独立直流电压源 $V$**（正极 $p$、负极 $n$）：引入支路电流未知数 $i_V$，施加 KVL 约束 $v_p - v_n = V$。
3. **电容器 $C$**（接节点 $a, b$，步长 $\Delta t$）：采用二阶精度梯形积分（Trapezoidal Rule）伴随电阻模型，避免一阶数值阻尼偏大：
   $$g_C = \frac{2C}{\Delta t}, \quad i_{\text{hist}} = g_C u_C^{(n)} + i_C^{(n)}$$
   稳态分析或开路孤岛切换时严格保护电荷与电压连续性。

## 3. 四大高中教学拓扑与解析校验
1. **`closed-power`（闭合电路欧姆定律与输出功率极值）**：$I = \frac{E}{R + r}$，$U = E - Ir$，$P_{\text{out}} = I^2 R$（$R = r$ 时取极大值 $\frac{E^2}{4r}$）。
2. **`series-parallel-dynamic`（混联电路滑变“串反并同”）**：$R_1$ 串联 $(R_2 \parallel R_p)$，由 MNA 精确求解节点电压与各支路电流。
3. **`rc-transient`（RC 充放电瞬态响应）**：充电解析解 $u_C(t) = E(1 - e^{-t/\tau})$，放电解析解 $u_C(t) = U_0 e^{-t/\tau}$（$\tau = R_{\text{eq}} C$）。
4. **`rc-bridge-charge`（电桥含容支路电荷计算）**：双分压支路中间跨接电容 $C$，动态演示调节滑变过程中电容两端电势差变化与电荷量 $Q = C (U_A - U_B)$ 正负极反转。

## 4. 验收指标
- 闭合电路与混联桥式电路基尔霍夫 KCL/KVL 残差 $< 10^{-10}$；
- RC 充电与放电瞬态曲线与解析指数解相对误差 $< 10^{-4}$；
- 极值参数（$E=0$、$r=0$、$dt=0$）零 `NaN / Infinity`。
