import type { EmDeviceKind } from './engine.js';
import { CYCL_DISPLAY_RADIUS, CYCL_GAP_HALF } from './cyclotronFlight.js';
import { RIGHT_X,SPECTROMETER_DEPTH,SPECTROMETER_SLIT_HALF } from './particleFlight.js';

/** Display geometry only: all lengths are schematic normalized coordinates, not SI device dimensions. */
export interface DevicePart {
  readonly id: string;
  readonly kind: 'box' | 'tube' | 'dee';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly material: 'glass' | 'copper' | 'rail';
  readonly side?: -1 | 1;
}

export interface DeviceCue {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  readonly kind: 'electric' | 'flow' | 'current';
  readonly label: string;
}

export interface DeviceSchematic {
  readonly parts: readonly DevicePart[];
  readonly fields: readonly {x: number; y: number}[];
  readonly cues: readonly DeviceCue[];
  readonly labels: readonly {x: number; y: number; text: string}[];
}

const box = (id: string, x: number, y: number, width: number, height: number, material: DevicePart['material'], depth = 0.12): DevicePart =>
  ({id, kind: 'box', x, y, width, height, depth, material});
const fieldGrid = (xs: readonly number[], ys: readonly number[]) => xs.flatMap(x => ys.map(y => ({x,y})));
const plates = (prefix: string, x: number, width: number, halfGap: number): DevicePart[] => [
  box(prefix+'-upper', x, halfGap, width, 0.075, 'copper'),
  box(prefix+'-lower', x, -halfGap, width, 0.075, 'copper')
];

export function deviceDiagramPoint(x: number, y: number) {
  return {x: -0.25 + x * 0.7, y: y * 0.7};
}

