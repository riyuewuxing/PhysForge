import type { DiagramIR, DiagramPrimitive } from '@physforge/sim-sdk';

export interface SvgRenderOptions {
  readonly monochrome?: boolean;
  readonly backgroundColor?: string;
  readonly strokeColor?: string;
}

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fmt(n: number): string {
  return Number.isFinite(n) ? Number(n.toFixed(3)).toString() : '0';
}

interface CoordMapper {
  sx: (wx: number) => number;
  sy: (wy: number) => number;
  scale: number;
}

function createMapper(ir: DiagramIR): CoordMapper {
  const { minX, minY, maxX, maxY } = ir.viewBox;
  const worldW = Math.max(1e-6, maxX - minX);
  const worldH = Math.max(1e-6, maxY - minY);
  const pad = 28;
  const innerW = Math.max(40, ir.width - pad * 2);
  const innerH = Math.max(40, ir.height - pad * 2);
  const scale = Math.min(innerW / worldW, innerH / worldH);
  const offsetX = pad + (innerW - worldW * scale) * 0.5;
  const offsetY = pad + (innerH - worldH * scale) * 0.5;

  return {
    scale,
    sx: (wx: number) => offsetX + (wx - minX) * scale,
    sy: (wy: number) => ir.height - (offsetY + (wy - minY) * scale)
  };
}

function renderFieldSymbolSvg(
  cx: number,
  cy: number,
  r: number,
  sym: 'cross' | 'dot' | 'plus' | 'minus',
  stroke: string
): string {
  const d = r * 0.58;
  if (sym === 'cross') {
    return [
      `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="none" stroke="${stroke}" stroke-width="1.2"/>`,
      `<line x1="${fmt(cx - d)}" y1="${fmt(cy - d)}" x2="${fmt(cx + d)}" y2="${fmt(cy + d)}" stroke="${stroke}" stroke-width="1.2"/>`,
      `<line x1="${fmt(cx - d)}" y1="${fmt(cy + d)}" x2="${fmt(cx + d)}" y2="${fmt(cy - d)}" stroke="${stroke}" stroke-width="1.2"/>`
    ].join('');
  }
  if (sym === 'dot') {
    return [
      `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="none" stroke="${stroke}" stroke-width="1.2"/>`,
      `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(Math.max(1.8, r * 0.25))}" fill="${stroke}"/>`
    ].join('');
  }
  if (sym === 'plus') {
    return [
      `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="none" stroke="${stroke}" stroke-width="1.2"/>`,
      `<line x1="${fmt(cx - d)}" y1="${fmt(cy)}" x2="${fmt(cx + d)}" y2="${fmt(cy)}" stroke="${stroke}" stroke-width="1.3"/>`,
      `<line x1="${fmt(cx)}" y1="${fmt(cy - d)}" x2="${fmt(cx)}" y2="${fmt(cy + d)}" stroke="${stroke}" stroke-width="1.3"/>`
    ].join('');
  }
  return [
    `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="none" stroke="${stroke}" stroke-width="1.2"/>`,
    `<line x1="${fmt(cx - d)}" y1="${fmt(cy)}" x2="${fmt(cx + d)}" y2="${fmt(cy)}" stroke="${stroke}" stroke-width="1.3"/>`
  ].join('');
}

