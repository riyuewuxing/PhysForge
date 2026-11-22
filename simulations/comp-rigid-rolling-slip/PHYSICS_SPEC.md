# C01 刚体定轴转动与滑滚转换（comp-rigid-rolling-slip）

## 1. 刚体转动惯量谱（$I = c m R^2$）
- 实心球 $c=2/5$、空心薄球壳 $c=2/3$、实心圆柱 $c=1/2$、薄圆环 $c=1$。

## 2. 水平滑动→纯滚动杂交自动机（`HybridAutomaton` + `bisectEvent`）
- 触地相对滑移速度 $v_{\text{slip}} = v - \omega R$；纯滚动守恒与临界事件二分至 $|\Delta t| \le 10^{-8}\text{ s}$。
- 当 $\omega_0 = 0, v_0 > 0$ 时，实心球严格满足：$t_c = \frac{2 v_0}{7 \mu_k g},\quad v_c = \frac{5}{7} v_0$（误差 $< 10^{-6}$）；支持初速度带强烈回旋反旋的保龄球回滚反物理演示。

## 3. 四刚体斜面纯滚竞速（`incline-race`）
- 加速度 $a = \frac{g\sin\theta}{1 + c}$，机械能守恒漂移 $< 10^{-6}$，四刚体同坡道冲刺实心球最快、薄圆环最慢。
