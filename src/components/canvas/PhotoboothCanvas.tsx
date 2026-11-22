'use client';

/**
 * PhotoboothCanvas — mesin render kanvas photobooth (React-Konva).
 *
 * Layer (bawah → atas):
 *   1. Background   : warna / pola
 *   2. Slot foto    : tiap slot = Group dengan clip rect (clipping mask) berisi foto yang bisa
 *                     di-drag, di-zoom (pinch / wheel) dan diputar (2 jari / Shift+wheel)
 *   3. Frame        : PNG transparan, tidak interaktif
 *   4. Item         : teks, stempel tanggal, stiker (Transformer untuk move/scale/rotate)
 *
 * Koordinat internal selalu "logis" (mis. 1200×3600). Tampilan di layar hanya di-scale lewat
 * Stage.scale; ekspor memakai pixelRatio = multiplier / scale sehingga hasil = resolusi penuh.
 *
 * WAJIB di-import dengan next/dynamic { ssr: false } — Konva butuh DOM/canvas.
 */

import Konva from 'konva';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Group, Rect, Image as KImage, Text, Transformer } from 'react-konva';
import useImage from 'use-image';

import { FILTERS } from '@/lib/filters';
import { createPatternCanvas } from '@/lib/patterns';
import type {
  FilterId,
  OverlayItem,
  PhotoboothCanvasHandle,
  PhotoboothCanvasProps,
  SlotRect,
  SlotTransform,
} from '@/types/photobooth';

// Agar touch tetap terkirim ke stage saat sebuah node sedang di-drag (dibutuhkan untuk pinch).
Konva.hitOnDragEnabled = true;

const IDENTITY: SlotTransform = { x: 0, y: 0, scale: 1, rotation: 0 };
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
/** Batas aman area canvas di iOS Safari (~16.7 MP). */
const MAX_EXPORT_PIXELS = 16_777_216;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/* -------------------------------------------------------------------------- */
/* Layer 2 — satu slot foto                                                    */
/* -------------------------------------------------------------------------- */

interface SlotPhotoProps {
  index: number;
  slot: SlotRect;
  src: string | null;
  transform: SlotTransform;
  filter: FilterId;
  registerNode: (index: number, node: Konva.Group | null) => void;
  onTransformChange: (index: number, patch: Partial<SlotTransform>) => void;
  onEmptyClick?: (index: number) => void;
}

function SlotPhoto({ index, slot, src, transform, filter, registerNode, onTransformChange, onEmptyClick }: SlotPhotoProps) {
  const [img] = useImage(src ?? '', 'anonymous');
  const imgRef = useRef<Konva.Image>(null);

  // Node memakai ukuran asli foto; "cover" + zoom diterapkan lewat scale. Zoom jadi tetap tajam
  // dan cache filter berada di resolusi asli.
  const cover = img ? Math.max(slot.width / img.naturalWidth, slot.height / img.naturalHeight) : 1;

  // Filter real-time berbasis Canvas: cache node lalu terapkan fungsi piksel.
  useEffect(() => {
    const node = imgRef.current;
    if (!node || !img) return;
    const list = FILTERS[filter];
    if (list.length === 0) {
      node.clearCache();
      node.filters([]);
    } else {
      node.cache({ pixelRatio: 1 });
      node.filters(list);
    }
    node.getLayer()?.batchDraw();
  }, [img, filter]);

  const maxX = slot.width / 2;
  const maxY = slot.height / 2;

  return (
    <Group x={slot.x} y={slot.y} clipX={0} clipY={0} clipWidth={slot.width} clipHeight={slot.height}>
      <Rect
        width={slot.width}
        height={slot.height}
        fill="#e7e5e4"
        onClick={() => !src && onEmptyClick?.(index)}
        onTap={() => !src && onEmptyClick?.(index)}
      />
      {!src && (
        <Text
          width={slot.width}
          height={slot.height}
          text={`+\n${index + 1}`}
          align="center"
          verticalAlign="middle"
          fontSize={Math.round(slot.height * 0.14)}
          fill="#a8a29e"
          listening={false}
        />
      )}
      {img && (
        <Group
          ref={(n) => {
            registerNode(index, n);
            return () => registerNode(index, null);
          }}
          x={slot.width / 2 + transform.x}
          y={slot.height / 2 + transform.y}
          rotation={transform.rotation}
          scaleX={cover * transform.scale}
          scaleY={cover * transform.scale}
          draggable
          onDragEnd={(e) => {
            const n = e.target;
            const x = clamp(n.x() - slot.width / 2, -maxX, maxX);
            const y = clamp(n.y() - slot.height / 2, -maxY, maxY);
            n.position({ x: slot.width / 2 + x, y: slot.height / 2 + y });
            onTransformChange(index, { x, y });
          }}
          onDblClick={() => onTransformChange(index, IDENTITY)}
          onDblTap={() => onTransformChange(index, IDENTITY)}
        >
          <KImage
            ref={imgRef}
            image={img}
            x={-img.naturalWidth / 2}
            y={-img.naturalHeight / 2}
            width={img.naturalWidth}
            height={img.naturalHeight}
          />
        </Group>
      )}
    </Group>
  );
}

