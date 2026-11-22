const CANDIDATES = [
  'video/mp4;codecs=avc1',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function pickVideoMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
}

export interface ClipRecorder {
  stop: () => Promise<Blob | null>;
}

/**
 * Merekam klip baru dari stream. Kita memulai rekaman tepat 2 detik sebelum jepretan
 * (jadwal countdown sudah deterministik), sehingga setiap klip valid & berdiri sendiri —
 * tidak perlu "ring buffer" yang rumit (chunk MediaRecorder selain yang pertama tidak bisa diputar sendiri).
 */
export function startClipRecorder(stream: MediaStream): ClipRecorder | null {
  try {
    if (typeof MediaRecorder === 'undefined') return null;
    const mimeType = pickVideoMime();
    const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 4_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const done = new Promise<Blob | null>((resolve) => {
      rec.onstop = () =>
        resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType || mimeType || 'video/webm' }) : null);
      rec.onerror = () => resolve(null);
    });
    rec.start();
    return {
      stop: () => {
        if (rec.state !== 'inactive') rec.stop();
        return done;
      },
    };
  } catch {
    return null;
  }
}
