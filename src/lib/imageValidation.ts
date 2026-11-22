export type ImageCheck =
  | { ok: true; blob: Blob; width: number; height: number; warning?: string }
  | { ok: false; error: string };

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 25 * 1024 * 1024;
const MIN_SHORT_SIDE = 600;
const MAX_LONG_SIDE = 2560;

/**
 * Validasi + normalisasi foto dari galeri:
 *  - tipe/ukuran file, resolusi minimum
 *  - rasio ekstrem (>3:1) ditolak; rasio yang jauh dari slot diberi peringatan (foto tetap bisa digeser di editor)
 *  - orientasi EXIF diterapkan, hasil di-downscale ke JPEG agar ringan di Konva.
 */
export async function validateImageFile(file: File, targetAspect: number): Promise<ImageCheck> {
  if (!ACCEPTED.includes(file.type)) return { ok: false, error: `${file.name}: format harus JPG, PNG, atau WebP.` };
  if (file.size > MAX_BYTES) return { ok: false, error: `${file.name}: ukuran melebihi 25 MB.` };

  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { ok: false, error: `${file.name}: file gambar tidak bisa dibaca.` };
  }

  const { width, height } = bmp;
  const ratio = width / height;
  if (Math.min(width, height) < MIN_SHORT_SIDE) {
    bmp.close();
    return { ok: false, error: `${file.name}: resolusi terlalu kecil (min. ${MIN_SHORT_SIDE}px sisi terpendek).` };
  }
  if (ratio > 3 || ratio < 1 / 3) {
    bmp.close();
    return { ok: false, error: `${file.name}: rasio aspek terlalu ekstrem (${ratio.toFixed(2)}).` };
  }

  const scale = Math.min(1, MAX_LONG_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
  if (!blob) return { ok: false, error: `${file.name}: gagal memproses gambar.` };

  const diff = Math.abs(ratio / targetAspect - 1);
  return {
    ok: true,
    blob,
    width: canvas.width,
    height: canvas.height,
    warning:
      diff > 0.35
        ? `${file.name}: rasio berbeda dari slot, tepi akan terpotong (atur posisinya di editor).`
        : undefined,
  };
}
