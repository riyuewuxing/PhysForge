# PhysForge V2.0 完全体施工方案（2/3）：模型全规格书（上）

> **文档编号**：`docs/v2-specs/02_MODELS_BUILDERS_AND_MECHANICS_EM.md`
> **覆盖范围**：**5 大自由可组合建模器（B1–B5）+ 11 个力学与天体专题模型（M01–M11）+ 10 个电磁学与 3D 空间场模型（E01–E10）**，共计 **26 个核心单元**（含 V1.0 已有模型的深度升维）。
> **前置依赖**：所有接口契约、数值核心升级（`HybridAutomaton`、`ScaleContext`、`UdwadiaKalaba`、稀疏 LU MNA、反问题求解器 `solveInverseRoot`）、画布直操手柄（`ControlHandle`）、通用 FBD / 参考系相机与试卷级 `DiagramIR` 导出规范均以 `01_ARCHITECTURE_AND_CORE_PLATFORM.md` 为唯一基准。

## 零、全局模型实现铁律与目录契约

本卷所有 26 个单元（无论新建还是从 V1.0 升级）必须严格遵守以下统一交付标准，禁止“只画动画、不管物理”或“交互与方程耦合”：

1. **标准单模型目录结构**（位于 `simulations/<model-id>/`）：
   * `PHYSICS_SPEC.md`：本模型推导文档（状态变量定义、微分/代数方程、边界事件函数 $g(t,\mathbf{y})=0$、解析验证公式与已知局限）。
   * `engine.ts`：**100% 零 DOM / Canvas / React 依赖**的纯 TypeScript 物理内核，必须可在 Node/Vitest 下无头运行并支持 `ParameterSweep` 批量扫描。
   * `engine.test.ts`：Vitest 物理严谨性单测套件（守恒律漂移、解析解精度、临界事件捕获精度、极端边界防 NaN 健壮性）。
   * `plugin.ts`：实现 `SimulationPluginV2`，声明 `paramSchema`、`controlHandles`、`layers`、`telemetryChannels`、`frameModes`、`renderCanvas`（或 3D 场景组件）及 `buildDiagramIR`（试卷级矢量配图导出钩子）。
   * `presets.ts`：覆盖教材例题、高考真题母题与临界反例的默认预设列表（且必须与本地 Vault 自定义 Preset 无缝兼容）。
2. **默认继承的全局能力**：全部 2D 模型接入 V2.0 `Viewport`、支持 `240 Hz` 固定步长或自适应步长稳定推进、单帧步进/回放、`uPlot` + `PhaseXYPlotter` 双引擎联动及 `buildDiagramIR` 黑白试卷图输出。
3. **无量纲缩放铁律**：凡涉及微观粒子或天体尺度的模型，必须在 `engine.ts` 内部强制通过 `ScaleContext` 归一化到 $\mathcal{O}(1)$ 求解空间积分，输出观测量时还原为 SI 单位。

---

## 一、五大自由可组合建模器（Meta-Builders，B1–B5）

### B1. 自由复合场建模器（`builder-composite-em-field`，升级 V1.0 `em-bounded-magnetic-field`）
* **方程与求解**：$\frac{d\mathbf{v}}{dt} = \frac{q}{m}[\mathbf{E}(\mathbf{r},t) + \mathbf{v}\times\mathbf{B}(\mathbf{r},t)] + \mathbf{g}_{\text{opt}}$；纯磁场/恒定正交场用 `stepBorisPusher`，空间梯度或时变场切换 `integrateAdaptiveRK45` 或分裂 Boris-RK4；所有场区 SDF 边界触发 `bisectEvent`（$<10^{-7}\text{ s}$）。
* **Scene DSL 原语**：`FieldRegion`（`half-plane`, `strip`, `circle`, `annulus`, `rect`, `sector`；匀强/方波或正弦交变/线性梯度，重叠线性叠加）、`Emitter`（`point`, `fan`, `parallel-beam`, `speed-scan`）、`Baffle/Detector`（吸收屏、弹性反射板、狭缝、通关点）。
* **直操与分析层**：拖拽场区平移缩放旋转、拖拽发射源与初速矢量；动态圆几何包络/圆心轨迹/公共焦点层；配速法双分量拆解层；一键临界反解器 `solveInverseRoot`。
* **Vitest 验收**：纯匀强磁场 50 周期动能漂移 $<10^{-10}$、半径误差 $<10^{-6}$；圆形磁聚焦 9 粒子汇聚离散 $<10^{-5} r_{\text{field}}$；摆线最高点速度与 $2E/B$ 误差 $<10^{-6}$；边界切换误差 $<10^{-7}\text{ s}$。

