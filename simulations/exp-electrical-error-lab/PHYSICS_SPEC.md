# X02 电学核心实验真误差仿真台（exp-electrical-error-lab）

全部电路测量均基于非理想 MNA（`solveNonlinearMna`）求解：
1. **测电源电动势与内阻（`emf-inner-outer`）**：
   - 电压表直接并接电源（相对外接分流，$I$ 漏流 $U/R_V$）：$E_{\text{测}} = \frac{R_V}{R_V + r} E < E,\quad r_{\text{测}} = \frac{r R_V}{r + R_V} < r$；
   - 电流表直接串联在电源旁（相对内接分压，$U_A = I R_A$）：$E_{\text{测}} = E,\quad r_{\text{测}} = r + R_A > r$；
   - 多挡负载电阻 MNA 实跑线性拟合斜率/截距与非理想解析值误差 $< 10^{-6}$。
2. **描绘小灯泡伏安特性（`bulb-iv-curve`）**：使用非线性幂律灯丝 `kind: 'lamp'` 跑分压/限流电路对比全压起点与非线性发热弯曲。
3. **半偏法测电流表内阻（`half-bias-rg`）**：非理想 MNA 精确求解半偏电阻箱读数 $R_2$，证明严格有 $R_{g,\text{测}} < R_{g,\text{真}}$，且随主干电阻 $R_1 \to \infty$ 收敛至真值。
4. **游标卡尺（10/20/50 分度）与螺旋测微器**：零漂移双向精准读数模型。
