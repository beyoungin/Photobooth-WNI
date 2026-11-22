'use client';

/**
 * CameraCapture — kamera WebRTC 1080p, burst auto-capture, flash + shutter, mirror,
 * switch kamera, upload galeri (dengan validasi rasio), dan klip "Live Photo" 2 detik.
 *
 * Komponen ini tidak memutuskan layout: parent memberi `aspectRatio` slot dan menerima
 * `CapturedShot[]` lewat `onComplete`. Parent lalu memiliki Object URL-nya (wajib di-revoke).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useCamera } from '@/hooks/useCamera';
import { validateImageFile } from '@/lib/imageValidation';
import { startClipRecorder, type ClipRecorder } from '@/lib/recorder';
import { playShutter, playTick, unlockAudio } from '@/lib/sound';
import type { CapturedShot } from '@/types/photobooth';

type Count = 3 | 4;
type Timer = 3 | 5 | 10;
type Phase = 'idle' | 'running' | 'review';

export interface CameraCaptureProps {
  /** width / height slot foto; foto dicrop center ke rasio ini agar pas di slot. */
  aspectRatio?: number;
  shotCount?: Count;
  onShotCountChange?: (n: Count) => void;
  defaultCountdown?: Timer;
  enableLivePhoto?: boolean;
  onComplete: (shots: CapturedShot[]) => void;
  className?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const newId = () => crypto.randomUUID();

async function grabFrame(video: HTMLVideoElement, aspect: number, mirror: boolean): Promise<CapturedShot> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) throw new Error('Video belum siap.');

  // crop center ke rasio slot
  let sw = vw;
  let sh = vh;
  if (vw / vh > aspect) sw = vh * aspect;
  else sh = vw / aspect;
  const sx = (vw - sw) / 2;
  const sy = (vh - sh) / 2;

  const k = Math.min(1, 2400 / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * k);
  canvas.height = Math.round(sh * k);
  const ctx = canvas.getContext('2d')!;
  if (mirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1); // hasil tersimpan sama dengan yang terlihat di preview
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('Gagal mengambil foto.'))), 'image/jpeg', 0.95),
  );
  return {
    id: newId(),
    blob,
    url: URL.createObjectURL(blob),
    width: canvas.width,
    height: canvas.height,
    source: 'camera',
  };
}