### B2. 自由拓扑电路建模器（`builder-circuit-mna`，升级 V1.0 `circuit-dc-capacitor-mna`）
* **核心求解**：拓扑预检（孤岛自动注入 $G_{\min}=10^{-12}\text{ S}$、真短路环路红光熔断告警绝不产 `NaN`）+ 稀疏 LU MNA + 电容/电感梯形伴随模型 + Newton-Raphson 非线性小灯泡与肖克利二极管（残差 $<10^{-9}\text{ A}$）。
* **元件库与直操**：直流/交流/电流源、定值与三端滑动变阻器、SPST/SPDT 开关、初始电压电容、初始电流电感、理想变压器、小灯泡、二极管、非理想电表（可调 $R_A, R_V$）、GND；导线电势染色 + 对数映射流动粒子 + 虚拟红黑表笔。
* **Vitest 验收**：节点 KCL $<10^{-9}\text{ A}$、回路 KVL $<10^{-9}\text{ V}$；RC $\tau$ 时刻误差 $<10^{-4}$；理想电源短路触发 `SHORT_CIRCUIT` 告警。

### B3. 自由几何光学画板（`builder-optics-ray`，升级 V1.0 `optics-ray-studio`）
* **核心求解**：线段/圆弧/二次曲面解析求交（最高 32 级反射/折射）、斯涅尔与全反射 + 可选菲涅尔分光、柯西色散 $n(\lambda)=A+B/\lambda^2$（7 色 CIE 近似 RGB）、光程累加器。
* **原语与直操**：点光源/平行束/激光笔、多边形与圆形/半圆柱介质、理想薄透镜与真实厚球面透镜、平面/球面镜、挡板/狭缝、照度接收屏；虚像反向延长线、法线与临界角吸附。
* **Vitest 验收**：临界角精度 $<0.01^\circ$；平行玻璃砖侧移误差 $<10^{-6}$；理想薄透镜 $\frac{1}{u}+\frac{1}{v}=\frac{1}{f}$ 误差 $<10^{-5}$。

### B4. 自由力学约束与多刚体建模器（`builder-mechanics-lab`，升级 V1.0 `mech-free-sandbox`）
* **双引擎**：默认精确解析约束模式（基于 `Udwadia-Kalaba` + Baumgarte 稳定，直接给出精准 $F_N, T$ 与单边脱离检测）；自由多刚体堆叠/牛顿摆沙箱模式按需懒加载 `Rapier2D` WASM。
* **直操与层**：拖放元件、绑定轻绳/弹簧、右键锁定任意参考系（地面/物块/质心）、Auto-FBD 受力正交分解层。
* **Vitest 验收**：阿特伍德机/斜面约束加速度误差 $<10^{-6}$；保守系统 20s 能量漂移 $<10^{-4}$；质心运动 $M\mathbf{a}_{\text{cm}}=\sum\mathbf{F}_{\text{ext}}$ 误差 $<10^{-6}$。

