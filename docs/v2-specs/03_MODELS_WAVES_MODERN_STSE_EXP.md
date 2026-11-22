# PhysForge V2.0 完全体施工方案（3/3）：模型全规格书（下）与终版全量验收矩阵

> **文档编号**：`docs/v2-specs/03_MODELS_WAVES_MODERN_STSE_EXP.md`
> **覆盖范围**：**波动与波动光学（W01–W02, O01）+ 热学与微观统计（T01–T02）+ 近代物理（N01–N03）+ 新高考前沿 STSE（S01–S04）+ 高考真误差实验台（X01–X02）+ 强基/竞赛与大学先修拓展（C01–C03）**，共计 **17 个核心单元**；并汇总全项目 **43 个单元**的终版质量门禁与本地总控 Agent 施工协议。

---

## 零、本卷专属数值算法与可复现性铁律

1. **偏微分方程稳定性铁律（FDTD 与 Crank-Nicolson）**：
   * 2D 波动方程显式差分（FDTD）强制校验 CFL 稳定性条件 $r = \frac{c_{\max}\Delta t}{\Delta x} \le \frac{1}{\sqrt{2}}$（硬性钳位至 $\le 0.5$）+ 四周吸收海绵层。
   * 1D 含时薛定谔方程（TDSE）必须采用**Crank-Nicolson 隐式差分 + 复数三对角托马斯算法（Thomas Algorithm）**，保证每一步总概率 $\int \lvert \psi(x,t) \rvert^2 dx = 1$ 漂移 $< 10^{-10}$。
2. **三维非均匀磁场无散度铁律（$\nabla \cdot \mathbf{B} = 0$）**：磁镜必须伴随径向分量 $B_r(r,z) = -\frac{r}{2}\frac{\partial B_z}{\partial z}$，使 3D `stepBorisPusher` 自动涌现真实磁镜反射。
3. **硬球分子动力学空间哈希铁律（$\mathcal{O}(N)$ 碰撞）**：微观气体盒实现均匀网格空间哈希与精确弹性冲量修正（含位置防穿透投影）。
4. **可确定性随机种子铁律（Seeded PRNG）**：严禁在 `engine.ts` 中调用 `Math.random()`；必须使用确定性 **Mulberry32 / Xoshiro128** + Box-Muller 高斯变换注入可控 `seed`。
5. **物理波长到 sRGB 光谱映射**：统一调用 `physics-core/optics/wavelengthToRgb`（$\lambda \in [380, 750]\text{ nm}$）。

---

## 一、波动与波动光学专题（W01–W02, O01）

### W01. 机械波多解性、叠加与多普勒效应（`wave-vibration-coupling`，升级 V1.0）
* **核心求解**：线性叠加 + 高考多解性枚举器 $v_{\text{右}}(n)=\frac{\Delta x_0 + n\lambda}{\Delta t}, v_{\text{左}}(n)=\frac{(\lambda-\Delta x_0)+n\lambda}{\Delta t}$ + 驻波波腹/波节 + 超音速马赫锥（$\sin\alpha = v_{\text{波}}/v_{\text{源}}$）。
* **Vitest**：相位差误差 $<10^{-8}$；多解性枚举各 $v(n)$ 演进 $\Delta t$ 后波形重合误差 $<10^{-7}$；波节位移 $<10^{-10}$。

### W02. 2D 波动池（FDTD 衍射、折射与干涉）（`wave-2d-ripple-fdtd`）
* **核心求解**：$240\times 180$ `Float32Array` 双缓冲 5 点 FDTD + 16 格海绵吸收边界 + 刚性障碍掩码 + 波速场 $c(x,y)=c_0/n(x,y)$；接收屏时间平均波强 $\langle u^2(y)\rangle$。
* **Vitest**：严格 CFL $<0.5$，2000 步零发散/NaN；双缝远场极大与 $\frac{L}{d}\lambda$ 偏差 $<5\%$。

### O01. 光的波动性进阶（薄膜干涉 / 牛顿环 / 单缝与光栅衍射）（`optics-wave-interference`）
* **核心求解**：半波损失判定 + 光程差 $2 n_2 d \cos\theta_2 + \delta_{\text{half}}\frac{\lambda}{2}$（劈尖凹坑/凸起缺陷函数、牛顿环、增透膜）；夫琅禾费单缝与光栅衍射 $I(\theta)=I_0(\frac{\sin\beta}{\beta})^2(\frac{\sin N\gamma}{\sin\gamma})^2$，支持真实物理波长色彩与缺级标定。
* **Vitest**：空气劈尖条纹间距误差 $<10^{-6}$；牛顿环暗环半径误差 $<10^{-4}$；$d/a=3$ 时第 3 级缺级光强 $<10^{-10}$。

---

## 二、热学与微观统计专题（T01–T02）