function renderCircuitElementSvg(
  el: Extract<DiagramPrimitive, { kind: 'circuitElement' }>,
  m: CoordMapper,
  stroke: string
): string {
  const x1 = m.sx(el.x1);
  const y1 = m.sy(el.y1);
  const x2 = m.sx(el.x2);
  const y2 = m.sy(el.y2);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const mx = (x1 + x2) * 0.5;
  const my = (y1 + y2) * 0.5;
  const parts: string[] = [];

  if (el.element === 'resistor') {
    const bw = 22;
    const bh = 9;
    const lead1x = mx - ux * (bw * 0.5);
    const lead1y = my - uy * (bw * 0.5);
    const lead2x = mx + ux * (bw * 0.5);
    const lead2y = my + uy * (bw * 0.5);
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    parts.push(`<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(lead1x)}" y2="${fmt(lead1y)}" stroke="${stroke}" stroke-width="1.5"/>`);
    parts.push(`<line x1="${fmt(lead2x)}" y1="${fmt(lead2y)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="${stroke}" stroke-width="1.5"/>`);
    parts.push(
      `<rect x="${fmt(mx - bw / 2)}" y="${fmt(my - bh / 2)}" width="${fmt(bw)}" height="${fmt(bh)}" fill="#ffffff" stroke="${stroke}" stroke-width="1.5" transform="rotate(${fmt(angleDeg)} ${fmt(mx)} ${fmt(my)})"/>`
    );
  } else if (el.element === 'capacitor') {
    const gap = 5;
    const plateH = 14;
    const p1x = mx - ux * gap;
    const p1y = my - uy * gap;
    const p2x = mx + ux * gap;
    const p2y = my + uy * gap;
    parts.push(`<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(p1x)}" y2="${fmt(p1y)}" stroke="${stroke}" stroke-width="1.5"/>`);
    parts.push(`<line x1="${fmt(p2x)}" y1="${fmt(p2y)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="${stroke}" stroke-width="1.5"/>`);
    parts.push(`<line x1="${fmt(p1x - nx * plateH)}" y1="${fmt(p1y - ny * plateH)}" x2="${fmt(p1x + nx * plateH)}" y2="${fmt(p1y + ny * plateH)}" stroke="${stroke}" stroke-width="2"/>`);
    parts.push(`<line x1="${fmt(p2x - nx * plateH)}" y1="${fmt(p2y - ny * plateH)}" x2="${fmt(p2x + nx * plateH)}" y2="${fmt(p2y + ny * plateH)}" stroke="${stroke}" stroke-width="2"/>`);
  } else if (el.element === 'battery') {
    const gap = 4.5;
    const p1x = mx - ux * gap;
    const p1y = my - uy * gap;
    const p2x = mx + ux * gap;
    const p2y = my + uy * gap;
    parts.push(`<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(p1x)}" y2="${fmt(p1y)}" stroke="${stroke}" stroke-width="1.5"/>`);
    parts.push(`<line x1="${fmt(p2x)}" y1="${fmt(p2y)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="${stroke}" stroke-width="1.5"/>`);
    parts.push(`<line x1="${fmt(p1x - nx * 13)}" y1="${fmt(p1y - ny * 13)}" x2="${fmt(p1x + nx * 13)}" y2="${fmt(p1y + ny * 13)}" stroke="${stroke}" stroke-width="1.6"/>`);
    parts.push(`<line x1="${fmt(p2x - nx * 7)}" y1="${fmt(p2y - ny * 7)}" x2="${fmt(p2x + nx * 7)}" y2="${fmt(p2y + ny * 7)}" stroke="${stroke}" stroke-width="2.6"/>`);
  } else if (el.element === 'ammeter' || el.element === 'voltmeter' || el.element === 'lamp') {
    const r = 11;
    const p1x = mx - ux * r;
    const p1y = my - uy * r;
    const p2x = mx + ux * r;
    const p2y = my + uy * r;
    parts.push(`<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(p1x)}" y2="${fmt(p1y)}" stroke="${stroke}" stroke-width="1.5"/>`);
    parts.push(`<line x1="${fmt(p2x)}" y1="${fmt(p2y)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="${stroke}" stroke-width="1.5"/>`);
    parts.push(`<circle cx="${fmt(mx)}" cy="${fmt(my)}" r="${r}" fill="#ffffff" stroke="${stroke}" stroke-width="1.5"/>`);
    if (el.element === 'lamp') {
      const d = r * 0.65;
      parts.push(`<line x1="${fmt(mx - d)}" y1="${fmt(my - d)}" x2="${fmt(mx + d)}" y2="${fmt(my + d)}" stroke="${stroke}" stroke-width="1.4"/>`);
      parts.push(`<line x1="${fmt(mx - d)}" y1="${fmt(my + d)}" x2="${fmt(mx + d)}" y2="${fmt(my - d)}" stroke="${stroke}" stroke-width="1.4"/>`);
    } else {
      const sym = el.element === 'ammeter' ? 'A' : 'V';
      parts.push(`<text x="${fmt(mx)}" y="${fmt(my + 4)}" text-anchor="middle" font-size="12" font-family="serif" font-weight="bold" fill="${stroke}">${sym}</text>`);
    }
  } else {
    parts.push(`<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="${stroke}" stroke-width="1.5"/>`);
  }

  if (el.label) {
    parts.push(
      `<text x="${fmt(mx + nx * 18)}" y="${fmt(my + ny * 18 + 4)}" text-anchor="middle" font-size="12" font-family="Times New Roman, serif" fill="${stroke}">${escapeXml(el.label)}</text>`
    );
  }
  return parts.join('');
}

/**
 * 将规范化 DiagramIR 渲染为黑白印刷试卷级纯离线矢量 SVG（零外部字体依赖）
 */
