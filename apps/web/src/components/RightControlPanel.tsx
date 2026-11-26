import React, { useMemo, useState } from 'react';
import type { AnySimulationPlugin } from '@physforge/simulations/registry';
import type { ParamRecord } from '@physforge/sim-sdk';
import type { TelemetrySummary } from '../store/useClassroomStore.js';
import { KatexFormulaCard } from './KatexFormulaCard.js';
import { EnergyBarChart } from './EnergyBarChart.js';

interface RightControlPanelProps {
  plugin: AnySimulationPlugin;
  activePresetId: string | null;
  params: ParamRecord;
  activeLayers: readonly string[];
  telemetry: TelemetrySummary;
  onApplyPreset: (presetId: string) => void;
  onUpdateParam: (key: string, value: number | boolean | string) => void;
  onToggleLayer: (layerId: string) => void;
  onClose: () => void;
}

const CONTEXT_CORE_KEYS: Readonly<Record<string, readonly string[]>> = {
  'em-induction-double-rod': ['batteryEmf', 'magneticB', 'resistorR', 'externalForce'],
  'builder-optics-ray': ['incidentAngleDeg', 'n1', 'n2', 'objectDistanceM'],
  'optics-ray-studio': ['incidentAngleDeg', 'n1', 'n2', 'objectDistanceM'],
  'builder-circuit-mna': ['emf', 'sliderR', 'internalR'],
  'circuit-dc-capacitor-mna': ['emf', 'sliderR', 'internalR'],
  'em-3d-magnetic-fields': ['currentI', 'radiusR', 'solenoidTurns'],
  'mech-kinematics-chase':['xB0','vA0','aA']
};