/* -------------------------------------------------------------------------- */
/* Layer 1 — gambar latar (cover: memenuhi kanvas tanpa melar)                 */
/* -------------------------------------------------------------------------- */

function BackgroundImage({ src, width, height }: { src: string; width: number; height: number }) {
  const [img] = useImage(src, 'anonymous');
  if (!img) return null;
  const k = Math.max(width / img.naturalWidth, height / img.naturalHeight);
  const w = img.naturalWidth * k;
  const h = img.naturalHeight * k;
  return <KImage image={img} x={(width - w) / 2} y={(height - h) / 2} width={w} height={h} listening={false} />;
}

/* -------------------------------------------------------------------------- */
/* Layer 3 — frame PNG                                                         */
/* -------------------------------------------------------------------------- */

function FrameImage({ src, width, height }: { src: string; width: number; height: number }) {
  const [img] = useImage(src, 'anonymous');
  return img ? <KImage image={img} width={width} height={height} listening={false} /> : null;
}

/* -------------------------------------------------------------------------- */
/* Layer 4 — teks & stiker                                                     */
/* -------------------------------------------------------------------------- */

interface ItemNodeProps {
  item: OverlayItem;
  register: (id: string, node: Konva.Node | null) => void;
  onChange: (id: string, node: Konva.Node) => void;
}

function ItemNode({ item, register, onChange }: ItemNodeProps) {
  const [sticker] = useImage(item.kind === 'image' ? (item.src ?? '') : '', 'anonymous');
  const common = {
    id: item.id,
    name: 'overlay-item',
    x: item.x,
    y: item.y,
    rotation: item.rotation,
    scaleX: item.scale,
    scaleY: item.scale,
    draggable: true,
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => onChange(item.id, e.target),
    onTransformEnd: (e: Konva.KonvaEventObject<Event>) => onChange(item.id, e.target),
  };
  const refCb = (n: Konva.Node | null) => {
    register(item.id, n);
    return () => register(item.id, null);
  };

  if (item.kind === 'text') {
    return (
      <Text
        {...common}
        ref={refCb}
        text={item.text ?? ''}
        width={item.width}
        align={item.align ?? 'left'}
        fontSize={item.fontSize ?? 64}
        fontFamily={item.fontFamily ?? 'sans-serif'}
        fontStyle={item.fontStyle ?? 'normal'}
        fill={item.fill ?? '#000'}
      />
    );
  }
  if (!sticker) return null;
  const w = item.width ?? 300;
  return <KImage {...common} ref={refCb} image={sticker} width={w} height={(w * sticker.naturalHeight) / sticker.naturalWidth} />;
}

/* -------------------------------------------------------------------------- */
/* Komponen utama                                                              */
/* -------------------------------------------------------------------------- */