export default function CameraCapture({
  aspectRatio = 4 / 3,
  shotCount: shotCountProp = 4,
  onShotCountChange,
  defaultCountdown = 3,
  enableLivePhoto = true,
  onComplete,
  className = '',
}: CameraCaptureProps) {
  const { videoRef, stream, status, error, canSwitch, switchCamera, mirror, setMirror, restart } = useCamera();

  const [shotCount, setShotCount] = useState<Count>(shotCountProp);
  const [countdown, setCountdown] = useState<Timer>(defaultCountdown);
  const [live, setLive] = useState(enableLivePhoto);
  const [phase, setPhase] = useState<Phase>('idle');
  const [tick, setTick] = useState<number | null>(null);
  const [current, setCurrent] = useState(0);
  const [flash, setFlash] = useState(false);
  const [shots, setShots] = useState<CapturedShot[]>([]);
  const [notes, setNotes] = useState<string[]>([]);

  const cancelRef = useRef(false);
  const shotsRef = useRef<CapturedShot[]>([]);
  const handedOff = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setShotCount(shotCountProp), [shotCountProp]);

  const commitShots = (next: CapturedShot[]) => {
    shotsRef.current = next;
    setShots(next);
  };
  const discardShots = useCallback(() => {
    shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url));
    shotsRef.current = [];
    setShots([]);
  }, []);

  // Unmount: hentikan burst & bersihkan URL kecuali sudah diserahkan ke parent.
  useEffect(
    () => () => {
      cancelRef.current = true;
      if (!handedOff.current) shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url));
    },
    [],
  );

  /** sleep yang bisa dibatalkan; return false jika dibatalkan. */
  const wait = async (ms: number) => {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      if (cancelRef.current) return false;
      await sleep(Math.min(100, Math.max(0, end - performance.now())));
    }
    return !cancelRef.current;
  };

  const runBurst = async () => {
    const video = videoRef.current;
    if (status !== 'ready' || !video || phase === 'running') return;
    unlockAudio(); // harus dalam gesture user
    cancelRef.current = false;
    discardShots();
    setNotes([]);
    setPhase('running');

    const collected: CapturedShot[] = [];
    let recorder: ClipRecorder | null = null;
    try {
      for (let i = 0; i < shotCount; i++) {
        setCurrent(i);
        for (let s: number = countdown; s >= 1; s--) {
          setTick(s);
          playTick(s === 1);
          // klip dimulai tepat 2 detik sebelum jepretan
          if (live && stream && s === Math.min(2, countdown)) recorder = startClipRecorder(stream);
          if (!(await wait(1000))) throw new Error('cancel');
        }
        setTick(null);

        playShutter();
        setFlash(true);
        const shot = await grabFrame(video, aspectRatio, mirror);
        setTimeout(() => setFlash(false), 80);

        if (recorder) {
          const clip = await recorder.stop();
          recorder = null;
          if (clip) shot.livePhoto = clip;
        }
        collected.push(shot);
        commitShots([...collected]);
        if (i < shotCount - 1 && !(await wait(1100))) throw new Error('cancel');
      }
      setPhase('review');
    } catch (e) {
      void recorder?.stop();
      if ((e as Error).message !== 'cancel') setNotes([(e as Error).message]);
      discardShots();
      setPhase('idle');
    } finally {
      setTick(null);
      setFlash(false);
    }
  };

  const cancelBurst = () => {
    cancelRef.current = true;
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    const msgs: string[] = [];
    const next = [...shotsRef.current];
    for (const file of Array.from(files)) {
      if (next.length >= shotCount) {
        msgs.push(`Maksimal ${shotCount} foto; sisanya diabaikan.`);
        break;
      }
      const res = await validateImageFile(file, aspectRatio);
      if (!res.ok) {
        msgs.push(res.error);
        continue;
      }
      if (res.warning) msgs.push(res.warning);
      next.push({
        id: newId(),
        blob: res.blob,
        url: URL.createObjectURL(res.blob),
        width: res.width,
        height: res.height,
        source: 'upload',
      });
    }
    commitShots(next);
    setNotes(msgs);
    if (next.length) setPhase('review');
    if (fileRef.current) fileRef.current.value = '';
  };

  const confirm = () => {
    handedOff.current = true;
    onComplete(shotsRef.current);
  };

  const running = phase === 'running';
  const changeCount = (n: Count) => {
    setShotCount(n);
    onShotCountChange?.(n);
  };

  return (
    <div className={`flex w-full flex-col gap-4 ${className}`}>
      {/* ---------------- Viewfinder ---------------- */}
      <div
        className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-[2rem] bg-stone-950 shadow-[inset_0_2px_12px_rgba(0,0,0,.6),0_12px_30px_rgba(0,0,0,.35)] ring-8 ring-stone-800"
        style={{ aspectRatio }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
          style={{ transform: mirror ? 'scaleX(-1)' : undefined }}
        />

        {status === 'starting' && <Overlay>Membuka kamera…</Overlay>}
        {status === 'error' && (
          <Overlay>
            <p className="max-w-xs text-center text-sm">{error}</p>
            <button onClick={restart} className={btn('light')}>
              Coba lagi
            </button>
          </Overlay>
        )}

        {tick !== null && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black/10">
            <span key={`${current}-${tick}`} className="animate-pop text-[clamp(6rem,30vw,12rem)] font-black leading-none text-white drop-shadow-[0_6px_24px_rgba(0,0,0,.6)]">
              {tick}
            </span>
          </div>
        )}

        {running && (
          <div className="absolute left-4 top-4 rounded-full bg-black/60 px-3 py-1 text-sm font-semibold text-white backdrop-blur">
            Foto {current + 1} / {shotCount}
          </div>
        )}

        {/* flash layar */}
        <div
          className={`pointer-events-none absolute inset-0 bg-white transition-opacity ${flash ? 'opacity-100 duration-75' : 'opacity-0 duration-500'}`}
        />
      </div>

      {/* ---------------- Strip thumbnail ---------------- */}
      <div className="mx-auto flex gap-2">
        {Array.from({ length: shotCount }, (_, i) => (
          <div
            key={i}
            className="h-14 overflow-hidden rounded-lg bg-stone-200 ring-2 ring-stone-300"
            style={{ aspectRatio }}
          >
            {shots[i] && <img src={shots[i].url} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" />}
          </div>
        ))}
      </div>

      {notes.length > 0 && (
        <ul className="mx-auto max-w-3xl space-y-1 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          {notes.map((n, i) => (
            <li key={i}>• {n}</li>
          ))}
        </ul>
      )}

      {/* ---------------- Kontrol ---------------- */}
      {phase === 'review' ? (
        <div className="mx-auto flex gap-3">
          <button
            className={btn('light')}
            onClick={() => {
              discardShots();
              setNotes([]);
              setPhase('idle');
            }}
          >
            Ulangi
          </button>
          <button className={btn('primary')} onClick={confirm}>
            Pakai foto ini ({shots.length})
          </button>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-center gap-x-6 gap-y-3">
          <Segmented
            label="Foto"
            disabled={running}
            value={shotCount}
            options={[3, 4]}
            onChange={(v) => changeCount(v as Count)}
          />
          <Segmented
            label="Timer"
            disabled={running}
            value={countdown}
            options={[3, 5, 10]}
            suffix="s"
            onChange={(v) => setCountdown(v as Timer)}
          />

          {/* tombol shutter */}
          {running ? (
            <button onClick={cancelBurst} aria-label="Batalkan" className={`${btn('light')} order-last w-full sm:order-none sm:w-auto`}>
              Batal
            </button>
          ) : (
            <button
              onClick={runBurst}
              disabled={status !== 'ready'}
              aria-label="Mulai ambil foto"
              className="group grid h-20 w-20 place-items-center rounded-full bg-stone-800 shadow-[0_6px_0_#0c0a09,0_10px_20px_rgba(0,0,0,.4)] transition active:translate-y-1 active:shadow-[0_2px_0_#0c0a09] disabled:opacity-40"
            >
              <span className="h-14 w-14 rounded-full bg-red-500 ring-4 ring-red-200/60 transition group-active:scale-95" />
            </button>
          )}

          <div className="flex flex-wrap justify-center gap-2">
            <button disabled={running} onClick={() => setMirror((m) => !m)} aria-pressed={mirror} className={btn(mirror ? 'dark' : 'light')}>
              Mirror
            </button>
            {canSwitch && (
              <button disabled={running} onClick={switchCamera} className={btn('light')}>
                Ganti kamera
              </button>
            )}
            <button disabled={running} onClick={() => setLive((l) => !l)} aria-pressed={live} className={btn(live ? 'dark' : 'light')}>
              Live 2s
            </button>
            <button disabled={running} onClick={() => fileRef.current?.click()} className={btn('light')}>
              Unggah
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(e) => void handleUpload(e.target.files)}
          />
        </div>
      )}
    </div>
  );
}

