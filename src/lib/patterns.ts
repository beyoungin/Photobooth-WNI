import type { PatternKind } from '@/types/photobooth';

/** Tile pola untuk Layer 1. Tile opaque, jadi tidak butuh warna dasar tambahan. */
export function createPatternCanvas(kind: PatternKind, color: string, accent: string): HTMLCanvasElement {
  const size = 80;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = accent;
  ctx.strokeStyle = accent;
  if (kind === 'dots') {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 8, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'stripes') {
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(-10, size + 10);
    ctx.lineTo(size + 10, -10);
    ctx.stroke();
  } else {
    ctx.fillRect(0, 0, size / 2, size / 2);
    ctx.fillRect(size / 2, size / 2, size / 2, size / 2);
  }
  return c;
}