export function renderDiagramToSvg(ir: DiagramIR, options: SvgRenderOptions = {}): string {
  const bg = options.backgroundColor ?? '#ffffff';
  const stroke = options.strokeColor ?? '#111827';
  const m = createMapper(ir);

  const elements: string[] = [
    `<rect x="0" y="0" width="${fmt(ir.width)}" height="${fmt(ir.height)}" fill="${bg}"/>`
  ];

  for (const prim of ir.primitives) {
    if (prim.kind === 'line') {
      const dash = prim.dashed ? ' stroke-dasharray="5,4"' : '';
      elements.push(
        `<line x1="${fmt(m.sx(prim.x1))}" y1="${fmt(m.sy(prim.y1))}" x2="${fmt(m.sx(prim.x2))}" y2="${fmt(m.sy(prim.y2))}" stroke="${stroke}" stroke-width="${fmt(prim.strokeWidth ?? 1.5)}"${dash}/>`
      );
    } else if (prim.kind === 'arrow') {
      const x1 = m.sx(prim.x1);
      const y1 = m.sy(prim.y1);
      const x2 = m.sx(prim.x2);
      const y2 = m.sy(prim.y2);
      const dash = prim.dashed ? ' stroke-dasharray="5,4"' : '';
      elements.push(
        `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="${stroke}" stroke-width="1.8" marker-end="url(#pf-arrow)"${dash}/>`
      );
      if (prim.label) {
        const lx = x2 + (x2 >= x1 ? 8 : -8);
        const ly = y2 + (y2 >= y1 ? 14 : -6);
        elements.push(
          `<text x="${fmt(lx)}" y="${fmt(ly)}" text-anchor="${x2 >= x1 ? 'start' : 'end'}" font-size="13" font-family="Times New Roman, serif" font-style="italic" fill="${stroke}">${escapeXml(prim.label)}</text>`
        );
      }
    } else if (prim.kind === 'circle') {
      const dash = prim.dashed ? ' stroke-dasharray="5,4"' : '';
      const fill = prim.fill ? stroke : 'none';
      elements.push(
        `<circle cx="${fmt(m.sx(prim.cx))}" cy="${fmt(m.sy(prim.cy))}" r="${fmt(prim.r * m.scale)}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dash}/>`
      );
    } else if (prim.kind === 'arc' || prim.kind === 'arcAngle') {
      const cx = m.sx(prim.cx);
      const cy = m.sy(prim.cy);
      const r = prim.r * m.scale;
      const sx = cx + r * Math.cos(prim.startAngle);
      const sy = cy - r * Math.sin(prim.startAngle);
      const ex = cx + r * Math.cos(prim.endAngle);
      const ey = cy - r * Math.sin(prim.endAngle);
      const sweep = prim.endAngle >= prim.startAngle ? 0 : 1;
      const largeArc = Math.abs(prim.endAngle - prim.startAngle) > Math.PI ? 1 : 0;
      const dash = prim.dashed ? ' stroke-dasharray="4,3"' : '';
      elements.push(
        `<path d="M ${fmt(sx)} ${fmt(sy)} A ${fmt(r)} ${fmt(r)} 0 ${largeArc} ${sweep} ${fmt(ex)} ${fmt(ey)}" fill="none" stroke="${stroke}" stroke-width="1.3"${dash}/>`
      );
      if (prim.kind === 'arcAngle' && prim.label) {
        const midA = 0.5 * (prim.startAngle + prim.endAngle);
        elements.push(
          `<text x="${fmt(cx + (r + 13) * Math.cos(midA))}" y="${fmt(cy - (r + 13) * Math.sin(midA) + 4)}" text-anchor="middle" font-size="12" font-family="Times New Roman, serif" fill="${stroke}">${escapeXml(prim.label)}</text>`
        );
      }
    } else if (prim.kind === 'rect') {
      const rx = m.sx(prim.x);
      const ry = m.sy(prim.y + prim.height);
      const rw = prim.width * m.scale;
      const rh = prim.height * m.scale;
      const dash = prim.dashed ? ' stroke-dasharray="5,4"' : '';
      const fill = prim.hatch ? 'url(#pf-hatch)' : 'none';
      elements.push(
        `<rect x="${fmt(rx)}" y="${fmt(ry)}" width="${fmt(rw)}" height="${fmt(rh)}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dash}/>`
      );
    } else if (prim.kind === 'hatchedGround') {
      const x1 = m.sx(prim.x1);
      const y1 = m.sy(prim.y1);
      const x2 = m.sx(prim.x2);
      const y2 = m.sy(prim.y2);
      elements.push(`<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="${stroke}" stroke-width="1.8"/>`);
      const len = Math.hypot(x2 - x1, y2 - y1);
      const steps = Math.max(4, Math.floor(len / 12));
      const depth = prim.depth ?? 9;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const hx = x1 + (x2 - x1) * t;
        const hy = y1 + (y2 - y1) * t;
        elements.push(`<line x1="${fmt(hx)}" y1="${fmt(hy)}" x2="${fmt(hx - depth * 0.7)}" y2="${fmt(hy + depth)}" stroke="${stroke}" stroke-width="1.0"/>`);
      }
    } else if (prim.kind === 'spring') {
      const x1 = m.sx(prim.x1);
      const y1 = m.sy(prim.y1);
      const x2 = m.sx(prim.x2);
      const y2 = m.sy(prim.y2);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;
      const coils = prim.coils ?? 8;
      const amp = (prim.amplitude ?? 0.08) * m.scale;
      const pts: string[] = [`M ${fmt(x1)} ${fmt(y1)}`];
      const lead = len * 0.1;
      pts.push(`L ${fmt(x1 + ux * lead)} ${fmt(y1 + uy * lead)}`);
      const bodyLen = len * 0.8;
      for (let i = 0; i < coils; i++) {
        const frac1 = (i + 0.25) / coils;
        const frac2 = (i + 0.75) / coils;
        const s1x = x1 + ux * (lead + bodyLen * frac1) + nx * amp;
        const s1y = y1 + uy * (lead + bodyLen * frac1) + ny * amp;
        const s2x = x1 + ux * (lead + bodyLen * frac2) - nx * amp;
        const s2y = y1 + uy * (lead + bodyLen * frac2) - ny * amp;
        pts.push(`L ${fmt(s1x)} ${fmt(s1y)} L ${fmt(s2x)} ${fmt(s2y)}`);
      }
      pts.push(`L ${fmt(x2 - ux * lead)} ${fmt(y2 - uy * lead)} L ${fmt(x2)} ${fmt(y2)}`);
      elements.push(`<path d="${pts.join(' ')}" fill="none" stroke="${stroke}" stroke-width="1.4"/>`);
    } else if (prim.kind === 'block') {
      const cx = m.sx(prim.cx);
      const cy = m.sy(prim.cy);
      const bw = prim.width * m.scale;
      const bh = prim.height * m.scale;
      const rot = prim.angleDeg ? ` transform="rotate(${fmt(-prim.angleDeg)} ${fmt(cx)} ${fmt(cy)})"` : '';
      elements.push(
        `<rect x="${fmt(cx - bw / 2)}" y="${fmt(cy - bh / 2)}" width="${fmt(bw)}" height="${fmt(bh)}" fill="#f8fafc" stroke="${stroke}" stroke-width="1.6"${rot}/>`
      );
      if (prim.label) {
        elements.push(
          `<text x="${fmt(cx)}" y="${fmt(cy + 4)}" text-anchor="middle" font-size="12" font-family="Times New Roman, serif" fill="${stroke}">${escapeXml(prim.label)}</text>`
        );
      }
    } else if (prim.kind === 'polyline' || prim.kind === 'trajectory') {
      if (prim.points.length >= 2) {
        const ptsAttr = prim.points.map((p) => `${fmt(m.sx(p.x))},${fmt(m.sy(p.y))}`).join(' ');
        const dash = prim.dashed ? ' stroke-dasharray="5,4"' : '';
        const sw = prim.kind === 'trajectory' ? (prim.strokeWidth ?? 1.6) : 1.5;
        const tag = prim.kind === 'polyline' && prim.closed ? 'polygon' : 'polyline';
        elements.push(
          `<${tag} points="${ptsAttr}" fill="none" stroke="${stroke}" stroke-width="${fmt(sw)}"${dash}/>`
        );
      }
    } else if (prim.kind === 'text' || prim.kind === 'mathLabel') {
      const size = prim.kind === 'mathLabel' ? (prim.fontSize ?? 13) : 12;
      const anchor = prim.align ?? 'start';
      elements.push(
        `<text x="${fmt(m.sx(prim.x))}" y="${fmt(m.sy(prim.y))}" text-anchor="${anchor}" font-size="${size}" font-family="Times New Roman, serif" fill="${stroke}">${escapeXml(prim.text)}</text>`
      );
    } else if (prim.kind === 'fieldSymbol') {
      elements.push(renderFieldSymbolSvg(m.sx(prim.x), m.sy(prim.y), 6.5, prim.symbol, stroke));
    } else if (prim.kind === 'fieldMarker') {
      elements.push(
        renderFieldSymbolSvg(m.sx(prim.x), m.sy(prim.y), prim.radius ?? 6.5, prim.symbol, stroke)
      );
    } else if (prim.kind === 'circuitElement') {
      elements.push(renderCircuitElementSvg(prim, m, stroke));
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(ir.width)}" height="${fmt(ir.height)}" viewBox="0 0 ${fmt(ir.width)} ${fmt(ir.height)}">`,
    `  <title>${escapeXml(ir.title)}</title>`,
    `  <defs>`,
    `    <marker id="pf-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">`,
    `      <path d="M 0 1 L 10 5 L 0 9 z" fill="${stroke}"/>`,
    `    </marker>`,
    `    <pattern id="pf-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`,
    `      <line x1="0" y1="0" x2="0" y2="8" stroke="${stroke}" stroke-width="0.9" stroke-opacity="0.35"/>`,
    `    </pattern>`,
    `  </defs>`,
    ...elements.map((el) => `  ${el}`),
    `</svg>`
  ].join('\n');
}