/* ---------------- UI kecil ---------------- */

function btn(kind: 'light' | 'dark' | 'primary') {
  const base =
    'rounded-xl px-4 py-2.5 text-sm font-semibold transition active:translate-y-0.5 disabled:opacity-40 disabled:pointer-events-none';
  if (kind === 'primary') return `${base} bg-orange-500 text-white shadow-[0_4px_0_#c2410c]  active:shadow-none`;
  if (kind === 'dark') return `${base} bg-stone-800 text-white shadow-[0_4px_0_#0c0a09] active:shadow-none`;
  return `${base} bg-white text-stone-800 shadow-[0_4px_0_#d6d3d1] ring-1 ring-stone-200 active:shadow-none`;
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-stone-950/85 p-6 text-white">
      {children}
    </div>
  );
}

function Segmented({
  label,
  value,
  options,
  suffix = '',
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  suffix?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex rounded-xl bg-stone-200 p-1 shadow-inner">
        {options.map((o) => (
          <button
            key={o}
            role="radio"
            aria-checked={value === o}
            disabled={disabled}
            onClick={() => onChange(o)}
            className={`min-w-11 rounded-lg px-3 py-2 text-sm font-bold transition disabled:opacity-50 ${
              value === o ? 'bg-white text-stone-900 shadow' : 'text-stone-500'
            }`}
          >
            {o}
            {suffix}
          </button>
        ))}
      </div>
    </div>
  );
}
