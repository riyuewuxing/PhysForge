import { describe, expect, it } from 'vitest';
import type { DiagramIR } from '@physforge/sim-sdk';
import { renderDiagramToSvg, renderDiagramToTikz } from './index.js';

describe('export-studio vector backends', () => {
  const sampleIr: DiagramIR = {
    width: 720,
    height: 440,
    viewBox: { minX: -4, minY: -3, maxX: 4, maxY: 3 },
    title: '斜面上含弹簧物块与有界磁场测试图',
    primitives: [
      { kind: 'hatchedGround', x1: -3.5, y1: -2, x2: 3.5, y2: -2 },
      { kind: 'spring', x1: -2.5, y1: -1.4, x2: -0.8, y2: -1.4, coils: 6 },
      { kind: 'block', cx: 0, cy: -1.4, width: 1.0, height: 0.8, label: 'm' },
      { kind: 'arrow', x1: 0, y1: -1.4, x2: 0, y2: -2.4, label: 'mg' },
      { kind: 'fieldMarker', x: 2, y: 1, symbol: 'cross' },
      { kind: 'circuitElement', element: 'resistor', x1: -3, y1: 1.8, x2: -1, y2: 1.8, label: 'R_1' },
      { kind: 'arcAngle', cx: -2, cy: -2, r: 0.7, startAngle: 0, endAngle: Math.PI / 6, label: 'θ' },
      { kind: 'mathLabel', x: 1.5, y: 2.1, text: 'B_0 = 2.0 T' }
    ]
  };

  it('renders crisp black-on-white SVG containing marker arrowheads, hatch pattern, and math labels', () => {
    const svg = renderDiagramToSvg(sampleIr);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('marker-end="url(#pf-arrow)"');
    expect(svg).toContain('R_1');
    expect(svg).toContain('B_0 = 2.0 T');
    expect(svg).not.toContain('cdn.jsdelivr');
    expect(svg).not.toContain('unpkg.com');
  });

  it('renders valid LaTeX TikZ code with arrows, ground, spring coils, and labels', () => {
    const tikz = renderDiagramToTikz(sampleIr);
    expect(tikz).toContain('\\begin{tikzpicture}');
    expect(tikz).toContain('\\end{tikzpicture}');
    expect(tikz).toContain('\\draw[->, thick]');
    expect(tikz).toContain('decoration={coil');
    expect(tikz).toContain('$B_0 = 2.0 T$');
  });
});