### B5. 通用方程与拉格朗日实验室（`builder-custom-ode-lab`，全新单元）
* **安全引擎**：基于 `mathjs >= 15.2.0` 白名单 AST（禁用 `eval`/`new Function`/原型链访问，严格拦截恶意表达式），支持显式一阶 ODE 组与 1–2 自由度拉格朗日模板，Web Worker 50 步 `ParameterSweep` 扫描 + 相图/庞加莱截面/FFT。
* **Vitest 验收**：恶意表达式 100% 拦截；简谐与开普勒误差 $<10^{-5}$；50 步参数扫描无阻塞完成。

---

## 二、力学与天体核心母题矩阵（M01–M11）

### M01. 运动学追及相遇与多过程图像（`mech-kinematics-chase`）
* 3 段匀变速 + 反应时间 + 刹车单向速度锁止；`bisectEvent` 捕获共速与相遇（$<10^{-7}\text{ s}$）；$x-t/v-t/a-t$ 三联图 + $v-t$ 阴影面积；支持 A 车参考系。
* **Vitest**：共速/相遇误差 $<10^{-7}\text{ s}$，刹车锁止后 $v \equiv 0$ 不倒车。

### M02. 动态平衡几何图解（`mech-dynamic-equilibrium`）
* 准静态 $\sum\vec{F}=\mathbf{0}$，区分活结（$T_1=T_2$）、死结、动杆、定杆；矢量闭合三角形 / 辅助圆 / 相似三角形三视图 + $T(\theta), F_N(\theta)$ 曲线。
* **Vitest**：全角度 $\lVert\sum\vec{F}\rVert < 10^{-10}\text{ N}$，活结 $T_1-T_2 \equiv 0$，最小拉力误差 $<10^{-6}$。

### M03. 关联速度（`mech-constrained-velocity`）
* 约束全导数 $\mathbf{v}_A\cdot\hat{\mathbf{e}}_{AB}=\mathbf{v}_B\cdot\hat{\mathbf{e}}_{AB}$（绳拉船、靠墙直杆、双绳拉物、斜面推杆）；真实合速度与沿绳/垂绳分量分解对照。
* **Vitest**：投影速度差 $<10^{-10}\text{ m/s}$，绳拉船加速度解析误差 $<10^{-5}$。

### M04. 抛体运动与斜面/曲面耦合（`mech-projectile-coupling`）
* 真空解析 vs 二次空气阻力（`RK45`）；半圆槽与斜面 `bisectEvent`；速度反向延长线交水平位移中点、斜抛安全包络抛物线、距斜面最远点垂线。
* **Vitest**：平抛落斜面飞行时间误差 $<10^{-7}\text{ s}$，不越过安全包络，有阻尼落地动能严格更小。

### M05. 传送带与叠放板块多阶段模型（`mech-block-conveyor`，升级 V1.0）
* `HybridAutomaton` 管理静/滑/锁止/滑落；`bisectEvent` 捕获共速与边界脱离；实体划痕 $\Delta x_{\text{相}}$ + 地面/带/板三参考系 + $v-t$ 面积阴影 + 能量核算。
* **Vitest**：共速事件 $<10^{-7}\text{ s}$，能量守恒残差 $<10^{-7}\text{ J}$，临界拉力误差 $<10^{-6}$。

### M06. 竖直面圆周运动与脱轨切换（`mech-vertical-circular`）
* `Udwadia-Kalaba` 解精确 $F_N(\theta)$；轻绳/内外轨 $F_N=0$ 处 `bisectEvent` 冻结并切换自由抛体模态；标注脱轨角 $\theta_d$ 与虚线抛体轨道。
* **Vitest**：光滑半球脱轨角与 $\arccos(2/3)$ 误差 $<10^{-6}\text{ rad}$，机械能漂移 $<10^{-6}$。

### M07. 圆锥摆、火车转弯与水平圆盘临界滑移（`mech-conical-turntable`）
* 多物块轻绳单边张力 + 静摩擦反向分段求解器；2.5D 俯视与截面联动 + $f-\omega^2, T-\omega^2$ 分段折线与临界角速度 $\omega_1,\omega_2,\omega_3$。
* **Vitest**：全部临界角速度误差 $<10^{-6}$，超阈后切向偏外滑出。

