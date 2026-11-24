# PhysForge V3.0 本地 Luna 精确施工方案（3D 视觉深化与 2D 剖面补齐版）

> **当前分支与基线**：请在本地 **`v3-review`** 分支上继续施工（完整保留总控已做好的 `7` 个已修改文件直修成果，禁止切回 `main` 或丢弃改动）。  
> **在线 AI（BYOK）说明**：按用户明确指示，**在线 AI 实网联调本轮暂不测试**（PR-0 单测与 Schema 容错已完成并全绿），待用户日后决定时再单独安排，**不作为本轮 V3.0 封板门禁**。

---

## 一、施工任务总览（共 3 个精准改造点）

| 任务 | 目标文件 | 解决的实测视觉问题 | 回归核验文件 |
| :--- | :--- | :--- | :--- |
| **L1：B1 3D 磁域边界与初态可视性** | [planarFlagshipScenes.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/planarFlagshipScenes.ts) | `V3_B1_3d.png` 在 `t=0` 时仅有一段暗灰玻璃侧壁与 5 个孤立点，磁域轮廓与入场速度指引不明显 | [planarFlagshipScenes.test.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/planarFlagshipScenes.test.ts) |
| **L2：M10 3D 开普勒椭圆解析轨道与恒星光环** | [remainingFlagshipScenes.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/remainingFlagshipScenes.ts) | `V3_M10_3d.png` 在 `kepler-ellipse` 模式 `t=0` 时仅见暗灰圆盘与中心点，无轨道闭合轮廓 | [remainingFlagshipScenes.test.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/remainingFlagshipScenes.test.ts) |
| **L3：E10 对称磁感线种子与 2D 线圈截面符号** | [em-3d-magnetic-fields/engine.ts](file:///d:/project%20code/44-PhysForge/simulations/em-3d-magnetic-fields/engine.ts)、[plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/em-3d-magnetic-fields/plugin.ts) | `V3_E10_flat.png` 侧视仅 1 条上方弧线（缺 `y<0` 对称种子）且线圈缺 `⊙/⊗` 电流方向截面标记 | [em-3d-magnetic-fields/engine.test.ts](file:///d:/project%20code/44-PhysForge/simulations/em-3d-magnetic-fields/engine.test.ts) |

---

## 二、Task L1：B1（`builder-composite-em-field`）3D 边界高亮环与 `t=0` 视觉增强

### 1. 精准源码改动（[apps/web/src/stage/planarFlagshipScenes.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/planarFlagshipScenes.ts#L210-L243)）

在 `boundedDriver` 的 `if (layers.has('fieldRegion')) { ... fixed.add(region); ... }` 之后（第 227 行后），按 `params.mode` 为 `fixed` 组追加清晰的高对比边界线框（`z = ±0.22` 与 `planarFlagshipScenes.ts` 既有的 `0.44` 柱高/盒厚严格对齐）：

```ts
          const rimMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.78 });
          if (params.mode === 'circular') {
            for (const [idx, zPlane] of [-0.22, 0.22].entries()) {
              const rimPts = Array.from({ length: 72 }, (_, k) => {
                const ang = (k / 72) * Math.PI * 2;
                return new THREE.Vector3(radius * Math.cos(ang), radius * Math.sin(ang), zPlane);
              });
              const rim = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(rimPts), rimMat.clone());
              rim.name = `b1-field-rim-${idx}`;
              fixed.add(rim);
            }
          } else {
            const boxW = params.mode === 'rectangular' ? radius : params.mode === 'half-space' ? 4 : 8;
            const boxH = params.mode === 'rectangular' ? Math.max(params.fieldScale * 1.6, 0.2) : 5;
            const centerX = params.mode === 'crossed-eb' ? 0 : boxW / 2;
            const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(boxW, boxH, 0.44));
            const wire = new THREE.LineSegments(edges, rimMat);
            wire.name = 'b1-field-wire';
            wire.position.x = centerX;
            fixed.add(wire);
          }
```

> **注意**：`disposeTree(root)`（第 14–26 行）已遍历 `THREE.Mesh | THREE.Line | THREE.LineSegments`（`LineLoop` 继承自 `THREE.Line`），但上面额外创建的 `new THREE.BoxGeometry(boxW, boxH, 0.44)` 临时几何体仅用于生成 `EdgesGeometry`，应立即调用 `.dispose()` 避免临时几何泄漏：
> ```ts
> const tempBox = new THREE.BoxGeometry(boxW, boxH, 0.44);
> const edges = new THREE.EdgesGeometry(tempBox);
> tempBox.dispose();
> ```
> 同时，确保在 `boundedDriver`（第 230–235 行）为 `B` 方向箭头使用更紧凑的长度与不刺眼间距，且在 `t = 0`（粒子在场外或刚入射）默认显示初速度箭头（现有第 271 行 `showVelocity = layers.has('velocityVector') && (track.id === 0 || state.particles.length <= 3)` 会在 `layers.has('velocityVector')` 时显示所有轨道或主轨道箭头，若 `state.particles.length <= 5` 可放宽到 `<= 5` 以便默认 5 束粒子都带清晰入射速度方向箭头！）。

### 2. 补充单测（[apps/web/src/stage/planarFlagshipScenes.test.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/planarFlagshipScenes.test.ts)）

* 验证 `mode: 'circular'` + `layers: new Set(['fieldRegion'])` 时 `scene.getObjectByName('b1-field-rim-0')` 与 `b1-field-rim-1` 存在，且其端点投影在 `morphT = 1` 下与 2D `circle` 半径误差 `< 0.5 px`，`driver.dispose()` 后 `scene.children.length === 0`。

---

## 三、Task L2：M10（`astro-orbital-mechanics`）3D 解析开普勒椭圆轮廓与恒星光环

### 1. 数学与源码改动（[apps/web/src/stage/remainingFlagshipScenes.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/remainingFlagshipScenes.ts#L113-L144)）

在 `orbitDriver` 中：
1. **增加 `kepler-ellipse` 理论闭合椭圆/双曲线参考线**：
   在 `orbitDriver` 的 `sig` 签名中加入 `p.r1Ratio`、`p.v0Ratio`（`const sig = JSON.stringify([p.mode, p.r1Ratio, p.v0Ratio, p.massRatioQ, p.r2OverR1, layers.has('rocheIsolines')]);`）。
   当 `p.mode === 'kepler-ellipse'` 时，依据引擎无量纲初值（初态在 `(r0 = s.xNorm, 0)`，初速度 `(0, vy0)` 或用初始守恒量 `r = Math.hypot(s.xNorm, s.yNorm)` 与 `(s.vxNorm, s.vyNorm)`，注意取初始 `tNorm === 0` 或利用 `s.energyNorm0`、`s.angularMomNorm0` 与初始位置计算，避免轨迹抖动）：
   - 实际上从 `p.v0Ratio` 在初态即可解析算出不变轨道参数（与 `engine.ts` 第 279–283 行完全同源）：
     ```ts
     if (p.mode === 'kepler-ellipse') {
       const r0 = Math.max(0.2, p.r1Ratio); // 见 engine.ts L75 & L280: xNorm = r1Ratio, yNorm = 0
       const v0 = Math.max(0.5, p.v0Ratio) / Math.sqrt(r0); // 见 engine.ts L77 & L282: vCircNorm = 1/sqrt(r0) ? wait: 核对 scale.toDimless(vCircSI)!
     ```
   - **重要核对（防单位换算写错）**：查看 [engine.ts](file:///d:/project%20code/44-PhysForge/simulations/astro-orbital-mechanics/engine.ts#L75-L83) 与 L280–283：`lengthUnit = r1SI`，`timeUnit = sqrt(r1SI^3 / muSI)`，因此 `velocityUnit = r1SI / timeUnit = sqrt(muSI / r1SI) = vCircSI`！所以无量纲初始态恒为 `xNorm = 1, yNorm = 0, vxNorm = 0, vyNorm = Math.max(0.5, p.v0Ratio)`！
   - 于是解析椭圆方程极其简洁精确（焦点在原点 `(0, 0)`，无量纲 $\mu = 1$）：
     - $v_0 = \max(0.5, p.v0Ratio)$
     - $h = v_0$，$p_{\text{orb}} = h^2 = v_0^2$
     - 偏心率矢量 $\mathbf{e} = (v_0^2 - 1,\ 0)$，记 $e_x = v_0^2 - 1$，$e = |e_x|$
     - 若 $e < 0.98$（束缚椭圆/圆轨道）：
       对 $\theta \in [0, 2\pi)$ 采样 128 点：
       $$r(\theta) = \frac{p_{\text{orb}}}{1 + e_x \cos\theta}$$
       轨道平面三维点为 `orbitDisplayPoint(r * Math.cos(theta), r * Math.sin(theta), 0, false)`（即 `(r cos θ, 0, -r sin θ)`），加入 `new THREE.LineLoop(..., new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.48 }))`，命名 `'kepler-analytical-orbit'`！
     - 若 $e \ge 0.98$（抛物/双曲逃逸）：仅采样 $|r(\theta)| \le 6$ 且分母 $1 + e_x \cos\theta > 0.08$ 的可见弧段绘制 `THREE.Line`！
2. **恒星外层光晕环**：
   在 `orbitDriver` 中为主星 `primary` 挂载一个柔和半透明金色晕环（`RingGeometry(0.16, 0.28, 32)` 水平躺在 `x-z` 平面 `rotation.x = -Math.PI / 2`，`opacity: 0.28`），提升 `M10` 3D 舞台恒星辨识度。

### 2. 补充单测（[apps/web/src/stage/remainingFlagshipScenes.test.ts](file:///d:/project%20code/44-PhysForge/apps/web/src/stage/remainingFlagshipScenes.test.ts)）

* 在 `kepler-ellipse`（`v0Ratio = 1.2`）下验证 `scene.getObjectByName('kepler-analytical-orbit')` 存在且在 `r = 1, θ = 0`（近日点 `(1, 0, 0)`）穿过初始行星点 `orbiting-body`，`morphT = 1` 投影与 2D 坐标对齐误差 `< 0.5 px`，`driver.dispose()` 后 `scene.children.length === 0`。

---

## 四、Task L3：E10（`em-3d-magnetic-fields`）对称磁感线与 2D 线圈截面符号

### 1. 根因与精准改动
* **对称磁感线种子（[simulations/em-3d-magnetic-fields/engine.ts](file:///d:/project%20code/44-PhysForge/simulations/em-3d-magnetic-fields/engine.ts#L279-L284)）**：
  当前 `helmholtz-coil` / `single-loop` 种子点仅有 `{x:0,y:0}`, `{x:±0.35R,y:0}`, `{x:0,y:0.35R}`，缺少 `y < 0` 对称种子，导致 2D 侧视投影 `(p.z, p.y)` 只有上半区有一条弧线。请补全为：
  ```ts
      : [
          { x: 0, y: 0, z: -1.4 },
          { x: 0.35 * R, y: 0, z: -1.3 },
          { x: -0.35 * R, y: 0, z: -1.3 },
          { x: 0, y: 0.35 * R, z: -1.3 },
          { x: 0, y: -0.35 * R, z: -1.3 },
          { x: 0, y: 0.65 * R, z: -1.3 },
          { x: 0, y: -0.65 * R, z: -1.3 }
        ];
  ```
  *（注：`engine.test.ts` 第 95–106 行仅对 `finite-solenoid` 断言了 12 条闭合种子，`helmholtz-coil` / `single-loop` 补充对称种子无任何现有单测冲突，且会让 3D 与 2D 画面同时变得对称饱满。）*
* **2D 线圈截面符号与对称磁感线箭头（[simulations/em-3d-magnetic-fields/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/em-3d-magnetic-fields/plugin.ts#L201-L231)）**：
  在 `renderCanvas` 的 `if (activeLayers.has('conductors'))` 块中：
  - 当 `params.geometryType === 'single-loop'`（`z = 0`）或 `'helmholtz-coil'`（`z = ±0.5 * params.radiusR`）或 `'finite-solenoid'` 时，在每匝线圈的上下截面端点 `(zCenter, +R)` 与 `(zCenter, -R)` 处使用 `m.toScreen(...)` 绘制带外圈的小型 `⊙`（实心点，电流出纸）与 `⊗`（交叉叉，电流入纸）截面标记（受 `params.currentI` 符号控制，随画布平移缩放同步）；
  - 在 `fieldLines3d` 绘制每条磁感线中点处顺着切线方向绘制小型方向箭头，使 2D 剖面无需依赖 3D 也能清晰读出磁场方向。

---

## 五、Luna 收尾验证门禁（全部完成后必须亲自跑通并看图）

1. 类型检查：`node ./node_modules/typescript/bin/tsc` 遍历全部 `18` 项配置（`11` `tsconfig.json` + `7` `tsconfig.build.json`）与 `7` 个包构建全绿；
2. 全量测试：`node ./node_modules/vitest/vitest.mjs run` 全绿（无 `skip`/`only`）；
3. 内容校验：`run-verify-packs.mjs`、`run-verify-scenes.mjs`、`run-verify-vault.mjs`、`git diff --check main..HEAD` 全绿；
4. 构建与单文件：`$env:VITE_BASE_PATH='/PhysForge/'; node ./apps/web/node_modules/vite/bin/vite.js build apps/web`（主包 `< 350 KB` gzip 且零重型泄漏）+ `node ./scripts/export-release-bundle.mjs --v3-audit`；
5. 浏览器实测（`BypassSandbox: true`）：`node ./scripts/visual-audit.mjs` + `node ./scripts/e2e-subpath-and-export.mjs` 全绿，并**多模态亲自查看**更新后的 `V3_B1_3d.png`、`V3_M10_3d.png`、`V3_E10_flat.png`、`V3_E10_3d.png` 确认达标后，更新 `docs/WRITER_HANDOFF_LOG.md` 交总控终审合并 `main` 并打 `v3.0.0` Tag。
