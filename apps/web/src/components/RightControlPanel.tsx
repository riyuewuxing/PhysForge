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
  }, [plugin, params.mode, params.topology, params.sceneMode, params.scenario, params.template]);

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
          {plugin.getTelemetryChannels && telemetry.formulaItems[0] && <div data-testid="ode-equation-caption" className="mb-2 break-all text-xs" style={{color:telemetry.observables.solverValid===0?'#fb7185':'var(--pf-text-muted)'}}>{telemetry.formulaItems[0].label}</div>}
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
            {([['angleDeg','实际角','°'],['force1','F₁','N'],['force2','F₂','N'],['minPullForceN','理论拉力下界','N'],['ropeLengthM','实际绳长','m']] as const).filter(([key])=>key!=='ropeLengthM'||params.mode==='hemisphere-suspension').map(([key,label,unit])=>{const v=telemetry.observables[key];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'equilibrium-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+unit:'—'}</span></div>;})}
            <div className="text-[10px]">演示时间仅用于准静态扫描；无解处曲线留空。</div>
          </section>
        ) : plugin.meta.id==='mech-kinematics-chase' ? (
          <section data-testid="chase-readouts" data-sample-time={telemetry.t} className="space-y-1 text-xs" style={{color:'var(--pf-text-muted)'}}>
            {([['deltaX','有向位置差 xB−xA','m'],['gap','实际间距','m'],['minGap','历史最小间距','m'],['deltaV','A 相对 B 速度','m/s'],['firstCoVelocityTime','首次共速','s'],['firstMeetTime','首次相遇','s']] as const).map(([key,label,unit])=>{const v=telemetry.observables[key];return <div key={key} className="flex justify-between gap-2"><span>{label}</span><span data-testid={'chase-'+key} className="tabular-nums" style={{color:'var(--pf-text)'}}>{typeof v==='number'&&Number.isFinite(v)?v.toFixed(3)+' '+unit:'—'}</span></div>;})}
            <div className="text-[10px]">质点模型 · 相遇后继续数学轨迹，未模拟碰撞。合力仅由可调质量与规定加速度推算。</div>
          </section>
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
              <EnergyBarChart observables={telemetry.observables} invariants={telemetry.invariants} />
              <div className="space-y-1 pt-1">
                {plugin.layers.map((layer) => (
                  <label key={layer.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[11px] text-slate-300 hover:bg-white/5">
                    <input type="checkbox" checked={activeLayers.includes(layer.id)} onChange={() => onToggleLayer(layer.id)} className="h-3.5 w-3.5 accent-sky-400" />
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
