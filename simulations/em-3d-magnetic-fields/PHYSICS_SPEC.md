# E10 3D 电磁空间场与左手/右手定则（em-3d-magnetic-fields）物理与数值规格书

## 1. 物理背景与课标对照
- 对应人教版《选择性必修二》第一章《安培力与洛伦兹力》与《必修第三册》第十三章（安培定则/右手螺旋、毕奥-萨伐尔定律空间磁场分布、左手定则判断洛伦兹力、带电粒子在 3D 磁场中的等距螺旋线运动）。
- 架构与性能红线：
  - `simulations/em-3d-magnetic-fields/engine.ts` 与 `plugin.ts` 保持 100% 零 DOM、零静态 `three` 依赖，在 Node/Vitest 下纯无头运行；
  - 3D WebGL 渲染由 `apps/web/src/stage/ThreeStage.tsx`（纯 Vanilla `three` + `OrbitControls`，`React.lazy()` 按需加载，严禁 `@react-three/fiber`）承接，切离 `E10` 时严格释放几何体、材质与 WebGL 上下文。

## 2. 数值模型与解析基准
1. **3D 毕奥-萨伐尔（Biot-Savart）离散积分**：
   $$\mathbf{B}(\mathbf{r}) = \frac{\mu_0 I}{4\pi}\sum_{k=1}^{N}\frac{\Delta\mathbf{l}_k \times (\mathbf{r} - \mathbf{r}_k')}{|\mathbf{r} - \mathbf{r}_k'|^3}$$
   支持单匝圆环、亥姆霍兹双线圈（$d = R$）、有限长螺线管、长直导线、平行双导线，以及用于螺旋线精度基准的 3D 匀强轴向磁场模式。
2. **3D Boris 推粒器**：调用 `@physforge/physics-core` 的 `stepBorisPusher` 推进 $(\mathbf{r}, \mathbf{v}) \in \mathbb{R}^3 \times \mathbb{R}^3$，天然保持纯磁场动能严格守恒，并在粒子处标注速度 $\mathbf{v}$、磁场 $\mathbf{B}$ 与洛伦兹加速度 $\mathbf{a}=(q/m)\mathbf{v}\times\mathbf{B}$（与速度和磁场分别正交，速度与磁场未必正交）。有限线圈模式的有效荷质比为输入值除以尺度 `MAG3D_SCALE.chargeUnit`，匀强场模式直接使用输入值；矢量箭头长度仅示意方向。

## 3. 单元测试与精度卡点
1. 单匝圆环 $z$ 轴磁场与 $\frac{\mu_0 I R^2}{2(R^2+z^2)^{3/2}}$ 相对误差 `< 1e-4`；
2. 3D 匀强磁场斜射螺旋线螺距 $p = v_\parallel \frac{2\pi m}{|q|B}$ 相对误差 `< 1e-5`，动能相对误差 `< 1e-10`；
3. 边界参数（$I=0, q=0, dt=0$）无 `NaN` / `Infinity`；首屏主包零 `three` chunk 泄漏。

## 4. 旗舰视图采样（V3.1）
- 有限螺线管采用真实 Biot–Savart 场的归一化方向 RK4 采样，利用离散圆环的四分之一转动对称性；添加内孔与轴线种子，开曲线止于展示域，闭曲线只保留单次遍历。采样密度不作定量磁感应强度标尺。零场不画磁感线，匀强场方向随磁场符号。
- 2D/3D 复用有界单项静态采样缓存；粒子参数不重建场几何，轨迹仍为 Boris 状态历史。材质光晕为视觉编码，不代表辐射。局部回旋半径/周期公式仅用于局部匀强近似。