### M08. 含弹簧连接体与临界分离模型（`mech-spring-separation`）
* 水平/竖直/斜面双体弹簧 + 单边接触 `bisectEvent` 分离捕获；“剪断轻绳/撤外力”瞬时突变；分离点冻结标定与 $a-t, F_N-t$ 曲线。
* **Vitest**：分离处 $F_N=0$ 精度 $<10^{-7}\text{ N}$，自由阶段质心守恒、机械能漂移 $<10^{-6}$。

### M09. 碰撞家族、人船模型与子弹打木块（`mech-collision-recoil`）
* 1D/2D 恢复系数碰撞（$e\in[0,1]$）+ 瞄准距 $b$ 拖拽 + 动量矢量三角形；子弹打木块共速/穿出 `bisectEvent`；人船与光滑滑槽固定质心轴 $x_{\text{cm}}\equiv\text{const}$。
* **Vitest**：动量守恒 $<10^{-10}$，$e=1$ 动能守恒 $<10^{-10}$，等质量 2D 弹性斜碰 $\mathbf{v}_1'\cdot\mathbf{v}_2' < 10^{-9}$。

### M10. 万有引力、天体变轨与多星系统（`astro-orbital-mechanics`）
* 天文 `ScaleContext` + `VelocityVerlet` / 4 阶辛积分求解 $N$ 体引力；霍曼转移点火 $\Delta v$、开普勒等面积扇形、双星/三星及限制性三体旋转系有效势等高线（$L_1\text{–}L_5$）。
* **Vitest**：50 周期半长轴与能量漂移 $<10^{-6}$，角动量 $<10^{-7}$，霍曼 $\Delta v$ 误差 $<10^{-5}$。

### M11. 简谐振动、非线性单摆、受迫振动与共振（`mech-shm-resonance`）
* 完整非线性受迫阻尼摆 $\ddot{\theta}+2\gamma\dot{\theta}+\frac{g}{L}\sin\theta=\frac{F_0}{mL}\cos(\omega_d t)$ 并行小角幽灵摆对比 + 参考圆 + `PhaseXYPlotter` 相空间 + 一键扫频共振峰。
* **Vitest**：$2^\circ$ 周期误差 $<10^{-4}$，无阻尼大角能量漂移 $<10^{-6}$，共振峰符合 $\sqrt{\omega_0^2-2\gamma^2}$。

---

## 三、电磁学与 3D 空间场核心母题矩阵（E01–E10）

### E01. 多点电荷静电场、等势面与粒子偏转（`em-electrostatic-field`）
* Marching Squares 等势线 + 双向 RK4 电场线 + `RK45` 试探粒子 + 匀强三点等分法；连线/中垂线 $E(x), \varphi(x)$ 曲线。
* **Vitest**：等势线与电场正交误差 $<1^\circ$，试探粒子 $E_k+q\varphi$ 守恒 $<10^{-5}$。

### E02. 平行板电容器动态分析与密立根油滴（`em-capacitor-millikan`）
* 闭合（恒 $U$）/ 断开（恒 $Q$）+ 拖动 $d, S, \varepsilon_r$ + 接地切换 + 静电计偏角 + 油滴平衡/斯托克斯阻力下落。
* **Vitest**：$C, Q, U, E, \varphi_P$ 解析误差 $<10^{-10}$；断开仅改 $d$ 时 $\Delta E \equiv 0$。

### E03. 交变电场加速、示波管与等效重力场（`em-ac-field-oscilloscope`）
* 方波/正弦电压翻转 `bisectEvent` 捕获 + 4 时刻群粒子对比；示波管荧光屏余辉扫描/李萨如图；重力+匀强电场等效重力轴与最高/最低点。
* **Vitest**：示波管偏转量误差 $<10^{-6}$，方波 $t_0=T/4$ 入射一周期净位移 $<10^{-7}$。

