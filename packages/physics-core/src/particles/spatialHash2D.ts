export interface DiskParticle2D {
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly radius: number;
  readonly mass: number;
}

/**
 * 二维均匀空间哈希网格（O(N) 邻域检索与硬球分子弹性碰撞，零 Math.random）
 */
export class SpatialHash2D {
  private readonly cellSize: number;
  private readonly buckets = new Map<string, number[]>();

  constructor(cellSize: number) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new Error(`SpatialHash2D cellSize must be positive finite, got ${cellSize}.`);
    }
    this.cellSize = cellSize;
  }

  private key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  clear(): void {
    this.buckets.clear();
  }

  rebuild(particles: readonly DiskParticle2D[]): void {
    this.buckets.clear();
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]!;
      const cx = Math.floor(p.x / this.cellSize);
      const cy = Math.floor(p.y / this.cellSize);
      const k = this.key(cx, cy);
      let list = this.buckets.get(k);
      if (!list) {
        list = [];
        this.buckets.set(k, list);
      }
      list.push(i);
    }
  }

  queryNeighbors(x: number, y: number): number[] {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const result: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.buckets.get(this.key(cx + dx, cy + dy));
        if (list) {
          for (const idx of list) result.push(idx);
        }
      }
    }
    return result;
  }

  /**
   * 求解全部相互重叠且相向运动的硬球二维弹性/非弹性碰撞，保持动量严格守恒（e=1 时动能严格守恒）
   */
  resolveDiskCollisions(particles: DiskParticle2D[], restitution = 1.0): number {
    this.rebuild(particles);
    let collisionCount = 0;

    for (let i = 0; i < particles.length; i++) {
      const a = particles[i]!;
      const neighbors = this.queryNeighbors(a.x, a.y);

      for (const j of neighbors) {
        if (j <= i) continue;
        const b = particles[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDist = a.radius + b.radius;
        const distSq = dx * dx + dy * dy;
        if (distSq >= minDist * minDist || distSq === 0) continue;

        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;

        // 位置去重叠修正（按质量倒数加权）
        const invMa = 1 / Math.max(a.mass, 1e-12);
        const invMb = 1 / Math.max(b.mass, 1e-12);
        const invMassSum = invMa + invMb;
        const overlap = minDist - dist;
        a.x -= nx * overlap * (invMa / invMassSum);
        a.y -= ny * overlap * (invMa / invMassSum);
        b.x += nx * overlap * (invMb / invMassSum);
        b.y += ny * overlap * (invMb / invMassSum);

        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const relVelNormal = rvx * nx + rvy * ny;
        if (relVelNormal > 0) continue;

        const impulse = (-(1 + restitution) * relVelNormal) / invMassSum;
        a.vx -= impulse * invMa * nx;
        a.vy -= impulse * invMa * ny;
        b.vx += impulse * invMb * nx;
        b.vy += impulse * invMb * ny;
        collisionCount++;
      }
    }

    return collisionCount;
  }
}
