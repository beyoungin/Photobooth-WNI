import type { FilterId } from '@/types/photobooth';

/** Signature yang diterima Konva: mutasi ImageData di tempat. */
export type PixelFilter = (imageData: ImageData) => void;

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

const bw: PixelFilter = ({ data }) => {
  for (let i = 0; i < data.length; i += 4) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const v = clamp((l - 128) * 1.45 + 134); // kontras tinggi
    data[i] = data[i + 1] = data[i + 2] = v;
  }
};

const vintage: PixelFilter = ({ data }) => {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // campur 40% sepia + warm tint + black-point terangkat (efek "fade")
    const sr = r * 0.393 + g * 0.769 + b * 0.189;
    const sg = r * 0.349 + g * 0.686 + b * 0.168;
    const sb = r * 0.272 + g * 0.534 + b * 0.131;
    data[i] = clamp((r * 0.6 + sr * 0.4) * 1.05 * 0.9 + 22);
    data[i + 1] = clamp((g * 0.6 + sg * 0.4) * 0.9 + 16);
    data[i + 2] = clamp((b * 0.6 + sb * 0.4) * 0.85 + 12);
  }
};

const cool: PixelFilter = ({ data }) => {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp(data[i] * 0.9);
    data[i + 1] = clamp(data[i + 1] * 1.0 + 2);
    data[i + 2] = clamp(data[i + 2] * 1.12 + 10);
  }
};

/** Soft glow: blur murah (down/up-scale, jalan di semua browser) lalu screen-blend. */
const glow: PixelFilter = (imageData) => {
  const { width: w, height: h, data } = imageData;
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  src.getContext('2d')!.putImageData(imageData, 0, 0);

  const f = Math.max(4, Math.round(Math.min(w, h) / 40));
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(w / f));
  small.height = Math.max(1, Math.round(h / f));
  const sctx = small.getContext('2d')!;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(src, 0, 0, small.width, small.height);

  const big = document.createElement('canvas');
  big.width = w;
  big.height = h;
  const bctx = big.getContext('2d')!;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, w, h);
  const blur = bctx.getImageData(0, 0, w, h).data;

  const k = 0.55;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const o = data[i + c];
      const b = blur[i + c] * k;
      data[i + c] = clamp(255 - ((255 - o) * (255 - b)) / 255 + 4);
    }
  }
};

export const FILTERS: Record<FilterId, PixelFilter[]> = {
  normal: [],
  bw: [bw],
  vintage: [vintage],
  cool: [cool],
  glow: [glow],
};

export const FILTER_LABELS: Record<FilterId, string> = {
  normal: 'Normal',
  bw: 'B&W Kontras',
  vintage: 'Vintage Hangat',
  cool: 'Cool Tone',
  glow: 'Soft Glow',
};
