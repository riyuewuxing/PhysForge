export interface LabelBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
  font?: string;
  bgColor?: string;
}

export type CanvasLabel = Omit<LabelBox, 'width' | 'height'> & {
  width?: number;
  height?: number;
};

export interface CanvasFrameOrigin {
  x: number;
  y: number;
}

export interface WorldMapper {
  readonly ppm: number;
  readonly toScreen: (worldX: number, worldY: number) => { x: number; y: number };
  readonly toX: (worldX: number) => number;
  readonly toY: (worldY: number) => number;
  readonly len: (worldLength: number) => number;
}

function getViewportOrigin(viewport: import('./index.js').Viewport): { x: number; y: number } {
  const width = Math.max(1, finite(viewport.width, 800));
  const height = Math.max(1, finite(viewport.height, 460));
  return {
    x: width * 0.45 + finite(viewport.offsetX),
    y: height * 0.5 + finite(viewport.offsetY)
  };
}

/** Pixels per world unit shared by Canvas renderers, controls, FBD and rulers. */
export function getPixelsPerMeter(viewport: import('./index.js').Viewport): number {
  const width = Math.max(1, finite(viewport.width, 800));
  const height = Math.max(1, finite(viewport.height, 460));
  const scale = Math.max(1e-6, finite(viewport.scale, 1));
  return Math.max(1e-6, Math.min(width, height) * 0.24 * scale);
}

/** Maps physical canvas coordinates through the shared pan/zoom viewport transform. */
export function worldToScreen(
  worldX: number,
  worldY: number,
  viewport: import('./index.js').Viewport,
  frameOrigin: CanvasFrameOrigin = { x: 0, y: 0 }
): { x: number; y: number } {
  const pixelsPerMeter = getPixelsPerMeter(viewport);
  const origin = getViewportOrigin(viewport);
  return {
    x: origin.x + (worldX - frameOrigin.x) * pixelsPerMeter,
    y: origin.y - (worldY - frameOrigin.y) * pixelsPerMeter
  };
}

/** Convert a screen pixel position back into the shared world coordinate system. */
export function screenToWorld(
  screenX: number,
  screenY: number,
  viewport: import('./index.js').Viewport,
  frameOrigin: CanvasFrameOrigin = { x: 0, y: 0 }
): { x: number; y: number } {
  const ppm = getPixelsPerMeter(viewport);
  const origin = getViewportOrigin(viewport);
  return {
    x: frameOrigin.x + (screenX - origin.x) / ppm,
    y: frameOrigin.y - (screenY - origin.y) / ppm
  };
}

/** Build a reusable coordinate mapper once per render pass. */
export function createWorldMapper(
  viewport: import('./index.js').Viewport,
  frameOrigin: CanvasFrameOrigin = { x: 0, y: 0 }
): WorldMapper {
  const ppm = getPixelsPerMeter(viewport);
  const origin = getViewportOrigin(viewport);
  return {
    ppm,
    toScreen: (worldX, worldY) => ({
      x: origin.x + (worldX - frameOrigin.x) * ppm,
      y: origin.y - (worldY - frameOrigin.y) * ppm
    }),
    toX: (worldX) => origin.x + (worldX - frameOrigin.x) * ppm,
    toY: (worldY) => origin.y - (worldY - frameOrigin.y) * ppm,
    len: (worldLength) => worldLength * ppm
  };
}

