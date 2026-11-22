import type { LayoutId, LayoutSpec, OverlayItem, SlotRect } from '@/types/photobooth';

export type ShotCount = 3 | 4;

/** Ukuran area kosong (px kanvas logis) yang bisa diatur pengguna. */
export interface LayoutOptions {
  /** Tepi kiri & kanan (strip) / tepi kiri, kanan, atas (4R). */
  margin: number;
  /** Tepi atas — hanya dipakai strip (di 4R mengikuti `margin`). */
  top: number;
  /** Ruang kosong di bawah foto (teks, stempel, gambar). */
  bottom: number;
  /** Jarak antar foto. */
  gap: number;
}

export interface OptionRange {
  key: keyof LayoutOptions;
  label: string;
  min: number;
  max: number;
}

export const DEFAULT_OPTIONS: Record<LayoutId, LayoutOptions> = {
  'strip-2x6': { margin: 100, top: 120, bottom: 420, gap: 60 },
  '4r-landscape': { margin: 60, top: 60, bottom: 140, gap: 40 },
};

export const OPTION_RANGES: Record<LayoutId, OptionRange[]> = {
  'strip-2x6': [
    { key: 'margin', label: 'Tepi samping', min: 40, max: 400 },
    { key: 'top', label: 'Tepi atas', min: 40, max: 500 },
    { key: 'bottom', label: 'Ruang bawah', min: 150, max: 900 },
    { key: 'gap', label: 'Jarak antar foto', min: 20, max: 200 },
  ],
  '4r-landscape': [
    { key: 'margin', label: 'Tepi samping & atas', min: 30, max: 300 },
    { key: 'bottom', label: 'Ruang bawah', min: 80, max: 500 },
    { key: 'gap', label: 'Jarak antar foto', min: 20, max: 120 },
  ],
};

const MIN_SLOT = 200;

/**
 * Layout dihitung deterministik dari jumlah foto + opsi ukuran.
 * Semua angka dalam piksel kanvas logis (setara 300 DPI sesuai spesifikasi).
 */
export function createLayout(id: LayoutId, count: ShotCount, options?: Partial<LayoutOptions>): LayoutSpec {
  const o = { ...DEFAULT_OPTIONS[id], ...options };

  if (id === 'strip-2x6') {
    const W = 1200;
    const H = 3600;
    const h = Math.max(MIN_SLOT, Math.floor((H - o.top - o.bottom - o.gap * (count - 1)) / count));
    const w = Math.max(MIN_SLOT, W - o.margin * 2);
    const slots: SlotRect[] = Array.from({ length: count }, (_, i) => ({
      x: Math.round((W - w) / 2),
      y: o.top + i * (h + o.gap),
      width: w,
      height: h,
    }));
    return { id, label: 'Photo Strip 2×6"', width: W, height: H, slots };
  }

  const W = 1800;
  const H = 1200;
  const m = o.margin;
  let slots: SlotRect[];
  if (count === 4) {
    const w = Math.max(MIN_SLOT, Math.floor((W - m * 2 - o.gap) / 2));
    const h = Math.max(MIN_SLOT, Math.floor((H - m - o.bottom - o.gap) / 2));
    slots = Array.from({ length: 4 }, (_, i) => ({
      x: m + (i % 2) * (w + o.gap),
      y: m + Math.floor(i / 2) * (h + o.gap),
      width: w,
      height: h,
    }));
  } else {
    const w = Math.max(MIN_SLOT, Math.floor((W - m * 2 - o.gap * 2) / 3));
    const h = Math.max(MIN_SLOT, H - m - o.bottom);
    slots = Array.from({ length: 3 }, (_, i) => ({ x: m + i * (w + o.gap), y: m, width: w, height: h }));
  }
  return { id, label: 'Cetak 4R (landscape)', width: W, height: H, slots };
}

export const slotAspect = (layout: LayoutSpec) => layout.slots[0].width / layout.slots[0].height;

/** Stempel tanggal otomatis (Layer 4) di area kosong bawah slot terakhir. */
export function createDateStampItem(layout: LayoutSpec, date = new Date(), fill = '#1c1917'): OverlayItem {
  const fontSize = Math.round(layout.width * 0.04);
  const lastBottom = Math.max(...layout.slots.map((s) => s.y + s.height));
  const free = layout.height - lastBottom;
  const margin = Math.round(layout.width * 0.08);
  return {
    id: `item-${crypto.randomUUID()}`,
    kind: 'text',
    text: date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase(),
    x: margin,
    y: lastBottom + free / 2 - fontSize / 2,
    width: layout.width - margin * 2,
    align: 'center',
    fontSize,
    fontFamily: 'ui-monospace, Menlo, monospace',
    fontStyle: 'bold',
    fill,
    rotation: 0,
    scale: 1,
  };
}
