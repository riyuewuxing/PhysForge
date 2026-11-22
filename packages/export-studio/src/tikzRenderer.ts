import type { DiagramIR } from '@physforge/sim-sdk';

function f(n: number): string {
  return Number.isFinite(n) ? Number(n.toFixed(3)).toString() : '0';
}

function escapeLatexMath(raw: string): string {
  return raw.replace(/([%&#])/g, '\\$1');
}

/**
 * 将 DiagramIR 编译为标准 LaTeX TikZ 矢量插图源码（可直接粘贴至 \usepackage{tikz} 试卷排版文档）
 */
export function renderDiagramToTikz(ir: DiagramIR): string {
  const lines: string[] = [
    `% PhysForge TikZ Export: ${ir.title}`,
    `\\begin{tikzpicture}[scale=1.2, >=stealth]`
  ];

  for (const prim of ir.primitives) {
    if (prim.kind === 'line') {
      const opt = prim.dashed ? '[dashed, thick]' : '[thick]';
      lines.push(`  \\draw${opt} (${f(prim.x1)}, ${f(prim.y1)}) -- (${f(prim.x2)}, ${f(prim.y2)});`);
    } else if (prim.kind === 'arrow') {
      const opt = prim.dashed ? '[->, dashed, thick]' : '[->, thick]';
      const labelPart = prim.label
        ? ` node[above right] {$${escapeLatexMath(prim.label)}$}`
        : '';
      lines.push(
        `  \\draw${opt} (${f(prim.x1)}, ${f(prim.y1)}) -- (${f(prim.x2)}, ${f(prim.y2)})${labelPart};`
      );
    } else if (prim.kind === 'circle') {
      const opt = prim.fill ? '[fill=black]' : prim.dashed ? '[dashed, thick]' : '[thick]';
      lines.push(`  \\draw${opt} (${f(prim.cx)}, ${f(prim.cy)}) circle (${f(prim.r)});`);
    } else if (prim.kind === 'arc' || prim.kind === 'arcAngle') {
      const deg1 = (prim.startAngle * 180) / Math.PI;
      const deg2 = (prim.endAngle * 180) / Math.PI;
      const sx = prim.cx + prim.r * Math.cos(prim.startAngle);
      const sy = prim.cy + prim.r * Math.sin(prim.startAngle);
      lines.push(
        `  \\draw[thick] (${f(sx)}, ${f(sy)}) arc (${f(deg1)}:${f(deg2)}:${f(prim.r)});`
      );
      if (prim.kind === 'arcAngle' && prim.label) {
        const mid = 0.5 * (prim.startAngle + prim.endAngle);
        lines.push(
          `  \\node at (${f(prim.cx + (prim.r + 0.2) * Math.cos(mid))}, ${f(prim.cy + (prim.r + 0.2) * Math.sin(mid))}) {$${escapeLatexMath(prim.label)}$};`
        );
      }
    } else if (prim.kind === 'rect') {
      const opt = prim.dashed ? '[dashed, thick]' : '[thick]';
      lines.push(
        `  \\draw${opt} (${f(prim.x)}, ${f(prim.y)}) rectangle (${f(prim.x + prim.width)}, ${f(prim.y + prim.height)});`
      );
    } else if (prim.kind === 'hatchedGround') {
      lines.push(`  \\draw[very thick] (${f(prim.x1)}, ${f(prim.y1)}) -- (${f(prim.x2)}, ${f(prim.y2)});`);
    } else if (prim.kind === 'spring') {
      lines.push(
        `  \\draw[decorate, decoration={coil, aspect=0.4, segment length=4pt}] (${f(prim.x1)}, ${f(prim.y1)}) -- (${f(prim.x2)}, ${f(prim.y2)});`
      );
    } else if (prim.kind === 'block') {
      const x1 = prim.cx - prim.width * 0.5;
      const y1 = prim.cy - prim.height * 0.5;
      const x2 = prim.cx + prim.width * 0.5;
      const y2 = prim.cy + prim.height * 0.5;
      lines.push(`  \\draw[thick, fill=black!5] (${f(x1)}, ${f(y1)}) rectangle (${f(x2)}, ${f(y2)});`);
      if (prim.label) {
        lines.push(`  \\node at (${f(prim.cx)}, ${f(prim.cy)}) {$${escapeLatexMath(prim.label)}$};`);
      }
    } else if (prim.kind === 'polyline' || prim.kind === 'trajectory') {
      if (prim.points.length >= 2) {
        const opt = prim.dashed ? '[dashed, thick]' : '[thick]';
        const coords = prim.points.map((p) => `(${f(p.x)}, ${f(p.y)})`).join(' -- ');
        const suffix = prim.kind === 'polyline' && prim.closed ? ' -- cycle' : '';
        lines.push(`  \\draw${opt} ${coords}${suffix};`);
      }
    } else if (prim.kind === 'text' || prim.kind === 'mathLabel') {
      lines.push(`  \\node at (${f(prim.x)}, ${f(prim.y)}) {$${escapeLatexMath(prim.text)}$};`);
    } else if (prim.kind === 'fieldSymbol' || prim.kind === 'fieldMarker') {
      const glyph = prim.symbol === 'cross' ? '\\times' : prim.symbol === 'dot' ? '\\bullet' : prim.symbol === 'plus' ? '+' : '-';
      lines.push(`  \\node[circle, draw, inner sep=1pt] at (${f(prim.x)}, ${f(prim.y)}) {$${glyph}$};`);
    } else if (prim.kind === 'circuitElement') {
      const mx = 0.5 * (prim.x1 + prim.x2);
      const my = 0.5 * (prim.y1 + prim.y2);
      lines.push(
        `  \\draw[thick] (${f(prim.x1)}, ${f(prim.y1)}) -- (${f(prim.x2)}, ${f(prim.y2)}) node[midway, above] {$${escapeLatexMath(prim.label ?? prim.element)}$};`
      );
      lines.push(`  \\node[draw, fill=white, inner sep=2pt] at (${f(mx)}, ${f(my)}) {\\scriptsize ${escapeLatexMath(prim.element)}};`);
    }
  }

  lines.push(`\\end{tikzpicture}`);
  return lines.join('\n');
}