/** Resolve a plugin's initial view and keep custom model scales inside safe zoom limits. */
export function resolveInitialCameraTransform<TParams extends import('./index.js').ParamRecord>(
  plugin: { defaultView?: import('./index.js').PluginDefaultViewSpec<TParams> } | undefined,
  params: TParams,
  width: number,
  height: number
): { scale: number; offsetX: number; offsetY: number } {
  const spec = plugin?.defaultView;
  if (!spec) return { scale: 1, offsetX: 0, offsetY: 0 };

  const viewportSize = {
    width: Math.max(1, finite(width, 800)),
    height: Math.max(1, finite(height, 460))
  };
  const rawScale = typeof spec.scale === 'function' ? spec.scale(params, viewportSize) : (spec.scale ?? 1);
  const rawOffsetX = typeof spec.offsetRatioX === 'function'
    ? spec.offsetRatioX(params, viewportSize)
    : (spec.offsetRatioX ?? 0);
  const rawOffsetY = typeof spec.offsetRatioY === 'function'
    ? spec.offsetRatioY(params, viewportSize)
    : (spec.offsetRatioY ?? 0);
  const lower=typeof spec.minScale==='number'&&Number.isFinite(spec.minScale)?Math.max(.0001,Math.min(.1,spec.minScale)):.1;
  const scale = Number.isFinite(rawScale) ? Math.max(lower, Math.min(20, rawScale)) : 1;
  const offsetX = Number.isFinite(rawOffsetX * viewportSize.width) ? rawOffsetX * viewportSize.width : 0;
  const offsetY = Number.isFinite(rawOffsetY * viewportSize.height) ? rawOffsetY * viewportSize.height : 0;
  return { scale, offsetX, offsetY };
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.max(0, Math.min(radius, width * 0.5, height * 0.5));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Solid metallic cross-section; never erase the canvas or circuit junctions. */
export function drawMetallicRail(
  ctx: CanvasRenderingContext2D, x1: number, y: number, x2: number, thickness = 8
): void {
  if (![x1, y, x2, thickness].every(Number.isFinite) || x2 <= x1 || thickness <= 0) return;
  ctx.save();
  const half = thickness * 0.5;
  const vertical = ctx.createLinearGradient(0, y - half, 0, y + half);
  vertical.addColorStop(0, '#39434f');
  vertical.addColorStop(0.18, '#8997a7');
  vertical.addColorStop(0.36, '#edf4fb');
  vertical.addColorStop(0.51, '#aebccc');
  vertical.addColorStop(0.76, '#68788a');
  vertical.addColorStop(1, '#303945');
  ctx.shadowColor = 'rgba(196, 221, 247, 0.24)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = vertical;
  roundedRectPath(ctx, x1, y - half, x2 - x1, thickness, Math.min(half, 2));
  ctx.fill();
  ctx.shadowBlur = 0;
  // Taper only the specular highlight, NOT the underlying physical rail.
  const highlight = ctx.createLinearGradient(x1, 0, x2, 0);
  highlight.addColorStop(0, 'rgba(255,255,255,.07)');
  highlight.addColorStop(0.08, 'rgba(255,255,255,.65)');
  highlight.addColorStop(0.92, 'rgba(255,255,255,.65)');
  highlight.addColorStop(1, 'rgba(255,255,255,.07)');
  ctx.fillStyle = highlight;
  ctx.fillRect(x1, y - thickness * .17, x2 - x1, Math.max(.8, thickness * .13));
  ctx.restore();
}

/** Draws a quiet dot or cross magnetic-field pattern. */
export function drawDotCrossField(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  direction: 'in' | 'out',
  spacingX = 76,
  spacingY = 58
): void {
  if (![left, top, width, height, spacingX, spacingY].every(Number.isFinite) || width <= 0 || height <= 0 || spacingX <= 0 || spacingY <= 0) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
  ctx.fillStyle = 'rgba(148, 163, 184, 0.36)';
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  const radius = 4;
  for (let x = left + spacingX * 0.5; x < left + width - 12; x += spacingX) {
    for (let y = top + spacingY * 0.5; y < top + height - 8; y += spacingY) {
      if (direction === 'in') {
        ctx.beginPath();
        ctx.moveTo(x - radius, y - radius);
        ctx.lineTo(x + radius, y + radius);
        ctx.moveTo(x + radius, y - radius);
        ctx.lineTo(x - radius, y + radius);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

/** Draws a luminous conductor and a velocity-direction wake. */
export function drawGlowingConductorRod(
  ctx: CanvasRenderingContext2D,
  x: number,
  yTop: number,
  yBot: number,
  velocitySign: number,
  tintHex = '#38bdf8',
  coreHex = '#e0f2fe',
  rodWidth = 11
): void {
  if (![x, yTop, yBot, velocitySign, rodWidth].every(Number.isFinite) || yBot <= yTop || rodWidth <= 0) return;
  ctx.save();
  if (Math.abs(velocitySign) > 0.01) {
    const direction = velocitySign >= 0 ? -1 : 1;
    const wakeLength = Math.min(120, Math.max(42, Math.abs(velocitySign) * 28));
    const wake = ctx.createLinearGradient(x, 0, x + direction * wakeLength, 0);
    wake.addColorStop(0, `${tintHex}55`);
    wake.addColorStop(0.55, `${tintHex}18`);
    wake.addColorStop(1, `${tintHex}00`);
    ctx.fillStyle = wake;
    ctx.fillRect(Math.min(x, x + direction * wakeLength), yTop + 4, wakeLength, yBot - yTop - 8);
  }

  const rod = ctx.createLinearGradient(x - rodWidth * 0.5, 0, x + rodWidth * 0.5, 0);
  rod.addColorStop(0, tintHex);
  rod.addColorStop(0.22, coreHex);
  rod.addColorStop(0.42, tintHex);
  rod.addColorStop(0.78, tintHex);
  rod.addColorStop(1, coreHex);
  ctx.shadowColor = tintHex;
  ctx.shadowBlur = 18;
  ctx.fillStyle = rod;
  roundedRectPath(ctx, x - rodWidth * 0.5, yTop - 12, rodWidth, yBot - yTop + 24, rodWidth * 0.45);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,.27)';
  ctx.fillRect(x - rodWidth * .24, yTop - 8, Math.max(.8, rodWidth * .12), yBot - yTop + 16);
  ctx.restore();
}

/** Draws a luminous vector with an unblurred, precise triangular head. */
export function drawGlowVectorArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  lineWidth = 4,
  headLen = 13
): void {
  if (![x1, y1, x2, y2, lineWidth, headLen].every(Number.isFinite)) return;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length < 6) return;
  const angle = Math.atan2(dy, dx);
  const head = Math.min(Math.max(4, headLen), length * 0.55);
  const shaftX = x2 - head * 0.72 * Math.cos(angle);
  const shaftY = y2 - head * 0.72 * Math.sin(angle);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 11;
  ctx.lineWidth = Math.max(0.5, lineWidth);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(shaftX, shaftY);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(0.5, lineWidth * .76);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - 0.48), y2 - head * Math.sin(angle - 0.48));
  ctx.lineTo(x2 - head * Math.cos(angle + 0.48), y2 - head * Math.sin(angle + 0.48));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Draws a bounded translucent optical glass block. */
export function drawRefractiveGlassBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
  ctx.save();
  const fill = ctx.createLinearGradient(x, y, x + width, y + height);
  fill.addColorStop(0, 'rgba(125, 211, 252, 0.24)');
  fill.addColorStop(0.55, 'rgba(56, 189, 248, 0.14)');
  fill.addColorStop(1, 'rgba(56, 189, 248, 0.08)');
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.32)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);
  ctx.shadowColor = 'rgba(125, 211, 252, 0.65)';
  ctx.shadowBlur = 10;
  ctx.strokeStyle = 'rgba(186, 230, 253, 0.72)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.stroke();
  ctx.restore();
}

