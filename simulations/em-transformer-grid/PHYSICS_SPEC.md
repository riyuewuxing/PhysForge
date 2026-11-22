# E08 理想变压器动态分析与远距离输电（em-transformer-grid）物理与数值规格书

## 1. 物理背景与课标对照
- 对应人教版《选择性必修二》第三章 第3、4节（理想变压器电压/电流/功率关系、原线圈串联等效电阻动态分析、高压远距离输电损耗与多用户开关动态调节）。
- 核心方程：
  1. **多路副线圈含原边电阻 $R_0$ 联立求解（`multi-tap-transformer`）**：
     $$\frac{U_2}{U_1} = \frac{n_2}{n_1}, \quad \frac{U_3}{U_1} = \frac{n_3}{n_1}, \quad U_1 I_1 = U_2 I_2 + U_3 I_3, \quad U_0 = U_1 + I_1 R_0$$
     等效输入电阻 $R_{\text{eq}} = \left(\frac{1}{n_1^2}\sum_{k=2}^3 \frac{n_k^2}{R_k}\right)^{-1}$。开关合上增加并联用户或减小 $R_2$ 时，通过比较前后基线状态自动标出各电表升降箭头 $\uparrow / \downarrow$。
  2. **远距离高压输电链（`long-distance-grid`）**：
     - 发电机输出功率 $P_{\text{gen}}$、端电压 $U_{\text{gen}}$ $\to$ 升压变压器（升压比 $k_1$）$U_{\text{high}} = k_1 U_{\text{gen}}$、$I_{\text{line}} = P_{\text{gen}} / U_{\text{high}}$ $\to$ 输电线压降 $\Delta U = I_{\text{line}} R_{\text{line}}$、线损 $\Delta P = I_{\text{line}}^2 R_{\text{line}} \propto 1/k_1^2$ $\to$ 降压变至用户电网。

## 2. 单元测试与精度卡点
1. 多路副线圈功守恒 $|\sum U_k I_k - U_1 I_1| / (U_1 I_1) < 10^{-10}$；
2. 等功率输电条件下升压比翻倍，输电线损耗严格降至原值的 `1/4`（误差 `< 1e-10`）；
3. 边界条件（负载断开/功率为零、`dt=0`）无 `NaN` / `Infinity`。