### T01. 汽缸活塞、水银柱与变质量充放气模型（`thermo-piston-gas-laws`）
* **核心求解**：`HybridAutomaton` 管理汽缸双室/卡口平衡、倾斜玻璃管/U型管水银柱溢出临界、变质量充放气守恒与等温等效体积法；同步 $P-V, P-T, V-T$ 三图与临界拐点。
* **Vitest**：$PV/(nRT)-1 < 10^{-10}$；多次抽气与 $P_0(V/(V+\Delta V))^k$ 误差 $<10^{-10}$；脱离卡口临界温度误差 $<10^{-7}\text{ K}$。

### T02. 热力学循环与分子动理论微观盒（`thermo-cycles-kinetic-md`）
* **核心求解**：3–4 段封闭过程解析功 $W$、内能变 $\Delta U$、热效率 $\eta$ 与卡诺对比；空间哈希 2D 硬球 MD（$N\in[100,400]$ + 布朗微粒）统计器壁压强与麦克斯韦速率分布拟合。
* **Vitest**：封闭循环 $\lvert\sum\Delta U_i\rvert < 10^{-10}\text{ J}$ 且 $\lvert\sum Q_i-\sum W_i\rvert < 10^{-8}\text{ J}$；硬球绝热盒 1000 步动能漂移 $<10^{-8}$；$N=300$ 麦克斯韦分布拟合通过统计检验。

---

## 三、近代物理专题（N01–N03）

### N01. 光电效应与康普顿散射（`modern-photoelectric-compton`）
* **核心求解**：$E_{km}=h\nu-W_0=e U_c$（真实金属逸出功、可冻结多条 $I-U$ 曲线叠加对比、$E_{km}-\nu$ 直线）；康普顿散射相对论能量动量闭合三角求解 $\Delta\lambda=\frac{h}{m_e c}(1-\cos\theta)$。
* **Vitest**：红限频率与遏止电压误差 $<10^{-10}$；康普顿散射能量与 2D 动量守恒残差 $<10^{-10}$。

### N02. 卢瑟福散射与玻尔氢原子能级光谱（`modern-rutherford-bohr`）
* **核心求解**：核物理 `ScaleContext`（$\text{fm}, \text{MeV}$）下 `integrateAdaptiveRK45` 积分库仑斥力轨道；玻尔 $E_n=-13.6/n^2\text{ eV}$，区分单个原子与一群原子跃迁谱线数，光子严格共振 vs 电子碰撞余能保留，真实赖曼/巴耳末/帕邢光谱着色。
* **Vitest**：散射角与卢瑟福公式误差 $<10^{-4}$；机械能漂移 $<10^{-6}$；巴耳末前 4 线波长误差 $<0.2\text{ nm}$。

### N03. 核反应反冲磁场与半衰期统计衰变（`modern-nuclear-recoil-decay`）
* **核心求解**：质量亏损 $\Delta m c^2$ + 动量守恒反冲交给 `stepBorisPusher`（$\alpha$ 外切圆 vs $\beta^-$ 内切圆）；Seeded PRNG 蒙特卡洛半衰期衰变（$16\text{–}4000$ 核对照）；链式裂变增殖 $k_{\text{eff}}$。
* **Vitest**：半径比 $q_2/q_1$ 误差 $<10^{-6}$；$N_0=4000$ 固定种子经 1/2/3 半衰期比例偏差 $<0.025$。

---

## 四、2025–2026 新高考科技前沿情境专题（STSE，S01–S04）

### S01. 托卡马克环形磁场与磁镜/磁瓶（`stse-tokamak-magnetic-mirror`）
* 3D 无散磁镜场 $B_z(z)=B_0(1+z^2/L^2), B_r=-B_0 r z/L^2$ + 托卡马克环向/极向螺旋场（`Three.js` 懒加载视图）；实时追踪磁矩 $\mu = \frac{mv_\perp^2}{2B}$ 与逃逸锥临界角 $\theta_c$。
* **Vitest**：动能漂移 $<10^{-8}$，大于逃逸角稳定反射、小于逃逸角穿出，$\mu$ 相对波动 $<5\%$。

### S02. 现代电磁科技器件集成台（`stse-em-devices-suite`）
* 单插件 6 器件：速度选择器、质谱仪、回旋加速器（可选相对论质量增长失谐）、霍尔元件（电子 vs 空穴翻转）、MHD 磁流体发电机、电磁流量计。
* **Vitest**：经典回旋出射动能误差 $<10^{-5}$；霍尔电压极性与解析误差 $<10^{-8}$；MHD $R=r$ 功率最大。

### S03. 电磁弹射、磁悬浮与新能源制动能量回收（`stse-em-launch-regen-brake`）
* 导轨炮（恒流/脉冲电容 + 反电动势 + 风阻）与新能源再生制动（发电电磁制动 + 机械摩擦补足，完整能量回收账本）。
* **Vitest**：全过程能量账本误差 $<10^{-6}\text{ J}$，纯电磁平路制动总距与动量定理误差 $<10^{-6}$。