/** Draws a smooth multi-segment wire with a voltage gradient. */
export function drawRoundedPotentialPath(
  ctx: CanvasRenderingContext2D,
  points: ReadonlyArray<{ x: number; y: number }>,
  startColor: string,
  endColor: string,
  cornerRadius = 12,
  lineWidth = 5
): void {
  if (points.length < 2 || !points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const gradient = ctx.createLinearGradient(first.x, first.y, last.x, last.y);
  gradient.addColorStop(0, startColor);
  gradient.addColorStop(1, endColor);
  ctx.save();
  ctx.strokeStyle = gradient;
  ctx.lineWidth = Math.max(0.5, lineWidth);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = startColor;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const before = Math.hypot(current.x - previous.x, current.y - previous.y);
    const after = Math.hypot(next.x - current.x, next.y - current.y);
    ctx.arcTo(current.x, current.y, next.x, next.y, Math.min(cornerRadius, before * 0.4, after * 0.4));
  }
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();
}

/** Draws a bulb whose glow follows its calculated electrical power. */
export function drawGlowingBulbSymbol(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  powerWatts: number,
  ratedWatts = 10,
  radius = 18
): void {
  if (![cx, cy, powerWatts, ratedWatts, radius].every(Number.isFinite) || radius <= 0) return;
  const ratio = Math.max(0, Math.min(1.3, powerWatts / Math.max(0.2, ratedWatts)));
  ctx.save();
  if (ratio > 0.02) {
    const halo = ctx.createRadialGradient(cx, cy - 2, 2, cx, cy - 2, radius * 2.5);
    halo.addColorStop(0, `rgba(253, 224, 71, ${(0.45 * Math.min(1, ratio)).toFixed(2)})`);
    halo.addColorStop(0.5, `rgba(251, 146, 60, ${(0.22 * Math.min(1, ratio)).toFixed(2)})`);
    halo.addColorStop(1, 'rgba(251, 146, 60, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy - 2, radius * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.strokeStyle = ratio > 0.05 ? '#fde047' : '#94a3b8';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#fbbf24';
  ctx.shadowBlur = 16 * Math.min(1, ratio);
  ctx.beginPath();
  ctx.arc(cx, cy - 3, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = ratio > 0.05 ? '#fef08a' : '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 5, cy + radius - 6);
  ctx.lineTo(cx - 5, cy - 3);
  ctx.lineTo(cx - 2, cy - 7);
  ctx.lineTo(cx + 2, cy - 1);
  ctx.lineTo(cx + 5, cy - 7);
  ctx.lineTo(cx + 5, cy + radius - 6);
  ctx.stroke();
  if (ratio > 0.1) {
    ctx.strokeStyle = `rgba(253, 224, 71, ${(0.35 + 0.55 * Math.min(1, ratio)).toFixed(2)})`;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    for (let index = -2; index <= 2; index += 1) {
      const angle = -Math.PI * 0.5 + index * 0.58;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * (radius + 5), cy - 3 + Math.sin(angle) * (radius + 5));
      ctx.lineTo(cx + Math.cos(angle) * (radius + 11 + ratio * 4), cy - 3 + Math.sin(angle) * (radius + 11 + ratio * 4));
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Draws the standard three-bar ground symbol. */
export function drawGroundSymbol(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color = '#38bdf8'
): void {
  if (![x, y].every(Number.isFinite)) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + 10);
  ctx.moveTo(x - 13, y + 10);
  ctx.lineTo(x + 13, y + 10);
  ctx.moveTo(x - 8, y + 16);
  ctx.lineTo(x + 8, y + 16);
  ctx.moveTo(x - 4, y + 22);
  ctx.lineTo(x + 4, y + 22);
  ctx.stroke();
  ctx.restore();
}

/** Draws a compact, data-driven current-voltage characteristic card. */
export function drawFloatingIUCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  samples: ReadonlyArray<{ u: number; i: number }>,
  currentPoint?: { u: number; i: number }
): void {
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
  ctx.save();
  ctx.fillStyle = 'rgba(18, 25, 39, 0.88)';
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
  ctx.lineWidth = 1.2;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 18;
  roundedRectPath(ctx, x, y, width, height, 14);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillText('I-U 曲线', x + 14, y + 23);
  const valid = samples.filter((sample) => Number.isFinite(sample.u) && Number.isFinite(sample.i));
  if (valid.length < 2) {
    ctx.restore();
    return;
  }
  const padX = 16;
  const padTop = 38;
  const padBottom = 18;
  const plotWidth = Math.max(1, width - padX * 2);
  const plotHeight = Math.max(1, height - padTop - padBottom);
  const minU = Math.min(0, ...valid.map((sample) => sample.u));
  const maxU = Math.max(1e-6, ...valid.map((sample) => sample.u));
  const minI = Math.min(0, ...valid.map((sample) => sample.i));
  const maxI = Math.max(1e-6, ...valid.map((sample) => sample.i));
  const toPoint = (u: number, i: number) => ({
    px: x + padX + ((u - minU) / (maxU - minU || 1)) * plotWidth,
    py: y + height - padBottom - ((i - minI) / (maxI - minI || 1)) * plotHeight
  });
  const baselineY = toPoint(0, 0).py;
  const area = ctx.createLinearGradient(x + padX, y + padTop, x + padX + plotWidth, y + height - padBottom);
  area.addColorStop(0, 'rgba(56, 189, 248, 0.05)');
  area.addColorStop(1, 'rgba(251, 113, 133, 0.22)');
  ctx.beginPath();
  const first = toPoint(valid[0]!.u, valid[0]!.i);
  ctx.moveTo(first.px, baselineY);
  for (const sample of valid) {
    const point = toPoint(sample.u, sample.i);
    ctx.lineTo(point.px, point.py);
  }
  const last = toPoint(valid[valid.length - 1]!.u, valid[valid.length - 1]!.i);
  ctx.lineTo(last.px, baselineY);
  ctx.closePath();
  ctx.fillStyle = area;
  ctx.fill();

  const line = ctx.createLinearGradient(x + padX, y + height - padBottom, x + padX + plotWidth, y + padTop);
  line.addColorStop(0, '#38bdf8');
  line.addColorStop(0.55, '#fbbf24');
  line.addColorStop(1, '#fb7185');
  ctx.strokeStyle = line;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  valid.forEach((sample, index) => {
    const point = toPoint(sample.u, sample.i);
    if (index === 0) ctx.moveTo(point.px, point.py);
    else ctx.lineTo(point.px, point.py);
  });
  ctx.stroke();
  if (currentPoint && Number.isFinite(currentPoint.u) && Number.isFinite(currentPoint.i)) {
    const point = toPoint(currentPoint.u, currentPoint.i);
    ctx.fillStyle = '#fde047';
    ctx.shadowColor = '#fde047';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(point.px, point.py, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return Math.abs(a.x - b.x) * 2 < a.width + b.width && Math.abs(a.y - b.y) * 2 < a.height + b.height;
}

/** Measures and places labels, preferring their requested positions while avoiding collisions. */
export function resolveLabelBoxes(
  labels: ReadonlyArray<CanvasLabel>,
  measureText: (text: string, font?: string) => number,
  canvasWidth: number,
  canvasHeight: number
): LabelBox[] {
  const width = Math.max(0, finite(canvasWidth));
  const height = Math.max(0, finite(canvasHeight));
  const placed: LabelBox[] = [];
  for (const label of labels) {
    const font = label.font ?? '600 13px system-ui, sans-serif';
    const boxWidth = Math.max(1, finite(label.width ?? measureText(label.text, font)) + (label.width === undefined ? 12 : 0));
    const boxHeight = Math.max(1, finite(label.height ?? 22));
    const margin = Math.min(8, width * 0.5, height * 0.5);
    const minX = Math.min(width * 0.5, boxWidth * 0.5 + margin);
    const maxX = Math.max(minX, width - boxWidth * 0.5 - margin);
    const minY = Math.min(height * 0.5, boxHeight * 0.5 + margin);
    const maxY = Math.max(minY, height - boxHeight * 0.5 - margin);
    const baseX = Math.max(minX, Math.min(maxX, finite(label.x)));
    const baseY = Math.max(minY, Math.min(maxY, finite(label.y)));
    const candidates: Array<{ x: number; y: number }> = [{ x: baseX, y: baseY }];
    const step = Math.max(boxHeight + 5, 24);
    for (let ring = 1; ring <= 8; ring += 1) {
      const offset = ring * step;
      candidates.push(
        { x: baseX, y: baseY - offset },
        { x: baseX, y: baseY + offset },
        { x: baseX - offset, y: baseY },
        { x: baseX + offset, y: baseY },
        { x: baseX - offset, y: baseY - offset },
        { x: baseX + offset, y: baseY - offset },
        { x: baseX - offset, y: baseY + offset },
        { x: baseX + offset, y: baseY + offset }
      );
    }
    let best: LabelBox | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const current: LabelBox = {
        ...label,
        x: Math.max(minX, Math.min(maxX, candidate.x)),
        y: Math.max(minY, Math.min(maxY, candidate.y)),
        width: boxWidth,
        height: boxHeight,
        font
      };
      const conflicts = placed.filter((other) => overlaps(current, other));
      if (conflicts.length === 0) {
        best = current;
        break;
      }
      const overlapScore = conflicts.reduce((sum, other) => {
        const overlapX = Math.max(0, (current.width + other.width) * 0.5 - Math.abs(current.x - other.x));
        const overlapY = Math.max(0, (current.height + other.height) * 0.5 - Math.abs(current.y - other.y));
        return sum + overlapX * overlapY;
      }, 0);
      const distance = Math.hypot(current.x - baseX, current.y - baseY) * 0.01;
      if (overlapScore + distance < bestScore) {
        best = current;
        bestScore = overlapScore + distance;
      }
    }
    if (best) placed.push(best);
  }
  return placed;
}

/** Resolves collisions and draws centered canvas labels. */
export function resolveAndDrawLabels(
  ctx: CanvasRenderingContext2D,
  rawLabels: ReadonlyArray<CanvasLabel>,
  canvasWidth: number,
  canvasHeight: number
): void {
  if (rawLabels.length === 0) return;
  const boxes = resolveLabelBoxes(
    rawLabels,
    (text, font) => {
      ctx.font = font ?? '600 13px system-ui, sans-serif';
      return ctx.measureText(text).width;
    },
    canvasWidth,
    canvasHeight
  );
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const box of boxes) {
    ctx.font = box.font ?? '600 13px system-ui, sans-serif';
    if (box.bgColor) {
      ctx.fillStyle = box.bgColor;
      roundedRectPath(ctx, box.x - box.width * 0.5, box.y - box.height * 0.5, box.width, box.height, 6);
      ctx.fill();
    }
    ctx.fillStyle = box.color;
    ctx.fillText(box.text, box.x, box.y);
  }
  ctx.restore();
}