export const RightControlPanel: React.FC<RightControlPanelProps> = ({
  plugin,
  activePresetId,
  params,
  activeLayers,
  telemetry,
  onApplyPreset,
  onUpdateParam,
  onToggleLayer
}) => {
  const [showLiveSubstituted, setShowLiveSubstituted] = useState(false);

  const { coreFields, extraFields } = useMemo(() => {
    if(plugin.getParamFields){const fields=plugin.getParamFields(params);const core=[...fields.filter(f=>f.kind!=='number'),...fields.filter(f=>f.kind==='number').slice(0,3)];const keys=new Set(core.map(f=>f.key));return {coreFields:core,extraFields:fields.filter(f=>!keys.has(f.key))};}
    const circuit=plugin.meta.id==='builder-circuit-mna'||plugin.meta.id==='circuit-dc-capacitor-mna';
    const circuitFields:Record<string,string[]>={
      'divider-lamp':['emf','sliderR','internalR','topology'],
      'closed-power':['emf','sliderR','internalR','topology'],
      'series-parallel-dynamic':['emf','sliderR','internalR','r1','r2','topology'],
      'rc-transient':['emf','r1','capacitance','internalR','switchClosed','topology'],
      'rc-bridge-charge':['emf','sliderR','internalR','r1','r2','capacitance','topology'],
      'nonlinear-lamp-diode':['emf','sliderR','internalR','switchClosed','topology']
    };
    const optics=plugin.meta.id==='builder-optics-ray';
    const opticsFields:Record<string,string[]>={
      'tir-interface':['incidentAngleDeg','n1','n2','sceneMode','animateSweep'],
      'parallel-slab':['incidentAngleDeg','n1','slabThickness','sceneMode','animateSweep'],
      'prism-dispersion':['incidentAngleDeg','n1','prismApexDeg','sceneMode','animateSweep'],
      'optical-fiber':['incidentAngleDeg','n1','n2','fiberHalfWidth','sceneMode','animateSweep'],
      'double-slit':['wavelengthNm','slitSeparationMm','screenDistanceM','sceneMode'],
      'thin-lens-imaging':['objectDistanceM','focalLengthM','sceneMode']
    };
    const mechanics=plugin.meta.id==='builder-mechanics-lab';
    const mechanicsFields:Record<string,string[]>={
      'elastic-collision':['restitution','massRatio','gravity','scenario'],
      'incline-slide':['inclineDeg','friction','massRatio','restitution','gravity','scenario'],
      'spring-oscillator':['springK','gravity','scenario'],
      'newtons-cradle':['restitution','gravity','scenario'],
      'atwood-constrained':['massRatio','gravity','scenario']
    };
    const valid=circuit?circuitFields[String(params.topology)]:optics?opticsFields[String(params.sceneMode)]:mechanics?mechanicsFields[String(params.scenario)]:undefined;
    const preferred = valid ?? (plugin.meta.id === 'modern-photoelectric-compton'
      ? params.mode === 'compton' ? ['xrayWavelengthNm', 'scatterAngleDeg'] : ['wavelengthNm', 'intensityRel', 'anodeVoltageV']
      : CONTEXT_CORE_KEYS[plugin.meta.id]);
    const numericFields = plugin.paramSchema.filter((field) => field.kind === 'number');
    const core = preferred
      ? preferred.flatMap((key) => {
          const field = plugin.paramSchema.find((candidate) => candidate.key === key);
          return field?.kind === 'number' ? [field] : [];
        }).slice(0, 3)
      : numericFields.slice(0, 3);
    const coreKeys = new Set(core.map((field) => field.key));
    return {
      coreFields: core,
      extraFields: plugin.paramSchema.filter((field) => !coreKeys.has(field.key) && (!valid||valid.includes(field.key)))
    };
  }, [plugin, params.mode, params.topology, params.sceneMode, params.scenario, params.template,params.radiusM,params.anchorHeightM,params.systemMode,params.trackMode]);

  const renderField = (field: (typeof plugin.paramSchema)[number]) => {
    const value = params[field.key] ?? field.defaultValue;
    if (field.kind === 'number') {
      const numberValue = typeof value === 'number' ? value : field.defaultValue;
      const min = field.min ?? 0;
      const max = field.max ?? 100;
      const progress = max > min ? Math.max(0, Math.min(100, ((numberValue - min) / (max - min)) * 100)) : 0;
      const decimals = String(field.step ?? '').split('.')[1]?.length ?? 1;
      const shortLabel = plugin.meta.id==='builder-circuit-mna' && params.topology==='divider-lamp' && field.key==='sliderR' ? '滑片下段 Rₚ' : field.label.replace(/（[^）]*）/g, '');
      return (
        <div key={field.key} className="space-y-0.5">
          <div className="flex items-baseline justify-between gap-2 text-[11px] font-medium">
            <label htmlFor={`param-${field.key}`} className="min-w-0 truncate text-slate-300">{shortLabel}</label>
            <span data-testid={`param-value-${field.key}`} className="shrink-0 font-mono tabular-nums text-slate-100">
              {numberValue.toFixed(Math.min(Math.max(decimals, 1), field.key === 'xrayWavelengthNm' ? 3 : 2))} {field.unit ?? ''}
            </span>
          </div>
          <input
            id={`param-${field.key}`}
            type="range"
            data-testid={`param-slider-${field.key}`}
            min={field.min}
            max={field.max}
            step={field.step}
            value={numberValue}
            onChange={(event) => onUpdateParam(field.key, Number(event.target.value))}
            className="pf-slider pf-touch-target"
            style={{ '--pf-progress': `${progress}%` } as React.CSSProperties}
          />
        </div>
      );
    }
    if (field.kind === 'boolean') {
      const checked = typeof value === 'boolean' ? value : field.defaultValue;
      return (
        <label key={field.key} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-950/35 px-2.5 py-1.5 text-[11px] text-slate-200">
          <span>{plugin.meta.id==='builder-circuit-mna'&&field.key==='switchClosed'?(params.topology==='rc-transient'?'充电初态（取消为放电；重置时间）':'二极管（取消为灯泡）'):field.label}</span>
          <input type="checkbox" checked={checked} onChange={(event) => onUpdateParam(field.key, event.target.checked)} className="h-4 w-4 accent-sky-400" />
        </label>
      );
    }
    const selected = typeof value === 'string' ? value : field.defaultValue;
    if(field.customTextMaxLength!==undefined)return <div key={field.key} className="space-y-1"><label htmlFor={'param-'+field.key} className="block text-[10px] text-slate-400">{field.label}</label><select aria-label="示例方程" value={field.options.some(o=>o.value===selected)?selected:''} onChange={e=>{if(e.target.value)onUpdateParam(field.key,e.target.value);}} className="w-full rounded border px-2 py-1 text-xs" style={{background:'var(--pf-surface-elevated)'}}><option value="">自定义表达式</option>{field.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select><form key={selected} onSubmit={e=>{e.preventDefault();onUpdateParam(field.key,String(new FormData(e.currentTarget).get('expression')??''));}} className="space-y-1"><textarea id={'param-'+field.key} data-testid="ode-expression-input" name="expression" defaultValue={selected} maxLength={field.customTextMaxLength} rows={3} className="w-full rounded border p-2 font-mono text-xs" style={{background:'var(--pf-surface-elevated)'}}/><button type="submit" data-testid="ode-expression-apply" className="w-full rounded bg-sky-500/20 px-2 py-1 text-xs text-sky-300">应用方程并复位</button></form><div className="text-[10px] text-slate-400">显式乘法 *；变量 x,v,t,k,m,g,A,w,gamma；最多256字符，量纲由建模者指定。</div></div>;
    return (
      <div key={field.key} className="space-y-1">
        <label htmlFor={`param-${field.key}`} className="block text-[10px] text-slate-400">{field.label}</label>
        <select id={`param-${field.key}`} value={selected} onChange={(event) => onUpdateParam(field.key, event.target.value)} className="h-8 w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 text-xs text-slate-100">
          {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
    );
  };

  const isCircuit = plugin.meta.id === 'builder-circuit-mna' || plugin.meta.id === 'circuit-dc-capacitor-mna';
  const emf = typeof params.emf === 'number' ? params.emf : 12;
  const divider = isCircuit && params.topology==='divider-lamp';
  const circuitReadouts:Record<string,{key:string;label:string;unit:string}[]>={
    'closed-power':[{key:'totalCurrent',label:'干路 I',unit:'A'},{key:'terminalVoltage',label:'路端 U',unit:'V'},{key:'outputPower',label:'负载功率 P',unit:'W'}],
    'series-parallel-dynamic':[{key:'totalCurrent',label:'干路 I',unit:'A'},{key:'branchCurrent1',label:'R₂ 支路 I₂',unit:'A'},{key:'branchCurrent2',label:'Rₚ 支路 Iₚ',unit:'A'}],
    'rc-transient':[{key:'capVoltage',label:'电容 U꜀',unit:'V'},{key:'capCurrent',label:'电容 I꜀',unit:'A'},{key:'capCharge',label:'电荷 Q',unit:'C'}],
    'rc-bridge-charge':[{key:'capVoltage',label:'左−右电势差 U꜀',unit:'V'},{key:'capCurrent',label:'左→右 I꜀',unit:'A'},{key:'capCharge',label:'左板电荷 Q',unit:'C'}],
    'nonlinear-lamp-diode':[{key:'totalCurrent',label:'干路 I',unit:'A'},{key:'terminalVoltage',label:'器件电压 U',unit:'V'},{key:'outputPower',label:'器件功率 P',unit:'W'}]
  };
  const isInduction = plugin.meta.id === 'em-induction-double-rod';
  const isOpticalInterface = plugin.meta.id === 'builder-optics-ray' && params.sceneMode === 'tir-interface';
  const energyReadouts = [
    { key: 'kineticEnergy', label: '总动能 Eₖ' },
    { key: 'jouleHeat', label: '累计焦耳热 Q' },
    ...(params.rodMode === 'single' && params.circuitLoad === 'capacitor' ? [{ key: 'capacitorEnergy', label: '电容储能 E꜀' }] : []),
    ...(params.rodMode === 'single' && params.circuitLoad === 'battery' ? [{ key: 'sourceWork', label: '电源做功 W' }] : [])
  ];
  const kineticEnergy = telemetry.observables.kineticEnergy;
  const dissipatedOrStoredEnergy = telemetry.observables.jouleHeat ?? telemetry.observables.capacitorEnergy;
  const hasEnergyMetrics = (typeof kineticEnergy === 'number' && Number.isFinite(kineticEnergy))
    || (typeof dissipatedOrStoredEnergy === 'number' && Number.isFinite(dissipatedOrStoredEnergy));
  const kineticPct = Math.max(0, Math.min(100, Math.round(((kineticEnergy ?? 0) / 10) * 100)));
  const heatPct = Math.max(0, Math.min(100, Math.round(((dissipatedOrStoredEnergy ?? 0) / 10) * 100)));

  return (
    <aside
      data-testid="right-control-panel"
      className="pf-floating-glass absolute right-3 top-[22px] z-20 flex max-h-[calc(100%-34px)] w-[272px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl border border-white/10 text-slate-100 shadow-2xl"
      style={{ borderColor: 'var(--pf-border)' }}
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3.5">
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/45 px-2.5 py-1.5">
          <label htmlFor="preset-select" className="shrink-0 text-[11px] font-medium text-slate-400">预设</label>
          <select
            id="preset-select"
            data-testid="preset-select"
            aria-label="课堂预设"
            value={activePresetId ?? ''}
            onChange={(event) => onApplyPreset(event.target.value)}
            className="min-w-0 flex-1 truncate bg-transparent text-xs font-medium text-slate-100 outline-none cursor-pointer"
          >
            {!activePresetId && <option value="" className="bg-slate-900">自定义参数</option>}
            {plugin.presets.map((preset, index) => (
              <option key={preset.id} value={preset.id} data-testid={`preset-btn-${preset.id}`} className="bg-slate-900 text-slate-100">
                {/^[0-9]+\s*[.、]/.test(preset.name) ? preset.name : `${index + 1}. ${preset.name}`}
              </option>
            ))}
          </select>
          {activePresetId && <span data-testid="active-preset-description" className="sr-only">{plugin.presets.find((preset) => preset.id === activePresetId)?.description}</span>}
        </div>

        <section className="space-y-1.5">{coreFields.map(renderField)}</section>

        <section data-testid="formula-card" className="relative rounded-xl border border-white/10 bg-slate-950/75 px-3 pb-3 pt-7 shadow-inner">
          <button
            type="button"
            data-testid="btn-toggle-formula-values"
            aria-label={showLiveSubstituted ? '隐藏代入数值' : '显示代入数值'}
            aria-pressed={showLiveSubstituted}
            onClick={() => setShowLiveSubstituted((shown) => !shown)}
            title={showLiveSubstituted ? '切换纯符号公式' : '显示实时代入数值'}
            className="absolute right-2 top-1.5 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10 hover:text-sky-300 cursor-pointer"
          >
            {showLiveSubstituted ? '仅符号' : '显示数值'}
          </button>
          {plugin.meta.id==='builder-custom-ode-lab' && telemetry.formulaItems[0] && <div data-testid="ode-equation-caption" className="mb-2 break-all text-xs" style={{color:telemetry.observables.solverValid===0?'#fb7185':'var(--pf-text-muted)'}}>{telemetry.formulaItems[0].label}</div>}
          <KatexFormulaCard items={telemetry.formulaItems} compact showSubstituted={showLiveSubstituted} />
        </section>

        {isCircuit ? (
          <div className="space-y-2 pt-0.5">
            {divider && <section data-testid="b2-divider-readouts" className="space-y-1.5" style={{color:'var(--pf-text-muted)'}}>
              {([{key:'sourceTerminalVoltage',label:'电源路端 Uₛ',unit:'V'},{key:'lampVoltage',label:'灯泡电压 Uₗ',unit:'V'},{key:'lampCurrent',label:'灯泡电流 Iₗ',unit:'A'},{key:'outputPower',label:'灯泡功率 Pₗ',unit:'W'}] as const).map(({key,label,unit})=>{
                const value=telemetry.observables[key];
                return <div key={key} className="flex justify-between gap-2 text-xs"><span>{label}</span><span data-testid={'b2-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof value==='number'&&Number.isFinite(value)?value.toFixed(3)+' '+unit:'—'}</span></div>;
              })}
            </section>}
            {!divider&&<section data-testid="b2-topology-readouts" data-sample-time={telemetry.t} className="space-y-1.5" style={{color:'var(--pf-text-muted)'}}>
              {telemetry.observables.solutionDefined===0&&<div data-testid="b2-invalid" className="text-xs text-rose-400">{params.topology==='nonlinear-lamp-diode'?'超出模型适用范围':emf===0?'理想零阻回路：电流不唯一':'理想短路：无有限解'}</div>}
              {(circuitReadouts[String(params.topology)]??[]).map(({key,label,unit})=>{const value=telemetry.observables[key];return <div key={key} className="flex justify-between gap-2 text-xs"><span>{label}</span><span data-testid={'b2-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{telemetry.observables.solutionDefined!==0&&typeof value==='number'&&Number.isFinite(value)?value.toFixed(3)+' '+unit:'—'}</span></div>;})}
            </section>}
            <div className="flex justify-between font-mono text-[10px]" style={{color:'var(--pf-text-muted)'}}><span>0V</span><span>电势分布</span><span>{emf.toFixed(0)}V</span></div>
            <div data-testid="b2-inspector-potential" data-divider-palette={divider?(emf===0?'zero':'range'):undefined} className="h-1.5 w-full rounded-full bg-gradient-to-r from-sky-400 via-amber-300 to-rose-400 shadow-[0_0_8px_rgba(56,189,248,0.4)]" />
          </div>
        ) : isInduction ? (
          <section data-testid="e04-energy-readouts" className="pf-energy-readouts space-y-2 pt-1">
            {energyReadouts.map(({key,label}) => {
              const value = telemetry.observables[key];
              return <div key={key} className="flex justify-between gap-2 text-xs">
                <span>{label}</span>
                <span data-testid={`e04-energy-${key}`} className="tabular-nums font-medium">{typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(3)} J` : '—'}</span>
              </div>;
            })}
          </section>
        ) : isOpticalInterface ? (
          <section data-testid="b3-interface-power" className="space-y-2 pt-0.5" style={{color:'var(--pf-text-muted)'}}>
            <div className="text-[11px]">非偏振光 · 界面功率分配</div>
            {([{key:'interfaceReflectance',label:'反射率 R',color:'#e8ba76'},{key:'interfaceTransmittance',label:'透射率 T',color:'#38bdf8'}] as const).map(({key,label,color})=>{
              const value=telemetry.observables[key],valid=typeof value==='number'&&Number.isFinite(value);
              const percent=valid?Math.max(0,Math.min(100,value*100)):0;
              return <div key={key}>
                <div className="mb-1 flex justify-between text-xs"><span>{label}</span><span data-testid={key==='interfaceReflectance'?'b3-interface-R':'b3-interface-T'} className="tabular-nums" style={{color:'var(--pf-text)'}}>{valid?percent.toFixed(1)+'%':'—'}</span></div>
                <div className="h-1.5 w-full overflow-hidden rounded-full" style={{background:'var(--pf-border)'}}><div className="h-full rounded-full" style={{width:percent+'%',background:color}}/></div>
              </div>;
            })}
          </section>
        ) : plugin.meta.id==='builder-optics-ray' ? (
          <section data-testid="b3-mode-readouts" className="space-y-1.5" style={{color:'var(--pf-text-muted)'}}>
            {(params.sceneMode==='parallel-slab'?[['refractedAngleDeg','折射角','°'],['lateralShift','侧移量','m']]:
              params.sceneMode==='prism-dispersion'?[['prismDeviationDeg','黄光偏向角','°']]:
              params.sceneMode==='optical-fiber'?[['fiberAcceptanceDeg','空气接受半角','°']]:
              params.sceneMode==='double-slit'?[['fringeSpacingMm','条纹间距','mm']]:
              [['imageDistanceM','像距','m'],['magnification','倍率','']]).map(([key,label,unit])=>{
                const value=telemetry.observables[key!];
                return <div key={key} className="flex justify-between gap-2 text-xs"><span>{label}</span><span data-testid={'b3-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof value==='number'&&Number.isFinite(value)?value.toFixed(3)+' '+unit:'—'}</span></div>;
              })}
            {params.sceneMode==='thin-lens-imaging'&&telemetry.observables.imageAtInfinity===1&&<div data-testid="b3-focus-infinity" className="text-xs">物在焦平面 · 无有限像</div>}
            {params.sceneMode==='optical-fiber'&&Number(params.n1)<=Number(params.n2)&&<div className="text-xs">无全反射导光条件</div>}
          </section>
        ) : plugin.meta.id==='mech-dynamic-equilibrium' ? (
          <section data-testid="equilibrium-readouts" data-sample-time={telemetry.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}>
            {telemetry.observables.solutionDefined===0&&<div data-testid="equilibrium-no-solution" className="font-semibold text-rose-500">当前构型无可靠有限平衡解</div>}
            {([['requestedInitialAngleDeg','初始请求角','°'],['initialAngleDeg','限幅后初始角','°'],['angleDeg','当前实际角','°'],['force1','F₁ 大小','N'],['force2','F₂ 大小','N'],['minPullForceN','理论拉力下界','N'],['ropeLengthM','实际绳长','m'],['rodAxialForceN','轴力 C（压正）','N'],['reactionXN','支承力 Rₓ','N'],['reactionYN','支承力 Rᵧ','N'],['supportMomentNm','固支力矩 M','N·m']] as const).filter(([key])=>key==='ropeLengthM'?params.mode==='hemisphere-suspension':key==='rodAxialForceN'?params.mode==='hinged-rod':['reactionXN','reactionYN','supportMomentNm'].includes(key)?params.mode==='fixed-rod':key==='minPullForceN'?params.mode!=='fixed-rod':true).map(([key,label,unit])=>{const v=telemetry.observables[key];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'equilibrium-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+unit:'—'}</span></div>;})}
            <div className="text-[10px]">演示时间仅用于准静态扫描；无解处曲线留空。</div>
          </section>
        ) : plugin.meta.id==='mech-kinematics-chase' ? (
          <section data-testid="chase-readouts" data-sample-time={telemetry.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}>
            {([['deltaX','有向位置差 xB−xA','m'],['gap','实际间距','m'],['minGap','历史最小间距','m'],['deltaV','A 相对 B 速度','m/s'],['firstCoVelocityTime','首次共速','s'],['firstMeetTime','首次相遇','s']] as const).map(([key,label,unit])=>{const v=telemetry.observables[key];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'chase-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+unit:'—'}</span></div>;})}
            <div className="text-[10px]">质点模型 · 相遇后继续数学轨迹，未模拟碰撞。合力仅由可调质量与规定加速度推算。</div>
          </section>
        ) : plugin.meta.id==='mech-block-conveyor' ? (
          <section data-testid="contact-readouts" data-sample-time={telemetry.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}>{([['xBlock','物块位置 x₁','m'],['xCarrier','带/板材料位移 x₂','m'],['relativeDisplacement','有向相对位移','m'],['relativeScratch','累计相对滑移路程','m'],['scratchSpanM','材料划痕覆盖跨度','m'],['frictionOnBlockN','有向摩擦力 f₁','N'],['groundFrictionN','地面对板摩擦力','N'],['kineticEnergy','系统动能 Eₖ','J'],['potentialEnergy','有向重力势能 Eₚ','J'],['frictionHeat','界面生热 Q₁','J'],['groundHeat','地面生热 Q₂','J'],['carrierWork','外力/电机功 W','J']] as const).filter(([key])=>!['groundHeat','groundFrictionN'].includes(key)||params.systemMode==='plank').map(([key,label,unit])=>{const v=telemetry.observables[key];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'contact-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+unit:'—'}</span></div>;})}<div className="text-[10px]">速度双曲线间阴影为可见采样区间的相对滑移路程近似；累计读数由物理事件积分给出。</div>{telemetry.observables.terminal===1&&<div className="font-semibold text-rose-500">已到承载面端点 · 接触模型结束</div>}</section>
        ) : plugin.meta.id==='mech-vertical-circular' ? (
          <section data-testid="vertical-readouts" data-sample-time={telemetry.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}><div className="font-semibold">{telemetry.observables.derailed===1?'自由抛体 · 约束已解除':params.trackMode==='light-rod'?'双边约束 · 向内为正':'单边接触'}</div>{([['normalForceN','实际约束力','N'],['speed','速率 v','m/s'],['kineticEnergy','动能 Eₖ','J'],['potentialEnergy','有向势能 Eₚ','J'],['energy','机械能 E','J'],['derailTime','脱轨时刻','s'],['derailAngleDeg','脱轨角','°']] as const).filter(([key])=>!key.startsWith('derail')||telemetry.observables.derailed===1).map(([key,label,unit])=>{const v=telemetry.observables[key];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'vertical-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+unit:'—'}</span></div>;})}<div className="text-[10px]">外凸向外为正；内轨/杆向内为正，杆可为负。脱轨后不模拟再接触或落地。</div></section>
        ) : plugin.meta.id==='mech-conical-turntable' ? (
          <section data-testid="turntable-readouts" data-sample-time={telemetry.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}><div className="font-semibold">{params.mode==='conical-pendulum'?(telemetry.observables.rotatingCone===1?'定态圆锥摆 · 正投影':'竖直静止支'):telemetry.observables.terminal===1?'接触模型已到边界':telemetry.observables.slippingOut===1?'二维滑移 · 库仑动摩擦':'共转 · 最小可行张力'}</div>{((params.mode==='conical-pendulum'?[['tensionN','真实绳张力 T','N'],['coneAngleDeg','真实半顶角 θ','°'],['rA','水平圆周半径','m'],['omega1','非零支临界 ω','rad/s'],['period','实际周期','s']]:[['tensionN','实际张力 T','N'],['frictionAN','A 向内摩擦分量','N'],['frictionBN','B 向内摩擦分量','N'],['staticTMin','共转需求 T下界','N'],['staticTMax','共转需求 T上界','N'],['omega1','首次饱和 ω₁','rad/s'],['omega2','摩擦反号 ω₂','rad/s'],['omega3','静态极限 ω₃','rad/s'],['actualSeparation','实际绳端间距','m'],['kineticEnergy','地面系动能','J'],['heat','摩擦热 Q','J'],['diskWork','盘面做功 W','J']]) as readonly (readonly [string,string,string])[]).filter(([key])=>key!=='period'||telemetry.observables.rotatingCone===1).map(([key,label,unit])=>{const v=telemetry.observables[key];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'turntable-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+unit:(key==='omega2'||key==='omega3')?'不存在':'—'}</span></div>;})}<div className="text-[10px]">{params.mode==='conical-pendulum'?'俯视与侧面同相位；正投影不改变真实 T。':'向内分量可为负；静态折线不是滑移力。动静 μ 暂同；盘边或松绳后停止。'}</div></section>
        ) : plugin.meta.id==='mech-spring-separation' ? (
          <section data-testid="spring-readouts" data-sample-time={telemetry.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}><div className="font-semibold">{telemetry.observables.terminal===1?'再接触 · 碰撞前停止':telemetry.observables.separated===1?'自由相 · 无接触力':'共同运动 · 单边接触'}</div>{([['normalForceN','实际接触力 Fₙ','N'],['a1','m₁ 加速度','m/s²'],['a2','m₂ 加速度','m/s²'],['v1','m₁ 速度','m/s'],['v2','m₂ 速度','m/s'],['gap','实际间隙','m'],['separationTime','分离时刻','s'],['separationS','分离位置','m'],['separationV','分离共同速度','m/s'],['kineticEnergy','动能 K','J'],['springEnergy','弹性势能','J'],['gravityEnergy','有向重力势能','J'],['energy','实际机械能 E','J'],['externalWork','外力功 W','J']] as const).filter(([key])=>!key.startsWith('separation')||telemetry.observables.separated===1).map(([key,label,unit])=>{const v=telemetry.observables[key];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'spring-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+unit:'—'}</span></div>;})}<div className="text-[10px]">沿斜面向上为正。零力切触不必然分离；再接触时停止，不预设碰撞系数。图中光滑面为理想截段。</div></section>
        ) : plugin.meta.id==='mech-collision-recoil' ? (
          <section data-testid="collision-readouts" data-sample-time={telemetry.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}><div className="font-semibold">{params.mode==='boat-recoil'?(telemetry.observables.phase===2?'到达右端 · 平滑静止':'人船 · 内部驱动'):params.mode==='bullet-block'?(['入靶前','穿行 · 恒定内力','共速 · 阻力停止','穿出 · 阻力停止'][telemetry.observables.phase??0]??'—'):(telemetry.observables.collided===1?'冲量后 · 自由运动':'碰撞前 / 未命中')}</div>{([...[ ['px','总动量 pₓ','kg·m/s'],['py','总动量 pᵧ','kg·m/s'],['xCm','质心 x','m'],['yCm','质心 y','m'],['ek','总动能 K','J'] ],...(params.mode==='boat-recoil'?[ ['relativePosition','人相对船位置','m'],['relativeSpeed','相对速度','m/s'],['vx1','人的地面速度','m/s'],['vx2','船的地面速度','m/s'],['walkDuration','行走总时长','s'] ]:params.mode==='bullet-block'?[ ['relativeSpeed','沿 x 相对速度','m/s'],['penetrationDist','实际穿行深度','m'],['heatLostJ','内能损耗 Q','J'],['entryTime','入靶时刻','s'],['phaseEndTime','结束时刻','s'] ]:[ ['vx1','v₁ₓ','m/s'],['vy1','v₁ᵧ','m/s'],['vx2','v₂ₓ','m/s'],['vy2','v₂ᵧ','m/s'],['heatLostJ','内能损耗 Q','J'],['impactTime','碰撞时刻','s'],['normalImpulse','法向冲量 Jₙ','N·s'],['gap','实际球间隙','m'] ])] as readonly (readonly string[])[]).filter(([key])=>key!==undefined&&typeof telemetry.observables[key]==='number').map(([key,label,unit])=>{const v=telemetry.observables[key!];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'collision-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+unit:'—'}</span></div>;})}<div className="text-[10px]">{params.mode==='boat-recoil'?'水平质心固定；机械动能由内部驱动改变，不作守恒报告。':params.mode==='bullet-block'?'理想质点，标记半径不参与接触；Q=f d。':'真实瞄准距与球半径；擦边无法向冲量；动量矢量采用地面系。'}</div></section>
        ) : plugin.meta.id==='mech-shm-resonance' ? (
          <section data-testid="shm-readouts" data-sample-time={telemetry.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}><div className="font-semibold">实测角运动与功—能账本</div>{([['thetaDeg','实际摆角 θ','°'],['thetaLinearDeg','线性摆 θlin','°'],['omega','角速度 ω','rad/s'],['tensionN','杆反力 R（向内正）','N'],['mechanicalEnergy','机械能 E','J'],['heatLostJ','累计耗散 Q','J'],['driveWorkJ','有符号外功 W','J'],['energyResidual','功—能残差','J'],['measuredPeriod','相邻向上穿零间隔','s'],['linearResponseAmplitude','线性特解振幅','rad']] as const).filter(([k])=>k==='heatLostJ'?params.mode!=='pendulum-compare':k==='driveWorkJ'?params.mode==='forced-resonance':k==='measuredPeriod'?(telemetry.observables.measuredPeriod??0)>0:k==='linearResponseAmplitude'?params.mode==='forced-resonance'&&telemetry.observables.linearResponseDefined===1:true).map(([k,label,unit])=>{const v=telemetry.observables[k];return <div key={k} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'shm-'+k} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?(k==='energyResidual'?v.toExponential(2):v.toFixed(3))+' '+unit:'—'}</span></div>;})}{params.mode==='forced-resonance'&&telemetry.observables.linearResponseDefined===0&&<div data-testid="shm-unbounded">线性理论无有限周期特解</div>}<div className="text-[10px]">理想刚性杆；参考圆与幅频曲线均属线性理论，不是非线性摆的实测曲线。</div></section>
        ) : plugin.getTelemetryChannels ? (
          <section data-testid="ode-readouts" className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}>{telemetry.observables.solverValid===0&&<div data-testid="ode-invalid" className="text-rose-400">方程未定义或积分失败 · 已停止</div>}{plugin.getTelemetryChannels(params).map(c=>{const v=telemetry.observables[c.key];return <div key={c.key} className="flex justify-between gap-2"><span>{c.label}</span><span className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+c.unit:'—'}</span></div>;})}</section>
        ) : hasEnergyMetrics ? (
          <div className="space-y-2 pt-0.5">
            <div>
              <div className="mb-1 flex justify-between text-[10px] text-slate-400"><span>动能 / 场能</span><span className="font-mono">{kineticPct}%</span></div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-sky-400/80 transition-all" style={{ width: `${kineticPct}%` }} /></div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[10px] text-slate-400"><span>耗散 / 储能转化</span><span className="font-mono">{heatPct}%</span></div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-amber-400/75 transition-all" style={{ width: `${heatPct}%` }} /></div>
            </div>
          </div>
        ) : null}

        {(extraFields.length > 0 || telemetry.invariants.length > 0 || plugin.layers.length > 0) && (
          <details className="rounded-xl border border-white/10 bg-slate-950/35 px-2.5">
            <summary className="cursor-pointer list-none py-2 text-[11px] font-medium text-slate-400 hover:text-slate-200">更多参数与图层 <span className="float-right">⌄</span></summary>
            <div className="space-y-2.5 pb-3">
              {extraFields.map(renderField)}
              {['mech-block-conveyor','mech-vertical-circular','mech-conical-turntable','mech-spring-separation','mech-collision-recoil','mech-shm-resonance'].includes(plugin.meta.id)?<div className="space-y-1 text-xs">{telemetry.invariants.map(i=><div key={i.name} className={i.passed?'text-emerald-400':'text-rose-400'}>{i.name}：{i.measuredError.toExponential(2)} {i.unit??''}</div>)}</div>:<EnergyBarChart observables={telemetry.observables} invariants={telemetry.invariants} />}
              <div className="space-y-1 pt-1">
                {plugin.layers.map((layer) => (
                  <label key={layer.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[11px] text-slate-300 hover:bg-white/5">
                    <input type="checkbox" data-testid={plugin.meta.id==='mech-dynamic-equilibrium'?'equilibrium-layer-'+layer.id:undefined} checked={activeLayers.includes(layer.id)} onChange={() => onToggleLayer(layer.id)} className="h-3.5 w-3.5 accent-sky-400" />
                    <span>{layer.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </details>
        )}
      </div>
    </aside>
  );
};
