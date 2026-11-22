# M09 碰撞与反冲模型（mech-collision-recoil）物理与数值规格书

## 1. 物理背景与课标对照
- 对应人教版《选择性必修第一册》第一章《动量守恒定律》（弹性碰撞、非弹性碰撞、二维斜碰、子弹打木块与人船/反冲模型）。
- 核心教学目标：
  1. 动量守恒条件（合外力为零或内力远大于外力）与牛顿恢复系数 $e \in [0, 1]$ 对动能损失的定量刻画；
  2. 一维/二维碰撞中的**动量矢量三角形**，以及等质量弹性斜碰 $m_1 = m_2, v_{20}=0, e=1 \implies \mathbf{v}_1' \perp \mathbf{v}_2'$；
  3. 子弹打木块内力做功与系统摩擦生热 $Q = f d_{\text{rel}} = \Delta E_k$；
  4. 人船/光滑曲面反冲模型中**质心位置恒定不变** $x_{\text{cm}}(t) \equiv x_{\text{cm}}(0)$。

## 2. 坐标系、状态向量与演化方程
- 惯性系坐标 $(x, y)$；质心速度参考系 $V_{\text{cm}} = \frac{m_1 \mathbf{v}_1 + m_2 \mathbf{v}_2}{m_1 + m_2}$。
- **二维球形碰撞 (`collision-2d-oblique` & `collision-1d`)**：
  - 状态：$\mathbf{r}_1, \mathbf{v}_1, \mathbf{r}_2, \mathbf{v}_2, t$。
  - 接近条件：$|\mathbf{r}_1 - \mathbf{r}_2| \le R_1 + R_2$ 且 $(\mathbf{v}_1 - \mathbf{v}_2)\cdot \hat{\mathbf{n}} > 0$（$\hat{\mathbf{n}} = \frac{\mathbf{r}_2 - \mathbf{r}_1}{|\mathbf{r}_2 - \mathbf{r}_1|}$）。
  - 通过 `bisectEvent` 将碰撞时刻精确二分至 $|\Delta t| \le 10^{-7}\text{ s}$。
  - 接触法向冲量：
    $$J_n = \frac{(1 + e) m_1 m_2}{m_1 + m_2} (\mathbf{v}_1 - \mathbf{v}_2)\cdot \hat{\mathbf{n}}$$
    $$\mathbf{v}_1' = \mathbf{v}_1 - \frac{J_n}{m_1}\hat{\mathbf{n}}, \qquad \mathbf{v}_2' = \mathbf{v}_2 + \frac{J_n}{m_2}\hat{\mathbf{n}}$$
- **子弹打木块 (`bullet-block`)**：
  - 接触前自由平动；用 `bisectEvent` 捕获撞击入靶时刻；
  - 穿行阶段受恒定阻力 $f$：$a_1 = -f/m_1, a_2 = f/m_2$；相对位移 $d_{\text{rel}} = \int (v_1 - v_2)\,\mathrm{d}t$；
  - 用 `bisectEvent` 精确捕获共速时刻 $v_1 - v_2 = 0$ 或穿出时刻 $d_{\text{rel}} = L_{\text{block}}$。
- **人船反冲 (`boat-recoil`)**：
  - 人与船（或滑块与光滑曲面槽）初始静止，人在船上以光滑相对速度 $v_{\text{rel}}(t)$ 从船左端走向右端：
    $$m_1 v_1 + m_2 v_2 = 0 \implies v_1 = \frac{m_2}{m_1+m_2} v_{\text{rel}}, \quad v_2 = -\frac{m_1}{m_1+m_2} v_{\text{rel}}$$

## 3. 解析特例与单元测试卡点
1. 任意恢复系数 $e \in [0, 1]$ 碰撞前后动量误差 $< 10^{-10}\text{ kg}\cdot\text{m/s}$；
2. $e = 1$ 弹性碰撞动能守恒误差 $< 10^{-10}\text{ J}$；
3. 等质量二维斜碰 ($m_1 = m_2, e = 1, v_{20} = 0, b \ne 0$) 碰后两球速度严格正交 $|\mathbf{v}_1' \cdot \mathbf{v}_2'| < 10^{-9}$；
4. 子弹打木块热损耗等于机械能损失，误差 $< 10^{-9}\text{ J}$；人船质心漂移 $|x_{\text{cm}}(t) - x_{\text{cm}}(0)| < 10^{-10}\text{ m}$；
5. 参数边界（$b=0, e=0, v_{10}=0, dt=0$）无 `NaN` / `Infinity`。
