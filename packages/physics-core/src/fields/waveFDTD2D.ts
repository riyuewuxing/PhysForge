export interface WaveFDTD2DConfig {
  readonly nx: number;
  readonly ny: number;
  readonly dx: number;
  readonly dt: number;
  readonly maxWaveSpeed: number;
  readonly spongeWidth?: number;
  readonly spongeStrength?: number;
  /** Optional physical velocity damping rate γ (s⁻¹) at the outer edge. */
  readonly spongeRatePerSecond?:number;
}

/**
 * 二维波动方程 FDTD 求解器 (Float32Array 双/三缓冲 + 12 格海绵吸收边界 + CFL 刚性检查)
 * 求解 ∂²u/∂t² = c(x,y)² (∂²u/∂x² + ∂²u/∂y²)
 */
export class WaveFDTD2D {
  readonly nx: number;
  readonly ny: number;
  readonly dx: number;
  readonly dt: number;
  readonly courantNumber: number;

  uPrev: Float32Array;
  uCurr: Float32Array;
  uNext: Float32Array;
  readonly speedGrid: Float32Array;
  readonly dampingGrid: Float32Array;
  readonly velocityDampingGrid?:Float32Array;

  constructor(config: WaveFDTD2DConfig) {
    const { nx, ny, dx, dt, maxWaveSpeed } = config;
    if (nx < 16 || ny < 16) {
      throw new Error(`WaveFDTD2D grid must be at least 16x16, got ${nx}x${ny}.`);
    }
    if (dx <= 0 || dt <= 0 || maxWaveSpeed <= 0) {
      throw new Error('WaveFDTD2D dx, dt, and maxWaveSpeed must be positive.');
    }

    const cfl = (maxWaveSpeed * dt) / dx;
    const cflLimit = 1 / Math.SQRT2;
    if (cfl > cflLimit + 1e-9) {
      throw new Error(
        `WaveFDTD2D CFL instability detected: c*dt/dx = ${cfl.toFixed(4)} > 1/sqrt(2) (${cflLimit.toFixed(4)}).`
      );
    }

    this.nx = nx;
    this.ny = ny;
    this.dx = dx;
    this.dt = dt;
    this.courantNumber = cfl;

    const total = nx * ny;
    this.uPrev = new Float32Array(total);
    this.uCurr = new Float32Array(total);
    this.uNext = new Float32Array(total);
    this.speedGrid = new Float32Array(total);
    this.speedGrid.fill(maxWaveSpeed);

    this.dampingGrid = new Float32Array(total);
    if(config.spongeRatePerSecond!==undefined){
      if(!Number.isFinite(config.spongeRatePerSecond)||config.spongeRatePerSecond<0)throw new Error('Invalid sponge velocity damping rate');
      this.velocityDampingGrid=new Float32Array(total);
    }
    const spongeWidth = config.spongeWidth ?? 12;
    const spongeStrength = config.spongeStrength ?? 0.08;

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const distEdge = Math.min(i, nx - 1 - i, j, ny - 1 - j);
        let damp = 1.0;
        if (distEdge < spongeWidth) {
          const ratio = (spongeWidth - distEdge) / spongeWidth;
          damp = Math.exp(-spongeStrength * ratio * ratio);
          if(this.velocityDampingGrid)this.velocityDampingGrid[j*nx+i]=.5*dt*config.spongeRatePerSecond!*ratio*ratio;
        }
        this.dampingGrid[j * nx + i] = damp;
      }
    }
  }

  setObstacleMask(isBlocked: (i: number, j: number) => boolean): void {
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        if (isBlocked(i, j)) {
          const idx = j * this.nx + i;
          this.speedGrid[idx] = 0;
          this.uCurr[idx] = 0;
          this.uPrev[idx] = 0;
        }
      }
    }
  }

  injectSource(i: number, j: number, value: number): void {
    if (i < 1 || i >= this.nx - 1 || j < 1 || j >= this.ny - 1) return;
    this.uCurr[j * this.nx + i] = value;
  }

  step(): void {
    const { nx, ny, dx, dt, uPrev, uCurr, uNext, speedGrid, dampingGrid } = this;
    const invDxSq = 1 / (dx * dx);
    const dtSq = dt * dt;
    const velocityDamping=this.velocityDampingGrid;

    for (let j = 1; j < ny - 1; j++) {
      const row = j * nx;
      for (let i = 1; i < nx - 1; i++) {
        const idx = row + i;
        const c = speedGrid[idx]!;
        if (c === 0) {
          uNext[idx] = 0;
          continue;
        }
        const laplacian =
          (uCurr[idx - 1]! +
            uCurr[idx + 1]! +
            uCurr[idx - nx]! +
            uCurr[idx + nx]! -
            4 * uCurr[idx]!) *
          invDxSq;

        const rawNext = 2 * uCurr[idx]! - uPrev[idx]! + c * c * dtSq * laplacian;
        // Centered discretization of u_tt + γ u_t = c²∇²u.
        // Legacy callers retain their historical displacement sponge.
        const g=velocityDamping?.[idx]??0;
        uNext[idx] = velocityDamping?(rawNext+g*uPrev[idx]!)/(1+g):rawNext*dampingGrid[idx]!;
      }
    }

    // 轮换三缓冲零拷贝
    this.uPrev = uCurr;
    this.uCurr = uNext;
    this.uNext = uPrev;
  }

  sampleMaxAmplitude(): number {
    let maxAbs = 0;
    for (let i = 0; i < this.uCurr.length; i++) {
      const v = Math.abs(this.uCurr[i]!);
      if (v > maxAbs) maxAbs = v;
    }
    return maxAbs;
  }
}
