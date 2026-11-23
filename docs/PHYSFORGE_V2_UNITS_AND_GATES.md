# PhysForge V2.0 全 43 单元实施清单与门禁核验明细（提交线上 AI 逐项审查）

> **配套文档**：本文件为 [PHYSFORGE_V2_REVIEW_OVERVIEW.md](file:///d:/project%20code/44-PhysForge/docs/PHYSFORGE_V2_REVIEW_OVERVIEW.md) 的明细附表，逐一列出全部 43 个物理单元的编号、`meta.id`、核心物理内核/数值算法、V2 能力覆盖与仓库防幻觉 CI 卡点。数据直接提取自 `simulations/catalog.ts`、`simulations/registry.ts` 与仓库源码实查。

---

## 一、全 43 物理仿真单元逐项清单

> 表中能力标志含义：`H` = `getControlHandles`（画布直操手柄）、`FBD` = `getForceVectors`（自动受力分析矢量）、`RF` = `referenceFrames`（随动/惯性参考系切换）、`3D` = `renderMode: 'three3d'`（懒加载 Vanilla Three.js）；全表 **43/43 均已100%实现** `PHYSICS_SPEC.md`、`engine.ts`（零 DOM/零 `Math.random()`）、`engine.test.ts`、`exportDiagramIR`（SVG/PNG/TikZ 导出）与 `sceneSerializer`。

### 1. 五大自由建模器（`B1–B5`）与 V1.0 兼容别名
| 序号 | 编号 | 规范 `meta.id`（及 V1 兼容别名） | 模型名称 | 核心数值算子与物理特性 | V2 能力 |
| :---: | :---: | :--- | :--- | :--- | :--- |
| 1 | `B1` | `builder-composite-em-field`<br>（兼容 `em-bounded-magnetic-field`） | 自由复合场与动态圆建模器 | 9 粒子磁聚焦、`BorisPusher` + `bisectEvent`、Brent 反解临界速率、配速法与多种有界场 | `H`, `FBD`, `RF` |
| 2 | `B2` | `builder-circuit-mna`<br>（兼容 `circuit-dc-capacitor-mna`） | 自由拓扑线性与非线性电路建模器 | 自研纯 TS 改进节点法（MNA）+ 梯形伴随电容 + Newton-Raphson 非线性肖克莱二极管/小灯泡 + 节点电势着色/电流光珠/闭合电源 `SHORT_CIRCUIT` 告警 | `H` |
| 3 | `B3` | `builder-optics-ray`<br>（兼容 `optics-ray-studio`） | 自由几何光学与波动光学建模器 | 2D 光线追迹、折射/全反射临界角、三棱镜色散、平行玻璃砖侧移、理想薄透镜高斯成像（$1/u+1/v=1/f$） | `H` |
| 4 | `B4` | `builder-mechanics-lab`<br>（兼容 `mech-free-sandbox`） | 自由力学约束与多刚体建模器 | `Udwadia-Kalaba` 解析约束（阿特伍德机等直接输出约束反力）+ `VelocityVerlet` 弹簧 + 懒加载 `Rapier2D` WASM | `H`, `FBD`, `RF` |
| 5 | `B5` | `builder-custom-ode-lab` | 通用微分方程与拉格朗日实验室 | 按需懒加载 `mathjs@^15.2.0` + 严格白名单 AST 编译器（零 `eval`/`new Function`）+ RK4/Verlet 开普勒/单摆/Duffing | `H` |

### 2. 力学与天体物理全矩阵（`M01–M11`，11 单元）
| 序号 | 编号 | 规范 `meta.id` | 模型名称 | 核心数值算子与物理特性 | V2 能力 |
| :---: | :---: | :--- | :--- | :--- | :--- |
| 6 | `M01` | `mech-kinematics-chase` | 运动学追及相遇与多过程图像 | 分段匀变速 + `bisectEvent` 精确捕获共速与追及时刻 | `H`, `RF` |
| 7 | `M02` | `mech-dynamic-equilibrium` | 动态平衡几何图解（活结/死结/矢量三角形） | 准静态几何解析 + 动态拉密定理 / 矢量闭合三角形联动 | `H`, `FBD` |
| 8 | `M03` | `mech-constrained-velocity` | 关联速度（绳拉船 / 靠墙杆 / 接触面分解） | 非完整几何约束速度投影分解与垂直约束验证 | `H` |
| 9 | `M04` | `mech-projectile-coupling` | 抛体运动与斜面/曲面耦合（安全包络与阻力） | `RK4` 二次空气阻力求解 + 抛物线安全包络线计算 | `H`, `FBD` |
| 10 | `M05` | `mech-block-conveyor` | 动力学板块模型与传送带摩擦力突变 | V2 原地升级：`bisectEvent` 共速互斥换向、划痕长度与摩擦生热守恒、`carrier` 随动参考系 | `H`, `FBD`, `RF` |
| 11 | `M06` | `mech-vertical-circular` | 竖直面圆周运动与单边脱轨模态切换 | `Udwadia-Kalaba` 约束反力 + `bisectEvent` 捕获脱轨瞬时切向抛体切换（$\arccos(2/3)$ 精密验证） | `H`, `FBD` |
| 12 | `M07` | `mech-conical-turntable` | 圆锥摆、水平圆盘双物块临界滑移 | 同侧/异侧双物块临界角速度 $\omega_1, \omega_2, \omega_3$ 解析与离心滑动模态切换 | `H`, `FBD` |
| 13 | `M08` | `mech-spring-separation` | 含弹簧连接体与临界分离模型 | 弹簧-双滑块系统 + `bisectEvent` 精确捕捉 $F_N=0$ 脱离时刻与加速度突变 | `H`, `FBD` |
| 14 | `M09` | `mech-collision-recoil` | 碰撞、斜碰与反冲动量模型 | 一/二维恢复系数碰撞、矢量三角形、等质量弹性斜碰正交检验、子弹打木块与人船模型质心守恒 | `H`, `RF` |
| 15 | `M10` | `astro-orbital-mechanics` | 万有引力、霍曼转移与拉格朗日点 | `ScaleContext` 无量纲归算 + 四阶 Yoshida 辛积分（50 周期能量/半长轴 `<1e-6`、角动量 `<1e-7`）+ 霍曼转移 + 双星 $L_1–L_5$ 与洛希等值面 | `H`, `RF` |
| 16 | `M11` | `mech-shm-resonance` | 简谐振动、非线性单摆与受迫共振 | 非线性受迫阻尼单摆 vs 简谐参考圆对照、小角与 $60^\circ$ 大角能量守恒与稳态共振峰值验证 | `H`, `FBD` |

### 3. 电磁学与 3D 空间场（`E01–E10`，10 单元）
| 序号 | 编号 | 规范 `meta.id` | 模型名称 | 核心数值算子与物理特性 | V2 能力 |
| :---: | :---: | :--- | :--- | :--- | :--- |
| 17 | `E01` | `em-electrostatic-field` | 多点电荷静电场、等势面与粒子偏转 | `marchingSquares` 等势线提取 + `integrateAdaptiveRK45` 粒子偏转轨迹 | `H`, `FBD` |
| 18 | `E02` | `em-capacitor-millikan` | 平行板电容器动态分析与密立根油滴 | 恒压 $U$/恒荷 $Q$ 双模、插入电介质动态电容与量子化油滴平衡悬浮 | `H`, `FBD` |
| 19 | `E03` | `em-ac-field-oscilloscope` | 交变电场、示波管与等效重力场 | 锯齿波扫描与正弦偏转利萨如图形、分段周期电场轨迹与复合重力场最高点分析 | `H`, `FBD` |
| 20 | `E04` | `em-induction-double-rod` | 电磁感应单杆与双杆切割综合模型 | V2 原地升级：阻性/容性/恒流驱动单双杆动量守恒与焦耳热闭合 | `H`, `FBD`, `RF` |
| 21 | `E05` | `em-wireframe-rotation` | 线框进出多区域磁场与旋转切割 | 梯形/矩形线框进出界 + 辐条轮/半圆框旋转切割感应电动势解析验证 | `H`, `FBD` |
| 22 | `E06` | `em-eddy-vortex-field` | 感生涡旋电场与电磁阻尼对比 | 法拉第涡旋电场电子加速与整块铜板 vs 开槽铜板电磁阻尼双摆衰减对照 | `H`, `FBD` |
| 23 | `E07` | `em-ac-generator-rms` | 交流电产生与有效值削峰填谷推导 | 转动线圈中性面提示 + 分段复合 Simpson 积分计算 6 种非正弦交变波形有效值 | `H` |
| 24 | `E08` | `em-transformer-grid` | 理想变压器动态分析与高压输电网 | 含原边串联内阻 $R_0$ 的多路副线圈联合求解（$\sum U_k I_k = U_1 I_1$）+ 远距离升压减损 1/4 验证 | `H` |
| 25 | `E09` | `em-lc-rlc-oscillation` | LC 电磁振荡与 RLC 交流谐振 | 20 周期 LC 能量漂移 `<1e-5`、`bisectEvent` 测周期、RLC 受迫谐振与相量图 | `H` |
| 26 | `E10` | `em-3d-magnetic-fields` | 3D 电磁空间场与左手/右手定则 | 毕奥-萨伐尔圆弧积分无头磁场 + `stepBorisPusher` 三维螺旋磁偏转 + 懒加载 `ThreeStage` 3D 渲染 | `3D` |

### 4. 波动、光学、热学与近代物理（`W01–W02, O01, T01–T02, N01–N03`，8 单元）
| 序号 | 编号 | 规范 `meta.id` | 模型名称 | 核心数值算子与物理特性 | V2 能力 |
| :---: | :---: | :--- | :--- | :--- | :--- |
| 27 | `W01` | `wave-vibration-coupling` | 机械波与质点振动双图联动 · 干涉与多普勒 | V2 原地升级：驻波简正模态、多解波速枚举与超音速马赫锥 | `H`, `RF` |
| 28 | `W02` | `wave-2d-ripple-fdtd` | 2D FDTD 波动池衍射、折射与干涉 | `WaveFDTD2D`（200×150 网格 + CFL $<0.5$ 钳位 + 阻尼吸收边界），双缝条纹间距与理论 $<5\%$ | `H` |
| 29 | `O01` | `optics-wave-interference` | 光的波动性进阶：劈尖、牛顿环与光栅缺级 | 劈尖等厚条纹、牛顿环半径定律、多缝干涉+单缝衍射包络线及 $d/a=3$ 缺级与 `wavelengthToRgb` 着色 | `H` |
| 30 | `T01` | `thermo-piston-gas-laws` | 汽缸活塞卡口、水银柱与变质量充放气 | `stepHybridAutomaton` 卡口脱离温度精确捕获（`<1e-7 K`）、水银柱溢出平衡态与多次抽打气 | `H` |
| 31 | `T02` | `thermo-cycles-kinetic-md` | 热力学循环与硬球分子动理论微观盒 | 卡诺/矩形循环效率热力学第一定律核对 + `SpatialHash2D` & `SeededPrng` 300 粒子硬球 MD 动能守恒与布朗轨迹 | — |
| 32 | `N01` | `modern-photoelectric-compton` | 光电效应与康普顿散射 | 爱因斯坦光电方程遏止电压线性定标 + 康普顿波长偏移能量动量闭合（`<1e-10`） | — |
| 33 | `N02` | `modern-rutherford-bohr` | 卢瑟福散射与玻尔氢原子能级 | `1 fm` 核尺度 `ScaleContext` + `RK45` 库仑散射角（`<1e-4 rad`）+ 玻尔跃迁巴耳末可见光谱线（`<0.2 nm`） | — |
| 34 | `N03` | `modern-nuclear-recoil-decay` | 核衰变反冲径迹与半衰期蒙特卡洛 | 二体相对论衰变与 `BorisPusher` 云室 $\alpha$ 外切 / $\beta^-$ 内切径迹 + `SeededPrng` ($N_0=4000$) 半衰期统计 | — |

### 5. STSE、真误差高考实验与强基竞赛（`S01–S04, X01–X02, C01–C03`，9 单元）
| 序号 | 编号 | 规范 `meta.id` | 模型名称 | 核心数值算子与物理特性 | V2 能力 |
| :---: | :---: | :--- | :--- | :--- | :--- |
| 35 | `S01` | `stse-tokamak-magnetic-mirror` | 托卡马克环形磁场与磁镜/磁瓶 | 解析无散磁镜 ($\nabla\cdot\mathbf{B}=0$) + 逃逸锥损失验证 + 托卡马克螺旋磁面 + 懒加载 `ThreeStage` | `3D` |
| 36 | `S02` | `stse-em-devices-suite` | 现代电磁科技器件集成台 | 速度选择器、质谱仪、回旋加速器（经典精度 `<1e-5` 与相对论失谐）、霍尔开关、MHD 发电机及电磁流量计 | — |
| 37 | `S03` | `stse-em-launch-regen-brake` | 电磁弹射与新能源再生制动 | 电容脉冲/恒流电磁炮 + 再生制动与纯电磁刹车动量定理停止距离及能量总账（残差 `<1e-6`） | — |
| 38 | `S04` | `stse-gravity-assist-rendezvous` | 深空引力弹弓与空间站交会对接 | 尾随加速 vs 前导减速弹弓（行星系速率守恒 `<1e-5`）与椭圆轨升轨滞后/降轨追赶机制 | `H`, `RF` |
| 39 | `X01` | `exp-mechanics-error-lab` | 力学实验真误差与纸带逐差仿真台 | `SeededPrng` 确定性高斯读数噪声、50Hz 纸带逐差法、未平衡/过平衡截距偏置、重钩码下弯与 Phyphox CSV 叠加 | `H` |
| 40 | `X02` | `exp-electrical-error-lab` | 电学核心实验真误差与精密读数台 | `solveNonlinearMna` 伏安内外接、半偏法系统偏小单调收敛、分压/限流测小灯泡曲线及 10/20/50 分度游标卡尺与千分尺解码 | `H` |
| 41 | `C01` | `comp-rigid-rolling-slip` | 刚体定轴转动与滑滚转换 | `stepHybridAutomaton` 精确捕获滑转纯滚时刻 $t_c = 2v_0/(7\mu g)$（`<1e-6`）、回旋保龄球与四大转动惯量斜面竞赛 | `H`, `FBD` |
| 42 | `C02` | `comp-chaos-normal-coriolis` | 混沌双摆、简正模与科里奥利力 | 双摆 `RK45` 30s 能量漂移 `<1e-6` + 李雅普诺夫影子对照、耦合振子简正模态频率与旋转圆盘非惯性系-惯性系轨迹等价验证 | `H`, `RF` |
| 43 | `C03` | `comp-relativity-quantum-tunneling` | 狭义相对论时空图与一维量子隧穿 | 512 格 Crank-Nicolson Complex-Thomas TDSE 量子势垒隧穿（幺正概率漂移 `<1e-10`）与洛伦兹 $\Delta s^2$ 几何不变量 | — |

---

## 二、防幻觉与发布门禁自动化流水线说明

### 1. AI 与场景验证闭环（`packages/ai-copilot` & `scripts/`）
* **`pnpm verify:packs`**：调用 [scripts/run-verify-packs.mjs](file:///d:/project%20code/44-PhysForge/scripts/run-verify-packs.mjs) 对 [content/teaching-packs/](file:///d:/project%20code/44-PhysForge/content/teaching-packs) 下 6 份 JSON 执行 Zod 校验并驱动真实无头物理内核跑出答案指标比对（20/20 题通过）。
* **`pnpm verify:scenes`**：调用 [scripts/verify-scenes.ts](file:///d:/project%20code/44-PhysForge/scripts/verify-scenes.ts) 对 [content/presets/](file:///d:/project%20code/44-PhysForge/content/presets) 下全部 V1 预设与 V2 `SceneDSL`（**共 10 份**）执行 Zod Schema 归一化 + 60 步无头仿真演进 + 不变量/有限值审计。
* **`pnpm verify:vault`**：调用 [scripts/verify-vault.ts](file:///d:/project%20code/44-PhysForge/scripts/verify-vault.ts) 验证 43 单元在 `catalog.ts` 与 `registry.ts` 中 1:1 相等、`WorkspaceVaultStore` 合并内置 10 份场景资产并通过 `fflate` ZIP 导入导出往返校验（`ZIP = 6080 B`）与全局搜索召回。
* **`Generate-then-Refine` 闭环**：[AiCopilotDrawer.tsx](file:///d:/project%20code/44-PhysForge/apps/web/src/components/AiCopilotDrawer.tsx) 不允许 AI 输出未经校验的 JSON 直接载入舞台，所有候选方案必须先通过 `auditSceneHeadless()` 跑通实际参数边界检查与多步 ODE/MNA/TDSE 演进，发现越界或守恒失败会将具体报错文本自动回传最多 3 轮修正后方可点击“载入模型舞台”。

### 2. CI / 发布自动化（`.github/workflows/`）
* **[ci.yml](file:///d:/project%20code/44-PhysForge/.github/workflows/ci.yml)**：每次 `push`/`PR` 自动执行 `typecheck` -> 静态禁用字面量扫描 -> `pnpm test`（60 文件 / 240 用例） -> `verify:packs` -> `verify:scenes` -> `verify:vault` -> `pnpm build` -> `< 350 KB` gzip 与主包防重依赖泄露断言 -> 单文件构建检验，并接入 `e2e-subpath-smoke` Job（执行 `VITE_BASE_PATH=/PhysForge/ pnpm build` 与 [e2e-subpath-and-export.mjs](file:///d:/project%20code/44-PhysForge/scripts/e2e-subpath-and-export.mjs)）。
* **[deploy-pages.yml](file:///d:/project%20code/44-PhysForge/.github/workflows/deploy-pages.yml)**：构建阶段注入 `VITE_BASE_PATH=/PhysForge/` 自动部署 GitHub Pages。
* **`pnpm export:release -- --all`（8 件旗舰离线 HTML 实测产出）**：
  * `builder-composite-em-field.html` (`2011.5 KB`)
  * `wave-vibration-coupling.html` (`2007.9 KB`)
  * `em-induction-double-rod.html` (`2008.9 KB`)
  * `mech-block-conveyor.html` (`2005.4 KB`)
  * `optics-wave-interference.html` (`2000.6 KB`)
  * `modern-rutherford-bohr.html` (`2004.8 KB`)
  * `exp-electrical-error-lab.html` (`2008.3 KB`)
  * `comp-relativity-quantum-tunneling.html` (`2000.5 KB`)
