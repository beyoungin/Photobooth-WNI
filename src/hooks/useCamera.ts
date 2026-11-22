'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'idle' | 'starting' | 'ready' | 'error';

function describeError(e: unknown): string {
  const name = (e as DOMException)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Izin kamera ditolak. Aktifkan izin kamera di pengaturan browser, lalu coba lagi.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Kamera tidak ditemukan di perangkat ini.';
    case 'NotReadableError':
      return 'Kamera sedang dipakai aplikasi lain.';
    default:
      return 'Gagal membuka kamera. Anda bisa mengunggah foto dari galeri.';
  }
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const token = useRef(0);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [mirror, setMirror] = useState(true);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  const start = useCallback(
    async (id?: string) => {
      const mine = ++token.current; // batalkan start() yang masih berjalan (Strict Mode / klik cepat)
      stop();
      setStatus('starting');
      setError(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('error');
        setError('Browser tidak mendukung akses kamera (butuh HTTPS atau localhost).');
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
            ...(id ? { deviceId: { exact: id } } : { facingMode: { ideal: 'user' } }),
          },
        });
        if (mine !== token.current) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        setStream(s);
        const settings = s.getVideoTracks()[0]?.getSettings();
        setDeviceId(settings?.deviceId);
        // Kamera belakang tidak di-mirror; kamera depan / webcam di-mirror seperti cermin.
        setMirror(settings?.facingMode !== 'environment');
        // enumerateDevices baru berisi label/ID lengkap setelah izin diberikan.
        const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        if (mine === token.current) {
          setDevices(list);
          setStatus('ready');
        }
      } catch (e) {
        if (mine !== token.current) return;
        setStatus('error');
        setError(describeError(e));
      }
    },
    [stop],
  );

  const switchCamera = useCallback(() => {
    if (devices.length < 2) return;
    const idx = devices.findIndex((d) => d.deviceId === deviceId);
    void start(devices[(idx + 1) % devices.length].deviceId);
  }, [devices, deviceId, start]);

  // Pasang stream ke <video>.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) v.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    void start();
    return () => {
      token.current++;
      stop();
    };
  }, [start, stop]);

  return { videoRef, stream, status, error, canSwitch: devices.length > 1, switchCamera, mirror, setMirror, restart: () => start(deviceId) };
}
