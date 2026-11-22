'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';

import CameraCapture from '@/components/camera/CameraCapture';
import { FILTER_LABELS } from '@/lib/filters';
import { createFrameTemplate, validateBackgroundFile, validateFrameFile } from '@/lib/frameTemplate';
import {
  DEFAULT_OPTIONS,
  OPTION_RANGES,
  createDateStampItem,
  createLayout,
  slotAspect,
  type LayoutOptions,
  type ShotCount,
} from '@/lib/layouts';
import type {
  BackgroundSpec,
  CapturedShot,
  FilterId,
  LayoutId,
  OverlayItem,
  PhotoboothCanvasHandle,
} from '@/types/photobooth';

// Konva butuh browser, jadi tidak boleh dirender di server.
const PhotoboothCanvas = dynamic(() => import('@/components/canvas/PhotoboothCanvas'), { ssr: false });

const PALETTE = ['#fafaf9', '#fde68a', '#fbcfe8', '#bfdbfe', '#bbf7d0', '#1c1917'];

export default function Page() {
  const [layoutId, setLayoutId] = useState<LayoutId>('strip-2x6');
  const [count, setCount] = useState<ShotCount>(4);
  const [opts, setOpts] = useState<LayoutOptions>(DEFAULT_OPTIONS['strip-2x6']);
  const layout = useMemo(() => createLayout(layoutId, count, opts), [layoutId, count, opts]);
  const changeLayout = (id: LayoutId) => {
    setLayoutId(id);
    setOpts(DEFAULT_OPTIONS[id]);
  };

  const [shots, setShots] = useState<CapturedShot[] | null>(null);
  const [filter, setFilter] = useState<FilterId>('normal');
  const [bgColor, setBgColor] = useState('#fafaf9');
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [frontItems, setFrontItems] = useState<OverlayItem[]>([]);
  const [backItems, setBackItems] = useState<OverlayItem[]>([]);
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [backSame, setBackSame] = useState(true);
  const [backBgColor, setBackBgColor] = useState('#fafaf9');
  const [backBgImage, setBackBgImage] = useState<string | null>(null);
  // Semua alat (teks, emoji, hapus, ...) otomatis bekerja pada sisi yang sedang dibuka.
  const items = side === 'front' ? frontItems : backItems;
  const setItems = side === 'front' ? setFrontItems : setBackItems;
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [frameNotes, setFrameNotes] = useState<string[]>([]);
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [bgNotes, setBgNotes] = useState<string[]>([]);
  const bgInput = useRef<HTMLInputElement>(null);

  const canvasRef = useRef<PhotoboothCanvasHandle>(null);
  const frameInput = useRef<HTMLInputElement>(null);

  // Sisi belakang: jika "samakan dengan depan" aktif, latar belakang = latar depan.
  const editingBack = side === 'back' && !backSame;
  const curBgColor = editingBack ? backBgColor : bgColor;
  const setCurBgColor = editingBack ? setBackBgColor : setBgColor;
  const curBgImage = editingBack ? backBgImage : bgImage;
  const setCurBgImage = editingBack ? setBackBgImage : setBgImage;
  const background: BackgroundSpec = curBgImage
    ? { kind: 'image', src: curBgImage, color: curBgColor }
    : { kind: 'color', color: curBgColor };
  const backLayout = useMemo(() => ({ ...layout, slots: [] }), [layout]);

  // Ganti layout -> perbarui stempel tanggal agar posisinya mengikuti layout baru.
  useEffect(() => {
    if (shots) setFrontItems((prev) => prev.filter((i) => i.kind !== 'text' || !i.text?.match(/^\d{2} /)).concat(createDateStampItem(layout)));
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setFrameNotes([]);
  }, [layout]);

  const startOver = () => {
    shots?.forEach((s) => URL.revokeObjectURL(s.url));
    if (frameSrc) URL.revokeObjectURL(frameSrc);
    if (bgImage) URL.revokeObjectURL(bgImage);
    if (backBgImage) URL.revokeObjectURL(backBgImage);
    setBgImage(null);
    setBackBgImage(null);
    setBgNotes([]);
    setShots(null);
    setFrameSrc(null);
    setFrontItems([]);
    setBackItems([]);
    setSide('front');
  };

  const addText = () => {
    const id = `item-${crypto.randomUUID()}`;
    setItems((p) => [
      ...p,
      { id, kind: 'text', text: 'Teks baru', x: layout.width * 0.1, y: layout.height * 0.45, width: layout.width * 0.8, align: 'center', fontSize: 90, fontFamily: 'sans-serif', fontStyle: 'bold', fill: '#1c1917', rotation: 0, scale: 1 },
    ]);
    setSelected(id);
  };

  const addEmoji = (emoji: string) => {
    const id = `item-${crypto.randomUUID()}`;
    setItems((p) => [...p, { id, kind: 'text', text: emoji, x: layout.width * 0.4, y: layout.height * 0.4, fontSize: 200, rotation: 0, scale: 1 }]);
  };

  const editSelectedText = () => {
    const it = items.find((i) => i.id === selected && i.kind === 'text');
    if (!it) return alert('Ketuk dulu sebuah teks di kanvas.');
    const t = prompt('Ubah teks:', it.text ?? '');
    if (t !== null) setItems((p) => p.map((i) => (i.id === it.id ? { ...i, text: t } : i)));
  };

  const deleteSelected = () => {
    if (selected) setItems((p) => p.filter((i) => i.id !== selected));
    setSelected(null);
  };

  const saveBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const downloadTemplate = async (mode: 'base' | 'guide' | 'back') => {
    const blob = await createFrameTemplate(layout, mode, curBgColor);
    const name = mode === 'base' ? 'frame-dasar' : mode === 'back' ? 'panduan-belakang' : 'panduan';
    saveBlob(blob, `template-${name}-${layout.id}-${layout.width}x${layout.height}.png`);
  };

  const handleBgFile = async (file: File) => {
    const check = await validateBackgroundFile(file, layout);
    if (!check.ok) {
      setBgNotes([check.error ?? 'Gambar tidak valid.']);
      return;
    }
    if (curBgImage) URL.revokeObjectURL(curBgImage);
    setCurBgImage(URL.createObjectURL(file));
    setBgNotes(check.warnings);
  };

  const handleFrameFile = async (file: File) => {
    const check = await validateFrameFile(file, layout);
    if (!check.ok) {
      setFrameNotes([check.error ?? 'Frame tidak valid.']);
      return;
    }
    if (frameSrc) URL.revokeObjectURL(frameSrc);
    setFrameSrc(URL.createObjectURL(file));
    setFrameNotes(check.warnings);
  };

  const download = async (format: 'png' | 'jpeg') => {
    if (!canvasRef.current) return;
    setBusy(true);
    try {
      const blob = await canvasRef.current.exportBlob({ format, quality: 0.95, multiplier: 1 });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `photobooth-${side === 'front' ? 'depan' : 'belakang'}-${Date.now()}.${format === 'jpeg' ? 'jpg' : 'png'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------ Tahap 1: kamera ------------------------------ */
  if (!shots) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <h1 className="mb-4 text-center text-2xl font-black tracking-tight">📸 Photobooth</h1>
        <div className="mb-4 flex justify-center gap-2">
          {(['strip-2x6', '4r-landscape'] as LayoutId[]).map((id) => (
            <button
              key={id}
              onClick={() => changeLayout(id)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold ${layoutId === id ? 'bg-stone-800 text-white' : 'bg-white ring-1 ring-stone-300'}`}
            >
              {id === 'strip-2x6' ? 'Strip 2×6"' : 'Cetak 4R'}
            </button>
          ))}
        </div>
        <CameraCapture
          aspectRatio={slotAspect(layout)}
          shotCount={count}
          onShotCountChange={setCount}
          onComplete={(s) => {
            setShots(s);
            setFrontItems([createDateStampItem(layout)]);
          }}
        />
      </main>
    );
  }

  /* ------------------------------ Tahap 2: editor ------------------------------ */
  return (
    <main className="flex h-dvh flex-col gap-3 p-3 lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-2xl bg-stone-200 p-3">
        <div className="flex justify-center gap-2">
          {(['front', 'back'] as const).map((sd) => (
            <button
              key={sd}
              onClick={() => {
                setSide(sd);
                setSelected(null);
              }}
              className={`rounded-xl px-5 py-2 text-sm font-bold ${side === sd ? 'bg-stone-800 text-white' : 'bg-white ring-1 ring-stone-300'}`}
            >
              {sd === 'front' ? 'Depan' : 'Belakang'}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">
        <PhotoboothCanvas
          key={side}
          ref={canvasRef}
          layout={side === 'front' ? layout : backLayout}
          photos={side === 'front' ? layout.slots.map((_, i) => shots[i]?.url ?? null) : []}
          background={background}
          frameSrc={side === 'front' ? frameSrc : null}
          filter={filter}
          items={items}
          onItemsChange={setItems}
          onSelectionChange={setSelected}
        />
        </div>
      </div>

      <aside className="w-full shrink-0 space-y-4 overflow-y-auto rounded-2xl bg-white p-4 shadow lg:w-80">
        {side === 'front' && (
          <>
          <Section title="Filter">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(FILTER_LABELS) as FilterId[]).map((f) => (
              <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
                {FILTER_LABELS[f]}
              </Chip>
            ))}
          </div>
        </Section>
          </>
        )}

        {side === 'back' && (
          <Section title="Sisi belakang">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={backSame} onChange={(e) => setBackSame(e.target.checked)} className="h-4 w-4 accent-orange-500" />
              Samakan latar dengan sisi depan
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <Chip onClick={() => downloadTemplate('back')}>⬇ Panduan belakang</Chip>
            </div>
            <p className="mt-1 text-xs text-stone-500">
              Panduan menampilkan posisi foto depan (terlihat tembus, sudah dibalik kiri-kanan) supaya gambar belakang sejajar. Saat cetak bolak-balik pilih
              <b> “flip on long edge / balik sisi panjang”</b> untuk strip tegak, atau <b>“short edge”</b> untuk 4R landscape.
              Tambah teks/emoji di sini, atau unggah gambar latar belakang di bawah.
            </p>
          </Section>
        )}

        <Section title="Latar belakang">
          <div className="flex flex-wrap items-center gap-2">
            {PALETTE.map((c) => (
              <button
                key={c}
                aria-label={c}
                onClick={() => setCurBgColor(c)}
                className={`h-9 w-9 rounded-full ring-2 ${curBgColor === c ? 'ring-orange-500' : 'ring-stone-300'}`}
                style={{ background: c }}
              />
            ))}
            <input type="color" value={curBgColor} onChange={(e) => setCurBgColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded" />
          </div>
          <input
            ref={bgInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleBgFile(f);
              e.target.value = '';
            }}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip onClick={() => bgInput.current?.click()}>⬆ Gambar latar</Chip>
            {curBgImage && (
              <Chip
                onClick={() => {
                  URL.revokeObjectURL(curBgImage);
                  setCurBgImage(null);
                  setBgNotes([]);
                }}
              >
                Hapus gambar
              </Chip>
            )}
          </div>
          <p className="mt-1 text-xs text-stone-500">
            Gambar digambar utuh di seluruh kanvas ({layout.width}×{layout.height}px); {side === 'front' ? 'bagian yang tertutup foto tidak akan terlihat. ' : ''}Tidak perlu transparan.
          </p>
          {bgNotes.length > 0 && (
            <ul className="mt-2 space-y-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
              {bgNotes.map((n, i) => (
                <li key={i}>• {n}</li>
              ))}
            </ul>
          )}
        </Section>

        {side === 'front' && (
          <>
          <Section title="Ukuran frame & ruang gambar">
          <div className="space-y-3">
            {OPTION_RANGES[layoutId].map((r) => (
              <label key={r.key} className="block text-xs text-stone-600">
                <span className="flex justify-between">
                  <span>{r.label}</span>
                  <span className="font-mono">{opts[r.key]}px</span>
                </span>
                <input
                  type="range"
                  min={r.min}
                  max={r.max}
                  step={10}
                  value={opts[r.key]}
                  onChange={(e) => setOpts((o) => ({ ...o, [r.key]: Number(e.target.value) }))}
                  className="w-full accent-orange-500"
                />
              </label>
            ))}
            <Chip onClick={() => setOpts(DEFAULT_OPTIONS[layoutId])}>Kembalikan standar</Chip>
          </div>
          <p className="mt-1 text-xs text-stone-500">
            Atur ukuran <b>sebelum</b> mengunduh template frame di bawah. Kalau diubah sesudahnya, lubang foto di frame lama tidak akan pas lagi.
          </p>
        </Section>
          </>
        )}

        {side === 'front' && (
          <>
          <Section title="Frame PNG (transparan)">
          <input
            ref={frameInput}
            type="file"
            accept="image/png"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFrameFile(f);
              e.target.value = '';
            }}
          />
          <ol className="mb-2 list-decimal space-y-0.5 pl-4 text-xs text-stone-500">
            <li>Unduh <b>frame dasar</b> (lubang foto sudah transparan).</li>
            <li>Edit di Canva/Photoshop/Figma — jangan geser atau ubah ukuran kanvas, jangan tutup lubangnya.</li>
            <li>Ekspor sebagai <b>PNG transparan</b>, lalu unggah di sini.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Chip onClick={() => downloadTemplate('base')}>⬇ Frame dasar</Chip>
            <Chip onClick={() => downloadTemplate('guide')}>⬇ Panduan posisi</Chip>
            <Chip onClick={() => frameInput.current?.click()}>⬆ Unggah frame</Chip>
            {frameSrc && (
              <Chip
                onClick={() => {
                  setFrameSrc(null);
                  setFrameNotes([]);
                }}
              >
                Hapus
              </Chip>
            )}
          </div>
          <p className="mt-1 text-xs text-stone-500">
            Ukuran template: {layout.width}×{layout.height}px.
          </p>
          {frameNotes.length > 0 && (
            <ul className="mt-2 space-y-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
              {frameNotes.map((n, i) => (
                <li key={i}>• {n}</li>
              ))}
            </ul>
          )}
        </Section>
          </>
        )}

        <Section title="Teks & stiker">
          <div className="flex flex-wrap gap-2">
            <Chip onClick={addText}>+ Teks</Chip>
            <Chip onClick={editSelectedText}>Ubah teks</Chip>
            <Chip onClick={deleteSelected}>Hapus item</Chip>
            {['❤️', '⭐', '✨', '🎀', '😎'].map((e) => (
              <Chip key={e} onClick={() => addEmoji(e)}>
                {e}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title={side === 'front' ? 'Simpan sisi depan' : 'Simpan sisi belakang'}>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => download('png')} className="flex-1 rounded-xl bg-orange-500 py-3 font-bold text-white shadow-[0_4px_0_#c2410c] active:translate-y-0.5 active:shadow-none disabled:opacity-50">
              {busy ? 'Memproses…' : 'Unduh PNG'}
            </button>
            <button disabled={busy} onClick={() => download('jpeg')} className="rounded-xl bg-stone-800 px-4 py-3 font-bold text-white disabled:opacity-50">
              JPG
            </button>
          </div>
        </Section>

        <button onClick={startOver} className="w-full rounded-xl py-2 text-sm text-stone-500 underline">
          Foto ulang dari awal
        </button>
        <p className="text-xs text-stone-400">Tips: seret foto untuk menggeser, cubit/scroll untuk zoom, Shift+scroll untuk memutar, ketuk dua kali untuk reset.</p>
      </aside>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-stone-500">{title}</h2>
      {children}
    </section>
  );
}

function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-sm font-semibold ring-1 transition active:scale-95 ${active ? 'bg-stone-800 text-white ring-stone-800' : 'bg-white ring-stone-300'}`}
    >
      {children}
    </button>
  );
}
