import type { LayoutSpec } from '@/types/photobooth';

export type TemplateMode = 'base' | 'guide' | 'back';

const toPng = (c: HTMLCanvasElement) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Gagal membuat PNG.'))), 'image/png'));

/**
 * Membuat template frame berukuran persis sama dengan kanvas.
 *  - 'base'  : warna dasar + LUBANG TRANSPARAN di setiap slot foto. Ini yang diedit lalu diunggah kembali.
 *  - 'back'  : kanvas sisi belakang + bayangan posisi foto depan (terbalik kiri-kanan, seperti terlihat tembus
 *              saat kertas dibalik) agar gambar belakang bisa disejajarkan. Hanya panduan.
 *  - 'guide' : panduan bergambar (slot berwarna, bernomor, ada ukuran). Hanya untuk referensi di
 *              aplikasi desain — JANGAN diunggah sebagai frame karena menutupi foto.
 */
export async function createFrameTemplate(layout: LayoutSpec, mode: TemplateMode, baseColor = '#ffffff'): Promise<Blob> {
  const { width: W, height: H, slots } = layout;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  if (mode === 'base') {
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'destination-out';
    for (const s of slots) ctx.fillRect(s.x, s.y, s.width, s.height);
    ctx.globalCompositeOperation = 'source-over';
    return toPng(c);
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  const fs = Math.round(W * 0.035);

  if (mode === 'back') {
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(120,113,108,0.8)';
    ctx.fillStyle = 'rgba(120,113,108,0.9)';
    ctx.lineWidth = 5;
    ctx.setLineDash([20, 14]);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${fs * 0.8}px sans-serif`;
    slots.forEach((s, i) => {
      const mx = W - s.x - s.width; // cermin kiri-kanan
      ctx.strokeRect(mx, s.y, s.width, s.height);
      ctx.fillText(`posisi foto depan ${i + 1} (tembus)`, mx + s.width / 2, s.y + s.height / 2);
    });
    ctx.setLineDash([]);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `${fs * 0.7}px sans-serif`;
    ctx.fillText(`Sisi BELAKANG — kanvas ${W}×${H}px. Garis putus-putus hanya panduan, sembunyikan sebelum ekspor.`, 24, 20);
    return toPng(c);
  }
  slots.forEach((s, i) => {
    ctx.fillStyle = 'rgba(236,72,153,0.28)';
    ctx.fillRect(s.x, s.y, s.width, s.height);
    ctx.strokeStyle = '#db2777';
    ctx.lineWidth = 6;
    ctx.setLineDash([24, 16]);
    ctx.strokeRect(s.x, s.y, s.width, s.height);
    ctx.setLineDash([]);
    ctx.fillStyle = '#9d174d';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${fs * 1.4}px sans-serif`;
    ctx.fillText(`FOTO ${i + 1}`, s.x + s.width / 2, s.y + s.height / 2 - fs * 0.6);
    ctx.font = `${fs * 0.8}px sans-serif`;
    ctx.fillText(`${s.width}×${s.height}px  (x:${s.x}, y:${s.y})`, s.x + s.width / 2, s.y + s.height / 2 + fs);
  });
  ctx.fillStyle = '#57534e';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `${fs * 0.7}px sans-serif`;
  ctx.fillText(`${layout.label} — kanvas ${W}×${H}px. Ini hanya panduan, jangan diunggah sebagai frame.`, 24, 20);
  return toPng(c);
}

/** Cek gambar latar: tipe, rasio (akan di-crop "cover"), dan resolusi. Tidak ada syarat transparan. */
export async function validateBackgroundFile(file: File, layout: LayoutSpec): Promise<FrameCheck> {
  const warnings: string[] = [];
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    return { ok: false, error: 'Gambar latar harus PNG, JPG, atau WebP.', warnings };
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return { ok: false, error: 'Gambar tidak bisa dibaca.', warnings };
  }
  const diff = Math.abs(bmp.width / bmp.height / (layout.width / layout.height) - 1);
  if (diff > 0.02)
    warnings.push(
      `Rasio gambar (${bmp.width}×${bmp.height}) berbeda dari kanvas (${layout.width}×${layout.height}); bagian tepi akan terpotong. Gunakan template agar pas.`,
    );
  if (bmp.width < layout.width * 0.5)
    warnings.push(`Resolusi rendah (${bmp.width}px); idealnya ${layout.width}×${layout.height}px agar cetakan tajam.`);
  bmp.close();
  return { ok: true, warnings };
}

export interface FrameCheck {
  ok: boolean;
  error?: string;
  warnings: string[];
}

/** Cek frame unggahan: PNG, rasio sama dengan kanvas, dan area slot benar-benar transparan. */
export async function validateFrameFile(file: File, layout: LayoutSpec): Promise<FrameCheck> {
  const warnings: string[] = [];
  if (file.type !== 'image/png') return { ok: false, error: 'Frame harus berformat PNG (agar bisa transparan).', warnings };

  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return { ok: false, error: 'File PNG tidak bisa dibaca.', warnings };
  }

  const ratioDiff = Math.abs(bmp.width / bmp.height / (layout.width / layout.height) - 1);
  if (ratioDiff > 0.02) {
    warnings.push(
      `Rasio frame (${bmp.width}×${bmp.height}) berbeda dari kanvas (${layout.width}×${layout.height}); frame akan melar. Gunakan template yang diunduh.`,
    );
  } else if (bmp.width < layout.width * 0.5) {
    warnings.push(`Resolusi frame rendah (${bmp.width}px). Idealnya ${layout.width}×${layout.height}px agar cetakan tajam.`);
  }

  // Sampel alpha di beberapa titik dalam tiap slot pada versi kecil.
  const k = 0.25;
  const cw = Math.round(layout.width * k);
  const ch = Math.round(layout.height * k);
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, cw, ch);
  bmp.close();

  const covered: number[] = [];
  layout.slots.forEach((s, i) => {
    let opaque = 0;
    const pts = [0.2, 0.5, 0.8];
    for (const fx of pts)
      for (const fy of pts) {
        const px = Math.round((s.x + s.width * fx) * k);
        const py = Math.round((s.y + s.height * fy) * k);
        if (ctx.getImageData(px, py, 1, 1).data[3] > 200) opaque++;
      }
    if (opaque >= 5) covered.push(i + 1);
  });
  if (covered.length)
    warnings.push(
      `Area slot foto ${covered.join(', ')} tidak transparan, jadi foto akan tertutup. Hapus (erase) bagian itu di aplikasi desain dan ekspor sebagai PNG transparan.`,
    );

  return { ok: true, warnings };
}
