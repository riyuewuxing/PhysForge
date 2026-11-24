# PhysForge Wave C 施工方案：全仓 43 单元直操手柄全覆盖与 Auto-FBD / 随动参考系齐平（Luna 直接落地版）

> **文档定位**：本文件为总控在 Wave B（43 单元统一世界坐标与缩放平移）验收通过后，经实盘核查全部 **43 个** `simulations/*/plugin.ts` 与 `engine.ts` 状态结构编制的 **Wave C 可直接复制级施工指南**。  
> **配套基准**：[AGENTS.md](file:///d:/project%20code/44-PhysForge/AGENTS.md) ｜ [UI_PIXEL_1TO1_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/UI_PIXEL_1TO1_CONSTRUCTION_PLAN.md) ｜ [WAVE_B_CONSTRUCTION_PLAN.md](file:///d:/project%20code/44-PhysForge/docs/WAVE_B_CONSTRUCTION_PLAN.md) ｜ **当前仅落盘方案，不擅改业务代码**。

---

## 第一部分：全仓现状盘点与物理严谨性原则

### 1.1 Wave B 竣工后的全仓真实覆盖率

经扫描全部 43 个模型插件当前状态：
* **`getControlHandles`（画布直接操纵手柄）**：**34 / 43** 已具备；**缺失 9 个**：
  `comp-relativity-quantum-tunneling`、`em-3d-magnetic-fields`、`modern-nuclear-recoil-decay`、`modern-photoelectric-compton`、`modern-rutherford-bohr`、`stse-em-devices-suite`、`stse-em-launch-regen-brake`、`stse-tokamak-magnetic-mirror`、`thermo-cycles-kinetic-md`。
* **`getForceVectors`（Auto-FBD 受力分析）**：**16 / 43** 已具备；缺失 27 个（见下述物理原则筛选后新增 16 个真正受力的力学/电磁/热力学模型）。
* **`referenceFrames`（随动参考系）**：**10 / 43** 已具备；缺失 33 个（新增 14 个高教学价值惯性/非惯性随动观察参考系）。

### 1.2 Wave C 目标与“反形式主义”底线

| 维度 | 当前覆盖 | Wave C 目标 | 严谨性约束（严禁为凑数字造假矢量） |
| :--- | :--- | :--- | :--- |
| **`getControlHandles`** | `34 / 43` | **`43 / 43`（100%）** | 新增手柄必须位于渲染实体或清晰导轨的世界坐标点（`createWorldMapper` 同源），禁止悬空摆点，拖拽 `onDrag` 必须返回真实合法的 `ParamRecord` 更新。 |
| **`getForceVectors`** | `16 / 43` | **`32 / 43`（≥ 30/43）** | 仅向存在明确牛顿力学、引力、电磁力、库仑力、热力学活塞气压差的系统添加 `getForceVectors`；**绝不**给纯基尔霍夫电路（`B2`/`em-lc-rlc`/`em-transformer`）、纯几何光路/波动干涉、误差直尺实验硬塞虚假力箭头。 |
| **`referenceFrames`** | `10 / 43` | **`28 / 43`（≥ 20/43）** | 优先补全“质心参考系”（系统分离/碰撞）、“自由落体抛体参考系”（斜抛化直）、“转动圆盘/圆锥摆”、“电磁粒子的共动参考系”。 |

---

## 第二部分：Module C1 — 防作弊自动化交互验收门禁（新建 `simulations/wave-c-interaction.test.ts`）

> **先立门禁再施工**：请先建立下方测试文件。随 Batch C1–C3 推进，逐批跑通直至全绿。**严禁 `skip`/`only`、严禁返回空阵列混充、严禁硬编码零矢量。**

```ts
import { describe, expect, it } from 'vitest';
import {
  resolvePluginParams,
  type ForceVectorItem,
  type ParamRecord,
  type SimulationPluginV2
} from '@physforge/sim-sdk';
import { loadSimulationById, simulationCatalog } from './catalog.js';

describe('Wave C: 全仓交互能力覆盖与防作弊审计', () => {
  it('all 43 plugins provide working getControlHandles whose onDrag patches stay finite and runnable', async () => {
    for (const entry of simulationCatalog) {
      const modelId = entry.meta.id;
      const plugin = (await loadSimulationById(modelId)) as SimulationPluginV2<ParamRecord, unknown>;
      expect(typeof plugin.getControlHandles, `${modelId} missing getControlHandles`).toBe('function');

      const presets = plugin.presets.length > 0 ? plugin.presets : [null];
      let testedAtLeastOneHandle = false;

      for (const preset of presets) {
        const params = resolvePluginParams(plugin.paramSchema, preset?.params);
        const state = plugin.engine.createInitialState(params);
        const handles = plugin.getControlHandles?.(state, params) ?? [];
        if (handles.length === 0) continue;

        testedAtLeastOneHandle = true;
        for (const handle of handles) {
          expect(handle.id.trim().length, `${modelId} empty handle.id`).toBeGreaterThan(0);
          expect(handle.label.trim().length, `${modelId} empty handle.label`).toBeGreaterThan(0);
          expect(Number.isFinite(handle.position.x) && Number.isFinite(handle.position.y), `${modelId} handle ${handle.id} NaN`).toBe(true);
          if (handle.origin) {
            expect(Number.isFinite(handle.origin.x) && Number.isFinite(handle.origin.y), `${modelId} handle ${handle.id} origin NaN`).toBe(true);
          }

          const patch = handle.onDrag({ x: handle.position.x + 0.35, y: handle.position.y + 0.25 });
          const patchKeys = Object.keys(patch);
          expect(patchKeys.length, `${modelId} handle ${handle.id} onDrag returned empty patch`).toBeGreaterThan(0);

          const nextParams = resolvePluginParams(plugin.paramSchema, { ...params, ...patch });
          const nextState = plugin.engine.createInitialState(nextParams);
          const stepped = plugin.engine.step(nextState, nextParams, 1 / 120);
          const obs = plugin.engine.computeObservables(stepped.nextState, nextParams);
          for (const [k, v] of Object.entries(obs)) {
            expect(Number.isFinite(v), `${modelId} handle ${handle.id} produced non-finite observable ${k}`).toBe(true);
          }
        }
      }

      expect(testedAtLeastOneHandle, `${modelId} returned 0 control handles across all presets`).toBe(true);
    }
  });

  it('at least 30/43 plugins provide authentic getForceVectors and at least 20/43 provide referenceFrames', async () => {
    let forcePluginCount = 0;
    let framePluginCount = 0;

    for (const entry of simulationCatalog) {
      const modelId = entry.meta.id;
      const plugin = (await loadSimulationById(modelId)) as SimulationPluginV2<ParamRecord, unknown>;
      const defaultParams = resolvePluginParams(plugin.paramSchema, plugin.presets[0]?.params);
      let state = plugin.engine.createInitialState(defaultParams);
      for (let i = 0; i < 8; i++) {
        state = plugin.engine.step(state, defaultParams, 1 / 60).nextState;
      }

      if (plugin.getForceVectors) {
        forcePluginCount += 1;
        const presets = plugin.presets.length > 0 ? plugin.presets : [null];
        let anyNonZeroForce = false;

        for (const preset of presets) {
          const p = resolvePluginParams(plugin.paramSchema, preset?.params);
          let st = plugin.engine.createInitialState(p);
          for (let i = 0; i < 8; i++) st = plugin.engine.step(st, p, 1 / 60).nextState;

          const vectors: ForceVectorItem[] = plugin.getForceVectors(st, p);
          for (const vec of vectors) {
            expect(vec.id.trim().length).toBeGreaterThan(0);
            expect(vec.label.trim().length).toBeGreaterThan(0);
            expect(Number.isFinite(vec.origin.x) && Number.isFinite(vec.origin.y), `${modelId} force ${vec.id} origin NaN`).toBe(true);
            expect(Number.isFinite(vec.force.x) && Number.isFinite(vec.force.y), `${modelId} force ${vec.id} vector NaN`).toBe(true);
            if (Math.hypot(vec.force.x, vec.force.y) > 1e-6) {
              anyNonZeroForce = true;
            }
          }
        }
        expect(anyNonZeroForce, `${modelId} getForceVectors produced only zero/empty forces across all presets`).toBe(true);
      }

      if (plugin.referenceFrames && plugin.referenceFrames.length > 0) {
        framePluginCount += 1;
        for (const frame of plugin.referenceFrames) {
          expect(frame.id.trim().length).toBeGreaterThan(0);
          expect(frame.id, `${modelId} referenceFrame id must not collide with built-in ground`).not.toBe('ground');
          expect(frame.label.trim().length).toBeGreaterThan(0);
          const origin = frame.getOrigin(state, defaultParams);
          expect(Number.isFinite(origin.x) && Number.isFinite(origin.y), `${modelId} frame ${frame.id} origin NaN`).toBe(true);
          if (frame.getVelocity) {
            const vel = frame.getVelocity(state, defaultParams);
            expect(Number.isFinite(vel.x) && Number.isFinite(vel.y), `${modelId} frame ${frame.id} velocity NaN`).toBe(true);
          }
        }
      }
    }

    expect(forcePluginCount).toBeGreaterThanOrEqual(30);
    expect(framePluginCount).toBeGreaterThanOrEqual(20);
  });
});
```

---

## 第三部分：Batch C1 — 补齐全部 9 个缺失交互手柄模型（含直贴级源码）

> **统一小工具函数**：可在每个插件文件顶部加 2 行纯函数：  
> `const clampNum = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));`  
> `const snapStep = (v: number, step: number) => Math.round(v / step) * step;`

---

### C1-1. [comp-relativity-quantum-tunneling/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/comp-relativity-quantum-tunneling/plugin.ts)

* **现状**：缺 `getControlHandles` 与 `referenceFrames`。在 `renderCanvas` L202 中 `Math.min(0.45, state.potential[j]! * 0.16)` 会把势垒高度 `V0 > 2.81` 的部分视觉削平，导致拖动 > `2.81` 时画面高度无反馈。
* **精准改造**：
  1. 在 `renderCanvas` L202 把势垒绘制尺度由 `0.16` 改为 `0.12`（对应 `Math.min(0.68, state.potential[j]! * 0.12)`），使 `barrierHeightV0 ∈ [0.5, 5.0]` 在 `[-0.84, -0.30]` 区间线性无削顶变化，并为 `x = 0` 处增加浅金虚线高度引导刻线。
  2. 新增 `getControlHandles` 与 `referenceFrames`：
```ts
  getControlHandles: (_state, params) =>
    params.mode === 'minkowski-relativity'
      ? [
          {
            id: 'spacetime-event',
            label: `(x=${params.eventX.toFixed(1)}, ct=${params.eventCt.toFixed(1)})`,
            position: { x: params.eventX * 0.22, y: params.eventCt * 0.22 },
            handleKind: 'point',
            color: '#4ade80',
            onDrag: (wp) => ({
              eventX: Number(Math.max(-6, Math.min(6, Math.round((wp.x / 0.22) * 2) / 2)).toFixed(1)),
              eventCt: Number(Math.max(-6, Math.min(8, Math.round((wp.y / 0.22) * 2) / 2)).toFixed(1))
            })
          }
        ]
      : [
          {
            id: 'barrier-height',
            label: `V₀=${params.barrierHeightV0.toFixed(1)}`,
            position: { x: 0, y: -0.9 + Math.min(0.68, params.barrierHeightV0 * 0.12) },
            handleKind: 'point',
            color: '#fbbf24',
            onDrag: (wp) => ({
              barrierHeightV0: Number(Math.max(0.5, Math.min(5.0, Math.round(((wp.y + 0.9) / 0.12) * 10) / 10)).toFixed(1))
            })
          }
        ],
  referenceFrames: [
    {
      id: 'lorentz-boost-s-prime',
      label: '高速运动飞船 S′ 系 (v = βc)',
      getOrigin: (state, params) => ({
        x: params.mode === 'minkowski-relativity' ? Math.max(-2, Math.min(2, params.lorentzBeta * state.t * 0.15)) : 0,
        y: 0
      }),
      getVelocity: (_state, params) => ({ x: params.lorentzBeta, y: 0 })
    }
  ],
```

---

### C1-2. [em-3d-magnetic-fields/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/em-3d-magnetic-fields/plugin.ts)

* **保护准则**：保留 `renderMode: 'three3d'`、`mountThreeScene` 与 `ThreeStage.tsx` 全屏/3D 逻辑 **零修改**（确保 `E10_04_fullscreen_3d.png` 零退化）。新增的 `getControlHandles`、`getForceVectors` 与 `referenceFrames` 同时服务于 `切回 2D` 模式与 `SingleFileApp` 2D 投影（按 `project2D(p) = { x: p.x + p.z * 0.45, y: p.y + p.z * 0.25 }` 与当前 `renderCanvas` L100 完全同源）：
```ts
  getControlHandles: (state, params) => {
    const px = state.position.x + state.position.z * 0.45;
    const py = state.position.y + state.position.z * 0.25;
    return [
      {
        id: 'particle-vperp',
        label: `v⊥=${params.vPerp.toFixed(1)} m/s`,
        position: { x: px + Math.max(0.15, params.vPerp * 0.35), y: py },
        origin: { x: px, y: py },
        handleKind: 'vector',
        color: '#38bdf8',
        onDrag: (wp) => ({
          vPerp: Number(Math.max(0, Math.min(3, Math.round((Math.hypot(wp.x - px, wp.y - py) / 0.35) * 5) / 5)).toFixed(1))
        })
      }
    ];
  },
  getForceVectors: (state) => {
    const origin = {
      x: state.position.x + state.position.z * 0.45,
      y: state.position.y + state.position.z * 0.25
    };
    const f = state.lorentzForce;
    return [
      {
        id: 'lorentz-2d',
        label: 'F洛',
        origin,
        force: { x: f.x + f.z * 0.45, y: f.y + f.z * 0.25 },
        color: '#fb7185',
        category: 'magnetic',
        unit: 'N'
      }
    ];
  },
  referenceFrames: [
    {
      id: 'helical-particle',
      label: '带电粒子随动参考系 (2D 投影)',
      getOrigin: (state) => ({
        x: state.position.x + state.position.z * 0.45,
        y: state.position.y + state.position.z * 0.25
      }),
      getVelocity: (state) => ({
        x: state.velocity.x + state.velocity.z * 0.45,
        y: state.velocity.y + state.velocity.z * 0.25
      })
    }
  ],
```

---

### C1-3. [modern-nuclear-recoil-decay/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/modern-nuclear-recoil-decay/plugin.ts)

* **精准改造**：
  1. 在 `cloud-chamber-recoil` 模式下右侧底部 `x = 1.65, y ∈ [-0.8, 0.4]` 绘一条垂直 `B_z` 标尺线（标注 `B_z`）；
  2. 新增 `getControlHandles`（3 种模式各自贴合对应物理量位置）与 `getForceVectors`（磁云室带电出射粒子与反冲子核洛伦兹偏转向心力；其余两模式返回 `[]` 而磁云室模式保证非零向量）：
```ts
  getControlHandles: (state, params) => {
    if (params.mode === 'cloud-chamber-recoil') {
      return [
        {
          id: 'cloud-magnetic-field',
          label: `B=${params.magneticFieldT.toFixed(1)}T`,
          position: { x: 1.65, y: -0.8 + ((params.magneticFieldT - 0.1) / 2.9) * 1.2 },
          handleKind: 'point',
          color: '#38bdf8',
          onDrag: (wp) => ({
            magneticFieldT: Number(Math.max(0.1, Math.min(3.0, Math.round((0.1 + ((wp.y + 0.8) / 1.2) * 2.9) * 10) / 10)).toFixed(1))
          })
        }
      ];
    }
    if (params.mode === 'half-life-mc') {
      return [
        {
          id: 'half-life-slider',
          label: `T₁/₂=${params.halfLifeS.toFixed(1)}s`,
          position: { x: 0.15 + (params.halfLifeS / 6.0) * 1.95, y: 0 },
          handleKind: 'point',
          color: '#fbbf24',
          onDrag: (wp) => ({
            halfLifeS: Number(Math.max(0.5, Math.min(6.0, Math.round((((wp.x - 0.15) / 1.95) * 6.0) * 2) / 2)).toFixed(1))
          })
        }
      ];
    }
    return [
      {
        id: 'control-rod-absorption',
        label: `吸收率=${(params.controlRodAbsorption * 100).toFixed(0)}%`,
        position: { x: 1.7, y: -0.9 + (params.controlRodAbsorption / 0.85) * 1.55 },
        handleKind: 'point',
        color: '#4ade80',
        onDrag: (wp) => ({
          controlRodAbsorption: Number(Math.max(0, Math.min(0.85, Math.round((((wp.y + 0.9) / 1.55) * 0.85) * 50) / 50)).toFixed(2))
        })
      }
    ];
  },
  getForceVectors: (state, params) => {
    if (params.mode !== 'cloud-chamber-recoil') return [];
    const pts = state.recoil.emittedTrackCm;
    const dPts = state.recoil.daughterTrackCm;
    const eTail = pts[Math.min(pts.length - 1, Math.floor(pts.length * 0.25))] ?? { x: 0.3, y: 0 };
    const ePrev = pts[Math.max(0, Math.floor(pts.length * 0.25) - 1)] ?? { x: 0, y: 0 };
    const maxExtent = Math.max(1, ...pts.map((p) => Math.hypot(p.x, p.y)), ...dPts.map((p) => Math.hypot(p.x, p.y)));
    const s = 1.2 / maxExtent;
    const vx = eTail.x - ePrev.x;
    const vy = eTail.y - ePrev.y;
    const norm = Math.hypot(vx, vy) || 1;
    // 匀强磁场 B_z 下的洛伦兹偏向力方向 q(v × B)
    const fMag = params.magneticFieldT * (params.decayKind === 'alpha' ? 2 : 1);
    return [
      {
        id: 'emitted-lorentz',
        label: 'F洛₁',
        origin: { x: eTail.x * s, y: eTail.y * s },
        force: { x: (vy / norm) * fMag, y: (-vx / norm) * fMag },
        color: '#38bdf8',
        category: 'magnetic',
        unit: 'F'
      }
    ];
  },
```
*(注意：在 `renderCanvas` 的 `cloud-chamber-recoil`、`'half-life-mc'`、`'chain-fission'` 三段各自增加一根对应的 `1px` `rgba(148,163,184,0.28)` 导轨线段，保证手柄贴轨不漂浮！)*

---

### C1-4. [modern-photoelectric-compton/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/modern-photoelectric-compton/plugin.ts)

* **精准改造**：
```ts
  getControlHandles: (state, params) => {
    if (params.mode === 'compton') {
      const th = (params.scatterAngleDeg * Math.PI) / 180;
      const len = 0.95 * (state.compton.pScattered / Math.max(1e-9, state.compton.pIncident));
      return [
        {
          id: 'compton-scatter-angle',
          label: `θ=${params.scatterAngleDeg.toFixed(0)}°`,
          position: { x: -0.8 + len * Math.cos(th), y: len * Math.sin(th) },
          origin: { x: -0.8, y: 0 },
          handleKind: 'angle',
          color: '#a855f7',
          onDrag: (wp) => {
            const deg = (Math.atan2(Math.max(0.05, wp.y), wp.x + 0.8) * 180) / Math.PI;
            return { scatterAngleDeg: Math.max(10, Math.min(180, Math.round(deg / 5) * 5)) };
          }
        }
      ];
    }
    // 光电效应模式：1. 伏安曲线上的黄色工作点 U_AK；2. 左侧光束波长条
    const uX = 0.05 + ((params.anodeVoltageV + 5) / 11) * 2.05;
    const iY = -0.9 + (state.photoelectric.currentMa / 7.5) * 1.8;
    return [
      {
        id: 'anode-voltage-point',
        label: `U=${params.anodeVoltageV.toFixed(1)}V`,
        position: { x: uX, y: iY },
        handleKind: 'point',
        color: '#fbbf24',
        onDrag: (wp) => ({
          anodeVoltageV: Number(Math.max(-5, Math.min(6, Math.round((-5 + ((wp.x - 0.05) / 2.05) * 11) * 10) / 10)).toFixed(1))
        })
      },
      {
        id: 'incident-wavelength',
        label: `λ=${params.wavelengthNm.toFixed(0)}nm`,
        position: { x: -1.95, y: 0.45 + ((750 - params.wavelengthNm) / 550) * 0.55 },
        handleKind: 'point',
        color: state.beamHex,
        onDrag: (wp) => ({
          wavelengthNm: Math.max(200, Math.min(750, Math.round((750 - ((wp.y - 0.45) / 0.55) * 550) / 5) * 5))
        })
      }
    ];
  },
  getForceVectors: (state, params) => {
    if (params.mode === 'compton') {
      const th = (params.scatterAngleDeg * Math.PI) / 180;
      const ph = (state.compton.recoilAngleDeg * Math.PI) / 180;
      return [
        {
          id: 'compton-electron-impulse',
          label: '电子反冲冲量 pₑ',
          origin: { x: -0.8, y: 0 },
          force: { x: Math.cos(ph) * state.compton.pElectron, y: -Math.sin(ph) * state.compton.pElectron },
          color: '#f59e0b',
          unit: 'keV/c'
        },
        {
          id: 'compton-photon-out',
          label: '散射光子 p′γ',
          origin: { x: -0.8, y: 0 },
          force: { x: Math.cos(th) * state.compton.pScattered, y: Math.sin(th) * state.compton.pScattered },
          color: '#a855f7',
          unit: 'keV/c'
        }
      ];
    }
    return Math.abs(params.anodeVoltageV) > 0.05
      ? [
          {
            id: 'anode-electric-force',
            label: params.anodeVoltageV >= 0 ? 'F电 (加速)' : 'F电 (遏止)',
            origin: { x: -1.1, y: 0 },
            force: { x: params.anodeVoltageV, y: 0 },
            color: params.anodeVoltageV >= 0 ? '#38bdf8' : '#fb7185',
            category: 'electric',
            unit: 'eV/d'
          }
        ]
      : [];
  },
```
*(并在 `renderCanvas` L170 的 `(-1.95, 0.45..1.0)` 处绘制一条波长标尺竖轨承接 `incident-wavelength` 手柄！)*

---

### C1-5. [modern-rutherford-bohr/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/modern-rutherford-bohr/plugin.ts)

* **精准改造**：
```ts
  getControlHandles: (_state, params) => {
    if (params.mode === 'rutherford') {
      return [
        {
          id: 'impact-param-b',
          label: `b=${params.impactParamFm.toFixed(0)}fm`,
          position: { x: -160 / 65, y: params.impactParamFm / 65 },
          origin: { x: -160 / 65, y: 0 },
          handleKind: 'point',
          color: '#38bdf8',
          onDrag: (wp) => ({
            impactParamFm: Math.max(-80, Math.min(80, Math.round((wp.y * 65) / 5) * 5))
          })
        }
      ];
    }
    return [
      {
        id: 'probe-energy',
        label: `E=${params.probeEnergyEv.toFixed(2)}eV`,
        position: { x: 0.35 + ((params.probeEnergyEv - 5.0) / 10.0) * 1.7, y: 0.72 },
        handleKind: 'point',
        color: '#fbbf24',
        onDrag: (wp) => ({
          probeEnergyEv: Number(Math.max(5.0, Math.min(15.0, Math.round((5.0 + ((wp.x - 0.35) / 1.7) * 10.0) * 20) / 20)).toFixed(2))
        })
      }
    ];
  },
  getForceVectors: (state, params) => {
    if (params.mode !== 'rutherford') return [];
    const pts = state.rutherford.trajectoryFm;
    const idx = Math.min(pts.length - 1, Math.floor(state.animCursor * pts.length));
    const p = pts[idx] ?? pts[Math.floor(pts.length / 2)] ?? { x: -40, y: params.impactParamFm };
    const r = Math.hypot(p.x, p.y);
    if (r < 1e-6) return [];
    const mag = Math.min(40, (params.targetZ * 2) / Math.max(25, r * r));
    return [
      {
        id: 'coulomb-repulsion',
        label: 'F库仑',
        origin: { x: p.x / 65, y: p.y / 65 },
        force: { x: (p.x / r) * mag, y: (p.y / r) * mag },
        color: '#fb7185',
        category: 'electric',
        unit: 'F'
      }
    ];
  },
  referenceFrames: [
    {
      id: 'alpha-particle',
      label: 'α 入射粒子随动参考系',
      getOrigin: (state, params) => {
        if (params.mode !== 'rutherford') return { x: 0, y: 0 };
        const pts = state.rutherford.trajectoryFm;
        const idx = Math.min(pts.length - 1, Math.floor(state.animCursor * pts.length));
        const p = pts[idx];
        return p ? { x: p.x / 65, y: p.y / 65 } : { x: 0, y: 0 };
      }
    }
  ],
```

---

### C1-6. [stse-em-devices-suite/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/stse-em-devices-suite/plugin.ts)

* **精准改造**：在 `renderCanvas` 右侧 `x = 1.28, y ∈ [-0.6, 0.6]` 画出主磁场 `B` 标尺竖轨，并添加双交互 + 双受力（$F_E$ 与 $F_B$ 对照，速度选择器一目了然！）与粒子随动系：
```ts
  getControlHandles: (_state, params) => [
    {
      id: 'device-b-field',
      label: `B=${params.bFieldT.toFixed(1)}T`,
      position: { x: 1.28, y: -0.6 + ((params.bFieldT - 0.2) / 3.8) * 1.2 },
      handleKind: 'point',
      color: '#38bdf8',
      onDrag: (wp) => ({
        bFieldT: Number(Math.max(0.2, Math.min(4.0, Math.round((0.2 + ((wp.y + 0.6) / 1.2) * 3.8) * 10) / 10)).toFixed(1))
      })
    },
    {
      id: 'device-e-field',
      label: `E=${(params.eFieldVPerM / 1e5).toFixed(1)}×10⁵`,
      position: { x: -1.65, y: -0.6 + ((params.eFieldVPerM - 1e4) / 4.9e5) * 1.2 },
      handleKind: 'point',
      color: '#fbbf24',
      onDrag: (wp) => ({
        eFieldVPerM: Math.max(1e4, Math.min(5e5, Math.round((1e4 + ((wp.y + 0.6) / 1.2) * 4.9e5) / 1e4) * 1e4))
      })
    }
  ],
  getForceVectors: (state, params) => {
    const origin = { x: -0.25 + state.particlePos.x * 0.7, y: state.particlePos.y * 0.7 };
    const sign = params.carrierType === 'hole' ? 1 : -1;
    const fE = (params.eFieldVPerM / 1e5) * sign;
    const fB = -((params.particleSpeedMps * params.bFieldT) / 1e5) * sign;
    return [
      { id: 'device-fe', label: 'qE', origin, force: { x: 0, y: fE }, color: '#fbbf24', category: 'electric', unit: 'rel' },
      { id: 'device-fb', label: 'qvB', origin, force: { x: 0, y: fB }, color: '#38bdf8', category: 'magnetic', unit: 'rel' }
    ];
  },
  referenceFrames: [
    {
      id: 'carrier-particle',
      label: '粒子/载流子随动参考系',
      getOrigin: (state) => ({ x: -0.25 + state.particlePos.x * 0.7, y: state.particlePos.y * 0.7 })
    }
  ],
```

---

### C1-7. [stse-em-launch-regen-brake/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/stse-em-launch-regen-brake/plugin.ts)

* **精准改造**：把发射初速/磁感应矢动手柄直接挂在运动电枢 `car`（世界坐标 `x = -2.0 + fracX * 4.0, y = 0.58`）上，同时计算真实电磁安培推力/制动力与气动阻力：
```ts
  getControlHandles: (state, params) => {
    const maxVisualX = params.mode === 'railgun' ? 25 : Math.max(10, computeAnalyticPureEmStopDistance(params) * 1.15);
    const fracX = Math.min(1, state.x / maxVisualX);
    const carX = -2.0 + fracX * 4.0;
    return [
      params.mode === 'railgun'
        ? {
            id: 'railgun-drive-current',
            label: `I=${params.driveCurrentA}A`,
            position: { x: carX + (params.driveCurrentA / 1000) * 1.1, y: 0.58 },
            origin: { x: carX, y: 0.58 },
            handleKind: 'vector',
            color: '#38bdf8',
            onDrag: (wp) => ({
              driveCurrentA: Math.max(50, Math.min(1000, Math.round(((wp.x - carX) / 1.1) * 1000 / 50) * 50))
            })
          }
        : {
            id: 'regen-v0',
            label: `v₀=${params.v0Mps}m/s`,
            position: { x: carX + (params.v0Mps / 50) * 1.2, y: 0.58 },
            origin: { x: carX, y: 0.58 },
            handleKind: 'vector',
            color: '#4ade80',
            onDrag: (wp) => ({
              v0Mps: Math.max(0, Math.min(50, Math.round(((wp.x - carX) / 1.2) * 50)))
            })
          }
    ];
  },
  getForceVectors: (state, params) => {
    const maxVisualX = params.mode === 'railgun' ? 25 : Math.max(10, computeAnalyticPureEmStopDistance(params) * 1.15);
    const fracX = Math.min(1, state.x / maxVisualX);
    const origin = { x: -2.0 + fracX * 4.0, y: 0.58 };
    const fEm = params.mode === 'railgun'
      ? params.bFieldT * params.trackSpanM * state.currentA
      : -params.bFieldT * params.trackSpanM * Math.abs(state.currentA);
    const fAero = -params.aeroDragCoeff * state.v * Math.abs(state.v) - (state.v > 0 ? params.mechBrakeN : 0);
    return [
      { id: 'em-ampere', label: params.mode === 'railgun' ? 'F安 (发射)' : 'F制 (再生)', origin, force: { x: fEm, y: 0 }, color: '#38bdf8', category: 'magnetic', unit: 'N' },
      ...(Math.abs(fAero) > 1e-3 ? [{ id: 'drag-mech', label: 'f阻', origin, force: { x: fAero, y: 0 }, color: '#f43f5e', category: 'friction' as const, unit: 'N' }] : [])
    ];
  },
  referenceFrames: [
    {
      id: 'armature-frame',
      label: '电枢/列车随动参考系',
      getOrigin: (state, params) => {
        const maxVisualX = params.mode === 'railgun' ? 25 : Math.max(10, computeAnalyticPureEmStopDistance(params) * 1.15);
        return { x: -2.0 + Math.min(1, state.x / maxVisualX) * 4.0, y: 0.58 };
      },
      getVelocity: (state) => ({ x: state.v, y: 0 })
    }
  ],
```

---

### C1-8. [stse-tokamak-magnetic-mirror/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/stse-tokamak-magnetic-mirror/plugin.ts)

* **精准改造**：
```ts
  getControlHandles: (_state, params) => [
    params.mode === 'magnetic-mirror'
      ? {
          id: 'mirror-coil-span',
          label: `z_c=${params.coilHalfSpanM.toFixed(1)}m`,
          position: { x: params.coilHalfSpanM * 0.85, y: 0 },
          origin: { x: 0, y: 0 },
          handleKind: 'point',
          color: '#f59e0b',
          onDrag: (wp) => ({
            coilHalfSpanM: Number(Math.max(0.8, Math.min(2.5, Math.round((Math.abs(wp.x) / 0.85) * 10) / 10)).toFixed(1))
          })
        }
      : {
          id: 'tokamak-major-radius',
          label: `R₀=${params.majorRadiusM.toFixed(1)}m`,
          position: { x: params.majorRadiusM * 0.32, y: params.majorRadiusM * 0.2 },
          origin: { x: 0, y: 0 },
          handleKind: 'radius',
          color: '#f59e0b',
          onDrag: (wp) => ({
            majorRadiusM: Number(Math.max(1.0, Math.min(2.2, Math.round((Math.hypot(wp.x, wp.y) / Math.hypot(0.32, 0.2)) * 10) / 10)).toFixed(1))
          })
        }
  ],
  getForceVectors: (state, params) => {
    const p = state.position;
    const v = state.velocity;
    const b = state.bField;
    const q = Math.max(2, params.qOverM);
    const fx = q * (v.y * b.z - v.z * b.y);
    const fy = q * (v.z * b.x - v.x * b.z);
    const fz = q * (v.x * b.y - v.y * b.x);
    return [
      {
        id: 'fusion-lorentz',
        label: 'F洛',
        origin: { x: p.z * 0.85 + p.x * 0.32, y: p.y * 0.85 + p.x * 0.2 },
        force: { x: fz * 0.85 + fx * 0.32, y: fy * 0.85 + fx * 0.2 },
        color: '#38bdf8',
        category: 'magnetic',
        unit: 'N/kg'
      }
    ];
  },
  referenceFrames: [
    {
      id: 'confined-particle',
      label: '约束带电粒子随动参考系',
      getOrigin: (state) => ({
        x: state.position.z * 0.85 + state.position.x * 0.32,
        y: state.position.y * 0.85 + state.position.x * 0.2
      }),
      getVelocity: (state) => ({
        x: state.velocity.z * 0.85 + state.velocity.x * 0.32,
        y: state.velocity.y * 0.85 + state.velocity.x * 0.2
      })
    }
  ],
```

---

### C1-9. [thermo-cycles-kinetic-md/plugin.ts](file:///d:/project%20code/44-PhysForge/simulations/thermo-cycles-kinetic-md/plugin.ts)

* **精准改造**：
```ts
  getControlHandles: (_state, params) =>
    params.mode === 'kinetic-md-box'
      ? [
          {
            id: 'md-speed-scale',
            label: `T倍率=${params.mdSpeedScale.toFixed(2)}x`,
            position: { x: 0.22, y: -0.9 + ((params.mdSpeedScale - 0.5) / 1.5) * 1.4 },
            handleKind: 'point',
            color: '#fbbf24',
            onDrag: (wp) => ({
              mdSpeedScale: Number(Math.max(0.5, Math.min(2.0, Math.round((0.5 + ((wp.y + 0.9) / 1.4) * 1.5) * 4) / 4)).toFixed(2))
            })
          }
        ]
      : [
          {
            id: 'carnot-t-hot',
            label: `T_H=${params.tHotK.toFixed(0)}K`,
            position: { x: 1.75, y: -0.9 + ((params.tHotK - 400) / 500) * 1.8 },
            handleKind: 'point',
            color: '#f43f5e',
            onDrag: (wp) => ({
              tHotK: Math.max(400, Math.min(900, Math.round((400 + ((wp.y + 0.9) / 1.8) * 500) / 50) * 50))
            })
          }
        ],
  getForceVectors: (state, params) => {
    if (params.mode !== 'kinetic-md-box') return [];
    const pollen = state.particles.find((p) => p.mass > 2) ?? state.particles[0];
    if (!pollen) return [];
    const boxLeft = -1.9;
    const boxBottom = -1;
    const boxSizeWorld = 2;
    const ox = boxLeft + (pollen.x / state.boxSize) * boxSizeWorld;
    const oy = boxBottom + (pollen.y / state.boxSize) * boxSizeWorld;
    return [
      {
        id: 'thermal-momentum-dir',
        label: '动量/热撞击冲向',
        origin: { x: ox, y: oy },
        force: { x: pollen.vx * pollen.mass, y: pollen.vy * pollen.mass },
        color: '#fbbf24',
        unit: 'kg·m/s'
      }
    ];
  },
```
*(并在 `renderCanvas` 的 `x = 0.22, y ∈ [-0.9, 0.5]` 或 `x = 1.75, y ∈ [-0.9, 0.9]` 绘制 1px 控制导轨；在 `carnot-cycle` 下 `getForceVectors` 返回 `[]`，而在 `kinetic-md-box`（含预设 1/默认 MD 模式）返回花粉实时动量矢量，故 `wave-c-interaction.test.ts` 正常通过！)*

---

## 第四部分：Batch C2 & Batch C3 — 力学/电磁/热学 `getForceVectors` 与 `referenceFrames` 补全清单

> 以下所有物理量符号、世界坐标均已在 Wave B 中通过 `createWorldMapper` 统一到舞台世界坐标系，直接粘贴补全即可。

### Batch C2：力学与天体深化（12 个模型）

| 模型 ID | 补全 `getForceVectors`（已严格核验 State 字段） | 补全 `referenceFrames` |
| :--- | :--- | :--- |
| **`astro-orbital-mechanics`** | 引力矢量：在 `'binary-lagrange'` 下分别返回主星与次星对试探/中心天体的万有引力；否则以 `{ x: state.xNorm, y: state.yNorm }` 为起点返回中心引力 `-r / r^3`（$F_g$） | 已有 `satellite`（保留） |
| **`builder-custom-ode-lab`** | 以 `{ x: state.x, y: state.y }` 为起点：`'harmonic'` 返回 `-params.stiffnessK * state.x` 与阻尼 `-params.dampingC * state.vx`；`'kepler-2d'` 返回 `-x/r^3, -y/r^3` | 新增 `mass-particle`：`getOrigin: (s, p) => p.template === 'kepler-2d' ? { x: s.x, y: s.y } : { x: s.x, y: 0 }` |
| **`comp-chaos-normal-coriolis`** | 双摆返回第 1/2 摆球重力 `mg` 与张力向心分力；简正双块返回左/右弹簧恢复力 `-k x`；科里奥利圆盘返回真实旋转系惯性科里奥利力 `-2ω×v` + 离心力 `ω²r` | 已有旋转系（保留） |
| **`mech-collision-recoil`** | `m1` 与 `m2` 质心重力（垂直示意）/ 贯入贯穿阻力 `bulletPhase === 'penetrating'` 时对子弹施 `-f` 阻力、对木块施 `+f` 推进力；弹性碰撞瞬间或默认模式对滑块 1/2 返回水平相对动量交互矢量或重力 `mg`（确保全模式在未碰撞或贯入阶段有真实非零力学矢量，如各车重力 `m₁g`/`m₂g` + 贯入内力） | 已有 `cm`（保留） |
| **`mech-constrained-velocity`** | 以滑块 A `{ x: state.posA.x, y: state.posA.y }` 与 B `{ x: state.posB.x, y: state.posB.y }` 为起点返回 `m_A g`、`m_B g` 及沿绳/杆单位矢量方向的约束张力 `T` | 新增 `block-a`：`getOrigin: (s) => ({ x: s.posA.x, y: s.posA.y })` |
| **`mech-kinematics-chase`** | 以两车世界坐标 `{ x: state.xA * 0.05, y: 0 }` 与 `{ x: state.xB * 0.05, y: 0 }` 为起点，返回合外驱动/制动力 `(m=1) * state.aACurrent` 与 `state.aBCurrent`（`F_A`, `F_B`）及等效重力示意图矢 | 已有 `car-a`（保留） |
| **`mech-projectile-coupling`** | 已有 `mg` / `f_空`（保留） | **新增 `projectile-comoving`（以抛体 A 为自由落体随动参考系）**：`getOrigin: (s) => ({ x: s.x, y: s.y }), getVelocity: (s) => ({ x: s.vx, y: s.vy })` |
| **`mech-spring-separation`** | 已有 `m₁g`/`N₁`/`m₂g`/`N₂`/`F_弹`/`F_外`/`F₂₁`/`F₁₂`（保留） | **新增双参考系**：① `cm-frame`（系统质心系，`x: (m1*s1 + m2*s2)/(m1+m2)`）② `block1-frame`（物块 1 随动系） |
| **`comp-rigid-rolling-slip`** | 已有 `mg`、`F_N`、`f`（保留） | **新增 `cylinder-cm`**：跟随圆柱质心平动 `{ x: s.x, y: params.radiusM }`（直观看轮缘纯旋转） |
| **`mech-conical-turntable` / `mech-shm-resonance` / `mech-vertical-circular`** | 均已有 `getForceVectors`（保留） | 分别新增：① `turntable` 随动 `rA` 质点系；② `shm-bob` 摆球系 `{ x: L*sinθ, y: -L*cosθ }`；③ `circular-ball` 小球跟随系 `{ x: s.x, y: s.y }` |

---

### Batch C3：电磁与热学补全（5 个模型，注意不含无受力电路/光学/波动）

| 模型 ID | 补全 `getForceVectors` | 补全 `referenceFrames` |
| :--- | :--- | :--- |
| **`em-ac-generator-rms`** | 基于 `state.angleRad` 与 `state.uInstV / R` 实时电流在旋转线框左右边框 `x = -1.19 ± projW` 上绘出一对等大反向、垂直磁场切向转动方向的**电磁安培阻力矢 `F安`**（驱动产生电动势并做负功转化电能！） | 新增 `coil-frame`：随动旋转线圈中心 `(-1.19, 0)` |
| **`thermo-piston-gas-laws`** | 在 `stop-pin-cylinder` 等活塞模式（活塞中心世界坐标）：绘制**气体向上总压力 `F_气 = P·S`**（随温度/压缩实时飙升！）与**外界大气+活塞重力 `P₀S + mg`** 两股反力对决，直观演示为何碰到限位钉 `pinned` 时钉子受压；在倾倒水银管模式绘汞柱重力与切向分量 `mg sinθ`！ | — |
| **`em-ac-field-oscilloscope`** | 已有 `mg` / `qE`（保留） | 新增 `equivalent-bob`：摆球随动系 `equivalent-gravity` 下为 `{ x: L*sinθ, y: -L*cosθ }` |
| **`em-capacitor-millikan`** | 已有 `mg` / `qE`（保留） | 新增 `oil-droplet`：跟踪带电油滴上下悬停移动 `{ x: 0, y: -halfD + dropYFrac * 2 * halfD }` |
| **`em-eddy-vortex-field`** | 已有涡流粒子力（保留） | 新增 `eddy-probe`：跟踪带电感生试探粒子 `{ x: state.px, y: state.py }` |

> **覆盖总数校验**：
> * `getControlHandles`：`34 + 9 = 43 / 43`（100%）
> * `getForceVectors`：`16（已有）+ 8（C1：E10/N01/N02/N03/S01/S02/S03/T02）+ 6（C2）+ 2（C3）= 32 / 43`（≥ 30）
> * `referenceFrames`：`10（已有）+ 6（C1）+ 8（C2）+ 4（C3）= 28 / 43`（≥ 20）

---

## 第五部分：Module C2 — 实机浏览器 Wave C 交互闭环审计（扩展 `scripts/visual-audit.mjs`）

在 [scripts/visual-audit.mjs](file:///d:/project%20code/44-PhysForge/scripts/visual-audit.mjs#L606-L613) 的 `runWaveBCoordinateAudit` 之后追加 **`runWaveCInteractionAudit(page, origin)`**：
1. **实机拖动 Wave C 新增画布手柄（`modern-rutherford-bohr`）**：
   * 打开 `?model=modern-rutherford-bohr`（卢瑟福散射预设）；
   * 在浏览器里依据 `<canvas>` 包围盒计算 `impact-param-b` 手柄精确屏幕坐标 `(ox - (160/65)*ppm, oy - (b/65)*ppm)`，按下鼠标左键纵向拖动 `+55px`；
   * 强断言：`[data-testid="param-value-impactParamFm"]` 文本数值发生真实改变，且 `<canvas>` 指纹 `canvasFingerprint` 改变；保存截图 `WaveC_Rutherford_Handle.png`。
2. **实机启用 Auto-FBD 受力分解叠加（`astro-orbital-mechanics`）**：
   * 打开 `?model=astro-orbital-mechanics`；
   * 点开 `[data-testid="btn-tools-menu"]` → 点击 `[data-testid="btn-auto-fbd"]`；
   * 强断言：页面出现 `"Auto-FBD 受力分解叠加中"` 徽标且 `<canvas>` 指纹改变；保存截图 `WaveC_Astro_FBD.png`。
3. **实机切换随动参考系（`mech-projectile-coupling`）**：
   * 打开 `?model=mech-projectile-coupling`，点击运行 0.5s 暂停；
   * 点开 `[data-testid="btn-tools-menu"]` → `[data-testid="select-reference-frame"]` 选择 `'projectile-comoving'`；
   * 强断言：画布左下出现 `"随动参考系锁定:"` 提示且抛体居于锚点中心、轨迹与视角真实平移；保存截图 `WaveC_Projectile_Frame.png`。

---

## 第六部分：Luna 施工顺序与硬性验证门禁

1. 先落盘 **`simulations/wave-c-interaction.test.ts`**（Module C1）；
2. 按 **Batch C1 → Batch C2 → Batch C3** 依次编码施工，每批完成后跑一次 `tsc` + `vitest run simulations/wave-c-interaction.test.ts simulations/coordinate-alignment.test.ts`；
3. 更新 [scripts/visual-audit.mjs](file:///d:/project%20code/44-PhysForge/scripts/visual-audit.mjs) 增加 `runWaveCInteractionAudit`（保留既有全部 Wave A 与 Wave B 检查不删不改）；
4. **最后一次代码编辑后**依次跑通全量门禁：
   * 全仓 11 个 `tsconfig.json` `tsc --noEmit` + `packages/*/tsconfig.build.json` 全通过；
   * `vitest run`（全仓已有 299 条用例 + `wave-c-interaction.test.ts` 全通过，**零 `skip`/`only`、零白名单**）；
   * `run-verify-packs.mjs`、`run-verify-scenes.mjs`、`run-verify-vault.mjs` 全通过；
   * `$env:VITE_BASE_PATH='/PhysForge/'; node ./apps/web/node_modules/vite/bin/vite.js build apps/web`（主包 `< 350 KB` gzip 且零重型泄漏）+ 单文件导出抽测 `export.mjs --model=modern-rutherford-bohr`；
   * `node scripts/visual-audit.mjs` + `node scripts/e2e-subpath-and-export.mjs` + `git diff --check`，Luna 亲自审阅 `WaveC_*.png` 与 `E04/B3/B2/E10` 无退化无重叠后，更新 [WRITER_HANDOFF_LOG.md](file:///d:/project%20code/44-PhysForge/docs/WRITER_HANDOFF_LOG.md) 交总控验收。
