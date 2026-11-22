# 几何光学与双缝光栅实验室（`optics-ray-studio`）物理建模规范

## 1. 集成评估与架构说明
- `ricktu288/ray-optics`（Apache-2.0）未发布独立 npm 包，且其 `src/core` 强依赖 `mathjs`、`i18next`、`bezier-js`、`evaluatex` 及 CommonJS 运行时加载。为保持 PhysForge 物理计算核 100% 零重型依赖、无 DOM 耦合与 `tsc --strict` 校验，本模型遵循斯涅尔折射定律、全反射条件、柯西色散及双缝干涉解析方程构建纯 TS 光学追迹引擎，并在 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) 明确声明参考来源。

## 2. 物理方程
1. **斯涅尔折射与全反射定律**：
   $$n_1 \sin\theta_1 = n_2 \sin\theta_2, \quad C = \arcsin\!\left(\frac{n_2}{n_1}\right) \text{ (当 } n_1 > n_2 \text{)}$$
   当 $\frac{n_1}{n_2}\sin\theta_1 \ge 1$ 时发生全反射（折射光能量为 0，反射率 100%）。
2. **平行玻璃砖侧移**：
   厚 $d$、折射率 $n$ 的平行玻璃砖置于空气（$n_0 = 1$）中，以入射角 $\theta_1$ 射入：
   $$\sin\theta_2 = \frac{\sin\theta_1}{n}, \quad \Delta x = d \frac{\sin(\theta_1 - \theta_2)}{\cos\theta_2}$$
   出射角严格等于入射角 $\theta_1$（出射光与入射光平行）。
3. **三棱镜折射与柯西色散**：
   顶角 $A$ 的等腰棱镜折射率 $n(\lambda) = n_0 + B/\lambda^2$（红光折射率最小、紫光最大），按左右两侧斜面两次精确矢量追迹求偏折角 $\delta$。
4. **双缝干涉条纹分布**：
   缝距 $d$、屏距 $L$、波长 $\lambda$（以 $\text{nm}$ 计）：
   $$\Delta x = \frac{L \lambda}{d}, \quad I(y) = I_0 \cos^2\!\left(\frac{\pi d y}{\lambda L}\right)$$

## 3. 验收标准
- 折射角与临界角误差 $< 10^{-8}\text{ rad}$；
- 平行玻璃砖侧移量 $\Delta x$ 与解析公式相对误差 $< 10^{-4}$，出射平行度误差 $< 10^{-8}\text{ rad}$；
- 光导纤维在满足全反射入射角内传输无漏光；双缝条纹间距 $\Delta x = L\lambda/d$ 误差 $< 10^{-4}$；边界值无 `NaN`。
