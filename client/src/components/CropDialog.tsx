import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Choose the part of a photo to keep (FB-11, phase 5).
 *
 * The shape is fixed — 4:3 for an activity, a square (shown as a circle) for a
 * portrait — so a photo always fills its card. Drag to move, use the slider
 * (or the mouse wheel) to zoom, arrow keys to nudge.
 *
 * Nothing is cut here: the dialog returns a box in the photo's own pixels and
 * the server cuts the original with it, so the stored photo loses no quality.
 * The browser shows a phone photo the right way up (CSS `image-orientation`
 * defaults to `from-image`), and the server turns it the same way before
 * cutting, so the box lands on the same pixels.
 *
 * Rendered into <body>, because it opens over editors that are already
 * dialogs: Escape closes only this one.
 */
export type CropBox = { x: number; y: number; width: number; height: number };

const MAX_ZOOM = 4;

export function CropDialog({
  file,
  shape,
  onCancel,
  onConfirm,
}: {
  file: File;
  shape: 'wide' | 'square';
  onCancel: () => void;
  /** null when the browser could not show the photo: use it uncut. */
  onConfirm: (crop: CropBox | null) => void;
}) {
  const aspect = shape === 'square' ? 1 : 4 / 3;
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [frameW, setFrameW] = useState(0);
  const [zoom, setZoom] = useState(1);
  /** Top-left of the photo relative to the frame, in screen pixels (≤ 0). */
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; px: number; py: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setFrameW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const frameH = frameW / aspect;
  /** Scale at zoom 1: the photo just covers the frame. */
  const cover = natural ? Math.max(frameW / natural.w, frameH / natural.h) : 1;
  const scale = cover * zoom;

  const clamp = useCallback(
    (p: { x: number; y: number }, s: number) => {
      if (!natural) return p;
      const minX = frameW - natural.w * s;
      const minY = frameH - natural.h * s;
      return { x: Math.min(0, Math.max(minX, p.x)), y: Math.min(0, Math.max(minY, p.y)) };
    },
    [natural, frameW, frameH],
  );

  // Centre the photo once its size and the frame's are known.
  const centred = useRef(false);
  useEffect(() => {
    if (!natural || !frameW || centred.current) return;
    centred.current = true;
    const s = Math.max(frameW / natural.w, frameH / natural.h);
    setPos({ x: (frameW - natural.w * s) / 2, y: (frameH - natural.h * s) / 2 });
  }, [natural, frameW, frameH]);

  // Keep the photo covering the frame if the frame is resized.
  useEffect(() => {
    setPos((p) => clamp(p, scale));
  }, [clamp, scale]);

  /** Zoom about the frame's centre, so the middle of the view stays put. */
  function zoomTo(next: number) {
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    const s0 = scale;
    const s1 = cover * z;
    const cx = frameW / 2;
    const cy = frameH / 2;
    setZoom(z);
    setPos(clamp({ x: cx - ((cx - pos.x) * s1) / s0, y: cy - ((cy - pos.y) * s1) / s0 }, s1));
  }

  useEffect(() => {
    panel.current?.focus();
    // Capture on window runs before the editor dialog's own Escape listener,
    // and stopping it here keeps that dialog open.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  function nudge(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 20 : 5;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      setPos((p) => clamp({ x: p.x + m[0], y: p.y + m[1] }, scale));
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomTo(zoom + 0.1);
    } else if (e.key === '-') {
      e.preventDefault();
      zoomTo(zoom - 0.1);
    }
  }

  function confirm() {
    if (!natural || !frameW) return;
    onConfirm({
      x: -pos.x / scale,
      y: -pos.y / scale,
      width: frameW / scale,
      height: frameH / scale,
    });
  }

  const ready = Boolean(natural && frameW);

  return createPortal(
    <div
      className="modal-backdrop crop-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="modal crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crop-title"
        tabIndex={-1}
        ref={panel}
      >
        <div className="modal-head">
          <div>
            <h2 id="crop-title">{shape === 'square' ? 'Frame the portrait' : 'Frame the photo'}</h2>
            <p className="sub">
              {shape === 'square'
                ? 'Drag to move, zoom to get closer. The circle is what people will see.'
                : 'Drag to move, zoom to get closer. The box is the shape of the card on your booking page.'}
            </p>
          </div>
        </div>

        <div className="modal-body">
          <div
            ref={frame}
            className={`crop-frame ${shape}`}
            // Never taller than half the screen, so the zoom slider and the
            // buttons stay in view on a short laptop or a phone held sideways.
            style={{ aspectRatio: String(aspect), width: `min(100%, ${(50 * aspect).toFixed(2)}vh)` }}
            tabIndex={0}
            role="application"
            aria-label="Photo position. Use the arrow keys to move it, plus and minus to zoom."
            onKeyDown={nudge}
            onPointerDown={(e) => {
              if (!ready) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.id !== e.pointerId) return;
              setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }, scale));
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onWheel={(e) => {
              if (ready) zoomTo(zoom - e.deltaY * 0.002);
            }}
          >
            {src && !failed && (
              <img
                src={src}
                alt=""
                draggable={false}
                onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                onError={() => setFailed(true)}
                style={
                  natural
                    ? {
                        width: natural.w * scale,
                        height: natural.h * scale,
                        transform: `translate(${pos.x}px, ${pos.y}px)`,
                      }
                    : { visibility: 'hidden' }
                }
              />
            )}
            {failed && (
              <p className="tiny muted crop-fallback">
                This browser cannot show that photo to frame it. It will be used as it is.
              </p>
            )}
          </div>

          <div className="crop-zoom">
            <label htmlFor="cropZoom" className="tiny">Zoom</label>
            <input
              id="cropZoom"
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              disabled={!ready}
              onChange={(e) => zoomTo(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="modal-foot">
          <button
            type="button"
            className="primary"
            disabled={!ready && !failed}
            onClick={() => (failed ? onConfirm(null) : confirm())}
          >
            Use this photo
          </button>
          <button type="button" className="link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