export default function PhotoboothCanvas({
  layout,
  photos,
  background,
  frameSrc,
  filter,
  items,
  onItemsChange,
  onSlotClick,
  onSelectionChange,
  className,
  ref,
}: PhotoboothCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const itemNodes = useRef(new Map<string, Konva.Node>());
  const slotNodes = useRef(new Map<number, Konva.Group>());
  const pinch = useRef<{ slot: number; dist: number; angle: number; cx: number; cy: number } | null>(null);
  const prevPhotos = useRef<(string | null)[]>([]);

  const [box, setBox] = useState({ w: 0, h: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transforms, setTransforms] = useState<SlotTransform[]>(() => layout.slots.map(() => ({ ...IDENTITY })));

  /* ---- ukuran responsif: fit-contain di dalam container ---- */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = useMemo(() => {
    if (!box.w) return 0;
    const byW = box.w / layout.width;
    const byH = box.h > 0 ? box.h / layout.height : byW;
    return Math.min(byW, byH);
  }, [box, layout.width, layout.height]);

  /* ---- reset transform slot jika fotonya berganti / jumlah slot berubah ---- */
  useEffect(() => {
    const before = prevPhotos.current;
    prevPhotos.current = photos;
    setTransforms((prev) => layout.slots.map((_, i) => (before[i] === photos[i] && prev[i] ? prev[i] : { ...IDENTITY })));
  }, [photos, layout.slots]);

  /* ---- Layer 1: pola ---- */
  const patternCanvas = useMemo(
    () => (background.kind === 'pattern' ? createPatternCanvas(background.pattern, background.color, background.accent) : null),
    [background],
  );

  /* ---- helper koordinat ---- */
  const toLogical = useCallback(
    (clientX: number, clientY: number) => {
      const rect = stageRef.current!.container().getBoundingClientRect();
      return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
    },
    [scale],
  );
  const slotAt = useCallback(
    (p: { x: number; y: number }) =>
      layout.slots.findIndex((s) => p.x >= s.x && p.x <= s.x + s.width && p.y >= s.y && p.y <= s.y + s.height),
    [layout.slots],
  );

  const patchTransform = useCallback((index: number, patch: Partial<SlotTransform>) => {
    setTransforms((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }, []);

  /* ---- pinch-to-zoom + rotate (2 jari) di dalam slot ---- */
  const handleTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const t = e.evt.touches;
    if (t.length !== 2) {
      pinch.current = null;
      return;
    }
    e.evt.preventDefault();
    const a = toLogical(t[0].clientX, t[0].clientY);
    const b = toLogical(t[1].clientX, t[1].clientY);
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

    const p = pinch.current;
    if (!p) {
      const slot = slotAt(c);
      if (slot < 0 || !photos[slot]) return;
      slotNodes.current.get(slot)?.stopDrag(); // hentikan drag 1 jari yang sedang berjalan
      pinch.current = { slot, dist, angle, cx: c.x, cy: c.y };
      return;
    }

    let dAngle = angle - p.angle;
    if (dAngle > 180) dAngle -= 360;
    if (dAngle < -180) dAngle += 360;
    const rect = layout.slots[p.slot];
    const factor = p.dist > 0 ? dist / p.dist : 1;
    setTransforms((prev) =>
      prev.map((tr, i) =>
        i !== p.slot
          ? tr
          : {
              x: clamp(tr.x + (c.x - p.cx), -rect.width / 2, rect.width / 2),
              y: clamp(tr.y + (c.y - p.cy), -rect.height / 2, rect.height / 2),
              scale: clamp(tr.scale * factor, MIN_ZOOM, MAX_ZOOM),
              rotation: tr.rotation + dAngle,
            },
      ),
    );
    pinch.current = { ...p, dist, angle, cx: c.x, cy: c.y };
  };

  /* ---- desktop: wheel = zoom, Shift+wheel = rotasi ---- */
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    const pos = stageRef.current?.getPointerPosition();
    if (!pos) return;
    const slot = slotAt({ x: pos.x / scale, y: pos.y / scale });
    if (slot < 0 || !photos[slot]) return;
    e.evt.preventDefault();
    const dy = e.evt.deltaY || e.evt.deltaX;
    setTransforms((prev) =>
      prev.map((tr, i) =>
        i !== slot
          ? tr
          : e.evt.shiftKey
            ? { ...tr, rotation: tr.rotation + dy * 0.1 }
            : { ...tr, scale: clamp(tr.scale * Math.exp(-dy * 0.0015), MIN_ZOOM, MAX_ZOOM) },
      ),
    );
  };

  /* ---- seleksi item Layer 4 ---- */
  const handlePointerDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const target = e.target;
    if (target.getParent()?.className === 'Transformer') return;
    setSelectedId(target.hasName('overlay-item') ? target.id() : null);
  };

  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selectedId ? itemNodes.current.get(selectedId) : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, items]);

  useEffect(() => {
    onSelectionChange?.(selectedId);
  }, [selectedId, onSelectionChange]);

  const registerItem = useCallback((id: string, node: Konva.Node | null) => {
    if (node) itemNodes.current.set(id, node);
    else itemNodes.current.delete(id);
  }, []);
  const registerSlot = useCallback((i: number, node: Konva.Group | null) => {
    if (node) slotNodes.current.set(i, node);
    else slotNodes.current.delete(i);
  }, []);

  const commitItem = useCallback(
    (id: string, node: Konva.Node) => {
      onItemsChange?.(
        items.map((it) =>
          it.id === id ? { ...it, x: node.x(), y: node.y(), rotation: node.rotation(), scale: node.scaleX() } : it,
        ),
      );
    },
    [items, onItemsChange],
  );

  /* ---- API imperatif: ekspor resolusi penuh ---- */
  useImperativeHandle(
    ref,
    () => ({
      clearSelection: () => setSelectedId(null),
      resetSlot: (i) => patchTransform(i, IDENTITY),
      exportBlob: async ({ format = 'png', quality = 1, multiplier = 1 } = {}) => {
        const stage = stageRef.current;
        if (!stage || !scale) throw new Error('Kanvas belum siap.');
        // Sembunyikan handle Transformer dari hasil ekspor.
        trRef.current?.nodes([]);
        trRef.current?.getLayer()?.draw();

        const maxMul = Math.sqrt(MAX_EXPORT_PIXELS / (layout.width * layout.height));
        const mul = Math.max(0.1, Math.min(multiplier, maxMul));
        const blob = await stage.toBlob({
          mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
          quality,
          // ukuran stage di layar = layout * scale  →  pixelRatio = mul / scale mengembalikan ke layout * mul.
          pixelRatio: mul / scale,
        });
        if (!blob) throw new Error('Gagal merender gambar.');
        return blob as Blob;
      },
    }),
    [scale, layout.width, layout.height, patchTransform],
  );

  return (
    <div ref={containerRef} className={className ?? 'h-full w-full'} style={{ touchAction: 'none' }}>
      {scale > 0 && (
        <Stage
          ref={stageRef}
          width={Math.floor(layout.width * scale)}
          height={Math.floor(layout.height * scale)}
          scaleX={scale}
          scaleY={scale}
          onPointerDown={handlePointerDown}
          onTouchMove={handleTouchMove}
          onTouchEnd={() => (pinch.current = null)}
          onWheel={handleWheel}
          style={{ margin: '0 auto', boxShadow: '0 10px 40px rgba(0,0,0,.25)' }}
        >
          {/* Layer 1 — Background */}
          <Layer listening={false}>
            {background.kind === 'pattern' ? (
              <Rect
                width={layout.width}
                height={layout.height}
                fillPatternImage={patternCanvas as unknown as HTMLImageElement}
                fillPatternRepeat="repeat"
              />
            ) : (
              <Rect width={layout.width} height={layout.height} fill={background.color} />
            )}
            {background.kind === 'image' && (
              <BackgroundImage src={background.src} width={layout.width} height={layout.height} />
            )}
          </Layer>

          {/* Layer 2 — Slot foto (clipping mask per slot) */}
          <Layer>
            {layout.slots.map((slot, i) => (
              <SlotPhoto
                key={i}
                index={i}
                slot={slot}
                src={photos[i] ?? null}
                transform={transforms[i] ?? IDENTITY}
                filter={filter}
                registerNode={registerSlot}
                onTransformChange={patchTransform}
                onEmptyClick={onSlotClick}
              />
            ))}
          </Layer>

          {/* Layer 3 — Overlay frame PNG transparan */}
          <Layer listening={false}>
            {frameSrc && <FrameImage src={frameSrc} width={layout.width} height={layout.height} />}
          </Layer>

          {/* Layer 4 — Teks, stempel tanggal, stiker */}
          <Layer>
            {items.map((it) => (
              <ItemNode key={it.id} item={it} register={registerItem} onChange={commitItem} />
            ))}
            <Transformer
              ref={trRef}
              keepRatio
              rotateEnabled
              enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
              anchorSize={Math.round(26 / scale)}
              anchorCornerRadius={Math.round(13 / scale)}
              borderStrokeWidth={2 / scale}
              anchorStrokeWidth={2 / scale}
              rotateAnchorOffset={Math.round(36 / scale)}
              borderStroke="#f97316"
              anchorStroke="#f97316"
              boundBoxFunc={(oldBox, newBox) => (newBox.width < 40 || newBox.height < 40 ? oldBox : newBox)}
            />
          </Layer>
        </Stage>
      )}
    </div>
  );
}