### S04. 深空引力弹弓与空间站轨道交会对接（`stse-gravity-assist-rendezvous`）
* 辛积分双星掠飞引力弹弓（太阳系 vs 行星共动系一键切换）；空间站交会对接反直觉降轨加速追赶（CW / 二体轨道）。
* **Vitest**：行星系进出动能差 $<10^{-5}$；绕后加速/绕前减速方向严格正确；正向切向加速一周期后反落后。

---

## 五、高考“真误差建模”实验台（X01–X02）

### X01. 力学核心实验误差仿真台（`exp-mechanics-error-lab`）
* 真实物理系统误差 $a_{\text{true}}=\frac{mg+Mg\sin\theta-f}{M+m}$ + $50\text{ Hz}$ 打点 + Seeded 高斯测量误差 $\varepsilon_i$ + 逐差法/OLS 拟合 + Phyphox CSV 叠加；完整复现 $a-F$ 四类高考异常图线。
* **Vitest**：零噪声逐差法误差 $<10^{-10}$；截距符号/大小解析误差 $<10^{-6}$；严格贴合 $F/(M+F/g)$。

### X02. 电学核心实验误差仿真台（`exp-electrical-error-lab`）
* 全基于 `B2` 非理想 MNA（非理想 $R_A, R_V$、非线性小灯泡）：测电源 $E, r$ 内外接系统误差与直线拟合、小灯泡分压/限流伏安曲线、半偏法测 $R_g$ 偏小原理、10/20/50 分度游标卡尺与螺旋测微器交互读数器。
* **Vitest**：测 $E, r$ 拟合斜率截距吻合非理想解析误差 $<10^{-6}$；半偏法满足 $R_{g,\text{测}}<R_{g,\text{真}}$ 且随 $R_1\to\infty$ 收敛；卡尺/千分尺零误差。

---

## 六、强基、物理竞赛与大学先修拓展（C01–C03）

### C01. 刚体定轴转动与滑滚转换（`comp-rigid-rolling-slip`）
* 实心球/球壳/圆柱/圆环 $I=c m R^2$；`HybridAutomaton` + `bisectEvent` 捕获 $v=\omega R$ 纯滚转换（含保龄球反旋回滚与四刚体斜面竞速）。
* **Vitest**：水平实心球 $t_c=\frac{2v_0}{7\mu_k g}$ 与末速 $\frac{5}{7}v_0$ 误差 $<10^{-6}$；斜面机械能漂移 $<10^{-6}$。

### C02. 混沌双摆、耦合振子简正模与非惯性科里奥利力（`comp-chaos-normal-coriolis`）
* 欧拉-拉格朗日双摆（`RK45` + 双初值发散 + 庞加莱截面）；双/三耦合振子对称/反对称简正模与拍频；地面惯性直轨 vs 转动圆盘科里奥利力双视口。
* **Vitest**：双摆 30s 机械能漂移 $<10^{-6}$；简正模频率与特征值误差 $<10^{-5}$；转动系变换与直接积分偏差 $<10^{-6}$。

### C03. 狭义相对论时空图与一维量子波包隧穿（`comp-relativity-quantum-tunneling`）
* 闵可夫斯基时空图（洛伦兹剪切动画、不变双曲线、光锥、类时/类空、双生子佯谬）；Crank-Nicolson + 三对角托马斯算法求解 512 格 1D TDSE（单势垒/双势垒共振/势阱），实时输出反射率 $R(t)$ 与透射率 $T(t)$。
* **Vitest**：$\Delta s^2$ 跨系不变性误差 $<10^{-10}$；Crank-Nicolson 1000 步总概率归一化漂移 $<10^{-10}$；$E_0<V_0$ 透射 $T>0$ 且随势垒增厚指数衰减。

---

## 七、全项目 43 单元终版六大发布门禁
1. **静态与零作弊**：`pnpm typecheck` 零错；零 `as any`、`@ts-ignore`、`eval(`、`new Function(`、`Math.random()`（引擎层）、`.skip(`。
2. **全量单测**：`pnpm test` 覆盖全 43 单元 + 核心库，$\ge 200$ 用例 100% 全绿。
3. **资产与教研验算**：`pnpm verify:packs` + `pnpm verify:vault` / `verify:scenes` 全绿。
4. **体积与懒加载隔离**：`pnpm build` 首屏主 JS（gzip）$< 350\text{ KB}$；`rapier`、`three`、`excalidraw`、`mathjs` 全拆为独立异步 chunk；零外网 CDN。
5. **多模态导出 E2E**：Playwright 抽检黑白 SVG/TikZ、WebM 录屏、单文件 HTML（`file://` 离线正常）、`Ctrl+K` 与 Vault 闭环。
6. **CI/CD 双线部署**：`.github/workflows/ci.yml` + `deploy.yml` 发布至 GitHub Pages 与 Cloudflare Pages。
