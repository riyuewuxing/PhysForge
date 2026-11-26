import {describe,it,expect} from 'vitest';
import {formatRulerMeasurement,formatCompassMeasurement,formatAngleMeasurement} from './RulerToolboxOverlay.js';
import {DISPLAY_LENGTH_PER_M} from '../../../../simulations/em-capacitor-millikan/engine.js';
import {CRT_CM_PER_DRAW_UNIT,CRT_SCREEN_DRAW_RADIUS} from '../../../../simulations/em-ac-field-oscilloscope/engine.js';
describe('physical measurement space instead of schematic metres',()=>{
  it('reports only vertical physical delta in the enlarged capacitor drawing',()=>{
    const space={kind:'vertical',factor:1000/DISPLAY_LENGTH_PER_M,unit:'mm'} as const;
    expect(formatRulerMeasurement(3,1.4,space)).toBe('Δy=20.000 mm · 横向示意');
    expect(formatRulerMeasurement(3,-1.4,space)).toBe('Δy=-20.000 mm · 横向示意');
    expect(formatCompassMeasurement(1,space)).toContain('非物理半径');
    expect(formatAngleMeasurement(90,space)).toBe('图示角 90.0°');
  });
  it('reports only real x in separated AC phase lanes',()=>{
    const space={kind:'horizontal',factor:1,unit:'m'} as const;
    expect(formatRulerMeasurement(2,100,space)).toBe('Δx=2.000 m · 竖向示意');
    expect(formatCompassMeasurement(1,space)).toContain('非物理半径');
  });
  it('uses the physical 6cm screen radius and preserves ordinary metric diagrams',()=>{
    const space={kind:'metric',factor:CRT_CM_PER_DRAW_UNIT,unit:'cm'} as const;
    expect(formatRulerMeasurement(CRT_SCREEN_DRAW_RADIUS,0,space)).toContain('L=6.000 cm');
    expect(formatCompassMeasurement(CRT_SCREEN_DRAW_RADIUS,space)).toBe('R = 6.000 cm');
    expect(formatAngleMeasurement(45,space)).toBe('45.0°');
    expect(formatRulerMeasurement(3,4)).toContain('L=5.000 m');
    expect(formatCompassMeasurement(2)).toBe('R = 2.000 m');
  });
});