export function getDeviceSchematic(device: EmDeviceKind): DeviceSchematic {
  switch (device) {
    case 'velocity-selector': return {
      parts: [box('selector-chamber', -0.25, 0, 2.1, 1.2, 'glass', 0.32), ...plates('selector-plate', -0.25, 2.1, 0.6),
        box('selector-exit-upper',0.8,0.35,0.065,0.5,'rail'),box('selector-exit-lower',0.8,-0.35,0.065,0.5,'rail')],
      fields: fieldGrid([-1,-0.5,0,0.5], [-0.35,0,0.35]),
      cues: [{id:'selector-electric',x:-0.88,y:-0.43,dx:0,dy:0.86,kind:'electric',label:'E'}],
      labels: [{x:-0.25,y:0.79,text:'正交电磁场 · 正电荷'}]
    };
    case 'mass-spectrometer': return {
      parts: [
        box('spectrometer-entry', -0.775, 0, 1.05, 0.4, 'glass', 0.26),
        box('spectrometer-analyzer', -0.25+0.35*RIGHT_X,-0.35*SPECTROMETER_DEPTH,0.7*RIGHT_X,0.7*SPECTROMETER_DEPTH,'glass',0.32),
        box('spectrometer-slit-upper',-0.25,0.15,0.065,0.1,'rail'),
        box('spectrometer-collector',-0.25,-0.35*(SPECTROMETER_DEPTH+SPECTROMETER_SLIT_HALF),0.065,0.7*(SPECTROMETER_DEPTH-SPECTROMETER_SLIT_HALF),'copper')
      ],
      fields: fieldGrid([-0.03,0.3,0.62],[-0.23,-0.55,-0.88]),
      cues: [{id:'spectrometer-inlet',x:-1.37,y:0,dx:0.52,dy:0,kind:'flow',label:'v'}],
      labels: [{x:-0.85,y:0.38,text:'入射区'}, {x:0.35,y:0.38,text:'偏转场 B₂'}, {x:-0.77,y:-0.72,text:'探测板'}]
    };
    case 'cyclotron': return {
      parts: ([-1,1] as const).map(side => ({
        id: side===-1?'dee-left':'dee-right',kind:'dee',x:-0.25+side*CYCL_GAP_HALF,y:0,width:CYCL_DISPLAY_RADIUS,height:2*CYCL_DISPLAY_RADIUS,depth:0.13,material:'copper',side
      })),
      fields: fieldGrid([-0.73,-0.25,0.23],[-0.4,0,0.4]),
      cues: [],
      labels: [{x:-0.25,y:1.15,text:'D 形盒 · 理想零宽狭缝'}, {x:-0.65,y:0.96,text:'RF'}]
    };
    case 'hall-sensor': return {
      parts: [
        box('hall-semiconductor',-0.25,0,1.9,0.75,'rail',0.16),
        box('hall-current-left',-1.24,0,0.14,0.75,'copper'),
        box('hall-current-right',0.74,0,0.14,0.75,'copper'),
        box('hall-voltage-upper',-0.25,0.43,0.4,0.12,'copper'),
        box('hall-voltage-lower',-0.25,-0.43,0.4,0.12,'copper')
      ],
      fields: fieldGrid([-0.82,-0.25,0.32],[-0.22,0.22]),
      cues: [{id:'hall-current',x:-1.18,y:-0.64,dx:1.86,dy:0,kind:'current',label:'I'}],
      labels: [{x:-0.25,y:0.7,text:'横向电势差 U_H'}, {x:-0.25,y:-0.94,text:'载流子符号决定电压符号'}]
    };
    case 'mhd-generator': return {
      parts: [
        box('mhd-duct',-0.25,0,2.4,1.1,'glass',0.42),
        ...plates('mhd-electrode',-0.25,1.4,0.55),
        box('mhd-load',-0.25,1.02,0.52,0.18,'rail'),
        box('mhd-lead-left',-0.9,0.78,0.05,0.46,'copper'),
        box('mhd-lead-top',-0.57,1.02,0.66,0.05,'copper'),
        box('mhd-lead-bottom',0.72,-0.55,0.54,0.05,'copper'),
        box('mhd-lead-right',0.99,0.235,0.05,1.57,'copper'),
        box('mhd-lead-return',0.50,1.02,0.98,0.05,'copper')
      ],
      fields: fieldGrid([-0.85,-0.25,0.35],[-0.32,0.32]),
      cues: [{id:'mhd-flow',x:-1.4,y:0,dx:2.3,dy:0,kind:'flow',label:'v'}],
      labels: [{x:-0.25,y:1.23,text:'外负载 R'}, {x:-0.25,y:-0.82,text:'导电流体通道'}]
    };
    case 'em-flowmeter': return {
      parts: [
        {id:'flowmeter-pipe',kind:'tube',x:-0.25,y:0,width:2.4,height:0.95,depth:0.95,material:'glass'},
        box('flowmeter-upper-electrode',-0.25,0.48,0.32,0.09,'copper'),
        box('flowmeter-lower-electrode',-0.25,-0.48,0.32,0.09,'copper')
      ],
      fields: fieldGrid([-0.7,-0.25,0.2],[-0.26,0.26]),
      cues: [{id:'flowmeter-flow',x:-1.38,y:0,dx:2.25,dy:0,kind:'flow',label:'v'}],
      labels: [{x:-0.25,y:0.96,text:'测量电极 · 感生电压 U'}, {x:-0.25,y:-0.97,text:'圆管截面 · 体积流量 Q'}]
    };
  }
}

/** Outline of one D-shaped half disk, identical in Canvas, export and the 3D mesh. */
export function deeOutline(part: DevicePart): {x:number;y:number}[] {
  if (part.kind !== 'dee' || part.side === undefined) return [];
  const center=part.x-part.side*CYCL_GAP_HALF;
  const span=Math.acos(CYCL_GAP_HALF/part.width),axis=part.side===1?0:Math.PI;
  return Array.from({length:65},(_,i)=>{
    const angle=axis-span+2*span*i/64;
    return {x:center+part.width*Math.cos(angle),y:part.y+part.height/2*Math.sin(angle)};
  });
}