### E04. 电磁感应单/双杆全族模型（`em-induction-double-rod`，升级 V1.0）
* 覆盖单杆（阻/容/恒压电源/倾斜粗糙）与双杆（等距/不等距 $L_1\neq L_2$ 广义动量守恒）；电流-时间阴影面积 $q=\int I\,dt$ 与焦耳热账本。
* **Vitest**：单杆电容加速度 $\frac{F}{m+CB^2L^2}$ 误差 $<10^{-7}$，不等距双杆 $L_1 v_1 - L_2 v_2 < 10^{-6}$ 且能量守恒 $<10^{-6}$。

### E05. 线框进出多区域磁场与旋转切割（`em-wireframe-rotation`）
* 矩形/正三角形/圆形线框精确磁通量交集导数 + 单/反向双/梯度磁场 + 重力自由穿越 + 金属棒转动切割与法拉第铜盘；四联图 $\Phi, \mathcal{E}, I, F_{\text{安}}$。
* **Vitest**：反向边界电动势 $2.000$ 倍精度；自由下落满足 $mg\Delta h = \Delta E_k + Q$ 误差 $<10^{-6}$。

### E06. 感生涡旋电场与电磁阻尼/涡流（`em-eddy-vortex-field`）
* 圆柱变化磁场内外感生涡旋场（$r/2 |\dot{B}|$ 与 $R^2/(2r)|\dot{B}|$）+ 电子感应加速器测试粒子 + 实心 vs 开槽铜盘阻尼摆对比。
* **Vitest**：闭合环路积分 $\oint \mathbf{E}\cdot d\mathbf{l}$ 与 $-d\Phi_B/dt$ 误差 $<10^{-8}$。

### E07. 正弦交流电产生与有效值直观推导（`em-ac-generator-rms`）
* 2.5D 转动线圈 + 中性面提示；Simpson 数值积分计算正弦/半波/全波/占空比方波/锯齿/直流偏置叠加波有效值 $U_{\text{rms}}$，$p-t$ 削峰填谷可视化。
* **Vitest**：各类典型波形有效值积分误差均 $<10^{-6}$。

### E08. 理想变压器动态分析与远距离输电（`em-transformer-grid`）
* 原线圈含电阻 $R_0$ + 多路副线圈精确联立；发电机→升压变→输电线→降压变→多并联用户开关；仪表旁浮现升降箭头 $\uparrow/\downarrow$ 与功率损耗流瀑布条。
* **Vitest**：$\sum U_k I_k = U_1 I_1$ 误差 $<10^{-10}$；升压翻倍等功率下线损严格降至 $1/4$。

### E09. LC 电磁振荡与 RLC 交流谐振（`em-lc-rlc-oscillation`）
* $L\ddot{q}+R\dot{q}+q/C=U_m\cos(\omega t)$；电场能 $E_E$ 与磁场能 $E_B$ 互补柱状图 + 感抗/容抗/电阻旋转相量图 + $I(f)$ 谐振峰。
* **Vitest**：无阻尼 20 周期能量漂移 $<10^{-5}$，周期误差 $<10^{-5}$，谐振电流严格等于 $U_m/R$。

### E10. 3D 电磁空间场与左手/右手定则可视化（`em-3d-magnetic-fields`）
* 独立懒加载 Vanilla `three`（`OrbitControls` + 严格 `dispose()`），禁止拉入 `@react-three/fiber`；Biot-Savart 数值积分（直导线/双导线/单环/亥姆霍兹/有限螺线管）+ 3D `BorisPusher` 螺旋线与三轴定则辅助指示器。
* **Vitest**：单环轴线磁场与 $\frac{\mu_0 I R^2}{2(R^2+z^2)^{3/2}}$ 误差 $<10^{-4}$；螺旋线螺距误差 $<10^{-5}$；首屏不含 `three` chunk。
