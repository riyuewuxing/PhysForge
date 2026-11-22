# B5 通用方程与拉格朗日实验室（`builder-custom-ode-lab`）物理建模规范

- **规范 ID**：`builder-custom-ode-lab`
- **公式安全沙箱**：禁止一切 `eval` / `new Function` / 原型链与对象索引访问；仅按需动态加载 `mathjs >= 15.2.0` 进行表达式语法树校验，白名单变量（`x, v, y, vx, vy, t, theta, omega, k, m, g, A, w, gamma, mu, pi, e`）与白名单初等函数，并限制表达式长度 `<= 256`、AST 节点总数 `<= 80`。
- **内置物理模板**：
  1. `harmonic-custom`：受驱阻尼线性/非线性振子 $a = F(x,v,t)/m$（`RK4` 积分）；
  2. `lagrangian-pendulum`：一自由度受驱阻尼拉格朗日单摆 $\ddot{\theta} = -\frac{g}{L}\sin\theta - \gamma\dot{\theta} + A\cos(\omega_d t)$（`RK4`）；
  3. `kepler-2d`：二维中心万有引力 $\ddot{\mathbf{r}} = -\frac{\mu}{r^3}\mathbf{r}$（`VelocityVerlet` 对称辛积分保持能量与角动量守恒 $< 10^{-6}$）；
  4. `custom-expr`：自定义白名单表达式加速度模板 `dv/dt = expr(x, v, t)`（`RK4`）。
