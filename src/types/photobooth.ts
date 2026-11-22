import type { Ref } from 'react';

export type LayoutId = 'strip-2x6' | '4r-landscape';

export interface SlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutSpec {
  id: LayoutId;
  label: string;
  /** Ukuran logis kanvas dalam px (setara 300 DPI). */
  width: number;
  height: number;
  slots: SlotRect[];
}

export type FilterId = 'normal' | 'bw' | 'vintage' | 'cool' | 'glow';

export type PatternKind = 'dots' | 'stripes' | 'checker';

export type BackgroundSpec =
  | { kind: 'color'; color: string }
  | { kind: 'pattern'; pattern: PatternKind; color: string; accent: string }
  /** Gambar penuh di belakang foto (di-cover ke seluruh kanvas); `color` = warna cadangan. */
  | { kind: 'image'; src: string; color: string };

/**
 * Transform foto di dalam slot (koordinat relatif terhadap pojok kiri-atas slot).
 * x,y = posisi TITIK TENGAH foto; rotasi & scale terjadi di titik tengah.
 */
export interface SlotTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

/** Item Layer 4: teks, stempel tanggal, emoji, atau stiker gambar. */
export interface OverlayItem {
  id: string; // harus unik, mis. "item-<uuid>"
  kind: 'text' | 'image';
  x: number;
  y: number;
  rotation: number;
  scale: number;
  // text
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontStyle?: string;
  fill?: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
  // image (stiker); width = lebar dasar sebelum scale
  src?: string;
}

export interface ExportOptions {
  format?: 'png' | 'jpeg';
  /** 0..1, hanya untuk JPEG. */
  quality?: number;
  /** 1 = persis ukuran layout (mis. 1200x3600). Otomatis dibatasi batas area canvas browser. */
  multiplier?: number;
}

export interface PhotoboothCanvasHandle {
  exportBlob: (opts?: ExportOptions) => Promise<Blob>;
  clearSelection: () => void;
  resetSlot: (index: number) => void;
}

export interface PhotoboothCanvasProps {
  layout: LayoutSpec;
  /** Satu entri per slot; null = slot kosong. Boleh blob: URL / data: URL. */
  photos: (string | null)[];
  background: BackgroundSpec;
  /** PNG transparan sebagai Layer 3. */
  frameSrc?: string | null;
  filter: FilterId;
  items: OverlayItem[];
  onItemsChange?: (items: OverlayItem[]) => void;
  onSlotClick?: (index: number) => void;
  onSelectionChange?: (id: string | null) => void;
  className?: string;
  /** React 19: ref adalah prop biasa. */
  ref?: Ref<PhotoboothCanvasHandle>;
}

export interface CapturedShot {
  id: string;
  blob: Blob;
  /** Object URL untuk <img> dan PhotoboothCanvas. Revoke saat tidak dipakai. */
  url: string;
  width: number;
  height: number;
  source: 'camera' | 'upload';
  /** Klip 2 detik sebelum jepretan (webm/mp4). Diisi asinkron. */
  livePhoto?: Blob;
}
